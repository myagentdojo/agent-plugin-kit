import { createHash } from "node:crypto"
import { expect, test } from "bun:test"
import { createMaintenanceContractHarness } from "./adapters/mutation-recording-module-adapter"
import { approvalDigestVectors } from "./fixtures/approval-digest-vectors"
import { mutatingRequests } from "./fixtures/literal-command-results"
import type { CommandPreview } from "../interface"

const digest = (bytes: string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`

async function assertApply(
  key: keyof typeof mutatingRequests,
  effectClass: CommandPreview["effectClass"],
) {
  const harness = createMaintenanceContractHarness()
  const request = mutatingRequests[key]
  const vector =
    key === "release" ? approvalDigestVectors[0]
    : key === "claude" ? approvalDigestVectors[1]
    : key === "codex" ? approvalDigestVectors[2]
    : undefined

  if (vector) {
    expect(digest(vector.candidateBytes)).toBe(vector.candidateDigest)
    expect(digest(vector.inspectedStateBytes)).toBe(vector.inspectedStateDigest)
    expect(digest(vector.expectedEffectsBytes)).toBe(vector.expectedEffectsDigest)
    expect(digest(vector.approvalBytes)).toBe(vector.approvalDigest)
  }

  const retrySafety =
    key === "materialize" || key === "package" ? "safe" : "requires-fresh-inspection"
  const preview = await harness.inspect(request)
  expect(preview, `contract-absent: ${request.command} must classify before apply`).toMatchObject({
    status: "ok",
    value: { command: request.command, effectClass, retrySafety },
  })
  const actual = await harness.apply(request)
  expect(actual, `contract-absent: ${request.command} must preserve exact Retry Safety`).toMatchObject({
    status: "ok",
    value: { command: request.command, retrySafety },
  })
  if (actual?.status === "ok") {
    expect("resultCode" in actual.value).toBeFalse()
    expect("stationId" in actual.value).toBeFalse()
    expect("exitClass" in actual.value).toBeFalse()
  }
  if (key === "runtime") {
    expect(harness.runtimeSpawnLedger).toEqual([
      {
        argv: ["repair"],
        control: { code: "REPAIR_PREVIEW", schemaVersion: 1, state: { before: "missing" } },
      },
      { argv: ["repair", "--apply"], control: null },
    ])
  } else {
    const owner =
      key === "materialize" || key === "package" ? "payload"
      : key === "release" ? "release"
      : key
    expect(harness.applyLedgers[owner]).toEqual([request])
  }
}

test("payload materialize is repository-local", () => assertApply("materialize", "repository-local"))
test("payload package is repository-local", () => assertApply("package", "repository-local"))
test("runtime repair apply transports outside approval", () => assertApply("runtime", "external"))
test("release apply transports only its fixed approval vector", () => assertApply("release", "external"))
test("Claude apply transports only its fixed approval vector", () => assertApply("claude", "external"))
test("Codex apply transports only its fixed approval vector", () => assertApply("codex", "external"))
test("canary qualify transports protected authority", () => assertApply("canary", "external"))

test("inspection requests no capability and writes no durable target", async () => {
  const harness = createMaintenanceContractHarness()
  const durableBefore = harness.durableDigest()
  const actual = await harness.inspect({ command: "release:inspect", request: { candidate: mutatingRequests.release.request.candidate, intent: "readiness" } })

  expect(harness.applyLedgers).toEqual({
    payload: [],
    release: [],
    claude: [],
    codex: [],
    canary: [],
  })
  expect(harness.runtimeSpawnLedger).toEqual([])
  expect(harness.durableDigest()).toBe(durableBefore)
  expect(actual, "contract-absent: inspection must return an immutable preview").toMatchObject({
    status: "ok",
    resultCode: "previewed",
    stationId: "release-inspect.previewed",
    value: { effectClass: "inspect", transactionState: "unchanged" },
  })
})

test("runtime repair apply refreshes preview immediately before exact apply argv", async () => {
  expect(Object.keys(mutatingRequests.runtime).sort()).toEqual(["argv", "command"])
  expect(mutatingRequests.runtime.argv).toEqual(["repair", "--apply"])
  const scenarios = [
    { label: "fresh missing preview", control: { code: "REPAIR_PREVIEW", schemaVersion: 1, state: { before: "missing" } }, apply: true, stationId: "runtime-repair-apply.runtime-repair-applied" },
    { label: "fresh corrupt preview", control: { code: "REPAIR_PREVIEW", schemaVersion: 1, state: { before: "corrupt" } }, apply: true, stationId: "runtime-repair-apply.runtime-repair-applied" },
    { label: "repair unneeded", control: { code: "REPAIR_UNNEEDED", schemaVersion: 1, state: { before: "valid" } }, apply: false, stationId: "runtime-repair-apply.runtime-repair-unneeded" },
    { label: "typed refusal", control: { code: "USAGE", schemaVersion: 1 }, apply: false, stationId: "runtime-repair-apply.runtime-usage-refused" },
    { label: "invalid control", control: { code: "INVALID_CONTROL", schemaVersion: 1 }, apply: false, stationId: "runtime-repair-apply.runtime-control-invalid" },
  ] as const
  for (const scenario of scenarios) {
    const harness = createMaintenanceContractHarness(undefined, { runtimeControls: [scenario.control] })
    const actual = await harness.apply(mutatingRequests.runtime)
    expect(actual, `contract-absent: ${scenario.label} must enforce the fresh Runtime apply precondition`).toMatchObject({ stationId: scenario.stationId })
    expect(harness.runtimeSpawnLedger).toEqual([
      { argv: ["repair"], control: scenario.control },
      ...(scenario.apply ? [{ argv: ["repair", "--apply"], control: null }] : []),
    ])
  }
  const repeated = createMaintenanceContractHarness(undefined, {
    runtimeControls: [
      { code: "REPAIR_PREVIEW", schemaVersion: 1, state: { before: "missing" } },
      { code: "REPAIR_PREVIEW", schemaVersion: 1, state: { before: "corrupt" } },
    ],
  })
  await repeated.apply(mutatingRequests.runtime)
  await repeated.apply(mutatingRequests.runtime)
  expect(repeated.runtimeSpawnLedger.map(({ argv }) => argv)).toEqual([
    ["repair"], ["repair", "--apply"], ["repair"], ["repair", "--apply"],
  ])
})
