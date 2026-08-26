import type { PreparedPluginPayload } from "../plugin-payload-production/interface"
import type {
  AdmittedIdentity,
  CandidateIdentity,
} from "../release-and-git-engine/interface"

type ApprovalDigest = `sha256:${string}`

export type ClaudeRequest = {
  identity: AdmittedIdentity
  payload: PreparedPluginPayload
  profileIdentity: string
}

export type CodexRequest = ClaudeRequest & {
  checkoutIdentity: string
}

export type ClaudeInspection = {
  candidate: CandidateIdentity
  profileIdentity: string
  expectedEffectIds: readonly string[]
}

export type CodexInspection = ClaudeInspection & {
  checkoutIdentity: string
}

export type ClaudeTransitionRequest = ClaudeRequest & {
  expectedEffectIds: readonly string[]
}

export type CodexTransitionRequest = CodexRequest & {
  expectedEffectIds: readonly string[]
}

export type ClaudeTransitionApproval = {
  schemaVersion: 1
  issuer: "harness-journeys:claude"
  candidate: CandidateIdentity
  candidateIdentitySha256: ApprovalDigest
  inspectedStateSha256: ApprovalDigest
  expectedEffectsSha256: ApprovalDigest
  digest: ApprovalDigest
}

export type CodexTransitionApproval = {
  schemaVersion: 1
  issuer: "harness-journeys:codex"
  candidate: CandidateIdentity
  candidateIdentitySha256: ApprovalDigest
  inspectedStateSha256: ApprovalDigest
  expectedEffectsSha256: ApprovalDigest
  digest: ApprovalDigest
}

export type ClaudeApplyResult = {
  completedEffectIds: readonly string[]
  remainingEffectIds: readonly string[]
}

export type CodexApplyResult = ClaudeApplyResult & {
  freshTaskCommand: readonly string[]
}

export interface HarnessJourneys {
  inspect(request: ClaudeRequest): Promise<ClaudeInspection>
  inspect(request: CodexRequest): Promise<CodexInspection>
  apply(
    request: ClaudeTransitionRequest,
    approval: ClaudeTransitionApproval,
  ): Promise<ClaudeApplyResult>
  apply(
    request: CodexTransitionRequest,
    approval: CodexTransitionApproval,
  ): Promise<CodexApplyResult>
}
