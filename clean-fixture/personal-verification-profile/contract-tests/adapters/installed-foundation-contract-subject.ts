import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, relative, resolve } from "node:path"
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
  expectedQualificationConditionalExport,
  expectedRootTypeExports,
  expectedSubpathRuntimeExports,
  expectedSubpathTypeExports,
} from "../fixtures/plugin-consumer"

const repositoryRoot = resolve(import.meta.dir, "../../../../")
const packageName = "agent-plugin-kit"
const fullCommitPattern = /^[0-9a-f]{40}$/

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
  readonly rootValueDeclarations: readonly string[]
  readonly rootRuntimeExports: readonly string[]
  readonly subpathRuntimeExports: Readonly<Record<string, readonly string[]>>
  readonly publicSubpaths: readonly string[]
  readonly subpathTypeExports: Readonly<Record<string, readonly string[]>>
  readonly subpathValueDeclarations: Readonly<Record<string, readonly string[]>>
  readonly regularFiles: readonly string[]
  readonly symlinks: readonly InstalledSymlink[]
  readonly lifecycleScriptLedger: readonly string[]
  readonly installedBytesSha256: `sha256:${string}`
  readonly installedInventoryPerturbationControl: {
    readonly roguePath: "rogue.js"
    readonly exactInventoryRefused: true
    readonly digestChanged: true
    readonly inventoryRestored: true
    readonly digestRestored: true
    readonly symlinkTargetMutationRefused: true
    readonly symlinkReplacementRefused: true
    readonly symlinkRestored: true
  }
  readonly outsideRepository: boolean
  readonly fixtureRemoved: boolean
  readonly qualificationRuntimeTargetPerturbationControl: {
    readonly refused: true
    readonly baselineRestored: true
    readonly descriptor: typeof expectedQualificationConditionalExport
    readonly perturbationsRefused: readonly string[]
    readonly restorationsProved: readonly string[]
    readonly cachedBaselineRestorationRefused: true
  }
  readonly admittedExecutionOrder: readonly [
    "admission",
    "maintenance-cli",
    "observation-cells",
    "qualification",
  ]
  readonly admissionRefusalControl: {
    readonly admission: AdmissionResult
    readonly startedProcesses: readonly string[]
  }
  readonly causalOrderPerturbationControl: {
    readonly preAdmissionLaunchRefused: true
    readonly baselineRestored: true
  }
  readonly publicSurfacePerturbationControl: {
    readonly typeFormsRefused: readonly string[]
    readonly typeBaselineRestored: true
    readonly runtimeSubpathsRefused: readonly string[]
    readonly runtimeSubpathsRestored: readonly string[]
    readonly valueDeclarationsRefused: readonly string[]
    readonly compilerBaselineRestored: true
  }
  readonly observationBindingControl: {
    readonly baselineProvedClaims: readonly ["kit.command.invoked", "runtime.supported-platform"]
    readonly missingObservationRefused: true
    readonly poisonedObservationRefused: true
    readonly commandReceiptDigest: `sha256:${string}`
    readonly runtimeReceiptDigest: `sha256:${string}`
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
    readonly processGroupTerminated: true
    readonly monotonicClock: "performance.now"
    readonly deadlineMs: 150
    readonly graceMs: 1_000
    readonly elapsedMs: number
    readonly withinDeadlineGrace: true
    readonly postKillGraceExpired: false
    readonly readerCancellation: "not-required"
    readonly readerCancellationMs: 100
    readonly readerCancellationSensitivity: {
      readonly rejectionClassified: true
      readonly rejectionDoesNotClaimClosure: true
      readonly deadlineClassified: true
      readonly deadlineDoesNotClaimClosure: true
      readonly deadlineBounded: true
    }
    readonly descriptorHoldingSensitivity: {
      readonly refused: true
      readonly postKillGraceExpired: true
      readonly descriptorClosure: "cancelled-after-grace"
      readonly descendantTerminatedAfterRestoration: true
      readonly withinOuterBound: true
      readonly outerDeadlineMs: 1_650
      readonly readerCancellation: "completed"
      readonly readerCancellationMs: 100
    }
  }
}

type InstalledMaintenanceCliObservation = {
  readonly observations: readonly ProcessObservation[]
  readonly importedFiles: readonly string[]
  readonly cwd: string
  readonly installedFiles: readonly string[]
  readonly externalDependencyPerturbationRefused: boolean
  readonly externalDependencyBaselineRestored: boolean
  readonly escapedRuntimePerturbationRefused: boolean
  readonly escapedRuntimeBaselineRestored: boolean
  readonly nonJavaScriptRuntimePerturbationRefused: boolean
  readonly nonJavaScriptRuntimeBaselineRestored: boolean
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
    readonly descriptorClosure:
      | "closed"
      | "cancelled-after-grace"
      | "cancellation-rejected"
      | "cancellation-deadline-expired"
    readonly cleanup: "natural" | "process-group-killed"
    readonly processGroupId: number
    readonly postKillGraceMs: number
    readonly postKillGraceExpired: boolean
    readonly readerCancellation: "not-required" | "completed" | "rejected" | "deadline-expired"
    readonly readerCancellationMs: number
  }
}

type InstalledSymlink = {
  readonly path: string
  readonly kind: "symlink"
  readonly linkText: string
}

type InstalledEntry =
  | { readonly path: string; readonly kind: "regular-file" }
  | InstalledSymlink

type HostObservation = {
  readonly os: "darwin" | "linux"
  readonly arch: "arm64" | "x64"
}

type PublicProcessEvidence = {
  readonly commandReceiptDigest: `sha256:${string}`
  readonly runtimeReceiptDigest: `sha256:${string}`
  readonly platform: HostObservation
}

type QualificationProbeObservation = {
  readonly rootRuntimeExports: readonly string[]
  readonly runtimeExports: Readonly<Record<string, readonly string[]>>
  readonly personalQualification: QualificationOutcome
  readonly publicQualification: QualificationOutcome
}

type ExecutionPhase = "admission" | "maintenance-cli" | "observation-cells" | "qualification"

class PhaseLedger {
  readonly #phases: ExecutionPhase[] = []

  record(phase: ExecutionPhase): void {
    if (this.#phases.at(-1) !== phase) this.#phases.push(phase)
  }

  snapshot(): readonly ExecutionPhase[] {
    return [...this.#phases]
  }
}

const defaultProcessDeadlineMs = 30_000
const defaultPostKillGraceMs = 1_000
const readerCancellationDeadlineMs = 100

function timer(ms: number): { readonly elapsed: Promise<void>; readonly cancel: () => void } {
  let handle: ReturnType<typeof setTimeout> | undefined
  const elapsed = new Promise<void>((resolveTimer) => {
    handle = setTimeout(resolveTimer, ms)
  })
  return {
    elapsed,
    cancel: () => {
      if (handle !== undefined) clearTimeout(handle)
    },
  }
}

function captureStream(stream: ReadableStream<Uint8Array>): {
  readonly completed: Promise<void>
  readonly cancel: () => Promise<void>
  readonly text: () => string
} {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let captured = ""
  const completed = (async () => {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      captured += decoder.decode(item.value, { stream: true })
    }
    captured += decoder.decode()
  })()
  return {
    completed,
    cancel: async () => {
      await reader.cancel()
    },
    text: () => captured,
  }
}

function killProcessGroup(pid: number, killChild: () => void): void {
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    killChild()
  }
}

async function settleAfterProcessKill(
  settled: Promise<unknown>,
  stdout: Pick<ReturnType<typeof captureStream>, "cancel">,
  stderr: Pick<ReturnType<typeof captureStream>, "cancel">,
  postKillGraceMs: number,
): Promise<{
  readonly graceExpired: boolean
  readonly readerCancellation: "not-required" | "completed" | "rejected" | "deadline-expired"
}> {
  const grace = timer(postKillGraceMs)
  const postKill = await Promise.race([
    settled.then(() => "settled" as const),
    grace.elapsed.then(() => "grace-expired" as const),
  ])
  grace.cancel()
  const graceExpired = postKill === "grace-expired"
  if (!graceExpired) return { graceExpired: false, readerCancellation: "not-required" }
  const cancellation = timer(readerCancellationDeadlineMs)
  const cancellationResult = await Promise.race([
    Promise.allSettled([stdout.cancel(), stderr.cancel()]).then((results) =>
      results.every((result) => result.status === "fulfilled") ? "completed" as const : "rejected" as const
    ),
    cancellation.elapsed.then(() => "deadline-expired" as const),
  ])
  cancellation.cancel()
  return { graceExpired: true, readerCancellation: cancellationResult }
}

function optionalSpawnEnvironment(
  environment: Readonly<Record<string, string | undefined>> | undefined,
): {} | { readonly env: Readonly<Record<string, string | undefined>> } {
  return environment === undefined ? {} : { env: environment }
}

function descriptorClosureFor(
  settlement: Awaited<ReturnType<typeof settleAfterProcessKill>>,
): SpawnResult["cleanup"]["descriptorClosure"] {
  if (settlement.readerCancellation === "deadline-expired") return "cancellation-deadline-expired"
  if (settlement.readerCancellation === "rejected") return "cancellation-rejected"
  return settlement.graceExpired ? "cancelled-after-grace" : "closed"
}

async function proveReaderCancellationSensitivity(): Promise<
  InstalledPackageObservation["processTimeoutControl"]["readerCancellationSensitivity"]
> {
  const neverSettles = new Promise<never>(() => undefined)
  const completedCancellation = { cancel: async () => undefined }
  const rejected = await settleAfterProcessKill(
    neverSettles,
    { cancel: async () => await Promise.reject(new Error("reader cancellation refused")) },
    completedCancellation,
    0,
  )
  const deadlineStartedAt = performance.now()
  const deadline = await settleAfterProcessKill(
    neverSettles,
    { cancel: async () => await neverSettles },
    { cancel: async () => await neverSettles },
    0,
  )
  const deadlineElapsedMs = performance.now() - deadlineStartedAt
  const rejectionClassified = rejected.readerCancellation === "rejected"
  const rejectionDoesNotClaimClosure = descriptorClosureFor(rejected) === "cancellation-rejected"
  const deadlineClassified = deadline.readerCancellation === "deadline-expired"
  const deadlineDoesNotClaimClosure = descriptorClosureFor(deadline) === "cancellation-deadline-expired"
  const deadlineBounded = deadlineElapsedMs >= readerCancellationDeadlineMs &&
    deadlineElapsedMs <= readerCancellationDeadlineMs + 100
  if (!(rejectionClassified && rejectionDoesNotClaimClosure && deadlineClassified &&
    deadlineDoesNotClaimClosure && deadlineBounded)) {
    throw new Error("reader cancellation rejection/deadline sensitivity did not fail closed")
  }
  return {
    rejectionClassified: true,
    rejectionDoesNotClaimClosure: true,
    deadlineClassified: true,
    deadlineDoesNotClaimClosure: true,
    deadlineBounded: true,
  }
}

async function spawn(command: readonly string[], options: {
  readonly cwd: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly deadlineMs?: number
  readonly postKillGraceMs?: number
  readonly phase?: { readonly ledger: PhaseLedger; readonly name: ExecutionPhase }
}): Promise<SpawnResult> {
  const deadlineMs = options.deadlineMs ?? defaultProcessDeadlineMs
  const postKillGraceMs = options.postKillGraceMs ?? defaultPostKillGraceMs
  options.phase?.ledger.record(options.phase.name)
  const child = Bun.spawn([...command], {
    cwd: options.cwd,
    ...optionalSpawnEnvironment(options.env),
    detached: true,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = captureStream(child.stdout)
  const stderr = captureStream(child.stderr)
  let observedExitCode: number | undefined
  const settled = Promise.all([
    child.exited.then((exitCode) => {
      observedExitCode = exitCode
    }),
    stdout.completed,
    stderr.completed,
  ])
  const deadline = timer(deadlineMs)
  const first = await Promise.race([
    settled.then(() => "settled" as const),
    deadline.elapsed.then(() => "deadline" as const),
  ])
  deadline.cancel()
  const timedOut = first === "deadline"
  if (timedOut) killProcessGroup(child.pid, () => child.kill("SIGKILL"))
  const postKillSettlement = timedOut
    ? await settleAfterProcessKill(settled, stdout, stderr, postKillGraceMs)
    : { graceExpired: false, readerCancellation: "not-required" as const }
  const descriptorClosure = descriptorClosureFor(postKillSettlement)
  return {
    exitCode: timedOut ? 124 : (observedExitCode ?? 1),
    stdout: stdout.text(),
    stderr: stderr.text(),
    cleanup: {
      deadlineMs,
      timedOut,
      descriptorClosure,
      cleanup: timedOut ? "process-group-killed" : "natural",
      processGroupId: child.pid,
      postKillGraceMs,
      postKillGraceExpired: postKillSettlement.graceExpired,
      readerCancellation: postKillSettlement.readerCancellation,
      readerCancellationMs: readerCancellationDeadlineMs,
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

function walkInstalledEntries(root: string, prefix = ""): InstalledEntry[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    const absolute = join(root, entry.name)
    const identity = lstatSync(absolute)
    if (identity.isDirectory()) return walkInstalledEntries(absolute, path)
    if (identity.isFile()) return [{ path, kind: "regular-file" as const }]
    if (identity.isSymbolicLink()) {
      return [{ path, kind: "symlink" as const, linkText: readlinkSync(absolute) }]
    }
    return []
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
}

function installedRegularFiles(packageRoot: string): string[] {
  return walkInstalledEntries(packageRoot)
    .filter((entry) => entry.kind === "regular-file")
    .map((entry) => entry.path)
}

function installedEntriesDigest(
  packageRoot: string,
  entries: readonly InstalledEntry[],
): `sha256:${string}` {
  const hash = createHash("sha256")
  for (const entry of entries) {
    hash.update(entry.path)
    hash.update("\0")
    hash.update(entry.kind)
    hash.update("\0")
    if (entry.kind === "regular-file") hash.update(readFileSync(join(packageRoot, entry.path)))
    else hash.update(entry.linkText)
    hash.update("\0")
  }
  return `sha256:${hash.digest("hex")}`
}

function proveCompleteInstalledInventory(
  packageRoot: string,
  expectedEntries: readonly InstalledEntry[],
  expectedDigest: `sha256:${string}`,
): InstalledPackageObservation["installedInventoryPerturbationControl"] {
  const roguePath = "rogue.js" as const
  const absoluteRoguePath = join(packageRoot, roguePath)
  let perturbedEntries: readonly InstalledEntry[] = []
  let perturbedDigest: `sha256:${string}` = expectedDigest
  try {
    writeFileSync(absoluteRoguePath, "export const escapedInventory = true\n", { mode: 0o600 })
    perturbedEntries = walkInstalledEntries(packageRoot)
    perturbedDigest = installedEntriesDigest(packageRoot, perturbedEntries)
  } finally {
    rmSync(absoluteRoguePath, { force: true })
  }
  const restoredEntries = walkInstalledEntries(packageRoot)
  const restoredDigest = installedEntriesDigest(packageRoot, restoredEntries)
  const exactInventoryRefused = JSON.stringify(perturbedEntries) !== JSON.stringify(expectedEntries) &&
    perturbedEntries.some((entry) => entry.path === roguePath && entry.kind === "regular-file")
  const digestChanged = perturbedDigest !== expectedDigest
  const inventoryRestored = JSON.stringify(restoredEntries) === JSON.stringify(expectedEntries)
  const digestRestored = restoredDigest === expectedDigest

  const symlink = expectedEntries.find((entry): entry is InstalledSymlink => entry.kind === "symlink")
  if (symlink === undefined) throw new Error("installed symlink oracle is empty")
  const symlinkPath = join(packageRoot, symlink.path)
  let mutatedTargetEntries: readonly InstalledEntry[] = []
  let mutatedTargetDigest: `sha256:${string}` = expectedDigest
  let replacementEntries: readonly InstalledEntry[] = []
  let replacementDigest: `sha256:${string}` = expectedDigest
  try {
    rmSync(symlinkPath, { force: true })
    symlinkSync(`${symlink.linkText}-mutated`, symlinkPath)
    mutatedTargetEntries = walkInstalledEntries(packageRoot)
    mutatedTargetDigest = installedEntriesDigest(packageRoot, mutatedTargetEntries)
    rmSync(symlinkPath, { force: true })
    writeFileSync(symlinkPath, "not-a-symlink\n", { mode: 0o600 })
    replacementEntries = walkInstalledEntries(packageRoot)
    replacementDigest = installedEntriesDigest(packageRoot, replacementEntries)
  } finally {
    rmSync(symlinkPath, { force: true })
    symlinkSync(symlink.linkText, symlinkPath)
  }
  const symlinkRestoredEntries = walkInstalledEntries(packageRoot)
  const symlinkRestoredDigest = installedEntriesDigest(packageRoot, symlinkRestoredEntries)
  const symlinkTargetMutationRefused = JSON.stringify(mutatedTargetEntries) !==
      JSON.stringify(expectedEntries) && mutatedTargetDigest !== expectedDigest
  const symlinkReplacementRefused = JSON.stringify(replacementEntries) !==
      JSON.stringify(expectedEntries) && replacementDigest !== expectedDigest
  const symlinkRestored = JSON.stringify(symlinkRestoredEntries) === JSON.stringify(expectedEntries) &&
    symlinkRestoredDigest === expectedDigest

  if (
    [
      exactInventoryRefused,
      digestChanged,
      inventoryRestored,
      digestRestored,
      symlinkTargetMutationRefused,
      symlinkReplacementRefused,
      symlinkRestored,
    ].includes(false)
  ) {
    throw new Error(`complete installed inventory perturbation was not refused and restored: ${JSON.stringify({
      exactInventoryRefused,
      digestChanged,
      inventoryRestored,
      digestRestored,
      symlinkTargetMutationRefused,
      symlinkReplacementRefused,
      symlinkRestored,
    })}`)
  }
  return {
    roguePath,
    exactInventoryRefused: true,
    digestChanged: true,
    inventoryRestored: true,
    digestRestored: true,
    symlinkTargetMutationRefused: true,
    symlinkReplacementRefused: true,
    symlinkRestored: true,
  }
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
  for (const match of source.matchAll(/^export\s+(?:default\s+)?(?:declare\s+)?(?:interface|type|class|enum|namespace)\s+([A-Za-z_$][\w$]*)/gmu)) {
    if (match[1] !== undefined) append(match[1])
  }
  return names
}

function exportedValueNames(source: string): string[] {
  return [...source.matchAll(
    /^export\s+(?:declare\s+)?(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/gmu,
  )].flatMap((match) => match[1] === undefined ? [] : [match[1]])
}

function installedTypeCatalog(
  packageRoot: string,
  exportsMap: Readonly<Record<string, unknown>>,
): {
  rootTypeExports: readonly string[]
  rootValueDeclarations: readonly string[]
  subpathTypeExports: Readonly<Record<string, readonly string[]>>
  subpathValueDeclarations: Readonly<Record<string, readonly string[]>>
} {
  const entries = Object.entries(exportsMap).map(([subpath, value]) => {
    const target = exportTarget(value).replace(/^\.\//u, "")
    const source = readFileSync(join(packageRoot, target), "utf8")
    return [subpath, exportedTypeNames(source), exportedValueNames(source)] as const
  })
  return {
    rootTypeExports: entries.find(([subpath]) => subpath === ".")?.[1] ?? [],
    rootValueDeclarations: entries.find(([subpath]) => subpath === ".")?.[2] ?? [],
    subpathTypeExports: Object.fromEntries(entries.filter(([subpath]) => subpath !== ".")),
    subpathValueDeclarations: Object.fromEntries(
      entries.filter(([subpath]) => subpath !== ".").map(([subpath, , values]) => [subpath, values]),
    ),
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
    `import { admissionBootstrap } from ${JSON.stringify(`${packageName}/admission-bootstrap`)}`,
    `import type { AdmissionBootstrap } from ${JSON.stringify(`${packageName}/admission-bootstrap`)}`,
    `import { qualificationEvidence } from ${JSON.stringify(`${packageName}/qualification-evidence`)}`,
    `import type { QualificationEvidence } from ${JSON.stringify(`${packageName}/qualification-evidence`)}`,
    "const admittedValue: AdmissionBootstrap = admissionBootstrap",
    "const qualificationValue: QualificationEvidence = qualificationEvidence",
    "void admittedValue",
    "void qualificationValue",
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

async function publicTypeResolutionSucceeds(
  consumerRoot: string,
  environment: Readonly<Record<string, string>>,
): Promise<boolean> {
  try {
    await observePublicTypeResolution(consumerRoot, environment)
    return true
  } catch {
    return false
  }
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

function receiptDigestFor(
  cell: ReturnType<typeof personalProfileCells>[number],
  installedBytesSha256: `sha256:${string}`,
  processEvidence: PublicProcessEvidence,
): `sha256:${string}` | undefined {
  if (cell.assertedStatus !== "proved" || cell.receipt === null) return undefined
  if (cell.claim === "plugin-payload.installed") return installedBytesSha256
  if (cell.claim === "kit.command.invoked") return processEvidence.commandReceiptDigest
  if (cell.claim === "runtime.supported-platform") return processEvidence.runtimeReceiptDigest
  return cell.receipt.digest
}

function projectProfileCell(
  cell: ReturnType<typeof personalProfileCells>[number],
  candidate: ReturnType<typeof candidateAtCommit>["candidate"],
  installedBytesSha256: `sha256:${string}`,
  processEvidence: PublicProcessEvidence,
) {
  const candidateIdentitySha256 = independentCandidateIdentityDigest(candidate)
  const installedPayload = cell.assertedStatus === "proved" && cell.claim === "plugin-payload.installed"
  const runtimeObserved = cell.assertedStatus === "proved" && cell.claim === "runtime.supported-platform"
  const receiptDigest = receiptDigestFor(cell, installedBytesSha256, processEvidence)
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
      ...(runtimeObserved
        ? { platform: processEvidence.platform }
        : {}),
    },
    receipt: cell.receipt === null
      ? null
      : {
          ...cell.receipt,
          candidateIdentitySha256,
          digest: receiptDigest ?? cell.receipt.digest,
        },
  }
}

function derivePublicProcessEvidence(
  commandObservation: ProcessObservation | undefined,
  hostObservation: HostObservation | undefined,
): PublicProcessEvidence | undefined {
  if (commandObservation === undefined || hostObservation === undefined) return undefined
  if (commandObservation.exitCode !== 0 || commandObservation.stderr !== "") return undefined
  try {
    const envelope = JSON.parse(commandObservation.stdout) as { status?: unknown }
    if (envelope.status !== "ok") return undefined
  } catch {
    return undefined
  }
  const commandReceiptDigest = sha256(JSON.stringify({
    schemaVersion: 1,
    argv: cleanFixtureHelpScenarios[0]?.argv ?? [],
    observation: {
      stdout: commandObservation.stdout,
      stderr: commandObservation.stderr,
      exitCode: commandObservation.exitCode,
    },
  }))
  return {
    commandReceiptDigest,
    runtimeReceiptDigest: sha256(JSON.stringify({
      schemaVersion: 1,
      platform: hostObservation,
      commandReceiptDigest,
    })),
    platform: hostObservation,
  }
}

async function observeHost(
  consumerRoot: string,
  environment: Readonly<Record<string, string>>,
  phaseLedger?: PhaseLedger,
): Promise<HostObservation> {
  const result = readJsonOutput<{ readonly os: string; readonly arch: string }>(
    "Clean Fixture host observation",
    await spawn([
      "bun",
      "--no-install",
      "-e",
      "console.log(JSON.stringify({ os: process.platform, arch: process.arch }))",
    ], {
      cwd: consumerRoot,
      env: environment,
      ...(phaseLedger === undefined
        ? {}
        : { phase: { ledger: phaseLedger, name: "maintenance-cli" as const } }),
    }),
  )
  if (!(["darwin", "linux"] as const).includes(result.os as "darwin" | "linux")) {
    throw new Error(`unsupported observed operating system: ${result.os}`)
  }
  if (!(["arm64", "x64"] as const).includes(result.arch as "arm64" | "x64")) {
    throw new Error(`unsupported observed architecture: ${result.arch}`)
  }
  return result as HostObservation
}

function proveObservationBinding(
  commandObservation: ProcessObservation,
  hostObservation: HostObservation,
): InstalledPackageObservation["observationBindingControl"] {
  const baseline = derivePublicProcessEvidence(commandObservation, hostObservation)
  const missing = derivePublicProcessEvidence(undefined, hostObservation)
  const poisoned = derivePublicProcessEvidence(
    { ...commandObservation, exitCode: 1 },
    hostObservation,
  )
  if (baseline === undefined || missing !== undefined || poisoned !== undefined) {
    throw new Error("command and runtime evidence construction did not fail closed")
  }
  return {
    baselineProvedClaims: ["kit.command.invoked", "runtime.supported-platform"],
    missingObservationRefused: true,
    poisonedObservationRefused: true,
    commandReceiptDigest: baseline.commandReceiptDigest,
    runtimeReceiptDigest: baseline.runtimeReceiptDigest,
  }
}

function writeAdmissionInput(
  consumerRoot: string,
  name: string,
  request: ReturnType<typeof candidateAtCommit>,
): string {
  const inputPath = join(consumerRoot, `${name}-admission-input.json`)
  writeFileSync(inputPath, `${JSON.stringify({ request })}\n`, { mode: 0o600 })
  return inputPath
}

function writeProbeInput(
  consumerRoot: string,
  name: string,
  request: ReturnType<typeof candidateAtCommit>,
  installedBytesSha256: `sha256:${string}`,
  processEvidence: PublicProcessEvidence,
): string {
  const candidate = request.candidate
  const projectCell = (cell: ReturnType<typeof personalProfileCells>[number]) =>
    projectProfileCell(cell, candidate, installedBytesSha256, processEvidence)
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

async function provePreAdmissionLaunchRefusal(
  consumerRoot: string,
  foreignCwd: string,
  environment: Readonly<Record<string, string>>,
  admissionProbePath: string,
  admissionInputPath: string,
): Promise<boolean> {
  const ledger = new PhaseLedger()
  const binary = join(consumerRoot, "node_modules/.bin/agent-plugin-kit")
  await spawn(["bun", "--no-install", binary, "--run-id", "pre-admission-control", "--help"], {
    cwd: foreignCwd,
    env: environment,
    phase: { ledger, name: "maintenance-cli" },
  })
  await spawn(["bun", "--no-install", admissionProbePath, admissionInputPath], {
    cwd: consumerRoot,
    env: environment,
    phase: { ledger, name: "admission" },
  })
  return JSON.stringify(ledger.snapshot()) !== JSON.stringify([
    "admission",
    "maintenance-cli",
    "observation-cells",
    "qualification",
  ])
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
      `import { appendFileSync, existsSync, realpathSync } from "node:fs"\n` +
      `import { basename, dirname, isAbsolute, relative, resolve } from "node:path"\n` +
      `const packageRoot = ${JSON.stringify(packageRoot)}\n` +
      `const consumerRoot = ${JSON.stringify(consumerRoot)}\n` +
      `const tracePath = ${JSON.stringify(tracePath)}\n` +
      `const instrumentationPath = ${JSON.stringify(preload)}\n` +
      `const externalPackage = (path) => { const marker = "/node_modules/"; const index = path.lastIndexOf(marker); if (index < 0) return undefined; const parts = path.slice(index + marker.length).split("/"); return parts[0]?.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0] }\n` +
      `const append = (identity) => appendFileSync(tracePath, identity + "\\n")\n` +
      `const record = (path) => { const resolved = realpathSync(path); if (resolved === instrumentationPath) return; if (resolved.startsWith(packageRoot + "/")) append(relative(packageRoot, resolved)); else { const packageName = externalPackage(resolved); append(packageName ? "external:" + packageName : "outside-package:" + basename(resolved)) } }\n` +
      `const recordBare = (specifier) => { if (specifier.startsWith("node:") || specifier.startsWith("bun:")) return; const parts = specifier.split("/"); const packageName = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]; if (packageName && packageName !== ${JSON.stringify(packageName)}) append("external:" + packageName) }\n` +
      `const recordSpecifier = (specifier, importer) => { if (!specifier.startsWith(".") && !specifier.startsWith("/")) return recordBare(specifier); const candidate = isAbsolute(specifier) ? specifier : resolve(dirname(importer), specifier); if (existsSync(candidate)) record(candidate) }\n` +
      `record(process.argv[1])\n` +
      `const loaderFor = (path) => path.endsWith(".tsx") ? "tsx" : path.endsWith(".jsx") ? "jsx" : path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs") ? "js" : "ts"\n` +
      `Bun.plugin({ name: "clean-fixture-runtime-trace", setup(builder) { builder.onResolve({ filter: /.*/ }, ({ path, importer }) => { recordSpecifier(path, importer); return undefined }); builder.onLoad({ filter: /\\.[cm]?[jt]sx?$/ }, async ({ path }) => { record(path); return { contents: await Bun.file(path).text(), loader: loaderFor(path) } }) } })\n`,
    { mode: 0o600 },
  )
  return preload
}

const requiredStationIdsIn = (literal: string): string[] =>
  [...literal.matchAll(/station\(\{([\s\S]*?)\}\)/gu)]
    .map((match) => match[1] ?? "")
    .filter((body) => /reachability:\s*"required"/u.test(body))
    .map((body) => {
      const command = /commandId:\s*"([^"]+)"/u.exec(body)?.[1]
      const result = /resultCode:\s*"([^"]+)"/u.exec(body)?.[1]
      if (command === undefined || result === undefined) throw new Error("required Branch Station literal is incomplete")
      return `${command.replaceAll(":", "-")}.${result}`
    })

/**
 * Required Station IDs in catalog order: direct `station({...})` rows and each
 * spread `...<name>` array literal in the order the catalog lists them.
 */
function requiredStationIdsInCatalogOrder(source: string): string[] {
  const catalogSource = source.split("export const branchStationCatalog = [")[1]?.split("] as const satisfies readonly BranchStation[]")[0]
  if (catalogSource === undefined) throw new Error("installed Branch Station catalog declaration is absent")
  const ids: string[] = []
  for (const member of catalogSource.matchAll(/station\(\{[\s\S]*?\}\)|\.\.\.([A-Za-z_$][\w$]*)/gu)) {
    const spreadName = member[1]
    if (spreadName === undefined) {
      ids.push(...requiredStationIdsIn(member[0]))
      continue
    }
    const declaration = new RegExp(`const ${spreadName} = (?:ownerPairStations\\(|\\[)([\\s\\S]*?)\\n(?:\\]|\\))\\n`, "u").exec(source)
    if (declaration === null) throw new Error(`installed Branch Station spread ${spreadName} is absent`)
    ids.push(...requiredStationIdsIn(declaration[1] ?? ""))
  }
  return ids
}

function observeStationMap(packageRoot: string): InstalledMaintenanceCliObservation["stationMap"] {
  const target = join(packageRoot, "src/modules/maintenance-command-contract/branch-stations.ts")
  const source = readFileSync(target, "utf8")
  const sourceSha256 = sha256(source)
  const requiredStationIds = requiredStationIdsInCatalogOrder(source)
  return {
    declared_branch_coverage: sourceSha256 === expectedBranchStationSourceSha256 ? 119 : 0,
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
  phaseLedger?: PhaseLedger,
): Promise<Omit<
  InstalledMaintenanceCliObservation,
  | "externalDependencyPerturbationRefused"
  | "externalDependencyBaselineRestored"
  | "escapedRuntimePerturbationRefused"
  | "escapedRuntimeBaselineRestored"
  | "nonJavaScriptRuntimePerturbationRefused"
  | "nonJavaScriptRuntimeBaselineRestored"
>> {
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
      ...(phaseLedger === undefined
        ? {}
        : { phase: { ledger: phaseLedger, name: "maintenance-cli" as const } }),
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
    installedFiles: installedRegularFiles(packageRoot),
    stationMap: observeStationMap(packageRoot),
  }
}

function cliObservationMatchesBaseline(
  observation: Omit<
    InstalledMaintenanceCliObservation,
    | "externalDependencyPerturbationRefused"
    | "externalDependencyBaselineRestored"
    | "escapedRuntimePerturbationRefused"
    | "escapedRuntimeBaselineRestored"
    | "nonJavaScriptRuntimePerturbationRefused"
    | "nonJavaScriptRuntimeBaselineRestored"
  >,
  baseline: Omit<
    InstalledMaintenanceCliObservation,
    | "externalDependencyPerturbationRefused"
    | "externalDependencyBaselineRestored"
    | "escapedRuntimePerturbationRefused"
    | "escapedRuntimeBaselineRestored"
    | "nonJavaScriptRuntimePerturbationRefused"
    | "nonJavaScriptRuntimeBaselineRestored"
  >,
): boolean {
  return JSON.stringify(observation) === JSON.stringify(baseline)
}

async function qualificationPerturbationIsRefused(
  consumerRoot: string,
  packageRoot: string,
  probePath: string,
  probeInputPath: string,
  environment: Readonly<Record<string, string>>,
  baseline: QualificationProbeObservation,
): Promise<InstalledPackageObservation["qualificationRuntimeTargetPerturbationControl"]> {
  const manifestPath = join(packageRoot, "package.json")
  const original = readFileSync(manifestPath, "utf8")
  const baselineManifest = JSON.parse(original) as { exports: Record<string, unknown> }
  const baselineDescriptor = qualificationConditionalDescriptor(baselineManifest.exports)
  if (!qualificationDescriptorMatchesExpected(baselineDescriptor)) {
    throw new Error("installed Qualification Evidence conditional descriptor is not exact")
  }
  const targets = expectedQualificationConditionalExport.targets
  const perturbations = [
    ["remove-types", { import: targets.import, default: targets.default }],
    ["remove-import", { types: targets.types, default: targets.default }],
    ["remove-default", { types: targets.types, import: targets.import }],
    ["reorder", { import: targets.import, types: targets.types, default: targets.default }],
    ["redirect-types", { types: targets.import, import: targets.import, default: targets.default }],
    ["redirect-import", { types: targets.types, import: targets.types, default: targets.default }],
    ["redirect-default-only", { types: targets.types, import: targets.import, default: targets.types }],
  ] as const
  const perturbationsRefused: string[] = []
  const restorationsProved: string[] = []
  for (const [label, descriptor] of perturbations) {
    const manifest = JSON.parse(original) as { exports: Record<string, unknown> }
    manifest.exports["./qualification-evidence"] = descriptor
    try {
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
      const installedPerturbation = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        exports: Record<string, unknown>
      }
      if (!qualificationDescriptorMatchesExpected(
        qualificationConditionalDescriptor(installedPerturbation.exports),
      )) perturbationsRefused.push(label)
    } finally {
      writeFileSync(manifestPath, original, { mode: 0o600 })
    }
    if (await qualificationDescriptorRestored({
      consumerRoot,
      packageRoot,
      manifestPath,
      probePath,
      probeInputPath,
      environment,
      baseline,
      label,
    })) restorationsProved.push(label)
  }
  const cachedBaselineRestorationRefused = proveCachedDescriptorCannotRestoreDisk(
    manifestPath,
    original,
    baselineDescriptor,
  )
  if (
    perturbationsRefused.length !== perturbations.length ||
    restorationsProved.length !== perturbations.length ||
    !cachedBaselineRestorationRefused
  ) {
    throw new Error(`Qualification conditional descriptor perturbations were not refused and restored: ${JSON.stringify({
      expected: perturbations.map(([label]) => label),
      perturbationsRefused,
      restorationsProved,
      cachedBaselineRestorationRefused,
    })}`)
  }
  return {
    refused: true,
    baselineRestored: true,
    descriptor: expectedQualificationConditionalExport,
    perturbationsRefused,
    restorationsProved,
    cachedBaselineRestorationRefused: true,
  }
}

async function qualificationDescriptorRestored(input: {
  readonly consumerRoot: string
  readonly packageRoot: string
  readonly manifestPath: string
  readonly probePath: string
  readonly probeInputPath: string
  readonly environment: Readonly<Record<string, string>>
  readonly baseline: QualificationProbeObservation
  readonly label: string
}): Promise<boolean> {
  const restoredManifest = JSON.parse(readFileSync(input.manifestPath, "utf8")) as {
    exports: Record<string, unknown>
  }
  const descriptorRestored = qualificationDescriptorMatchesExpected(
    qualificationConditionalDescriptor(restoredManifest.exports),
  )
  const compilerRestored = await publicTypeResolutionSucceeds(input.consumerRoot, input.environment)
  const catalogRestored = typeCatalogMatchesExpected(
    installedTypeCatalog(input.packageRoot, restoredManifest.exports),
  )
  const runtimeRestored = readJsonOutput<QualificationProbeObservation>(
    `restored Qualification descriptor after ${input.label}`,
    await spawn(["bun", "--no-install", input.probePath, input.probeInputPath], {
      cwd: input.consumerRoot,
      env: input.environment,
    }),
  )
  const runtimeMatchesBaseline = JSON.stringify(runtimeRestored) === JSON.stringify(input.baseline)
  if (!descriptorRestored || !compilerRestored || !catalogRestored || !runtimeMatchesBaseline) {
    throw new Error(`Qualification conditional descriptor restoration failed: ${JSON.stringify({
      label: input.label,
      descriptorRestored,
      compilerRestored,
      catalogRestored,
      runtimeMatchesBaseline,
    })}`)
  }
  return true
}

function proveCachedDescriptorCannotRestoreDisk(
  manifestPath: string,
  original: string,
  cachedDescriptor: ReturnType<typeof qualificationConditionalDescriptor>,
): boolean {
  const manifest = JSON.parse(original) as { exports: Record<string, unknown> }
  manifest.exports["./qualification-evidence"] = {
    types: expectedQualificationConditionalExport.targets.types,
    import: expectedQualificationConditionalExport.targets.import,
    default: expectedQualificationConditionalExport.targets.types,
  }
  let cachedRefused = false
  try {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
    const diskManifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      exports: Record<string, unknown>
    }
    cachedRefused = qualificationDescriptorMatchesExpected(cachedDescriptor) &&
      !qualificationDescriptorMatchesExpected(qualificationConditionalDescriptor(diskManifest.exports))
  } finally {
    writeFileSync(manifestPath, original, { mode: 0o600 })
  }
  const restoredManifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    exports: Record<string, unknown>
  }
  return cachedRefused && qualificationDescriptorMatchesExpected(
    qualificationConditionalDescriptor(restoredManifest.exports),
  )
}

function qualificationConditionalDescriptor(exportsMap: Readonly<Record<string, unknown>>): {
  readonly keys: readonly string[]
  readonly targets: Readonly<Record<string, string>>
} | undefined {
  const value = exportsMap["./qualification-evidence"]
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  const entries = Object.entries(value)
  if (entries.some(([, target]) => typeof target !== "string")) return undefined
  return { keys: entries.map(([key]) => key), targets: Object.fromEntries(entries) as Record<string, string> }
}

function qualificationDescriptorMatchesExpected(
  descriptor: ReturnType<typeof qualificationConditionalDescriptor>,
): boolean {
  return descriptor !== undefined &&
    JSON.stringify(descriptor.keys) === JSON.stringify(expectedQualificationConditionalExport.keys) &&
    JSON.stringify(descriptor.targets) === JSON.stringify(expectedQualificationConditionalExport.targets)
}

function typeCatalogMatchesExpected(catalog: ReturnType<typeof installedTypeCatalog>): boolean {
  return JSON.stringify(catalog.rootTypeExports) === JSON.stringify(expectedRootTypeExports) &&
    JSON.stringify(catalog.subpathTypeExports) === JSON.stringify(expectedSubpathTypeExports) &&
    JSON.stringify(catalog.rootValueDeclarations) === JSON.stringify(expectedSubpathRuntimeExports["."]) &&
    JSON.stringify(catalog.subpathValueDeclarations) === JSON.stringify(
      Object.fromEntries(Object.entries(expectedSubpathRuntimeExports).filter(([subpath]) => subpath !== ".")),
    )
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

function proveTypeSurfacePerturbations(
  packageRoot: string,
  exportsMap: Readonly<Record<string, unknown>>,
): { readonly refused: readonly string[]; readonly restored: true } {
  const typeTarget = join(
    packageRoot,
    exportTarget(exportsMap["./runtime-custody"]).replace(/^\.\//u, ""),
  )
  const originalTypeTarget = readFileSync(typeTarget, "utf8")
  const wildcardTarget = join(packageRoot, "src/modules/runtime-custody/clean-fixture-extra-types.ts")
  const typeForms = [
    ["direct", "\nexport type CleanFixtureUnexpected = string\n"],
    ["named-type", "\ntype CleanFixtureUnexpected = string\nexport { type CleanFixtureUnexpected }\n"],
    ["default-interface", "\nexport default interface CleanFixtureUnexpected {}\n"],
    ["wildcard", "\nexport type * from \"./clean-fixture-extra-types.ts\"\n"],
  ] as const
  const refused: string[] = []
  try {
    writeFileSync(wildcardTarget, "export type CleanFixtureUnexpected = string\n", { mode: 0o600 })
    for (const [label, source] of typeForms) {
      writeFileSync(typeTarget, `${originalTypeTarget}${source}`, { mode: 0o600 })
      if (!typeCatalogMatchesExpected(installedTypeCatalog(packageRoot, exportsMap))) refused.push(label)
    }
  } finally {
    writeFileSync(typeTarget, originalTypeTarget, { mode: 0o600 })
    rmSync(wildcardTarget, { force: true })
  }
  if (!typeCatalogMatchesExpected(installedTypeCatalog(packageRoot, exportsMap))) {
    throw new Error("type export baseline was not restored")
  }
  return { refused, restored: true }
}

async function proveValueDeclarationPerturbations(
  consumerRoot: string,
  packageRoot: string,
  exportsMap: Readonly<Record<string, unknown>>,
  environment: Readonly<Record<string, string>>,
): Promise<{ readonly refused: readonly string[]; readonly restored: true }> {
  const cases = [
    {
      subpath: "./admission-bootstrap",
      declaration: "export declare const admissionBootstrap: AdmissionBootstrap",
      drift: "export declare const admissionBootstrap: string",
      extra: "export declare function cleanFixtureUnexpectedValue(): void",
    },
    {
      subpath: "./qualification-evidence",
      declaration: "export declare const qualificationEvidence: QualificationEvidence",
      drift: "export declare const qualificationEvidence: string",
      extra: "export declare const cleanFixtureUnexpectedValue: string",
    },
  ] as const
  const refused: string[] = []
  for (const item of cases) {
    const target = join(packageRoot, exportTarget(exportsMap[item.subpath]).replace(/^\.\//u, ""))
    const original = readFileSync(target, "utf8")
    const label = item.subpath.slice(2)
    if (!original.includes(item.declaration)) throw new Error(`missing accepted value declaration: ${label}`)
    try {
      writeFileSync(target, original.replace(item.declaration, ""), { mode: 0o600 })
      if (!(await publicTypeResolutionSucceeds(consumerRoot, environment))) refused.push(`${label}-remove`)
      writeFileSync(target, original.replace(item.declaration, item.drift), { mode: 0o600 })
      if (!(await publicTypeResolutionSucceeds(consumerRoot, environment))) refused.push(`${label}-drift`)
      writeFileSync(target, `${original}\n${item.extra}\n`, { mode: 0o600 })
      if (!typeCatalogMatchesExpected(installedTypeCatalog(packageRoot, exportsMap))) {
        refused.push(`${label}-add`)
      }
    } finally {
      writeFileSync(target, original, { mode: 0o600 })
    }
  }
  const restored = await publicTypeResolutionSucceeds(consumerRoot, environment) &&
    typeCatalogMatchesExpected(installedTypeCatalog(packageRoot, exportsMap))
  if (!restored) throw new Error("compiler-backed public declaration baseline was not restored")
  return { refused, restored: true }
}

async function proveRuntimeSurfacePerturbations(
  consumerRoot: string,
  packageRoot: string,
  exportsMap: Readonly<Record<string, unknown>>,
  environment: Readonly<Record<string, string>>,
): Promise<{ readonly refused: readonly string[]; readonly restored: readonly string[] }> {
  const refused: string[] = []
  const restored: string[] = []
  for (const [subpath, exportValue] of Object.entries(exportsMap)) {
    const target = join(packageRoot, runtimeExportTarget(exportValue).replace(/^\.\//u, ""))
    const original = readFileSync(target, "utf8")
    const specifier = subpath === "." ? packageName : `${packageName}${subpath.slice(1)}`
    const expected = expectedSubpathRuntimeExports[subpath]
    if (expected === undefined) throw new Error(`missing expected runtime catalog for ${subpath}`)
    try {
      writeFileSync(target, `${original}\nexport const cleanFixtureUnexpectedRuntime = true\n`, { mode: 0o600 })
      const observed = await observeRuntimeExportKeys(consumerRoot, specifier, environment)
      if (JSON.stringify(observed) !== JSON.stringify(expected)) refused.push(subpath)
    } finally {
      writeFileSync(target, original, { mode: 0o600 })
    }
    const baseline = await observeRuntimeExportKeys(consumerRoot, specifier, environment)
    if (JSON.stringify(baseline) === JSON.stringify(expected)) restored.push(subpath)
  }
  return { refused, restored }
}

async function provePublicSurfacePerturbations(
  consumerRoot: string,
  packageRoot: string,
  exportsMap: Readonly<Record<string, unknown>>,
  environment: Readonly<Record<string, string>>,
): Promise<InstalledPackageObservation["publicSurfacePerturbationControl"]> {
  const type = proveTypeSurfacePerturbations(packageRoot, exportsMap)
  const values = await proveValueDeclarationPerturbations(
    consumerRoot,
    packageRoot,
    exportsMap,
    environment,
  )
  const runtime = await proveRuntimeSurfacePerturbations(
    consumerRoot,
    packageRoot,
    exportsMap,
    environment,
  )
  return {
    typeFormsRefused: type.refused,
    typeBaselineRestored: type.restored,
    runtimeSubpathsRefused: runtime.refused,
    runtimeSubpathsRestored: runtime.restored,
    valueDeclarationsRefused: values.refused,
    compilerBaselineRestored: values.restored,
  }
}

async function proveExternalRuntimePerturbation(
  consumerRoot: string,
  observerRoot: string,
  packageRoot: string,
  foreignCwd: string,
  environment: Readonly<Record<string, string>>,
  baseline: Parameters<typeof cliObservationMatchesBaseline>[1],
): Promise<{
  readonly externalDependencyPerturbationRefused: boolean
  readonly externalDependencyBaselineRestored: boolean
  readonly escapedRuntimePerturbationRefused: boolean
  readonly escapedRuntimeBaselineRestored: boolean
  readonly nonJavaScriptRuntimePerturbationRefused: boolean
  readonly nonJavaScriptRuntimeBaselineRestored: boolean
}> {
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
  let externalDependencyPerturbationRefused = false
  try {
    writeFileSync(target, `${original}\nimport "clean-fixture-foreign-dependency"\n`, { mode: 0o600 })
    const observation = await observeCli(
      consumerRoot,
      join(observerRoot, "external-perturbation"),
      packageRoot,
      foreignCwd,
      environment,
    )
    externalDependencyPerturbationRefused = observation.importedFiles.includes("external:clean-fixture-foreign-dependency") &&
      JSON.stringify(observation.importedFiles) !== JSON.stringify(expectedDependencyFreeHelpRuntimeTrace)
  } finally {
    writeFileSync(target, original, { mode: 0o600 })
    rmSync(dependencyRoot, { recursive: true, force: true })
  }
  const externalDependencyBaselineRestored = cliObservationMatchesBaseline(
    await observeCli(
      consumerRoot,
      join(observerRoot, "external-restoration"),
      packageRoot,
      foreignCwd,
      environment,
    ),
    baseline,
  )

  const escapedPath = join(foreignCwd, "escaped-runtime.ts")
  let escapedRuntimePerturbationRefused = false
  try {
    writeFileSync(escapedPath, "export const escapedRuntime = true\n", { mode: 0o600 })
    writeFileSync(target, `${original}\nimport ${JSON.stringify(escapedPath)}\n`, { mode: 0o600 })
    const observation = await observeCli(
      consumerRoot,
      join(observerRoot, "escaped-runtime-perturbation"),
      packageRoot,
      foreignCwd,
      environment,
    )
    escapedRuntimePerturbationRefused = observation.importedFiles.includes(
      `outside-package:${basename(escapedPath)}`,
    ) && JSON.stringify(observation.importedFiles) !==
      JSON.stringify(expectedDependencyFreeHelpRuntimeTrace)
  } finally {
    writeFileSync(target, original, { mode: 0o600 })
    rmSync(escapedPath, { force: true })
  }
  const escapedRuntimeBaselineRestored = cliObservationMatchesBaseline(
    await observeCli(
      consumerRoot,
      join(observerRoot, "escaped-runtime-restoration"),
      packageRoot,
      foreignCwd,
      environment,
    ),
    baseline,
  )

  const escapedJsonPath = join(foreignCwd, "escaped-runtime.json")
  let nonJavaScriptRuntimePerturbationRefused = false
  try {
    writeFileSync(escapedJsonPath, "{\"escaped\":true}\n", { mode: 0o600 })
    writeFileSync(
      target,
      `${original}\nimport escapedRuntime from ${JSON.stringify(escapedJsonPath)} with { type: "json" }\nvoid escapedRuntime\n`,
      { mode: 0o600 },
    )
    const observation = await observeCli(
      consumerRoot,
      join(observerRoot, "non-javascript-runtime-perturbation"),
      packageRoot,
      foreignCwd,
      environment,
    )
    nonJavaScriptRuntimePerturbationRefused = observation.importedFiles.includes(
      `outside-package:${basename(escapedJsonPath)}`,
    ) && JSON.stringify(observation.importedFiles) !==
      JSON.stringify(expectedDependencyFreeHelpRuntimeTrace)
  } finally {
    writeFileSync(target, original, { mode: 0o600 })
    rmSync(escapedJsonPath, { force: true })
  }
  const nonJavaScriptRuntimeBaselineRestored = cliObservationMatchesBaseline(
    await observeCli(
      consumerRoot,
      join(observerRoot, "non-javascript-runtime-restoration"),
      packageRoot,
      foreignCwd,
      environment,
    ),
    baseline,
  )

  return {
    externalDependencyPerturbationRefused,
    externalDependencyBaselineRestored,
    escapedRuntimePerturbationRefused,
    escapedRuntimeBaselineRestored,
    nonJavaScriptRuntimePerturbationRefused,
    nonJavaScriptRuntimeBaselineRestored,
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

function processGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch {
    return false
  }
}

async function waitForProcessTreeExit(
  descendantPid: number,
  processGroupId: number,
  deadlineAt = performance.now() + 500,
): Promise<{ readonly descendantExists: boolean; readonly processGroupExists: boolean }> {
  let liveness = {
    descendantExists: processExists(descendantPid),
    processGroupExists: processGroupExists(processGroupId),
  }
  while (performance.now() < deadlineAt) {
    if (!liveness.descendantExists && !liveness.processGroupExists) return liveness
    await Bun.sleep(10)
    liveness = {
      descendantExists: processExists(descendantPid),
      processGroupExists: processGroupExists(processGroupId),
    }
  }
  return liveness
}

async function proveBoundedProcessTreeTimeout(
  fixtureRoot: string,
  environment: Readonly<Record<string, string>>,
  deadlineMs: 150,
  graceMs: 1_000,
): Promise<{ readonly elapsedMs: number }> {
  const childPidPath = join(fixtureRoot, "timeout-descendant.pid")
  const script = [
    `const child = Bun.spawn(["/bin/sleep", "30"], { stdout: "inherit", stderr: "inherit" })`,
    `await Bun.write(${JSON.stringify(childPidPath)}, String(child.pid))`,
    "await new Promise(() => undefined)",
  ].join("\n")
  const startedAt = performance.now()
  const result = await spawn([process.execPath, "-e", script], {
    cwd: fixtureRoot,
    env: environment,
    deadlineMs,
  })
  const descendantPid = Number(readFileSync(childPidPath, "utf8"))
  const liveness = await waitForProcessTreeExit(descendantPid, result.cleanup.processGroupId)
  const elapsedMs = performance.now() - startedAt
  const checks = [
    result.exitCode === 124,
    result.cleanup.timedOut,
    result.cleanup.descriptorClosure === "closed",
    !result.cleanup.postKillGraceExpired,
    result.cleanup.readerCancellation === "not-required",
    !liveness.descendantExists,
    !liveness.processGroupExists,
    elapsedMs >= deadlineMs && elapsedMs <= deadlineMs + graceMs,
  ]
  if (checks.includes(false)) throw new Error("bounded process timeout did not terminate its process tree")
  return { elapsedMs }
}

function killDescriptorHolder(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // The descendant may already have exited after proving descriptor sensitivity.
    }
  }
}

async function proveDescriptorHoldingSensitivity(
  fixtureRoot: string,
  environment: Readonly<Record<string, string>>,
  deadlineMs: 150,
  graceMs: 1_000,
): Promise<InstalledPackageObservation["processTimeoutControl"]["descriptorHoldingSensitivity"]> {
  const pidPath = join(fixtureRoot, "descriptor-holder.pid")
  const script = [
    `const child = Bun.spawn(["/bin/sleep", "30"], { detached: true, stdout: "inherit", stderr: "inherit" })`,
    "child.unref()",
    `await Bun.write(${JSON.stringify(pidPath)}, String(child.pid))`,
  ].join("\n")
  const startedAt = performance.now()
  const outerDeadlineMs = 1_650 as const
  const outerDeadlineAt = startedAt + outerDeadlineMs
  const result = await spawn([process.execPath, "-e", script], {
    cwd: fixtureRoot,
    env: environment,
    deadlineMs,
    postKillGraceMs: graceMs,
  })
  const pid = Number(readFileSync(pidPath, "utf8"))
  killDescriptorHolder(pid)
  while (processExists(pid) && performance.now() < outerDeadlineAt) await Bun.sleep(10)
  const elapsedMs = performance.now() - startedAt
  const refused = result.exitCode === 124 && result.cleanup.postKillGraceExpired &&
    result.cleanup.descriptorClosure === "cancelled-after-grace" && !processExists(pid) &&
    result.cleanup.readerCancellation === "completed" &&
    elapsedMs <= outerDeadlineMs
  if (!refused) {
    throw new Error("descriptor-holding descendant did not fail closed within the outer bound")
  }
  return {
    refused: true,
    postKillGraceExpired: true,
    descriptorClosure: "cancelled-after-grace",
    descendantTerminatedAfterRestoration: true,
    withinOuterBound: true,
    outerDeadlineMs,
    readerCancellation: "completed",
    readerCancellationMs: readerCancellationDeadlineMs,
  }
}

async function proveTimeoutCleanup(
  fixtureRoot: string,
  environment: Readonly<Record<string, string>>,
): Promise<InstalledPackageObservation["processTimeoutControl"]> {
  const deadlineMs = 150 as const
  const graceMs = 1_000 as const
  const { elapsedMs } = await proveBoundedProcessTreeTimeout(
    fixtureRoot,
    environment,
    deadlineMs,
    graceMs,
  )
  const descriptorHoldingSensitivity = await proveDescriptorHoldingSensitivity(
    fixtureRoot,
    environment,
    deadlineMs,
    graceMs,
  )
  const readerCancellationSensitivity = await proveReaderCancellationSensitivity()
  return {
    exitCode: 124,
    timedOut: true,
    descriptorClosure: "closed",
    cleanup: "process-group-killed",
    descendantPidObserved: true,
    descendantTerminated: true,
    processGroupTerminated: true,
    monotonicClock: "performance.now",
    deadlineMs,
    graceMs,
    elapsedMs,
    withinDeadlineGrace: true,
    postKillGraceExpired: false,
    readerCancellation: "not-required",
    readerCancellationMs: readerCancellationDeadlineMs,
    readerCancellationSensitivity,
    descriptorHoldingSensitivity,
  }
}

function readLifecycleLedger(path: string): readonly string[] {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split("\n").filter(Boolean)
}

function proveRestoredCausalOrder(
  preAdmissionLaunchRefused: boolean,
  admittedExecutionOrder: readonly ExecutionPhase[],
): InstalledPackageObservation["causalOrderPerturbationControl"] {
  const baselineRestored = JSON.stringify(admittedExecutionOrder) === JSON.stringify([
    "admission",
    "maintenance-cli",
    "observation-cells",
    "qualification",
  ])
  if (!preAdmissionLaunchRefused || !baselineRestored) {
    throw new Error("execution phase ledger did not refuse pre-Admission launch and restore baseline")
  }
  return { preAdmissionLaunchRefused: true, baselineRestored: true }
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
    const lockCreation = await spawn(["bun", "add", "--ignore-scripts", "--exact", gitDependency], {
      cwd: consumerRoot,
      env: environment,
    })
    requireSuccess("Clean Fixture lock creation", lockCreation)
    rmSync(join(consumerRoot, "node_modules"), { recursive: true, force: true })
    const frozenInstall = await spawn(["bun", "install", "--ignore-scripts", "--production", "--frozen-lockfile"], {
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
    const installedEntries = walkInstalledEntries(packageRoot)
    const regularFiles = installedEntries
      .filter((entry) => entry.kind === "regular-file")
      .map((entry) => entry.path)
    const symlinks = installedEntries.filter((entry) => entry.kind === "symlink")
    const installedBytesSha256 = installedEntriesDigest(packageRoot, installedEntries)
    const installedInventoryPerturbationControl = proveCompleteInstalledInventory(
      packageRoot,
      installedEntries,
      installedBytesSha256,
    )
    const request = candidateAtCommit(sourceCommit)
    const admissionInputPath = writeAdmissionInput(consumerRoot, "admitted", request)
    const admissionProbePath = writeAdmissionProbe(consumerRoot)
    const preAdmissionLaunchRefused = await provePreAdmissionLaunchRefusal(
      consumerRoot,
      foreignCwd,
      environment,
      admissionProbePath,
      admissionInputPath,
    )
    const admittedPhaseLedger = new PhaseLedger()
    const admission = readJsonOutput<AdmissionResult>(
      "installed public Admission probe",
      await spawn(["bun", "--no-install", admissionProbePath, admissionInputPath], {
        cwd: consumerRoot,
        env: environment,
        phase: { ledger: admittedPhaseLedger, name: "admission" },
      }),
    )
    if (admission.kind !== "admitted") {
      throw new Error(`installed Candidate was refused before downstream execution: ${JSON.stringify(admission)}`)
    }
    const installedMaintenanceCliBase = await observeCli(
      consumerRoot,
      observerRoot,
      packageRoot,
      foreignCwd,
      environment,
      admittedPhaseLedger,
    )
    const hostObservation = await observeHost(consumerRoot, environment, admittedPhaseLedger)
    const commandObservation = installedMaintenanceCliBase.observations[0]
    if (commandObservation === undefined) {
      throw new Error("accepted maintenance CLI scenarios produced no command observation")
    }
    const observationBindingControl = proveObservationBinding(
      commandObservation,
      hostObservation,
    )
    const processEvidence = derivePublicProcessEvidence(
      commandObservation,
      hostObservation,
    )
    if (processEvidence === undefined) {
      throw new Error("accepted CLI and host observations did not produce qualification evidence")
    }
    admittedPhaseLedger.record("observation-cells")
    const mainInputPath = writeProbeInput(
      consumerRoot,
      "admitted",
      request,
      installedBytesSha256,
      processEvidence,
    )
    const qualificationInputBindings = observeQualificationInputBindings(mainInputPath)
    const qualificationProbePath = writeQualificationProbe(consumerRoot, publicSubpaths)
    const qualificationProbe = readJsonOutput<QualificationProbeObservation>(
      "installed public Qualification probe",
      await spawn(["bun", "--no-install", qualificationProbePath, mainInputPath], {
        cwd: consumerRoot,
        env: environment,
        phase: { ledger: admittedPhaseLedger, name: "qualification" },
      }),
    )
    const runtimePerturbationControl = await proveExternalRuntimePerturbation(
      consumerRoot,
      observerRoot,
      packageRoot,
      foreignCwd,
      environment,
      installedMaintenanceCliBase,
    )
    const installedMaintenanceCli = {
      ...installedMaintenanceCliBase,
      ...runtimePerturbationControl,
    }
    const qualificationRuntimeTargetPerturbationControl = await qualificationPerturbationIsRefused(
      consumerRoot,
      packageRoot,
      qualificationProbePath,
      mainInputPath,
      environment,
      qualificationProbe,
    )
    const mismatchedRequest = {
      ...request,
      package: { ...request.package, commit: "cccccccccccccccccccccccccccccccccccccccc" },
    }
    const refusedInputPath = writeAdmissionInput(
      consumerRoot,
      "refused",
      mismatchedRequest,
    )
    const refusedPhaseLedger = new PhaseLedger()
    const refusedAdmission = readJsonOutput<AdmissionResult>(
      "mismatched installed public Admission probe",
      await spawn(["bun", "--no-install", admissionProbePath, refusedInputPath], {
        cwd: consumerRoot,
        env: environment,
        phase: { ledger: refusedPhaseLedger, name: "admission" },
      }),
    )
    if (refusedAdmission.kind === "admitted") {
      await observeCli(
        consumerRoot,
        join(observerRoot, "refused-candidate"),
        packageRoot,
        foreignCwd,
        environment,
        refusedPhaseLedger,
      )
      refusedPhaseLedger.record("observation-cells")
      await spawn(["bun", "--no-install", qualificationProbePath, refusedInputPath], {
        cwd: consumerRoot,
        env: environment,
        phase: { ledger: refusedPhaseLedger, name: "qualification" },
      })
    }
    const publicSurfacePerturbationControl = await provePublicSurfacePerturbations(
      consumerRoot,
      packageRoot,
      installedManifest.exports,
      environment,
    )
    const processTimeoutControl = await proveTimeoutCleanup(fixtureRoot, environment)
    const admittedExecutionOrder = admittedPhaseLedger.snapshot()
    const causalOrderPerturbationControl = proveRestoredCausalOrder(
      preAdmissionLaunchRefused,
      admittedExecutionOrder,
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
      rootRuntimeExports: qualificationProbe.rootRuntimeExports,
      subpathRuntimeExports: qualificationProbe.runtimeExports,
      publicSubpaths,
      regularFiles,
      symlinks,
      lifecycleScriptLedger: readLifecycleLedger(lifecycleLedgerPath),
      installedBytesSha256,
      installedInventoryPerturbationControl,
      outsideRepository: relative(repositoryRoot, fixtureRoot).startsWith(".."),
      qualificationRuntimeTargetPerturbationControl,
      admittedExecutionOrder: admittedExecutionOrder as [
        "admission",
        "maintenance-cli",
        "observation-cells",
        "qualification",
      ],
      admissionRefusalControl: {
        admission: refusedAdmission,
        startedProcesses: refusedPhaseLedger.snapshot(),
      },
      causalOrderPerturbationControl,
      publicSurfacePerturbationControl,
      observationBindingControl,
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
