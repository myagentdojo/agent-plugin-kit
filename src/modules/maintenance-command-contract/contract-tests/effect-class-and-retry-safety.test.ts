import { createHash } from "node:crypto"
import { expect, test } from "bun:test"
import {
  createMaintenanceContractHarness,
  runtimeControl,
} from "./adapters/mutation-recording-module-adapter"
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
        result: runtimeControl("REPAIR_PREVIEW", { state: { before: "missing" } }),
      },
      {
        argv: ["repair", "--apply"],
        result: runtimeControl("REPAIR_APPLIED", { sideEffects: ["published-runtime"] }),
      },
    ])
  } else {
    const owner =
      key === "materialize" || key === "package" ? "payload"
      : key === "release" ? "release"
      : key
    expect(harness.applyLedgers[owner]).toEqual([request])
    if (effectClass === "external") {
      expect(await harness.apply(request)).toMatchObject({
        status: "error",
        resultCode: "recovery-required",
      })
      expect(harness.applyLedgers[owner]).toEqual([request])
      await harness.inspect(request)
      expect(await harness.apply(request)).toMatchObject({ status: "ok" })
      expect(harness.applyLedgers[owner]).toEqual([request, request])
    }
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
    {
      label: "fresh missing preview",
      results: [
        runtimeControl("REPAIR_PREVIEW", { state: { before: "missing" } }),
        runtimeControl("REPAIR_APPLIED", { sideEffects: ["published-runtime"] }),
      ],
      stationId: "runtime-repair-apply.runtime-repair-applied",
    },
    {
      label: "fresh corrupt preview",
      results: [
        runtimeControl("REPAIR_PREVIEW", { state: { before: "corrupt" } }),
        runtimeControl("REPAIR_APPLIED", { sideEffects: ["published-runtime"] }),
      ],
      stationId: "runtime-repair-apply.runtime-repair-applied",
    },
    {
      label: "repair unneeded",
      results: [runtimeControl("REPAIR_UNNEEDED", { state: { before: "valid" } })],
      stationId: "runtime-repair-apply.runtime-repair-unneeded",
    },
    {
      label: "typed refusal",
      results: [runtimeControl("USAGE", { ok: false, exitClass: 2 })],
      stationId: "runtime-repair-apply.runtime-usage-refused",
    },
    {
      label: "apply refusal",
      results: [
        runtimeControl("REPAIR_PREVIEW", { state: { before: "missing" } }),
        runtimeControl("USAGE", { ok: false, exitClass: 2 }),
      ],
      stationId: "runtime-repair-apply.runtime-usage-refused",
    },
    {
      label: "invalid process result",
      results: [{ kind: "skill-process", stdout: new Uint8Array(), stderr: new Uint8Array(), exitCode: 0 }],
      stationId: "runtime-repair-apply.runtime-control-invalid",
    },
  ] as const
  for (const scenario of scenarios) {
    const harness = createMaintenanceContractHarness(undefined, { runtimeResults: scenario.results })
    const actual = await harness.apply(mutatingRequests.runtime)
    expect(actual, `contract-absent: ${scenario.label} must enforce the fresh Runtime apply precondition`).toMatchObject({ stationId: scenario.stationId })
    expect(harness.runtimeSpawnLedger.map(({ argv }) => argv)).toEqual(
      scenario.results.length === 2
        ? [["repair"], ["repair", "--apply"]]
        : [["repair"]],
    )
  }
  const repeated = createMaintenanceContractHarness(undefined, {
    runtimeResults: [
      runtimeControl("REPAIR_PREVIEW", { state: { before: "missing" } }),
      runtimeControl("REPAIR_APPLIED", { sideEffects: ["published-runtime"] }),
      runtimeControl("REPAIR_PREVIEW", { state: { before: "corrupt" } }),
      runtimeControl("REPAIR_APPLIED", { sideEffects: ["published-runtime"] }),
    ],
  })
  await repeated.apply(mutatingRequests.runtime)
  await repeated.apply(mutatingRequests.runtime)
  expect(repeated.runtimeSpawnLedger.map(({ argv }) => argv)).toEqual([
    ["repair"], ["repair", "--apply"], ["repair"], ["repair", "--apply"],
  ])
})
