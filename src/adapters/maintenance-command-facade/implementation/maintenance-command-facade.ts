import { randomUUID } from "node:crypto"
import type {
  DiagnosticMode,
  DiagnosticRecord,
  EventAcceptance,
  EventRecord,
  MaintenanceCommandFacade,
  MaintenanceCommandFacadeAssembly,
  MaintenanceCommandFacadeFactory,
  ProcessObservation,
} from "../interface"
import type {
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
  serializeFacadeErrorEgress,
  serializeFacadeSuccessEgress,
} from "../serialized-values"
import { createDiagnosticPipeline, sanitizeEventRecord } from "./logtape-diagnostic-adapter"

const runIdPattern = /^[A-Za-z0-9._-]{1,64}$/

type ParseFailure = {
  message: string
  runId?: string
  diagnosticMode?: DiagnosticMode
  eventMode?: EventMode
}

type ParsedGlobals = {
  runId: string | undefined
  diagnosticMode: DiagnosticMode | undefined
  eventMode: EventMode | undefined
  route: string[]
  group: boolean
}

type EventMode = "auto" | "off"

type GlobalState = {
  runId: string | undefined
  diagnosticMode: DiagnosticMode | undefined
  eventMode: EventMode | undefined
  seen: Set<string>
}

type ArgumentState = {
  commandStarted: boolean
  group: boolean
  route: string[]
  globals: GlobalState
}

const generatedRunId = (): string => randomUUID()

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
      eventMode: undefined,
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

const parseCommand = (
  argv: readonly string[],
  stdin: string,
): {
  command: MaintenanceCommand
  runId: string | undefined
  diagnosticMode: DiagnosticMode | undefined
  eventMode: EventMode | undefined
} | ParseFailure => {
  const parsed = parseGlobals(argv)
  if ("message" in parsed) return parsed
  const route = routeFor(parsed)
  if (!helpAlias(route) || stdin !== "") {
    return parseFailureFor("Unknown maintenance command.", parsed)
  }
  return {
    command: { command: "help" },
    runId: parsed.runId,
    diagnosticMode: parsed.diagnosticMode,
    eventMode: parsed.eventMode,
  }
}

const successEnvelope = (
  runId: string,
  outcome: MaintenanceOutcome<unknown> & { status: "ok" },
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
  outcome: MaintenanceOutcome<unknown>,
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

type OutcomeValueMetadata = {
  transactionState: NonNullable<DiagnosticRecord["transaction_state"]>
  retrySafety: NonNullable<DiagnosticRecord["retry_safety"]>
  nextAction: DiagnosticNextAction
}

const outcomeValueMetadata = (outcome: MaintenanceOutcome<unknown>): OutcomeValueMetadata => {
  if (outcome.status === "error") {
    return {
      transactionState: outcome.error.transactionState,
      retrySafety: outcome.error.retrySafety,
      nextAction: outcome.error.nextAction,
    }
  }
  const value = outcome.value as {
    transactionState: OutcomeValueMetadata["transactionState"]
    retrySafety: OutcomeValueMetadata["retrySafety"]
    nextAction: DiagnosticNextAction
  }
  return {
    transactionState: value.transactionState,
    retrySafety: value.retrySafety,
    nextAction: value.nextAction,
  }
}

const diagnosticWithoutSequenceFor = (
  runId: string,
  event: string,
  level: DiagnosticRecord["level"],
  outcome: Extract<MaintenanceOutcome<unknown>, { status: "error" }>,
  command?: MaintenanceCommand["command"],
): Omit<DiagnosticRecord, "sequence"> => ({
  schema_version: 1,
  record_type: "diagnostic",
  timestamp: new Date().toISOString(),
  level,
  category: ["agent-plugin-kit", "maintenance"],
  event,
  run_id: runId,
  ...(command === undefined ? {} : { command }),
  station_id: outcome.stationId,
  failure_class: outcome.error.failureClass,
  result_code: outcome.resultCode,
  transaction_state: outcome.error.transactionState,
  retry_safety: outcome.error.retrySafety,
  next_action: outcome.error.nextAction,
  message: `Maintenance command failed with result code "${outcome.resultCode}".`,
})

const eventFailureNextAction: DiagnosticNextAction = {
  id: "events.inspect-configuration",
  action: "repair_state",
  summary: "Inspect the configured event transport; do not repeat the command solely to replay its event.",
  commandId: null,
}

const eventFailureDiagnosticFor = (
  runId: string,
  outcome: MaintenanceOutcome<unknown>,
  command: MaintenanceCommand["command"],
): Omit<DiagnosticRecord, "sequence"> => {
  const metadata = outcomeValueMetadata(outcome)
  return {
    schema_version: 1,
    record_type: "diagnostic",
    timestamp: new Date().toISOString(),
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
    next_action: eventFailureNextAction,
    message: eventFailureNextAction.summary,
  }
}

const eventOutcomeFor = (outcome: MaintenanceOutcome<unknown>): EventRecord["outcome"] => {
  if (outcome.status === "ok") return outcome.resultCode === "previewed" ? "previewed" : "completed"
  return outcome.error.failureClass === "usage" || outcome.error.failureClass === "refusal" ? "refused" : "failed"
}

const eventRecordFor = (
  runId: string,
  sequence: number,
  command: MaintenanceCommand,
  outcome: MaintenanceOutcome<unknown>,
  secrets: readonly string[],
): EventRecord | undefined => {
  const metadata = outcomeValueMetadata(outcome)
  const candidate: Record<string, unknown> = {
    schema_version: 1,
    // The event ID is an opaque value to consumers. This stable owner-local
    // value is retained for the accepted correlation fixture.
    event_id: `${runId}.${sequence + 1}`,
    occurred_at: new Date().toISOString(),
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
): Promise<MaintenanceOutcome<unknown>> => {
  if (isMaintenanceApplyRequest(command)) return commands.apply(command)
  return commands.inspect(command)
}

export const createMaintenanceCommandFacade: MaintenanceCommandFacadeFactory = (
  assembly,
): MaintenanceCommandFacade => ({
  async invoke(invocation): Promise<ProcessObservation> {
    const parsed = parseCommand(invocation.argv, invocation.stdin)
    const runId = parsed.runId ?? generatedRunId()
    const diagnostics = assembly.diagnostics === undefined
      ? undefined
      : createDiagnosticPipeline({
          mode: parsed.diagnosticMode ?? "default",
          maximumBufferedRecords: 250,
          diagnostics: assembly.diagnostics,
          secretValues: secretValuesFor(invocation.environment),
        })
    let sequence = 0
    const nextSequence = (): number => {
      sequence += 1
      return sequence
    }
    const recordDiagnostic = (record: Omit<DiagnosticRecord, "sequence">): void => {
      diagnostics?.record({ ...record, sequence: nextSequence() })
    }
    const acceptEvent = (
      command: MaintenanceCommand,
      outcome: MaintenanceOutcome<unknown>,
    ): void => {
      if (assembly.events === undefined || parsed.eventMode !== "auto") return
      const eventSequence = nextSequence()
      const event = eventRecordFor(
        runId,
        eventSequence,
        command,
        outcome,
        secretValuesFor(invocation.environment),
      )
      if (event === undefined) return
      let acceptance: EventAcceptance | undefined
      try {
        acceptance = assembly.events.accept(event)
      } catch {
        acceptance = undefined
      }
      if (acceptance?.status !== "accepted") {
        recordDiagnostic(eventFailureDiagnosticFor(runId, outcome, command.command))
      }
    }

    try {
      if ("message" in parsed) {
        const usage = maintenanceUsageRefusalOutcome()
        recordDiagnostic(diagnosticWithoutSequenceFor(
          runId,
          "maintenance.usage-refused",
          "error",
          usage,
        ))
        return observationForUsage(runId, parsed.message)
      }
      const outcome = await dispatchFor(assembly.commands, parsed.command)
      if (outcome.status === "error") {
        recordDiagnostic(diagnosticWithoutSequenceFor(
          runId,
          outcome.stationId,
          outcome.error.severity === "fatal" ? "fatal" : outcome.error.severity === "warning" ? "warning" : "error",
          outcome,
          parsed.command.command,
        ))
      }
      const observation = observationForOutcome(runId, parsed.command, outcome)
      acceptEvent(parsed.command, outcome)
      return observation
    } catch {
      return emergencyContainment()
    } finally {
      diagnostics?.dispose()
    }
  },

  async dispatch(command): Promise<MaintenanceOutcome<unknown>> {
    return dispatchFor(assembly.commands, command)
  },
})
