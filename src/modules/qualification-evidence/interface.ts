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
} & (
  | {
      assertedStatus: "proved"
      actualProofLayer: "in-process" | "public-process" | "clean-fixture" | "hosted" | "fresh-native"
      observable: { kind: "observed"; code: string; digest?: `sha256:${string}` }
      skipRationale: null
    }
  | {
      assertedStatus: "not-proved"
      actualProofLayer: "in-process" | "public-process" | "clean-fixture" | "hosted" | "fresh-native"
      observable: { kind: "failure" | "proved-absence"; code: string; digest?: `sha256:${string}` }
      skipRationale: null
    }
  | {
      assertedStatus: "unknown"
      unknownKind: "observation"
      actualProofLayer: "in-process" | "public-process" | "clean-fixture" | "hosted" | "fresh-native"
      observable: { kind: "unavailable" | "unknown"; code: string; digest?: `sha256:${string}` }
      skipRationale: null
    }
  | {
      assertedStatus: "unknown"
      unknownKind: "skip"
      actualProofLayer: null
      observable: null
      skipRationale:
        | "hosted-proof-not-run"
        | "fresh-native-proof-not-run"
        | "protected-authority-unavailable"
        | "platform-not-selected"
        | "host-unavailable"
        | "not-applicable"
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
  id: "personal" | "public"
  requirements: readonly {
    claim: EvidenceCell["claim"]
    requiredProofLayer: "in-process" | "public-process" | "clean-fixture" | "hosted" | "fresh-native"
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

export const VerificationProfile = Object.freeze({
  personal: Object.freeze({
    schemaVersion: 1,
    id: "personal",
    requirements: Object.freeze<VerificationProfile["requirements"]>([
      Object.freeze({ claim: "kit.identity.admitted", requiredProofLayer: "clean-fixture", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "release", "package", "workflow"]) }),
      Object.freeze({ claim: "kit.command.invoked", requiredProofLayer: "clean-fixture", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "package"]) }),
      Object.freeze({ claim: "kit.package.full-commit-pin", requiredProofLayer: "clean-fixture", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "package"]) }),
      Object.freeze({ claim: "kit.workflow.full-commit-pin", requiredProofLayer: "clean-fixture", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "workflow"]) }),
      Object.freeze({ claim: "plugin-payload.installed", requiredProofLayer: "clean-fixture", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "package", "installed-payload"]) }),
      Object.freeze({ claim: "runtime.supported-platform", requiredProofLayer: "public-process", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "package", "platform", "receipt"]) }),
      Object.freeze({ claim: "harness.claude.fresh-native", requiredProofLayer: "fresh-native", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "package", "installed-payload", "receipt"]) }),
      Object.freeze({ claim: "harness.codex.fresh-native", requiredProofLayer: "fresh-native", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "package", "installed-payload", "receipt"]) }),
    ]),
  }),
  public: Object.freeze({
    schemaVersion: 1,
    id: "public",
    requirements: Object.freeze<VerificationProfile["requirements"]>([
      Object.freeze({ claim: "kit.identity.admitted", requiredProofLayer: "clean-fixture", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "release", "package", "workflow"]) }),
      Object.freeze({ claim: "kit.command.invoked", requiredProofLayer: "clean-fixture", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "package"]) }),
      Object.freeze({ claim: "kit.package.full-commit-pin", requiredProofLayer: "clean-fixture", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "package"]) }),
      Object.freeze({ claim: "kit.workflow.full-commit-pin", requiredProofLayer: "clean-fixture", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "workflow"]) }),
      Object.freeze({ claim: "plugin-payload.installed", requiredProofLayer: "hosted", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "package", "installed-payload", "hosted-run", "receipt"]) }),
      Object.freeze({ claim: "runtime.supported-platform", requiredProofLayer: "hosted", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "package", "platform", "hosted-run", "receipt"]) }),
      Object.freeze({ claim: "release.identity.published", requiredProofLayer: "hosted", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "release", "hosted-run", "receipt"]) }),
      Object.freeze({ claim: "workflow.called-revision", requiredProofLayer: "hosted", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "workflow", "hosted-run", "receipt"]) }),
      Object.freeze({ claim: "canary.hosted-qualified", requiredProofLayer: "hosted", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "package", "workflow", "installed-payload", "hosted-run", "receipt"]) }),
      Object.freeze({ claim: "harness.claude.fresh-native", requiredProofLayer: "fresh-native", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "package", "installed-payload", "receipt"]) }),
      Object.freeze({ claim: "harness.codex.fresh-native", requiredProofLayer: "fresh-native", requiredLineage: Object.freeze<VerificationProfile["requirements"][number]["requiredLineage"]>(["source", "package", "installed-payload", "receipt"]) }),
    ]),
  }),
}) satisfies Readonly<Record<"personal" | "public", VerificationProfile>>

/**
 * A reduced result is deterministic: claims follow the exact selected
 * profile order. Every claim retains at least one contributing Evidence Cell
 * ID, and those IDs are globally unique across the result. A claim's status
 * precedence is `not-proved > unknown > proved`; when cells tie, the first
 * input cell wins. Claim metadata and the top-level Non-Claims and receipt
 * digest arrays preserve first occurrence order.
 */
export type QualificationResult = {
  schemaVersion: 1
  candidate: CandidateIdentity
  profileId: VerificationProfile["id"]
  claims: readonly (
    & {
      claim: EvidenceCell["claim"]
      nonClaims: readonly EvidenceCell["claim"][]
      receiptDigests: readonly NonNullable<EvidenceCell["receipt"]>["digest"][]
      evidenceCellIds: readonly EvidenceCell["id"][]
    }
    & (
      | {
          status: "proved"
          actualProofLayer: "in-process" | "public-process" | "clean-fixture" | "hosted" | "fresh-native"
          observationKind: "observed"
          skipRationale: null
        }
      | {
          status: "not-proved"
          actualProofLayer: "in-process" | "public-process" | "clean-fixture" | "hosted" | "fresh-native"
          observationKind: "observed" | "failure" | "proved-absence"
          skipRationale: null
        }
      | {
          status: "unknown"
          unknownKind: "observation"
          actualProofLayer: "in-process" | "public-process" | "clean-fixture" | "hosted" | "fresh-native"
          observationKind: "unavailable" | "unknown"
          skipRationale: null
        }
      | {
          status: "unknown"
          unknownKind: "skip"
          actualProofLayer: null
          observationKind: null
          skipRationale: Extract<EvidenceCell, { unknownKind: "skip" }>["skipRationale"]
        }
    )
  )[]
  counts: {
    selected: number
    covered: number
    skipped: number
    proved: number
    notProved: number
    unknown: number
  }
  nonClaims: readonly EvidenceCell["claim"][]
  receiptDigests: readonly NonNullable<EvidenceCell["receipt"]>["digest"][]
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
  claim: EvidenceCell["claim"] | null
  evidenceCellId: EvidenceCell["id"] | null
}

export type QualificationOutcome =
  | { status: "reduced"; result: QualificationResult }
  | { status: "refused"; refusal: QualificationRefusal }

export interface QualificationEvidence {
  /**
   * Refuses malformed IDs, profile drift, invalid resolution references,
   * Candidate Lineage disagreement, and unqualified resolution in this order:
   * invalid-cell-id, out-of-profile, invalid-resolution,
   * lineage-disagreement, unqualified-resolution, zero-cell, and
   * mixed-unresolved. A reduced result retains the canonical profile claim
   * order, `selected = covered + skipped`, `covered = proved + notProved +
   * unknown`, at least one globally unique contributing Evidence Cell ID per
   * claim, and first-occurrence claim and aggregate metadata.
   *
   * A Personal profile may skip only either Fresh-Native harness claim, using
   * `fresh-native-proof-not-run`. In a Public profile,
   * `plugin-payload.installed`, `release.identity.published`, and
   * `workflow.called-revision` accept `hosted-proof-not-run`,
   * `host-unavailable`, or `not-applicable`; `runtime.supported-platform`
   * additionally accepts `platform-not-selected`; `canary.hosted-qualified`
   * instead additionally accepts `protected-authority-unavailable`; and each
   * Fresh-Native harness claim accepts `fresh-native-proof-not-run`,
   * `host-unavailable`, or `not-applicable`.
   * `out-of-profile` covers a noncanonical profile table, a cell whose claim
   * is outside that profile, or a skip not admitted by these rules.
   */
  reduce(input: {
    candidate: CandidateIdentity
    profile: VerificationProfile
    cells: readonly EvidenceCell[]
  }): QualificationOutcome
}
