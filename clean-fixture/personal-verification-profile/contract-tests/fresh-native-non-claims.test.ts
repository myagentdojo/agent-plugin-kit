import { expect, test } from "bun:test"
import {
  installedPersonalQualification,
  nativeObservationLedger,
} from "./adapters/contract-subjects"

test("Claude Fresh-Native Evidence remains an explicit skipped Non-Claim", () => {
  const before = [...nativeObservationLedger]
  const actual = installedPersonalQualification.status === "reduced"
    ? installedPersonalQualification.result
    : undefined

  expect(nativeObservationLedger).toEqual(before)
  expect(actual?.counts, "contract-absent: the Personal Profile selection and skip counts must remain exact").toMatchObject({ selected: 8, skipped: 2 })
  expect(actual?.nonClaims, "contract-absent: Claude native proof must remain explicitly skipped").toContain("harness.claude.fresh-native")
})

test("Codex Fresh-Native Evidence remains an explicit skipped Non-Claim", () => {
  const before = [...nativeObservationLedger]
  const actual = installedPersonalQualification.status === "reduced"
    ? installedPersonalQualification.result
    : undefined

  expect(nativeObservationLedger).toEqual(before)
  expect(actual?.counts, "contract-absent: the Personal Profile selection and skip counts must remain exact").toMatchObject({ selected: 8, skipped: 2 })
  expect(actual?.nonClaims, "contract-absent: Codex native proof must remain explicitly skipped").toContain("harness.codex.fresh-native")
})
