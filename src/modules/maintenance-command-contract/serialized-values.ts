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
import type { BranchStationMembership } from "./branch-stations"
import {
  canonicalNextActionFor,
  isDeclaredBranchStation,
  stationSlugFor,
} from "./branch-stations"
import { commandVocabulary } from "./command-vocabulary"
import {
  actionVocabulary,
  effectClassVocabulary,
  errorFamilyVocabulary,
  errorSeverityVocabulary,
  failureClassPolicy,
  failureClassVocabulary,
  recoverabilityVocabulary,
  resultVocabulary,
  retrySafetyForEffectClass,
  retrySafetyVocabulary,
  transactionStateVocabulary,
} from "./result-vocabulary"

export type MaintenancePreviewOutcome = MaintenanceOutcome<CommandPreview>
export type MaintenanceResultOutcome = MaintenanceOutcome<CommandResult>
export type MaintenanceErrorOutcome = Extract<MaintenanceOutcome<never>, { status: "error" }>

type CommandCatalogRow = (typeof commandVocabulary)[number]
type CatalogCommandId = CommandCatalogRow["command"]
type CatalogApplyCommandId = Extract<CommandCatalogRow, { interfaceCall: "apply" }>["command"]
type CatalogInspectCommandId = Extract<CommandCatalogRow, { interfaceCall: "inspect" }>["command"]
type CatalogResultCode = (typeof resultVocabulary)[number]["resultCode"]
type DeclaredInspectCommandId = Exclude<
  MaintenanceCommand["command"],
  MaintenanceApplyRequest["command"]
>

/**
 * The sealed catalogs and the declared unions must denote the same commands and
 * Result Codes in both directions. A removed catalog row, an added declared
 * member, or a changed `interfaceCall` partition fails this assertion at
 * compile time, before any enum tuple is built from catalog data.
 */
const catalogEquivalenceChecks: [
  CatalogCommandId extends MaintenanceCommand["command"] ? true : false,
  MaintenanceCommand["command"] extends CatalogCommandId ? true : false,
  CatalogApplyCommandId extends MaintenanceApplyRequest["command"] ? true : false,
  MaintenanceApplyRequest["command"] extends CatalogApplyCommandId ? true : false,
  CatalogInspectCommandId extends DeclaredInspectCommandId ? true : false,
  DeclaredInspectCommandId extends CatalogInspectCommandId ? true : false,
  CatalogResultCode extends ResultCode ? true : false,
  ResultCode extends CatalogResultCode ? true : false,
] = [true, true, true, true, true, true, true, true]

void catalogEquivalenceChecks

const isApplyCatalogRow = (
  descriptor: CommandCatalogRow,
): descriptor is Extract<CommandCatalogRow, { interfaceCall: "apply" }> =>
  descriptor.interfaceCall === "apply"

const commandIds = commandVocabulary.map(({ command }) => command) as [
  CatalogCommandId,
  ...CatalogCommandId[],
]
const applyCommandIds = commandVocabulary
  .filter(isApplyCatalogRow)
  .map(({ command }) => command) as [CatalogApplyCommandId, ...CatalogApplyCommandId[]]
const resultCodes = resultVocabulary.map(({ resultCode }) => resultCode) as [
  CatalogResultCode,
  ...CatalogResultCode[],
]

const commandIdSchema = z.enum(commandIds)
const applyCommandIdSchema = z.enum(applyCommandIds)
const resultCodeSchema = z.enum(resultCodes)
const stationIdSchema = z.templateLiteral([z.string().min(1), ".", resultCodeSchema])
const effectClassSchema = z.enum(effectClassVocabulary)
const transactionStateSchema = z.enum(transactionStateVocabulary)
const retrySafetySchema = z.enum(retrySafetyVocabulary)
const maintenanceActionSchema = z.enum(actionVocabulary)
const failureClassSchema = z.enum(failureClassVocabulary)
const errorFamilySchema = z.enum(errorFamilyVocabulary)
const recoverabilitySchema = z.enum(recoverabilityVocabulary)
const errorSeveritySchema = z.enum(errorSeverityVocabulary)
type NonContinuationFailureClass = Exclude<MaintenanceError["failureClass"], "continuation">
const nonContinuationFailureClassValues = failureClassVocabulary.filter(
  (failureClass): failureClass is NonContinuationFailureClass =>
    Object.hasOwn(failureClassPolicy, failureClass) && failureClass !== "continuation",
) as [NonContinuationFailureClass, ...NonContinuationFailureClass[]]
const nonContinuationFailureClassSchema = z.enum(nonContinuationFailureClassValues)
const continuationFailureClass = failureClassVocabulary.find((failureClass) => failureClass === "continuation")
if (continuationFailureClass === undefined) throw new Error("missing continuation Failure Class vocabulary value")

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
const commandDescriptorsByCommand = Object.fromEntries(
  commandVocabulary.map((descriptor) => [descriptor.command, descriptor]),
) as Record<CatalogCommandId, CommandCatalogRow>

const addValueIssue = (ctx: z.RefinementCtx, path: PropertyKey[]) => {
  ctx.addIssue({ code: "custom", message: "invalid serialized value", path })
}

/** Canonical meaning shared by fixed and retry-enriched Next Actions. */
const hasCanonicalNextActionMeaning = (actual: NextAction, canonical: NextAction): boolean =>
  actual.id === canonical.id &&
  actual.action === canonical.action &&
  actual.summary === canonical.summary &&
  actual.commandId === canonical.commandId

/** Success values cannot add retry metadata to their fixed canonical Next Action. */
const isExactCanonicalNextAction = (actual: NextAction, canonical: NextAction): boolean =>
  hasCanonicalNextActionMeaning(actual, canonical) &&
  actual.retryAfterMs === canonical.retryAfterMs &&
  actual.idempotencyKey === canonical.idempotencyKey

type SuccessValueKind = "preview" | "result"

/** The result-agnostic success Result Code the opposite value kind owns. */
const foreignSuccessResultCode = { preview: "completed", result: "previewed" } as const

const canonicalSuccessNextActions = new Map<string, readonly NextAction[]>()
for (const descriptor of commandVocabulary) {
  for (const kind of ["preview", "result"] as const) {
    for (const transactionState of transactionStateVocabulary) {
      const actions = resultVocabulary
        .filter((candidate) =>
          candidate.exitClass === 0 &&
          candidate.transactionState === transactionState &&
          candidate.resultCode !== foreignSuccessResultCode[kind] &&
          isDeclaredBranchStation({
            commandId: descriptor.command,
            resultCode: candidate.resultCode,
            classification: "success",
          }))
        .flatMap((candidate) => {
          const canonical = canonicalNextActionFor(descriptor.command, candidate.resultCode)
          return canonical === undefined ? [] : [canonical]
        })
      canonicalSuccessNextActions.set(`${descriptor.command}|${kind}|${transactionState}`, actions)
    }
  }
}

const canonicalSuccessNextActionsFor = (
  command: CatalogCommandId,
  kind: SuccessValueKind,
  transactionState: TransactionState,
): readonly NextAction[] => canonicalSuccessNextActions.get(`${command}|${kind}|${transactionState}`) ?? []

type MaintenanceFailureProjection = {
  exitCodeHint: MaintenanceError["exitCodeHint"]
  failureClass: MaintenanceError["failureClass"]
  severity: MaintenanceError["severity"]
  action: MaintenanceAction
  retryable: boolean
  retrySafety: RetrySafety
  transactionState: TransactionState
  errorFamily: MaintenanceError["errorFamily"]
  recoverability: MaintenanceError["recoverability"]
  nextAction: NextAction
}

/**
 * Every failure meaning a Next Action identity can carry. Result Codes that
 * share one Next Action must project the same failure meaning, so this map is a
 * function and a Maintenance Error can be checked without its Result Code.
 */
const failureProjectionsByNextActionId = new Map<string, MaintenanceFailureProjection>()
for (const descriptor of resultVocabulary) {
  const exitCodeHint = descriptor.exitClass
  const failureClass = descriptor.failureClass
  if (exitCodeHint === 0 || failureClass === null) continue
  const policy = failureClassPolicy[failureClass]
  const projection: MaintenanceFailureProjection = {
    exitCodeHint,
    failureClass,
    severity: descriptor.severity === "info" ? "error" : descriptor.severity,
    action: descriptor.nextAction.action,
    retryable: descriptor.retrySafety === "safe" && descriptor.exitFamilyId === "transient-retry",
    retrySafety: descriptor.retrySafety,
    transactionState: descriptor.transactionState,
    errorFamily: policy.errorFamily,
    recoverability: policy.recoverability,
    nextAction: descriptor.nextAction,
  }
  const earlier = failureProjectionsByNextActionId.get(descriptor.nextAction.id)
  if (earlier === undefined) {
    failureProjectionsByNextActionId.set(descriptor.nextAction.id, projection)
    continue
  }
  if (JSON.stringify(earlier) !== JSON.stringify(projection)) {
    throw new Error(`conflicting Maintenance failure projection: ${descriptor.nextAction.id}`)
  }
}

/**
 * Owner-local semantic refinement shared by the direct public parsers and the
 * composed outcome parsers. These three functions reject only the relationships
 * a value carries enough of itself to decide: a Command Preview and a Command
 * Result know their command, and a Maintenance Error knows its Next Action.
 * Relationships that need the Result Code or the Station ID stay with the
 * composed outcome refinement, which owns the rest of the contract.
 */
const refineCommandPreviewValue = (preview: CommandPreview, ctx: z.RefinementCtx) => {
  const descriptor = commandDescriptorsByCommand[preview.command]
  if (preview.effectClass !== descriptor.effectClass) addValueIssue(ctx, ["effectClass"])
  if (preview.retrySafety !== retrySafetyForEffectClass(descriptor.effectClass)) {
    addValueIssue(ctx, ["retrySafety"])
  }
  if (preview.transactionState !== "unchanged") addValueIssue(ctx, ["transactionState"])
  const canonical = canonicalSuccessNextActionsFor(
    preview.command,
    "preview",
    preview.transactionState,
  )
  if (!canonical.some((candidate) => isExactCanonicalNextAction(preview.nextAction, candidate))) {
    addValueIssue(ctx, ["nextAction"])
  }
}

const refineCommandResultValue = (result: CommandResult, ctx: z.RefinementCtx) => {
  const descriptor = commandDescriptorsByCommand[result.command]
  if (result.retrySafety !== retrySafetyForEffectClass(descriptor.effectClass)) {
    addValueIssue(ctx, ["retrySafety"])
  }
  if (result.remainingEffectIds.length !== 0) addValueIssue(ctx, ["remainingEffectIds"])
  if (result.transactionState === "unchanged" && result.completedEffectIds.length !== 0) {
    addValueIssue(ctx, ["completedEffectIds"])
  }
  const canonical = canonicalSuccessNextActionsFor(result.command, "result", result.transactionState)
  if (canonical.length === 0) addValueIssue(ctx, ["transactionState"])
  if (!canonical.some((candidate) => isExactCanonicalNextAction(result.nextAction, candidate))) {
    addValueIssue(ctx, ["nextAction"])
  }
}

const retryMetadataIsValid = (error: MaintenanceError): boolean => {
  const copiesAgree =
    error.retryAfterMs === error.nextAction.retryAfterMs &&
    error.idempotencyKey === error.nextAction.idempotencyKey
  if (!copiesAgree) return false
  return error.retryable ||
    (error.retryAfterMs === undefined && error.idempotencyKey === undefined)
}

const refineMaintenanceErrorValue = (error: MaintenanceError, ctx: z.RefinementCtx) => {
  const projection = failureProjectionsByNextActionId.get(error.nextAction.id)
  if (projection === undefined) {
    addValueIssue(ctx, ["nextAction", "id"])
    return
  }
  const projectionChecks: readonly [boolean, PropertyKey[]][] = [
    [error.exitCodeHint === projection.exitCodeHint, ["exitCodeHint"]],
    [error.failureClass === projection.failureClass, ["failureClass"]],
    [error.severity === projection.severity, ["severity"]],
    [error.action === projection.action, ["action"]],
    [error.action === error.nextAction.action, ["action"]],
    [error.retryable === projection.retryable, ["retryable"]],
    [error.retrySafety === projection.retrySafety, ["retrySafety"]],
    [error.transactionState === projection.transactionState, ["transactionState"]],
    [error.errorFamily === projection.errorFamily, ["errorFamily"]],
    [error.recoverability === projection.recoverability, ["recoverability"]],
    [hasCanonicalNextActionMeaning(error.nextAction, projection.nextAction), ["nextAction"]],
    [retryMetadataIsValid(error), ["nextAction"]],
  ]
  for (const [isValid, path] of projectionChecks) {
    if (!isValid) addValueIssue(ctx, path)
  }
}

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
    failureClass: z.literal(continuationFailureClass),
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
    failureClass: nonContinuationFailureClassSchema,
    errorFamily: errorFamilySchema,
    severity: errorSeveritySchema,
    action: maintenanceActionSchema,
    retryable: z.boolean(),
    recoverability: recoverabilitySchema,
    retrySafety: retrySafetySchema,
    transactionState: transactionStateSchema,
  }),
]).superRefine(refineMaintenanceErrorValue)
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
}).superRefine(refineCommandPreviewValue)
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
}).superRefine(refineCommandResultValue)
const serializedValidationLookups = {
  commands: commandDescriptorsByCommand,
  commandsBySlug: new Map(
    commandVocabulary.map((descriptor) => [stationSlugFor(descriptor.command), descriptor] as const),
  ),
  results: Object.fromEntries(
    resultVocabulary.map((descriptor) => [descriptor.resultCode, descriptor]),
  ) as Record<ResultCode, (typeof resultVocabulary)[number]>,
  failureClassPolicy,
} as const

type OutcomeValidationInput =
  | {
      status: "ok"
      resultCode: ResultCode
      stationId: StationId
      value: CommandPreview | CommandResult
    }
  | {
      status: "error"
      resultCode: ResultCode
      stationId: StationId
      error: MaintenanceError
    }

type OutcomeSchemaKind = "preview" | "result" | "error"

const addOutcomeIssue = (ctx: z.RefinementCtx, path: PropertyKey[]) => {
  ctx.addIssue({ code: "custom", message: "invalid serialized outcome", path })
}

type SerializedCommandDescriptor = (typeof commandVocabulary)[number]
type SerializedResultDescriptor = (typeof resultVocabulary)[number]

type OutcomeValidationContext = {
  stationSlug: string
  commandDescriptor: SerializedCommandDescriptor | undefined
  resultDescriptor: SerializedResultDescriptor
}

const outcomeValidationContextFor = (outcome: OutcomeValidationInput): OutcomeValidationContext => {
  const resultDescriptor = serializedValidationLookups.results[outcome.resultCode]
  const stationSeparator = outcome.stationId.lastIndexOf(".")
  const stationSlug = outcome.stationId.slice(0, stationSeparator)
  const commandDescriptor = serializedValidationLookups.commandsBySlug.get(stationSlug)
  return { stationSlug, commandDescriptor, resultDescriptor }
}

const refineOutcomeStationAndStatus = (
  outcome: OutcomeValidationInput,
  context: OutcomeValidationContext,
  ctx: z.RefinementCtx,
) => {
  const stationResultCode = outcome.stationId.slice(outcome.stationId.lastIndexOf(".") + 1)

  if (stationResultCode !== outcome.resultCode) {
    addOutcomeIssue(ctx, ["stationId"])
  }
  if (context.stationSlug !== "maintenance" && context.commandDescriptor === undefined) {
    addOutcomeIssue(ctx, ["stationId"])
  }

  if (outcome.status === "ok") {
    if (context.resultDescriptor.exitClass !== 0 || context.resultDescriptor.failureClass !== null) {
      addOutcomeIssue(ctx, ["status", "resultCode"])
    }
  } else if (context.resultDescriptor.exitClass === 0 || context.resultDescriptor.failureClass === null) {
    addOutcomeIssue(ctx, ["status", "resultCode"])
  }

  refineOutcomeStationMembership(outcome, context, ctx)
}

const outcomeCommandIdFor = (
  context: OutcomeValidationContext,
): BranchStationMembership["commandId"] | undefined =>
  context.stationSlug === "maintenance" ? "maintenance" : context.commandDescriptor?.command

const outcomeNextActionSideFor = (
  outcome: OutcomeValidationInput,
): { nextAction: NextAction; path: "value" | "error" } =>
  outcome.status === "ok"
    ? { nextAction: outcome.value.nextAction, path: "value" }
    : { nextAction: outcome.error.nextAction, path: "error" }

/**
 * The command, Result Code, and envelope status must name a declared Branch
 * Station, and the outcome must carry that station's one canonical Next Action.
 * A command that cannot reach a Result Code, and a Next Action that no station
 * declares, are both refused here rather than at the value schema, because only
 * the outcome carries the Station ID.
 */
const refineOutcomeStationMembership = (
  outcome: OutcomeValidationInput,
  context: OutcomeValidationContext,
  ctx: z.RefinementCtx,
) => {
  const commandId = outcomeCommandIdFor(context)
  const classification = outcome.status === "ok" ? "success" : "failure"
  if (
    commandId === undefined ||
    !isDeclaredBranchStation({ commandId, resultCode: outcome.resultCode, classification })
  ) {
    addOutcomeIssue(ctx, ["stationId"])
    return
  }

  const canonical = canonicalNextActionFor(commandId, outcome.resultCode)
  const side = outcomeNextActionSideFor(outcome)
  const nextActionMatches = canonical !== undefined && (
    outcome.status === "ok"
      ? isExactCanonicalNextAction(side.nextAction, canonical)
      : hasCanonicalNextActionMeaning(side.nextAction, canonical)
  )
  if (!nextActionMatches) {
    addOutcomeIssue(ctx, [side.path, "nextAction"])
  }
}

const refineErrorOutcome = (
  outcome: Extract<OutcomeValidationInput, { status: "error" }>,
  context: OutcomeValidationContext,
  ctx: z.RefinementCtx,
) => {
  const { resultDescriptor, commandDescriptor } = context
  if (resultDescriptor.failureClass === null) return
  const failurePolicy = serializedValidationLookups.failureClassPolicy[resultDescriptor.failureClass]

  const errorChecks: readonly [boolean, PropertyKey[]][] = [
    [outcome.error.exitCodeHint === resultDescriptor.exitClass, ["error", "exitCodeHint"]],
    [outcome.error.failureClass === resultDescriptor.failureClass, ["error", "failureClass"]],
    [outcome.error.severity === (resultDescriptor.severity === "info" ? "error" : resultDescriptor.severity), ["error", "severity"]],
    [outcome.error.retrySafety === resultDescriptor.retrySafety, ["error", "retrySafety"]],
    [outcome.error.transactionState === resultDescriptor.transactionState, ["error", "transactionState"]],
    [outcome.error.errorFamily === failurePolicy.errorFamily, ["error", "errorFamily"]],
    [outcome.error.recoverability === failurePolicy.recoverability, ["error", "recoverability"]],
    [outcome.error.retryable === (resultDescriptor.retrySafety === "safe" && resultDescriptor.exitFamilyId === "transient-retry"), ["error", "retryable"]],
    [outcome.error.action === resultDescriptor.nextAction.action, ["error", "action"]],
    [outcome.error.action === outcome.error.nextAction.action, ["error", "nextAction", "action"]],
    [outcome.error.nextAction.id === resultDescriptor.nextAction.id, ["error", "nextAction", "id"]],
    [
      resultDescriptor.failureClass !== "continuation" ||
        (commandDescriptor !== undefined && commandDescriptor.interfaceCall === "apply"),
      ["stationId"],
    ],
  ]
  for (const [isValid, path] of errorChecks) {
    if (!isValid) addOutcomeIssue(ctx, path)
  }
}

const refinePreviewOutcome = (
  outcome: Extract<OutcomeValidationInput, { status: "ok" }>,
  context: OutcomeValidationContext,
  ctx: z.RefinementCtx,
) => {
  const preview = outcome.value as CommandPreview
  const expectedCommandSlug = stationSlugFor(outcome.value.command)
  if (context.stationSlug !== expectedCommandSlug) addOutcomeIssue(ctx, ["stationId"])
  if (preview.transactionState !== context.resultDescriptor.transactionState) {
    addOutcomeIssue(ctx, ["value", "transactionState"])
  }
}

const refineResultOutcome = (
  outcome: Extract<OutcomeValidationInput, { status: "ok" }>,
  context: OutcomeValidationContext,
  ctx: z.RefinementCtx,
) => {
  const result = outcome.value as CommandResult
  const expectedCommandSlug = stationSlugFor(result.command)
  if (context.stationSlug !== expectedCommandSlug) addOutcomeIssue(ctx, ["stationId"])
  if (result.transactionState !== context.resultDescriptor.transactionState) {
    addOutcomeIssue(ctx, ["value", "transactionState"])
  }
}

const refineOutcome = (
  kind: OutcomeSchemaKind,
  outcome: OutcomeValidationInput,
  ctx: z.RefinementCtx,
) => {
  const context = outcomeValidationContextFor(outcome)
  refineOutcomeStationAndStatus(outcome, context, ctx)
  if (outcome.status === "error") {
    refineErrorOutcome(outcome, context, ctx)
    return
  }
  if (kind === "preview") {
    refinePreviewOutcome(outcome, context, ctx)
    return
  }
  refineResultOutcome(outcome, context, ctx)
}

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
]).superRefine((outcome, ctx) => refineOutcome("preview", outcome, ctx))
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
]).superRefine((outcome, ctx) => refineOutcome("result", outcome, ctx))
const errorOutcomeSchema = z.strictObject({
  status: z.literal("error"),
  resultCode: resultCodeSchema,
  stationId: stationIdSchema,
  error: maintenanceErrorSchema,
}).superRefine((outcome, ctx) => refineOutcome("error", outcome, ctx))

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
