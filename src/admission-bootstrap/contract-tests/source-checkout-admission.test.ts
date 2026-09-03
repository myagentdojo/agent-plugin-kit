import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import type {
  AdmittedIdentity,
  AdmittedSourceCheckoutIdentity,
  SourceCheckoutAdmissionRequest,
} from "../../modules/release-and-git-engine/interface"
import { parseSourceCheckoutAdmissionRequest } from "../../modules/release-and-git-engine/serialized-values"
import { admissionBootstrap } from "../implementation/admission-bootstrap"
import { expectedAdmittedIdentity, admissionInvariantCases } from "../../../clean-fixture/personal-verification-profile/contract-tests/fixtures/admission-invariant-cases"

const commit = "1111111111111111111111111111111111111111"
const request: SourceCheckoutAdmissionRequest = {
  candidate: {
    source: { repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" }, commit },
    package: { repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" }, commit },
  },
  repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" },
  provenance: { repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" }, commit },
  source: { repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" }, commit },
  package: { repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" }, commit },
}

test("agreeing source-checkout observations admit a detached frozen identity", () => {
  const mutable = structuredClone(request)
  const result = admissionBootstrap.admitSourceCheckout(mutable)
  expect(result.kind).toBe("admitted")
  if (result.kind !== "admitted") return
  expect(result.identity).toMatchObject({ profile: "source-checkout", source: request.candidate.source, package: request.candidate.package })
  expect(Object.keys(result.identity).sort()).toEqual(["package", "profile", "source"])
  expect(Object.isFrozen(result.identity)).toBe(true)
  expect(Object.isFrozen(result.identity.source)).toBe(true)
  expect(Object.isFrozen(result.identity.source.repository)).toBe(true)
  expect(Object.isFrozen(result.identity.package)).toBe(true)
  expect(Object.isFrozen(result.identity.package.repository)).toBe(true)
  const durableIdentityDigest = createHash("sha256").update(JSON.stringify(result.identity)).digest("hex")
  mutable.candidate.source.commit = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  mutable.candidate.package.repository.origin = "https://github.com/myagentdojo/mutated.git"
  expect(result.identity.source.commit).toBe(commit)
  expect(result.identity.package.repository.origin).toBe(request.candidate.package.repository.origin)
  expect(createHash("sha256").update(JSON.stringify(result.identity)).digest("hex")).toBe(durableIdentityDigest)
})

test("source checkout refuses in deterministic precedence order", () => {
  const repository = structuredClone(request)
  repository.repository.origin = "https://github.com/myagentdojo/other.git"
  repository.provenance.commit = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  expect(admissionBootstrap.admitSourceCheckout(repository)).toMatchObject({ refusal: { code: "repository-mismatch" } })
  const provenance = structuredClone(request)
  provenance.provenance.commit = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  provenance.source.commit = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  expect(admissionBootstrap.admitSourceCheckout(provenance)).toMatchObject({ refusal: { code: "provenance-mismatch" } })
  const source = structuredClone(request)
  source.source.commit = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  source.package.commit = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  expect(admissionBootstrap.admitSourceCheckout(source)).toMatchObject({ refusal: { code: "source-pin-mismatch" } })
})

test("source checkout refuses malformed and mismatched source pins", () => {
  for (const invalid of ["short", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "gggggggggggggggggggggggggggggggggggggggg"]) {
    const invalidRequest = structuredClone(request)
    invalidRequest.candidate.source.commit = invalid
    invalidRequest.provenance.commit = invalid
    invalidRequest.source.commit = invalid
    expect(admissionBootstrap.admitSourceCheckout(invalidRequest)).toMatchObject({ refusal: { code: "source-pin-mismatch" } })
  }
})

test("source checkout refuses package origin and pin disagreement", () => {
  const origin = structuredClone(request)
  origin.candidate.package.repository.origin = "https://github.com/myagentdojo/other.git"
  origin.package.repository.origin = "https://github.com/myagentdojo/other.git"
  expect(admissionBootstrap.admitSourceCheckout(origin)).toMatchObject({ refusal: { code: "package-pin-mismatch" } })
  const pin = structuredClone(request)
  pin.candidate.package.commit = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  pin.package.commit = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  expect(admissionBootstrap.admitSourceCheckout(pin)).toMatchObject({ refusal: { code: "package-pin-mismatch" } })
  const precedence = structuredClone(request)
  precedence.source.commit = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  precedence.package.commit = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  expect(admissionBootstrap.admitSourceCheckout(precedence)).toMatchObject({ refusal: { code: "source-pin-mismatch" } })
})

test("source checkout serialization is strict and excludes released fields", () => {
  expect(parseSourceCheckoutAdmissionRequest({ ...request, release: {} })).toBeUndefined()
  expect(parseSourceCheckoutAdmissionRequest({ ...request, workflow: {} })).toBeUndefined()
})

test("released and source-checkout identities stay distinct at compile time", () => {
  const nonAssignable: [
    AdmittedSourceCheckoutIdentity extends AdmittedIdentity ? false : true,
    AdmittedIdentity extends AdmittedSourceCheckoutIdentity ? false : true,
  ] = [true, true]
  void nonAssignable
  expect(Object.keys(admissionBootstrap).sort()).toEqual(["admit", "admitSourceCheckout"])
  const released = admissionBootstrap.admit(admissionInvariantCases[0]!.request)
  expect(released).toEqual({ kind: "admitted", identity: expectedAdmittedIdentity })
  expect(JSON.stringify(released)).toBe(JSON.stringify({ kind: "admitted", identity: expectedAdmittedIdentity }))
})
