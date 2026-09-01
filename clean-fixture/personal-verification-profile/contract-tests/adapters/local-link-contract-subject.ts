import { chmod, cp, mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  removeTemporaryProofRoot,
  runLocalLinkContractProof,
  type LocalLinkProofResult,
} from "../../../local-link-contract-proof"
import { localLinkProcessScenarios } from "../fixtures/maintenance-cli-process-scenarios"

const git = async (root: string, arguments_: readonly string[]): Promise<void> => {
  const child = Bun.spawn(["git", ...arguments_], {
    cwd: root,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/private/tmp",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited])
  if (exitCode !== 0) throw new Error(`temporary-git-fixture-refused:${stderr.trim()}`)
}

const commitFixture = async (root: string): Promise<void> => {
  await git(root, ["init", "--quiet"])
  await git(root, ["add", "--all"])
  await git(root, [
    "-c", "user.name=Agent Plugin Kit Contract Test",
    "-c", "user.email=contract-test@invalid.example",
    "commit", "--quiet", "-m", "fixture",
  ])
}

const createKitFixture = async (kitRoot: string, sourceKitRoot: string): Promise<void> => {
  const publicBinary = resolve(sourceKitRoot, "src/adapters/maintenance-command-facade/maintenance.ts")
  const wrapper = `#!/usr/bin/env bun\nconst child = Bun.spawn([${JSON.stringify(publicBinary)}, ...process.argv.slice(2)], { cwd: process.cwd(), env: process.env, stdin: "inherit", stdout: "inherit", stderr: "inherit" })\nprocess.exitCode = await child.exited\n`
  await mkdir(join(kitRoot, "src/adapters/maintenance-command-facade/implementation"), { recursive: true })
  await mkdir(join(kitRoot, "src/admission-bootstrap"), { recursive: true })
  await mkdir(join(kitRoot, "node_modules"), { recursive: true })
  await writeFile(join(kitRoot, ".gitignore"), "node_modules/\n")
  await writeFile(join(kitRoot, "package.json"), `${JSON.stringify({
    name: "agent-plugin-kit",
    version: "0.0.0",
    private: true,
    type: "module",
    bin: { "agent-plugin-kit": "./maintenance.ts" },
    dependencies: { zod: "4.4.3" },
  }, null, 2)}\n`)
  await writeFile(join(kitRoot, "maintenance.ts"), wrapper, { mode: 0o755 })
  await chmod(join(kitRoot, "maintenance.ts"), 0o755)
  await writeFile(
    join(kitRoot, "src/adapters/maintenance-command-facade/package.json"),
    await readFile(join(sourceKitRoot, "src/adapters/maintenance-command-facade/package.json")),
  )
  await writeFile(
    join(kitRoot, "src/admission-bootstrap/package.json"),
    await readFile(join(sourceKitRoot, "src/admission-bootstrap/package.json")),
  )
  await writeFile(join(kitRoot, "bun.lock"), await readFile(join(sourceKitRoot, "bun.lock")))
  const logTapeEntry = Bun.resolveSync(
    "@logtape/logtape",
    join(sourceKitRoot, "src/adapters/maintenance-command-facade/implementation"),
  )
  await mkdir(join(kitRoot, "node_modules/@logtape"), { recursive: true })
  await cp(resolve(logTapeEntry, "../.."), join(kitRoot, "node_modules/@logtape/logtape"), { recursive: true })
  await commitFixture(kitRoot)
}

const createConsumerFixture = async (consumerRoot: string): Promise<void> => {
  await mkdir(join(consumerRoot, "node_modules/.bin"), { recursive: true })
  await writeFile(join(consumerRoot, ".gitignore"), "node_modules/\n")
  await writeFile(join(consumerRoot, "README.md"), "# Local-link contract consumer\n")
  await commitFixture(consumerRoot)
}

const provePreexistingDestinationRefusal = async (
  options: Parameters<typeof runLocalLinkContractProof>[0],
): Promise<true> => {
  const destination = join(options.consumerRoot, "node_modules/agent-plugin-kit")
  const marker = "foreign-node-must-survive\n"
  await writeFile(destination, marker)
  let refusal: unknown
  try {
    await runLocalLinkContractProof({ ...options, runId: "preexisting-destination-negative-control" })
  } catch (error) {
    refusal = error
  }
  const preserved = await readFile(destination, "utf8")
  await unlink(destination)
  if (!(refusal instanceof Error) || refusal.message !== "link-destination-preexists" || preserved !== marker) {
    throw new Error("preexisting-destination-negative-control-failed")
  }
  return true
}

type LocalLinkContractSubject = LocalLinkProofResult & Readonly<{
  preexistingDestinationRefused: true
}>

async function createLocalLinkContractSubject(): Promise<LocalLinkContractSubject> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "agent-plugin-kit-local-link-"))
  await chmod(temporaryRoot, 0o700)
  const kitParent = join(temporaryRoot, "kit-parent")
  const consumerParent = join(temporaryRoot, "consumer-parent")
  const kitRoot = join(kitParent, "agent-plugin-kit")
  const consumerRoot = join(consumerParent, "dotfiles")
  const stateRoot = join(temporaryRoot, "state")
  await mkdir(kitRoot, { recursive: true, mode: 0o700 })
  await mkdir(consumerRoot, { recursive: true, mode: 0o700 })
  await chmod(kitParent, 0o700)
  await chmod(consumerParent, 0o700)
  const sourceKitRoot = resolve(import.meta.dir, "../../../../")
  try {
    await createKitFixture(kitRoot, sourceKitRoot)
    await createConsumerFixture(consumerRoot)
    const options = {
      kitRoot,
      consumerRoot,
      stateRoot,
      runId: "contract-help-literal",
      scenarios: localLinkProcessScenarios,
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    } as const
    const result = await runLocalLinkContractProof(options)
    const preexistingDestinationRefused = await provePreexistingDestinationRefusal(options)
    return { ...result, preexistingDestinationRefused }
  } finally {
    await removeTemporaryProofRoot(temporaryRoot)
  }
}

export const localLinkContractSubject = await createLocalLinkContractSubject()
