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
test("reset configure and dispose are idempotent and throwing close preserves primary result", async () => {
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
test("redaction validates and freezes both seams before crossing", async () => {
  const redactionTrace: DiagnosticRedactionStep[] = []
  const embeddedBearerCredential = "fixture-embedded-bearer-credential"
  const embeddedBasicCredential = "fixture-embedded-basic-credential"
  const embeddedOpReference = "op://fixture-vault/fixture-item/fixture-field"
  const underscoreBearerCredential = "fixture-underscore-bearer-credential"
  const underscoreBasicCredential = "fixture-underscore-basic-credential"
  const underscoreOpReference = "op://fixture-underscore-vault/fixture-item/fixture-field"
  const malformedCredentialTail = "fixture-raw-secret-tail"
  const malformedBearerCredential = `fixture-malformed-bearer!$<${malformedCredentialTail}`
  const malformedBasicCredential = `fixture-malformed-basic!$<${malformedCredentialTail}`
  const malformedOpReference = `op://fixture-malformed-vault/malformed!$<${malformedCredentialTail}`
  const completePrivateKey = "-----BEGIN PRIVATE KEY-----\nfixture-private-key-secret\n-----END PRIVATE KEY-----"
  const incompletePrivateKey = "-----BEGIN PRIVATE KEY-----\nfixtureTail"
  const underscoreAuthUsername = "fixture-auth-user"
  const underscoreAuthPassword = "fixture-auth-password"
  const underscoreAuthUrl = `https://${underscoreAuthUsername}:${underscoreAuthPassword}@fixture-auth-host`
  const underscoreAssignment = "fixture-underscore-assignment-secret"
  const emptyUsernameAuthUrl = "https://:fixture-empty-username-password@fixture-empty-username.example"
  const emptyPasswordAuthUrl = "https://fixture-empty-password-username:@fixture-empty-password.example"
  const slashBearingAuthUrl = "https://fixtureUser:fixture/fixtureTail@fixture.example"
  const usernameOnlyAuthUrl = "https://fixtureToken@example.test/path"
  const percentEncodedUserinfoAuthUrl = "https://fixture%54oken%2Dsecret@example.test/path"
  const ftpAuthUrl = "ftp://fixtureUser:fixturePassword@fixture.example"
  const postgresAuthUrl = "postgres://fixtureUser:fixturePassword@fixture.example"
  const longPrefixedTokenKey = `${"x".repeat(200)}Token`
  const keyAt511Characters = `token${"x".repeat(506)}`
  const keyAt512Characters = `token${"x".repeat(507)}`
  const keyAt513Characters = `token${"x".repeat(508)}`
  const assignmentCases = [
    { input: `x_token=${underscoreAssignment}`, expected: "x_token=[REDACTED]" },
    { input: "token=opaque-02", expected: "token=[REDACTED]" },
    { input: 'token="opaque 03" more', expected: "token=[REDACTED] more" },
    { input: 'token="opaque 04";opaque-tail', expected: "token=[REDACTED]" },
    { input: '{"token":"opaque-05"}', expected: '{"token":[REDACTED]}' },
    { input: '{"password":"opaque-06"}', expected: '{"password":[REDACTED]}' },
    { input: '{"accessToken":"opaque-07"}', expected: '{"accessToken":[REDACTED]}' },
    { input: "clientSecret=opaque-08", expected: "clientSecret=[REDACTED]" },
    { input: '{"token":"opaque-09","mode":"safe"}', expected: '{"token":[REDACTED],"mode":"safe"}' },
    { input: '"token=opaque-10', expected: '"token=[REDACTED]' },
    { input: '{"token:opaque-11', expected: '{"token:[REDACTED]' },
    { input: "'password:opaque-12", expected: "'password:[REDACTED]" },
    { input: 'token="opaque-13', expected: "token=[REDACTED]" },
    { input: "private key=opaque-14", expected: "private key=[REDACTED]" },
    { input: "api key=opaque-15", expected: "api key=[REDACTED]" },
    { input: "private  key=opaque-16", expected: "private  key=[REDACTED]" },
    { input: "api\tkey=opaque-17", expected: "api\tkey=[REDACTED]" },
    { input: "password=correct horse battery staple", expected: "password=[REDACTED]" },
    { input: '{"private.key":"opaque-19","mode":"safe"}', expected: '{"private.key":[REDACTED],"mode":"safe"}' },
    { input: '{"api/key":"opaque-20","mode":"safe"}', expected: '{"api/key":[REDACTED],"mode":"safe"}' },
    { input: "password=correct,horse battery staple", expected: "password=[REDACTED]" },
    { input: "token=opaque]tail", expected: "token=[REDACTED]" },
    { input: "token= | mode=safe", expected: "token=[REDACTED] | mode=safe" },
    { input: "token=opaque-23b | mode=safe", expected: "token=[REDACTED] | mode=safe" },
    { input: "token signing key=opaque-24", expected: "token signing key=[REDACTED]" },
    { input: '{"token signing key:opaque-25', expected: '{"token signing key:[REDACTED]' },
    { input: '{"to\\"ken":"opaque-26","mode":"safe"}', expected: '{"to\\"ken":[REDACTED],"mode":"safe"}' },
    { input: '{"to:ken":"opaque-27","mode":"safe"}', expected: '{"to:ken":[REDACTED],"mode":"safe"}' },
    { input: '{"tok\\u0065n":"opaque-28","mode":"safe"}', expected: '{"tok\\u0065n":[REDACTED],"mode":"safe"}' },
    { input: '{"pass\\u0077ord":"opaque-29","mode":"safe"}', expected: '{"pass\\u0077ord":[REDACTED],"mode":"safe"}' },
    { input: "tok%65n=opaque-30", expected: "tok%65n=[REDACTED]" },
    { input: '{"api,key":"opaque-31","mode":"safe"}', expected: '{"api,key":[REDACTED],"mode":"safe"}' },
    { input: '{"pri[vate]key":"opaque-32","mode":"safe"}', expected: '{"pri[vate]key":[REDACTED],"mode":"safe"}' },
    { input: '{"auth|orization":"opaque-33","mode":"safe"}', expected: '{"auth|orization":[REDACTED],"mode":"safe"}' },
    { input: "token'=opaque-34", expected: "token'=[REDACTED]" },
    { input: `${longPrefixedTokenKey}=opaque-35`, expected: `${longPrefixedTokenKey}=[REDACTED]` },
    { input: String.raw`tok\u65n=opaque-36`, expected: String.raw`tok\u65n=[REDACTED]` },
    { input: "tok%6n=opaque-37", expected: "tok%6n=[REDACTED]" },
    { input: String.raw`tok\\u0065n=opaque-38`, expected: String.raw`tok\\u0065n=[REDACTED]` },
    { input: "tok%65n%3Dopaque-39", expected: "tok%65n%3D[REDACTED]" },
    { input: String.raw`tok\u0065n\u003dopaque-40`, expected: String.raw`tok\u0065n\u003d[REDACTED]` },
    { input: "to,ken=opaque-41", expected: "to,ken=[REDACTED]" },
    { input: "to|ken=opaque-42", expected: "to|ken=[REDACTED]" },
    { input: "pri[vate]key=opaque-43", expected: "pri[vate]key=[REDACTED]" },
    { input: "password=correct | horse battery staple", expected: "password=[REDACTED]" },
    { input: "tok%5Cu0065n=opaque-45", expected: "tok%5Cu0065n=[REDACTED]" },
    { input: "tok%2565n=opaque-46", expected: "tok%2565n=[REDACTED]" },
    { input: "tokenized output | progress=100% complete", expected: "tokenized output | progress=100% complete" },
    { input: "auth token refreshed; progress=100% complete", expected: "auth token refreshed; progress=100% complete" },
    { input: "auth token refreshed, progress=100% complete", expected: "auth token refreshed, progress=100% complete" },
    { input: "auth token refreshed progress=100% complete", expected: "auth token refreshed progress=100% complete" },
    { input: "Token parsing failed: retry later", expected: "Token parsing failed: retry later" },
    { input: 'mode="token: opaque"', expected: 'mode="token: opaque"' },
    { input: "context token=opaque-51 tail", expected: "context token=[REDACTED]" },
    { input: '"token=opaque-52"', expected: '"token=[REDACTED]"' },
    { input: 'context "token=opaque-53" tail', expected: 'context "token=[REDACTED]" tail' },
    { input: "private key: opaque-54", expected: "private key:[REDACTED]" },
    { input: "api key: opaque-55", expected: "api key:[REDACTED]" },
    { input: "safe context | private key: opaque-56", expected: "safe context | private key:[REDACTED]" },
    { input: "token=opaque-57; mode=safe", expected: "token=[REDACTED]; mode=safe" },
    { input: "token=opaque-58\nmode=safe", expected: "token=[REDACTED]\nmode=safe" },
    { input: `${keyAt511Characters}=opaque-59`, expected: `${keyAt511Characters}=[REDACTED]` },
    { input: `${keyAt512Characters}=opaque-60`, expected: `${keyAt512Characters}=[REDACTED]` },
    { input: `${keyAt513Characters}=opaque-61`, expected: `${keyAt513Characters}=[REDACTED]` },
    { input: "t%256Fken=opaque-62", expected: "t%256Fken=[REDACTED]" },
    { input: "%2574oken=opaque-63", expected: "%2574oken=[REDACTED]" },
    { input: "t%5Cu006fken=opaque-64", expected: "t%5Cu006fken=[REDACTED]" },
    { input: "password=correct | horse: battery staple", expected: "password=[REDACTED]" },
    { input: "password=correct, horse: battery staple", expected: "password=[REDACTED]" },
    { input: "password=correct; horse: battery staple", expected: "password=[REDACTED]" },
    { input: "password=correct\nhorse: battery staple", expected: "password=[REDACTED]" },
    { input: "password=correct | horse=battery staple", expected: "password=[REDACTED]" },
    { input: '{"token:mode":"opaque"}', expected: '{"token:mode":[REDACTED]}' },
    { input: 'mode="token: opaque"| mode=safe', expected: 'mode="token: opaque"| mode=safe' },
    { input: 'mode="token: opaque";mode=safe', expected: 'mode="token: opaque";mode=safe' },
    { input: 'password={"mode":"safe","value":"opaque-secret"}', expected: "password=[REDACTED]" },
    { input: 'password={"mode":"safe","value":"opaque-secret"} | mode=safe', expected: "password=[REDACTED] | mode=safe" },
    { input: 'private key="opaque"| mode=safe', expected: "private key=[REDACTED]| mode=safe" },
    { input: 'private key="opaque";mode=safe', expected: "private key=[REDACTED];mode=safe" },
    { input: "password={opaque] | mode=safe, hidden-tail}", expected: "password=[REDACTED]" },
    { input: "password=[opaque) | mode=safe, hidden-tail]", expected: "password=[REDACTED]" },
    { input: "password=(opaque} | mode=safe, hidden-tail)", expected: "password=[REDACTED]" },
    { input: String.raw`password={opaque\} | mode=safe, hidden-tail}`, expected: "password=[REDACTED]" },
    { input: String.raw`password=[opaque\] | mode=safe, hidden-tail]`, expected: "password=[REDACTED]" },
    { input: String.raw`password=(opaque\) | mode=safe, hidden-tail)`, expected: "password=[REDACTED]" },
    { input: String.raw`password=opaque\| mode=safe, hidden-tail`, expected: "password=[REDACTED]" },
    { input: String.raw`password=opaque\\| mode=safe`, expected: "password=[REDACTED]| mode=safe" },
    { input: String.raw`password=opaque\, mode=safe, hidden-tail`, expected: "password=[REDACTED]" },
    { input: String.raw`password=opaque\\, mode=safe`, expected: "password=[REDACTED], mode=safe" },
    { input: String.raw`password=opaque\;mode=safe, hidden-tail`, expected: "password=[REDACTED]" },
    { input: String.raw`password=opaque\\;mode=safe`, expected: "password=[REDACTED];mode=safe" },
    { input: String.raw`private key="opaque"\| mode=safe, hidden-tail`, expected: "private key=[REDACTED]" },
    { input: String.raw`private key="opaque"\\| mode=safe`, expected: "private key=[REDACTED]| mode=safe" },
    { input: String.raw`private key="opaque"\, mode=safe, hidden-tail`, expected: "private key=[REDACTED]" },
    { input: String.raw`private key="opaque"\\, mode=safe`, expected: "private key=[REDACTED], mode=safe" },
    { input: String.raw`private key="opaque"\;mode=safe, hidden-tail`, expected: "private key=[REDACTED]" },
    { input: String.raw`private key="opaque"\\;mode=safe`, expected: "private key=[REDACTED];mode=safe" },
  ] as const
  const overlongAuthUrl = `https://${"u".repeat(2048)}:${"p".repeat(2048)}@fixture-overlong.example`
  const incompleteAuthUrl = "https://fixtureUser:fixtureSecret@"
  const incompleteNoAtAuthUrl = "https://fixtureUser:fixtureSecret"
  const diagnostic = diagnosticHarness("debug", {
    redactionTrace: (step) => redactionTrace.push(step),
  })
  diagnostic.pipeline.record({
    ...diagnosticRecord(1, "error", "fixture.hostile-redaction"),
    message: [
      `context before Bearer ${embeddedBearerCredential}`,
      `Basic ${embeddedBasicCredential}`,
      embeddedOpReference,
      `x_Bearer ${underscoreBearerCredential}`,
      `x_Basic ${underscoreBasicCredential}`,
      `x_${underscoreOpReference}`,
      `Bearer ${malformedBearerCredential}`,
      `Basic ${malformedBasicCredential}`,
      malformedOpReference,
      completePrivateKey,
      `x_${emptyUsernameAuthUrl}`,
      `x_${emptyPasswordAuthUrl}`,
      `x_${underscoreAuthUrl}`,
      slashBearingAuthUrl,
      usernameOnlyAuthUrl,
      percentEncodedUserinfoAuthUrl,
      ftpAuthUrl,
      postgresAuthUrl,
      "https://fixture.example:8080",
      "https://fixture.example:8443.",
      "Bearer fixtureHead;fixtureTail",
      "Basic fixtureHead,fixtureTail",
      "op://fixture/head;fixtureTail",
    ].join(" | "),
    secret_token: "fixture-diagnostic-secret",
  } as DiagnosticRecord)
  const incompletePrivateKeyDiagnostic = diagnosticHarness("debug")
  incompletePrivateKeyDiagnostic.pipeline.record({
    ...diagnosticRecord(2, "error", "fixture.incomplete-private-key"),
    message: incompletePrivateKey,
  })
  const overlongAuthDiagnostic = diagnosticHarness("debug")
  overlongAuthDiagnostic.pipeline.record({
    ...diagnosticRecord(3, "error", "fixture.overlong-auth-userinfo"),
    message: overlongAuthUrl,
  })
  const incompleteAuthDiagnostic = diagnosticHarness("debug")
  incompleteAuthDiagnostic.pipeline.record({
    ...diagnosticRecord(4, "error", "fixture.incomplete-auth-url"),
    message: incompleteAuthUrl,
  })
  const incompleteNoAtAuthDiagnostic = diagnosticHarness("debug")
  incompleteNoAtAuthDiagnostic.pipeline.record({
    ...diagnosticRecord(5, "error", "fixture.incomplete-no-at-auth-url"),
    message: incompleteNoAtAuthUrl,
  })
  const assignmentDiagnostics = diagnosticHarness("debug")
  assignmentCases.forEach(({ input: message }, index) => {
    assignmentDiagnostics.pipeline.record({
      ...diagnosticRecord(index + 6, "error", `fixture.assignment-variant-${index + 1}`),
      message,
    })
  })
  const harness = await facadeHarness({ eventAcceptance: "refused" })
  const serialized = JSON.stringify({ injectedDiagnostics: diagnostic.records, incompletePrivateKeyDiagnostics: incompletePrivateKeyDiagnostic.records, overlongAuthDiagnostics: overlongAuthDiagnostic.records, incompleteAuthDiagnostics: incompleteAuthDiagnostic.records, incompleteNoAtAuthDiagnostics: incompleteNoAtAuthDiagnostic.records, assignmentDiagnostics: assignmentDiagnostics.records, diagnostics: harness.diagnostics.records, events: harness.events.records })
  const redactionSecrets = [
    "fixture-secret-must-not-cross",
    "fixture-diagnostic-secret",
    "secret_token",
    embeddedBearerCredential,
    embeddedBasicCredential,
    embeddedOpReference,
    underscoreBearerCredential,
    underscoreBasicCredential,
    underscoreOpReference,
    malformedCredentialTail,
    malformedBearerCredential,
    malformedBasicCredential,
    malformedOpReference,
    completePrivateKey,
    incompletePrivateKey,
    "fixture-private-key-secret",
    underscoreAuthUsername,
    underscoreAuthPassword,
    underscoreAuthUrl,
    underscoreAssignment,
    emptyUsernameAuthUrl,
    emptyPasswordAuthUrl,
    slashBearingAuthUrl,
    usernameOnlyAuthUrl,
    percentEncodedUserinfoAuthUrl,
    ftpAuthUrl,
    postgresAuthUrl,
    overlongAuthUrl,
    incompleteAuthUrl,
    "fixture-empty-username-password",
    "fixture-empty-password-username",
    "fixtureTail",
    "fixtureHead",
  ]
  absent(
    {
      recordsFrozen: [...diagnostic.records, ...assignmentDiagnostics.records, ...harness.diagnostics.records, ...harness.events.records].every(Object.isFrozen),
      leakedSecret: redactionSecrets.some((secret) => serialized.includes(secret)),
      redactedMessage: diagnostic.records[0]?.message,
      assignmentMessages: assignmentDiagnostics.records.map(({ message }) => message),
      incompletePrivateKeyRecords: incompletePrivateKeyDiagnostic.records,
      overlongAuthRecords: overlongAuthDiagnostic.records,
      incompleteAuthRecords: incompleteAuthDiagnostic.records,
      incompleteNoAtAuthRecords: incompleteNoAtAuthDiagnostic.records,
      primary: { stdout: harness.observation.stdout, exitCode: harness.observation.exitCode },
      order: redactionTrace,
    },
    { recordsFrozen: true, leakedSecret: false, redactedMessage: "context before [REDACTED] | [REDACTED] | [REDACTED] | x_[REDACTED] | x_[REDACTED] | x_[REDACTED] | [REDACTED] | [REDACTED] | [REDACTED] | [REDACTED] | x_[REDACTED] | x_[REDACTED] | x_[REDACTED] | [REDACTED] | [REDACTED] | [REDACTED] | [REDACTED] | [REDACTED] | https://fixture.example:8080 | https://fixture.example:8443. | [REDACTED] | [REDACTED] | [REDACTED]", assignmentMessages: assignmentCases.map(({ expected }) => expected), incompletePrivateKeyRecords: [], overlongAuthRecords: [], incompleteAuthRecords: [], incompleteNoAtAuthRecords: [], primary: { stdout: literalHelpProcess.stdout, exitCode: literalHelpProcess.exitCode }, order: ["build-allowlist", "redact", "validate", "freeze", "cross-seam"] },
    "redaction must precede both seams without changing the fixed primary result",
  )
})
