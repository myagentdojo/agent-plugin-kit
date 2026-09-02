import { z } from "zod"
import type {
  CanaryAuthorityReference,
  CanaryAuthoritySourceRefusal,
  CanaryCandidate,
  CanaryPlan,
  CanaryResult,
} from "./interface"
import { candidateIdentitySchema } from "../release-and-git-engine/serialized-values"

const sha256Schema = z.templateLiteral(["sha256:", z.string()])

export const canaryAuthorityReferenceSchema = z.string().min(1)

const canaryAuthoritySourceRefusalSchema = z.strictObject({
  status: z.literal("refused"),
  code: z.enum([
    "authority-reference-invalid",
    "authority-unavailable",
    "authority-candidate-mismatch",
    "authority-plan-mismatch",
  ]),
})

export const canaryCandidateSchema = z.strictObject({
  identity: candidateIdentitySchema,
  inertPayloadSha256: sha256Schema,
})

const canaryPlanSchema = z.strictObject({
  candidate: candidateIdentitySchema,
  target: z.string(),
  immutableReference: z.string(),
})

const canaryResultSchema = z.strictObject({
  candidate: candidateIdentitySchema,
  hostedRunId: z.string(),
  installedPayloadSha256: sha256Schema,
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
  if (parsed === undefined) throw new Error("canary-qualification: invalid serialized value")
  return JSON.stringify(parsed)
}

export const parseCanaryAuthorityReference = (value: unknown): CanaryAuthorityReference | undefined =>
  parseValue(canaryAuthorityReferenceSchema, value)

const parseCanaryAuthoritySourceRefusal = (value: unknown): CanaryAuthoritySourceRefusal | undefined =>
  parseValue(canaryAuthoritySourceRefusalSchema, value)

export const parseCanaryCandidate = (value: unknown): CanaryCandidate | undefined =>
  parseValue(canaryCandidateSchema, value)

export const parseCanaryPlan = (value: unknown): CanaryPlan | undefined =>
  parseValue(canaryPlanSchema, value)

export const parseCanaryResult = (value: unknown): CanaryResult | undefined =>
  parseValue(canaryResultSchema, value)

export const serializeCanaryAuthorityReference = (value: CanaryAuthorityReference): string =>
  serializeValue(canaryAuthorityReferenceSchema, value)

const serializeCanaryAuthoritySourceRefusal = (value: CanaryAuthoritySourceRefusal): string =>
  serializeValue(canaryAuthoritySourceRefusalSchema, value)

export const serializeCanaryCandidate = (value: CanaryCandidate): string =>
  serializeValue(canaryCandidateSchema, value)

export const serializeCanaryPlan = (value: CanaryPlan): string =>
  serializeValue(canaryPlanSchema, value)

export const serializeCanaryResult = (value: CanaryResult): string =>
  serializeValue(canaryResultSchema, value)

type InferredCanaryAuthoritySourceRefusal = z.infer<typeof canaryAuthoritySourceRefusalSchema>
type InferredCanaryCandidate = z.infer<typeof canaryCandidateSchema>
type InferredCanaryPlan = z.infer<typeof canaryPlanSchema>
type InferredCanaryResult = z.infer<typeof canaryResultSchema>

const bidirectionalTypeChecks: [
  InferredCanaryAuthoritySourceRefusal extends CanaryAuthoritySourceRefusal ? true : false,
  CanaryAuthoritySourceRefusal extends InferredCanaryAuthoritySourceRefusal ? true : false,
  InferredCanaryCandidate extends CanaryCandidate ? true : false,
  CanaryCandidate extends InferredCanaryCandidate ? true : false,
  InferredCanaryPlan extends CanaryPlan ? true : false,
  CanaryPlan extends InferredCanaryPlan ? true : false,
  InferredCanaryResult extends CanaryResult ? true : false,
  CanaryResult extends InferredCanaryResult ? true : false,
] = [true, true, true, true, true, true, true, true]

void bidirectionalTypeChecks
