import type { CandidateIdentity } from "../release-and-git-engine/interface"

export type CanaryCandidate = {
  identity: CandidateIdentity
  inertPayloadSha256: `sha256:${string}`
}

export type CanaryPlan = {
  candidate: CandidateIdentity
  target: string
  immutableReference: string
}

declare const protectedCanaryAuthorityBrand: unique symbol

export type ProtectedCanaryAuthority = {
  readonly [protectedCanaryAuthorityBrand]: true
}

export type CanaryResult = {
  candidate: CandidateIdentity
  hostedRunId: string
  installedPayloadSha256: `sha256:${string}`
}

export interface CanaryQualification {
  inspect(candidate: CanaryCandidate): Promise<CanaryPlan>
  qualify(
    candidate: CanaryCandidate,
    authority: ProtectedCanaryAuthority,
  ): Promise<CanaryResult>
}
