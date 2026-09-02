import { expect, test } from "bun:test"
import type {
  AdmissionRefusal,
  AdmissionRequest,
  CandidateIdentity,
  PackageObservation,
  ReleaseCandidateApproval,
  ReleaseMutationRequest,
  ReleasePlan,
  ReleaseRequest,
  ReleaseResult,
} from "../interface"
import {
  parseAdmissionRefusal,
  parseAdmissionRequest,
  parseCandidateIdentity,
  parsePackageObservation,
  parseReleaseCandidateApproval,
  parseReleaseMutationRequest,
  parseReleasePlan,
  parseReleaseRequest,
  parseReleaseResult,
  serializeAdmissionRefusal,
  serializeAdmissionRequest,
  serializeCandidateIdentity,
  serializePackageObservation,
  serializeReleaseCandidateApproval,
  serializeReleaseMutationRequest,
  serializeReleasePlan,
  serializeReleaseRequest,
  serializeReleaseResult,
} from "../serialized-values"

const candidate: CandidateIdentity = {
  source: {
    repository: { origin: "https://github.com/myagentdojo/example-plugin.git" },
    commit: "1111111111111111111111111111111111111111",
  },
  release: {
    reference: "refs/tags/v1.0.0",
    commit: "1111111111111111111111111111111111111111",
  },
  package: {
    repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" },
    commit: "1111111111111111111111111111111111111111",
  },
  workflow: {
    repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" },
    path: ".github/workflows/plugin-maintenance.yml",
    commit: "1111111111111111111111111111111111111111",
  },
}

const approval: ReleaseCandidateApproval = {
  schemaVersion: 1,
  issuer: "release-and-git-engine",
  candidate,
  candidateIdentitySha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  inspectedStateSha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  expectedEffectsSha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  digest: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
}

const values: readonly [
  AdmissionRequest,
  AdmissionRefusal,
  CandidateIdentity,
  PackageObservation,
  ReleaseCandidateApproval,
  ReleaseMutationRequest,
  ReleasePlan,
  ReleaseRequest,
  ReleaseResult,
] = [
  {
    candidate,
    repository: candidate.package.repository,
    provenance: candidate.source,
    source: candidate.source,
    release: candidate.release,
    package: candidate.package,
    workflow: candidate.workflow,
  },
  { code: "repository-mismatch", nextAction: "Correct the mismatched immutable identity observation." },
  candidate,
  { identity: candidate.package, payloadSha256: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
  approval,
  { candidate, intent: "maintenance", expectedEffectIds: ["effect:release"] },
  { candidate, expectedEffectIds: ["effect:release"], approvalDigest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" },
  { candidate, intent: "maintenance" },
  { candidate, completedEffectIds: ["effect:release"], remainingEffectIds: [] },
]

test("Release and Git Engine serialized values make exact JSON round trips", () => {
  const serialized = [
    serializeAdmissionRequest(values[0]),
    serializeAdmissionRefusal(values[1]),
    serializeCandidateIdentity(values[2]),
    serializePackageObservation(values[3]),
    serializeReleaseCandidateApproval(values[4]),
    serializeReleaseMutationRequest(values[5]),
    serializeReleasePlan(values[6]),
    serializeReleaseRequest(values[7]),
    serializeReleaseResult(values[8]),
  ]
  const parsed = [
    parseAdmissionRequest(JSON.parse(serialized[0]!)),
    parseAdmissionRefusal(JSON.parse(serialized[1]!)),
    parseCandidateIdentity(JSON.parse(serialized[2]!)),
    parsePackageObservation(JSON.parse(serialized[3]!)),
    parseReleaseCandidateApproval(JSON.parse(serialized[4]!)),
    parseReleaseMutationRequest(JSON.parse(serialized[5]!)),
    parseReleasePlan(JSON.parse(serialized[6]!)),
    parseReleaseRequest(JSON.parse(serialized[7]!)),
    parseReleaseResult(JSON.parse(serialized[8]!)),
  ]
  expect([...parsed]).toEqual([...values])
})

test("Release and Git Engine ingress is strict and preserves independent approval versioning", () => {
  expect(parseCandidateIdentity({ ...candidate, extra: true })).toBeUndefined()
  expect(parseCandidateIdentity({ ...candidate, source: { ...candidate.source, commit: 7 } })).toBeUndefined()
  expect(parseReleaseRequest({ ...values[7], intent: "publish" })).toBeUndefined()
  expect(parseReleaseCandidateApproval({ ...approval, schemaVersion: 2 })).toBeUndefined()
  expect(parseReleaseCandidateApproval({ ...approval, candidate: { ...candidate, workflow: { ...candidate.workflow, commit: "2222222222222222222222222222222222222222" } } })).toBeUndefined()
})

test("Release and Git Engine egress rejects undefined and non-JSON values without raw detail", () => {
  const invalid = { ...candidate, workflow: { ...candidate.workflow, path: undefined } }
  expect(parseCandidateIdentity(invalid)).toBeUndefined()
  expect(() => serializeCandidateIdentity(invalid as unknown as CandidateIdentity)).toThrow(
    "release-and-git-engine: invalid serialized value",
  )
  expect(() => serializeReleaseResult({
    ...values[8],
    completedEffectIds: ["effect:release", undefined],
  } as unknown as ReleaseResult)).toThrow("release-and-git-engine: invalid serialized value")
})
