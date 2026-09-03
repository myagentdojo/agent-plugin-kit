import { createHash } from "node:crypto"
import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { join, resolve, sep } from "node:path"
import type {
  PayloadArtifactRecord,
  PayloadFailureCode,
  PayloadPackageRequest,
  PayloadProductionRequest,
  PayloadProductionResult,
  PayloadPublicationState,
  PayloadRefusalCode,
  PluginPayloadProduction,
  PreparedFileDeclaration,
  PreparedProjectionDeclaration,
} from "../interface"

/** Owner-local proof seams. Production composition uses the defaults only. */
export type PayloadCompressor = {
  command: readonly string[]
  deadlineMs: number
}

export type PayloadPublicationPoint = "staged" | "archive-published" | "checksums-published"

export type PluginPayloadProductionOptions = {
  compressor?: PayloadCompressor
  /** Test-only interruption seam invoked at each named publication point. */
  interrupt?: (point: PayloadPublicationPoint) => void
}

const defaultPayloadCompressor: PayloadCompressor = {
  command: ["gzip", "-n", "-9", "-c"],
  deadlineMs: 30_000,
}

const PLUGIN_DIRECTORY = "plugin"
const OUTPUT_DIRECTORY = "dist"
const USTAR_BLOCK_BYTES = 512
const checksumEvidence =
  "Checksum metadata is integrity evidence for these archive bytes, not independent publisher or builder authenticity."

type Refused = Extract<PayloadProductionResult, { kind: "refused" }>
type Failed = Extract<PayloadProductionResult, { kind: "failed" }>
type Packaged = Extract<PayloadProductionResult, { kind: "packaged" }>

class PayloadRefusal extends Error {
  constructor(readonly code: PayloadRefusalCode, readonly detail: string) {
    super(detail)
  }
}

class PayloadFailure extends Error {
  constructor(
    readonly code: PayloadFailureCode,
    readonly publication: PayloadPublicationState,
    readonly transient: boolean,
    readonly artifacts: Failed["artifacts"],
    detail: string,
  ) {
    super(detail)
  }
}

const refusalActions: Readonly<Record<PayloadRefusalCode, string>> = {
  "mode-deferred": "Use payload:package; check and materialize are not implemented in this stage.",
  "repository-root-invalid": "Name an existing Plugin Repository directory as repositoryRoot.",
  "payload-root-invalid": "Prepare a regular plugin/ directory under the repository root.",
  "source-identity-mismatch": "Regenerate the preparation for the requested plugin Source Identity.",
  "release-invalid": "Supply a safe release name, version, and the matching v<version> tag.",
  "declaration-invalid": "Regenerate the preparation declaration with unique, sorted, safe paths and required projections.",
  "binding-mismatch": "Regenerate the preparation binding from the current declaration.",
  "payload-digest-mismatch": "Regenerate the preparation payload digest from the current plugin/ files.",
  "unsafe-entry": "Remove the unsafe plugin/ entry and regenerate the preparation.",
  "undeclared-file": "Regenerate the preparation after removing or declaring the file.",
  "declared-file-missing": "Restore the declared file or regenerate the preparation.",
  "file-mismatch": "Regenerate the preparation from the current plugin/ bytes and modes.",
  "projection-mismatch": "Regenerate the projection declarations from the current source inputs.",
  "output-conflict": "Inspect dist/ and move the conflicting artifact aside before repeating payload:package.",
}

const failureActions: Readonly<Record<PayloadFailureCode, string>> = {
  "staging-failed": "Inspect dist/ permissions and free space, then repeat payload:package.",
  "compressor-failed": "Inspect the host gzip, then repeat payload:package.",
  "compressor-deadline": "Inspect the host gzip and load, then repeat payload:package.",
  "publication-interrupted": "Repeat payload:package to complete the checksum publication for the published archive.",
  "publication-unobservable": "Inspect dist/ before repeating payload:package.",
}

const refused = (code: PayloadRefusalCode, detail: string): Refused => ({
  kind: "refused",
  code,
  detail,
  nextAction: refusalActions[code],
})

const failed = (failure: PayloadFailure): Failed => ({
  kind: "failed",
  code: failure.code,
  publication: failure.publication,
  transient: failure.transient,
  artifacts: failure.artifacts,
  nextAction: failureActions[failure.code],
})

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")
const prefixed = (hex: string): `sha256:${string}` => `sha256:${hex}`

const safeNamePattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/
const safeVersionPattern = /^[0-9A-Za-z](?:[0-9A-Za-z.+-]*[0-9A-Za-z])?$/

const isSafeRelativePath = (path: string): boolean =>
  path.length > 0 &&
  !path.includes("\0") &&
  !path.startsWith("/") &&
  path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")

const strictlySortedBy = <T>(items: readonly T[], compare: (left: T, right: T) => number): boolean =>
  items.every((item, index) => index === 0 || compare(items[index - 1] as T, item) < 0)

const compareProjections = (left: PreparedProjectionDeclaration, right: PreparedProjectionDeclaration): number =>
  compareCodeUnits(left.role, right.role) || compareCodeUnits(left.path, right.path)

const bindingDigest = (request: PayloadPackageRequest): string => {
  const { prepared, release } = request
  const tuple = [
    1,
    prepared.sourceIdentity.repository.origin,
    prepared.sourceIdentity.commit,
    release.name,
    release.version,
    release.tag,
    prepared.files.map((file) => [file.path, file.bytes, file.sha256, file.executable]),
    prepared.projections.map((projection) => [projection.role, projection.path, projection.bytes, projection.sha256]),
    prepared.payloadSha256,
  ]
  return sha256Hex(new TextEncoder().encode(JSON.stringify(tuple)))
}

function validateSourceAndRelease(request: PayloadPackageRequest): void {
  const { sourceIdentity, release, prepared } = request
  if (
    sourceIdentity.repository.origin !== prepared.sourceIdentity.repository.origin ||
    sourceIdentity.commit !== prepared.sourceIdentity.commit
  ) {
    throw new PayloadRefusal("source-identity-mismatch", "request sourceIdentity differs from prepared.sourceIdentity")
  }
  if (!safeNamePattern.test(release.name)) throw new PayloadRefusal("release-invalid", "release.name is not a safe package name")
  if (!safeVersionPattern.test(release.version)) throw new PayloadRefusal("release-invalid", "release.version is not a safe version")
  if (release.tag !== `v${release.version}`) throw new PayloadRefusal("release-invalid", "release.tag must be v<version>")
}

function validateDeclaredPaths(request: PayloadPackageRequest): void {
  const { prepared } = request
  for (const file of prepared.files) {
    if (!isSafeRelativePath(file.path)) throw new PayloadRefusal("declaration-invalid", `unsafe declared file path: ${JSON.stringify(file.path)}`)
  }
  if (!strictlySortedBy(prepared.files, (left, right) => compareCodeUnits(left.path, right.path))) {
    throw new PayloadRefusal("declaration-invalid", "declared files are not unique in code-unit order")
  }
  for (const projection of prepared.projections) {
    if (!isSafeRelativePath(projection.path)) throw new PayloadRefusal("declaration-invalid", `unsafe projection path: ${JSON.stringify(projection.path)}`)
  }
  if (!strictlySortedBy(prepared.projections, compareProjections)) {
    throw new PayloadRefusal("declaration-invalid", "projections are not unique in role then path order")
  }
}

function validateRequiredProjections(request: PayloadPackageRequest): void {
  for (const role of ["runtime-lock", "bundle-inventory"] as const) {
    if (request.prepared.projections.filter((projection) => projection.role === role).length !== 1) {
      throw new PayloadRefusal("declaration-invalid", `exactly one ${role} projection is required`)
    }
  }
}

function validateStatics(request: PayloadPackageRequest): void {
  validateSourceAndRelease(request)
  validateDeclaredPaths(request)
  validateRequiredProjections(request)
  if (prefixed(bindingDigest(request)) !== request.prepared.bindingSha256) {
    throw new PayloadRefusal("binding-mismatch", "prepared.bindingSha256 does not bind this declaration")
  }
}

type Roots = { root: string; pluginRoot: string; distRoot: string }

function resolveRoots(request: PayloadPackageRequest): Roots {
  const root = resolve(request.repositoryRoot)
  try {
    if (!lstatSync(realpathSync(root)).isDirectory()) throw new Error("not a directory")
  } catch {
    throw new PayloadRefusal("repository-root-invalid", "repositoryRoot is not an existing directory")
  }
  const pluginRoot = join(root, PLUGIN_DIRECTORY)
  let pluginStatus: ReturnType<typeof lstatSync>
  try {
    pluginStatus = lstatSync(pluginRoot)
  } catch {
    throw new PayloadRefusal("payload-root-invalid", "plugin/ is absent")
  }
  if (pluginStatus.isSymbolicLink()) throw new PayloadRefusal("payload-root-invalid", "plugin/ is a symlink")
  if (!pluginStatus.isDirectory()) throw new PayloadRefusal("payload-root-invalid", "plugin/ is not a directory")
  return { root, pluginRoot, distRoot: join(root, OUTPUT_DIRECTORY) }
}

type Snapshot = ReadonlyMap<string, { bytes: Uint8Array; executable: boolean }>

function walkPayload(pluginRoot: string): string[] {
  const inventory: string[] = []
  const walk = (directory: string, relativeDirectory: string): void => {
    const entries = readdirSync(directory).sort(compareCodeUnits)
    if (entries.length === 0) throw new PayloadRefusal("unsafe-entry", `plugin/${relativeDirectory}: empty directory`)
    for (const entry of entries) {
      const relativePath = relativeDirectory === "" ? entry : `${relativeDirectory}/${entry}`
      const status = lstatSync(join(directory, entry))
      if (status.isSymbolicLink()) throw new PayloadRefusal("unsafe-entry", `plugin/${relativePath}: symlink`)
      if (status.isDirectory()) {
        walk(join(directory, entry), relativePath)
        continue
      }
      if (!status.isFile()) throw new PayloadRefusal("unsafe-entry", `plugin/${relativePath}: special file`)
      inventory.push(relativePath)
    }
  }
  walk(pluginRoot, "")
  return inventory.sort(compareCodeUnits)
}

function readDeclaredFile(pluginRoot: string, file: PreparedFileDeclaration): { bytes: Uint8Array; executable: boolean } {
  const absolute = join(pluginRoot, file.path)
  const status = lstatSync(absolute)
  if (!status.isFile()) throw new PayloadRefusal("declared-file-missing", `plugin/${file.path}: not a regular file`)
  if (status.size !== file.bytes) throw new PayloadRefusal("file-mismatch", `plugin/${file.path}: declared ${file.bytes} bytes, observed ${status.size}`)
  const bytes = new Uint8Array(readFileSync(absolute))
  if (prefixed(sha256Hex(bytes)) !== file.sha256) throw new PayloadRefusal("file-mismatch", `plugin/${file.path}: content digest differs from the declaration`)
  const executable = (status.mode & 0o111) !== 0
  if (executable !== file.executable) throw new PayloadRefusal("file-mismatch", `plugin/${file.path}: executable mode differs from the declaration`)
  return { bytes, executable }
}

/**
 * Walk the actual payload tree and require it to be exactly the declared
 * closure. Reused by the first snapshot and by the pre-publication recheck, so
 * an entry added, removed, or made unsafe after the snapshot is refused.
 */
function assertDeclaredClosure(pluginRoot: string, request: PayloadPackageRequest): void {
  const inventory = walkPayload(pluginRoot)
  const declared = new Set(request.prepared.files.map((file) => file.path))
  const undeclared = inventory.find((path) => !declared.has(path))
  if (undeclared !== undefined) throw new PayloadRefusal("undeclared-file", `plugin/${undeclared}: present but not declared`)
  const present = new Set(inventory)
  const missing = request.prepared.files.find((file) => !present.has(file.path))
  if (missing !== undefined) throw new PayloadRefusal("declared-file-missing", `plugin/${missing.path}: declared but absent`)
}

function snapshotClosure(pluginRoot: string, request: PayloadPackageRequest): Snapshot {
  assertDeclaredClosure(pluginRoot, request)
  const snapshot = new Map<string, { bytes: Uint8Array; executable: boolean }>()
  const hash = createHash("sha256")
  const frame = (length: number): Buffer => {
    const buffer = Buffer.alloc(8)
    buffer.writeBigUInt64BE(BigInt(length))
    return buffer
  }
  for (const file of request.prepared.files) {
    const observed = readDeclaredFile(pluginRoot, file)
    snapshot.set(file.path, observed)
    const pathBytes = new TextEncoder().encode(file.path)
    hash.update(frame(pathBytes.byteLength))
    hash.update(pathBytes)
    hash.update(frame(observed.bytes.byteLength))
    hash.update(observed.bytes)
  }
  if (prefixed(hash.digest("hex")) !== request.prepared.payloadSha256) {
    throw new PayloadRefusal("payload-digest-mismatch", "prepared.payloadSha256 differs from the framed digest of the declared files")
  }
  return snapshot
}

/**
 * Recheck every source input immediately before publication: the exact closure
 * and its safety, each declared file against the snapshot, and every
 * projection. The snapshot bytes remain the packaged content; this recheck only
 * refuses a source that changed while the archive was being compressed.
 */
function recheckSourceInputs(roots: Roots, request: PayloadPackageRequest, snapshot: Snapshot): ProjectionHashes {
  assertDeclaredClosure(roots.pluginRoot, request)
  for (const file of request.prepared.files) {
    const observed = readDeclaredFile(roots.pluginRoot, file)
    const original = snapshot.get(file.path)
    if (original === undefined || observed.executable !== original.executable || Buffer.compare(observed.bytes, original.bytes) !== 0) {
      throw new PayloadRefusal("file-mismatch", `plugin/${file.path}: changed after the snapshot`)
    }
  }
  return checkProjections(roots, request, snapshot)
}

type ProjectionHashes = { runtimeLockSha256: string; bundleInventorySha256: string }

/**
 * Resolve one repository-relative path physically. Every component from the
 * root is `lstat`ed, so a symlinked ancestor cannot carry a regular leaf
 * outside the named repository. Only a symlink or non-directory component is
 * refused, so valid newline and representable long names stay packageable.
 */
function physicalPathWithin(root: string, relativePath: string): string {
  const segments = relativePath.split("/")
  let current = root
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment)
    let status: ReturnType<typeof lstatSync>
    try {
      status = lstatSync(current)
    } catch {
      throw new PayloadRefusal("projection-mismatch", `${relativePath}: projection is absent`)
    }
    if (status.isSymbolicLink()) {
      throw new PayloadRefusal("unsafe-entry", `${relativePath}: path component "${segment}" is a symlink`)
    }
    if (index < segments.length - 1 && !status.isDirectory()) {
      throw new PayloadRefusal("projection-mismatch", `${relativePath}: path component "${segment}" is not a directory`)
    }
  }
  return current
}

function readProjection(roots: Roots, projection: PreparedProjectionDeclaration): { bytes: Uint8Array; hex: string } {
  const lexical = resolve(roots.root, projection.path)
  if (!lexical.startsWith(`${roots.root}${sep}`)) throw new PayloadRefusal("declaration-invalid", `${projection.path}: projection escapes the repository root`)
  const absolute = physicalPathWithin(roots.root, projection.path)
  if (!lstatSync(absolute).isFile()) throw new PayloadRefusal("projection-mismatch", `${projection.path}: projection is not a regular file`)
  const bytes = new Uint8Array(readFileSync(absolute))
  const hex = sha256Hex(bytes)
  if (bytes.byteLength !== projection.bytes || prefixed(hex) !== projection.sha256) {
    throw new PayloadRefusal("projection-mismatch", `${projection.path}: projection bytes differ from the declaration`)
  }
  return { bytes, hex }
}

function checkProjectionInsidePayload(projection: PreparedProjectionDeclaration, bytes: Uint8Array, snapshot: Snapshot): void {
  if (!projection.path.startsWith(`${PLUGIN_DIRECTORY}/`)) return
  const inside = snapshot.get(projection.path.slice(PLUGIN_DIRECTORY.length + 1))
  if (inside === undefined || Buffer.compare(inside.bytes, bytes) !== 0) {
    throw new PayloadRefusal("projection-mismatch", `${projection.path}: projection inside plugin/ is not the declared file`)
  }
}

function checkProjections(roots: Roots, request: PayloadPackageRequest, snapshot: Snapshot): ProjectionHashes {
  const hashes: Partial<ProjectionHashes> = {}
  for (const projection of request.prepared.projections) {
    const { bytes, hex } = readProjection(roots, projection)
    checkProjectionInsidePayload(projection, bytes, snapshot)
    if (projection.role === "runtime-lock") hashes.runtimeLockSha256 = hex
    if (projection.role === "bundle-inventory") hashes.bundleInventorySha256 = hex
  }
  if (hashes.runtimeLockSha256 === undefined || hashes.bundleInventorySha256 === undefined) {
    throw new PayloadRefusal("declaration-invalid", "runtime-lock and bundle-inventory projections are required")
  }
  return { runtimeLockSha256: hashes.runtimeLockSha256, bundleInventorySha256: hashes.bundleInventorySha256 }
}

type ArchiveEntry = { path: string; directory: boolean; bytes: Uint8Array; executable: boolean }

type DirectoryNode = { directories: Map<string, DirectoryNode>; files: Map<string, { bytes: Uint8Array; executable: boolean }> }

function archiveEntriesFor(packageName: string, snapshot: Snapshot): ArchiveEntry[] {
  const rootNode: DirectoryNode = { directories: new Map(), files: new Map() }
  for (const [path, file] of snapshot) {
    const segments = path.split("/")
    let node = rootNode
    for (const segment of segments.slice(0, -1)) {
      let child = node.directories.get(segment)
      if (child === undefined) {
        child = { directories: new Map(), files: new Map() }
        node.directories.set(segment, child)
      }
      node = child
    }
    node.files.set(segments[segments.length - 1] as string, file)
  }
  const entries: ArchiveEntry[] = []
  const emit = (node: DirectoryNode, prefix: string): void => {
    entries.push({ path: `${prefix}/`, directory: true, bytes: new Uint8Array(), executable: true })
    const names = [...node.directories.keys(), ...node.files.keys()].sort(compareCodeUnits)
    for (const name of names) {
      const directory = node.directories.get(name)
      if (directory !== undefined) {
        emit(directory, `${prefix}/${name}`)
        continue
      }
      const file = node.files.get(name) as { bytes: Uint8Array; executable: boolean }
      entries.push({ path: `${prefix}/${name}`, directory: false, bytes: file.bytes, executable: file.executable })
    }
  }
  emit(rootNode, packageName)
  return entries
}

function splitUstarPath(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path, "utf8") <= 100) return { name: path, prefix: "" }
  for (let slash = path.lastIndexOf("/"); slash > 0; slash = path.lastIndexOf("/", slash - 1)) {
    const prefix = path.slice(0, slash)
    const name = path.slice(slash + 1)
    if (name.length > 0 && Buffer.byteLength(name, "utf8") <= 100 && Buffer.byteLength(prefix, "utf8") <= 155) {
      return { name, prefix }
    }
  }
  throw new PayloadRefusal("unsafe-entry", `${path}: USTAR path cannot be represented`)
}

function writeText(header: Buffer, offset: number, width: number, value: string): void {
  const bytes = Buffer.from(value, "utf8")
  if (bytes.length > width) throw new PayloadRefusal("unsafe-entry", `USTAR field exceeds ${width} bytes`)
  bytes.copy(header, offset)
}

function writeOctal(header: Buffer, offset: number, width: number, value: number): void {
  const octal = value.toString(8)
  if (octal.length > width - 1) throw new PayloadRefusal("unsafe-entry", `USTAR numeric field exceeds ${width} bytes`)
  writeText(header, offset, width, `${octal.padStart(width - 1, "0")}\0`)
}

function ustarHeader(entry: ArchiveEntry): Buffer {
  const header = Buffer.alloc(USTAR_BLOCK_BYTES)
  const { name, prefix } = splitUstarPath(entry.path)
  writeText(header, 0, 100, name)
  writeOctal(header, 100, 8, entry.directory || entry.executable ? 0o755 : 0o644)
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  writeOctal(header, 124, 12, entry.directory ? 0 : entry.bytes.byteLength)
  writeOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header[156] = entry.directory ? 0x35 : 0x30
  writeText(header, 257, 6, "ustar\0")
  writeText(header, 263, 2, "00")
  writeText(header, 265, 32, "root")
  writeText(header, 297, 32, "root")
  writeOctal(header, 329, 8, 0)
  writeOctal(header, 337, 8, 0)
  writeText(header, 345, 155, prefix)
  let checksum = 0
  for (const byte of header) checksum += byte
  writeText(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `)
  return header
}

function deterministicUstar(entries: readonly ArchiveEntry[]): Buffer {
  const chunks: Buffer[] = []
  for (const entry of entries) {
    chunks.push(ustarHeader(entry))
    if (entry.directory) continue
    chunks.push(Buffer.from(entry.bytes))
    const padding = (USTAR_BLOCK_BYTES - (entry.bytes.byteLength % USTAR_BLOCK_BYTES)) % USTAR_BLOCK_BYTES
    if (padding > 0) chunks.push(Buffer.alloc(padding))
  }
  chunks.push(Buffer.alloc(USTAR_BLOCK_BYTES * 2))
  return Buffer.concat(chunks)
}

type CompressorHandle = { kill(): void }

const processGroupAlive = (pid: number): boolean => {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

const pause = (milliseconds: number): Promise<void> => new Promise((done) => setTimeout(done, milliseconds))

async function reapProcessGroup(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && processGroupAlive(pid); attempt += 1) {
    try { process.kill(-pid, "SIGKILL") } catch {}
    await pause(5)
  }
}

async function compress(
  uncompressed: Buffer,
  compressor: PayloadCompressor,
  register: (handle: CompressorHandle | undefined) => void,
): Promise<Buffer> {
  let child: ReturnType<typeof Bun.spawn>
  try {
    child = Bun.spawn({
      cmd: [...compressor.command],
      stdin: uncompressed,
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    })
  } catch {
    throw new PayloadFailure("compressor-failed", "none", false, { archive: null, checksums: null }, "compressor could not be spawned")
  }
  const terminate = (): void => {
    try { process.kill(-child.pid, "SIGKILL") } catch {}
    try { child.kill("SIGKILL") } catch {}
  }
  register({ kill: terminate })
  if (!(child.stdout instanceof ReadableStream) || !(child.stderr instanceof ReadableStream)) {
    terminate()
    throw new PayloadFailure("compressor-failed", "none", false, { archive: null, checksums: null }, "compressor streams were not piped")
  }
  const stdout = new Response(child.stdout).arrayBuffer()
  const stderr = new Response(child.stderr).text()
  let timedOut = false
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<"deadline">((done) => {
    deadlineTimer = setTimeout(() => { timedOut = true; done("deadline") }, compressor.deadlineMs)
  })
  const settled = Promise.all([stdout, stderr, child.exited]).then(() => "settled" as const)
  const outcome = await Promise.race([settled, deadline])
  clearTimeout(deadlineTimer)
  if (outcome === "deadline") {
    terminate()
    await reapProcessGroup(child.pid)
    await Promise.race([settled, pause(1_000)])
    register(undefined)
    throw new PayloadFailure("compressor-deadline", "none", false, { archive: null, checksums: null }, "compressor exceeded its deadline")
  }
  const [bytes, , exitCode] = await Promise.all([stdout, stderr, child.exited])
  if (timedOut || exitCode !== 0) {
    terminate()
    await reapProcessGroup(child.pid)
    register(undefined)
    throw new PayloadFailure("compressor-failed", "none", false, { archive: null, checksums: null }, `compressor exited with ${exitCode}`)
  }
  register(undefined)
  return Buffer.from(bytes)
}

type ExistingOutput = "absent" | "identical"

function existingOutputState(path: string, expected: Buffer, label: string): ExistingOutput {
  let status: ReturnType<typeof lstatSync>
  try {
    status = lstatSync(path)
  } catch {
    return "absent"
  }
  if (status.isSymbolicLink()) throw new PayloadRefusal("output-conflict", `dist/${label}: existing symlink`)
  if (!status.isFile()) throw new PayloadRefusal("output-conflict", `dist/${label}: existing non-regular entry`)
  const observed = readFileSync(path)
  if (Buffer.compare(observed, expected) !== 0) throw new PayloadRefusal("output-conflict", `dist/${label}: different existing artifact preserved`)
  return "identical"
}

function ensureOutputRoot(distRoot: string): void {
  let status: ReturnType<typeof lstatSync> | undefined
  try {
    status = lstatSync(distRoot)
  } catch {
    status = undefined
  }
  if (status === undefined) {
    try {
      mkdirSync(distRoot, { recursive: true })
    } catch {
      throw new PayloadFailure("staging-failed", "none", false, { archive: null, checksums: null }, "dist/ could not be created")
    }
    return
  }
  if (status.isSymbolicLink()) throw new PayloadRefusal("output-conflict", "dist/: existing symlink")
  if (!status.isDirectory()) throw new PayloadRefusal("output-conflict", "dist/: existing non-directory")
}

function fsyncFile(path: string): void {
  const descriptor = openSync(path, "r")
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

function fsyncDirectory(path: string): void {
  try {
    fsyncFile(path)
  } catch {
    // Directory fsync is best effort; no durability claim is made.
  }
}

function stageArtifact(stagingRoot: string, name: string, bytes: Buffer): string {
  const path = join(stagingRoot, name)
  writeFileSync(path, bytes, { mode: 0o644 })
  fsyncFile(path)
  return path
}

/**
 * A publication-phase fault. It carries no publication claim of its own: the
 * publication owner classifies every one of these against the artifacts it can
 * actually observe, so a fault after the archive was published can never be
 * reported as an unchanged repository.
 */
class PayloadPublicationFault extends Error {}

/** Atomic no-replace publication; returns whether the existing file already matched. */
function publishNoReplace(staged: string, final: string, expected: Buffer, label: string): "published" | "identical" {
  try {
    linkSync(staged, final)
    return "published"
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
      throw new PayloadPublicationFault(`dist/${label}: publication failed`)
    }
    return existingOutputState(final, expected, label) === "identical" ? "identical" : "published"
  }
}

function artifactRecordFor(path: string, expected: Buffer, label: string): PayloadArtifactRecord {
  const observed = observedArtifact(path, expected)
  if (typeof observed === "string") {
    throw new PayloadPublicationFault(`dist/${label}: published artifact could not be confirmed on reread`)
  }
  return observed
}

type ObservedArtifact = PayloadArtifactRecord | "absent" | "conflicting" | "unobservable"

/**
 * Read one output entry as evidence. The entry is this candidate's artifact
 * only when its bytes match exactly; an unsafe entry or another candidate's
 * bytes is a conflict, and an entry that cannot be read is unobservable rather
 * than absent.
 */
function observedArtifact(path: string, expected: Buffer): ObservedArtifact {
  let status: ReturnType<typeof lstatSync>
  try {
    status = lstatSync(path)
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT" ? "absent" : "unobservable"
  }
  if (status.isSymbolicLink() || !status.isFile()) return "conflicting"
  try {
    const bytes = readFileSync(path)
    return Buffer.compare(bytes, expected) === 0
      ? { path, bytes: bytes.byteLength, sha256: prefixed(sha256Hex(bytes)) }
      : "conflicting"
  } catch {
    return "unobservable"
  }
}

type Invocation = {
  compressor: CompressorHandle | undefined
  stagingRoot: string | undefined
}

function cleanupInvocation(invocation: Invocation): void {
  invocation.compressor?.kill()
  invocation.compressor = undefined
  if (invocation.stagingRoot !== undefined) {
    rmSync(invocation.stagingRoot, { recursive: true, force: true })
    invocation.stagingRoot = undefined
  }
}

const cleanupSignals = ["SIGTERM", "SIGINT", "SIGHUP"] as const

function withSignalCleanup<T>(invocation: Invocation, run: () => Promise<T>): Promise<T> {
  const handlers = cleanupSignals.map((signal) => {
    const handler = (): void => {
      cleanupInvocation(invocation)
      for (const [name, registered] of handlers) process.off(name, registered)
      process.kill(process.pid, signal)
    }
    process.on(signal, handler)
    return [signal, handler] as const
  })
  return run().finally(() => {
    for (const [signal, handler] of handlers) process.off(signal, handler)
  })
}

type ArtifactNames = { archive: string; checksums: string }
type ArtifactBytes = { archive: Buffer; checksums: Buffer }
type PublishedArtifacts = { archive: PayloadArtifactRecord; checksums: PayloadArtifactRecord }

const rereadArtifacts = (roots: Roots, names: ArtifactNames, bytes: ArtifactBytes): PublishedArtifacts => ({
  archive: artifactRecordFor(join(roots.distRoot, names.archive), bytes.archive, names.archive),
  checksums: artifactRecordFor(join(roots.distRoot, names.checksums), bytes.checksums, names.checksums),
})

/** Classify existing output before staging; refuse every unsafe or conflicting state. */
function existingArtifactsState(roots: Roots, names: ArtifactNames, bytes: ArtifactBytes): "absent" | "archive-only" | "complete" {
  const archiveState = existingOutputState(join(roots.distRoot, names.archive), bytes.archive, names.archive)
  const checksumsState = existingOutputState(join(roots.distRoot, names.checksums), bytes.checksums, names.checksums)
  if (archiveState === "absent" && checksumsState === "identical") {
    throw new PayloadRefusal("output-conflict", `dist/${names.checksums}: checksum document without its archive preserved`)
  }
  if (archiveState === "identical") return checksumsState === "identical" ? "complete" : "archive-only"
  return "absent"
}

const stagingRootFor = (roots: Roots, invocation: Invocation): string => {
  try {
    invocation.stagingRoot = mkdtempSync(join(roots.distRoot, ".agent-plugin-kit-"))
    return invocation.stagingRoot
  } catch {
    throw new PayloadFailure("staging-failed", "none", false, { archive: null, checksums: null }, "staging directory could not be created")
  }
}

type ObservedPublication = { publication: PayloadPublicationState; artifacts: Failed["artifacts"] }

/** Read the published state from the actual output entries, never from the fault. */
function observePublication(archive: ObservedArtifact, checksums: ObservedArtifact): ObservedPublication {
  const archiveRecord = typeof archive === "string" ? null : archive
  const checksumsRecord = typeof checksums === "string" ? null : checksums
  const artifacts = { archive: archiveRecord, checksums: checksumsRecord }
  if (archive === "unobservable" || checksums === "unobservable") return { publication: "unknown", artifacts }
  if (archiveRecord === null) {
    return checksumsRecord === null
      ? { publication: "none", artifacts }
      : { publication: "unknown", artifacts }
  }
  return checksumsRecord === null
    ? { publication: "archive-only", artifacts }
    : { publication: "unknown", artifacts }
}

const publicationFailureCodes = {
  none: "staging-failed",
  "archive-only": "publication-interrupted",
  unknown: "publication-unobservable",
} as const satisfies Record<PayloadPublicationState, PayloadFailureCode>

/**
 * Classify one publication-phase error against the artifacts actually present.
 * An output entry owned by another candidate is a preserved conflict whatever
 * raised the error. Otherwise the caller receives the observed publication
 * state, so a fault after the archive was linked can never report an unchanged
 * repository.
 */
function publicationOutcomeFor(
  roots: Roots,
  names: ArtifactNames,
  bytes: ArtifactBytes,
  error: unknown,
): PayloadRefusal | PayloadFailure {
  const detail = error instanceof Error && error.message !== "" ? error.message : "publication failed"
  const archive = observedArtifact(join(roots.distRoot, names.archive), bytes.archive)
  const checksums = observedArtifact(join(roots.distRoot, names.checksums), bytes.checksums)
  if (archive === "conflicting" || checksums === "conflicting") {
    return error instanceof PayloadRefusal ? error : new PayloadRefusal("output-conflict", detail)
  }
  const observed = observePublication(archive, checksums)
  if (error instanceof PayloadRefusal && observed.publication === "none") return error
  return new PayloadFailure(
    publicationFailureCodes[observed.publication],
    observed.publication,
    false,
    observed.artifacts,
    detail,
  )
}

function publishStaged(
  roots: Roots,
  names: ArtifactNames,
  bytes: ArtifactBytes,
  state: "absent" | "archive-only",
  stagingRoot: string,
  interrupt: PluginPayloadProductionOptions["interrupt"],
): PublishedArtifacts {
  const archivePath = join(roots.distRoot, names.archive)
  const checksumsPath = join(roots.distRoot, names.checksums)
  const stagedChecksums = stageArtifact(stagingRoot, names.checksums, bytes.checksums)
  if (state === "absent") {
    const stagedArchive = stageArtifact(stagingRoot, names.archive, bytes.archive)
    interrupt?.("staged")
    publishNoReplace(stagedArchive, archivePath, bytes.archive, names.archive)
    unlinkSync(stagedArchive)
  }
  artifactRecordFor(archivePath, bytes.archive, names.archive)
  interrupt?.("archive-published")
  publishNoReplace(stagedChecksums, checksumsPath, bytes.checksums, names.checksums)
  unlinkSync(stagedChecksums)
  fsyncDirectory(roots.distRoot)
  interrupt?.("checksums-published")
  return rereadArtifacts(roots, names, bytes)
}

function publishArtifacts(
  roots: Roots,
  names: ArtifactNames,
  bytes: ArtifactBytes,
  invocation: Invocation,
  interrupt: PluginPayloadProductionOptions["interrupt"],
): PublishedArtifacts {
  ensureOutputRoot(roots.distRoot)
  const state = existingArtifactsState(roots, names, bytes)
  if (state === "complete") {
    try {
      return rereadArtifacts(roots, names, bytes)
    } catch (error) {
      throw publicationOutcomeFor(roots, names, bytes, error)
    }
  }
  const stagingRoot = stagingRootFor(roots, invocation)
  try {
    return publishStaged(roots, names, bytes, state, stagingRoot, interrupt)
  } catch (error) {
    throw publicationOutcomeFor(roots, names, bytes, error)
  } finally {
    cleanupInvocation(invocation)
  }
}

async function packagePayload(
  request: PayloadPackageRequest,
  options: PluginPayloadProductionOptions,
): Promise<PayloadProductionResult> {
  validateStatics(request)
  const roots = resolveRoots(request)
  const snapshot = snapshotClosure(roots.pluginRoot, request)
  checkProjections(roots, request, snapshot)
  const packageName = `${request.release.name}-${request.release.version}`
  const entries = archiveEntriesFor(packageName, snapshot)
  for (const entry of entries) splitUstarPath(entry.path)
  const uncompressed = deterministicUstar(entries)
  const invocation: Invocation = { compressor: undefined, stagingRoot: undefined }
  return withSignalCleanup(invocation, async () => {
    const archive = await compress(uncompressed, options.compressor ?? defaultPayloadCompressor, (handle) => {
      invocation.compressor = handle
    })
    const archiveSha256 = sha256Hex(archive)
    const projectionHashes = recheckSourceInputs(roots, request, snapshot)
    const names = { archive: `${packageName}.tar.gz`, checksums: `${packageName}.checksums.json` }
    const checksums = Buffer.from(`${JSON.stringify({
      repository: request.sourceIdentity.repository.origin,
      sourceCommit: request.sourceIdentity.commit,
      tag: request.release.tag,
      plugin: request.release.name,
      version: request.release.version,
      archive: names.archive,
      archiveBytes: archive.byteLength,
      archiveSha256,
      runtimeLockSha256: projectionHashes.runtimeLockSha256,
      bundleInventorySha256: projectionHashes.bundleInventorySha256,
      payloadInventorySha256: request.prepared.payloadSha256.slice("sha256:".length),
      evidence: checksumEvidence,
    }, null, 2)}\n`, "utf8")
    const artifacts = publishArtifacts(roots, names, { archive, checksums }, invocation, options.interrupt)
    const packaged: Packaged = {
      kind: "packaged",
      sourceIdentity: {
        repository: { origin: request.sourceIdentity.repository.origin },
        commit: request.sourceIdentity.commit,
      },
      release: { name: request.release.name, version: request.release.version, tag: request.release.tag },
      bindingSha256: request.prepared.bindingSha256,
      payload: {
        regularFiles: request.prepared.files.map((file) => file.path),
        payloadSha256: request.prepared.payloadSha256,
      },
      artifacts,
      nextAction: "Inspect the packaged Plugin Payload artifacts under dist/.",
    }
    return packaged
  })
}

/**
 * The Plugin Payload Production Implementation. Package mode is complete;
 * check and materialize remain deferred refusals until their own gate.
 */
export function createPluginPayloadProduction(
  options: PluginPayloadProductionOptions = {},
): PluginPayloadProduction {
  return {
    async produce(request: PayloadProductionRequest): Promise<PayloadProductionResult> {
      if (request.mode !== "package") return refused("mode-deferred", `payload ${request.mode} is not implemented`)
      try {
        return await packagePayload(request, options)
      } catch (error) {
        if (error instanceof PayloadRefusal) return refused(error.code, error.detail)
        if (error instanceof PayloadFailure) return failed(error)
        throw error
      }
    },
  }
}
