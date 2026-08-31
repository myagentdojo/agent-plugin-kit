import {
  configureSync,
  getLogger,
  resetSync,
  type Logger,
  type Sink,
} from "@logtape/logtape"
import type {
  DiagnosticAdapter,
  DiagnosticMode,
  DiagnosticPipeline,
  DiagnosticPipelineAssembly,
  DiagnosticPipelineFactory,
  DiagnosticRecord,
  EventRecord,
} from "../interface"
import type {
  FailureClass,
  MaintenanceAction,
  MaintenanceCommand,
  ResultCode,
  RetrySafety,
  TransactionState,
} from "../../../modules/maintenance-command-contract/interface"
import { commandVocabulary } from "../../../modules/maintenance-command-contract/command-vocabulary"
import {
  actionVocabulary,
  failureClassVocabulary,
  resultVocabulary,
  retrySafetyVocabulary,
  transactionStateVocabulary,
} from "../../../modules/maintenance-command-contract/result-vocabulary"

const diagnosticCategory = ["agent-plugin-kit", "maintenance"] as const
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
const secretKeyPattern = /(?:password|passwd|secret|token|authorization|cookie|credential|private[-_]?key|api[-_]?key)/i
const secretAssignmentPattern = /\b(secret|password|passwd|token|credential|authorization|cookie|private[-_ ]?key|api[-_ ]?key)\s*([:=])\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi
const authUrlPattern = /\bhttps?:\/\/[^\s/@]+:[^\s/@]+@[^\s]+/gi
const privateKeyPattern = /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi
const bearerPattern = /^(?:bearer\s+|basic\s+|op:\/\/)/i
const redactedValue = "[REDACTED]"
const maximumBufferedRecords = 250
const maximumNestedDepth = 4
const maximumArrayEntries = 100
const logTapeRecordProperty = "__agent_plugin_kit_diagnostic_record"

type UnknownRecord = Record<string, unknown>

const commandIds = new Set(commandVocabulary.map(({ command }) => command))
const resultCodes = new Set(resultVocabulary.map(({ resultCode }) => resultCode))
const actions = new Set(actionVocabulary)
const failureClasses = new Set(failureClassVocabulary)
const retrySafeties = new Set(retrySafetyVocabulary)
const transactionStates = new Set(transactionStateVocabulary)

const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const hasOwn = (value: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

const isSafeIdentifier = (value: unknown): value is string =>
  typeof value === "string" && safeIdentifierPattern.test(value)

const isRunId = (value: unknown): value is string =>
  typeof value === "string" && runIdPattern.test(value)

const isKnownCommand = (value: unknown): value is MaintenanceCommand["command"] =>
  typeof value === "string" && commandIds.has(value as MaintenanceCommand["command"])

const isKnownResultCode = (value: unknown): value is ResultCode =>
  typeof value === "string" && resultCodes.has(value as ResultCode)

const isKnownAction = (value: unknown): value is MaintenanceAction =>
  typeof value === "string" && actions.has(value as MaintenanceAction)

const isKnownFailureClass = (value: unknown): value is FailureClass =>
  typeof value === "string" && failureClasses.has(value as FailureClass)

const isKnownRetrySafety = (value: unknown): value is RetrySafety =>
  typeof value === "string" && retrySafeties.has(value as RetrySafety)

const isKnownTransactionState = (value: unknown): value is TransactionState =>
  typeof value === "string" && transactionStates.has(value as TransactionState)

const isSecretValue = (value: string): boolean =>
  bearerPattern.test(value) || authUrlPattern.test(value) || privateKeyPattern.test(value)

const replaceConfiguredSecrets = (value: string, secrets: readonly string[]): string => {
  let redacted = value
  for (const secret of [...secrets].filter((candidate) => candidate.length > 0).sort((left, right) => right.length - left.length)) {
    redacted = redacted.split(secret).join(redactedValue)
  }
  return redacted
}

const redactString = (value: string, secrets: readonly string[]): string => {
  const configured = replaceConfiguredSecrets(value, secrets)
  const privateKeyRedacted = configured.replace(privateKeyPattern, redactedValue)
  const urlRedacted = privateKeyRedacted.replace(authUrlPattern, redactedValue)
  return urlRedacted.replace(secretAssignmentPattern, (_match, key: string, separator: string) => `${key}${separator}${redactedValue}`)
}

const redactArray = (value: readonly unknown[], depth: number, secrets: readonly string[]): unknown =>
  value.length > maximumArrayEntries
    ? redactedValue
    : value.map((entry) => redactValue(entry, "", depth + 1, secrets))

const redactObject = (value: UnknownRecord, depth: number, secrets: readonly string[]): unknown => {
  const entries = Object.entries(value)
  if (entries.length > maximumArrayEntries) return redactedValue
  return Object.fromEntries(entries.map(([entryKey, entryValue]) => [
    entryKey,
    redactValue(entryValue, entryKey, depth + 1, secrets),
  ]))
}

const isRedactionBlocked = (key: string, depth: number): boolean =>
  secretKeyPattern.test(key) || depth > maximumNestedDepth

const redactScalar = (value: unknown, secrets: readonly string[]): unknown => {
  if (typeof value === "string") return redactString(value, secrets)
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : redactedValue
  return redactedValue
}

const redactValue = (
  value: unknown,
  key: string,
  depth: number,
  secrets: readonly string[],
): unknown => {
  if (isRedactionBlocked(key, depth)) return redactedValue
  if (Array.isArray(value)) return redactArray(value, depth, secrets)
  if (isRecord(value)) return redactObject(value, depth, secrets)
  return redactScalar(value, secrets)
}

const buildNextActionAllowlist = (value: unknown): UnknownRecord | undefined => {
  if (!isRecord(value)) return undefined
  const result: UnknownRecord = {}
  for (const key of nextActionKeys) {
    if (hasOwn(value, key)) result[key] = value[key]
  }
  return result
}

const buildDiagnosticAllowlist = (value: unknown): UnknownRecord | undefined => {
  if (!isRecord(value)) return undefined
  const result: UnknownRecord = {}
  for (const key of diagnosticRecordKeys) {
    if (!hasOwn(value, key)) continue
    result[key] = key === "next_action" ? buildNextActionAllowlist(value[key]) : value[key]
  }
  return result
}

const buildEventAllowlist = (value: unknown): UnknownRecord | undefined => {
  if (!isRecord(value)) return undefined
  const result: UnknownRecord = {}
  for (const key of eventRecordKeys) {
    if (hasOwn(value, key)) result[key] = value[key]
  }
  return result
}

const redactRecord = (value: UnknownRecord, secrets: readonly string[]): UnknownRecord =>
  Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [
    key,
    redactValue(entryValue, key, 0, secrets),
  ]))

const canonicalTimestamp = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined
  const timestamp = new Date(value)
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString()
}

const isValidTimestamp = (value: unknown): boolean => {
  if (typeof value !== "string") return false
  return Number.isFinite(new Date(value).getTime())
}

const validateNextActionIdentity = (value: UnknownRecord): boolean =>
  isSafeIdentifier(value.id) && isKnownAction(value.action) && typeof value.summary === "string"

const validateNextActionOptionalFields = (value: UnknownRecord): boolean => {
  const commandValid = !hasOwn(value, "commandId") || value.commandId === null || isKnownCommand(value.commandId)
  const retryAfterValid = !hasOwn(value, "retryAfterMs") || (
    Number.isInteger(value.retryAfterMs) &&
    (value.retryAfterMs as number) >= 0 &&
    (value.retryAfterMs as number) <= 30000
  )
  const idempotencyValid = !hasOwn(value, "idempotencyKey") || isSafeIdentifier(value.idempotencyKey)
  return commandValid && retryAfterValid && idempotencyValid
}

const validateNextAction = (value: unknown): value is UnknownRecord =>
  isRecord(value) && validateNextActionIdentity(value) && validateNextActionOptionalFields(value)

const hasUnredactedSecret = (value: unknown, secrets: readonly string[], depth = 0): boolean => {
  if (depth > maximumNestedDepth) return value !== redactedValue
  if (typeof value === "string") {
    return value !== redactedValue && (isSecretValue(value) || secrets.some((secret) => secret.length > 0 && value.includes(secret)))
  }
  if (Array.isArray(value)) return value.some((entry) => hasUnredactedSecret(entry, secrets, depth + 1))
  if (isRecord(value)) return Object.entries(value).some(([key, entryValue]) => secretKeyPattern.test(key) || hasUnredactedSecret(entryValue, secrets, depth + 1))
  return false
}

const validateDiagnosticIdentity = (value: UnknownRecord): boolean =>
  [
    value.schema_version === 1,
    value.record_type === "diagnostic",
    isValidTimestamp(value.timestamp),
    Number.isInteger(value.sequence),
    (value.sequence as number) >= 1,
    typeof value.level === "string",
    diagnosticLevels.includes(value.level as (typeof diagnosticLevels)[number]),
    JSON.stringify(value.category) === JSON.stringify(diagnosticCategory),
    isSafeIdentifier(value.event),
    isRunId(value.run_id),
    typeof value.message === "string",
  ].every(Boolean)

type FieldValidator = (value: unknown) => boolean

const validateOptionalField = (
  value: UnknownRecord,
  key: string,
  validator: FieldValidator,
): boolean => {
  if (!hasOwn(value, key)) return true
  return validator(value[key])
}

const validateDiagnosticOptionalFields = (value: UnknownRecord): boolean =>
  [
    validateOptionalField(value, "command", isKnownCommand),
    validateOptionalField(value, "station_id", isSafeIdentifier),
    validateOptionalField(value, "failure_class", isKnownFailureClass),
    validateOptionalField(value, "result_code", isKnownResultCode),
    validateOptionalField(value, "transaction_state", isKnownTransactionState),
    validateOptionalField(value, "retry_safety", isKnownRetrySafety),
    validateOptionalField(value, "next_action", validateNextAction),
  ].every(Boolean)

const validateDiagnosticRecord = (value: UnknownRecord, secrets: readonly string[]): value is DiagnosticRecord =>
  validateDiagnosticIdentity(value) && validateDiagnosticOptionalFields(value) && !hasUnredactedSecret(value, secrets)

const validateEventIdentity = (value: UnknownRecord): boolean =>
  [
    value.schema_version === 1,
    isSafeIdentifier(value.event_id),
    isValidTimestamp(value.occurred_at),
    Number.isInteger(value.sequence),
    (value.sequence as number) >= 1,
    isRunId(value.run_id),
    isKnownCommand(value.command),
    isSafeIdentifier(value.station_id),
    typeof value.outcome === "string",
    eventOutcomes.includes(value.outcome as (typeof eventOutcomes)[number]),
    isKnownResultCode(value.result_code),
    isKnownTransactionState(value.transaction_state),
    isKnownRetrySafety(value.retry_safety),
    isSafeIdentifier(value.next_action_id),
  ].every(Boolean)

const validateEventOptionalFields = (value: UnknownRecord): boolean =>
  !hasOwn(value, "failure_class") || isKnownFailureClass(value.failure_class)

const validateEventRecord = (value: UnknownRecord, secrets: readonly string[]): value is EventRecord =>
  validateEventIdentity(value) && validateEventOptionalFields(value) && !hasUnredactedSecret(value, secrets)

const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const nested of Object.values(value as UnknownRecord)) deepFreeze(nested)
  return value
}

/** The single facade-owned allowlist, redaction, validation, and freeze path. */
const sanitizeDiagnosticRecord = (
  value: unknown,
  secrets: readonly string[] = [],
): DiagnosticRecord | undefined => {
  const allowlisted = buildDiagnosticAllowlist(value)
  if (allowlisted === undefined) return undefined
  const redacted = redactRecord(allowlisted, secrets)
  const timestamp = canonicalTimestamp(redacted.timestamp)
  if (timestamp === undefined) return undefined
  redacted.timestamp = timestamp
  if (!validateDiagnosticRecord(redacted, secrets)) return undefined
  return deepFreeze(redacted as DiagnosticRecord)
}

/** The Event Seam receives the same closed pipeline, without transport policy. */
export const sanitizeEventRecord = (
  value: unknown,
  secrets: readonly string[] = [],
): EventRecord | undefined => {
  const allowlisted = buildEventAllowlist(value)
  if (allowlisted === undefined) return undefined
  const redacted = redactRecord(allowlisted, secrets)
  const occurredAt = canonicalTimestamp(redacted.occurred_at)
  if (occurredAt === undefined) return undefined
  redacted.occurred_at = occurredAt
  if (!validateEventRecord(redacted, secrets)) return undefined
  return deepFreeze(redacted as EventRecord)
}

const writeRecord = (diagnostics: DiagnosticAdapter, record: DiagnosticRecord): void => {
  try {
    diagnostics.record(record)
  } catch {
    // Environmental writers cannot replace the primary Maintenance result.
  }
}

const truncationRecordFor = (trigger: DiagnosticRecord, droppedRecordCount: number): DiagnosticRecord | undefined =>
  sanitizeDiagnosticRecord({
    ...trigger,
    level: "warning",
    event: "diagnostic.buffer-truncated",
    message: `Diagnostic buffer dropped ${droppedRecordCount} oldest record${droppedRecordCount === 1 ? "" : "s"}.`,
  })

const isTriggerLevel = (level: DiagnosticRecord["level"]): boolean =>
  level === "error" || level === "fatal"

const isSuppressedByMode = (mode: DiagnosticMode, level: DiagnosticRecord["level"]): boolean =>
  (mode === "quiet" && !isTriggerLevel(level)) || (mode === "verbose" && level === "debug")

const isImmediateMode = (mode: DiagnosticMode): boolean =>
  mode === "quiet" || mode === "verbose" || mode === "debug"

export const createDiagnosticPipeline: DiagnosticPipelineFactory = (
  assembly: DiagnosticPipelineAssembly,
): DiagnosticPipeline => {
  const diagnostics = assembly.diagnostics
  const mode = assembly.mode
  const secrets = assembly.secretValues ?? []
  let buffered: DiagnosticRecord[] = []
  let droppedRecordCount = 0
  let disposed = false

  const write = (record: DiagnosticRecord): void => writeRecord(diagnostics, record)
  const trigger = (record: DiagnosticRecord): void => {
    if (droppedRecordCount > 0) {
      const truncation = truncationRecordFor(record, droppedRecordCount)
      if (truncation !== undefined) write(truncation)
    }
    for (const bufferedRecord of buffered) write(bufferedRecord)
    buffered = []
    droppedRecordCount = 0
    write(record)
    try {
      diagnostics.flush()
    } catch {
      // A throwing environmental flush is contained at this seam.
    }
  }

  return {
    record(value): void {
      if (disposed) return
      const record = sanitizeDiagnosticRecord(value, secrets)
      if (record === undefined) return
      if (isSuppressedByMode(mode, record.level)) return
      if (isImmediateMode(mode)) {
        write(record)
        return
      }
      if (isTriggerLevel(record.level)) {
        trigger(record)
        return
      }
      if (buffered.length >= maximumBufferedRecords) {
        buffered.shift()
        droppedRecordCount += 1
      }
      buffered.push(record)
    },

    reset(): void {
      buffered = []
      droppedRecordCount = 0
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      buffered = []
      droppedRecordCount = 0
      try {
        diagnostics.dispose()
      } catch {
        // Disposal is best effort and cannot replace an already-built result.
      }
    },
  }
}

const emitThroughLogTape = (logger: Logger, record: DiagnosticRecord): void => {
  const properties = { [logTapeRecordProperty]: record }
  switch (record.level) {
    case "debug":
      logger.debug(record.message, properties)
      break
    case "info":
      logger.info(record.message, properties)
      break
    case "warning":
      logger.warning(record.message, properties)
      break
    case "error":
      logger.error(record.message, properties)
      break
    case "fatal":
      logger.fatal(record.message, properties)
      break
  }
}

export type LogTapeDiagnosticAdapterOptions = {
  write?: (line: string) => void
}

/** LogTape remains a private facade environmental Adapter, never a root dependency. */
export const createLogTapeDiagnosticAdapter = (
  options: LogTapeDiagnosticAdapterOptions = {},
): DiagnosticAdapter => {
  const write = options.write ?? ((line: string) => process.stderr.write(line))
  let logger: Logger | undefined
  let disposed = false

  const configure = (): void => {
    if (logger !== undefined || disposed) return
    const sink: Sink = (logRecord) => {
      const record = logRecord.properties[logTapeRecordProperty]
      if (!isRecord(record)) return
      try {
        write(`${JSON.stringify(record)}\n`)
      } catch {
        // LogTape suppresses sink errors; preserve that property for stderr.
      }
    }
    try {
      configureSync({
        reset: true,
        sinks: { diagnostic: sink },
        loggers: [
          { category: [...diagnosticCategory], lowestLevel: "debug", sinks: ["diagnostic"] },
          { category: ["logtape", "meta"], lowestLevel: "fatal", sinks: [] },
        ],
      })
      logger = getLogger(diagnosticCategory)
    } catch {
      logger = undefined
    }
  }

  return {
    record(record): void {
      if (disposed) return
      configure()
      if (logger === undefined) return
      try {
        emitThroughLogTape(logger, record)
      } catch {
        // A diagnostic writer failure cannot alter the command result.
      }
    },
    flush(): void {
      // The owner pipeline is synchronous; LogTape's sink has no pending work.
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      if (logger === undefined) return
      logger = undefined
      try {
        resetSync()
      } catch {
        // Reset is deliberately idempotent at the Adapter boundary.
      }
    },
  }
}
