import { expect, test } from "bun:test"
import { literalHelpProcess, literalUsageProcess } from "../../../modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"
import {
  createDiagnosticPipeline,
  createEventDelivery,
  createMaintenanceCommandFacade,
  type DiagnosticMode,
  type DiagnosticRecord,
  type EventRecord,
} from "../interface"
import { createDiagnosticRecordingAdapter } from "./adapters/diagnostic-recording-adapter"
import {
  createEventRecordingAdapter,
  createFakeClockRecordingAdapter,
  createTransportRecordingAdapter,
} from "./adapters/event-recording-adapter"
import { createMaintenanceCommandsRecordingAdapter } from "./adapters/maintenance-commands-recording-adapter"
import {
  bufferedSequence,
  correlationContract,
  deliveryContract,
  diagnosticModeContract,
  diagnosticModes,
  fixedEventFailure,
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

const eventRecord: EventRecord = Object.freeze({
  schema_version: 1,
  event_id: "contract-help-literal.2",
  occurred_at: "2026-08-27T00:00:00.000Z",
  sequence: 2,
  run_id: "contract-help-literal",
  command: "help",
  station_id: "help.previewed",
  outcome: "previewed",
  result_code: "previewed",
  transaction_state: "unchanged",
  retry_safety: "safe",
  next_action_id: "help.choose-command",
})

function diagnosticHarness(mode: DiagnosticMode) {
  if (createDiagnosticPipeline === undefined) {
    expect(createDiagnosticPipeline, "contract-absent: the diagnostic pipeline must cross its callable facade-owned Interface").toBeFunction()
    return undefined
  }
  const recording = createDiagnosticRecordingAdapter()
  return {
    ...recording,
    pipeline: createDiagnosticPipeline({ mode, maximumBufferedRecords: 250, diagnostics: recording.adapter }),
  }
}

async function facadeHarness(options: { eventAcceptance?: "accepted" | "refused"; throwOnDispose?: boolean; argv?: readonly string[] } = {}) {
  if (createMaintenanceCommandFacade === undefined) {
    expect(createMaintenanceCommandFacade, "contract-absent: observability must cross the callable facade Interface").toBeFunction()
    return undefined
  }
  const commands = createMaintenanceCommandsRecordingAdapter()
  const diagnostics = createDiagnosticRecordingAdapter(
    options.throwOnDispose === undefined ? {} : { throwOnDispose: options.throwOnDispose },
  )
  const events = createEventRecordingAdapter({ status: options.eventAcceptance ?? "accepted" })
  const facade = createMaintenanceCommandFacade({
    commands: commands.commands,
    diagnostics: diagnostics.adapter,
    events: events.adapter,
  })
  const observation = await facade.invoke({
    argv: options.argv ?? ["--events", "auto", "--run-id", "contract-help-literal", "help"],
    environment: {
      AGENT_PLUGIN_KIT_EVENT_ENDPOINT: "http://127.0.0.1:9/events",
      AGENT_PLUGIN_KIT_EVENT_AUTH: "fixture-secret-must-not-cross",
    },
    stdin: "",
  })
  return { commands, diagnostics, events, observation }
}

test("machine stdout contains only the primary success envelope", async () => {
  absent((await facadeHarness())?.observation, literalHelpProcess, "success output must remain machine-only")
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
  const harness = diagnosticHarness("default")
  for (let sequence = 1; sequence <= 251; sequence += 1) harness?.pipeline.record(diagnosticRecord(sequence, "info"))
  harness?.pipeline.record(diagnosticRecord(252, "error"))
  absent(
    harness && {
      firstRetained: harness.records.find(({ event }) => event !== "diagnostic.buffer-truncated")?.sequence,
      recordCount: harness.records.length,
      truncationRecords: harness.records.filter(({ event }) => event === "diagnostic.buffer-truncated").length,
    },
    { firstRetained: 2, recordCount: 252, truncationRecords: 1 },
    "diagnostic truncation must be observable",
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
  const throwingFacade = await facadeHarness({ throwOnDispose: true })
  absent(
    {
      resetSequences: harness?.records.map(({ sequence }) => sequence),
      pipelineLifecycle: harness?.lifecycle,
      successfulRecords: successful?.records,
      successfulLifecycle: successful?.lifecycle,
      facadeLifecycle: throwingFacade?.diagnostics.lifecycle,
      primary: throwingFacade?.observation,
    },
    {
      resetSequences: [2, 3],
      pipelineLifecycle: ["flush", "dispose"],
      successfulRecords: [],
      successfulLifecycle: ["dispose"],
      facadeLifecycle: ["dispose"],
      primary: literalHelpProcess,
    },
    "diagnostic lifecycle must reset between cases and contain close failure without replacing the primary result",
  )
  expect(lifecycleContract.doubleDispose).toBe("no-op")
})
test("event acceptance is synchronous and best effort", async () => {
  const harness = await facadeHarness({ eventAcceptance: "accepted" })
  absent(harness && { eventCount: harness.events.records.length, primary: harness.observation }, { eventCount: 1, primary: literalHelpProcess }, "event delivery must never delay the primary result")
})
test("event refusal retains run sequence event ID result and station correlation", async () => {
  const harness = await facadeHarness({ eventAcceptance: "refused" })
  const recordedEvent = harness?.events.records[0]
  absent(
    harness && {
      failure: (() => {
        const record = harness.diagnostics.records.find(({ event }) => event === fixedEventFailure.event)
        return record && { event: record.event, stationId: record.station_id, resultCode: record.result_code, failureClass: record.failure_class, nextActionId: record.next_action?.id }
      })(),
      correlation: { runIds: [recordedEvent?.run_id, harness.diagnostics.records.at(-1)?.run_id], sequences: [recordedEvent?.sequence, harness.diagnostics.records.at(-1)?.sequence], eventId: recordedEvent?.event_id },
      primary: { stdout: harness.observation.stdout, exitCode: harness.observation.exitCode },
    },
    { failure: { event: fixedEventFailure.event, stationId: fixedEventFailure.stationId, resultCode: fixedEventFailure.resultCode, failureClass: fixedEventFailure.failureClass, nextActionId: fixedEventFailure.nextActionId }, correlation: correlationContract, primary: { stdout: literalHelpProcess.stdout, exitCode: literalHelpProcess.exitCode } },
    "event refusal must retain original result and monotonic correlation",
  )
})
test("fake-clock delivery owns two bounded attempts and all settlement cases", async () => {
  expect(fixedEventFailure.endpoint).toBe("http://127.0.0.1:9/events")
  if (createEventDelivery === undefined) {
    expect(createEventDelivery, "contract-absent: event settlement must cross the callable delivery Interface").toBeFunction()
    return
  }
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
    const result = await createEventDelivery({ clock: clock.clock, transport: transport.transport, attemptTimeoutMs: 250, maximumAttempts: 2 }).deliver(eventRecord)
    scenarios.push({ label, result, attempts: transport.records.length, sleeps: clock.sleeps })
  }
  absent(
    { eventId: eventRecord.event_id, scenarios },
    {
      eventId: deliveryContract.eventId,
      scenarios: [
        { label: "success", result: { status: "delivered", attempts: 1 }, attempts: 1, sleeps: [250] },
        { label: "timeout", result: { status: "delivered", attempts: 2 }, attempts: 2, sleeps: [250, 250] },
        { label: "synchronous-failure", result: { status: "delivered", attempts: 2 }, attempts: 2, sleeps: [250, 250] },
        { label: "both-attempts-failed", result: { status: "failed", attempts: 2 }, attempts: 2, sleeps: [250, 250] },
      ],
    },
    "event delivery must use a stable event ID and at most two 250ms fake-clock attempts",
  )
})
test("redaction validates and freezes both seams before crossing", async () => {
  const diagnostic = diagnosticHarness("debug")
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
      order: redactionContract.order,
    },
    { recordsFrozen: true, leakedSecret: false, primary: { stdout: literalHelpProcess.stdout, exitCode: literalHelpProcess.exitCode }, order: ["build-allowlist", "redact", "validate", "freeze", "cross-seam"] },
    "redaction must precede both seams without changing the fixed primary result",
  )
})
