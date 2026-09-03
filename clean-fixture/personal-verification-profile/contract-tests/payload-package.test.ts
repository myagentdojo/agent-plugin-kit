import { afterAll, beforeAll, expect, test } from "bun:test"
import { createHash, randomBytes } from "node:crypto"
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createPluginFixture,
  framedPayloadDigest,
  readArchiveEntries,
  rebind,
  redeclare,
  type PluginFixture,
} from "../../../src/modules/plugin-payload-production/contract-tests/fixtures/prepared-plugin-fixture"
import { createAdmittedPackageConsumer, packageArguments, processGuardMs, settleProcess, type AdmittedPackageConsumer, type ProcessResult } from "./adapters/admitted-package-consumer"

let consumer: AdmittedPackageConsumer
const fixtures: PluginFixture[] = []
const fixture = (input: Parameters<typeof createPluginFixture>[0]): PluginFixture => {
  const created = createPluginFixture(input)
  fixtures.push(created)
  return created
}
const requestFile = (subject: PluginFixture, request = subject.request, name = "request.json"): string => {
  const path = join(subject.root, name)
  writeFileSync(path, `${JSON.stringify(request)}\n`)
  return path
}
const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex")

type Envelope = {
  schema_version: number
  status: string
  run_id: string
  data: Record<string, unknown> & { result?: Record<string, unknown> }
}
const successEnvelope = (result: ProcessResult): Envelope => {
  expect(result.exitCode).toBe(0)
  expect(result.stderr).toBe("")
  expect(result.stdout.endsWith("\n")).toBe(true)
  return JSON.parse(result.stdout) as Envelope
}
const refusalEnvelope = (result: ProcessResult, exitCode: number): Record<string, unknown> => {
  expect(result.exitCode).toBe(exitCode)
  expect(result.stdout).toBe("")
  const lines = result.stderr.trim().split("\n")
  const envelope = JSON.parse(lines.at(-1) ?? "{}") as Record<string, unknown>
  for (const line of lines.slice(0, -1)) expect((JSON.parse(line) as { record_type: string }).record_type).toBe("diagnostic")
  return envelope
}

const shared = {
  subject: undefined as PluginFixture | undefined,
  observation: undefined as ProcessResult | undefined,
}
const sharedFiles = [
  { path: ".claude-plugin/plugin.json", bytes: '{"name":"clean-fixture-plugin","version":"1.2.3"}\n' },
  { path: "bin/launch", bytes: "#!/bin/sh\necho launch\n", executable: true },
  { path: "skills/hello/SKILL.md", bytes: "# Hello\n" },
  { path: "z-last.txt", bytes: "last\n", mode: 0o640 },
] as const

beforeAll(() => {
  consumer = createAdmittedPackageConsumer()
  shared.subject = createPluginFixture({ name: "clean-fixture-plugin", version: "1.2.3", files: [...sharedFiles] })
  fixtures.push(shared.subject)
})
afterAll(() => {
  for (const created of fixtures.splice(0)) rmSync(created.root, { recursive: true, force: true })
  consumer?.dispose()
})

const sharedObservation = async (): Promise<{ subject: PluginFixture; observation: ProcessResult }> => {
  const subject = shared.subject
  if (subject === undefined) throw new Error("shared fixture is absent")
  shared.observation ??= await consumer.run(packageArguments("clean-fixture-package", requestFile(subject)))
  return { subject, observation: shared.observation }
}

test("C07 the admitted real process packages a prepared payload with complete evidence", async () => {
  const { subject, observation } = await sharedObservation()
  const envelope = successEnvelope(observation)
  const archive = readFileSync(subject.archivePath)
  const checksums = readFileSync(subject.checksumsPath)
  expect(envelope).toMatchObject({
    schema_version: 1,
    status: "ok",
    run_id: "clean-fixture-package",
    data: {
      contract_id: "agent-plugin-kit.maintenance-command-result",
      result_schema_version: 1,
      command: "payload:package",
      result_code: "completed",
      station_id: "payload-package.completed",
      effect_class: "repository-local",
      transaction_state: "completed",
      retry_safety: "safe",
      completed_effect_ids: ["effect:payload-packaged"],
      remaining_effect_ids: [],
      next_action: { id: "payload-package.inspect-result", action: "inspect_state", commandId: null },
      result: {
        schemaVersion: 1,
        kind: "packaged",
        result: {
          kind: "packaged",
          sourceIdentity: subject.request.sourceIdentity,
          release: { name: "clean-fixture-plugin", version: "1.2.3", tag: "v1.2.3" },
          bindingSha256: subject.request.prepared.bindingSha256,
          payload: { regularFiles: sharedFiles.map(({ path }) => path).sort(), payloadSha256: subject.request.prepared.payloadSha256 },
          artifacts: {
            archive: { path: subject.archivePath, bytes: archive.byteLength, sha256: `sha256:${sha256(archive)}` },
            checksums: { path: subject.checksumsPath, bytes: checksums.byteLength, sha256: `sha256:${sha256(checksums)}` },
          },
        },
      },
    },
  })
  expect(readdirSync(subject.distRoot).sort()).toEqual(["clean-fixture-plugin-1.2.3.checksums.json", "clean-fixture-plugin-1.2.3.tar.gz"])
  expect(readFileSync(join(consumer.consumerRoot, "dist/generated.txt"), "utf8")).toBe("allowed\n")
  const repeat = await consumer.run(packageArguments("clean-fixture-package-repeat", requestFile(subject)))
  expect(successEnvelope(repeat).data.result).toEqual(envelope.data.result)
}, processGuardMs)

test("C01 independent extraction reproduces bytes, modes, and digests", async () => {
  const { subject } = await sharedObservation()
  const archive = readFileSync(subject.archivePath)
  const extracted = mkdtempSync(join(tmpdir(), "agent-plugin-kit-extract-"))
  try {
    const untar = Bun.spawnSync({ cmd: ["tar", "-xpzf", "-", "-C", extracted], stdin: archive, stdout: "pipe", stderr: "pipe" })
    expect(untar.exitCode, untar.stderr.toString()).toBe(0)
    expect(readdirSync(extracted)).toEqual(["clean-fixture-plugin-1.2.3"])
    for (const file of sharedFiles) {
      const path = join(extracted, "clean-fixture-plugin-1.2.3", file.path)
      expect(readFileSync(path, "utf8")).toBe(file.bytes)
      expect(statSync(path).mode & 0o777).toBe("executable" in file && file.executable ? 0o755 : 0o644)
    }
    const entries = readArchiveEntries(archive)
    expect(entries.map(({ path, mode }) => [path, mode])).toEqual([
      ["clean-fixture-plugin-1.2.3/", 0o755],
      ["clean-fixture-plugin-1.2.3/.claude-plugin/", 0o755],
      ["clean-fixture-plugin-1.2.3/.claude-plugin/plugin.json", 0o644],
      ["clean-fixture-plugin-1.2.3/bin/", 0o755],
      ["clean-fixture-plugin-1.2.3/bin/launch", 0o755],
      ["clean-fixture-plugin-1.2.3/skills/", 0o755],
      ["clean-fixture-plugin-1.2.3/skills/hello/", 0o755],
      ["clean-fixture-plugin-1.2.3/skills/hello/SKILL.md", 0o644],
      ["clean-fixture-plugin-1.2.3/z-last.txt", 0o644],
    ])
    expect(entries.every(({ uid, gid, mtime, uname, gname }) => uid === 0 && gid === 0 && mtime === 0 && uname === "root" && gname === "root")).toBe(true)
    const installed = entries.filter(({ type }) => type === "file").map(({ path, bytes }) => ({ path: path.slice("clean-fixture-plugin-1.2.3/".length), bytes }))
    const document = JSON.parse(readFileSync(subject.checksumsPath, "utf8")) as Record<string, unknown>
    expect(document).toMatchObject({
      repository: subject.request.sourceIdentity.repository.origin,
      sourceCommit: subject.request.sourceIdentity.commit,
      tag: "v1.2.3",
      plugin: "clean-fixture-plugin",
      version: "1.2.3",
      archive: "clean-fixture-plugin-1.2.3.tar.gz",
      archiveBytes: archive.byteLength,
      archiveSha256: sha256(archive),
      runtimeLockSha256: sha256(readFileSync(join(subject.root, "runtime/runtime.lock.json"))),
      bundleInventorySha256: sha256(readFileSync(join(subject.root, "runtime/bundle-inventory.json"))),
      payloadInventorySha256: framedPayloadDigest(installed),
    })
  } finally {
    rmSync(extracted, { recursive: true, force: true })
  }
}, processGuardMs)

test("C02 byte corruption of the published archive is detected and preserved", async () => {
  const { subject } = await sharedObservation()
  const original = readFileSync(subject.archivePath)
  const corrupted = Buffer.from(original)
  corrupted[corrupted.byteLength - 20] = (corrupted[corrupted.byteLength - 20] ?? 0) ^ 0xff
  writeFileSync(subject.archivePath, corrupted)
  try {
    const document = JSON.parse(readFileSync(subject.checksumsPath, "utf8")) as { archiveSha256: string }
    expect(sha256(corrupted)).not.toBe(document.archiveSha256)
    const refusal = refusalEnvelope(await consumer.run(packageArguments("clean-fixture-corrupt", requestFile(subject))), 21)
    expect(refusal).toMatchObject({ message: 'Maintenance command failed with result code "command-refused".', data: { station_id: "payload-package.command-refused", transaction_state: "unchanged" } })
    expect(readFileSync(subject.archivePath)).toEqual(corrupted)
  } finally {
    writeFileSync(subject.archivePath, original)
  }
}, processGuardMs)

test("C03 an executable-mode change is visible in the archive and refused against published output", async () => {
  const { subject } = await sharedObservation()
  chmodSync(join(subject.pluginRoot, "z-last.txt"), 0o755)
  try {
    const changed = redeclare(subject)
    expect(changed.prepared.payloadSha256).toBe(subject.request.prepared.payloadSha256)
    expect(changed.prepared.bindingSha256).not.toBe(subject.request.prepared.bindingSha256)
    const conflict = refusalEnvelope(await consumer.run(packageArguments("clean-fixture-mode-conflict", requestFile(subject, changed, "mode-request.json"))), 21)
    expect(conflict).toMatchObject({ data: { station_id: "payload-package.command-refused" } })
    expect(readArchiveEntries(readFileSync(subject.archivePath)).find(({ path }) => path.endsWith("/z-last.txt"))?.mode).toBe(0o644)
    const bumped = rebind({ ...changed, release: { name: "clean-fixture-plugin", version: "1.2.4", tag: "v1.2.4" } })
    successEnvelope(await consumer.run(packageArguments("clean-fixture-mode-bump", requestFile(subject, bumped, "bump-request.json"))))
    expect(readArchiveEntries(readFileSync(join(subject.distRoot, "clean-fixture-plugin-1.2.4.tar.gz"))).find(({ path }) => path.endsWith("/z-last.txt"))?.mode).toBe(0o755)
  } finally {
    chmodSync(join(subject.pluginRoot, "z-last.txt"), 0o640)
  }
}, processGuardMs)

test("C04 a projection hash change is refused before packaging and in a published document", async () => {
  const { subject } = await sharedObservation()
  const lock = join(subject.root, "runtime/runtime.lock.json")
  const originalLock = readFileSync(lock)
  writeFileSync(lock, '{"lock":"drifted"}\n')
  try {
    const stale = refusalEnvelope(await consumer.run(packageArguments("clean-fixture-stale-projection", requestFile(subject))), 21)
    expect(stale).toMatchObject({ data: { station_id: "payload-package.command-refused" } })
  } finally {
    writeFileSync(lock, originalLock)
  }
  const document = readFileSync(subject.checksumsPath, "utf8")
  const mutated = document.replace(/"runtimeLockSha256": "[0-9a-f]{64}"/u, `"runtimeLockSha256": "${"f".repeat(64)}"`)
  expect(mutated).not.toBe(document)
  writeFileSync(subject.checksumsPath, mutated)
  try {
    const conflict = refusalEnvelope(await consumer.run(packageArguments("clean-fixture-projection-conflict", requestFile(subject))), 21)
    expect(conflict).toMatchObject({ data: { station_id: "payload-package.command-refused" } })
    expect(readFileSync(subject.checksumsPath, "utf8")).toBe(mutated)
  } finally {
    writeFileSync(subject.checksumsPath, document)
  }
}, processGuardMs)

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const childrenOf = (pid: number): number[] => {
  const result = Bun.spawnSync({ cmd: ["pgrep", "-P", String(pid)], stdout: "pipe", stderr: "pipe" })
  return result.stdout.toString().split("\n").map((line) => Number.parseInt(line, 10)).filter((value) => Number.isInteger(value))
}
const commandOf = (pid: number): string =>
  Bun.spawnSync({ cmd: ["ps", "-o", "comm=", "-p", String(pid)], stdout: "pipe", stderr: "pipe" }).stdout.toString().trim()
/**
 * The admitted process spawns Git children before it ever compresses, so the
 * compressor is identified by its command name rather than by child order.
 */
const compressorChildOf = (pid: number): number | undefined =>
  childrenOf(pid).find((child) => commandOf(child).split("/").at(-1) === "gzip")
const waitUntil = async (condition: () => boolean, budgetMs: number): Promise<boolean> => {
  const started = performance.now()
  while (performance.now() - started < budgetMs) {
    if (condition()) return true
    await new Promise((done) => setTimeout(done, 2))
  }
  return condition()
}

test("C05 an interrupted process terminates its compressor and the repeat recovers exact output", async () => {
  const large = fixture({ name: "large-plugin", version: "0.0.1", files: [{ path: "blob.bin", bytes: new Uint8Array(randomBytes(16 * 1024 * 1024)) }] })
  const request = requestFile(large)
  const child = Bun.spawn({
    cmd: [consumer.binary, ...packageArguments("clean-fixture-interrupt", request)],
    cwd: consumer.consumerRoot,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: processGuardMs,
    killSignal: "SIGKILL",
  })
  let compressor: number | undefined
  const reached = await waitUntil(() => {
    compressor = compressorChildOf(child.pid)
    return compressor !== undefined
  }, 20_000)
  expect(reached, "the real process must reach its named compressor before interruption").toBe(true)
  if (compressor === undefined) return
  expect(commandOf(compressor).split("/").at(-1), "the interrupted child must be the compressor itself").toBe("gzip")
  expect(alive(compressor)).toBe(true)
  child.kill("SIGTERM")
  await settleProcess(child)
  expect(child.signalCode).toBe("SIGTERM")
  expect(await waitUntil(() => !alive(compressor as number), 2_000)).toBe(true)
  expect(existsSync(large.distRoot) ? readdirSync(large.distRoot) : []).toEqual([])
  const recovered = successEnvelope(await consumer.run(packageArguments("clean-fixture-recover", request)))
  const archive = readFileSync(large.archivePath)
  expect(recovered.data.result).toMatchObject({ result: { artifacts: { archive: { bytes: archive.byteLength, sha256: `sha256:${sha256(archive)}` } } } })
  expect(readdirSync(large.distRoot).sort()).toEqual(["large-plugin-0.0.1.checksums.json", "large-plugin-0.0.1.tar.gz"])
  const blob = readArchiveEntries(archive).find(({ path }) => path === "large-plugin-0.0.1/blob.bin")
  expect(blob !== undefined && Buffer.compare(blob.bytes, large.fileBytes.get("blob.bin") ?? new Uint8Array()) === 0).toBe(true)

  // Harness hygiene only. The named-gzip observation above is the sole evidence that
  // the application cleaned up; terminating a child from the harness proves nothing
  // about the application. Both checks use a short controlled deadline so the
  // accepted 45s default never has to elapse.
  const guardPidPath = join(large.root, "guard.pid")
  const guardStarted = performance.now()
  const guarded = await consumer.run(["-c", `echo $$ > "${guardPidPath}"; exec sleep 8`], { entry: "/bin/sh", timeoutMs: 750 })
  expect(performance.now() - guardStarted, "the outer guard must fire well before the child would finish").toBeLessThan(4_000)
  expect(guarded.exitCode).not.toBe(0)
  const guardedPid = Number.parseInt(readFileSync(guardPidPath, "utf8").trim(), 10)
  expect(await waitUntil(() => !alive(guardedPid), 2_000), "the guard must terminate the real subprocess, not merely stop awaiting it").toBe(true)

  // A surviving grandchild retains the inherited stdout pipe after its parent exits,
  // so settlement is bounded independently of the exit guard.
  const strayPidPath = join(large.root, "stray.pid")
  const settlementStarted = performance.now()
  await expect(consumer.run(["-c", `sleep 8 & echo $! > "${strayPidPath}"; exit 0`], { entry: "/bin/sh" })).rejects.toThrow(/did not settle/u)
  expect(performance.now() - settlementStarted, "a retained pipe must not outlive the settlement bound").toBeLessThan(6_000)
  const strayPid = Number.parseInt(readFileSync(strayPidPath, "utf8").trim(), 10)
  try {
    process.kill(strayPid, "SIGKILL")
  } catch {}
}, processGuardMs)

test("C06 a second product packages through the same process and a Canary-style consumer verifies lineage", async () => {
  const second = fixture({
    name: "second-product",
    version: "2.0.0",
    sourceIdentity: { repository: { origin: "https://github.com/myagentdojo/second-product" }, commit: "2".repeat(40) },
    files: [
      { path: ".codex-plugin/plugin.json", bytes: '{"name":"second-product"}\n' },
      { path: "runtime/bundle-inventory.json", bytes: '{"bundles":["skill-a"]}\n' },
      { path: "runtime/runtime-exec", bytes: "#!/bin/sh\nexec bun \"$@\"\n", executable: true },
      { path: "skills/skill-a/SKILL.md", bytes: "# Skill A\n" },
    ],
    projections: [
      { role: "runtime-lock", path: "runtime/runtime.lock.json", bytes: '{"targets":4}\n' },
      { role: "bundle-inventory", path: "plugin/runtime/bundle-inventory.json", bytes: '{"bundles":["skill-a"]}\n' },
      { role: "native-manifest", path: "plugin/.codex-plugin/plugin.json", bytes: '{"name":"second-product"}\n' },
      { role: "config", path: "plugin.config.json", bytes: '{"name":"second-product","version":"2.0.0"}\n' },
    ],
  })
  const envelope = successEnvelope(await consumer.run(packageArguments("clean-fixture-second", requestFile(second))))
  const archive = readFileSync(second.archivePath)
  const document = JSON.parse(readFileSync(second.checksumsPath, "utf8")) as Record<string, unknown>
  const installRoot = mkdtempSync(join(tmpdir(), "agent-plugin-kit-canary-install-"))
  try {
    expect(Bun.spawnSync({ cmd: ["tar", "-xpzf", "-", "-C", installRoot], stdin: archive, stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0)
    const installed = join(installRoot, "second-product-2.0.0")
    const walk = (directory: string, prefix: string): { path: string; bytes: Uint8Array }[] => readdirSync(directory).sort((left, right) => left < right ? -1 : left > right ? 1 : 0).flatMap((name) => {
      const absolute = join(directory, name)
      const relativePath = prefix === "" ? name : `${prefix}/${name}`
      return lstatSync(absolute).isDirectory() ? walk(absolute, relativePath) : [{ path: relativePath, bytes: new Uint8Array(readFileSync(absolute)) }]
    })
    const installedFiles = walk(installed, "").sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    const installedPayloadSha256 = framedPayloadDigest(installedFiles)
    const identity = {
      repository: "https://github.com/myagentdojo/second-product",
      sourceCommit: "2".repeat(40),
      tag: "v2.0.0",
      plugin: "second-product",
      version: "2.0.0",
      archive: "second-product-2.0.0.tar.gz",
      archiveBytes: archive.byteLength,
      archiveSha256: sha256(archive),
      payloadInventorySha256: installedPayloadSha256,
    }
    for (const [field, value] of Object.entries(identity)) expect(document[field], field).toBe(value)
    expect(envelope.data.result).toMatchObject({ result: { payload: { payloadSha256: `sha256:${installedPayloadSha256}` } } })
    expect(statSync(join(installed, "runtime/runtime-exec")).mode & 0o111).not.toBe(0)
    expect(document.bundleInventorySha256).toBe(sha256(readFileSync(join(installed, "runtime/bundle-inventory.json"))))
  } finally {
    rmSync(installRoot, { recursive: true, force: true })
  }
}, processGuardMs)
