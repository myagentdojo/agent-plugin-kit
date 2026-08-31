import { randomUUID } from "node:crypto"
import type {
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

const runIdPattern = /^[A-Za-z0-9._-]{1,64}$/

type ParseFailure = {
  message: string
  runId?: string
}

type ParsedGlobals = {
  runId: string | undefined
  route: string[]
  group: boolean
}

type DiagnosticMode = "quiet" | "verbose" | "debug"

type GlobalState = {
  runId: string | undefined
  diagnosticMode: DiagnosticMode | undefined
  seen: Set<string>
}

type ArgumentState = {
  commandStarted: boolean
  group: boolean
  route: string[]
  globals: GlobalState
}

const generatedRunId = (): string => randomUUID()

const parseFailureFor = (message: string, runId: string | undefined): ParseFailure =>
  runId === undefined ? { message } : { message, runId }

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
    return { message: "Invalid run ID." }
  }
  state.runId = candidate
  return 1
}

const consumeEventMode = (argv: readonly string[], index: number): number | ParseFailure => {
  const mode = argv[index + 1]
  return mode === "auto" || mode === "off"
    ? 1
    : { message: "Invalid event mode." }
}

const consumeDiagnosticMode = (mode: DiagnosticMode) => (
  _argv: readonly string[],
  _index: number,
  state: GlobalState,
): number | ParseFailure => {
  if (state.diagnosticMode !== undefined) {
    return { message: "Diagnostic modes are mutually exclusive." }
  }
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
  if (state.seen.has(token)) return { message: "Duplicate command option." }
  const handler = globalOptionHandlers[token]
  if (handler === undefined) return { message: "Unknown command option." }
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
      seen: new Set<string>(),
    },
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined) return { message: "Invalid command grammar." }
    const consumed = consumeArgument(token, argv, index, state)
    if (typeof consumed !== "number") return parseFailureFor(consumed.message, state.globals.runId)
    index += consumed
  }

  return { runId: state.globals.runId, route: state.route, group: state.group }
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
): { command: MaintenanceCommand; runId: string | undefined } | ParseFailure => {
  const parsed = parseGlobals(argv)
  if ("message" in parsed) return parsed
  const route = routeFor(parsed)
  if (!helpAlias(route) || stdin !== "") {
    return parseFailureFor("Unknown maintenance command.", parsed.runId)
  }
  return { command: { command: "help" }, runId: parsed.runId }
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
    if ("message" in parsed) return observationForUsage(parsed.runId ?? generatedRunId(), parsed.message)
    const runId = parsed.runId ?? generatedRunId()

    try {
      const outcome = await dispatchFor(assembly.commands, parsed.command)
      return observationForOutcome(runId, parsed.command, outcome)
    } catch {
      return emergencyContainment()
    }
  },

  async dispatch(command): Promise<MaintenanceOutcome<unknown>> {
    return dispatchFor(assembly.commands, command)
  },
})
