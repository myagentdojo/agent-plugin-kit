import {
  VerificationProfile,
  type EvidenceCell,
} from "agent-plugin-kit/qualification-evidence"
import { admittedCandidate } from "./admission-invariant-cases"

type VerificationClaim = EvidenceCell["claim"]

const candidateDigest =
  "sha256:2af031b2b3bc51ced417b607dd3e1d937b01534e37d831c392bf85022e903566" as const

function observed(claim: VerificationClaim, id: `cell:${string}`): EvidenceCell {
  return {
    schemaVersion: 1,
    id,
    candidate: admittedCandidate,
    claim,
    actualProofLayer: "clean-fixture",
    assertedStatus: "proved",
    observable: { kind: "observed", code: "CLEAN_FIXTURE_OBSERVED" },
    lineage: {
      candidateIdentitySha256: candidateDigest,
      source: admittedCandidate.source,
      release: admittedCandidate.release,
      package: admittedCandidate.package,
      workflow: admittedCandidate.workflow,
      installedPayloadSha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      hostedRun: {
        provider: "github-actions",
        repository: admittedCandidate.source.repository,
        runId: "12345",
        attempt: 1,
        headCommit: admittedCandidate.source.commit,
      },
      platform: { os: "darwin", arch: "arm64" },
    },
    skipRationale: null,
    nonClaims: [],
    receipt: {
      schemaVersion: 1,
      owner: "clean-fixture",
      receiptSchemaVersion: 1,
      candidateIdentitySha256: candidateDigest,
      digest: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    },
    resolves: [],
  }
}

function skipped(
  claim: VerificationClaim,
  id: `cell:${string}`,
  skipRationale: "hosted-proof-not-run" | "fresh-native-proof-not-run",
): EvidenceCell {
  return {
    ...observed(claim, id),
    actualProofLayer: null,
    assertedStatus: "unknown",
    observable: null,
    skipRationale,
    nonClaims: [claim],
    receipt: null,
  }
}

export const personalProfile = VerificationProfile.personal
export const publicProfile = VerificationProfile.public

export function personalProfileCells(): EvidenceCell[] {
  return [
    observed("kit.identity.admitted", "cell:personal-admitted"),
    observed("kit.command.invoked", "cell:personal-command"),
    observed("kit.package.full-commit-pin", "cell:personal-package"),
    observed("kit.workflow.full-commit-pin", "cell:personal-workflow"),
    observed("plugin-payload.installed", "cell:personal-payload"),
    { ...observed("runtime.supported-platform", "cell:personal-runtime"), actualProofLayer: "public-process" },
    skipped("harness.claude.fresh-native", "cell:personal-claude", "fresh-native-proof-not-run"),
    skipped("harness.codex.fresh-native", "cell:personal-codex", "fresh-native-proof-not-run"),
  ]
}

export function publicProfileCells(): EvidenceCell[] {
  return [
    observed("kit.identity.admitted", "cell:public-admitted"),
    observed("kit.command.invoked", "cell:public-command"),
    observed("kit.package.full-commit-pin", "cell:public-package"),
    observed("kit.workflow.full-commit-pin", "cell:public-workflow"),
    skipped("plugin-payload.installed", "cell:public-payload", "hosted-proof-not-run"),
    skipped("runtime.supported-platform", "cell:public-runtime", "hosted-proof-not-run"),
    skipped("release.identity.published", "cell:public-release", "hosted-proof-not-run"),
    skipped("workflow.called-revision", "cell:public-workflow-call", "hosted-proof-not-run"),
    skipped("canary.hosted-qualified", "cell:public-canary", "hosted-proof-not-run"),
    skipped("harness.claude.fresh-native", "cell:public-claude", "fresh-native-proof-not-run"),
    skipped("harness.codex.fresh-native", "cell:public-codex", "fresh-native-proof-not-run"),
  ]
}
