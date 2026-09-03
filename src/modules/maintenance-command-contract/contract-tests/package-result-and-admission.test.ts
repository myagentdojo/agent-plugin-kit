import { expect, test } from "bun:test"
import type { PayloadProductionResult } from "../../plugin-payload-production/interface"
import { createMaintenanceContractHarness } from "./adapters/mutation-recording-module-adapter"
import { literalPackageRequest, mutatingRequests } from "./fixtures/literal-command-results"

const packageApply = mutatingRequests.package
const applyWith = async (payloadResult: PayloadProductionResult) => {
  const harness = createMaintenanceContractHarness({ payloadResult })
  const outcome = await harness.apply(packageApply)
  return { harness, outcome }
}
const completePackaged = (): Extract<PayloadProductionResult, { kind: "packaged" }> => ({
  kind: "packaged",
  sourceIdentity: literalPackageRequest.sourceIdentity,
  release: literalPackageRequest.release,
  bindingSha256: literalPackageRequest.prepared.bindingSha256,
  payload: { regularFiles: [".claude-plugin/plugin.json"], payloadSha256: literalPackageRequest.prepared.payloadSha256 },
  artifacts: {
    archive: { path: "/fixture/plugin/dist/example-plugin-1.0.0.tar.gz", bytes: 130, sha256: `sha256:${"1".repeat(64)}` },
    checksums: { path: "/fixture/plugin/dist/example-plugin-1.0.0.checksums.json", bytes: 700, sha256: `sha256:${"2".repeat(64)}` },
  },
  nextAction: "Inspect the packaged Plugin Payload artifacts under dist/.",
})

test("M01 a checked or materialized owner result cannot complete a package apply", async () => {
  for (const wrong of [
    { kind: "checked", nextAction: "Inspect the payload." },
    { kind: "materialized", nextAction: "Inspect the payload." },
  ] as const) {
    const { harness, outcome } = await applyWith(wrong)
    expect(outcome).toMatchObject({
      status: "error",
      resultCode: "runtime-failed",
      stationId: "payload-package.runtime-failed",
      error: { failureClass: "unexpected", transactionState: "unknown", retrySafety: "unsafe", exitCodeHint: 1 },
    })
    expect(harness.applyLedgers.payload).toEqual([packageApply])
  }
  const { outcome } = await applyWith(completePackaged())
  expect(outcome).toMatchObject({
    status: "ok",
    resultCode: "completed",
    stationId: "payload-package.completed",
    value: { completedEffectIds: ["effect:payload-packaged"], remainingEffectIds: [], transactionState: "completed" },
  })
  if (outcome.status !== "ok") return
  expect(outcome.value.agent).toEqual({
    schemaVersion: 1,
    kind: "packaged",
    result: {
      kind: "packaged",
      sourceIdentity: { repository: { origin: literalPackageRequest.sourceIdentity.repository.origin }, commit: literalPackageRequest.sourceIdentity.commit },
      release: { name: "example-plugin", version: "1.0.0", tag: "v1.0.0" },
      bindingSha256: literalPackageRequest.prepared.bindingSha256,
      payload: { regularFiles: [".claude-plugin/plugin.json"], payloadSha256: literalPackageRequest.prepared.payloadSha256 },
      artifacts: completePackaged().artifacts,
      nextAction: "Inspect the packaged Plugin Payload artifacts under dist/.",
    },
  })
})

test("M02 a packaged result without complete artifact evidence cannot complete", async () => {
  const complete = completePackaged()
  const incomplete: readonly unknown[] = [
    { ...complete, artifacts: { archive: complete.artifacts.archive } },
    { ...complete, artifacts: { archive: complete.artifacts.archive, checksums: null } },
    { ...complete, artifacts: { ...complete.artifacts, checksums: { ...complete.artifacts.checksums, sha256: "sha256:short" } } },
    { ...complete, artifacts: { ...complete.artifacts, archive: { ...complete.artifacts.archive, path: "" } } },
    { ...complete, artifacts: { ...complete.artifacts, archive: { ...complete.artifacts.archive, bytes: -1 } } },
    { ...complete, artifacts: undefined },
    { ...complete, payload: undefined },
  ]
  for (const candidate of incomplete) {
    const { harness, outcome } = await applyWith(candidate as PayloadProductionResult)
    expect(outcome, JSON.stringify(candidate)).toMatchObject({ status: "error", resultCode: "runtime-failed", stationId: "payload-package.runtime-failed" })
    expect(harness.applyLedgers.payload).toHaveLength(1)
  }
})

test("M03 an owner refusal keeps its repair meaning and publishes no effect", async () => {
  const { harness, outcome } = await applyWith({ kind: "refused", code: "output-conflict", detail: "dist/example-plugin-1.0.0.tar.gz: different existing artifact preserved", nextAction: "Inspect dist/ and move the conflicting artifact aside before repeating payload:package." })
  expect(outcome).toMatchObject({
    status: "error",
    resultCode: "command-refused",
    stationId: "payload-package.command-refused",
    error: {
      failureClass: "refusal",
      recoverability: "repair_state",
      retryable: false,
      transactionState: "unchanged",
      retrySafety: "requires-fresh-inspection",
      exitCodeHint: 21,
      nextAction: { id: "maintenance.inspect-refusal", action: "inspect_state", commandId: null },
    },
  })
  expect(harness.applyLedgers.payload).toEqual([packageApply])
  const failedNone = await applyWith({ kind: "failed", code: "compressor-failed", publication: "none", transient: false, artifacts: { archive: null, checksums: null }, nextAction: "Inspect the host gzip, then repeat payload:package." })
  expect(failedNone.outcome).toMatchObject({ status: "error", resultCode: "command-refused", stationId: "payload-package.command-refused", error: { transactionState: "unchanged" } })
  const transient = await applyWith({ kind: "failed", code: "staging-failed", publication: "none", transient: true, artifacts: { archive: null, checksums: null }, nextAction: "Repeat payload:package." })
  expect(transient.outcome).toMatchObject({ status: "error", resultCode: "retry-deferred", stationId: "payload-package.retry-deferred", error: { retryable: true, retrySafety: "safe", transactionState: "unchanged" } })
})

test("M05 an unobservable publication maps to recovery without a fabricated completed effect", async () => {
  const archive = completePackaged().artifacts.archive
  const unknown = await applyWith({ kind: "failed", code: "publication-unobservable", publication: "unknown", transient: false, artifacts: { archive: null, checksums: null }, nextAction: "Inspect dist/ before repeating payload:package." })
  expect(unknown.outcome).toMatchObject({
    status: "error",
    resultCode: "recovery-required",
    stationId: "payload-package.recovery-required",
    error: { failureClass: "recovery", transactionState: "unknown", retrySafety: "requires-fresh-inspection", exitCodeHint: 20 },
  })
  if (unknown.outcome.status === "error") expect(unknown.outcome.error.completedEffectIds).toBeUndefined()
  const archiveOnly = await applyWith({ kind: "failed", code: "publication-interrupted", publication: "archive-only", transient: false, artifacts: { archive, checksums: null }, nextAction: "Repeat payload:package to complete the checksum publication for the published archive." })
  expect(archiveOnly.outcome).toMatchObject({
    status: "error",
    resultCode: "continuation-required",
    stationId: "payload-package.continuation-required",
    error: {
      failureClass: "continuation",
      transactionState: "partially-completed",
      retrySafety: "unsafe",
      exitCodeHint: 20,
      completedEffectIds: ["effect:payload-archive-published"],
      remainingEffectIds: ["effect:payload-checksums-published"],
    },
  })
})
