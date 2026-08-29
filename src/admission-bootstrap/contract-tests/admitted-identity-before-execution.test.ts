import { expect, test } from "bun:test"
import "../interface"
import { createAdmissionContractHarness } from "./adapters/admission-contract-harness"
import {
  admissionInvariantCases,
  expectedAdmittedIdentity,
} from "../../../clean-fixture/personal-verification-profile/contract-tests/fixtures/admission-invariant-cases"

const agreeing = admissionInvariantCases[0]

function requestWithCompletePin(commit: string) {
  const request = structuredClone(agreeing.request)

  Object.assign(request.candidate.source, { commit })
  Object.assign(request.provenance, { commit })
  Object.assign(request.source, { commit })
  Object.assign(request.candidate.release, { commit })
  Object.assign(request.release, { commit })
  Object.assign(request.candidate.package, { commit })
  Object.assign(request.package, { commit })
  Object.assign(request.candidate.workflow, { commit })
  Object.assign(request.workflow, { commit })

  return request
}

test("identity-agrees returns the literal Admitted Identity", () => {
  const harness = createAdmissionContractHarness()
  const request = structuredClone(agreeing.request)
  const actual = harness.bootstrap?.admit(request)

  expect(
    actual,
    "contract-absent: Admission Bootstrap must return the admitted Candidate Identity",
  ).toEqual({ kind: "admitted", identity: expectedAdmittedIdentity })

  expect(actual?.kind).toBe("admitted")
  if (actual?.kind !== "admitted") return

  expect(Object.isFrozen(actual.identity)).toBe(true)
  expect(Object.isFrozen(actual.identity.source)).toBe(true)
  expect(Object.isFrozen(actual.identity.source.repository)).toBe(true)
  expect(Object.isFrozen(actual.identity.release)).toBe(true)
  expect(Object.isFrozen(actual.identity.package)).toBe(true)
  expect(Object.isFrozen(actual.identity.package.repository)).toBe(true)
  expect(Object.isFrozen(actual.identity.workflow)).toBe(true)
  expect(Object.isFrozen(actual.identity.workflow.repository)).toBe(true)

  expect(Object.isFrozen(request.candidate.source)).toBe(false)
  expect(Object.isFrozen(request.candidate.source.repository)).toBe(false)
  expect(Object.isFrozen(request.candidate.release)).toBe(false)
  expect(Object.isFrozen(request.candidate.package)).toBe(false)
  expect(Object.isFrozen(request.candidate.package.repository)).toBe(false)
  expect(Object.isFrozen(request.candidate.workflow)).toBe(false)
  expect(Object.isFrozen(request.candidate.workflow.repository)).toBe(false)

  Object.assign(request.candidate.source, {
    commit: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  })
  Object.assign(request.candidate.source.repository, {
    origin: "https://github.com/myagentdojo/mutated-plugin.git",
  })
  Object.assign(request.candidate.release, {
    reference: "v9.9.9",
    commit: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  })
  Object.assign(request.candidate.package, {
    commit: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  })
  Object.assign(request.candidate.package.repository, {
    origin: "https://github.com/myagentdojo/mutated-package.git",
  })
  Object.assign(request.candidate.workflow, {
    path: ".github/workflows/mutated.yml",
    commit: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  })
  Object.assign(request.candidate.workflow.repository, {
    origin: "https://github.com/myagentdojo/mutated-workflow.git",
  })
  expect(actual.identity).toEqual(expectedAdmittedIdentity)

  for (const invalidCompletePin of [
    "abc123",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "gggggggggggggggggggggggggggggggggggggggg",
  ]) {
    const invalidPinResult = harness.bootstrap?.admit(requestWithCompletePin(invalidCompletePin))
    expect(invalidPinResult?.kind).toBe("refused")
    if (invalidPinResult?.kind === "refused") {
      expect(invalidPinResult.refusal.code).toBe("source-pin-mismatch")
    }
  }
})

test("admission completes before any maintenance execution", () => {
  const harness = createAdmissionContractHarness()
  const before = harness.durableDigest()

  const actual = harness.bootstrap?.admit(agreeing.request)

  expect(harness.durableDigest()).toBe(before)
  expect(
    actual,
    "contract-absent: dependency-free Admission must complete before maintenance execution",
  ).toEqual({ kind: "admitted", identity: expectedAdmittedIdentity })
})
