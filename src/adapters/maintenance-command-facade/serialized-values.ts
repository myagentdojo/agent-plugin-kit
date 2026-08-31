import { z } from "zod"
import type {
  FacadeErrorEnvelope,
  FacadeSuccessEnvelope,
} from "./interface"
import {
  maintenanceErrorEnvelopeDataSchema,
  maintenanceErrorEnvelopeProjectionSchema,
  maintenanceSuccessEnvelopeDataSchema,
  isPlainJsonTree,
} from "../../modules/maintenance-command-contract/serialized-values"

const facadeSuccessEnvelopeSchema = z.strictObject({
  schema_version: z.literal(1),
  status: z.literal("ok"),
  run_id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  data: maintenanceSuccessEnvelopeDataSchema,
})
const facadeErrorEnvelopeSchema = z.strictObject({
  record_type: z.literal("error_envelope"),
  schema_version: z.literal(1),
  status: z.literal("error"),
  message: z.string(),
  run_id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  data: maintenanceErrorEnvelopeDataSchema,
  error: maintenanceErrorEnvelopeProjectionSchema,
}).superRefine((envelope, ctx) => {
  const [agentAction] = envelope.error.agentActions
  const nextAction = envelope.data.next_action
  const copiesMatch =
    envelope.data.result_code === envelope.error.code &&
    envelope.data.station_id === envelope.error.stationId &&
    agentAction.nextActionId === nextAction.id &&
    agentAction.action === nextAction.action &&
    agentAction.summary === nextAction.summary &&
    agentAction.retryAfterMs === nextAction.retryAfterMs &&
    agentAction.idempotencyKey === nextAction.idempotencyKey
  if (!copiesMatch) {
    ctx.addIssue({ code: "custom", message: "invalid facade error envelope copies" })
  }
})

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

const validate = <T>(schema: z.ZodType<T>, value: unknown): T | undefined => {
  if (!isPlainJsonTree(value)) return undefined
  const parsed = schema.safeParse(value)
  return parsed.success ? deepFreeze(parsed.data) : undefined
}

export const validateFacadeSuccessEnvelope = (value: unknown): FacadeSuccessEnvelope | undefined =>
  validate(facadeSuccessEnvelopeSchema, value)

export const validateFacadeErrorEnvelope = (value: unknown): FacadeErrorEnvelope | undefined =>
  validate(facadeErrorEnvelopeSchema, value)

export const serializeFacadeSuccessEgress = (value: unknown): string | undefined => {
  const parsed = validateFacadeSuccessEnvelope(value)
  return parsed === undefined ? undefined : `${JSON.stringify(parsed)}\n`
}

export const serializeFacadeErrorEgress = (value: unknown): string | undefined => {
  const parsed = validateFacadeErrorEnvelope(value)
  return parsed === undefined ? undefined : `${JSON.stringify(parsed)}\n`
}

type InferredFacadeSuccessEnvelope = z.infer<typeof facadeSuccessEnvelopeSchema>
type InferredFacadeErrorEnvelope = z.infer<typeof facadeErrorEnvelopeSchema>

const bidirectionalTypeChecks: [
  InferredFacadeSuccessEnvelope extends FacadeSuccessEnvelope ? true : false,
  FacadeSuccessEnvelope extends InferredFacadeSuccessEnvelope ? true : false,
  InferredFacadeErrorEnvelope extends FacadeErrorEnvelope ? true : false,
  FacadeErrorEnvelope extends InferredFacadeErrorEnvelope ? true : false,
] = [
  true,
  true,
  true,
  true,
]

void bidirectionalTypeChecks
