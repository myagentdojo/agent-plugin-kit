import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mutatingRequests } from "../../../src/modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"
import { createPluginFixture, type PluginFixture } from "../../../src/modules/plugin-payload-production/contract-tests/fixtures/prepared-plugin-fixture"
import { createAdmittedPackageConsumer, git, kitOrigin, type AdmittedPackageConsumer, type ProcessResult } from "./adapters/admitted-package-consumer"
import {
  sourceCheckoutNotAdmittedMessage,
  sourceCheckoutPackageArguments,
  sourceCheckoutPayloadRefusalMessage,
} from "./adapters/source-checkout-contract-subject"
import { sourceCheckoutAdmissionCases } from "./fixtures/source-checkout-admission-cases"

let consumer: AdmittedPackageConsumer
let prepared: PluginFixture, payloadPrepared: PluginFixture
let packageRequest = "", preparedRequest = "", payloadCheckRequest = "", payloadMaterializeRequest = ""
const run = (args: string[], options: { entry?: string; cwd?: string; environment?: Record<string, string | undefined> } = {}) => consumer.run(args, options)
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
/** Admitted checkout, well-formed request, nonexistent payload root: the Payload owner refuses, Admission does not. */
async function expectPayloadRefusal(request: string) {
  const result = await run(sourceCheckoutPackageArguments(request))
  expect(result.exitCode).toBe(21)
  expect(result.stdout).toBe("")
  const envelope = JSON.parse(result.stderr.trim().split("\n").at(-1) ?? "{}") as Record<string, unknown>
  expect(envelope).toMatchObject({
    record_type: "error_envelope",
    status: "error",
    message: sourceCheckoutPayloadRefusalMessage,
    run_id: "source-checkout",
    data: { command: "payload:package", result_code: "command-refused", station_id: "payload-package.command-refused", transaction_state: "unchanged" },
    error: { code: "command-refused", exitCodeHint: 21, failureClass: "refusal" },
  })
  expect(result.stderr).not.toContain(sourceCheckoutNotAdmittedMessage)
}
/** Refused Admission never reaches Payload: the prepared fixture gains no dist/ output. */
function expectPayloadUntouched(): void {
  expect(existsSync(prepared.distRoot)).toBe(false)
}
beforeAll(async () => {
  consumer = createAdmittedPackageConsumer()
  prepared = createPluginFixture({ files: [{ path: "a-safe.txt", bytes: "safe\n" }] })
  payloadPrepared = createPluginFixture({
    files: [
      { path: "a-safe.txt", bytes: "safe\n" },
      { path: "skills/fixture/SKILL.md", bytes: "# Fixture\n" },
    ],
    projections: [
      { role: "runtime-lock", path: "runtime/runtime.lock.json", bytes: '{"lock":"fixture"}\n' },
      { role: "config", path: "runtime/plugin.config.json", bytes: '{"fixture":true}\n' },
      { role: "skill-inventory", path: "runtime/skill-catalog.json", bytes: '{"skills":["fixture"]}\n' },
    ],
  })
  packageRequest = join(consumer.consumerRoot, "request.json"); preparedRequest = join(consumer.consumerRoot, "prepared-request.json")
  writeFileSync(packageRequest, JSON.stringify({ ...prepared.request, repositoryRoot: join(consumer.fixtureRoot, "nonexistent-payload-root") }))
  writeFileSync(preparedRequest, JSON.stringify(prepared.request))
  const payloadRequest = {
    repositoryRoot: payloadPrepared.root,
    configuration: {
      plugin: {
        name: "source-checkout-plugin", displayName: "Source Checkout Plugin", version: "0.1.0",
        description: "Source checkout payload fixture", author: { name: "Fixture Author" },
        repository: "https://github.com/example/source-checkout-plugin", license: "MIT", keywords: ["fixture"],
        category: "Developer Tools", shortDescription: "Source checkout payload",
        longDescription: "Source checkout payload fixture", capabilities: ["payload-check"],
        defaultPrompts: ["Check this payload"], brandColor: "#123ABC",
        composerIcon: "./assets/fixture-plugin.svg", logo: "./assets/fixture-plugin.svg", hookDeclarationPaths: [],
      },
      skills: [{ id: "fixture", hookDependence: "hook-independent", production: { kind: "model-only" } }],
    },
    sourceProjectionPaths: { config: "runtime/plugin.config.json", runtimeLock: "runtime/runtime.lock.json", skillInventory: "runtime/skill-catalog.json" },
  }
  payloadCheckRequest = join(consumer.consumerRoot, "payload-check-request.json")
  payloadMaterializeRequest = join(consumer.consumerRoot, "payload-materialize-request.json")
  writeFileSync(payloadCheckRequest, JSON.stringify({ ...payloadRequest, mode: "check" }))
  writeFileSync(payloadMaterializeRequest, JSON.stringify({ ...payloadRequest, mode: "materialize" }))
})
beforeEach(() => { consumer.commitAuthority(consumer.kitCommit) })
afterAll(() => { rmSync(prepared.root, { recursive: true, force: true }); rmSync(payloadPrepared.root, { recursive: true, force: true }); consumer?.dispose() })
test(sourceCheckoutAdmissionCases.admittedPayloadRefusal.title, async () => {
  expect(git(consumer.kitRoot, "status", "--porcelain=v1", "--untracked-files=all")).toBe("")
  expect(readFileSync(join(consumer.consumerRoot, "dist/generated.txt"), "utf8")).toBe("allowed\n")
  await expectPayloadRefusal(packageRequest)
  const materialized = await run(["--run-id", "source-checkout-payload-materialize", "maintenance", "payload", "materialize", "--request", payloadMaterializeRequest])
  expect(materialized.exitCode).toBe(0)
  expect(materialized.stderr).toBe("")
  expect(materialized.stdout).toContain('"command":"payload:materialize"')
  expect(materialized.stdout).toContain('"result_code":"completed"')
  const checked = await run(["--run-id", "source-checkout-payload-check", "maintenance", "payload", "check", "--request", payloadCheckRequest])
  expect(checked.exitCode).toBe(0)
  expect(checked.stderr).toBe("")
  expect(checked.stdout).toContain('"command":"payload:check"')
  expect(checked.stdout).toContain('"result_code":"previewed"')
})
test(sourceCheckoutAdmissionCases.committedWrongPin.title, async () => {
  consumer.commitAuthority("e".repeat(40))
  expectPublicRefusal(await run(sourceCheckoutPackageArguments(preparedRequest)), sourceCheckoutNotAdmittedMessage)
  expectPayloadUntouched()
})
test(sourceCheckoutAdmissionCases.uncommittedRestoration.title, async () => {
  consumer.commitAuthority("e".repeat(40))
  writeFileSync(join(consumer.consumerRoot, "package.json"), JSON.stringify({ dependencies: { "agent-plugin-kit": `git+${kitOrigin}#${consumer.kitCommit}` } }))
  expectPublicRefusal(await run(sourceCheckoutPackageArguments(preparedRequest)), sourceCheckoutNotAdmittedMessage)
  expectPayloadUntouched()
})
test(sourceCheckoutAdmissionCases.committedRestoration.title, async () => {
  consumer.commitAuthority("e".repeat(40)); consumer.commitAuthority(consumer.kitCommit)
  await expectPayloadRefusal(packageRequest)
})
test(sourceCheckoutAdmissionCases.dirtyCheckout.title, async () => {
  const dirty = join(consumer.kitRoot, "README.md"), original = readFileSync(dirty, "utf8"), request = preparedRequest
  expect(statSync(request).isFile()).toBe(true)
  const setupFailure = await run(sourceCheckoutPackageArguments(request), { environment: { ...process.env, TMPDIR: request } })
  expect(setupFailure.stderr).not.toContain(request)
  expectPublicRefusal(setupFailure, sourceCheckoutNotAdmittedMessage)
  writeFileSync(dirty, `${original}\n`)
  try { expectPublicRefusal(await run(sourceCheckoutPackageArguments(request)), sourceCheckoutNotAdmittedMessage) } finally { writeFileSync(dirty, original) }
  expectPayloadUntouched()
  await expectPayloadRefusal(packageRequest)
})
test(sourceCheckoutAdmissionCases.gitInstalledCopy.title, async () => {
  const productionConsumer = join(consumer.fixtureRoot, "production-consumer"), commit = git(consumer.kitRoot, "rev-parse", "HEAD")
  mkdirSync(productionConsumer, { recursive: true })
  const dependency = `git+file://${consumer.kitRoot}#${commit}`
  writeFileSync(join(productionConsumer, "package.json"), JSON.stringify({ name: "production-consumer", dependencies: { "agent-plugin-kit": dependency } }) + "\n")
  await Bun.$`bun install`.cwd(productionConsumer).quiet()
  const installed = join(productionConsumer, "node_modules/agent-plugin-kit")
  expect(existsSync(join(installed, ".git"))).toBe(false)
  const entry = join(productionConsumer, "node_modules/.bin/agent-plugin-kit")
  expectPublicRefusal(await run(sourceCheckoutPackageArguments(preparedRequest), { entry, cwd: productionConsumer }), sourceCheckoutNotAdmittedMessage)
  expectPayloadUntouched()
})
test(sourceCheckoutAdmissionCases.protectedCommand.title, async () => {
  const releaseRequest = join(consumer.consumerRoot, "release-request.json"), approval = join(consumer.consumerRoot, "approval.json"), canaryCandidate = join(consumer.consumerRoot, "canary-candidate.json"), authority = join(consumer.consumerRoot, "authority.json")
  writeFileSync(releaseRequest, JSON.stringify(mutatingRequests.release.request)); writeFileSync(approval, JSON.stringify(mutatingRequests.release.approval)); writeFileSync(canaryCandidate, JSON.stringify(mutatingRequests.canary.candidate)); writeFileSync(authority, JSON.stringify("authority-sentinel"))
  const release = await run(["--run-id", "source-checkout", "maintenance", "release", "apply", "--request", releaseRequest, "--approval", approval])
  const canary = await run(["--run-id", "source-checkout", "maintenance", "canary", "qualify", "--candidate", canaryCandidate, "--authority", authority])
  expectPublicRefusal(release, "Maintenance command is not admitted.")
  expectPublicRefusal(canary, "Maintenance command is not admitted.")
  expect(`${release.stderr}${canary.stderr}`).not.toContain("authority-sentinel")
})
