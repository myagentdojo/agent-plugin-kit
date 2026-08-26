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

type MaintenanceInspectionCommand =
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

export type MaintenanceCommand =
  | MaintenanceInspectionCommand
  | MaintenanceApplyRequest

type EffectClass = "inspect" | "repository-local" | "external"
type TransactionState =
  | "unchanged"
  | "completed"
  | "partially-completed"
  | "unknown"
type RetrySafety = "safe" | "unsafe" | "requires-fresh-inspection"

export type CommandPreview = {
  schemaVersion: 1
  command: MaintenanceCommand["command"]
  effectClass: EffectClass
  expectedEffectIds: readonly string[]
  transactionState: TransactionState
  retrySafety: RetrySafety
  nextAction: string
  human: string
  agent: Readonly<Record<string, unknown>>
  stderr: string
  exitClass: number
}

export type CommandResult = {
  schemaVersion: 1
  command: MaintenanceApplyRequest["command"]
  transactionState: TransactionState
  retrySafety: RetrySafety
  completedEffectIds: readonly string[]
  remainingEffectIds: readonly string[]
  nextAction: string
  human: string
  agent: Readonly<Record<string, unknown>>
  stderr: string
  exitClass: number
}

export interface MaintenanceCommands {
  inspect(command: MaintenanceCommand): Promise<CommandPreview>
  apply(request: MaintenanceApplyRequest): Promise<CommandResult>
}
