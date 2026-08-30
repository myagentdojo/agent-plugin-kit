import type {
  EvidenceCell,
} from "../../interface"
import { VerificationProfile } from "../../interface"
import type { CandidateIdentity } from "../../../release-and-git-engine/interface"

export const candidate: CandidateIdentity = {
  source: {
    repository: { origin: "https://github.com/myagentdojo/example-plugin.git" },
    commit: "1111111111111111111111111111111111111111",
  },
  release: {
    reference: "refs/tags/v1.0.0",
    commit: "1111111111111111111111111111111111111111",
  },
  package: {
    repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" },
    commit: "1111111111111111111111111111111111111111",
  },
  workflow: {
    repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" },
    path: ".github/workflows/plugin-maintenance.yml",
    commit: "1111111111111111111111111111111111111111",
  },
}

export const candidateDigest =
  "sha256:2af031b2b3bc51ced417b607dd3e1d937b01534e37d831c392bf85022e903566" as const

export const personalProfile = VerificationProfile.personal
export const publicProfile = VerificationProfile.public

export function observedCell(
  overrides: Partial<Extract<EvidenceCell, { assertedStatus: "proved" }>> = {},
): Extract<EvidenceCell, { assertedStatus: "proved" }> {
  return {
    schemaVersion: 1,
    id: "cell:admitted",
    candidate,
    claim: "kit.identity.admitted",
    actualProofLayer: "clean-fixture",
    assertedStatus: "proved",
    observable: {
      kind: "observed",
      code: "ADMISSION_AGREED",
      digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    lineage: {
      candidateIdentitySha256: candidateDigest,
      source: candidate.source,
      release: candidate.release,
      package: candidate.package,
      workflow: candidate.workflow,
      installedPayloadSha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      platform: { os: "darwin", arch: "arm64" },
    },
    skipRationale: null,
    nonClaims: ["workflow.called-revision"],
    receipt: {
      schemaVersion: 1,
      owner: "clean-fixture",
      receiptSchemaVersion: 1,
      candidateIdentitySha256: candidateDigest,
      digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
    resolves: [],
    ...overrides,
  }
}

const observedClaims = [
  "kit.identity.admitted",
  "kit.command.invoked",
  "kit.package.full-commit-pin",
  "kit.workflow.full-commit-pin",
  "plugin-payload.installed",
  "runtime.supported-platform",
] as const

export function personalEvidenceCells(): EvidenceCell[] {
  return [
    ...observedClaims.map((claim, index) =>
      observedCell({
        id: `cell:personal-observed-${index}`,
        claim,
        actualProofLayer: claim === "runtime.supported-platform" ? "public-process" : "clean-fixture",
      }),
    ),
    skipCell("harness.claude.fresh-native", "cell:personal-claude-skip"),
    skipCell("harness.codex.fresh-native", "cell:personal-codex-skip"),
  ]
}

export function publicEvidenceCells(): EvidenceCell[] {
  return [
    observedCell({ id: "cell:public-admitted" }),
    observedCell({ id: "cell:public-command", claim: "kit.command.invoked" }),
    observedCell({ id: "cell:public-package", claim: "kit.package.full-commit-pin" }),
    observedCell({ id: "cell:public-workflow", claim: "kit.workflow.full-commit-pin" }),
    skipCell("plugin-payload.installed", "cell:public-payload", "hosted-proof-not-run"),
    skipCell("runtime.supported-platform", "cell:public-runtime", "hosted-proof-not-run"),
    skipCell("release.identity.published", "cell:public-release", "hosted-proof-not-run"),
    skipCell("workflow.called-revision", "cell:public-workflow-call", "hosted-proof-not-run"),
    skipCell("canary.hosted-qualified", "cell:public-canary", "hosted-proof-not-run"),
    skipCell("harness.claude.fresh-native", "cell:public-claude"),
    skipCell("harness.codex.fresh-native", "cell:public-codex"),
  ]
}

export function skipCell(
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
    | "harness.codex.fresh-native",
  id: `cell:${string}` = "cell:skip",
  skipRationale: Extract<EvidenceCell, { unknownKind: "skip" }>["skipRationale"] = "fresh-native-proof-not-run",
): Extract<EvidenceCell, { unknownKind: "skip" }> {
  return {
    ...observedCell(),
    id,
    claim,
    assertedStatus: "unknown",
    unknownKind: "skip",
    actualProofLayer: null,
    observable: null,
    skipRationale,
    nonClaims: [claim],
    receipt: null,
    resolves: [],
  }
}

export function failureCell(
  claim: EvidenceCell["claim"],
  id: `cell:${string}` = "cell:failure",
): Extract<EvidenceCell, { assertedStatus: "not-proved" }> {
  const base = observedCell({ id, claim })
  return {
    ...base,
    assertedStatus: "not-proved",
    observable: { kind: "failure", code: "QUALIFICATION_FAILED" },
  }
}

export function provedAbsenceCell(
  claim: EvidenceCell["claim"],
  id: `cell:${string}` = "cell:proved-absence",
): Extract<EvidenceCell, { assertedStatus: "not-proved" }> {
  const base = observedCell({ id, claim })
  return {
    ...base,
    assertedStatus: "not-proved",
    observable: { kind: "proved-absence", code: "QUALIFICATION_ABSENT" },
  }
}

export function unavailableCell(
  claim: EvidenceCell["claim"],
  id: `cell:${string}` = "cell:unavailable",
): Extract<EvidenceCell, { assertedStatus: "unknown"; unknownKind: "observation" }> {
  const base = observedCell({ id, claim })
  return {
    ...base,
    assertedStatus: "unknown",
    unknownKind: "observation",
    observable: { kind: "unavailable", code: "QUALIFICATION_UNAVAILABLE" },
  }
}

export function unknownObservationCell(
  claim: EvidenceCell["claim"],
  id: `cell:${string}` = "cell:unknown",
): Extract<EvidenceCell, { assertedStatus: "unknown"; unknownKind: "observation" }> {
  const base = observedCell({ id, claim })
  return {
    ...base,
    assertedStatus: "unknown",
    unknownKind: "observation",
    observable: { kind: "unknown", code: "QUALIFICATION_UNKNOWN" },
  }
}
