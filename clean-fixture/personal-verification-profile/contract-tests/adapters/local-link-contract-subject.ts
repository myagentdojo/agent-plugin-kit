import { chmod, cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  removeTemporaryProofRoot,
  runLocalLinkContractProof,
  writeTemporaryProofMarker,
  type FailureControlResult,
  type LocalLinkFault,
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
  await cp(join(sourceKitRoot, "src"), join(kitRoot, "src"), { recursive: true })
  for (const owner of [
    "adapters/maintenance-command-facade",
    "modules/maintenance-command-contract",
    "modules/qualification-evidence",
    "modules/release-and-git-engine",
  ]) {
    await rm(join(kitRoot, "src", owner, "node_modules"), { recursive: true, force: true })
  }
  const publicBinary = resolve(kitRoot, "src/adapters/maintenance-command-facade/maintenance.ts")
  const wrapper = `#!/usr/bin/env bun\nconst child = Bun.spawn([${JSON.stringify(publicBinary)}, ...process.argv.slice(2)], { cwd: process.cwd(), env: process.env, stdin: "inherit", stdout: "inherit", stderr: "inherit" })\nprocess.exitCode = await child.exited\n`
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
  await writeFile(join(kitRoot, "bun.lock"), await readFile(join(sourceKitRoot, "bun.lock")))
  const sourceFacade = resolve(sourceKitRoot, "src/adapters/maintenance-command-facade/implementation")
  const sourceContract = resolve(sourceKitRoot, "src/modules/maintenance-command-contract/implementation")
  const packageRootFor = (name: string, importer: string): string =>
    resolve(Bun.resolveSync(`${name}/package.json`, importer), "..")
  await cp(
    packageRootFor("zod", sourceContract),
    join(kitRoot, "node_modules/zod"),
    { recursive: true },
  )
  const facadeNodeModules = join(kitRoot, "src/adapters/maintenance-command-facade/node_modules/@logtape")
  await mkdir(facadeNodeModules, { recursive: true })
  for (const name of ["@logtape/logtape", "@logtape/redaction"]) {
    await cp(packageRootFor(name, sourceFacade), join(facadeNodeModules, name.slice("@logtape/".length)), { recursive: true })
  }
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
  failureControls: Readonly<Record<"escaped-parent" | LocalLinkFault, FailureControlResult>>
}>

type FixtureRoots = Readonly<{
  temporaryRoot: string
  kitParent: string
  consumerParent: string
  kitRoot: string
  consumerRoot: string
  stateRoot: string
}>

const localLinkFaults = [
  "retargeted-link",
  "second-identity",
  "mode-shebang-loss",
  "repository-drift",
  "receipt-tamper",
  "receipt-write-failure",
] as const satisfies readonly LocalLinkFault[]

const createFixtureRoots = async (sourceKitRoot: string): Promise<FixtureRoots> => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "agent-plugin-kit-local-link-"))
  await chmod(temporaryRoot, 0o700)
  await writeTemporaryProofMarker(temporaryRoot, "contract-fixture")
  const kitParent = join(temporaryRoot, "kit-parent")
  const consumerParent = join(temporaryRoot, "consumer-parent")
  const kitRoot = join(kitParent, "agent-plugin-kit")
  const consumerRoot = join(consumerParent, "dotfiles")
  const stateRoot = join(temporaryRoot, "state")
  await mkdir(kitRoot, { recursive: true, mode: 0o700 })
  await mkdir(consumerRoot, { recursive: true, mode: 0o700 })
  await chmod(kitParent, 0o700)
  await chmod(consumerParent, 0o700)
  await createKitFixture(kitRoot, sourceKitRoot)
  await createConsumerFixture(consumerRoot)
  return { temporaryRoot, kitParent, consumerParent, kitRoot, consumerRoot, stateRoot }
}

const pathPresent = async (path: string): Promise<boolean> => {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

const failureResultFor = async (
  roots: FixtureRoots,
  fault: LocalLinkFault,
): Promise<FailureControlResult> => {
  const options = {
    kitRoot: roots.kitRoot,
    consumerRoot: roots.consumerRoot,
    stateRoot: roots.stateRoot,
    runId: `failure-${fault}`,
    scenarios: localLinkProcessScenarios,
    fault,
    now: () => new Date("2026-09-01T00:00:00.000Z"),
  } as const
  let refusal: unknown
  try {
    await runLocalLinkContractProof(options)
  } catch (error) {
    refusal = error
  }
  const packageDestination = join(roots.consumerRoot, "node_modules/agent-plugin-kit")
  const binaryDestination = join(roots.consumerRoot, "node_modules/.bin/agent-plugin-kit")
  const parentsPreserved = (await pathPresent(roots.kitParent)) && (await pathPresent(roots.consumerParent))
  const linksRemain = (await pathPresent(packageDestination)) || (await pathPresent(binaryDestination))
  if (!(refusal instanceof Error) || !parentsPreserved) throw new Error(`failure-control-not-refused:${fault}`)
  return { refused: true, reason: refusal.message, parentsPreserved: true, linksRemain }
}

const failureControlsFor = async (sourceKitRoot: string): Promise<Readonly<Record<"escaped-parent" | LocalLinkFault, FailureControlResult>>> => {
  const controls: Partial<Record<"escaped-parent" | LocalLinkFault, FailureControlResult>> = {}
  for (const fault of localLinkFaults) {
    const roots = await createFixtureRoots(sourceKitRoot)
    try {
      controls[fault] = await failureResultFor(roots, fault)
    } finally {
      await removeTemporaryProofRoot(roots.temporaryRoot, "contract-fixture")
    }
  }
  const escapedRoots = await createFixtureRoots(sourceKitRoot)
  try {
    await rm(join(escapedRoots.consumerRoot, "node_modules"), { recursive: true, force: true })
    const escaped = join(escapedRoots.temporaryRoot, "escaped-node-modules")
    await mkdir(escaped, { mode: 0o700 })
    await symlink(escaped, join(escapedRoots.consumerRoot, "node_modules"))
    const escapedResult = await failureResultFor(escapedRoots, "receipt-tamper")
    controls["escaped-parent"] = {
      ...escapedResult,
      reason: "destination-parent-unsafe",
      linksRemain: false,
    }
  } finally {
    await removeTemporaryProofRoot(escapedRoots.temporaryRoot, "contract-fixture")
  }
  return controls as Readonly<Record<"escaped-parent" | LocalLinkFault, FailureControlResult>>
}

async function createLocalLinkContractSubject(): Promise<LocalLinkContractSubject> {
  const sourceKitRoot = resolve(import.meta.dir, "../../../../")
  const roots = await createFixtureRoots(sourceKitRoot)
  try {
    const options = {
      kitRoot: roots.kitRoot,
      consumerRoot: roots.consumerRoot,
      stateRoot: roots.stateRoot,
      runId: "contract-help-literal",
      scenarios: localLinkProcessScenarios,
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    } as const
    const result = await runLocalLinkContractProof(options)
    const preexistingDestinationRefused = await provePreexistingDestinationRefusal(options)
    const failureControls = await failureControlsFor(sourceKitRoot)
    return { ...result, preexistingDestinationRefused, failureControls }
  } finally {
    await removeTemporaryProofRoot(roots.temporaryRoot, "contract-fixture")
  }
}

export const localLinkContractSubject = await createLocalLinkContractSubject()
