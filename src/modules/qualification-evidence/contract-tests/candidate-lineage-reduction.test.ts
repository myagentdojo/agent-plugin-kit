import { expect, test } from "bun:test"
import type {
  EvidenceCell,
  QualificationOutcome,
  VerificationProfile,
} from "../interface"
import { qualificationEvidence } from "../implementation/qualification-evidence"
import {
  candidate,
  candidateDigest,
  observedCell,
  personalEvidenceCells,
  personalProfile,
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

test("canonical Candidate Lineage reduction preserves profile order and evidence metadata", () => {
  const outcome = reduceAttempt(personalProfile, personalEvidenceCells())
  expect(outcome.status).toBe("reduced")
  if (outcome.status !== "reduced") return

  expect(outcome.result.claims.map(({ claim }) => claim)).toEqual(
    personalProfile.requirements.map(({ claim }) => claim),
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
  expect(candidateDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
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
