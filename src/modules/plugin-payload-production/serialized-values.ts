import { z } from "zod"
import type {
  PayloadArtifactRecord,
  PayloadCategory,
  PayloadCheckRequest,
  PayloadMaterializeRequest,
  PayloadPackageRequest,
  PayloadProductionResult,
  PayloadProductionRequest,
  PluginPayloadConfiguration,
  PluginPayloadMetadata,
  PluginPayloadSkillConfiguration,
  PayloadSkillProduction,
  PayloadSourceProjectionPaths,
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

const payloadCategorySchema = z.enum([
  "Productivity",
  "Creativity",
  "Developer Tools",
  "Business & Operations",
  "Data & Analytics",
  "Communication",
  "Education & Research",
  "Security",
  "Finance",
  "Healthcare",
  "Travel",
  "Entertainment",
  "Other",
])

const payloadMetadataSchema = z.strictObject({
  name: z.string(),
  displayName: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.strictObject({ name: z.string() }),
  repository: z.string(),
  license: z.string(),
  keywords: z.array(z.string()).readonly(),
  category: payloadCategorySchema,
  shortDescription: z.string(),
  longDescription: z.string(),
  capabilities: z.array(z.string()).readonly(),
  defaultPrompts: z.array(z.string()).readonly(),
  brandColor: z.templateLiteral(["#", z.string()]),
  composerIcon: z.string(),
  logo: z.string(),
  hookDeclarationPaths: z.array(z.string()).readonly(),
})

const payloadSkillProductionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("model-only") }),
  z.strictObject({ kind: z.literal("workspace"), workspacePath: z.string(), entryPath: z.string() }),
  z.strictObject({ kind: z.literal("prepared"), entryPath: z.string() }),
])

const payloadSkillConfigurationSchema = z.strictObject({
  id: z.string(),
  hookDependence: z.enum(["hook-dependent", "hook-independent"]),
  production: payloadSkillProductionSchema,
})

const payloadConfigurationSchema = z.strictObject({
  plugin: payloadMetadataSchema,
  skills: z.array(payloadSkillConfigurationSchema).readonly(),
})

const payloadSourceProjectionPathsSchema = z.strictObject({
  config: z.string(),
  runtimeLock: z.string(),
  skillInventory: z.string(),
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
  configuration: payloadConfigurationSchema,
  sourceProjectionPaths: payloadSourceProjectionPathsSchema,
})

export const payloadMaterializeRequestSchema = z.strictObject({
  repositoryRoot: z.string(),
  mode: z.literal("materialize"),
  configuration: payloadConfigurationSchema,
  sourceProjectionPaths: payloadSourceProjectionPathsSchema,
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

const preparedPayloadCandidateSchema = z.strictObject({
  files: z.array(preparedFileDeclarationSchema).readonly(),
  projections: z.array(preparedProjectionDeclarationSchema).readonly(),
  ownedFiles: z.array(preparedFileDeclarationSchema).readonly(),
  payloadSha256: hexSha256Schema,
})

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
  "configuration-invalid",
  "dependency-refused",
  "bundle-refused",
  "payload-outdated",
  "inventory-invalid",
])

const payloadRefusalSchema = z.union([
  z.strictObject({
    kind: z.literal("refused"),
    code: z.enum([
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
      "configuration-invalid",
      "dependency-refused",
      "bundle-refused",
      "inventory-invalid",
    ]),
    detail: z.string(),
    nextAction: z.string(),
  }),
  z.strictObject({
    kind: z.literal("refused"),
    code: z.literal("payload-outdated"),
    paths: z.array(z.string()).readonly(),
    detail: z.string(),
    nextAction: z.string(),
  }),
])

const emptyPathArraySchema: z.ZodType<readonly []> = z.custom<readonly []>(
  (value) => Array.isArray(value) && value.length === 0,
)
const nonEmptyPathArraySchema: z.ZodType<readonly [string, ...string[]]> = z.custom<readonly [string, ...string[]]>(
  (value) => Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string"),
)

const payloadFailureCodeSchema = z.enum([
  "staging-failed",
  "compressor-failed",
  "compressor-deadline",
  "publication-interrupted",
  "publication-unobservable",
])

const payloadProductionResultSchema = z.union([
  z.strictObject({
    kind: z.literal("checked"),
    candidate: preparedPayloadCandidateSchema,
    nextAction: z.string(),
  }),
  z.strictObject({
    kind: z.literal("materialized"),
    candidate: preparedPayloadCandidateSchema,
    changedPaths: z.array(z.string()).readonly(),
    removedPaths: z.array(z.string()).readonly(),
    unchangedPaths: z.array(z.string()).readonly(),
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
  payloadRefusalSchema,
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
  z.strictObject({
    kind: z.literal("materialization-failed"),
    code: z.enum(["materialization-staging-failed", "materialization-interrupted", "materialization-verification-failed"]),
    state: z.literal("none"),
    transient: z.boolean(),
    changedPaths: emptyPathArraySchema,
    remainingPaths: z.array(z.string()).readonly(),
    nextAction: z.string(),
  }),
  z.strictObject({
    kind: z.literal("materialization-failed"),
    code: z.enum(["materialization-interrupted", "materialization-verification-failed"]),
    state: z.literal("partial"),
    transient: z.literal(false),
    changedPaths: nonEmptyPathArraySchema,
    remainingPaths: z.array(z.string()).readonly(),
    nextAction: z.string(),
  }),
  z.strictObject({
    kind: z.literal("materialization-failed"),
    code: z.literal("materialization-state-unobservable"),
    state: z.literal("unknown"),
    transient: z.literal(false),
    changedPaths: z.null(),
    remainingPaths: z.null(),
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
type InferredPayloadMetadata = z.infer<typeof payloadMetadataSchema>
type InferredPayloadSkillProduction = z.infer<typeof payloadSkillProductionSchema>
type InferredPayloadSkillConfiguration = z.infer<typeof payloadSkillConfigurationSchema>
type InferredPayloadConfiguration = z.infer<typeof payloadConfigurationSchema>
type InferredPayloadSourceProjectionPaths = z.infer<typeof payloadSourceProjectionPathsSchema>
type InferredPreparedPayloadCandidate = z.infer<typeof preparedPayloadCandidateSchema>

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
  InferredPayloadMetadata extends PluginPayloadMetadata ? true : false,
  PluginPayloadMetadata extends InferredPayloadMetadata ? true : false,
  InferredPayloadSkillProduction extends PayloadSkillProduction ? true : false,
  PayloadSkillProduction extends InferredPayloadSkillProduction ? true : false,
  InferredPayloadSkillConfiguration extends PluginPayloadSkillConfiguration ? true : false,
  PluginPayloadSkillConfiguration extends InferredPayloadSkillConfiguration ? true : false,
  InferredPayloadConfiguration extends PluginPayloadConfiguration ? true : false,
  PluginPayloadConfiguration extends InferredPayloadConfiguration ? true : false,
  InferredPayloadSourceProjectionPaths extends PayloadSourceProjectionPaths ? true : false,
  PayloadSourceProjectionPaths extends InferredPayloadSourceProjectionPaths ? true : false,
  InferredPreparedPayloadCandidate extends import("./interface").PreparedPayloadCandidate ? true : false,
  import("./interface").PreparedPayloadCandidate extends InferredPreparedPayloadCandidate ? true : false,
] = [
  true, true, true, true, true, true, true, true, true, true,
  true, true, true, true, true, true, true, true, true, true,
  true, true, true, true, true, true, true, true, true, true,
  true, true,
]

void bidirectionalTypeChecks
