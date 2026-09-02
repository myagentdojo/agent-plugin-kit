import type {
  AdmittedIdentity,
  CandidateIdentity,
} from "../release-and-git-engine/interface"

export type CanaryCandidate = {
  identity: CandidateIdentity
  inertPayloadSha256: `sha256:${string}`
}

export type CanaryPlan = {
  candidate: CandidateIdentity
  target: string
  immutableReference: string
}

/** Opaque wire reference resolved by the owner-local protected source. */
export type CanaryAuthorityReference = string

declare const protectedCanaryAuthorityBrand: unique symbol

export type ProtectedCanaryAuthority = {
  readonly [protectedCanaryAuthorityBrand]: true
}

export type CanaryAuthoritySourceRefusalCode =
  | "authority-reference-invalid"
  | "authority-unavailable"
  | "authority-candidate-mismatch"
  | "authority-plan-mismatch"

export type CanaryAuthoritySourceRefusal = {
  status: "refused"
  code: CanaryAuthoritySourceRefusalCode
}

export type CanaryAuthoritySourceResolution =
  | { status: "resolved"; authority: ProtectedCanaryAuthority }
  | CanaryAuthoritySourceRefusal

export interface CanaryAuthoritySource {
  resolve(
    reference: CanaryAuthorityReference,
    candidate: AdmittedIdentity,
    plan: CanaryPlan,
  ): Promise<CanaryAuthoritySourceResolution>
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
