#!/usr/bin/env bun
import { existsSync } from "node:fs"
import { resolve } from "node:path"

const repositoryRoot = resolve(import.meta.dir, "../..")
const fallowExecutable = resolve(repositoryRoot, "node_modules/.bin/fallow")
const expectedFallowVersion = "3.19.0"
const expectedAuditSchemaVersion = 10
const expectedProtocolVersion = 7
const expectedBackendVersion = "7.0.2"
const documentedNativeExits = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13])
const introducedCountKeys = [
  "dead_code_introduced",
  "complexity_introduced",
  "duplication_introduced",
  "styling_introduced",
] as const
const inheritedCountKeys = [
  "dead_code_inherited",
  "complexity_inherited",
  "duplication_inherited",
  "styling_inherited",
] as const

type Decision = "accepted" | "refused" | "error"

type ReasonCode =
  | "policy-accepted"
  | "introduced-findings"
  | "native-fail-verdict"
  | "comparison-base-required"
  | "comparison-base-unavailable"
  | "local-fallow-missing"
  | "fallow-version-mismatch"
  | "native-launch-failed"
  | "native-output-missing"
  | "native-output-not-json"
  | "native-output-schema-mismatch"
  | "type-aware-incomplete"
  | "native-exit-mismatch"
  | "native-operational-error"
  | "native-exit-undocumented"
  | "internal-error"

type JsonRecord = Record<string, unknown>

type PolicyEnvelope = {
  kind: "fallow-policy"
  schema_version: 1
  command: "quality:fallow"
  decision: Decision
  reason_code: ReasonCode
  base_ref: string | null
  fallow_version: string | null
  native_exit: number | null
  native_stderr: string | null
  repair_hint: string | null
  fallow: JsonRecord | null
}

type NativeObservation = {
  exitCode: number
  stdout: string
  stderr: string
}

const repairHints: Record<Exclude<ReasonCode, "policy-accepted">, string> = {
  "introduced-findings": "Remove or narrowly justify every introduced finding, then rerun the same comparison.",
  "native-fail-verdict": "Repair the error-severity introduced findings, then rerun the same comparison.",
  "comparison-base-required": "Supply an immutable commit, or HEAD for a dirty turn.",
  "comparison-base-unavailable": "Correct or fetch the named commit, then rerun with the same task scope.",
  "local-fallow-missing": "Run the repository Bun install and restore the pinned Fallow dependency.",
  "fallow-version-mismatch": "Restore the exact Fallow manifest and lockfile pin.",
  "native-launch-failed": "Repair local executable permissions or platform installation, then rerun.",
  "native-output-missing": "Inspect the bounded native diagnostics, repair the native failure, then rerun.",
  "native-output-not-json": "Inspect the bounded diagnostics and restore the pinned Fallow output contract.",
  "native-output-schema-mismatch": "Restore Fallow 3.19.0 or update this contract through a new reviewed plan.",
  "type-aware-incomplete": "Restore complete TypeScript Go analysis before judging findings.",
  "native-exit-mismatch": "Treat the run as unreliable and restore agreement between the native envelope and exit.",
  "native-operational-error": "Repair the reported Fallow resource, coverage, network, security, or upload condition.",
  "native-exit-undocumented": "Review the installed Fallow contract before retrying this undocumented native exit.",
  "internal-error": "Repair the policy Adapter through a focused failing test; do not infer a Fallow verdict.",
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function parseBaseRef(argv: readonly string[]): string | null {
  const positionalIndex = argv.indexOf("--changed-since")
  if (positionalIndex !== -1) return argv[positionalIndex + 1] ?? null
  return parseInlineBaseRef(argv)
}

function parseInlineBaseRef(argv: readonly string[]): string | null {
  const inline = argv.find(isInlineBaseRef)
  return inline?.slice("--changed-since=".length) || null
}

function isInlineBaseRef(argument: string): boolean {
  return argument.startsWith("--changed-since=")
}

const stackTraceLinePatterns = [/^\s*at\s/i, /^\s*stack backtrace:/i, /^\s*\d+:\s+0x[0-9a-f]+\b/i]

function isDiagnosticMessageLine(line: string): boolean {
  return !stackTraceLinePatterns.some((pattern) => pattern.test(line))
}

function stripStackTrace(input: string): string {
  return input.split("\n").filter(isDiagnosticMessageLine).join("\n")
}

function sanitizeDiagnostic(input: string): string | null {
  const ansiEscape = String.fromCharCode(27)
  const withoutTerminalEscapes = input.replaceAll(
    new RegExp(`${ansiEscape}\\[[0-?]*[ -/]*[@-~]`, "g"),
    "",
  )
  const withoutStackTrace = stripStackTrace(withoutTerminalEscapes)
  const withoutCredentials = withoutStackTrace
    .replace(/\b(authorization|password|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=<redacted>")
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, "https://<redacted>@")
  const withoutAbsolutePaths = withoutCredentials
    .replace(/\b[A-Za-z]:\\[^\s"'`,;:)]+/g, "<redacted-path>")
    .replace(/(^|[\s("'=:])\/(?:[^/\s"'`,;:()]+\/)*[^/\s"'`,;:()]*/gm, "$1<redacted-path>")
  const bounded = withoutAbsolutePaths.trim().slice(0, 1_000)
  return bounded.length === 0 ? null : bounded
}

function makeEnvelope(options: {
  decision: Decision
  reasonCode: ReasonCode
  baseRef: string | null
  fallowVersion: string | null
  nativeExit: number | null
  nativeStderr?: string | null
  fallow?: JsonRecord | null
}): PolicyEnvelope {
  return {
    kind: "fallow-policy",
    schema_version: 1,
    command: "quality:fallow",
    decision: options.decision,
    reason_code: options.reasonCode,
    base_ref: options.baseRef,
    fallow_version: options.fallowVersion,
    native_exit: options.nativeExit,
    native_stderr: options.nativeStderr ?? null,
    repair_hint: options.reasonCode === "policy-accepted" ? null : repairHints[options.reasonCode],
    fallow: options.fallow ?? null,
  }
}

type AuditEvidence = {
  kind: "audit"
  document: JsonRecord
  verdict: "pass" | "warn" | "fail"
  introducedFindings: number
  typeAwareComplete: boolean
}

type NativeEvidence =
  | AuditEvidence
  | { kind: "error"; document: JsonRecord; declaredExit: number }
  | { kind: "unusable"; reasonCode: ReasonCode; document: JsonRecord | null }

function hasExpectedAuditHeader(document: JsonRecord, baseRef: string): boolean {
  return [
    document.kind === "audit",
    document.schema_version === expectedAuditSchemaVersion,
    document.version === expectedFallowVersion,
    document.command === "audit",
    ["pass", "warn", "fail"].includes(String(document.verdict)),
    document.base_ref === baseRef,
  ].every(Boolean)
}

function hasExpectedAttribution(attribution: JsonRecord): boolean {
  const countsAreValid = [...introducedCountKeys, ...inheritedCountKeys].every((key) =>
    isNonNegativeInteger(attribution[key]),
  )
  return attribution.gate === "new-only" && countsAreValid
}

function hasExpectedTypeAwareIdentity(typeAware: JsonRecord): boolean {
  const identity = typeAware.identity
  if (!isRecord(identity)) return false
  return [
    typeAware.protocol_version === expectedProtocolVersion,
    typeAware.sidecar_version === expectedFallowVersion,
    typeAware.backend === "typescript-go",
    typeAware.backend_version === expectedBackendVersion,
    identity.backend_family === "typescript-go",
  ].every(Boolean)
}

function isTypeAwareComplete(typeAware: JsonRecord): boolean {
  const identity = typeAware.identity as JsonRecord
  return [
    typeAware.executed === true,
    typeAware.required_completeness === "complete",
    identity.completeness === "complete",
  ].every(Boolean)
}

type AuditShape = { attribution: JsonRecord; typeAware: JsonRecord }

function extractAuditShape(document: JsonRecord): AuditShape | null {
  if (!isRecord(document.attribution)) return null
  if (!isRecord(document._meta)) return null
  if (!isRecord(document._meta.type_aware)) return null
  return { attribution: document.attribution, typeAware: document._meta.type_aware }
}

function hasExpectedAuditShape(shape: AuditShape): boolean {
  return [hasExpectedAttribution(shape.attribution), hasExpectedTypeAwareIdentity(shape.typeAware)].every(Boolean)
}

function decodeAuditEvidence(document: JsonRecord, baseRef: string): NativeEvidence {
  if (!hasExpectedAuditHeader(document, baseRef)) {
    return { kind: "unusable", reasonCode: "native-output-schema-mismatch", document }
  }
  const shape = extractAuditShape(document)
  if (shape === null) return { kind: "unusable", reasonCode: "native-output-schema-mismatch", document }
  if (!hasExpectedAuditShape(shape)) {
    return { kind: "unusable", reasonCode: "native-output-schema-mismatch", document }
  }
  return {
    kind: "audit",
    document,
    verdict: document.verdict as AuditEvidence["verdict"],
    introducedFindings: introducedFindingCount(document),
    typeAwareComplete: isTypeAwareComplete(shape.typeAware),
  }
}

function isStructurallyValidError(document: JsonRecord): boolean {
  return document.error === true && typeof document.message === "string" && Number.isInteger(document.exit_code)
}

function isComparisonBaseError(document: JsonRecord, nativeStderr: string | null): boolean {
  const message = typeof document.message === "string" ? document.message : ""
  const combined = `${message}\n${nativeStderr ?? ""}`
  return /(?:base ref|changed-since).*(?:exist|resolve|determine|revision|commit)/is.test(combined)
}

function introducedFindingCount(document: JsonRecord): number {
  if (!isRecord(document.attribution)) return 0
  const attribution = document.attribution
  return introducedCountKeys.reduce((total, key) => total + Number(attribution[key] ?? 0), 0)
}

function parseJsonRecord(output: string): NativeEvidence | { parsed: JsonRecord } {
  try {
    const parsed: unknown = JSON.parse(output)
    return isRecord(parsed)
      ? { parsed }
      : { kind: "unusable", reasonCode: "native-output-schema-mismatch", document: null }
  } catch {
    return { kind: "unusable", reasonCode: "native-output-not-json", document: null }
  }
}

function missingOutputReason(observation: NativeObservation, nativeStderr: string | null): ReasonCode {
  const isOperational =
    nativeStderr !== null && ![0, 1].includes(observation.exitCode) && documentedNativeExits.has(observation.exitCode)
  return isOperational ? "native-operational-error" : "native-output-missing"
}

function decodeNativeEvidence(
  observation: NativeObservation,
  nativeStderr: string | null,
  baseRef: string,
): NativeEvidence {
  const output = observation.stdout.trim()
  if (output.length === 0) {
    return { kind: "unusable", reasonCode: missingOutputReason(observation, nativeStderr), document: null }
  }
  const parsed = parseJsonRecord(output)
  if ("kind" in parsed) return parsed
  if (isStructurallyValidError(parsed.parsed)) {
    return { kind: "error", document: parsed.parsed, declaredExit: parsed.parsed.exit_code as number }
  }
  return decodeAuditEvidence(parsed.parsed, baseRef)
}

type NativeEnvelopeContext = {
  baseRef: string
  fallowVersion: string
  nativeExit: number
  nativeStderr: string | null
}

function makeNativeEnvelope(
  context: NativeEnvelopeContext,
  decision: Decision,
  reasonCode: ReasonCode,
  document: JsonRecord | null,
): PolicyEnvelope {
  return makeEnvelope({
    decision,
    reasonCode,
    baseRef: context.baseRef,
    fallowVersion: context.fallowVersion,
    nativeExit: context.nativeExit,
    nativeStderr: context.nativeStderr,
    fallow: document,
  })
}

function classifyNativeError(
  evidence: Extract<NativeEvidence, { kind: "error" }>,
  context: NativeEnvelopeContext,
): PolicyEnvelope {
  const reasonCode = classifyNativeErrorReason(evidence, context)
  return makeNativeEnvelope(context, "error", reasonCode, evidence.document)
}

function classifyNativeErrorReason(
  evidence: Extract<NativeEvidence, { kind: "error" }>,
  context: NativeEnvelopeContext,
): ReasonCode {
  const precedenceReason = classifyNativeErrorPrecedence(evidence, context)
  if (precedenceReason !== null) return precedenceReason
  return classifyNativeErrorExit(evidence, context.nativeExit)
}

function classifyNativeErrorPrecedence(
  evidence: Extract<NativeEvidence, { kind: "error" }>,
  context: NativeEnvelopeContext,
): ReasonCode | null {
  if ([context.nativeExit, evidence.declaredExit].some(isPolicyOutcomeExit)) return "native-output-schema-mismatch"
  if (context.nativeExit === 2 && isComparisonBaseError(evidence.document, context.nativeStderr)) {
    return "comparison-base-unavailable"
  }
  return null
}

function isPolicyOutcomeExit(exitCode: number): boolean {
  return [0, 1].includes(exitCode)
}

function classifyNativeErrorExit(
  evidence: Extract<NativeEvidence, { kind: "error" }>,
  nativeExit: number,
): ReasonCode {
  if (!documentedNativeExits.has(nativeExit)) return "native-exit-undocumented"
  return evidence.declaredExit === nativeExit ? "native-operational-error" : "native-exit-mismatch"
}

function validateAuditExecution(evidence: AuditEvidence, nativeExit: number): ReasonCode | null {
  if (!documentedNativeExits.has(nativeExit)) return "native-exit-undocumented"
  if (!evidence.typeAwareComplete) return "type-aware-incomplete"
  return nativeExit === expectedAuditExit(evidence.verdict) ? null : "native-exit-mismatch"
}

function expectedAuditExit(verdict: AuditEvidence["verdict"]): number {
  return verdict === "fail" ? 1 : 0
}

function classifyAuditDecision(evidence: AuditEvidence): { decision: Decision; reasonCode: ReasonCode } {
  if (evidence.introducedFindings > 0) return { decision: "refused", reasonCode: "introduced-findings" }
  if (evidence.verdict === "fail") return { decision: "refused", reasonCode: "native-fail-verdict" }
  return { decision: "accepted", reasonCode: "policy-accepted" }
}

function classifyAudit(evidence: AuditEvidence, context: NativeEnvelopeContext): PolicyEnvelope {
  const executionError = validateAuditExecution(evidence, context.nativeExit)
  if (executionError !== null) return makeNativeEnvelope(context, "error", executionError, evidence.document)
  const decision = classifyAuditDecision(evidence)
  return makeNativeEnvelope(context, decision.decision, decision.reasonCode, evidence.document)
}

function classifyNative(options: {
  baseRef: string
  fallowVersion: string
  observation: NativeObservation
}): PolicyEnvelope {
  const { baseRef, fallowVersion, observation } = options
  const nativeStderr = sanitizeDiagnostic(observation.stderr)
  const context = { baseRef, fallowVersion, nativeExit: observation.exitCode, nativeStderr }
  const evidence = decodeNativeEvidence(observation, nativeStderr, baseRef)
  if (evidence.kind === "unusable") {
    return makeNativeEnvelope(context, "error", evidence.reasonCode, evidence.document)
  }
  if (evidence.kind === "error") return classifyNativeError(evidence, context)
  return classifyAudit(evidence, context)
}

async function observeProcess(command: readonly string[], cwd: string): Promise<NativeObservation> {
  const child = Bun.spawn([...command], {
    cwd,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

type PolicyResult = { envelope: PolicyEnvelope; exitCode: number }
type LocalFallowReady = { kind: "ready"; version: string }
type LocalFallowPreparation = LocalFallowReady | { kind: "error"; result: PolicyResult }

function policyError(
  reasonCode: ReasonCode,
  baseRef: string | null,
  fallowVersion: string | null,
  nativeStderr?: string | null,
): PolicyResult {
  return {
    envelope: makeEnvelope({
      decision: "error",
      reasonCode,
      baseRef,
      fallowVersion,
      nativeExit: null,
      nativeStderr,
    }),
    exitCode: 2,
  }
}

async function observeSafely(command: readonly string[]): Promise<NativeObservation | null> {
  try {
    return await observeProcess(command, repositoryRoot)
  } catch {
    return null
  }
}

function installedFallowVersion(versionObservation: NativeObservation): string | null {
  const versionMatch = versionObservation.stdout.match(/^fallow\s+(\S+)/m)
  return versionMatch?.[1] ?? null
}

function versionMatchesContract(observation: NativeObservation, version: string | null): boolean {
  return [observation.exitCode === 0, version === expectedFallowVersion].every(Boolean)
}

async function prepareLocalFallow(baseRef: string): Promise<LocalFallowPreparation> {
  if (!existsSync(fallowExecutable)) {
    return { kind: "error", result: policyError("local-fallow-missing", baseRef, null) }
  }
  const observation = await observeSafely([fallowExecutable, "--version"])
  if (observation === null) return { kind: "error", result: policyError("native-launch-failed", baseRef, null) }
  const version = installedFallowVersion(observation)
  if (!versionMatchesContract(observation, version)) {
    return {
      kind: "error",
      result: policyError("fallow-version-mismatch", baseRef, version, sanitizeDiagnostic(observation.stderr)),
    }
  }
  return { kind: "ready", version: expectedFallowVersion }
}

function auditCommand(baseRef: string): readonly string[] {
  return [
    fallowExecutable,
    "audit",
    "--format",
    "json",
    "--quiet",
    "--changed-since",
    baseRef,
    "--type-aware",
    "--type-aware-require",
    "complete",
  ]
}

const decisionExitCodes: Record<Decision, number> = { accepted: 0, refused: 1, error: 2 }

async function runLocalAudit(baseRef: string, fallowVersion: string): Promise<PolicyResult> {
  const observation = await observeSafely(auditCommand(baseRef))
  if (observation === null) return policyError("native-launch-failed", baseRef, fallowVersion)
  const envelope = classifyNative({ baseRef, fallowVersion, observation })
  return { envelope, exitCode: decisionExitCodes[envelope.decision] }
}

async function executePolicy(argv: readonly string[]): Promise<PolicyResult> {
  const baseRef = parseBaseRef(argv)
  if (baseRef === null) return policyError("comparison-base-required", null, null)
  const preparation = await prepareLocalFallow(baseRef)
  if (preparation.kind === "error") return preparation.result
  return runLocalAudit(baseRef, preparation.version)
}

async function main(argv: readonly string[]): Promise<void> {
  let envelope: PolicyEnvelope
  let exitCode: number
  try {
    ;({ envelope, exitCode } = await executePolicy(argv))
  } catch {
    envelope = makeEnvelope({
      decision: "error",
      reasonCode: "internal-error",
      baseRef: null,
      fallowVersion: null,
      nativeExit: null,
    })
    exitCode = 2
  }
  process.stdout.write(`${JSON.stringify(envelope)}\n`)
  process.exitCode = exitCode
}

await main(Bun.argv.slice(2))
