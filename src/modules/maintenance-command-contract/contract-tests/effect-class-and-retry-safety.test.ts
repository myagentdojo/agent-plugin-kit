import { createHash } from "node:crypto"
import { expect, test } from "bun:test"
import {
  createMaintenanceContractHarness,
  runtimeControl,
} from "./adapters/mutation-recording-module-adapter"
import { approvalDigestVectors } from "./fixtures/approval-digest-vectors"
import { mutatingRequests } from "./fixtures/literal-command-results"
import type {
  CommandPreview,
  MaintenanceApplyRequest,
  MaintenanceCommand,
} from "../interface"

const digest = (bytes: string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`

const canonicalInspectionFor = (request: MaintenanceApplyRequest): MaintenanceCommand => {
  switch (request.command) {
    case "release:apply":
      return {
        command: "release:inspect",
        request: { candidate: request.request.candidate, intent: request.request.intent },
      }
    case "harness:claude:apply":
      return {
        command: "harness:claude:inspect",
        request: {
          identity: request.request.identity,
          payload: request.request.payload,
          profileIdentity: request.request.profileIdentity,
        },
      }
    case "harness:codex:apply":
      return {
        command: "harness:codex:inspect",
        request: {
          identity: request.request.identity,
          payload: request.request.payload,
          profileIdentity: request.request.profileIdentity,
          checkoutIdentity: request.request.checkoutIdentity,
        },
      }
    case "canary:qualify":
      return { command: "canary:inspect", candidate: request.candidate }
    default:
      return request
  }
}

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
  const inspection = canonicalInspectionFor(request)
  const preview = await harness.inspect(inspection)
  expect(preview, `contract-absent: ${request.command} must classify before apply`).toMatchObject({
    status: "ok",
    value: {
      command: inspection.command,
      effectClass: inspection.command === request.command ? effectClass : "inspect",
      retrySafety: inspection.command === request.command ? retrySafety : "safe",
    },
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
      await harness.inspect(inspection)
      expect(await harness.apply(request)).toMatchObject({ status: "ok" })
      expect(harness.applyLedgers[owner]).toEqual([request, request])
    }
  }
}

test("payload materialize is repository-local", () => assertApply("materialize", "repository-local"))
test("payload package is repository-local", () => assertApply("package", "repository-local"))
test("runtime repair apply transports outside approval", () => assertApply("runtime", "external"))
test("release apply transports only its fixed approval vector", async () => {
  await assertApply("release", "external")
  const request = mutatingRequests.release
  const partial = createMaintenanceContractHarness(undefined, {
    releaseResult: {
      candidate: request.request.candidate,
      completedEffectIds: [],
      remainingEffectIds: ["effect:release"],
    },
  })
  await partial.inspect(canonicalInspectionFor(request))
  expect(await partial.apply(request)).toMatchObject({
    status: "error",
    resultCode: "continuation-required",
    stationId: "release-apply.continuation-required",
    error: {
      exitCodeHint: 20,
      failureClass: "continuation",
      retrySafety: "unsafe",
      transactionState: "partially-completed",
      completedEffectIds: [],
      remainingEffectIds: ["effect:release"],
    },
  })

  const changedBinding = createMaintenanceContractHarness()
  const changedRequest: MaintenanceApplyRequest = {
    command: "release:apply",
    request: {
      candidate: request.request.candidate,
      intent: request.request.intent,
      expectedEffectIds: ["effect:changed"],
    },
    approval: request.approval,
  }
  await changedBinding.inspect(canonicalInspectionFor(request))
  expect(await changedBinding.apply(changedRequest)).toMatchObject({
    status: "error",
    resultCode: "recovery-required",
  })
  expect(changedBinding.applyLedgers.release).toEqual([])
  expect(await changedBinding.apply(request)).toMatchObject({
    status: "error",
    resultCode: "recovery-required",
  })
})
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
  const exactPreview = createMaintenanceContractHarness(undefined, {
    runtimeResults: [runtimeControl("REPAIR_PREVIEW", { state: { before: "missing" } })],
  })
  expect(await exactPreview.inspect({ command: "runtime:repair", argv: ["repair"] })).toMatchObject({
    status: "ok",
    resultCode: "runtime-repair-preview",
    stationId: "runtime-repair.runtime-repair-preview",
    value: {
      nextAction: { id: "runtime.review-repair-preview" },
      retrySafety: "safe",
      transactionState: "unchanged",
    },
  })

  const hostileSecret = "runtime-private-diagnostic-token"
  const hostileRuntime = createMaintenanceContractHarness(undefined, {
    runtimeResults: [
      runtimeControl("REPAIR_PREVIEW", {
        state: { before: "missing" },
        stderr: hostileSecret,
      }),
      runtimeControl("REPAIR_PREVIEW", {
        state: { before: "missing" },
        stderr: hostileSecret,
      }),
      runtimeControl("REPAIR_APPLIED", {
        sideEffects: ["published-runtime"],
        stderr: hostileSecret,
      }),
    ],
  })
  const hostilePreview = await hostileRuntime.inspect({ command: "runtime:repair", argv: ["repair"] })
  expect(JSON.stringify(hostilePreview?.status === "ok" ? hostilePreview.value.agent : undefined)).not.toContain(hostileSecret)
  const hostileApplied = await hostileRuntime.apply(mutatingRequests.runtime)
  expect(JSON.stringify(hostileApplied?.status === "ok" ? hostileApplied.value.agent : undefined)).not.toContain(hostileSecret)

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
    {
      label: "applied result in inspection position",
      results: [runtimeControl("REPAIR_APPLIED", { sideEffects: ["published-runtime"] })],
      stationId: "runtime-repair-apply.runtime-control-invalid",
    },
    {
      label: "preview result in apply position",
      results: [
        runtimeControl("REPAIR_PREVIEW", { state: { before: "missing" } }),
        runtimeControl("REPAIR_PREVIEW", { state: { before: "missing" } }),
      ],
      stationId: "runtime-repair-apply.runtime-control-invalid",
    },
    {
      label: "unneeded result in apply position",
      results: [
        runtimeControl("REPAIR_PREVIEW", { state: { before: "missing" } }),
        runtimeControl("REPAIR_UNNEEDED", { state: { before: "valid" } }),
      ],
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
