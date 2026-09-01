import { createHash } from "node:crypto"
import {
  appendFile,
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
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { literalHelpProcess, literalUsageProcess } from "../src/modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"
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

export type AuditCommandKind = "read" | "link" | "public-process" | "timeout-probe"

export type AuditLedgerEntry = Readonly<{
  operation: "command" | "unlink"
  kind: AuditCommandKind | "package" | "binary"
  executable?: string
  argv?: readonly string[]
}>

export type LocalLinkFault =
  | "retargeted-link"
  | "second-identity"
  | "mode-shebang-loss"
  | "repository-drift"
  | "receipt-tamper"
  | "receipt-write-failure"

export type FailureControlResult = Readonly<{
  refused: true
  reason: string
  parentsPreserved: true
  linksRemain: boolean
}>

export type PublicObservabilityOracle = Readonly<{
  runId: string
  exitCode: number
  stdoutRecordCount: number
  stderrRecordCount: number
  stdoutStatus: "ok" | "empty"
  stderrSequences: readonly number[]
  stderrEvents: readonly string[]
  primaryEnvelopeChannel: "stdout" | "stderr" | "none"
  eventSequenceGap: boolean
  redacted: true
}>

type RepositorySnapshot = Readonly<{
  status: string
  tracked: readonly Readonly<{ path: string; mode: string; sha256: string }>[]
  manifestsAndLocks: readonly Readonly<{ path: string; sha256: string }>[]
}>

type LinkIdentity = Readonly<{
  kind: "package" | "binary"
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
  command_ledger: readonly AuditLedgerEntry[]
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
  auditLedger: readonly AuditLedgerEntry[]
  publicObservability: readonly PublicObservabilityOracle[]
  forbiddenCommandRefused: true
  timeoutDescriptorControl: ProcessCleanupReceipt
  parentsPreserved: true
  receiptDeleted: true
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
  fault?: LocalLinkFault
  now?: () => Date
}>

const contained = (root: string, candidate: string): boolean => {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot))
}

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex")

type AuditedCommand = Readonly<{
  kind: AuditCommandKind
  executable: string
  argv: readonly string[]
  cwd: string
  allowedExecutable?: string
  allowedArgv?: readonly string[]
}>

const actualExecutable = (executable: string): string =>
  isAbsolute(executable) ? executable : Bun.which(executable) ?? executable

const sameArgv = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

const exactGitReadArgv = {
  status: ["status", "--porcelain=v1", "--untracked-files=all"],
  index: ["ls-files", "-s", "-z"],
} as const

const isGitPathRead = (argv: readonly string[], operation: "check-ignore" | "error-unmatch" | "index"): boolean => {
  const expected = operation === "check-ignore"
    ? ["check-ignore", "--quiet", "--"]
    : ["ls-files", operation === "error-unmatch" ? "--error-unmatch" : "-s", "--"]
  return argv.length === 4 && expected.every((value, index) => argv[index] === value)
}

const allowedGitRead = (argv: readonly string[]): boolean =>
  sameArgv(argv, exactGitReadArgv.status) || sameArgv(argv, exactGitReadArgv.index) ||
  isGitPathRead(argv, "check-ignore") || isGitPathRead(argv, "error-unmatch") || isGitPathRead(argv, "index")

const isReadCommandAllowlisted = (command: AuditedCommand): boolean =>
  basename(command.executable) === "git" && allowedGitRead(command.argv)

const isLinkCommandAllowlisted = (command: AuditedCommand): boolean =>
  command.executable === "/bin/ln" && command.argv.length === 3 && command.argv[0] === "-s" &&
  command.argv[1] !== undefined && command.argv[2] !== undefined &&
  isAbsolute(command.argv[1]) && isAbsolute(command.argv[2])

const isPublicProcessAllowlisted = (command: AuditedCommand): boolean =>
  command.allowedExecutable === command.executable && command.allowedArgv !== undefined &&
  sameArgv(command.argv, command.allowedArgv)

const isTimeoutProbeAllowlisted = (command: AuditedCommand): boolean =>
  command.executable === process.execPath && sameArgv(command.argv, ["-e", "setTimeout(() => {}, 10_000)"])

const commandIsAllowlisted = (command: AuditedCommand): boolean => {
  switch (command.kind) {
    case "read":
      return isReadCommandAllowlisted(command)
    case "link":
      return isLinkCommandAllowlisted(command)
    case "public-process":
      return isPublicProcessAllowlisted(command)
    case "timeout-probe":
      return isTimeoutProbeAllowlisted(command)
  }
}

const auditCommand = (command: AuditedCommand, ledger: AuditLedgerEntry[]): string => {
  const executable = actualExecutable(command.executable)
  const normalized = { ...command, executable }
  if (!commandIsAllowlisted(normalized)) throw new Error("command-not-allowlisted")
  ledger.push({ operation: "command", kind: normalized.kind, executable, argv: [...normalized.argv] })
  return executable
}

const auditedSpawnSync = (
  command: AuditedCommand,
  ledger: AuditLedgerEntry[],
  acceptedExitCodes: readonly number[] = [0],
): { stdout: string; stderr: string; exitCode: number } => {
  const executable = auditCommand(command, ledger)
  const result = Bun.spawnSync([executable, ...command.argv], {
    cwd: command.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()
  if (!acceptedExitCodes.includes(result.exitCode)) {
    throw new Error(`command-refused:${basename(executable)}:${result.exitCode}:${stderr.trim()}`)
  }
  return { stdout, stderr, exitCode: result.exitCode }
}

const commandOutput = async (
  command: readonly string[],
  cwd: string,
  acceptedExitCodes: readonly number[] = [0],
  ledger: AuditLedgerEntry[] = [],
): Promise<string> => {
  return auditedSpawnSync({ kind: "read", executable: command[0] ?? "", argv: command.slice(1), cwd }, ledger, acceptedExitCodes).stdout
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

const repositorySnapshot = async (root: string, ledger: AuditLedgerEntry[] = []): Promise<RepositorySnapshot> => {
  const status = await commandOutput(["git", "status", "--porcelain=v1", "--untracked-files=all"], root, [0], ledger)
  const index = await commandOutput(["git", "ls-files", "-s", "-z"], root, [0], ledger)
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

const assertIgnored = async (consumerRoot: string, destination: string, ledger: AuditLedgerEntry[] = []): Promise<void> => {
  const relativeDestination = relative(consumerRoot, destination)
  await commandOutput(["git", "check-ignore", "--quiet", "--", relativeDestination], consumerRoot, [0], ledger)
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

const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const

const allDependenciesFor = (manifest: Record<string, unknown>): Readonly<Record<string, unknown>> => {
  const entries: Record<string, unknown> = {}
  for (const field of dependencyFields) {
    const value = manifest[field]
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(entries, value as Record<string, unknown>)
    }
  }
  return entries
}

const ownerLogTapeNames = ["@logtape/logtape", "@logtape/redaction"] as const

type OwnerLogTapeManifests = Readonly<{
  root: Record<string, unknown>
  facadeRoot: string
  facade: Record<string, unknown>
  admission: Record<string, unknown>
}>

const readOwnerLogTapeManifests = async (kitRoot: string): Promise<OwnerLogTapeManifests> => {
  const facadeRoot = join(kitRoot, "src/adapters/maintenance-command-facade")
  return {
    root: await readJsonObject(join(kitRoot, "package.json")),
    facadeRoot,
    facade: await readJsonObject(join(facadeRoot, "package.json")),
    admission: await readJsonObject(join(kitRoot, "src/admission-bootstrap/package.json")),
  }
}

const assertOwnerLogTapeDeclaration = (facadeManifest: Record<string, unknown>): void => {
  const facadeDependencies = dependenciesFor(facadeManifest)
  if (facadeDependencies["@logtape/logtape"] !== "2.3.1" || facadeDependencies["@logtape/redaction"] !== "2.3.1") {
    throw new Error("logtape-owner-pin-invalid")
  }
  for (const field of ["devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    const dependencies = facadeManifest[field]
    if (dependencies !== undefined && allDependenciesFor({ [field]: dependencies })["@logtape/logtape"] !== undefined) {
      throw new Error("logtape-owner-scope-invalid")
    }
    if (dependencies !== undefined && allDependenciesFor({ [field]: dependencies })["@logtape/redaction"] !== undefined) {
      throw new Error("logtape-owner-scope-invalid")
    }
  }
}

const assertNoNonOwnerLogTape = async (
  kitRoot: string,
  rootManifest: Record<string, unknown>,
  admissionManifest: Record<string, unknown>,
  facadeRoot: string,
): Promise<void> => {
  if (ownerLogTapeNames.some((name) => name in allDependenciesFor(rootManifest)) ||
    ownerLogTapeNames.some((name) => name in allDependenciesFor(admissionManifest))) {
    throw new Error("logtape-locality-invalid")
  }
  const packageManifestPaths = (await Array.fromAsync(new Bun.Glob("src/**/package.json").scan({ cwd: kitRoot, onlyFiles: true }))
  ).filter((manifestPath) => !manifestPath.split("/").includes("node_modules"))
  for (const manifestPath of packageManifestPaths) {
    const manifest = await readJsonObject(join(kitRoot, manifestPath))
    const names = ownerLogTapeNames.filter((name) => name in allDependenciesFor(manifest))
    if (names.length > 0 && resolve(kitRoot, manifestPath) !== resolve(facadeRoot, "package.json")) {
      throw new Error("logtape-locality-invalid")
    }
  }
}

const assertOwnerLocalLogTapeInstallation = async (kitRoot: string, facadeRoot: string): Promise<void> => {
  const lock = await readFile(join(kitRoot, "bun.lock"), "utf8")
  if (!lock.includes('"@logtape/logtape": "2.3.1"') || !lock.includes('"@logtape/logtape@2.3.1"') ||
    !lock.includes('"@logtape/redaction": "2.3.1"') || !lock.includes('"@logtape/redaction@2.3.1"')) {
    throw new Error("logtape-lock-resolution-invalid")
  }
  for (const name of ownerLogTapeNames) {
    const ownerLocalManifest = join(facadeRoot, "node_modules", name, "package.json")
    const resolved = Bun.resolveSync(`${name}/package.json`, join(facadeRoot, "implementation"))
    const ownerLocalResolution = await realpath(ownerLocalManifest)
    if (ownerLocalResolution !== await realpath(resolved)) throw new Error("logtape-installed-resolution-not-owner-local")
    const installedManifest = await readJsonObject(ownerLocalManifest)
    if (installedManifest.name !== name || installedManifest.version !== "2.3.1") {
      throw new Error("logtape-installed-version-invalid")
    }
  }
}

const assertOwnerLocalLogTape = async (kitRoot: string): Promise<void> => {
  const manifests = await readOwnerLogTapeManifests(kitRoot)
  assertOwnerLogTapeDeclaration(manifests.facade)
  await assertNoNonOwnerLogTape(kitRoot, manifests.root, manifests.admission, manifests.facadeRoot)
  await assertOwnerLocalLogTapeInstallation(kitRoot, manifests.facadeRoot)
}

const linkIdentity = async (kind: "package" | "binary", destination: string): Promise<LinkIdentity> => {
  const metadata = await lstat(destination)
  if (!metadata.isSymbolicLink()) throw new Error("owned-node-not-symlink")
  return {
    kind,
    destination,
    rawTarget: await readlink(destination),
    canonicalTarget: await realpath(destination),
    device: metadata.dev,
    inode: metadata.ino,
    mode: metadata.mode,
  }
}

const sameLink = (left: LinkIdentity, right: LinkIdentity): boolean =>
  left.kind === right.kind && left.destination === right.destination && left.rawTarget === right.rawTarget &&
  left.canonicalTarget === right.canonicalTarget && left.device === right.device &&
  left.inode === right.inode && left.mode === right.mode

const writeReceipt = async (path: string, receipt: OwnershipReceipt): Promise<void> => {
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(receipt)}\n`, { mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
}

const validRunId = (runId: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(runId)

const assertOwnershipReceiptMetadata = (metadata: Awaited<ReturnType<typeof lstat>>): void => {
  if (!metadata.isFile() || metadata.isSymbolicLink() || (Number(metadata.mode) & 0o777) !== 0o600) {
    throw new Error("ownership-receipt-permissions-invalid")
  }
}

const assertOwnershipReceiptIdentity = (receipt: Record<string, unknown>): void => {
  if (receipt.schema_version !== 1 || receipt.proof !== proofIdentity || typeof receipt.run_id !== "string" ||
    !validRunId(receipt.run_id)) {
    throw new Error("ownership-receipt-invalid")
  }
}

const assertOwnershipReceiptTiming = (receipt: Record<string, unknown>): void => {
  if (typeof receipt.created_at !== "string" || typeof receipt.retained_until !== "string" ||
    !Number.isFinite(Date.parse(receipt.created_at)) || !Number.isFinite(Date.parse(receipt.retained_until))) {
    throw new Error("ownership-receipt-invalid")
  }
}

const assertOwnershipReceiptCollections = (receipt: Record<string, unknown>): void => {
  if (!Array.isArray(receipt.links) || !Array.isArray(receipt.command_ledger)) {
    throw new Error("ownership-receipt-invalid")
  }
}

const assertOwnershipReceiptHeader = (receipt: Record<string, unknown>): void => {
  assertOwnershipReceiptIdentity(receipt)
  assertOwnershipReceiptTiming(receipt)
  assertOwnershipReceiptCollections(receipt)
}

const assertOwnershipReceiptState = (receipt: Record<string, unknown>): void => {
  const created = receipt.created
  const cleaned = receipt.cleaned
  if (created === null || typeof created !== "object" || Array.isArray(created) ||
    cleaned === null || typeof cleaned !== "object" || Array.isArray(cleaned)) {
    throw new Error("ownership-receipt-state-invalid")
  }
}

const readOwnershipReceipt = async (path: string): Promise<OwnershipReceipt> => {
  const metadata = await lstat(path)
  assertOwnershipReceiptMetadata(metadata)
  const receipt = await readJsonObject(path)
  assertOwnershipReceiptHeader(receipt)
  assertOwnershipReceiptState(receipt)
  return receipt as unknown as OwnershipReceipt
}

const receiptLink = (receipt: OwnershipReceipt, kind: "package" | "binary"): LinkIdentity => {
  const links = receipt.links.filter((link) => link.kind === kind)
  if (links.length !== 1) throw new Error("ownership-receipt-link-invalid")
  const link = links[0]
  if (link === undefined) throw new Error("ownership-receipt-link-invalid")
  return link
}

const receiptMatchesRoots = (
  receipt: OwnershipReceipt,
  context: Pick<ProofContext, "kitRoot" | "consumerRoot" | "sources" | "destinations">,
): boolean => receipt.proof === proofIdentity && receipt.roots.kit === context.kitRoot &&
  receipt.roots.consumer === context.consumerRoot &&
  receipt.sources.package === context.sources.package && receipt.sources.binary === context.sources.binary

const receiptMatchesOwnershipContext = (
  receipt: OwnershipReceipt,
  context: Pick<ProofContext, "kitRoot" | "consumerRoot" | "sources" | "destinations">,
): boolean =>
  receipt.destinations.package === context.destinations.package &&
  receipt.destinations.binary === context.destinations.binary &&
  receipt.preflight_destinations[0] === "absent" && receipt.preflight_destinations[1] === "absent" &&
  receipt.links.length === 2 &&
  receipt.links.every((link) => link.kind === "package" || link.kind === "binary")

const receiptMatchesContext = (
  receipt: OwnershipReceipt,
  context: Pick<ProofContext, "kitRoot" | "consumerRoot" | "sources" | "destinations">,
): boolean => receiptMatchesRoots(receipt, context) && receiptMatchesOwnershipContext(receipt, context)

const ownershipMarkerName = ".agent-plugin-kit-local-link-owner.json"

export const writeTemporaryProofMarker = async (root: string, runId: string): Promise<void> => {
  if (!validRunId(runId)) throw new Error("temporary-proof-run-id-invalid")
  const canonicalRoot = await realpath(root)
  const markerPath = join(canonicalRoot, ownershipMarkerName)
  await writeFile(markerPath, `${JSON.stringify({ proof: proofIdentity, run_id: runId, root: canonicalRoot })}\n`, { mode: 0o600 })
  await chmod(markerPath, 0o600)
}

type OwnedReceiptCandidate = Readonly<{
  receiptPath: string
  runDirectory: string
  runId: string
}>

const ownedReceiptCandidate = async (
  canonicalProofRoot: string,
  entry: string,
): Promise<OwnedReceiptCandidate | undefined> => {
  const receiptPath = join(canonicalProofRoot, entry)
  const runDirectory = dirname(receiptPath)
  try {
    const runMetadata = await lstat(runDirectory)
    if (!runMetadata.isDirectory() || runMetadata.isSymbolicLink() || (runMetadata.mode & 0o777) !== 0o700) return undefined
    const canonicalRunDirectory = await realpath(runDirectory)
    if (!contained(canonicalProofRoot, canonicalRunDirectory) || canonicalRunDirectory !== runDirectory) return undefined
    const runId = basename(runDirectory)
    if (!validRunId(runId)) return undefined
    return { receiptPath, runDirectory, runId }
  } catch {
    return undefined
  }
}

const removeExpiredReceipt = async (candidate: OwnedReceiptCandidate, now: Date): Promise<void> => {
  try {
    const receipt = await readOwnershipReceipt(candidate.receiptPath)
    if (receipt.run_id !== candidate.runId || Date.parse(receipt.retained_until) > now.getTime()) return
    await unlink(candidate.receiptPath)
    await rmdir(candidate.runDirectory)
  } catch {
    // A malformed or non-empty receipt directory is not ours to remove.
  }
}

const removeExpiredOwnedReceipt = async (canonicalProofRoot: string, entry: string, now: Date): Promise<void> => {
  const candidate = await ownedReceiptCandidate(canonicalProofRoot, entry)
  if (candidate !== undefined) await removeExpiredReceipt(candidate, now)
}

const pruneExpiredReceipts = async (proofRoot: string, now: Date): Promise<void> => {
  const proofMetadata = await lstat(proofRoot)
  if (!proofMetadata.isDirectory() || proofMetadata.isSymbolicLink() || (proofMetadata.mode & 0o777) !== 0o700) {
    throw new Error("proof-root-unsafe")
  }
  const canonicalProofRoot = await realpath(proofRoot)
  let entries: string[]
  try {
    entries = await Array.fromAsync(new Bun.Glob("*/ownership.json").scan({ cwd: canonicalProofRoot, onlyFiles: true }))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
  for (const entry of entries) await removeExpiredOwnedReceipt(canonicalProofRoot, entry, now)
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
  ledger: AuditLedgerEntry[],
  kind: "public-process" | "timeout-probe" = "public-process",
  allowlistedArgv: readonly string[] = command.slice(1),
): Promise<{ observation: ProcessObservation; cleanup: ProcessCleanupReceipt }> => {
  const deadlineMs = kind === "timeout-probe" ? 100 : 2_000
  const executable = actualExecutable(command[0] ?? "")
  auditCommand({
    kind,
    executable,
    argv: command.slice(1),
    cwd,
    ...(kind === "public-process" ? { allowedExecutable: executable, allowedArgv: allowlistedArgv } : {}),
  }, ledger)
  const child = Bun.spawn([executable, ...command.slice(1)], {
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

const channelRecords = (channel: string): Record<string, unknown>[] => {
  if (channel === "") return []
  if (!channel.endsWith("\n")) throw new Error("public-process-channel-not-terminated")
  return channel.slice(0, -1).split("\n").map(parsedLine)
}

const exactJson = (actual: unknown, expected: unknown, failure: string): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(failure)
}

const expectedEnvelope = (serialized: string, runId: string): Record<string, unknown> => {
  const envelope = parsedLine(serialized.trim())
  return { ...envelope, run_id: runId }
}

const exactKeys = (record: Record<string, unknown>, keys: readonly string[], failure: string): void => {
  const actual = Object.keys(record).sort()
  const expected = [...keys].sort()
  exactJson(actual, expected, failure)
}

const nextActionFor = (record: Record<string, unknown>): Record<string, unknown> => {
  const action = record.next_action
  if (action === null || typeof action !== "object" || Array.isArray(action)) throw new Error("diagnostic-next-action-invalid")
  return action as Record<string, unknown>
}

type DiagnosticExpectation = Readonly<{
  event: string
  runId: string
  sequence: number
  command?: string
  resultCode: string
  stationId: string
  failureClass?: string
  level: "info" | "error"
  message: string
  nextAction?: Readonly<Record<string, unknown>>
}>

const diagnosticBaseKeys = [
  "category", "event", "level", "message", "record_type", "result_code", "retry_safety",
  "run_id", "schema_version", "sequence", "station_id", "timestamp", "transaction_state",
] as const

const diagnosticKeysFor = (expected: DiagnosticExpectation): string[] => [
  ...diagnosticBaseKeys,
  ...(expected.command === undefined ? [] : ["command"]),
  ...(expected.failureClass === undefined ? [] : ["failure_class"]),
  ...(expected.nextAction === undefined ? [] : ["next_action"]),
]

const assertDiagnosticShape = (record: Record<string, unknown>, expected: DiagnosticExpectation): void => {
  exactKeys(record, diagnosticKeysFor(expected), "public-process-diagnostic-shape-drift")
}

const assertDiagnosticEnvelopeIdentity = (record: Record<string, unknown>): void => {
  if (record.schema_version !== 2 || record.record_type !== "diagnostic" || record.category === undefined ||
    JSON.stringify(record.category) !== JSON.stringify(["agent-plugin-kit", "maintenance"])) {
    throw new Error("public-process-diagnostic-value-drift")
  }
}

const assertDiagnosticEventIdentity = (record: Record<string, unknown>, expected: DiagnosticExpectation): void => {
  if (record.event !== expected.event || record.run_id !== expected.runId || record.sequence !== expected.sequence ||
    record.result_code !== expected.resultCode || record.station_id !== expected.stationId) {
    throw new Error("public-process-diagnostic-value-drift")
  }
}

const assertDiagnosticOutcome = (record: Record<string, unknown>, expected: DiagnosticExpectation): void => {
  if (record.transaction_state !== "unchanged" || record.retry_safety !== "safe" || record.level !== expected.level ||
    record.message !== expected.message) {
    throw new Error("public-process-diagnostic-value-drift")
  }
}

const assertDiagnosticCore = (record: Record<string, unknown>, expected: DiagnosticExpectation): void => {
  assertDiagnosticEnvelopeIdentity(record)
  assertDiagnosticEventIdentity(record, expected)
  assertDiagnosticOutcome(record, expected)
}

const assertDiagnosticTimestamp = (record: Record<string, unknown>): void => {
  if (typeof record.timestamp !== "string" || !Number.isFinite(Date.parse(record.timestamp))) {
    throw new Error("public-process-diagnostic-value-drift")
  }
}

const assertDiagnosticOptionalFields = (record: Record<string, unknown>, expected: DiagnosticExpectation): void => {
  if (expected.command !== undefined && record.command !== expected.command) throw new Error("public-process-diagnostic-command-drift")
  if (expected.failureClass !== undefined && record.failure_class !== expected.failureClass) {
    throw new Error("public-process-diagnostic-failure-drift")
  }
}

const assertDiagnosticNextAction = (record: Record<string, unknown>, expected: DiagnosticExpectation): void => {
  if (expected.nextAction !== undefined) exactJson(nextActionFor(record), expected.nextAction, "public-process-next-action-drift")
}

const assertDiagnosticRecord = (
  record: Record<string, unknown>,
  expected: DiagnosticExpectation,
): void => {
  assertDiagnosticShape(record, expected)
  assertDiagnosticCore(record, expected)
  assertDiagnosticTimestamp(record)
  assertDiagnosticOptionalFields(record, expected)
  assertDiagnosticNextAction(record, expected)
}

const expectedUsageNextAction = {
  id: "maintenance.show-help",
  action: "change_input",
  summary: "Choose a command from machine discovery.",
  commandId: "help",
} as const

const expectedEventNextAction = {
  id: "events.inspect-configuration",
  action: "repair_state",
  summary: "Inspect the configured event transport; do not repeat the command solely to replay its event.",
  commandId: null,
} as const

const assertNoRedactionLeak = (
  scenario: LocalLinkProcessScenario,
  records: readonly Record<string, unknown>[],
): void => {
  const serialized = JSON.stringify(records)
  const forbidden = [
    ...(scenario.environment === undefined ? [] : Object.values(scenario.environment)),
    process.env.PATH ?? "",
    process.env.HOME ?? "",
  ].filter((value) => value.length > 0)
  if (forbidden.some((value) => serialized.includes(value))) throw new Error("public-process-redaction-drift")
}

const assertRefusalChannels = (
  scenario: LocalLinkProcessScenario,
  stdout: readonly Record<string, unknown>[],
): boolean => {
  const eventRefusal = scenario.expected.diagnosticEvent === "event.delivery-failed"
  if (eventRefusal) {
    if (stdout.length !== 1) throw new Error("public-process-event-stdout-count-drift")
    exactJson(stdout[0], expectedEnvelope(literalHelpProcess.stdout, scenario.expected.runId), "public-process-event-envelope-drift")
  } else if (stdout.length !== 0 || scenario.expected.diagnosticEvent === undefined) {
    throw new Error("public-process-refusal-channel-drift")
  }
  return eventRefusal
}

const refusalDiagnosticPair = (
  stderr: readonly Record<string, unknown>[],
  expectedRecordCount: number,
): readonly [Record<string, unknown>, Record<string, unknown>] => {
  if (stderr.length !== expectedRecordCount) throw new Error("public-process-diagnostic-count-drift")
  const context = stderr[0]
  const diagnostic = stderr[1]
  if (context === undefined || diagnostic === undefined) throw new Error("public-process-diagnostic-missing")
  return [context, diagnostic]
}

const assertUsageDiagnosticRecords = (
  scenario: LocalLinkProcessScenario,
  stderr: readonly Record<string, unknown>[],
): void => {
  const [context, diagnostic] = refusalDiagnosticPair(stderr, 3)
  assertDiagnosticRecord(context, {
    event: "maintenance.outcome-context",
    runId: scenario.expected.runId,
    sequence: 1,
    resultCode: "usage-refused",
    stationId: "maintenance.usage-refused",
    level: "info",
    message: "Maintenance command reached result code \"usage-refused\".",
  })
  assertDiagnosticRecord(diagnostic, {
    event: "maintenance.usage-refused",
    runId: scenario.expected.runId,
    sequence: 2,
    resultCode: "usage-refused",
    stationId: "maintenance.usage-refused",
    failureClass: "usage",
    level: "error",
    message: "Maintenance command failed with result code \"usage-refused\".",
    nextAction: expectedUsageNextAction,
  })
}

const assertEventDiagnosticRecords = (
  scenario: LocalLinkProcessScenario,
  event: string,
  stderr: readonly Record<string, unknown>[],
): void => {
  const [context, diagnostic] = refusalDiagnosticPair(stderr, 2)
  assertDiagnosticRecord(context, {
    event: "maintenance.outcome-context",
    runId: scenario.expected.runId,
    sequence: 2,
    command: "help",
    resultCode: "previewed",
    stationId: "help.previewed",
    level: "info",
    message: "Maintenance command reached result code \"previewed\".",
  })
  assertDiagnosticRecord(diagnostic, {
    event,
    runId: scenario.expected.runId,
    sequence: 3,
    command: "help",
    resultCode: "previewed",
    stationId: "help.previewed",
    failureClass: "event_delivery",
    level: "error",
    message: "Inspect the configured event transport; do not repeat the command solely to replay its event.",
    nextAction: expectedEventNextAction,
  })
}

const assertRefusalDiagnosticRecords = (
  scenario: LocalLinkProcessScenario,
  stderr: readonly Record<string, unknown>[],
): { event: string; usage: boolean } => {
  const event = scenario.expected.diagnosticEvent
  if (event === undefined) throw new Error("public-process-diagnostic-oracle-invalid")
  if (event === "maintenance.usage-refused") {
    assertUsageDiagnosticRecords(scenario, stderr)
    return { event, usage: true }
  }
  assertEventDiagnosticRecords(scenario, event, stderr)
  return { event, usage: false }
}

const assertRefusalPrimaryEnvelope = (
  scenario: LocalLinkProcessScenario,
  stderr: readonly Record<string, unknown>[],
  usage: boolean,
): PublicObservabilityOracle["primaryEnvelopeChannel"] => {
  if (usage) {
    const finalRecord = stderr[2]
    if (finalRecord === undefined) throw new Error("public-process-final-envelope-missing")
    exactJson(finalRecord, expectedEnvelope(literalUsageProcess.stderr, scenario.expected.runId), "public-process-error-envelope-drift")
    return "stderr"
  }
  if (stderr.some((record) => record.record_type !== "diagnostic")) throw new Error("public-process-event-envelope-placement-drift")
  return "stdout"
}

const refusalSequences = (
  stderr: readonly Record<string, unknown>[],
  usage: boolean,
  eventRefusal: boolean,
): { sequences: number[]; eventSequenceGap: boolean } => {
  const sequences = stderr.filter((record) => record.record_type === "diagnostic").map((record) => {
    if (typeof record.sequence !== "number") throw new Error("public-process-sequence-invalid")
    return record.sequence
  })
  exactJson(sequences, usage ? [1, 2] : [2, 3], "public-process-sequence-order-drift")
  const eventSequenceGap = !usage && sequences[0] === 2 && !sequences.includes(1)
  if (eventRefusal && !eventSequenceGap) throw new Error("public-process-event-gap-drift")
  return { sequences, eventSequenceGap }
}

const summarizePublicObservation = (
  scenario: LocalLinkProcessScenario,
  observation: ProcessObservation,
  stdout: readonly Record<string, unknown>[],
  stderr: readonly Record<string, unknown>[],
  stdoutStatus: PublicObservabilityOracle["stdoutStatus"],
  stderrSequences: readonly number[],
  primaryEnvelopeChannel: PublicObservabilityOracle["primaryEnvelopeChannel"],
  eventSequenceGap: boolean,
): PublicObservabilityOracle => ({
  runId: scenario.expected.runId,
  exitCode: observation.exitCode,
  stdoutRecordCount: stdout.length,
  stderrRecordCount: stderr.length,
  stdoutStatus,
  stderrSequences,
  stderrEvents: stderr.map((record) => String(record.event ?? record.record_type)),
  primaryEnvelopeChannel,
  eventSequenceGap,
  redacted: true,
})

const validateHelpSuccessObservation = (
  scenario: LocalLinkProcessScenario,
  observation: ProcessObservation,
  stdout: readonly Record<string, unknown>[],
  stderr: readonly Record<string, unknown>[],
  allRecords: readonly Record<string, unknown>[],
): PublicObservabilityOracle => {
  if (stdout.length !== 1 || stderr.length !== 0) throw new Error("public-process-help-channel-drift")
  exactJson(stdout[0], expectedEnvelope(literalHelpProcess.stdout, scenario.expected.runId), "public-process-help-envelope-drift")
  if (scenario.expected.diagnosticEvent !== undefined) throw new Error("public-process-help-oracle-invalid")
  assertNoRedactionLeak(scenario, allRecords)
  return summarizePublicObservation(scenario, observation, stdout, stderr, "ok", [], "stdout", false)
}

const validateRefusalDiagnosticObservation = (
  scenario: LocalLinkProcessScenario,
  observation: ProcessObservation,
  stdout: readonly Record<string, unknown>[],
  stderr: readonly Record<string, unknown>[],
  allRecords: readonly Record<string, unknown>[],
): PublicObservabilityOracle => {
  const eventRefusal = assertRefusalChannels(scenario, stdout)
  const { event, usage } = assertRefusalDiagnosticRecords(scenario, stderr)
  const primaryEnvelopeChannel = assertRefusalPrimaryEnvelope(scenario, stderr, usage)
  assertNoRedactionLeak(scenario, allRecords)
  const { sequences, eventSequenceGap } = refusalSequences(stderr, usage, eventRefusal)
  return summarizePublicObservation(scenario, observation, stdout, stderr, "empty", sequences, primaryEnvelopeChannel, eventSequenceGap)
}

const validateObservation = (
  scenario: LocalLinkProcessScenario,
  observation: ProcessObservation,
): PublicObservabilityOracle => {
  if (observation.exitCode !== scenario.expected.exitCode) throw new Error("public-process-exit-drift")
  const stdout = channelRecords(observation.stdout)
  const stderr = channelRecords(observation.stderr)
  const allRecords = [...stdout, ...stderr]
  const eventRefusal = scenario.expected.diagnosticEvent === "event.delivery-failed"
  if (scenario.expected.stdoutStatus === "ok" && !eventRefusal) {
    return validateHelpSuccessObservation(scenario, observation, stdout, stderr, allRecords)
  }
  return validateRefusalDiagnosticObservation(scenario, observation, stdout, stderr, allRecords)
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
  auditLedger: AuditLedgerEntry[]
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

const publicBinary = async (kitRoot: string, ledger: AuditLedgerEntry[] = []): Promise<PublicBinary> => {
  const binarySource = resolve(kitRoot, await publicBinaryManifestEntry(kitRoot))
  if (!contained(kitRoot, binarySource)) throw new Error("public-binary-escaped")
  const binaryMetadata = await stat(binarySource)
  if (!binaryMetadata.isFile()) throw new Error("public-binary-not-regular")
  const mode = binaryMetadata.mode & 0o777
  const shebang = (await readFile(binarySource, "utf8")).split("\n", 1)[0]
  if (mode !== 0o755 || shebang !== "#!/usr/bin/env bun") throw new Error("public-binary-identity-invalid")
  const relativeBinary = relative(kitRoot, binarySource)
  await commandOutput(["git", "ls-files", "--error-unmatch", "--", relativeBinary], kitRoot, [0], ledger)
  const indexRow = await commandOutput(["git", "ls-files", "-s", "--", relativeBinary], kitRoot, [0], ledger)
  if (!indexRow.startsWith("100755 ")) throw new Error("public-binary-index-mode-invalid")
  return { source: binarySource, shebang, mode }
}

const prepareProofContext = async (
  options: LocalLinkProofOptions,
  now: Date,
): Promise<ProofContext> => {
  if (!validRunId(options.runId)) throw new Error("run-id-invalid")
  if (!isAbsolute(options.stateRoot)) throw new Error("state-root-must-be-absolute")
  const auditLedger: AuditLedgerEntry[] = []
  const kitRoot = await realpath(options.kitRoot)
  const consumerRoot = await realpath(options.consumerRoot)
  const binary = await publicBinary(kitRoot, auditLedger)
  await assertOwnerLocalLogTape(kitRoot)
  const packageDestination = join(consumerRoot, "node_modules/agent-plugin-kit")
  const binaryDestination = join(consumerRoot, "node_modules/.bin/agent-plugin-kit")
  await assertDirectory(consumerRoot, dirname(packageDestination))
  await assertDirectory(consumerRoot, dirname(binaryDestination))
  await assertIgnored(consumerRoot, packageDestination, auditLedger)
  await assertIgnored(consumerRoot, binaryDestination, auditLedger)
  const preflightDestinations = [await pathState(packageDestination), await pathState(binaryDestination)] as const
  if (preflightDestinations[0] !== "absent" || preflightDestinations[1] !== "absent") {
    throw new Error("link-destination-preexists")
  }
  const before = { kit: await repositorySnapshot(kitRoot, auditLedger), consumer: await repositorySnapshot(consumerRoot, auditLedger) }
  await mkdir(options.stateRoot, { recursive: true, mode: 0o700 })
  await chmod(options.stateRoot, 0o700)
  const stateRoot = await realpath(options.stateRoot)
  const proofRoot = join(stateRoot, "my-second-brain-vault/agent-plugin-kit/local-link-proof")
  if (!contained(stateRoot, proofRoot)) throw new Error("proof-root-escaped")
  const receiptDirectory = join(proofRoot, options.runId)
  await mkdir(proofRoot, { recursive: true, mode: 0o700 })
  await chmod(proofRoot, 0o700)
  await pruneExpiredReceipts(proofRoot, now)
  await mkdir(receiptDirectory, { mode: 0o700 })
  await chmod(receiptDirectory, 0o700)
  const receiptPath = join(receiptDirectory, "ownership.json")
  const sources = { package: kitRoot, binary: binary.source }
  const destinations = { package: packageDestination, binary: binaryDestination }
  return { kitRoot, consumerRoot, binary, sources, destinations, before, receiptDirectory, receiptPath, auditLedger }
}

type ProofState = {
  receipt: OwnershipReceipt
  ledger: string[]
  auditLedger: AuditLedgerEntry[]
  actionLedger: AuditLedgerEntry[]
  observations: ProcessObservation[]
  publicObservability: PublicObservabilityOracle[]
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
    auditedSpawnSync({ kind: "link", executable: "/bin/ln", argv: ["-s", source, destination], cwd: context.consumerRoot }, state.auditLedger)
    const command = state.auditLedger.at(-1)
    if (command?.operation !== "command" || command.kind !== "link") throw new Error("link-command-audit-missing")
    state.actionLedger.push(command)
    state.ledger.push(ledgerEntry)
    const identity = await linkIdentity(kind, destination)
    state.ownedLinks.set(kind, identity)
    const expectedCanonicalTarget = await realpath(source)
    if (identity.rawTarget !== source || identity.canonicalTarget !== expectedCanonicalTarget) {
      throw new Error("created-link-identity-invalid")
    }
    await updateReceipt({
      links: [...state.ownedLinks.values()],
      created: { ...state.receipt.created, [kind]: true },
      command_ledger: [...state.actionLedger],
    })
  }
}

const assertLinkedState = async (context: ProofContext, state: ProofState): Promise<void> => {
  for (const [kind, destination] of [
    ["package", context.destinations.package],
    ["binary", context.destinations.binary],
  ] as const) {
    const expected = state.ownedLinks.get(kind)
    if (expected === undefined || !sameLink(await linkIdentity(kind, destination), expected)) {
      throw new Error(`owned-link-drifted:${kind}`)
    }
  }
  const binary = await publicBinary(context.kitRoot, context.auditLedger)
  if (binary.source !== context.binary.source || binary.mode !== 0o755 || binary.shebang !== "#!/usr/bin/env bun") {
    throw new Error("public-binary-identity-invalid")
  }
}

const applyPostLinkFault = async (
  fault: LocalLinkFault,
  context: ProofContext,
): Promise<void> => {
  if (fault === "retargeted-link") {
    await unlink(context.destinations.binary)
    await symlink(context.sources.package, context.destinations.binary)
    return
  }
  if (fault === "second-identity") {
    await unlink(context.destinations.package)
    await symlink(context.sources.package, context.destinations.package)
    return
  }
  if (fault === "mode-shebang-loss") {
    const source = await readFile(context.sources.binary, "utf8")
    await writeFile(context.sources.binary, source.replace(/^#!\/usr\/bin\/env bun/u, "#!/usr/bin/env sh"), { mode: 0o644 })
    await chmod(context.sources.binary, 0o644)
    return
  }
  if (fault === "repository-drift") {
    await appendFile(context.sources.binary, "\n// local-link repository drift negative control\n")
    return
  }
  if (fault === "receipt-tamper") {
    const receipt = await readOwnershipReceipt(context.receiptPath)
    await writeFile(context.receiptPath, `${JSON.stringify({
      ...receipt,
      created: { ...receipt.created, package: false },
    })}\n`, { mode: 0o600 })
    await chmod(context.receiptPath, 0o600)
  }
}

const forbiddenCommandNegativeControl = (cwd: string): true => {
  try {
    auditCommand({ kind: "read", executable: "npm", argv: ["install"], cwd }, [])
  } catch (error) {
    if (error instanceof Error && error.message === "command-not-allowlisted") return true
    throw error
  }
  throw new Error("forbidden-command-was-allowlisted")
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
      state.auditLedger,
      "public-process",
      scenario.argv,
    )
    const expectedLedger = `execute:${scenario.argv.join(" ")}`
    if (scenario.ledger !== expectedLedger) throw new Error("scenario-ledger-drift")
    state.ledger.push(expectedLedger)
    const command = state.auditLedger.at(-1)
    if (command?.operation !== "command" || command.kind !== "public-process") throw new Error("public-command-audit-missing")
    state.actionLedger.push(command)
    state.publicObservability.push(validateObservation(scenario, result.observation))
    state.observations.push(result.observation)
    state.processCleanupReceipts.push(result.cleanup)
    await updateReceipt({ command_ledger: [...state.actionLedger] })
  }
}

const cleanupOwnedLink = async (
  context: ProofContext,
  state: ProofState,
  kind: "package" | "binary",
  destination: string,
  ledgerEntry: string,
): Promise<void> => {
  const durable = await readOwnershipReceipt(context.receiptPath)
  if (!receiptMatchesContext(durable, context) || durable.run_id !== state.receipt.run_id) {
    throw new Error("ownership-receipt-context-drifted")
  }
  if (!durable.created[kind] || durable.cleaned[kind]) throw new Error(`ownership-receipt-state-drifted:${kind}`)
  const owned = receiptLink(durable, kind)
  const current = await linkIdentity(kind, destination)
  if (!sameLink(current, owned)) throw new Error(`owned-link-drifted:${kind}`)
  await unlink(destination)
  state.ledger.push(ledgerEntry)
  state.auditLedger.push({ operation: "unlink", kind })
  state.actionLedger.push({ operation: "unlink", kind })
  const currentReceipt = await readOwnershipReceipt(context.receiptPath)
  if (!receiptMatchesContext(currentReceipt, context) || currentReceipt.run_id !== state.receipt.run_id) {
    throw new Error("ownership-receipt-context-drifted")
  }
  state.receipt = {
    ...currentReceipt,
    cleaned: { ...currentReceipt.cleaned, [kind]: true },
    command_ledger: [...state.actionLedger],
  }
  await writeReceipt(context.receiptPath, state.receipt)
}

const cleanupLinks = async (
  context: ProofContext,
  state: ProofState,
): Promise<unknown[]> => {
  const cleanupFailures: unknown[] = []
  for (const [kind, destination, ledgerEntry] of [
    ["binary", context.destinations.binary, "unlink:binary"],
    ["package", context.destinations.package, "unlink:package"],
  ] as const) {
    try {
      await cleanupOwnedLink(context, state, kind, destination, ledgerEntry)
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  return cleanupFailures
}

const deleteSuccessfulReceipt = async (context: ProofContext, state: ProofState): Promise<true> => {
  const durable = await readOwnershipReceipt(context.receiptPath)
  if (!receiptMatchesContext(durable, context) || durable.run_id !== state.receipt.run_id ||
    !durable.created.package || !durable.created.binary || !durable.cleaned.package || !durable.cleaned.binary) {
    throw new Error("ownership-receipt-completion-invalid")
  }
  await unlink(context.receiptPath)
  await rmdir(context.receiptDirectory)
  return true
}

const proveRestoration = async (context: ProofContext): Promise<boolean> => {
  const after = {
    kit: await repositorySnapshot(context.kitRoot, context.auditLedger),
    consumer: await repositorySnapshot(context.consumerRoot, context.auditLedger),
  }
  const digestsEqual = sameSnapshot(context.before.kit, after.kit) &&
    sameSnapshot(context.before.consumer, after.consumer)
  if (!digestsEqual) throw new Error("repository-state-drifted")
  const packageAbsent = await pathState(context.destinations.package) === "absent"
  const binaryAbsent = await pathState(context.destinations.binary) === "absent"
  const packageParentPresent = await pathState(dirname(context.destinations.package)) === "present"
  const binaryParentPresent = await pathState(dirname(context.destinations.binary)) === "present"
  if (!packageAbsent || !binaryAbsent) throw new Error("owned-link-remained")
  if (!packageParentPresent || !binaryParentPresent) throw new Error("destination-parent-removed")
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
    auditLedger: context.auditLedger,
    actionLedger: [],
    observations: [],
    publicObservability: [],
    processCleanupReceipts: [],
    ownedLinks: new Map(),
  }
  const updateReceipt: ReceiptUpdater = async (update) => {
    if (options.fault === "receipt-write-failure" && update.created?.package === true) {
      throw new Error("ownership-receipt-write-failure")
    }
    const durable = await readOwnershipReceipt(context.receiptPath)
    exactJson(
      {
        links: durable.links,
        created: durable.created,
        cleaned: durable.cleaned,
        command_ledger: durable.command_ledger,
      },
      {
        links: state.receipt.links,
        created: state.receipt.created,
        cleaned: state.receipt.cleaned,
        command_ledger: state.receipt.command_ledger,
      },
      "ownership-receipt-tampered",
    )
    state.receipt = { ...state.receipt, ...update }
    await writeReceipt(context.receiptPath, state.receipt)
  }
  await writeReceipt(context.receiptPath, state.receipt)

  let primaryFailure: unknown
  const timeoutDescriptorControl = (await invokeBoundedProcess(
    [process.execPath, "-e", "setTimeout(() => {}, 10_000)"],
    context.kitRoot,
    {},
    state.auditLedger,
    "timeout-probe",
  )).cleanup
  const forbiddenCommandRefused = forbiddenCommandNegativeControl(context.kitRoot)
  try {
    await createLinks(context, state, updateReceipt)
    if (options.fault !== undefined && options.fault !== "receipt-write-failure") {
      await applyPostLinkFault(options.fault, context)
      if (options.fault !== "repository-drift" && options.fault !== "receipt-tamper") {
        await assertLinkedState(context, state)
      }
    }
    await executeScenarios(options, context, state, updateReceipt)
  } catch (error) {
    primaryFailure = error
  }
  const cleanupFailures = await cleanupLinks(context, state)
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
  const receiptDeleted = await deleteSuccessfulReceipt(context, state)
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
    auditLedger: state.auditLedger,
    publicObservability: state.publicObservability,
    forbiddenCommandRefused,
    timeoutDescriptorControl,
    parentsPreserved: true,
    receiptDeleted,
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

export async function removeTemporaryProofRoot(root: string, runId: string): Promise<void> {
  const canonicalRoot = await realpath(root)
  const canonicalParent = dirname(canonicalRoot)
  if (!basename(canonicalRoot).startsWith("agent-plugin-kit-local-link-") || !contained(canonicalParent, canonicalRoot)) {
    throw new Error("temporary-proof-root-refused")
  }
  const markerPath = join(canonicalRoot, ownershipMarkerName)
  const markerMetadata = await lstat(markerPath)
  if (!markerMetadata.isFile() || markerMetadata.isSymbolicLink() || (markerMetadata.mode & 0o777) !== 0o600) {
    throw new Error("temporary-proof-marker-invalid")
  }
  const marker = await readJsonObject(markerPath)
  if (marker.proof !== proofIdentity || marker.run_id !== runId || marker.root !== canonicalRoot) {
    throw new Error("temporary-proof-marker-mismatch")
  }
  await rm(canonicalRoot, { recursive: true, force: true })
}
