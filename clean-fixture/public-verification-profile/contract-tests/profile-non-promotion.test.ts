import { expect, test } from "bun:test"
import {
  hostedEffectLedger,
  installedPublicQualification,
} from "../../personal-verification-profile/contract-tests/adapters/contract-subjects"

test("local installation evidence cannot promote a hosted workflow claim", () => {
  const before = [...hostedEffectLedger]
  const actual = installedPublicQualification.status === "reduced"
    ? installedPublicQualification.result
    : undefined

  expect(hostedEffectLedger).toEqual(before)
  const claim = actual?.claims.find((item) => item.claim === "workflow.called-revision")
  expect(claim, "contract-absent: hosted workflow evidence must stay unknown without hosted Reusable Workflow Adapter proof").toMatchObject({ status: "unknown", actualProofLayer: null })
  expect(actual?.counts).toMatchObject({ selected: 11, skipped: 7 })
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
