import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { mutatingRequests } from "../../../src/modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"
import {
  sourceCheckoutCandidateNewFiles,
  sourceCheckoutNotAdmittedMessage,
  sourceCheckoutOwnerAbsentMessage,
  sourceCheckoutPackageArguments,
} from "./adapters/source-checkout-contract-subject"
import { sourceCheckoutAdmissionCases } from "./fixtures/source-checkout-admission-cases"

const repositoryRoot = resolve(import.meta.dir, "../../..")
let fixtureRoot = "", kitRoot = "", consumerRoot = ""
let packageRequest = "", checkRequest = ""
let kitCommit = ""
function git(root: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr))
  return new TextDecoder().decode(result.stdout).trim()
}
async function run(args: string[], entryPath = join(consumerRoot, "node_modules/.bin/agent-plugin-kit"), cwd = consumerRoot, environment = process.env) {
  const child = Bun.spawn({ cmd: [entryPath, ...args], cwd, env: environment, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { exitCode, stdout, stderr }
}
type ProcessResult = Awaited<ReturnType<typeof run>>
function expectPublicRefusal(result: ProcessResult, message: string): ProcessResult {
  expect(result.exitCode).toBe(2)
  expect(result.stdout).toBe("")
  const records = result.stderr.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
  const envelope = records.pop()
  for (const diagnostic of records) {
    expect(diagnostic.record_type).toBe("diagnostic")
    expect(diagnostic.schema_version).toBe(2)
    expect(diagnostic.run_id).toBe("source-checkout")
  }
  expect(envelope).toEqual({
    record_type: "error_envelope",
    schema_version: 1,
    status: "error",
    message,
    run_id: "source-checkout",
    data: {
      contract_id: "agent-plugin-kit.maintenance-command-result",
      result_schema_version: 1,
      command: "maintenance",
      result_code: "usage-refused",
      station_id: "maintenance.usage-refused",
      transaction_state: "unchanged",
      retry_safety: "safe",
      next_action: { id: "maintenance.show-help", action: "change_input", summary: "Choose a command from machine discovery.", commandId: "help" },
    },
    error: {
      schemaVersion: 1,
      name: "MaintenanceCommandError",
      code: "usage-refused",
      action: "change_input",
      errorFamily: "input",
      hintVersion: 1,
      severity: "error",
      recoverability: "change_input",
      retryable: false,
      exitCodeHint: 2,
      failureClass: "usage",
      stationId: "maintenance.usage-refused",
      agentActions: [{ nextActionId: "maintenance.show-help", action: "change_input", summary: "Choose a command from machine discovery." }],
    },
  })
  return result
}
async function expectOwnerAbsent(request: string) {
  expectPublicRefusal(await run(sourceCheckoutPackageArguments(request)), sourceCheckoutOwnerAbsentMessage)
}
async function commitAuthority(commit: string): Promise<void> {
  await writeFile(join(consumerRoot, "package.json"), JSON.stringify({ dependencies: { "agent-plugin-kit": `git+https://github.com/myagentdojo/agent-plugin-kit.git#${commit}` } }))
  git(consumerRoot, "add", "package.json"); git(consumerRoot, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", `authority-${commit.slice(0, 8)}`)
}
beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "agent-plugin-kit-source-checkout-process-")); kitRoot = join(fixtureRoot, "kit"); consumerRoot = join(fixtureRoot, "consumer")
  const clone = Bun.spawnSync(["git", "clone", "--quiet", repositoryRoot, kitRoot], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  if (clone.exitCode !== 0) throw new Error(new TextDecoder().decode(clone.stderr))
  const patch = Bun.spawnSync(["git", "-C", repositoryRoot, "diff", "--binary", "HEAD"], { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  if (patch.exitCode !== 0) throw new Error(new TextDecoder().decode(patch.stderr))
  const patchPath = join(fixtureRoot, "working-tree.patch")
  if (patch.stdout.byteLength > 0) {
    await writeFile(patchPath, patch.stdout)
    git(kitRoot, "apply", "--binary", patchPath)
  }
  for (const file of sourceCheckoutCandidateNewFiles) {
    const target = join(kitRoot, file)
    await mkdir(dirname(target), { recursive: true })
    await cp(join(repositoryRoot, file), target)
  }
  git(kitRoot, "add", "--all"); git(kitRoot, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "candidate")
  await Bun.$`bun install --frozen-lockfile`.cwd(kitRoot).quiet()
  const commit = git(kitRoot, "rev-parse", "HEAD"); kitCommit = commit
  await mkdir(join(consumerRoot, "node_modules"), { recursive: true })
  await writeFile(join(consumerRoot, "package.json"), JSON.stringify({ name: "consumer", dependencies: { "agent-plugin-kit": `git+https://github.com/myagentdojo/agent-plugin-kit.git#${commit}` } }) + "\n")
  await writeFile(join(consumerRoot, ".gitignore"), "node_modules\ndist\n"); await mkdir(join(consumerRoot, "dist"), { recursive: true }); await writeFile(join(consumerRoot, "dist/generated.txt"), "allowed\n")
  await symlink(kitRoot, join(consumerRoot, "node_modules/agent-plugin-kit")); await mkdir(join(consumerRoot, "node_modules/.bin")); await symlink(join(kitRoot, "src/adapters/maintenance-command-facade/maintenance.ts"), join(consumerRoot, "node_modules/.bin/agent-plugin-kit")); git(consumerRoot, "init", "-q"); git(consumerRoot, "add", "package.json", ".gitignore"); git(consumerRoot, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "consumer")
  packageRequest = join(consumerRoot, "request.json"); checkRequest = join(consumerRoot, "check-request.json")
  await writeFile(packageRequest, JSON.stringify({ repositoryRoot: "/foreign", mode: "package", sourceIdentity: { repository: { origin: "https://github.com/example/foreign.git" }, commit: "e".repeat(40) } }))
  await writeFile(checkRequest, JSON.stringify({ repositoryRoot: "/foreign", mode: "check", sourceIdentity: { repository: { origin: "https://github.com/example/foreign.git" }, commit: "e".repeat(40) } }))
})
beforeEach(async () => { await commitAuthority(kitCommit) })
afterAll(async () => { if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true }) })
test(sourceCheckoutAdmissionCases.admittedOwnerAbsent.title, async () => {
  expect(git(kitRoot, "status", "--porcelain=v1", "--untracked-files=all")).toBe("")
  expect(await readFile(join(consumerRoot, "dist/generated.txt"), "utf8")).toBe("allowed\n")
  await expectOwnerAbsent(packageRequest)
  expectPublicRefusal(await run(["--run-id", "source-checkout", "maintenance", "payload", "check", "--request", checkRequest]), "Maintenance command is not admitted.")
})
test(sourceCheckoutAdmissionCases.committedWrongPin.title, async () => {
  await commitAuthority("e".repeat(40))
  expectPublicRefusal(await run(sourceCheckoutPackageArguments(packageRequest)), sourceCheckoutNotAdmittedMessage)
})
test(sourceCheckoutAdmissionCases.uncommittedRestoration.title, async () => {
  await commitAuthority("e".repeat(40))
  await writeFile(join(consumerRoot, "package.json"), JSON.stringify({ dependencies: { "agent-plugin-kit": `git+https://github.com/myagentdojo/agent-plugin-kit.git#${kitCommit}` } }))
  expectPublicRefusal(await run(sourceCheckoutPackageArguments(packageRequest)), sourceCheckoutNotAdmittedMessage)
})
test(sourceCheckoutAdmissionCases.committedRestoration.title, async () => {
  await commitAuthority("e".repeat(40)); await commitAuthority(kitCommit)
  await expectOwnerAbsent(packageRequest)
})
test(sourceCheckoutAdmissionCases.dirtyCheckout.title, async () => {
  const dirty = join(kitRoot, "README.md"), original = await readFile(dirty, "utf8"), request = packageRequest
  expect((await stat(request)).isFile()).toBe(true)
  const setupFailure = await run(sourceCheckoutPackageArguments(request), undefined, undefined, { ...process.env, TMPDIR: request })
  expect(setupFailure.stderr).not.toContain(request)
  expectPublicRefusal(setupFailure, sourceCheckoutNotAdmittedMessage)
  await writeFile(dirty, `${original}\n`)
  try { expectPublicRefusal(await run(sourceCheckoutPackageArguments(request)), sourceCheckoutNotAdmittedMessage) } finally { await writeFile(dirty, original) }
  await expectOwnerAbsent(request)
})
test(sourceCheckoutAdmissionCases.gitInstalledCopy.title, async () => {
  const productionConsumer = join(fixtureRoot, "production-consumer"), commit = git(kitRoot, "rev-parse", "HEAD")
  await mkdir(productionConsumer, { recursive: true })
  const dependency = `git+file://${kitRoot}#${commit}`
  await writeFile(join(productionConsumer, "package.json"), JSON.stringify({ name: "production-consumer", dependencies: { "agent-plugin-kit": dependency } }) + "\n")
  await Bun.$`bun install`.cwd(productionConsumer)
  const installed = join(productionConsumer, "node_modules/agent-plugin-kit")
  const gitMetadata = await stat(join(installed, ".git")).catch(() => undefined)
  expect(gitMetadata).toBeUndefined()
  const entry = join(productionConsumer, "node_modules/.bin/agent-plugin-kit")
  expectPublicRefusal(await run(sourceCheckoutPackageArguments(packageRequest), entry, productionConsumer), sourceCheckoutNotAdmittedMessage)
})
test(sourceCheckoutAdmissionCases.protectedCommand.title, async () => {
  const releaseRequest = join(consumerRoot, "release-request.json"), approval = join(consumerRoot, "approval.json"), canaryCandidate = join(consumerRoot, "canary-candidate.json"), authority = join(consumerRoot, "authority.json")
  await writeFile(releaseRequest, JSON.stringify(mutatingRequests.release.request)); await writeFile(approval, JSON.stringify(mutatingRequests.release.approval)); await writeFile(canaryCandidate, JSON.stringify(mutatingRequests.canary.candidate)); await writeFile(authority, JSON.stringify("authority-sentinel"))
  const release = await run(["--run-id", "source-checkout", "maintenance", "release", "apply", "--request", releaseRequest, "--approval", approval])
  const canary = await run(["--run-id", "source-checkout", "maintenance", "canary", "qualify", "--candidate", canaryCandidate, "--authority", authority])
  expectPublicRefusal(release, "Maintenance command is not admitted.")
  expectPublicRefusal(canary, "Maintenance command is not admitted.")
  expect(`${release.stderr}${canary.stderr}`).not.toContain("authority-sentinel")
})
