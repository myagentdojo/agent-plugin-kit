import type {
  CandidateIdentity,
  PackageIdentity,
  ReleaseIdentity,
  RepositoryIdentity,
  SourceIdentity,
  WorkflowIdentity,
} from "../release-and-git-engine/interface"

export type EvidenceCell = {
  schemaVersion: 1
  id: `cell:${string}`
  candidate: CandidateIdentity
  claim:
    | "kit.identity.admitted"
    | "kit.command.invoked"
    | "kit.package.full-commit-pin"
    | "kit.workflow.full-commit-pin"
    | "plugin-payload.installed"
    | "runtime.supported-platform"
    | "release.identity.published"
    | "workflow.called-revision"
    | "canary.hosted-qualified"
    | "harness.claude.fresh-native"
    | "harness.codex.fresh-native"
  actualProofLayer:
    | "in-process"
    | "public-process"
    | "clean-fixture"
    | "hosted"
    | "fresh-native"
    | null
  assertedStatus: "proved" | "not-proved" | "unknown"
  observable: {
    kind: "observed" | "failure" | "proved-absence" | "unavailable" | "unknown"
    code: string
    digest?: `sha256:${string}`
  } | null
  lineage: {
    candidateIdentitySha256: `sha256:${string}`
    source: SourceIdentity
    release?: ReleaseIdentity
    package?: PackageIdentity
    workflow?: WorkflowIdentity
    installedPayloadSha256?: `sha256:${string}`
    hostedRun?: {
      provider: "github-actions"
      repository: RepositoryIdentity
      runId: string
      attempt: number
      headCommit: string
    }
    platform?: {
      os: "darwin" | "linux"
      arch: "arm64" | "x64"
      libc?: "glibc"
    }
  }
  skipRationale:
    | "hosted-proof-not-run"
    | "fresh-native-proof-not-run"
    | "protected-authority-unavailable"
    | "platform-not-selected"
    | "host-unavailable"
    | "not-applicable"
    | null
  nonClaims: readonly (
    | "kit.identity.admitted"
    | "kit.command.invoked"
    | "kit.package.full-commit-pin"
    | "kit.workflow.full-commit-pin"
    | "plugin-payload.installed"
    | "runtime.supported-platform"
    | "release.identity.published"
    | "workflow.called-revision"
    | "canary.hosted-qualified"
    | "harness.claude.fresh-native"
    | "harness.codex.fresh-native"
  )[]
  receipt: {
    schemaVersion: 1
    owner:
      | "plugin-payload-production"
      | "runtime-custody"
      | "release-and-git-engine"
      | "harness-journeys"
      | "canary-qualification"
      | "reusable-workflow-adapter"
      | "clean-fixture"
    receiptSchemaVersion: number
    candidateIdentitySha256: `sha256:${string}`
    digest: `sha256:${string}`
  } | null
  resolves: readonly `cell:${string}`[]
}

export type VerificationProfile = {
  schemaVersion: 1
  id: "personal" | "public"
  requirements: readonly {
    claim:
      | "kit.identity.admitted"
      | "kit.command.invoked"
      | "kit.package.full-commit-pin"
      | "kit.workflow.full-commit-pin"
      | "plugin-payload.installed"
      | "runtime.supported-platform"
      | "release.identity.published"
      | "workflow.called-revision"
      | "canary.hosted-qualified"
      | "harness.claude.fresh-native"
      | "harness.codex.fresh-native"
    requiredProofLayer:
      | "in-process"
      | "public-process"
      | "clean-fixture"
      | "hosted"
      | "fresh-native"
    requiredLineage: readonly (
      | "source"
      | "release"
      | "package"
      | "workflow"
      | "installed-payload"
      | "hosted-run"
      | "platform"
      | "receipt"
    )[]
  }[]
}

export const VerificationProfile = {
  personal: {
    schemaVersion: 1,
    id: "personal",
    requirements: [
      { claim: "kit.identity.admitted", requiredProofLayer: "clean-fixture", requiredLineage: ["source", "release", "package", "workflow"] },
      { claim: "kit.command.invoked", requiredProofLayer: "clean-fixture", requiredLineage: ["source", "package"] },
      { claim: "kit.package.full-commit-pin", requiredProofLayer: "clean-fixture", requiredLineage: ["source", "package"] },
      { claim: "kit.workflow.full-commit-pin", requiredProofLayer: "clean-fixture", requiredLineage: ["source", "workflow"] },
      { claim: "plugin-payload.installed", requiredProofLayer: "clean-fixture", requiredLineage: ["source", "package", "installed-payload"] },
      { claim: "runtime.supported-platform", requiredProofLayer: "public-process", requiredLineage: ["source", "package", "platform", "receipt"] },
      { claim: "harness.claude.fresh-native", requiredProofLayer: "fresh-native", requiredLineage: ["source", "package", "installed-payload", "receipt"] },
      { claim: "harness.codex.fresh-native", requiredProofLayer: "fresh-native", requiredLineage: ["source", "package", "installed-payload", "receipt"] },
    ],
  },
  public: {
    schemaVersion: 1,
    id: "public",
    requirements: [
      { claim: "kit.identity.admitted", requiredProofLayer: "clean-fixture", requiredLineage: ["source", "release", "package", "workflow"] },
      { claim: "kit.command.invoked", requiredProofLayer: "clean-fixture", requiredLineage: ["source", "package"] },
      { claim: "kit.package.full-commit-pin", requiredProofLayer: "clean-fixture", requiredLineage: ["source", "package"] },
      { claim: "kit.workflow.full-commit-pin", requiredProofLayer: "clean-fixture", requiredLineage: ["source", "workflow"] },
      { claim: "plugin-payload.installed", requiredProofLayer: "hosted", requiredLineage: ["source", "package", "installed-payload", "hosted-run", "receipt"] },
      { claim: "runtime.supported-platform", requiredProofLayer: "hosted", requiredLineage: ["source", "package", "platform", "hosted-run", "receipt"] },
      { claim: "release.identity.published", requiredProofLayer: "hosted", requiredLineage: ["source", "release", "hosted-run", "receipt"] },
      { claim: "workflow.called-revision", requiredProofLayer: "hosted", requiredLineage: ["source", "workflow", "hosted-run", "receipt"] },
      { claim: "canary.hosted-qualified", requiredProofLayer: "hosted", requiredLineage: ["source", "package", "workflow", "installed-payload", "hosted-run", "receipt"] },
      { claim: "harness.claude.fresh-native", requiredProofLayer: "fresh-native", requiredLineage: ["source", "package", "installed-payload", "receipt"] },
      { claim: "harness.codex.fresh-native", requiredProofLayer: "fresh-native", requiredLineage: ["source", "package", "installed-payload", "receipt"] },
    ],
  },
} as const satisfies Readonly<Record<"personal" | "public", VerificationProfile>>

export type QualificationResult = {
  schemaVersion: 1
  candidate: CandidateIdentity
  profileId: "personal" | "public"
  claims: readonly {
    claim:
      | "kit.identity.admitted"
      | "kit.command.invoked"
      | "kit.package.full-commit-pin"
      | "kit.workflow.full-commit-pin"
      | "plugin-payload.installed"
      | "runtime.supported-platform"
      | "release.identity.published"
      | "workflow.called-revision"
      | "canary.hosted-qualified"
      | "harness.claude.fresh-native"
      | "harness.codex.fresh-native"
    status: "proved" | "not-proved" | "unknown"
    actualProofLayer:
      | "in-process"
      | "public-process"
      | "clean-fixture"
      | "hosted"
      | "fresh-native"
      | null
    observationKind: "observed" | "failure" | "proved-absence" | "unavailable" | "unknown" | null
    skipRationale:
      | "hosted-proof-not-run"
      | "fresh-native-proof-not-run"
      | "protected-authority-unavailable"
      | "platform-not-selected"
      | "host-unavailable"
      | "not-applicable"
      | null
    nonClaims: readonly (
      | "kit.identity.admitted"
      | "kit.command.invoked"
      | "kit.package.full-commit-pin"
      | "kit.workflow.full-commit-pin"
      | "plugin-payload.installed"
      | "runtime.supported-platform"
      | "release.identity.published"
      | "workflow.called-revision"
      | "canary.hosted-qualified"
      | "harness.claude.fresh-native"
      | "harness.codex.fresh-native"
    )[]
    receiptDigests: readonly `sha256:${string}`[]
    evidenceCellIds: readonly `cell:${string}`[]
  }[]
  counts: {
    selected: number
    covered: number
    skipped: number
    proved: number
    notProved: number
    unknown: number
  }
  nonClaims: readonly (
    | "kit.identity.admitted"
    | "kit.command.invoked"
    | "kit.package.full-commit-pin"
    | "kit.workflow.full-commit-pin"
    | "plugin-payload.installed"
    | "runtime.supported-platform"
    | "release.identity.published"
    | "workflow.called-revision"
    | "canary.hosted-qualified"
    | "harness.claude.fresh-native"
    | "harness.codex.fresh-native"
  )[]
  receiptDigests: readonly `sha256:${string}`[]
}

export type QualificationRefusalCode =
  | "zero-cell"
  | "out-of-profile"
  | "lineage-disagreement"
  | "invalid-cell-id"
  | "invalid-resolution"
  | "unqualified-resolution"
  | "mixed-unresolved"

export type QualificationRefusal = {
  schemaVersion: 1
  code: QualificationRefusalCode
  claim:
    | (
        | "kit.identity.admitted"
        | "kit.command.invoked"
        | "kit.package.full-commit-pin"
        | "kit.workflow.full-commit-pin"
        | "plugin-payload.installed"
        | "runtime.supported-platform"
        | "release.identity.published"
        | "workflow.called-revision"
        | "canary.hosted-qualified"
        | "harness.claude.fresh-native"
        | "harness.codex.fresh-native"
      )
    | null
  evidenceCellId: `cell:${string}` | null
}

export type QualificationOutcome =
  | { status: "reduced"; result: QualificationResult }
  | { status: "refused"; refusal: QualificationRefusal }

export interface QualificationEvidence {
  reduce(input: {
    candidate: CandidateIdentity
    profile: VerificationProfile
    cells: readonly EvidenceCell[]
  }): QualificationResult
}
