import type { MaintenanceCommand } from "../../modules/maintenance-command-contract/interface"
import type { CommandResult } from "../../modules/maintenance-command-contract/interface"
import type { WorkflowIdentity } from "../../modules/release-and-git-engine/interface"

export type ReusableWorkflowRequest = {
  event:
    | { kind: "pull-request"; repository: string; headCommit: string }
    | { kind: "workflow-dispatch"; repository: string; headCommit: string }
  workflow: WorkflowIdentity
  command: MaintenanceCommand
  inputs: Readonly<Record<string, string>>
  permissions: Readonly<Record<string, "none" | "read" | "write">>
  environment: string | null
  expectedCheckName: string
  expectedOutputs: readonly string[]
}

export type ReusableWorkflowResult = {
  workflow: WorkflowIdentity
  hostedRunId: string
  checkName: string
  outputs: Readonly<Record<string, string>>
  commandResult: CommandResult
}

export interface ReusableWorkflowAdapter {
  invoke(request: ReusableWorkflowRequest): Promise<ReusableWorkflowResult>
}
