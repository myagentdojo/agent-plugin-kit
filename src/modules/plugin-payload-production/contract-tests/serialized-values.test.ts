import { expect, test } from "bun:test"
import type {
  PayloadProductionRequest,
  PayloadProductionResult,
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

const request: PayloadProductionRequest = {
  repositoryRoot: "/fixture/plugin",
  mode: "check",
}

const prepared: PreparedPluginPayload = {
  regularFiles: [".claude-plugin/plugin.json"],
  payloadSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
}

const result: PayloadProductionResult = {
  kind: "checked",
  nextAction: "Inspect the payload check result.",
}

test("Plugin Payload Production serialized values make exact JSON round trips", () => {
  expect(parsePayloadProductionRequest(JSON.parse(serializePayloadProductionRequest(request)))).toEqual(request)
  expect(parsePreparedPluginPayload(JSON.parse(serializePreparedPluginPayload(prepared)))).toEqual(prepared)
  expect(parsePayloadProductionResult(JSON.parse(serializePayloadProductionResult(result)))).toEqual(result)
})

test("Plugin Payload Production ingress is strict and does not coerce", () => {
  expect(parsePayloadProductionRequest({ ...request, repositoryRoot: 42 })).toBeUndefined()
  expect(parsePayloadProductionRequest({ ...request, unexpected: true })).toBeUndefined()
  expect(parsePayloadProductionRequest({ ...request, mode: "CHECK" })).toBeUndefined()
  expect(parsePreparedPluginPayload({ ...prepared, payloadSha256: "aaaaaaaa" })).toBeUndefined()
  expect(parsePayloadProductionResult({ ...result, unexpected: true })).toBeUndefined()
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
})
