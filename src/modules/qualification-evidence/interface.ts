import type {
  CandidateIdentity,
  PackageIdentity,
  ReleaseIdentity,
  RepositoryIdentity,
  SourceIdentity,
  WorkflowIdentity,
} from "../release-and-git-engine/interface"

/** Evidence Cell identifiers match `^cell:[a-z][a-z0-9-]{0,63}$`. */
export type EvidenceCellId = `cell:${string}`
export type Sha256Digest = `sha256:${string}`
export type CandidateIdentityDigest = Sha256Digest

export type VerificationClaim =
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

export type ProofLayer = "in-process" | "public-process" | "clean-fixture" | "hosted" | "fresh-native"

export type LineageMember =
  | "source"
  | "release"
  | "package"
  | "workflow"
  | "installed-payload"
  | "hosted-run"
  | "platform"
  | "receipt"

export type SkipRationale =
  | "hosted-proof-not-run"
  | "fresh-native-proof-not-run"
  | "protected-authority-unavailable"
  | "platform-not-selected"
  | "host-unavailable"
  | "not-applicable"

/** The fixed partial order used for proof promotion and resolution. */
export type ProofLayerSatisfaction = {
  readonly "in-process": readonly ["in-process"]
  readonly "public-process": readonly ["in-process", "public-process"]
  readonly "clean-fixture": readonly ["in-process", "public-process", "clean-fixture"]
  readonly hosted: readonly ["in-process", "public-process", "clean-fixture", "hosted"]
  readonly "fresh-native": readonly ["in-process", "public-process", "clean-fixture", "fresh-native"]
}

export type VerificationProfileId = "personal" | "public"

export type VerificationRequirement = {
  claim: VerificationClaim
  requiredProofLayer: ProofLayer
  requiredLineage: readonly LineageMember[]
}

/**
 * A Personal skip is limited to the two Fresh-Native claims and its one
 * rationale. A Public skip is limited to hosted or Fresh-Native claims and
 * the rationale associated with that claim's unavailable proof.
 */
export type AllowedQualificationSkip =
  | {
      profileId: "personal"
      claim: "harness.claude.fresh-native" | "harness.codex.fresh-native"
      skipRationale: "fresh-native-proof-not-run"
    }
  | {
      profileId: "public"
      claim: "plugin-payload.installed" | "release.identity.published" | "workflow.called-revision"
      skipRationale: "hosted-proof-not-run" | "host-unavailable" | "not-applicable"
    }
  | {
      profileId: "public"
      claim: "runtime.supported-platform"
      skipRationale: "hosted-proof-not-run" | "platform-not-selected" | "host-unavailable" | "not-applicable"
    }
  | {
      profileId: "public"
      claim: "canary.hosted-qualified"
      skipRationale: "hosted-proof-not-run" | "protected-authority-unavailable" | "host-unavailable" | "not-applicable"
    }
  | {
      profileId: "public"
      claim: "harness.claude.fresh-native" | "harness.codex.fresh-native"
      skipRationale: "fresh-native-proof-not-run" | "host-unavailable" | "not-applicable"
    }

export type EvidenceCell = {
  schemaVersion: 1
  id: EvidenceCellId
  candidate: CandidateIdentity
  claim: VerificationClaim
  lineage: {
    candidateIdentitySha256: CandidateIdentityDigest
    source: SourceIdentity
    release?: ReleaseIdentity
    package?: PackageIdentity
    workflow?: WorkflowIdentity
    installedPayloadSha256?: Sha256Digest
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
  nonClaims: readonly VerificationClaim[]
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
    candidateIdentitySha256: CandidateIdentityDigest
    digest: Sha256Digest
  } | null
  resolves: readonly EvidenceCellId[]
} & (
  | {
      assertedStatus: "proved"
      actualProofLayer: ProofLayer
      observable: { kind: "observed"; code: string; digest?: Sha256Digest }
      skipRationale: null
    }
  | {
      assertedStatus: "not-proved"
      actualProofLayer: ProofLayer
      observable: { kind: "failure" | "proved-absence"; code: string; digest?: Sha256Digest }
      skipRationale: null
    }
  | {
      assertedStatus: "unknown"
      unknownKind: "observation"
      actualProofLayer: ProofLayer
      observable: { kind: "unavailable" | "unknown"; code: string; digest?: Sha256Digest }
      skipRationale: null
    }
  | {
      assertedStatus: "unknown"
      unknownKind: "skip"
      actualProofLayer: null
      observable: null
      skipRationale: SkipRationale
      receipt: null
      resolves: readonly []
    }
)

/**
 * Reduction accepts only the exact ordered requirement table of the selected
 * `VerificationProfile` sentinel. Missing, duplicate, extra, reordered, or
 * weakened requirements are refused. The selected profile order is the result
 * claim order; caller input order cannot replace it.
 */
export type VerificationProfile = {
  schemaVersion: 1
  id: VerificationProfileId
  requirements: readonly VerificationRequirement[]
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

export type QualificationClaim = {
  claim: VerificationClaim
  nonClaims: readonly VerificationClaim[]
  receiptDigests: readonly Sha256Digest[]
  evidenceCellIds: readonly EvidenceCellId[]
} & (
  | {
      status: "proved"
      actualProofLayer: ProofLayer
      observationKind: "observed"
      skipRationale: null
    }
  | {
      status: "not-proved"
      actualProofLayer: ProofLayer
      observationKind: "observed" | "failure" | "proved-absence"
      skipRationale: null
    }
  | {
      status: "unknown"
      unknownKind: "observation"
      actualProofLayer: ProofLayer
      observationKind: "unavailable" | "unknown"
      skipRationale: null
    }
  | {
      status: "unknown"
      unknownKind: "skip"
      actualProofLayer: null
      observationKind: null
      skipRationale: SkipRationale
    }
)

/**
 * `selected` equals the exact profile requirement count and `claims.length`.
 * `selected = covered + skipped`; `covered = proved + notProved + unknown`.
 * The three status counts are counts of the corresponding claim variants;
 * skipped claims are `unknown` claims with `unknownKind: "skip"`, not part of
 * the `unknown` observation count.
 */
export type QualificationResultCounts = {
  selected: number
  covered: number
  skipped: number
  proved: number
  notProved: number
  unknown: number
}

/**
 * Whole-input checks run in this order. If they pass, selected claims are
 * reduced in profile order, with `zero-cell` before `mixed-unresolved`.
 */
export type QualificationReductionPrecedence = readonly [
  "invalid-cell-id",
  "out-of-profile",
  "invalid-resolution",
  "lineage-disagreement",
  "unqualified-resolution",
  "zero-cell",
  "mixed-unresolved",
]

export type QualificationResult = {
  schemaVersion: 1
  candidate: CandidateIdentity
  profileId: VerificationProfileId
  claims: readonly QualificationClaim[]
  counts: QualificationResultCounts
  nonClaims: readonly VerificationClaim[]
  receiptDigests: readonly Sha256Digest[]
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
  claim: VerificationClaim | null
  evidenceCellId: EvidenceCellId | null
}

export type QualificationOutcome =
  | { status: "reduced"; result: QualificationResult }
  | { status: "refused"; refusal: QualificationRefusal }

export interface QualificationEvidence {
  /**
   * Refuses malformed IDs, profile drift, invalid resolution references,
   * Candidate Lineage disagreement, and unqualified resolution in the
   * `QualificationReductionPrecedence` order. A reduced result retains the
   * canonical profile claim order and the count equations above.
   */
  reduce(input: {
    candidate: CandidateIdentity
    profile: VerificationProfile
    cells: readonly EvidenceCell[]
  }): QualificationOutcome
}
