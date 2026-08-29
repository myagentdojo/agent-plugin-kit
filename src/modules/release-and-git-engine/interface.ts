export type RepositoryIdentity = {
  origin: string
}

export type SourceIdentity = {
  repository: RepositoryIdentity
  commit: string
}

export type ReleaseIdentity = {
  reference: string
  commit: string
}

export type PackageIdentity = {
  repository: RepositoryIdentity
  commit: string
}

export type WorkflowIdentity = {
  repository: RepositoryIdentity
  path: string
  commit: string
}

export type CandidateIdentity = {
  source: SourceIdentity
  release: ReleaseIdentity
  package: PackageIdentity
  workflow: WorkflowIdentity
}

declare const admittedIdentityBrand: unique symbol

export type AdmittedIdentity = {
  readonly source: {
    readonly repository: { readonly origin: string }
    readonly commit: string
  }
  readonly release: {
    readonly reference: string
    readonly commit: string
  }
  readonly package: {
    readonly repository: { readonly origin: string }
    readonly commit: string
  }
  readonly workflow: {
    readonly repository: { readonly origin: string }
    readonly path: string
    readonly commit: string
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
