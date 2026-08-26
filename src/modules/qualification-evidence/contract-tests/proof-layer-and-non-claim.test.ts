import { expect, test } from "bun:test"
import type { EvidenceCell, QualificationEvidence, VerificationProfile } from "../interface"
import {
  candidate,
  observedCell,
  personalEvidenceCells,
  personalProfile,
  publicEvidenceCells,
  publicProfile,
} from "./fixtures/evidence-cells"

const qualificationEvidence: QualificationEvidence | undefined = undefined

function reduceAttempt(profile: VerificationProfile, cells: readonly EvidenceCell[]) {
  if (!qualificationEvidence) return undefined
  return qualificationEvidence.reduce({ candidate, profile, cells })
}

test("Proof Layer satisfaction is reflexive", () => {
  const actual = reduceAttempt(personalProfile, personalEvidenceCells())
  const claim = actual?.claims.find((item) => item.claim === "kit.identity.admitted")
  expect(claim, "contract-absent: clean-fixture must satisfy itself").toMatchObject({ status: "proved", actualProofLayer: "clean-fixture" })
})

test("clean-fixture satisfies public-process and in-process", () => {
  const cells = personalEvidenceCells()
  cells[5] = observedCell({ id: "cell:runtime-clean", claim: "runtime.supported-platform", actualProofLayer: "clean-fixture" })
  const actual = reduceAttempt(personalProfile, cells)
  const claim = actual?.claims.find((item) => item.claim === "runtime.supported-platform")
  expect(claim, "contract-absent: clean-fixture must satisfy public-process and in-process").toMatchObject({ status: "proved", actualProofLayer: "clean-fixture" })
})

test("hosted cannot satisfy fresh-native", () => {
  const cells = personalEvidenceCells()
  cells[6] = observedCell({ id: "cell:claude-hosted", claim: "harness.claude.fresh-native", actualProofLayer: "hosted" })
  const actual = reduceAttempt(personalProfile, cells)
  const hostedForNative = actual?.claims.find((item) => item.claim === "harness.claude.fresh-native")
  expect(hostedForNative, "contract-absent: hosted cannot satisfy fresh-native").toMatchObject({ status: "not-proved", actualProofLayer: "hosted" })

  const publicCells = publicEvidenceCells()
  publicCells[7] = observedCell({
    id: "cell:workflow-native",
    claim: "workflow.called-revision",
    actualProofLayer: "fresh-native",
    lineage: {
      ...observedCell().lineage,
      hostedRun: {
        provider: "github-actions",
        repository: candidate.source.repository,
        runId: "12345",
        attempt: 1,
        headCommit: candidate.source.commit,
      },
    },
  })
  const publicActual = reduceAttempt(publicProfile, publicCells)
  const nativeForHosted = publicActual?.claims.find((item) => item.claim === "workflow.called-revision")
  expect(nativeForHosted, "contract-absent: fresh-native cannot satisfy hosted").toMatchObject({ status: "not-proved", actualProofLayer: "fresh-native" })
})

test("insufficient layer never promotes a mechanics observation", () => {
  const cells = personalEvidenceCells()
  cells[0] = observedCell({ id: "cell:admitted-process", actualProofLayer: "public-process" })
  const actual = reduceAttempt(personalProfile, cells)
  const claim = actual?.claims.find((item) => item.claim === "kit.identity.admitted")
  expect(claim, "contract-absent: lower-layer mechanics must remain not-proved").toMatchObject({ status: "not-proved", actualProofLayer: "public-process" })
})

test("skip accounting preserves selected covered and skipped counts", () => {
  const actual = reduceAttempt(personalProfile, personalEvidenceCells())
  expect(actual, "contract-absent: every uncovered claim must retain one Skip Rationale").toMatchObject({ counts: { selected: 8, covered: 6, skipped: 2, proved: 6, notProved: 0, unknown: 0 } })
})

test("Non-Claims and receipt digests survive reduction without raw receipt content", () => {
  const actual = reduceAttempt(personalProfile, personalEvidenceCells())
  expect(actual, "contract-absent: reduction must retain bounded Non-Claims and receipt digests").toMatchObject({
    nonClaims: expect.arrayContaining(["workflow.called-revision", "harness.claude.fresh-native", "harness.codex.fresh-native"]),
    receiptDigests: expect.arrayContaining(["sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"]),
  })
  expect(JSON.stringify(actual ?? {})).not.toContain("raw")
})
