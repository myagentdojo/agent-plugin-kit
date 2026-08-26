import { expect, test } from "bun:test"
import { qualificationEvidence, nativeObservationLedger } from "./adapters/contract-subjects"
import { admittedCandidate } from "./fixtures/admission-invariant-cases"
import {
  personalProfile,
  personalProfileCells,
} from "./fixtures/profile-cells"

test("Claude Fresh-Native Evidence remains an explicit skipped Non-Claim", () => {
  const before = [...nativeObservationLedger]
  const actual = qualificationEvidence?.reduce({ candidate: admittedCandidate, profile: personalProfile, cells: personalProfileCells() })

  expect(nativeObservationLedger).toEqual(before)
  expect(actual, "contract-absent: Claude native proof must remain explicitly skipped").toMatchObject({ counts: { selected: 8, skipped: 2 }, nonClaims: expect.arrayContaining(["harness.claude.fresh-native"]) })
})

test("Codex Fresh-Native Evidence remains an explicit skipped Non-Claim", () => {
  const before = [...nativeObservationLedger]
  const actual = qualificationEvidence?.reduce({ candidate: admittedCandidate, profile: personalProfile, cells: personalProfileCells() })

  expect(nativeObservationLedger).toEqual(before)
  expect(actual, "contract-absent: Codex native proof must remain explicitly skipped").toMatchObject({ counts: { selected: 8, skipped: 2 }, nonClaims: expect.arrayContaining(["harness.codex.fresh-native"]) })
})
