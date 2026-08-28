import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { dirname, extname, relative, resolve } from "node:path"

type BalancedCounts = {
  tests: number
  passed: number
  failed: number
  skipped: number
  failure_classes: Readonly<Record<string, number>>
}

type RepositoryProofGroup = BalancedCounts & {
  id: string
  files: readonly string[]
}

type RepositoryQualificationContract = {
  schema_version: 1
  structure: {
    required_paths: readonly string[]
    forbidden_paths: readonly string[]
  }
  admission: {
    source_entry: string
    source_closure: readonly string[]
    owner_manifest: string
    consumer_fixture: string
    projection_fixture: string
    projection: Readonly<Record<string, unknown>>
  }
  package_contract: {
    name: string
    version: string
    private: boolean
    type: string
    package_manager: string
    workspaces: readonly string[]
    exports: Readonly<Record<string, string>>
    bin: Readonly<Record<string, string>>
    scripts: Readonly<Record<string, string>>
    dev_dependencies: Readonly<Record<string, string>>
  }
  owner_manifests: Readonly<Record<string, {
    path: string
    private: boolean
    type: string
    exports: Readonly<Record<string, string>>
    empty_dependency_fields: readonly string[]
  }>>
  shells: {
    maintenance_cli: {
      command: string
      red_exit: number
      red_verdict: string
      proof_schema_version: number
    }
    maintenance_cli_local_link: {
      command: string
      red_exit: number
      red_sentinel: string
      proof_schema_version: number
    }
  }
  proof_groups: readonly RepositoryProofGroup[]
  aggregate: {
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
const knownFailureClasses = new Set(["contract-absent"])
const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]

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
  process.exitCode = refusal.code === "repository-unqualified" ? 1 : 2
}

function refuseRepository(code: string, kind: string, owner: string, repairId: string): never {
  throw new QualificationRefusal(code, "complete", [{ kind, owner, repair_id: repairId }])
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
  if (isSkippedDirectory(entry.name)) return []
  const entryRelative = relativeEntryPath(prefix, entry.name)
  const path = resolve(directory, entry.name)
  if (entry.isDirectory()) return repositoryEntries(path, entryRelative, include)
  return include(entry.name) ? [entryRelative] : []
}

function isSkippedDirectory(name: string): boolean {
  return name === ".git" || name === "node_modules"
}

function relativeEntryPath(prefix: string, name: string): string {
  return prefix === "" ? name : `${prefix}/${name}`
}

function verifySelectors(contract: RepositoryQualificationContract): void {
  const selected = new Set<string>()
  for (const [index, group] of contract.proof_groups.entries()) {
    verifyGroupSelectors(group, index, selected)
  }
  if (contract.aggregate.files !== selected.size) {
    refuseRepository("repository-unqualified", "selector-drift", "aggregate.files", "restore-current-declaration")
  }
  const discovered = repositoryTestFiles(repositoryRoot)
    .filter((file) => !file.startsWith("tooling/repository-quality/"))
    .sort()
  const selectedSorted = [...selected].sort()
  if (JSON.stringify(discovered) !== JSON.stringify(selectedSorted)) {
    refuseRepository("repository-unqualified", "selector-drift", "proof_groups", "restore-current-declaration")
  }
}

function verifyGroupSelectors(
  group: RepositoryProofGroup,
  index: number,
  selected: Set<string>,
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
}

function verifyStructurePaths(contract: RepositoryQualificationContract): void {
  const missing = contract.structure.required_paths.some((path) => !existsSync(resolve(repositoryRoot, path)))
  if (missing) refuseRepository("repository-unqualified", "path-drift", "structure.required_paths", "restore-repository-bytes")
  const present = contract.structure.forbidden_paths.some((path) => existsSync(resolve(repositoryRoot, path)))
  if (present) refuseRepository("repository-unqualified", "path-drift", "structure.forbidden_paths", "restore-repository-bytes")
}

function admissionDrift(): never {
  return refuseRepository(
    "repository-unqualified",
    "admission-closure-drift",
    "admission.source_closure",
    "restore-repository-bytes",
  )
}

function sourceSpecifiers(source: string): string[] {
  const specifiers = new Set<string>()
  for (const pattern of [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']/g,
  ]) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier !== undefined) specifiers.add(specifier)
    }
  }
  return [...specifiers]
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
    pending.push(...sourceSpecifiers(readFileSync(source.absolute, "utf8"))
      .filter((specifier) => !specifier.startsWith("node:"))
      .map((specifier) => resolveAdmissionImport(file, specifier)))
  }
  return [...discovered].sort()
}

function verifyAdmission(contract: RepositoryQualificationContract): void {
  const admission = contract.admission
  verifyAdmissionManifest(admission.owner_manifest)
  verifyAdmissionClosure(admission.source_entry, admission.source_closure)
  verifyAdmissionProjection(admission.projection_fixture, admission.projection)
  verifyAdmissionConsumer(admission.consumer_fixture)
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
  const hasDependency = dependencyFields.some((field) => {
    const value = manifest[field]
    return value !== undefined && (!value || typeof value !== "object" || Object.keys(value).length !== 0)
  })
  if (hasDependency) admissionDrift()
}

function verifyAdmissionClosure(entry: string, expected: readonly string[]): void {
  const closure = discoverAdmissionSourceClosure(entry)
  if (JSON.stringify(closure) !== JSON.stringify([...expected].sort())) admissionDrift()
}

function verifyAdmissionProjection(path: string, expected: Readonly<Record<string, unknown>>): void {
  const projection = JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")) as unknown
  if (JSON.stringify(projection) !== JSON.stringify(expected)) admissionDrift()
}

function verifyAdmissionConsumer(path: string): void {
  const consumer = readFileSync(resolve(repositoryRoot, path), "utf8")
  if (consumer !== 'await import("agent-plugin-kit/admission-bootstrap")\nconsole.log("admission-bootstrap:loaded")\n') admissionDrift()
}

function packageDrift(owner: string): never {
  throw new QualificationRefusal("repository-unqualified", "complete", [
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
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined
}

function packageManifests(directory: string, prefix = ""): string[] {
  return repositoryEntries(directory, prefix, (name) => name === "package.json")
}

function verifyPackageContract(contract: RepositoryQualificationContract): void {
  const root = packageJson("package.json")
  verifyRootDependencies(root)
  verifyRootIdentity(root, contract.package_contract)
  verifyRootCollections(root, contract.package_contract)
  verifyRootScripts(root.scripts, contract.package_contract.scripts)
  verifyNoZod(packageManifests(repositoryRoot))
  verifyOwnerManifests(contract.owner_manifests)
}

function hasZodDependency(manifest: Record<string, unknown>): boolean {
  return dependencyFields.some((field) => objectValue(manifest[field])?.zod !== undefined)
}

function verifyRootDependencies(root: Record<string, unknown>): void {
  if (hasZodDependency(root)) packageDrift("package_contract.zod")
}

function verifyNoZod(paths: readonly string[]): void {
  if (paths.some((path) => hasZodDependency(packageJson(path)))) packageDrift("package_contract.zod")
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
}

function verifyOwnerManifests(
  declarations: Readonly<Record<string, RepositoryQualificationContract["owner_manifests"][string]>>,
): void {
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
  if (
    manifest.private !== declaration.private ||
    manifest.type !== declaration.type ||
    JSON.stringify(manifest.exports) !== JSON.stringify(declaration.exports)
  ) return true
  return declaration.empty_dependency_fields.some((field) => {
    const dependencies = objectValue(manifest[field])
    return dependencies !== undefined && Object.keys(dependencies).length !== 0
  })
}

function shellDrift(owner: string): never {
  throw new QualificationRefusal("repository-unqualified", "complete", [
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
  verifyShell(
    maintenance.command,
    maintenance.red_exit,
    maintenance.proof_schema_version,
    "verdict",
    maintenance.red_verdict,
    "shells.maintenance_cli",
  )

  const localLink = contract.shells.maintenance_cli_local_link
  verifyShell(
    localLink.command,
    localLink.red_exit,
    localLink.proof_schema_version,
    "sentinel",
    localLink.red_sentinel,
    "shells.maintenance_cli_local_link",
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
  const value = JSON.parse(readFileSync(contractPath, "utf8")) as unknown
  const root = exactRecord(value, "contract", [
    "schema_version",
    "bun",
    "structure",
    "proof_groups",
    "aggregate",
    "admission",
    "shells",
    "package_contract",
    "owner_manifests",
  ])
  exactRecord(root.bun, "bun", ["config_file", "install_auto"])
  const structure = exactRecord(root.structure, "structure", [
    "required_paths",
    "forbidden_paths",
    "required_agent_pointers",
    "required_context_terms",
    "required_context_map_routes",
    "required_agent_index_links",
  ])
  for (const route of structure.required_context_map_routes as unknown[]) {
    exactRecord(route, "structure.required_context_map_routes[]", ["question", "term", "path"])
  }
  for (const group of root.proof_groups as unknown[]) {
    exactRecord(group, "proof_groups[]", ["id", "files", "tests", "passed", "failed", "skipped", "failure_classes"])
  }
  exactRecord(root.aggregate, "aggregate", ["files", "tests", "passed", "failed", "skipped", "failure_classes"])
  const admission = exactRecord(root.admission, "admission", [
    "proof_layer",
    "sentinel_file",
    "sentinel_name",
    "sentinel_count",
    "source_entry",
    "source_closure",
    "owner_manifest",
    "consumer_fixture",
    "projection_fixture",
    "projection",
    "forbidden_self_reports",
    "non_claims",
  ])
  exactRecord(admission.projection, "admission.projection", ["name", "type", "exports"])
  const shells = exactRecord(root.shells, "shells", ["maintenance_cli", "maintenance_cli_local_link"])
  exactRecord(shells.maintenance_cli, "shells.maintenance_cli", ["script", "command", "red_exit", "red_verdict", "proof_schema_version"])
  exactRecord(shells.maintenance_cli_local_link, "shells.maintenance_cli_local_link", ["script", "command", "red_exit", "red_sentinel", "proof_schema_version"])
  const packageContract = exactRecord(root.package_contract, "package_contract", [
    "name",
    "version",
    "private",
    "type",
    "package_manager",
    "workspaces",
    "exports",
    "bin",
    "scripts",
    "dev_dependencies",
  ])
  for (const [owner, declaration] of Object.entries(root.owner_manifests as Record<string, unknown>)) {
    exactRecord(declaration, `owner_manifests.${owner}`, ["path", "private", "type", "exports", "empty_dependency_fields"])
  }
  void packageContract
  return root as unknown as RepositoryQualificationContract
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
    const unknownOwner = `${owner}.${unknown}`.replace("contract.", "")
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

function verifyRepository(contract: RepositoryQualificationContract): void {
  verifyStructurePaths(contract)
  verifyAdmission(contract)
  verifyPackageContract(contract)
  verifySelectors(contract)
  verifyShells(contract)
  verifyProofGroups(contract.proof_groups)
  verifyCounts(contract.aggregate, "aggregate")
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

function readMode(): "complete" | "structure-only" | undefined {
  const argumentsAfterScript = process.argv.slice(2)
  if (argumentsAfterScript.some((argument) => argument !== "--structure-only")) {
    process.exitCode = 2
    return undefined
  }
  return argumentsAfterScript.length === 1 ? "structure-only" : "complete"
}

function qualificationReceipt(
  contract: RepositoryQualificationContract,
  mode: "complete" | "structure-only",
): Record<string, unknown> {
  return {
    schema_version: 1,
    command: "verify:repository-qualification",
    status: "qualified",
    mode,
    contract: "tooling/repository-quality/repository-qualification-contract.json",
    groups: mode === "structure-only"
      ? []
      : contract.proof_groups.map(({ id, files, tests, passed, failed, skipped, failure_classes }) => ({
          id,
          files: files.length,
          tests,
          passed,
          failed,
          skipped,
          failure_classes,
        })),
    aggregate: mode === "structure-only"
      ? null
      : {
          files: contract.aggregate.files,
          tests: contract.aggregate.tests,
          passed: contract.aggregate.passed,
          failed: contract.aggregate.failed,
          skipped: contract.aggregate.skipped,
        },
  }
}

function run(): void {
  const contract = readContract()
  verifyRepository(contract)
  const mode = readMode()
  if (mode === undefined) return
  process.stdout.write(`${JSON.stringify(qualificationReceipt(contract, mode))}\n`)
}

try {
  run()
} catch (error) {
  if (error instanceof QualificationRefusal) {
    writeRefusal(error)
  } else {
    process.exitCode = 2
  }
}
