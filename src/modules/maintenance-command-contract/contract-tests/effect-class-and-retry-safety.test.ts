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
import type { MaintenanceInspectionInput } from "../implementation/maintenance-commands"

type ReleaseApplyInspectionInput = Extract<MaintenanceInspectionInput, { command: "release:apply" }>
type ProtectedInputIsStripped = "approval" extends keyof ReleaseApplyInspectionInput ? false : true
const protectedInputIsStripped: ProtectedInputIsStripped = true

const digest = (bytes: string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`

const canonicalInspectionFor = (request: MaintenanceApplyRequest): MaintenanceCommand => {
  switch (request.command) {
    case "payload:materialize":
    case "payload:package":
      return { command: "payload:check", request: { ...request.request, mode: "check" } }
    case "runtime:repair-apply":
      return { command: "runtime:repair", argv: ["repair"] }
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
  spec: ApplySpec,
) {
  const request = mutatingRequests[key]
  const harness = createHarnessFor(key)
  assertApprovalDigestVector(key)
  const inspection = canonicalInspectionFor(request)
  const preview = await harness.inspect(inspection)
  expect(preview, `implemented: ${request.command} classifies before apply`).toMatchObject({
    status: "ok",
    value: {
      command: inspection.command,
      effectClass: inspection.command === request.command ? spec.effectClass : "inspect",
      retrySafety: inspection.command === request.command ? spec.retrySafety : "safe",
    },
  })
  const actual = await harness.apply(request)
  assertSuccessfulApply(actual, request, spec.retrySafety)
  await assertApplyOutcome(harness, key, request, inspection, spec)
}

type MutationKey = keyof typeof mutatingRequests
type Harness = ReturnType<typeof createMaintenanceContractHarness>
type ApplyOutcome = Awaited<ReturnType<Harness["apply"]>>
type ApplySpec = {
  effectClass: CommandPreview["effectClass"]
  retrySafety: "safe" | "requires-fresh-inspection"
  owner?: keyof Harness["applyLedgers"]
}

const applySpecs = {
  materialize: { effectClass: "repository-local", retrySafety: "safe", owner: "payload" },
  package: { effectClass: "repository-local", retrySafety: "safe", owner: "payload" },
  runtime: { effectClass: "external", retrySafety: "requires-fresh-inspection" },
  release: { effectClass: "external", retrySafety: "requires-fresh-inspection", owner: "release" },
  claude: { effectClass: "external", retrySafety: "requires-fresh-inspection", owner: "claude" },
  codex: { effectClass: "external", retrySafety: "requires-fresh-inspection", owner: "codex" },
  canary: { effectClass: "external", retrySafety: "requires-fresh-inspection", owner: "canary" },
} as const satisfies Record<MutationKey, ApplySpec>

const createHarnessFor = (key: MutationKey): Harness => key === "runtime"
  ? createMaintenanceContractHarness({
      runtimeResults: [
        runtimeControl("REPAIR_PREVIEW", { state: { before: "missing" } }),
        runtimeControl("REPAIR_PREVIEW", { state: { before: "missing" } }),
        runtimeControl("REPAIR_APPLIED", { sideEffects: ["published-runtime"] }),
      ],
    })
  : createMaintenanceContractHarness()

const approvalDigestVectorFor = (key: MutationKey) => {
  switch (key) {
    case "release": return approvalDigestVectors[0]
    case "claude": return approvalDigestVectors[1]
    case "codex": return approvalDigestVectors[2]
    default: return undefined
  }
}

const assertApprovalDigestVector = (key: MutationKey) => {
  const vector = approvalDigestVectorFor(key)
  if (vector === undefined) return
  expect(digest(vector.candidateBytes)).toBe(vector.candidateDigest)
  expect(digest(vector.inspectedStateBytes)).toBe(vector.inspectedStateDigest)
  expect(digest(vector.expectedEffectsBytes)).toBe(vector.expectedEffectsDigest)
  expect(digest(vector.approvalBytes)).toBe(vector.approvalDigest)
}

const assertSuccessfulApply = (
  actual: ApplyOutcome,
  request: MaintenanceApplyRequest,
  retrySafety: ApplySpec["retrySafety"],
) => {
  expect(actual, `implemented: ${request.command} preserves exact Retry Safety`).toMatchObject({
    status: "ok",
    value: { command: request.command, retrySafety },
  })
  if (actual.status !== "ok") return
  expect("resultCode" in actual.value).toBeFalse()
  expect("stationId" in actual.value).toBeFalse()
  expect("exitClass" in actual.value).toBeFalse()
}

const assertRuntimeApplyOutcome = (harness: Harness) => {
  expect(harness.runtimeSpawnLedger).toEqual([
    {
      argv: ["repair"],
      result: runtimeControl("REPAIR_PREVIEW", { state: { before: "missing" } }),
    },
    {
      argv: ["repair"],
      result: runtimeControl("REPAIR_PREVIEW", { state: { before: "missing" } }),
    },
    {
      argv: ["repair", "--apply"],
      result: runtimeControl("REPAIR_APPLIED", { sideEffects: ["published-runtime"] }),
    },
  ])
}

const assertOwnerApplyOutcome = async (
  harness: Harness,
  request: MaintenanceApplyRequest,
  inspection: MaintenanceCommand,
  spec: ApplySpec,
) => {
  const owner = spec.owner
  if (owner === undefined) throw new Error("owner apply outcome requires an owner ledger")
  expect(harness.applyLedgers[owner]).toEqual([request])
  if (spec.effectClass !== "external") return
  expect(await harness.apply(request)).toMatchObject({
    status: "error",
    resultCode: "recovery-required",
  })
  expect(harness.applyLedgers[owner]).toEqual([request])
  await harness.inspect(inspection)
  expect(await harness.apply(request)).toMatchObject({ status: "ok" })
  expect(harness.applyLedgers[owner]).toEqual([request, request])
}

const assertApplyOutcome = (
  harness: Harness,
  key: MutationKey,
  request: MaintenanceApplyRequest,
  inspection: MaintenanceCommand,
  spec: ApplySpec,
) => key === "runtime"
  ? assertRuntimeApplyOutcome(harness)
  : assertOwnerApplyOutcome(harness, request, inspection, spec)

test("payload materialize is repository-local", () => assertApply("materialize", applySpecs.materialize))
test("payload package is repository-local", () => assertApply("package", applySpecs.package))
test("runtime repair apply transports outside approval", () => assertApply("runtime", applySpecs.runtime))
test("release apply transports only its fixed approval vector", async () => {
  await assertApply("release", applySpecs.release)
  const request = mutatingRequests.release
  const partial = createMaintenanceContractHarness({
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

  const candidate = request.request.candidate
  const reorderedInspection: MaintenanceCommand = {
    command: "release:inspect",
    request: {
      intent: request.request.intent,
      candidate: {
        workflow: candidate.workflow,
        package: candidate.package,
        release: { commit: candidate.release.commit, reference: candidate.release.reference },
        source: { commit: candidate.source.commit, repository: candidate.source.repository },
      },
    },
  }
  const canonicalInspection = canonicalInspectionFor(request)
  if (canonicalInspection.command !== "release:inspect") throw new Error("expected a release inspection")
  expect(Object.keys(reorderedInspection.request)).not.toEqual(Object.keys(canonicalInspection.request))
  expect(Object.keys(reorderedInspection.request.candidate.source)).not.toEqual(
    Object.keys(canonicalInspection.request.candidate.source),
  )
  expect(JSON.stringify(reorderedInspection.request)).not.toBe(
    JSON.stringify(canonicalInspection.request),
  )
  const reordered = createMaintenanceContractHarness()
  await reordered.inspect(reorderedInspection)
  expect(await reordered.apply(request)).toMatchObject({ status: "ok" })
  expect(reordered.applyLedgers.release).toEqual([request])
  expect(await reordered.apply(request)).toMatchObject({
    status: "error",
    resultCode: "recovery-required",
  })
  expect(reordered.applyLedgers.release).toEqual([request])
})
test("Claude apply transports only its fixed approval vector", () => assertApply("claude", applySpecs.claude))
test("Codex apply transports only its fixed approval vector", () => assertApply("codex", applySpecs.codex))
test("canary qualify transports protected authority", () => assertApply("canary", applySpecs.canary))

test("inspection requests no capability and writes no durable target", async () => {
  const harness = createMaintenanceContractHarness()
  const durableBefore = harness.durableDigest()
  const actual = await harness.inspect({ command: "release:inspect", request: { candidate: mutatingRequests.release.request.candidate, intent: "readiness" } })
  const hostileAuthorityMarker = "hostile-canary-authority-marker"
  await harness.inspect(mutatingRequests.release)
  await harness.inspect(mutatingRequests.claude)
  await harness.inspect(mutatingRequests.codex)
  await harness.inspect({
    ...mutatingRequests.canary,
    authority: { hostileAuthorityMarker } as never,
  })

  expect(harness.applyLedgers).toEqual({
    payload: [],
    release: [],
    claude: [],
    codex: [],
    canary: [],
  })
  expect(harness.runtimeSpawnLedger).toEqual([])
  expect(harness.durableDigest()).toBe(durableBefore)
  expect(actual, "implemented: inspection returns an immutable preview").toMatchObject({
    status: "ok",
    resultCode: "previewed",
    stationId: "release-inspect.previewed",
    value: { effectClass: "inspect", transactionState: "unchanged" },
  })
  expect(protectedInputIsStripped).toBeTrue()
  const ownerInspectionJson = JSON.stringify(harness.ownerInspectionLedger)
  expect(ownerInspectionJson).not.toContain(mutatingRequests.release.approval.digest)
  expect(ownerInspectionJson).not.toContain(mutatingRequests.claude.approval.digest)
  expect(ownerInspectionJson).not.toContain(mutatingRequests.codex.approval.digest)
  expect(ownerInspectionJson).not.toContain(hostileAuthorityMarker)
  expect(harness.ownerInspectionLedger.every((entry) =>
    typeof entry === "object" &&
    entry !== null &&
    !Object.hasOwn(entry, "approval") &&
    !Object.hasOwn(entry, "authority") &&
    !Object.hasOwn(entry, "issuer"),
  )).toBeTrue()

  const observedInputs = harness.inspectionInputLedger
  expect(observedInputs.map(({ command }) => command)).toEqual([
    "release:inspect",
    "release:inspect",
    "harness:claude:inspect",
    "harness:codex:inspect",
    "canary:inspect",
  ])
  expect(observedInputs.every((observed) =>
    !Object.hasOwn(observed, "approval") && !Object.hasOwn(observed, "authority"),
  )).toBeTrue()
  const observedInputJson = JSON.stringify(observedInputs)
  expect(observedInputJson).not.toContain(mutatingRequests.release.approval.digest)
  expect(observedInputJson).not.toContain(mutatingRequests.claude.approval.digest)
  expect(observedInputJson).not.toContain(mutatingRequests.codex.approval.digest)
  expect(observedInputJson).not.toContain(hostileAuthorityMarker)
  expect(Object.hasOwn(mutatingRequests.release, "approval")).toBeTrue()
  expect(Object.hasOwn(mutatingRequests.canary, "authority")).toBeTrue()
})

test("runtime repair apply refreshes preview immediately before exact apply argv", async () => {
  expect(Object.keys(mutatingRequests.runtime).sort()).toEqual(["argv", "command"])
  expect(mutatingRequests.runtime.argv).toEqual(["repair", "--apply"])
  const exactPreview = createMaintenanceContractHarness({
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
  const hostileRuntime = createMaintenanceContractHarness({
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
  expect(JSON.stringify(hostilePreview.status === "ok" ? hostilePreview.value.agent : undefined)).not.toContain(hostileSecret)
  const hostileApplied = await hostileRuntime.apply(mutatingRequests.runtime)
  expect(JSON.stringify(hostileApplied.status === "ok" ? hostileApplied.value.agent : undefined)).not.toContain(hostileSecret)

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
      label: "inconsistent ok flag",
      results: [runtimeControl("REPAIR_PREVIEW", { ok: false, state: { before: "missing" } })],
      stationId: "runtime-repair-apply.runtime-control-invalid",
    },
    {
      label: "inconsistent exit class",
      results: [runtimeControl("REPAIR_PREVIEW", { ok: true, exitClass: 20, state: { before: "missing" } })],
      stationId: "runtime-repair-apply.runtime-control-invalid",
    },
    {
      label: "inspection claiming a published effect",
      results: [runtimeControl("REPAIR_PREVIEW", { sideEffects: ["published-runtime"], state: { before: "missing" } })],
      stationId: "runtime-repair-apply.runtime-control-invalid",
    },
    {
      label: "typed refusal with a success ok flag",
      results: [runtimeControl("USAGE", { ok: true, exitClass: 2 })],
      stationId: "runtime-repair-apply.runtime-control-invalid",
    },
    {
      label: "applied result without its published effect",
      results: [
        runtimeControl("REPAIR_PREVIEW", { state: { before: "missing" } }),
        runtimeControl("REPAIR_APPLIED"),
      ],
      stationId: "runtime-repair-apply.runtime-control-invalid",
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
    const harness = createMaintenanceContractHarness({ runtimeResults: scenario.results })
    const actual = await harness.apply(mutatingRequests.runtime)
    expect(actual, `implemented: ${scenario.label} enforces the fresh Runtime apply precondition`).toMatchObject({ stationId: scenario.stationId })
    expect(harness.runtimeSpawnLedger.map(({ argv }) => argv)).toEqual(
      scenario.results.length === 2
        ? [["repair"], ["repair", "--apply"]]
        : [["repair"]],
    )
  }
  const inspectionPositionResults = [
    runtimeControl("REPAIR_PREVIEW", { ok: false, state: { before: "missing" } }),
    runtimeControl("REPAIR_PREVIEW", { ok: true, exitClass: 20, state: { before: "missing" } }),
    runtimeControl("REPAIR_PREVIEW", { sideEffects: ["published-runtime"], state: { before: "missing" } }),
    runtimeControl("REPAIR_APPLIED", { sideEffects: ["published-runtime"] }),
  ]
  for (const result of inspectionPositionResults) {
    const harness = createMaintenanceContractHarness({ runtimeResults: [result] })
    expect(await harness.inspect({ command: "runtime:repair", argv: ["repair"] })).toMatchObject({
      status: "error",
      resultCode: "runtime-control-invalid",
      stationId: "runtime-repair.runtime-control-invalid",
    })
  }
  const repeated = createMaintenanceContractHarness({
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
