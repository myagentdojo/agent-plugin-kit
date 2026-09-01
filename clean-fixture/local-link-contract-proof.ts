import { createHash } from "node:crypto"
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import type { ProcessObservation } from "../src/adapters/maintenance-command-facade/interface"

const proofIdentity = "agent-plugin-kit.maintenance-cli-local-link"
const maximumRetentionMs = 7 * 24 * 60 * 60 * 1_000

export type LocalLinkProcessScenario = Readonly<{
  ledger: string
  argv: readonly string[]
  environment?: Readonly<Record<string, string>>
  expected: Readonly<{
    exitCode: number
    runId: string
    stdoutStatus?: "ok"
    diagnosticEvent?: string
    finalStderrRecordType?: "error_envelope"
  }>
}>

type RepositorySnapshot = Readonly<{
  status: string
  tracked: readonly Readonly<{ path: string; mode: string; sha256: string }>[]
  manifestsAndLocks: readonly Readonly<{ path: string; sha256: string }>[]
}>

type LinkIdentity = Readonly<{
  destination: string
  rawTarget: string
  canonicalTarget: string
  device: number
  inode: number
  mode: number
}>

type OwnershipReceipt = Readonly<{
  schema_version: 1
  proof: typeof proofIdentity
  run_id: string
  created_at: string
  retained_until: string
  roots: Readonly<{ kit: string; consumer: string }>
  sources: Readonly<{ package: string; binary: string }>
  destinations: Readonly<{ package: string; binary: string }>
  preflight_destinations: readonly ["absent", "absent"]
  links: readonly LinkIdentity[]
  created: Readonly<{ package: boolean; binary: boolean }>
  cleaned: Readonly<{ package: boolean; binary: boolean }>
  repository_snapshots: Readonly<{ kit: RepositorySnapshot; consumer: RepositorySnapshot }>
  command_ledger: readonly string[]
}>

export type ProcessCleanupReceipt = Readonly<{
  deadlineMs: number
  timedOut: boolean
  exitObserved: boolean
  descriptorClosure: "closed"
  cleanup: "natural" | "process-group-killed"
  retainedResources: 0
}>

export type LocalLinkProofResult = Readonly<{
  parentModes: readonly [number, number]
  preflightDestinations: readonly ["absent", "absent"]
  linkIdentities: readonly [
    { kind: "package"; rawTargetRole: "kit-root"; canonicalTargetRole: "kit-root" },
    { kind: "binary"; rawTargetRole: "maintenance-shell"; canonicalTargetRole: "maintenance-shell" },
  ]
  executable: Readonly<{ shebang: "#!/usr/bin/env bun"; mode: number }>
  fixedHelpArgv: readonly string[]
  observations: readonly ProcessObservation[]
  processCleanupReceipts: readonly ProcessCleanupReceipt[]
  cleanupLedger: readonly string[]
  receipt: Readonly<{
    schema_version: 1
    proof: typeof proofIdentity
    run_id: string
    directory_mode: number
    file_mode: number
    maximum_retention_days: 7
    observed_public_cli_executions: number
    links_cleaned: true
  }>
  digestsEqual: boolean
}>

export type LocalLinkProofOptions = Readonly<{
  kitRoot: string
  consumerRoot: string
  stateRoot: string
  runId: string
  scenarios: readonly LocalLinkProcessScenario[]
  now?: () => Date
}>

const contained = (root: string, candidate: string): boolean => {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot))
}

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex")

const commandOutput = async (
  command: readonly string[],
  cwd: string,
  acceptedExitCodes: readonly number[] = [0],
): Promise<string> => {
  const result = Bun.spawnSync([...command], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()
  if (!acceptedExitCodes.includes(result.exitCode)) {
    throw new Error(`command-refused:${basename(command[0] ?? "unknown")}:${result.exitCode}:${stderr.trim()}`)
  }
  return stdout
}

const pathState = async (path: string): Promise<"absent" | "present"> => {
  try {
    await lstat(path)
    return "present"
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent"
    throw error
  }
}

const repositorySnapshot = async (root: string): Promise<RepositorySnapshot> => {
  const status = await commandOutput(["git", "status", "--porcelain=v1", "--untracked-files=all"], root)
  const index = await commandOutput(["git", "ls-files", "-s", "-z"], root)
  const rows = index.split("\0").filter(Boolean).map((row) => {
    const match = /^(\d+) [0-9a-f]+ \d+\t(.+)$/u.exec(row)
    if (match === null) throw new Error("tracked-index-row-invalid")
    const mode = match[1]
    const path = match[2]
    if (mode === undefined || path === undefined) throw new Error("tracked-index-row-invalid")
    return { mode, path }
  })
  const tracked = await Promise.all(rows.map(async ({ mode, path }) => {
    const absolute = join(root, path)
    const metadata = await lstat(absolute)
    const content = metadata.isSymbolicLink() ? await readlink(absolute) : await readFile(absolute)
    return { path, mode, sha256: sha256(content) }
  }))
  const manifestsAndLocks = tracked.filter(({ path }) =>
    basename(path) === "package.json" || basename(path) === "package-lock.json" ||
    basename(path) === "npm-shrinkwrap.json" || basename(path) === "bun.lock")
  return { status, tracked, manifestsAndLocks }
}

const sameSnapshot = (left: RepositorySnapshot, right: RepositorySnapshot): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const assertDirectory = async (root: string, path: string): Promise<void> => {
  const metadata = await lstat(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("destination-parent-unsafe")
  const canonical = await realpath(path)
  if (!contained(root, canonical)) throw new Error("destination-parent-escaped")
}

const assertIgnored = async (consumerRoot: string, destination: string): Promise<void> => {
  const relativeDestination = relative(consumerRoot, destination)
  await commandOutput(["git", "check-ignore", "--quiet", "--", relativeDestination], consumerRoot)
}

const readJsonObject = async (path: string): Promise<Record<string, unknown>> => {
  const value: unknown = JSON.parse(await readFile(path, "utf8"))
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("json-object-required")
  return value as Record<string, unknown>
}

const dependenciesFor = (manifest: Record<string, unknown>): Readonly<Record<string, unknown>> => {
  const value = manifest.dependencies
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

const assertOwnerLocalLogTape = async (kitRoot: string): Promise<void> => {
  const rootManifest = await readJsonObject(join(kitRoot, "package.json"))
  const facadeRoot = join(kitRoot, "src/adapters/maintenance-command-facade")
  const facadeManifest = await readJsonObject(join(facadeRoot, "package.json"))
  const admissionManifest = await readJsonObject(join(kitRoot, "src/admission-bootstrap/package.json"))
  if (dependenciesFor(facadeManifest)["@logtape/logtape"] !== "2.3.1") throw new Error("logtape-owner-pin-invalid")
  if ("@logtape/logtape" in dependenciesFor(rootManifest) || "@logtape/logtape" in dependenciesFor(admissionManifest)) {
    throw new Error("logtape-locality-invalid")
  }
  const lock = await readFile(join(kitRoot, "bun.lock"), "utf8")
  if (!lock.includes('"@logtape/logtape": "2.3.1"') || !lock.includes('"@logtape/logtape@2.3.1"')) {
    throw new Error("logtape-lock-resolution-invalid")
  }
  const resolved = Bun.resolveSync("@logtape/logtape", join(facadeRoot, "implementation"))
  if (!contained(kitRoot, await realpath(resolved))) throw new Error("logtape-installed-resolution-escaped")
}

const linkIdentity = async (destination: string): Promise<LinkIdentity> => {
  const metadata = await lstat(destination)
  if (!metadata.isSymbolicLink()) throw new Error("owned-node-not-symlink")
  return {
    destination,
    rawTarget: await readlink(destination),
    canonicalTarget: await realpath(destination),
    device: metadata.dev,
    inode: metadata.ino,
    mode: metadata.mode,
  }
}

const sameLink = (left: LinkIdentity, right: LinkIdentity): boolean =>
  left.destination === right.destination && left.rawTarget === right.rawTarget &&
  left.canonicalTarget === right.canonicalTarget && left.device === right.device &&
  left.inode === right.inode && left.mode === right.mode

const writeReceipt = async (path: string, receipt: OwnershipReceipt): Promise<void> => {
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(receipt)}\n`, { mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
}

const pruneExpiredReceipts = async (proofRoot: string, now: Date): Promise<void> => {
  let entries: string[]
  try {
    entries = await Array.fromAsync(new Bun.Glob("*/ownership.json").scan({ cwd: proofRoot, onlyFiles: true }))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
  for (const entry of entries) {
    const receiptPath = join(proofRoot, entry)
    try {
      const receipt = await readJsonObject(receiptPath)
      if (receipt.proof !== proofIdentity || typeof receipt.retained_until !== "string") continue
      if (Date.parse(receipt.retained_until) > now.getTime()) continue
      await unlink(receiptPath)
      await rmdir(dirname(receiptPath))
    } catch {
      // A malformed or non-empty receipt directory is not ours to remove.
    }
  }
}

const minimalEnvironment = (overrides: Readonly<Record<string, string>> = {}): Record<string, string> => ({
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: process.env.HOME ?? "/private/tmp",
  LANG: process.env.LANG ?? "C",
  NO_COLOR: "1",
  ...overrides,
})

const invokeBoundedProcess = async (
  command: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>>,
): Promise<{ observation: ProcessObservation; cleanup: ProcessCleanupReceipt }> => {
  const deadlineMs = 2_000
  const child = Bun.spawn([...command], {
    cwd,
    detached: true,
    env: minimalEnvironment(environment),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  let timedOut = false
  const deadline = setTimeout(() => {
    timedOut = true
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch {
      child.kill("SIGKILL")
    }
  }, deadlineMs)
  const [capturedStdout, capturedStderr, observedExitCode] = await Promise.all([stdout, stderr, child.exited])
  clearTimeout(deadline)
  let retained = false
  try {
    process.kill(child.pid, 0)
    retained = true
  } catch {
    retained = false
  }
  if (retained) throw new Error("public-process-retained")
  return {
    observation: { stdout: capturedStdout, stderr: capturedStderr, exitCode: timedOut ? 124 : observedExitCode },
    cleanup: {
      deadlineMs,
      timedOut,
      exitObserved: true,
      descriptorClosure: "closed",
      cleanup: timedOut ? "process-group-killed" : "natural",
      retainedResources: 0,
    },
  }
}

const parsedLine = (line: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(line)
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("process-record-invalid")
  return value as Record<string, unknown>
}

const validateStdout = (scenario: LocalLinkProcessScenario, observation: ProcessObservation): void => {
  if (scenario.expected.stdoutStatus !== undefined) {
    const envelope = parsedLine(observation.stdout.trim())
    if (envelope.status !== scenario.expected.stdoutStatus || envelope.run_id !== scenario.expected.runId) {
      throw new Error("public-process-stdout-drift")
    }
    return
  }
  if (observation.stdout !== "") throw new Error("public-process-stdout-not-empty")
}

const validateStderr = (scenario: LocalLinkProcessScenario, observation: ProcessObservation): void => {
  const stderr = observation.stderr.split("\n").filter(Boolean).map(parsedLine)
  if (scenario.expected.diagnosticEvent !== undefined) {
    const diagnostic = stderr.find((record) => record.record_type === "diagnostic" && record.event === scenario.expected.diagnosticEvent)
    if (diagnostic?.event !== scenario.expected.diagnosticEvent || diagnostic.run_id !== scenario.expected.runId) {
      throw new Error("public-process-diagnostic-drift")
    }
  }
  if (scenario.expected.finalStderrRecordType !== undefined) {
    const finalRecord = stderr.at(-1)
    if (finalRecord?.record_type !== scenario.expected.finalStderrRecordType || finalRecord.run_id !== scenario.expected.runId) {
      throw new Error("public-process-final-envelope-drift")
    }
  }
}

const validateObservation = (scenario: LocalLinkProcessScenario, observation: ProcessObservation): void => {
  if (observation.exitCode !== scenario.expected.exitCode) throw new Error("public-process-exit-drift")
  validateStdout(scenario, observation)
  validateStderr(scenario, observation)
}

const initialReceipt = (
  now: Date,
  options: LocalLinkProofOptions,
  roots: Readonly<{ kit: string; consumer: string }>,
  sources: Readonly<{ package: string; binary: string }>,
  destinations: Readonly<{ package: string; binary: string }>,
  snapshots: Readonly<{ kit: RepositorySnapshot; consumer: RepositorySnapshot }>,
): OwnershipReceipt => ({
  schema_version: 1,
  proof: proofIdentity,
  run_id: options.runId,
  created_at: now.toISOString(),
  retained_until: new Date(now.getTime() + maximumRetentionMs).toISOString(),
  roots,
  sources,
  destinations,
  preflight_destinations: ["absent", "absent"],
  links: [],
  created: { package: false, binary: false },
  cleaned: { package: false, binary: false },
  repository_snapshots: snapshots,
  command_ledger: [],
})

type PublicBinary = Readonly<{
  source: string
  shebang: "#!/usr/bin/env bun"
  mode: number
}>

type ProofContext = Readonly<{
  kitRoot: string
  consumerRoot: string
  binary: PublicBinary
  sources: Readonly<{ package: string; binary: string }>
  destinations: Readonly<{ package: string; binary: string }>
  before: Readonly<{ kit: RepositorySnapshot; consumer: RepositorySnapshot }>
  receiptDirectory: string
  receiptPath: string
}>

const publicBinaryManifestEntry = async (kitRoot: string): Promise<string> => {
  const rootManifest = await readJsonObject(join(kitRoot, "package.json"))
  const bin = rootManifest.bin
  if (rootManifest.name !== "agent-plugin-kit" || bin === null || typeof bin !== "object" || Array.isArray(bin)) {
    throw new Error("package-identity-invalid")
  }
  const binEntries = Object.entries(bin as Record<string, unknown>)
  if (binEntries.length !== 1 || binEntries[0]?.[0] !== "agent-plugin-kit" || typeof binEntries[0][1] !== "string") {
    throw new Error("public-binary-invalid")
  }
  return binEntries[0][1]
}

const publicBinary = async (kitRoot: string): Promise<PublicBinary> => {
  const binarySource = resolve(kitRoot, await publicBinaryManifestEntry(kitRoot))
  if (!contained(kitRoot, binarySource)) throw new Error("public-binary-escaped")
  const binaryMetadata = await stat(binarySource)
  if (!binaryMetadata.isFile()) throw new Error("public-binary-not-regular")
  const mode = binaryMetadata.mode & 0o777
  const shebang = (await readFile(binarySource, "utf8")).split("\n", 1)[0]
  if (mode !== 0o755 || shebang !== "#!/usr/bin/env bun") throw new Error("public-binary-identity-invalid")
  const relativeBinary = relative(kitRoot, binarySource)
  await commandOutput(["git", "ls-files", "--error-unmatch", "--", relativeBinary], kitRoot)
  const indexRow = await commandOutput(["git", "ls-files", "-s", "--", relativeBinary], kitRoot)
  if (!indexRow.startsWith("100755 ")) throw new Error("public-binary-index-mode-invalid")
  return { source: binarySource, shebang, mode }
}

const prepareProofContext = async (
  options: LocalLinkProofOptions,
  now: Date,
): Promise<ProofContext> => {
  const kitRoot = await realpath(options.kitRoot)
  const consumerRoot = await realpath(options.consumerRoot)
  const binary = await publicBinary(kitRoot)
  await assertOwnerLocalLogTape(kitRoot)
  const packageDestination = join(consumerRoot, "node_modules/agent-plugin-kit")
  const binaryDestination = join(consumerRoot, "node_modules/.bin/agent-plugin-kit")
  await assertDirectory(consumerRoot, dirname(packageDestination))
  await assertDirectory(consumerRoot, dirname(binaryDestination))
  await assertIgnored(consumerRoot, packageDestination)
  await assertIgnored(consumerRoot, binaryDestination)
  const preflightDestinations = [await pathState(packageDestination), await pathState(binaryDestination)] as const
  if (preflightDestinations[0] !== "absent" || preflightDestinations[1] !== "absent") {
    throw new Error("link-destination-preexists")
  }
  const before = { kit: await repositorySnapshot(kitRoot), consumer: await repositorySnapshot(consumerRoot) }
  const proofRoot = join(options.stateRoot, "my-second-brain-vault/agent-plugin-kit/local-link-proof")
  const receiptDirectory = join(proofRoot, options.runId)
  await mkdir(proofRoot, { recursive: true, mode: 0o700 })
  await pruneExpiredReceipts(proofRoot, now)
  await mkdir(receiptDirectory, { mode: 0o700 })
  await chmod(receiptDirectory, 0o700)
  const receiptPath = join(receiptDirectory, "ownership.json")
  const sources = { package: kitRoot, binary: binary.source }
  const destinations = { package: packageDestination, binary: binaryDestination }
  return { kitRoot, consumerRoot, binary, sources, destinations, before, receiptDirectory, receiptPath }
}

type ProofState = {
  receipt: OwnershipReceipt
  ledger: string[]
  observations: ProcessObservation[]
  processCleanupReceipts: ProcessCleanupReceipt[]
  ownedLinks: Map<"package" | "binary", LinkIdentity>
}

type ReceiptUpdater = (update: Partial<OwnershipReceipt>) => Promise<void>

const createLinks = async (
  context: ProofContext,
  state: ProofState,
  updateReceipt: ReceiptUpdater,
): Promise<void> => {
  for (const [kind, source, destination, ledgerEntry] of [
    ["package", context.sources.package, context.destinations.package, "ln:-s:package"],
    ["binary", context.sources.binary, context.destinations.binary, "ln:-s:binary"],
  ] as const) {
    await commandOutput(["/bin/ln", "-s", source, destination], context.consumerRoot)
    state.ledger.push(ledgerEntry)
    const identity = await linkIdentity(destination)
    state.ownedLinks.set(kind, identity)
    const expectedCanonicalTarget = await realpath(source)
    if (identity.rawTarget !== source || identity.canonicalTarget !== expectedCanonicalTarget) {
      throw new Error("created-link-identity-invalid")
    }
    await updateReceipt({
      links: [...state.ownedLinks.values()],
      created: { ...state.receipt.created, [kind]: true },
      command_ledger: [...state.ledger],
    })
  }
}

const executeScenarios = async (
  options: LocalLinkProofOptions,
  context: ProofContext,
  state: ProofState,
  updateReceipt: ReceiptUpdater,
): Promise<void> => {
  for (const scenario of options.scenarios) {
    const result = await invokeBoundedProcess(
      [context.destinations.binary, ...scenario.argv],
      context.consumerRoot,
      scenario.environment ?? {},
    )
    state.ledger.push(scenario.ledger)
    validateObservation(scenario, result.observation)
    state.observations.push(result.observation)
    state.processCleanupReceipts.push(result.cleanup)
    await updateReceipt({ command_ledger: [...state.ledger] })
  }
}

const cleanupLinks = async (
  context: ProofContext,
  state: ProofState,
  updateReceipt: ReceiptUpdater,
): Promise<unknown[]> => {
  const cleanupFailures: unknown[] = []
  for (const [kind, destination, ledgerEntry] of [
    ["binary", context.destinations.binary, "unlink:binary"],
    ["package", context.destinations.package, "unlink:package"],
  ] as const) {
    const owned = state.ownedLinks.get(kind)
    if (owned === undefined) continue
    try {
      const current = await linkIdentity(destination)
      if (!sameLink(current, owned)) {
        cleanupFailures.push(new Error(`owned-link-drifted:${kind}`))
        continue
      }
      await unlink(destination)
      state.ledger.push(ledgerEntry)
      await updateReceipt({
        cleaned: { ...state.receipt.cleaned, [kind]: true },
        command_ledger: [...state.ledger],
      })
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  return cleanupFailures
}

const proveRestoration = async (context: ProofContext): Promise<boolean> => {
  const after = {
    kit: await repositorySnapshot(context.kitRoot),
    consumer: await repositorySnapshot(context.consumerRoot),
  }
  const digestsEqual = sameSnapshot(context.before.kit, after.kit) &&
    sameSnapshot(context.before.consumer, after.consumer)
  if (!digestsEqual) throw new Error("repository-state-drifted")
  const packageAbsent = await pathState(context.destinations.package) === "absent"
  const binaryAbsent = await pathState(context.destinations.binary) === "absent"
  if (!packageAbsent || !binaryAbsent) throw new Error("owned-link-remained")
  return true
}

export async function runLocalLinkContractProof(options: LocalLinkProofOptions): Promise<LocalLinkProofResult> {
  const now = (options.now ?? (() => new Date()))()
  const context = await prepareProofContext(options, now)
  const state: ProofState = {
    receipt: initialReceipt(
      now,
      options,
      { kit: context.kitRoot, consumer: context.consumerRoot },
      context.sources,
      context.destinations,
      context.before,
    ),
    ledger: [],
    observations: [],
    processCleanupReceipts: [],
    ownedLinks: new Map(),
  }
  const updateReceipt: ReceiptUpdater = async (update) => {
    state.receipt = { ...state.receipt, ...update }
    await writeReceipt(context.receiptPath, state.receipt)
  }
  await writeReceipt(context.receiptPath, state.receipt)

  let primaryFailure: unknown
  try {
    await createLinks(context, state, updateReceipt)
    await executeScenarios(options, context, state, updateReceipt)
  } catch (error) {
    primaryFailure = error
  }
  const cleanupFailures = await cleanupLinks(context, state, updateReceipt)
  let restorationFailure: unknown
  let digestsEqual = false
  try {
    digestsEqual = await proveRestoration(context)
  } catch (error) {
    restorationFailure = error
  }
  if (primaryFailure !== undefined) throw primaryFailure
  if (cleanupFailures[0] !== undefined) throw cleanupFailures[0]
  if (restorationFailure !== undefined) throw restorationFailure

  const directoryMode = (await stat(context.receiptDirectory)).mode & 0o777
  const fileMode = (await stat(context.receiptPath)).mode & 0o777
  return {
    parentModes: [
      (await stat(dirname(context.kitRoot))).mode & 0o777,
      (await stat(dirname(context.consumerRoot))).mode & 0o777,
    ],
    preflightDestinations: ["absent", "absent"],
    linkIdentities: [
      { kind: "package", rawTargetRole: "kit-root", canonicalTargetRole: "kit-root" },
      { kind: "binary", rawTargetRole: "maintenance-shell", canonicalTargetRole: "maintenance-shell" },
    ],
    executable: { shebang: context.binary.shebang, mode: context.binary.mode },
    fixedHelpArgv: [...(options.scenarios[0]?.argv ?? [])],
    observations: state.observations,
    processCleanupReceipts: state.processCleanupReceipts,
    cleanupLedger: state.ledger,
    receipt: {
      schema_version: 1,
      proof: proofIdentity,
      run_id: options.runId,
      directory_mode: directoryMode,
      file_mode: fileMode,
      maximum_retention_days: 7,
      observed_public_cli_executions: state.observations.length,
      links_cleaned: true,
    },
    digestsEqual,
  }
}

export async function removeTemporaryProofRoot(root: string): Promise<void> {
  const canonicalRoot = await realpath(root)
  const canonicalParent = dirname(canonicalRoot)
  if (!basename(canonicalRoot).startsWith("agent-plugin-kit-local-link-") || !contained(canonicalParent, canonicalRoot)) {
    throw new Error("temporary-proof-root-refused")
  }
  await rm(canonicalRoot, { recursive: true, force: true })
}
