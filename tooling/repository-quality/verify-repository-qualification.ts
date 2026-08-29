import { createHash } from "node:crypto"
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path"
import {
  NonliteralModuleSpecifierError,
  staticModuleSpecifiers,
  typescriptLexicalCode,
  typescriptRuntimeCode,
} from "./static-module-specifiers"

type BalancedCounts = {
  tests: number
  passed: number
  failed: number
  skipped: number
  failure_classes: Readonly<Record<string, number>>
}

type RepositoryProofGroup = BalancedCounts & {
  id: string
  script: string
  files: readonly string[]
}

type WorkspaceSelector = BalancedCounts & {
  id: string
  command: readonly string[]
  package_directory: string
  files: readonly string[]
}

type ObservedCounts = BalancedCounts & {
  files: number
}

type ProofObservation = {
  groups: readonly (ObservedCounts & { id: string })[]
  aggregate: ObservedCounts
}

type JunitSuiteMatch = {
  tag: string
  index: number
}

type RepositoryQualificationContract = {
  schema_version: 1
  bun: {
    config_file: string
    install_auto: "disable"
  }
  structure: {
    required_paths: readonly string[]
    forbidden_paths: readonly string[]
    forbidden_source_path_segments: readonly string[]
    required_agent_pointers: readonly string[]
    required_context_terms: readonly string[]
    required_context_map_routes: readonly {
      question: string
      term: string
      path: string
    }[]
    required_agent_index_links: readonly string[]
  }
  admission: {
    proof_layer: "public-process"
    first_green_implementation_transition: string
    sentinel_file: string
    sentinel_name: string
    sentinel_count: number
    source_entry: string
    source_closure: readonly string[]
    runtime_source_paths: readonly string[]
    owner_manifest: string
    consumer_fixture: string
    projection_fixture: string
    projection: {
      name: string
      type: string
      exports: Readonly<Record<string, string>>
    }
    forbidden_self_reports: readonly string[]
    self_report_files: readonly string[]
    non_claims: readonly string[]
  }
  package_contract: {
    name: string
    version: string
    private: boolean
    type: string
    package_manager: string
    workspaces: readonly string[]
    exports: Readonly<Record<string, string>>
    type_exports: Readonly<Record<string, readonly string[]>>
    runtime_output_sha256: Readonly<Record<string, string>>
    bin: Readonly<Record<string, string>>
    scripts: Readonly<Record<string, string>>
    dev_dependencies: Readonly<Record<string, string>>
    forbidden_dependency_names: readonly string[]
    forbidden_dependency_name_fragments: readonly string[]
    catalogs_allowed: false
  }
  owner_manifests: Readonly<Record<string, {
    path: string
    name: string
    private: boolean
    type: string
    exports: Readonly<Record<string, string>>
    empty_dependency_fields: readonly string[]
  }>>
  repository_quality_tests: readonly {
    path: string
    tests: number
  }[]
  fallow: {
    config_file: string
    config: Readonly<Record<string, unknown>>
    vscode_settings_file: string
    vscode_settings: Readonly<Record<string, unknown>>
    gitignore_file: string
    gitignore_line: string
    skill_files: readonly string[]
    skill_version_marker: string
    skill_target: string
  }
  workspace_selectors: readonly WorkspaceSelector[]
  shells: {
    maintenance_cli: {
      script: string
      command: string
      red_exit: number
      red_verdict: string
      proof_schema_version: number
    }
    maintenance_cli_local_link: {
      script: string
      command: string
      red_exit: number
      red_sentinel: string
      proof_schema_version: number
    }
  }
  proof_groups: readonly RepositoryProofGroup[]
  aggregate: {
    script: string
    selected_files: readonly string[]
    files: number
    tests: number
    passed: number
    failed: number
    skipped: number
    failure_classes: Readonly<Record<string, number>>
  }
}

type RefusalFinding = {
  kind: string
  owner: string
  repair_id: string
}

class QualificationRefusal extends Error {
  constructor(
    readonly code: string,
    readonly mode: "complete" | "structure-only",
    readonly findings: readonly RefusalFinding[],
  ) {
    super(code)
  }
}

const repositoryRoot = resolve(import.meta.dir, "../..")
const contractPath = resolve(repositoryRoot, "tooling/repository-quality/repository-qualification-contract.json")
const repositoryQualityModuleSpecifierPath = "tooling/repository-quality/static-module-specifiers.ts"
const knownFailureClasses = new Set(["contract-absent"])
const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
let activeMode: "complete" | "structure-only" = "complete"

function writeRefusal(refusal: QualificationRefusal): void {
  process.stderr.write(
    `${JSON.stringify({
      schema_version: 1,
      command: "verify:repository-qualification",
      status: "refused",
      mode: refusal.mode,
      code: refusal.code,
      findings: refusal.findings,
    })}\n`,
  )
  process.exitCode = refusal.code === "repository-unqualified" || refusal.code === "proof-process-failed" ? 1 : 2
}

function refuseRepository(code: string, kind: string, owner: string, repairId: string): never {
  throw new QualificationRefusal(code, activeMode, [{ kind, owner, repair_id: repairId }])
}

function refuseProofProcess(owner: string): never {
  throw new QualificationRefusal("proof-process-failed", activeMode, [
    { kind: "proof-process-failed", owner, repair_id: "repair-proof-process" },
  ])
}

function repositoryTestFiles(directory: string, prefix = ""): string[] {
  return repositoryEntries(directory, prefix, (name) => name.endsWith(".test.ts"))
}

function repositoryEntries(
  directory: string,
  prefix: string,
  include: (name: string) => boolean,
): string[] {
  const entries: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    entries.push(...repositoryEntry(directory, prefix, entry, include))
  }
  return entries
}

function repositoryEntry(
  directory: string,
  prefix: string,
  entry: { name: string; isDirectory(): boolean },
  include: (name: string) => boolean,
): string[] {
  if (isSkippedDirectory(entry.name, prefix)) {
    verifySkippedDirectory(directory, entry)
    return []
  }
  const entryRelative = relativeEntryPath(prefix, entry.name)
  const path = resolve(directory, entry.name)
  if (entry.isDirectory()) return repositoryEntries(path, entryRelative, include)
  return include(entry.name) ? [entryRelative] : []
}

function isSkippedDirectory(name: string, prefix: string): boolean {
  return name === ".fallow" || (prefix === "" && (name === ".git" || name === "node_modules"))
}

function verifySkippedDirectory(
  directory: string,
  entry: { name: string; isDirectory(): boolean },
): void {
  if (entry.name !== ".fallow" || !entry.isDirectory()) return
  if (directoryContainsTypeScript(resolve(directory, entry.name))) {
    refuseRepository("repository-unqualified", "path-drift", "structure.required_paths", "restore-current-declaration")
  }
}

function directoryContainsTypeScript(directory: string): boolean {
  return readdirSync(directory, { withFileTypes: true }).some((entry) =>
    entry.isDirectory()
      ? directoryContainsTypeScript(resolve(directory, entry.name))
      : [".ts", ".mts", ".cts", ".tsx"].some((extension) => entry.name.endsWith(extension))
  )
}

function relativeEntryPath(prefix: string, name: string): string {
  return prefix === "" ? name : `${prefix}/${name}`
}

function verifySelectors(contract: RepositoryQualificationContract): void {
  const scripts = rootScripts()
  const selected = new Set<string>()
  for (const [index, group] of contract.proof_groups.entries()) {
    verifyGroupSelectors(group, index, selected, scripts)
  }
  verifyAggregateFileCount(contract.aggregate.files, selected.size)
  verifyRepositoryTestPartition(selected)
  verifyAggregateSelector(contract.aggregate, selected, scripts)
  verifyWorkspaceSelectors(contract.workspace_selectors)
}

function rootScripts(): Readonly<Record<string, unknown>> {
  const scripts = objectValue(packageJson("package.json").scripts)
  if (scripts === undefined) packageDrift("package_contract.scripts")
  return scripts
}

function verifyAggregateFileCount(declared: number, observed: number): void {
  if (declared !== observed) {
    selectorDrift("aggregate.files")
  }
}

function verifyRepositoryTestPartition(selected: ReadonlySet<string>): void {
  const discovered = repositoryTestFiles(repositoryRoot)
    .filter((file) => !file.startsWith("tooling/repository-quality/"))
    .sort()
  const selectedSorted = [...selected].sort()
  if (JSON.stringify(discovered) !== JSON.stringify(selectedSorted)) {
    selectorDrift("proof_groups")
  }
}

function verifyAggregateSelector(
  aggregate: RepositoryQualificationContract["aggregate"],
  selected: ReadonlySet<string>,
  scripts: Readonly<Record<string, unknown>>,
): void {
  const selectedSorted = [...selected].sort()
  if (
    JSON.stringify([...aggregate.selected_files].sort()) !== JSON.stringify(selectedSorted) ||
    scripts[aggregate.script] !== `bun test ${aggregate.selected_files.join(" ")}`
  ) {
    selectorDrift("aggregate.script")
  }
}

function selectorDrift(owner: string): never {
  return refuseRepository(
    "repository-unqualified",
    "selector-drift",
    owner,
    "restore-current-declaration",
  )
}

function verifyGroupSelectors(
  group: RepositoryProofGroup,
  index: number,
  selected: Set<string>,
  scripts: Readonly<Record<string, unknown>>,
): void {
  const groupFiles = new Set<string>()
  const invalid = group.files.some((file) => {
    const duplicate = groupFiles.has(file)
    groupFiles.add(file)
    selected.add(file)
    return duplicate || !file.endsWith(".test.ts") || !existsSync(resolve(repositoryRoot, file))
  })
  if (invalid) {
    refuseRepository(
      "repository-unqualified",
      "selector-drift",
      `proof_groups[${index}].files`,
      "restore-current-declaration",
    )
  }
  if (scripts[group.script] !== `bun test ${group.files.join(" ")}`) {
    refuseRepository(
      "repository-unqualified",
      "selector-drift",
      `proof_groups[${index}].script`,
      "restore-current-declaration",
    )
  }
}

function verifyWorkspaceSelectors(selectors: readonly WorkspaceSelector[]): void {
  for (const [index, selector] of selectors.entries()) {
    verifyWorkspaceSelector(selector, index)
  }
}

function verifyWorkspaceSelector(selector: WorkspaceSelector, index: number): void {
  const owner = `workspace_selectors[${index}]`
  const manifest = packageJson(`${selector.package_directory}/package.json`)
  selectorDriftWhen(selector.command.length !== 5, owner)
  selectorDriftWhen(selector.command[0] !== "bun", owner)
  selectorDriftWhen(selector.command[1] !== "run", owner)
  selectorDriftWhen(selector.command[2] !== "--filter", owner)
  selectorDriftWhen(selector.command[4] !== "test", owner)
  selectorDriftWhen(manifest.name !== selector.command[3], owner)
  selectorDriftWhen(
    objectValue(manifest.scripts)?.test !== `bun test ${selector.files.join(" ")}`,
    owner,
  )
  verifyCounts(selector, owner)
}

function selectorDriftWhen(drifted: boolean, owner: string): void {
  if (drifted) selectorDrift(owner)
}

const repositoryQualityTestExpectations: Readonly<Record<string, number>> = {
  "tooling/repository-quality/contract-tests/fallow-policy.test.ts": 18,
  "tooling/repository-quality/contract-tests/repository-qualification.test.ts": 10,
}

function verifyRepositoryQualityTests(
  declarations: readonly { path: string; tests: number }[],
): void {
  const declared = declarations.map(({ path }) => path).sort()
  const discovered = repositoryTestFiles(repositoryRoot)
    .filter((file) => file.startsWith("tooling/repository-quality/"))
    .sort()
  if (JSON.stringify(declared) !== JSON.stringify(discovered)) {
    refuseRepository("repository-unqualified", "selector-drift", "repository_quality_tests", "restore-current-declaration")
  }

  const mismatch = declarations.findIndex((declaration) => {
    const expectedTests = repositoryQualityTestExpectations[declaration.path]
    if (expectedTests === undefined || declaration.tests !== expectedTests) return true
    const source = readFileSync(resolve(repositoryRoot, declaration.path), "utf8")
    return topLevelTestDrift(source, expectedTests)
  })
  if (mismatch !== -1) {
    refuseRepository("repository-unqualified", "selector-drift", `repository_quality_tests[${mismatch}]`, "restore-current-declaration")
  }
}

function topLevelTestDrift(source: string, expectedTests: number): boolean {
  const testCount = source.match(/^test\s*\(/gm)?.length ?? 0
  return testCount !== expectedTests || /test\.(skip|todo|only|each)\s*\(|describe\s*\(/.test(source)
}

function verifyBunPolicy(bun: RepositoryQualificationContract["bun"]): void {
  if (bun.config_file !== "bunfig.toml" || bun.install_auto !== "disable") {
    refuseRepository("repository-unqualified", "path-drift", "bun", "restore-repository-bytes")
  }
  const source = readFileSync(resolve(repositoryRoot, bun.config_file), "utf8")
  if (source !== `[install]\nauto = "${bun.install_auto}"\n`) {
    refuseRepository("repository-unqualified", "path-drift", "bun", "restore-repository-bytes")
  }
}

function verifyStructurePaths(contract: RepositoryQualificationContract): void {
  verifyRequiredPathDeclaration(contract.structure.required_paths)
  const missing = contract.structure.required_paths.some((path) => !existsSync(resolve(repositoryRoot, path)))
  if (missing) refuseRepository("repository-unqualified", "path-drift", "structure.required_paths", "restore-repository-bytes")
  const present = contract.structure.forbidden_paths.some((path) => existsSync(resolve(repositoryRoot, path)))
  if (present) refuseRepository("repository-unqualified", "path-drift", "structure.forbidden_paths", "restore-repository-bytes")
  const sourcePaths = repositoryEntries(resolve(repositoryRoot, "src"), "src", () => true)
  const forbiddenSegment = contract.structure.forbidden_source_path_segments.find((segment) =>
    sourcePaths.some((path) => path.split("/").includes(segment))
  )
  if (forbiddenSegment !== undefined) {
    refuseRepository(
      "repository-unqualified",
      "path-drift",
      "structure.forbidden_source_path_segments",
      "restore-repository-bytes",
    )
  }
  const declaredSourcePaths = contract.structure.required_paths
    .filter((path) => path.startsWith("src/"))
    .sort()
  verifyExactSourcePaths(sourcePaths, declaredSourcePaths)
  verifyStructureGuidance(contract.structure)
}

function verifyExactSourcePaths(observed: string[], declared: string[]): void {
  if (JSON.stringify(observed.sort()) === JSON.stringify(declared)) return
  refuseRepository(
    "repository-unqualified",
    "path-drift",
    "structure.required_paths",
    "restore-current-declaration",
  )
}

function verifyRequiredPathDeclaration(requiredPaths: readonly string[]): void {
  if (requiredPaths.includes(repositoryQualityModuleSpecifierPath)) return
  refuseRepository("repository-unqualified", "path-drift", "structure.required_paths", "restore-current-declaration")
}

function verifyStructureGuidance(structure: RepositoryQualificationContract["structure"]): void {
  verifyAgentPointers(structure.required_agent_pointers)
  verifyContextTerms(structure.required_context_terms)
  verifyContextMapRoutes(structure.required_context_map_routes)
  verifyAgentIndexLinks(structure.required_agent_index_links)
}

function verifyAgentPointers(pointers: readonly string[]): void {
  const agents = readFileSync(resolve(repositoryRoot, "AGENTS.md"), "utf8")
  if (pointers.some((pointer) => !agents.includes(pointer))) {
    refuseRepository("repository-unqualified", "path-drift", "structure.required_agent_pointers", "restore-repository-bytes")
  }
}

function verifyContextTerms(terms: readonly string[]): void {
  const context = readFileSync(resolve(repositoryRoot, "CONTEXT.md"), "utf8")
  if (terms.some((term) => !context.includes(`**${term}**:`))) {
    refuseRepository("repository-unqualified", "path-drift", "structure.required_context_terms", "restore-repository-bytes")
  }
}

function verifyContextMapRoutes(routes: readonly RepositoryQualificationContract["structure"]["required_context_map_routes"][number][]): void {
  const contextMap = readFileSync(resolve(repositoryRoot, "CONTEXT-MAP.md"), "utf8")
  if (routes.some((route) => !contextMapRoutePresent(contextMap, route))) {
    refuseRepository("repository-unqualified", "path-drift", "structure.required_context_map_routes", "restore-repository-bytes")
  }
}

function verifyAgentIndexLinks(links: readonly string[]): void {
  const agentIndex = readFileSync(resolve(repositoryRoot, "docs/agents/README.md"), "utf8")
  if (links.some((link) => !agentIndex.includes(link))) {
    refuseRepository("repository-unqualified", "path-drift", "structure.required_agent_index_links", "restore-repository-bytes")
  }
}

function contextMapRoutePresent(
  contextMap: string,
  route: RepositoryQualificationContract["structure"]["required_context_map_routes"][number],
): boolean {
  const row = contextMap.split("\n").find((line) => line.includes(route.question))
  return row?.includes(route.term) === true && row.includes(route.path)
}

function admissionDrift(owner = "admission.source_closure"): never {
  return refuseRepository(
    "repository-unqualified",
    "admission-closure-drift",
    owner,
    "restore-repository-bytes",
  )
}

function sourceSpecifiers(file: string, source: string): string[] {
  try {
    return staticModuleSpecifiers(file, source)
  } catch (error) {
    if (error instanceof NonliteralModuleSpecifierError) admissionDrift()
    throw error
  }
}

function resolveAdmissionImport(importer: string, specifier: string): string {
  if (!specifier.startsWith(".")) admissionDrift()
  const unresolved = resolve(dirname(resolve(repositoryRoot, importer)), specifier)
  const resolved = admissionCandidates(unresolved).find(isFile)
  if (resolved === undefined) admissionDrift()
  return sourceFile(resolved).relative
}

function discoverAdmissionSourceClosure(entry: string): string[] {
  const pending = [entry]
  const discovered = new Set<string>()
  while (pending.length > 0) {
    const file = pending.pop() as string
    if (discovered.has(file)) continue
    const source = sourceFile(resolve(repositoryRoot, file))
    discovered.add(source.relative)
    pending.push(...sourceSpecifiers(source.relative, readFileSync(source.absolute, "utf8"))
      .filter((specifier) => !specifier.startsWith("node:"))
      .map((specifier) => resolveAdmissionImport(file, specifier)))
  }
  return [...discovered].sort()
}

function verifyAdmission(contract: RepositoryQualificationContract): void {
  const admission = contract.admission
  verifyFirstGreenImplementationTransition(admission.first_green_implementation_transition)
  verifyAdmissionSentinel(admission)
  verifyAdmissionSelfReports(admission.forbidden_self_reports, admission.self_report_files)
  verifyAdmissionManifest(admission.owner_manifest)
  verifyAdmissionClosure(admission.source_entry, admission.source_closure)
  verifyAdmissionProductionSources(admission.runtime_source_paths, admission.source_closure)
  verifyAdmissionProjection(admission.projection_fixture, admission.projection, contract.package_contract)
  verifyAdmissionConsumer(admission.consumer_fixture)
  verifyAdmissionNonClaims(admission.non_claims)
}

function verifyFirstGreenImplementationTransition(rule: string): void {
  const expected = "The first GREEN Implementation change must re-scope this Repository Qualification contract in the same reviewed checkpoint."
  if (rule !== expected) admissionDrift()
}

function verifyAdmissionNonClaims(nonClaims: readonly string[]): void {
  const expected = [
    "installed dependency freedom",
    "distribution",
    "linker semantics",
    "direct observation of network inactivity",
  ]
  if (JSON.stringify(nonClaims) !== JSON.stringify(expected)) admissionDrift()
}

function verifyAdmissionSentinel(admission: RepositoryQualificationContract["admission"]): void {
  const source = readFileSync(resolve(repositoryRoot, admission.sentinel_file), "utf8")
  const escapedName = escapeRegExp(admission.sentinel_name)
  const count = source.match(new RegExp(`^test\\("${escapedName}"`, "gm"))?.length ?? 0
  if (count !== admission.sentinel_count) admissionDrift()
}

function verifyAdmissionSelfReports(forbidden: readonly string[], declaredFiles: readonly string[]): void {
  const inspected = [
    ...new Set([
      ...repositoryEntries(resolve(repositoryRoot, "src"), "src", (name) => name.endsWith(".ts")),
      ...declaredFiles,
    ]),
  ]
  const present = forbidden.some((token) =>
    inspected.some((path) => readFileSync(resolve(repositoryRoot, path), "utf8").includes(token))
  )
  if (present) admissionDrift()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function admissionCandidates(unresolved: string): string[] {
  return extname(unresolved) === ""
    ? [`${unresolved}.ts`, resolve(unresolved, "index.ts")]
    : [unresolved]
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile()
}

function sourceFile(path: string): { absolute: string; relative: string } {
  if (!existsSync(path)) admissionDrift()
  const absolute = realpathSync(path)
  const sourceRoot = realpathSync(resolve(repositoryRoot, "src"))
  const sourceRelative = relative(sourceRoot, absolute).replaceAll("\\", "/")
  if (sourceRelative.startsWith("../") || sourceRelative === "..") admissionDrift()
  return {
    absolute,
    relative: relative(repositoryRoot, absolute).replaceAll("\\", "/"),
  }
}

function verifyAdmissionManifest(path: string): void {
  const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")) as Record<string, unknown>
  if (hasDependencyFieldDrift(manifest)) admissionDrift()
}

function hasDependencyFieldDrift(
  manifest: Record<string, unknown>,
  fields: readonly string[] = dependencyFields,
): boolean {
  return fields.some((field) => {
    const value = manifest[field]
    if (value === undefined) return false
    const dependencies = objectValue(value)
    return dependencies === undefined || Object.keys(dependencies).length !== 0
  })
}

function verifyAdmissionClosure(entry: string, expected: readonly string[]): void {
  const closure = discoverAdmissionSourceClosure(entry)
  if (JSON.stringify(closure) !== JSON.stringify([...expected].sort())) admissionDrift()
}

function verifyAdmissionProductionSources(
  runtimeSourcePaths: readonly string[],
  sourceClosure: readonly string[],
): void {
  const sources = repositoryEntries(
    resolve(repositoryRoot, "src/admission-bootstrap"),
    "src/admission-bootstrap",
    (name) => name.endsWith(".ts"),
  ).filter((path) => !path.includes("/contract-tests/"))
  const runtimeSourceSet = new Set(runtimeSourcePaths)
  verifyAdmissionRuntimeSourcePaths(runtimeSourcePaths, sourceClosure, sources, runtimeSourceSet)
  for (const file of sources) {
    verifyAdmissionProductionSource(file, runtimeSourceSet)
  }
}

function verifyAdmissionRuntimeSourcePaths(
  runtimeSourcePaths: readonly string[],
  sourceClosure: readonly string[],
  sources: readonly string[],
  runtimeSourceSet: ReadonlySet<string>,
): void {
  if (runtimeSourceSet.size !== runtimeSourcePaths.length) admissionDrift("admission.runtime_source_paths")
  if (JSON.stringify([...runtimeSourcePaths].sort()) !== JSON.stringify(runtimeSourcePaths)) {
    admissionDrift("admission.runtime_source_paths")
  }
  if (runtimeSourcePaths.some((path) => isAdmissionRuntimeSourcePathInvalid(path, sourceClosure, sources))) {
    admissionDrift("admission.runtime_source_paths")
  }
}

function isAdmissionRuntimeSourcePathInvalid(
  path: string,
  sourceClosure: readonly string[],
  sources: readonly string[],
): boolean {
  return !sources.includes(path) || !sourceClosure.includes(path)
}

function verifyAdmissionProductionSource(
  file: string,
  runtimeSourceSet: ReadonlySet<string>,
): void {
  const source = readFileSync(resolve(repositoryRoot, file), "utf8")
  if (sourceSpecifiers(file, source).some(isForbiddenAdmissionSpecifier)) admissionDrift()
  const hasRuntime = typescriptRuntimeCode(source).trim() !== ""
  if (hasRuntime !== runtimeSourceSet.has(file)) admissionDrift("admission.runtime_source_paths")
  if (hasGlobalEvalReference(source)) admissionDrift()
}

function hasGlobalEvalReference(source: string): boolean {
  const normalizedSource = typescriptRuntimeCode(source)
  const code = typescriptLexicalCode(normalizedSource)
  if (hasUnqualifiedGlobalObjectReference(code)) return true
  return [...code.matchAll(/\beval\b/g)].some((match) => {
    const index = match.index
    return index !== undefined && isGlobalEvalIdentifier(code, index)
  })
}

function isGlobalEvalIdentifier(code: string, index: number): boolean {
  if (/^\s*:/.test(code.slice(index + "eval".length))) return false
  return isUnqualifiedIdentifier(code, index)
}

function hasUnqualifiedGlobalObjectReference(code: string): boolean {
  return [...code.matchAll(/\b(?:globalThis|global)\b/g)].some((match) => {
    const index = match.index
    if (index === undefined || /^\s*:/.test(code.slice(index + match[0].length))) return false
    return isUnqualifiedIdentifier(code, index)
  })
}

function isUnqualifiedIdentifier(code: string, index: number): boolean {
  const prefix = code.slice(0, index).trimEnd()
  return !prefix.endsWith(".") && !prefix.endsWith("#")
}

function isForbiddenAdmissionSpecifier(specifier: string): boolean {
  return specifier === "node:module" || (!specifier.startsWith(".") && !specifier.startsWith("node:"))
}

function verifyAdmissionProjection(
  path: string,
  expected: RepositoryQualificationContract["admission"]["projection"],
  packageContract: RepositoryQualificationContract["package_contract"],
): void {
  const projection = JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")) as unknown
  if (JSON.stringify(projection) !== JSON.stringify(expected)) admissionDrift()
  const publicEntry = packageContract.exports["./admission-bootstrap"]
  const agreements = [
    expected.name === packageContract.name,
    expected.type === packageContract.type,
    publicEntry !== undefined,
    JSON.stringify(expected.exports) === JSON.stringify({ "./admission-bootstrap": publicEntry }),
  ]
  if (agreements.includes(false)) admissionDrift()
}

function verifyAdmissionConsumer(path: string): void {
  const consumer = readFileSync(resolve(repositoryRoot, path), "utf8")
  if (consumer !== 'await import("agent-plugin-kit/admission-bootstrap")\nconsole.log("admission-bootstrap:loaded")\n') admissionDrift()
}

function packageDrift(owner: string): never {
  throw new QualificationRefusal("repository-unqualified", activeMode, [
    {
      kind: "package-contract-drift",
      owner,
      repair_id: "restore-repository-bytes",
    },
  ])
}

function packageJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")) as Record<string, unknown>
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function packageManifests(directory: string, prefix = ""): string[] {
  return repositoryEntries(directory, prefix, (name) => name === "package.json")
}

class PublicTypeExportParseError extends Error {}

const directPublicTypeDeclaration = /\bexport\s+(?:declare\s+)?(?:type(?!\s*\{)|interface)\s+([^\s=<{;]+)/g
const namedPublicTypeExportBlock = /\bexport\s+(type\s*)?\{([\s\S]*?)\}/g
const declaredPublicValue = /\bexport\s+declare\s+(?:function|const|let|var)\b/g
const ambientPublicDeclaration = /\bdeclare\s+(?:global|module|namespace)\b/g
const unsupportedPublicDecorator = /@/g
const unsupportedPublicTypeExport = /\bexport\s+(?:(?:type\s+)?\*|(?:(?:declare|abstract)\s+)*(?:class|(?:const\s+)?enum|namespace|module|import)\b)/g
const unsupportedDefaultPublicTypeExport = /\bexport\s+default\b/g
const unsupportedPublicTypePatterns = [
  unsupportedPublicDecorator,
  unsupportedPublicTypeExport,
  unsupportedDefaultPublicTypeExport,
]
const publicTypeIdentifier = /^[$A-Z_a-z][$\w]*$/
const namedTypeExport = /^(?:type\s+)?([$A-Z_a-z][$\w]*)(?:\s+as\s+([$A-Z_a-z][$\w]*))?$/
const namedValueExport = /^([$A-Z_a-z][$\w]*)(?:\s+as\s+([$A-Z_a-z][$\w]*))?$/
const supportedRelativeReexport = /^(?:\.\/|\.\.\/)[^\\]+$/
const descendantRelativePath = /^(?!\.\.(?:\/|$)).+$/

type LocatedPublicTypeExport = {
  readonly index: number
  readonly name: string
}

function namedPublicTypeExports(
  path: string,
  source: string,
  match: RegExpMatchArray,
): LocatedPublicTypeExport[] {
  const allTypeOnly = match[1] !== undefined
  const block = match[2] ?? ""
  const specifier = publicReexportSpecifier(source, match)
  return block.split(",").flatMap((entry) =>
    namedPublicTypeExport(path, entry, allTypeOnly, specifier, match.index ?? 0)
  )
}

function directPublicTypeExport(match: RegExpMatchArray): LocatedPublicTypeExport {
  const name = match[1]
  if (name === undefined || !publicTypeIdentifier.test(name)) {
    throw new PublicTypeExportParseError()
  }
  return { index: match.index ?? 0, name }
}

function namedPublicTypeExport(
  path: string,
  entry: string,
  allTypeOnly: boolean,
  specifier: string | undefined,
  index: number,
): LocatedPublicTypeExport[] {
  const normalized = entry.trim()
  if (normalized === "") return []
  const name = namedPublicTypeExportName(path, normalized, allTypeOnly, specifier)
  return name === undefined ? [] : [{ index, name }]
}

function namedPublicTypeExportName(
  path: string,
  entry: string,
  allTypeOnly: boolean,
  specifier: string | undefined,
): string | undefined {
  if (isValueNamedExport(entry, allTypeOnly)) return supportedNamedValueReexport(path, entry, specifier)
  const parsed = entry.match(namedTypeExport)
  if (parsed === null) throw new PublicTypeExportParseError()
  return publicTypeExportName(parsed)
}

function supportedNamedValueReexport(
  path: string,
  entry: string,
  specifier: string | undefined,
): undefined {
  if (!isSupportedConstValueReexport(path, entry, specifier)) {
    throw new PublicTypeExportParseError()
  }
}

function publicReexportSpecifier(source: string, match: RegExpMatchArray): string | undefined {
  const end = (match.index ?? 0) + match[0].length
  const parsed = source.slice(end).match(/^\s+from\s*(["'])([^"']+)\1/)
  return parsed?.[2]
}

function isValueNamedExport(entry: string, allTypeOnly: boolean): boolean {
  return !allTypeOnly && !/^type\s+/.test(entry)
}

function isSupportedConstValueReexport(
  exporterPath: string,
  entry: string,
  specifier: string | undefined,
): boolean {
  const reexport = localValueReexport(entry, specifier)
  if (reexport === undefined) return false
  const target = resolvePublicReexportTarget(exporterPath, reexport.specifier)
  if (target === undefined) return false
  return directlyExportsValueOnlyConst(target, reexport.sourceName)
}

function localValueReexport(
  entry: string,
  specifier: string | undefined,
): { readonly sourceName: string; readonly specifier: string } | undefined {
  const localSpecifier = relativeReexportSpecifier(specifier)
  if (localSpecifier === undefined) return undefined
  const sourceName = namedValueExportSourceName(entry)
  if (sourceName === undefined) return undefined
  return { sourceName, specifier: localSpecifier }
}

function relativeReexportSpecifier(specifier: string | undefined): string | undefined {
  return specifier !== undefined && supportedRelativeReexport.test(specifier) ? specifier : undefined
}

function namedValueExportSourceName(entry: string): string | undefined {
  const parsed = entry.match(namedValueExport)
  return parsed === null ? undefined : parsed[1]
}

function directlyExportsValueOnlyConst(target: string, sourceName: string): boolean {
  const source = readFileSync(target, "utf8")
  const code = typescriptLexicalCode(source)
  const declaration = new RegExp(`\\bexport\\s+const\\s+${escapeRegExp(sourceName)}\\b`, "g")
  const targetPath = relative(repositoryRoot, target).replaceAll("\\", "/")
  const publicTypes = locatedPublicTypeExports(targetPath, source, code).map(({ name }) => name)
  return topLevelMatches(code, declaration).length === 1 && !publicTypes.includes(sourceName)
}

function resolvePublicReexportTarget(exporterPath: string, specifier: string): string | undefined {
  const unresolved = resolve(dirname(resolve(repositoryRoot, exporterPath)), specifier)
  const resolved = admissionCandidates(unresolved).find(isFile)
  if (resolved === undefined) return undefined
  const implementationRoot = ownerImplementationRoot(exporterPath)
  if (implementationRoot === undefined) return undefined
  const absolute = realpathSync(resolved)
  return pathInside(implementationRoot, absolute)
}

function pathInside(root: string, target: string): string | undefined {
  const nativeRelativeTarget = relative(root, target)
  if (isAbsolute(nativeRelativeTarget)) return undefined
  const relativeTarget = nativeRelativeTarget.replaceAll("\\", "/")
  return descendantRelativePath.test(relativeTarget) ? target : undefined
}

function ownerImplementationRoot(exporterPath: string): string | undefined {
  const ownerRoot = realDirectory(dirname(resolve(repositoryRoot, exporterPath)))
  if (ownerRoot === undefined) return undefined
  const implementationRoot = realDirectory(resolve(ownerRoot, "implementation"))
  if (implementationRoot === undefined) return undefined
  return pathInside(ownerRoot, implementationRoot)
}

function realDirectory(path: string): string | undefined {
  if (!existsSync(path)) return undefined
  const absolute = realpathSync(path)
  return statSync(absolute).isDirectory() ? absolute : undefined
}

function publicTypeExportName(match: RegExpMatchArray): string {
  return (match[2] ?? match[1]) as string
}

function isTopLevelMatch(code: string, match: RegExpMatchArray): boolean {
  const prefix = code.slice(0, match.index ?? 0)
  const followsMemberAccess = match[0]?.startsWith("export") === true && prefix.trimEnd().endsWith(".")
  return !followsMemberAccess && prefix.split("{").length === prefix.split("}").length
}

function topLevelMatches(code: string, pattern: RegExp): RegExpMatchArray[] {
  return [...code.matchAll(pattern)].filter((match) => isTopLevelMatch(code, match))
}

function locatedPublicTypeExports(
  path: string,
  source: string,
  code: string,
): LocatedPublicTypeExport[] {
  if (unsupportedPublicTypePatterns.some((pattern) => topLevelMatches(code, pattern).length > 0)) {
    throw new PublicTypeExportParseError()
  }
  const direct = topLevelMatches(code, directPublicTypeDeclaration).map(directPublicTypeExport)
  const named = topLevelMatches(code, namedPublicTypeExportBlock).flatMap((match) =>
    namedPublicTypeExports(path, source, match)
  )
  return [...direct, ...named].sort((left, right) => left.index - right.index)
}

function publicTypeExports(path: string): string[] {
  const source = readFileSync(resolve(repositoryRoot, path), "utf8")
  const code = typescriptLexicalCode(source)
  return [...new Set(locatedPublicTypeExports(path, source, code).map(({ name }) => name))]
}

function runtimeOutputSha256(path: string): string {
  const source = readFileSync(resolve(repositoryRoot, path), "utf8")
  const code = typescriptLexicalCode(source)
  if (
    topLevelMatches(code, declaredPublicValue).length > 0 ||
    topLevelMatches(code, ambientPublicDeclaration).length > 0
  ) {
    throw new PublicTypeExportParseError()
  }
  return createHash("sha256").update(typescriptRuntimeCode(source)).digest("hex")
}

function verifyPackageContract(contract: RepositoryQualificationContract): void {
  const root = packageJson("package.json")
  const manifestPaths = packageManifests(repositoryRoot)
  verifyDependencyBans(manifestPaths, contract.package_contract)
  verifyRootIdentity(root, contract.package_contract)
  verifyRootCollections(root, contract.package_contract)
  verifyPublicTypeExports(contract.package_contract)
  verifyRootScripts(root.scripts, contract.package_contract.scripts)
  verifyOwnerManifests(contract.owner_manifests)
}

function verifyPublicTypeExports(
  expected: RepositoryQualificationContract["package_contract"],
): void {
  if (JSON.stringify(Object.keys(expected.type_exports)) !== JSON.stringify(Object.keys(expected.exports))) {
    packageDrift("package_contract.type_exports")
  }
  if (JSON.stringify(Object.keys(expected.runtime_output_sha256)) !== JSON.stringify(Object.keys(expected.exports))) {
    packageDrift("package_contract.runtime_output_sha256")
  }
  for (const [subpath, target] of Object.entries(expected.exports)) {
    verifyPublicTypeExport(subpath, target, expected.type_exports[subpath])
    verifyPublicRuntimeOutput(subpath, target, expected.runtime_output_sha256[subpath])
  }
}

function verifyPublicTypeExport(
  subpath: string,
  target: string,
  declared: readonly string[] | undefined,
): void {
  const typeOwner = `package_contract.type_exports[${JSON.stringify(subpath)}]`
  let observed: readonly string[]
  try {
    observed = publicTypeExports(target)
  } catch {
    packageDrift(typeOwner)
  }
  if (JSON.stringify(observed) !== JSON.stringify(declared)) packageDrift(typeOwner)
}

function verifyPublicRuntimeOutput(subpath: string, target: string, declaredSha256: string | undefined): void {
  const runtimeOwner = `package_contract.runtime_output_sha256[${JSON.stringify(subpath)}]`
  let observedSha256: string
  try {
    observedSha256 = runtimeOutputSha256(target)
  } catch {
    packageDrift(runtimeOwner)
  }
  if (observedSha256 !== declaredSha256) packageDrift(runtimeOwner)
}

function verifyDependencyBans(
  paths: readonly string[],
  expected: RepositoryQualificationContract["package_contract"],
): void {
  for (const path of paths) {
    verifyManifestDependencyBans(packageJson(path), expected)
  }
}

function verifyManifestDependencyBans(
  manifest: Record<string, unknown>,
  expected: RepositoryQualificationContract["package_contract"],
): void {
  const malformedField = dependencyFields.find((field) => {
    const value = manifest[field]
    return value !== undefined && objectValue(value) === undefined
  })
  if (malformedField !== undefined) packageDrift(`package_contract.${malformedField}`)
  const names = manifestDependencyNames(manifest)
  verifyExactDependencyBans(names, expected.forbidden_dependency_names)
  verifyDependencyFragments(names, expected.forbidden_dependency_name_fragments)
  verifyCatalogBan(manifest, expected.catalogs_allowed)
}

function manifestDependencyNames(manifest: Record<string, unknown>): string[] {
  return dependencyFields.flatMap((field) => Object.keys(objectValue(manifest[field]) ?? {}))
}

function verifyExactDependencyBans(names: readonly string[], forbidden: readonly string[]): void {
  const match = forbidden.find((name) => names.includes(name))
  if (match !== undefined) packageDrift(`package_contract.forbidden_dependency_names.${match}`)
}

function verifyDependencyFragments(names: readonly string[], forbidden: readonly string[]): void {
  const match = forbidden.find((fragment) =>
    names.some((name) => name.toLowerCase().includes(fragment.toLowerCase()))
  )
  if (match !== undefined) {
    packageDrift(`package_contract.forbidden_dependency_name_fragments.${match}`)
  }
}

function verifyCatalogBan(manifest: Record<string, unknown>, allowed: false): void {
  if (!allowed && (manifest.catalog !== undefined || manifest.catalogs !== undefined)) {
    packageDrift("package_contract.catalogs_allowed")
  }
}

function verifyRootIdentity(
  root: Record<string, unknown>,
  expected: RepositoryQualificationContract["package_contract"],
): void {
  const fields: readonly [string, unknown][] = [
    ["name", expected.name],
    ["version", expected.version],
    ["private", expected.private],
    ["type", expected.type],
    ["packageManager", expected.package_manager],
  ]
  if (fields.some(([field, value]) => root[field] !== value)) packageDrift("package_contract")
}

function verifyRootCollections(
  root: Record<string, unknown>,
  expected: RepositoryQualificationContract["package_contract"],
): void {
  const checks: readonly [unknown, unknown, string][] = [
    [root.workspaces, expected.workspaces, "package_contract.workspaces"],
    [root.exports, expected.exports, "package_contract.exports"],
    [root.bin, expected.bin, "package_contract.bin"],
    [root.devDependencies, expected.dev_dependencies, "package_contract.dev_dependencies"],
  ]
  const mismatch = checks.find(([actual, declared]) => JSON.stringify(actual) !== JSON.stringify(declared))
  if (mismatch !== undefined) packageDrift(mismatch[2])
}

function verifyRootScripts(value: unknown, expected: Readonly<Record<string, string>>): void {
  const scripts = objectValue(value)
  if (scripts === undefined) packageDrift("package_contract.scripts")
  const mismatch = Object.entries(expected).find(([name, script]) => scripts[name] !== script)
  if (mismatch !== undefined) packageDrift(`package_contract.scripts.${mismatch[0]}`)
  const undeclared = Object.keys(scripts).find((name) => expected[name] === undefined)
  if (undeclared !== undefined) packageDrift(`package_contract.scripts.${undeclared}`)
}

function verifyOwnerManifests(
  declarations: Readonly<Record<string, RepositoryQualificationContract["owner_manifests"][string]>>,
): void {
  const declaredPaths = Object.values(declarations).map((declaration) => declaration.path).sort()
  const observedPaths = packageManifests(resolve(repositoryRoot, "src"), "src").sort()
  if (JSON.stringify(declaredPaths) !== JSON.stringify(observedPaths)) packageDrift("owner_manifests")
  const mismatch = Object.entries(declarations).find(([_, declaration]) => {
    const manifest = packageJson(declaration.path)
    return ownerManifestDrift(manifest, declaration)
  })
  if (mismatch !== undefined) packageDrift(`owner_manifests.${mismatch[0]}`)
}

function ownerManifestDrift(
  manifest: Record<string, unknown>,
  declaration: RepositoryQualificationContract["owner_manifests"][string],
): boolean {
  const fieldsMatch = [
    manifest.name === declaration.name,
    manifest.private === declaration.private,
    manifest.type === declaration.type,
    JSON.stringify(manifest.exports) === JSON.stringify(declaration.exports),
  ].every(Boolean)
  if (!fieldsMatch) return true
  return hasDependencyFieldDrift(manifest, declaration.empty_dependency_fields)
}

function shellDrift(owner: string): never {
  throw new QualificationRefusal("repository-unqualified", activeMode, [
    {
      kind: "shell-drift",
      owner,
      repair_id: "restore-repository-bytes",
    },
  ])
}

function observeShell(command: string): { exitCode: number; record: Record<string, unknown> } {
  const words = shellCommandWords(command)
  const result = Bun.spawnSync({
    cmd: [words[0], words[1], "--silent", ...words.slice(2)],
    cwd: repositoryRoot,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    stdout: "pipe",
    stderr: "pipe",
  })
  return { exitCode: result.exitCode, record: shellRecord(result.stdout.toString()) }
}

function shellCommandWords(command: string): [string, string, ...string[]] {
  const words = command.trim().split(/\s+/)
  if (words.length < 3 || words[0] !== "bun" || words[1] !== "run") shellDrift("shells")
  return words as [string, string, ...string[]]
}

function shellRecord(output: string): Record<string, unknown> {
  const lines = output.trim().split("\n")
  const lastLine = lines.at(-1)
  if (lastLine === undefined || lastLine === "") shellDrift("shells")
  try {
    return JSON.parse(lastLine) as Record<string, unknown>
  } catch {
    shellDrift("shells")
  }
}

function verifyShells(contract: RepositoryQualificationContract): void {
  const maintenance = contract.shells.maintenance_cli
  verifyShellRoute(maintenance.script, maintenance.command, "shells.maintenance_cli")
  verifyShell(
    maintenance.command,
    maintenance.red_exit,
    maintenance.proof_schema_version,
    "verdict",
    maintenance.red_verdict,
    "shells.maintenance_cli",
  )

  const localLink = contract.shells.maintenance_cli_local_link
  verifyShellRoute(localLink.script, localLink.command, "shells.maintenance_cli_local_link")
  verifyShell(
    localLink.command,
    localLink.red_exit,
    localLink.proof_schema_version,
    "sentinel",
    localLink.red_sentinel,
    "shells.maintenance_cli_local_link",
  )
}

function verifyShellRoute(script: string, command: string, owner: string): void {
  if (command !== `bun run ${script}`) shellDrift(`${owner}.script`)
  const scripts = objectValue(packageJson("package.json").scripts)
  if (scripts?.[script] !== shellCommandSource(script)) shellDrift(`${owner}.script`)
}

function shellCommandSource(script: string): string {
  if (script === "audit:maintenance-cli") return "bun run clean-fixture/audit-maintenance-cli.ts"
  if (script === "verify:maintenance-cli:local-link") {
    return "bun run clean-fixture/verify-maintenance-cli-local-link.ts"
  }
  shellDrift("shells")
}

function verifyFallow(contract: RepositoryQualificationContract["fallow"]): void {
  verifyExactJsonFile(contract.config_file, contract.config, "fallow.config")
  verifyExactJsonFile(
    contract.vscode_settings_file,
    contract.vscode_settings,
    "fallow.vscode_settings",
  )
  verifyFallowGitignore(contract)
  verifyFallowSkills(contract)
}

function verifyExactJsonFile(path: string, expected: unknown, owner: string): void {
  const value = JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")) as unknown
  if (JSON.stringify(value) !== JSON.stringify(expected)) fallowDrift(owner)
}

function verifyFallowGitignore(contract: RepositoryQualificationContract["fallow"]): void {
  const gitignore = readFileSync(resolve(repositoryRoot, contract.gitignore_file), "utf8").split("\n")
  if (gitignore.filter((line) => line === contract.gitignore_line).length !== 1) {
    fallowDrift("fallow.gitignore_line")
  }
}

function verifyFallowSkills(contract: RepositoryQualificationContract["fallow"]): void {
  const skillDrift = contract.skill_files.some((file) => {
    const source = readFileSync(resolve(repositoryRoot, file), "utf8")
    return !source.includes(contract.skill_version_marker) || !source.includes(contract.skill_target)
  })
  if (skillDrift) fallowDrift("fallow.skill_files")
}

function fallowDrift(owner: string): never {
  return refuseRepository(
    "repository-unqualified",
    "path-drift",
    owner,
    "restore-repository-bytes",
  )
}

function verifyShell(
  command: string,
  expectedExit: number,
  expectedSchema: number,
  field: string,
  expectedValue: string,
  owner: string,
): void {
  const observation = observeShell(command)
  if (observation.exitCode !== expectedExit) shellDrift(`${owner}.red_exit`)
  if (observation.record.schema_version !== expectedSchema) shellDrift(`${owner}.proof_schema_version`)
  if (observation.record[field] !== expectedValue) shellDrift(`${owner}.red_${field}`)
}

function readContract(): RepositoryQualificationContract {
  const root = exactRecord(readContractValue(), "contract", [
    "schema_version",
    "bun",
    "structure",
    "proof_groups",
    "aggregate",
    "admission",
    "shells",
    "package_contract",
    "owner_manifests",
    "repository_quality_tests",
    "fallow",
    "workspace_selectors",
  ])
  try {
    validateContractRecords(root)
  } catch (error) {
    if (error instanceof QualificationRefusal) throw error
    refuseRepository("contract-invalid", "unknown-contract-key", relative(repositoryRoot, contractPath), "restore-current-declaration")
  }
  return root as unknown as RepositoryQualificationContract
}

function readContractValue(): unknown {
  try {
    return JSON.parse(readFileSync(contractPath, "utf8")) as unknown
  } catch {
    refuseRepository("contract-invalid", "unknown-contract-key", relative(repositoryRoot, contractPath), "restore-current-declaration")
  }
}

function validateContractRecords(root: Record<string, unknown>): void {
  contractLiteral(root.schema_version, 1, "schema_version")
  const bun = exactRecord(root.bun, "bun", ["config_file", "install_auto"])
  contractString(bun.config_file, "bun.config_file")
  contractLiteral(bun.install_auto, "disable", "bun.install_auto")
  validateStructureRecord(root.structure)
  validateProofGroupRecords(root.proof_groups)
  validateAggregateRecord(root.aggregate)
  validateAdmissionRecord(root.admission)
  validateShellRecords(root.shells)
  validatePackageContractRecord(root.package_contract)
  validateOwnerManifestRecords(root.owner_manifests)
  validateRepositoryQualityRecords(root.repository_quality_tests)
  validateFallowRecord(root.fallow)
  validateWorkspaceSelectorRecords(root.workspace_selectors)
}

function validatePackageContractRecord(value: unknown): void {
  const contract = exactRecord(value, "package_contract", [
    "name",
    "version",
    "private",
    "type",
    "package_manager",
    "workspaces",
    "exports",
    "type_exports",
    "runtime_output_sha256",
    "bin",
    "scripts",
    "dev_dependencies",
    "forbidden_dependency_names",
    "forbidden_dependency_name_fragments",
    "catalogs_allowed",
  ])
  contractString(contract.name, "package_contract.name")
  contractString(contract.version, "package_contract.version")
  contractBoolean(contract.private, "package_contract.private")
  contractString(contract.type, "package_contract.type")
  contractString(contract.package_manager, "package_contract.package_manager")
  contractStringArray(contract.workspaces, "package_contract.workspaces")
  contractStringRecord(contract.exports, "package_contract.exports")
  contractStringArrayRecord(contract.type_exports, "package_contract.type_exports")
  contractStringRecord(contract.runtime_output_sha256, "package_contract.runtime_output_sha256")
  contractStringRecord(contract.bin, "package_contract.bin")
  contractStringRecord(contract.scripts, "package_contract.scripts")
  contractStringRecord(contract.dev_dependencies, "package_contract.dev_dependencies")
  contractStringArray(contract.forbidden_dependency_names, "package_contract.forbidden_dependency_names")
  contractStringArray(
    contract.forbidden_dependency_name_fragments,
    "package_contract.forbidden_dependency_name_fragments",
  )
  contractLiteral(contract.catalogs_allowed, false, "package_contract.catalogs_allowed")
}

function validateStructureRecord(value: unknown): void {
  const structure = exactRecord(value, "structure", [
    "required_paths",
    "forbidden_paths",
    "forbidden_source_path_segments",
    "required_agent_pointers",
    "required_context_terms",
    "required_context_map_routes",
    "required_agent_index_links",
  ])
  contractStringArray(structure.required_paths, "structure.required_paths")
  contractStringArray(structure.forbidden_paths, "structure.forbidden_paths")
  contractStringArray(
    structure.forbidden_source_path_segments,
    "structure.forbidden_source_path_segments",
  )
  contractStringArray(structure.required_agent_pointers, "structure.required_agent_pointers")
  contractStringArray(structure.required_context_terms, "structure.required_context_terms")
  contractStringArray(structure.required_agent_index_links, "structure.required_agent_index_links")
  for (const [index, route] of contractArray(
    structure.required_context_map_routes,
    "structure.required_context_map_routes",
  ).entries()) {
    const owner = `structure.required_context_map_routes[${index}]`
    const record = exactRecord(route, owner, ["question", "term", "path"])
    contractString(record.question, `${owner}.question`)
    contractString(record.term, `${owner}.term`)
    contractString(record.path, `${owner}.path`)
  }
}

function validateProofGroupRecords(value: unknown): void {
  for (const [index, group] of contractArray(value, "proof_groups").entries()) {
    const owner = `proof_groups[${index}]`
    const record = exactRecord(group, owner, ["id", "script", "files", "tests", "passed", "failed", "skipped", "failure_classes"])
    contractString(record.id, `${owner}.id`)
    contractString(record.script, `${owner}.script`)
    contractStringArray(record.files, `${owner}.files`)
    validateBalancedCounts(record, owner)
  }
}

function validateAggregateRecord(value: unknown): void {
  const aggregate = exactRecord(value, "aggregate", ["script", "selected_files", "files", "tests", "passed", "failed", "skipped", "failure_classes"])
  contractString(aggregate.script, "aggregate.script")
  contractStringArray(aggregate.selected_files, "aggregate.selected_files")
  contractInteger(aggregate.files, "aggregate.files")
  validateBalancedCounts(aggregate, "aggregate")
}

function validateBalancedCounts(record: Record<string, unknown>, owner: string): void {
  contractInteger(record.tests, `${owner}.tests`)
  contractInteger(record.passed, `${owner}.passed`)
  contractInteger(record.failed, `${owner}.failed`)
  contractInteger(record.skipped, `${owner}.skipped`)
  contractIntegerRecord(record.failure_classes, `${owner}.failure_classes`)
}

function validateAdmissionRecord(value: unknown): void {
  const admission = exactRecord(value, "admission", [
    "proof_layer",
    "first_green_implementation_transition",
    "sentinel_file",
    "sentinel_name",
    "sentinel_count",
    "source_entry",
    "source_closure",
    "runtime_source_paths",
    "owner_manifest",
    "consumer_fixture",
    "projection_fixture",
    "projection",
    "forbidden_self_reports",
    "self_report_files",
    "non_claims",
  ])
  contractLiteral(admission.proof_layer, "public-process", "admission.proof_layer")
  contractString(admission.first_green_implementation_transition, "admission.first_green_implementation_transition")
  contractString(admission.sentinel_file, "admission.sentinel_file")
  contractString(admission.sentinel_name, "admission.sentinel_name")
  contractInteger(admission.sentinel_count, "admission.sentinel_count")
  contractString(admission.source_entry, "admission.source_entry")
  contractStringArray(admission.source_closure, "admission.source_closure")
  contractStringArray(admission.runtime_source_paths, "admission.runtime_source_paths")
  contractString(admission.owner_manifest, "admission.owner_manifest")
  contractString(admission.consumer_fixture, "admission.consumer_fixture")
  contractString(admission.projection_fixture, "admission.projection_fixture")
  contractStringArray(admission.forbidden_self_reports, "admission.forbidden_self_reports")
  contractStringArray(admission.self_report_files, "admission.self_report_files")
  contractStringArray(admission.non_claims, "admission.non_claims")
  const projection = exactRecord(admission.projection, "admission.projection", ["name", "type", "exports"])
  contractString(projection.name, "admission.projection.name")
  contractString(projection.type, "admission.projection.type")
  contractStringRecord(projection.exports, "admission.projection.exports")
}

function validateShellRecords(value: unknown): void {
  const shells = exactRecord(value, "shells", ["maintenance_cli", "maintenance_cli_local_link"])
  const cli = exactRecord(shells.maintenance_cli, "shells.maintenance_cli", ["script", "command", "red_exit", "red_verdict", "proof_schema_version"])
  contractString(cli.script, "shells.maintenance_cli.script")
  contractString(cli.command, "shells.maintenance_cli.command")
  contractInteger(cli.red_exit, "shells.maintenance_cli.red_exit")
  contractString(cli.red_verdict, "shells.maintenance_cli.red_verdict")
  contractInteger(cli.proof_schema_version, "shells.maintenance_cli.proof_schema_version")
  const localLink = exactRecord(shells.maintenance_cli_local_link, "shells.maintenance_cli_local_link", ["script", "command", "red_exit", "red_sentinel", "proof_schema_version"])
  contractString(localLink.script, "shells.maintenance_cli_local_link.script")
  contractString(localLink.command, "shells.maintenance_cli_local_link.command")
  contractInteger(localLink.red_exit, "shells.maintenance_cli_local_link.red_exit")
  contractString(localLink.red_sentinel, "shells.maintenance_cli_local_link.red_sentinel")
  contractInteger(localLink.proof_schema_version, "shells.maintenance_cli_local_link.proof_schema_version")
}

function validateOwnerManifestRecords(value: unknown): void {
  for (const [ownerName, declaration] of Object.entries(contractRecord(value, "owner_manifests"))) {
    const owner = `owner_manifests.${ownerName}`
    const record = exactRecord(declaration, owner, ["path", "name", "private", "type", "exports", "empty_dependency_fields"])
    contractString(record.path, `${owner}.path`)
    contractString(record.name, `${owner}.name`)
    contractBoolean(record.private, `${owner}.private`)
    contractString(record.type, `${owner}.type`)
    contractStringRecord(record.exports, `${owner}.exports`)
    contractStringArray(record.empty_dependency_fields, `${owner}.empty_dependency_fields`)
  }
}

function validateRepositoryQualityRecords(value: unknown): void {
  for (const [index, declaration] of contractArray(value, "repository_quality_tests").entries()) {
    const owner = `repository_quality_tests[${index}]`
    const record = exactRecord(declaration, owner, ["path", "tests"])
    contractString(record.path, `${owner}.path`)
    contractInteger(record.tests, `${owner}.tests`)
  }
}

function validateFallowRecord(value: unknown): void {
  const fallow = exactRecord(value, "fallow", [
    "config_file",
    "config",
    "vscode_settings_file",
    "vscode_settings",
    "gitignore_file",
    "gitignore_line",
    "skill_files",
    "skill_version_marker",
    "skill_target",
  ])
  contractString(fallow.config_file, "fallow.config_file")
  validateFallowConfig(fallow.config)
  contractString(fallow.vscode_settings_file, "fallow.vscode_settings_file")
  contractStringRecord(fallow.vscode_settings, "fallow.vscode_settings")
  contractString(fallow.gitignore_file, "fallow.gitignore_file")
  contractString(fallow.gitignore_line, "fallow.gitignore_line")
  contractStringArray(fallow.skill_files, "fallow.skill_files")
  contractString(fallow.skill_version_marker, "fallow.skill_version_marker")
  contractString(fallow.skill_target, "fallow.skill_target")
}

function validateFallowConfig(value: unknown): void {
  const config = exactRecord(value, "fallow.config", ["$schema", "typeAware", "audit", "rules"])
  contractString(config.$schema, "fallow.config.$schema")
  const typeAware = exactRecord(config.typeAware, "fallow.config.typeAware", ["enabled", "require"])
  contractBoolean(typeAware.enabled, "fallow.config.typeAware.enabled")
  contractLiteral(typeAware.require, "complete", "fallow.config.typeAware.require")
  const audit = exactRecord(config.audit, "fallow.config.audit", ["gate"])
  contractLiteral(audit.gate, "new-only", "fallow.config.audit.gate")
  contractStringRecord(config.rules, "fallow.config.rules")
}

function validateWorkspaceSelectorRecords(value: unknown): void {
  for (const [index, selector] of contractArray(value, "workspace_selectors").entries()) {
    const owner = `workspace_selectors[${index}]`
    const record = exactRecord(selector, owner, [
      "id",
      "command",
      "package_directory",
      "files",
      "tests",
      "passed",
      "failed",
      "skipped",
      "failure_classes",
    ])
    contractString(record.id, `${owner}.id`)
    contractStringArray(record.command, `${owner}.command`)
    contractString(record.package_directory, `${owner}.package_directory`)
    contractStringArray(record.files, `${owner}.files`)
    validateBalancedCounts(record, owner)
  }
}

function contractArray(value: unknown, owner: string): readonly unknown[] {
  if (!Array.isArray(value)) contractInvalid(owner)
  return value
}

function contractStringArray(value: unknown, owner: string): readonly string[] {
  const values = contractArray(value, owner)
  if (values.some((entry) => typeof entry !== "string")) contractInvalid(owner)
  return values as readonly string[]
}

function contractStringRecord(value: unknown, owner: string): Readonly<Record<string, string>> {
  const record = contractRecord(value, owner)
  if (Object.values(record).some((entry) => typeof entry !== "string")) contractInvalid(owner)
  return record as Readonly<Record<string, string>>
}

function contractStringArrayRecord(
  value: unknown,
  owner: string,
): Readonly<Record<string, readonly string[]>> {
  const record = contractRecord(value, owner)
  for (const [key, entry] of Object.entries(record)) {
    contractStringArray(entry, `${owner}[${JSON.stringify(key)}]`)
  }
  return record as Readonly<Record<string, readonly string[]>>
}

function contractIntegerRecord(value: unknown, owner: string): Readonly<Record<string, number>> {
  const record = contractRecord(value, owner)
  if (Object.values(record).some((entry) => !isContractInteger(entry))) contractInvalid(owner)
  return record as Readonly<Record<string, number>>
}

function contractString(value: unknown, owner: string): string {
  if (typeof value !== "string") contractInvalid(owner)
  return value
}

function contractBoolean(value: unknown, owner: string): boolean {
  if (typeof value !== "boolean") contractInvalid(owner)
  return value
}

function contractInteger(value: unknown, owner: string): number {
  if (!isContractInteger(value)) contractInvalid(owner)
  return value
}

function isContractInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function contractLiteral<T extends string | number | boolean>(value: unknown, expected: T, owner: string): T {
  if (value !== expected) contractInvalid(owner)
  return expected
}

function contractInvalid(owner: string): never {
  return refuseRepository("contract-invalid", "unknown-contract-key", owner, "restore-current-declaration")
}

function exactRecord(
  value: unknown,
  owner: string,
  keys: readonly string[],
): Record<string, unknown> {
  const record = contractRecord(value, owner)
  const allowed = new Set(keys)
  const unknown = Object.keys(record).find((key) => !allowed.has(key))
  if (unknown !== undefined) {
    const unknownOwner = owner === "contract" ? unknown : `${owner}.${unknown}`
    refuseRepository("contract-invalid", "unknown-contract-key", unknownOwner, "restore-current-declaration")
  }
  return record
}

function contractRecord(value: unknown, owner: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    refuseRepository("contract-invalid", "unknown-contract-key", owner, "restore-current-declaration")
  }
  return value as Record<string, unknown>
}

function verifyRepository(contract: RepositoryQualificationContract): ProofObservation | undefined {
  verifyBunPolicy(contract.bun)
  verifyStructurePaths(contract)
  verifyAdmission(contract)
  verifyPackageContract(contract)
  verifyFallow(contract.fallow)
  verifyRepositoryQualityTests(contract.repository_quality_tests)
  verifySelectors(contract)
  verifyShells(contract)
  verifyProofGroups(contract.proof_groups)
  verifyCounts(contract.aggregate, "aggregate")
  return activeMode === "structure-only" ? undefined : observeProof(contract)
}

function verifyProofGroups(groups: readonly RepositoryProofGroup[]): void {
  for (const [index, group] of groups.entries()) {
    verifyCounts(group, `proof_groups[${index}]`)
  }
}

function verifyCounts(counts: BalancedCounts, owner: string): void {
  if (counts.tests !== counts.passed + counts.failed + counts.skipped) {
    refuseRepository("repository-unqualified", "count-mismatch", owner, "restore-current-declaration")
  }
  if (failureClassDrift(counts)) {
    refuseRepository("repository-unqualified", "failure-class-drift", `${owner}.failure_classes`, "restore-current-declaration")
  }
}

function observeProof(contract: RepositoryQualificationContract): ProofObservation {
  return withPrivateReceiptDirectory((directory) => {
    observeWorkspaceSelectors(contract.workspace_selectors, directory)
    const groups = contract.proof_groups.map((group, index) => observeGroup(group, index, directory))
    const aggregate = observeSelection(
      contract.aggregate.selected_files,
      contract.aggregate,
      "aggregate",
      join(directory, "aggregate.xml"),
    )
    return { groups, aggregate }
  })
}

function observeWorkspaceSelectors(
  selectors: readonly WorkspaceSelector[],
  directory: string,
): void {
  for (const [index, selector] of selectors.entries()) {
    const owner = `workspace_selectors[${index}]`
    const receiptPath = join(directory, `workspace-${index}.xml`)
    const result = Bun.spawnSync({
      cmd: [...selector.command, "--reporter=junit", "--reporter-outfile", receiptPath],
      cwd: repositoryRoot,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      stdout: "pipe",
      stderr: "pipe",
    })
    verifyProcessExit(result.exitCode, selector, owner)
    const observed = parseJUnitReceipt(readProofReceipt(receiptPath, owner), selector.files, owner)
    if (!sameObservedCounts(selector, observed)) refuseProofProcess(owner)
  }
}

function withPrivateReceiptDirectory<T>(run: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), "agent-plugin-kit-qualification-proof-"))
  try {
    return run(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function observeGroup(
  group: RepositoryProofGroup,
  index: number,
  directory: string,
): ObservedCounts & { id: string } {
  const owner = `proof_groups[${index}]`
  const observed = observeSelection(group.files, group, owner, join(directory, `group-${index}.xml`))
  return { id: group.id, ...observed }
}

function observeSelection(
  files: readonly string[],
  expected: BalancedCounts,
  owner: string,
  receiptPath: string,
): ObservedCounts {
  const observed = runTestProcess(files, expected, owner, receiptPath)
  if (!sameObservedCounts(expected, observed)) refuseProofProcess(owner)
  return observed
}

function runTestProcess(
  files: readonly string[],
  expected: BalancedCounts,
  owner: string,
  receiptPath: string,
): ObservedCounts {
  verifyUniqueProofFiles(files, owner)
  const result = Bun.spawnSync({
    cmd: ["bun", "test", ...files, "--reporter=junit", "--reporter-outfile", receiptPath],
    cwd: repositoryRoot,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    stdout: "pipe",
    stderr: "pipe",
  })
  verifyProcessExit(result.exitCode, expected, owner)
  return parseJUnitReceipt(readProofReceipt(receiptPath, owner), files, owner)
}

function verifyUniqueProofFiles(files: readonly string[], owner: string): void {
  if (new Set(files).size !== files.length) refuseProofProcess(owner)
}

function verifyProcessExit(exitCode: number, expected: BalancedCounts, owner: string): void {
  if (exitCode !== expectedProcessExit(expected)) refuseProofProcess(owner)
}

function readProofReceipt(receiptPath: string, owner: string): string {
  if (!isFile(receiptPath)) refuseProofProcess(owner)
  const receipt = readFileSync(receiptPath, "utf8")
  if (receipt.trim() === "") refuseProofProcess(owner)
  return receipt
}

function expectedProcessExit(expected: BalancedCounts): number {
  return expected.failed === 0 ? 0 : 1
}

function parseJUnitReceipt(
  source: string,
  files: readonly string[],
  owner: string,
): ObservedCounts {
  const root = singleXmlTag(source, /<testsuites\b[^>]*>/g, owner)
  verifyJUnitDocument(source, owner)
  const suites = [...source.matchAll(/<testsuite\b[^>]*>/g)].map((match) => ({
    tag: match[0] as string,
    index: match.index ?? -1,
  }))
  verifyJUnitSuiteCount(suites, files, owner)
  const expectedFiles = new Set(files)
  const observedFiles = new Set<string>()
  const parsed = suites.map((suite, index) => parseJUnitSuite(source, suites, suite, index, expectedFiles, observedFiles, owner))
  verifyObservedFileCount(observedFiles, expectedFiles, owner)
  const totals = sumJUnitSuites(parsed)
  verifyJUnitRoot(root, totals, owner)
  return { files: parsed.length, ...totals }
}

function verifyJUnitDocument(source: string, owner: string): void {
  const closingTags = source.match(/<\/testsuites>/g) ?? []
  if (!source.includes("</testsuites>") || closingTags.length !== 1) refuseProofProcess(owner)
}

function verifyJUnitSuiteCount(
  suites: readonly JunitSuiteMatch[],
  files: readonly string[],
  owner: string,
): void {
  if (suites.length !== files.length) refuseProofProcess(owner)
}

function verifyObservedFileCount(
  observedFiles: ReadonlySet<string>,
  expectedFiles: ReadonlySet<string>,
  owner: string,
): void {
  if (observedFiles.size !== expectedFiles.size) refuseProofProcess(owner)
}

function singleXmlTag(source: string, pattern: RegExp, owner: string): string {
  const tags = [...source.matchAll(pattern)]
  const tag = tags.length === 1 ? tags[0]?.[0] : undefined
  if (tag === undefined) refuseProofProcess(owner)
  return tag
}

function parseJUnitSuite(
  source: string,
  suites: readonly JunitSuiteMatch[],
  suite: JunitSuiteMatch,
  index: number,
  expectedFiles: ReadonlySet<string>,
  observedFiles: Set<string>,
  owner: string,
): BalancedCounts & { file: string } {
  const file = xmlAttribute(suite.tag, "file", owner)
  verifyJUnitSuiteFile(file, expectedFiles, observedFiles, owner)
  observedFiles.add(file)
  const body = junitSuiteBody(source, suites, suite, index, owner)
  const counts = junitCounts(suite.tag, owner)
  const failures = [...body.matchAll(/<failure\b[^>]*>/g)]
  const skipped = junitSkippedCount(body)
  verifyJUnitSuiteBody(body, counts, failures.length, skipped, owner)
  return {
    file,
    tests: counts.tests,
    passed: counts.tests - counts.failed - counts.skipped,
    failed: counts.failed,
    skipped: counts.skipped,
    failure_classes: junitFailureClasses(failures, owner),
  }
}

function verifyJUnitSuiteFile(
  file: string,
  expectedFiles: ReadonlySet<string>,
  observedFiles: ReadonlySet<string>,
  owner: string,
): void {
  if (!expectedFiles.has(file) || observedFiles.has(file)) refuseProofProcess(owner)
}

function junitSkippedCount(body: string): number {
  return [...body.matchAll(/<skipped\b[^>]*\/?\s*>/g)].length
}

function verifyJUnitSuiteBody(
  body: string,
  counts: Pick<BalancedCounts, "tests" | "failed" | "skipped">,
  failureCount: number,
  skippedCount: number,
  owner: string,
): void {
  verifyJUnitTestCount(body, counts.tests, owner)
  verifyJUnitFailureCount(failureCount, counts.failed, owner)
  verifyJUnitSkippedCount(skippedCount, counts.skipped, owner)
  if (body.includes("<error")) refuseProofProcess(owner)
}

function verifyJUnitTestCount(body: string, expected: number, owner: string): void {
  if ([...body.matchAll(/<testcase\b[^>]*>/g)].length !== expected) refuseProofProcess(owner)
}

function verifyJUnitFailureCount(actual: number, expected: number, owner: string): void {
  if (actual !== expected) refuseProofProcess(owner)
}

function verifyJUnitSkippedCount(actual: number, expected: number, owner: string): void {
  if (actual !== expected) refuseProofProcess(owner)
}

function junitSuiteBody(
  source: string,
  suites: readonly JunitSuiteMatch[],
  suite: JunitSuiteMatch,
  index: number,
  owner: string,
): string {
  const start = suite.index + suite.tag.length
  const closingRoot = source.indexOf("</testsuites>", start)
  const nextSuite = suites[index + 1]?.index ?? closingRoot
  verifyJUnitSuiteBounds(suite, start, nextSuite, closingRoot, owner)
  const body = source.slice(start, nextSuite)
  if (!body.includes("</testsuite>")) refuseProofProcess(owner)
  return body
}

function verifyJUnitSuiteBounds(
  suite: JunitSuiteMatch,
  start: number,
  nextSuite: number,
  closingRoot: number,
  owner: string,
): void {
  if (suite.index < 0 || nextSuite < start || closingRoot < 0) refuseProofProcess(owner)
}

function junitCounts(tag: string, owner: string): Pick<BalancedCounts, "tests" | "failed" | "skipped"> {
  return {
    tests: xmlInteger(tag, "tests", owner),
    failed: xmlInteger(tag, "failures", owner),
    skipped: xmlInteger(tag, "skipped", owner),
  }
}

function xmlInteger(tag: string, attribute: string, owner: string): number {
  const value = Number(xmlAttribute(tag, attribute, owner))
  if (!Number.isInteger(value) || value < 0) refuseProofProcess(owner)
  return value
}

function xmlAttribute(tag: string, attribute: string, owner: string): string {
  const match = tag.match(new RegExp(`\\b${attribute}="([^"]*)"`))
  const value = match?.[1]
  if (value === undefined) refuseProofProcess(owner)
  return value
}

function junitFailureClasses(
  failures: readonly RegExpMatchArray[],
  owner: string,
): Readonly<Record<string, number>> {
  const classes: Record<string, number> = {}
  for (const failure of failures) {
    const message = xmlAttribute(failure[0] as string, "message", owner)
    const failureClass = [...knownFailureClasses].find((candidate) => message.includes(`${candidate}:`))
    if (failureClass === undefined) refuseProofProcess(owner)
    classes[failureClass] = (classes[failureClass] ?? 0) + 1
  }
  return classes
}

function sumJUnitSuites(suites: readonly (BalancedCounts & { file: string })[]): BalancedCounts {
  return suites.reduce(
    (total, suite) => ({
      tests: total.tests + suite.tests,
      passed: total.passed + suite.passed,
      failed: total.failed + suite.failed,
      skipped: total.skipped + suite.skipped,
      failure_classes: mergeFailureClasses(total.failure_classes, suite.failure_classes),
    }),
    { tests: 0, passed: 0, failed: 0, skipped: 0, failure_classes: {} },
  )
}

function mergeFailureClasses(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const merged: Record<string, number> = { ...left }
  for (const [failureClass, count] of Object.entries(right)) {
    merged[failureClass] = (merged[failureClass] ?? 0) + count
  }
  return merged
}

function verifyJUnitRoot(root: string, totals: BalancedCounts, owner: string): void {
  const rootCounts = junitCounts(root, owner)
  if (
    rootCounts.tests !== totals.tests ||
    rootCounts.failed !== totals.failed ||
    rootCounts.skipped !== totals.skipped
  ) refuseProofProcess(owner)
}

function sameObservedCounts(expected: BalancedCounts, observed: ObservedCounts): boolean {
  const expectedValues = [expected.tests, expected.passed, expected.failed, expected.skipped]
  const observedValues = [observed.tests, observed.passed, observed.failed, observed.skipped]
  return expectedValues.every((value, index) => value === observedValues[index]) &&
    JSON.stringify(expected.failure_classes) === JSON.stringify(observed.failure_classes)
}

function failureClassDrift(counts: BalancedCounts): boolean {
  if (hasUnknownFailureClass(counts.failure_classes)) return true
  if (failureClassTotal(counts.failure_classes) !== counts.failed) return true
  return counts.failed === 0 && Object.keys(counts.failure_classes).length !== 0
}

function hasUnknownFailureClass(failureClasses: Readonly<Record<string, number>>): boolean {
  return Object.keys(failureClasses).some((failureClass) => !knownFailureClasses.has(failureClass))
}

function failureClassTotal(failureClasses: Readonly<Record<string, number>>): number {
  return Object.values(failureClasses).reduce((total, count) => total + count, 0)
}

function readMode(): "complete" | "structure-only" {
  const argumentsAfterScript = process.argv.slice(2)
  if (
    argumentsAfterScript.some((argument) => argument !== "--structure-only") ||
    argumentsAfterScript.length > 1
  ) {
    refuseRepository("usage", "unknown-contract-key", "argv", "restore-current-declaration")
  }
  return argumentsAfterScript.length === 1 ? "structure-only" : "complete"
}

function qualificationReceipt(
  mode: "complete" | "structure-only",
  observation: ProofObservation | undefined,
): Record<string, unknown> {
  return {
    schema_version: 1,
    command: "verify:repository-qualification",
    status: "qualified",
    mode,
    contract: "tooling/repository-quality/repository-qualification-contract.json",
    groups: receiptGroups(mode, observation),
    aggregate: receiptAggregate(mode, observation),
  }
}

function receiptGroups(
  mode: "complete" | "structure-only",
  observation: ProofObservation | undefined,
): readonly Record<string, unknown>[] {
  if (mode === "structure-only" || observation === undefined) return []
  return observation.groups.map(({ id, files, tests, passed, failed, skipped, failure_classes }) => ({
    id,
    files,
    tests,
    passed,
    failed,
    skipped,
    failure_classes,
  }))
}

function receiptAggregate(
  mode: "complete" | "structure-only",
  observation: ProofObservation | undefined,
): Record<string, number> | null {
  if (mode === "structure-only" || observation === undefined) return null
  return {
    files: observation.aggregate.files,
    tests: observation.aggregate.tests,
    passed: observation.aggregate.passed,
    failed: observation.aggregate.failed,
    skipped: observation.aggregate.skipped,
  }
}

function run(): void {
  const mode = readMode()
  activeMode = mode
  const contract = readContract()
  const observation = verifyRepository(contract)
  process.stdout.write(`${JSON.stringify(qualificationReceipt(mode, observation))}\n`)
}

try {
  run()
} catch (error) {
  if (error instanceof QualificationRefusal) {
    writeRefusal(error)
  } else {
    writeRefusal(new QualificationRefusal("proof-process-failed", activeMode, [
      { kind: "proof-process-failed", owner: "verifier", repair_id: "repair-proof-process" },
    ]))
  }
}
