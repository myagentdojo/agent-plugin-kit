import { expect, test } from "bun:test"
import {
  hostedEffectLedger,
  qualificationEvidence,
} from "../../personal-verification-profile/contract-tests/adapters/contract-subjects"
import { admittedCandidate } from "../../personal-verification-profile/contract-tests/fixtures/admission-invariant-cases"
import {
  publicProfile,
  publicProfileCells,
} from "../../personal-verification-profile/contract-tests/fixtures/profile-cells"

test("local installation evidence cannot promote a hosted workflow claim", () => {
  const before = [...hostedEffectLedger]
  const actual = qualificationEvidence?.reduce({ candidate: admittedCandidate, profile: publicProfile, cells: publicProfileCells() })

  expect(hostedEffectLedger).toEqual(before)
  const claim = actual?.claims.find((item) => item.claim === "workflow.called-revision")
  expect(claim, "contract-absent: hosted workflow evidence must stay unknown without the P8 hosted Adapter owner").toMatchObject({ status: "unknown", actualProofLayer: null })
  expect(actual?.counts).toMatchObject({ selected: 11, skipped: 7 })
})

test("hosted evidence cannot promote a Fresh-Native claim", () => {
  const before = [...hostedEffectLedger]
  const actual = qualificationEvidence?.reduce({ candidate: admittedCandidate, profile: publicProfile, cells: publicProfileCells() })

  expect(hostedEffectLedger).toEqual(before)
  const claim = actual?.claims.find((item) => item.claim === "harness.codex.fresh-native")
  expect(claim, "contract-absent: hosted and Fresh-Native proof must remain incomparable").toMatchObject({ status: "unknown" })
  expect(actual?.nonClaims).toContain("harness.codex.fresh-native")
})
