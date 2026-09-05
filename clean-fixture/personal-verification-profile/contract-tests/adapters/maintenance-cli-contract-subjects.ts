import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  installedFoundation,
  type ProcessObservation,
} from "./installed-foundation-contract-subject"

export type InstalledMaintenanceCliObservation = {
  observations: readonly ProcessObservation[]
  importedFiles: readonly string[]
  cwd: string
  installedFiles: readonly string[]
  externalDependencyPerturbationRefused: boolean
  externalDependencyBaselineRestored: boolean
  escapedRuntimePerturbationRefused: boolean
  escapedRuntimeBaselineRestored: boolean
  nonJavaScriptRuntimePerturbationRefused: boolean
  nonJavaScriptRuntimeBaselineRestored: boolean
  stationMap: Readonly<Record<string, unknown>>
}

export const installedMaintenanceCliSubject: InstalledMaintenanceCliObservation =
  installedFoundation.installedMaintenanceCli

type ChildResult = Readonly<{ exitCode: number; stdout: string; stderr: string }>

const runChild = async (
  command: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<ChildResult> => {
  const child = Bun.spawn({
    cmd: [...command],
    cwd,
    env: environment,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

const productionEnvironmentFor = (root: string): Readonly<Record<string, string | undefined>> => {
  const paths = ["tmp", "cache", "config", "data", "state"].map((name) => join(root, name))
  for (const path of paths) mkdirSync(path, { recursive: true, mode: 0o700 })
  return {
    ...process.env,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    HOME: root,
    TMPDIR: paths[0],
    XDG_CACHE_HOME: paths[1],
    XDG_CONFIG_HOME: paths[2],
    XDG_DATA_HOME: paths[3],
    XDG_STATE_HOME: paths[4],
  }
}

const productionOwnerProbeSource = `
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const [packageRoot, consumerRoot, candidatePath, authorityPath] = process.argv.slice(2)
if (packageRoot === undefined || consumerRoot === undefined || candidatePath === undefined || authorityPath === undefined) {
  throw new Error("owner proof arguments are incomplete")
}
const binary = join(consumerRoot, "node_modules/.bin/agent-plugin-kit")
const candidate = JSON.parse(await readFile(candidatePath, "utf8"))
const payload = { regularFiles: [".claude-plugin/plugin.json"], payloadSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
const canaryCandidate = { identity: candidate, inertPayloadSha256: payload.payloadSha256 }
const writeJson = async (name, value) => {
  const path = join(consumerRoot, name)
  await writeFile(path, JSON.stringify(value) + "\\n")
  return path
}
const payloadRequestPath = await writeJson("payload-request.json", {
  repositoryRoot: "/fixture/plugin",
  mode: "check",
  configuration: {
    plugin: {
      name: "source-checkout-plugin", displayName: "Source Checkout Plugin", version: "0.1.0",
      description: "Source checkout payload fixture", author: { name: "Fixture Author" },
      repository: "https://github.com/example/source-checkout-plugin", license: "MIT", keywords: ["fixture"],
      category: "Developer Tools", shortDescription: "Source checkout payload fixture",
      longDescription: "Source checkout payload fixture", capabilities: ["payload-check"],
      defaultPrompts: ["Check this payload"], brandColor: "#123ABC",
      composerIcon: "./assets/fixture-plugin.svg", logo: "./assets/fixture-plugin.svg", hookDeclarationPaths: [],
    },
    skills: [{ id: "fixture", hookDependence: "hook-independent", production: { kind: "model-only" } }],
  },
  sourceProjectionPaths: { config: "runtime/plugin.config.json", runtimeLock: "runtime/runtime.lock.json", skillInventory: "runtime/skill-catalog.json" },
})
const releaseRequestPath = await writeJson("release-request.json", { candidate, intent: "maintenance" })
const claudeRequestPath = await writeJson("claude-request.json", { candidate, payload, profileIdentity: "clean-fixture" })
const codexRequestPath = await writeJson("codex-request.json", { candidate, payload, profileIdentity: "clean-fixture", checkoutIdentity: "checkout-b" })
const canaryCandidatePath = await writeJson("canary-candidate.json", canaryCandidate)

const runPublic = async (args) => {
  const child = Bun.spawn({
    cmd: ["bun", "--no-install", binary, ...args],
    cwd: consumerRoot,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { exitCode, stdout, stderr }
}
const observe = (result) => ({
  exitCode: result.exitCode,
  stdoutEmpty: result.stdout === "",
  maintenanceNotAdmitted: result.stderr.includes('"message":"Maintenance command is not admitted."'),
  invalidInput: result.stderr.includes('"message":"Invalid maintenance command input."'),
  sourceCheckoutNotAdmitted: result.stderr.includes('"message":"Maintenance source checkout is not admitted."'),
})
const validCommands = {
  payloadCheck: ["--run-id", "clean-fixture-payload", "maintenance", "payload", "check", "--request", payloadRequestPath],
  releaseInspect: ["--run-id", "clean-fixture-release", "maintenance", "release", "inspect", "--request", releaseRequestPath],
  harnessClaudeInspect: ["--run-id", "clean-fixture-claude", "maintenance", "harness", "claude", "inspect", "--request", claudeRequestPath],
  harnessCodexInspect: ["--run-id", "clean-fixture-codex", "maintenance", "harness", "codex", "inspect", "--request", codexRequestPath],
  canaryInspect: ["--run-id", "clean-fixture-canary", "maintenance", "canary", "inspect", "--candidate", canaryCandidatePath],
  canaryQualify: ["--run-id", "clean-fixture-qualification", "maintenance", "canary", "qualify", "--candidate", canaryCandidatePath, "--authority", authorityPath],
}
const publicProcess = Object.fromEntries(await Promise.all(
  Object.entries(validCommands).map(async ([label, args]) => [label, observe(await runPublic(args))]),
))
const invalidInput = observe(await runPublic(["--run-id", "clean-fixture-invalid", "maintenance", "payload", "check"]))
const help = await runPublic(["--run-id", "clean-fixture-help", "--help"])
const qualificationRuntime = await import("agent-plugin-kit/qualification-evidence")
const qualificationResult = qualificationRuntime.qualificationEvidence.reduce({
  candidate,
  profile: qualificationRuntime.VerificationProfile.personal,
  cells: [],
})
const qualification = qualificationResult.status === "refused"
  ? { status: qualificationResult.status, code: qualificationResult.refusal.code }
  : { status: qualificationResult.status, code: null }
console.log(JSON.stringify({
  parseOwners: {
    "plugin-payload-production": publicProcess.payloadCheck.sourceCheckoutNotAdmitted && !publicProcess.payloadCheck.invalidInput,
    "release-and-git-engine": publicProcess.releaseInspect.maintenanceNotAdmitted,
    "harness-journeys": publicProcess.harnessClaudeInspect.maintenanceNotAdmitted && publicProcess.harnessCodexInspect.maintenanceNotAdmitted,
    "canary-qualification": publicProcess.canaryInspect.maintenanceNotAdmitted,
    "qualification-evidence": qualification.status === "refused" && qualification.code === "zero-cell",
    "maintenance-command-facade": help.exitCode === 0 && help.stdout !== "" && help.stderr === "",
    "maintenance-command-contract": publicProcess.canaryQualify.maintenanceNotAdmitted,
  },
  publicProcess: { ...publicProcess, help: observe(help) },
  invalidInput,
  qualification,
}))
`

export type ProductionOwnerProof = Readonly<{
  parseOwners: Readonly<Record<string, boolean>>
  installedPrivateValidatorPaths: readonly string[]
  publicValidatorExports: readonly string[]
  zodVersions: Readonly<Record<string, string>>
  publicProcess: Readonly<Record<string, Readonly<{
    exitCode: number
    stdoutEmpty: boolean
    maintenanceNotAdmitted: boolean
    invalidInput: boolean
    sourceCheckoutNotAdmitted: boolean
  }>>>
  invalidInput: Readonly<{
    exitCode: number
    stdoutEmpty: boolean
    maintenanceNotAdmitted: boolean
    invalidInput: boolean
    sourceCheckoutNotAdmitted: boolean
  }>
  qualification: Readonly<{ status: string; code: string | null }>
}>

let productionOwnerProofPromise: Promise<ProductionOwnerProof> | undefined

type OwnerProofEnvironment = Readonly<Record<string, string | undefined>>

const prepareOwnerProofSource = async (
  root: string,
  sourceRoot: string,
  repositoryRoot: string,
  environment: OwnerProofEnvironment,
): Promise<string> => {
  const sourceClone = await runChild(["git", "clone", "--quiet", repositoryRoot, sourceRoot], root, environment)
  if (sourceClone.exitCode !== 0) throw new Error("owner proof source checkout failed")
  const patchPath = join(root, "working-tree.patch")
	const workingTree = await runChild(["git", "diff", "--binary", "HEAD"], repositoryRoot, environment)
	if (workingTree.exitCode !== 0) throw new Error("owner proof working-tree capture failed")
	if (workingTree.stdout !== "") {
		writeFileSync(patchPath, workingTree.stdout, { mode: 0o600 })
		const apply = await runChild(["git", "apply", "--binary", patchPath], sourceRoot, environment)
		if (apply.exitCode !== 0) throw new Error(`owner proof working-tree application failed: ${apply.stderr}`)
		const stage = await runChild(["git", "add", "--all"], sourceRoot, environment)
		if (stage.exitCode !== 0) throw new Error("owner proof source staging failed")
		const commit = await runChild([
			"git",
			"-c",
			"user.name=agent-plugin-kit-owner-proof",
			"-c",
			"user.email=agent-plugin-kit-owner-proof@example.invalid",
			"commit",
			"--quiet",
			"-m",
			"owner-proof-source",
		], sourceRoot, environment)
		if (commit.exitCode !== 0) throw new Error(`owner proof source commit failed: ${commit.stderr}`)
	}
  const sourceCommit = (await runChild(["git", "rev-parse", "HEAD^{commit}"], sourceRoot, environment)).stdout.trim()
  if (!/^[0-9a-f]{40}$/u.test(sourceCommit)) throw new Error("owner proof source commit is not pinned")
  return sourceCommit
}

const installOwnerProofPackage = async (
  root: string,
  sourceRoot: string,
  remoteRoot: string,
  consumerRoot: string,
  sourceCommit: string,
  environment: OwnerProofEnvironment,
): Promise<string> => {
  const clone = await runChild(["git", "clone", "--bare", "--quiet", sourceRoot, remoteRoot], root, environment)
  if (clone.exitCode !== 0) throw new Error("owner proof remote creation failed")
  writeFileSync(join(consumerRoot, "package.json"), `${JSON.stringify({
    name: "agent-plugin-kit-owner-proof-consumer",
    private: true,
    type: "module",
    dependencies: { "agent-plugin-kit": `git+file://${remoteRoot}#${sourceCommit}` },
  }, null, 2)}\n`, { mode: 0o600 })
  const dependency = `git+file://${remoteRoot}#${sourceCommit}`
  const lock = await runChild(["bun", "add", "--ignore-scripts", "--exact", dependency], consumerRoot, environment)
  if (lock.exitCode !== 0) throw new Error("owner proof lock creation failed")
  rmSync(join(consumerRoot, "node_modules"), { recursive: true, force: true })
  const install = await runChild(["bun", "install", "--ignore-scripts", "--production", "--frozen-lockfile"], consumerRoot, environment)
  if (install.exitCode !== 0) throw new Error("owner proof production install failed")
  return realpathSync(join(consumerRoot, "node_modules", "agent-plugin-kit"))
}

type InstalledOwnerProofFacts = Readonly<{
  installedPrivateValidatorPaths: readonly string[]
  publicValidatorExports: readonly string[]
  zodVersions: Readonly<Record<string, string>>
}>

const installedOwnerProofFactsFor = (packageRoot: string): InstalledOwnerProofFacts => {
  const privateValidatorPaths = [
    "src/modules/plugin-payload-production/serialized-values.ts",
    "src/modules/release-and-git-engine/serialized-values.ts",
    "src/modules/harness-journeys/serialized-values.ts",
    "src/modules/canary-qualification/serialized-values.ts",
    "src/modules/qualification-evidence/serialized-values.ts",
    "src/modules/maintenance-command-contract/serialized-values.ts",
    "src/adapters/maintenance-command-facade/serialized-values.ts",
  ] as const
  const installedPrivateValidatorPaths = privateValidatorPaths.filter((path) => existsSync(join(packageRoot, path)))
  const installedManifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
    exports?: Record<string, unknown>
  }
  const publicValidatorExports = Object.entries(installedManifest.exports ?? {}).flatMap(([name, target]) =>
    JSON.stringify(target).includes("serialized-values") || JSON.stringify(target).includes("trusted-command-binding") ? [name] : [])
  const zodManifestPaths = [
    "package.json",
    "src/modules/plugin-payload-production/package.json",
    "src/modules/release-and-git-engine/package.json",
    "src/modules/harness-journeys/package.json",
    "src/modules/canary-qualification/package.json",
    "src/modules/qualification-evidence/package.json",
    "src/modules/maintenance-command-contract/package.json",
    "src/adapters/maintenance-command-facade/package.json",
  ] as const
  const zodVersions = Object.fromEntries(zodManifestPaths.map((path) => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, path), "utf8")) as { dependencies?: Record<string, unknown> }
    const version = manifest.dependencies?.zod
    if (typeof version !== "string") throw new Error(`owner proof manifest omits zod: ${path}`)
    return [path, version]
  })) as Record<string, string>
  return { installedPrivateValidatorPaths, publicValidatorExports, zodVersions }
}

const runOwnerProofProbe = async (
  packageRoot: string,
  consumerRoot: string,
  environment: OwnerProofEnvironment,
): Promise<ProductionOwnerProof> => {
  const candidatePath = join(consumerRoot, "candidate.json")
  const candidate = {
    source: { repository: { origin: "https://github.com/myagentdojo/example-plugin.git" }, commit: "1111111111111111111111111111111111111111" },
    release: { reference: "refs/tags/v1.0.0", commit: "1111111111111111111111111111111111111111" },
    package: { repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" }, commit: "1111111111111111111111111111111111111111" },
    workflow: { repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" }, path: ".github/workflows/plugin-maintenance.yml", commit: "1111111111111111111111111111111111111111" },
  }
  const authorityPath = join(consumerRoot, "authority.txt")
  writeFileSync(candidatePath, `${JSON.stringify(candidate)}\n`, { mode: 0o600 })
  writeFileSync(authorityPath, "authority-file-must-not-be-read\n", { mode: 0o600 })
  const binary = join(consumerRoot, "node_modules/.bin/agent-plugin-kit")
  const help = await runChild(["bun", "--no-install", binary, "--run-id", "clean-fixture-help", "--help"], consumerRoot, environment)
  if (help.exitCode !== 0 || help.stderr !== "") throw new Error("owner proof help process failed")
  writeFileSync(join(consumerRoot, "help.json"), help.stdout, { mode: 0o600 })
  const probePath = join(consumerRoot, "owner-proof.ts")
  writeFileSync(probePath, productionOwnerProbeSource, { mode: 0o600 })
  const probe = await runChild(["bun", "--no-install", probePath, packageRoot, consumerRoot, candidatePath, authorityPath], consumerRoot, environment)
  if (probe.exitCode !== 0) throw new Error(`owner proof probe failed: ${probe.stderr}`)
  return JSON.parse(probe.stdout) as ProductionOwnerProof
}

const createProductionOwnerProof = async (): Promise<ProductionOwnerProof> => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugin-kit-owner-proof-"))
  const sourceRoot = join(root, "source")
  const remoteRoot = join(root, "agent-plugin-kit.git")
  const consumerRoot = join(root, "consumer")
  const environment = productionEnvironmentFor(root)
  const repositoryRoot = resolve(import.meta.dir, "../../../../")
  mkdirSync(consumerRoot, { recursive: true, mode: 0o700 })
  try {
    const sourceCommit = await prepareOwnerProofSource(root, sourceRoot, repositoryRoot, environment)
    const packageRoot = await installOwnerProofPackage(
      root,
      sourceRoot,
      remoteRoot,
      consumerRoot,
      sourceCommit,
      environment,
    )
    const facts = installedOwnerProofFactsFor(packageRoot)
    const probe = await runOwnerProofProbe(packageRoot, consumerRoot, environment)
    return { ...probe, ...facts }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export const productionOwnerProof = (): Promise<ProductionOwnerProof> => {
  productionOwnerProofPromise ??= createProductionOwnerProof()
  return productionOwnerProofPromise
}
