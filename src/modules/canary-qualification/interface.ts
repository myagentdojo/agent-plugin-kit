import type { CandidateIdentity } from "../release-and-git-engine/interface"

type Sha256Digest = `sha256:${string}`

export type CanaryCandidate = {
  identity: CandidateIdentity
  inertPayloadSha256: Sha256Digest
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
  installedPayloadSha256: Sha256Digest
}

export interface CanaryQualification {
  inspect(candidate: CanaryCandidate): Promise<CanaryPlan>
  qualify(
    candidate: CanaryCandidate,
    authority: ProtectedCanaryAuthority,
  ): Promise<CanaryResult>
}
