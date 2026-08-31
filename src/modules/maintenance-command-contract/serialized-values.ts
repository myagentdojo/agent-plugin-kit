import { z } from "zod"
import type {
  AgentPayload,
  CommandPreview,
  CommandResult,
  EffectClass,
  FailureClass,
  JsonValue,
  MaintenanceAction,
  MaintenanceApplyRequest,
  MaintenanceCommand,
  MaintenanceError,
  MaintenanceOutcome,
  NextAction,
  ResultCode,
  RetrySafety,
  StationId,
  TransactionState,
} from "./interface"
import { commandVocabulary } from "./command-vocabulary"
import { resultVocabulary } from "./result-vocabulary"

export type MaintenancePreviewOutcome = MaintenanceOutcome<CommandPreview>
export type MaintenanceResultOutcome = MaintenanceOutcome<CommandResult>
export type MaintenanceErrorOutcome = Extract<MaintenanceOutcome<never>, { status: "error" }>

const commandIds = commandVocabulary.map(({ command }) => command) as [
  MaintenanceCommand["command"],
  ...MaintenanceCommand["command"][],
]
const applyCommandIds = commandVocabulary
  .filter(({ interfaceCall }) => interfaceCall === "apply")
  .map(({ command }) => command) as [
    MaintenanceApplyRequest["command"],
    ...MaintenanceApplyRequest["command"][],
  ]
const resultCodes = resultVocabulary.map(({ resultCode }) => resultCode) as [
  ResultCode,
  ...ResultCode[],
]

const commandIdSchema = z.enum(commandIds)
const applyCommandIdSchema = z.enum(applyCommandIds)
const resultCodeSchema = z.enum(resultCodes)
const stationIdSchema = z.templateLiteral([z.string().min(1), ".", resultCodeSchema])
const effectClassSchema = z.enum(["inspect", "repository-local", "external"])
const transactionStateSchema = z.enum([
  "unchanged",
  "completed",
  "partially-completed",
  "unknown",
])
const retrySafetySchema = z.enum(["safe", "unsafe", "requires-fresh-inspection"])
const maintenanceActionSchema = z.enum([
  "change_input",
  "contact_support",
  "inspect_state",
  "open_docs",
  "repair_state",
  "retry",
  "run_command",
  "select_command",
  "wait",
])
const failureClassSchema = z.enum([
  "usage",
  "refusal",
  "transient",
  "continuation",
  "recovery",
  "unexpected",
  "event_delivery",
])

const jsonPrimitiveSchema = z.union([z.null(), z.boolean(), z.number().finite(), z.string()])
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  jsonPrimitiveSchema,
  z.array(jsonValueSchema).readonly(),
  z.record(z.string(), jsonValueSchema),
]))
const agentPayloadSchema = z.object({ schemaVersion: z.literal(1) }).catchall(jsonValueSchema)
const nextActionSchema = z.strictObject({
  id: z.string(),
  action: maintenanceActionSchema,
  summary: z.string(),
  commandId: commandIdSchema.nullable(),
  retryAfterMs: z.number().int().nonnegative().exactOptional(),
  idempotencyKey: z.string().exactOptional(),
})
const maintenanceErrorCommonShape = {
  name: z.literal("MaintenanceCommandError"),
  nextAction: nextActionSchema,
  retryAfterMs: z.number().int().nonnegative().exactOptional(),
  idempotencyKey: z.string().exactOptional(),
} as const
const maintenanceErrorSchema = z.discriminatedUnion("failureClass", [
  z.strictObject({
    ...maintenanceErrorCommonShape,
    exitCodeHint: z.literal(20),
    failureClass: z.literal("continuation"),
    errorFamily: z.literal("state_conflict"),
    severity: z.literal("error"),
    action: z.literal("inspect_state"),
    retryable: z.literal(false),
    recoverability: z.literal("repair_state"),
    retrySafety: z.literal("unsafe"),
    transactionState: z.literal("partially-completed"),
    completedEffectIds: z.array(z.string()).readonly(),
    remainingEffectIds: z.tuple([z.string()], z.string()).readonly(),
  }),
  z.strictObject({
    ...maintenanceErrorCommonShape,
    exitCodeHint: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(20),
      z.literal(21),
      z.literal(22),
      z.literal(23),
    ]),
    failureClass: failureClassSchema.exclude(["event_delivery", "continuation"]),
    errorFamily: z.enum([
      "input",
      "state_conflict",
      "authentication",
      "authorization_scope",
      "network",
      "transient",
      "runtime",
    ]),
    severity: z.enum(["warning", "error", "fatal"]),
    action: maintenanceActionSchema,
    retryable: z.boolean(),
    recoverability: z.enum([
      "none",
      "retry",
      "change_input",
      "authenticate",
      "repair_state",
      "contact_support",
    ]),
    retrySafety: retrySafetySchema,
    transactionState: transactionStateSchema,
  }),
])
const commandPreviewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  command: commandIdSchema,
  effectClass: effectClassSchema,
  expectedEffectIds: z.array(z.string()).readonly(),
  transactionState: transactionStateSchema,
  retrySafety: retrySafetySchema,
  nextAction: nextActionSchema,
  human: z.string(),
  agent: agentPayloadSchema,
  stderr: z.string(),
})
const commandResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  command: applyCommandIdSchema,
  transactionState: transactionStateSchema,
  retrySafety: retrySafetySchema,
  completedEffectIds: z.array(z.string()).readonly(),
  remainingEffectIds: z.array(z.string()).readonly(),
  nextAction: nextActionSchema,
  human: z.string(),
  agent: agentPayloadSchema,
  stderr: z.string(),
})
const previewOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    resultCode: resultCodeSchema,
    stationId: stationIdSchema,
    value: commandPreviewSchema,
  }),
  z.strictObject({
    status: z.literal("error"),
    resultCode: resultCodeSchema,
    stationId: stationIdSchema,
    error: maintenanceErrorSchema,
  }),
])
const resultOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ok"),
    resultCode: resultCodeSchema,
    stationId: stationIdSchema,
    value: commandResultSchema,
  }),
  z.strictObject({
    status: z.literal("error"),
    resultCode: resultCodeSchema,
    stationId: stationIdSchema,
    error: maintenanceErrorSchema,
  }),
])
const errorOutcomeSchema = z.strictObject({
  status: z.literal("error"),
  resultCode: resultCodeSchema,
  stationId: stationIdSchema,
  error: maintenanceErrorSchema,
})

function isPlainJsonArray(value: unknown[], seen: Set<object>): boolean {
  if (Object.getPrototypeOf(value) !== Array.prototype) return false
  if (Reflect.ownKeys(value).some((key) =>
    key !== "length" && (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)))) return false
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || !isPlainJsonTree(value[index], seen)) return false
  }
  return true
}

function isPlainJsonRecord(value: object, seen: Set<object>): boolean {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return false
    if (!isPlainJsonTree(descriptor.value, seen)) return false
  }
  return true
}

function isPlainJsonTree(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value !== "object" || seen.has(value)) return false
  seen.add(value)
  const valid = Array.isArray(value)
    ? isPlainJsonArray(value, seen)
    : isPlainJsonRecord(value, seen)
  seen.delete(value)
  return valid
}

function parseValue<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  if (!isPlainJsonTree(value)) return undefined
  const result = schema.safeParse(value)
  if (!result.success) return undefined
  return result.data
}

function serializeValue<T>(schema: z.ZodType<T>, value: T): string {
  if (!isPlainJsonTree(value)) {
    throw new Error("maintenance-command-contract: invalid serialized value")
  }
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new Error("maintenance-command-contract: invalid serialized value")
  }
  return JSON.stringify(result.data)
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function validateEgress<T>(schema: z.ZodType<T>, value: T): T {
  const parsed = parseValue(schema, value)
  if (parsed === undefined) throw new Error("maintenance-command-contract: invalid serialized egress")
  return deepFreeze(parsed)
}

export function parseCommandPreview(value: unknown): CommandPreview | undefined {
  return parseValue(commandPreviewSchema, value)
}

export function parseCommandResult(value: unknown): CommandResult | undefined {
  return parseValue(commandResultSchema, value)
}

export function parseMaintenanceError(value: unknown): MaintenanceError | undefined {
  return parseValue(maintenanceErrorSchema, value)
}

export function parseMaintenancePreviewOutcome(value: unknown): MaintenancePreviewOutcome | undefined {
  return parseValue(previewOutcomeSchema, value)
}

export function parseMaintenanceResultOutcome(value: unknown): MaintenanceResultOutcome | undefined {
  return parseValue(resultOutcomeSchema, value)
}

export function serializeMaintenancePreviewOutcome(value: MaintenancePreviewOutcome): string {
  return serializeValue(previewOutcomeSchema, value)
}

export function serializeMaintenanceResultOutcome(value: MaintenanceResultOutcome): string {
  return serializeValue(resultOutcomeSchema, value)
}

export function validateMaintenancePreviewEgress(
  value: MaintenancePreviewOutcome,
): MaintenancePreviewOutcome {
  return validateEgress(previewOutcomeSchema, value)
}

export function validateMaintenanceResultEgress(
  value: MaintenanceResultOutcome,
): MaintenanceResultOutcome {
  return validateEgress(resultOutcomeSchema, value)
}

export function validateMaintenanceErrorEgress(value: MaintenanceErrorOutcome): MaintenanceErrorOutcome {
  return validateEgress(errorOutcomeSchema, value)
}

type InferredStationId = z.infer<typeof stationIdSchema>
type InferredEffectClass = z.infer<typeof effectClassSchema>
type InferredTransactionState = z.infer<typeof transactionStateSchema>
type InferredRetrySafety = z.infer<typeof retrySafetySchema>
type InferredMaintenanceAction = z.infer<typeof maintenanceActionSchema>
type InferredFailureClass = z.infer<typeof failureClassSchema>
type InferredNextAction = z.infer<typeof nextActionSchema>
type InferredAgentPayload = z.infer<typeof agentPayloadSchema>
type InferredMaintenanceError = z.infer<typeof maintenanceErrorSchema>
type InferredCommandPreview = z.infer<typeof commandPreviewSchema>
type InferredCommandResult = z.infer<typeof commandResultSchema>
type InferredPreviewOutcome = z.infer<typeof previewOutcomeSchema>
type InferredResultOutcome = z.infer<typeof resultOutcomeSchema>

const bidirectionalTypeChecks: [
  InferredStationId extends StationId ? true : false,
  StationId extends InferredStationId ? true : false,
  InferredEffectClass extends EffectClass ? true : false,
  EffectClass extends InferredEffectClass ? true : false,
  InferredTransactionState extends TransactionState ? true : false,
  TransactionState extends InferredTransactionState ? true : false,
  InferredRetrySafety extends RetrySafety ? true : false,
  RetrySafety extends InferredRetrySafety ? true : false,
  InferredMaintenanceAction extends MaintenanceAction ? true : false,
  MaintenanceAction extends InferredMaintenanceAction ? true : false,
  InferredFailureClass extends FailureClass ? true : false,
  FailureClass extends InferredFailureClass ? true : false,
  InferredNextAction extends NextAction ? true : false,
  NextAction extends InferredNextAction ? true : false,
  InferredAgentPayload extends AgentPayload ? true : false,
  AgentPayload extends InferredAgentPayload ? true : false,
  InferredMaintenanceError extends MaintenanceError ? true : false,
  MaintenanceError extends InferredMaintenanceError ? true : false,
  InferredCommandPreview extends CommandPreview ? true : false,
  CommandPreview extends InferredCommandPreview ? true : false,
  InferredCommandResult extends CommandResult ? true : false,
  CommandResult extends InferredCommandResult ? true : false,
  InferredPreviewOutcome extends MaintenancePreviewOutcome ? true : false,
  MaintenancePreviewOutcome extends InferredPreviewOutcome ? true : false,
  InferredResultOutcome extends MaintenanceResultOutcome ? true : false,
  MaintenanceResultOutcome extends InferredResultOutcome ? true : false,
] = [
  true, true, true, true, true, true, true, true, true, true, true, true,
  true, true,
  true, true, true, true, true, true, true, true, true, true, true, true,
]

void bidirectionalTypeChecks
