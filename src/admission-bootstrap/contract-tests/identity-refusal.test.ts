import { expect, test } from "bun:test"
import "../interface"
import { createAdmissionContractHarness } from "./adapters/admission-contract-harness"
import { admissionInvariantCases } from "../../../clean-fixture/personal-verification-profile/contract-tests/fixtures/admission-invariant-cases"
import type {
  AdmissionRefusal,
  AdmissionRequest,
} from "../../modules/release-and-git-engine/interface"

type CandidatePinOwner = "release" | "package" | "workflow"

const alternateFullCommitPin = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

function assertRequestRefusal(
  request: AdmissionRequest,
  code: AdmissionRefusal["code"],
  label: string,
) {
  const harness = createAdmissionContractHarness()
  const actual = harness.bootstrap?.admit(request)

  expect(actual, `contract-absent: ${label} must return its structured refusal`).toEqual({
    kind: "refused",
    refusal: {
      code,
      nextAction: "Correct the mismatched immutable identity observation.",
    },
  })
}

function assertRefusal(index: 1 | 2 | 3 | 4 | 5 | 6) {
  const invariantCase = admissionInvariantCases[index]
  const code =
    invariantCase.expected.kind === "refused"
      ? invariantCase.expected.code
      : "repository-mismatch"
  assertRequestRefusal(invariantCase.request, code, invariantCase.id)
}

function assertCandidateSourcePinMismatch(
  owner: CandidatePinOwner,
  code: AdmissionRefusal["code"],
) {
  const request = structuredClone(admissionInvariantCases[0].request)
  Object.assign(request.candidate[owner], { commit: alternateFullCommitPin })
  Object.assign(request[owner], { commit: alternateFullCommitPin })
  assertRequestRefusal(request, code, `${owner} agrees with its observation but not Candidate Source`)
}

test("repository mismatch fails closed", () => assertRefusal(1))
test("provenance mismatch fails closed", () => assertRefusal(2))
test("source pin mismatch fails closed", () => {
  assertRefusal(3)

  const sourceRepositoryMismatch = structuredClone(admissionInvariantCases[0].request)
  Object.assign(sourceRepositoryMismatch, {
    source: {
      ...sourceRepositoryMismatch.source,
      repository: { origin: "https://github.com/myagentdojo/other-plugin.git" },
    },
  })
  assertRequestRefusal(
    sourceRepositoryMismatch,
    "source-pin-mismatch",
    "source repository mismatch",
  )
})
test("release pin mismatch fails closed", () => {
  assertRefusal(4)
  assertCandidateSourcePinMismatch("release", "release-pin-mismatch")
})
test("package pin mismatch fails closed", () => {
  assertRefusal(5)
  assertCandidateSourcePinMismatch("package", "package-pin-mismatch")
})
test("workflow pin mismatch fails closed", () => {
  assertRefusal(6)
  assertCandidateSourcePinMismatch("workflow", "workflow-pin-mismatch")
})
