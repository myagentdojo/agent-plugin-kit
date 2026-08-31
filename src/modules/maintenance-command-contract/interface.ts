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
  exitCodeHint: 1 | 2 | 20 | 21 | 22 | 23
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

export interface MaintenanceCommands {
  inspect(command: MaintenanceCommand): Promise<MaintenanceOutcome<CommandPreview>>
  apply(request: MaintenanceApplyRequest): Promise<MaintenanceOutcome<CommandResult>>
}
