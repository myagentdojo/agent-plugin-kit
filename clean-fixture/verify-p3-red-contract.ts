import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, extname, join, relative, resolve } from "node:path"
import ts from "typescript"

type TestGroup = {
  readonly count: number
  readonly files: readonly string[]
}

type P3RedContract = {
  readonly schemaVersion: number
  readonly bun: { readonly configFile: string; readonly installAuto: string }
  readonly structure: {
    readonly requiredPaths: readonly string[]
    readonly requiredAgentPointers: readonly string[]
  }
  readonly tests: {
    readonly kitInterface: TestGroup
    readonly admissionBootstrap: TestGroup
    readonly maintenanceCommandContract: TestGroup
    readonly qualificationEvidence: TestGroup
    readonly cleanFixture: TestGroup
    readonly maintenanceCliUnit: TestGroup
    readonly maintenanceCliCatalog: TestGroup
    readonly maintenanceCliProcess: TestGroup
    readonly maintenanceCliObservability: TestGroup
    readonly maintenanceCliCleanFixture: TestGroup
    readonly maintenanceCliLocalLink: TestGroup
    readonly maintenanceCli: TestGroup & { readonly fileCount: number }
    readonly aggregate: { readonly count: number; readonly fileCount: number }
  }
  readonly audit: {
    readonly maintenanceCli: { readonly command: string; readonly redExit: number; readonly redVerdict: string; readonly greenExit: number; readonly greenVerdict: string; readonly proofSchemaVersion: number }
  }
  readonly qualification: {
    readonly maintenanceCliLocalLink: { readonly command: string; readonly redExit: number; readonly redSentinel: string; readonly greenExit: number; readonly proofSchemaVersion: number }
  }
  readonly admission: {
    readonly proofLayer: string
    readonly sentinelFile: string
    readonly sentinelName: string
    readonly sentinelCount: number
    readonly sourceEntry: string
    readonly sourceClosure: readonly string[]
    readonly ownerManifest: string
    readonly consumerFixture: string
    readonly projectionFixture: string
    readonly projection: {
      readonly name: string
      readonly type: string
      readonly exports: Readonly<Record<string, string>>
    }
    readonly forbiddenSelfReports: readonly string[]
    readonly nonClaims: readonly string[]
    readonly firstP4GreenTransition: string
  }
}

type ExpectedResult = {
  readonly label: string
  readonly command: readonly string[]
  readonly tests: number
  readonly selectedFiles: readonly string[]
  readonly packageDirectory?: string
}

type PackageMetadata = {
  readonly name?: string
  readonly type?: string
  readonly catalog?: unknown
  readonly catalogs?: unknown
  readonly dependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
  readonly exports?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly private?: boolean
  readonly scripts?: Record<string, string>
}

const repositoryRoot = resolve(import.meta.dir, "..")
const testEnvironment: Record<string, string | undefined> = { ...process.env, NO_COLOR: "1" }
delete testEnvironment.FORCE_COLOR

function fail(message: string): never {
  throw new Error(message)
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function readContract(root: string): P3RedContract {
  const contract = readJson<P3RedContract>(join(root, "clean-fixture/p3-red-contract.json"))
  if (contract.schemaVersion !== 1) fail("P3 RED contract schemaVersion must remain 1")
  if (contract.admission.proofLayer !== "public-process") {
    fail("Admission sentinel Proof Layer must remain public-process")
  }
  if (contract.admission.sentinelCount !== 1) {
    fail("P3 RED must retain exactly one Admission dependency-freedom sentinel")
  }
  if (
    typeof contract.admission.firstP4GreenTransition !== "string" ||
    !contract.admission.firstP4GreenTransition.includes("first P4 GREEN") ||
    !contract.admission.firstP4GreenTransition.includes("same reviewed checkpoint")
  ) {
    fail("P3 RED contract must retain the first P4 GREEN transition rule")
  }
  if (
    JSON.stringify(contract.admission.nonClaims) !==
    JSON.stringify([
      "installed dependency freedom",
      "distribution",
      "linker semantics",
      "direct observation of network inactivity",
    ])
  ) {
    fail("Admission P3 Non-Claims must remain exact")
  }
  return contract
}

function expectedResults(contract: P3RedContract): {
  readonly focused: readonly ExpectedResult[]
  readonly workspace: readonly ExpectedResult[]
  readonly aggregate: ExpectedResult
} {
  const { tests } = contract
  const aggregateFiles = [
    ...new Set([
      ...tests.kitInterface.files,
      ...tests.admissionBootstrap.files,
      ...tests.maintenanceCommandContract.files,
      ...tests.qualificationEvidence.files,
      ...tests.cleanFixture.files,
      ...tests.maintenanceCli.files,
    ]),
  ]
  return {
    focused: [
      {
        label: "Kit Interface",
        command: ["bun", "run", "test:p3:kit-interface"],
        tests: tests.kitInterface.count,
        selectedFiles: tests.kitInterface.files,
      },
      {
        label: "Admission Bootstrap",
        command: ["bun", "run", "test:p3:admission-bootstrap"],
        tests: tests.admissionBootstrap.count,
        selectedFiles: tests.admissionBootstrap.files,
      },
      {
        label: "Maintenance Command Contract",
        command: ["bun", "run", "test:p3:maintenance-command-contract"],
        tests: tests.maintenanceCommandContract.count,
        selectedFiles: tests.maintenanceCommandContract.files,
      },
      {
        label: "Qualification Evidence",
        command: ["bun", "run", "test:p3:qualification-evidence"],
        tests: tests.qualificationEvidence.count,
        selectedFiles: tests.qualificationEvidence.files,
      },
      {
        label: "Clean Fixture",
        command: ["bun", "run", "test:p3:clean-fixture"],
        tests: tests.cleanFixture.count,
        selectedFiles: tests.cleanFixture.files,
      },
      { label: "Maintenance CLI unit", command: ["bun", "run", "test:p3:maintenance-cli:unit"], tests: tests.maintenanceCliUnit.count, selectedFiles: tests.maintenanceCliUnit.files },
      { label: "Maintenance CLI catalog", command: ["bun", "run", "test:p3:maintenance-cli:catalog"], tests: tests.maintenanceCliCatalog.count, selectedFiles: tests.maintenanceCliCatalog.files },
      { label: "Maintenance CLI process", command: ["bun", "run", "test:p3:maintenance-cli:process"], tests: tests.maintenanceCliProcess.count, selectedFiles: tests.maintenanceCliProcess.files },
      { label: "Maintenance CLI observability", command: ["bun", "run", "test:p3:maintenance-cli:observability"], tests: tests.maintenanceCliObservability.count, selectedFiles: tests.maintenanceCliObservability.files },
      { label: "Maintenance CLI Clean Fixture", command: ["bun", "run", "test:p3:maintenance-cli:clean-fixture"], tests: tests.maintenanceCliCleanFixture.count, selectedFiles: tests.maintenanceCliCleanFixture.files },
      { label: "Maintenance CLI local link", command: ["bun", "run", "test:p3:maintenance-cli:local-link"], tests: tests.maintenanceCliLocalLink.count, selectedFiles: tests.maintenanceCliLocalLink.files },
      { label: "Maintenance CLI", command: ["bun", "run", "test:p3:maintenance-cli"], tests: tests.maintenanceCli.count, selectedFiles: tests.maintenanceCli.files },
    ],
    workspace: [
      {
        label: "Admission Bootstrap workspace",
        command: ["bun", "run", "--filter", "@agent-plugin-kit/admission-bootstrap", "test"],
        tests: tests.admissionBootstrap.count,
        selectedFiles: tests.admissionBootstrap.files.map((file) =>
          file.replace("src/admission-bootstrap/", ""),
        ),
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
        tests: tests.maintenanceCommandContract.count,
        selectedFiles: tests.maintenanceCommandContract.files.map((file) =>
          file.replace("src/modules/maintenance-command-contract/", ""),
        ),
        packageDirectory: "src/modules/maintenance-command-contract",
      },
      {
        label: "Qualification Evidence workspace",
        command: ["bun", "run", "--filter", "@agent-plugin-kit/qualification-evidence", "test"],
        tests: tests.qualificationEvidence.count,
        selectedFiles: tests.qualificationEvidence.files.map((file) =>
          file.replace("src/modules/qualification-evidence/", ""),
        ),
        packageDirectory: "src/modules/qualification-evidence",
      },
      {
        label: "Maintenance Command Facade workspace",
        command: ["bun", "run", "--filter", "@agent-plugin-kit/maintenance-command-facade", "test"],
        tests: 32,
        selectedFiles: [
          "contract-tests/command-surface.test.ts",
          "contract-tests/public-process.test.ts",
          "contract-tests/observability.test.ts",
        ],
        packageDirectory: "src/adapters/maintenance-command-facade",
      },
    ],
    aggregate: {
      label: "P3 aggregate",
      command: ["bun", "run", "test:p3"],
      tests: tests.aggregate.count,
      selectedFiles: aggregateFiles,
    },
  }
}

function walkPaths(root: string, directory: string): string[] {
  const absolute = join(root, directory)
  if (!existsSync(absolute)) return []
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = `${directory}/${entry.name}`
    return entry.isDirectory() ? [child, ...walkPaths(root, child)] : [child]
  })
}

function walkRepositoryPaths(root: string, directory = ""): string[] {
  const absolute = join(root, directory)
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git" || entry.name === "node_modules") return []
    const child = directory === "" ? entry.name : `${directory}/${entry.name}`
    return entry.isDirectory() ? [child, ...walkRepositoryPaths(root, child)] : [child]
  })
}

function selectedTestFiles(root: string, result: ExpectedResult): string[] {
  const scriptName = result.packageDirectory === undefined ? result.command.at(-1) : "test"
  if (scriptName === undefined) fail(`${result.label} command has no script name`)
  const metadata = readJson<PackageMetadata>(
    join(root, result.packageDirectory ?? "", "package.json"),
  )
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

function moduleSpecifiers(file: string, source: string): string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const specifiers: string[] = []
  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const dynamicImportArgument = node.arguments[0]
      if (dynamicImportArgument === undefined || !ts.isStringLiteral(dynamicImportArgument)) {
        fail(`${file} contains a dynamic import with a nonliteral target`)
      }
      specifiers.push(dynamicImportArgument.text)
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      const requireArgument = node.arguments[0]
      if (
        node.arguments.length !== 1 ||
        requireArgument === undefined ||
        !ts.isStringLiteral(requireArgument)
      ) {
        fail(`${file} contains require() with a nonliteral target`)
      }
      specifiers.push(requireArgument.text)
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text)
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression !== undefined &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return specifiers
}

function resolveRelativeImport(root: string, importer: string, specifier: string): string {
  const unresolved = resolve(dirname(join(root, importer)), specifier)
  const candidates =
    extname(unresolved) === "" ? [`${unresolved}.ts`, join(unresolved, "index.ts")] : [unresolved]
  const resolved = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile())
  if (resolved === undefined) fail(`unresolved relative Admission source import ${importer} -> ${specifier}`)
  const sourceRelative = relative(root, resolved).replaceAll("\\", "/")
  if (sourceRelative.startsWith("../") || !sourceRelative.startsWith("src/")) {
    fail(`Admission source closure escaped Source Tree: ${sourceRelative}`)
  }
  return sourceRelative
}

function discoverAdmissionSourceClosure(root: string, entry: string): string[] {
  const pending = [entry]
  const discovered = new Set<string>()
  const sourceRoot = realpathSync(join(root, "src"))
  while (pending.length > 0) {
    const file = pending.pop()
    if (file === undefined || discovered.has(file)) continue
    if (!existsSync(join(root, file))) fail(`missing Admission source closure file ${file}`)
    const realSource = realpathSync(join(root, file))
    const realSourceRelative = relative(sourceRoot, realSource).replaceAll("\\", "/")
    if (realSourceRelative.startsWith("../") || realSourceRelative === "..") {
      fail(`Admission source closure realpath escaped Source Tree: ${file} -> ${realSource}`)
    }
    discovered.add(file)
    const source = readFileSync(join(root, file), "utf8")
    for (const specifier of moduleSpecifiers(file, source)) {
      if (specifier.startsWith("node:")) continue
      if (!specifier.startsWith(".")) {
        fail(`Admission source closure contains bare import ${file} -> ${specifier}`)
      }
      pending.push(resolveRelativeImport(root, file, specifier))
    }
  }
  return [...discovered].sort()
}

function verifyBunPolicy(root: string, contract: P3RedContract): void {
  const bunfig = readFileSync(join(root, contract.bun.configFile), "utf8")
  const expected = `[install]\nauto = "${contract.bun.installAuto}"\n`
  if (bunfig !== expected || contract.bun.installAuto !== "disable") {
    fail('bunfig.toml must contain exact [install] auto = "disable" policy')
  }
  if (/\blinker\b/.test(bunfig)) fail("linker semantics remain deliberately unpinned")
}

function verifyAdmissionContract(root: string, contract: P3RedContract): void {
  const admission = contract.admission
  const ownerManifest = readJson<PackageMetadata>(join(root, admission.ownerManifest))
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ] as const) {
    if (Object.keys(ownerManifest[field] ?? {}).length !== 0) {
      fail(`Admission Owner Manifest ${field} must remain empty`)
    }
  }

  const closure = discoverAdmissionSourceClosure(root, admission.sourceEntry)
  if (JSON.stringify(closure) !== JSON.stringify(admission.sourceClosure)) {
    fail(`Admission copied source closure drifted: ${JSON.stringify(closure)}`)
  }

  const productionSources = walkPaths(root, "src/admission-bootstrap")
    .filter((path) => path.endsWith(".ts") && !path.includes("/contract-tests/"))
    .sort()
  for (const file of productionSources) {
    const source = readFileSync(join(root, file), "utf8")
    for (const specifier of moduleSpecifiers(file, source)) {
      if (!specifier.startsWith(".") && !specifier.startsWith("node:")) {
        fail(`Admission source allows only relative imports and node: builtins: ${file} -> ${specifier}`)
      }
    }
  }

  const projection = readJson<unknown>(join(root, admission.projectionFixture))
  if (JSON.stringify(projection) !== JSON.stringify(admission.projection)) {
    fail("Admission Test Fixture projection name, type, or export surface drifted")
  }
  if (
    admission.projection.name !== "agent-plugin-kit" ||
    admission.projection.type !== "module" ||
    JSON.stringify(admission.projection.exports) !==
      JSON.stringify({ "./admission-bootstrap": "./src/admission-bootstrap/interface.ts" })
  ) {
    fail("Admission Test Fixture projection must retain the accepted public subpath")
  }

  const selfReportTargets = [
    "src/admission-bootstrap/contract-tests/adapters/admission-contract-harness.ts",
    "src/admission-bootstrap/contract-tests/admitted-identity-before-execution.test.ts",
    "clean-fixture/personal-verification-profile/contract-tests/adapters/contract-subjects.ts",
    admission.sentinelFile,
  ]
  for (const file of selfReportTargets) {
    const source = readFileSync(join(root, file), "utf8")
    for (const identifier of admission.forbiddenSelfReports) {
      if (source.includes(identifier)) fail(`Admission self-report ledger returned in ${file}: ${identifier}`)
    }
  }

  const sentinelSource = readFileSync(join(root, admission.sentinelFile), "utf8")
  const sentinelLiteral = `test(${JSON.stringify(admission.sentinelName)}`
  if (sentinelSource.split(sentinelLiteral).length - 1 !== admission.sentinelCount) {
    fail("Admission dependency-freedom sentinel count or name drifted")
  }
  const consumerSource = readFileSync(join(root, admission.consumerFixture), "utf8")
  const expectedConsumerSource =
    'await import("agent-plugin-kit/admission-bootstrap")\nconsole.log("admission-bootstrap:loaded")\n'
  if (
    consumerSource !== expectedConsumerSource ||
    JSON.stringify(moduleSpecifiers(admission.consumerFixture, consumerSource)) !==
      JSON.stringify(["agent-plugin-kit/admission-bootstrap"])
  ) {
    fail("Admission child must import only the accepted public package subpath")
  }
}

const forbiddenP3Paths = [
  "tests",
  "test-utils",
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
  "src/adapters/maintenance-command-facade/implementation",
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
] as const

function verifyP3StaticContract(root = repositoryRoot): void {
  const contract = readContract(root)
  const results = expectedResults(contract)
  const packageMetadata = readJson<PackageMetadata>(join(root, "package.json"))
  const facadeManifest = readJson<PackageMetadata>(join(root, "src/adapters/maintenance-command-facade/package.json"))
  const admissionManifest = readJson<PackageMetadata>(join(root, "src/admission-bootstrap/package.json"))

  verifyBunPolicy(root, contract)
  verifyAdmissionContract(root, contract)

  for (const path of contract.structure.requiredPaths) {
    if (!existsSync(join(root, path))) fail(`missing required P3 path ${path}`)
  }

  for (const result of [...results.focused, ...results.workspace, results.aggregate]) {
    const actualFiles = selectedTestFiles(root, result)
    if (JSON.stringify(actualFiles) !== JSON.stringify(result.selectedFiles)) {
      fail(`${result.label} must select its exact accepted Contract Test files in order`)
    }
  }

  const selectedAggregateFiles = [...results.aggregate.selectedFiles].sort()
  const sourcePaths = walkPaths(root, "src")
  const discoveredFiles = walkRepositoryPaths(root)
    .filter((file) => file.endsWith(".test.ts"))
    .sort()
  if (
    JSON.stringify(discoveredFiles) !== JSON.stringify(selectedAggregateFiles) ||
    discoveredFiles.length !== contract.tests.aggregate.fileCount
  ) {
    fail("test:p3 must select the complete exact P3 Contract Test file set")
  }

  let explicitTestCount = 0
  for (const file of discoveredFiles) {
    const source = readFileSync(join(root, file), "utf8")
    if (/\b(?:test|it|describe)\.(?:skip|todo|only)\b/.test(source)) {
      fail(`disabled or narrowed Contract Test ${file}`)
    }
    explicitTestCount += source.match(/^test\s*\(/gm)?.length ?? 0
  }
  if (explicitTestCount !== contract.tests.aggregate.count) {
    fail(`expected ${contract.tests.aggregate.count} explicit Contract Tests, found ${explicitTestCount}`)
  }

  for (const path of forbiddenP3Paths) {
    if (existsSync(join(root, path))) fail(`forbidden in P3 RED ${path}`)
  }
  const unexpectedImplementation = sourcePaths.find((path) => path.split("/").includes("implementation"))
  if (unexpectedImplementation !== undefined) {
    fail(`Implementation paths remain absent in P3 RED: ${unexpectedImplementation}`)
  }

  for (const guide of ["AGENTS.md", "README.md"]) {
    const source = readFileSync(join(root, guide), "utf8")
    if (!source.includes("clean-fixture/p3-red-contract.json")) {
      fail(`${guide} must point to the canonical P3 RED contract owner`)
    }
  }
  const contextSource = readFileSync(join(root, "CONTEXT.md"), "utf8")
  const requiredContextTerms = [
    "Result Code", "Maintenance Outcome", "Maintenance Error",
    "Maintenance Command Facade Adapter", "Branch Station", "Station ID",
    "Station Map", "Declared Branch Coverage", "Observed Branch Coverage",
    "Stage-Deferred Branch", "Failure Class", "Diagnostic Record",
    "Event Record", "Event Acceptance", "Facade Envelope Version",
    "Result Schema Version", "Hint Version", "Command Surface Alignment Proof",
  ]
  for (const term of requiredContextTerms) {
    if (!contextSource.includes(`**${term}**:`)) fail(`CONTEXT.md is missing exact Ubiquitous Language term ${term}`)
  }
  const contextMapSource = readFileSync(join(root, "CONTEXT-MAP.md"), "utf8")
  for (const route of [
    "src/modules/maintenance-command-contract/command-vocabulary.ts",
    "src/modules/maintenance-command-contract/result-vocabulary.ts",
    "src/modules/maintenance-command-contract/branch-stations.ts",
    "src/adapters/maintenance-command-facade/interface.ts",
    "docs/adr/0001-language-to-topology.md",
    "docs/adr/0002-owner-manifests-and-dependency-locality.md",
  ]) {
    if (!contextMapSource.includes(route)) fail(`CONTEXT-MAP.md is missing exact owner route ${route}`)
  }
  const contextMapRows = contextMapSource.split("\n")
  const commandResultRoute = contextMapRows.find((row) => row.includes("Where are command and result meanings owned?"))
  const facadeRoute = contextMapRows.find((row) => row.includes("Where is the public maintenance binary adapted?"))
  const branchStationRoute = contextMapRows.find((row) => row.includes("Where are execution branches declared and reconciled?"))
  if (
    !commandResultRoute?.includes("docs/adr/0001-language-to-topology.md") ||
    !commandResultRoute.includes("src/modules/maintenance-command-contract/command-vocabulary.ts") ||
    !commandResultRoute.includes("src/modules/maintenance-command-contract/result-vocabulary.ts") ||
    !facadeRoute?.includes("docs/adr/0002-owner-manifests-and-dependency-locality.md") ||
    !facadeRoute.includes("src/adapters/maintenance-command-facade/interface.ts") ||
    !branchStationRoute?.includes("docs/adr/0001-language-to-topology.md") ||
    !branchStationRoute.includes("src/modules/maintenance-command-contract/branch-stations.ts")
  ) {
    fail("CONTEXT-MAP.md owner routes must retain their exact Interface and binding ADR pairs")
  }
  if (contextMapSource.includes("command-descriptor.ts")) fail("CONTEXT-MAP.md must not restore the retired command descriptor route")
  const requiredCommands = [
    "bun run check",
    "bun run verify:p3:red",
    "bun run test:p3",
    ...results.focused.map(({ command }) => command.join(" ")),
    ...results.workspace.map(({ command }) => command.join(" ")),
  ]
  const agentGuidance = readFileSync(join(root, "AGENTS.md"), "utf8")
  for (const pointer of contract.structure.requiredAgentPointers) {
    if (!agentGuidance.includes(pointer)) fail(`AGENTS.md is missing pointer ${pointer}`)
  }
  const agentCodeSpans = [...agentGuidance.matchAll(/`([^`\n]+)`/g)].map((match) => match[1])
  for (const command of requiredCommands) {
    if (!agentCodeSpans.includes(command)) fail(`AGENTS.md is missing exact command ${command}`)
  }

  if (Object.keys(packageMetadata.exports ?? {}).length !== 10) {
    fail("root Package Identity must retain exactly 10 exports")
  }
  if (JSON.stringify((packageMetadata as PackageMetadata & { bin?: Record<string, string> }).bin) !== JSON.stringify({ "agent-plugin-kit": "./src/adapters/maintenance-command-facade/maintenance.ts" })) {
    fail("root Package Identity must own the sole accepted binary mapping")
  }
  if (
    facadeManifest.name !== "@agent-plugin-kit/maintenance-command-facade" ||
    facadeManifest.private !== true ||
    facadeManifest.type !== "module" ||
    JSON.stringify(facadeManifest.exports) !== JSON.stringify({ ".": "./interface.ts" }) ||
    facadeManifest.scripts?.test !== "bun test contract-tests/command-surface.test.ts contract-tests/public-process.test.ts contract-tests/observability.test.ts"
  ) {
    fail("Maintenance Command Facade Owner Manifest identity, ESM Interface export, and selector must remain exact")
  }
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    if (Object.keys(facadeManifest[field] ?? {}).length !== 0) fail(`Facade Owner Manifest ${field} must remain empty in RED`)
  }
  for (const [label, manifest] of [["root", packageMetadata], ["Admission", admissionManifest]] as const) {
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }
    if (dependencies["@logtape/logtape"] !== undefined) fail(`${label} manifest must remain free of LogTape`)
    if (Object.keys(dependencies).some((name) => name.toLowerCase().includes("sidequest"))) fail(`${label} manifest must remain free of SideQuest`)
  }
  if (packageMetadata.catalog !== undefined || packageMetadata.catalogs !== undefined) {
    fail("Bun catalog remains absent in P3")
  }
  const workspaceManifests = sourcePaths.filter((file) => file.endsWith("/package.json"))
  if (workspaceManifests.length !== 10) {
    fail(`expected exactly 10 Owner Manifests, found ${workspaceManifests.length}`)
  }
  for (const file of workspaceManifests) {
    if (readJson<PackageMetadata>(join(root, file)).private !== true) {
      fail(`Owner Manifest must remain private: ${file}`)
    }
  }
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

function verifyIntentionalRed(
  root: string,
  result: ExpectedResult,
  receiptDirectory: string,
  environment: Record<string, string | undefined> = testEnvironment,
): void {
  const receipt = join(
    receiptDirectory,
    `${result.label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.xml`,
  )
  const processResult = Bun.spawnSync({
    cmd: [...result.command, "--reporter=junit", "--reporter-outfile", receipt],
    cwd: root,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  })
  const output = stripAnsi(`${processResult.stdout.toString()}\n${processResult.stderr.toString()}`)

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
    fail(
      `${result.label} expected 0 pass/${result.tests} fail/0 skip, observed ${passes}/${failures}/${skipped}`,
    )
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

function copyRepositoryFixture(destination: string): void {
  const excluded = new Set([".git", "node_modules"])
  function copyDirectory(source: string, target: string): void {
    mkdirSync(target, { recursive: true, mode: 0o700 })
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue
      const sourcePath = join(source, entry.name)
      const targetPath = join(target, entry.name)
      if (entry.isDirectory()) copyDirectory(sourcePath, targetPath)
      else if (entry.isFile()) copyFileSync(sourcePath, targetPath)
    }
  }
  copyDirectory(repositoryRoot, destination)
}

function expectStaticRejection(label: string, mutate: (root: string) => void): void {
  const scratchParent = mkdtempSync(join(tmpdir(), "agent-plugin-kit-p3-probe-"))
  const scratchRoot = join(scratchParent, "repository")
  try {
    copyRepositoryFixture(scratchRoot)
    mutate(scratchRoot)
    try {
      verifyP3StaticContract(scratchRoot)
      fail(`sensitivity probe did not fail closed: ${label}`)
    } catch (error) {
      if (error instanceof Error && error.message === `sensitivity probe did not fail closed: ${label}`) {
        throw error
      }
      console.log(`sensitivity ${label}: rejected`)
    }
  } finally {
    rmSync(scratchParent, { recursive: true, force: true })
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function verifyStaticSensitivity(): void {
  expectStaticRejection("bunfig auto-install setting changed", (root) => {
    writeFileSync(join(root, "bunfig.toml"), '[install]\nauto = "auto"\n')
  })
  expectStaticRejection("Admission Owner Manifest dependency added", (root) => {
    const path = join(root, "src/admission-bootstrap/package.json")
    const manifest = readJson<Record<string, unknown>>(path)
    manifest.dependencies = { "p3-unavailable-dependency": "1.0.0" }
    writeJson(path, manifest)
  })
  expectStaticRejection("Admission Owner Manifest dev dependency added", (root) => {
    const path = join(root, "src/admission-bootstrap/package.json")
    const manifest = readJson<Record<string, unknown>>(path)
    manifest.devDependencies = { typescript: "6.0.3" }
    writeJson(path, manifest)
  })
  expectStaticRejection("Admission source bare import added", (root) => {
    const path = join(root, "src/admission-bootstrap/interface.ts")
    writeFileSync(path, `${readFileSync(path, "utf8")}\nimport "p3-unavailable-dependency"\n`)
  })
  expectStaticRejection("Admission source bare require added", (root) => {
    const path = join(root, "src/admission-bootstrap/interface.ts")
    writeFileSync(path, `${readFileSync(path, "utf8")}\nrequire("typescript")\n`)
  })
  expectStaticRejection("Admission source computed require added", (root) => {
    const path = join(root, "src/admission-bootstrap/interface.ts")
    writeFileSync(
      path,
      `${readFileSync(path, "utf8")}\nconst requiredDependency = "typescript"\nrequire(requiredDependency)\n`,
    )
  })
  expectStaticRejection("Admission computed dynamic import added", (root) => {
    const path = join(root, "src/admission-bootstrap/interface.ts")
    writeFileSync(
      path,
      `${readFileSync(path, "utf8")}\nconst dependency = "typescript"\nawait import(dependency)\n`,
    )
  })
  expectStaticRejection("Admission two-argument dynamic bare import added", (root) => {
    const path = join(root, "src/admission-bootstrap/interface.ts")
    writeFileSync(
      path,
      `${readFileSync(path, "utf8")}\nawait import("typescript", { with: { type: "json" } })\n`,
    )
  })
  expectStaticRejection("Admission type-only import-equals bare import added", (root) => {
    const path = join(root, "src/admission-bootstrap/interface.ts")
    writeFileSync(
      path,
      `${readFileSync(path, "utf8")}\nimport type ts = require("typescript")\n`,
    )
  })
  expectStaticRejection("Admission copied closure widened", (root) => {
    const entry = join(root, "src/admission-bootstrap/interface.ts")
    writeFileSync(join(root, "src/admission-bootstrap/extra.ts"), "export type Extra = never\n")
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\nexport type { Extra } from "./extra"\n`)
  })
  expectStaticRejection("Admission type-only copied closure widened", (root) => {
    const entry = join(root, "src/admission-bootstrap/interface.ts")
    writeFileSync(join(root, "src/admission-bootstrap/extra.ts"), "export type Extra = never\n")
    writeFileSync(
      entry,
      `${readFileSync(entry, "utf8")}\nexport type ExtraAlias = import("./extra").Extra\n`,
    )
  })
  expectStaticRejection("Admission closure symlink escaped Source Tree", (root) => {
    const external = join(root, "external-admission-source.ts")
    const target = join(root, "src/modules/release-and-git-engine/interface.ts")
    writeFileSync(external, "export type ReleaseIdentity = never\n")
    unlinkSync(target)
    symlinkSync("../../../external-admission-source.ts", target)
  })
  expectStaticRejection("Admission projection drifted", (root) => {
    const contract = readContract(root)
    const path = join(root, contract.admission.projectionFixture)
    const projection = readJson<Record<string, unknown>>(path)
    projection.name = "drifted-agent-plugin-kit"
    writeJson(path, projection)
  })
  expectStaticRejection("Admission consumer fixture drifted", (root) => {
    const contract = readContract(root)
    writeFileSync(
      join(root, contract.admission.consumerFixture),
      'await import("agent-plugin-kit/maintenance-command-contract")\n',
    )
  })
  expectStaticRejection("Admission self-report ledger returned", (root) => {
    const path = join(
      root,
      "clean-fixture/personal-verification-profile/contract-tests/adapters/contract-subjects.ts",
    )
    writeFileSync(path, `${readFileSync(path, "utf8")}\nconst admissionImportLedger: string[] = []\n`)
  })
  expectStaticRejection("Contract Test skipped", (root) => {
    const contract = readContract(root)
    const path = join(root, contract.admission.sentinelFile)
    const source = readFileSync(path, "utf8")
    writeFileSync(
      path,
      source.replace(
        `test(${JSON.stringify(contract.admission.sentinelName)}`,
        `test.skip(${JSON.stringify(contract.admission.sentinelName)}`,
      ),
    )
  })
  expectStaticRejection("extra repository Contract Test file", (root) => {
    writeFileSync(
      join(root, "docs/extra.test.ts"),
      'import { test } from "bun:test"\ntest("extra", () => {})\n',
    )
  })
  expectStaticRejection("top-level tests owner appeared", (root) => {
    const path = join(root, "tests/extra.ts")
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, "export {}\n")
  })
  expectStaticRejection("top-level test-utils owner appeared", (root) => {
    const path = join(root, "test-utils/extra.ts")
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, "export {}\n")
  })
  expectStaticRejection("missing Contract Test file", (root) => {
    const contract = readContract(root)
    const selectedFile = contract.tests.admissionBootstrap.files[0]
    if (selectedFile === undefined) fail("Admission selector must retain a Contract Test file")
    unlinkSync(join(root, selectedFile))
  })
  expectStaticRejection("later Implementation path appeared", (root) => {
    const path = join(root, "src/admission-bootstrap/implementation/index.ts")
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, "export {}\n")
  })
  expectStaticRejection("first P4 GREEN transition rule removed", (root) => {
    const path = join(root, "clean-fixture/p3-red-contract.json")
    const contract = readJson<Record<string, Record<string, unknown>>>(path)
    const admission = contract.admission
    if (admission === undefined) fail("P3 RED contract is missing Admission")
    delete admission.firstP4GreenTransition
    writeJson(path, contract)
  })
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    expectStaticRejection(`Facade Owner Manifest ${field} added`, (root) => {
      const path = join(root, "src/adapters/maintenance-command-facade/package.json")
      const manifest = readJson<Record<string, unknown>>(path)
      manifest[field] = { "p3-unavailable-dependency": "1.0.0" }
      writeJson(path, manifest)
    })
  }
  expectStaticRejection("LogTape added to root", (root) => {
    const path = join(root, "package.json")
    const manifest = readJson<Record<string, unknown>>(path)
    manifest.dependencies = { "@logtape/logtape": "2.3.1" }
    writeJson(path, manifest)
  })
  expectStaticRejection("LogTape added to Admission", (root) => {
    const path = join(root, "src/admission-bootstrap/package.json")
    const manifest = readJson<Record<string, unknown>>(path)
    manifest.dependencies = { "@logtape/logtape": "2.3.1" }
    writeJson(path, manifest)
  })
  expectStaticRejection("eleventh root export added", (root) => {
    const path = join(root, "package.json")
    const manifest = readJson<Record<string, unknown> & { exports: Record<string, string> }>(path)
    manifest.exports["./maintenance-command-facade"] = "./src/adapters/maintenance-command-facade/interface.ts"
    writeJson(path, manifest)
  })
  expectStaticRejection("Facade Owner Manifest made public", (root) => {
    const path = join(root, "src/adapters/maintenance-command-facade/package.json")
    const manifest = readJson<Record<string, unknown>>(path)
    manifest.private = false
    writeJson(path, manifest)
  })
  expectStaticRejection("Facade Owner Manifest ESM type drifted", (root) => {
    const path = join(root, "src/adapters/maintenance-command-facade/package.json")
    const manifest = readJson<Record<string, unknown>>(path)
    manifest.type = "commonjs"
    writeJson(path, manifest)
  })
  expectStaticRejection("Facade Owner Manifest Interface export drifted", (root) => {
    const path = join(root, "src/adapters/maintenance-command-facade/package.json")
    const manifest = readJson<Record<string, unknown>>(path)
    manifest.exports = { ".": "./drifted.ts" }
    writeJson(path, manifest)
  })
  expectStaticRejection("facade Ubiquitous Language term removed", (root) => {
    const path = join(root, "CONTEXT.md")
    writeFileSync(path, readFileSync(path, "utf8").replace("**Maintenance Command Facade Adapter**:", "**Drifted Facade Adapter**:"))
  })
  expectStaticRejection("Branch Station owner route removed", (root) => {
    const path = join(root, "CONTEXT-MAP.md")
    writeFileSync(path, readFileSync(path, "utf8").replace("src/modules/maintenance-command-contract/branch-stations.ts", "src/modules/maintenance-command-contract/drifted-stations.ts"))
  })
  expectStaticRejection("Facade owner route ADR binding swapped", (root) => {
    const path = join(root, "CONTEXT-MAP.md")
    const source = readFileSync(path, "utf8")
    const row = source.split("\n").find((line) => line.includes("Where is the public maintenance binary adapted?"))
    if (!row) fail("missing facade Context Map row in sensitivity fixture")
    writeFileSync(path, source.replace(row, row.replace("docs/adr/0002-owner-manifests-and-dependency-locality.md", "docs/adr/0001-language-to-topology.md")))
  })
  expectStaticRejection("Branch Station route ADR binding swapped", (root) => {
    const path = join(root, "CONTEXT-MAP.md")
    const source = readFileSync(path, "utf8")
    const row = source.split("\n").find((line) => line.includes("Where are execution branches declared and reconciled?"))
    if (!row) fail("missing Branch Station Context Map row in sensitivity fixture")
    writeFileSync(path, source.replace(row, row.replace("docs/adr/0001-language-to-topology.md", "docs/adr/0002-owner-manifests-and-dependency-locality.md")))
  })
  expectStaticRejection("tenth workspace owner removed", (root) => {
    rmSync(join(root, "src/adapters/maintenance-command-facade"), { recursive: true })
  })
}

function verifyRedContractShells(contract: P3RedContract, root = repositoryRoot): void {
  for (const shell of [
    { ...contract.audit.maintenanceCli, sentinel: contract.audit.maintenanceCli.redVerdict },
    { ...contract.qualification.maintenanceCliLocalLink, sentinel: contract.qualification.maintenanceCliLocalLink.redSentinel },
  ]) {
    const result = Bun.spawnSync({
      cmd: shell.command.split(" "),
      cwd: root,
      env: testEnvironment,
      stdout: "pipe",
      stderr: "pipe",
    })
    const stdout = stripAnsi(result.stdout.toString())
    const lines = stdout.trim().split("\n")
    let record: Record<string, unknown> | undefined
    try {
      record = JSON.parse(lines.at(-1) ?? "") as Record<string, unknown>
    } catch {
      fail(`${shell.command} must emit one parseable JSON proof record`)
    }
    if (result.exitCode !== shell.redExit || !stdout.includes(shell.sentinel) || record?.schema_version !== shell.proofSchemaVersion) {
      fail(`${shell.command} must retain its schema-valid intentional RED sentinel and exit`)
    }
    if (shell.command === contract.audit.maintenanceCli.command) {
      const exactKeys = [
        "schema_version", "package_identity", "command_contract_id",
        "command_contract_schema_version", "facade_envelope_schema_version",
        "result_schema_version", "error_schema_version", "hint_version",
        "diagnostic_schema_version", "event_schema_version", "surface_findings",
        "declared_branch_coverage", "stage_deferred_branch_coverage",
        "stage_deferred_owner_stages", "declared_unreachable_branch_coverage",
        "required_observed_branch_total", "observed_branch_coverage", "stations",
        "root_consumers", "verdict",
      ].sort()
      if (JSON.stringify(Object.keys(record ?? {}).sort()) !== JSON.stringify(exactKeys)) {
        fail("maintenance CLI audit must emit the exact closed proof schema")
      }
      const findings = record?.surface_findings as { surface: string; status: string; detail: string }[]
      const stations = record?.stations as {
        station_id: string
        status: string
        provenance: string | null
        argv: string[] | null
        exit_code: number | null
        deadline_ms: number | null
        timed_out: boolean | null
        descriptor_closure: string | null
        result_code: string | null
        next_action_id: string | null
      }[]
      const owners = record?.stage_deferred_owner_stages as unknown[]
      const consumers = record?.root_consumers as Record<string, unknown>
      const requiredRows = stations.filter(({ station_id }) => station_id === "help.previewed" || station_id === "maintenance.usage-refused")
      if (
        record?.package_identity !== "agent-plugin-kit" ||
        record?.command_contract_id !== "agent-plugin-kit.maintenance-command-result" ||
        ![record?.command_contract_schema_version, record?.result_schema_version, record?.facade_envelope_schema_version, record?.error_schema_version, record?.hint_version, record?.diagnostic_schema_version, record?.event_schema_version].every((version) => version === 1) ||
        record?.declared_branch_coverage !== 118 ||
        record?.stage_deferred_branch_coverage !== 109 ||
        record?.declared_unreachable_branch_coverage !== 7 ||
        record?.required_observed_branch_total !== 2 ||
        record?.observed_branch_coverage !== 0 ||
        stations.length !== 118 || owners.length !== 5 ||
        JSON.stringify(requiredRows) !== JSON.stringify([
          { station_id: "help.previewed", status: "drifted", provenance: "real_process", argv: ["--run-id", "p3-help-literal", "--help"], exit_code: 1, deadline_ms: 2000, timed_out: false, descriptor_closure: "closed", result_code: null, next_action_id: null, skip_rationale: null },
          { station_id: "maintenance.usage-refused", status: "drifted", provenance: "real_process", argv: ["--run-id", "p3-help-literal", "unknown"], exit_code: 1, deadline_ms: 2000, timed_out: false, descriptor_closure: "closed", result_code: null, next_action_id: null, skip_rationale: null },
        ]) ||
        JSON.stringify(findings.filter(({ status }) => status === "drifted").map(({ surface }) => surface)) !== JSON.stringify(["public_process"]) ||
        record?.verdict !== "drifted" ||
        JSON.stringify(consumers.declared) !== JSON.stringify(consumers.discovered) ||
        JSON.stringify(consumers.discovered) !== JSON.stringify(consumers.typechecked) ||
        consumers.declared_count !== (consumers.declared as unknown[]).length ||
        consumers.discovered_count !== (consumers.discovered as unknown[]).length ||
        consumers.typechecked_count !== (consumers.typechecked as unknown[]).length
      ) {
        fail("maintenance CLI audit proof content drifted")
      }
    } else if (
      JSON.stringify(Object.keys(record ?? {}).sort()) !==
        JSON.stringify(["expected_cleanup_ledger", "expected_public_cli_executions", "fixed_help_argv", "observed_public_cli_executions", "proof", "run_id", "schema_version", "sentinel", "verdict"].sort()) ||
      record?.expected_public_cli_executions !== 4 ||
      record?.observed_public_cli_executions !== 0 || record?.run_id !== "p3-help-literal" ||
      JSON.stringify(record?.fixed_help_argv) !== JSON.stringify(["maintenance", "--json", "--run-id", "p3-local-link-help", "help"]) ||
      (record?.expected_cleanup_ledger as string[]).filter((entry) => entry.startsWith("execute:")).length !== 4 ||
      JSON.stringify((record?.expected_cleanup_ledger as string[]).slice(0, 2)) !== JSON.stringify(["ln:-s:package", "ln:-s:binary"]) ||
      JSON.stringify((record?.expected_cleanup_ledger as string[]).slice(-2)) !== JSON.stringify(["unlink:binary", "unlink:package"])
    ) {
      fail("maintenance CLI local-link RED receipt schema drifted")
    }
    console.log(`verified ${shell.command}: intentional RED exit ${result.exitCode}`)
  }
}

function expectDynamicRedRejection(label: string, source: string): void {
  const scratchRoot = mkdtempSync(join(tmpdir(), "agent-plugin-kit-p3-dynamic-probe-"))
  const receiptRoot = join(scratchRoot, "receipts")
  mkdirSync(receiptRoot)
  const testFile = join(scratchRoot, "probe.test.ts")
  writeFileSync(testFile, source)
  const result: ExpectedResult = {
    label,
    command: ["bun", `--config=${join(repositoryRoot, "bunfig.toml")}`, "test", testFile],
    tests: 1,
    selectedFiles: [testFile],
  }
  try {
    try {
      verifyIntentionalRed(scratchRoot, result, receiptRoot)
      fail(`dynamic sensitivity probe did not fail closed: ${label}`)
    } catch (error) {
      if (error instanceof Error && error.message === `dynamic sensitivity probe did not fail closed: ${label}`) {
        throw error
      }
      console.log(`sensitivity ${label}: rejected`)
    }
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true })
  }
}

function expectAuditRejection(label: string, mutate: (root: string) => void): void {
  const scratchParent = mkdtempSync(join(tmpdir(), "agent-plugin-kit-p3-audit-probe-"))
  const scratchRoot = join(scratchParent, "repository")
  try {
    copyRepositoryFixture(scratchRoot)
    mutate(scratchRoot)
    try {
      verifyRedContractShells(readContract(scratchRoot), scratchRoot)
      fail(`audit sensitivity probe did not fail closed: ${label}`)
    } catch (error) {
      if (error instanceof Error && error.message === `audit sensitivity probe did not fail closed: ${label}`) throw error
      console.log(`sensitivity audit ${label}: rejected`)
    }
  } finally {
    rmSync(scratchParent, { recursive: true, force: true })
  }
}

function verifyDynamicSensitivity(): void {
  expectDynamicRedRejection(
    "wrong failure class",
    'import { expect, test } from "bun:test"\ntest("wrong class", () => { expect(undefined, "fixture-failure: wrong class").toBeDefined() })\n',
  )
  expectAuditRejection("schema equality drift", (root) => {
    const path = join(root, "src/modules/maintenance-command-contract/command-vocabulary.ts")
    writeFileSync(path, readFileSync(path, "utf8").replace("export const commandContractSchemaVersion = resultSchemaVersion", "export const commandContractSchemaVersion = 2 as const"))
  })
  expectAuditRejection("failure Next Action drift", (root) => {
    const path = join(root, "src/modules/maintenance-command-contract/result-vocabulary.ts")
    writeFileSync(path, readFileSync(path, "utf8").replace('"maintenance.show-help"', '"maintenance.show-drifted-help"'))
  })
  expectAuditRejection("conflicting duplicate Next Action", (root) => {
    const path = join(root, "src/modules/maintenance-command-contract/result-vocabulary.ts")
    writeFileSync(path, readFileSync(path, "utf8").replace('"runtime.inspect-usage"', '"maintenance.show-help"'))
  })
  expectAuditRejection("frozen Clean Fixture help drift", (root) => {
    const path = join(root, "clean-fixture/personal-verification-profile/contract-tests/fixtures/plugin-consumer.ts")
    writeFileSync(path, readFileSync(path, "utf8").replace('\\"package_identity\\":\\"agent-plugin-kit\\"', '\\"package_identity\\":\\"drifted-kit\\"'))
  })
  expectAuditRejection("facade consumer omitted", (root) => {
    const path = join(root, "src/adapters/maintenance-command-facade/maintenance.ts")
    writeFileSync(path, readFileSync(path, "utf8").replace('from "./interface"', 'from "./drifted-interface"'))
  })
  expectAuditRejection("required usage argv drift", (root) => {
    const path = join(root, "clean-fixture/audit-p3-maintenance-cli.ts")
    writeFileSync(path, readFileSync(path, "utf8").replace('["--run-id", "p3-help-literal", "unknown"]', '["--run-id", "p3-help-literal", "drifted"]'))
  })
  expectAuditRejection("declared-unreachable owner rationale drift", (root) => {
    const path = join(root, "src/modules/maintenance-command-contract/branch-stations.ts")
    writeFileSync(path, readFileSync(path, "utf8").replace(
      "No accepted argv, stdin, or named file can cause a pre-dispatch facade fault; unit fault Adapters retain containment proof.",
      "",
    ))
  })
  expectAuditRejection("declared-unreachable Interface pointer drift", (root) => {
    const path = join(root, "src/modules/maintenance-command-contract/branch-stations.ts")
    writeFileSync(path, readFileSync(path, "utf8").replace(
      'governingInterface: "src/adapters/maintenance-command-facade/interface.ts",',
      'governingInterface: "src/modules/maintenance-command-contract/interface.ts",',
    ))
  })
  expectAuditRejection("package version drift", (root) => {
    const path = join(root, "package.json")
    const manifest = readJson<Record<string, unknown>>(path)
    manifest.version = "0.0.1"
    writeJson(path, manifest)
  })
  expectAuditRejection("unreachable workspace consumer added", (root) => {
    writeFileSync(
      join(root, "src/modules/plugin-payload-production/hidden-facade-consumer.ts"),
      'import type { MaintenanceCommandFacade } from "../../adapters/maintenance-command-facade/interface"\nexport type HiddenFacadeConsumer = MaintenanceCommandFacade\n',
    )
  })
  expectAuditRejection("type-position workspace consumer added", (root) => {
    writeFileSync(
      join(root, "src/modules/plugin-payload-production/hidden-type-facade-consumer.ts"),
      'export type HiddenTypeFacadeConsumer = import("../../adapters/maintenance-command-facade/interface").MaintenanceCommandFacade\n',
    )
  })
  expectAuditRejection("package-identity workspace consumer added", (root) => {
    writeFileSync(
      join(root, "src/modules/plugin-payload-production/hidden-package-facade-consumer.ts"),
      'export type HiddenPackageFacadeConsumer = import("@agent-plugin-kit/maintenance-command-facade").MaintenanceCommandFacade\n',
    )
  })
  expectDynamicRedRejection(
    "static test load failure",
    'import "p3-static-test-load-failure"\nimport { test } from "bun:test"\ntest("undiscovered", () => {})\n',
  )

  const contract = readContract(repositoryRoot)
  const resolutionFailure = Bun.spawnSync({
    cmd: [
      "bun",
      `--config=${join(repositoryRoot, contract.bun.configFile)}`,
      "test",
      contract.admission.sentinelFile,
    ],
    cwd: repositoryRoot,
    env: {
      ...testEnvironment,
      AGENT_PLUGIN_KIT_ADMISSION_BARE_SPECIFIER_PERTURBATION:
        "p3-copied-subject-resolution-failure",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const resolutionOutput = stripAnsi(
    `${resolutionFailure.stdout.toString()}\n${resolutionFailure.stderr.toString()}`,
  )
  if (
    resolutionFailure.exitCode === 0 ||
    !resolutionOutput.includes("Cannot find package") ||
    resolutionOutput.includes("0 tests") ||
    !resolutionOutput.includes(contract.admission.sentinelName) ||
    resolutionOutput.match(/^error: contract-absent:/gm)?.length !== 2 ||
    resolutionOutput.match(/^error: expect\(received\)\.toEqual\(expected\)$/gm)?.length !== 1
  ) {
    fail("copied-subject bare import must fail through the owning Contract Test as the wrong RED class")
  }
  console.log("sensitivity copied-subject bare import: resolution failure rejected as wrong RED class")
}

function verifyAutoInstallDenied(): void {
  const scratchRoot = mkdtempSync(join(tmpdir(), "agent-plugin-kit-auto-install-"))
  const entry = join(scratchRoot, "entry.ts")
  const packagePath = join(scratchRoot, "package.json")
  const packageSource = '{"name":"auto-install-denial-probe","private":true,"type":"module"}\n'
  try {
    writeFileSync(packagePath, packageSource)
    writeFileSync(entry, 'await import("p3-auto-install-must-remain-unavailable")\n')
    const result = Bun.spawnSync({
      cmd: ["bun", `--config=${join(repositoryRoot, "bunfig.toml")}`, entry],
      cwd: scratchRoot,
      env: { PATH: process.env.PATH },
      stdout: "pipe",
      stderr: "pipe",
    })
    const stderr = result.stderr.toString()
    if (
      result.exitCode === 0 ||
      !stderr.includes("Cannot find package") ||
      existsSync(join(scratchRoot, "node_modules")) ||
      existsSync(join(scratchRoot, "bun.lock")) ||
      readFileSync(packagePath, "utf8") !== packageSource
    ) {
      fail("Bun auto-install denial scratch proof did not fail locally without dependency drift")
    }
    console.log("verified Bun auto-install denial: local resolution failed without install artifacts")
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true })
  }
}

function run(): void {
  const structureOnly = process.argv.includes("--structure-only")
  verifyP3StaticContract()
  if (structureOnly) {
    console.log("P3 structure contract verified")
    return
  }

  verifyStaticSensitivity()
  verifyDynamicSensitivity()
  verifyAutoInstallDenied()
  verifyRedContractShells(readContract(repositoryRoot))

  const results = expectedResults(readContract(repositoryRoot))
  const receiptDirectory = mkdtempSync(join(tmpdir(), "agent-plugin-kit-p3-red-"))
  try {
    for (const result of [...results.focused, ...results.workspace, results.aggregate]) {
      verifyIntentionalRed(repositoryRoot, result, receiptDirectory)
    }
    verifyIntentionalRed(
      repositoryRoot,
      { ...results.aggregate, label: "P3 aggregate hostile color" },
      receiptDirectory,
      { ...testEnvironment, FORCE_COLOR: "3", NO_COLOR: "0", TERM: "xterm-256color" },
    )
    console.log("P3 intentional RED contract verified")
  } finally {
    rmSync(receiptDirectory, { recursive: true, force: true })
  }
}

try {
  run()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`P3 RED verification failed: ${message}`)
  process.exitCode = 1
}
