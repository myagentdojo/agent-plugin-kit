import { afterEach, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { createPluginPayloadProduction } from "../implementation/plugin-payload-production"
import {
  createPluginFixture,
  expectedChecksumDocument,
  readArchiveEntries,
  rebind,
  redeclare,
  sha256Hex,
  type PluginFixture,
} from "./fixtures/prepared-plugin-fixture"

const fixtures: PluginFixture[] = []
const fixture = (input: Parameters<typeof createPluginFixture>[0]): PluginFixture => {
  const created = createPluginFixture(input)
  fixtures.push(created)
  return created
}
afterEach(() => {
  for (const created of fixtures.splice(0)) rmSync(created.root, { recursive: true, force: true })
})

const payload = () => createPluginPayloadProduction()

test("D01 packages the exact regular-file closure with normalized archive modes", async () => {
  const subject = fixture({
    files: [
      { path: "a-safe.txt", bytes: "safe\n", mode: 0o640 },
      { path: "nested/binary.dat", bytes: new Uint8Array([0, 1, 2, 255]) },
      { path: "nested/deeper/run", bytes: "#!/bin/sh\n", executable: true, mode: 0o751 },
    ],
  })
  const result = await payload().produce(subject.request)
  expect(result.kind).toBe("packaged")
  if (result.kind !== "packaged") return
  const archiveBytes = readFileSync(subject.archivePath)
  const checksumBytes = readFileSync(subject.checksumsPath)
  expect(result.artifacts.archive).toEqual({
    path: subject.archivePath,
    bytes: statSync(subject.archivePath).size,
    sha256: `sha256:${sha256Hex(archiveBytes)}`,
  })
  expect(result.artifacts.checksums).toEqual({
    path: subject.checksumsPath,
    bytes: statSync(subject.checksumsPath).size,
    sha256: `sha256:${sha256Hex(checksumBytes)}`,
  })
  expect(result.payload.regularFiles).toEqual(["a-safe.txt", "nested/binary.dat", "nested/deeper/run"])
  expect(result.payload.payloadSha256).toBe(subject.request.prepared.payloadSha256)
  expect(result.bindingSha256).toBe(subject.request.prepared.bindingSha256)
  const entries = readArchiveEntries(archiveBytes)
  expect(entries.map(({ path, type, mode }) => [path, type, mode])).toEqual([
    ["plugin-0.1.0/", "directory", 0o755],
    ["plugin-0.1.0/a-safe.txt", "file", 0o644],
    ["plugin-0.1.0/nested/", "directory", 0o755],
    ["plugin-0.1.0/nested/binary.dat", "file", 0o644],
    ["plugin-0.1.0/nested/deeper/", "directory", 0o755],
    ["plugin-0.1.0/nested/deeper/run", "file", 0o755],
  ])
  for (const entry of entries) {
    expect([entry.uid, entry.gid, entry.mtime, entry.uname, entry.gname]).toEqual([0, 0, 0, "root", "root"])
    if (entry.type === "file") {
      expect([...entry.bytes]).toEqual([...(subject.fileBytes.get(entry.path.slice("plugin-0.1.0/".length)) ?? [])])
    }
  }
  expect(new TextDecoder().decode(checksumBytes)).toBe(expectedChecksumDocument({
    repository: subject.request.sourceIdentity.repository.origin,
    sourceCommit: subject.request.sourceIdentity.commit,
    tag: "v0.1.0",
    plugin: "plugin",
    version: "0.1.0",
    archive: "plugin-0.1.0.tar.gz",
    archiveBytes: archiveBytes.byteLength,
    archiveSha256: sha256Hex(archiveBytes),
    runtimeLockSha256: sha256Hex(readFileSync(`${subject.root}/runtime/runtime.lock.json`)),
    bundleInventorySha256: sha256Hex(readFileSync(`${subject.root}/runtime/bundle-inventory.json`)),
    payloadInventorySha256: subject.request.prepared.payloadSha256.slice("sha256:".length),
  }))
})

const packaged = async (subject: PluginFixture, request = subject.request) => {
  const result = await payload().produce(request)
  if (result.kind !== "packaged") throw new Error(`expected packaged, observed ${JSON.stringify(result)}`)
  return result
}

const literalArchiveSha256 = "116a569020e91b24e5994dae842f0a4fe3bfd90bb0ee7f20c4c66f3e38b805ae"
const canonicalFixture = () => fixture({ files: [{ path: "a-safe.txt", bytes: "safe\n" }] })

test("D02 repeated packaging reuses identical artifacts despite changed source mtimes", async () => {
  const subject = fixture({ files: [{ path: "a-safe.txt", bytes: "safe\n" }, { path: "nested/run", bytes: "#!/bin/sh\n", executable: true }] })
  const first = await packaged(subject)
  const firstArchive = readFileSync(subject.archivePath)
  const firstStat = statSync(subject.archivePath)
  const firstChecksumStat = statSync(subject.checksumsPath)
  const past = new Date(Date.now() - 86_400_000)
  utimesSync(`${subject.pluginRoot}/a-safe.txt`, past, past)
  utimesSync(`${subject.pluginRoot}/nested/run`, past, past)
  const second = await packaged(subject)
  expect(second).toEqual(first)
  expect(readFileSync(subject.archivePath)).toEqual(firstArchive)
  expect([statSync(subject.archivePath).ino, statSync(subject.archivePath).mtimeMs]).toEqual([firstStat.ino, firstStat.mtimeMs])
  expect([statSync(subject.checksumsPath).ino, statSync(subject.checksumsPath).mtimeMs]).toEqual([firstChecksumStat.ino, firstChecksumStat.mtimeMs])
  expect(readdirSync(subject.distRoot).sort()).toEqual(["plugin-0.1.0.checksums.json", "plugin-0.1.0.tar.gz"])
})

test("D03 inventory and archive order use locale-independent code-unit comparison", async () => {
  const subject = fixture({ files: [{ path: "ä-localized.txt", bytes: "ä\n" }, { path: "Z-upper.txt", bytes: "Z\n" }, { path: "a-safe.txt", bytes: "a\n" }] })
  expect(["ä-localized.txt", "a-safe.txt", "Z-upper.txt"].sort((left, right) => left.localeCompare(right))).not.toEqual(["Z-upper.txt", "a-safe.txt", "ä-localized.txt"])
  const result = await packaged(subject)
  expect(result.payload.regularFiles).toEqual(["Z-upper.txt", "a-safe.txt", "ä-localized.txt"])
  expect(readArchiveEntries(readFileSync(subject.archivePath)).map(({ path }) => path)).toEqual([
    "plugin-0.1.0/", "plugin-0.1.0/Z-upper.txt", "plugin-0.1.0/a-safe.txt", "plugin-0.1.0/ä-localized.txt",
  ])
})

test("D04 newline-bearing paths are preserved without line parsing", async () => {
  const subject = fixture({ files: [{ path: "a-safe.txt", bytes: "safe\n" }, { path: "line\nbreak.txt", bytes: "unusual\n" }] })
  const result = await packaged(subject)
  expect(result.payload.regularFiles).toEqual(["a-safe.txt", "line\nbreak.txt"])
  const entries = readArchiveEntries(readFileSync(subject.archivePath))
  expect(entries.map(({ path }) => path)).toContain("plugin-0.1.0/line\nbreak.txt")
  expect(entries.find(({ path }) => path === "plugin-0.1.0/line\nbreak.txt")?.bytes).toEqual(new TextEncoder().encode("unusual\n"))
})

test("D05 the payload digest frames path and body bytes without cross-record ambiguity", async () => {
  const first = fixture({ files: [{ path: "a-safe.txt", bytes: new Uint8Array([0x62, 0, 0x63, 0, 0x64]) }] })
  const second = fixture({ files: [{ path: "a-safe.txt", bytes: new Uint8Array([0x62, 0]) }, { path: "c", bytes: "d" }] })
  expect(first.request.prepared.payloadSha256).not.toBe(second.request.prepared.payloadSha256)
  expect((await packaged(first)).payload.payloadSha256).toBe(first.request.prepared.payloadSha256)
  expect((await packaged(second)).payload.payloadSha256).toBe(second.request.prepared.payloadSha256)
  const rebound = rebind({ ...second.request, prepared: { ...second.request.prepared, payloadSha256: first.request.prepared.payloadSha256 } })
  const third = fixture({ files: [{ path: "a-safe.txt", bytes: new Uint8Array([0x62, 0]) }, { path: "c", bytes: "d" }] })
  expect(await payload().produce({ ...rebound, repositoryRoot: third.root })).toMatchObject({ kind: "refused", code: "payload-digest-mismatch" })
  expect(existsSync(third.distRoot)).toBe(false)
})

test("D06 archive order keeps each directory beside its descendants", async () => {
  const subject = fixture({ files: [{ path: "a-safe.txt", bytes: "safe\n" }, { path: "runtime/a.js", bytes: "runtime\n" }, { path: "runtime.txt", bytes: "sibling\n" }] })
  await packaged(subject)
  expect(readArchiveEntries(readFileSync(subject.archivePath)).map(({ path }) => path)).toEqual([
    "plugin-0.1.0/", "plugin-0.1.0/a-safe.txt", "plugin-0.1.0/runtime/", "plugin-0.1.0/runtime/a.js", "plugin-0.1.0/runtime.txt",
  ])
})

test("D07 the canonical USTAR and gzip bytes reproduce the literal regression digest", async () => {
  const subject = canonicalFixture()
  const result = await packaged(subject)
  const archive = readFileSync(subject.archivePath)
  expect(sha256Hex(archive)).toBe(literalArchiveSha256)
  expect(archive.byteLength).toBe(130)
  expect(result.artifacts.archive).toEqual({ path: subject.archivePath, bytes: 130, sha256: `sha256:${literalArchiveSha256}` })
  const header = Buffer.from(Bun.gunzipSync(archive)).subarray(0, 512)
  const text = (offset: number) => header.subarray(offset, offset + 32).toString("utf8").replace(/\0.*$/su, "")
  expect([text(265), text(297)]).toEqual(["root", "root"])
  expect(Bun.spawnSync({ cmd: ["tar", "-tzf", "-"], stdin: archive, stdout: "pipe", stderr: "pipe" }).stdout.toString()).toBe("plugin-0.1.0/\nplugin-0.1.0/a-safe.txt\n")
})

test("D08 USTAR prefix fields preserve representable long paths", async () => {
  const directory = `nested-${"p".repeat(80)}`
  const file = `${"f".repeat(30)}.txt`
  const subject = fixture({ files: [{ path: "a-safe.txt", bytes: "safe\n" }, { path: `${directory}/${file}`, bytes: "long path\n" }] })
  await packaged(subject)
  const listing = Bun.spawnSync({ cmd: ["tar", "-tzf", "-"], stdin: readFileSync(subject.archivePath), stdout: "pipe", stderr: "pipe" })
  expect(listing.exitCode, listing.stderr.toString()).toBe(0)
  expect(listing.stdout.toString()).toContain(`plugin-0.1.0/${directory}/${file}\n`)
})

test("D09 the checksum document binds the literal identity and projection hashes", async () => {
  const subject = canonicalFixture()
  expect(subject.request.prepared.bindingSha256).toBe("sha256:cc3bd3ccecd6b326f7671ee3001a4a2e04cfb32a0b6947888d5ff4967380dda0")
  expect(subject.request.prepared.payloadSha256).toBe("sha256:6f8f45b87609cfcc4a88b36710a63fc54ef937fd1e80c4a934401ff4ee27943d")
  const result = await packaged(subject)
  const document = readFileSync(subject.checksumsPath, "utf8")
  expect(sha256Hex(document)).toBe("30d323e1218f6deb0a0532a4adec98b43bd7531cc8fe08c45c9535cc91af54ef")
  expect(result.artifacts.checksums).toEqual({ path: subject.checksumsPath, bytes: 758, sha256: "sha256:30d323e1218f6deb0a0532a4adec98b43bd7531cc8fe08c45c9535cc91af54ef" })
  expect(result.bindingSha256).toBe(subject.request.prepared.bindingSha256)
  expect(Object.keys(JSON.parse(document) as Record<string, unknown>)).toEqual([
    "repository", "sourceCommit", "tag", "plugin", "version", "archive", "archiveBytes", "archiveSha256",
    "runtimeLockSha256", "bundleInventorySha256", "payloadInventorySha256", "evidence",
  ])
  expect(JSON.parse(document)).toEqual({
    repository: "https://github.com/myagentdojo/example-plugin.git",
    sourceCommit: "1111111111111111111111111111111111111111",
    tag: "v0.1.0",
    plugin: "plugin",
    version: "0.1.0",
    archive: "plugin-0.1.0.tar.gz",
    archiveBytes: 130,
    archiveSha256: literalArchiveSha256,
    runtimeLockSha256: "f9c51694a2012f55b3e264d97dfc13cb08773246058fa55c018b04fbf41bafce",
    bundleInventorySha256: "2e6177652b3afbe8936573adeabf196351459f36f878f67ea390c59c88a39b43",
    payloadInventorySha256: "6f8f45b87609cfcc4a88b36710a63fc54ef937fd1e80c4a934401ff4ee27943d",
    evidence: "Checksum metadata is integrity evidence for these archive bytes, not independent publisher or builder authenticity.",
  })
  expect(document).not.toContain(result.artifacts.checksums.sha256.slice("sha256:".length))
})

const checksumMutations = [
  ["D10", "repository", "https://github.com/wrong/plugin.git"],
  ["D11", "sourceCommit", "c".repeat(40)],
  ["D12", "tag", "v9.9.9"],
  ["D13", "plugin", "wrong-plugin"],
  ["D14", "version", "9.9.9"],
  ["D15", "archive", "wrong.tar.gz"],
  ["D16", "archiveBytes", 9999],
  ["D17", "archiveSha256", "d".repeat(64)],
  ["D18", "payloadInventorySha256", "f".repeat(64)],
] as const

test.each([...checksumMutations])("%s a mutated existing checksum %s is refused and preserved", async (_case, field, value) => {
  const subject = canonicalFixture()
  await packaged(subject)
  const archive = readFileSync(subject.archivePath)
  const mutated = `${JSON.stringify({ ...JSON.parse(readFileSync(subject.checksumsPath, "utf8")), [field]: value }, null, 2)}\n`
  writeFileSync(subject.checksumsPath, mutated)
  const before = statSync(subject.checksumsPath)
  const result = await payload().produce(subject.request)
  expect(result).toMatchObject({ kind: "refused", code: "output-conflict" })
  if (result.kind === "refused") expect(result.detail).toContain("plugin-0.1.0.checksums.json")
  expect(readFileSync(subject.checksumsPath, "utf8")).toBe(mutated)
  expect(statSync(subject.checksumsPath).ino).toBe(before.ino)
  expect(readFileSync(subject.archivePath)).toEqual(archive)
  expect(readdirSync(subject.distRoot).sort()).toEqual(["plugin-0.1.0.checksums.json", "plugin-0.1.0.tar.gz"])
})

test("D19 a product-only skill change repackages without Kit changes", async () => {
  const subject = fixture({ files: [{ path: "a-safe.txt", bytes: "safe\n" }, { path: "skills/hello/SKILL.md", bytes: "# hello v1\n" }] })
  const first = await packaged(subject)
  writeFileSync(`${subject.pluginRoot}/skills/hello/SKILL.md`, "# hello v2\n")
  const second = await packaged(subject, rebind({ ...redeclare(subject), release: { name: "plugin", version: "0.1.1", tag: "v0.1.1" } }))
  expect(second.payload.payloadSha256).not.toBe(first.payload.payloadSha256)
  expect(second.artifacts.archive.path).toBe(`${subject.distRoot}/plugin-0.1.1.tar.gz`)
  expect(second.artifacts.archive.sha256).not.toBe(first.artifacts.archive.sha256)
  const skill = readArchiveEntries(readFileSync(second.artifacts.archive.path)).find(({ path }) => path === "plugin-0.1.1/skills/hello/SKILL.md")
  expect(skill?.bytes).toEqual(new TextEncoder().encode("# hello v2\n"))
  expect(readdirSync(subject.distRoot).sort()).toEqual(["plugin-0.1.0.checksums.json", "plugin-0.1.0.tar.gz", "plugin-0.1.1.checksums.json", "plugin-0.1.1.tar.gz"])
})

test("D20 an executable-bit-only change keeps the payload digest but changes archive and binding", async () => {
  const plain = fixture({ files: [{ path: "a-safe.txt", bytes: "safe\n" }, { path: "bin/run", bytes: "#!/bin/sh\n" }] })
  const executable = fixture({ files: [{ path: "a-safe.txt", bytes: "safe\n" }, { path: "bin/run", bytes: "#!/bin/sh\n", executable: true }] })
  expect(plain.request.prepared.payloadSha256).toBe(executable.request.prepared.payloadSha256)
  expect(plain.request.prepared.bindingSha256).not.toBe(executable.request.prepared.bindingSha256)
  const first = await packaged(plain)
  const second = await packaged(executable)
  expect(first.payload.payloadSha256).toBe(second.payload.payloadSha256)
  expect(first.bindingSha256).not.toBe(second.bindingSha256)
  expect(first.artifacts.archive.sha256).not.toBe(second.artifacts.archive.sha256)
  expect(readArchiveEntries(readFileSync(plain.archivePath)).find(({ path }) => path === "plugin-0.1.0/bin/run")?.mode).toBe(0o644)
  expect(readArchiveEntries(readFileSync(executable.archivePath)).find(({ path }) => path === "plugin-0.1.0/bin/run")?.mode).toBe(0o755)
})
