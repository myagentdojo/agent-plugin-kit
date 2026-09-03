import { afterEach, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { PayloadPackageRequest, PayloadProductionResult } from "../interface"
import { createPluginPayloadProduction, type PluginPayloadProductionOptions } from "../implementation/plugin-payload-production"
import {
  createPluginFixture,
  rebind,
  redeclare,
  sha256Hex,
  type PluginFixture,
} from "./fixtures/prepared-plugin-fixture"

const fixtures: PluginFixture[] = []
const barriers: string[] = []
const fixture = (input: Parameters<typeof createPluginFixture>[0] = { files: [{ path: "a-safe.txt", bytes: "safe\n" }] }): PluginFixture => {
  const created = createPluginFixture(input)
  fixtures.push(created)
  return created
}
afterEach(() => {
  for (const created of fixtures.splice(0)) rmSync(created.root, { recursive: true, force: true })
  for (const barrier of barriers.splice(0)) rmSync(barrier, { recursive: true, force: true })
})

const produce = (subject: PluginFixture, options: PluginPayloadProductionOptions = {}, request = subject.request) =>
  createPluginPayloadProduction(options).produce(request)

const expectRefusal = (result: PayloadProductionResult, code: string, detail: RegExp, subject: PluginFixture) => {
  expect(result).toMatchObject({ kind: "refused", code })
  if (result.kind === "refused") expect(result.detail).toMatch(detail)
  expect(existsSync(subject.distRoot)).toBe(false)
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const waitUntil = async (condition: () => boolean, budgetMs: number): Promise<boolean> => {
  const started = performance.now()
  while (performance.now() - started < budgetMs) {
    if (condition()) return true
    await new Promise((done) => setTimeout(done, 5))
  }
  return condition()
}

test("U01 an internal symlink is refused before any output", async () => {
  const subject = fixture()
  symlinkSync("a-safe.txt", join(subject.pluginRoot, "z-internal-link"))
  expectRefusal(await produce(subject), "unsafe-entry", /z-internal-link.*symlink/u, subject)
})

test("U02 an external symlink is refused before any output", async () => {
  const subject = fixture()
  writeFileSync(join(subject.root, "outside.txt"), "outside\n")
  symlinkSync(join(subject.root, "outside.txt"), join(subject.pluginRoot, "z-external-link"))
  expectRefusal(await produce(subject), "unsafe-entry", /z-external-link.*symlink/u, subject)
})

test("U03 a dangling symlink is refused before any output", async () => {
  const subject = fixture()
  symlinkSync("missing.txt", join(subject.pluginRoot, "z-dangling-link"))
  expectRefusal(await produce(subject), "unsafe-entry", /z-dangling-link.*symlink/u, subject)
})

test("U04 a nested symlink escape is refused before any output", async () => {
  const subject = fixture()
  mkdirSync(join(subject.root, "outside"))
  writeFileSync(join(subject.root, "outside", "escaped.txt"), "escaped\n")
  mkdirSync(join(subject.pluginRoot, "nested"))
  symlinkSync(join(subject.root, "outside"), join(subject.pluginRoot, "nested", "z-escape"))
  expectRefusal(await produce(subject), "unsafe-entry", /nested\/z-escape.*symlink/u, subject)
})

test("U05 a Unix-domain socket is refused before any output", async () => {
  const subject = fixture()
  const socketPath = join(subject.pluginRoot, "z-socket")
  const server = createServer()
  try {
    await new Promise<void>((resolveListening, reject) => {
      server.once("error", reject)
      server.listen(socketPath, () => { server.off("error", reject); resolveListening() })
    })
    expectRefusal(await produce(subject), "unsafe-entry", /z-socket.*special file/u, subject)
  } finally {
    if (server.listening) await new Promise<void>((done, reject) => { server.close((error) => (error ? reject(error) : done())) })
  }
})

test("U06 an empty payload directory is refused instead of silently dropped", async () => {
  const subject = fixture()
  mkdirSync(join(subject.pluginRoot, "empty"))
  expectRefusal(await produce(subject), "unsafe-entry", /empty.*empty directory/u, subject)
})

test("U07 an unrepresentable USTAR path component is refused", async () => {
  const subject = fixture({ files: [{ path: "a-safe.txt", bytes: "safe\n" }, { path: "x".repeat(101), bytes: "too long\n" }] })
  expectRefusal(await produce(subject), "unsafe-entry", /USTAR path cannot be represented/u, subject)
})

test("U08 an undeclared regular file is refused", async () => {
  const subject = fixture()
  writeFileSync(join(subject.pluginRoot, "unexpected.extra"), "include me\n")
  expectRefusal(await produce(subject), "undeclared-file", /unexpected\.extra/u, subject)
})

test("U09 a missing declared file is refused", async () => {
  const subject = fixture({ files: [{ path: "a-safe.txt", bytes: "safe\n" }, { path: "gone.txt", bytes: "gone\n" }] })
  unlinkSync(join(subject.pluginRoot, "gone.txt"))
  expectRefusal(await produce(subject), "declared-file-missing", /gone\.txt/u, subject)
})

/**
 * A compressor that announces readiness, then waits for a test-owned barrier
 * file before compressing. It makes the window between the byte snapshot and
 * the pre-publication recheck deterministic without any timed wait.
 */
const barrierCompressor = (subject: PluginFixture): { options: PluginPayloadProductionOptions; started: string; go: string } => {
  const started = join(subject.root, "compressor-started")
  const go = join(subject.root, "compressor-go")
  return {
    started,
    go,
    options: {
      compressor: {
        command: ["sh", "-c", `: > ${JSON.stringify(started)}; while [ ! -f ${JSON.stringify(go)} ]; do sleep 0.01; done; exec gzip -n -9 -c`],
        deadlineMs: 20_000,
      },
    },
  }
}

/** Mutate the source between the snapshot and the recheck, then release the compressor. */
const produceWithMutation = async (
  subject: PluginFixture,
  mutate: () => void,
  request = subject.request,
): Promise<PayloadProductionResult> => {
  const barrier = barrierCompressor(subject)
  const pending = produce(subject, barrier.options, request)
  expect(await waitUntil(() => existsSync(barrier.started), 20_000), "the compressor must start before the source is mutated").toBe(true)
  mutate()
  writeFileSync(barrier.go, "")
  return pending
}

test("U10 bytes or modes changed after preparation are refused, including during compression", async () => {
  const subject = fixture({ files: [{ path: "a-safe.txt", bytes: "safe\n" }, { path: "run", bytes: "#!/bin/sh\n" }] })
  writeFileSync(join(subject.pluginRoot, "a-safe.txt"), "SAFE\n")
  expectRefusal(await produce(subject), "file-mismatch", /a-safe\.txt.*digest/u, subject)
  writeFileSync(join(subject.pluginRoot, "a-safe.txt"), "safe\n")
  chmodSync(join(subject.pluginRoot, "run"), 0o755)
  expectRefusal(await produce(subject), "file-mismatch", /run.*executable/u, subject)
  chmodSync(join(subject.pluginRoot, "run"), 0o644)
  writeFileSync(join(subject.pluginRoot, "a-safe.txt"), "safe!\n")
  expectRefusal(await produce(subject), "file-mismatch", /a-safe\.txt.*bytes/u, subject)
  writeFileSync(join(subject.pluginRoot, "a-safe.txt"), "safe\n")

  const changedBytes = await produceWithMutation(subject, () => {
    writeFileSync(join(subject.pluginRoot, "a-safe.txt"), "changed during compression\n")
  })
  expectRefusal(changedBytes, "file-mismatch", /a-safe\.txt/u, subject)
  writeFileSync(join(subject.pluginRoot, "a-safe.txt"), "safe\n")

  const addedEntry = await produceWithMutation(subject, () => {
    writeFileSync(join(subject.pluginRoot, "added-during-compression.txt"), "new\n")
  })
  expectRefusal(addedEntry, "undeclared-file", /added-during-compression/u, subject)
  rmSync(join(subject.pluginRoot, "added-during-compression.txt"))

  const swapped = fixture({ files: [{ path: "a-safe.txt", bytes: "safe\n" }, { path: "nested/leaf.txt", bytes: "leaf\n" }] })
  const swappedAway = join(swapped.root, "moved-nested")
  const swappedEntry = await produceWithMutation(swapped, () => {
    renameSync(join(swapped.pluginRoot, "nested"), swappedAway)
    symlinkSync(swappedAway, join(swapped.pluginRoot, "nested"))
  })
  expectRefusal(swappedEntry, "unsafe-entry", /nested.*symlink/u, swapped)
}, 60_000)

test("U11 a source identity disagreeing with the preparation is refused", async () => {
  const subject = fixture()
  const mismatched = { ...subject.request, sourceIdentity: { ...subject.request.sourceIdentity, commit: "2".repeat(40) } }
  expectRefusal(await produce(subject, {}, mismatched), "source-identity-mismatch", /sourceIdentity/u, subject)
  const forgedOrigin = { ...subject.request, prepared: { ...subject.request.prepared, sourceIdentity: { repository: { origin: "https://github.com/other/plugin.git" }, commit: subject.request.sourceIdentity.commit } } }
  expectRefusal(await produce(subject, {}, forgedOrigin), "source-identity-mismatch", /sourceIdentity/u, subject)
  const staleBinding = { ...subject.request, release: { ...subject.request.release, version: "0.1.0", tag: "v0.1.0", name: "renamed" } }
  expectRefusal(await produce(subject, {}, staleBinding), "binding-mismatch", /bindingSha256/u, subject)
})

test("U12 a stale projection digest is refused", async () => {
  const subject = fixture()
  writeFileSync(join(subject.root, "runtime", "runtime.lock.json"), '{"lock":"changed"}\n')
  expectRefusal(await produce(subject), "projection-mismatch", /runtime\.lock\.json/u, subject)
  writeFileSync(join(subject.root, "runtime", "runtime.lock.json"), '{"lock":"fixture"}\n')
  const inside = fixture({
    files: [{ path: "a-safe.txt", bytes: "safe\n" }, { path: "runtime/bundle-inventory.json", bytes: '{"bundles":["x"]}\n' }],
    projections: [
      { role: "runtime-lock", path: "runtime/runtime.lock.json", bytes: '{"lock":"fixture"}\n' },
      { role: "bundle-inventory", path: "plugin/runtime/bundle-inventory.json", bytes: '{"bundles":["x"]}\n' },
    ],
  })
  expect(await produce(inside)).toMatchObject({ kind: "packaged" })
  const escaped = { ...subject.request, prepared: { ...subject.request.prepared, projections: subject.request.prepared.projections.map((projection) => projection.role === "runtime-lock" ? { ...projection, path: "../runtime.lock.json" } : projection) } }
  expectRefusal(await produce(subject, {}, rebind(escaped)), "declaration-invalid", /unsafe projection path/u, subject)

  const ancestor = fixture()
  const outside = join(ancestor.root, "outside-runtime")
  renameSync(join(ancestor.root, "runtime"), outside)
  symlinkSync(outside, join(ancestor.root, "runtime"))
  expect(statSync(join(ancestor.root, "runtime/runtime.lock.json")).isFile(), "the symlinked ancestor must still carry a regular leaf").toBe(true)
  expectRefusal(await produce(ancestor), "unsafe-entry", /^runtime\/[a-z-]+\.json: path component "runtime" is a symlink$/u, ancestor)
})

test("U13 a failing compressor reports no publication and leaves no descendant", async () => {
  const subject = fixture()
  const marker = join(subject.root, "compressor-calls")
  const result = await produce(subject, { compressor: { command: ["sh", "-c", `echo called >> ${JSON.stringify(marker)}; exit 3`], deadlineMs: 5_000 } })
  expect(readFileSync(marker, "utf8")).toBe("called\n")
  expect(result).toEqual({
    kind: "failed",
    code: "compressor-failed",
    publication: "none",
    transient: false,
    artifacts: { archive: null, checksums: null },
    nextAction: "Inspect the host gzip, then repeat payload:package.",
  })
  expect(existsSync(subject.distRoot)).toBe(false)

  const survivor = fixture()
  const pidPath = join(survivor.root, "descendant.pid")
  const detached = `/bin/sleep 30 >/dev/null 2>&1 </dev/null & echo $! > ${JSON.stringify(pidPath)}`
  const withDescendant = await produce(survivor, { compressor: { command: ["sh", "-c", `${detached}; exit 4`], deadlineMs: 5_000 } })
  expect(withDescendant).toMatchObject({ kind: "failed", code: "compressor-failed", publication: "none" })
  const descendant = Number(readFileSync(pidPath, "utf8"))
  expect(Number.isInteger(descendant), "the failing compressor must have spawned an observable descendant").toBe(true)
  expect(await waitUntil(() => !alive(descendant), 2_000), "a descendant of a failed compressor must be reaped").toBe(true)
  expect(existsSync(survivor.distRoot)).toBe(false)
})

test("U14 a compressor past its deadline is killed and reported without publication", async () => {
  const subject = fixture()
  const pidPath = join(subject.root, "compressor.pid")
  const started = performance.now()
  const result = await produce(subject, { compressor: { command: ["sh", "-c", `echo $$ > ${JSON.stringify(pidPath)}; exec /bin/sleep 30`], deadlineMs: 200 } })
  const elapsed = performance.now() - started
  expect(result).toMatchObject({ kind: "failed", code: "compressor-deadline", publication: "none", transient: false, artifacts: { archive: null, checksums: null } })
  expect(elapsed).toBeGreaterThanOrEqual(200)
  expect(elapsed).toBeLessThan(5_000)
  const pid = Number(readFileSync(pidPath, "utf8"))
  expect(Number.isInteger(pid)).toBe(true)
  expect(await waitUntil(() => !alive(pid), 2_000)).toBe(true)
  expect(existsSync(subject.distRoot)).toBe(false)
})

test("U15 a descendant retaining the compressor descriptor is reaped with the group", async () => {
  const subject = fixture()
  const childPath = join(subject.root, "descendant.pid")
  const result = await produce(subject, { compressor: { command: ["sh", "-c", `/bin/sleep 30 & echo $! > ${JSON.stringify(childPath)}; exit 0`], deadlineMs: 300 } })
  expect(result).toMatchObject({ kind: "failed", code: "compressor-deadline", publication: "none" })
  const descendant = Number(readFileSync(childPath, "utf8"))
  expect(Number.isInteger(descendant)).toBe(true)
  expect(await waitUntil(() => !alive(descendant), 2_000)).toBe(true)
  expect(existsSync(subject.distRoot)).toBe(false)
})

test("U16 an archive-only interruption is reported and the repeat completes safely", async () => {
  const subject = fixture()
  const interrupted = await produce(subject, { interrupt: (point) => { if (point === "archive-published") throw new Error("injected interruption") } })
  expect(interrupted).toMatchObject({ kind: "failed", code: "publication-interrupted", publication: "archive-only", transient: false })
  if (interrupted.kind !== "failed") return
  const archive = readFileSync(subject.archivePath)
  expect(interrupted.artifacts).toEqual({ archive: { path: subject.archivePath, bytes: archive.byteLength, sha256: `sha256:${sha256Hex(archive)}` }, checksums: null })
  expect(readdirSync(subject.distRoot)).toEqual(["plugin-0.1.0.tar.gz"])
  const archiveInode = statSync(subject.archivePath).ino
  const completed = await produce(subject)
  expect(completed).toMatchObject({ kind: "packaged", artifacts: { archive: interrupted.artifacts.archive } })
  expect(statSync(subject.archivePath).ino).toBe(archiveInode)
  expect(readdirSync(subject.distRoot).sort()).toEqual(["plugin-0.1.0.checksums.json", "plugin-0.1.0.tar.gz"])
  const stagedInterruption = await produce(fixture(), { interrupt: (point) => { if (point === "staged") throw new Error("injected staging fault") } })
  expect(stagedInterruption).toMatchObject({ kind: "failed", code: "staging-failed", publication: "none", artifacts: { archive: null, checksums: null } })

  // A checksum link that fails for a reason other than an existing file, after
  // the archive is already published, must report the archive it published.
  const linkFault = fixture()
  const linkFaulted = await produce(linkFault, {
    interrupt: (point) => {
      if (point !== "archive-published") return
      const staging = readdirSync(linkFault.distRoot).find((entry) => entry.startsWith(".agent-plugin-kit-"))
      if (staging === undefined) throw new Error("staging directory is absent")
      const staged = join(linkFault.distRoot, staging, "plugin-0.1.0.checksums.json")
      rmSync(staged)
      mkdirSync(staged)
    },
  })
  const publishedArchive = readFileSync(linkFault.archivePath)
  expect(linkFaulted).toEqual({
    kind: "failed",
    code: "publication-interrupted",
    publication: "archive-only",
    transient: false,
    artifacts: {
      archive: { path: linkFault.archivePath, bytes: publishedArchive.byteLength, sha256: `sha256:${sha256Hex(publishedArchive)}` },
      checksums: null,
    },
    nextAction: "Repeat payload:package to complete the checksum publication for the published archive.",
  })
  expect(readdirSync(linkFault.distRoot)).toEqual(["plugin-0.1.0.tar.gz"])
  expect(await produce(linkFault)).toMatchObject({ kind: "packaged" })

  // An artifact that cannot be reread is unknown publication, not unchanged.
  const unreadable = fixture()
  const unobservable = await produce(unreadable, {
    interrupt: (point) => {
      if (point === "archive-published") chmodSync(unreadable.archivePath, 0o000)
    },
  })
  try {
    expect(unobservable).toMatchObject({ kind: "failed", code: "publication-unobservable", publication: "unknown" })
    if (unobservable.kind === "failed") {
      expect(unobservable.artifacts.archive).toBeNull()
      expect(unobservable.artifacts.checksums).not.toBeNull()
    }
    expect(readdirSync(unreadable.distRoot).sort()).toEqual(["plugin-0.1.0.checksums.json", "plugin-0.1.0.tar.gz"])
  } finally {
    chmodSync(unreadable.archivePath, 0o644)
  }
})

/**
 * Release two real packaging processes into the same no-replace publication
 * window. Each child stages, announces readiness, and blocks on the barrier, so
 * both reach the link with the output still absent. Bounds stop a stuck child;
 * they are not the observation.
 */
const concurrentPublication = async (
  subject: PluginFixture,
  requests: readonly [PayloadPackageRequest, PayloadPackageRequest],
): Promise<readonly [PayloadProductionResult, PayloadProductionResult]> => {
  const barrier = mkdtempSync(join(tmpdir(), "agent-plugin-kit-barrier-"))
  barriers.push(barrier)
  const child = resolve(import.meta.dir, "adapters/concurrent-publication-child.ts")
  const spawned = requests.map((request, index) => {
    const requestPath = join(barrier, `request-${index}.json`)
    writeFileSync(requestPath, JSON.stringify(request))
    return Bun.spawn({
      cmd: ["bun", child, requestPath, barrier, String(index)],
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
  })
  const staged = await waitUntil(
    () => spawned.every((_, index) => existsSync(join(barrier, `staged-${index}`))),
    30_000,
  )
  expect(staged, "both attempts must be staged before either publishes").toBe(true)
  expect(existsSync(join(subject.distRoot, "plugin-0.1.0.tar.gz")), "no artifact may be published before the barrier").toBe(false)
  writeFileSync(join(barrier, "go"), "")
  const settled = await Promise.all(spawned.map(async (process) => {
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ])
    expect(exitCode, `concurrent publication child failed: ${stderr}`).toBe(0)
    return JSON.parse(stdout) as PayloadProductionResult
  }))
  const [first, second] = settled
  if (first === undefined || second === undefined) throw new Error("concurrent publication produced no results")
  return [first, second]
}

test("U17 concurrent identical publications converge on one artifact set", async () => {
  const subject = fixture()
  const [first, second] = await concurrentPublication(subject, [subject.request, subject.request])
  expect(first).toMatchObject({ kind: "packaged" })
  expect(second).toEqual(first)
  expect(readdirSync(subject.distRoot).sort()).toEqual(["plugin-0.1.0.checksums.json", "plugin-0.1.0.tar.gz"])
  const archive = readFileSync(subject.archivePath)
  if (first.kind === "packaged") {
    expect(first.artifacts.archive.sha256).toBe(`sha256:${sha256Hex(archive)}`)
    expect(first.artifacts.checksums.sha256).toBe(`sha256:${sha256Hex(readFileSync(subject.checksumsPath))}`)
  }
}, 60_000)

test("U18 a conflicting candidate preserves the winner and refuses the loser", async () => {
  const subject = fixture()
  const other = rebind({
    ...subject.request,
    sourceIdentity: { ...subject.request.sourceIdentity, commit: "2".repeat(40) },
    prepared: { ...subject.request.prepared, sourceIdentity: { ...subject.request.sourceIdentity, commit: "2".repeat(40) } },
  })
  const outcomes = await concurrentPublication(subject, [subject.request, other])
  const winners = outcomes.filter((outcome) => outcome.kind === "packaged")
  const losers = outcomes.filter((outcome) => outcome.kind === "refused")
  expect(winners).toHaveLength(1)
  expect(losers).toHaveLength(1)
  expect(losers[0]).toMatchObject({ kind: "refused", code: "output-conflict" })
  const document = JSON.parse(readFileSync(subject.checksumsPath, "utf8")) as { sourceCommit: string }
  const winner = winners[0]
  const publishedArchive = readFileSync(subject.archivePath)
  if (winner?.kind === "packaged") {
    expect(document.sourceCommit).toBe(winner.sourceIdentity.commit)
    expect(winner.artifacts.checksums.sha256).toBe(`sha256:${sha256Hex(readFileSync(subject.checksumsPath))}`)
    expect(winner.artifacts.archive.sha256).toBe(`sha256:${sha256Hex(publishedArchive)}`)
  }
  // The surviving pair belongs to one candidate: the published document names
  // the archive that is actually on disk, so no attempt replaced the other's.
  expect((JSON.parse(readFileSync(subject.checksumsPath, "utf8")) as { archiveSha256: string }).archiveSha256)
    .toBe(sha256Hex(publishedArchive))
  expect(readdirSync(subject.distRoot).sort()).toEqual(["plugin-0.1.0.checksums.json", "plugin-0.1.0.tar.gz"])
  const preservedArchive = readFileSync(subject.archivePath)
  writeFileSync(join(subject.pluginRoot, "a-safe.txt"), "different\n")
  const sequential = await produce(subject, {}, redeclare(subject))
  expect(sequential).toMatchObject({ kind: "refused", code: "output-conflict" })
  if (sequential.kind === "refused") expect(sequential.detail).toContain("plugin-0.1.0.tar.gz")
  expect(readFileSync(subject.archivePath)).toEqual(preservedArchive)
  expect(readdirSync(subject.distRoot).sort()).toEqual(["plugin-0.1.0.checksums.json", "plugin-0.1.0.tar.gz"])
}, 60_000)
