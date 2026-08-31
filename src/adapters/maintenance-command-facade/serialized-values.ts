import { z } from "zod"
import type {
  FacadeErrorEnvelope,
  FacadeSuccessEnvelope,
  DiagnosticRedactionStep,
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
import { commandVocabulary } from "../../modules/maintenance-command-contract/command-vocabulary"
import {
  actionVocabulary,
  failureClassVocabulary,
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
const diagnosticLevels = ["debug", "info", "warning", "error", "fatal"] as const
const eventOutcomes = ["previewed", "completed", "refused", "failed"] as const
const safeIdentifierPattern = /^[A-Za-z0-9._:-]{1,160}$/
const runIdPattern = /^[A-Za-z0-9._-]{1,64}$/
const maximumCredentialMatchLength = 4096
const secretKeyPattern = /(?:password|passwd|secret|token|authorization|cookie|credential|private[-_]?key|api[-_]?key)/i
const uriSchemePattern = "[A-Za-z][A-Za-z0-9+.-]*"
const secretAssignmentPattern = /(^|[^A-Za-z0-9])(secret|password|passwd|token|credential|authorization|cookie|private[-_ ]?key|api[-_ ]?key)(\s*)([:=])(\s*)("(?:\\.|[^"\\])*"[^\s]*|'(?:\\.|[^'\\])*'[^\s]*|"(?:(?:\\.|[^"\\])*)$|'(?:(?:\\.|[^'\\])*)$|[^\s]+)/gi
const authUrlPattern = new RegExp(
  `(^|[^A-Za-z0-9])(?=${uriSchemePattern}:\\/\\/[^\\s@]{1,${maximumCredentialMatchLength}}@)${uriSchemePattern}:\\/\\/[^\\s@]{1,${maximumCredentialMatchLength}}@[^\\s]+`,
  "gi",
)
const authUrlDetectPattern = new RegExp(
  `(?:^|[^A-Za-z0-9])${uriSchemePattern}:\\/\\/[^\\s@]+@`,
  "i",
)
const incompleteAuthUrlDetectPattern = new RegExp(
  `(?:^|[^A-Za-z0-9])${uriSchemePattern}:\\/\\/[^\\s/:@?#]*:(?![0-9]+(?:[/?#]|$|[\\s,;]))[^\\s@,;]*(?=$|[\\s,;])`,
  "i",
)
const privateKeyPattern = /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi
const privateKeyDetectPattern = /-----BEGIN [^-]*PRIVATE KEY-----/i
const credentialCandidatePattern = `[^\\s]{1,${maximumCredentialMatchLength}}`
const bearerCredentialPattern = new RegExp(
  `(^|[^A-Za-z0-9])(?:bearer|basic)\\s+${credentialCandidatePattern}(?![^\\s])`,
  "gi",
)
const bearerCredentialDetectPattern = /(?:^|[^A-Za-z0-9])(?:bearer|basic)\s+/i
const opReferencePattern = new RegExp(
  `(^|[^A-Za-z0-9])op:\\/\\/${credentialCandidatePattern}(?![^\\s])`,
  "gi",
)
const opReferenceDetectPattern = /(?:^|[^A-Za-z0-9])op:\/\//i
const redactedDiagnosticValue = "[REDACTED]"
const maximumDiagnosticNestedDepth = 4
const maximumDiagnosticArrayEntries = 100

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
const nextActionSchema = z.strictObject({
  id: identifierSchema,
  action: actionSchema,
  summary: z.string(),
  commandId: z.union([commandIdSchema, z.null()]),
  retryAfterMs: z.number().int().nonnegative().exactOptional(),
  idempotencyKey: identifierSchema.exactOptional(),
})
const diagnosticRecordSchema = z.strictObject({
  schema_version: z.literal(1),
  record_type: z.literal("diagnostic"),
  timestamp: timestampSchema,
  sequence: z.number().int().min(1),
  level: z.enum(diagnosticLevels),
  category: z.tuple([z.literal("agent-plugin-kit"), z.literal("maintenance")]).readonly(),
  event: identifierSchema,
  run_id: runIdSchema,
  command: commandIdSchema.exactOptional(),
  station_id: stationIdSchema.exactOptional(),
  failure_class: failureClassSchema.exactOptional(),
  result_code: resultCodeSchema.exactOptional(),
  transaction_state: transactionStateSchema.exactOptional(),
  retry_safety: retrySafetySchema.exactOptional(),
  next_action: nextActionSchema.exactOptional(),
  message: z.string(),
})
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

const replaceConfiguredSecrets = (value: string, secrets: readonly string[]): string => {
  let redacted = value
  for (const secret of [...secrets].filter((candidate) => candidate.length > 0).sort((left, right) => right.length - left.length)) {
    redacted = redacted.split(secret).join(redactedDiagnosticValue)
  }
  return redacted
}

const redactString = (value: string, secrets: readonly string[]): string => {
  const configured = replaceConfiguredSecrets(value, secrets)
  const privateKeyRedacted = configured.replace(privateKeyPattern, redactedDiagnosticValue)
  const preserveBoundaryAndRedact = (_match: string, boundary: string): string => `${boundary}${redactedDiagnosticValue}`
  const urlRedacted = privateKeyRedacted.replace(authUrlPattern, preserveBoundaryAndRedact)
  const bearerRedacted = urlRedacted.replace(bearerCredentialPattern, preserveBoundaryAndRedact)
  const opReferenceRedacted = bearerRedacted.replace(opReferencePattern, preserveBoundaryAndRedact)
  return opReferenceRedacted.replace(secretAssignmentPattern, (_match, boundary: string, key: string, beforeSeparator: string, separator: string, afterSeparator: string) => `${boundary}${key}${beforeSeparator}${separator}${afterSeparator}${redactedDiagnosticValue}`)
}

const isRedactionBlocked = (key: string, depth: number): boolean =>
  secretKeyPattern.test(key) || depth > maximumDiagnosticNestedDepth

const redactArray = (
  value: readonly unknown[],
  depth: number,
  secrets: readonly string[],
): unknown => value.length > maximumDiagnosticArrayEntries
  ? redactedDiagnosticValue
  : value.map((entry) => redactValue(entry, "", depth + 1, secrets))

const redactObject = (
  value: DiagnosticRecordInput,
  depth: number,
  secrets: readonly string[],
): unknown => {
  const entries = Object.entries(value)
  return entries.length > maximumDiagnosticArrayEntries
    ? redactedDiagnosticValue
    : Object.fromEntries(entries.map(([entryKey, entryValue]) => [
      entryKey,
      redactValue(entryValue, entryKey, depth + 1, secrets),
    ]))
}

const redactScalar = (value: unknown, secrets: readonly string[]): unknown => {
  if (typeof value === "string") return redactString(value, secrets)
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : redactedDiagnosticValue
  return redactedDiagnosticValue
}

const redactValue = (
  value: unknown,
  key: string,
  depth: number,
  secrets: readonly string[],
): unknown => {
  if (isRedactionBlocked(key, depth)) return redactedDiagnosticValue
  if (Array.isArray(value)) return redactArray(value, depth, secrets)
  if (isRecord(value)) return redactObject(value, depth, secrets)
  return redactScalar(value, secrets)
}

const redactRecord = (value: DiagnosticRecordInput, secrets: readonly string[]): DiagnosticRecordInput =>
  Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [
    key,
    redactValue(entryValue, key, 0, secrets),
  ]))

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

const isSecretValue = (value: string): boolean =>
  bearerCredentialDetectPattern.test(value) ||
  opReferenceDetectPattern.test(value) ||
  authUrlDetectPattern.test(value) ||
  incompleteAuthUrlDetectPattern.test(value) ||
  privateKeyDetectPattern.test(value)

const hasUnredactedSecret = (value: unknown, secrets: readonly string[], depth = 0): boolean => {
  if (depth > maximumDiagnosticNestedDepth) return value !== redactedDiagnosticValue
  if (typeof value === "string") {
    return value !== redactedDiagnosticValue && (isSecretValue(value) || secrets.some((secret) => secret.length > 0 && value.includes(secret)))
  }
  if (Array.isArray(value)) return value.some((entry) => hasUnredactedSecret(entry, secrets, depth + 1))
  if (isRecord(value)) return Object.entries(value).some(([key, entryValue]) => secretKeyPattern.test(key) || hasUnredactedSecret(entryValue, secrets, depth + 1))
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
  trace?: (step: DiagnosticRedactionStep) => void,
): DiagnosticRecordInput | undefined => {
  const allowed = allowlist(value)
  if (allowed === undefined || !isPlainJsonTree(allowed)) return undefined
  trace?.("build-allowlist")
  return allowed
}

const redactedRecordFor = (
  allowed: DiagnosticRecordInput,
  timestampKey: "timestamp" | "occurred_at",
  secrets: readonly string[],
  trace?: (step: DiagnosticRedactionStep) => void,
): DiagnosticRecordInput | undefined => {
  const redacted = redactRecord(allowed, secrets)
  const timestamp = canonicalTimestamp(redacted[timestampKey])
  if (timestamp === undefined) return undefined
  redacted[timestampKey] = timestamp
  trace?.("redact")
  return redacted
}

const sanitizeRecord = <T>(
  schema: z.ZodType<T>,
  value: unknown,
  allowlist: (value: unknown) => DiagnosticRecordInput | undefined,
  timestampKey: "timestamp" | "occurred_at",
  secrets: readonly string[],
  trace?: (step: DiagnosticRedactionStep) => void,
): T | undefined => {
  const allowed = allowlistedRecordFor(value, allowlist, trace)
  if (allowed === undefined) return undefined
  const redacted = redactedRecordFor(allowed, timestampKey, secrets, trace)
  if (redacted === undefined) return undefined
  if (!isPlainJsonTree(redacted) || hasUnredactedSecret(redacted, secrets)) return undefined
  const parsed = schema.safeParse(redacted)
  if (!parsed.success) return undefined
  trace?.("validate")
  const frozen = deepFreeze(parsed.data)
  trace?.("freeze")
  return frozen
}

/**
 * Sanitize and validate a diagnostic record by filtering allowed fields,
 * redacting sensitive values, and ensuring schema compliance. Returns undefined
 * if the record fails validation or contains unredacted secrets.
 */
export const sanitizeDiagnosticRecord = (
  value: unknown,
  secrets: readonly string[] = [],
  trace?: (step: DiagnosticRedactionStep) => void,
): import("./interface").DiagnosticRecord | undefined =>
  sanitizeRecord(diagnosticRecordSchema, value, buildDiagnosticAllowlist, "timestamp", secrets, trace)

/**
 * Sanitize and validate an event record by filtering allowed fields, redacting
 * sensitive values, and ensuring schema compliance. Returns undefined if the
 * record fails validation or contains unredacted secrets.
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
