import { expect, test } from "bun:test"
import "../interface"
import { createAdmissionContractHarness } from "./adapters/admission-contract-harness"
import { admissionInvariantCases } from "../../../clean-fixture/personal-verification-profile/contract-tests/fixtures/admission-invariant-cases"
import type {
  AdmissionRefusal,
  AdmissionRequest,
} from "../../modules/release-and-git-engine/interface"

type CandidatePinOwner = "release" | "package" | "workflow"
type ObservationOwner = "provenance" | "source" | "release" | "package" | "workflow"

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

function assertAdjacentPrecedence(
  earlierIndex: 1 | 2 | 3 | 4 | 5,
  laterIndex: 2 | 3 | 4 | 5 | 6,
  laterOwner: ObservationOwner,
  code: AdmissionRefusal["code"],
) {
  const request = structuredClone(admissionInvariantCases[earlierIndex].request)
  const laterRequest = admissionInvariantCases[laterIndex].request
  Object.assign(request, { [laterOwner]: structuredClone(laterRequest[laterOwner]) })
  assertRequestRefusal(request, code, `${code} precedes ${laterOwner}`)
}

test("repository mismatch fails closed", () => {
  assertRefusal(1)
  assertAdjacentPrecedence(1, 2, "provenance", "repository-mismatch")
})
test("provenance mismatch fails closed", () => {
  assertRefusal(2)
  assertAdjacentPrecedence(2, 3, "source", "provenance-mismatch")
})
test("source pin mismatch fails closed", () => {
  assertRefusal(3)
  assertAdjacentPrecedence(3, 4, "release", "source-pin-mismatch")

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
  assertAdjacentPrecedence(4, 5, "package", "release-pin-mismatch")
  assertCandidateSourcePinMismatch("release", "release-pin-mismatch")
})
test("package pin mismatch fails closed", () => {
  assertRefusal(5)
  assertAdjacentPrecedence(5, 6, "workflow", "package-pin-mismatch")
  assertCandidateSourcePinMismatch("package", "package-pin-mismatch")
})
test("workflow pin mismatch fails closed", () => {
  assertRefusal(6)
  assertCandidateSourcePinMismatch("workflow", "workflow-pin-mismatch")
})
