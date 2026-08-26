import { expect, test } from "bun:test"
import type {
  EvidenceCell,
  QualificationEvidence,
  VerificationProfile,
} from "../interface"
import {
  candidate,
  candidateDigest,
  observedCell,
  personalEvidenceCells,
  personalProfile,
  skipCell,
} from "./fixtures/evidence-cells"

const qualificationEvidence: QualificationEvidence | undefined = undefined

function reduceAttempt(profile: VerificationProfile, cells: readonly EvidenceCell[]) {
  if (!qualificationEvidence) return { kind: "contract-absent" } as const
  try {
    return { kind: "result", value: qualificationEvidence.reduce({ candidate, profile, cells }) } as const
  } catch (error) {
    return { kind: "refused", message: error instanceof Error ? error.message : String(error) } as const
  }
}

test("canonical Candidate Lineage agreement reduces to proved", () => {
  const actual = reduceAttempt(personalProfile, personalEvidenceCells())
  expect(actual, "contract-absent: canonical lineage must reduce to proved").toMatchObject({
    kind: "result",
    value: { counts: { selected: 8, covered: 6, skipped: 2, proved: 6 } },
  })
})

test("Candidate Identity digest disagreement is refused", () => {
  const cells = personalEvidenceCells()
  cells[0] = observedCell({
    lineage: {
      ...observedCell().lineage,
      candidateIdentitySha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    },
  })
  expect(reduceAttempt(personalProfile, cells), "contract-absent: candidate digest mismatch must refuse").toMatchObject({ kind: "refused" })
})

test("Candidate Identity component disagreement is refused", () => {
  const cells = personalEvidenceCells()
  cells[0] = observedCell({
    lineage: {
      ...observedCell().lineage,
      source: { ...candidate.source, commit: "2222222222222222222222222222222222222222" },
    },
  })
  expect(reduceAttempt(personalProfile, cells), "contract-absent: lineage component mismatch must refuse").toMatchObject({ kind: "refused" })
})

test("installed payload disagreement for one candidate is refused", () => {
  const cells = personalEvidenceCells()
  cells[0] = observedCell({
    id: "cell:first",
    lineage: { ...observedCell().lineage, installedPayloadSha256: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
  })
  const second = observedCell({
    id: "cell:second",
    lineage: { ...observedCell().lineage, installedPayloadSha256: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" },
  })
  expect(reduceAttempt(personalProfile, [...cells, second]), "contract-absent: installed bytes must agree per candidate").toMatchObject({ kind: "refused" })
})

test("receipt binding uses the canonical Candidate Identity digest", () => {
  const cells = personalEvidenceCells()
  cells[0] = observedCell({
    receipt: {
      ...observedCell().receipt!,
      candidateIdentitySha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    },
  })
  expect(candidateDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
  expect(reduceAttempt(personalProfile, cells), "contract-absent: receipt candidate binding must refuse drift").toMatchObject({ kind: "refused" })
})

test("zero-cell selected claim is refused", () => {
  expect(reduceAttempt(personalProfile, []), "contract-absent: uncovered claims need one explicit skip").toMatchObject({ kind: "refused" })
})

test("cell outside the selected profile is refused", () => {
  const cell = observedCell({ id: "cell:outside", claim: "release.identity.published" })
  expect(reduceAttempt(personalProfile, [...personalEvidenceCells(), cell]), "contract-absent: out-of-profile evidence must refuse").toMatchObject({ kind: "refused" })
})

test("explicit resolution preserves earlier identifiers and receipts", () => {
  const cells = personalEvidenceCells()
  const skipped = skipCell("kit.identity.admitted", "cell:earlier-skip")
  const resolving = observedCell({ id: "cell:resolving", resolves: ["cell:earlier-skip"] })
  const actual = reduceAttempt(personalProfile, [skipped, resolving, ...cells.slice(1)])
  const claim = actual.kind === "result"
    ? actual.value.claims.find((item) => item.claim === "kit.identity.admitted")
    : undefined
  expect(claim, "contract-absent: explicit resolution must preserve audit identity").toMatchObject({
    status: "proved",
    evidenceCellIds: ["cell:earlier-skip", "cell:resolving"],
  })
  const receiptDigests = actual.kind === "result" ? actual.value.receiptDigests : undefined
  expect(receiptDigests).toContain("sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc")
})
