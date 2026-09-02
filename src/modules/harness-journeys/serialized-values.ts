import { z } from "zod"
import type {
  ClaudeApplyResult,
  ClaudeInspection,
  ClaudeTransitionApproval,
  CodexApplyResult,
  CodexInspection,
  CodexTransitionApproval,
} from "./interface"
import type { CandidateIdentity } from "../release-and-git-engine/interface"
import type { PreparedPluginPayload } from "../plugin-payload-production/interface"
import { candidateIdentitySchema } from "../release-and-git-engine/serialized-values"
import { preparedPluginPayloadSchema } from "../plugin-payload-production/serialized-values"

export type ClaudeWireRequest = {
  candidate: CandidateIdentity
  payload: PreparedPluginPayload
  profileIdentity: string
}

export type CodexWireRequest = ClaudeWireRequest & {
  checkoutIdentity: string
}

const sha256Schema = z.templateLiteral(["sha256:", z.string()])
const effectIdsSchema = z.array(z.string()).readonly()

export const claudeWireRequestSchema = z.strictObject({
  candidate: candidateIdentitySchema,
  payload: preparedPluginPayloadSchema,
  profileIdentity: z.string(),
})

export const codexWireRequestSchema = z.strictObject({
  candidate: candidateIdentitySchema,
  payload: preparedPluginPayloadSchema,
  profileIdentity: z.string(),
  checkoutIdentity: z.string(),
})

const claudeInspectionSchema = z.strictObject({
  candidate: candidateIdentitySchema,
  profileIdentity: z.string(),
  expectedEffectIds: effectIdsSchema,
})

const codexInspectionSchema = z.strictObject({
  candidate: candidateIdentitySchema,
  profileIdentity: z.string(),
  expectedEffectIds: effectIdsSchema,
  checkoutIdentity: z.string(),
})

export const claudeTransitionApprovalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  issuer: z.literal("harness-journeys:claude"),
  candidate: candidateIdentitySchema,
  candidateIdentitySha256: sha256Schema,
  inspectedStateSha256: sha256Schema,
  expectedEffectsSha256: sha256Schema,
  digest: sha256Schema,
})

export const codexTransitionApprovalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  issuer: z.literal("harness-journeys:codex"),
  candidate: candidateIdentitySchema,
  candidateIdentitySha256: sha256Schema,
  inspectedStateSha256: sha256Schema,
  expectedEffectsSha256: sha256Schema,
  digest: sha256Schema,
})

const claudeApplyResultSchema = z.strictObject({
  completedEffectIds: effectIdsSchema,
  remainingEffectIds: effectIdsSchema,
})

const codexApplyResultSchema = z.strictObject({
  completedEffectIds: effectIdsSchema,
  remainingEffectIds: effectIdsSchema,
  freshTaskCommand: z.array(z.string()).readonly(),
})

function isPlainJsonTree(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value !== "object" || seen.has(value)) return false
  seen.add(value)
  let valid = true
  if (Array.isArray(value)) {
    valid = Object.getPrototypeOf(value) === Array.prototype &&
      Reflect.ownKeys(value).every((key) =>
        key === "length" || (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)))
    for (let index = 0; valid && index < value.length; index += 1) {
      if (!Object.hasOwn(value, index) || !isPlainJsonTree(value[index], seen)) valid = false
    }
  } else {
    valid = Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        valid = false
        break
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor) || !isPlainJsonTree(descriptor.value, seen)) {
        valid = false
        break
      }
    }
  }
  seen.delete(value)
  return valid
}

const parseValue = <T>(schema: z.ZodType<T>, value: unknown): T | undefined => {
  if (!isPlainJsonTree(value)) return undefined
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

const serializeValue = <T>(schema: z.ZodType<T>, value: T): string => {
  const parsed = parseValue(schema, value)
  if (parsed === undefined) throw new Error("harness-journeys: invalid serialized value")
  return JSON.stringify(parsed)
}

export const parseClaudeWireRequest = (value: unknown): ClaudeWireRequest | undefined =>
  parseValue(claudeWireRequestSchema, value)

export const parseCodexWireRequest = (value: unknown): CodexWireRequest | undefined =>
  parseValue(codexWireRequestSchema, value)

export const parseClaudeInspection = (value: unknown): ClaudeInspection | undefined =>
  parseValue(claudeInspectionSchema, value)

export const parseCodexInspection = (value: unknown): CodexInspection | undefined =>
  parseValue(codexInspectionSchema, value)

export const parseClaudeTransitionApproval = (value: unknown): ClaudeTransitionApproval | undefined =>
  parseValue(claudeTransitionApprovalSchema, value)

export const parseCodexTransitionApproval = (value: unknown): CodexTransitionApproval | undefined =>
  parseValue(codexTransitionApprovalSchema, value)

export const parseClaudeApplyResult = (value: unknown): ClaudeApplyResult | undefined =>
  parseValue(claudeApplyResultSchema, value)

export const parseCodexApplyResult = (value: unknown): CodexApplyResult | undefined =>
  parseValue(codexApplyResultSchema, value)

export const serializeClaudeWireRequest = (value: ClaudeWireRequest): string =>
  serializeValue(claudeWireRequestSchema, value)

export const serializeCodexWireRequest = (value: CodexWireRequest): string =>
  serializeValue(codexWireRequestSchema, value)

export const serializeClaudeInspection = (value: ClaudeInspection): string =>
  serializeValue(claudeInspectionSchema, value)

export const serializeCodexInspection = (value: CodexInspection): string =>
  serializeValue(codexInspectionSchema, value)

export const serializeClaudeTransitionApproval = (value: ClaudeTransitionApproval): string =>
  serializeValue(claudeTransitionApprovalSchema, value)

export const serializeCodexTransitionApproval = (value: CodexTransitionApproval): string =>
  serializeValue(codexTransitionApprovalSchema, value)

export const serializeClaudeApplyResult = (value: ClaudeApplyResult): string =>
  serializeValue(claudeApplyResultSchema, value)

export const serializeCodexApplyResult = (value: CodexApplyResult): string =>
  serializeValue(codexApplyResultSchema, value)

type InferredClaudeInspection = z.infer<typeof claudeInspectionSchema>
type InferredCodexInspection = z.infer<typeof codexInspectionSchema>
type InferredClaudeTransitionApproval = z.infer<typeof claudeTransitionApprovalSchema>
type InferredCodexTransitionApproval = z.infer<typeof codexTransitionApprovalSchema>
type InferredClaudeApplyResult = z.infer<typeof claudeApplyResultSchema>
type InferredCodexApplyResult = z.infer<typeof codexApplyResultSchema>

const bidirectionalTypeChecks: [
  InferredClaudeInspection extends ClaudeInspection ? true : false,
  ClaudeInspection extends InferredClaudeInspection ? true : false,
  InferredCodexInspection extends CodexInspection ? true : false,
  CodexInspection extends InferredCodexInspection ? true : false,
  InferredClaudeTransitionApproval extends ClaudeTransitionApproval ? true : false,
  ClaudeTransitionApproval extends InferredClaudeTransitionApproval ? true : false,
  InferredCodexTransitionApproval extends CodexTransitionApproval ? true : false,
  CodexTransitionApproval extends InferredCodexTransitionApproval ? true : false,
  InferredClaudeApplyResult extends ClaudeApplyResult ? true : false,
  ClaudeApplyResult extends InferredClaudeApplyResult ? true : false,
  InferredCodexApplyResult extends CodexApplyResult ? true : false,
  CodexApplyResult extends InferredCodexApplyResult ? true : false,
] = [true, true, true, true, true, true, true, true, true, true, true, true]

void bidirectionalTypeChecks
