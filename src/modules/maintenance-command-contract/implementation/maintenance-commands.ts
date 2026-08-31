import type {
  AgentPayload,
  CommandPreview,
  CommandResult,
  EffectClass,
  JsonValue,
  MaintenanceApplyRequest,
  MaintenanceCommand,
  MaintenanceCommands,
  MaintenanceError,
  MaintenanceOutcome,
  ResultCode,
  RetrySafety,
  StationId,
  TransactionState,
} from "../interface"
import type { CanaryQualification } from "../../canary-qualification/interface"
import type { HarnessJourneys } from "../../harness-journeys/interface"
import type { PluginPayloadProduction } from "../../plugin-payload-production/interface"
import type { ReleaseAndGitEngine } from "../../release-and-git-engine/interface"
import type {
  RuntimeCustodyCommand,
  RuntimeCustodyResult,
} from "../../runtime-custody/interface"
import { commandVocabulary } from "../command-vocabulary"
import {
  validateMaintenanceErrorEgress,
  validateMaintenancePreviewEgress,
  validateMaintenanceResultEgress,
} from "../serialized-values"
import {
  containmentExit,
  exitFamilies,
  failureClassPolicy,
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

export type RuntimeRepairCommand = Extract<
  RuntimeCustodyCommand,
  readonly ["repair"] | readonly ["repair", "--apply"]
>

type RuntimeControlResult = Extract<RuntimeCustodyResult, { kind: "control" }>
type RuntimeControl = RuntimeControlResult["control"]

export type MaintenanceCommandDependencies = {
  payload: PluginPayloadProduction
  runtime: (command: RuntimeRepairCommand) => Promise<RuntimeCustodyResult>
  release: ReleaseAndGitEngine
  harness: HarnessJourneys
  canary: CanaryQualification
}

type PayloadRequest = Parameters<PluginPayloadProduction["produce"]>[0]
type PayloadResult = Awaited<ReturnType<PluginPayloadProduction["produce"]>>
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

const preservedAgent = (kind: string, result: JsonValue): AgentPayload => ({
  schemaVersion: resultSchemaVersion,
  kind,
  result,
})

const helpAgent = () => ({
  schemaVersion: resultSchemaVersion,
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
  return validateMaintenancePreviewEgress({
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
  })
}

const preview = (
  command: MaintenanceCommand["command"],
  expectedEffectIds: readonly string[] = [],
  agent: AgentPayload = { schemaVersion: resultSchemaVersion, kind: "previewed" },
): MaintenanceOutcome<CommandPreview> => {
  const descriptor = commandIdFor(command)
  return validateMaintenancePreviewEgress({
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
  })
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
  agent: AgentPayload = { schemaVersion: resultSchemaVersion, kind },
): MaintenanceOutcome<CommandResult> => {
  const descriptor = commandIdFor(request.command)
  const transactionState: TransactionState = remainingEffectIds.length === 0
    ? "completed"
    : "partially-completed"
  return validateMaintenanceResultEgress({
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
  })
}

const errorFor = (
  command: MaintenanceCommand["command"] | "maintenance",
  resultCode: ResultCode,
): MaintenanceOutcome<never> => {
  const descriptor = resultFor(resultCode)
  if (descriptor.failureClass === null || descriptor.exitClass === 0) {
    throw new Error(`success Result Code cannot build a Maintenance Error: ${resultCode}`)
  }
  const policy = failureClassPolicy[descriptor.failureClass]
  return validateMaintenanceErrorEgress({
    status: "error",
    resultCode,
    stationId: stationFor(command, resultCode),
    error: {
      name: "MaintenanceCommandError",
      exitCodeHint: descriptor.exitClass,
      failureClass: descriptor.failureClass,
      errorFamily: policy.errorFamily,
      severity: descriptor.severity === "info" ? "error" : descriptor.severity,
      action: descriptor.nextAction.action,
      retryable: descriptor.retrySafety === "safe" && descriptor.exitFamilyId === "transient-retry",
      recoverability: policy.recoverability,
      retrySafety: descriptor.retrySafety,
      transactionState: descriptor.transactionState,
      nextAction: descriptor.nextAction,
    },
  })
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

const applyPayload = async (
  request: Extract<MaintenanceApplyRequest, { command: "payload:materialize" | "payload:package" }>,
  collaborators: MaintenanceCommandDependencies,
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
    preservedAgent(kind, ownerResult),
  )
}

const inspectPayload = async (
  command: Extract<MaintenanceCommand, { command: "payload:check" }>,
  collaborators: MaintenanceCommandDependencies,
): Promise<MaintenanceOutcome<CommandPreview>> => {
  const ownerResult = await collaborators.payload.produce(command.request)
  if (ownerResult.kind === "refused") return errorFor(command.command, "command-refused")
  return preview(command.command, [], preservedAgent(ownerResult.kind, ownerResult))
}

const inspectRelease = async (
  command: ReleaseInspectionCommand,
  collaborators: MaintenanceCommandDependencies,
): Promise<MaintenanceOutcome<CommandPreview>> => {
  const plan = await collaborators.release.inspect(command.request)
  return preview(command.command, plan.expectedEffectIds, preservedAgent("release-plan", plan))
}

const inspectClaude = async (
  command: ClaudeInspectionCommand,
  collaborators: MaintenanceCommandDependencies,
): Promise<MaintenanceOutcome<CommandPreview>> => {
  const plan = await collaborators.harness.inspect(command.request)
  return preview(command.command, plan.expectedEffectIds, preservedAgent("claude-inspection", plan))
}

const inspectCodex = async (
  command: CodexInspectionCommand,
  collaborators: MaintenanceCommandDependencies,
): Promise<MaintenanceOutcome<CommandPreview>> => {
  const plan = await collaborators.harness.inspect(command.request)
  return preview(command.command, plan.expectedEffectIds, preservedAgent("codex-inspection", plan))
}

const inspectCanary = async (
  command: CanaryInspectionCommand,
  collaborators: MaintenanceCommandDependencies,
): Promise<MaintenanceOutcome<CommandPreview>> => {
  const plan = await collaborators.canary.inspect(command.candidate)
  return preview(command.command, [], preservedAgent("canary-plan", plan))
}

const runtimeResultCodes: Record<RuntimeControl["code"], ResultCode> = {
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
}

const runtimeResultCode = (result: RuntimeCustodyResult): ResultCode =>
  result.kind === "control"
    ? runtimeResultCodes[result.control.code]
    : "runtime-control-invalid"

const runtimePreview = (
  command: "runtime:repair" | "runtime:repair-apply",
  result: RuntimeCustodyResult,
): MaintenanceOutcome<CommandPreview> | MaintenanceOutcome<never> => {
  if (result.kind !== "control") return errorFor(command, "runtime-control-invalid")
  const resultCode = runtimeResultCode(result)
  if (resultCode !== "runtime-repair-preview" && resultCode !== "runtime-repair-unneeded") {
    return errorFor(command, resultCode)
  }
  return preview(command, [], preservedAgent(resultCode, result))
}

const isRepairableInspection = (result: RuntimeControlResult): boolean =>
  result.control.state?.before === "missing" || result.control.state?.before === "corrupt"

const isAppliedRuntime = (result: RuntimeCustodyResult): result is RuntimeControlResult =>
  result.kind === "control" &&
  result.control.ok &&
  result.exitClass === 0 &&
  result.control.sideEffects.length === 1 &&
  result.control.sideEffects[0] === "published-runtime"

const runtimeCompletedResult = (
  request: Extract<MaintenanceApplyRequest, { command: "runtime:repair-apply" }>,
  resultCode: "runtime-repair-applied" | "runtime-repair-unneeded",
  result: RuntimeControlResult,
): MaintenanceOutcome<CommandResult> => {
  const applied = resultCode === "runtime-repair-applied"
  const completed = completedResult(
    request,
    applied ? ["effect:runtime-repair"] : [],
    [],
    applied ? "repaired" : "repair-unneeded",
    preservedAgent(resultCode, result),
  )
  if (completed.status !== "ok") return completed
  return validateMaintenanceResultEgress({
    ...completed,
    resultCode,
    stationId: stationFor(request.command, resultCode),
  })
}

const applyRuntime = async (
  request: Extract<MaintenanceApplyRequest, { command: "runtime:repair-apply" }>,
  collaborators: MaintenanceCommandDependencies,
): Promise<MaintenanceOutcome<CommandResult>> => {
  const inspection = await collaborators.runtime(["repair"])
  if (inspection.kind !== "control") {
    return errorFor(request.command, "runtime-control-invalid")
  }
  const resultCode = runtimeResultCode(inspection)
  if (resultCode === "runtime-repair-preview") {
    if (!isRepairableInspection(inspection)) return errorFor(request.command, "runtime-control-invalid")
    const applied = await collaborators.runtime(["repair", "--apply"])
    const appliedResultCode = runtimeResultCode(applied)
    if (appliedResultCode !== "runtime-repair-applied") return errorFor(request.command, appliedResultCode)
    if (!isAppliedRuntime(applied)) return errorFor(request.command, "runtime-control-invalid")
    return runtimeCompletedResult(request, "runtime-repair-applied", applied)
  }
  if (resultCode === "runtime-repair-unneeded") {
    return runtimeCompletedResult(request, resultCode, inspection)
  }
  return errorFor(request.command, resultCode)
}

const applyRelease = async (
  request: Extract<MaintenanceApplyRequest, { command: "release:apply" }>,
  collaborators: MaintenanceCommandDependencies,
): Promise<MaintenanceOutcome<CommandResult>> => {
  const ownerResult = await collaborators.release.apply(request.request, request.approval)
  return completedResult(
    request,
    ownerResult.completedEffectIds,
    ownerResult.remainingEffectIds,
    "Release",
    preservedAgent("released", ownerResult),
  )
}

const applyClaude = async (
  request: Extract<MaintenanceApplyRequest, { command: "harness:claude:apply" }>,
  collaborators: MaintenanceCommandDependencies,
): Promise<MaintenanceOutcome<CommandResult>> => {
  const ownerResult = await collaborators.harness.apply(request.request, request.approval)
  return completedResult(
    request,
    ownerResult.completedEffectIds,
    ownerResult.remainingEffectIds,
    "Claude Harness",
    preservedAgent("claude-transitioned", ownerResult),
  )
}

const applyCodex = async (
  request: Extract<MaintenanceApplyRequest, { command: "harness:codex:apply" }>,
  collaborators: MaintenanceCommandDependencies,
): Promise<MaintenanceOutcome<CommandResult>> => {
  const ownerResult = await collaborators.harness.apply(request.request, request.approval)
  return completedResult(
    request,
    ownerResult.completedEffectIds,
    ownerResult.remainingEffectIds,
    "Codex Harness",
    preservedAgent("codex-transitioned", ownerResult),
  )
}

const applyCanary = async (
  request: Extract<MaintenanceApplyRequest, { command: "canary:qualify" }>,
  collaborators: MaintenanceCommandDependencies,
): Promise<MaintenanceOutcome<CommandResult>> => {
  const ownerResult = await collaborators.canary.qualify(request.candidate, request.authority)
  return completedResult(
    request,
    ["effect:canary-qualified"],
    [],
    "Canary Qualification",
    preservedAgent("qualified", ownerResult),
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
  collaborators: MaintenanceCommandDependencies,
): MaintenanceCommands => {
  const inspected = new Set<string>()

  const inspectHandlers = {
    help: inspectionHandlerFor("help", async () => helpPreview()),
    "payload:check": inspectionHandlerFor("payload:check", (command) => inspectPayload(command, collaborators)),
    "payload:materialize": inspectionHandlerFor("payload:materialize", async (command) => preview(command.command)),
    "payload:package": inspectionHandlerFor("payload:package", async (command) => preview(command.command)),
    "runtime:repair": inspectionHandlerFor("runtime:repair", async (command) => {
      const result = await collaborators.runtime(["repair"])
      return runtimePreview(command.command, result)
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
    if (isFreshPreviewRequired(request.command) && !inspected.delete(resultKey(request))) {
      return errorFor(request.command, "recovery-required")
    }
    return applyHandlers[request.command](request)
  }

  return { inspect, apply }
}
