import { createHash } from "node:crypto"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { SourceIdentity } from "../../../release-and-git-engine/interface"
import type {
  PayloadPackageRequest,
  PreparedFileDeclaration,
  PreparedPayloadDeclaration,
  PreparedProjectionDeclaration,
  PreparedProjectionRole,
} from "../../interface"

/**
 * Test-owned preparation oracle. It never imports the Implementation: every
 * digest, tuple encoding, and archive expectation here is derived from the
 * accepted decision text and node:crypto, so a producer drift is visible.
 */
export type FixtureFile = {
  path: string
  bytes: Uint8Array | string
  executable?: boolean
  mode?: number
}

export type FixtureProjection = {
  role: PreparedProjectionRole
  path: string
  bytes: Uint8Array | string
}

export type PluginFixtureInput = {
  root?: string
  name?: string
  version?: string
  sourceIdentity?: SourceIdentity
  files: readonly FixtureFile[]
  projections?: readonly FixtureProjection[]
}

export type PluginFixture = {
  root: string
  pluginRoot: string
  distRoot: string
  packageName: string
  archivePath: string
  checksumsPath: string
  request: PayloadPackageRequest
  fileBytes: ReadonlyMap<string, Uint8Array>
}

const fixtureSourceIdentity: SourceIdentity = {
  repository: { origin: "https://github.com/myagentdojo/example-plugin.git" },
  commit: "1111111111111111111111111111111111111111",
}

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

export const sha256Hex = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex")

const prefixedSha256 = (bytes: Uint8Array | string): `sha256:${string}` =>
  `sha256:${sha256Hex(bytes)}`

const toBytes = (value: Uint8Array | string): Uint8Array =>
  typeof value === "string" ? new TextEncoder().encode(value) : value

const framedLength = (length: number): Uint8Array => {
  const frame = Buffer.alloc(8)
  frame.writeBigUInt64BE(BigInt(length))
  return frame
}

/** Length-framed path/body digest over files in the supplied order, bare hex. */
export const framedPayloadDigest = (files: readonly { path: string; bytes: Uint8Array }[]): string => {
  const hash = createHash("sha256")
  for (const file of files) {
    const pathBytes = new TextEncoder().encode(file.path)
    hash.update(framedLength(pathBytes.byteLength))
    hash.update(pathBytes)
    hash.update(framedLength(file.bytes.byteLength))
    hash.update(file.bytes)
  }
  return hash.digest("hex")
}

/** UTF-8 JSON tuple binding digest from the accepted decision, bare hex. */
const bindingDigest = (input: {
  sourceIdentity: SourceIdentity
  name: string
  version: string
  tag: string
  files: readonly PreparedFileDeclaration[]
  projections: readonly PreparedProjectionDeclaration[]
  payloadSha256: `sha256:${string}`
}): string => {
  const tuple = [
    1,
    input.sourceIdentity.repository.origin,
    input.sourceIdentity.commit,
    input.name,
    input.version,
    input.tag,
    input.files.map((file) => [file.path, file.bytes, file.sha256, file.executable]),
    [...input.projections]
      .sort((left, right) => compareCodeUnits(left.role, right.role) || compareCodeUnits(left.path, right.path))
      .map((projection) => [projection.role, projection.path, projection.bytes, projection.sha256]),
    input.payloadSha256,
  ]
  return sha256Hex(JSON.stringify(tuple))
}

const defaultProjections: readonly FixtureProjection[] = [
  { role: "runtime-lock", path: "runtime/runtime.lock.json", bytes: '{"lock":"fixture"}\n' },
  { role: "bundle-inventory", path: "runtime/bundle-inventory.json", bytes: '{"bundles":[]}\n' },
]

const declarationFor = (input: {
  sourceIdentity: SourceIdentity
  name: string
  version: string
  files: readonly { path: string; bytes: Uint8Array; executable: boolean }[]
  projections: readonly { role: PreparedProjectionRole; path: string; bytes: Uint8Array }[]
}): PreparedPayloadDeclaration => {
  const sortedFiles = [...input.files].sort((left, right) => compareCodeUnits(left.path, right.path))
  const files: PreparedFileDeclaration[] = sortedFiles.map((file) => ({
    path: file.path,
    bytes: file.bytes.byteLength,
    sha256: prefixedSha256(file.bytes),
    executable: file.executable,
  }))
  const projections: PreparedProjectionDeclaration[] = [...input.projections]
    .sort((left, right) => compareCodeUnits(left.role, right.role) || compareCodeUnits(left.path, right.path))
    .map((projection) => ({
      role: projection.role,
      path: projection.path,
      bytes: projection.bytes.byteLength,
      sha256: prefixedSha256(projection.bytes),
    }))
  const payloadSha256: `sha256:${string}` = `sha256:${framedPayloadDigest(sortedFiles)}`
  return {
    sourceIdentity: input.sourceIdentity,
    files,
    projections,
    payloadSha256,
    bindingSha256: `sha256:${bindingDigest({
      sourceIdentity: input.sourceIdentity,
      name: input.name,
      version: input.version,
      tag: `v${input.version}`,
      files,
      projections,
      payloadSha256,
    })}`,
  }
}

/** Write one Plugin Repository fixture and its sealed declaration. */
export const createPluginFixture = (input: PluginFixtureInput): PluginFixture => {
  const root = input.root ?? mkdtempSync(join(tmpdir(), "agent-plugin-kit-payload-"))
  const name = input.name ?? "plugin"
  const version = input.version ?? "0.1.0"
  const sourceIdentity = input.sourceIdentity ?? fixtureSourceIdentity
  const pluginRoot = join(root, "plugin")
  mkdirSync(pluginRoot, { recursive: true })
  const fileBytes = new Map<string, Uint8Array>()
  const files = input.files.map((file) => {
    const bytes = toBytes(file.bytes)
    const absolute = join(pluginRoot, file.path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, bytes)
    chmodSync(absolute, file.mode ?? (file.executable ? 0o755 : 0o644))
    fileBytes.set(file.path, bytes)
    return { path: file.path, bytes, executable: file.executable ?? false }
  })
  const projections = (input.projections ?? defaultProjections).map((projection) => {
    const bytes = toBytes(projection.bytes)
    const absolute = join(root, projection.path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, bytes)
    return { role: projection.role, path: projection.path, bytes }
  })
  const packageName = `${name}-${version}`
  return {
    root,
    pluginRoot,
    distRoot: join(root, "dist"),
    packageName,
    archivePath: join(root, "dist", `${packageName}.tar.gz`),
    checksumsPath: join(root, "dist", `${packageName}.checksums.json`),
    request: {
      repositoryRoot: root,
      mode: "package",
      sourceIdentity,
      release: { name, version, tag: `v${version}` },
      prepared: declarationFor({ sourceIdentity, name, version, files, projections }),
    },
    fileBytes,
  }
}

/** Recompute only the binding for an edited request; a stale binding stays stale unless rebound. */
export const rebind = (request: PayloadPackageRequest): PayloadPackageRequest => ({
  ...request,
  prepared: {
    ...request.prepared,
    bindingSha256: `sha256:${bindingDigest({
      sourceIdentity: request.prepared.sourceIdentity,
      name: request.release.name,
      version: request.release.version,
      tag: request.release.tag,
      files: request.prepared.files,
      projections: request.prepared.projections,
      payloadSha256: request.prepared.payloadSha256,
    })}`,
  },
})

/** Re-derive the declaration after fixture bytes or modes changed on disk. */
export const redeclare = (fixture: PluginFixture): PayloadPackageRequest => {
  const files = fixture.request.prepared.files.map((file) => {
    const absolute = join(fixture.pluginRoot, file.path)
    return {
      path: file.path,
      bytes: new Uint8Array(readFileSync(absolute)),
      executable: (statSync(absolute).mode & 0o111) !== 0,
    }
  })
  const projections = fixture.request.prepared.projections.map((projection) => ({
    role: projection.role,
    path: projection.path,
    bytes: new Uint8Array(readFileSync(join(fixture.root, projection.path))),
  }))
  return {
    ...fixture.request,
    prepared: declarationFor({
      sourceIdentity: fixture.request.sourceIdentity,
      name: fixture.request.release.name,
      version: fixture.request.release.version,
      files,
      projections,
    }),
  }
}

export type ArchiveEntry = {
  path: string
  type: "directory" | "file"
  mode: number
  uid: number
  gid: number
  mtime: number
  uname: string
  gname: string
  bytes: Uint8Array
}

const octalField = (header: Uint8Array, offset: number, width: number): number =>
  Number.parseInt(new TextDecoder().decode(header.subarray(offset, offset + width)).replace(/\0.*$/su, "").trim() || "0", 8)

const textField = (header: Uint8Array, offset: number, width: number): string =>
  new TextDecoder().decode(header.subarray(offset, offset + width)).replace(/\0.*$/su, "")

/** Independent USTAR reader over gunzipped bytes; no production tar code. */
export const readArchiveEntries = (gzipBytes: Uint8Array): ArchiveEntry[] => {
  const tar = Bun.gunzipSync(new Uint8Array(gzipBytes))
  const entries: ArchiveEntry[] = []
  let offset = 0
  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    if (textField(header, 257, 6) !== "ustar") throw new Error(`non-USTAR header at ${offset}`)
    const name = textField(header, 0, 100)
    const prefix = textField(header, 345, 155)
    const size = octalField(header, 124, 12)
    const typeflag = header[156]
    const body = tar.subarray(offset + 512, offset + 512 + size)
    entries.push({
      path: prefix === "" ? name : `${prefix}/${name}`,
      type: typeflag === 0x35 ? "directory" : "file",
      mode: octalField(header, 100, 8),
      uid: octalField(header, 108, 8),
      gid: octalField(header, 116, 8),
      mtime: octalField(header, 136, 12),
      uname: textField(header, 265, 32),
      gname: textField(header, 297, 32),
      bytes: new Uint8Array(body),
    })
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}

const checksumEvidenceSentence =
  "Checksum metadata is integrity evidence for these archive bytes, not independent publisher or builder authenticity."

/** Test-owned checksum document rendering from independently known values. */
export const expectedChecksumDocument = (identity: {
  repository: string
  sourceCommit: string
  tag: string
  plugin: string
  version: string
  archive: string
  archiveBytes: number
  archiveSha256: string
  runtimeLockSha256: string
  bundleInventorySha256: string
  payloadInventorySha256: string
}): string =>
  `${JSON.stringify({ ...identity, evidence: checksumEvidenceSentence }, null, 2)}\n`
