import { expect, test } from "bun:test"
import type {
  EvidenceCell,
  QualificationOutcome,
  VerificationProfile,
} from "../interface"
import type { CandidateIdentity } from "../../release-and-git-engine/interface"
import { qualificationEvidence } from "../implementation/qualification-evidence"
import { canonicalCandidateIdentityDigest } from "../serialized-values"
import {
  candidate,
  candidateDigest,
  observedCell,
  personalEvidenceCells,
  personalProfile,
  publicEvidenceCells,
  publicProfile,
  skipCell,
} from "./fixtures/evidence-cells"

function reduceAttempt(profile: VerificationProfile, cells: readonly EvidenceCell[]): QualificationOutcome {
  return qualificationEvidence.reduce({ candidate, profile, cells })
}

function expectRefusal(
  outcome: QualificationOutcome,
  code: "zero-cell" | "out-of-profile" | "lineage-disagreement" | "invalid-cell-id" | "invalid-resolution" | "unqualified-resolution" | "mixed-unresolved",
  claim: EvidenceCell["claim"] | null = null,
): void {
  expect(outcome.status).toBe("refused")
  if (outcome.status !== "refused") return
  const expected = claim === null ? { schemaVersion: 1, code } : { schemaVersion: 1, code, claim }
  expect(outcome.refusal).toMatchObject(expected)
}

function evidenceCellsForCandidate(
  lineageCandidate: CandidateIdentity,
  digest: `sha256:${string}`,
  cellCandidate: CandidateIdentity = lineageCandidate,
): EvidenceCell[] {
  return personalEvidenceCells().map((cell) => {
    const lineage = {
      ...cell.lineage,
      candidateIdentitySha256: digest,
      source: lineageCandidate.source,
      release: lineageCandidate.release,
      package: lineageCandidate.package,
      workflow: lineageCandidate.workflow,
    }
    if (cell.assertedStatus === "unknown" && cell.unknownKind === "skip") {
      return { ...cell, candidate: cellCandidate, lineage, receipt: null }
    }
    return {
      ...cell,
      candidate: cellCandidate,
      lineage,
      receipt: cell.receipt === null
        ? null
        : { ...cell.receipt, candidateIdentitySha256: digest },
    }
  })
}

test("canonical Candidate Lineage reduction preserves profile order and evidence metadata", () => {
  const outcome = reduceAttempt(personalProfile, personalEvidenceCells())
  expect(outcome.status).toBe("reduced")
  if (outcome.status !== "reduced") return

  expect(outcome.result.claims.map(({ claim }) => claim)).toEqual(
    [
      "kit.identity.admitted",
      "kit.command.invoked",
      "kit.package.full-commit-pin",
      "kit.workflow.full-commit-pin",
      "plugin-payload.installed",
      "runtime.supported-platform",
      "harness.claude.fresh-native",
      "harness.codex.fresh-native",
    ],
  )
  expect(outcome.result.counts).toEqual({ selected: 8, covered: 6, skipped: 2, proved: 6, notProved: 0, unknown: 0 })
  expect(outcome.result.claims.map(({ evidenceCellIds }) => evidenceCellIds)).toEqual([
    ["cell:personal-observed-0"],
    ["cell:personal-observed-1"],
    ["cell:personal-observed-2"],
    ["cell:personal-observed-3"],
    ["cell:personal-observed-4"],
    ["cell:personal-observed-5"],
    ["cell:personal-claude-skip"],
    ["cell:personal-codex-skip"],
  ])
  expect(outcome.result.nonClaims).toEqual([
    "workflow.called-revision",
    "harness.claude.fresh-native",
    "harness.codex.fresh-native",
  ])
  expect(outcome.result.receiptDigests).toEqual([
    "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  ])

  const reorderedCandidate: CandidateIdentity = {
    workflow: {
      commit: candidate.workflow.commit,
      path: candidate.workflow.path,
      repository: { origin: candidate.workflow.repository.origin },
    },
    package: {
      commit: candidate.package.commit,
      repository: { origin: candidate.package.repository.origin },
    },
    release: {
      commit: candidate.release.commit,
      reference: candidate.release.reference,
    },
    source: {
      commit: candidate.source.commit,
      repository: { origin: candidate.source.repository.origin },
    },
  }
  const semanticallyEqual = personalEvidenceCells().map((cell) => ({ ...cell, candidate: reorderedCandidate }))
  expect(reduceAttempt(personalProfile, semanticallyEqual).status).toBe("reduced")
})

test("zero-cell selected claim is refused", () => {
  const cells = personalEvidenceCells().filter((cell) => cell.claim !== "kit.identity.admitted")
  const outcome = reduceAttempt(personalProfile, cells)
  expectRefusal(outcome, "zero-cell", "kit.identity.admitted")
})

test("a cell outside the selected profile is refused", () => {
  const outcome = reduceAttempt(personalProfile, [
    ...personalEvidenceCells(),
    observedCell({ id: "cell:outside", claim: "release.identity.published" }),
  ])
  expectRefusal(outcome, "out-of-profile", "release.identity.published")
})

test("Candidate Lineage, installed payload, and receipt disagreement are refused", () => {
  const digestMismatch = personalEvidenceCells()
  digestMismatch[0] = observedCell({
    id: "cell:digest-mismatch",
    lineage: {
      ...observedCell().lineage,
      candidateIdentitySha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    },
  })

  const memberMismatch = personalEvidenceCells()
  memberMismatch[0] = observedCell({
    id: "cell:member-mismatch",
    candidate: {
      ...candidate,
      source: { ...candidate.source, commit: "2222222222222222222222222222222222222222" },
    },
  })

  const payloadMismatch = personalEvidenceCells()
  payloadMismatch[1] = observedCell({
    id: "cell:payload-mismatch",
    claim: "kit.command.invoked",
    lineage: {
      ...observedCell().lineage,
      installedPayloadSha256: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    },
  })

  const receiptMismatch = personalEvidenceCells()
  receiptMismatch[0] = observedCell({
    id: "cell:receipt-mismatch",
    receipt: {
      ...observedCell().receipt!,
      candidateIdentitySha256: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    },
  })

  for (const cells of [digestMismatch, memberMismatch, payloadMismatch, receiptMismatch]) {
    expectRefusal(reduceAttempt(personalProfile, cells), "lineage-disagreement")
  }

  const inconsistentCandidate: CandidateIdentity = {
    ...candidate,
    release: { ...candidate.release, commit: "2222222222222222222222222222222222222222" },
  }
  const inconsistentDigest =
    "sha256:20c432f7c9b7182dbc3f900fefe7c1ac6b022ac3db1811fc6fa78c8fda519a58" as const
  const internallyInconsistent = evidenceCellsForCandidate(inconsistentCandidate, inconsistentDigest)
  expectRefusal(
    qualificationEvidence.reduce({
      candidate: inconsistentCandidate,
      profile: personalProfile,
      cells: internallyInconsistent,
    }),
    "lineage-disagreement",
  )
  expect(candidateDigest).toMatch(/^sha256:[0-9a-f]{64}$/)

  const composedCandidate: CandidateIdentity = {
    ...candidate,
    release: { ...candidate.release, reference: "refs/tags/caf\u00e9" },
  }
  const decomposedCandidate: CandidateIdentity = {
    ...candidate,
    release: { ...candidate.release, reference: "refs/tags/cafe\u0301" },
  }
  const composedDigest = canonicalCandidateIdentityDigest(composedCandidate)
  expect(composedDigest).not.toBe(canonicalCandidateIdentityDigest(decomposedCandidate))
  expectRefusal(
    qualificationEvidence.reduce({
      candidate: composedCandidate,
      profile: personalProfile,
      cells: evidenceCellsForCandidate(composedCandidate, composedDigest, decomposedCandidate),
    }),
    "lineage-disagreement",
  )

  const hostedCell = observedCell({
    id: "cell:public-payload-hosted",
    claim: "plugin-payload.installed",
    actualProofLayer: "hosted",
    lineage: {
      ...observedCell().lineage,
      hostedRun: {
        provider: "github-actions",
        repository: candidate.source.repository,
        runId: "123456",
        attempt: 1,
        headCommit: candidate.source.commit,
      },
    },
  })
  const correct = publicEvidenceCells().map((cell) =>
    cell.claim === "plugin-payload.installed" ? hostedCell : cell,
  )
  expect(reduceAttempt(publicProfile, correct).status).toBe("reduced")

  const wrongRepository = correct.map((cell) =>
    cell.id === hostedCell.id
      ? {
          ...hostedCell,
          lineage: {
            ...hostedCell.lineage,
            hostedRun: {
              ...hostedCell.lineage.hostedRun!,
              repository: { origin: "https://github.com/myagentdojo/not-the-candidate.git" },
            },
          },
        }
      : cell,
  )
  const wrongCommit = correct.map((cell) =>
    cell.id === hostedCell.id
      ? {
          ...hostedCell,
          lineage: {
            ...hostedCell.lineage,
            hostedRun: {
              ...hostedCell.lineage.hostedRun!,
              headCommit: "2222222222222222222222222222222222222222",
            },
          },
        }
      : cell,
  )
  expectRefusal(reduceAttempt(publicProfile, wrongRepository), "lineage-disagreement")
  expectRefusal(reduceAttempt(publicProfile, wrongCommit), "lineage-disagreement")
})

test("malformed and duplicate cell identifiers are refused", () => {
  const malformed = personalEvidenceCells()
  malformed[0] = observedCell({ id: "cell:Uppercase" as EvidenceCell["id"] })
  expectRefusal(reduceAttempt(personalProfile, malformed), "invalid-cell-id")

  const duplicate = personalEvidenceCells()
  duplicate[1] = observedCell({ id: duplicate[0]!.id })
  expectRefusal(reduceAttempt(personalProfile, duplicate), "invalid-cell-id")
})

test("unknown, forward, cross-candidate, and cross-claim resolutions are refused", () => {
  const unknown = personalEvidenceCells()
  unknown[0] = observedCell({ id: "cell:unknown-resolver", resolves: ["cell:missing"] })

  const forward = personalEvidenceCells()
  forward[0] = observedCell({ id: "cell:forward-resolver", resolves: ["cell:later"] })
  forward.push(observedCell({ id: "cell:later" }))

  const crossCandidate = personalEvidenceCells()
  crossCandidate[0] = observedCell({ id: "cell:cross-candidate-resolver", resolves: ["cell:other-candidate"] })
  crossCandidate.push(observedCell({
    id: "cell:other-candidate",
    candidate: {
      ...candidate,
      source: { ...candidate.source, commit: "2222222222222222222222222222222222222222" },
    },
  }))

  const crossClaim = personalEvidenceCells()
  crossClaim[0] = observedCell({ id: "cell:cross-claim-resolver", resolves: ["cell:personal-observed-1"] })

  for (const cells of [unknown, forward, crossCandidate, crossClaim]) {
    expectRefusal(reduceAttempt(personalProfile, cells), "invalid-resolution")
  }
})

test("an unqualified lower-layer, incomplete-lineage, or incomparable resolver is refused", () => {
  const lowerLayer = personalEvidenceCells().filter((cell) => cell.claim !== "kit.identity.admitted")
  lowerLayer.unshift(skipCell("kit.identity.admitted", "cell:lower-layer-skip"))
  lowerLayer.push(observedCell({
    id: "cell:lower-layer-resolver",
    actualProofLayer: "public-process",
    resolves: ["cell:lower-layer-skip"],
  }))

  const incompleteLineage = personalEvidenceCells().filter((cell) => cell.claim !== "plugin-payload.installed")
  incompleteLineage.unshift(skipCell("plugin-payload.installed", "cell:incomplete-lineage-skip"))
  const completeResolver = observedCell({
    id: "cell:incomplete-lineage-resolver",
    claim: "plugin-payload.installed",
    resolves: ["cell:incomplete-lineage-skip"],
  })
  const { installedPayloadSha256: _installedPayloadSha256, ...lineageWithoutPayload } = completeResolver.lineage
  incompleteLineage.push({ ...completeResolver, lineage: lineageWithoutPayload })

  const incomparable = personalEvidenceCells().filter((cell) => cell.claim !== "harness.claude.fresh-native")
  incomparable.push(skipCell("harness.claude.fresh-native", "cell:incomparable-skip"))
  incomparable.push(observedCell({
    id: "cell:incomparable-resolver",
    claim: "harness.claude.fresh-native",
    actualProofLayer: "hosted",
    resolves: ["cell:incomparable-skip"],
  }))

  for (const cells of [lowerLayer, incompleteLineage, incomparable]) {
    expectRefusal(reduceAttempt(personalProfile, cells), "unqualified-resolution")
  }
})

test("an unresolved skip plus observation is refused, while explicit resolution preserves both", () => {
  const mixed = personalEvidenceCells().filter((cell) => cell.claim !== "kit.identity.admitted")
  mixed.unshift(skipCell("kit.identity.admitted", "cell:unresolved-skip"))
  mixed.push(observedCell({ id: "cell:unresolved-observation" }))
  expectRefusal(reduceAttempt(personalProfile, mixed), "mixed-unresolved", "kit.identity.admitted")

  const resolved = personalEvidenceCells().filter((cell) => cell.claim !== "kit.identity.admitted")
  resolved.unshift(skipCell("kit.identity.admitted", "cell:earlier-skip"))
  resolved.push(observedCell({ id: "cell:resolving", resolves: ["cell:earlier-skip"] }))
  const outcome = reduceAttempt(personalProfile, resolved)
  expect(outcome.status).toBe("reduced")
  if (outcome.status !== "reduced") return
  expect(outcome.result.claims[0]).toMatchObject({
    claim: "kit.identity.admitted",
    status: "proved",
    evidenceCellIds: ["cell:earlier-skip", "cell:resolving"],
    nonClaims: ["kit.identity.admitted", "workflow.called-revision"],
    receiptDigests: ["sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"],
  })
})
