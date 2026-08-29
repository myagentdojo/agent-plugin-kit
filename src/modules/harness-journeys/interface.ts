import type { PreparedPluginPayload } from "../plugin-payload-production/interface"
import type {
  AdmittedIdentity,
  CandidateIdentity,
} from "../release-and-git-engine/interface"

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
  candidateIdentitySha256: `sha256:${string}`
  inspectedStateSha256: `sha256:${string}`
  expectedEffectsSha256: `sha256:${string}`
  digest: `sha256:${string}`
}

export type CodexTransitionApproval = {
  schemaVersion: 1
  issuer: "harness-journeys:codex"
  candidate: CandidateIdentity
  candidateIdentitySha256: `sha256:${string}`
  inspectedStateSha256: `sha256:${string}`
  expectedEffectsSha256: `sha256:${string}`
  digest: `sha256:${string}`
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
