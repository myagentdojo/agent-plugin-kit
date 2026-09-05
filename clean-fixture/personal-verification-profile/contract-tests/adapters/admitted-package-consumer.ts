import { chmodSync, cpSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

/**
 * One admitted Plugin Consumer: a clean committed clone of this checkout,
 * including uncommitted work, linked from a separate consumer Git repository
 * whose committed root manifest pins the clone commit. The real public
 * process runs from the consumer root, so Source Checkout Admission is real.
 */
export type AdmittedPackageConsumer = {
  fixtureRoot: string
  kitRoot: string
  consumerRoot: string
  kitCommit: string
  binary: string
  commitAuthority(commit: string): void
  run(args: readonly string[], options?: { cwd?: string; environment?: Record<string, string | undefined>; entry?: string; timeoutMs?: number }): Promise<ProcessResult>
  runSync(args: readonly string[], options?: { cwd?: string; environment?: Record<string, string | undefined>; entry?: string; timeoutMs?: number }): ProcessResult & { signalCode: string | null }
  dispose(): void
}

export type ProcessResult = { exitCode: number; stdout: string; stderr: string }

export const kitOrigin = "https://github.com/myagentdojo/agent-plugin-kit.git"
const repositoryRoot = resolve(import.meta.dir, "../../../..")

const fixtureCommitter = ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid"] as const

export function git(root: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
  return new TextDecoder().decode(result.stdout).trim()
}

const gitCommit = (root: string, message: string): void => {
  git(root, ...fixtureCommitter, "commit", "--allow-empty", "-qm", message)
}

/** Clone the checkout, then carry every tracked change and untracked non-ignored file into one commit. */
const cloneWorkingTree = (kitRoot: string, fixtureRoot: string): string => {
  const clone = Bun.spawnSync(["git", "clone", "--quiet", repositoryRoot, kitRoot], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  if (clone.exitCode !== 0) throw new Error(new TextDecoder().decode(clone.stderr))
  const patch = Bun.spawnSync(["git", "-C", repositoryRoot, "diff", "--binary", "HEAD"], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  if (patch.exitCode !== 0) throw new Error(new TextDecoder().decode(patch.stderr))
  if (patch.stdout.byteLength > 0) {
    const patchPath = join(fixtureRoot, "working-tree.patch")
    writeFileSync(patchPath, patch.stdout)
    git(kitRoot, "apply", "--binary", patchPath)
  }
  const untracked = git(repositoryRoot, "ls-files", "--others", "--exclude-standard", "-z").split("\0").filter((path) => path !== "")
  for (const file of untracked) {
    const target = join(kitRoot, file)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(repositoryRoot, file), target)
  }
  git(kitRoot, "add", "--all")
  gitCommit(kitRoot, "candidate")
  const install = Bun.spawnSync(["bun", "install", "--frozen-lockfile"], { cwd: kitRoot, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  if (install.exitCode !== 0) throw new Error(new TextDecoder().decode(install.stderr))
  return git(kitRoot, "rev-parse", "HEAD")
}

const streamText = (stream: unknown): Promise<string> =>
  stream instanceof ReadableStream ? new Response(stream).text() : Promise.resolve("")

/** Accepted outer process guard for one real admitted process. */
export const processGuardMs = 45_000
/**
 * Exit and stream settlement are separate claims: a killed child closes its own
 * descriptors, but a surviving grandchild keeps the inherited pipe open, so an
 * unbounded drain outlives the guard. This bounds only that drain.
 */
const streamSettlementMs = 2_000

/**
 * Await one already-spawned child within a bounded settlement window. Killing a
 * child is harness hygiene, never evidence that the application released its own
 * resources; a stuck stream is surfaced as a named failure rather than a hang.
 */
export const settleProcess = async (child: ReturnType<typeof Bun.spawn>): Promise<ProcessResult> => {
  const streams = { stdout: streamText(child.stdout), stderr: streamText(child.stderr) }
  const exitCode = await child.exited
  let expiry: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<"expired">((settle) => {
    expiry = setTimeout(() => settle("expired"), streamSettlementMs)
  })
  try {
    const settled = await Promise.race([Promise.all([streams.stdout, streams.stderr]), expired])
    if (settled === "expired") {
      for (const stream of [child.stdout, child.stderr]) {
        if (stream instanceof ReadableStream) void stream.cancel().catch(() => {})
      }
      throw new Error(`admitted process streams did not settle within ${streamSettlementMs}ms: a surviving descendant still holds stdout or stderr`)
    }
    return { exitCode, stdout: settled[0], stderr: settled[1] }
  } finally {
    clearTimeout(expiry)
  }
}

export function createAdmittedPackageConsumer(): AdmittedPackageConsumer {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "agent-plugin-kit-admitted-consumer-"))
  const kitRoot = join(fixtureRoot, "kit")
  const consumerRoot = join(fixtureRoot, "consumer")
  const kitCommit = cloneWorkingTree(kitRoot, fixtureRoot)
  const gitDirectory = join(fixtureRoot, "kit.git")
  renameSync(join(kitRoot, ".git"), gitDirectory)
  writeFileSync(join(kitRoot, ".git"), `gitdir: ${gitDirectory}\n`)
  mkdirSync(join(consumerRoot, "node_modules", ".bin"), { recursive: true })
  writeFileSync(join(consumerRoot, ".gitignore"), "node_modules\ndist\n")
  mkdirSync(join(consumerRoot, "dist"), { recursive: true })
  writeFileSync(join(consumerRoot, "dist", "generated.txt"), "allowed\n")
  symlinkSync(kitRoot, join(consumerRoot, "node_modules", "agent-plugin-kit"))
  const binary = join(consumerRoot, "node_modules", ".bin", "agent-plugin-kit")
  writeFileSync(binary, `#!/usr/bin/env bun
const child = Bun.spawn([${JSON.stringify(join(kitRoot, "src/adapters/maintenance-command-facade/maintenance.ts"))}, ...process.argv.slice(2)], { cwd: process.cwd(), env: process.env, stdin: "inherit", stdout: "inherit", stderr: "inherit" })
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  const forward = () => {
    process.off(signal, forward)
    child.kill(signal)
    process.kill(process.pid, signal)
  }
  process.on(signal, forward)
}
process.exitCode = await child.exited
`, { mode: 0o755 })
  chmodSync(binary, 0o755)
  git(consumerRoot, "init", "-q")
  const commitAuthority = (commit: string): void => {
    writeFileSync(join(consumerRoot, "package.json"), `${JSON.stringify({ name: "consumer", dependencies: { "agent-plugin-kit": `git+${kitOrigin}#${commit}` } })}\n`)
    git(consumerRoot, "add", "package.json", ".gitignore")
    gitCommit(consumerRoot, `authority-${commit.slice(0, 8)}`)
  }
  commitAuthority(kitCommit)
  const spawnOptions = (options: { cwd?: string; environment?: Record<string, string | undefined>; entry?: string } = {}) => ({
    cmd: [options.entry ?? binary],
    cwd: options.cwd ?? consumerRoot,
    env: options.environment ?? { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  })
  return {
    fixtureRoot,
    kitRoot,
    consumerRoot,
    kitCommit,
    binary,
    commitAuthority,
    async run(args, options = {}) {
      const spawn = spawnOptions(options)
      const child = Bun.spawn({ cmd: [...spawn.cmd, ...args], cwd: spawn.cwd, env: spawn.env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: options.timeoutMs ?? processGuardMs, killSignal: "SIGKILL" })
      return settleProcess(child)
    },
    runSync(args, options = {}) {
      const spawn = spawnOptions(options)
      const result = Bun.spawnSync({ cmd: [...spawn.cmd, ...args], cwd: spawn.cwd, env: spawn.env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: options.timeoutMs ?? processGuardMs, killSignal: "SIGKILL" })
      return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString(), signalCode: result.signalCode ?? null }
    },
    dispose() {
      rmSync(fixtureRoot, { recursive: true, force: true })
    },
  }
}

export const packageArguments = (runId: string, request: string): string[] =>
  ["--run-id", runId, "maintenance", "payload", "package", "--request", request]
