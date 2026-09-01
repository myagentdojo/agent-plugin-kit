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
const secretKeyPattern = /(?:password|passwd|secret|token|authorization|cookie|credential|privatekey|apikey)/i
const uriSchemePattern = "[A-Za-z][A-Za-z0-9+.-]*"
const authUrlPattern = new RegExp(
  `(^|[^A-Za-z0-9])(?=${uriSchemePattern}:\\/\\/[^\\s@]{1,${maximumCredentialMatchLength}}@)${uriSchemePattern}:\\/\\/[^\\s@]{1,${maximumCredentialMatchLength}}@[^\\s]+`,
  "gi",
)
const authUrlDetectPattern = new RegExp(
  `(?:^|[^A-Za-z0-9])${uriSchemePattern}:\\/\\/[^\\s@]+@`,
  "i",
)
const incompleteAuthUrlDetectPattern = new RegExp(
  `(?:^|[^A-Za-z0-9])${uriSchemePattern}:\\/\\/[^\\s/:@?#]*:(?![0-9]+(?:[/?#]|\\.(?=$|[\\s,;])|$|[\\s,;]))[^\\s@,;]*(?=$|[\\s,;])`,
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

const maximumNormalizedAssignmentKeyTailLength = 64
const maximumRawAssignmentKeyLength = 512
const ambiguousAssignmentKeyCharacter = "?"
const twoWordSensitiveAssignmentKeys = new Set(["privatekey", "apikey"])
const assignmentKeyBoundaryCharacters = new Set([";", "\n", "\r", "{", "}", ":", "="])

type AssignmentKeyCharacter = Readonly<{
  character: string
  nextCursor: number
}>

type AssignmentSeparator = Readonly<{
  character: ":" | "="
  end: number
  start: number
}>

type SecretAssignmentRange = Readonly<{
  valueEnd: number
  valueStart: number
}>

type AssignmentKey = Readonly<{
  enclosingQuote?: number
  malformedQuote: boolean
  quoted: boolean
  raw: string
  truncated: boolean
}>

type NormalizedAssignmentKeyWord = Readonly<{
  ambiguous: boolean
  sensitive: boolean
  value: string
}>

const decodedHexCharacterAt = (
  value: string,
  start: number,
  length: number,
): string | undefined => {
  const digits = value.slice(start, start + length)
  return digits.length === length && /^[0-9A-Fa-f]+$/.test(digits)
    ? String.fromCodePoint(Number.parseInt(digits, 16))
    : undefined
}

const malformedEncodingEnd = (value: string, start: number, maximumLength: number): number => {
  let end = start
  while (end < value.length && end - start < maximumLength && /[A-Za-z0-9]/.test(value[end] ?? "")) {
    end += 1
  }
  return end
}

const escapedKeyCharacterAt = (value: string, cursor: number): AssignmentKeyCharacter | undefined => {
  if (value[cursor] !== "\\") return undefined
  let unicode = cursor
  while (value[unicode] === "\\") unicode += 1
  if (value[unicode] !== "u") return { character: "", nextCursor: unicode }
  const character = decodedHexCharacterAt(value, unicode + 1, 4)
  return character === undefined
    ? {
        character: ambiguousAssignmentKeyCharacter,
        nextCursor: malformedEncodingEnd(value, unicode + 1, 4),
      }
    : { character, nextCursor: unicode + 5 }
}

const percentEncodedKeyCharacterAt = (value: string, cursor: number): AssignmentKeyCharacter | undefined => {
  if (value[cursor] !== "%") return undefined
  const character = decodedHexCharacterAt(value, cursor + 1, 2)
  return character === undefined
    ? {
        character: ambiguousAssignmentKeyCharacter,
        nextCursor: malformedEncodingEnd(value, cursor + 1, 2),
      }
    : { character, nextCursor: cursor + 3 }
}

const encodedAssignmentKeyCharacterAt = (
  value: string,
  cursor: number,
): AssignmentKeyCharacter | undefined =>
  escapedKeyCharacterAt(value, cursor) ?? percentEncodedKeyCharacterAt(value, cursor)

const normalizedAssignmentKeyCharacterAt = (
  value: string,
  cursor: number,
): AssignmentKeyCharacter => {
  const encoded = encodedAssignmentKeyCharacterAt(value, cursor)
  if (encoded === undefined) {
    return { character: value[cursor] ?? "", nextCursor: cursor + 1 }
  }
  return {
    character: encoded.character === "\\" || encoded.character === "%"
      ? ambiguousAssignmentKeyCharacter
      : encoded.character,
    nextCursor: encoded.nextCursor,
  }
}

const normalizeAssignmentKeyWord = (raw: string): NormalizedAssignmentKeyWord => {
  let normalized = ""
  let ambiguous = false
  let sensitive = false
  let cursor = 0
  while (cursor < raw.length) {
    const character = normalizedAssignmentKeyCharacterAt(raw, cursor)
    cursor = character.nextCursor
    if (character.character === ambiguousAssignmentKeyCharacter) ambiguous = true
    if (/[A-Za-z0-9]/.test(character.character)) {
      normalized = `${normalized}${character.character.toLowerCase()}`
        .slice(-maximumNormalizedAssignmentKeyTailLength)
      sensitive ||= secretKeyPattern.test(normalized)
    }
  }
  return { ambiguous, sensitive, value: normalized }
}

const lastAssignmentKeyWords = (raw: string): readonly NormalizedAssignmentKeyWord[] =>
  raw.trim().split(/\s+/).slice(-3).map(normalizeAssignmentKeyWord)

const hasSensitiveAssignmentKeyTail = (
  words: readonly NormalizedAssignmentKeyWord[],
): boolean => words.slice(-2).some(({ ambiguous, sensitive }) => ambiguous || sensitive)

const lastTwoAssignmentKeyWords = (
  words: readonly NormalizedAssignmentKeyWord[],
): string => words.slice(-2).map(({ value }) => value).join("")

const hasSensitiveSigningKeyTail = (
  words: readonly NormalizedAssignmentKeyWord[],
  lastTwo: string,
): boolean => {
  const first = words.at(-3)
  return lastTwo === "signingkey"
    && first !== undefined
    && (first.ambiguous || secretKeyPattern.test(first.value))
}

const sensitiveAssignmentKey = (key: AssignmentKey): boolean => {
  if (key.truncated) return true
  const words = lastAssignmentKeyWords(key.raw)
  if (hasSensitiveAssignmentKeyTail(words)) return true
  const lastTwo = lastTwoAssignmentKeyWords(words)
  return twoWordSensitiveAssignmentKeys.has(lastTwo)
    || hasSensitiveSigningKeyTail(words, lastTwo)
}

const assignmentSeparatorAt = (
  value: string,
  cursor: number,
): AssignmentSeparator | undefined => {
  const encoded = encodedAssignmentKeyCharacterAt(value, cursor)
  const character = encoded?.character ?? value[cursor]
  if (character !== ":" && character !== "=") return undefined
  return {
    character,
    end: encoded?.nextCursor ?? cursor + 1,
    start: cursor,
  }
}

const afterWhitespace = (value: string, start: number): number => {
  let end = start
  while (/\s/.test(value[end] ?? "")) end += 1
  return end
}

const isEscapedAt = (value: string, cursor: number): boolean => {
  let slashCount = 0
  let previous = cursor - 1
  while (
    previous >= 0
    && slashCount <= maximumRawAssignmentKeyLength
    && value[previous] === "\\"
  ) {
    slashCount += 1
    previous -= 1
  }
  return slashCount > maximumRawAssignmentKeyLength || slashCount % 2 === 1
}

const closingQuoteAfter = (
  value: string,
  opening: number,
): number | undefined => {
  const quote = value[opening]
  if (quote !== "\"" && quote !== "'") return undefined
  let cursor = opening + 1
  while (cursor < value.length) {
    if (value[cursor] === quote && !isEscapedAt(value, cursor)) return cursor
    cursor += 1
  }
  return undefined
}

const openingQuoteBefore = (
  value: string,
  closing: number,
): number | undefined => {
  const quote = value[closing]
  if (quote !== "\"" && quote !== "'") return undefined
  let cursor = closing - 1
  const minimum = Math.max(0, closing - maximumRawAssignmentKeyLength)
  while (cursor >= minimum) {
    if (value[cursor] === quote && !isEscapedAt(value, cursor)) return cursor
    cursor -= 1
  }
  return undefined
}

const isSpacedPipeBoundaryBefore = (value: string, cursor: number): boolean =>
  value[cursor - 1] === "|"
  && /\s/.test(value[cursor - 2] ?? "")
  && /\s/.test(value[cursor] ?? "")

const isSpacedCommaBoundaryBefore = (value: string, cursor: number): boolean =>
  value[cursor - 1] === ","
  && /\s/.test(value[cursor] ?? "")

const isAssignmentKeyBoundaryBefore = (value: string, cursor: number): boolean => {
  const previous = value[cursor - 1]
  return previous === undefined
    || assignmentKeyBoundaryCharacters.has(previous)
    || isSpacedPipeBoundaryBefore(value, cursor)
    || isSpacedCommaBoundaryBefore(value, cursor)
}

const isQuotedAssignmentKeyStart = (value: string, cursor: number): boolean => {
  const quote = value[cursor]
  if (quote !== "\"" && quote !== "'") return false
  const previous = value[cursor - 1]
  return previous === undefined || /[\s{[(,:=|;]/.test(previous)
}

const assignmentKeyEndBefore = (value: string, separatorStart: number): number => {
  let end = separatorStart
  while (end > 0 && /\s/.test(value[end - 1] ?? "")) end -= 1
  return end
}

const quotedAssignmentKeyBefore = (
  value: string,
  end: number,
): AssignmentKey | undefined => {
  const closing = end - 1
  const opening = openingQuoteBefore(value, closing)
  return opening === undefined
    ? undefined
    : {
        malformedQuote: false,
        quoted: true,
        raw: value.slice(opening + 1, closing),
        truncated: false,
      }
}

const assignmentKeyStartBefore = (
  value: string,
  end: number,
): Readonly<{ start: number; truncated: boolean }> => {
  let start = end
  while (
    start > 0
    && end - start < maximumRawAssignmentKeyLength
    && !isAssignmentKeyBoundaryBefore(value, start)
    && !isQuotedAssignmentKeyStart(value, start)
  ) {
    start -= 1
  }
  const truncated = start > 0 && !isAssignmentKeyBoundaryBefore(value, start)
  while (start < end && /\s/.test(value[start] ?? "")) start += 1
  return { start, truncated }
}

const bareAssignmentKeyBefore = (
  value: string,
  end: number,
): AssignmentKey | undefined => {
  const { start, truncated } = assignmentKeyStartBefore(value, end)
  const leadingQuote = value[start] === "\"" || value[start] === "'"
  const raw = value.slice(leadingQuote ? start + 1 : start, end)
  const enclosingQuote = leadingQuote ? closingQuoteAfter(value, start) : undefined
  return raw.length === 0
    ? undefined
    : {
        ...(enclosingQuote === undefined ? {} : { enclosingQuote }),
        malformedQuote: leadingQuote && enclosingQuote === undefined,
        quoted: false,
        raw,
        truncated,
      }
}

const assignmentKeyBefore = (
  value: string,
  separator: AssignmentSeparator,
): AssignmentKey | undefined => {
  const end = assignmentKeyEndBefore(value, separator.start)
  if (end === 0) return undefined
  return quotedAssignmentKeyBefore(value, end) ?? bareAssignmentKeyBefore(value, end)
}

const isSyntacticAssignment = (
  value: string,
  separator: AssignmentSeparator,
): boolean => assignmentKeyBefore(value, separator) !== undefined

const safeAssignmentBoundaryKeys = new Set(["mode", "progress"])

const assignmentKeyStartingAt = (
  value: string,
  start: number,
  separator: AssignmentSeparator,
): AssignmentKey | undefined => {
  const keyStart = afterWhitespace(value, start)
  const keyEnd = assignmentKeyEndBefore(value, separator.start)
  if (keyEnd <= keyStart || keyEnd - keyStart > maximumRawAssignmentKeyLength) return undefined
  const opening = value[keyStart]
  if (opening === "\"" || opening === "'") {
    const closing = closingQuoteAfter(value, keyStart)
    return closing === keyEnd - 1
      ? {
          malformedQuote: false,
          quoted: true,
          raw: value.slice(keyStart + 1, closing),
          truncated: false,
        }
      : undefined
  }
  const raw = value.slice(keyStart, keyEnd)
  return raw.includes("\"") || raw.includes("'")
    ? undefined
    : { malformedQuote: false, quoted: false, raw, truncated: false }
}

const isAdmissibleFollowingAssignment = (
  value: string,
  start: number,
  separator: AssignmentSeparator,
): boolean => {
  const key = assignmentKeyStartingAt(value, start, separator)
  if (key === undefined) return false
  if (key.quoted || sensitiveAssignmentKey(key)) return true
  if (/\s/.test(key.raw.trim())) return false
  const normalized = normalizeAssignmentKeyWord(key.raw)
  return !normalized.ambiguous && safeAssignmentBoundaryKeys.has(normalized.value)
}

const startsAssignment = (value: string, start: number): boolean => {
  const limit = Math.min(value.length, start + maximumRawAssignmentKeyLength)
  let cursor = afterWhitespace(value, start)
  while (cursor < limit) {
    const separator = assignmentSeparatorAt(value, cursor)
    if (separator !== undefined) {
      return isAdmissibleFollowingAssignment(value, start, separator)
    }
    if (/[,;\n\r|]/.test(value[cursor] ?? "")) return false
    cursor += 1
  }
  return false
}

const nonWhitespaceEnd = (value: string, start: number): number => {
  let end = start
  while (end < value.length && !/\s/.test(value[end] ?? "")) end += 1
  return end
}

const isQuotedValueDelimiter = (value: string, start: number): boolean => {
  const delimiter = value[start]
  if (delimiter === undefined || /\s/.test(delimiter) || ",}])".includes(delimiter)) return true
  if (delimiter !== ";" && delimiter !== ".") return false
  const next = value[start + 1]
  return next === undefined || /\s/.test(next)
}

const assignmentBoundaryWidthAt = (value: string, cursor: number): number => {
  if (value.startsWith(" | ", cursor)) return 3
  if (value.startsWith("| ", cursor)) return 2
  return ",;\n\r".includes(value[cursor] ?? "") ? 1 : 0
}

const quotedValueEnd = (value: string, start: number, quote: string): number => {
  const closing = closingQuoteAfter(value, start)
  if (closing === undefined) return value.length
  const closed = closing + 1
  let boundary = closed
  while (value[boundary] === "\\") boundary += 1
  const boundaryWidth = assignmentBoundaryWidthAt(value, boundary)
  if (boundaryWidth > 0) {
    if ((boundary - closed) % 2 !== 0) return value.length
    if (startsAssignment(value, boundary + boundaryWidth)) return boundary
  }
  return isQuotedValueDelimiter(value, closed)
    ? closed
    : nonWhitespaceEnd(value, closed)
}

const balancedQuotedValueEndAfter = (
  value: string,
  separator: AssignmentSeparator,
): number | undefined => {
  const start = afterWhitespace(value, separator.end)
  const quote = value[start]
  if (quote !== "\"" && quote !== "'") return undefined
  const closing = closingQuoteAfter(value, start)
  return closing === undefined ? undefined : closing + 1
}

const quotedAssignmentSeparatorAfter = (
  value: string,
  opening: number,
): AssignmentSeparator | undefined => {
  if (!isQuotedAssignmentKeyStart(value, opening)) return undefined
  const closing = closingQuoteAfter(value, opening)
  return closing === undefined
    ? undefined
    : assignmentSeparatorAt(value, afterWhitespace(value, closing + 1))
}

const startsFollowingAssignmentAt = (
  value: string,
  cursor: number,
  nestedDepth: number,
): boolean => {
  if (nestedDepth !== 0) return false
  if (isEscapedAt(value, cursor)) return false
  const boundaryWidth = assignmentBoundaryWidthAt(value, cursor)
  return boundaryWidth > 0 && startsAssignment(value, cursor + boundaryWidth)
}

const quotedSegmentEndAt = (value: string, cursor: number): number | undefined => {
  const character = value[cursor]
  if ((character !== "\"" && character !== "'") || isEscapedAt(value, cursor)) {
    return undefined
  }
  return (closingQuoteAfter(value, cursor) ?? value.length - 1) + 1
}

const expectedCloserForOpener = new Map([
  ["{", "}"],
  ["[", "]"],
  ["(", ")"],
])

const closingDelimiters = new Set(expectedCloserForOpener.values())

const consumeNestedDelimiter = (
  value: string,
  cursor: number,
  expectedClosers: string[],
): boolean => {
  const character = value[cursor]
  if (character === undefined) return true
  if (isEscapedAt(value, cursor)) return true
  const expectedCloser = expectedCloserForOpener.get(character)
  if (expectedCloser !== undefined) {
    expectedClosers.push(expectedCloser)
    return true
  }
  if (!closingDelimiters.has(character)) return true
  if (expectedClosers.at(-1) !== character) return false
  expectedClosers.pop()
  return true
}

const unquotedAssignmentValueEnd = (value: string, start: number): number => {
  let end = start
  const expectedClosers: string[] = []
  while (end < value.length) {
    if (startsFollowingAssignmentAt(value, end, expectedClosers.length)) break
    const quotedEnd = quotedSegmentEndAt(value, end)
    if (quotedEnd !== undefined) {
      end = quotedEnd
      continue
    }
    if (!consumeNestedDelimiter(value, end, expectedClosers)) return value.length
    end += 1
  }
  while (end > start && /\s/.test(value[end - 1] ?? "")) end -= 1
  return end
}

const assignmentValueRangeAfter = (
  value: string,
  separator: AssignmentSeparator,
  key: AssignmentKey,
): SecretAssignmentRange => {
  const valueStart = separator.end
  if (key.enclosingQuote !== undefined) {
    return { valueStart, valueEnd: key.enclosingQuote }
  }
  const contentStart = afterWhitespace(value, valueStart)
  const quote = value[contentStart]
  const emptyBoundaryWidth = assignmentBoundaryWidthAt(value, contentStart)
  const emptyBeforeAssignment = emptyBoundaryWidth > 0
    && startsAssignment(value, contentStart + emptyBoundaryWidth)
  if (emptyBeforeAssignment) return { valueStart, valueEnd: valueStart }
  if (quote === undefined) return { valueStart, valueEnd: contentStart }
  return {
    valueStart,
    valueEnd: quote === "\"" || quote === "'"
      ? quotedValueEnd(value, contentStart, quote)
      : unquotedAssignmentValueEnd(value, contentStart),
  }
}

const redactSecretAssignments = (value: string): string => {
  const output: string[] = []
  let copiedThrough = 0
  let cursor = 0
  let redacted = false
  while (cursor < value.length) {
    const quotedKeySeparator = quotedAssignmentSeparatorAfter(value, cursor)
    if (quotedKeySeparator !== undefined) {
      cursor = quotedKeySeparator.start
      continue
    }
    const separator = assignmentSeparatorAt(value, cursor)
    if (separator === undefined) {
      cursor += 1
      continue
    }
    const key = assignmentKeyBefore(value, separator)
    if (key === undefined || !isSyntacticAssignment(value, separator)) {
      cursor = separator.end
      continue
    }
    if (!sensitiveAssignmentKey(key)) {
      cursor = balancedQuotedValueEndAfter(value, separator) ?? separator.end
      continue
    }
    const assignment = assignmentValueRangeAfter(value, separator, key)
    output.push(value.slice(copiedThrough, assignment.valueStart), redactedDiagnosticValue)
    copiedThrough = assignment.valueEnd
    cursor = Math.max(separator.end, assignment.valueEnd)
    redacted = true
  }
  return redacted
    ? `${output.join("")}${value.slice(copiedThrough)}`
    : value
}

const redactString = (value: string, secrets: readonly string[]): string => {
  const configured = replaceConfiguredSecrets(value, secrets)
  const privateKeyRedacted = configured.replace(privateKeyPattern, redactedDiagnosticValue)
  const preserveBoundaryAndRedact = (_match: string, boundary: string): string => `${boundary}${redactedDiagnosticValue}`
  const urlRedacted = privateKeyRedacted.replace(authUrlPattern, preserveBoundaryAndRedact)
  const bearerRedacted = urlRedacted.replace(bearerCredentialPattern, preserveBoundaryAndRedact)
  const opReferenceRedacted = bearerRedacted.replace(opReferencePattern, preserveBoundaryAndRedact)
  return redactSecretAssignments(opReferenceRedacted)
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
