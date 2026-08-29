export type RepositoryIdentity = {
  readonly origin: string
}

export type SourceIdentity = {
  readonly repository: RepositoryIdentity
  readonly commit: string
}

export type ReleaseIdentity = {
  readonly reference: string
  readonly commit: string
}

export type PackageIdentity = {
  readonly repository: RepositoryIdentity
  readonly commit: string
}

export type WorkflowIdentity = {
  readonly repository: RepositoryIdentity
  readonly path: string
  readonly commit: string
}

export type CandidateIdentity = {
  readonly source: SourceIdentity
  readonly release: ReleaseIdentity
  readonly package: PackageIdentity
  readonly workflow: WorkflowIdentity
}

declare const fullCommitPinBrand: unique symbol
declare const admittedIdentityBrand: unique symbol

export type FullCommitPin = string & {
  readonly [fullCommitPinBrand]: true
}

export type AdmittedIdentity = {
  readonly source: {
    readonly repository: RepositoryIdentity
    readonly commit: FullCommitPin
  }
  readonly release: {
    readonly reference: string
    readonly commit: FullCommitPin
  }
  readonly package: {
    readonly repository: RepositoryIdentity
    readonly commit: FullCommitPin
  }
  readonly workflow: {
    readonly repository: RepositoryIdentity
    readonly path: string
    readonly commit: FullCommitPin
  }
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
  payloadSha256: `sha256:${string}`
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
  approvalDigest: `sha256:${string}`
}

export type ReleaseResult = {
  candidate: CandidateIdentity
  completedEffectIds: readonly string[]
  remainingEffectIds: readonly string[]
}

export type ReleaseCandidateApproval = {
  schemaVersion: 1
  issuer: "release-and-git-engine"
  candidate: CandidateIdentity
  candidateIdentitySha256: `sha256:${string}`
  inspectedStateSha256: `sha256:${string}`
  expectedEffectsSha256: `sha256:${string}`
  digest: `sha256:${string}`
}

export interface ReleaseAndGitEngine {
  inspect(request: ReleaseRequest): Promise<ReleasePlan>
  apply(
    request: ReleaseMutationRequest,
    approval: ReleaseCandidateApproval,
  ): Promise<ReleaseResult>
}
