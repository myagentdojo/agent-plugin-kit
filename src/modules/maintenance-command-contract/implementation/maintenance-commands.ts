import type {
  CommandPreview,
  CommandResult,
  EffectClass,
  MaintenanceApplyRequest,
  MaintenanceCommand,
  MaintenanceCommands,
  MaintenanceCommandCollaborators,
  MaintenanceError,
  MaintenanceOutcome,
  ResultCode,
  RetrySafety,
  RuntimeRepairControl,
  StationId,
  TransactionState,
} from "../interface"
import { commandVocabulary } from "../command-vocabulary"
import {
  containmentExit,
  exitFamilies,
  failureNextActionProjection,
  maintenanceCommandContractId,
  resultSchemaVersion,
  resultVocabulary,
} from "../result-vocabulary"

const globalOptions = [
  "--json",
  "--quiet",
  "--verbose",
  "--debug",
  "--run-id <ID>",
  "--events <auto|off>",
] as const

type PayloadRequest = Parameters<MaintenanceCommandCollaborators["payload"]["produce"]>[0]
type PayloadResult = Awaited<ReturnType<MaintenanceCommandCollaborators["payload"]["produce"]>>
type ReleaseInspectionCommand = Extract<
  MaintenanceCommand,
  { command: "release:inspect" | "release:apply" }
>
type ClaudeInspectionCommand = Extract<
  MaintenanceCommand,
  { command: "harness:claude:inspect" | "harness:claude:apply" }
>
type CodexInspectionCommand = Extract<
  MaintenanceCommand,
  { command: "harness:codex:inspect" | "harness:codex:apply" }
>
type CanaryInspectionCommand = Extract<
  MaintenanceCommand,
  { command: "canary:inspect" | "canary:qualify" }
>

const environmentDependencies = [
  {
    name: "AGENT_PLUGIN_KIT_EVENT_ENDPOINT",
    required: false,
    secret: false,
    accepted: "https-or-loopback-http-without-userinfo-query-fragment",
  },
  {
    name: "AGENT_PLUGIN_KIT_EVENT_AUTH",
    required: false,
    secret: true,
    accepted: "opaque-never-recorded",
  },
] as const

const commandIdFor = (command: MaintenanceCommand["command"]) => {
  const descriptor = commandVocabulary.find((candidate) => candidate.command === command)
  if (!descriptor) throw new Error(`missing Command Vocabulary row ${command}`)
  return descriptor
}

const resultFor = (resultCode: ResultCode) => {
  const descriptor = resultVocabulary.find((candidate) => candidate.resultCode === resultCode)
  if (!descriptor) throw new Error(`missing Result Vocabulary row ${resultCode}`)
  return descriptor
}

const stationFor = (command: MaintenanceCommand["command"] | "maintenance", resultCode: ResultCode): StationId => {
  const commandSlug = command === "maintenance" ? command : command.replaceAll(":", "-")
  return `${commandSlug}.${resultCode}` as StationId
}

const retrySafetyFor = (effectClass: EffectClass): RetrySafety =>
  effectClass === "inspect" || effectClass === "repository-local"
    ? "safe"
    : "requires-fresh-inspection"

const helpAgent = () => ({
  schema_version: resultSchemaVersion,
  contract_id: maintenanceCommandContractId,
  package_identity: "agent-plugin-kit",
  package_version: "0.0.0",
  binary: "agent-plugin-kit",
  versions: {
    facade_envelope: 1,
    result: 1,
    error: 1,
    hint: 1,
    diagnostic: 1,
    event: 1,
  },
  global_options: [...globalOptions],
  environment_dependencies: environmentDependencies.map((dependency) => ({ ...dependency })),
  commands: commandVocabulary.map((descriptor) => ({
    route: [...descriptor.route],
    command: descriptor.command,
    interface_call: descriptor.interfaceCall,
    inputs: [...descriptor.inputs],
    stdin: descriptor.stdin,
    effect_class: descriptor.effectClass,
    preview_route: descriptor.previewRoute === null ? null : [...descriptor.previewRoute],
    example: [...descriptor.example],
    next_action_id: descriptor.nextAction.id,
  })),
  result_semantics: {
    retry_safety: ["safe", "unsafe", "requires-fresh-inspection"],
    transaction_state: ["unchanged", "completed", "partially-completed", "unknown"],
    post_dispatch_refusals: [
      "command-refused",
      "retry-deferred",
      "continuation-required",
      "recovery-required",
    ],
  },
  exits: {
    typed: exitFamilies.map((family) => ({
      family_id: family.familyId,
      exit: family.exit,
      owner: family.owner,
      result_codes: [...family.resultCodes],
      envelope: family.envelope,
      meaning: family.meaning,
    })),
    containment: [{
      family_id: containmentExit.familyId,
      exit: containmentExit.exit,
      owner: containmentExit.owner,
      result_codes: [...containmentExit.resultCodes],
      envelope: containmentExit.envelope,
      meaning: containmentExit.meaning,
    }],
  },
  next_actions: failureNextActionProjection.map(({ id, action, commandId, failureClass }) => ({
    id,
    action,
    command_id: commandId,
    failure_class: failureClass,
  })),
  privacy: {
    argv_secret_values: false,
    stdout: "machine-only",
    diagnostics: "stderr",
    events: "redacted-best-effort",
    persisted_state: false,
  },
})

const helpPreview = (): MaintenanceOutcome<CommandPreview> => {
  const descriptor = commandIdFor("help")
  return {
    status: "ok",
    resultCode: "previewed",
    stationId: stationFor("help", "previewed"),
    value: {
      schemaVersion: resultSchemaVersion,
      command: "help",
      effectClass: descriptor.effectClass,
      expectedEffectIds: [],
      transactionState: "unchanged",
      retrySafety: "safe",
      nextAction: descriptor.nextAction,
      human: "Agent Plugin Kit maintenance commands\n",
      agent: helpAgent(),
      stderr: "",
    },
  }
}

const preview = (
  command: MaintenanceCommand["command"],
  expectedEffectIds: readonly string[] = [],
  agent: Readonly<Record<string, unknown>> = { schemaVersion: resultSchemaVersion, kind: "previewed" },
): MaintenanceOutcome<CommandPreview> => {
  const descriptor = commandIdFor(command)
  return {
    status: "ok",
    resultCode: "previewed",
    stationId: stationFor(command, "previewed"),
    value: {
      schemaVersion: resultSchemaVersion,
      command,
      effectClass: descriptor.effectClass,
      expectedEffectIds: [...expectedEffectIds],
      transactionState: "unchanged",
      retrySafety: retrySafetyFor(descriptor.effectClass),
      nextAction: descriptor.nextAction,
      human: "",
      agent,
      stderr: "",
    },
  }
}

const resultHuman = (command: MaintenanceApplyRequest["command"], kind: string): string => {
  switch (command) {
    case "payload:materialize":
      return "Plugin Payload materialized.\n"
    case "payload:package":
      return "Plugin Payload packaged.\n"
    default:
      return `${kind} completed.\n`
  }
}

const completedResult = (
  request: MaintenanceApplyRequest,
  completedEffectIds: readonly string[],
  remainingEffectIds: readonly string[],
  kind: string,
  agent: Readonly<Record<string, unknown>> = { schemaVersion: resultSchemaVersion, kind },
): MaintenanceOutcome<CommandResult> => {
  const descriptor = commandIdFor(request.command)
  const transactionState: TransactionState = remainingEffectIds.length === 0
    ? "completed"
    : "partially-completed"
  return {
    status: "ok",
    resultCode: "completed",
    stationId: stationFor(request.command, "completed"),
    value: {
      schemaVersion: resultSchemaVersion,
      command: request.command,
      transactionState,
      retrySafety: retrySafetyFor(descriptor.effectClass),
      completedEffectIds: [...completedEffectIds],
      remainingEffectIds: [...remainingEffectIds],
      nextAction: descriptor.nextAction,
      human: resultHuman(request.command, kind),
      agent,
      stderr: "",
    },
  }
}

const errorFamilyFor = (resultCode: ResultCode): MaintenanceError["errorFamily"] => {
  const failureClass = resultFor(resultCode).failureClass
  switch (failureClass) {
    case "usage":
      return "input"
    case "refusal":
      return "authorization_scope"
    case "transient":
      return "transient"
    case "continuation":
      return "state_conflict"
    case "recovery":
      return "runtime"
    case "unexpected":
      return "runtime"
    case null:
      throw new Error(`success Result Code cannot build a Maintenance Error: ${resultCode}`)
    default:
      throw new Error(`unhandled Maintenance Failure Class ${String(failureClass)}`)
  }
}

const recoverabilityFor = (resultCode: ResultCode): MaintenanceError["recoverability"] => {
  switch (resultFor(resultCode).failureClass) {
    case "usage":
      return "change_input"
    case "transient":
      return "retry"
    case "refusal":
    case "continuation":
    case "recovery":
      return "repair_state"
    case "unexpected":
      return "contact_support"
    case null:
      throw new Error(`success Result Code cannot build recoverability: ${resultCode}`)
    default:
      throw new Error(`unhandled Maintenance Failure Class for ${resultCode}`)
  }
}

const errorFor = (
  command: MaintenanceCommand["command"] | "maintenance",
  resultCode: ResultCode,
): MaintenanceOutcome<never> => {
  const descriptor = resultFor(resultCode)
  if (descriptor.failureClass === null) {
    throw new Error(`success Result Code cannot build a Maintenance Error: ${resultCode}`)
  }
  return {
    status: "error",
    resultCode,
    stationId: stationFor(command, resultCode),
    error: {
      name: "MaintenanceCommandError",
      exitCodeHint: descriptor.exitClass,
      failureClass: descriptor.failureClass,
      errorFamily: errorFamilyFor(resultCode),
      severity: descriptor.severity === "info" ? "error" : descriptor.severity,
      action: descriptor.nextAction.action,
      retryable: descriptor.retrySafety === "safe" && descriptor.exitFamilyId === "transient-retry",
      recoverability: recoverabilityFor(resultCode),
      retrySafety: descriptor.retrySafety,
      transactionState: descriptor.transactionState,
      nextAction: descriptor.nextAction,
    },
  }
}

const resultKey = (request: MaintenanceApplyRequest): string => JSON.stringify(request)

const isFreshPreviewRequired = (command: MaintenanceApplyRequest["command"]): boolean =>
  command !== "payload:materialize" && command !== "payload:package" && command !== "runtime:repair-apply"

const payloadKind = (request: PayloadRequest, result: PayloadResult): string => {
  if (result.kind === "refused") return result.kind
  if (request.mode === "materialize") return "materialized"
  if (request.mode === "package") return "packaged"
  return "checked"
}

const payloadEffect = (request: PayloadRequest): string | null => {
  switch (request.mode) {
    case "materialize":
      return "effect:payload-materialized"
    case "package":
      return "effect:payload-packaged"
    case "check":
      return null
    default:
      return null
  }
}

const payloadAgent = (kind: string): Readonly<Record<string, unknown>> => ({
  schemaVersion: resultSchemaVersion,
  kind,
})

const applyPayload = async (
  request: Extract<MaintenanceApplyRequest, { command: "payload:materialize" | "payload:package" }>,
  collaborators: MaintenanceCommandCollaborators,
): Promise<MaintenanceOutcome<CommandResult>> => {
  const ownerResult = await collaborators.payload.produce(request.request)
  const kind = payloadKind(request.request, ownerResult)
  if (ownerResult.kind === "refused") return errorFor(request.command, "command-refused")
  const effectId = payloadEffect(request.request)
  return completedResult(
    request,
    effectId === null ? [] : [effectId],
    [],
    kind,
    payloadAgent(kind),
  )
}

const inspectPayload = async (
  command: Extract<MaintenanceCommand, { command: "payload:check" }>,
  collaborators: MaintenanceCommandCollaborators,
): Promise<MaintenanceOutcome<CommandPreview>> => {
  const ownerResult = await collaborators.payload.produce(command.request)
  if (ownerResult.kind === "refused") return errorFor(command.command, "command-refused")
  return preview(command.command)
}

const inspectRelease = async (
  command: ReleaseInspectionCommand,
  collaborators: MaintenanceCommandCollaborators,
): Promise<MaintenanceOutcome<CommandPreview>> => {
  const plan = await collaborators.release.inspect(command.request)
  return preview(command.command, plan.expectedEffectIds)
}

const inspectClaude = async (
  command: ClaudeInspectionCommand,
  collaborators: MaintenanceCommandCollaborators,
): Promise<MaintenanceOutcome<CommandPreview>> => {
  const plan = await collaborators.harness.inspect(command.request)
  return preview(command.command, plan.expectedEffectIds)
}

const inspectCodex = async (
  command: CodexInspectionCommand,
  collaborators: MaintenanceCommandCollaborators,
): Promise<MaintenanceOutcome<CommandPreview>> => {
  const plan = await collaborators.harness.inspect(command.request)
  return preview(command.command, plan.expectedEffectIds)
}

const inspectCanary = async (
  command: CanaryInspectionCommand,
  collaborators: MaintenanceCommandCollaborators,
): Promise<MaintenanceOutcome<CommandPreview>> => {
  await collaborators.canary.inspect(command.candidate)
  return preview(command.command)
}

const runtimeResultCodes: Record<RuntimeRepairControl["code"], ResultCode> = {
  REPAIR_PREVIEW: "runtime-repair-preview",
  REPAIR_UNNEEDED: "runtime-repair-unneeded",
  REPAIR_APPLIED: "runtime-repair-applied",
  USAGE: "runtime-usage-refused",
  BUN_MISSING: "runtime-bun-missing",
  CACHE_ROOT_UNSAFE: "runtime-cache-root-unsafe",
  REPAIR_REQUIRED: "runtime-repair-required",
  HOST_TOOL_MISSING: "runtime-host-tool-missing",
  RUNTIME_NOT_EXECUTABLE: "runtime-not-executable",
  UNSUPPORTED_PLATFORM: "runtime-unsupported-platform",
  DOWNLOAD_FAILED: "runtime-download-failed",
  LOCK_HELD: "runtime-lock-held",
  ARCHIVE_HASH_MISMATCH: "runtime-archive-hash-mismatch",
  ARCHIVE_MEMBER_AMBIGUOUS: "runtime-archive-member-ambiguous",
  ARCHIVE_MEMBER_MISSING: "runtime-archive-member-missing",
  ARCHIVE_SIZE_MISMATCH: "runtime-archive-size-mismatch",
  BUNDLE_MISMATCH: "runtime-bundle-mismatch",
  BUNDLE_UNMAPPED: "runtime-bundle-unmapped",
  EXECUTABLE_HASH_MISMATCH: "runtime-executable-hash-mismatch",
  EXECUTABLE_SIZE_MISMATCH: "runtime-executable-size-mismatch",
  EXECUTABLE_VERSION_MISMATCH: "runtime-executable-version-mismatch",
  LOCK_INVALID: "runtime-lock-invalid",
  SKILL_UNKNOWN: "runtime-skill-unknown",
  URL_REJECTED: "runtime-url-rejected",
  INVALID_CONTROL: "runtime-control-invalid",
}

const runtimeResultCode = (control: RuntimeRepairControl): ResultCode =>
  runtimeResultCodes[control.code]

const runtimePreview = (
  command: "runtime:repair" | "runtime:repair-apply",
  control: RuntimeRepairControl,
): MaintenanceOutcome<CommandPreview> | MaintenanceOutcome<never> => {
  const resultCode = runtimeResultCode(control)
  if (resultCode !== "runtime-repair-preview" && resultCode !== "runtime-repair-unneeded") {
    return errorFor(command, resultCode)
  }
  return preview(command, [], { schemaVersion: resultSchemaVersion, kind: resultCode })
}

const applyRuntime = async (
  request: Extract<MaintenanceApplyRequest, { command: "runtime:repair-apply" }>,
  collaborators: MaintenanceCommandCollaborators,
): Promise<MaintenanceOutcome<CommandResult>> => {
  const control = await collaborators.runtime.invoke(["repair"])
  const resultCode = runtimeResultCode(control)
  if (resultCode === "runtime-repair-preview") {
    if (control.state?.before !== "missing" && control.state?.before !== "corrupt") {
      return errorFor(request.command, "runtime-control-invalid")
    }
    await collaborators.runtime.invoke(["repair", "--apply"])
    const completed = completedResult(request, ["effect:runtime-repair"], [], "repaired")
    if (completed.status !== "ok") return completed
    return {
      ...completed,
      resultCode: "runtime-repair-applied",
      stationId: stationFor(request.command, "runtime-repair-applied"),
    }
  }
  if (resultCode === "runtime-repair-unneeded") {
    const completed = completedResult(request, [], [], "repair-unneeded")
    if (completed.status !== "ok") return completed
    return {
      ...completed,
      resultCode,
      stationId: stationFor(request.command, resultCode),
    }
  }
  return errorFor(request.command, resultCode)
}

const applyRelease = async (
  request: Extract<MaintenanceApplyRequest, { command: "release:apply" }>,
  collaborators: MaintenanceCommandCollaborators,
): Promise<MaintenanceOutcome<CommandResult>> => {
  const ownerResult = await collaborators.release.apply(request.request, request.approval)
  return completedResult(
    request,
    ownerResult.completedEffectIds,
    ownerResult.remainingEffectIds,
    "Release",
    { schemaVersion: resultSchemaVersion, kind: "released" },
  )
}

const applyClaude = async (
  request: Extract<MaintenanceApplyRequest, { command: "harness:claude:apply" }>,
  collaborators: MaintenanceCommandCollaborators,
): Promise<MaintenanceOutcome<CommandResult>> => {
  const ownerResult = await collaborators.harness.apply(request.request, request.approval)
  return completedResult(
    request,
    ownerResult.completedEffectIds,
    ownerResult.remainingEffectIds,
    "Claude Harness",
    { schemaVersion: resultSchemaVersion, kind: "claude-transitioned" },
  )
}

const applyCodex = async (
  request: Extract<MaintenanceApplyRequest, { command: "harness:codex:apply" }>,
  collaborators: MaintenanceCommandCollaborators,
): Promise<MaintenanceOutcome<CommandResult>> => {
  const ownerResult = await collaborators.harness.apply(request.request, request.approval)
  return completedResult(
    request,
    ownerResult.completedEffectIds,
    ownerResult.remainingEffectIds,
    "Codex Harness",
    { schemaVersion: resultSchemaVersion, kind: "codex-transitioned" },
  )
}

const applyCanary = async (
  request: Extract<MaintenanceApplyRequest, { command: "canary:qualify" }>,
  collaborators: MaintenanceCommandCollaborators,
): Promise<MaintenanceOutcome<CommandResult>> => {
  const ownerResult = await collaborators.canary.qualify(request.candidate, request.authority)
  return completedResult(
    request,
    ["effect:canary-qualified"],
    [],
    "Canary Qualification",
    { schemaVersion: resultSchemaVersion, kind: "qualified", hostedRunId: ownerResult.hostedRunId },
  )
}

type InspectionHandler = (
  command: MaintenanceCommand,
) => Promise<MaintenanceOutcome<CommandPreview>>

type ApplyHandler = (
  request: MaintenanceApplyRequest,
) => Promise<MaintenanceOutcome<CommandResult>>

const isCommand = <C extends MaintenanceCommand["command"]>(
  command: MaintenanceCommand,
  expected: C,
): command is Extract<MaintenanceCommand, { command: C }> => command.command === expected

const inspectionHandlerFor = <C extends MaintenanceCommand["command"]>(
  expected: C,
  handler: (
    command: Extract<MaintenanceCommand, { command: C }>,
  ) => Promise<MaintenanceOutcome<CommandPreview>>,
): InspectionHandler => async (command) => {
  if (!isCommand(command, expected)) throw new Error(`unexpected inspection command ${command.command}`)
  return handler(command)
}

const isApplyRequest = <C extends MaintenanceApplyRequest["command"]>(
  request: MaintenanceApplyRequest,
  expected: C,
): request is Extract<MaintenanceApplyRequest, { command: C }> => request.command === expected

const applyHandlerFor = <C extends MaintenanceApplyRequest["command"]>(
  expected: C,
  handler: (
    request: Extract<MaintenanceApplyRequest, { command: C }>,
  ) => Promise<MaintenanceOutcome<CommandResult>>,
): ApplyHandler => async (request) => {
  if (!isApplyRequest(request, expected)) throw new Error(`unexpected apply command ${request.command}`)
  return handler(request)
}

export const createMaintenanceCommands = (
  collaborators: MaintenanceCommandCollaborators,
): MaintenanceCommands => {
  const inspected = new Set<string>()

  const inspectHandlers = {
    help: inspectionHandlerFor("help", async () => helpPreview()),
    "payload:check": inspectionHandlerFor("payload:check", (command) => inspectPayload(command, collaborators)),
    "payload:materialize": inspectionHandlerFor("payload:materialize", async (command) => preview(command.command)),
    "payload:package": inspectionHandlerFor("payload:package", async (command) => preview(command.command)),
    "runtime:repair": inspectionHandlerFor("runtime:repair", async (command) => {
      const control = await collaborators.runtime.invoke(["repair"])
      return runtimePreview(command.command, control)
    }),
    "runtime:repair-apply": inspectionHandlerFor("runtime:repair-apply", async (command) => preview(command.command)),
    "release:inspect": inspectionHandlerFor("release:inspect", (command) => inspectRelease(command, collaborators)),
    "release:apply": inspectionHandlerFor("release:apply", async (command) => {
      const result = await inspectRelease(command, collaborators)
      inspected.add(resultKey(command))
      return result
    }),
    "harness:claude:inspect": inspectionHandlerFor("harness:claude:inspect", (command) => inspectClaude(command, collaborators)),
    "harness:claude:apply": inspectionHandlerFor("harness:claude:apply", async (command) => {
      const result = await inspectClaude(command, collaborators)
      inspected.add(resultKey(command))
      return result
    }),
    "harness:codex:inspect": inspectionHandlerFor("harness:codex:inspect", (command) => inspectCodex(command, collaborators)),
    "harness:codex:apply": inspectionHandlerFor("harness:codex:apply", async (command) => {
      const result = await inspectCodex(command, collaborators)
      inspected.add(resultKey(command))
      return result
    }),
    "canary:inspect": inspectionHandlerFor("canary:inspect", (command) => inspectCanary(command, collaborators)),
    "canary:qualify": inspectionHandlerFor("canary:qualify", async (command) => {
      const result = await inspectCanary(command, collaborators)
      inspected.add(resultKey(command))
      return result
    }),
  } satisfies Record<MaintenanceCommand["command"], InspectionHandler>

  const inspect = async (command: MaintenanceCommand): Promise<MaintenanceOutcome<CommandPreview>> =>
    inspectHandlers[command.command](command)

  const applyHandlers = {
    "payload:materialize": applyHandlerFor("payload:materialize", (request) => applyPayload(request, collaborators)),
    "payload:package": applyHandlerFor("payload:package", (request) => applyPayload(request, collaborators)),
    "runtime:repair-apply": applyHandlerFor("runtime:repair-apply", (request) => applyRuntime(request, collaborators)),
    "release:apply": applyHandlerFor("release:apply", (request) => applyRelease(request, collaborators)),
    "harness:claude:apply": applyHandlerFor("harness:claude:apply", (request) => applyClaude(request, collaborators)),
    "harness:codex:apply": applyHandlerFor("harness:codex:apply", (request) => applyCodex(request, collaborators)),
    "canary:qualify": applyHandlerFor("canary:qualify", (request) => applyCanary(request, collaborators)),
  } satisfies Record<MaintenanceApplyRequest["command"], ApplyHandler>

  const apply = async (request: MaintenanceApplyRequest): Promise<MaintenanceOutcome<CommandResult>> => {
    if (isFreshPreviewRequired(request.command) && !inspected.has(resultKey(request))) {
      return errorFor(request.command, "recovery-required")
    }
    return applyHandlers[request.command](request)
  }

  return { inspect, apply }
}
