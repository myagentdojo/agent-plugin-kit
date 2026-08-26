type Sha256Digest = `sha256:${string}`
type FullCommitPin = string

export type RepositoryIdentity = {
  origin: string
}

export type SourceIdentity = {
  repository: RepositoryIdentity
  commit: FullCommitPin
}

export type ReleaseIdentity = {
  reference: string
  commit: FullCommitPin
}

export type PackageIdentity = {
  repository: RepositoryIdentity
  commit: FullCommitPin
}

export type WorkflowIdentity = {
  repository: RepositoryIdentity
  path: string
  commit: FullCommitPin
}

export type CandidateIdentity = {
  source: SourceIdentity
  release: ReleaseIdentity
  package: PackageIdentity
  workflow: WorkflowIdentity
}

declare const admittedIdentityBrand: unique symbol

export type AdmittedIdentity = CandidateIdentity & {
  readonly [admittedIdentityBrand]: true
}

export type AdmissionRequest = {
  candidate: CandidateIdentity
  repository: RepositoryIdentity
  provenance: SourceIdentity
  source: SourceIdentity
  release: ReleaseIdentity
  package: PackageIdentity
  workflow: WorkflowIdentity
}

export type AdmissionRefusal = {
  code:
    | "repository-mismatch"
    | "provenance-mismatch"
    | "source-pin-mismatch"
    | "release-pin-mismatch"
    | "package-pin-mismatch"
    | "workflow-pin-mismatch"
  nextAction: string
}

export type PackageObservation = {
  identity: PackageIdentity
  payloadSha256: Sha256Digest
}

export type ReleaseRequest = {
  candidate: CandidateIdentity
  intent: "impact" | "readiness" | "maintenance" | "publication" | "resume" | "repair"
}

export type ReleaseMutationRequest = ReleaseRequest & {
  expectedEffectIds: readonly string[]
}

export type ReleasePlan = {
  candidate: CandidateIdentity
  expectedEffectIds: readonly string[]
  approvalDigest: Sha256Digest
}

export type ReleaseResult = {
  candidate: CandidateIdentity
  completedEffectIds: readonly string[]
  remainingEffectIds: readonly string[]
}

type ApprovalDigest = `sha256:${string}`

export type ReleaseCandidateApproval = {
  schemaVersion: 1
  issuer: "release-and-git-engine"
  candidate: CandidateIdentity
  candidateIdentitySha256: ApprovalDigest
  inspectedStateSha256: ApprovalDigest
  expectedEffectsSha256: ApprovalDigest
  digest: ApprovalDigest
}

export interface ReleaseAndGitEngine {
  inspect(request: ReleaseRequest): Promise<ReleasePlan>
  apply(
    request: ReleaseMutationRequest,
    approval: ReleaseCandidateApproval,
  ): Promise<ReleaseResult>
}
