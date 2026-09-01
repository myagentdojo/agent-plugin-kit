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
import { tmpdir } from "node:os"
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

export type AuditCommandKind = "read" | "link" | "public-process" | "timeout-probe" | "fault"

export type AuditLedgerEntry = Readonly<{
  operation: "command" | "unlink"
  kind: AuditCommandKind | "package" | "binary"
  executable?: string
  argv?: readonly string[]
}>

type NetworkObserver = Readonly<{
  preloadPath: string
  tracePath: string
}>

export type LocalLinkFault =
  | "partial-link"
  | "retargeted-link"
  | "second-identity"
  | "mode-shebang-loss"
  | "repository-drift"
  | "manifest-lock-drift"
  | "staged-index-drift"
  | "commit-ref-drift"
  | "parent-deletion"
  | "network-primitive"
  | "diagnostic-order"
  | "redaction-bypass"
  | "missing-owner-local-dependency"
  | "receipt-schema"
  | "receipt-mistyped"
  | "receipt-tamper"
  | "receipt-link-substitution"
  | "receipt-write-failure"

export type FailureControlResult = Readonly<{
  refused: true
  reason: string
  parentsPreserved: boolean
  linksRemain: boolean
  receiptRemaining: boolean
}>

export type PublicObservabilityOracle = Readonly<{
  runId: string
  exitCode: number
  stdoutRecordCount: number
  stderrRecordCount: number
  stdoutRecordTypes: readonly string[]
  stderrRecordTypes: readonly string[]
  stdoutStatus: "ok" | "empty"
  stderrSequences: readonly number[]
  stderrEvents: readonly string[]
  stationIds: readonly string[]
  resultCodes: readonly string[]
  nextActionIds: readonly string[]
  primaryEnvelopeChannel: "stdout" | "stderr" | "none"
  eventSequenceGap: boolean
  noExtraRecords: true
  safeContext: true
  redacted: true
}>

type RepositorySnapshot = Readonly<{
  status: string
  head: string
  tree: string
  index_sha256: string
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
  hardSettlementDeadlineMs: number
  timedOut: boolean
  hardSettlementTimedOut: boolean
  exitObserved: boolean
  descriptorClosure: "closed"
  descriptorRetainingDescendant: boolean
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
  zeroNetworkAttempts: true
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
  gitStateEqual: true
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
  approvedExecutable?: string
  approvedPreload?: string
}>

const actualExecutable = (executable: string): string =>
  isAbsolute(executable) ? executable : Bun.which(executable) ?? executable

const sameArgv = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

const exactGitReadArgv = {
  status: ["status", "--porcelain=v1", "--untracked-files=all"],
  index: ["ls-files", "-s", "-z"],
  head: ["rev-parse", "HEAD"],
  tree: ["rev-parse", "HEAD^{tree}"],
} as const

const exactGitFaultArgv = {
  stagedIndex: ["add", "--", "src/adapters/maintenance-command-facade/maintenance.ts"],
  commitRef: ["reset", "--soft", "HEAD^"],
} as const

const timeoutProbeArgv = [
  "-e",
  "const child = Bun.spawn([process.execPath, '-e', 'setTimeout(() => {}, 10_000)'], { stdout: 'inherit', stderr: 'inherit' }); process.stderr.write('descriptor-retaining-descendant\\n'); process.exit(0)",
] as const

const networkPrimitiveMutation = "\nfetch(\"http://127.0.0.1:9/proof-network-negative-control\")\n"
const redactionControlSecret = "local-link-redaction-control-secret"

type ApprovedScenario = Readonly<{
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

const approvedScenarioCatalog: readonly ApprovedScenario[] = [
  {
    argv: ["maintenance", "--json", "--run-id", "local-link-help", "help"],
    expected: { exitCode: 0, runId: "local-link-help", stdoutStatus: "ok" },
  },
  {
    argv: ["--run-id", "local-link-usage", "unknown"],
    expected: {
      exitCode: 2,
      runId: "local-link-usage",
      diagnosticEvent: "maintenance.usage-refused",
      finalStderrRecordType: "error_envelope",
    },
  },
  {
    argv: ["--events", "auto", "--run-id", "local-link-event", "maintenance", "help"],
    environment: { AGENT_PLUGIN_KIT_EVENT_ENDPOINT: "http://127.0.0.1:9/events" },
    expected: {
      exitCode: 0,
      runId: "local-link-event",
      stdoutStatus: "ok",
      diagnosticEvent: "event.delivery-failed",
    },
  },
  {
    argv: ["--run-id", "local-link-second-refusal", "unknown"],
    expected: {
      exitCode: 2,
      runId: "local-link-second-refusal",
      diagnosticEvent: "maintenance.usage-refused",
      finalStderrRecordType: "error_envelope",
    },
  },
] as const

const sameEnvironment = (
  left: Readonly<Record<string, string>> | undefined,
  right: Readonly<Record<string, string>> | undefined,
): boolean => JSON.stringify(left ?? {}) === JSON.stringify(right ?? {})

const assertApprovedScenarioCatalog = (scenarios: readonly LocalLinkProcessScenario[]): void => {
  if (scenarios.length !== approvedScenarioCatalog.length) throw new Error("public-process-scenario-count-invalid")
  for (const [index, scenario] of scenarios.entries()) {
    const expected = approvedScenarioCatalog[index]
    if (!approvedScenarioMatches(scenario, expected)) throw new Error("public-process-scenario-catalog-invalid")
  }
}

const approvedScenarioMatches = (
  scenario: LocalLinkProcessScenario,
  expected: ApprovedScenario | undefined,
): boolean => {
  if (expected === undefined) return false
  const expectedFields = expected.expected
  const actualFields = scenario.expected
  return sameArgv(scenario.argv, expected.argv) && scenario.ledger === `execute:${expected.argv.join(" ")}` &&
    sameEnvironment(scenario.environment, expected.environment) && actualFields.exitCode === expectedFields.exitCode &&
    actualFields.runId === expectedFields.runId && actualFields.stdoutStatus === expectedFields.stdoutStatus &&
    actualFields.diagnosticEvent === expectedFields.diagnosticEvent &&
    actualFields.finalStderrRecordType === expectedFields.finalStderrRecordType
}

const isGitPathRead = (argv: readonly string[], operation: "check-ignore" | "error-unmatch" | "index"): boolean => {
  const expected = operation === "check-ignore"
    ? ["check-ignore", "--quiet", "--"]
    : ["ls-files", operation === "error-unmatch" ? "--error-unmatch" : "-s", "--"]
  return argv.length === 4 && expected.every((value, index) => argv[index] === value)
}

const allowedGitRead = (argv: readonly string[]): boolean =>
  sameArgv(argv, exactGitReadArgv.status) || sameArgv(argv, exactGitReadArgv.index) ||
  sameArgv(argv, exactGitReadArgv.head) || sameArgv(argv, exactGitReadArgv.tree) ||
  isGitPathRead(argv, "check-ignore") || isGitPathRead(argv, "error-unmatch") || isGitPathRead(argv, "index")

const allowedGitFault = (argv: readonly string[]): boolean =>
  sameArgv(argv, exactGitFaultArgv.stagedIndex) || sameArgv(argv, exactGitFaultArgv.commitRef)

const isReadCommandAllowlisted = (command: AuditedCommand): boolean =>
  basename(command.executable) === "git" && allowedGitRead(command.argv)

const isLinkCommandAllowlisted = (command: AuditedCommand): boolean =>
  command.executable === "/bin/ln" && command.argv.length === 3 && command.argv[0] === "-s" &&
  command.argv[1] !== undefined && command.argv[2] !== undefined &&
  isAbsolute(command.argv[1]) && isAbsolute(command.argv[2])

const isPublicProcessAllowlisted = (command: AuditedCommand): boolean =>
  command.approvedExecutable !== undefined && command.approvedPreload !== undefined &&
  command.executable === process.execPath && command.allowedExecutable === command.approvedExecutable &&
  command.allowedArgv !== undefined && sameArgv(command.argv, [
    "--no-install",
    "--preload",
    command.approvedPreload,
    command.approvedExecutable,
    ...command.allowedArgv,
  ])

const isTimeoutProbeAllowlisted = (command: AuditedCommand): boolean =>
  command.executable === process.execPath && sameArgv(command.argv, timeoutProbeArgv)

const isFaultCommandAllowlisted = (command: AuditedCommand): boolean =>
  basename(command.executable) === "git" && allowedGitFault(command.argv)

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
    case "fault":
      return isFaultCommandAllowlisted(command)
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
  const head = (await commandOutput(["git", "rev-parse", "HEAD"], root, [0], ledger)).trim()
  const tree = (await commandOutput(["git", "rev-parse", "HEAD^{tree}"], root, [0], ledger)).trim()
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
  return { status, head, tree, index_sha256: sha256(index), tracked, manifestsAndLocks }
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string")

const isAbsoluteString = (value: unknown): value is string =>
  typeof value === "string" && isAbsolute(value)

const isDigest = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value)

const readJsonObject = async (path: string): Promise<Record<string, unknown>> => {
  const value: unknown = JSON.parse(await readFile(path, "utf8"))
  if (!isRecord(value)) throw new Error("json-object-required")
  return value
}

const dependenciesFor = (manifest: Record<string, unknown>): Readonly<Record<string, unknown>> => {
  const value = manifest.dependencies
  return isRecord(value)
    ? value
    : {}
}

const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const

const allDependenciesFor = (manifest: Record<string, unknown>): Readonly<Record<string, unknown>> => {
  const entries: Record<string, unknown> = {}
  for (const field of dependencyFields) {
    const value = manifest[field]
    if (isRecord(value)) {
      Object.assign(entries, value)
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

const assertLogTapeLockResolution = async (kitRoot: string): Promise<void> => {
  const lock = await readFile(join(kitRoot, "bun.lock"), "utf8")
  if (!lock.includes('"@logtape/logtape": "2.3.1"') || !lock.includes('"@logtape/logtape@2.3.1"') ||
    !lock.includes('"@logtape/redaction": "2.3.1"') || !lock.includes('"@logtape/redaction@2.3.1"')) {
    throw new Error("logtape-lock-resolution-invalid")
  }
}

const ownerLocalPackageResolution = async (
  name: string,
  facadeRoot: string,
): Promise<Readonly<{ ownerLocalManifest: string; resolved: string; ownerLocalResolution: string }>> => {
  const ownerLocalManifest = join(facadeRoot, "node_modules", name, "package.json")
  try {
    const resolved = Bun.resolveSync(`${name}/package.json`, join(facadeRoot, "implementation"))
    const ownerLocalResolution = await realpath(ownerLocalManifest)
    return { ownerLocalManifest, resolved, ownerLocalResolution }
  } catch {
    throw new Error("owner-local-dependency-missing")
  }
}

const assertOwnerLocalLogTapeInstallation = async (kitRoot: string, facadeRoot: string): Promise<void> => {
  await assertLogTapeLockResolution(kitRoot)
  for (const name of ownerLogTapeNames) {
    const { ownerLocalManifest, resolved, ownerLocalResolution } = await ownerLocalPackageResolution(name, facadeRoot)
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

type ReceiptWriteOptions = Readonly<{
  failAfterTemporaryWrite?: boolean
  previousReceiptBytes?: string
}>

const removeTemporaryReceipt = async (temporary: string): Promise<void> => {
  try {
    await unlink(temporary)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}

const writeReceipt = async (
  path: string,
  receipt: OwnershipReceipt,
  options: ReceiptWriteOptions = {},
): Promise<void> => {
  const temporary = `${path}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(receipt)}\n`, { mode: 0o600 })
    await chmod(temporary, 0o600)
    if (options.failAfterTemporaryWrite === true) {
      let durableReceiptBytes: string | undefined
      try {
        durableReceiptBytes = await readFile(path, "utf8")
      } catch {
        durableReceiptBytes = undefined
      }
      throw new Error("ownership-receipt-write-failure", {
        cause: {
          previousReceiptBytes: options.previousReceiptBytes,
          durableReceiptBytes,
        },
      })
    }
    await rename(temporary, path)
  } catch (error) {
    await removeTemporaryReceipt(temporary)
    throw error
  }
}

const validRunId = (runId: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(runId)

const assertOwnershipReceiptMetadata = (metadata: Awaited<ReturnType<typeof lstat>>): void => {
  if (!metadata.isFile() || metadata.isSymbolicLink() || (Number(metadata.mode) & 0o777) !== 0o600) {
    throw new Error("ownership-receipt-permissions-invalid")
  }
}

const isAuditCommandKind = (value: unknown): value is AuditCommandKind => {
  if (typeof value !== "string") return false
  switch (value) {
    case "read":
    case "link":
    case "public-process":
    case "timeout-probe":
    case "fault":
      return true
    default:
      return false
  }
}

const isLinkKind = (value: unknown): value is "package" | "binary" =>
  value === "package" || value === "binary"

const isUnlinkLedgerEntry = (value: Record<string, unknown>): boolean =>
  hasExactKeys(value, ["operation", "kind"]) && isLinkKind(value.kind)

const isCommandLedgerEntry = (value: Record<string, unknown>): boolean =>
  hasExactKeys(value, ["operation", "kind", "executable", "argv"]) &&
  isAuditCommandKind(value.kind) && typeof value.executable === "string" && isStringArray(value.argv)

const isAuditLedgerEntry = (value: unknown): value is AuditLedgerEntry => {
  if (!isRecord(value)) return false
  return value.operation === "unlink" ? isUnlinkLedgerEntry(value) :
    value.operation === "command" && isCommandLedgerEntry(value)
}

const isSafeNonNegativeInteger = (value: unknown): value is number => {
  if (typeof value !== "number") return false
  return Number.isSafeInteger(value) && value >= 0
}

const isLinkIdentity = (value: unknown): value is LinkIdentity => {
  if (!isRecord(value) || !hasExactKeys(value, ["kind", "destination", "rawTarget", "canonicalTarget", "device", "inode", "mode"])) {
    return false
  }
  return isLinkKind(value.kind) && isAbsoluteString(value.destination) && typeof value.rawTarget === "string" &&
    isAbsoluteString(value.canonicalTarget) && isSafeNonNegativeInteger(value.device) &&
    isSafeNonNegativeInteger(value.inode) && isSafeNonNegativeInteger(value.mode)
}

const isGitObjectId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{40}$/u.test(value)

const isRepositoryFile = (value: unknown): value is Readonly<{ path: string; mode: string; sha256: string }> => {
  if (!isRecord(value) || !hasExactKeys(value, ["path", "mode", "sha256"])) return false
  return typeof value.path === "string" && value.path !== "" && typeof value.mode === "string" && isDigest(value.sha256)
}

const isRepositorySnapshot = (value: unknown): value is RepositorySnapshot => {
  if (!isRecord(value) || !hasExactKeys(value, ["status", "head", "tree", "index_sha256", "tracked", "manifestsAndLocks"])) {
    return false
  }
  const tracked = isRepositoryFileList(value.tracked)
  const manifestsAndLocks = isRepositoryFileList(value.manifestsAndLocks)
  return [typeof value.status === "string", isGitObjectId(value.head), isGitObjectId(value.tree),
    isDigest(value.index_sha256), tracked, manifestsAndLocks].every(Boolean)
}

const isRepositoryFileList = (value: unknown): boolean =>
  Array.isArray(value) && value.every(isRepositoryFile)

const receiptKeys = [
  "schema_version", "proof", "run_id", "created_at", "retained_until", "roots", "sources", "destinations",
  "preflight_destinations", "links", "created", "cleaned", "repository_snapshots", "command_ledger",
] as const

const isReceiptHeader = (value: Record<string, unknown>): boolean =>
  value.schema_version === 1 && value.proof === proofIdentity && typeof value.run_id === "string" &&
  validRunId(value.run_id) && typeof value.created_at === "string" && typeof value.retained_until === "string"

const isReceiptDates = (value: Record<string, unknown>): boolean => {
  if (typeof value.created_at !== "string" || typeof value.retained_until !== "string") return false
  const createdAt = Date.parse(value.created_at)
  const retainedUntil = Date.parse(value.retained_until)
  return Number.isFinite(createdAt) && Number.isFinite(retainedUntil) && retainedUntil >= createdAt &&
    retainedUntil - createdAt <= maximumRetentionMs
}

const isAbsolutePathPair = (value: unknown, keys: readonly [string, string]): boolean => {
  if (!isRecord(value) || !hasExactKeys(value, keys)) return false
  return isAbsoluteString(value[keys[0]]) && isAbsoluteString(value[keys[1]])
}

const isReceiptPaths = (value: Record<string, unknown>): boolean =>
  isAbsolutePathPair(value.roots, ["kit", "consumer"]) &&
  isAbsolutePathPair(value.sources, ["package", "binary"]) &&
  isAbsolutePathPair(value.destinations, ["package", "binary"])

const isReceiptPreflight = (value: Record<string, unknown>): boolean =>
  Array.isArray(value.preflight_destinations) && value.preflight_destinations.length === 2 &&
  value.preflight_destinations[0] === "absent" && value.preflight_destinations[1] === "absent"

const isReceiptLinks = (value: Record<string, unknown>): boolean => {
  if (!Array.isArray(value.links) || value.links.length > 2 || !value.links.every(isLinkIdentity)) return false
  const linkKinds = value.links.map((link) => link.kind)
  return new Set(linkKinds).size === linkKinds.length
}

const isReceiptFlags = (value: Record<string, unknown>): boolean => {
  const created = value.created
  const cleaned = value.cleaned
  if (!isRecord(created) || !hasExactKeys(created, ["package", "binary"]) ||
    typeof created.package !== "boolean" || typeof created.binary !== "boolean") return false
  return isRecord(cleaned) && hasExactKeys(cleaned, ["package", "binary"]) &&
    typeof cleaned.package === "boolean" && typeof cleaned.binary === "boolean"
}

const isReceiptSnapshots = (value: Record<string, unknown>): boolean => {
  const snapshots = value.repository_snapshots
  return isRecord(snapshots) && hasExactKeys(snapshots, ["kit", "consumer"]) &&
    isRepositorySnapshot(snapshots.kit) && isRepositorySnapshot(snapshots.consumer)
}

const isReceiptLedger = (value: Record<string, unknown>): boolean => {
  const ledger = value.command_ledger
  if (!Array.isArray(ledger)) return false
  return ledger.every(isAuditLedgerEntry)
}

const isOwnershipReceipt = (value: unknown): value is OwnershipReceipt => {
  if (!isRecord(value) || !hasExactKeys(value, receiptKeys)) return false
  const validators = [
    isReceiptHeader(value),
    isReceiptDates(value),
    isReceiptPaths(value),
    isReceiptPreflight(value),
    isReceiptLinks(value),
    isReceiptFlags(value),
    isReceiptSnapshots(value),
    isReceiptLedger(value),
  ]
  return validators.every(Boolean)
}

const readOwnershipReceipt = async (path: string): Promise<OwnershipReceipt> => {
  const metadata = await lstat(path)
  assertOwnershipReceiptMetadata(metadata)
  let value: unknown
  try {
    value = JSON.parse(await readFile(path, "utf8"))
  } catch {
    throw new Error("ownership-receipt-invalid")
  }
  if (!isOwnershipReceipt(value)) throw new Error("ownership-receipt-invalid")
  return value
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
  receipt.links.length <= 2 &&
  receipt.links.every((link) => link.kind === "package" || link.kind === "binary")

const receiptMatchesContext = (
  receipt: OwnershipReceipt,
  context: Pick<ProofContext, "kitRoot" | "consumerRoot" | "sources" | "destinations">,
): boolean => receiptMatchesRoots(receipt, context) && receiptMatchesOwnershipContext(receipt, context)

const ownershipMarkerName = ".agent-plugin-kit-local-link-owner.json"

const temporaryRootName = (root: string): boolean =>
  basename(root).startsWith("agent-plugin-kit-local-link-")

const canonicalTemporaryRoot = async (root: string): Promise<string> => {
  const metadata = await lstat(root)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("temporary-proof-root-refused")
  const canonicalRoot = await realpath(root)
  const canonicalTemporaryDirectory = await realpath(tmpdir())
  if (!temporaryRootName(canonicalRoot) || dirname(canonicalRoot) !== canonicalTemporaryDirectory) {
    throw new Error("temporary-proof-root-parent-refused")
  }
  return canonicalRoot
}

const isProofMarker = (value: unknown): value is Readonly<{ proof: typeof proofIdentity; run_id: string; root: string }> =>
  isRecord(value) && hasExactKeys(value, ["proof", "run_id", "root"]) && value.proof === proofIdentity &&
  typeof value.run_id === "string" && validRunId(value.run_id) && isAbsoluteString(value.root)

export const writeTemporaryProofMarker = async (root: string, runId: string): Promise<void> => {
  if (!validRunId(runId)) throw new Error("temporary-proof-run-id-invalid")
  const canonicalRoot = await canonicalTemporaryRoot(root)
  const markerPath = join(canonicalRoot, ownershipMarkerName)
  try {
    await writeFile(markerPath, `${JSON.stringify({ proof: proofIdentity, run_id: runId, root: canonicalRoot })}\n`, {
      flag: "wx",
      mode: 0o600,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("temporary-proof-marker-exists")
    throw error
  }
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

const processDeadlines = {
  "public-process": { deadlineMs: 2_000, hardSettlementDeadlineMs: 3_000 },
  "timeout-probe": { deadlineMs: 100, hardSettlementDeadlineMs: 1_000 },
} as const

type ProcessKind = keyof typeof processDeadlines

type ProcessSettlement = Readonly<{
  capturedStdout: string
  capturedStderr: string
  observedExitCode: number
  timedOut: boolean
  hardSettlementTimedOut: boolean
}>

const observedPublicProcessCommand = (
  command: readonly string[],
  cwd: string,
  allowlistedArgv: readonly string[],
  approvedExecutable: string | undefined,
  networkObserver: NetworkObserver | undefined,
): AuditedCommand | undefined => {
  if (networkObserver === undefined || approvedExecutable === undefined) return undefined
  return {
    kind: "public-process",
    executable: process.execPath,
    argv: ["--no-install", "--preload", networkObserver.preloadPath, approvedExecutable, ...command.slice(1)],
    cwd,
    allowedExecutable: actualExecutable(command[0] ?? ""),
    allowedArgv: allowlistedArgv,
    approvedExecutable,
    approvedPreload: networkObserver.preloadPath,
  }
}

const auditedProcessCommand = (
  command: readonly string[],
  cwd: string,
  kind: ProcessKind,
  allowlistedArgv: readonly string[],
  approvedExecutable: string | undefined,
  networkObserver: NetworkObserver | undefined,
): AuditedCommand => kind === "public-process"
  ? observedPublicProcessCommand(command, cwd, allowlistedArgv, approvedExecutable, networkObserver) ?? {
    kind,
    executable: actualExecutable(command[0] ?? ""),
    argv: command.slice(1),
    cwd,
  }
  : {
    kind,
    executable: actualExecutable(command[0] ?? ""),
    argv: command.slice(1),
    cwd,
  }

const killProcessGroup = (child: ReturnType<typeof Bun.spawn>): void => {
  try {
    process.kill(-child.pid, "SIGKILL")
  } catch {
    try {
      child.kill("SIGKILL")
    } catch {
      // The child may have exited between the deadline and cleanup.
    }
  }
}

const settleBoundedProcess = async (
  child: ReturnType<typeof Bun.spawn>,
  stdout: Promise<string>,
  stderr: Promise<string>,
  deadlineMs: number,
  hardSettlementDeadlineMs: number,
): Promise<ProcessSettlement> => {
  let timedOut = false
  let hardSettlementTimedOut = false
  const deadline = setTimeout(() => {
    timedOut = true
    killProcessGroup(child)
  }, deadlineMs)
  let releaseHardDeadline: (() => void) | undefined
  let hardTimer: ReturnType<typeof setTimeout> | undefined
  const hardDeadline = new Promise<false>((resolveHardDeadline) => {
    releaseHardDeadline = () => resolveHardDeadline(false)
    hardTimer = setTimeout(() => {
      hardSettlementTimedOut = true
      killProcessGroup(child)
      resolveHardDeadline(false)
    }, hardSettlementDeadlineMs)
  })
  const settled = await Promise.race([
    Promise.all([stdout, stderr, child.exited]).then((value) => ({ settled: true as const, value })),
    hardDeadline.then(() => ({ settled: false as const })),
  ])
  clearTimeout(deadline)
  if (hardTimer !== undefined) clearTimeout(hardTimer)
  releaseHardDeadline?.()
  if (!settled.settled) throw new Error("process-settlement-deadline-exceeded")
  const [capturedStdout, capturedStderr, observedExitCode] = settled.value
  return { capturedStdout, capturedStderr, observedExitCode, timedOut, hardSettlementTimedOut }
}

const assertProcessNotRetained = (child: ReturnType<typeof Bun.spawn>): void => {
  let retained = false
  try {
    process.kill(child.pid, 0)
    retained = true
  } catch {
    retained = false
  }
  if (retained) throw new Error("public-process-retained")
}

const descriptorRetentionFor = (kind: ProcessKind, capturedStderr: string): boolean => {
  const descriptorRetainingDescendant = capturedStderr.includes("descriptor-retaining-descendant")
  if (kind === "timeout-probe" && !descriptorRetainingDescendant) {
    throw new Error("descriptor-retaining-descendant-not-observed")
  }
  if (kind !== "timeout-probe" && descriptorRetainingDescendant) {
    throw new Error("unexpected-descriptor-retaining-descendant")
  }
  return descriptorRetainingDescendant
}

const invokeBoundedProcess = async (
  command: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>>,
  ledger: AuditLedgerEntry[],
  kind: ProcessKind = "public-process",
  allowlistedArgv: readonly string[] = command.slice(1),
  approvedExecutable?: string,
  networkObserver?: NetworkObserver,
): Promise<{ observation: ProcessObservation; cleanup: ProcessCleanupReceipt }> => {
  const auditedCommand = auditedProcessCommand(command, cwd, kind, allowlistedArgv, approvedExecutable, networkObserver)
  const executable = auditCommand(auditedCommand, ledger)
  const child = Bun.spawn([executable, ...auditedCommand.argv], {
    cwd,
    detached: true,
    env: minimalEnvironment({
      ...environment,
      ...(networkObserver === undefined ? {} : { AGENT_PLUGIN_KIT_NETWORK_PRELOAD: networkObserver.preloadPath }),
    }),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  const deadline = processDeadlines[kind]
  const settled = await settleBoundedProcess(child, stdout, stderr, deadline.deadlineMs, deadline.hardSettlementDeadlineMs)
  assertProcessNotRetained(child)
  if (networkObserver !== undefined && (await readFile(networkObserver.tracePath, "utf8")) !== "") {
    throw new Error("network-attempt-detected")
  }
  const descriptorRetainingDescendant = descriptorRetentionFor(kind, settled.capturedStderr)
  return {
    observation: {
      stdout: settled.capturedStdout,
      stderr: settled.capturedStderr,
      exitCode: settled.timedOut ? 124 : settled.observedExitCode,
    },
    cleanup: {
      deadlineMs: deadline.deadlineMs,
      hardSettlementDeadlineMs: deadline.hardSettlementDeadlineMs,
      timedOut: settled.timedOut,
      hardSettlementTimedOut: settled.hardSettlementTimedOut,
      exitObserved: true,
      descriptorClosure: "closed",
      descriptorRetainingDescendant,
      cleanup: settled.timedOut ? "process-group-killed" : "natural",
      retainedResources: 0,
    },
  }
}

const parsedLine = (line: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(line)
  if (!isRecord(value)) throw new Error("process-record-invalid")
  return value
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
  if (!isRecord(action)) throw new Error("diagnostic-next-action-invalid")
  return action
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
    redactionControlSecret,
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
): PublicObservabilityOracle => {
  const allRecords = [...stdout, ...stderr]
  const noExtraRecords = allRecords.every((record) => {
    const recordType = record.record_type
    return recordType === undefined || recordType === "diagnostic" || recordType === "error_envelope"
  })
  if (!noExtraRecords) throw new Error("public-process-record-type-drift")
  const safeContext = !JSON.stringify(allRecords).includes(redactionControlSecret)
  if (!safeContext) throw new Error("public-process-redaction-drift")
  const nestedRecord = (record: Record<string, unknown>, key: string): unknown => {
    const direct = record[key]
    if (direct !== undefined) return direct
    const data = record.data
    if (isRecord(data) && data[key] !== undefined) return data[key]
    const error = record.error
    if (isRecord(error) && key === "station_id") return error.stationId
    return undefined
  }
  const valuesFor = (key: string): string[] => allRecords.flatMap((record) => {
    const value = nestedRecord(record, key)
    return typeof value === "string" ? [value] : []
  })
  const nextActionIds = allRecords.flatMap((record) => {
    const direct = record.next_action
    if (isRecord(direct) && typeof direct.id === "string") return [direct.id]
    const data = record.data
    if (isRecord(data) && isRecord(data.next_action) && typeof data.next_action.id === "string") {
      return [data.next_action.id]
    }
    const error = record.error
    if (isRecord(error) && Array.isArray(error.agentActions)) {
      return error.agentActions.flatMap((entry) => isRecord(entry) && typeof entry.nextActionId === "string" ? [entry.nextActionId] : [])
    }
    return []
  })
  return {
    runId: scenario.expected.runId,
    exitCode: observation.exitCode,
    stdoutRecordCount: stdout.length,
    stderrRecordCount: stderr.length,
    stdoutRecordTypes: stdout.map((record) => typeof record.record_type === "string" ? record.record_type : "envelope"),
    stderrRecordTypes: stderr.map((record) => typeof record.record_type === "string" ? record.record_type : "diagnostic"),
    stdoutStatus,
    stderrSequences,
    stderrEvents: stderr.map((record) => String(record.event ?? record.record_type)),
    stationIds: valuesFor("station_id"),
    resultCodes: valuesFor("result_code"),
    nextActionIds,
    primaryEnvelopeChannel,
    eventSequenceGap,
    noExtraRecords: true,
    safeContext: true,
    redacted: true,
  }
}

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
): PublicObservabilityOracle => {
  const eventRefusal = assertRefusalChannels(scenario, stdout)
  assertNoRedactionLeak(scenario, [...stdout, ...stderr])
  const { event, usage } = assertRefusalDiagnosticRecords(scenario, stderr)
  const primaryEnvelopeChannel = assertRefusalPrimaryEnvelope(scenario, stderr, usage)
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
  return validateRefusalDiagnosticObservation(scenario, observation, stdout, stderr)
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
  networkObserver: NetworkObserver
  auditLedger: AuditLedgerEntry[]
}>

const publicBinaryManifestEntry = async (kitRoot: string): Promise<string> => {
  const rootManifest = await readJsonObject(join(kitRoot, "package.json"))
  const bin = rootManifest.bin
  if (rootManifest.name !== "agent-plugin-kit" || !isRecord(bin)) {
    throw new Error("package-identity-invalid")
  }
  const binEntries = Object.entries(bin)
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

const existingDirectory = async (path: string, failure: string): Promise<string> => {
  const metadata = await lstat(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700) throw new Error(failure)
  return realpath(path)
}

const proofOwnedDirectory = async (path: string): Promise<void> => {
  try {
    const metadata = await lstat(path)
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700) {
      throw new Error("proof-directory-unsafe")
    }
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  await mkdir(path, { mode: 0o700 })
  await chmod(path, 0o700)
}

const createNetworkObserver = async (receiptDirectory: string): Promise<NetworkObserver> => {
  const preloadPath = join(receiptDirectory, "network-observer.ts")
  const tracePath = join(receiptDirectory, "network-attempts.jsonl")
  const traceLiteral = JSON.stringify(tracePath)
  await writeFile(tracePath, "", { mode: 0o600 })
  await writeFile(preloadPath, [
    'import { appendFileSync } from "node:fs"',
    'import { Socket } from "node:net"',
    `const tracePath = ${traceLiteral}`,
    'const refuse = (kind) => { appendFileSync(tracePath, JSON.stringify({ kind }) + "\\n"); throw new Error("network-attempt-blocked") }',
    'globalThis.fetch = (..._args) => refuse("fetch")',
    'globalThis.WebSocket = class { constructor() { refuse("websocket") } }',
    'Bun.connect = (..._args) => refuse("bun-connect")',
    'Socket.prototype.connect = function (..._args) { return refuse("socket-connect") }',
    "",
  ].join("\n"), { mode: 0o600 })
  return { preloadPath, tracePath }
}

const removeNetworkObserver = async (observer: NetworkObserver): Promise<void> => {
  for (const path of [observer.preloadPath, observer.tracePath]) {
    try {
      await unlink(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
}

const prepareProofContext = async (
  options: LocalLinkProofOptions,
  now: Date,
): Promise<ProofContext> => {
  if (!validRunId(options.runId)) throw new Error("run-id-invalid")
  if (!isAbsolute(options.stateRoot)) throw new Error("state-root-must-be-absolute")
  assertApprovedScenarioCatalog(options.scenarios)
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
  const stateRoot = await existingDirectory(options.stateRoot, "state-root-unsafe")
  const proofRoot = join(stateRoot, "my-second-brain-vault/agent-plugin-kit/local-link-proof")
  if (!contained(stateRoot, proofRoot)) throw new Error("proof-root-escaped")
  const receiptDirectory = join(proofRoot, options.runId)
  await proofOwnedDirectory(join(stateRoot, "my-second-brain-vault"))
  await proofOwnedDirectory(join(stateRoot, "my-second-brain-vault/agent-plugin-kit"))
  await proofOwnedDirectory(proofRoot)
  await pruneExpiredReceipts(proofRoot, now)
  await mkdir(receiptDirectory, { mode: 0o700 })
  await chmod(receiptDirectory, 0o700)
  const receiptPath = join(receiptDirectory, "ownership.json")
  const networkObserver = await createNetworkObserver(receiptDirectory)
  const sources = { package: kitRoot, binary: binary.source }
  const destinations = { package: packageDestination, binary: binaryDestination }
  return {
    kitRoot,
    consumerRoot,
    binary,
    sources,
    destinations,
    before,
    receiptDirectory,
    receiptPath,
    networkObserver,
    auditLedger,
  }
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
  rollbackPendingLinks: Set<"package" | "binary">
  rolledBackLinks: Set<"package" | "binary">
}

type ReceiptUpdater = (update: Partial<OwnershipReceipt>) => Promise<void>

const createLinks = async (
  context: ProofContext,
  state: ProofState,
  updateReceipt: ReceiptUpdater,
  fault: LocalLinkFault | undefined,
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
    state.rollbackPendingLinks.add(kind)
    const expectedCanonicalTarget = await realpath(source)
    if (identity.rawTarget !== source || identity.canonicalTarget !== expectedCanonicalTarget) {
      throw new Error("created-link-identity-invalid")
    }
    await updateReceipt({
      links: [...state.ownedLinks.values()],
      created: { ...state.receipt.created, [kind]: true },
      command_ledger: [...state.actionLedger],
    })
    state.rollbackPendingLinks.delete(kind)
    if (fault === "partial-link" && kind === "package") throw new Error("partial-link-failure")
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
  await assertOwnerLocalLogTape(context.kitRoot)
}

type PostLinkFaultHandler = (context: ProofContext, state: ProofState) => Promise<void>

const retargetLink = async (context: ProofContext): Promise<void> => {
  await unlink(context.destinations.binary)
  await symlink(context.sources.package, context.destinations.binary)
}

const replacePackageIdentity = async (context: ProofContext): Promise<void> => {
  await unlink(context.destinations.package)
  await symlink(context.sources.package, context.destinations.package)
}

const removeExecutableIdentity = async (context: ProofContext): Promise<void> => {
  const source = await readFile(context.sources.binary, "utf8")
  await writeFile(context.sources.binary, source.replace(/^#!\/usr\/bin\/env bun/u, "#!/usr/bin/env sh"), { mode: 0o644 })
  await chmod(context.sources.binary, 0o644)
}

const appendRepositoryDrift = async (context: ProofContext): Promise<void> => {
  await appendFile(context.sources.binary, "\n// local-link repository drift negative control\n")
}

const appendManifestLockDrift = async (context: ProofContext): Promise<void> => {
  await appendFile(join(context.kitRoot, "package.json"), "\n")
  await appendFile(join(context.kitRoot, "bun.lock"), "\n# local-link manifest-lock drift negative control\n")
}

const stageIndexDrift = async (context: ProofContext, state: ProofState): Promise<void> => {
  await appendFile(context.sources.binary, "\n// local-link staged-index drift negative control\n")
  auditedSpawnSync({
    kind: "fault",
    executable: "git",
    argv: [...exactGitFaultArgv.stagedIndex],
    cwd: context.kitRoot,
  }, state.auditLedger)
}

const moveCommitRef = async (context: ProofContext, state: ProofState): Promise<void> => {
  auditedSpawnSync({
    kind: "fault",
    executable: "git",
    argv: [...exactGitFaultArgv.commitRef],
    cwd: context.consumerRoot,
  }, state.auditLedger)
}

const removeDestinationParent = async (context: ProofContext): Promise<void> => {
  await rm(dirname(context.destinations.package), { recursive: true, force: true })
}

const appendNetworkPrimitive = async (context: ProofContext): Promise<void> => {
  await appendFile(
    join(context.kitRoot, "src/adapters/maintenance-command-facade/implementation/maintenance-event-adapter.ts"),
    networkPrimitiveMutation,
  )
}

const substituteReceiptAndPackageLink = async (context: ProofContext): Promise<void> => {
  await unlink(context.destinations.package)
  await symlink(context.sources.package, context.destinations.package)
  const replacement = await linkIdentity("package", context.destinations.package)
  const receipt = await readOwnershipReceipt(context.receiptPath)
  await writeReceipt(context.receiptPath, {
    ...receipt,
    links: receipt.links.map((link) => link.kind === "package" ? replacement : link),
  })
}

const reorderDiagnosticSequence = async (context: ProofContext): Promise<void> => {
  const facadePath = join(context.kitRoot, "src/adapters/maintenance-command-facade/implementation/maintenance-command-facade.ts")
  const source = await readFile(facadePath, "utf8")
  const needle = "    sequence += 1\n"
  if (source.split(needle).length !== 2) throw new Error("diagnostic-order-control-unavailable")
  await writeFile(facadePath, source.replace(needle, "    sequence += 2\n"))
}

const bypassDiagnosticRedaction = async (context: ProofContext): Promise<void> => {
  const adapterPath = join(context.kitRoot, "src/adapters/maintenance-command-facade/implementation/logtape-diagnostic-adapter.ts")
  const source = await readFile(adapterPath, "utf8")
  const sinkNeedle = "const sink = redactByField(jsonlSink, {\n    fieldPatterns: diagnosticSensitiveFieldPatterns,\n    action: () => redactedDiagnosticValue,\n  })"
  const recordNeedle = "properties: { [logTapeRecordProperty]: record },"
  if (!source.includes(sinkNeedle) || !source.includes(recordNeedle)) {
    throw new Error("redaction-bypass-control-unavailable")
  }
  const bypassed = source
    .replace(sinkNeedle, "const sink = jsonlSink")
    .replace(recordNeedle, `properties: { [logTapeRecordProperty]: { ...record, api_key: "${redactionControlSecret}" } },`)
  await writeFile(adapterPath, bypassed)
}

const removeOwnerLocalDependency = async (context: ProofContext): Promise<void> => {
  await rm(join(context.kitRoot, "src/adapters/maintenance-command-facade/node_modules/@logtape/redaction"), {
    recursive: true,
    force: true,
  })
}

const addReceiptSchemaField = async (context: ProofContext): Promise<void> => {
  const receipt = await readOwnershipReceipt(context.receiptPath)
  await writeFile(context.receiptPath, `${JSON.stringify({ ...receipt, unexpected: true })}\n`, { mode: 0o600 })
}

const mistypeReceiptSchemaVersion = async (context: ProofContext): Promise<void> => {
  const receipt = await readOwnershipReceipt(context.receiptPath)
  await writeFile(context.receiptPath, `${JSON.stringify({ ...receipt, schema_version: "1" })}\n`, { mode: 0o600 })
}

const tamperReceiptCreatedState = async (context: ProofContext): Promise<void> => {
  const receipt = await readOwnershipReceipt(context.receiptPath)
  await writeFile(context.receiptPath, `${JSON.stringify({
    ...receipt,
    created: { ...receipt.created, package: false },
  })}\n`, { mode: 0o600 })
}

const postLinkFaultHandlers: Partial<Record<LocalLinkFault, PostLinkFaultHandler>> = {
  "retargeted-link": (context) => retargetLink(context),
  "second-identity": (context) => replacePackageIdentity(context),
  "mode-shebang-loss": (context) => removeExecutableIdentity(context),
  "repository-drift": (context) => appendRepositoryDrift(context),
  "manifest-lock-drift": (context) => appendManifestLockDrift(context),
  "staged-index-drift": stageIndexDrift,
  "commit-ref-drift": moveCommitRef,
  "parent-deletion": (context) => removeDestinationParent(context),
  "network-primitive": (context) => appendNetworkPrimitive(context),
  "diagnostic-order": (context) => reorderDiagnosticSequence(context),
  "redaction-bypass": (context) => bypassDiagnosticRedaction(context),
  "missing-owner-local-dependency": (context) => removeOwnerLocalDependency(context),
  "receipt-schema": (context) => addReceiptSchemaField(context),
  "receipt-mistyped": (context) => mistypeReceiptSchemaVersion(context),
  "receipt-tamper": (context) => tamperReceiptCreatedState(context),
  "receipt-link-substitution": (context) => substituteReceiptAndPackageLink(context),
}

const applyPostLinkFault = async (
  fault: LocalLinkFault,
  context: ProofContext,
  state: ProofState,
): Promise<void> => {
  const handler = postLinkFaultHandlers[fault]
  if (handler !== undefined) await handler(context, state)
}

const forbiddenCommandNegativeControl = async (
  context: ProofContext,
  state: ProofState,
): Promise<true> => {
  const scenario = approvedScenarioCatalog[0]
  if (scenario === undefined) throw new Error("public-process-scenario-catalog-invalid")
  try {
    await invokeBoundedProcess(
      ["/bin/echo", ...scenario.argv],
      context.consumerRoot,
      scenario.environment ?? {},
      state.auditLedger,
      "public-process",
      scenario.argv,
      context.destinations.binary,
      context.networkObserver,
    )
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
      context.destinations.binary,
      context.networkObserver,
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

const assertReceiptContext = (
  receipt: OwnershipReceipt,
  context: ProofContext,
  state: ProofState,
): void => {
  if (!receiptMatchesContext(receipt, context) || receipt.run_id !== state.receipt.run_id) {
    throw new Error("ownership-receipt-context-drifted")
  }
}

const cleanupReceiptLink = async (
  context: ProofContext,
  state: ProofState,
  kind: "package" | "binary",
): Promise<LinkIdentity | undefined> => {
  const durable = await readOwnershipReceipt(context.receiptPath)
  if (!durable.created[kind] && !state.ownedLinks.has(kind)) return undefined
  assertReceiptContext(durable, context, state)
  if (!durable.created[kind] || durable.cleaned[kind]) throw new Error(`ownership-receipt-state-drifted:${kind}`)
  const durableLink = receiptLink(durable, kind)
  const originallyOwned = state.ownedLinks.get(kind)
  if (originallyOwned === undefined || !sameLink(durableLink, originallyOwned)) {
    throw new Error(`ownership-receipt-link-drifted:${kind}`)
  }
  return durableLink
}

const recordCleanedLink = async (
  context: ProofContext,
  state: ProofState,
  kind: "package" | "binary",
): Promise<void> => {
  const currentReceipt = await readOwnershipReceipt(context.receiptPath)
  assertReceiptContext(currentReceipt, context, state)
  const nextReceipt = {
    ...currentReceipt,
    cleaned: { ...currentReceipt.cleaned, [kind]: true },
    command_ledger: [...state.actionLedger],
  }
  await writeReceipt(context.receiptPath, nextReceipt)
  state.receipt = nextReceipt
}

const cleanupOwnedLink = async (
  context: ProofContext,
  state: ProofState,
  kind: "package" | "binary",
  destination: string,
  ledgerEntry: string,
): Promise<void> => {
  if (state.rolledBackLinks.has(kind) && await pathState(destination) === "absent") return
  const owned = await cleanupReceiptLink(context, state, kind)
  if (owned === undefined) return
  const current = await linkIdentity(kind, destination)
  if (!sameLink(current, owned)) throw new Error(`owned-link-drifted:${kind}`)
  await unlink(destination)
  state.ledger.push(ledgerEntry)
  state.auditLedger.push({ operation: "unlink", kind })
  state.actionLedger.push({ operation: "unlink", kind })
  await recordCleanedLink(context, state, kind)
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

type DestinationState = Readonly<{
  packageAbsent: boolean
  binaryAbsent: boolean
  packageParentPresent: boolean
  binaryParentPresent: boolean
}>

const destinationState = async (context: ProofContext): Promise<DestinationState> => ({
  packageAbsent: await pathState(context.destinations.package) === "absent",
  binaryAbsent: await pathState(context.destinations.binary) === "absent",
  packageParentPresent: await pathState(dirname(context.destinations.package)) === "present",
  binaryParentPresent: await pathState(dirname(context.destinations.binary)) === "present",
})

const rollbackIdentityCheckedLink = async (
  state: ProofState,
  kind: "package" | "binary",
  destination: string,
): Promise<void> => {
  if (state.rolledBackLinks.has(kind)) return
  const expected = state.ownedLinks.get(kind)
  if (expected === undefined) return
  if (await pathState(destination) === "absent") {
    state.rolledBackLinks.add(kind)
    return
  }
  const current = await linkIdentity(kind, destination)
  if (!sameLink(current, expected)) throw new Error(`owned-link-drifted:${kind}`)
  await unlink(destination)
  state.ledger.push(`rollback:unlink:${kind}`)
  state.auditLedger.push({ operation: "unlink", kind })
  state.actionLedger.push({ operation: "unlink", kind })
  state.rolledBackLinks.add(kind)
}

const rollbackIdentityCheckedLinks = async (
  context: ProofContext,
  state: ProofState,
  kinds: readonly ("package" | "binary")[],
): Promise<unknown[]> => {
  const failures: unknown[] = []
  for (const kind of kinds) {
    const destination = context.destinations[kind]
    try {
      await rollbackIdentityCheckedLink(state, kind, destination)
    } catch (error) {
      failures.push(error)
    }
  }
  return failures
}

const failureReceiptCleanupReady = async (context: ProofContext): Promise<boolean> => {
  const paths = await destinationState(context)
  return paths.packageAbsent && paths.binaryAbsent && paths.packageParentPresent && paths.binaryParentPresent
}

const assertFailureReceiptOwnership = async (
  context: ProofContext,
  state: ProofState,
): Promise<void> => {
  const durable = await readOwnershipReceipt(context.receiptPath)
  assertReceiptContext(durable, context, state)
}

const removeReceiptDirectory = async (receiptDirectory: string): Promise<void> => {
  try {
    await rmdir(receiptDirectory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ENOTEMPTY") {
      throw error
    }
  }
}

const removeFailureReceipt = async (
  context: ProofContext,
  state: ProofState,
): Promise<boolean> => {
  if (!await failureReceiptCleanupReady(context)) return false
  if (await pathState(context.receiptPath) === "absent") return true
  await assertFailureReceiptOwnership(context, state)
  await unlink(context.receiptPath)
  await removeReceiptDirectory(context.receiptDirectory)
  return true
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
  const paths = await destinationState(context)
  if (!paths.packageAbsent || !paths.binaryAbsent) throw new Error("owned-link-remained")
  if (!paths.packageParentPresent || !paths.binaryParentPresent) throw new Error("destination-parent-removed")
  return true
}

const assertRepositoriesUnchanged = async (context: ProofContext): Promise<void> => {
  const after = {
    kit: await repositorySnapshot(context.kitRoot, context.auditLedger),
    consumer: await repositorySnapshot(context.consumerRoot, context.auditLedger),
  }
  if (!sameSnapshot(context.before.kit, after.kit) || !sameSnapshot(context.before.consumer, after.consumer)) {
    throw new Error("repository-state-drifted")
  }
}

const assertDestinationParentsPresent = async (context: ProofContext): Promise<void> => {
  const packageParent = dirname(context.destinations.package)
  const binaryParent = dirname(context.destinations.binary)
  if (await pathState(packageParent) !== "present" || await pathState(binaryParent) !== "present") {
    throw new Error("destination-parent-removed")
  }
  await assertDirectory(context.consumerRoot, packageParent)
  await assertDirectory(context.consumerRoot, binaryParent)
}

const postLinkNoImmediateAssertion = new Set<LocalLinkFault>(["network-primitive", "receipt-link-substitution"])
const persistedReceiptFaults = new Set<LocalLinkFault>(["receipt-schema", "receipt-mistyped"])
const repositoryStateFaults = new Set<LocalLinkFault>([
  "repository-drift",
  "manifest-lock-drift",
  "staged-index-drift",
  "commit-ref-drift",
])

const assertPostLinkFault = async (
  fault: LocalLinkFault,
  context: ProofContext,
  state: ProofState,
): Promise<void> => {
  if (fault === "parent-deletion") {
    await assertDestinationParentsPresent(context)
    return
  }
  if (postLinkNoImmediateAssertion.has(fault)) return
  if (persistedReceiptFaults.has(fault)) {
    await readOwnershipReceipt(context.receiptPath)
    return
  }
  if (repositoryStateFaults.has(fault)) {
    await assertRepositoriesUnchanged(context)
    return
  }
  await assertLinkedState(context, state)
}

const createProofState = (
  options: LocalLinkProofOptions,
  context: ProofContext,
  now: Date,
): ProofState => ({
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
  rollbackPendingLinks: new Set(),
  rolledBackLinks: new Set(),
})

const createReceiptUpdater = (
  options: LocalLinkProofOptions,
  context: ProofContext,
  state: ProofState,
): ReceiptUpdater => async (update) => {
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
  const nextReceipt = { ...state.receipt, ...update }
  const writerFault = options.fault === "receipt-write-failure" && update.created?.package === true
  const previousReceiptBytes = writerFault ? await readFile(context.receiptPath, "utf8") : undefined
  await writeReceipt(context.receiptPath, nextReceipt, {
    failAfterTemporaryWrite: writerFault,
    ...(previousReceiptBytes === undefined ? {} : { previousReceiptBytes }),
  })
  state.receipt = nextReceipt
}

const applyOptionalFault = async (
  options: LocalLinkProofOptions,
  context: ProofContext,
  state: ProofState,
): Promise<void> => {
  if (options.fault === undefined || options.fault === "receipt-write-failure" ||
    options.fault === "receipt-link-substitution") return
  await applyPostLinkFault(options.fault, context, state)
  await assertPostLinkFault(options.fault, context, state)
}

type PrimaryProofRun = Readonly<{
  primaryFailure: unknown
  timeoutDescriptorControl: ProcessCleanupReceipt | undefined
  forbiddenCommandRefused: true
  zeroNetworkAttempts: true
}>

const assertNetworkObserverClear = async (observer: NetworkObserver): Promise<true> => {
  if ((await readFile(observer.tracePath, "utf8")) !== "") throw new Error("network-attempt-detected")
  return true
}

const executePrimaryProofRun = async (
  options: LocalLinkProofOptions,
  context: ProofContext,
  state: ProofState,
  updateReceipt: ReceiptUpdater,
): Promise<PrimaryProofRun> => {
  let primaryFailure: unknown
  let timeoutDescriptorControl: ProcessCleanupReceipt | undefined
  let forbiddenCommandRefused: true = true
  let zeroNetworkAttempts: true = true
  try {
    timeoutDescriptorControl = (await invokeBoundedProcess(
      [process.execPath, ...timeoutProbeArgv],
      context.kitRoot,
      {},
      state.auditLedger,
      "timeout-probe",
    )).cleanup
    await createLinks(context, state, updateReceipt, options.fault)
    await applyOptionalFault(options, context, state)
    forbiddenCommandRefused = await forbiddenCommandNegativeControl(context, state)
    await executeScenarios(options, context, state, updateReceipt)
    if (options.fault === "receipt-link-substitution") {
      await substituteReceiptAndPackageLink(context)
    }
    zeroNetworkAttempts = await assertNetworkObserverClear(context.networkObserver)
  } catch (error) {
    primaryFailure = error
  }
  return { primaryFailure, timeoutDescriptorControl, forbiddenCommandRefused, zeroNetworkAttempts }
}

const rollbackKindsFor = (state: ProofState): ("package" | "binary")[] =>
  (["binary", "package"] as const).filter((kind) => state.rollbackPendingLinks.has(kind))

type CleanupProofRun = Readonly<{
  allCleanupFailures: unknown[]
  receiptFailure: unknown
}>

const tryRemoveFailureReceipt = async (
  context: ProofContext,
  state: ProofState,
): Promise<unknown> => {
  try {
    await removeFailureReceipt(context, state)
    return undefined
  } catch (error) {
    return error
  }
}

const cleanupFailedProofRun = async (
  context: ProofContext,
  state: ProofState,
  primaryFailure: unknown,
): Promise<CleanupProofRun> => {
  const rollbackFailures = await rollbackIdentityCheckedLinks(context, state, rollbackKindsFor(state))
  const cleanupFailures = await cleanupLinks(context, state)
  let observerFailure: unknown
  try {
    await removeNetworkObserver(context.networkObserver)
  } catch (error) {
    observerFailure = error
  }
  const allCleanupFailures = [...rollbackFailures, ...cleanupFailures, ...(observerFailure === undefined ? [] : [observerFailure])]
  const receiptFailure = primaryFailure !== undefined || allCleanupFailures.length > 0
    ? await tryRemoveFailureReceipt(context, state)
    : undefined
  return { allCleanupFailures, receiptFailure }
}

type RestorationProof = Readonly<{
  digestsEqual: boolean
  restorationFailure: unknown
}>

const proveRunRestoration = async (context: ProofContext): Promise<RestorationProof> => {
  try {
    return { digestsEqual: await proveRestoration(context), restorationFailure: undefined }
  } catch (error) {
    return { digestsEqual: false, restorationFailure: error }
  }
}

const throwProofFailures = (
  primaryFailure: unknown,
  allCleanupFailures: readonly unknown[],
  receiptFailure: unknown,
  restorationFailure: unknown,
): void => {
  if (primaryFailure !== undefined) throw primaryFailure
  if (allCleanupFailures[0] !== undefined) throw allCleanupFailures[0]
  if (receiptFailure !== undefined) throw receiptFailure
  if (restorationFailure !== undefined) throw restorationFailure
}

export async function runLocalLinkContractProof(options: LocalLinkProofOptions): Promise<LocalLinkProofResult> {
  const now = (options.now ?? (() => new Date()))()
  const context = await prepareProofContext(options, now)
  const state = createProofState(options, context, now)
  const updateReceipt = createReceiptUpdater(options, context, state)
  await writeReceipt(context.receiptPath, state.receipt)

  const primary = await executePrimaryProofRun(options, context, state, updateReceipt)
  const cleanup = await cleanupFailedProofRun(context, state, primary.primaryFailure)
  const restoration = await proveRunRestoration(context)
  throwProofFailures(
    primary.primaryFailure,
    cleanup.allCleanupFailures,
    cleanup.receiptFailure,
    restoration.restorationFailure,
  )

  if (primary.timeoutDescriptorControl === undefined) throw new Error("timeout-control-missing")
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
    forbiddenCommandRefused: primary.forbiddenCommandRefused,
    timeoutDescriptorControl: primary.timeoutDescriptorControl,
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
    digestsEqual: restoration.digestsEqual,
    zeroNetworkAttempts: primary.zeroNetworkAttempts,
    gitStateEqual: true,
  }
}

export async function removeTemporaryProofRoot(root: string, runId: string): Promise<void> {
  if (!validRunId(runId)) throw new Error("temporary-proof-run-id-invalid")
  const canonicalRoot = await canonicalTemporaryRoot(root)
  const markerPath = join(canonicalRoot, ownershipMarkerName)
  const markerMetadata = await lstat(markerPath)
  if (!markerMetadata.isFile() || markerMetadata.isSymbolicLink() || (markerMetadata.mode & 0o777) !== 0o600) {
    throw new Error("temporary-proof-marker-invalid")
  }
  let markerValue: unknown
  try {
    markerValue = JSON.parse(await readFile(markerPath, "utf8"))
  } catch {
    throw new Error("temporary-proof-marker-invalid")
  }
  if (!isProofMarker(markerValue) || markerValue.run_id !== runId || markerValue.root !== canonicalRoot) {
    throw new Error("temporary-proof-marker-mismatch")
  }
  await rm(canonicalRoot, { recursive: true, force: true })
}
