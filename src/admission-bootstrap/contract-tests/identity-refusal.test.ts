import { expect, test } from "bun:test"
import "../interface"
import { createAdmissionContractHarness } from "./adapters/admission-contract-harness"
import { admissionInvariantCases } from "../../../clean-fixture/personal-verification-profile/contract-tests/fixtures/admission-invariant-cases"

function assertRefusal(index: 1 | 2 | 3 | 4 | 5 | 6) {
  const invariantCase = admissionInvariantCases[index]
  const harness = createAdmissionContractHarness()
  const actual = harness.bootstrap?.admit(invariantCase.request)

  expect(
    actual,
    `contract-absent: ${invariantCase.id} must return its structured refusal`,
  ).toEqual({
    kind: "refused",
    refusal: {
      code:
        invariantCase.expected.kind === "refused"
          ? invariantCase.expected.code
          : "repository-mismatch",
      nextAction: "Correct the mismatched immutable identity observation.",
    },
  })
}

test("repository mismatch fails closed", () => assertRefusal(1))
test("provenance mismatch fails closed", () => assertRefusal(2))
test("source pin mismatch fails closed", () => assertRefusal(3))
test("release pin mismatch fails closed", () => assertRefusal(4))
test("package pin mismatch fails closed", () => assertRefusal(5))
test("workflow pin mismatch fails closed", () => assertRefusal(6))
