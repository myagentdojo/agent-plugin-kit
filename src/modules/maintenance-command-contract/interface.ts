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
  exitCodeHint: number
  failureClass:
    | "usage"
    | "refusal"
    | "transient"
    | "continuation"
    | "recovery"
    | "unexpected"
  errorFamily:
    | "input"
    | "state_conflict"
    | "authentication"
    | "authorization_scope"
    | "network"
    | "transient"
    | "runtime"
  severity: "warning" | "error" | "fatal"
  action:
    | "change_input"
    | "contact_support"
    | "inspect_state"
    | "open_docs"
    | "repair_state"
    | "retry"
    | "run_command"
    | "select_command"
    | "wait"
  retryable: boolean
  recoverability:
    | "none"
    | "retry"
    | "change_input"
    | "authenticate"
    | "repair_state"
    | "contact_support"
  retrySafety: "safe" | "unsafe" | "requires-fresh-inspection"
  transactionState: "unchanged" | "completed" | "partially-completed" | "unknown"
  nextAction: {
    id: string
    action:
      | "change_input"
      | "contact_support"
      | "inspect_state"
      | "open_docs"
      | "repair_state"
      | "retry"
      | "run_command"
      | "select_command"
      | "wait"
    summary: string
    commandId?: MaintenanceCommand["command"] | null
    retryAfterMs?: number
    idempotencyKey?: string
  }
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
  effectClass: "inspect" | "repository-local" | "external"
  expectedEffectIds: readonly string[]
  transactionState: "unchanged" | "completed" | "partially-completed" | "unknown"
  retrySafety: "safe" | "unsafe" | "requires-fresh-inspection"
  nextAction: {
    id: string
    action:
      | "change_input"
      | "contact_support"
      | "inspect_state"
      | "open_docs"
      | "repair_state"
      | "retry"
      | "run_command"
      | "select_command"
      | "wait"
    summary: string
    commandId?: MaintenanceCommand["command"] | null
    retryAfterMs?: number
    idempotencyKey?: string
  }
  human: string
  agent: Readonly<Record<string, unknown>>
  stderr: string
}

export type CommandResult = {
  schemaVersion: 1
  command: MaintenanceApplyRequest["command"]
  transactionState: "unchanged" | "completed" | "partially-completed" | "unknown"
  retrySafety: "safe" | "unsafe" | "requires-fresh-inspection"
  completedEffectIds: readonly string[]
  remainingEffectIds: readonly string[]
  nextAction: {
    id: string
    action:
      | "change_input"
      | "contact_support"
      | "inspect_state"
      | "open_docs"
      | "repair_state"
      | "retry"
      | "run_command"
      | "select_command"
      | "wait"
    summary: string
    commandId?: MaintenanceCommand["command"] | null
    retryAfterMs?: number
    idempotencyKey?: string
  }
  human: string
  agent: Readonly<Record<string, unknown>>
  stderr: string
}

export interface MaintenanceCommands {
  inspect(command: MaintenanceCommand): Promise<MaintenanceOutcome<CommandPreview>>
  apply(request: MaintenanceApplyRequest): Promise<MaintenanceOutcome<CommandResult>>
}
