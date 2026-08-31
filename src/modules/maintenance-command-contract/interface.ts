import type {
  CanaryCandidate,
  ProtectedCanaryAuthority,
} from "../canary-qualification/interface"
import type {
  ClaudeRequest,
  ClaudeTransitionApproval,
  ClaudeTransitionRequest,
  CodexRequest,
  CodexTransitionApproval,
  CodexTransitionRequest,
} from "../harness-journeys/interface"
import type { PayloadProductionRequest } from "../plugin-payload-production/interface"
import type {
  ReleaseCandidateApproval,
  ReleaseMutationRequest,
  ReleaseRequest,
} from "../release-and-git-engine/interface"

export type EffectClass = "inspect" | "repository-local" | "external"

export type TransactionState =
  | "unchanged"
  | "completed"
  | "partially-completed"
  | "unknown"

export type RetrySafety = "safe" | "unsafe" | "requires-fresh-inspection"

export type MaintenanceAction =
  | "change_input"
  | "contact_support"
  | "inspect_state"
  | "open_docs"
  | "repair_state"
  | "retry"
  | "run_command"
  | "select_command"
  | "wait"

/** All machine-observable failure meanings owned by Maintenance. */
export type FailureClass =
  | "usage"
  | "refusal"
  | "transient"
  | "continuation"
  | "recovery"
  | "unexpected"
  | "event_delivery"

/** Event delivery is observation-only and never appears on MaintenanceError. */
export type MaintenanceErrorFailureClass = Exclude<FailureClass, "event_delivery">

export type NextAction = {
  id: string
  action: MaintenanceAction
  summary: string
  commandId?: MaintenanceCommand["command"] | null
  retryAfterMs?: number
  idempotencyKey?: string
}

export type RuntimeRepairArgv = readonly ["repair"] | readonly ["repair", "--apply"]

export type RuntimeRepairControl = {
  code:
    | "REPAIR_PREVIEW"
    | "REPAIR_UNNEEDED"
    | "REPAIR_APPLIED"
    | "USAGE"
    | "BUN_MISSING"
    | "CACHE_ROOT_UNSAFE"
    | "REPAIR_REQUIRED"
    | "HOST_TOOL_MISSING"
    | "RUNTIME_NOT_EXECUTABLE"
    | "UNSUPPORTED_PLATFORM"
    | "DOWNLOAD_FAILED"
    | "LOCK_HELD"
    | "ARCHIVE_HASH_MISMATCH"
    | "ARCHIVE_MEMBER_AMBIGUOUS"
    | "ARCHIVE_MEMBER_MISSING"
    | "ARCHIVE_SIZE_MISMATCH"
    | "BUNDLE_MISMATCH"
    | "BUNDLE_UNMAPPED"
    | "EXECUTABLE_HASH_MISMATCH"
    | "EXECUTABLE_SIZE_MISMATCH"
    | "EXECUTABLE_VERSION_MISMATCH"
    | "LOCK_INVALID"
    | "SKILL_UNKNOWN"
    | "URL_REJECTED"
    | "INVALID_CONTROL"
  schemaVersion: 1
  state?: { before: "valid" | "missing" | "corrupt" }
}

export interface RuntimeRepairExecutor {
  invoke(argv: RuntimeRepairArgv): Promise<RuntimeRepairControl>
}

export type MaintenanceApplyRequest =
  | {
      command: "payload:materialize"
      request: PayloadProductionRequest & { mode: "materialize" }
    }
  | {
      command: "payload:package"
      request: PayloadProductionRequest & { mode: "package" }
    }
  | {
      command: "runtime:repair-apply"
      argv: readonly ["repair", "--apply"]
    }
  | {
      command: "release:apply"
      request: ReleaseMutationRequest
      approval: ReleaseCandidateApproval
    }
  | {
      command: "harness:claude:apply"
      request: ClaudeTransitionRequest
      approval: ClaudeTransitionApproval
    }
  | {
      command: "harness:codex:apply"
      request: CodexTransitionRequest
      approval: CodexTransitionApproval
    }
  | {
      command: "canary:qualify"
      candidate: CanaryCandidate
      authority: ProtectedCanaryAuthority
    }

export type MutatingMaintenanceCommand = MaintenanceApplyRequest["command"]

export type MaintenanceCommand =
  | { command: "help" }
  | {
      command: "payload:check"
      request: PayloadProductionRequest & { mode: "check" }
    }
  | { command: "runtime:repair"; argv: readonly ["repair"] }
  | { command: "release:inspect"; request: ReleaseRequest }
  | { command: "harness:claude:inspect"; request: ClaudeRequest }
  | { command: "harness:codex:inspect"; request: CodexRequest }
  | { command: "canary:inspect"; candidate: CanaryCandidate }
  | MaintenanceApplyRequest

export type MaintenanceCommandCollaborators = {
  payload: {
    produce(
      request: Extract<
        MaintenanceCommand,
        { command: "payload:check" | "payload:materialize" | "payload:package" }
      >["request"],
    ): Promise<{
      kind: "checked" | "materialized" | "packaged" | "refused"
      nextAction: string
    }>
  }
  runtime: RuntimeRepairExecutor
  release: {
    inspect(
      request: Extract<MaintenanceCommand, { command: "release:inspect" }>["request"],
    ): Promise<{ expectedEffectIds: readonly string[] }>
    apply(
      request: Extract<MaintenanceApplyRequest, { command: "release:apply" }>["request"],
      approval: Extract<MaintenanceApplyRequest, { command: "release:apply" }>["approval"],
    ): Promise<{
      completedEffectIds: readonly string[]
      remainingEffectIds: readonly string[]
    }>
  }
  harness: {
    inspect(
      request: Extract<MaintenanceCommand, { command: "harness:claude:inspect" }>["request"],
    ): Promise<{ expectedEffectIds: readonly string[] }>
    inspect(
      request: Extract<MaintenanceCommand, { command: "harness:codex:inspect" }>["request"],
    ): Promise<{ expectedEffectIds: readonly string[] }>
    apply(
      request: Extract<MaintenanceApplyRequest, { command: "harness:claude:apply" }>["request"],
      approval: Extract<MaintenanceApplyRequest, { command: "harness:claude:apply" }>["approval"],
    ): Promise<{
      completedEffectIds: readonly string[]
      remainingEffectIds: readonly string[]
    }>
    apply(
      request: Extract<MaintenanceApplyRequest, { command: "harness:codex:apply" }>["request"],
      approval: Extract<MaintenanceApplyRequest, { command: "harness:codex:apply" }>["approval"],
    ): Promise<{
      completedEffectIds: readonly string[]
      remainingEffectIds: readonly string[]
      freshTaskCommand: readonly string[]
    }>
  }
  canary: {
    inspect(
      candidate: Extract<MaintenanceCommand, { command: "canary:inspect" }>["candidate"],
    ): Promise<unknown>
    qualify(
      candidate: Extract<MaintenanceApplyRequest, { command: "canary:qualify" }>["candidate"],
      authority: Extract<MaintenanceApplyRequest, { command: "canary:qualify" }>["authority"],
    ): Promise<{ hostedRunId: string }>
  }
}

export type ResultCode =
  | "completed"
  | "previewed"
  | "runtime-repair-preview"
  | "runtime-repair-unneeded"
  | "runtime-repair-applied"
  | "runtime-failed"
  | "runtime-control-invalid"
  | "usage-refused"
  | "runtime-usage-refused"
  | "continuation-required"
  | "recovery-required"
  | "runtime-bun-missing"
  | "runtime-cache-root-unsafe"
  | "runtime-repair-required"
  | "command-refused"
  | "runtime-host-tool-missing"
  | "runtime-not-executable"
  | "runtime-unsupported-platform"
  | "retry-deferred"
  | "runtime-download-failed"
  | "runtime-lock-held"
  | "runtime-archive-hash-mismatch"
  | "runtime-archive-member-ambiguous"
  | "runtime-archive-member-missing"
  | "runtime-archive-size-mismatch"
  | "runtime-bundle-mismatch"
  | "runtime-bundle-unmapped"
  | "runtime-executable-hash-mismatch"
  | "runtime-executable-size-mismatch"
  | "runtime-executable-version-mismatch"
  | "runtime-lock-invalid"
  | "runtime-skill-unknown"
  | "runtime-url-rejected"

export type StationId = `${string}.${ResultCode}`

export type MaintenanceError = {
  name: "MaintenanceCommandError"
  exitCodeHint: number
  failureClass: MaintenanceErrorFailureClass
  errorFamily:
    | "input"
    | "state_conflict"
    | "authentication"
    | "authorization_scope"
    | "network"
    | "transient"
    | "runtime"
  severity: "warning" | "error" | "fatal"
  action: MaintenanceAction
  retryable: boolean
  recoverability:
    | "none"
    | "retry"
    | "change_input"
    | "authenticate"
    | "repair_state"
    | "contact_support"
  retrySafety: RetrySafety
  transactionState: TransactionState
  nextAction: NextAction
  retryAfterMs?: number
  idempotencyKey?: string
}

export type MaintenanceOutcome<T> =
  | {
      status: "ok"
      resultCode: ResultCode
      stationId: StationId
      value: T
    }
  | {
      status: "error"
      resultCode: ResultCode
      stationId: StationId
      error: MaintenanceError
    }

export type CommandPreview = {
  schemaVersion: 1
  command: MaintenanceCommand["command"]
  effectClass: EffectClass
  expectedEffectIds: readonly string[]
  transactionState: TransactionState
  retrySafety: RetrySafety
  nextAction: NextAction
  human: string
  agent: Readonly<Record<string, unknown>>
  stderr: string
}

export type CommandResult = {
  schemaVersion: 1
  command: MaintenanceApplyRequest["command"]
  transactionState: TransactionState
  retrySafety: RetrySafety
  completedEffectIds: readonly string[]
  remainingEffectIds: readonly string[]
  nextAction: NextAction
  human: string
  agent: Readonly<Record<string, unknown>>
  stderr: string
}

export interface MaintenanceCommands {
  inspect(command: MaintenanceCommand): Promise<MaintenanceOutcome<CommandPreview>>
  apply(request: MaintenanceApplyRequest): Promise<MaintenanceOutcome<CommandResult>>
}
