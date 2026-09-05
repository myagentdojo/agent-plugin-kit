import { expect, test } from "bun:test"
import type {
  PayloadCheckRequest,
  PayloadProductionRequest,
  PayloadProductionResult,
  PluginPayloadConfiguration,
  PreparedPluginPayload,
} from "../interface"
import {
  parsePayloadProductionRequest,
  parsePayloadProductionResult,
  parsePreparedPluginPayload,
  serializePayloadProductionRequest,
  serializePayloadProductionResult,
  serializePreparedPluginPayload,
} from "../serialized-values"

const hex = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`
const sourceIdentity = {
  repository: { origin: "https://github.com/myagentdojo/example-plugin.git" },
  commit: "1111111111111111111111111111111111111111",
}

const configuration = {
  plugin: {
    name: "example-plugin",
    displayName: "Example Plugin",
    version: "1.0.0",
    description: "Example Plugin",
    author: { name: "Example Author" },
    repository: "https://github.com/myagentdojo/example-plugin",
    license: "MIT",
    keywords: ["example"],
    category: "Developer Tools",
    shortDescription: "Example Plugin",
    longDescription: "Example Plugin for serialized value fixtures.",
    capabilities: ["payload"],
    defaultPrompts: ["Inspect the payload."],
    brandColor: "#123456",
    composerIcon: "./assets/example.svg",
    logo: "./assets/example.svg",
    hookDeclarationPaths: [],
  },
  skills: [{ id: "example", hookDependence: "hook-independent", production: { kind: "model-only" } }],
} as const satisfies PluginPayloadConfiguration

const sourceProjectionPaths = {
  config: "plugin.config.json",
  runtimeLock: "runtime.lock.json",
  skillInventory: "skill-catalog.json",
} as const

const request: PayloadCheckRequest = {
  repositoryRoot: "/fixture/plugin",
  mode: "check",
  configuration,
  sourceProjectionPaths,
}

const packageRequest: PayloadProductionRequest = {
  repositoryRoot: "/fixture/plugin",
  mode: "package",
  sourceIdentity,
  release: { name: "example-plugin", version: "1.0.0", tag: "v1.0.0" },
  prepared: {
    sourceIdentity,
    files: [{ path: ".claude-plugin/plugin.json", bytes: 2, sha256: hex("a"), executable: false }],
    projections: [
      { role: "bundle-inventory", path: "runtime/bundle-inventory.json", bytes: 2, sha256: hex("b") },
      { role: "runtime-lock", path: "runtime/runtime.lock.json", bytes: 2, sha256: hex("c") },
    ],
    payloadSha256: hex("d"),
    bindingSha256: hex("e"),
  },
}

const prepared: PreparedPluginPayload = {
  regularFiles: [".claude-plugin/plugin.json"],
  payloadSha256: hex("a"),
}

const result: PayloadProductionResult = {
  kind: "checked",
  candidate: {
    files: [],
    projections: [],
    ownedFiles: [],
    payloadSha256: hex("0"),
  },
  nextAction: "Inspect the payload check result.",
}

const packaged: PayloadProductionResult = {
  kind: "packaged",
  sourceIdentity,
  release: { name: "example-plugin", version: "1.0.0", tag: "v1.0.0" },
  bindingSha256: hex("e"),
  payload: prepared,
  artifacts: {
    archive: { path: "/fixture/plugin/dist/example-plugin-1.0.0.tar.gz", bytes: 130, sha256: hex("1") },
    checksums: { path: "/fixture/plugin/dist/example-plugin-1.0.0.checksums.json", bytes: 700, sha256: hex("2") },
  },
  nextAction: "Inspect the packaged Plugin Payload artifacts under dist/.",
}

const failedResult: PayloadProductionResult = {
  kind: "failed",
  code: "publication-interrupted",
  publication: "archive-only",
  transient: false,
  artifacts: { archive: { path: "/fixture/plugin/dist/example-plugin-1.0.0.tar.gz", bytes: 130, sha256: hex("1") }, checksums: null },
  nextAction: "Repeat payload:package to complete the checksum publication for the published archive.",
}

test("Plugin Payload Production serialized values make exact JSON round trips", () => {
  expect(parsePayloadProductionRequest(JSON.parse(serializePayloadProductionRequest(request)))).toEqual(request)
  expect(parsePayloadProductionRequest(JSON.parse(serializePayloadProductionRequest(packageRequest)))).toEqual(packageRequest)
  expect(parsePreparedPluginPayload(JSON.parse(serializePreparedPluginPayload(prepared)))).toEqual(prepared)
  expect(parsePayloadProductionResult(JSON.parse(serializePayloadProductionResult(result)))).toEqual(result)
  expect(parsePayloadProductionResult(JSON.parse(serializePayloadProductionResult(packaged)))).toEqual(packaged)
  expect(parsePayloadProductionResult(JSON.parse(serializePayloadProductionResult(failedResult)))).toEqual(failedResult)
})

test("Plugin Payload Production ingress is strict and does not coerce", () => {
  expect(parsePayloadProductionRequest({ ...request, repositoryRoot: 42 })).toBeUndefined()
  expect(parsePayloadProductionRequest({ ...request, unexpected: true })).toBeUndefined()
  expect(parsePayloadProductionRequest({ ...request, mode: "CHECK" })).toBeUndefined()
  expect(parsePayloadProductionRequest({ ...request, mode: "package" })).toBeUndefined()
  expect(parsePayloadProductionRequest({ ...packageRequest, release: { ...packageRequest.release, extra: true } })).toBeUndefined()
  expect(parsePayloadProductionRequest({ ...packageRequest, prepared: { ...packageRequest.prepared, files: [{ path: "x", bytes: "2", sha256: hex("a"), executable: false }] } })).toBeUndefined()
  expect(parsePayloadProductionRequest({ ...packageRequest, prepared: { ...packageRequest.prepared, files: [{ path: "x", bytes: 2, sha256: "sha256:not-hex", executable: false }] } })).toBeUndefined()
  expect(parsePayloadProductionRequest({ ...packageRequest, prepared: { ...packageRequest.prepared, projections: [{ role: "manifest", path: "x", bytes: 2, sha256: hex("a") }] } })).toBeUndefined()
  expect(parsePayloadProductionRequest({ ...packageRequest, prepared: { ...packageRequest.prepared, bindingSha256: undefined } })).toBeUndefined()
  expect(parsePreparedPluginPayload({ ...prepared, payloadSha256: "aaaaaaaa" })).toBeUndefined()
  expect(parsePayloadProductionResult({ ...result, unexpected: true })).toBeUndefined()
  expect(parsePayloadProductionResult({ ...packaged, artifacts: { archive: packaged.artifacts.archive } })).toBeUndefined()
  expect(parsePayloadProductionResult({ ...failedResult, publication: "partial" })).toBeUndefined()
  expect(parsePayloadProductionResult({ kind: "refused", code: "unknown-code", detail: "x", nextAction: "y" })).toBeUndefined()
})

test("Plugin Payload Production egress rejects undefined and non-JSON values without raw detail", () => {
  const invalidRequest = { ...request, repositoryRoot: undefined }
  expect(parsePayloadProductionRequest(invalidRequest)).toBeUndefined()
  expect(() => serializePayloadProductionRequest(invalidRequest as unknown as PayloadProductionRequest)).toThrow(
    "plugin-payload-production: invalid serialized value",
  )
  expect(() => serializePayloadProductionResult({
    ...result,
    nextAction: "\u0000",
    payload: { ...prepared, regularFiles: ["ok", undefined] },
  } as unknown as PayloadProductionResult)).toThrow("plugin-payload-production: invalid serialized value")
  expect(() => serializePayloadProductionResult({
    ...packaged,
    artifacts: { ...packaged.artifacts, checksums: { ...packaged.artifacts.checksums, bytes: Number.POSITIVE_INFINITY } },
  } as unknown as PayloadProductionResult)).toThrow("plugin-payload-production: invalid serialized value")
})
