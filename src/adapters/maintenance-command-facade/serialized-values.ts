import { z } from "zod"
import type {
  DiagnosticMessage,
  DiagnosticEgressStep,
  FacadeErrorEnvelope,
  FacadeSuccessEnvelope,
} from "./interface"
import type {
  FailureClass,
  MaintenanceAction,
  MaintenanceCommand,
  NextAction,
  ResultCode,
  RetrySafety,
  StationId,
  TransactionState,
} from "../../modules/maintenance-command-contract/interface"
import {
  maintenanceErrorEnvelopeDataSchema,
  maintenanceErrorEnvelopeProjectionSchema,
  maintenanceSuccessEnvelopeDataSchema,
  isPlainJsonTree,
} from "../../modules/maintenance-command-contract/serialized-values"
import { canonicalNextActionFor, stationSlugFor } from "../../modules/maintenance-command-contract/branch-stations"
import { commandVocabulary } from "../../modules/maintenance-command-contract/command-vocabulary"
import {
  actionVocabulary,
  failureClassVocabulary,
  failureNextActionProjection,
  resultVocabulary,
  retrySafetyVocabulary,
  transactionStateVocabulary,
} from "../../modules/maintenance-command-contract/result-vocabulary"

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

const diagnosticRecordKeys = [
  "schema_version",
  "record_type",
  "timestamp",
  "sequence",
  "level",
  "category",
  "event",
  "run_id",
  "command",
  "station_id",
  "failure_class",
  "result_code",
  "transaction_state",
  "retry_safety",
  "next_action",
  "dropped_record_count",
  "message",
] as const
const eventRecordKeys = [
  "schema_version",
  "event_id",
  "occurred_at",
  "sequence",
  "run_id",
  "command",
  "station_id",
  "outcome",
  "result_code",
  "failure_class",
  "transaction_state",
  "retry_safety",
  "next_action_id",
] as const
const nextActionKeys = [
  "id",
  "action",
  "summary",
  "commandId",
  "retryAfterMs",
  "idempotencyKey",
] as const
const contextualDiagnosticLevels = ["debug", "info", "warning"] as const
const failureDiagnosticLevels = ["error", "fatal"] as const
const eventOutcomes = ["previewed", "completed", "refused", "failed"] as const
const safeIdentifierPattern = /^[A-Za-z0-9._:-]{1,160}$/
const runIdPattern = /^[A-Za-z0-9._-]{1,64}$/
type DiagnosticRecordInput = Record<string, unknown>

const commandIds = commandVocabulary.map(({ command }) => command) as [
  MaintenanceCommand["command"],
  ...MaintenanceCommand["command"][],
]
const resultCodes = resultVocabulary.map(({ resultCode }) => resultCode) as [
  ResultCode,
  ...ResultCode[],
]
const commandIdSchema = z.enum(commandIds)
const resultCodeSchema = z.enum(resultCodes)
const stationIdSchema = z.templateLiteral([z.string().min(1), ".", resultCodeSchema])
const actionSchema = z.enum(actionVocabulary)
const failureClassSchema = z.enum(failureClassVocabulary)
const transactionStateSchema = z.enum(transactionStateVocabulary)
const retrySafetySchema = z.enum(retrySafetyVocabulary)
const identifierSchema = z.string().regex(safeIdentifierPattern)
const runIdSchema = z.string().regex(runIdPattern)
const timestampSchema = z.iso.datetime()
const eventDeliveryFailureMessage =
  "Inspect the configured event transport; do not repeat the command solely to replay its event." as const
const eventDeliveryFailureProjection = failureNextActionProjection.find(
  ({ failureClass }) => failureClass === "event_delivery",
)
if (eventDeliveryFailureProjection === undefined) {
  throw new Error("missing event-delivery Next Action projection")
}

export const diagnosticFailureMessageFor = (resultCode: ResultCode): DiagnosticMessage =>
  `Maintenance command failed with result code "${resultCode}".`

export const diagnosticOutcomeContextMessageFor = (resultCode: ResultCode): DiagnosticMessage =>
  `Maintenance command reached result code "${resultCode}".`

export const diagnosticBufferMessageFor = (droppedRecordCount: number): DiagnosticMessage =>
  `Diagnostic buffer dropped ${droppedRecordCount} oldest record${droppedRecordCount === 1 ? "" : "s"}.`

export const eventDeliveryFailureNextAction = Object.freeze({
  id: eventDeliveryFailureProjection.id,
  action: eventDeliveryFailureProjection.action,
  summary: eventDeliveryFailureMessage,
  commandId: eventDeliveryFailureProjection.commandId,
} satisfies NextAction)

const nextActionSchema = z.strictObject({
  id: identifierSchema,
  action: actionSchema,
  summary: z.string(),
  commandId: z.union([commandIdSchema, z.null()]),
  retryAfterMs: z.number().int().nonnegative().exactOptional(),
  idempotencyKey: identifierSchema.exactOptional(),
})
const diagnosticMessageSchema = z.custom<DiagnosticMessage>(
  (value) => typeof value === "string",
)

const isExactCanonicalNextAction = (actual: NextAction, canonical: NextAction): boolean =>
  nextActionKeys.every((key) => actual[key] === canonical[key])

const diagnosticRecordFieldsSchema = z.strictObject({
  schema_version: z.literal(2),
  record_type: z.literal("diagnostic"),
  timestamp: timestampSchema,
  sequence: z.number().int().min(1),
  category: z.tuple([z.literal("agent-plugin-kit"), z.literal("maintenance")]).readonly(),
  event: identifierSchema,
  run_id: runIdSchema,
  command: commandIdSchema.exactOptional(),
  station_id: stationIdSchema.exactOptional(),
  failure_class: failureClassSchema.exactOptional(),
  result_code: resultCodeSchema.exactOptional(),
  transaction_state: transactionStateSchema.exactOptional(),
  retry_safety: retrySafetySchema.exactOptional(),
  dropped_record_count: z.number().int().positive().exactOptional(),
  message: diagnosticMessageSchema,
})
const diagnosticRecordBaseSchema = z.union([
  diagnosticRecordFieldsSchema.extend({
    level: z.enum(contextualDiagnosticLevels),
    next_action: nextActionSchema.exactOptional(),
  }),
  diagnosticRecordFieldsSchema.extend({
    level: z.enum(failureDiagnosticLevels),
    next_action: nextActionSchema,
  }),
])
type DiagnosticRecordCandidate = z.infer<typeof diagnosticRecordBaseSchema>

const canonicalDiagnosticMessageFor = (
  record: DiagnosticRecordCandidate,
): DiagnosticMessage | undefined => {
  if (record.event === "diagnostic.buffer-truncated") {
    return record.dropped_record_count === undefined
      ? undefined
      : diagnosticBufferMessageFor(record.dropped_record_count)
  }
  if (record.event === "maintenance.outcome-context") {
    return record.result_code === undefined
      ? undefined
      : diagnosticOutcomeContextMessageFor(record.result_code)
  }
  if (record.dropped_record_count !== undefined) return undefined
  if (record.event === "event.delivery-failed") return eventDeliveryFailureMessage
  return record.result_code === undefined
    ? undefined
    : diagnosticFailureMessageFor(record.result_code)
}

const diagnosticCommandFor = (
  record: DiagnosticRecordCandidate,
): Parameters<typeof canonicalNextActionFor>[0] | null | undefined => record.command ?? (
  record.station_id === "maintenance.usage-refused"
    ? "maintenance"
    : record.next_action?.commandId
)

const expectedDiagnosticNextActionFor = (
  record: DiagnosticRecordCandidate,
): NextAction | undefined => {
  if (record.event === "event.delivery-failed") {
    return record.failure_class === "event_delivery"
      ? eventDeliveryFailureNextAction
      : undefined
  }
  const command = diagnosticCommandFor(record)
  const canonical = command === null || command === undefined || record.result_code === undefined
    ? undefined
    : canonicalNextActionFor(command, record.result_code)
  return canonical
}

const hasCanonicalDiagnosticNextAction = (record: DiagnosticRecordCandidate): boolean => {
  if (record.next_action === undefined) {
    return record.level !== "error" && record.level !== "fatal"
  }
  const expected = expectedDiagnosticNextActionFor(record)
  return expected !== undefined && isExactCanonicalNextAction(record.next_action, expected)
}

const addOutcomeContextIssue = (
  ctx: z.RefinementCtx,
  condition: boolean,
  message: string,
  path: string,
): void => {
  if (condition) ctx.addIssue({ code: "custom", message, path: [path] })
}

const refineOutcomeContextShape = (
  record: DiagnosticRecordCandidate,
  ctx: z.RefinementCtx,
): void => {
  addOutcomeContextIssue(ctx, record.level !== "info", "outcome context must use info level", "level")
  addOutcomeContextIssue(ctx, record.station_id === undefined, "outcome context requires station metadata", "station_id")
  addOutcomeContextIssue(ctx, record.result_code === undefined, "outcome context requires result metadata", "result_code")
  addOutcomeContextIssue(ctx, record.failure_class !== undefined, "outcome context cannot carry failure class", "failure_class")
  addOutcomeContextIssue(ctx, record.next_action !== undefined, "outcome context cannot carry next action", "next_action")
  addOutcomeContextIssue(ctx, record.dropped_record_count !== undefined, "outcome context cannot carry dropped record count", "dropped_record_count")
}

const expectedOutcomeContextStationIdFor = (
  record: DiagnosticRecordCandidate,
): string | undefined => {
  if (record.command === undefined || record.result_code === undefined) return undefined
  return `${stationSlugFor(record.command)}.${record.result_code}`
}

const refineOutcomeContextCommand = (
  record: DiagnosticRecordCandidate,
  ctx: z.RefinementCtx,
): void => {
  if (record.station_id === undefined || record.result_code === undefined) return
  const usageRefusal = record.station_id === "maintenance.usage-refused"
  addOutcomeContextIssue(ctx, usageRefusal && record.command !== undefined, "usage refusal context cannot carry a command", "command")
  addOutcomeContextIssue(ctx, !usageRefusal && record.command === undefined, "selected command context requires a command", "command")
  addOutcomeContextIssue(
    ctx,
    record.command !== undefined && record.station_id !== expectedOutcomeContextStationIdFor(record),
    "outcome context command disagrees with station or result",
    "command",
  )
  const resultSuffix = record.station_id.slice(record.station_id.lastIndexOf(".") + 1)
  addOutcomeContextIssue(ctx, resultSuffix !== record.result_code, "outcome context station disagrees with result", "station_id")
}

const refineOutcomeContext = (record: DiagnosticRecordCandidate, ctx: z.RefinementCtx): void => {
  if (record.event !== "maintenance.outcome-context") return
  refineOutcomeContextShape(record, ctx)
  refineOutcomeContextCommand(record, ctx)
}

const refineDiagnosticRecord = (record: DiagnosticRecordCandidate, ctx: z.RefinementCtx): void => {
  const canonicalMessage = canonicalDiagnosticMessageFor(record)
  if (canonicalMessage === undefined || record.message !== canonicalMessage) {
    ctx.addIssue({ code: "custom", message: "invalid canonical diagnostic message", path: ["message"] })
  }
  if (!hasCanonicalDiagnosticNextAction(record)) {
    ctx.addIssue({ code: "custom", message: "invalid canonical diagnostic next action", path: ["next_action"] })
  }
  refineOutcomeContext(record, ctx)
}

const diagnosticRecordSchema = diagnosticRecordBaseSchema.superRefine(refineDiagnosticRecord)
const eventRecordSchema = z.strictObject({
  schema_version: z.literal(1),
  event_id: identifierSchema,
  occurred_at: timestampSchema,
  sequence: z.number().int().min(1),
  run_id: runIdSchema,
  command: commandIdSchema,
  station_id: stationIdSchema,
  outcome: z.enum(eventOutcomes),
  result_code: resultCodeSchema,
  failure_class: failureClassSchema.exactOptional(),
  transaction_state: transactionStateSchema,
  retry_safety: retrySafetySchema,
  next_action_id: identifierSchema,
})

const isRecord = (value: unknown): value is DiagnosticRecordInput =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const hasOwn = (value: DiagnosticRecordInput, key: string): boolean =>
  Object.hasOwn(value, key)

const buildNextActionAllowlist = (value: unknown): DiagnosticRecordInput | undefined => {
  if (!isRecord(value)) return undefined
  return Object.fromEntries(nextActionKeys.flatMap((key) => hasOwn(value, key) ? [[key, value[key]]] : []))
}

const buildDiagnosticAllowlist = (value: unknown): DiagnosticRecordInput | undefined => {
  if (!isRecord(value)) return undefined
  return Object.fromEntries(diagnosticRecordKeys.flatMap((key) => {
    if (!hasOwn(value, key)) return []
    return [[key, key === "next_action" ? buildNextActionAllowlist(value[key]) : value[key]]]
  }))
}

const buildEventAllowlist = (value: unknown): DiagnosticRecordInput | undefined => {
  if (!isRecord(value)) return undefined
  return Object.fromEntries(eventRecordKeys.flatMap((key) => hasOwn(value, key) ? [[key, value[key]]] : []))
}

const canonicalTimestamp = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined
  const timestamp = new Date(value)
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString()
}

const containsConfiguredSecret = (
  value: unknown,
  secrets: readonly string[],
): boolean => {
  if (typeof value === "string") {
    return secrets.some((secret) => secret.length > 0 && value.includes(secret))
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsConfiguredSecret(entry, secrets))
  }
  if (isRecord(value)) {
    return Object.values(value).some((entry) => containsConfiguredSecret(entry, secrets))
  }
  return false
}

type DiagnosticRecordSchema = z.infer<typeof diagnosticRecordSchema>
type EventRecordSchema = z.infer<typeof eventRecordSchema>

const observabilityTypeChecks: [
  DiagnosticRecordSchema extends import("./interface").DiagnosticRecord ? true : false,
  import("./interface").DiagnosticRecord extends DiagnosticRecordSchema ? true : false,
  EventRecordSchema extends import("./interface").EventRecord ? true : false,
  import("./interface").EventRecord extends EventRecordSchema ? true : false,
] = [true, true, true, true]

void observabilityTypeChecks

const allowlistedRecordFor = (
  value: unknown,
  allowlist: (value: unknown) => DiagnosticRecordInput | undefined,
  trace?: (step: DiagnosticEgressStep) => void,
): DiagnosticRecordInput | undefined => {
  const allowed = allowlist(value)
  if (allowed === undefined || !isPlainJsonTree(allowed)) return undefined
  trace?.("build-allowlist")
  return allowed
}

const canonicalRecordFor = (
  allowed: DiagnosticRecordInput,
  timestampKey: "timestamp" | "occurred_at",
  trace?: (step: DiagnosticEgressStep) => void,
): DiagnosticRecordInput | undefined => {
  const timestamp = canonicalTimestamp(allowed[timestampKey])
  if (timestamp === undefined) return undefined
  allowed[timestampKey] = timestamp
  trace?.("canonicalize")
  return allowed
}

const sanitizeRecord = <T>(
  schema: z.ZodType<T>,
  value: unknown,
  allowlist: (value: unknown) => DiagnosticRecordInput | undefined,
  timestampKey: "timestamp" | "occurred_at",
  secrets: readonly string[],
  trace?: (step: DiagnosticEgressStep) => void,
): T | undefined => {
  const allowed = allowlistedRecordFor(value, allowlist, trace)
  if (allowed === undefined) return undefined
  const canonical = canonicalRecordFor(allowed, timestampKey, trace)
  if (canonical === undefined || containsConfiguredSecret(canonical, secrets)) return undefined
  const parsed = schema.safeParse(canonical)
  if (!parsed.success) return undefined
  trace?.("validate")
  const frozen = deepFreeze(parsed.data)
  trace?.("freeze")
  return frozen
}

/**
 * Project, canonicalize, validate, and freeze a diagnostic record. Returns
 * undefined when the record is non-canonical, fails validation, or contains an
 * exact configured secret. The environmental Adapter owns native field
 * redaction immediately before its sink.
 */
export const sanitizeDiagnosticRecord = (
  value: unknown,
  secrets: readonly string[] = [],
  trace?: (step: DiagnosticEgressStep) => void,
): import("./interface").DiagnosticRecord | undefined =>
  sanitizeRecord(diagnosticRecordSchema, value, buildDiagnosticAllowlist, "timestamp", secrets, trace)

/**
 * Project, canonicalize, validate, and freeze an event record. Returns
 * undefined when the record fails validation or contains an exact configured
 * secret.
 */
export const sanitizeEventRecord = (
  value: unknown,
  secrets: readonly string[] = [],
): import("./interface").EventRecord | undefined =>
  sanitizeRecord(eventRecordSchema, value, buildEventAllowlist, "occurred_at", secrets)

const validate = <T>(schema: z.ZodType<T>, value: unknown): T | undefined => {
  if (!isPlainJsonTree(value)) return undefined
  const parsed = schema.safeParse(value)
  return parsed.success ? deepFreeze(parsed.data) : undefined
}

/**
 * Validate and freeze a facade success envelope. Returns the validated envelope
 * or undefined if validation fails.
 */
export const validateFacadeSuccessEnvelope = (value: unknown): FacadeSuccessEnvelope | undefined =>
  validate(facadeSuccessEnvelopeSchema, value)

/**
 * Validate and freeze a facade error envelope. Returns the validated envelope
 * or undefined if validation fails.
 */
export const validateFacadeErrorEnvelope = (value: unknown): FacadeErrorEnvelope | undefined =>
  validate(facadeErrorEnvelopeSchema, value)

/**
 * Serialize a facade success envelope to a newline-terminated JSON string.
 * Returns undefined if the envelope fails validation.
 */
export const serializeFacadeSuccessEgress = (value: unknown): string | undefined => {
  const parsed = validateFacadeSuccessEnvelope(value)
  return parsed === undefined ? undefined : `${JSON.stringify(parsed)}\n`
}

/**
 * Serialize a facade error envelope to a newline-terminated JSON string.
 * Returns undefined if the envelope fails validation.
 */
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
