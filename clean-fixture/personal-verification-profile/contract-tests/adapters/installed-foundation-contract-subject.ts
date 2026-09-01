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
  expectedDependencyFreeHelpRuntimeTrace,
  expectedRootTypeExports,
  expectedSubpathRuntimeExports,
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
  readonly subpathRuntimeExports: Readonly<Record<string, readonly string[]>>
  readonly publicSubpaths: readonly string[]
  readonly subpathTypeExports: Readonly<Record<string, readonly string[]>>
  readonly regularFiles: readonly string[]
  readonly lifecycleScriptLedger: readonly string[]
  readonly installedBytesSha256: `sha256:${string}`
  readonly outsideRepository: boolean
  readonly fixtureRemoved: boolean
  readonly qualificationRuntimeTargetPerturbationRefused: boolean
  readonly admittedExecutionOrder: readonly ["admission", "qualification", "maintenance-cli"]
  readonly admissionRefusalControl: {
    readonly admission: AdmissionResult
    readonly startedProcesses: readonly string[]
  }
  readonly publicSurfacePerturbationControl: {
    readonly typeFormsRefused: readonly string[]
    readonly runtimeSubpathsRefused: readonly string[]
  }
  readonly qualificationInputBindings: {
    readonly provedInstalledPayloadCells: readonly {
      readonly id: string
      readonly lineageDigest: `sha256:${string}`
      readonly receiptDigest: `sha256:${string}`
    }[]
    readonly hostedLineageCellIds: readonly string[]
  }
  readonly processTimeoutControl: {
    readonly exitCode: 124
    readonly timedOut: true
    readonly descriptorClosure: "closed"
    readonly cleanup: "process-group-killed"
    readonly descendantPidObserved: true
    readonly descendantTerminated: true
  }
}

type InstalledMaintenanceCliObservation = {
  readonly observations: readonly ProcessObservation[]
  readonly importedFiles: readonly string[]
  readonly cwd: string
  readonly installedFiles: readonly string[]
  readonly externalDependencyPerturbationRefused: boolean
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
  readonly cleanup: {
    readonly deadlineMs: number
    readonly timedOut: boolean
    readonly descriptorClosure: "closed"
    readonly cleanup: "natural" | "process-group-killed"
  }
}

const defaultProcessDeadlineMs = 30_000

async function spawn(command: readonly string[], options: {
  readonly cwd: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly deadlineMs?: number
}): Promise<SpawnResult> {
  const deadlineMs = options.deadlineMs ?? defaultProcessDeadlineMs
  const child = Bun.spawn([...command], {
    cwd: options.cwd,
    ...(options.env === undefined ? {} : { env: options.env }),
    detached: true,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  let timedOut = false
  let deadlineHandle: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolveDeadline) => {
    deadlineHandle = setTimeout(() => {
      timedOut = true
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch {
        child.kill("SIGKILL")
      }
      resolveDeadline()
    }, deadlineMs)
  })
  await Promise.race([child.exited.then(() => undefined), deadline])
  const [exitCode, capturedStdout, capturedStderr] = await Promise.all([
    child.exited,
    stdout,
    stderr,
  ])
  if (deadlineHandle !== undefined) clearTimeout(deadlineHandle)
  return {
    exitCode: timedOut ? 124 : exitCode,
    stdout: capturedStdout,
    stderr: capturedStderr,
    cleanup: {
      deadlineMs,
      timedOut,
      descriptorClosure: "closed",
      cleanup: timedOut ? "process-group-killed" : "natural",
    },
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

function runtimeExportTarget(value: unknown): string {
  if (typeof value === "string") return value
  if (value !== null && typeof value === "object") {
    const conditions = value as Record<string, unknown>
    const selected = conditions.import ?? conditions.default
    if (typeof selected === "string") return selected
  }
  throw new Error("installed package export has no supported runtime target")
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

  for (const match of source.matchAll(/^export\s+(?:type\s+)?\{([\s\S]*?)\}(?:\s*from\s*["'][^"']+["'])?/gmu)) {
    for (const name of namesFromExportList(match[1] ?? "")) append(name)
  }
  if (/^export\s+(?:type\s+)?\*/mu.test(source)) append("*")
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

async function observePublicTypeResolution(
  consumerRoot: string,
  environment: Readonly<Record<string, string>>,
): Promise<ProcessObservation> {
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

  const result = await spawn([
    join(repositoryRoot, "node_modules/.bin/tsc"),
    "-p",
    configPath,
    "--noEmit",
    "--pretty",
    "false",
  ], { cwd: consumerRoot, env: environment })
  requireSuccess("installed public type resolution", result)
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
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

function projectProfileCell(
  cell: ReturnType<typeof personalProfileCells>[number],
  candidate: ReturnType<typeof candidateAtCommit>["candidate"],
  installedBytesSha256: `sha256:${string}`,
) {
  const candidateIdentitySha256 = independentCandidateIdentityDigest(candidate)
  const installedPayload = cell.assertedStatus === "proved" && cell.claim === "plugin-payload.installed"
  return {
    ...cell,
    candidate,
    lineage: {
      candidateIdentitySha256,
      source: candidate.source,
      release: candidate.release,
      package: candidate.package,
      workflow: candidate.workflow,
      ...(installedPayload ? { installedPayloadSha256: installedBytesSha256 } : {}),
      ...(cell.assertedStatus !== "unknown" && cell.claim === "runtime.supported-platform"
        ? { platform: { os: "darwin", arch: "arm64" } }
        : {}),
    },
    receipt: cell.receipt === null
      ? null
      : {
          ...cell.receipt,
          candidateIdentitySha256,
          digest: installedPayload ? installedBytesSha256 : cell.receipt.digest,
        },
  }
}

function writeProbeInput(
  consumerRoot: string,
  name: string,
  request: ReturnType<typeof candidateAtCommit>,
  installedBytesSha256: `sha256:${string}`,
): string {
  const candidate = request.candidate
  const projectCell = (cell: ReturnType<typeof personalProfileCells>[number]) =>
    projectProfileCell(cell, candidate, installedBytesSha256)
  const inputPath = join(consumerRoot, `${name}-input.json`)
  writeFileSync(inputPath, `${JSON.stringify({
    request,
    candidate,
    personalCells: personalProfileCells().map(projectCell),
    publicCells: publicProfileCells().map(projectCell),
  })}\n`, { mode: 0o600 })

  return inputPath
}

function observeQualificationInputBindings(
  inputPath: string,
): InstalledPackageObservation["qualificationInputBindings"] {
  const input = JSON.parse(readFileSync(inputPath, "utf8")) as {
    personalCells: Array<{
      id: string
      assertedStatus: string
      claim: string
      lineage: { installedPayloadSha256?: `sha256:${string}`; hostedRun?: unknown }
      receipt: { digest: `sha256:${string}` } | null
    }>
    publicCells: Array<{
      id: string
      assertedStatus: string
      claim: string
      lineage: { installedPayloadSha256?: `sha256:${string}`; hostedRun?: unknown }
      receipt: { digest: `sha256:${string}` } | null
    }>
  }
  const cells = [...input.personalCells, ...input.publicCells]
  const provedInstalledPayloadCells = cells
    .filter((cell) => cell.assertedStatus === "proved" && cell.claim === "plugin-payload.installed")
    .map((cell) => {
      if (cell.lineage.installedPayloadSha256 === undefined || cell.receipt === null) {
        throw new Error("proved installed-payload evidence is not bound to installed bytes")
      }
      return {
        id: cell.id,
        lineageDigest: cell.lineage.installedPayloadSha256,
        receiptDigest: cell.receipt.digest,
      }
    })
  return {
    provedInstalledPayloadCells,
    hostedLineageCellIds: cells
      .filter((cell) => cell.lineage.hostedRun !== undefined)
      .map((cell) => cell.id),
  }
}

function writeAdmissionProbe(consumerRoot: string): string {
  const probePath = join(consumerRoot, "admission-probe.ts")
  writeFileSync(
    probePath,
    `import { admissionBootstrap } from ${JSON.stringify(`${packageName}/admission-bootstrap`)}\n` +
      `const input = await Bun.file(process.argv[2]).json()\n` +
      `console.log(JSON.stringify(admissionBootstrap.admit(input.request)))\n`,
    { mode: 0o600 },
  )
  return probePath
}

function writeQualificationProbe(
  consumerRoot: string,
  publicSubpaths: readonly string[],
): string {
  const probePath = join(consumerRoot, "qualification-probe.ts")
  writeFileSync(
    probePath,
    `import * as root from ${JSON.stringify(packageName)}\n` +
      `import * as qualificationRuntime from ${JSON.stringify(`${packageName}/qualification-evidence`)}\n` +
      `const input = await Bun.file(process.argv[2]).json()\n` +
      `const runtimeExports = {}\n` +
      `for (const subpath of ${JSON.stringify(publicSubpaths)}) {\n` +
      `  const specifier = subpath === "." ? ${JSON.stringify(packageName)} : ${JSON.stringify(packageName)} + subpath.slice(1)\n` +
      `  runtimeExports[subpath] = Object.keys(await import(specifier)).sort()\n` +
      `}\n` +
      `if (typeof qualificationRuntime.qualificationEvidence?.reduce !== "function") throw new Error("qualification reducer unavailable")\n` +
      `const personalQualification = qualificationRuntime.qualificationEvidence.reduce({ candidate: input.candidate, profile: qualificationRuntime.VerificationProfile.personal, cells: input.personalCells })\n` +
      `const publicQualification = qualificationRuntime.qualificationEvidence.reduce({ candidate: input.candidate, profile: qualificationRuntime.VerificationProfile.public, cells: input.publicCells })\n` +
      `console.log(JSON.stringify({ rootRuntimeExports: Object.keys(root).sort(), runtimeExports, personalQualification, publicQualification }))\n`,
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

function writeRuntimeTracePreload(
  observerRoot: string,
  packageRoot: string,
  consumerRoot: string,
  tracePath: string,
): string {
  const preload = join(observerRoot, "runtime-trace-preload.ts")
  writeFileSync(
    preload,
    `import { appendFileSync, realpathSync } from "node:fs"\n` +
      `import { relative } from "node:path"\n` +
      `const packageRoot = ${JSON.stringify(packageRoot)}\n` +
      `const consumerRoot = ${JSON.stringify(consumerRoot)}\n` +
      `const tracePath = ${JSON.stringify(tracePath)}\n` +
      `const externalPackage = (path) => { const marker = "/node_modules/"; const index = path.lastIndexOf(marker); if (index < 0) return undefined; const parts = path.slice(index + marker.length).split("/"); return parts[0]?.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0] }\n` +
      `const append = (identity) => appendFileSync(tracePath, identity + "\\n")\n` +
      `const record = (path) => { const resolved = realpathSync(path); if (resolved.startsWith(packageRoot + "/")) append(relative(packageRoot, resolved)); else { const packageName = externalPackage(resolved); if (packageName) append("external:" + packageName) } }\n` +
      `const recordBare = (specifier) => { if (specifier.startsWith("node:") || specifier.startsWith("bun:")) return; const parts = specifier.split("/"); const packageName = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]; if (packageName && packageName !== ${JSON.stringify(packageName)}) append("external:" + packageName) }\n` +
      `record(process.argv[1])\n` +
      `const loaderFor = (path) => path.endsWith(".tsx") ? "tsx" : path.endsWith(".jsx") ? "jsx" : path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs") ? "js" : "ts"\n` +
      `Bun.plugin({ name: "clean-fixture-runtime-trace", setup(builder) { builder.onResolve({ filter: /^[^./]/ }, ({ path }) => { recordBare(path); return undefined }); builder.onLoad({ filter: /\\.[cm]?[jt]sx?$/ }, async ({ path }) => { record(path); return { contents: await Bun.file(path).text(), loader: loaderFor(path) } }) } })\n`,
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

async function observeCli(
  consumerRoot: string,
  observerRoot: string,
  packageRoot: string,
  foreignCwd: string,
  environment: Readonly<Record<string, string>>,
): Promise<Omit<InstalledMaintenanceCliObservation, "externalDependencyPerturbationRefused">> {
  mkdirSync(observerRoot, { recursive: true, mode: 0o700 })
  const tracePath = join(observerRoot, "runtime-load-trace.txt")
  const preload = writeRuntimeTracePreload(observerRoot, packageRoot, consumerRoot, tracePath)
  const binary = join(consumerRoot, "node_modules/.bin/agent-plugin-kit")
  if (!existsSync(binary)) throw new Error("installed root binary is absent")
  const executableMode = statSync(realpathSync(binary)).mode & 0o777
  if ((executableMode & 0o111) === 0) throw new Error("installed root binary is not executable")

  const observations: ProcessObservation[] = []
  for (const scenario of cleanFixtureHelpScenarios) {
    const result = await spawn(["bun", "--no-install", "--preload", preload, binary, ...scenario.argv], {
      cwd: foreignCwd,
      env: { ...environment, ...("environment" in scenario ? scenario.environment : {}) },
    })
    observations.push({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr })
  }
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

async function qualificationPerturbationIsRefused(
  consumerRoot: string,
  packageRoot: string,
  probePath: string,
  probeInputPath: string,
  environment: Readonly<Record<string, string>>,
): Promise<boolean> {
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
    const result = await spawn(["bun", "--no-install", probePath, probeInputPath], {
      cwd: consumerRoot,
      env: environment,
    })
    return result.exitCode !== 0 && result.stderr.includes("qualification reducer unavailable")
  } finally {
    writeFileSync(manifestPath, original, { mode: 0o600 })
  }
}

function typeCatalogMatchesExpected(catalog: ReturnType<typeof installedTypeCatalog>): boolean {
  return JSON.stringify(catalog.rootTypeExports) === JSON.stringify(expectedRootTypeExports) &&
    JSON.stringify(catalog.subpathTypeExports) === JSON.stringify(expectedSubpathTypeExports)
}

async function observeRuntimeExportKeys(
  consumerRoot: string,
  specifier: string,
  environment: Readonly<Record<string, string>>,
): Promise<readonly string[]> {
  const probePath = join(consumerRoot, "runtime-export-probe.ts")
  writeFileSync(
    probePath,
    `console.log(JSON.stringify(Object.keys(await import(process.argv[2])).sort()))\n`,
    { mode: 0o600 },
  )
  return readJsonOutput<readonly string[]>(
    `runtime export observation for ${specifier}`,
    await spawn(["bun", "--no-install", probePath, specifier], { cwd: consumerRoot, env: environment }),
  )
}

async function provePublicSurfacePerturbations(
  consumerRoot: string,
  packageRoot: string,
  exportsMap: Readonly<Record<string, unknown>>,
  environment: Readonly<Record<string, string>>,
): Promise<InstalledPackageObservation["publicSurfacePerturbationControl"]> {
  const typeSubpath = "./runtime-custody"
  const typeTarget = join(packageRoot, exportTarget(exportsMap[typeSubpath]).replace(/^\.\//u, ""))
  const originalTypeTarget = readFileSync(typeTarget, "utf8")
  const wildcardTarget = join(packageRoot, "src/modules/runtime-custody/clean-fixture-extra-types.ts")
  const typeForms = [
    ["direct", "\nexport type CleanFixtureUnexpected = string\n"],
    ["named-type", "\ntype CleanFixtureUnexpected = string\nexport { type CleanFixtureUnexpected }\n"],
    ["wildcard", "\nexport type * from \"./clean-fixture-extra-types.ts\"\n"],
  ] as const
  const typeFormsRefused: string[] = []
  try {
    writeFileSync(wildcardTarget, "export type CleanFixtureUnexpected = string\n", { mode: 0o600 })
    for (const [label, source] of typeForms) {
      writeFileSync(typeTarget, `${originalTypeTarget}${source}`, { mode: 0o600 })
      if (!typeCatalogMatchesExpected(installedTypeCatalog(packageRoot, exportsMap))) {
        typeFormsRefused.push(label)
      }
    }
  } finally {
    writeFileSync(typeTarget, originalTypeTarget, { mode: 0o600 })
    rmSync(wildcardTarget, { force: true })
  }

  const runtimeSubpathsRefused: string[] = []
  for (const [subpath, exportValue] of Object.entries(exportsMap)) {
    const target = join(packageRoot, runtimeExportTarget(exportValue).replace(/^\.\//u, ""))
    const original = readFileSync(target, "utf8")
    try {
      writeFileSync(target, `${original}\nexport const cleanFixtureUnexpectedRuntime = true\n`, { mode: 0o600 })
      const specifier = subpath === "." ? packageName : `${packageName}${subpath.slice(1)}`
      const observed = await observeRuntimeExportKeys(consumerRoot, specifier, environment)
      const expected = expectedSubpathRuntimeExports[subpath]
      if (expected === undefined) throw new Error(`missing expected runtime catalog for ${subpath}`)
      if (JSON.stringify(observed) !== JSON.stringify(expected)) runtimeSubpathsRefused.push(subpath)
    } finally {
      writeFileSync(target, original, { mode: 0o600 })
    }
  }
  return { typeFormsRefused, runtimeSubpathsRefused }
}

async function proveExternalRuntimePerturbation(
  consumerRoot: string,
  observerRoot: string,
  packageRoot: string,
  foreignCwd: string,
  environment: Readonly<Record<string, string>>,
): Promise<boolean> {
  const dependencyRoot = join(consumerRoot, "node_modules", "clean-fixture-foreign-dependency")
  const target = join(packageRoot, "src/adapters/maintenance-command-facade/maintenance.ts")
  const original = readFileSync(target, "utf8")
  mkdirSync(dependencyRoot, { recursive: true, mode: 0o700 })
  writeFileSync(join(dependencyRoot, "package.json"), `${JSON.stringify({
    name: "clean-fixture-foreign-dependency",
    type: "module",
    exports: "./index.ts",
  })}\n`, { mode: 0o600 })
  writeFileSync(join(dependencyRoot, "index.ts"), "export const marker = true\n", { mode: 0o600 })
  try {
    writeFileSync(target, `${original}\nimport \"clean-fixture-foreign-dependency\"\n`, { mode: 0o600 })
    const observation = await observeCli(
      consumerRoot,
      join(observerRoot, "external-perturbation"),
      packageRoot,
      foreignCwd,
      environment,
    )
    return observation.importedFiles.includes("external:clean-fixture-foreign-dependency") &&
      JSON.stringify(observation.importedFiles) !== JSON.stringify(expectedDependencyFreeHelpRuntimeTrace)
  } finally {
    writeFileSync(target, original, { mode: 0o600 })
    rmSync(dependencyRoot, { recursive: true, force: true })
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function proveTimeoutCleanup(
  fixtureRoot: string,
  environment: Readonly<Record<string, string>>,
): Promise<InstalledPackageObservation["processTimeoutControl"]> {
  const childPidPath = join(fixtureRoot, "timeout-descendant.pid")
  const script = [
    `const child = Bun.spawn([\"/bin/sleep\", \"30\"], { stdout: \"inherit\", stderr: \"inherit\" })`,
    `await Bun.write(${JSON.stringify(childPidPath)}, String(child.pid))`,
    "await new Promise(() => undefined)",
  ].join("\n")
  const result = await spawn([process.execPath, "-e", script], {
    cwd: fixtureRoot,
    env: environment,
    deadlineMs: 150,
  })
  const descendantPid = Number(readFileSync(childPidPath, "utf8"))
  for (let attempt = 0; attempt < 50 && processExists(descendantPid); attempt += 1) {
    await Bun.sleep(10)
  }
  if (result.exitCode !== 124 || !result.cleanup.timedOut || processExists(descendantPid)) {
    throw new Error("bounded process timeout did not terminate its process tree")
  }
  return {
    exitCode: 124,
    timedOut: true,
    descriptorClosure: result.cleanup.descriptorClosure,
    cleanup: "process-group-killed",
    descendantPidObserved: true,
    descendantTerminated: true,
  }
}

async function observeInstalledFoundation(): Promise<InstalledFoundationObservation> {
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
      await spawn(["git", "rev-parse", "HEAD^{commit}"], { cwd: repositoryRoot, env: environment }),
    )
    if (!fullCommitPattern.test(sourceCommit)) throw new Error("source Git did not return one Full Commit Pin")
    requireSuccess(
      "temporary bare Git remote creation",
      await spawn(["git", "clone", "--bare", "--quiet", repositoryRoot, remoteRoot], { cwd: fixtureRoot, env: environment }),
    )
    const remoteCommit = requireSuccess(
      "temporary bare Git remote commit observation",
      await spawn(["git", `--git-dir=${remoteRoot}`, "rev-parse", `${sourceCommit}^{commit}`], { cwd: fixtureRoot, env: environment }),
    )
    writeConsumerFiles(consumerRoot, remoteRoot, sourceCommit)

    const gitDependency = `git+file://${remoteRoot}#${sourceCommit}`
    const lockCreation = await spawn(["bun", "add", "--ignore-scripts", "--exact", "--backend=copyfile", gitDependency], {
      cwd: consumerRoot,
      env: environment,
    })
    requireSuccess("Clean Fixture lock creation", lockCreation)
    rmSync(join(consumerRoot, "node_modules"), { recursive: true, force: true })
    const frozenInstall = await spawn(["bun", "install", "--ignore-scripts", "--production", "--frozen-lockfile", "--backend=copyfile"], {
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
    const publicTypeResolution = await observePublicTypeResolution(consumerRoot, environment)
    const typeCatalog = installedTypeCatalog(packageRoot, installedManifest.exports)
    const regularFiles = installedProductionFiles(packageRoot)
    const installedBytesSha256 = installedFilesDigest(packageRoot, regularFiles)
    const request = candidateAtCommit(sourceCommit)
    const mainInputPath = writeProbeInput(consumerRoot, "admitted", request, installedBytesSha256)
    const qualificationInputBindings = observeQualificationInputBindings(mainInputPath)
    const admissionProbePath = writeAdmissionProbe(consumerRoot)
    const qualificationProbePath = writeQualificationProbe(consumerRoot, publicSubpaths)
    const admittedExecutionOrder: string[] = ["admission"]
    const admission = readJsonOutput<AdmissionResult>(
      "installed public Admission probe",
      await spawn(["bun", "--no-install", admissionProbePath, mainInputPath], {
        cwd: consumerRoot,
        env: environment,
      }),
    )
    if (admission.kind !== "admitted") {
      throw new Error(`installed Candidate was refused before downstream execution: ${JSON.stringify(admission)}`)
    }
    admittedExecutionOrder.push("qualification")
    const qualificationProbe = readJsonOutput<{
      rootRuntimeExports: readonly string[]
      runtimeExports: Readonly<Record<string, readonly string[]>>
      personalQualification: QualificationOutcome
      publicQualification: QualificationOutcome
    }>(
      "installed public Qualification probe",
      await spawn(["bun", "--no-install", qualificationProbePath, mainInputPath], {
        cwd: consumerRoot,
        env: environment,
      }),
    )
    admittedExecutionOrder.push("maintenance-cli")
    const installedMaintenanceCliBase = await observeCli(
      consumerRoot,
      observerRoot,
      packageRoot,
      foreignCwd,
      environment,
    )
    const externalDependencyPerturbationRefused = await proveExternalRuntimePerturbation(
      consumerRoot,
      observerRoot,
      packageRoot,
      foreignCwd,
      environment,
    )
    const installedMaintenanceCli = {
      ...installedMaintenanceCliBase,
      externalDependencyPerturbationRefused,
    }
    const qualificationRuntimeTargetPerturbationRefused = await qualificationPerturbationIsRefused(
      consumerRoot,
      packageRoot,
      qualificationProbePath,
      mainInputPath,
      environment,
    )
    const mismatchedRequest = {
      ...request,
      package: { ...request.package, commit: "cccccccccccccccccccccccccccccccccccccccc" },
    }
    const refusedInputPath = writeProbeInput(
      consumerRoot,
      "refused",
      mismatchedRequest,
      installedBytesSha256,
    )
    const startedProcesses = ["admission"]
    const refusedAdmission = readJsonOutput<AdmissionResult>(
      "mismatched installed public Admission probe",
      await spawn(["bun", "--no-install", admissionProbePath, refusedInputPath], {
        cwd: consumerRoot,
        env: environment,
      }),
    )
    if (refusedAdmission.kind === "admitted") {
      startedProcesses.push("qualification")
      await spawn(["bun", "--no-install", qualificationProbePath, refusedInputPath], {
        cwd: consumerRoot,
        env: environment,
      })
      startedProcesses.push("maintenance-cli")
      await observeCli(
        consumerRoot,
        join(observerRoot, "refused-candidate"),
        packageRoot,
        foreignCwd,
        environment,
      )
    }
    const publicSurfacePerturbationControl = await provePublicSurfacePerturbations(
      consumerRoot,
      packageRoot,
      installedManifest.exports,
      environment,
    )
    const processTimeoutControl = await proveTimeoutCleanup(fixtureRoot, environment)

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
      rootRuntimeExports: qualificationProbe.rootRuntimeExports,
      subpathRuntimeExports: qualificationProbe.runtimeExports,
      publicSubpaths,
      regularFiles,
      lifecycleScriptLedger: existsSync(lifecycleLedgerPath)
        ? readFileSync(lifecycleLedgerPath, "utf8").split("\n").filter(Boolean)
        : [],
      installedBytesSha256,
      outsideRepository: relative(repositoryRoot, fixtureRoot).startsWith(".."),
      qualificationRuntimeTargetPerturbationRefused,
      admittedExecutionOrder: admittedExecutionOrder as ["admission", "qualification", "maintenance-cli"],
      admissionRefusalControl: {
        admission: refusedAdmission,
        startedProcesses,
      },
      publicSurfacePerturbationControl,
      qualificationInputBindings,
      processTimeoutControl,
      installedMaintenanceCli,
      admission,
      personalQualification: qualificationProbe.personalQualification,
      publicQualification: qualificationProbe.publicQualification,
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

export const installedFoundation = Object.freeze(await observeInstalledFoundation())

export function installedProcessObservationFor(argv: readonly string[]): ProcessObservation | undefined {
  const index = cleanFixtureHelpScenarios.findIndex((scenario) =>
    JSON.stringify(scenario.argv) === JSON.stringify(argv)
  )
  return index < 0 ? undefined : installedFoundation.installedMaintenanceCli.observations[index]
}
