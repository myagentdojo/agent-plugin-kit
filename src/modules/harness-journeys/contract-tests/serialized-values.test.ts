import { expect, test } from "bun:test"
import type {
  ClaudeApplyResult,
  ClaudeInspection,
  ClaudeTransitionApproval,
  CodexApplyResult,
  CodexInspection,
  CodexTransitionApproval,
} from "../interface"
import type { CandidateIdentity } from "../../release-and-git-engine/interface"
import type { PreparedPluginPayload } from "../../plugin-payload-production/interface"
import {
  parseClaudeInspection,
  parseClaudeTransitionApproval,
  parseClaudeWireRequest,
  parseCodexInspection,
  parseCodexTransitionApproval,
  parseCodexWireRequest,
  parseClaudeApplyResult,
  parseCodexApplyResult,
  serializeClaudeInspection,
  serializeClaudeTransitionApproval,
  serializeClaudeWireRequest,
  serializeCodexInspection,
  serializeCodexTransitionApproval,
  serializeCodexWireRequest,
  serializeClaudeApplyResult,
  serializeCodexApplyResult,
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

const payload: PreparedPluginPayload = {
  regularFiles: [".claude-plugin/plugin.json"],
  payloadSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
}

const claudeWire = {
  candidate,
  payload,
  profileIdentity: "claude-profile",
} as const

const codexWire = {
  ...claudeWire,
  checkoutIdentity: "checkout-b",
} as const

const claudeInspection: ClaudeInspection = {
  candidate,
  profileIdentity: "claude-profile",
  expectedEffectIds: ["effect:claude"],
}

const codexInspection: CodexInspection = {
  ...claudeInspection,
  checkoutIdentity: "checkout-b",
}

const claudeApproval: ClaudeTransitionApproval = {
  schemaVersion: 1,
  issuer: "harness-journeys:claude",
  candidate,
  candidateIdentitySha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  inspectedStateSha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  expectedEffectsSha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  digest: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
}

const codexApproval: CodexTransitionApproval = {
  ...claudeApproval,
  issuer: "harness-journeys:codex",
}

const claudeResult: ClaudeApplyResult = {
  completedEffectIds: ["effect:claude"],
  remainingEffectIds: [],
}

const codexResult: CodexApplyResult = {
  ...claudeResult,
  freshTaskCommand: ["task", "refresh"],
}

test("Harness Journeys serialized values make exact JSON round trips", () => {
  expect(parseClaudeWireRequest(JSON.parse(serializeClaudeWireRequest(claudeWire)))).toEqual(claudeWire)
  expect(parseCodexWireRequest(JSON.parse(serializeCodexWireRequest(codexWire)))).toEqual(codexWire)
  expect(parseClaudeInspection(JSON.parse(serializeClaudeInspection(claudeInspection)))).toEqual(claudeInspection)
  expect(parseCodexInspection(JSON.parse(serializeCodexInspection(codexInspection)))).toEqual(codexInspection)
  expect(parseClaudeTransitionApproval(JSON.parse(serializeClaudeTransitionApproval(claudeApproval)))).toEqual(claudeApproval)
  expect(parseCodexTransitionApproval(JSON.parse(serializeCodexTransitionApproval(codexApproval)))).toEqual(codexApproval)
  expect(parseClaudeApplyResult(JSON.parse(serializeClaudeApplyResult(claudeResult)))).toEqual(claudeResult)
  expect(parseCodexApplyResult(JSON.parse(serializeCodexApplyResult(codexResult)))).toEqual(codexResult)
})

test("Harness Journeys wire ingress is unbranded, strict, and owner-versioned", () => {
  expect(parseClaudeWireRequest({ ...claudeWire, identity: {} })).toBeUndefined()
  expect(parseCodexWireRequest({ ...codexWire, extra: true })).toBeUndefined()
  expect(parseClaudeWireRequest({ ...claudeWire, profileIdentity: 7 })).toBeUndefined()
  expect(parseClaudeTransitionApproval({ ...claudeApproval, schemaVersion: 2 })).toBeUndefined()
  expect(parseClaudeTransitionApproval({ ...claudeApproval, issuer: "harness-journeys:codex" })).toBeUndefined()
})

test("Harness Journeys keeps Claude and Codex approval values non-interchangeable", () => {
  expect(parseClaudeTransitionApproval(codexApproval)).toBeUndefined()
  expect(parseCodexTransitionApproval(claudeApproval)).toBeUndefined()
  expect(parseCodexInspection({ ...codexInspection, checkoutIdentity: undefined })).toBeUndefined()
  expect(parseCodexApplyResult({ ...codexResult, freshTaskCommand: ["task", undefined] })).toBeUndefined()
})

test("Harness Journeys egress rejects undefined and non-JSON capability-shaped values", () => {
  expect(() => serializeClaudeWireRequest({ ...claudeWire, payload: undefined } as never)).toThrow(
    "harness-journeys: invalid serialized value",
  )
  expect(() => serializeClaudeWireRequest({ ...claudeWire, identity: {} } as never)).toThrow(
    "harness-journeys: invalid serialized value",
  )
  expect(() => serializeCodexApplyResult({
    ...codexResult,
    freshTaskCommand: ["task", undefined],
  } as never)).toThrow("harness-journeys: invalid serialized value")
})
