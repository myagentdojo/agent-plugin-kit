import { expect, test } from "bun:test"
import {
  installedAdmission,
  installedPackage,
  installedPersonalQualification,
  nativeObservationLedger,
} from "./adapters/contract-subjects"
import { expectedPersonalQualification } from "./fixtures/plugin-consumer"

test("Claude Fresh-Native Evidence remains an explicit skipped Non-Claim", () => {
  const before = [...nativeObservationLedger]
  expect(nativeObservationLedger).toEqual(before)
  if (installedAdmission.kind !== "admitted") throw new Error("installed Candidate was not admitted")
  expect(installedPersonalQualification, "contract-absent: every Personal Profile field must match the accepted result").toEqual(
    expectedPersonalQualification(installedAdmission.identity, installedPackage.installedBytesSha256),
  )
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
