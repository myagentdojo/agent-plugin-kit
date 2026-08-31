import type {
  AgentPayload,
  CommandPreview,
  CommandResult,
  JsonValue,
  MaintenanceApplyRequest,
  MaintenanceCommand,
  MaintenanceCommands,
  MaintenanceError,
  MaintenanceOutcome,
  ResultCode,
  StationId,
} from "../interface"
import type {
  CanaryPlan,
  CanaryQualification,
  CanaryResult,
} from "../../canary-qualification/interface"
import type {
  ClaudeApplyResult,
  ClaudeInspection,
  CodexApplyResult,
  CodexInspection,
  HarnessJourneys,
} from "../../harness-journeys/interface"
import type {
  PayloadProductionResult,
  PluginPayloadProduction,
} from "../../plugin-payload-production/interface"
import type {
  CandidateIdentity,
  ReleaseAndGitEngine,
  ReleasePlan,
  ReleaseResult,
} from "../../release-and-git-engine/interface"
import type {
  RuntimeCustodyCommand,
  RuntimeCustodyResult,
} from "../../runtime-custody/interface"
import { stationSlugFor } from "../branch-stations"
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
  retrySafetyForEffectClass,
  retrySafetyVocabulary,
  transactionStateVocabulary,
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

type StripProtectedAuthority<T> = T extends unknown ? Omit<T, "approval" | "authority"> : never
// fallow-ignore-next-line private-type-leak -- the public inspection input intentionally hides its private distributive helper
export type MaintenanceInspectionInput = StripProtectedAuthority<MaintenanceCommand>

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
type PayloadResult = PayloadProductionResult
type ReleaseInspectionCommand = Extract<
  MaintenanceInspectionInput,
  { command: "release:inspect" | "release:apply" }
>
type ClaudeInspectionCommand = Extract<
  MaintenanceInspectionInput,
  { command: "harness:claude:inspect" | "harness:claude:apply" }
>
type CodexInspectionCommand = Extract<
  MaintenanceInspectionInput,
  { command: "harness:codex:inspect" | "harness:codex:apply" }
>
type CanaryInspectionCommand = Extract<
  MaintenanceInspectionInput,
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

const inspectionInputFor = (command: MaintenanceCommand): MaintenanceInspectionInput => {
  const protectedInput = commandIdFor(command.command).protectedInput
  if (protectedInput === null) return command

  // TypeScript cannot narrow a discriminated union through this correlated computed key.
  const inspectionInput: MaintenanceCommand &
    Partial<Record<"approval" | "authority", unknown>> = { ...command }
  delete inspectionInput[protectedInput]
  return inspectionInput as MaintenanceInspectionInput
}

const resultFor = (resultCode: ResultCode) => {
  const descriptor = resultVocabulary.find((candidate) => candidate.resultCode === resultCode)
  if (!descriptor) throw new Error(`missing Result Vocabulary row ${resultCode}`)
  return descriptor
}

const stationFor = (command: MaintenanceCommand["command"] | "maintenance", resultCode: ResultCode): StationId => {
  const commandSlug = stationSlugFor(command)
  return `${commandSlug}.${resultCode}` as StationId
}

type AgentKind =
  | "previewed"
  | "checked"
  | "materialized"
  | "packaged"
  | "release-plan"
  | "claude-inspection"
  | "codex-inspection"
  | "canary-plan"
  | "released"
  | "claude-transitioned"
  | "codex-transitioned"
  | "qualified"
  | "runtime-control"

type HumanResultKind =
  | "checked"
  | "materialized"
  | "packaged"
  | "Release"
  | "Claude Harness"
  | "Codex Harness"
  | "Canary Qualification"

/**
 * These projections are the only owner-result fields allowed into agent
 * output. They deliberately copy the public meaning instead of forwarding a
 * trusted owner's object, which keeps diagnostics, capabilities, and
 * incidental fields on their owning seams.
 */
const agentPayload = (kind: AgentKind, result: JsonValue): AgentPayload => ({
  schemaVersion: resultSchemaVersion,
  kind,
  result,
})

const projectCandidateIdentity = (candidate: CandidateIdentity): JsonValue => ({
  source: {
    repository: { origin: candidate.source.repository.origin },
    commit: candidate.source.commit,
  },
  release: {
    reference: candidate.release.reference,
    commit: candidate.release.commit,
  },
  package: {
    repository: { origin: candidate.package.repository.origin },
    commit: candidate.package.commit,
  },
  workflow: {
    repository: { origin: candidate.workflow.repository.origin },
    path: candidate.workflow.path,
    commit: candidate.workflow.commit,
  },
})

const projectPayloadResult = (result: PayloadResult): JsonValue => ({
  kind: result.kind,
  ...(result.payload === undefined
    ? {}
    : {
        payload: {
          regularFiles: [...result.payload.regularFiles],
          payloadSha256: result.payload.payloadSha256,
        },
      }),
  nextAction: result.nextAction,
})

const projectReleasePlan = (plan: ReleasePlan): JsonValue => ({
  candidate: projectCandidateIdentity(plan.candidate),
  expectedEffectIds: [...plan.expectedEffectIds],
  approvalDigest: plan.approvalDigest,
})

const projectReleaseResult = (result: ReleaseResult): JsonValue => ({
  candidate: projectCandidateIdentity(result.candidate),
  completedEffectIds: [...result.completedEffectIds],
  remainingEffectIds: [...result.remainingEffectIds],
})

const projectClaudeInspection = (inspection: ClaudeInspection): JsonValue => ({
  candidate: projectCandidateIdentity(inspection.candidate),
  profileIdentity: inspection.profileIdentity,
  expectedEffectIds: [...inspection.expectedEffectIds],
})

const projectCodexInspection = (inspection: CodexInspection): JsonValue => ({
  candidate: projectCandidateIdentity(inspection.candidate),
  profileIdentity: inspection.profileIdentity,
  expectedEffectIds: [...inspection.expectedEffectIds],
  checkoutIdentity: inspection.checkoutIdentity,
})

const isCodexInspection = (inspection: ClaudeInspection): inspection is CodexInspection =>
  "checkoutIdentity" in inspection

const projectClaudeResult = (result: ClaudeApplyResult): JsonValue => ({
  completedEffectIds: [...result.completedEffectIds],
  remainingEffectIds: [...result.remainingEffectIds],
})

const projectCodexResult = (result: CodexApplyResult): JsonValue => ({
  completedEffectIds: [...result.completedEffectIds],
  remainingEffectIds: [...result.remainingEffectIds],
  freshTaskCommand: [...result.freshTaskCommand],
})

const projectCanaryPlan = (plan: CanaryPlan): JsonValue => ({
  candidate: projectCandidateIdentity(plan.candidate),
  target: plan.target,
  immutableReference: plan.immutableReference,
})

const projectCanaryResult = (result: CanaryResult): JsonValue => ({
  candidate: projectCandidateIdentity(result.candidate),
  hostedRunId: result.hostedRunId,
  installedPayloadSha256: result.installedPayloadSha256,
})

const projectRuntimeResult = (result: RuntimeCustodyResult): JsonValue => {
  if (result.kind === "skill-process") {
    return { kind: result.kind, exitCode: result.exitCode }
  }

  const { control } = result
  return {
    kind: result.kind,
    control: {
      schemaVersion: control.schemaVersion,
      ok: control.ok,
      code: control.code,
      sideEffects: [...control.sideEffects],
      retrySafe: control.retrySafe,
      nextAction: control.nextAction,
      ...(control.runtime === undefined
        ? {}
        : {
            runtime: {
              version: control.runtime.version,
              executableSha256: control.runtime.executableSha256,
            },
          }),
      ...(control.state === undefined ? {} : { state: { before: control.state.before } }),
    },
    exitClass: result.exitClass,
  }
}

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
    retry_safety: [...retrySafetyVocabulary],
    transaction_state: [...transactionStateVocabulary],
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
      retrySafety: retrySafetyForEffectClass(descriptor.effectClass),
      nextAction: descriptor.nextAction,
      human: "",
      agent,
      stderr: "",
    },
  })
}

const resultHuman = (command: MaintenanceApplyRequest["command"], kind: HumanResultKind): string => {
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
  kind: HumanResultKind,
  agent: AgentPayload,
): MaintenanceOutcome<CommandResult> => {
  const [firstRemainingEffect, ...otherRemainingEffects] = remainingEffectIds
  if (firstRemainingEffect !== undefined) {
    return continuationRequired(
      request,
      completedEffectIds,
      [firstRemainingEffect, ...otherRemainingEffects],
    )
  }
  const descriptor = commandIdFor(request.command)
  return validateMaintenanceResultEgress({
    status: "ok",
    resultCode: "completed",
    stationId: stationFor(request.command, "completed"),
    value: {
      schemaVersion: resultSchemaVersion,
      command: request.command,
      transactionState: "completed",
      retrySafety: retrySafetyForEffectClass(descriptor.effectClass),
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
  if (descriptor.failureClass === null || descriptor.exitClass === 0 || descriptor.failureClass === "continuation") {
    throw new Error(`Result Code requires a dedicated outcome constructor: ${resultCode}`)
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

const continuationRequired = (
  request: MaintenanceApplyRequest,
  completedEffectIds: readonly string[],
  remainingEffectIds: readonly [string, ...string[]],
): MaintenanceOutcome<never> => {
  const descriptor = resultFor("continuation-required")
  return validateMaintenanceErrorEgress({
    status: "error",
    resultCode: descriptor.resultCode,
    stationId: stationFor(request.command, descriptor.resultCode),
    error: {
      name: "MaintenanceCommandError",
      exitCodeHint: 20,
      failureClass: "continuation",
      errorFamily: "state_conflict",
      severity: "error",
      action: "inspect_state",
      retryable: false,
      recoverability: "repair_state",
      retrySafety: "unsafe",
      transactionState: "partially-completed",
      nextAction: descriptor.nextAction,
      completedEffectIds: [...completedEffectIds],
      remainingEffectIds: [...remainingEffectIds],
    },
  })
}

const compareBindingKeys = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

/** `-0` and `0` are different scalars, and a non-finite number keeps its name. */
const canonicalNumberKey = (value: number): string =>
  Object.is(value, -0) ? "number:-0" : `number:${String(value)}`

const canonicalRecordKey = (value: object): string => {
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => compareBindingKeys(left, right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalBindingKey(entryValue)}`)
  return `{${entries.join(",")}}`
}

/**
 * One deterministic key for a Candidate Identity binding. Object keys are sorted
 * so two semantically equal requests bind to the same key whatever order their
 * properties were written in. Array order and exact scalar values are preserved
 * because both carry binding meaning: a reordered effect list and a changed
 * number are different requests, a reordered object is the same request.
 */
const canonicalBindingKey = (value: unknown): string => {
  if (value === null) return "null"
  if (typeof value === "number") return canonicalNumberKey(value)
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value !== "object") return `${typeof value}:${String(value)}`
  return Array.isArray(value)
    ? `[${value.map(canonicalBindingKey).join(",")}]`
    : canonicalRecordKey(value)
}

const freshInspectionKey = (
  command: MaintenanceInspectionInput | MaintenanceApplyRequest,
): string | null => {
  switch (command.command) {
    case "release:inspect":
    case "release:apply":
      return canonicalBindingKey({
        owner: "release-and-git-engine",
        request: { candidate: command.request.candidate, intent: command.request.intent },
      })
    case "harness:claude:inspect":
    case "harness:claude:apply":
      return canonicalBindingKey({
        owner: "harness-journeys:claude",
        request: {
          identity: command.request.identity,
          payload: command.request.payload,
          profileIdentity: command.request.profileIdentity,
        },
      })
    case "harness:codex:inspect":
    case "harness:codex:apply":
      return canonicalBindingKey({
        owner: "harness-journeys:codex",
        request: {
          identity: command.request.identity,
          payload: command.request.payload,
          profileIdentity: command.request.profileIdentity,
          checkoutIdentity: command.request.checkoutIdentity,
        },
      })
    case "canary:inspect":
    case "canary:qualify":
      return canonicalBindingKey({ owner: "canary-qualification", candidate: command.candidate })
    default:
      return null
  }
}

const expectedEffectIdsFor = (request: MaintenanceApplyRequest): readonly string[] => {
  switch (request.command) {
    case "release:apply":
      return request.request.expectedEffectIds
    case "harness:claude:apply":
      return request.request.expectedEffectIds
    case "harness:codex:apply":
      return request.request.expectedEffectIds
    case "canary:qualify":
    case "payload:materialize":
    case "payload:package":
    case "runtime:repair-apply":
      return []
  }
}

const effectIdsMatch = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((effectId, index) => effectId === right[index])

const payloadKind = (
  request: PayloadRequest,
  result: Exclude<PayloadResult, { kind: "refused" }>,
): Extract<AgentKind, "checked" | "materialized" | "packaged"> => {
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
  if (ownerResult.kind === "refused") return errorFor(request.command, "command-refused")
  const kind = payloadKind(request.request, ownerResult)
  const effectId = payloadEffect(request.request)
  return completedResult(
    request,
    effectId === null ? [] : [effectId],
    [],
    kind,
    agentPayload(kind, projectPayloadResult(ownerResult)),
  )
}

const inspectPayload = async (
  command: Extract<MaintenanceCommand, { command: "payload:check" }>,
  collaborators: MaintenanceCommandDependencies,
): Promise<MaintenanceOutcome<CommandPreview>> => {
  const ownerResult = await collaborators.payload.produce(command.request)
  if (ownerResult.kind === "refused") return errorFor(command.command, "command-refused")
  return preview(command.command, [], agentPayload(ownerResult.kind, projectPayloadResult(ownerResult)))
}

const inspectRelease = async (
  command: ReleaseInspectionCommand,
  collaborators: MaintenanceCommandDependencies,
): Promise<MaintenanceOutcome<CommandPreview>> => {
  const plan = await collaborators.release.inspect(command.request)
  return preview(command.command, plan.expectedEffectIds, agentPayload("release-plan", projectReleasePlan(plan)))
}

const inspectClaude = async (
  command: ClaudeInspectionCommand,
  collaborators: MaintenanceCommandDependencies,
): Promise<MaintenanceOutcome<CommandPreview>> => {
  const plan = await collaborators.harness.inspect(command.request)
  return preview(command.command, plan.expectedEffectIds, agentPayload("claude-inspection", projectClaudeInspection(plan)))
}

const inspectCodex = async (
  command: CodexInspectionCommand,
  collaborators: MaintenanceCommandDependencies,
): Promise<MaintenanceOutcome<CommandPreview>> => {
  const plan = await collaborators.harness.inspect(command.request)
  if (!isCodexInspection(plan)) throw new Error("Harness Journeys returned a Claude inspection for Codex")
  return preview(command.command, plan.expectedEffectIds, agentPayload("codex-inspection", projectCodexInspection(plan)))
}

const inspectCanary = async (
  command: CanaryInspectionCommand,
  collaborators: MaintenanceCommandDependencies,
): Promise<MaintenanceOutcome<CommandPreview>> => {
  const plan = await collaborators.canary.inspect(command.candidate)
  return preview(command.command, [], agentPayload("canary-plan", projectCanaryPlan(plan)))
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

type RuntimeCallPosition = "inspection" | "apply"

const runtimeOutcomeCode = (
  position: RuntimeCallPosition,
  result: RuntimeCustodyResult,
): ResultCode => {
  if (result.kind !== "control") return "runtime-control-invalid"

  const mapped = runtimeResultCodes[result.control.code]
  const resultDescriptor = resultFor(mapped)
  const expectedOk = resultDescriptor.exitClass === 0
  const isPublishedRuntimeOnly =
    result.control.sideEffects.length === 1 && result.control.sideEffects[0] === "published-runtime"
  const mappedApplied = mapped === "runtime-repair-applied"
  const invalidPosition = position === "inspection"
    ? mappedApplied
    : mapped === "runtime-repair-preview" || mapped === "runtime-repair-unneeded"

  const invalidOutcomeChecks = [
    resultDescriptor.exitClass !== result.exitClass ||
    result.control.ok !== expectedOk,
    isPublishedRuntimeOnly !== mappedApplied,
    invalidPosition,
  ].some(Boolean)

  if (invalidOutcomeChecks) {
    return "runtime-control-invalid"
  }
  return mapped
}

const runtimePreview = (
  command: "runtime:repair" | "runtime:repair-apply",
  result: RuntimeCustodyResult,
): MaintenanceOutcome<CommandPreview> | MaintenanceOutcome<never> => {
  const resultCode = runtimeOutcomeCode("inspection", result)
  if (resultCode !== "runtime-repair-preview" && resultCode !== "runtime-repair-unneeded") {
    return errorFor(command, resultCode)
  }
  const commandDescriptor = commandIdFor(command)
  const resultDescriptor = resultFor(resultCode)
  return validateMaintenancePreviewEgress({
    status: "ok",
    resultCode,
    stationId: stationFor(command, resultCode),
    value: {
      schemaVersion: resultSchemaVersion,
      command,
      effectClass: commandDescriptor.effectClass,
      expectedEffectIds: [],
      transactionState: resultDescriptor.transactionState,
      retrySafety: retrySafetyForEffectClass(commandDescriptor.effectClass),
      nextAction: resultDescriptor.nextAction,
      human: resultCode === "runtime-repair-preview"
        ? "Runtime Custody repair preview ready.\n"
        : "Runtime Custody repair is not required.\n",
      agent: agentPayload("runtime-control", projectRuntimeResult(result)),
      stderr: "",
    },
  })
}

const isRepairableInspection = (result: RuntimeControlResult): boolean =>
  result.control.state?.before === "missing" || result.control.state?.before === "corrupt"

const runtimeCompletedResult = (
  request: Extract<MaintenanceApplyRequest, { command: "runtime:repair-apply" }>,
  resultCode: "runtime-repair-applied" | "runtime-repair-unneeded",
  result: RuntimeControlResult,
): MaintenanceOutcome<CommandResult> => {
  const applied = resultCode === "runtime-repair-applied"
  const commandDescriptor = commandIdFor(request.command)
  const resultDescriptor = resultFor(resultCode)
  return validateMaintenanceResultEgress({
    status: "ok",
    resultCode,
    stationId: stationFor(request.command, resultCode),
    value: {
      schemaVersion: resultSchemaVersion,
      command: request.command,
      transactionState: resultDescriptor.transactionState,
      retrySafety: retrySafetyForEffectClass(commandDescriptor.effectClass),
      completedEffectIds: applied ? ["effect:runtime-repair"] : [],
      remainingEffectIds: [],
      nextAction: resultDescriptor.nextAction,
      human: applied ? "Runtime Custody repaired.\n" : "Runtime Custody repair is not required.\n",
      agent: agentPayload("runtime-control", projectRuntimeResult(result)),
      stderr: "",
    },
  })
}

const applyRuntime = async (
  request: Extract<MaintenanceApplyRequest, { command: "runtime:repair-apply" }>,
  collaborators: MaintenanceCommandDependencies,
): Promise<MaintenanceOutcome<CommandResult>> => {
  const inspection = await collaborators.runtime(["repair"])
  const resultCode = runtimeOutcomeCode("inspection", inspection)
  if (resultCode === "runtime-repair-preview") {
    if (inspection.kind !== "control" || !isRepairableInspection(inspection)) {
      return errorFor(request.command, "runtime-control-invalid")
    }
    const applied = await collaborators.runtime(["repair", "--apply"])
    const appliedResultCode = runtimeOutcomeCode("apply", applied)
    if (appliedResultCode !== "runtime-repair-applied") {
      return errorFor(request.command, appliedResultCode)
    }
    if (applied.kind !== "control") return errorFor(request.command, "runtime-control-invalid")
    return runtimeCompletedResult(request, "runtime-repair-applied", applied)
  }
  if (resultCode === "runtime-repair-unneeded") {
    if (inspection.kind !== "control") return errorFor(request.command, "runtime-control-invalid")
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
    agentPayload("released", projectReleaseResult(ownerResult)),
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
    agentPayload("claude-transitioned", projectClaudeResult(ownerResult)),
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
    agentPayload("codex-transitioned", projectCodexResult(ownerResult)),
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
    agentPayload("qualified", projectCanaryResult(ownerResult)),
  )
}

type InspectionHandler = (
  command: MaintenanceInspectionInput,
) => Promise<MaintenanceOutcome<CommandPreview>>

type ApplyHandler = (
  request: MaintenanceApplyRequest,
) => Promise<MaintenanceOutcome<CommandResult>>

const isCommand = <C extends MaintenanceCommand["command"]>(
  command: MaintenanceInspectionInput,
  expected: C,
): command is Extract<MaintenanceInspectionInput, { command: C }> => command.command === expected

const inspectionHandlerFor = <C extends MaintenanceInspectionInput["command"]>(
  expected: C,
  handler: (
    command: Extract<MaintenanceInspectionInput, { command: C }>,
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

/**
 * Owner-local observation of the exact inspection input a handler receives:
 * after protected-input stripping and before delegation. It exists so the
 * colocated Contract Tests can observe the stripped object itself rather than
 * infer stripping from what a collaborator happened to be handed. It stays
 * private to this Implementation: it is absent from the public Module
 * Interface, from every package export, and from every production caller.
 */
export type MaintenanceInspectionInputObserver = (input: MaintenanceInspectionInput) => void

export const createMaintenanceCommands = (
  collaborators: MaintenanceCommandDependencies,
  observeInspectionInput?: MaintenanceInspectionInputObserver,
): MaintenanceCommands => {
  const inspected = new Map<string, readonly string[]>()

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
    "release:apply": inspectionHandlerFor("release:apply", (command) => inspectRelease(command, collaborators)),
    "harness:claude:inspect": inspectionHandlerFor("harness:claude:inspect", (command) => inspectClaude(command, collaborators)),
    "harness:claude:apply": inspectionHandlerFor("harness:claude:apply", (command) => inspectClaude(command, collaborators)),
    "harness:codex:inspect": inspectionHandlerFor("harness:codex:inspect", (command) => inspectCodex(command, collaborators)),
    "harness:codex:apply": inspectionHandlerFor("harness:codex:apply", (command) => inspectCodex(command, collaborators)),
    "canary:inspect": inspectionHandlerFor("canary:inspect", (command) => inspectCanary(command, collaborators)),
    "canary:qualify": inspectionHandlerFor("canary:qualify", (command) => inspectCanary(command, collaborators)),
  } satisfies Record<MaintenanceInspectionInput["command"], InspectionHandler>

  const inspect = async (command: MaintenanceCommand): Promise<MaintenanceOutcome<CommandPreview>> => {
    const inspectionInput = inspectionInputFor(command)
    observeInspectionInput?.(inspectionInput)
    const outcome = await inspectHandlers[command.command](inspectionInput)
    const inspectionKey = freshInspectionKey(inspectionInput)
    if (outcome.status === "ok" && inspectionKey !== null) {
      inspected.set(inspectionKey, [...outcome.value.expectedEffectIds])
    }
    return outcome
  }

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
    const inspectionKey = freshInspectionKey(request)
    if (inspectionKey !== null) {
      const inspectedEffectIds = inspected.get(inspectionKey)
      inspected.delete(inspectionKey)
      if (
        inspectedEffectIds === undefined ||
        !effectIdsMatch(inspectedEffectIds, expectedEffectIdsFor(request))
      ) {
        return errorFor(request.command, "recovery-required")
      }
    }
    return applyHandlers[request.command](request)
  }

  return { inspect, apply }
}
