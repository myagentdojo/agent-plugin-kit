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
  await git(root, [
    "-c", "user.name=Agent Plugin Kit Contract Test",
    "-c", "user.email=contract-test@invalid.example",
    "commit", "--quiet", "--allow-empty", "-m", "fixture-ref",
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
  const wrapper = `#!/usr/bin/env bun\nconst preload = process.env.AGENT_PLUGIN_KIT_NETWORK_PRELOAD\nconst command = preload === undefined ? [${JSON.stringify(publicBinary)}, ...process.argv.slice(2)] : [process.execPath, "--no-install", "--preload", preload, ${JSON.stringify(publicBinary)}, ...process.argv.slice(2)]\nconst child = Bun.spawn(command, { cwd: process.cwd(), env: process.env, stdin: "inherit", stdout: "inherit", stderr: "inherit" })\nprocess.exitCode = await child.exited\n`
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
  temporaryProofControls: Readonly<{
    wrongParentRefused: true
    preexistingMarkerRefused: true
    substitutedRootRefused: true
  }>
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
  "partial-link",
  "retargeted-link",
  "second-identity",
  "mode-shebang-loss",
  "repository-drift",
  "manifest-lock-drift",
  "staged-index-drift",
  "commit-ref-drift",
  "parent-deletion",
  "network-primitive",
  "diagnostic-order",
  "redaction-bypass",
  "missing-owner-local-dependency",
  "receipt-schema",
  "receipt-mistyped",
  "receipt-tamper",
  "receipt-link-substitution",
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
  await mkdir(stateRoot, { mode: 0o700 })
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
  const receiptPath = join(
    roots.stateRoot,
    "my-second-brain-vault/agent-plugin-kit/local-link-proof",
    options.runId,
    "ownership.json",
  )
  const parentsPreserved = (await pathPresent(roots.kitParent)) && (await pathPresent(roots.consumerParent)) &&
    (await pathPresent(join(roots.consumerRoot, "node_modules")))
  const linksRemain = (await pathPresent(packageDestination)) || (await pathPresent(binaryDestination))
  const receiptRemaining = await pathPresent(receiptPath)
  if (!(refusal instanceof Error)) throw new Error(`failure-control-not-refused:${fault}`)
  return { refused: true, reason: refusal.message, parentsPreserved, linksRemain, receiptRemaining }
}

const probeWrongTemporaryParent = async (): Promise<boolean> => {
  const wrongParent = await mkdtemp(join(tmpdir(), "agent-plugin-kit-local-link-controls-"))
  const wrongRootParent = join(wrongParent, "nested")
  const wrongRoot = join(wrongRootParent, "agent-plugin-kit-local-link-wrong-parent")
  await mkdir(wrongRoot, { recursive: true, mode: 0o700 })
  let refused = false
  try {
    await writeTemporaryProofMarker(wrongRoot, "wrong-parent-control")
  } catch (error) {
    refused = error instanceof Error && error.message === "temporary-proof-root-parent-refused"
  }
  await rm(wrongParent, { recursive: true, force: true })
  return refused
}

const probePreexistingTemporaryMarker = async (): Promise<boolean> => {
  const preexistingRoot = await mkdtemp(join(tmpdir(), "agent-plugin-kit-local-link-"))
  await chmod(preexistingRoot, 0o700)
  let refused = false
  try {
    await writeTemporaryProofMarker(preexistingRoot, "preexisting-marker-control")
    try {
      await writeTemporaryProofMarker(preexistingRoot, "preexisting-marker-control")
    } catch (error) {
      refused = error instanceof Error && error.message === "temporary-proof-marker-exists"
    }
  } finally {
    await removeTemporaryProofRoot(preexistingRoot, "preexisting-marker-control")
  }
  return refused
}

const probeSubstitutedTemporaryRoot = async (): Promise<boolean> => {
  const substitutedTarget = await mkdtemp(join(tmpdir(), "agent-plugin-kit-local-link-"))
  await chmod(substitutedTarget, 0o700)
  await writeTemporaryProofMarker(substitutedTarget, "substituted-root-control")
  const substitutedPath = await mkdtemp(join(tmpdir(), "agent-plugin-kit-local-link-"))
  await rm(substitutedPath, { recursive: true, force: true })
  await symlink(substitutedTarget, substitutedPath)
  let refused = false
  try {
    await removeTemporaryProofRoot(substitutedPath, "substituted-root-control")
  } catch (error) {
    refused = error instanceof Error && error.message === "temporary-proof-root-refused"
  } finally {
    await unlink(substitutedPath)
    await removeTemporaryProofRoot(substitutedTarget, "substituted-root-control")
  }
  return refused
}

const proveTemporaryProofControls = async (): Promise<Readonly<{
  wrongParentRefused: true
  preexistingMarkerRefused: true
  substitutedRootRefused: true
}>> => {
  const wrongParentRefused = await probeWrongTemporaryParent()
  const preexistingMarkerRefused = await probePreexistingTemporaryMarker()
  const substitutedRootRefused = await probeSubstitutedTemporaryRoot()
  if (!wrongParentRefused || !preexistingMarkerRefused || !substitutedRootRefused) {
    throw new Error("temporary-proof-root-negative-controls-failed")
  }
  return { wrongParentRefused: true, preexistingMarkerRefused: true, substitutedRootRefused: true }
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
    controls["escaped-parent"] = escapedResult
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
    const temporaryProofControls = await proveTemporaryProofControls()
    const failureControls = await failureControlsFor(sourceKitRoot)
    return { ...result, preexistingDestinationRefused, temporaryProofControls, failureControls }
  } finally {
    await removeTemporaryProofRoot(roots.temporaryRoot, "contract-fixture")
  }
}

export const localLinkContractSubject = await createLocalLinkContractSubject()
