import { afterEach, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { observeSourceCheckout } from "../implementation/source-checkout-observation"
import { admissionBootstrap } from "../../../admission-bootstrap/implementation/admission-bootstrap"

const roots: string[] = []
const origin = "https://github.com/myagentdojo/agent-plugin-kit.git"
type ObservationHasNoRequest = "request" extends keyof Parameters<typeof observeSourceCheckout>[0] ? false : true
const observationHasNoRequest: ObservationHasNoRequest = true

function git(root: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
  return new TextDecoder().decode(result.stdout).trim()
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agent-plugin-kit-source-checkout-test-"))
  roots.push(root)
  const kit = join(root, "kit")
  const consumer = join(root, "consumer")
  await mkdir(kit, { recursive: true })
  git(kit, "init", "-q")
  await writeFile(join(kit, "package.json"), JSON.stringify({ name: "agent-plugin-kit", repository: { url: origin } }) + "\n")
  await writeFile(join(kit, "entry.ts"), "export const entry = true\n")
  git(kit, "add", "package.json", "entry.ts")
  git(kit, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "kit")
  const commit = git(kit, "rev-parse", "HEAD")
  await mkdir(join(consumer, "node_modules"), { recursive: true })
  git(consumer, "init", "-q")
  await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "consumer", dependencies: { "agent-plugin-kit": `git+${origin}#${commit}` } }) + "\n")
  await writeFile(join(consumer, ".gitignore"), "node_modules\ndist\n")
  await mkdir(join(consumer, "dist"), { recursive: true })
  await writeFile(join(consumer, "dist", "generated.txt"), "allowed\n")
  await symlink(kit, join(consumer, "node_modules", "agent-plugin-kit"))
  git(consumer, "add", "package.json", ".gitignore")
  git(consumer, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "consumer")
  return { kit, consumer, entry: join(kit, "entry.ts"), commit }
}

function observe(entryPath: string, cwd: string, PATH = process.env.PATH): ReturnType<typeof observeSourceCheckout> {
  return observeSourceCheckout({ entryPath, cwd, environment: { PATH } })
}
async function observeInChild(entryPath: string, cwd: string, PATH: string): Promise<ReturnType<typeof observeSourceCheckout>> {
  const source = `import { observeSourceCheckout } from ${JSON.stringify(import.meta.resolve("../implementation/source-checkout-observation"))}; console.log(JSON.stringify(observeSourceCheckout({ entryPath: ${JSON.stringify(entryPath)}, cwd: ${JSON.stringify(cwd)}, environment: { PATH: ${JSON.stringify(PATH)} } })))`
  const child = Bun.spawn({ cmd: ["bun", "-e", source], cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const timeout = setTimeout(() => child.kill("SIGKILL"), 12_000)
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  clearTimeout(timeout)
  if (exitCode !== 0 || stderr !== "") throw new Error("isolated observer did not settle")
  return JSON.parse(stdout) as ReturnType<typeof observeSourceCheckout>
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

test("F01 a clean linked checkout observes the literal request that Admission admits", async () => {
  const value = await fixture()
  const result = observe(value.entry, value.consumer)
  expect(result).toEqual({ kind: "observed", request: {
    candidate: { source: { repository: { origin }, commit: value.commit }, package: { repository: { origin }, commit: value.commit } },
    repository: { origin }, provenance: { repository: { origin }, commit: value.commit }, source: { repository: { origin }, commit: value.commit }, package: { repository: { origin }, commit: value.commit },
  } })
  if (result.kind === "observed") expect(admissionBootstrap.admitSourceCheckout(result.request).kind).toBe("admitted")
  const worktree = join(roots.at(-1) ?? value.kit, "linked-worktree")
  git(value.kit, "worktree", "add", "--detach", "-q", worktree, value.commit)
  await rm(join(value.consumer, "node_modules", "agent-plugin-kit")); await symlink(worktree, join(value.consumer, "node_modules", "agent-plugin-kit"))
  expect(observe(join(worktree, "entry.ts"), value.consumer)).toMatchObject({ kind: "observed", request: { source: { commit: value.commit } } })
})

test("F02 dirty tracked and untracked Kit files refuse while ignored files and restoration remain clean", async () => {
  const value = await fixture()
  await writeFile(value.entry, "changed\n")
  expect(observe(value.entry, value.consumer)).toEqual({ kind: "refused", code: "source-tree-dirty" })
  await writeFile(value.entry, "export const entry = true\n")
  await writeFile(join(value.kit, "untracked.ts"), "dirty\n")
  expect(observe(value.entry, value.consumer)).toEqual({ kind: "refused", code: "source-tree-dirty" })
  await rm(join(value.kit, "untracked.ts")); await writeFile(join(value.kit, ".gitignore"), "ignored.ts\n"); git(value.kit, "add", ".gitignore"); git(value.kit, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "ignore")
  await writeFile(join(value.kit, "ignored.ts"), "ignored\n")
  expect(observe(value.entry, value.consumer).kind).toBe("observed")
})

test("F03 link, copied checkout, and worktree mismatches refuse physical resolution", async () => {
  const value = await fixture()
  const copy = join(value.kit, "copy")
  await mkdir(copy); await writeFile(join(copy, "package.json"), JSON.stringify({ name: "agent-plugin-kit" })); await writeFile(join(copy, "entry.ts"), "copy\n")
  expect(observe(join(copy, "entry.ts"), value.consumer)).toEqual({ kind: "refused", code: "checkout-toplevel-mismatch" })
  await rm(copy, { recursive: true })
  const redirected = join(value.kit, "redirected"); await mkdir(redirected); git(value.kit, "config", "core.worktree", redirected)
  expect(observe(value.entry, value.consumer)).toEqual({ kind: "refused", code: "checkout-toplevel-mismatch" })
  git(value.kit, "config", "--unset", "core.worktree")
  const other = join(value.consumer, "other"); await mkdir(other); await rm(join(value.consumer, "node_modules", "agent-plugin-kit")); await symlink(other, join(value.consumer, "node_modules", "agent-plugin-kit"))
  expect(observe(value.entry, value.consumer)).toEqual({ kind: "refused", code: "consumer-link-mismatch" })
})

test("F04 committed consumer authority outranks working files and malformed pins", async () => {
  const value = await fixture()
  git(value.consumer, "rm", "--cached", "-q", "package.json")
  expect(observe(value.entry, value.consumer)).toEqual({ kind: "refused", code: "consumer-authority-dirty" })
  git(value.consumer, "add", "package.json")
  await writeFile(join(value.consumer, "package.json"), JSON.stringify({ dependencies: { "agent-plugin-kit": `git+${origin}#${"e".repeat(40)}` } }))
  expect(observe(value.entry, value.consumer)).toEqual({ kind: "refused", code: "consumer-authority-dirty" })
  await rm(join(value.consumer, "package.json")); expect(observe(value.entry, value.consumer)).toEqual({ kind: "refused", code: "consumer-authority-dirty" })
  await writeFile(join(value.consumer, "package.json"), JSON.stringify({ dependencies: { "agent-plugin-kit": "link:../kit" } })); git(value.consumer, "add", "package.json"); git(value.consumer, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "missing")
  expect(observe(value.entry, value.consumer)).toEqual({ kind: "refused", code: "consumer-pin-missing" })
  await writeFile(join(value.consumer, "package.json"), JSON.stringify({ dependencies: { "agent-plugin-kit": `git+${origin}#short` } })); git(value.consumer, "add", "package.json"); git(value.consumer, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "invalid")
  expect(observe(value.entry, value.consumer)).toEqual({ kind: "refused", code: "consumer-pin-invalid" })
  await writeFile(join(value.consumer, "package.json"), JSON.stringify({ dependencies: { "agent-plugin-kit": `git+${origin}#main` } })); git(value.consumer, "add", "package.json"); git(value.consumer, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "branch")
  expect(observe(value.entry, value.consumer)).toEqual({ kind: "refused", code: "consumer-pin-invalid" })
  const foreignOrigin = "https://github.com/example/foreign.git"
  await writeFile(join(value.consumer, "package.json"), JSON.stringify({ dependencies: { "agent-plugin-kit": `git+${foreignOrigin}#${"e".repeat(40)}` } })); git(value.consumer, "add", "package.json"); git(value.consumer, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "different")
  const observed = observe(value.entry, value.consumer)
  expect(observed).toMatchObject({ kind: "observed", request: { repository: { origin: foreignOrigin }, source: { commit: "e".repeat(40) } } })
  if (observed.kind === "observed") expect(admissionBootstrap.admitSourceCheckout(observed.request)).toMatchObject({ kind: "refused", refusal: { code: "repository-mismatch" } })
  await writeFile(join(value.consumer, "package.json"), JSON.stringify({ dependencies: { "agent-plugin-kit": `git+${origin}#${"e".repeat(40)}` } })); git(value.consumer, "add", "package.json"); git(value.consumer, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "different-same-origin")
  const differentCommit = observe(value.entry, value.consumer)
  expect(differentCommit).toMatchObject({ kind: "observed", request: { repository: { origin }, source: { commit: "e".repeat(40) } } })
  if (differentCommit.kind === "observed") expect(admissionBootstrap.admitSourceCheckout(differentCommit.request)).toMatchObject({ kind: "refused", refusal: { code: "source-pin-mismatch" } })
  await writeFile(join(value.consumer, "package.json"), JSON.stringify({ name: "consumer" })); git(value.consumer, "add", "package.json"); git(value.consumer, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "remove-manifest-authority")
  await writeFile(join(value.consumer, "package.json"), JSON.stringify({ name: "consumer" }))
  expect(observe(value.entry, value.consumer)).toEqual({ kind: "refused", code: "consumer-pin-missing" })
  const outside = join(roots.at(-1) ?? value.consumer, "outside"); await mkdir(outside)
  expect(observe(value.entry, outside)).toEqual({ kind: "refused", code: "consumer-root-unresolved" })
  git(value.consumer, "rm", "-q", "package.json"); git(value.consumer, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "manifest-absent")
  await writeFile(join(value.consumer, "package.json"), JSON.stringify({ name: "consumer" }))
  expect(observe(value.entry, value.consumer)).toEqual({ kind: "refused", code: "consumer-manifest-uncommitted" })
}, 15_000)

test("F05 symlink entry and outside entry retain physical checkout boundaries", async () => {
  const value = await fixture()
  const linked = join(value.consumer, "entry-link.ts"), chained = join(value.consumer, "entry-chain.ts"); await symlink(value.entry, linked); await symlink(linked, chained)
  expect(observe(chained, value.consumer).kind).toBe("observed")
  await writeFile(join(value.kit, ".gitignore"), "ignored-entry.ts\n"); git(value.kit, "add", ".gitignore"); git(value.kit, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "ignore-entry")
  await writeFile(join(value.kit, "ignored-entry.ts"), "ignored\n")
  expect(observe(join(value.kit, "ignored-entry.ts"), value.consumer)).toEqual({ kind: "refused", code: "entry-outside-checkout" })
  const nested = join(value.kit, "nested"); await mkdir(nested); await writeFile(join(nested, "package.json"), JSON.stringify({ name: "agent-plugin-kit", repository: { url: origin } })); await writeFile(join(nested, "entry.ts"), "nested\n"); git(value.kit, "add", "nested"); git(value.kit, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "nested")
  expect(observe(join(nested, "entry.ts"), value.consumer)).toEqual({ kind: "refused", code: "checkout-toplevel-mismatch" })
})

test("F06 bounded scrubbed Git and request-independent observation remain controlled", async () => {
  const value = await fixture()
  expect(observe(value.entry, value.consumer, "/missing-git")).toEqual({ kind: "refused", code: "git-unavailable" })
  const lateFailureShim = join(value.consumer, "late-failure-shim"), lateFailureCount = join(value.consumer, "late-failure-count")
  await mkdir(lateFailureShim); await writeFile(join(lateFailureShim, "git"), `#!/bin/sh\ncount=0\nif test -f ${JSON.stringify(lateFailureCount)}; then read count < ${JSON.stringify(lateFailureCount)}; fi\ncount=$((count + 1))\necho "$count" > ${JSON.stringify(lateFailureCount)}\nif test "$count" -ge 3; then exit 7; fi\nexec /usr/bin/git "$@"\n`); await chmod(join(lateFailureShim, "git"), 0o755)
  expect(observe(value.entry, value.consumer, lateFailureShim)).toEqual({ kind: "refused", code: "git-unavailable" })
  const first = observe(value.entry, value.consumer)
  const requestOne = join(value.consumer, "request-one.json"), requestTwo = join(value.consumer, "request-two.json")
  await writeFile(requestOne, JSON.stringify({ sourceIdentity: "first" })); await writeFile(requestTwo, JSON.stringify({ sourceIdentity: "second" }))
  expect(observationHasNoRequest).toBeTrue()
  expect(observe(value.entry, value.consumer)).toEqual(first)
  const decoy = join(value.consumer, "decoy"); await mkdir(decoy); git(decoy, "init", "-q")
  expect(observeSourceCheckout({ entryPath: value.entry, cwd: value.consumer, environment: { PATH: process.env.PATH, GIT_DIR: join(decoy, ".git"), GIT_WORK_TREE: decoy, GIT_CONFIG_GLOBAL: join(decoy, "config"), GIT_CEILING_DIRECTORIES: decoy } })).toEqual(first)
})

test("F07 bounded Git timeout kills its child and restoration remains clean", async () => {
  const value = await fixture()
  const first = observe(value.entry, value.consumer)
  const shim = join(value.consumer, "shim"), pidPath = join(value.consumer, "shim.pid"); await mkdir(shim); const shimGit = join(shim, "git"); await writeFile(shimGit, `#!/bin/sh\necho $$ > ${JSON.stringify(pidPath)}\nexec /bin/sleep 11\n`); await chmod(shimGit, 0o755)
  const started = performance.now()
  expect(await observeInChild(value.entry, value.consumer, shim)).toEqual({ kind: "refused", code: "git-unavailable" })
  expect(performance.now() - started).toBeGreaterThanOrEqual(9_000)
  const pid = Number(await readFile(pidPath, "utf8")); expect(Number.isInteger(pid)).toBeTrue()
  expect(() => process.kill(pid, 0)).toThrow()
  expect(observe(value.entry, value.consumer)).toEqual(first)
}, 15_000)
