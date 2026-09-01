import { expect, test } from "bun:test"
import {
  hostedEffectLedger,
  installedAdmission,
  installedPublicQualification,
} from "../../personal-verification-profile/contract-tests/adapters/contract-subjects"
import { expectedPublicQualification } from "../../personal-verification-profile/contract-tests/fixtures/plugin-consumer"

test("local installation evidence cannot promote a hosted workflow claim", () => {
  const before = [...hostedEffectLedger]
  expect(hostedEffectLedger).toEqual(before)
  if (installedAdmission.kind !== "admitted") throw new Error("installed Candidate was not admitted")
  expect(installedPublicQualification, "contract-absent: every Public Profile field must match the accepted result").toEqual(
    expectedPublicQualification(installedAdmission.identity),
  )
})

test("hosted evidence cannot promote a Fresh-Native claim", () => {
  const before = [...hostedEffectLedger]
  const actual = installedPublicQualification.status === "reduced"
    ? installedPublicQualification.result
    : undefined

  expect(hostedEffectLedger).toEqual(before)
  const claim = actual?.claims.find((item) => item.claim === "harness.codex.fresh-native")
  expect(claim, "contract-absent: hosted and Fresh-Native proof must remain incomparable").toMatchObject({ status: "unknown" })
  expect(actual?.nonClaims).toContain("harness.codex.fresh-native")
})
