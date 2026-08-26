import { expect, test } from "bun:test"
import "../interface"
import { createAdmissionContractHarness } from "./adapters/admission-contract-harness"
import {
  admissionInvariantCases,
  expectedAdmittedIdentity,
} from "../../../clean-fixture/personal-verification-profile/contract-tests/fixtures/admission-invariant-cases"

const agreeing = admissionInvariantCases[0]

test("identity-agrees returns the literal Admitted Identity", () => {
  const harness = createAdmissionContractHarness()
  const actual = harness.bootstrap?.admit(agreeing.request)

  expect(
    actual,
    "contract-absent: Admission Bootstrap must return the admitted Candidate Identity",
  ).toEqual({ kind: "admitted", identity: expectedAdmittedIdentity })
})

test("admission completes before any maintenance execution", () => {
  const harness = createAdmissionContractHarness()
  const before = harness.durableDigest()

  const actual = harness.bootstrap?.admit(agreeing.request)

  expect(harness.importedOwners).toEqual([])
  expect(harness.durableDigest()).toBe(before)
  expect(
    actual,
    "contract-absent: dependency-free Admission must complete before maintenance execution",
  ).toEqual({ kind: "admitted", identity: expectedAdmittedIdentity })
})
