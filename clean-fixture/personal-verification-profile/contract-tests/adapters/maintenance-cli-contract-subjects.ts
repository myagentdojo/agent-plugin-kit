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
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const [packageRoot, consumerRoot, candidatePath, authorityPath] = process.argv.slice(2)
if (packageRoot === undefined || consumerRoot === undefined || candidatePath === undefined || authorityPath === undefined) {
  throw new Error("owner proof arguments are incomplete")
}
const moduleAt = async (relative) => import(pathToFileURL(join(packageRoot, relative)).href)
const candidate = JSON.parse(await readFile(candidatePath, "utf8"))
const payload = { regularFiles: [".claude-plugin/plugin.json"], payloadSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
const canaryCandidate = { identity: candidate, inertPayloadSha256: payload.payloadSha256 }
const help = JSON.parse(await readFile(join(consumerRoot, "help.json"), "utf8"))
const plugin = await moduleAt("src/modules/plugin-payload-production/serialized-values.ts")
const release = await moduleAt("src/modules/release-and-git-engine/serialized-values.ts")
const harness = await moduleAt("src/modules/harness-journeys/serialized-values.ts")
const canary = await moduleAt("src/modules/canary-qualification/serialized-values.ts")
const maintenance = await moduleAt("src/modules/maintenance-command-contract/serialized-values.ts")
const qualification = await moduleAt("src/modules/qualification-evidence/serialized-values.ts")
const qualificationInterface = await moduleAt("src/modules/qualification-evidence/interface.ts")
const facade = await moduleAt("src/adapters/maintenance-command-facade/serialized-values.ts")
const authorityAdapter = await moduleAt("src/modules/canary-qualification/adapters/protected-file-authority-source.ts")
const binding = await moduleAt("src/modules/maintenance-command-contract/implementation/trusted-command-binding.ts")
const parseOwners = {
  "plugin-payload-production": plugin.parsePayloadProductionRequest({ repositoryRoot: "/fixture/plugin", mode: "check" }) !== undefined,
  "release-and-git-engine": release.parseCandidateIdentity(candidate) !== undefined,
  "harness-journeys": harness.parseClaudeWireRequest({ candidate, payload, profileIdentity: "clean-fixture" }) !== undefined,
  "canary-qualification": canary.parseCanaryCandidate(canaryCandidate) !== undefined,
  "qualification-evidence": qualification.parseVerificationProfile(qualificationInterface.VerificationProfile.personal) !== undefined,
  "maintenance-command-facade": facade.validateFacadeSuccessEnvelope(help) !== undefined,
}
const validatorExports = {
  "plugin-payload-production": ["payloadProductionResultSchema"].filter((name) => Object.hasOwn(plugin, name)),
  "release-and-git-engine": ["admissionRequestSchema", "admissionRefusalSchema", "packageObservationSchema", "releasePlanSchema", "releaseResultSchema"].filter((name) => Object.hasOwn(release, name)),
  "harness-journeys": ["claudeInspectionSchema", "codexInspectionSchema", "claudeApplyResultSchema", "codexApplyResultSchema"].filter((name) => Object.hasOwn(harness, name)),
  "canary-qualification": ["canaryAuthoritySourceRefusalSchema", "canaryPlanSchema", "canaryResultSchema"].filter((name) => Object.hasOwn(canary, name)),
  "maintenance-command-contract": ["wireCommandSchema"].filter((name) => Object.hasOwn(maintenance, name)),
}
const steps = []
const protectedSource = authorityAdapter.createProtectedFileAuthoritySource()
const references = []
const result = await binding.bindTrustedCommand({
  schemaVersion: 1,
  command: "canary:qualify",
  candidate: canaryCandidate,
  authority: authorityPath,
}, {
  admittedIdentity: candidate,
  trace: (step) => steps.push(step),
  canary: {
    inspect: async (input) => ({ candidate: input.identity, target: "fixture", immutableReference: "refs/tags/v1.0.0" }),
    acceptPlan: (plan) => release.candidateIdentitiesMatch(plan.candidate, candidate),
    authoritySource: {
      resolve: async (reference, identity, plan) => {
        references.push({
          reference,
          identityMatches: release.candidateIdentitiesMatch(identity, candidate),
          planMatches: release.candidateIdentitiesMatch(plan.candidate, candidate),
        })
        return protectedSource.resolve(reference, identity, plan)
      },
    },
  },
})
let qualificationObserved = false
let boundAuthorityOpaque = false
if (result.status === "bound" && result.command.command === "canary:qualify") {
  boundAuthorityOpaque = result.command.authority !== undefined && !Object.hasOwn(result.command, "schemaVersion")
  qualificationObserved = true
  steps.push("qualify")
}
const publicProcess = await (async () => {
  const binary = join(packageRoot, "src/adapters/maintenance-command-facade/maintenance.ts")
  const child = Bun.spawn({
    cmd: ["bun", "--no-install", binary, "--run-id", "clean-fixture-authority", "canary", "qualify", "--candidate", candidatePath, "--authority", authorityPath],
    cwd: consumerRoot,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { exitCode, stdout, stderr }
})()
console.log(JSON.stringify({
  parseOwners: { ...parseOwners, "maintenance-command-contract": result.status === "bound" },
  validatorExports,
  references,
  steps,
  boundAuthorityOpaque,
  qualificationObserved,
  publicProcess: {
    exitCode: publicProcess.exitCode,
    stdoutEmpty: publicProcess.stdout === "",
    hostileContentAbsent: !publicProcess.stderr.includes("authority-file-must-not-be-read"),
  },
}))
`

export type ProductionOwnerProof = Readonly<{
  parseOwners: Readonly<Record<string, boolean>>
  validatorExports: Readonly<Record<string, readonly string[]>>
  installedPrivateValidatorPaths: readonly string[]
  publicValidatorExports: readonly string[]
  zodVersions: Readonly<Record<string, string>>
  references: readonly Readonly<{ reference: string; identityMatches: boolean; planMatches: boolean }>[]
  steps: readonly string[]
  boundAuthorityOpaque: boolean
  qualificationObserved: boolean
  publicProcess: Readonly<{ exitCode: number; stdoutEmpty: boolean; hostileContentAbsent: boolean }>
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
  const binary = join(packageRoot, "src/adapters/maintenance-command-facade/maintenance.ts")
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
