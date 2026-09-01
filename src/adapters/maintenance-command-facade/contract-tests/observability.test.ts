import { expect, test } from "bun:test"
import { configureSync, getLogger, resetSync, type Sink } from "@logtape/logtape"
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
  DiagnosticEgressStep,
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
} from "./fixtures/literal-observability-cases"

const absent = (actual: unknown, expected: unknown, claim: string) =>
  expect(actual, `contract-absent: ${claim}`).toEqual(expected)

const diagnosticRecord = (
  sequence: number,
  level: DiagnosticRecord["level"],
  event = `fixture.${level}`,
): DiagnosticRecord => {
  const fields = {
    schema_version: 2 as const,
    record_type: "diagnostic" as const,
    timestamp: "2026-08-27T00:00:00.000Z",
    sequence,
    category: ["agent-plugin-kit", "maintenance"] as const,
    event,
    run_id: "contract-help-literal",
    station_id: "maintenance.usage-refused" as const,
    failure_class: "usage" as const,
    result_code: "usage-refused" as const,
    transaction_state: "unchanged" as const,
    retry_safety: "safe" as const,
    message: 'Maintenance command failed with result code "usage-refused".' as const,
  }
  if (level !== "error" && level !== "fatal") return Object.freeze({ ...fields, level })
  return Object.freeze({
    ...fields,
    level,
    next_action: {
      id: "maintenance.show-help",
      action: "change_input",
      summary: "Choose a command from machine discovery.",
      commandId: "help",
    } as const,
  })
}

const fixedCorrelation: FacadeCorrelationSources = {
  now: () => "2026-08-27T00:00:00.000Z",
  eventId: () => "opaque-event-id",
}

// @ts-expect-error error and fatal diagnostics require one canonical repair action
const missingCompileTimeRepair: DiagnosticRecord = {
  schema_version: 2,
  record_type: "diagnostic",
  timestamp: "2026-08-27T00:00:00.000Z",
  sequence: 1,
  level: "error",
  category: ["agent-plugin-kit", "maintenance"],
  event: "fixture.missing-compile-time-repair",
  run_id: "contract-help-literal",
  message: 'Maintenance command failed with result code "usage-refused".',
}
void missingCompileTimeRepair

const withoutNextAction = ({ next_action, ...record }: DiagnosticRecord): unknown => {
  void next_action
  return record
}

function diagnosticHarness(
  mode: DiagnosticMode,
  options: {
    nextSequence?: () => number
    egressTrace?: (step: DiagnosticEgressStep) => void
    secretValues?: readonly string[]
  } = {},
) {
  const recording = createDiagnosticRecordingAdapter()
  let localSequence = 0
  const nextSequence = options.nextSequence ?? (() => {
    localSequence += 1
    return localSequence
  })
  return {
    ...recording,
    pipeline: createDiagnosticPipeline({
      mode,
      maximumBufferedRecords: 250,
      diagnostics: recording.adapter,
      nextSequence,
      ...(options.egressTrace === undefined ? {} : { egressTrace: options.egressTrace }),
      ...(options.secretValues === undefined ? {} : { secretValues: options.secretValues }),
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
  const hostWrites: string[] = []
  const hostSink: Sink = (record) => hostWrites.push(String(record.message[0] ?? ""))
  resetSync()
  configureSync({
    sinks: { host: hostSink },
    loggers: [{ category: ["fixture", "host"], lowestLevel: "debug", sinks: ["host"] }],
  })
  const hostLogger = getLogger(["fixture", "host"])
  hostLogger.info("host-before-adapter")

  const firstWrites: string[] = []
  const first = createLogTapeDiagnosticAdapter({ write: (line) => firstWrites.push(line) })
  first.record(diagnosticRecord(1, "error", "fixture.production-first"))
  first.record(diagnosticRecord(2, "error", "fixture.production-second"))
  first.flush()
  first.dispose()
  first.dispose()

  const secondWrites: string[] = []
  const second = createLogTapeDiagnosticAdapter({ write: (line) => secondWrites.push(line) })
  second.record(diagnosticRecord(3, "error", "fixture.production-after-dispose"))
  second.dispose()
  hostLogger.info("host-after-adapter")
  resetSync()
  return { firstWrites, secondWrites, hostWrites }
}

const productionLogTapeSummaryFor = (lifecycle: ReturnType<typeof productionDiagnosticLifecycle>) => ({
  firstEvents: lifecycle.firstWrites.map((line) => (JSON.parse(line) as DiagnosticRecord).event),
  secondEvents: lifecycle.secondWrites.map((line) => (JSON.parse(line) as DiagnosticRecord).event),
  hostMessages: lifecycle.hostWrites,
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
    lastRetained: records.at(-2)?.sequence,
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
  for (const [sequence, level] of ["debug", "info", "warning", "error", "fatal"].entries()) harness.pipeline.record(diagnosticRecord(sequence + 1, level as DiagnosticRecord["level"]))
  absent(harness.records.map(({ level }) => level), diagnosticModeContract.quiet.writtenLevels, "quiet diagnostics must discard lower levels")
})
test("verbose mode writes info through fatal immediately without buffering", () => {
  const harness = diagnosticHarness("verbose")
  for (const [sequence, level] of ["debug", "info", "warning", "error", "fatal"].entries()) harness.pipeline.record(diagnosticRecord(sequence + 1, level as DiagnosticRecord["level"]))
  absent(harness.records.map(({ level }) => level), diagnosticModeContract.verbose.writtenLevels, "verbose diagnostics must bypass the buffer")
})
test("debug mode retains debug records in order", () => {
  expect(diagnosticModes).toEqual(["quiet", "verbose", "debug"])
  const harness = diagnosticHarness("debug")
  for (const [sequence, level] of ["debug", "info", "warning", "error", "fatal"].entries()) harness.pipeline.record(diagnosticRecord(sequence + 1, level as DiagnosticRecord["level"]))
  absent(harness.records.map(({ level }) => level), diagnosticModeContract.debug.writtenLevels, "debug diagnostics must preserve record order without buffering")
})
test("fingers-crossed buffer is bounded at 250 records", () => {
  expect(bufferedSequence).toEqual([1, 2, 3, 4])
  const harness = diagnosticHarness("default")
  for (const sequence of bufferedSequence) harness.pipeline.record(diagnosticRecord(sequence, "info"))
  harness.pipeline.record(diagnosticRecord(5, "error"))
  absent(harness.records.map(({ sequence }) => sequence), [1, 2, 3, 4, 5], "default diagnostics must flush oldest-to-newest within the bound")
})
test("buffer overflow drops oldest and emits one truncation record", () => {
  let nextSequence = 0
  const allocate = () => {
    nextSequence += 1
    return nextSequence
  }
  const harness = diagnosticHarness("default", { nextSequence: allocate })
  for (let record = 1; record <= 252; record += 1) harness.pipeline.record(diagnosticRecord(allocate(), "info"))
  harness.pipeline.record(diagnosticRecord(allocate(), "error"))
  absent(
    overflowSummaryFor(harness.records),
    {
      firstEvent: "fixture.info",
      sequences: [...Array.from({ length: 249 }, (_, index) => index + 3), 252, 253, 254],
      firstRetained: 3,
      truncationSequence: 252,
      lastRetained: 253,
      triggerEvent: "fixture.error",
      triggerSequence: 254,
      recordCount: 252,
      truncationRecords: 1,
      uniqueSequences: true,
    },
    "diagnostic truncation must preserve unique assigned identities while flushing in allocated order",
  )

  const failingAllocatorHarness = diagnosticHarness("default", {
    nextSequence: () => {
      throw new Error("fixture sequence allocation failure")
    },
  })
  for (let sequence = 1; sequence <= 252; sequence += 1) {
    failingAllocatorHarness.pipeline.record(diagnosticRecord(sequence, "info"))
  }
  failingAllocatorHarness.pipeline.record(diagnosticRecord(253, "error"))
  absent(
    overflowSummaryFor(failingAllocatorHarness.records),
    {
      firstEvent: "fixture.info",
      sequences: Array.from({ length: 251 }, (_, index) => index + 3),
      firstRetained: 3,
      truncationSequence: undefined,
      lastRetained: 252,
      triggerEvent: "fixture.error",
      triggerSequence: 253,
      recordCount: 251,
      truncationRecords: 0,
      uniqueSequences: true,
    },
    "failed truncation allocation must omit the synthetic record instead of inventing an identity",
  )
})
test("buffered context precedes trigger and primary error envelope is last", async () => {
  const harness = await facadeHarness({ argv: ["--run-id", "contract-help-literal", "unknown"] })
  absent(
    {
      diagnosticSequences: harness.diagnostics.records.map(({ sequence }) => sequence),
      finalStderrRecord: harness.observation.stderr.split("\n").filter(Boolean).at(-1),
    },
    { diagnosticSequences: [1], finalStderrRecord: literalUsageProcess.stderr.trim() },
    "stderr placement must keep the primary refusal last",
  )
})
test("pipeline reset and adapter dispose preserve host logging and primary result", async () => {
  const harness = diagnosticHarness("default")
  harness.pipeline.record(diagnosticRecord(1, "info", "fixture.before-reset"))
  harness.pipeline.reset()
  harness.pipeline.reset()
  harness.pipeline.record(diagnosticRecord(2, "info", "fixture.after-reset"))
  harness.pipeline.record(diagnosticRecord(3, "error", "fixture.trigger"))
  harness.pipeline.dispose()
  harness.pipeline.dispose()
  const successful = diagnosticHarness("default")
  successful.pipeline.record(diagnosticRecord(1, "info", "fixture.discard-on-success"))
  successful.pipeline.dispose()
  const throwingFacade = await facadeHarness({
    throwOnDispose: true,
    argv: ["--run-id", "contract-help-literal", "unknown"],
  })
  const directFacadeCorrelation = await directFacadeCorrelationFor()
  const productionLogTape = productionLogTapeSummaryFor(productionDiagnosticLifecycle())
  absent(
    {
      resetSequences: harness.records.map(({ sequence }) => sequence),
      pipelineLifecycle: harness.lifecycle,
      successfulRecords: successful.records,
      successfulLifecycle: successful.lifecycle,
      facadeLifecycle: throwingFacade.diagnostics.lifecycle,
      directFacadeCorrelation,
      productionLogTape,
      primary: throwingFacade.observation,
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
        secondEvents: ["fixture.production-after-dispose"],
        hostMessages: ["host-before-adapter", "host-after-adapter"],
      },
      primary: literalUsageProcess,
    },
    "diagnostic lifecycle must preserve host logging and contain close failure without replacing the primary result",
  )
  expect(lifecycleContract.doubleDispose).toBe("no-op")
})
test("event acceptance is synchronous and best effort", async () => {
  const harness = await facadeHarness({ eventAcceptance: "accepted" })
  const ipv6LoopbackAccepted = createMaintenanceEventAdapter({ endpoint: "http://[::1]/events" }) !== undefined
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
      accepted: { eventCount: harness.events.records.length, ipv6LoopbackAccepted, primary: harness.observation },
      off: { eventFactoryLoads: offFactoryLoads, commandCalls: off.commands.calls.length, primary: off.observation },
      absentEndpoint: { commandCalls: absentEndpoint.commands.calls.length, primary: absentEndpoint.observation },
      invalid: {
        eventFactoryLoads: invalidFactoryLoads,
        commandCalls: invalid.commands.calls,
        diagnostics: invalid.diagnostics.records.map(({ event }) => event),
        primary: invalid.observation,
      },
    },
    {
      accepted: { eventCount: 1, ipv6LoopbackAccepted: true, primary: literalHelpProcess },
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
    {
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
    { label: "success", outcomes: ["success"], clockOutcome: "success" },
    { label: "timeout", outcomes: ["timeout", "success"], clockOutcome: "success" },
    { label: "synchronous-failure", outcomes: ["failure", "success"], clockOutcome: "success" },
    { label: "both-attempts-failed", outcomes: ["failure", "failure"], clockOutcome: "success" },
    { label: "clock-failure", outcomes: ["timeout", "timeout"], clockOutcome: "failure" },
  ] as const
  for (const { label, outcomes, clockOutcome } of cases) {
    const clock = createFakeClockRecordingAdapter(clockOutcome)
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
        { label: "clock-failure", result: { status: "failed", attempts: 2 }, attempts: 2, eventIds: ["opaque-event-id", "opaque-event-id"], sequences: [1, 1], sameRecord: true, sleeps: [250, 250] },
      ],
    },
    "event delivery must use a stable event ID and at most two 250ms fake-clock attempts",
  )
})
test("closed diagnostics fail closed and native field redaction protects the sink", async () => {
  const egressTrace: DiagnosticEgressStep[] = []
  const configuredSecret = "fixture-secret-must-not-cross"
  const structuredSecret = "fixture-structured-secret"
  const diagnostic = diagnosticHarness("debug", {
    egressTrace: (step) => egressTrace.push(step),
  })
  const canonical = diagnosticRecord(1, "error", "fixture.canonical")
  diagnostic.pipeline.record(canonical)
  const noncanonical = diagnosticHarness("debug")
  noncanonical.pipeline.record({
    ...diagnosticRecord(2, "error", "fixture.noncanonical"),
    message: `Bearer ${structuredSecret}`,
  } as unknown as DiagnosticRecord)
  const configured = diagnosticHarness("debug", { secretValues: [configuredSecret] })
  configured.pipeline.record({
    ...diagnosticRecord(3, "error", "fixture.configured-secret"),
    run_id: configuredSecret,
  })
  const missingRepair = diagnosticHarness("debug")
  missingRepair.pipeline.record(withoutNextAction(
    diagnosticRecord(4, "error", "fixture.missing-repair"),
  ) as DiagnosticRecord)
  const forgedEventRepair = diagnosticHarness("debug")
  const eventRepair = {
    ...diagnosticRecord(5, "error", "event.delivery-failed"),
    command: "help" as const,
    station_id: "help.previewed" as const,
    failure_class: "event_delivery" as const,
    result_code: "previewed" as const,
    transaction_state: "completed" as const,
    next_action: {
      id: "events.inspect-configuration",
      action: "repair_state" as const,
      summary: "Inspect the configured event transport; do not repeat the command solely to replay its event.",
      commandId: null,
      retryAfterMs: 250,
      idempotencyKey: "forged-event-repair",
    },
    message: "Inspect the configured event transport; do not repeat the command solely to replay its event." as const,
  }
  forgedEventRepair.pipeline.record(eventRepair)

  const writes: string[] = []
  const native = createLogTapeDiagnosticAdapter({ write: (line) => writes.push(line) })
  native.record({
    ...diagnosticRecord(6, "error", "fixture.native-field-redaction"),
    context: {
      api_key: structuredSecret,
      safe_label: "preserved",
    },
  } as unknown as DiagnosticRecord)
  native.dispose()

  const nativeRecord = JSON.parse(writes[0] ?? "{}") as {
    context?: { api_key?: string; safe_label?: string }
    message?: string
  }
  const harness = await facadeHarness({ eventAcceptance: "refused" })
  const serialized = JSON.stringify({
    diagnostics: diagnostic.records,
    noncanonicalDiagnostics: noncanonical.records,
    configuredDiagnostics: configured.records,
    missingRepairDiagnostics: missingRepair.records,
    forgedEventRepairDiagnostics: forgedEventRepair.records,
    nativeRecord,
    facadeDiagnostics: harness.diagnostics.records,
    events: harness.events.records,
  })

  absent(
    {
      acceptedMessages: diagnostic.records.map(({ message }) => message),
      noncanonicalRecords: noncanonical.records,
      configuredSecretRecords: configured.records,
      missingRepairRecords: missingRepair.records,
      forgedEventRepairRecords: forgedEventRepair.records,
      recordsFrozen: [...diagnostic.records, ...harness.diagnostics.records, ...harness.events.records]
        .every(Object.isFrozen),
      configuredSecretLeaked: serialized.includes(configuredSecret),
      structuredSecretLeaked: serialized.includes(structuredSecret),
      nativeContext: nativeRecord.context,
      nativeMessage: nativeRecord.message,
      primary: {
        stdout: harness.observation.stdout,
        exitCode: harness.observation.exitCode,
      },
      order: egressTrace,
    },
    {
      acceptedMessages: ['Maintenance command failed with result code "usage-refused".'],
      noncanonicalRecords: [],
      configuredSecretRecords: [],
      missingRepairRecords: [],
      forgedEventRepairRecords: [],
      recordsFrozen: true,
      configuredSecretLeaked: false,
      structuredSecretLeaked: false,
      nativeContext: {
        api_key: "[REDACTED]",
        safe_label: "preserved",
      },
      nativeMessage: 'Maintenance command failed with result code "usage-refused".',
      primary: {
        stdout: literalHelpProcess.stdout,
        exitCode: literalHelpProcess.exitCode,
      },
      order: ["build-allowlist", "canonicalize", "validate", "freeze", "cross-seam"],
    },
    "canonical diagnostics must precede both seams and LogTape must redact structured sensitive fields",
  )
})
