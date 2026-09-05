import { afterAll, beforeAll, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve, sep } from "node:path"
import type { PayloadCheckRequest, PayloadMaterializeRequest, PluginPayloadConfiguration } from "../../../src/modules/plugin-payload-production/interface"
import { createPluginFixture, type PluginFixture } from "../../../src/modules/plugin-payload-production/contract-tests/fixtures/prepared-plugin-fixture"
import { createAdmittedPackageConsumer, processGuardMs, type AdmittedPackageConsumer, type ProcessResult } from "./adapters/admitted-package-consumer"

let consumer: AdmittedPackageConsumer
const fixtures: PluginFixture[] = []
const roots: string[] = []
const kitRoot = resolve(import.meta.dir, "../../../..")

const configuration: PluginPayloadConfiguration = {
  plugin: {
    name: "plugin",
    displayName: "Fixture Plugin",
    version: "0.1.0",
    description: "Fixture Plugin",
    author: { name: "Fixture Author" },
    repository: "https://github.com/example/fixture-plugin",
    license: "MIT",
    keywords: ["fixture"],
    category: "Developer Tools",
    shortDescription: "Fixture Plugin",
    longDescription: "Fixture Plugin for public process payload contract tests.",
    capabilities: ["payload-check"],
    defaultPrompts: ["Inspect this payload"],
    brandColor: "#123ABC",
    composerIcon: "./assets/fixture-plugin.svg",
    logo: "./assets/fixture-plugin.svg",
    hookDeclarationPaths: [],
  },
  skills: [{ id: "fixture", hookDependence: "hook-independent", production: { kind: "model-only" } }],
}

const sourceProjectionPaths = {
  config: "payload-inputs/plugin.config.json",
  runtimeLock: "payload-inputs/runtime.lock.json",
  skillInventory: "payload-inputs/skill-catalog.json",
} as const

const expectedClaudeManifest = `{
  "name": "plugin",
  "displayName": "Fixture Plugin",
  "version": "0.1.0",
  "defaultEnabled": false,
  "description": "Fixture Plugin",
  "author": {
    "name": "Fixture Author"
  },
  "repository": "https://github.com/example/fixture-plugin",
  "license": "MIT",
  "keywords": [
    "fixture"
  ],
  "skills": "./skills/",
  "hooks": "./hooks/claude/hooks.json"
}
`

const createSubject = (root = mkdtempSync(join(tmpdir(), "agent-plugin-kit-clean-payload-"))): PluginFixture => {
  const subject = createPluginFixture({
    root,
    name: "plugin",
    version: "0.1.0",
    files: [
      { path: "a-safe.txt", bytes: "safe\n" },
      { path: "skills/fixture/SKILL.md", bytes: "# Fixture\n" },
    ],
    projections: [
      { role: "config", path: sourceProjectionPaths.config, bytes: '{"fixture":true}\n' },
      { role: "runtime-lock", path: sourceProjectionPaths.runtimeLock, bytes: '{"lock":"fixture"}\n' },
      { role: "skill-inventory", path: sourceProjectionPaths.skillInventory, bytes: '{"skills":["fixture"]}\n' },
    ],
  })
  fixtures.push(subject)
  return subject
}

const requestFile = (subject: PluginFixture, mode: "check" | "materialize", name = `${mode}.json`): string => {
  const request: PayloadCheckRequest | PayloadMaterializeRequest = {
    repositoryRoot: subject.root,
    mode,
    configuration,
    sourceProjectionPaths,
  }
  const path = join(subject.root, name)
  writeFileSync(path, `${JSON.stringify(request)}\n`)
  return path
}

const runPayload = (subject: PluginFixture, mode: "check" | "materialize", runId: string, options?: Parameters<AdmittedPackageConsumer["run"]>[1]): Promise<ProcessResult> =>
  consumer.run(["--run-id", runId, "maintenance", "payload", mode, "--request", requestFile(subject, mode, `${runId}.json`)], options)

type Envelope = {
  status: string
  data: {
    command: string
    result_code: string
    station_id: string
    transaction_state: string
    completed_effect_ids?: string[]
    result: {
      kind: string
      result: {
        kind: string
        candidate: { payloadSha256: string }
        changedPaths?: string[]
        removedPaths?: string[]
      }
    }
  }
}

const successEnvelope = (actual: ProcessResult): Envelope => {
  expect(actual.exitCode).toBe(0)
  expect(actual.stderr).toBe("")
  expect(actual.stdout.endsWith("\n")).toBe(true)
  expect(actual.stdout.split("\n")).toHaveLength(2)
  return JSON.parse(actual.stdout.trim()) as Envelope
}

const errorEnvelope = (actual: ProcessResult): Record<string, any> => {
  expect(actual.stdout).toBe("")
  return JSON.parse(actual.stderr.trim().split("\n").at(-1) ?? "{}") as Record<string, any>
}

const framedLength = (length: number): Uint8Array => {
  const frame = new Uint8Array(8)
  new DataView(frame.buffer).setBigUint64(0, BigInt(length), false)
  return frame
}

const independentFramedDigest = (files: readonly { path: string; bytes: Uint8Array }[]): string => {
  const hash = createHash("sha256")
  for (const file of files) {
    const path = new TextEncoder().encode(file.path)
    hash.update(framedLength(path.byteLength))
    hash.update(path)
    hash.update(framedLength(file.bytes.byteLength))
    hash.update(file.bytes)
  }
  return hash.digest("hex")
}

const observedPluginFiles = (root: string): { path: string; bytes: Uint8Array }[] => {
  const files: { path: string; bytes: Uint8Array }[] = []
  const visit = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = prefix === "" ? name : `${prefix}/${name}`
      const absolute = join(directory, name)
      const status = lstatSync(absolute)
      if (status.isDirectory()) visit(absolute, path)
      else {
        expect(status.isFile()).toBe(true)
        files.push({ path, bytes: new Uint8Array(readFileSync(absolute)) })
      }
    }
  }
  visit(root, "")
  return files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
}

const inside = (base: string, candidate: string): boolean => {
  const path = relative(resolve(base), resolve(candidate))
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep))
}

const isolatedEnvironment = (fixtureRoot: string): Record<string, string | undefined> => {
  const directories = {
    HOME: join(fixtureRoot, "home"),
    XDG_CACHE_HOME: join(fixtureRoot, "cache"),
    XDG_CONFIG_HOME: join(fixtureRoot, "config"),
    XDG_DATA_HOME: join(fixtureRoot, "data"),
    XDG_STATE_HOME: join(fixtureRoot, "state"),
    TMPDIR: join(fixtureRoot, "tmp"),
  }
  for (const directory of Object.values(directories)) mkdirSync(directory, { recursive: true, mode: 0o700 })
  const environment: Record<string, string | undefined> = {
    ...process.env,
    ...directories,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    LANG: "C.UTF-8",
    TZ: "UTC",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  }
  for (const key of Object.keys(environment)) {
    if (key === "NODE_PATH" || key === "BUN_INSTALL" || key.startsWith("AGENT_PLUGIN_KIT_")) delete environment[key]
  }
  return environment
}

beforeAll(() => { consumer = createAdmittedPackageConsumer() })
afterAll(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture.root, { recursive: true, force: true })
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  consumer?.dispose()
})

test("CF01 production-only install and real payload check", async () => {
  const subject = createSubject()
  expect((await runPayload(subject, "materialize", "cf01-materialize")).exitCode).toBe(0)
  const actual = await runPayload(subject, "check", "cf01-check")
  const envelope = successEnvelope(actual)
  expect(envelope.data).toMatchObject({ command: "payload:check", result_code: "previewed", station_id: "payload-check.previewed", transaction_state: "unchanged" })
  expect(envelope.data.result.kind).toBe("checked")
  const files = observedPluginFiles(subject.pluginRoot)
  expect(envelope.data.result.result.candidate.payloadSha256).toBe(`sha256:${independentFramedDigest(files)}`)
  expect(lstatSync(join(consumer.consumerRoot, "node_modules/agent-plugin-kit/.git")).isDirectory()).toBe(false)
  for (const dependency of ["@biomejs/biome", "typescript", "fallow"]) expect(existsSync(join(consumer.consumerRoot, "node_modules", dependency))).toBe(false)
}, processGuardMs)

test("CF02 host-temporary fixture materializes through the real process and converges", async () => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugin-kit-cf02-host-"))
  roots.push(root)
  const subject = createSubject(root)
  expect(inside(kitRoot, subject.root)).toBe(false)
  expect(inside(consumer.kitRoot, subject.root)).toBe(false)
  expect(inside(consumer.consumerRoot, subject.root)).toBe(false)
  const first = successEnvelope(await runPayload(subject, "materialize", "cf02-materialize"))
  expect(first.data).toMatchObject({ command: "payload:materialize", result_code: "completed", station_id: "payload-materialize.completed", transaction_state: "completed", completed_effect_ids: ["effect:payload-materialized"] })
  for (const path of [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json", "plugin/.claude-plugin/plugin.json", "plugin/.codex-plugin/plugin.json", "plugin/skill-inventory.json", "plugin/runtime/bundle-inventory.json", "plugin/runtime/bundle-inventory.sh", "plugin/THIRD-PARTY-NOTICES.md"]) expect(statSync(join(subject.root, path)).isFile()).toBe(true)
  expect(statSync(join(subject.pluginRoot, "runtime/bundle-inventory.sh")).mode & 0o111).toBe(0)
  expect(readFileSync(join(subject.pluginRoot, ".claude-plugin/plugin.json"), "utf8")).toBe(expectedClaudeManifest)
  const second = successEnvelope(await runPayload(subject, "materialize", "cf02-materialize-repeat"))
  expect(second.data.result.result.changedPaths).toEqual([])
  expect(second.data.result.result.removedPaths).toEqual([])
}, processGuardMs)

test("CF03 isolated real check has no undeclared source, dependency, or parent resolution", async () => {
  const subject = createSubject()
  expect((await runPayload(subject, "materialize", "cf03-materialize")).exitCode).toBe(0)
  const isolatedRoot = join(consumer.consumerRoot, "cf03-isolated-run")
  mkdirSync(isolatedRoot, { recursive: true })
  const actual = await runPayload(subject, "check", "cf03-check", { cwd: isolatedRoot, environment: isolatedEnvironment(isolatedRoot) })
  expect(actual.exitCode).toBe(0)
  expect(actual.stderr).toBe("")
  expect(`${actual.stdout}${actual.stderr}`).not.toContain(consumer.kitRoot)
  expect(`${actual.stdout}${actual.stderr}`).not.toContain(join(consumer.kitRoot, "node_modules/.bun"))
  const installedManifest = JSON.parse(readFileSync(join(consumer.consumerRoot, "node_modules/agent-plugin-kit/src/admission-bootstrap/package.json"), "utf8")) as { dependencies?: Record<string, unknown> }
  expect(installedManifest.dependencies ?? {}).toEqual({})
  expect(inside(realpathSync(consumer.consumerRoot), realpathSync(consumer.binary))).toBe(true)
}, processGuardMs)

test("CF04 public process bytes, streams, exits, refusal, ingress, and repair are stable", async () => {
  const subject = createSubject()
  expect((await runPayload(subject, "materialize", "cf04-prepare")).exitCode).toBe(0)
  const clean = await runPayload(subject, "check", "cf04-clean")
  expect(clean.exitCode).toBe(0)
  expect(clean.stderr).toBe("")
  expect(clean.stdout.endsWith("\n")).toBe(true)
  expect(clean.stdout.split("\n")).toHaveLength(2)
  writeFileSync(join(subject.pluginRoot, ".claude-plugin/plugin.json"), '{"drifted":true}\n')
  const drift = await runPayload(subject, "check", "cf04-drift")
  expect(drift.exitCode).toBe(21)
  const refusal = errorEnvelope(drift)
  expect(refusal).toMatchObject({ data: { command: "payload:check", result_code: "command-refused", station_id: "payload-check.command-refused", transaction_state: "unchanged" }, error: { exitCodeHint: 21 } })
  expect(refusal.message).not.toContain("Maintenance source checkout is not admitted.")
  const invalidRoot = join(subject.root, "invalid.json")
  writeFileSync(invalidRoot, `${JSON.stringify({ repositoryRoot: subject.root, mode: "check" })}\n`)
  const invalid = await consumer.run(["--run-id", "cf04-invalid", "maintenance", "payload", "check", "--request", invalidRoot])
  expect(invalid.exitCode).toBe(2)
  expect(invalid.stdout).toBe("")
  expect(invalid.stderr).toContain('"message":"Invalid maintenance command input."')
  expect(invalid.stderr).not.toContain("ZodError")
  expect((await runPayload(subject, "materialize", "cf04-repair")).exitCode).toBe(0)
  expect((await runPayload(subject, "check", "cf04-repaired-check")).stdout).toContain('"result_code":"previewed"')
}, processGuardMs)
