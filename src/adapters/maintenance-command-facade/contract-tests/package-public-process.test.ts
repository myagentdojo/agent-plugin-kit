import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AdmittedSourceCheckoutIdentity } from "../../../modules/release-and-git-engine/interface"
import type { PayloadPackageRequest, PayloadProductionResult, PluginPayloadProduction } from "../../../modules/plugin-payload-production/interface"
import { createPluginPayloadProduction } from "../../../modules/plugin-payload-production/implementation/plugin-payload-production"
import { createPluginFixture, type PluginFixture } from "../../../modules/plugin-payload-production/contract-tests/fixtures/prepared-plugin-fixture"
import { createMaintenanceCommands } from "../../../modules/maintenance-command-contract/implementation/maintenance-commands"
import { bindSourceCheckoutCommand, bindTrustedCommand } from "../../../modules/maintenance-command-contract/implementation/trusted-command-binding"
import { literalPackageRequest, mutatingRequests } from "../../../modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"
import { createMaintenanceCommandFacade } from "../implementation/maintenance-command-facade"
import { invokePublicProcess } from "./adapters/public-process-adapter"
import { fixedRunId } from "./fixtures/literal-cli-scenarios"

const roots: string[] = []
const fixtures: PluginFixture[] = []
const fixture = (input: Parameters<typeof createPluginFixture>[0] = { files: [{ path: "a-safe.txt", bytes: "safe\n" }] }): PluginFixture => {
  const created = createPluginFixture(input)
  fixtures.push(created)
  return created
}
const jsonFile = (value: unknown): string => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugin-kit-package-process-"))
  roots.push(root)
  const path = join(root, "request.json")
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  return path
}
afterEach(() => {
  for (const created of fixtures.splice(0)) rmSync(created.root, { recursive: true, force: true })
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const unavailable = async (..._arguments: unknown[]): Promise<never> => {
  throw new Error("later Maintenance owner is not admitted in this test")
}
const admitted = { kind: "admitted" as const, identity: {} as AdmittedSourceCheckoutIdentity }
const admittedIdentity = mutatingRequests.claude.request.identity

const commandsWith = (payload: PluginPayloadProduction) => createMaintenanceCommands({
  payload,
  runtime: unavailable,
  release: { inspect: unavailable, apply: unavailable },
  harness: { inspect: unavailable, apply: unavailable },
  canary: { inspect: unavailable, qualify: unavailable },
})

/** In-process projection subject: admitted source-checkout binding plus the named owner. */
const sourceCheckoutFacade = (payload: PluginPayloadProduction = createPluginPayloadProduction()) => createMaintenanceCommandFacade({
  commands: commandsWith(payload),
  wireBinding: async (value) => bindSourceCheckoutCommand(value, { admission: async () => admitted }),
})

/** In-process subject for the deferred inspect and materialize owner outcomes. */
const releasedFacade = () => createMaintenanceCommandFacade({
  commands: commandsWith(createPluginPayloadProduction()),
  wireBinding: async (value) => bindTrustedCommand(value, { admittedIdentity }),
})

const invokePackage = (facade: ReturnType<typeof createMaintenanceCommandFacade>, request: PayloadPackageRequest) =>
  facade.invoke({ argv: ["--run-id", fixedRunId, "maintenance", "payload", "package", "--request", jsonFile(request)], environment: {}, stdin: "" })

const envelopeOf = (stderr: string) => JSON.parse(stderr.trim().split("\n").at(-1) ?? "{}") as {
  message: string
  data: { command: string; result_code: string; station_id: string; transaction_state: string; completed_effect_ids?: string[]; remaining_effect_ids?: string[] }
  error: { failureClass: string; exitCodeHint: number }
}

test("P02 the real binary refuses malformed package input without raw detail", async () => {
  for (const malformed of [
    { ...literalPackageRequest, prepared: { ...literalPackageRequest.prepared, files: "nope" } },
    { repositoryRoot: "/fixture/plugin", mode: "package" },
    { ...literalPackageRequest, release: { name: "x" } },
    { ...literalPackageRequest, prepared: { ...literalPackageRequest.prepared, projections: [{ role: "config", path: "x", bytes: 1, sha256: "sha256:zz" }] } },
  ]) {
    const path = jsonFile(malformed)
    const actual = await invokePublicProcess(["--run-id", fixedRunId, "maintenance", "payload", "package", "--request", path])
    expect(actual.stdout).toBe("")
    expect(actual.exitCode).toBe(2)
    expect(actual.stderr).toContain('"message":"Invalid maintenance command input."')
    expect(actual.stderr).not.toContain('"message":"Maintenance source checkout is not admitted."')
    expect(actual.stderr).not.toContain(path)
    expect(actual.stderr).not.toContain("ZodError")
    expect(actual.stderr).not.toContain("nope")
  }
})

test("P03 a source and preparation mismatch projects a command refusal without output", async () => {
  const subject = fixture()
  const mismatched = { ...subject.request, sourceIdentity: { ...subject.request.sourceIdentity, commit: "2".repeat(40) } }
  const actual = await invokePackage(sourceCheckoutFacade(), mismatched)
  expect(actual.stdout).toBe("")
  expect(actual.exitCode).toBe(21)
  const envelope = envelopeOf(actual.stderr)
  expect(envelope.message).toBe('Maintenance command failed with result code "command-refused".')
  expect(envelope.data).toMatchObject({ command: "payload:package", result_code: "command-refused", station_id: "payload-package.command-refused", transaction_state: "unchanged" })
  expect(envelope.data.completed_effect_ids).toBeUndefined()
  expect(actual.stderr).not.toContain(subject.root)
  expect(existsSync(subject.distRoot)).toBe(false)
})

test("P05 payload check stays a deferred owner refusal", async () => {
  const actual = await releasedFacade().invoke({ argv: ["--run-id", fixedRunId, "maintenance", "payload", "check", "--request", jsonFile({ repositoryRoot: "/fixture/plugin", mode: "check" })], environment: {}, stdin: "" })
  expect(actual).toMatchObject({ stdout: "", exitCode: 21 })
  expect(envelopeOf(actual.stderr).data).toMatchObject({ command: "payload:check", result_code: "command-refused", station_id: "payload-check.command-refused" })
})

test("P06 payload materialize stays a deferred owner refusal", async () => {
  const actual = await releasedFacade().invoke({ argv: ["--run-id", fixedRunId, "maintenance", "payload", "materialize", "--request", jsonFile({ repositoryRoot: "/fixture/plugin", mode: "materialize" })], environment: {}, stdin: "" })
  expect(actual).toMatchObject({ stdout: "", exitCode: 21 })
  expect(envelopeOf(actual.stderr).data).toMatchObject({ command: "payload:materialize", result_code: "command-refused", station_id: "payload-materialize.command-refused" })
})

test("P07 a package preview maps to the deferred check refusal without touching output", async () => {
  const subject = fixture()
  const requests: PayloadPackageRequest[] = []
  const observing: PluginPayloadProduction = {
    async produce(request) {
      if (request.mode === "package") requests.push(request)
      return createPluginPayloadProduction().produce(request)
    },
  }
  const preview = await commandsWith(observing).inspect({ command: "payload:package", request: subject.request })
  expect(preview).toMatchObject({ status: "error", resultCode: "command-refused", stationId: "payload-check.command-refused" })
  expect(requests).toEqual([])
  expect(existsSync(subject.distRoot)).toBe(false)
})

test("P08 a checksum-only output state is preserved and refused", async () => {
  const subject = fixture()
  mkdirSync(subject.distRoot)
  writeFileSync(subject.checksumsPath, "{\"stale\":true}\n")
  const actual = await invokePackage(sourceCheckoutFacade(), subject.request)
  expect(actual).toMatchObject({ stdout: "", exitCode: 21 })
  expect(envelopeOf(actual.stderr).data).toMatchObject({ result_code: "command-refused", station_id: "payload-package.command-refused", transaction_state: "unchanged" })
  expect(readdirSync(subject.distRoot)).toEqual(["plugin-0.1.0.checksums.json"])
  expect(readFileSync(subject.checksumsPath, "utf8")).toBe("{\"stale\":true}\n")
})

test("P09 an unsafe output path or symlink is refused without writes", async () => {
  const linked = fixture()
  const elsewhere = join(linked.root, "elsewhere")
  mkdirSync(elsewhere)
  symlinkSync(elsewhere, linked.distRoot)
  const viaDirectory = await invokePackage(sourceCheckoutFacade(), linked.request)
  expect(viaDirectory).toMatchObject({ stdout: "", exitCode: 21 })
  expect(envelopeOf(viaDirectory.stderr).data).toMatchObject({ result_code: "command-refused", station_id: "payload-package.command-refused" })
  expect(readdirSync(elsewhere)).toEqual([])
  const archiveLink = fixture()
  mkdirSync(archiveLink.distRoot)
  writeFileSync(join(archiveLink.root, "target.tar.gz"), "target\n")
  symlinkSync(join(archiveLink.root, "target.tar.gz"), archiveLink.archivePath)
  const viaArchive = await invokePackage(sourceCheckoutFacade(), archiveLink.request)
  expect(viaArchive).toMatchObject({ stdout: "", exitCode: 21 })
  expect(readdirSync(archiveLink.distRoot)).toEqual(["plugin-0.1.0.tar.gz"])
  expect(readFileSync(join(archiveLink.root, "target.tar.gz"), "utf8")).toBe("target\n")
})

const injected = (result: PayloadProductionResult): PluginPayloadProduction => ({ produce: async () => result })

test("P10 an archive-only publication failure projects partial state and its repair", async () => {
  const archive = { path: "/fixture/plugin/dist/example-plugin-1.0.0.tar.gz", bytes: 130, sha256: `sha256:${"1".repeat(64)}` as const }
  const actual = await invokePackage(sourceCheckoutFacade(injected({
    kind: "failed", code: "publication-interrupted", publication: "archive-only", transient: false,
    artifacts: { archive, checksums: null }, nextAction: "Repeat payload:package to complete the checksum publication for the published archive.",
  })), literalPackageRequest)
  expect(actual).toMatchObject({ stdout: "", exitCode: 20 })
  const envelope = envelopeOf(actual.stderr)
  expect(envelope.data).toEqual(expect.objectContaining({
    command: "payload:package",
    result_code: "continuation-required",
    station_id: "payload-package.continuation-required",
    transaction_state: "partially-completed",
    completed_effect_ids: ["effect:payload-archive-published"],
    remaining_effect_ids: ["effect:payload-checksums-published"],
  }))
  expect(envelope.error).toMatchObject({ failureClass: "continuation", exitCodeHint: 20 })
})

test("P11 a pre-publication failure reports unchanged state and no success", async () => {
  const actual = await invokePackage(sourceCheckoutFacade(injected({
    kind: "failed", code: "compressor-failed", publication: "none", transient: false,
    artifacts: { archive: null, checksums: null }, nextAction: "Inspect the host gzip, then repeat payload:package.",
  })), literalPackageRequest)
  expect(actual).toMatchObject({ stdout: "", exitCode: 21 })
  const envelope = envelopeOf(actual.stderr)
  expect(envelope.data).toMatchObject({ result_code: "command-refused", station_id: "payload-package.command-refused", transaction_state: "unchanged" })
  expect(envelope.data.completed_effect_ids).toBeUndefined()
  expect(envelope.error).toMatchObject({ failureClass: "refusal", exitCodeHint: 21 })
  const transient = await invokePackage(sourceCheckoutFacade(injected({
    kind: "failed", code: "staging-failed", publication: "none", transient: true,
    artifacts: { archive: null, checksums: null }, nextAction: "Repeat payload:package.",
  })), literalPackageRequest)
  expect(transient).toMatchObject({ stdout: "", exitCode: 22 })
  expect(envelopeOf(transient.stderr).data).toMatchObject({ result_code: "retry-deferred", station_id: "payload-package.retry-deferred", transaction_state: "unchanged" })
})
