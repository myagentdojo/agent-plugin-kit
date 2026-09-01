import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

export const currentStageTestFiles = [
  "clean-fixture/personal-verification-profile/contract-tests/package-export-catalog.test.ts",
  "src/admission-bootstrap/contract-tests/admitted-identity-before-execution.test.ts",
  "src/admission-bootstrap/contract-tests/identity-refusal.test.ts",
  "src/modules/maintenance-command-contract/contract-tests/effect-class-and-retry-safety.test.ts",
  "src/modules/maintenance-command-contract/contract-tests/human-and-agent-result-vocabulary.test.ts",
  "src/modules/maintenance-command-contract/contract-tests/branch-station-catalog.test.ts",
  "src/modules/qualification-evidence/contract-tests/candidate-lineage-reduction.test.ts",
  "src/modules/qualification-evidence/contract-tests/proof-layer-and-non-claim.test.ts",
  "clean-fixture/personal-verification-profile/contract-tests/admission-and-invocation.test.ts",
  "clean-fixture/personal-verification-profile/contract-tests/installation-evidence.test.ts",
  "clean-fixture/personal-verification-profile/contract-tests/fresh-native-non-claims.test.ts",
  "clean-fixture/public-verification-profile/contract-tests/profile-non-promotion.test.ts",
  "clean-fixture/personal-verification-profile/contract-tests/maintenance-cli.test.ts",
  "clean-fixture/personal-verification-profile/contract-tests/maintenance-cli-local-link.test.ts",
  "src/adapters/maintenance-command-facade/contract-tests/command-surface.test.ts",
  "src/adapters/maintenance-command-facade/contract-tests/public-process.test.ts",
  "src/adapters/maintenance-command-facade/contract-tests/observability.test.ts",
] as const

export const currentStageTestCounts = {
  "clean-fixture/personal-verification-profile/contract-tests/package-export-catalog.test.ts": 3,
  "src/admission-bootstrap/contract-tests/admitted-identity-before-execution.test.ts": 2,
  "src/admission-bootstrap/contract-tests/identity-refusal.test.ts": 6,
  "src/modules/maintenance-command-contract/contract-tests/effect-class-and-retry-safety.test.ts": 9,
  "src/modules/maintenance-command-contract/contract-tests/human-and-agent-result-vocabulary.test.ts": 7,
  "src/modules/maintenance-command-contract/contract-tests/branch-station-catalog.test.ts": 8,
  "src/modules/qualification-evidence/contract-tests/candidate-lineage-reduction.test.ts": 8,
  "src/modules/qualification-evidence/contract-tests/proof-layer-and-non-claim.test.ts": 7,
  "clean-fixture/personal-verification-profile/contract-tests/admission-and-invocation.test.ts": 3,
  "clean-fixture/personal-verification-profile/contract-tests/installation-evidence.test.ts": 3,
  "clean-fixture/personal-verification-profile/contract-tests/fresh-native-non-claims.test.ts": 2,
  "clean-fixture/public-verification-profile/contract-tests/profile-non-promotion.test.ts": 2,
  "clean-fixture/personal-verification-profile/contract-tests/maintenance-cli.test.ts": 5,
  "clean-fixture/personal-verification-profile/contract-tests/maintenance-cli-local-link.test.ts": 8,
  "src/adapters/maintenance-command-facade/contract-tests/command-surface.test.ts": 12,
  "src/adapters/maintenance-command-facade/contract-tests/public-process.test.ts": 11,
  "src/adapters/maintenance-command-facade/contract-tests/observability.test.ts": 12,
} as const

export const currentStageExpectedTestCount = 108

export type GuardResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false
      code:
        | "selector-duplicate"
        | "selector-missing"
        | "selector-unexpected"
        | "selector-order"
        | "selector-file-missing"
        | "forbidden-test-directive"
        | "report-malformed"
        | "report-file-drift"
        | "report-count-mismatch"
        | "report-skipped"
        | "report-failed"
        | "test-process-failed"
        | "test-process-timeout"
      detail: string
    }>

type GuardFailure = Extract<GuardResult, { ok: false }>

const failure = (code: GuardFailure["code"], detail: string): GuardFailure => ({ ok: false, code, detail })

const missingValues = (actual: readonly string[]): readonly string[] =>
  currentStageTestFiles.filter((file) => !actual.includes(file))

const unexpectedValues = (actual: readonly string[]): readonly string[] =>
  actual.filter((file) => !currentStageTestFiles.includes(file as (typeof currentStageTestFiles)[number]))

export function validateCurrentStageSelection(actual: readonly string[]): GuardResult {
  const duplicates = actual.filter((file, index) => actual.indexOf(file) !== index)
  if (duplicates.length > 0) return failure("selector-duplicate", duplicates.join(","))

  const missing = missingValues(actual)
  if (missing.length > 0) return failure("selector-missing", missing.join(","))

  const unexpected = unexpectedValues(actual)
  if (unexpected.length > 0) return failure("selector-unexpected", unexpected.join(","))

  if (actual.length !== currentStageTestFiles.length) {
    return failure("selector-order", `expected ${currentStageTestFiles.length} files, received ${actual.length}`)
  }

  const orderDrift = actual.findIndex((file, index) => file !== currentStageTestFiles[index])
  return orderDrift === -1
    ? { ok: true }
    : failure("selector-order", `index ${orderDrift} expected ${currentStageTestFiles[orderDrift] ?? "missing"}`)
}

export function validateCurrentStageFiles(repositoryRoot: string, files: readonly string[]): GuardResult {
  for (const file of files) {
    try {
      if (!statSync(join(repositoryRoot, file)).isFile()) return failure("selector-file-missing", file)
    } catch {
      return failure("selector-file-missing", file)
    }
  }
  return { ok: true }
}

const forbiddenTestDirective = /\b(?:test|it|describe)\.(?:only|skip|todo|onlyIf|skipIf|todoIf)\s*\(/u

export function forbiddenTestDirectiveIn(source: string): boolean {
  return forbiddenTestDirective.test(source)
}

export function validateCurrentStageSources(
  repositoryRoot: string,
  files: readonly string[],
): GuardResult {
  for (const file of files) {
    let source: string
    try {
      source = readFileSync(join(repositoryRoot, file), "utf8")
    } catch {
      return failure("selector-file-missing", file)
    }
    if (forbiddenTestDirectiveIn(source)) return failure("forbidden-test-directive", file)
  }
  return { ok: true }
}

type JunitSuite = Readonly<{
  file: string
  tests: number
  failures: number
  skipped: number
  testCases: number
  failedCases: number
  skippedCases: number
}>

const integerAttribute = (attributes: string, name: string): number | undefined => {
  const value = new RegExp(`\\b${name}="([0-9]+)"`, "u").exec(attributes)?.[1]
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

const stringAttribute = (attributes: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`, "u").exec(attributes)?.[1]

function parseJunitSuite(attributes: string, body: string): JunitSuite | GuardFailure {
  const file = stringAttribute(attributes, "file")
  const tests = integerAttribute(attributes, "tests")
  const failures = integerAttribute(attributes, "failures")
  const skipped = integerAttribute(attributes, "skipped")
  if (file === undefined || tests === undefined || failures === undefined || skipped === undefined) {
    return failure("report-malformed", "testsuite attributes")
  }

  const testCases = [...body.matchAll(/<testcase\b[^>]*(?:\/>|>[\s\S]*?<\/testcase>)/gu)]
  const failedCases = testCases.filter(([testCase]) => /<(?:failure|error)\b/u.test(testCase)).length
  const skippedCases = testCases.filter(([testCase]) => /<skipped\b/u.test(testCase)).length
  return { file, tests, failures, skipped, testCases: testCases.length, failedCases, skippedCases }
}

type JunitRoot = Readonly<{
  tests: number
  failures: number
  skipped: number
  suites: readonly JunitSuite[]
}>

type JunitRootAttributes = Readonly<{
  tests: number
  failures: number
  skipped: number
}>

function parseJunitRootAttributes(attributes: string): JunitRootAttributes | GuardFailure {
  const tests = integerAttribute(attributes, "tests")
  const failures = integerAttribute(attributes, "failures")
  const skipped = integerAttribute(attributes, "skipped")
  if (tests === undefined || failures === undefined || skipped === undefined) {
    return failure("report-malformed", "testsuites attributes")
  }
  return { tests, failures, skipped }
}

function parseJunitSuites(body: string): readonly JunitSuite[] | GuardFailure {
  const suites: JunitSuite[] = []
  for (const match of body.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/gu)) {
    const parsed = parseJunitSuite(match[1] ?? "", match[2] ?? "")
    if ("ok" in parsed && !parsed.ok) return parsed
    suites.push(parsed as JunitSuite)
  }
  return suites
}

function parseJunitRoot(xml: string): { ok: true; value: JunitRoot } | GuardFailure {
  const rootMatch = /<testsuites\b([^>]*)>([\s\S]*)<\/testsuites>\s*$/u.exec(xml.trim())
  if (rootMatch === null) return failure("report-malformed", "testsuites envelope")
  const attributes = parseJunitRootAttributes(rootMatch[1] ?? "")
  if ("ok" in attributes) return attributes
  const suites = parseJunitSuites(rootMatch[2] ?? "")
  if ("ok" in suites) return suites
  return { ok: true, value: { ...attributes, suites } }
}

function validateJunitSuiteInventory(suites: readonly JunitSuite[]): GuardResult {
  if (suites.length !== currentStageTestFiles.length) {
    return failure("report-file-drift", `expected ${currentStageTestFiles.length} suites, received ${suites.length}`)
  }

  const files = suites.map(({ file }) => file)
  const duplicates = files.filter((file, index) => files.indexOf(file) !== index)
  if (duplicates.length > 0) return failure("report-file-drift", `duplicate ${duplicates.join(",")}`)
  const missing = missingValues(files)
  const unexpected = unexpectedValues(files)
  if (missing.length > 0 || unexpected.length > 0) {
    return failure("report-file-drift", `missing=${missing.join(",")} unexpected=${unexpected.join(",")}`)
  }
  return { ok: true }
}

function validateJunitRootTotals(root: JunitRoot): GuardResult {
  if (root.tests !== currentStageExpectedTestCount || root.failures !== 0 || root.skipped !== 0) {
    return failure("report-count-mismatch", `tests=${root.tests} failures=${root.failures} skipped=${root.skipped}`)
  }
  return { ok: true }
}

function validateJunitSuiteOutcome(suite: JunitSuite): GuardResult {
  const expectedTests = currentStageTestCounts[suite.file as keyof typeof currentStageTestCounts]
  if (expectedTests === undefined || suite.tests !== expectedTests || suite.testCases !== expectedTests) {
    return failure("report-count-mismatch", `${suite.file} expected ${expectedTests ?? "known"} tests, received ${suite.tests}/${suite.testCases}`)
  }
  if (suite.failures !== 0 || suite.failedCases !== 0) return failure("report-failed", suite.file)
  if (suite.skipped !== 0 || suite.skippedCases !== 0) return failure("report-skipped", suite.file)
  return { ok: true }
}

function validateJunitSuiteOutcomes(suites: readonly JunitSuite[]): GuardResult {
  for (const suite of suites) {
    const result = validateJunitSuiteOutcome(suite)
    if (!result.ok) return result
  }
  return { ok: true }
}

export function validateJunitReport(xml: string): GuardResult {
  const parsed = parseJunitRoot(xml)
  if (!parsed.ok) return parsed
  const inventory = validateJunitSuiteInventory(parsed.value.suites)
  if (!inventory.ok) return inventory
  const totals = validateJunitRootTotals(parsed.value)
  if (!totals.ok) return totals
  return validateJunitSuiteOutcomes(parsed.value.suites)
}

export type CurrentStageProcessResult = Readonly<{
  exitCode: number
  signalCode: NodeJS.Signals | null
  report: string
}>

export function validateCurrentStageProcess(result: CurrentStageProcessResult): GuardResult {
  if (result.signalCode !== null) return failure("test-process-timeout", result.signalCode)
  if (result.exitCode !== 0) return failure("test-process-failed", `exit ${result.exitCode}`)
  return validateJunitReport(result.report)
}

const reportFailure = (result: GuardFailure): void => {
  process.stderr.write(`${JSON.stringify({ command: "test:current-stage", ...result })}\n`)
}

async function runCurrentStage(): Promise<number> {
  const selected = process.argv.slice(2)
  const selection = validateCurrentStageSelection(selected)
  if (!selection.ok) {
    reportFailure(selection)
    return 1
  }

  const repositoryRoot = resolve(import.meta.dir, "..")
  const files = validateCurrentStageFiles(repositoryRoot, selected)
  if (!files.ok) {
    reportFailure(files)
    return 1
  }
  const sources = validateCurrentStageSources(repositoryRoot, selected)
  if (!sources.ok) {
    reportFailure(sources)
    return 1
  }

  const temporaryRoot = mkdtempSync(join(tmpdir(), "agent-plugin-kit-current-stage-"))
  const reportPath = join(temporaryRoot, "junit.xml")
  try {
    const child = Bun.spawn({
      cmd: [process.execPath, "test", "--reporter=junit", "--reporter-outfile", reportPath, ...selected],
      cwd: repositoryRoot,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      timeout: 120_000,
      killSignal: "SIGKILL",
    })
    const exitCode = await child.exited
    let report: string
    try {
      report = readFileSync(reportPath, "utf8")
    } catch {
      report = ""
    }
    const result = validateCurrentStageProcess({ exitCode, signalCode: child.signalCode, report })
    if (!result.ok) reportFailure(result)
    return result.ok ? 0 : 1
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

if (import.meta.main) process.exitCode = await runCurrentStage()
