import { afterAll, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const kitRoot = resolve(import.meta.dir, "../../..")
const policySourcePath = resolve(import.meta.dir, "../fallow-policy.ts")
const temporaryRoots: string[] = []

type JsonRecord = Record<string, unknown>

type Scenario = {
  exitCode: number
  stdout?: string | JsonRecord
  stderr?: string
}

type ProcessObservation = {
  exitCode: number
  stdout: string
  stderr: string
  envelope: JsonRecord
}

const zeroAttribution = {
  gate: "new-only",
  dead_code_introduced: 0,
  dead_code_inherited: 0,
  complexity_introduced: 0,
  complexity_inherited: 0,
  duplication_introduced: 0,
  duplication_inherited: 0,
  styling_introduced: 0,
  styling_inherited: 0,
}

const expectedReasonCodes = [
  "policy-accepted",
  "introduced-findings",
  "native-fail-verdict",
  "comparison-base-required",
  "comparison-base-unavailable",
  "local-fallow-missing",
  "fallow-version-mismatch",
  "native-launch-failed",
  "native-output-missing",
  "native-output-not-json",
  "native-output-schema-mismatch",
  "type-aware-incomplete",
  "native-exit-mismatch",
  "native-operational-error",
  "native-exit-undocumented",
  "internal-error",
] as const

type ExpectedReasonCode = (typeof expectedReasonCodes)[number]

const expectedRepairHints: Record<Exclude<ExpectedReasonCode, "policy-accepted">, string> = {
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

function successDocument(verdict: "pass" | "warn" | "fail" = "pass"): JsonRecord {
  return {
    kind: "audit",
    schema_version: 10,
    version: "3.19.0",
    command: "audit",
    verdict,
    base_ref: "HEAD",
    attribution: { ...zeroAttribution },
    _meta: {
      type_aware: {
        identity: { backend_family: "typescript-go", completeness: "complete" },
        required_completeness: "complete",
        executed: true,
        protocol_version: 7,
        sidecar_version: "3.19.0",
        backend: "typescript-go",
        backend_version: "7.0.2",
      },
    },
  }
}

function emptyDeltaDocument(): JsonRecord {
  return {
    kind: "audit",
    schema_version: 10,
    version: "3.19.0",
    command: "audit",
    verdict: "pass",
    changed_files_count: 0,
    base_ref: "HEAD",
    attribution: { ...zeroAttribution },
    summary: {
      dead_code_issues: 0,
      dead_code_has_errors: false,
      complexity_findings: 0,
      max_cyclomatic: null,
      duplication_clone_groups: 0,
    },
    _meta: { telemetry: { analysis_run_id: "run_fixture" } },
  }
}

function cloneDocument(document: JsonRecord): JsonRecord {
  return structuredClone(document)
}

function setAttribution(document: JsonRecord, key: string, value: number): JsonRecord {
  const copy = cloneDocument(document)
  ;(copy.attribution as JsonRecord)[key] = value
  return copy
}

function setTypeAware(document: JsonRecord, key: string, value: unknown): JsonRecord {
  const copy = cloneDocument(document)
  const meta = copy._meta as JsonRecord
  ;(meta.type_aware as JsonRecord)[key] = value
  return copy
}

function setTypeAwareIdentity(document: JsonRecord, key: string, value: unknown): JsonRecord {
  const copy = cloneDocument(document)
  const meta = copy._meta as JsonRecord
  const typeAware = meta.type_aware as JsonRecord
  ;(typeAware.identity as JsonRecord)[key] = value
  return copy
}

const fakeFallowSource = `#!/usr/bin/env bun
const version = process.env.FAKE_FALLOW_VERSION ?? "3.19.0"
if (Bun.argv.includes("--version")) {
  process.stdout.write(\`fallow \${version}\\n\`)
} else {
  const scenario = JSON.parse(process.env.FAKE_FALLOW_SCENARIO ?? "{}")
  if (scenario.stdout !== undefined) {
    process.stdout.write(typeof scenario.stdout === "string" ? scenario.stdout : JSON.stringify(scenario.stdout))
  }
  if (scenario.stderr !== undefined) process.stderr.write(scenario.stderr)
  process.exitCode = scenario.exitCode ?? 0
}
`

async function makeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-plugin-kit-fallow-policy-"))
  temporaryRoots.push(root)
  return root
}

async function observe(command: readonly string[], options: { cwd: string; env?: Record<string, string> }): Promise<{
  exitCode: number
  stdout: string
  stderr: string
}> {
  const child = Bun.spawn([...command], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env, FORCE_COLOR: "0" },
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

async function runScenario(
  scenario: Scenario,
  options: {
    argv?: readonly string[]
    executable?: "file" | "missing" | "directory"
    version?: string
    transformPolicy?: (source: string) => string
  } = {},
): Promise<ProcessObservation> {
  const root = await makeTemporaryRoot()
  const policyDirectory = join(root, "tooling/repository-quality")
  const executableDirectory = join(root, "node_modules/.bin")
  await mkdir(policyDirectory, { recursive: true })
  await mkdir(executableDirectory, { recursive: true })
  const policySource = await readFile(policySourcePath, "utf8")
  const policyPath = join(policyDirectory, "fallow-policy.ts")
  await writeFile(policyPath, options.transformPolicy?.(policySource) ?? policySource)

  const executable = options.executable ?? "file"
  const executablePath = join(executableDirectory, "fallow")
  if (executable === "file") {
    await writeFile(executablePath, fakeFallowSource)
    await chmod(executablePath, 0o755)
  } else if (executable === "directory") {
    await mkdir(executablePath)
  }

  const result = await observe(
    ["bun", "run", "--silent", policyPath, ...(options.argv ?? ["--changed-since", "HEAD"])],
    {
      cwd: root,
      env: {
        FAKE_FALLOW_SCENARIO: JSON.stringify(scenario),
        FAKE_FALLOW_VERSION: options.version ?? "3.19.0",
      },
    },
  )
  const outputLines = result.stdout.trim().split("\n")
  expect(outputLines).toHaveLength(1)
  return { ...result, envelope: JSON.parse(outputLines[0] ?? "null") as JsonRecord }
}

function expectReason(
  observation: ProcessObservation,
  reasonCode: ExpectedReasonCode,
  decision: string,
  exitCode: number,
): void {
  expect(observation.exitCode).toBe(exitCode)
  expect(observation.stderr).toBe("")
  expect(observation.envelope.reason_code).toBe(reasonCode)
  expect(observation.envelope.decision).toBe(decision)
  expect(observation.envelope.repair_hint).toBe(
    reasonCode === "policy-accepted" ? null : expectedRepairHints[reasonCode],
  )
  expect(Object.keys(observation.envelope)).toEqual([
    "kind",
    "schema_version",
    "command",
    "decision",
    "reason_code",
    "base_ref",
    "fallow_version",
    "native_exit",
    "native_stderr",
    "repair_hint",
    "fallow",
  ])
}

afterAll(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })))
})

test("accepts a clean pass", async () => {
  const native = successDocument("pass")
  const result = await runScenario({ exitCode: 0, stdout: native })
  expectReason(result, "policy-accepted", "accepted", 0)
  expect(result.envelope.repair_hint).toBeNull()
  expect(result.envelope.fallow).toEqual(native)

  const emptyDelta = emptyDeltaDocument()
  const emptyResult = await runScenario({ exitCode: 0, stdout: emptyDelta })
  expectReason(emptyResult, "policy-accepted", "accepted", 0)
  expect(emptyResult.envelope.fallow).toEqual(emptyDelta)

  const falseEmptyDelta = cloneDocument(emptyDelta)
  falseEmptyDelta.changed_files_count = 1
  const falseEmptyResult = await runScenario({ exitCode: 0, stdout: falseEmptyDelta })
  expectReason(falseEmptyResult, "native-output-schema-mismatch", "error", 2)
})

test("accepts a warning verdict with zero introduced findings", async () => {
  const result = await runScenario({ exitCode: 0, stdout: successDocument("warn") })
  expectReason(result, "policy-accepted", "accepted", 0)
})

test("refuses a fail verdict with zero introduced findings", async () => {
  const result = await runScenario({ exitCode: 1, stdout: successDocument("fail") })
  expectReason(result, "native-fail-verdict", "refused", 1)
})

test("refuses introduced warnings even when native exit is zero", async () => {
  const native = setAttribution(successDocument("warn"), "dead_code_introduced", 1)
  const result = await runScenario({ exitCode: 0, stdout: native })
  expectReason(result, "introduced-findings", "refused", 1)
})

test("keeps inherited warnings visible without refusing", async () => {
  const native = setAttribution(successDocument("warn"), "complexity_inherited", 7)
  const result = await runScenario({ exitCode: 0, stdout: native })
  expectReason(result, "policy-accepted", "accepted", 0)
  expect(((result.envelope.fallow as JsonRecord).attribution as JsonRecord).complexity_inherited).toBe(7)
})

test("refuses a missing comparison base before native execution", async () => {
  const result = await runScenario({ exitCode: 0, stdout: successDocument() }, { argv: [] })
  expectReason(result, "comparison-base-required", "error", 2)
  expect(result.envelope.native_exit).toBeNull()
  expect(result.envelope.fallow).toBeNull()
})

test("refuses a missing repository-local executable without PATH fallback", async () => {
  const result = await runScenario({ exitCode: 0, stdout: successDocument() }, { executable: "missing" })
  expectReason(result, "local-fallow-missing", "error", 2)
  expect(result.envelope.fallow_version).toBeNull()
})

test("refuses a repository-local Fallow version mismatch", async () => {
  const result = await runScenario({ exitCode: 0, stdout: successDocument() }, { version: "2.88.2" })
  expectReason(result, "fallow-version-mismatch", "error", 2)
  expect(result.envelope.fallow_version).toBe("2.88.2")
})

test("classifies an invalid comparison base before generic exit two", async () => {
  const native = {
    error: true,
    message: "could not determine changed files for base ref 'missing'. Verify the ref exists",
    exit_code: 2,
  }
  const result = await runScenario({ exitCode: 2, stdout: native, stderr: "--changed-since failed for ref 'missing'" })
  expectReason(result, "comparison-base-unavailable", "error", 2)
  expect(result.envelope.fallow).toEqual(native)
})

test("rejects malformed native JSON", async () => {
  const result = await runScenario({ exitCode: 2, stdout: "{not-json", stderr: "parse failed" })
  expectReason(result, "native-output-not-json", "error", 2)
  expect(result.envelope.fallow).toBeNull()
})

test("classifies every documented operational native exit and preserves evidence", async () => {
  for (const exitCode of [2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13]) {
    const native = { error: true, message: `operational failure ${exitCode}`, exit_code: exitCode }
    const result = await runScenario({ exitCode, stdout: native })
    expectReason(result, "native-operational-error", "error", 2)
    expect(result.envelope.native_exit).toBe(exitCode)
    expect(result.envelope.fallow).toEqual(native)
  }
  const stderrOnly = await runScenario({ exitCode: 3, stderr: "resource limit reached" })
  expectReason(stderrOnly, "native-operational-error", "error", 2)
  expect(stderrOnly.envelope.fallow).toBeNull()
  const mismatch = await runScenario({ exitCode: 3, stdout: { error: true, message: "network", exit_code: 4 } })
  expectReason(mismatch, "native-exit-mismatch", "error", 2)
  const undocumented = await runScenario({ exitCode: 9, stdout: { error: true, message: "unknown", exit_code: 9 } })
  expectReason(undocumented, "native-exit-undocumented", "error", 2)
}, 20_000)

test("rejects every pinned success and error envelope shape mismatch", async () => {
  const cases: JsonRecord[] = []
  for (const [key, value] of [
    ["kind", "review"],
    ["schema_version", 9],
    ["version", "3.18.0"],
    ["command", "check"],
  ] as const) {
    const native = successDocument()
    native[key] = value
    cases.push(native)
  }
  cases.push(setTypeAware(successDocument(), "protocol_version", 6))
  cases.push(setTypeAware(successDocument(), "sidecar_version", "3.18.0"))
  cases.push(setTypeAware(successDocument(), "backend", "typescript"))
  cases.push(setTypeAware(successDocument(), "backend_version", "7.0.1"))
  cases.push(setTypeAwareIdentity(successDocument(), "backend_family", "typescript"))
  cases.push(setAttribution(successDocument(), "dead_code_introduced", -1))
  cases.push({ error: true, message: "not an operational error", exit_code: 0 })
  cases.push({ error: true, message: "not an operational error", exit_code: 1 })
  for (const native of cases) {
    const nativeExit = typeof native.exit_code === "number" ? native.exit_code : 0
    const result = await runScenario({ exitCode: nativeExit, stdout: native })
    expectReason(result, "native-output-schema-mismatch", "error", 2)
  }
}, 20_000)

test("rejects pass and warn verdicts paired with a non-zero native exit", async () => {
  for (const verdict of ["pass", "warn"] as const) {
    const result = await runScenario({ exitCode: 1, stdout: successDocument(verdict) })
    expectReason(result, "native-exit-mismatch", "error", 2)
  }
})

test("rejects a fail verdict paired with a native exit other than one", async () => {
  const result = await runScenario({ exitCode: 0, stdout: successDocument("fail") })
  expectReason(result, "native-exit-mismatch", "error", 2)
})

test("rejects explicitly incomplete type-aware evidence", async () => {
  const native = setTypeAwareIdentity(successDocument(), "completeness", "partial")
  const result = await runScenario({ exitCode: 0, stdout: native })
  expectReason(result, "type-aware-incomplete", "error", 2)
})

test("includes an untracked TypeScript source in the real new-only audit", async () => {
  const root = await makeTemporaryRoot()
  await mkdir(join(root, "tooling/repository-quality"), { recursive: true })
  await mkdir(join(root, "src"), { recursive: true })
  await symlink(join(kitRoot, "node_modules"), join(root, "node_modules"))
  await writeFile(join(root, ".gitignore"), "node_modules/\n/.fallow/\n")
  await writeFile(join(root, ".fallowrc.json"), await readFile(join(kitRoot, ".fallowrc.json"), "utf8"))
  await writeFile(join(root, "tooling/repository-quality/fallow-policy.ts"), await readFile(policySourcePath, "utf8"))
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "fallow-untracked-proof",
      private: true,
      type: "module",
      scripts: { "quality:fallow": "bun run tooling/repository-quality/fallow-policy.ts" },
      exports: { ".": "./src/index.ts" },
      devDependencies: { fallow: "3.19.0", typescript: "7.0.2" },
    }),
  )
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }))
  await writeFile(join(root, "src/index.ts"), "export const admitted = true\n")
  await observe(["git", "init", "-q"], { cwd: root })
  await observe(["git", "config", "user.name", "Fallow Contract Test"], { cwd: root })
  await observe(["git", "config", "user.email", "fallow-contract@example.invalid"], { cwd: root })
  await observe(["git", "add", "."], { cwd: root })
  await observe(["git", "commit", "-qm", "fixture baseline"], { cwd: root })
  await writeFile(join(root, "src/untracked.ts"), "type Hidden = string\nexport const reveal = (value: Hidden): Hidden => value\n")
  const result = await observe(
    ["bun", "run", "--silent", join(root, "tooling/repository-quality/fallow-policy.ts"), "--changed-since", "HEAD"],
    { cwd: root },
  )
  expect(result.stderr).toBe("")
  expect(result.exitCode).toBe(1)
  const envelope = JSON.parse(result.stdout) as JsonRecord
  expect(envelope.reason_code).toBe("introduced-findings")
  const fallow = envelope.fallow as JsonRecord
  const attribution = fallow.attribution as JsonRecord
  expect(Object.entries(attribution).some(([key, value]) => key.endsWith("_introduced") && Number(value) > 0)).toBe(true)
})

test("keeps handled process output pure, bounded, redacted, and repairable", async () => {
  const policySource = await readFile(policySourcePath, "utf8")
  const reasonCodeDeclaration = policySource.match(/type ReasonCode =([\s\S]*?)\n\ntype JsonRecord/)?.[1] ?? ""
  const declaredReasonCodes = [...reasonCodeDeclaration.matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort()
  expect(declaredReasonCodes).toEqual([...expectedReasonCodes].sort())
  expect(Object.keys(expectedRepairHints).sort()).toEqual(
    expectedReasonCodes.filter((reasonCode) => reasonCode !== "policy-accepted").sort(),
  )
  for (const repairHint of Object.values(expectedRepairHints)) {
    expect(repairHint).not.toMatch(/\b(?:bun|npm|git|fallow)\s/)
    expect(repairHint).not.toMatch(/\/(?:[^/\r\n]+\/)+[^/\r\n]+/)
    expect(repairHint).not.toMatch(/\b[A-Za-z]:\\/)
  }

  const launchFailure = await runScenario(
    { exitCode: 0, stdout: successDocument() },
    { executable: "directory" },
  )
  expectReason(launchFailure, "native-launch-failed", "error", 2)
  const missingOutput = await runScenario({ exitCode: 0 })
  expectReason(missingOutput, "native-output-missing", "error", 2)

  const hostile = [
    `\u001b[31mfailed\u001b[0m at /custom/root/private/file token=super-secret ${"x".repeat(2_000)}`,
    "comma,/srv/shared/config.ts:7:4",
    "bracket[/Library/Application Support/Fallow/config.json:2:1]",
    "file URL file:///Users/example/My Folder/fallow.ts:5:6",
    "    at run (/usr/local/lib/runner.ts:42:1)",
    "    at async /Library/Application Support/Fallow/worker.js:8:2",
    "0: 0x0123 - /opt/fallow/bin/fallow",
    "Windows source [C:\\Program Files\\Fallow\\runner.ts:9:3]",
    "UNC source \\\\server\\shared folder\\runner.ts:4:2",
  ].join("\n")
  const result = await runScenario({
    exitCode: 3,
    stdout: { error: true, message: "resource failure", exit_code: 3 },
    stderr: hostile,
  })
  expectReason(result, "native-operational-error", "error", 2)
  const diagnostic = String(result.envelope.native_stderr)
  expect(diagnostic.length).toBeLessThanOrEqual(1_000)
  expect(diagnostic).not.toContain("\u001b")
  expect(diagnostic).not.toContain("/")
  expect(diagnostic).not.toMatch(/(?:\b[A-Za-z]:\\|\\\\)/)
  expect(diagnostic).not.toMatch(/(?:^|\n)\s*(?:at\s|stack backtrace:|\d+:\s+0x)/i)
  expect(diagnostic).not.toContain("super-secret")
  expect(String(result.envelope.repair_hint)).not.toMatch(/\b(?:bun|npm|git|fallow)\s/)
})

test("reduces an unexpected adapter exception to internal-error", async () => {
  const result = await runScenario(
    { exitCode: 0, stdout: successDocument() },
    {
      transformPolicy: (source) =>
        source.replace("const baseRef = parseBaseRef(argv)", 'throw new Error("test-owned internal failure probe")'),
    },
  )
  expectReason(result, "internal-error", "error", 2)
  expect(result.envelope.base_ref).toBeNull()
  expect(result.stdout).not.toContain("test-owned internal failure probe")
})
