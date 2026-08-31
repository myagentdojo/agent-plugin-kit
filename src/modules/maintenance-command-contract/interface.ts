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
  commandId: MaintenanceCommand["command"] | null
  retryAfterMs?: number
  idempotencyKey?: string
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
  recoverability:
    | "none"
    | "retry"
    | "change_input"
    | "authenticate"
    | "repair_state"
    | "contact_support"
  nextAction: NextAction
  retryAfterMs?: number
  idempotencyKey?: string
} & (
  | {
      exitCodeHint: 20
      failureClass: "continuation"
      errorFamily: "state_conflict"
      severity: "error"
      action: "inspect_state"
      retryable: false
      recoverability: "repair_state"
      retrySafety: "unsafe"
      transactionState: "partially-completed"
      completedEffectIds: readonly string[]
      remainingEffectIds: readonly [string, ...string[]]
    }
  | {
      exitCodeHint: 1 | 2 | 20 | 21 | 22 | 23
      failureClass: Exclude<MaintenanceErrorFailureClass, "continuation">
      retryable: boolean
      retrySafety: RetrySafety
      transactionState: TransactionState
      completedEffectIds?: never
      remainingEffectIds?: never
    }
)

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

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

export type AgentPayload = {
  readonly schemaVersion: 1
  readonly [key: string]: JsonValue
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
  agent: AgentPayload
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
  agent: AgentPayload
  stderr: string
}

/**
 * The Maintenance Command Contract boundary for inspection and application.
 *
 * A successful inspection of an external command that delegates to another
 * owner binds its expected effect IDs to the inspected request and authorizes
 * exactly one matching apply. The implementation consumes that authorization
 * before delegating; a missing inspection or a changed request or effect
 * binding returns the Maintenance-owned recovery refusal instead of delegating.
 * This one-use binding governs `release:apply`, `harness:claude:apply`,
 * `harness:codex:apply`, and `canary:qualify`.
 *
 * `runtime:repair-apply` is the one bounded exception. Runtime Custody state can
 * change between any two calls, so a caller-held prior binding would authorize
 * an apply against state that no longer exists. `apply` therefore inspects
 * Runtime itself, inside the same call and immediately before the repair, and
 * requires no prior `inspect`. A stale, absent, or non-repairable Runtime
 * inspection refuses there rather than at a caller-held binding. Every other
 * command keeps the one-use binding above.
 */
export interface MaintenanceCommands {
  /**
   * Inspect current state without acquiring a capability or causing an
   * effect. For a delegating external command, the returned expected effect IDs
   * are the binding consumed by the matching `apply` call.
   */
  inspect(command: MaintenanceCommand): Promise<MaintenanceOutcome<CommandPreview>>

  /**
   * Apply one admitted request. For a delegating external command the matching
   * inspection binding must be present and unchanged, and is consumed before
   * owner delegation. For `runtime:repair-apply` the Runtime inspection happens
   * inside this call instead, immediately before the repair.
   */
  apply(request: MaintenanceApplyRequest): Promise<MaintenanceOutcome<CommandResult>>
}
