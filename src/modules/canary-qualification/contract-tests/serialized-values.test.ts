import { expect, test } from "bun:test"
import type {
  CanaryCandidate,
  CanaryPlan,
  CanaryResult,
} from "../interface"
import type { CandidateIdentity } from "../../release-and-git-engine/interface"
import {
  parseCanaryAuthorityReference,
  parseCanaryCandidate,
  parseCanaryPlan,
  parseCanaryResult,
  serializeCanaryAuthorityReference,
  serializeCanaryCandidate,
  serializeCanaryPlan,
  serializeCanaryResult,
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

const canary: CanaryCandidate = {
  identity: candidate,
  inertPayloadSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
}

const plan: CanaryPlan = {
  candidate,
  target: "github://myagentdojo/example-plugin",
  immutableReference: "refs/tags/v1.0.0",
}

const result: CanaryResult = {
  candidate,
  hostedRunId: "run-123",
  installedPayloadSha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
}

test("Canary Qualification serialized values make exact JSON round trips", () => {
  expect(parseCanaryAuthorityReference(JSON.parse(serializeCanaryAuthorityReference("/protected/authority")))).toBe("/protected/authority")
  expect(parseCanaryCandidate(JSON.parse(serializeCanaryCandidate(canary)))).toEqual(canary)
  expect(parseCanaryPlan(JSON.parse(serializeCanaryPlan(plan)))).toEqual(plan)
  expect(parseCanaryResult(JSON.parse(serializeCanaryResult(result)))).toEqual(result)
})

test("Canary Qualification ingress is strict and does not interpret authority contents", () => {
  expect(parseCanaryAuthorityReference({ authority: true })).toBeUndefined()
  expect(parseCanaryCandidate({ ...canary, extra: true })).toBeUndefined()
  expect(parseCanaryCandidate({ ...canary, identity: { ...candidate, source: undefined } })).toBeUndefined()
  expect(parseCanaryPlan({ ...plan, target: 42 })).toBeUndefined()
  expect(parseCanaryResult({ ...result, installedPayloadSha256: "not-a-digest" })).toBeUndefined()
})

test("Canary Qualification egress rejects undefined, unknown keys, and capability-shaped authority", () => {
  expect(() => serializeCanaryAuthorityReference(undefined as never)).toThrow(
    "canary-qualification: invalid serialized value",
  )
  expect(() => serializeCanaryCandidate({ ...canary, authority: {} } as never)).toThrow(
    "canary-qualification: invalid serialized value",
  )
  expect(() => serializeCanaryPlan({ ...plan, immutableReference: undefined } as never)).toThrow(
    "canary-qualification: invalid serialized value",
  )
})
