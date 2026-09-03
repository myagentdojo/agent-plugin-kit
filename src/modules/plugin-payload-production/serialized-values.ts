import { z } from "zod"
import type {
  PayloadArtifactRecord,
  PayloadCheckRequest,
  PayloadMaterializeRequest,
  PayloadPackageRequest,
  PayloadProductionRequest,
  PayloadProductionResult,
  PreparedFileDeclaration,
  PreparedPayloadDeclaration,
  PreparedPluginPayload,
  PreparedProjectionDeclaration,
} from "./interface"
import { sourceIdentitySchema } from "../release-and-git-engine/serialized-values"

const sha256Schema = z.templateLiteral(["sha256:", z.string()])
const hexSha256Schema = z.templateLiteral(["sha256:", z.string().regex(/^[0-9a-f]{64}$/)])
const byteCountSchema = z.number().int().nonnegative()
const nonEmptyStringSchema = z.string().min(1)

const payloadReleaseSchema = z.strictObject({
  name: nonEmptyStringSchema,
  version: nonEmptyStringSchema,
  tag: nonEmptyStringSchema,
})

const preparedFileDeclarationSchema = z.strictObject({
  path: nonEmptyStringSchema,
  bytes: byteCountSchema,
  sha256: hexSha256Schema,
  executable: z.boolean(),
})

const preparedProjectionDeclarationSchema = z.strictObject({
  role: z.enum(["config", "runtime-lock", "bundle-inventory", "skill-inventory", "native-manifest"]),
  path: nonEmptyStringSchema,
  bytes: byteCountSchema,
  sha256: hexSha256Schema,
})

const preparedPayloadDeclarationSchema = z.strictObject({
  sourceIdentity: sourceIdentitySchema,
  files: z.array(preparedFileDeclarationSchema).readonly(),
  projections: z.array(preparedProjectionDeclarationSchema).readonly(),
  payloadSha256: hexSha256Schema,
  bindingSha256: hexSha256Schema,
})

export const payloadCheckRequestSchema = z.strictObject({
  repositoryRoot: z.string(),
  mode: z.literal("check"),
  sourceIdentity: sourceIdentitySchema.exactOptional(),
})

export const payloadMaterializeRequestSchema = z.strictObject({
  repositoryRoot: z.string(),
  mode: z.literal("materialize"),
  sourceIdentity: sourceIdentitySchema.exactOptional(),
})

export const payloadPackageRequestSchema = z.strictObject({
  repositoryRoot: z.string(),
  mode: z.literal("package"),
  sourceIdentity: sourceIdentitySchema,
  release: payloadReleaseSchema,
  prepared: preparedPayloadDeclarationSchema,
})

const payloadProductionRequestSchema = z.discriminatedUnion("mode", [
  payloadCheckRequestSchema,
  payloadMaterializeRequestSchema,
  payloadPackageRequestSchema,
])

export const preparedPluginPayloadSchema = z.strictObject({
  regularFiles: z.array(z.string()).readonly(),
  payloadSha256: sha256Schema,
})

const payloadArtifactRecordSchema = z.strictObject({
  path: z.string(),
  bytes: byteCountSchema,
  sha256: hexSha256Schema,
})

const payloadRefusalCodeSchema = z.enum([
  "mode-deferred",
  "repository-root-invalid",
  "payload-root-invalid",
  "source-identity-mismatch",
  "release-invalid",
  "declaration-invalid",
  "binding-mismatch",
  "payload-digest-mismatch",
  "unsafe-entry",
  "undeclared-file",
  "declared-file-missing",
  "file-mismatch",
  "projection-mismatch",
  "output-conflict",
])

const payloadFailureCodeSchema = z.enum([
  "staging-failed",
  "compressor-failed",
  "compressor-deadline",
  "publication-interrupted",
  "publication-unobservable",
])

const payloadProductionResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("checked"),
    payload: preparedPluginPayloadSchema.exactOptional(),
    nextAction: z.string(),
  }),
  z.strictObject({
    kind: z.literal("materialized"),
    payload: preparedPluginPayloadSchema.exactOptional(),
    nextAction: z.string(),
  }),
  z.strictObject({
    kind: z.literal("packaged"),
    sourceIdentity: sourceIdentitySchema,
    release: payloadReleaseSchema,
    bindingSha256: hexSha256Schema,
    payload: preparedPluginPayloadSchema,
    artifacts: z.strictObject({
      archive: payloadArtifactRecordSchema,
      checksums: payloadArtifactRecordSchema,
    }),
    nextAction: z.string(),
  }),
  z.strictObject({
    kind: z.literal("refused"),
    code: payloadRefusalCodeSchema,
    detail: z.string(),
    nextAction: z.string(),
  }),
  z.strictObject({
    kind: z.literal("failed"),
    code: payloadFailureCodeSchema,
    publication: z.enum(["none", "archive-only", "unknown"]),
    transient: z.boolean(),
    artifacts: z.strictObject({
      archive: payloadArtifactRecordSchema.nullable(),
      checksums: payloadArtifactRecordSchema.nullable(),
    }),
    nextAction: z.string(),
  }),
])

// fallow-ignore-next-line code-duplication -- the owner keeps strict JSON boundary validation private and explicit
// fallow-ignore-next-line complexity -- the owner keeps strict JSON boundary validation private and explicit
function isPlainJsonTree(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value !== "object" || seen.has(value)) return false
  seen.add(value)
  const valid = Array.isArray(value)
    ? Object.getPrototypeOf(value) === Array.prototype &&
      Reflect.ownKeys(value).every((key) => key === "length" || (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key))) &&
      value.every((entry) => isPlainJsonTree(entry, seen))
    : (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
      Reflect.ownKeys(value).every((key) => {
        if (typeof key !== "string") return false
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        return descriptor !== undefined && descriptor.enumerable && "value" in descriptor && isPlainJsonTree(descriptor.value, seen)
      })
  seen.delete(value)
  return valid
}

// fallow-ignore-next-line code-duplication -- the owner keeps strict JSON boundary validation private and explicit
const parseValue = <T>(schema: z.ZodType<T>, value: unknown): T | undefined => {
  if (!isPlainJsonTree(value)) return undefined
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

const serializeValue = <T>(schema: z.ZodType<T>, value: T): string => {
  const parsed = parseValue(schema, value)
  if (parsed === undefined) throw new Error("plugin-payload-production: invalid serialized value")
  return JSON.stringify(parsed)
}

export const parsePayloadProductionRequest = (value: unknown): PayloadProductionRequest | undefined =>
  parseValue(payloadProductionRequestSchema, value)

export const parsePreparedPluginPayload = (value: unknown): PreparedPluginPayload | undefined =>
  parseValue(preparedPluginPayloadSchema, value)

export const parsePayloadProductionResult = (value: unknown): PayloadProductionResult | undefined =>
  parseValue(payloadProductionResultSchema, value)

export const serializePayloadProductionRequest = (value: PayloadProductionRequest): string =>
  serializeValue(payloadProductionRequestSchema, value)

export const serializePreparedPluginPayload = (value: PreparedPluginPayload): string =>
  serializeValue(preparedPluginPayloadSchema, value)

export const serializePayloadProductionResult = (value: PayloadProductionResult): string =>
  serializeValue(payloadProductionResultSchema, value)

type InferredPayloadCheckRequest = z.infer<typeof payloadCheckRequestSchema>
type InferredPayloadMaterializeRequest = z.infer<typeof payloadMaterializeRequestSchema>
type InferredPayloadPackageRequest = z.infer<typeof payloadPackageRequestSchema>
type InferredPayloadProductionRequest = z.infer<typeof payloadProductionRequestSchema>
type InferredPreparedFileDeclaration = z.infer<typeof preparedFileDeclarationSchema>
type InferredPreparedProjectionDeclaration = z.infer<typeof preparedProjectionDeclarationSchema>
type InferredPreparedPayloadDeclaration = z.infer<typeof preparedPayloadDeclarationSchema>
type InferredPreparedPluginPayload = z.infer<typeof preparedPluginPayloadSchema>
type InferredPayloadArtifactRecord = z.infer<typeof payloadArtifactRecordSchema>
type InferredPayloadProductionResult = z.infer<typeof payloadProductionResultSchema>

const bidirectionalTypeChecks: [
  InferredPayloadCheckRequest extends PayloadCheckRequest ? true : false,
  PayloadCheckRequest extends InferredPayloadCheckRequest ? true : false,
  InferredPayloadMaterializeRequest extends PayloadMaterializeRequest ? true : false,
  PayloadMaterializeRequest extends InferredPayloadMaterializeRequest ? true : false,
  InferredPayloadPackageRequest extends PayloadPackageRequest ? true : false,
  PayloadPackageRequest extends InferredPayloadPackageRequest ? true : false,
  InferredPayloadProductionRequest extends PayloadProductionRequest ? true : false,
  PayloadProductionRequest extends InferredPayloadProductionRequest ? true : false,
  InferredPreparedFileDeclaration extends PreparedFileDeclaration ? true : false,
  PreparedFileDeclaration extends InferredPreparedFileDeclaration ? true : false,
  InferredPreparedProjectionDeclaration extends PreparedProjectionDeclaration ? true : false,
  PreparedProjectionDeclaration extends InferredPreparedProjectionDeclaration ? true : false,
  InferredPreparedPayloadDeclaration extends PreparedPayloadDeclaration ? true : false,
  PreparedPayloadDeclaration extends InferredPreparedPayloadDeclaration ? true : false,
  InferredPreparedPluginPayload extends PreparedPluginPayload ? true : false,
  PreparedPluginPayload extends InferredPreparedPluginPayload ? true : false,
  InferredPayloadArtifactRecord extends PayloadArtifactRecord ? true : false,
  PayloadArtifactRecord extends InferredPayloadArtifactRecord ? true : false,
  InferredPayloadProductionResult extends PayloadProductionResult ? true : false,
  PayloadProductionResult extends InferredPayloadProductionResult ? true : false,
] = [
  true, true, true, true, true, true, true, true, true, true,
  true, true, true, true, true, true, true, true, true, true,
]

void bidirectionalTypeChecks
