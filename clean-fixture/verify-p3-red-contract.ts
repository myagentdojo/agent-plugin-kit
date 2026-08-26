import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

type ExpectedResult = {
  readonly label: string
  readonly command: readonly string[]
  readonly tests: number
  readonly selectedFiles: readonly string[]
  readonly packageDirectory?: string
}

type PackageMetadata = {
  readonly exports?: Record<string, string>
  readonly scripts?: Record<string, string>
}

const repositoryRoot = resolve(import.meta.dir, "..")
const testEnvironment: Record<string, string | undefined> = { ...process.env, NO_COLOR: "1" }
delete testEnvironment.FORCE_COLOR
const packageMetadata = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
) as PackageMetadata

// Independent oracle: keep these accepted selector literals separate from the package scripts under test.
const kitInterfaceFiles = [
  "clean-fixture/personal-verification-profile/contract-tests/package-export-catalog.test.ts",
] as const
const admissionFiles = [
  "src/admission-bootstrap/contract-tests/admitted-identity-before-execution.test.ts",
  "src/admission-bootstrap/contract-tests/identity-refusal.test.ts",
] as const
const maintenanceFiles = [
  "src/modules/maintenance-command-contract/contract-tests/effect-class-and-retry-safety.test.ts",
  "src/modules/maintenance-command-contract/contract-tests/human-and-agent-result-vocabulary.test.ts",
] as const
const qualificationFiles = [
  "src/modules/qualification-evidence/contract-tests/candidate-lineage-reduction.test.ts",
  "src/modules/qualification-evidence/contract-tests/proof-layer-and-non-claim.test.ts",
] as const
const cleanFixtureFiles = [
  ...kitInterfaceFiles,
  "clean-fixture/personal-verification-profile/contract-tests/admission-and-invocation.test.ts",
  "clean-fixture/personal-verification-profile/contract-tests/installation-evidence.test.ts",
  "clean-fixture/personal-verification-profile/contract-tests/fresh-native-non-claims.test.ts",
  "clean-fixture/public-verification-profile/contract-tests/profile-non-promotion.test.ts",
] as const
const aggregateFiles = [
  ...new Set([
    ...kitInterfaceFiles,
    ...admissionFiles,
    ...maintenanceFiles,
    ...qualificationFiles,
    ...cleanFixtureFiles,
  ]),
] as const

const focusedResults: readonly ExpectedResult[] = [
  {
    label: "Kit Interface",
    command: ["bun", "run", "test:p3:kit-interface"],
    tests: 3,
    selectedFiles: kitInterfaceFiles,
  },
  {
    label: "Admission Bootstrap",
    command: ["bun", "run", "test:p3:admission-bootstrap"],
    tests: 8,
    selectedFiles: admissionFiles,
  },
  {
    label: "Maintenance Command Contract",
    command: ["bun", "run", "test:p3:maintenance-command-contract"],
    tests: 16,
    selectedFiles: maintenanceFiles,
  },
  {
    label: "Qualification Evidence",
    command: ["bun", "run", "test:p3:qualification-evidence"],
    tests: 14,
    selectedFiles: qualificationFiles,
  },
  {
    label: "Clean Fixture",
    command: ["bun", "run", "test:p3:clean-fixture"],
    tests: 13,
    selectedFiles: cleanFixtureFiles,
  },
]

const workspaceResults: readonly ExpectedResult[] = [
  {
    label: "Admission Bootstrap workspace",
    command: ["bun", "run", "--filter", "@agent-plugin-kit/admission-bootstrap", "test"],
    tests: 8,
    selectedFiles: admissionFiles.map((file) => file.replace("src/admission-bootstrap/", "")),
    packageDirectory: "src/admission-bootstrap",
  },
  {
    label: "Maintenance Command Contract workspace",
    command: [
      "bun",
      "run",
      "--filter",
      "@agent-plugin-kit/maintenance-command-contract",
      "test",
    ],
    tests: 16,
    selectedFiles: maintenanceFiles.map((file) =>
      file.replace("src/modules/maintenance-command-contract/", ""),
    ),
    packageDirectory: "src/modules/maintenance-command-contract",
  },
  {
    label: "Qualification Evidence workspace",
    command: ["bun", "run", "--filter", "@agent-plugin-kit/qualification-evidence", "test"],
    tests: 14,
    selectedFiles: qualificationFiles.map((file) =>
      file.replace("src/modules/qualification-evidence/", ""),
    ),
    packageDirectory: "src/modules/qualification-evidence",
  },
]

const aggregateResult: ExpectedResult = {
  label: "P3 aggregate",
  command: ["bun", "run", "test:p3"],
  tests: 51,
  selectedFiles: aggregateFiles,
}

const requiredAgentCommands = [
  "bun run check",
  "bun run verify:p3:red",
  "bun run test:p3",
  ...focusedResults.map(({ command }) => command.join(" ")),
  ...workspaceResults.map(({ command }) => command.join(" ")),
]

const forbiddenP3Paths = [
  ".github/workflows",
  "src/admission-bootstrap/implementation",
  "src/admission-bootstrap/adapters",
  "src/modules/plugin-payload-production/implementation",
  "src/modules/runtime-custody/implementation",
  "src/modules/release-and-git-engine/implementation",
  "src/modules/maintenance-command-contract/implementation",
  "src/modules/harness-journeys/implementation",
  "src/modules/canary-qualification/implementation",
  "src/modules/qualification-evidence/implementation",
  "src/adapters/reusable-workflow-adapter/implementation",
  "src/modules/plugin-payload-production/contract-tests",
  "src/modules/runtime-custody/contract-tests",
  "src/modules/release-and-git-engine/contract-tests",
  "src/modules/harness-journeys/contract-tests",
  "src/modules/canary-qualification/contract-tests",
  "src/adapters/reusable-workflow-adapter/contract-tests",
  "clean-fixture/public-verification-profile/contract-tests/hosted-canary-qualification.test.ts",
  "clean-fixture/public-verification-profile/contract-tests/hosted-distribution-evidence.test.ts",
  "clean-fixture/public-verification-profile/contract-tests/hosted-installation-evidence.test.ts",
  "clean-fixture/public-verification-profile/contract-tests/hosted-release-identity.test.ts",
  "clean-fixture/public-verification-profile/contract-tests/hosted-runtime-platform-evidence.test.ts",
  "clean-fixture/public-verification-profile/contract-tests/hosted-workflow-identity.test.ts",
]

function fail(message: string): never {
  throw new Error(message)
}

function stripAnsi(text: string): string {
  const ansiEscape = String.fromCharCode(27)
  return text.replaceAll(new RegExp(`${ansiEscape}\\[[0-?]*[ -/]*[@-~]`, "g"), "")
}

function readAttribute(xml: string, name: string): number {
  const value = xml.match(new RegExp(`<testsuites\\b[^>]*\\b${name}="(\\d+)"`))?.[1]
  if (value === undefined) fail(`JUnit receipt is missing integer ${name}`)
  return Number(value)
}

function walkPaths(directory: string): string[] {
  return readdirSync(join(repositoryRoot, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`
    return entry.isDirectory() ? [relative, ...walkPaths(relative)] : [relative]
  })
}

function selectedTestFiles(result: ExpectedResult): string[] {
  const scriptName = result.packageDirectory === undefined ? result.command.at(-1) : "test"
  if (scriptName === undefined) fail(`${result.label} command has no script name`)
  const metadata = result.packageDirectory === undefined
    ? packageMetadata
    : JSON.parse(
        readFileSync(join(repositoryRoot, result.packageDirectory, "package.json"), "utf8"),
      ) as PackageMetadata
  const script = metadata.scripts?.[scriptName]
  if (script === undefined) {
    fail(`${result.packageDirectory ?? "root package.json"} is missing script ${scriptName}`)
  }
  const words = script.trim().split(/\s+/)
  if (words[0] !== "bun" || words[1] !== "test") {
    fail(`${scriptName} must remain a direct bun test selector`)
  }
  const files = words.slice(2)
  if (files.length === 0 || files.some((file) => file.startsWith("-") || !file.endsWith(".test.ts"))) {
    fail(`${scriptName} must select explicit Contract Test files only`)
  }
  return files
}

function verifyStaticContract(): void {
  for (const result of [...focusedResults, ...workspaceResults, aggregateResult]) {
    const actualFiles = selectedTestFiles(result)
    if (JSON.stringify(actualFiles) !== JSON.stringify(result.selectedFiles)) {
      fail(`${result.label} must select its exact accepted Contract Test files in order`)
    }
  }

  const selectedAggregateFiles = [...aggregateResult.selectedFiles].sort()
  const sourcePaths = walkPaths("src")
  const discoveredFiles = [...sourcePaths, ...walkPaths("clean-fixture")]
    .filter((file) => file.endsWith(".test.ts"))
    .sort()
  if (JSON.stringify(discoveredFiles) !== JSON.stringify(selectedAggregateFiles)) {
    fail("test:p3 must select the complete exact P3 Contract Test file set")
  }

  for (const file of discoveredFiles) {
    const source = readFileSync(join(repositoryRoot, file), "utf8")
    if (/\b(?:test|it|describe)\.(?:skip|todo|only)\b/.test(source)) {
      fail(`disabled or narrowed Contract Test ${file}`)
    }
  }

  for (const relative of forbiddenP3Paths) {
    if (existsSync(join(repositoryRoot, relative))) fail(`forbidden in P3 RED ${relative}`)
  }
  const unexpectedImplementation = sourcePaths.find((relative) =>
    relative.split("/").includes("implementation"),
  )
  if (unexpectedImplementation !== undefined) {
    fail(`Implementation paths remain absent in P3 RED: ${unexpectedImplementation}`)
  }

  const agentGuidance = readFileSync(join(repositoryRoot, "AGENTS.md"), "utf8")
  const agentCodeSpans = [...agentGuidance.matchAll(/`([^`\n]+)`/g)].map((match) => match[1])
  for (const command of requiredAgentCommands) {
    if (!agentCodeSpans.includes(command)) fail(`AGENTS.md is missing exact command ${command}`)
  }

  if (Object.keys(packageMetadata.exports ?? {}).length !== 10) {
    fail("root Package Identity must retain exactly 10 exports")
  }

  const workspaceManifests = sourcePaths.filter((file) => file.endsWith("/package.json"))
  if (workspaceManifests.length !== 9) {
    fail(`expected exactly 9 workspace manifests, found ${workspaceManifests.length}`)
  }
  for (const file of workspaceManifests) {
    const workspacePackage = JSON.parse(readFileSync(join(repositoryRoot, file), "utf8")) as {
      private?: boolean
    }
    if (workspacePackage.private !== true) fail(`workspace package must remain private: ${file}`)
  }
}

function verifyIntentionalRed(result: ExpectedResult, receiptDirectory: string): void {
  const receipt = join(receiptDirectory, `${result.label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.xml`)
  const processResult = Bun.spawnSync({
    cmd: [...result.command, "--reporter=junit", "--reporter-outfile", receipt],
    cwd: repositoryRoot,
    env: testEnvironment,
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = stripAnsi(
    `${processResult.stdout.toString()}\n${processResult.stderr.toString()}`,
  )

  if (processResult.exitCode !== 1) {
    fail(`${result.label} must exit 1 as intentional RED, observed ${processResult.exitCode}`)
  }
  if (!existsSync(receipt) || !statSync(receipt).isFile()) {
    fail(`${result.label} did not produce a JUnit receipt`)
  }

  const xml = readFileSync(receipt, "utf8")
  const tests = readAttribute(xml, "tests")
  const failures = readAttribute(xml, "failures")
  const skipped = readAttribute(xml, "skipped")
  const files = xml.match(/<testsuite\s/g)?.length ?? 0
  const passes = tests - failures - skipped

  if (tests !== result.tests || files !== result.selectedFiles.length) {
    fail(
      `${result.label} expected ${result.tests} tests/${result.selectedFiles.length} files, observed ${tests}/${files}`,
    )
  }
  if (passes !== 0 || failures !== result.tests || skipped !== 0) {
    fail(`${result.label} expected 0 pass/${result.tests} fail/0 skip, observed ${passes}/${failures}/${skipped}`)
  }

  const errorMessages = output
    .split("\n")
    .map((line) => line.match(/^(?:@\S+ test: )?error:\s*(.+)$/)?.[1])
    .filter((message): message is string => message !== undefined)
  const contractAbsent = errorMessages.filter((message) => message.startsWith("contract-absent:"))
  const otherFailures = errorMessages.filter(
    (message) =>
      !message.startsWith("contract-absent:") &&
      !/^script ".+" exited with code 1$/.test(message),
  )
  if (contractAbsent.length !== result.tests || otherFailures.length !== 0) {
    fail(
      `${result.label} expected ${result.tests} contract-absent failures only, observed ${contractAbsent.length} contract-absent and ${otherFailures.length} other`,
    )
  }

  console.log(
    `verified ${result.label}: 0 pass, ${failures} contract-absent fail, ${files} ${files === 1 ? "file" : "files"}`,
  )
}

const receiptDirectory = mkdtempSync(join(tmpdir(), "agent-plugin-kit-p3-red-"))
try {
  verifyStaticContract()
  for (const result of [...focusedResults, ...workspaceResults, aggregateResult]) {
    verifyIntentionalRed(result, receiptDirectory)
  }
  console.log("P3 intentional RED contract verified")
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`P3 RED verification failed: ${message}`)
  process.exitCode = 1
} finally {
  rmSync(receiptDirectory, { recursive: true, force: true })
}
