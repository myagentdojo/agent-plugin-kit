import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import type {
  DiagnosticAdapter,
  DiagnosticMode,
  DiagnosticPipeline,
  DiagnosticPipelineFactory,
  DiagnosticRecord,
  EventAcceptance,
  EventAdapter,
  EventRecord,
  FacadeCorrelationSources,
  MaintenanceCommandFacade,
  MaintenanceCommandFacadeAssembly,
  MaintenanceCommandFacadeFactory,
  ProcessObservation,
} from "../interface"
import type {
  CommandPreview,
  CommandResult,
  MaintenanceApplyRequest,
  MaintenanceCommand,
  MaintenanceOutcome,
} from "../../../modules/maintenance-command-contract/interface"
import type { CommandDescriptor } from "../../../modules/maintenance-command-contract/command-vocabulary"
import { commandVocabulary } from "../../../modules/maintenance-command-contract/command-vocabulary"
import {
  maintenanceErrorEnvelopeDataFor,
  maintenanceErrorEnvelopeProjectionFor,
  maintenanceSuccessEnvelopeDataFor,
  maintenanceUsageRefusalOutcome,
} from "../../../modules/maintenance-command-contract/implementation/maintenance-commands"
import {
  diagnosticFailureMessageFor,
  diagnosticOutcomeContextMessageFor,
  eventDeliveryFailureNextAction,
  serializeFacadeErrorEgress,
  serializeFacadeSuccessEgress,
  sanitizeEventRecord,
} from "../serialized-values"
import { wireCommandRefusalFor } from "../../../modules/maintenance-command-contract/implementation/trusted-command-binding"

const runIdPattern = /^[A-Za-z0-9._-]{1,64}$/

type TrustedMaintenanceOutcome = MaintenanceOutcome<CommandPreview | CommandResult>

type ParseFailure = {
  message: string
  runId?: string
  diagnosticMode?: DiagnosticMode
  eventMode?: EventMode
}

type ParsedGlobals = {
  runId: string | undefined
  diagnosticMode: DiagnosticMode | undefined
  eventMode: EventMode
  route: string[]
  group: boolean
}

type EventMode = "auto" | "off"

type GlobalState = {
  runId: string | undefined
  diagnosticMode: DiagnosticMode | undefined
  eventMode: EventMode
  seen: Set<string>
}

type ArgumentState = {
  commandStarted: boolean
  group: boolean
  route: string[]
  globals: GlobalState
}

const generatedRunId = (): string => randomUUID()

const defaultCorrelationSources: FacadeCorrelationSources = {
  now: () => new Date().toISOString(),
  eventId: () => randomUUID(),
}

const timestampFor = (correlation: FacadeCorrelationSources): string => {
  try {
    return correlation.now()
  } catch {
    return defaultCorrelationSources.now()
  }
}

const eventIdFor = (correlation: FacadeCorrelationSources): string => {
  try {
    return correlation.eventId()
  } catch {
    return defaultCorrelationSources.eventId()
  }
}

const parseFailureFor = (
  message: string,
  state: Pick<GlobalState, "runId" | "diagnosticMode" | "eventMode">,
): ParseFailure => ({
  message,
  ...(state.runId === undefined ? {} : { runId: state.runId }),
  ...(state.diagnosticMode === undefined ? {} : { diagnosticMode: state.diagnosticMode }),
  ...(state.eventMode === undefined ? {} : { eventMode: state.eventMode }),
})

const descriptorForCommand = (command: MaintenanceCommand["command"]): CommandDescriptor => {
  const descriptor = commandVocabulary.find((candidate) => candidate.command === command)
  if (descriptor === undefined) throw new Error(`missing Maintenance Command descriptor: ${command}`)
  return descriptor
}

const consumeRunId = (
  argv: readonly string[],
  index: number,
  state: GlobalState,
): number | ParseFailure => {
  const candidate = argv[index + 1]
  if (candidate === undefined || candidate.startsWith("--") || !runIdPattern.test(candidate)) {
    return parseFailureFor("Invalid run ID.", state)
  }
  state.runId = candidate
  return 1
}

const consumeEventMode = (
  argv: readonly string[],
  index: number,
  state: GlobalState,
): number | ParseFailure => {
  const mode = argv[index + 1]
  if (mode !== "auto" && mode !== "off") return parseFailureFor("Invalid event mode.", state)
  state.eventMode = mode
  return 1
}

const consumeDiagnosticMode = (mode: DiagnosticMode) => (
  _argv: readonly string[],
  _index: number,
  state: GlobalState,
): number | ParseFailure => {
  if (state.diagnosticMode !== undefined) return parseFailureFor("Diagnostic modes are mutually exclusive.", state)
  state.diagnosticMode = mode
  return 0
}

const globalOptionHandlers: Readonly<Record<string, (
  argv: readonly string[],
  index: number,
  state: GlobalState,
) => number | ParseFailure>> = {
  "--json": () => 0,
  "--quiet": consumeDiagnosticMode("quiet"),
  "--verbose": consumeDiagnosticMode("verbose"),
  "--debug": consumeDiagnosticMode("debug"),
  "--run-id": consumeRunId,
  "--events": consumeEventMode,
}

const consumeGlobalOption = (
  token: string,
  argv: readonly string[],
  index: number,
  state: GlobalState,
): number | ParseFailure => {
  if (state.seen.has(token)) return parseFailureFor("Duplicate command option.", state)
  const handler = globalOptionHandlers[token]
  if (handler === undefined) return parseFailureFor("Unknown command option.", state)
  state.seen.add(token)
  return handler(argv, index, state)
}

const appendRouteToken = (token: string, state: ArgumentState): number => {
  state.commandStarted = true
  state.route.push(token)
  return 0
}

const consumeRootGroup = (state: ArgumentState): number | ParseFailure => {
  if (state.group) return { message: "Invalid command grammar." }
  state.group = true
  return 0
}

const consumeArgument = (
  token: string,
  argv: readonly string[],
  index: number,
  state: ArgumentState,
): number | ParseFailure => {
  if (state.commandStarted) return appendRouteToken(token, state)
  if (token === "maintenance") return consumeRootGroup(state)
  if (token === "-h" || token === "--help") return appendRouteToken(token, state)
  if (token.startsWith("--")) return consumeGlobalOption(token, argv, index, state.globals)
  return appendRouteToken(token, state)
}

const parseGlobals = (argv: readonly string[]): ParsedGlobals | ParseFailure => {
  const state: ArgumentState = {
    commandStarted: false,
    group: false,
    route: [],
    globals: {
      runId: undefined,
      diagnosticMode: undefined,
      eventMode: "auto",
      seen: new Set<string>(),
    },
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined) return { message: "Invalid command grammar." }
    const consumed = consumeArgument(token, argv, index, state)
    if (typeof consumed !== "number") return parseFailureFor(consumed.message, state.globals)
    index += consumed
  }

  return {
    runId: state.globals.runId,
    diagnosticMode: state.globals.diagnosticMode,
    eventMode: state.globals.eventMode,
    route: state.route,
    group: state.group,
  }
}

const helpAlias = (route: readonly string[]): boolean =>
  route.length === 0 || (route.length === 1 && ["help", "-h", "--help"].includes(route[0] ?? ""))

const routeFor = (parsed: ParsedGlobals): readonly string[] => {
  if (parsed.route.length === 0) return ["help"]
  if (helpAlias(parsed.route)) return ["help"]
  return parsed.route
}

const routeStartsWith = (actual: readonly string[], expected: readonly string[]): boolean =>
  actual.length >= expected.length && expected.every((token, index) => actual[index] === token)

const inputOptionSet = (descriptor: CommandDescriptor): ReadonlySet<string> =>
  new Set(descriptor.inputs)

const parseJsonText = (text: string): unknown | undefined => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

const isParseFailure = (value: unknown): value is ParseFailure =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  typeof (value as { message?: unknown }).message === "string"

const readJsonReference = async (reference: string, stdin: string): Promise<unknown | undefined> => {
	if (reference === "-") return parseJsonText(stdin)
	try {
		return parseJsonText(await readFile(reference, "utf8"))
	} catch {
		return undefined
	}
}

const fileInputFor = async (
  descriptor: CommandDescriptor,
  route: readonly string[],
): Promise<Readonly<Record<string, unknown>> | ParseFailure> => {
  const inputs = inputOptionSet(descriptor)
  const values: Record<string, unknown> = {}
  for (let index = descriptor.route.length; index < route.length; index += 1) {
    const option = route[index]
    if (option === undefined || !inputs.has(option) || Object.hasOwn(values, option)) {
      return { message: "Invalid maintenance command input." }
    }
    const reference = route[index + 1]
    if (reference === undefined || reference.startsWith("--")) {
      return { message: "Invalid maintenance command input." }
    }
		values[option] = reference
		index += 1
	}
	if (Object.values(values).filter((value) => value === "-").length > 1) {
		return { message: "Invalid maintenance command input." }
	}
	return values
}

const requiredInputPresent = (
	descriptor: CommandDescriptor,
	values: Readonly<Record<string, unknown>>,
): boolean => descriptor.inputs.every((input) => typeof values[input] === "string")

const invalidMaintenanceInput = (): ParseFailure => ({
	message: "Invalid maintenance command input.",
})

const stdinWireCandidateFor = (
	descriptor: CommandDescriptor,
	stdin: string,
): unknown | ParseFailure => {
	const parsed = parseJsonText(stdin)
	if (parsed === undefined) return invalidMaintenanceInput()
	if (descriptor.command === "canary:inspect") {
		return { schemaVersion: 1, command: descriptor.command, candidate: parsed }
	}
	if (descriptor.command === "canary:qualify") {
		return { schemaVersion: 1, command: descriptor.command, candidate: parsed, authority: "" }
	}
	return { schemaVersion: 1, command: descriptor.command, request: parsed }
}

const jsonInputFor = async (
	values: Readonly<Record<string, unknown>>,
	option: string,
	stdin: string,
): Promise<unknown | ParseFailure> => {
	const reference = values[option]
	if (typeof reference !== "string") return invalidMaintenanceInput()
	const parsed = await readJsonReference(reference, stdin)
	return parsed === undefined ? invalidMaintenanceInput() : parsed
}

const requestWireCandidateFor = async (
	command: CommandDescriptor["command"],
	values: Readonly<Record<string, unknown>>,
	stdin: string,
): Promise<unknown | ParseFailure> => {
	const request = await jsonInputFor(values, "--request", stdin)
	return isParseFailure(request)
		? request
		: { schemaVersion: 1, command, request }
}

const requestAndApprovalWireCandidateFor = async (
	command: CommandDescriptor["command"],
	values: Readonly<Record<string, unknown>>,
	stdin: string,
): Promise<unknown | ParseFailure> => {
	const request = await jsonInputFor(values, "--request", stdin)
	if (isParseFailure(request)) return request
	const approval = await jsonInputFor(values, "--approval", stdin)
	return isParseFailure(approval)
		? approval
		: { schemaVersion: 1, command, request, approval }
}

const candidateWireCandidateFor = async (
	command: CommandDescriptor["command"],
	values: Readonly<Record<string, unknown>>,
	stdin: string,
): Promise<unknown | ParseFailure> => {
	const candidate = await jsonInputFor(values, "--candidate", stdin)
	return isParseFailure(candidate)
		? candidate
		: { schemaVersion: 1, command, candidate }
}

const authorityReferenceFor = (
	values: Readonly<Record<string, unknown>>,
	stdin: string,
): string | ParseFailure => {
	const reference = values["--authority"]
	if (typeof reference !== "string") return invalidMaintenanceInput()
	if (reference !== "-") return reference
	const parsed = parseJsonText(stdin)
	return typeof parsed === "string" && parsed !== "-" && parsed.length > 0
		? parsed
		: invalidMaintenanceInput()
}

const fixedWireCandidateFor = (
	command: CommandDescriptor["command"],
): Readonly<Record<string, unknown>> => {
	if (command === "runtime:repair") return { schemaVersion: 1, command, argv: ["repair"] }
	if (command === "runtime:repair-apply") {
		return { schemaVersion: 1, command, argv: ["repair", "--apply"] }
	}
	return { schemaVersion: 1, command }
}

const fileWireCandidateFor = async (
	descriptor: CommandDescriptor,
	values: Readonly<Record<string, unknown>>,
	stdin: string,
): Promise<unknown | ParseFailure> => {
	if (descriptor.command === "canary:qualify") {
		const candidate = await jsonInputFor(values, "--candidate", stdin)
		if (isParseFailure(candidate)) return candidate
		const authority = authorityReferenceFor(values, stdin)
		return isParseFailure(authority)
			? authority
			: { schemaVersion: 1, command: descriptor.command, candidate, authority }
	}
	if (descriptor.command === "canary:inspect") {
		return candidateWireCandidateFor(descriptor.command, values, stdin)
	}
	if (descriptor.protectedInput === "approval") {
		return requestAndApprovalWireCandidateFor(descriptor.command, values, stdin)
	}
	if (descriptor.inputs.includes("--request")) {
		return requestWireCandidateFor(descriptor.command, values, stdin)
	}
	return fixedWireCandidateFor(descriptor.command)
}

const wireInputFailureFor = (
	descriptor: CommandDescriptor,
	values: Readonly<Record<string, unknown>>,
	stdin: string,
): ParseFailure | undefined => {
	if (!descriptor.stdin && stdin !== "") return invalidMaintenanceInput()
	const missingInput = !requiredInputPresent(descriptor, values)
	if (missingInput && (!descriptor.stdin || stdin === "" || stdin === "present")) {
		return invalidMaintenanceInput()
	}
	return undefined
}

const wireCandidateFor = async (
	descriptor: CommandDescriptor,
	route: readonly string[],
	stdin: string,
): Promise<unknown | ParseFailure> => {
	const values = await fileInputFor(descriptor, route)
	if (isParseFailure(values)) return values
	const inputFailure = wireInputFailureFor(descriptor, values, stdin)
	if (inputFailure !== undefined) return inputFailure
	if (descriptor.stdin && Object.keys(values).length === 0) {
		return stdinWireCandidateFor(descriptor, stdin)
	}
	return fileWireCandidateFor(descriptor, values, stdin)
}

const bindingRefusalMessages: Readonly<Record<string, string>> = {
	"wire-version-unsupported": "Unsupported maintenance command version.",
	"wire-command-invalid": "Invalid maintenance command input.",
	"payload-fragment-invalid": "Invalid maintenance command input.",
	"release-fragment-invalid": "Invalid maintenance command input.",
	"release-approval-invalid": "Invalid maintenance command input.",
	"claude-fragment-invalid": "Invalid maintenance command input.",
	"claude-approval-invalid": "Invalid maintenance command input.",
	"codex-fragment-invalid": "Invalid maintenance command input.",
	"codex-approval-invalid": "Invalid maintenance command input.",
	"canary-fragment-invalid": "Invalid maintenance command input.",
	"authority-unavailable": "Maintenance command authority is unavailable.",
	"authority-reference-invalid": "Maintenance command authority is unavailable.",
}

const bindingRefusalMessageFor = (code: string): string =>
	bindingRefusalMessages[code] ??
	(code.endsWith("-invalid")
		? "Invalid maintenance command input."
		: "Maintenance command is not admitted.")

const bindWireCandidate = async (
	wireCandidate: unknown,
	parsed: ParsedGlobals,
	wireBinding: MaintenanceCommandFacadeAssembly["wireBinding"],
): Promise<MaintenanceCommand | ParseFailure> => {
	if (wireBinding === undefined) return parseFailureFor("Maintenance command is not admitted.", parsed)
	const bound = await wireBinding(wireCandidate)
	if (bound.status === "bound") return bound.command
	return parseFailureFor(bindingRefusalMessageFor(bound.code), parsed)
}

const parseCommand = async (
  argv: readonly string[],
  stdin: string,
  wireBinding: MaintenanceCommandFacadeAssembly["wireBinding"],
): Promise<{
  command: MaintenanceCommand
  runId: string | undefined
  diagnosticMode: DiagnosticMode | undefined
  eventMode: EventMode
} | ParseFailure> => {
  const parsed = parseGlobals(argv)
  if ("message" in parsed) return parsed
  const route = routeFor(parsed)
  if (helpAlias(route) && stdin === "") {
    return {
      command: { command: "help" },
      runId: parsed.runId,
      diagnosticMode: parsed.diagnosticMode,
      eventMode: parsed.eventMode,
    }
  }
  if (helpAlias(route)) {
    return parseFailureFor("Unknown maintenance command.", parsed)
  }
	const descriptor = commandVocabulary
		.filter((candidate) => routeStartsWith(route, candidate.route))
		.sort((left, right) => right.route.length - left.route.length)[0]
	if (descriptor === undefined) return parseFailureFor("Unknown maintenance command.", parsed)
	const wireCandidate = await wireCandidateFor(descriptor, route, stdin)
	if (isParseFailure(wireCandidate)) return parseFailureFor(wireCandidate.message, parsed)
	const bound = await bindWireCandidate(wireCandidate, parsed, wireBinding)
	if (isParseFailure(bound)) return bound
	return {
		command: bound,
		runId: parsed.runId,
    diagnosticMode: parsed.diagnosticMode,
    eventMode: parsed.eventMode,
  }
}

const successEnvelope = (
  runId: string,
  outcome: Extract<TrustedMaintenanceOutcome, { status: "ok" }>,
) => ({
  schema_version: 1,
  status: "ok",
  run_id: runId,
  data: maintenanceSuccessEnvelopeDataFor(outcome),
})

const errorEnvelope = (
  runId: string,
  message: string,
  requested: MaintenanceCommand["command"] | "maintenance",
  outcome: MaintenanceOutcome<unknown> & { status: "error" },
) => ({
  record_type: "error_envelope",
  schema_version: 1,
  status: "error",
  message,
  run_id: runId,
  data: maintenanceErrorEnvelopeDataFor(requested, outcome),
  error: maintenanceErrorEnvelopeProjectionFor(outcome),
})

const emergencyContainment = (): ProcessObservation => ({
  stdout: "",
  stderr: "Maintenance command facade containment failure.\n",
  exitCode: 1,
})

const observationForUsage = (runId: string, message: string): ProcessObservation => {
  const outcome = maintenanceUsageRefusalOutcome()
  const stderr = serializeFacadeErrorEgress(errorEnvelope(runId, message, "maintenance", outcome))
  return stderr === undefined
    ? emergencyContainment()
    : { stdout: "", stderr, exitCode: outcome.error.exitCodeHint }
}

const observationForOutcome = (
  runId: string,
  requested: MaintenanceCommand,
  outcome: TrustedMaintenanceOutcome,
): ProcessObservation => {
  if (outcome.status === "ok") {
    const stdout = serializeFacadeSuccessEgress(successEnvelope(runId, outcome))
    return stdout === undefined
      ? emergencyContainment()
      : { stdout, stderr: "", exitCode: 0 }
  }
  const stderr = serializeFacadeErrorEgress(errorEnvelope(
    runId,
    `Maintenance command failed with result code "${outcome.resultCode}".`,
    requested.command,
    outcome,
  ))
  if (stderr === undefined) return emergencyContainment()
  return {
    stdout: "",
    stderr,
    exitCode: outcome.error.exitCodeHint,
  }
}

type DiagnosticNextAction = NonNullable<DiagnosticRecord["next_action"]>
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never
type DiagnosticRecordWithoutSequence = DistributiveOmit<DiagnosticRecord, "sequence">

type OutcomeValueMetadata = {
  transactionState: NonNullable<DiagnosticRecord["transaction_state"]>
  retrySafety: NonNullable<DiagnosticRecord["retry_safety"]>
  nextAction: DiagnosticNextAction
}

const outcomeValueMetadata = (outcome: TrustedMaintenanceOutcome): OutcomeValueMetadata => {
  if (outcome.status === "error") {
    return {
      transactionState: outcome.error.transactionState,
      retrySafety: outcome.error.retrySafety,
      nextAction: outcome.error.nextAction,
    }
  }
  const value = outcome.value
  return {
    transactionState: value.transactionState,
    retrySafety: value.retrySafety,
    nextAction: value.nextAction,
  }
}

const diagnosticOutcomeContextFor = (
  timestamp: string,
  runId: string,
  outcome: TrustedMaintenanceOutcome,
  command?: MaintenanceCommand["command"],
): DiagnosticRecordWithoutSequence => {
  const metadata = outcomeValueMetadata(outcome)
  return {
    schema_version: 2,
    record_type: "diagnostic",
    timestamp,
    level: "info",
    category: ["agent-plugin-kit", "maintenance"],
    event: "maintenance.outcome-context",
    run_id: runId,
    ...(command === undefined ? {} : { command }),
    station_id: outcome.stationId,
    result_code: outcome.resultCode,
    transaction_state: metadata.transactionState,
    retry_safety: metadata.retrySafety,
    message: diagnosticOutcomeContextMessageFor(outcome.resultCode),
  }
}

const diagnosticWithoutSequenceFor = (
  timestamp: string,
  runId: string,
  event: string,
  level: DiagnosticRecord["level"],
  outcome: Extract<MaintenanceOutcome<unknown>, { status: "error" }>,
  command?: MaintenanceCommand["command"],
): DiagnosticRecordWithoutSequence => {
  const fields = {
    schema_version: 2,
    record_type: "diagnostic",
    timestamp,
    category: ["agent-plugin-kit", "maintenance"] as const,
    event,
    run_id: runId,
    ...(command === undefined ? {} : { command }),
    station_id: outcome.stationId,
    failure_class: outcome.error.failureClass,
    result_code: outcome.resultCode,
    transaction_state: outcome.error.transactionState,
    retry_safety: outcome.error.retrySafety,
    next_action: outcome.error.nextAction,
    message: diagnosticFailureMessageFor(outcome.resultCode),
  } as const
  return level === "error" || level === "fatal"
    ? { ...fields, level }
    : { ...fields, level }
}

const eventFailureDiagnosticFor = (
  timestamp: string,
  runId: string,
  outcome: TrustedMaintenanceOutcome,
  command: MaintenanceCommand["command"],
): DiagnosticRecordWithoutSequence => {
  const metadata = outcomeValueMetadata(outcome)
  return {
    schema_version: 2,
    record_type: "diagnostic",
    timestamp,
    level: "error",
    category: ["agent-plugin-kit", "maintenance"],
    event: "event.delivery-failed",
    run_id: runId,
    command,
    station_id: outcome.stationId,
    failure_class: "event_delivery",
    result_code: outcome.resultCode,
    transaction_state: metadata.transactionState,
    retry_safety: metadata.retrySafety,
    next_action: eventDeliveryFailureNextAction,
    message: eventDeliveryFailureNextAction.summary,
  }
}

const eventOutcomeFor = (outcome: TrustedMaintenanceOutcome): EventRecord["outcome"] => {
  if (outcome.status === "ok") return outcome.resultCode === "previewed" ? "previewed" : "completed"
  return outcome.error.failureClass === "usage" || outcome.error.failureClass === "refusal" ? "refused" : "failed"
}

const eventRecordFor = (
  runId: string,
  sequence: number,
  command: MaintenanceCommand,
  outcome: TrustedMaintenanceOutcome,
  secrets: readonly string[],
  correlation: FacadeCorrelationSources,
): EventRecord | undefined => {
  const metadata = outcomeValueMetadata(outcome)
  const candidate: Record<string, unknown> = {
    schema_version: 1,
    event_id: eventIdFor(correlation),
    occurred_at: timestampFor(correlation),
    sequence,
    run_id: runId,
    command: command.command,
    station_id: outcome.stationId,
    outcome: eventOutcomeFor(outcome),
    result_code: outcome.resultCode,
    transaction_state: metadata.transactionState,
    retry_safety: metadata.retrySafety,
    next_action_id: metadata.nextAction.id,
  }
  if (outcome.status === "error") candidate.failure_class = outcome.error.failureClass
  return sanitizeEventRecord(candidate, secrets)
}

const secretValuesFor = (environment: Readonly<Record<string, string | undefined>>): readonly string[] => {
  const auth = environment.AGENT_PLUGIN_KIT_EVENT_AUTH
  return auth === undefined || auth === "" ? [] : [auth]
}

const isMaintenanceApplyRequest = (
  command: MaintenanceCommand,
): command is MaintenanceApplyRequest =>
  descriptorForCommand(command.command).interfaceCall === "apply"

const dispatchFor = async (
  commands: MaintenanceCommandFacadeAssembly["commands"],
  command: MaintenanceCommand,
): Promise<TrustedMaintenanceOutcome> => {
  if (isMaintenanceApplyRequest(command)) return commands.apply(command)
  return commands.inspect(command)
}

const loadDiagnosticPipelineFactory = async (): Promise<DiagnosticPipelineFactory | undefined> => {
  try {
    const implementation = await import("./logtape-diagnostic-adapter")
    return implementation.createDiagnosticPipeline
  } catch {
    return undefined
  }
}

const createDiagnosticPipelineFor = async (
  adapter: DiagnosticAdapter,
  mode: DiagnosticMode,
  secrets: readonly string[],
  nextSequence: () => number,
): Promise<DiagnosticPipeline | undefined> => {
  const factory = await loadDiagnosticPipelineFactory()
  if (factory === undefined) {
    try {
      adapter.dispose()
    } catch {
      // A failed diagnostic construction cannot replace the primary result.
    }
    return undefined
  }
  try {
    return factory({
      mode,
      maximumBufferedRecords: 250,
      diagnostics: adapter,
      secretValues: secrets,
      nextSequence,
    })
  } catch {
    try {
      adapter.dispose()
    } catch {
      // A failed diagnostic construction cannot replace the primary result.
    }
    return undefined
  }
}

type EventResolution = {
  adapter: EventAdapter | undefined
  invalidConfiguration: boolean
}

const resolveEvent = async (
  assembly: MaintenanceCommandFacadeAssembly,
  mode: EventMode,
): Promise<EventResolution> => {
  if (mode === "off" || assembly.eventFactory === undefined) {
    return { adapter: undefined, invalidConfiguration: false }
  }
  try {
    const adapter = await assembly.eventFactory()
    return { adapter, invalidConfiguration: adapter === undefined }
  } catch {
    return { adapter: undefined, invalidConfiguration: true }
  }
}

type DiagnosticRuntime = {
  record(record: DiagnosticRecordWithoutSequence): Promise<void>
  dispose(): void
}

const diagnosticAdapterFor = async (
  assembly: MaintenanceCommandFacadeAssembly,
): Promise<DiagnosticAdapter | undefined> => {
  if (assembly.diagnosticFactory === undefined) return undefined
  try {
    return await assembly.diagnosticFactory()
  } catch {
    return undefined
  }
}

const createDiagnosticRuntime = (
  assembly: MaintenanceCommandFacadeAssembly,
  parsed: Awaited<ReturnType<typeof parseCommand>>,
  secrets: readonly string[],
  nextSequence: () => number,
): DiagnosticRuntime => {
  let diagnostics: DiagnosticPipeline | undefined
  let loadAttempted = false
  const ensure = async (): Promise<DiagnosticPipeline | undefined> => {
    if (diagnostics !== undefined || loadAttempted) return diagnostics
    loadAttempted = true
    const adapter = await diagnosticAdapterFor(assembly)
    if (adapter === undefined) return undefined
    diagnostics = await createDiagnosticPipelineFor(
      adapter,
      "diagnosticMode" in parsed && parsed.diagnosticMode !== undefined ? parsed.diagnosticMode : "default",
      secrets,
      nextSequence,
    )
    return diagnostics
  }
  return {
    async record(record): Promise<void> {
      const pipeline = await ensure()
      if (pipeline === undefined) return
      try {
        pipeline.record({ ...record, sequence: nextSequence() })
      } catch {
        // A diagnostic pipeline failure cannot replace the primary result.
      }
    },
    dispose(): void {
      try {
        diagnostics?.dispose()
      } catch {
        // A throwing environmental close cannot replace the primary result.
      }
    },
  }
}

const usageRefusalFor = async (
  runtime: DiagnosticRuntime,
  correlation: FacadeCorrelationSources,
  runId: string,
  message: string,
): Promise<ProcessObservation> => {
  const usage = maintenanceUsageRefusalOutcome()
  await runtime.record(diagnosticOutcomeContextFor(
    timestampFor(correlation),
    runId,
    usage,
  ))
  await runtime.record(diagnosticWithoutSequenceFor(
    timestampFor(correlation),
    runId,
    "maintenance.usage-refused",
    "error",
    usage,
  ))
  return observationForUsage(runId, message)
}

const recordOutcomeDiagnostic = async (
  runtime: DiagnosticRuntime,
  correlation: FacadeCorrelationSources,
  runId: string,
  command: MaintenanceCommand,
  outcome: TrustedMaintenanceOutcome,
): Promise<void> => {
  if (outcome.status !== "error") return
  await runtime.record(diagnosticOutcomeContextFor(
    timestampFor(correlation),
    runId,
    outcome,
    command.command,
  ))
  await runtime.record(diagnosticWithoutSequenceFor(
    timestampFor(correlation),
    runId,
    outcome.stationId,
    outcome.error.severity === "fatal" ? "fatal" : outcome.error.severity === "warning" ? "warning" : "error",
    outcome,
    command.command,
  ))
}

const acceptEventFor = async (
  runtime: DiagnosticRuntime,
  correlation: FacadeCorrelationSources,
  eventAdapter: EventAdapter | undefined,
  runId: string,
  nextSequence: () => number,
  secrets: readonly string[],
  command: MaintenanceCommand,
  outcome: TrustedMaintenanceOutcome,
): Promise<void> => {
  if (eventAdapter === undefined) return
  let event: EventRecord | undefined
  try {
    event = eventRecordFor(runId, nextSequence(), command, outcome, secrets, correlation)
  } catch {
    return
  }
  if (event === undefined) return
  let acceptance: EventAcceptance | undefined
  try {
    acceptance = eventAdapter.accept(event)
  } catch {
    acceptance = undefined
  }
  if (acceptance?.status !== "accepted") {
    await runtime.record(diagnosticOutcomeContextFor(
      timestampFor(correlation),
      runId,
      outcome,
      command.command,
    ))
    await runtime.record(eventFailureDiagnosticFor(
      timestampFor(correlation),
      runId,
      outcome,
      command.command,
    ))
  }
}

const runParsedInvocation = async (
  assembly: MaintenanceCommandFacadeAssembly,
  parsed: Awaited<ReturnType<typeof parseCommand>>,
  runtime: DiagnosticRuntime,
  correlation: FacadeCorrelationSources,
  runId: string,
  nextSequence: () => number,
  secrets: readonly string[],
): Promise<ProcessObservation> => {
  if ("message" in parsed) return usageRefusalFor(runtime, correlation, runId, parsed.message)
  const eventResolution = await resolveEvent(assembly, parsed.eventMode)
  if (eventResolution.invalidConfiguration) return usageRefusalFor(runtime, correlation, runId, "Invalid event endpoint.")
  const outcome = await dispatchFor(assembly.commands, parsed.command)
  await recordOutcomeDiagnostic(runtime, correlation, runId, parsed.command, outcome)
  const observation = observationForOutcome(runId, parsed.command, outcome)
  await acceptEventFor(runtime, correlation, eventResolution.adapter, runId, nextSequence, secrets, parsed.command, outcome)
  return observation
}

/**
 * Create a maintenance command facade that orchestrates command invocation,
 * diagnostic recording, and event delivery. The facade manages the complete
 * lifecycle of maintenance commands from parsing through execution to
 * observability.
 */
export const createMaintenanceCommandFacade: MaintenanceCommandFacadeFactory = (
  assembly,
): MaintenanceCommandFacade => ({
  async invoke(invocation): Promise<ProcessObservation> {
    const parsed = await parseCommand(invocation.argv, invocation.stdin, assembly.wireBinding)
    const runId = parsed.runId ?? generatedRunId()
    let sequence = 0
    const nextSequence = (): number => {
      sequence += 1
      return sequence
    }
    const secrets = secretValuesFor(invocation.environment)
    const correlation = assembly.correlation ?? defaultCorrelationSources
    const runtime = createDiagnosticRuntime(assembly, parsed, secrets, nextSequence)

    try {
      return await runParsedInvocation(assembly, parsed, runtime, correlation, runId, nextSequence, secrets)
    } catch {
      return emergencyContainment()
    } finally {
      runtime.dispose()
    }
  },

  async dispatch(command): Promise<MaintenanceOutcome<unknown>> {
    return dispatchFor(assembly.commands, command)
  },
})
