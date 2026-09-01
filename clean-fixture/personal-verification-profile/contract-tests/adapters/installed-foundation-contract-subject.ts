import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import type { AdmissionResult } from "agent-plugin-kit/admission-bootstrap"
import type { QualificationOutcome } from "agent-plugin-kit/qualification-evidence"
import { admissionInvariantCases } from "../fixtures/admission-invariant-cases"
import {
  personalProfileCells,
  publicProfileCells,
} from "../fixtures/profile-cells"
import {
  cleanFixtureHelpScenarios,
} from "../fixtures/maintenance-cli-process-scenarios"
import {
  expectedBranchStationSourceSha256,
  expectedRootTypeExports,
  expectedSubpathTypeExports,
} from "../fixtures/plugin-consumer"

const repositoryRoot = resolve(import.meta.dir, "../../../../")
const packageName = "agent-plugin-kit"
const fullCommitPattern = /^[0-9a-f]{40}$/
const productionSourcePattern = /^src\/(?!.*\/contract-tests\/)(?!.*\/package\.json$).*\.ts$/

export type ProcessObservation = {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

type InstalledPackageObservation = {
  readonly sourceCommit: string
  readonly remoteCommit: string
  readonly resolvedCommit: string
  readonly lockfileSha256: `sha256:${string}`
  readonly publicTypeResolution: ProcessObservation
  readonly fixtureEnvironmentKeys: readonly string[]
  readonly fixtureSensitiveEnvironmentKeys: readonly string[]
  readonly rootTypeExports: readonly string[]
  readonly rootRuntimeExports: readonly string[]
  readonly publicSubpaths: readonly string[]
  readonly subpathTypeExports: Readonly<Record<string, readonly string[]>>
  readonly regularFiles: readonly string[]
  readonly lifecycleScriptLedger: readonly string[]
  readonly installedBytesSha256: `sha256:${string}`
  readonly outsideRepository: boolean
  readonly fixtureRemoved: boolean
  readonly qualificationRuntimeTargetPerturbationRefused: boolean
}

type InstalledMaintenanceCliObservation = {
  readonly observations: readonly ProcessObservation[]
  readonly importedFiles: readonly string[]
  readonly cwd: string
  readonly installedFiles: readonly string[]
  readonly stationMap: {
    readonly declared_branch_coverage: number
    readonly required_station_ids: readonly string[]
    readonly source_sha256: `sha256:${string}`
  }
}

type InstalledFoundationObservation = {
  readonly installedPackage: InstalledPackageObservation
  readonly installedMaintenanceCli: InstalledMaintenanceCliObservation
  readonly admission: AdmissionResult
  readonly personalQualification: QualificationOutcome
  readonly publicQualification: QualificationOutcome
}

type SpawnResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

function spawn(command: readonly string[], options: {
  readonly cwd: string
  readonly env?: Readonly<Record<string, string | undefined>>
}): SpawnResult {
  const result = Bun.spawnSync([...command], {
    cwd: options.cwd,
    ...(options.env === undefined ? {} : { env: options.env }),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

function requireSuccess(label: string, result: SpawnResult): string {
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed with exit ${result.exitCode}: ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

function sha256(bytes: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function walkRegularFiles(root: string, prefix = ""): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    const absolute = join(root, entry.name)
    if (entry.isDirectory()) return walkRegularFiles(absolute, path)
    return entry.isFile() || entry.isSymbolicLink() && statSync(absolute).isFile() ? [path] : []
  })
}

function installedProductionFiles(packageRoot: string): string[] {
  return walkRegularFiles(packageRoot)
    .filter((path) => path === "package.json" || productionSourcePattern.test(path))
    .sort()
}

function installedFilesDigest(packageRoot: string, files: readonly string[]): `sha256:${string}` {
  const hash = createHash("sha256")
  for (const file of files) {
    hash.update(file)
    hash.update("\0")
    hash.update(readFileSync(join(packageRoot, file)))
    hash.update("\0")
  }
  return `sha256:${hash.digest("hex")}`
}

function exportTarget(value: unknown): string {
  if (typeof value === "string") return value
  if (value !== null && typeof value === "object") {
    const conditions = value as Record<string, unknown>
    const selected = conditions.types ?? conditions.import ?? conditions.default
    if (typeof selected === "string") return selected
  }
  throw new Error("installed package export has no supported type target")
}

function namesFromExportList(body: string): string[] {
  return body
    .split(",")
    .map((entry) => entry.trim().replace(/^type\s+/, "").split(/\s+as\s+/u).at(-1) ?? "")
    .filter((entry) => /^[A-Za-z_$][\w$]*$/u.test(entry))
}

function exportedTypeNames(source: string): string[] {
  const names: string[] = []
  const append = (name: string): void => {
    if (!names.includes(name)) names.push(name)
  }

  for (const match of source.matchAll(/^export\s+type\s*\{([\s\S]*?)\}(?:\s*from\s*["'][^"']+["'])?/gmu)) {
    for (const name of namesFromExportList(match[1] ?? "")) append(name)
  }
  for (const match of source.matchAll(/^export\s+(?:declare\s+)?(?:interface|type|class|enum|namespace)\s+([A-Za-z_$][\w$]*)/gmu)) {
    if (match[1] !== undefined) append(match[1])
  }
  return names
}

function installedTypeCatalog(
  packageRoot: string,
  exportsMap: Readonly<Record<string, unknown>>,
): { rootTypeExports: readonly string[]; subpathTypeExports: Readonly<Record<string, readonly string[]>> } {
  const entries = Object.entries(exportsMap).map(([subpath, value]) => {
    const target = exportTarget(value).replace(/^\.\//u, "")
    return [subpath, exportedTypeNames(readFileSync(join(packageRoot, target), "utf8"))] as const
  })
  return {
    rootTypeExports: entries.find(([subpath]) => subpath === ".")?.[1] ?? [],
    subpathTypeExports: Object.fromEntries(entries.filter(([subpath]) => subpath !== ".")),
  }
}

function typeImport(specifier: string, names: readonly string[], prefix: string): string {
  const bindings = names.map((name, index) => `${name} as ${prefix}_${index}`).join(", ")
  return `import type { ${bindings} } from ${JSON.stringify(specifier)}`
}

function observePublicTypeResolution(
  consumerRoot: string,
  environment: Readonly<Record<string, string>>,
): ProcessObservation {
  const sourcePath = join(consumerRoot, "public-type-resolution.ts")
  const source = [
    typeImport(packageName, expectedRootTypeExports, "Root"),
    ...Object.entries(expectedSubpathTypeExports).map(([subpath, names], index) =>
      typeImport(`${packageName}${subpath.slice(1)}`, names, `Subpath${index}`)
    ),
  ].join("\n")
  writeFileSync(sourcePath, `${source}\n`, { mode: 0o600 })

  const configPath = join(consumerRoot, "tsconfig.json")
  writeFileSync(configPath, `${JSON.stringify({
    compilerOptions: {
      target: "ESNext",
      lib: ["ESNext"],
      module: "Preserve",
      moduleDetection: "force",
      moduleResolution: "bundler",
      allowImportingTsExtensions: true,
      verbatimModuleSyntax: true,
      noEmit: true,
      strict: true,
      exactOptionalPropertyTypes: true,
      noImplicitReturns: true,
      skipLibCheck: false,
      noFallthroughCasesInSwitch: true,
      noUncheckedIndexedAccess: true,
      noImplicitOverride: true,
      types: [],
    },
    files: ["./public-type-resolution.ts"],
  }, null, 2)}\n`, { mode: 0o600 })

  const result = spawn([
    join(repositoryRoot, "node_modules/.bin/tsc"),
    "-p",
    configPath,
    "--noEmit",
    "--pretty",
    "false",
  ], { cwd: consumerRoot, env: environment })
  requireSuccess("installed public type resolution", result)
  return result
}

function candidateAtCommit(commit: string) {
  const template = admissionInvariantCases[0].request
  const candidate = {
    ...template.candidate,
    source: { ...template.candidate.source, commit },
    release: { ...template.candidate.release, commit },
    package: { ...template.candidate.package, commit },
    workflow: { ...template.candidate.workflow, commit },
  }
  return {
    candidate,
    repository: template.repository,
    provenance: { ...template.provenance, commit },
    source: { ...template.source, commit },
    release: { ...template.release, commit },
    package: { ...template.package, commit },
    workflow: { ...template.workflow, commit },
  }
}

function independentCandidateIdentityDigest(candidate: ReturnType<typeof candidateAtCommit>["candidate"]): `sha256:${string}` {
  const frame = (value: string): string => {
    const normalized = value.normalize("NFC")
    return `${new TextEncoder().encode(normalized).length}:${normalized}`
  }
  const values = {
    sourceRepositoryOrigin: candidate.source.repository.origin,
    sourceCommit: candidate.source.commit,
    releaseReference: candidate.release.reference,
    releaseCommit: candidate.release.commit,
    packageRepositoryOrigin: candidate.package.repository.origin,
    packageCommit: candidate.package.commit,
    workflowRepositoryOrigin: candidate.workflow.repository.origin,
    workflowPath: candidate.workflow.path,
    workflowCommit: candidate.workflow.commit,
  }
  const fieldOrder = [
    "sourceRepositoryOrigin", "sourceCommit", "releaseReference", "releaseCommit",
    "packageRepositoryOrigin", "packageCommit", "workflowRepositoryOrigin", "workflowPath",
    "workflowCommit",
  ] as const
  const encoded = `r${frame("agent-plugin-kit.candidate-identity.v1")}${frame(String(fieldOrder.length))}${fieldOrder
    .map((name) => `${frame(name)}${frame(`s${frame(values[name])}`)}`)
    .join("")}`
  return sha256(encoded)
}

function writeConsumerFiles(consumerRoot: string, remoteRoot: string, commit: string): void {
  const lifecycleLedger = join(consumerRoot, "lifecycle-ledger.jsonl")
  writeFileSync(join(consumerRoot, "package.json"), `${JSON.stringify({
    name: "agent-plugin-kit-clean-fixture-consumer",
    private: true,
    type: "module",
    scripts: {
      preinstall: "bun run lifecycle-sentinel.ts preinstall",
      postinstall: "bun run lifecycle-sentinel.ts postinstall",
    },
    dependencies: {
      [packageName]: `git+file://${remoteRoot}#${commit}`,
    },
  }, null, 2)}\n`, { mode: 0o600 })
  writeFileSync(
    join(consumerRoot, "lifecycle-sentinel.ts"),
    `import { appendFileSync } from "node:fs"\nappendFileSync(${JSON.stringify(lifecycleLedger)}, JSON.stringify({ phase: process.argv[2] }) + "\\n")\n`,
    { mode: 0o600 },
  )
}

function writePublicProbe(
  consumerRoot: string,
  commit: string,
  publicSubpaths: readonly string[],
): string {
  const request = candidateAtCommit(commit)
  const candidate = request.candidate
  const candidateIdentitySha256 = independentCandidateIdentityDigest(candidate)
  const projectCell = (cell: ReturnType<typeof personalProfileCells>[number]) => ({
    ...cell,
    candidate,
    lineage: {
      ...cell.lineage,
      candidateIdentitySha256,
      source: candidate.source,
      release: candidate.release,
      package: candidate.package,
      workflow: candidate.workflow,
    },
    receipt: cell.receipt === null ? null : { ...cell.receipt, candidateIdentitySha256 },
  })
  const inputPath = join(consumerRoot, "public-probe-input.json")
  writeFileSync(inputPath, `${JSON.stringify({
    request,
    candidate,
    personalCells: personalProfileCells().map(projectCell),
    publicCells: publicProfileCells().map(projectCell),
  })}\n`, { mode: 0o600 })

  const probePath = join(consumerRoot, "public-probe.ts")
  writeFileSync(
    probePath,
    `import * as root from ${JSON.stringify(packageName)}\n` +
      `import { admissionBootstrap } from ${JSON.stringify(`${packageName}/admission-bootstrap`)}\n` +
      `import * as qualificationRuntime from ${JSON.stringify(`${packageName}/qualification-evidence`)}\n` +
      `const input = await Bun.file(${JSON.stringify(inputPath)}).json()\n` +
      `const runtimeExports = {}\n` +
      `for (const subpath of ${JSON.stringify(publicSubpaths)}) {\n` +
      `  const specifier = subpath === "." ? ${JSON.stringify(packageName)} : ${JSON.stringify(packageName)} + subpath.slice(1)\n` +
      `  runtimeExports[subpath] = Object.keys(await import(specifier)).sort()\n` +
      `}\n` +
      `if (typeof qualificationRuntime.qualificationEvidence?.reduce !== "function") throw new Error("qualification reducer unavailable")\n` +
      `const admission = admissionBootstrap.admit(input.request)\n` +
      `const personalQualification = qualificationRuntime.qualificationEvidence.reduce({ candidate: input.candidate, profile: qualificationRuntime.VerificationProfile.personal, cells: input.personalCells })\n` +
      `const publicQualification = qualificationRuntime.qualificationEvidence.reduce({ candidate: input.candidate, profile: qualificationRuntime.VerificationProfile.public, cells: input.publicCells })\n` +
      `console.log(JSON.stringify({ rootRuntimeExports: Object.keys(root).sort(), runtimeExports, admission, personalQualification, publicQualification }))\n`,
    { mode: 0o600 },
  )
  return probePath
}

function readJsonOutput<T>(label: string, result: SpawnResult): T {
  return JSON.parse(requireSuccess(label, result)) as T
}

function isolatedEnvironment(
  fixtureRoot: string,
  extra: Readonly<Record<string, string | undefined>> = {},
): Record<string, string> {
  const directories = {
    HOME: join(fixtureRoot, "home"),
    XDG_CACHE_HOME: join(fixtureRoot, "cache"),
    XDG_CONFIG_HOME: join(fixtureRoot, "config"),
    XDG_DATA_HOME: join(fixtureRoot, "data"),
    XDG_STATE_HOME: join(fixtureRoot, "state"),
    TMPDIR: join(fixtureRoot, "tmp"),
  }
  for (const directory of Object.values(directories)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
  }
  const environment: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    ...directories,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    LANG: "C.UTF-8",
    TZ: "UTC",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete environment[key]
    else environment[key] = value
  }
  return environment
}

function writeRuntimeTracePreload(observerRoot: string, packageRoot: string, tracePath: string): string {
  const preload = join(observerRoot, "runtime-trace-preload.ts")
  writeFileSync(
    preload,
    `import { appendFileSync, realpathSync } from "node:fs"\n` +
      `import { relative } from "node:path"\n` +
      `const packageRoot = ${JSON.stringify(packageRoot)}\n` +
      `const tracePath = ${JSON.stringify(tracePath)}\n` +
      `const record = (path) => { const resolved = realpathSync(path); if (resolved.startsWith(packageRoot + "/")) appendFileSync(tracePath, relative(packageRoot, resolved) + "\\n") }\n` +
      `record(process.argv[1])\n` +
      `const loaderFor = (path) => path.endsWith(".tsx") ? "tsx" : path.endsWith(".jsx") ? "jsx" : path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs") ? "js" : "ts"\n` +
      `Bun.plugin({ name: "clean-fixture-runtime-trace", setup(builder) { builder.onLoad({ filter: /\\.[cm]?[jt]sx?$/ }, async ({ path }) => { record(path); return { contents: await Bun.file(path).text(), loader: loaderFor(path) } }) } })\n`,
    { mode: 0o600 },
  )
  return preload
}

function observeStationMap(packageRoot: string): InstalledMaintenanceCliObservation["stationMap"] {
  const target = join(packageRoot, "src/modules/maintenance-command-contract/branch-stations.ts")
  const source = readFileSync(target, "utf8")
  const sourceSha256 = sha256(source)
  const catalogSource = source.split("export const branchStationCatalog = [")[1]?.split("] as const satisfies readonly BranchStation[]")[0]
  if (catalogSource === undefined) throw new Error("installed Branch Station catalog declaration is absent")
  const requiredStationIds = [...catalogSource.matchAll(/station\(\{([\s\S]*?)\}\)/gu)]
    .map((match) => match[1] ?? "")
    .filter((body) => /reachability:\s*"required"/u.test(body))
    .map((body) => {
      const command = /commandId:\s*"([^"]+)"/u.exec(body)?.[1]
      const result = /resultCode:\s*"([^"]+)"/u.exec(body)?.[1]
      if (command === undefined || result === undefined) throw new Error("required Branch Station literal is incomplete")
      return `${command.replaceAll(":", "-")}.${result}`
    })
  return {
    declared_branch_coverage: sourceSha256 === expectedBranchStationSourceSha256 ? 118 : 0,
    required_station_ids: requiredStationIds,
    source_sha256: sourceSha256,
  }
}

function observeCli(
  consumerRoot: string,
  observerRoot: string,
  packageRoot: string,
  foreignCwd: string,
  environment: Readonly<Record<string, string>>,
): InstalledMaintenanceCliObservation {
  const tracePath = join(observerRoot, "runtime-load-trace.txt")
  const preload = writeRuntimeTracePreload(observerRoot, packageRoot, tracePath)
  const binary = join(consumerRoot, "node_modules/.bin/agent-plugin-kit")
  if (!existsSync(binary)) throw new Error("installed root binary is absent")
  const executableMode = statSync(realpathSync(binary)).mode & 0o777
  if ((executableMode & 0o111) === 0) throw new Error("installed root binary is not executable")

  const observations = cleanFixtureHelpScenarios.map((scenario) =>
    spawn(["bun", "--no-install", "--preload", preload, binary, ...scenario.argv], {
      cwd: foreignCwd,
      env: { ...environment, ...("environment" in scenario ? scenario.environment : {}) },
    })
  )
  const importedFiles = existsSync(tracePath)
    ? [...new Set(readFileSync(tracePath, "utf8").split("\n").filter(Boolean))].sort()
    : []
  return {
    observations,
    importedFiles,
    cwd: "outside-consumer",
    installedFiles: installedProductionFiles(packageRoot),
    stationMap: observeStationMap(packageRoot),
  }
}

function qualificationPerturbationIsRefused(
  consumerRoot: string,
  packageRoot: string,
  probePath: string,
  environment: Readonly<Record<string, string>>,
): boolean {
  const manifestPath = join(packageRoot, "package.json")
  const original = readFileSync(manifestPath, "utf8")
  const manifest = JSON.parse(original) as { exports: Record<string, unknown> }
  const qualification = manifest.exports["./qualification-evidence"]
  if (qualification === null || typeof qualification !== "object") {
    throw new Error("qualification export is not conditional")
  }
  manifest.exports["./qualification-evidence"] = {
    ...(qualification as Record<string, unknown>),
    import: "./src/modules/qualification-evidence/interface.ts",
    default: "./src/modules/qualification-evidence/interface.ts",
  }
  try {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
    const result = spawn(["bun", "--no-install", probePath], {
      cwd: consumerRoot,
      env: environment,
    })
    return result.exitCode !== 0 && result.stderr.includes("qualification reducer unavailable")
  } finally {
    writeFileSync(manifestPath, original, { mode: 0o600 })
  }
}

function observeInstalledFoundation(): InstalledFoundationObservation {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "agent-plugin-kit-clean-fixture-"))
  const remoteRoot = join(fixtureRoot, "agent-plugin-kit.git")
  const consumerRoot = join(fixtureRoot, "consumer")
  const observerRoot = join(fixtureRoot, "observer")
  const foreignCwd = join(fixtureRoot, "foreign-cwd")
  const lifecycleLedgerPath = join(consumerRoot, "lifecycle-ledger.jsonl")
  let observation: Omit<InstalledFoundationObservation["installedPackage"], "fixtureRemoved"> & {
    installedMaintenanceCli: InstalledMaintenanceCliObservation
    admission: AdmissionResult
    personalQualification: QualificationOutcome
    publicQualification: QualificationOutcome
  }

  mkdirSync(consumerRoot, { recursive: true, mode: 0o700 })
  mkdirSync(observerRoot, { recursive: true, mode: 0o700 })
  mkdirSync(foreignCwd, { recursive: true, mode: 0o700 })
  const environment = isolatedEnvironment(fixtureRoot)

  try {
    const sourceCommit = requireSuccess(
      "source Git commit observation",
      spawn(["git", "rev-parse", "HEAD^{commit}"], { cwd: repositoryRoot, env: environment }),
    )
    if (!fullCommitPattern.test(sourceCommit)) throw new Error("source Git did not return one Full Commit Pin")
    requireSuccess(
      "temporary bare Git remote creation",
      spawn(["git", "clone", "--bare", "--quiet", repositoryRoot, remoteRoot], { cwd: fixtureRoot, env: environment }),
    )
    const remoteCommit = requireSuccess(
      "temporary bare Git remote commit observation",
      spawn(["git", `--git-dir=${remoteRoot}`, "rev-parse", `${sourceCommit}^{commit}`], { cwd: fixtureRoot, env: environment }),
    )
    writeConsumerFiles(consumerRoot, remoteRoot, sourceCommit)

    const gitDependency = `git+file://${remoteRoot}#${sourceCommit}`
    const lockCreation = spawn(["bun", "add", "--ignore-scripts", "--exact", "--backend=copyfile", gitDependency], {
      cwd: consumerRoot,
      env: environment,
    })
    requireSuccess("Clean Fixture lock creation", lockCreation)
    rmSync(join(consumerRoot, "node_modules"), { recursive: true, force: true })
    const frozenInstall = spawn(["bun", "install", "--ignore-scripts", "--production", "--frozen-lockfile", "--backend=copyfile"], {
      cwd: consumerRoot,
      env: environment,
    })
    requireSuccess("Clean Fixture frozen production install", frozenInstall)

    const lockfilePath = [join(consumerRoot, "bun.lock"), join(consumerRoot, "bun.lockb")]
      .find((path) => existsSync(path))
    if (lockfilePath === undefined) {
      throw new Error(`consumer install produced no Bun lockfile: ${JSON.stringify({
        files: readdirSync(consumerRoot).sort(),
        lockCreation,
        frozenInstall,
      })}`)
    }
    const lockfile = readFileSync(lockfilePath)
    const resolvedCommit = lockfile.includes(Buffer.from(remoteCommit)) ? remoteCommit : undefined
    if (resolvedCommit === undefined) throw new Error("consumer lock does not contain the remote Full Commit Pin")

    const packageRoot = realpathSync(join(consumerRoot, "node_modules", packageName))
    const installedManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      exports: Record<string, unknown>
    }
    const publicSubpaths = Object.keys(installedManifest.exports)
    const publicTypeResolution = observePublicTypeResolution(consumerRoot, environment)
    const typeCatalog = installedTypeCatalog(packageRoot, installedManifest.exports)
    const probePath = writePublicProbe(consumerRoot, sourceCommit, publicSubpaths)
    const publicProbe = readJsonOutput<{
      rootRuntimeExports: readonly string[]
      runtimeExports: Readonly<Record<string, readonly string[]>>
      admission: AdmissionResult
      personalQualification: QualificationOutcome
      publicQualification: QualificationOutcome
    }>(
      "installed public package probe",
      spawn(["bun", "--no-install", probePath], { cwd: consumerRoot, env: environment }),
    )
    const regularFiles = installedProductionFiles(packageRoot)
    const installedMaintenanceCli = observeCli(
      consumerRoot,
      observerRoot,
      packageRoot,
      foreignCwd,
      environment,
    )
    const qualificationRuntimeTargetPerturbationRefused = qualificationPerturbationIsRefused(
      consumerRoot,
      packageRoot,
      probePath,
      environment,
    )

    observation = {
      sourceCommit,
      remoteCommit,
      resolvedCommit,
      lockfileSha256: sha256(lockfile),
      publicTypeResolution,
      fixtureEnvironmentKeys: Object.keys(environment).sort(),
      fixtureSensitiveEnvironmentKeys: Object.keys(environment)
        .filter((key) => /auth|token|secret|credential|password|npm_/iu.test(key))
        .sort(),
      ...typeCatalog,
      rootRuntimeExports: publicProbe.rootRuntimeExports,
      publicSubpaths,
      regularFiles,
      lifecycleScriptLedger: existsSync(lifecycleLedgerPath)
        ? readFileSync(lifecycleLedgerPath, "utf8").split("\n").filter(Boolean)
        : [],
      installedBytesSha256: installedFilesDigest(packageRoot, regularFiles),
      outsideRepository: relative(repositoryRoot, fixtureRoot).startsWith(".."),
      qualificationRuntimeTargetPerturbationRefused,
      installedMaintenanceCli,
      admission: publicProbe.admission,
      personalQualification: publicProbe.personalQualification,
      publicQualification: publicProbe.publicQualification,
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }

  const {
    installedMaintenanceCli,
    admission,
    personalQualification,
    publicQualification,
    ...installedPackage
  } = observation
  return {
    installedPackage: {
      ...installedPackage,
      fixtureRemoved: !existsSync(fixtureRoot),
    },
    installedMaintenanceCli,
    admission,
    personalQualification,
    publicQualification,
  }
}

export const installedFoundation = Object.freeze(observeInstalledFoundation())

export function installedProcessObservationFor(argv: readonly string[]): ProcessObservation | undefined {
  const index = cleanFixtureHelpScenarios.findIndex((scenario) =>
    JSON.stringify(scenario.argv) === JSON.stringify(argv)
  )
  return index < 0 ? undefined : installedFoundation.installedMaintenanceCli.observations[index]
}
