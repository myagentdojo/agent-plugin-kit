import { expect, test } from "bun:test"
import { literalHelpProcess, literalUsageProcess } from "../../../modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"
import {
  createDiagnosticPipeline,
  createLogTapeDiagnosticAdapter,
} from "../implementation/logtape-diagnostic-adapter"
import {
  createEventDelivery,
  createMaintenanceEventAdapter,
} from "../implementation/maintenance-event-adapter"
import { createMaintenanceCommandFacade } from "../implementation/maintenance-command-facade"
import type {
  DiagnosticMode,
  DiagnosticRecord,
  DiagnosticRedactionStep,
  EventAdapter,
  EventRecord,
  FacadeCorrelationSources,
} from "../interface"
import { invokePublicProcess } from "./adapters/public-process-adapter"
import { createDiagnosticRecordingAdapter } from "./adapters/diagnostic-recording-adapter"
import {
  createEventRecordingAdapter,
  createFakeClockRecordingAdapter,
  createTransportRecordingAdapter,
} from "./adapters/event-recording-adapter"
import { createMaintenanceCommandsRecordingAdapter } from "./adapters/maintenance-commands-recording-adapter"
import {
  bufferedSequence,
  diagnosticModeContract,
  diagnosticModes,
  fixedEventFailure,
  hostileColorEnvironment,
  lifecycleContract,
  redactionContract,
} from "./fixtures/literal-observability-cases"

const absent = (actual: unknown, expected: unknown, claim: string) =>
  expect(actual, `contract-absent: ${claim}`).toEqual(expected)

const diagnosticRecord = (
  sequence: number,
  level: DiagnosticRecord["level"],
  event = `fixture.${level}`,
): DiagnosticRecord => Object.freeze({
  schema_version: 1,
  record_type: "diagnostic",
  timestamp: "2026-08-27T00:00:00.000Z",
  sequence,
  level,
  category: ["agent-plugin-kit", "maintenance"] as const,
  event,
  run_id: "contract-help-literal",
  command: "help",
  station_id: "help.previewed",
  result_code: "previewed",
  transaction_state: "unchanged",
  retry_safety: "safe",
  message: "redacted fixture diagnostic",
})

const fixedCorrelation: FacadeCorrelationSources = {
  now: () => "2026-08-27T00:00:00.000Z",
  eventId: () => "opaque-event-id",
}

function diagnosticHarness(
  mode: DiagnosticMode,
  options: {
    nextSequence?: () => number
    redactionTrace?: (step: DiagnosticRedactionStep) => void
  } = {},
) {
  const recording = createDiagnosticRecordingAdapter()
  return {
    ...recording,
    pipeline: createDiagnosticPipeline({
      mode,
      maximumBufferedRecords: 250,
      diagnostics: recording.adapter,
      ...(options.nextSequence === undefined ? {} : { nextSequence: options.nextSequence }),
      ...(options.redactionTrace === undefined ? {} : { redactionTrace: options.redactionTrace }),
    }),
  }
}

async function facadeHarness(options: {
  eventAcceptance?: "accepted" | "refused"
  eventAdapter?: EventAdapter
  eventFactory?: () => Promise<EventAdapter | undefined>
  withoutEventFactory?: boolean
  throwOnDispose?: boolean
  argv?: readonly string[]
  environment?: Readonly<Record<string, string | undefined>>
} = {}) {
  const commands = createMaintenanceCommandsRecordingAdapter()
  const diagnostics = createDiagnosticRecordingAdapter(
    options.throwOnDispose === undefined ? {} : { throwOnDispose: options.throwOnDispose },
  )
  const events = createEventRecordingAdapter({ status: options.eventAcceptance ?? "accepted" })
  const facade = createMaintenanceCommandFacade({
    commands: commands.commands,
    diagnosticFactory: async () => diagnostics.adapter,
    ...(options.withoutEventFactory
      ? {}
      : {
          eventFactory: options.eventFactory ?? (async () => options.eventAdapter ?? events.adapter),
        }),
    correlation: fixedCorrelation,
  })
  const observation = await facade.invoke({
    argv: options.argv ?? ["--run-id", "contract-help-literal", "help"],
    environment: options.environment ?? {
      AGENT_PLUGIN_KIT_EVENT_ENDPOINT: "http://127.0.0.1:9/events",
      AGENT_PLUGIN_KIT_EVENT_AUTH: "fixture-secret-must-not-cross",
    },
    stdin: "",
  })
  return { commands, diagnostics, events, observation }
}

const productionEventHarness = () => {
  const production = createMaintenanceEventAdapter({ endpoint: fixedEventFailure.endpoint })
  if (production === undefined) throw new Error("fixture endpoint must be accepted by the production Event Adapter")
  const records: EventRecord[] = []
  const adapter: EventAdapter = {
    accept(record) {
      records.push(record)
      return production.accept(record)
    },
  }
  return { adapter, records }
}

const productionDiagnosticLifecycle = () => {
  const firstWrites: string[] = []
  const first = createLogTapeDiagnosticAdapter({ write: (line) => firstWrites.push(line) })
  first.record(diagnosticRecord(1, "error", "fixture.production-first"))
  first.record(diagnosticRecord(2, "error", "fixture.production-second"))
  first.flush()
  first.dispose()
  first.dispose()

  const secondWrites: string[] = []
  const second = createLogTapeDiagnosticAdapter({ write: (line) => secondWrites.push(line) })
  second.record(diagnosticRecord(3, "error", "fixture.production-after-reset"))
  second.dispose()
  return { firstWrites, secondWrites }
}

const productionLogTapeSummaryFor = (lifecycle: ReturnType<typeof productionDiagnosticLifecycle>) => ({
  firstEvents: lifecycle.firstWrites.map((line) => (JSON.parse(line) as DiagnosticRecord).event),
  secondEvents: lifecycle.secondWrites.map((line) => (JSON.parse(line) as DiagnosticRecord).event),
})

const directFacadeCorrelationFor = async () => {
  const facade = await facadeHarness({ eventAcceptance: "refused" })
  const event = facade.events.records[0]
  const diagnostics = facade.diagnostics.records
  return {
    runIds: [event?.run_id, diagnostics.at(-1)?.run_id],
    sequences: [event?.sequence, diagnostics.at(-1)?.sequence],
    uniqueSequences: new Set([
      event?.sequence,
      ...diagnostics.map(({ sequence }) => sequence),
    ]).size === diagnostics.length + 1,
  }
}

const overflowSummaryFor = (records: readonly DiagnosticRecord[]) => {
  const sequences = records.map(({ sequence }) => sequence)
  const truncationIndex = records.findIndex(({ event }) => event === "diagnostic.buffer-truncated")
  return {
    firstEvent: records[0]?.event,
    sequences,
    truncationSequence: truncationIndex < 0 ? undefined : records[truncationIndex]?.sequence,
    firstRetained: records[0]?.sequence,
    lastRetained: truncationIndex <= 0 ? undefined : records[truncationIndex - 1]?.sequence,
    triggerEvent: records.at(-1)?.event,
    triggerSequence: records.at(-1)?.sequence,
    recordCount: records.length,
    truncationRecords: records.filter(({ event }) => event === "diagnostic.buffer-truncated").length,
    uniqueSequences: new Set(sequences).size === sequences.length,
  }
}

test("machine stdout contains only the primary success envelope", async () => {
  absent(
    await invokePublicProcess(["--run-id", "contract-help-literal", "help"], hostileColorEnvironment),
    literalHelpProcess,
    "success output must remain machine-only and color-independent",
  )
})
test("quiet mode discards debug info and warning before buffering", () => {
  const harness = diagnosticHarness("quiet")
  for (const [sequence, level] of ["debug", "info", "warning", "error", "fatal"].entries()) harness?.pipeline.record(diagnosticRecord(sequence + 1, level as DiagnosticRecord["level"]))
  absent(harness?.records.map(({ level }) => level), diagnosticModeContract.quiet.writtenLevels, "quiet diagnostics must discard lower levels")
})
test("verbose mode writes info through fatal immediately without buffering", () => {
  const harness = diagnosticHarness("verbose")
  for (const [sequence, level] of ["debug", "info", "warning", "error", "fatal"].entries()) harness?.pipeline.record(diagnosticRecord(sequence + 1, level as DiagnosticRecord["level"]))
  absent(harness?.records.map(({ level }) => level), diagnosticModeContract.verbose.writtenLevels, "verbose diagnostics must bypass the buffer")
})
test("debug mode retains debug records in order", () => {
  expect(diagnosticModes).toEqual(["quiet", "verbose", "debug"])
  const harness = diagnosticHarness("debug")
  for (const [sequence, level] of ["debug", "info", "warning", "error", "fatal"].entries()) harness?.pipeline.record(diagnosticRecord(sequence + 1, level as DiagnosticRecord["level"]))
  absent(harness?.records.map(({ level }) => level), diagnosticModeContract.debug.writtenLevels, "debug diagnostics must preserve record order without buffering")
})
test("fingers-crossed buffer is bounded at 250 records", () => {
  expect(bufferedSequence).toEqual([1, 2, 3, 4])
  const harness = diagnosticHarness("default")
  for (const sequence of bufferedSequence) harness?.pipeline.record(diagnosticRecord(sequence, "info"))
  harness?.pipeline.record(diagnosticRecord(5, "error"))
  absent(harness?.records.map(({ sequence }) => sequence), [1, 2, 3, 4, 5], "default diagnostics must flush oldest-to-newest within the bound")
})
test("buffer overflow drops oldest and emits one truncation record", () => {
  let nextSequence = 0
  const allocate = () => {
    nextSequence += 1
    return nextSequence
  }
  const harness = diagnosticHarness("default", { nextSequence: allocate })
  for (let record = 1; record <= 251; record += 1) harness.pipeline.record(diagnosticRecord(allocate(), "info"))
  harness.pipeline.record(diagnosticRecord(allocate(), "error"))
  absent(
    overflowSummaryFor(harness.records),
    {
      firstEvent: "fixture.info",
      sequences: [...Array.from({ length: 250 }, (_, index) => index + 2), 252, 253],
      firstRetained: 2,
      truncationSequence: 252,
      lastRetained: 251,
      triggerEvent: "fixture.error",
      triggerSequence: 253,
      recordCount: 252,
      truncationRecords: 1,
      uniqueSequences: true,
    },
    "diagnostic truncation must preserve unique assigned identities while emitting truncation first",
  )
})
test("buffered context precedes trigger and primary error envelope is last", async () => {
  const harness = await facadeHarness({ argv: ["--run-id", "contract-help-literal", "unknown"] })
  absent(
    harness && {
      diagnosticSequences: harness.diagnostics.records.map(({ sequence }) => sequence),
      finalStderrRecord: harness.observation.stderr.split("\n").filter(Boolean).at(-1),
    },
    { diagnosticSequences: [1], finalStderrRecord: literalUsageProcess.stderr.trim() },
    "stderr placement must keep the primary refusal last",
  )
})
test("reset configure and dispose are idempotent and throwing close preserves primary result", async () => {
  const harness = diagnosticHarness("default")
  harness?.pipeline.record(diagnosticRecord(1, "info", "fixture.before-reset"))
  harness?.pipeline.reset()
  harness?.pipeline.reset()
  harness?.pipeline.record(diagnosticRecord(2, "info", "fixture.after-reset"))
  harness?.pipeline.record(diagnosticRecord(3, "error", "fixture.trigger"))
  harness?.pipeline.dispose()
  harness?.pipeline.dispose()
  const successful = diagnosticHarness("default")
  successful?.pipeline.record(diagnosticRecord(1, "info", "fixture.discard-on-success"))
  successful?.pipeline.dispose()
  const throwingFacade = await facadeHarness({
    throwOnDispose: true,
    argv: ["--run-id", "contract-help-literal", "unknown"],
  })
  const directFacadeCorrelation = await directFacadeCorrelationFor()
  const productionLogTape = productionLogTapeSummaryFor(productionDiagnosticLifecycle())
  absent(
    {
      resetSequences: harness?.records.map(({ sequence }) => sequence),
      pipelineLifecycle: harness?.lifecycle,
      successfulRecords: successful?.records,
      successfulLifecycle: successful?.lifecycle,
      facadeLifecycle: throwingFacade?.diagnostics.lifecycle,
      directFacadeCorrelation,
      productionLogTape,
      primary: throwingFacade?.observation,
    },
    {
      resetSequences: [2, 3],
      pipelineLifecycle: ["flush", "dispose"],
      successfulRecords: [],
      successfulLifecycle: ["dispose"],
      facadeLifecycle: ["flush", "dispose"],
      directFacadeCorrelation: {
        runIds: ["contract-help-literal", "contract-help-literal"],
        sequences: [1, 2],
        uniqueSequences: true,
      },
      productionLogTape: {
        firstEvents: ["fixture.production-first", "fixture.production-second"],
        secondEvents: ["fixture.production-after-reset"],
      },
      primary: literalUsageProcess,
    },
    "diagnostic lifecycle must reset between cases and contain close failure without replacing the primary result",
  )
  expect(lifecycleContract.doubleDispose).toBe("no-op")
})
test("event acceptance is synchronous and best effort", async () => {
  const harness = await facadeHarness({ eventAcceptance: "accepted" })
  const invalidEndpoint = "not-an-event-endpoint"
  let offFactoryLoads = 0
  const off = await facadeHarness({
    argv: ["--events", "off", "--run-id", "contract-help-literal", "help"],
    environment: { AGENT_PLUGIN_KIT_EVENT_ENDPOINT: invalidEndpoint },
    eventFactory: async () => {
      offFactoryLoads += 1
      return createMaintenanceEventAdapter({ endpoint: invalidEndpoint })
    },
  })
  const absentEndpoint = await facadeHarness({
    withoutEventFactory: true,
    environment: {},
  })
  let invalidFactoryLoads = 0
  const invalid = await facadeHarness({
    environment: { AGENT_PLUGIN_KIT_EVENT_ENDPOINT: invalidEndpoint },
    eventFactory: async () => {
      invalidFactoryLoads += 1
      return createMaintenanceEventAdapter({ endpoint: invalidEndpoint })
    },
  })
  const invalidPrimary = {
    ...literalUsageProcess,
    stderr: literalUsageProcess.stderr.replace("Unknown maintenance command.", "Invalid event endpoint."),
  }
  absent(
    {
      accepted: harness && { eventCount: harness.events.records.length, primary: harness.observation },
      off: off && { eventFactoryLoads: offFactoryLoads, commandCalls: off.commands.calls.length, primary: off.observation },
      absentEndpoint: absentEndpoint && { commandCalls: absentEndpoint.commands.calls.length, primary: absentEndpoint.observation },
      invalid: invalid && {
        eventFactoryLoads: invalidFactoryLoads,
        commandCalls: invalid.commands.calls,
        diagnostics: invalid.diagnostics.records.map(({ event }) => event),
        primary: invalid.observation,
      },
    },
    {
      accepted: { eventCount: 1, primary: literalHelpProcess },
      off: { eventFactoryLoads: 0, commandCalls: 1, primary: literalHelpProcess },
      absentEndpoint: { commandCalls: 1, primary: literalHelpProcess },
      invalid: {
        eventFactoryLoads: 1,
        commandCalls: [],
        diagnostics: ["maintenance.usage-refused"],
        primary: invalidPrimary,
      },
    },
    "event acceptance must be synchronous, default to configured auto, and honor off before endpoint work",
  )
})
test("event refusal retains run sequence event ID result and station correlation", async () => {
  const production = productionEventHarness()
  const harness = await facadeHarness({ eventAdapter: production.adapter })
  const recordedEvent = production.records[0]
  absent(
    harness && {
      failure: (() => {
        const record = harness.diagnostics.records.find(({ event }) => event === fixedEventFailure.event)
        return record && { event: record.event, stationId: record.station_id, resultCode: record.result_code, failureClass: record.failure_class, nextActionId: record.next_action?.id }
      })(),
      correlation: { runIds: [recordedEvent?.run_id, harness.diagnostics.records.at(-1)?.run_id], sequences: [recordedEvent?.sequence, harness.diagnostics.records.at(-1)?.sequence], eventId: recordedEvent?.event_id },
      primary: { stdout: harness.observation.stdout, exitCode: harness.observation.exitCode },
    },
    {
      failure: {
        event: fixedEventFailure.event,
        stationId: fixedEventFailure.stationId,
        resultCode: fixedEventFailure.resultCode,
        failureClass: fixedEventFailure.failureClass,
        nextActionId: fixedEventFailure.nextActionId,
      },
      correlation: {
        runIds: ["contract-help-literal", "contract-help-literal"],
        sequences: [1, 2],
        eventId: "opaque-event-id",
      },
      primary: { stdout: literalHelpProcess.stdout, exitCode: literalHelpProcess.exitCode },
    },
    "event refusal must retain original result and monotonic correlation",
  )
})
test("fake-clock delivery owns two bounded attempts and all settlement cases", async () => {
  expect(fixedEventFailure.endpoint).toBe("http://127.0.0.1:9/events")
  const facade = await facadeHarness()
  const capturedEvent = facade.events.records[0]
  if (capturedEvent === undefined) throw new Error("Facade must capture the accepted Event Record")
  const scenarios = []
  const cases = [
    { label: "success", outcomes: ["success"] },
    { label: "timeout", outcomes: ["timeout", "success"] },
    { label: "synchronous-failure", outcomes: ["failure", "success"] },
    { label: "both-attempts-failed", outcomes: ["failure", "failure"] },
  ] as const
  for (const { label, outcomes } of cases) {
    const clock = createFakeClockRecordingAdapter()
    const transport = createTransportRecordingAdapter(outcomes)
    const result = await createEventDelivery({ clock: clock.clock, transport: transport.transport, attemptTimeoutMs: 250, maximumAttempts: 2 }).deliver(capturedEvent)
    scenarios.push({
      label,
      result,
      attempts: transport.records.length,
      eventIds: transport.records.map(({ event_id }) => event_id),
      sequences: transport.records.map(({ sequence }) => sequence),
      sameRecord: transport.records.every((record) => record === capturedEvent),
      sleeps: clock.sleeps,
    })
  }
  absent(
    { eventId: capturedEvent.event_id, scenarios },
    {
      eventId: "opaque-event-id",
      scenarios: [
        { label: "success", result: { status: "delivered", attempts: 1 }, attempts: 1, eventIds: ["opaque-event-id"], sequences: [1], sameRecord: true, sleeps: [250] },
        { label: "timeout", result: { status: "delivered", attempts: 2 }, attempts: 2, eventIds: ["opaque-event-id", "opaque-event-id"], sequences: [1, 1], sameRecord: true, sleeps: [250, 250] },
        { label: "synchronous-failure", result: { status: "delivered", attempts: 2 }, attempts: 2, eventIds: ["opaque-event-id", "opaque-event-id"], sequences: [1, 1], sameRecord: true, sleeps: [250, 250] },
        { label: "both-attempts-failed", result: { status: "failed", attempts: 2 }, attempts: 2, eventIds: ["opaque-event-id", "opaque-event-id"], sequences: [1, 1], sameRecord: true, sleeps: [250, 250] },
      ],
    },
    "event delivery must use a stable event ID and at most two 250ms fake-clock attempts",
  )
})
test("redaction validates and freezes both seams before crossing", async () => {
  const redactionTrace: DiagnosticRedactionStep[] = []
  const diagnostic = diagnosticHarness("debug", {
    redactionTrace: (step) => redactionTrace.push(step),
  })
  diagnostic?.pipeline.record({
    ...diagnosticRecord(1, "error", "fixture.hostile-redaction"),
    message: "token=fixture-diagnostic-secret",
    secret_token: "fixture-diagnostic-secret",
  } as DiagnosticRecord)
  const harness = await facadeHarness({ eventAcceptance: "refused" })
  const serialized = JSON.stringify({ injectedDiagnostics: diagnostic?.records, diagnostics: harness?.diagnostics.records, events: harness?.events.records })
  absent(
    harness && {
      recordsFrozen: [...(diagnostic?.records ?? []), ...harness.diagnostics.records, ...harness.events.records].every(Object.isFrozen),
      leakedSecret: serialized.includes("fixture-secret-must-not-cross") || serialized.includes("fixture-diagnostic-secret") || serialized.includes("secret_token"),
      primary: { stdout: harness.observation.stdout, exitCode: harness.observation.exitCode },
      order: redactionTrace,
    },
    { recordsFrozen: true, leakedSecret: false, primary: { stdout: literalHelpProcess.stdout, exitCode: literalHelpProcess.exitCode }, order: ["build-allowlist", "redact", "validate", "freeze", "cross-seam"] },
    "redaction must precede both seams without changing the fixed primary result",
  )
})
