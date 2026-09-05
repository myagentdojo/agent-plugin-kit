import { expect, test } from "bun:test"
import type { CommandPreview, CommandResult, MaintenanceApplyRequest, MaintenanceCommand } from "../interface"
import type { PayloadProductionResult } from "../../plugin-payload-production/interface"
import { createMaintenanceContractHarness } from "./adapters/mutation-recording-module-adapter"
import {
  literalPackageRequest,
  literalPayloadCandidate,
  literalPayloadCheckCommand,
  mutatingRequests,
} from "./fixtures/literal-command-results"
import {
  createMaintenanceCommands,
  type MaintenanceCommandDependencies,
} from "../implementation/maintenance-commands"

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
    { kind: "checked", candidate: literalPayloadCandidate, nextAction: "Inspect the payload." },
    { kind: "materialized", candidate: literalPayloadCandidate, changedPaths: [], removedPaths: [], unchangedPaths: [], nextAction: "Inspect the payload." },
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

const createPayloadOnlyCommands = (ownerResult: PayloadProductionResult) => {
  const payloadCalls: unknown[] = []
  const unexpectedCollaboratorCall = async (): Promise<never> => {
    throw new Error("unexpected collaborator call")
  }
  const dependencies: MaintenanceCommandDependencies = {
    payload: {
      async produce(request) {
        if (request.mode === "materialize") payloadCalls.push(request)
        return ownerResult
      },
    },
    runtime: unexpectedCollaboratorCall,
    release: {
      inspect: unexpectedCollaboratorCall,
      apply: unexpectedCollaboratorCall,
    },
    harness: {
      inspect: unexpectedCollaboratorCall,
      apply: unexpectedCollaboratorCall,
    },
    canary: {
      inspect: unexpectedCollaboratorCall,
      qualify: unexpectedCollaboratorCall,
    },
  }
  return { commands: createMaintenanceCommands(dependencies), payloadCalls }
}

const materializeApply = mutatingRequests.materialize as Extract<
  MaintenanceApplyRequest,
  { command: "payload:materialize" }
>

const payloadResultMappingRows = [
    {
      name: "checked",
      mode: "inspect",
      command: literalPayloadCheckCommand,
      ownerResult: {
        kind: "checked",
        candidate: literalPayloadCandidate,
        nextAction: "Inspect the payload.",
      },
      expected: {
        status: "ok",
        resultCode: "previewed",
        stationId: "payload-check.previewed",
        expectedEffectIds: [],
        transactionState: "unchanged",
        nextActionId: "payload-check.inspect-result",
      },
      projection: {
        kind: "checked",
        candidatePayloadSha256: literalPayloadCandidate.payloadSha256,
      },
    },
    {
      name: "payload-outdated refusal",
      mode: "inspect",
      command: literalPayloadCheckCommand,
      ownerResult: {
        kind: "refused",
        code: "payload-outdated",
        paths: ["plugin/skill-inventory.json"],
        detail: "Bundle inventory is stale.",
        nextAction: "Run payload:materialize.",
      },
      expected: {
        status: "error",
        resultCode: "command-refused",
        stationId: "payload-check.command-refused",
        failureClass: "refusal",
        transactionState: "unchanged",
        retrySafety: "requires-fresh-inspection",
        exitCodeHint: 21,
        nextActionId: "maintenance.inspect-refusal",
      },
    },
    {
      name: "input refusal",
      mode: "apply",
      command: materializeApply,
      ownerResult: {
        kind: "refused",
        code: "configuration-invalid",
        detail: "hookDeclarationPaths must be unique.",
        nextAction: "Repair the Plugin Payload configuration.",
      },
      expected: {
        status: "error",
        resultCode: "command-refused",
        stationId: "payload-materialize.command-refused",
        failureClass: "refusal",
        transactionState: "unchanged",
        retrySafety: "requires-fresh-inspection",
        exitCodeHint: 21,
        nextActionId: "maintenance.inspect-refusal",
      },
    },
    {
      name: "materialized",
      mode: "apply",
      command: materializeApply,
      ownerResult: {
        kind: "materialized",
        candidate: literalPayloadCandidate,
        changedPaths: [".claude-plugin/marketplace.json"],
        removedPaths: [],
        unchangedPaths: [".agents/plugins/marketplace.json"],
        nextAction: "Inspect the payload.",
      },
      expected: {
        status: "ok",
        resultCode: "completed",
        stationId: "payload-materialize.completed",
        completedEffectIds: ["effect:payload-materialized"],
        remainingEffectIds: [],
        transactionState: "completed",
        nextActionId: "payload-materialize.inspect-result",
      },
      projection: {
        kind: "materialized",
        candidatePayloadSha256: literalPayloadCandidate.payloadSha256,
        changedPaths: [".claude-plugin/marketplace.json"],
        removedPaths: [],
        unchangedPaths: [".agents/plugins/marketplace.json"],
      },
    },
    {
      name: "transient none",
      mode: "apply",
      command: materializeApply,
      ownerResult: {
        kind: "materialization-failed",
        code: "materialization-staging-failed",
        state: "none",
        transient: true,
        changedPaths: [],
        remainingPaths: [".claude-plugin/marketplace.json"],
        nextAction: "Retry payload:materialize.",
      },
      expected: {
        status: "error",
        resultCode: "retry-deferred",
        stationId: "payload-materialize.retry-deferred",
        failureClass: "transient",
        transactionState: "unchanged",
        retrySafety: "safe",
        exitCodeHint: 22,
        nextActionId: "maintenance.retry-command",
      },
    },
    {
      name: "non-transient none",
      mode: "apply",
      command: materializeApply,
      ownerResult: {
        kind: "materialization-failed",
        code: "materialization-interrupted",
        state: "none",
        transient: false,
        changedPaths: [],
        remainingPaths: [".claude-plugin/marketplace.json"],
        nextAction: "Repair the interrupted materialization.",
      },
      expected: {
        status: "error",
        resultCode: "command-refused",
        stationId: "payload-materialize.command-refused",
        failureClass: "refusal",
        transactionState: "unchanged",
        retrySafety: "requires-fresh-inspection",
        exitCodeHint: 21,
        nextActionId: "maintenance.inspect-refusal",
      },
    },
    {
      name: "partial",
      mode: "apply",
      command: materializeApply,
      ownerResult: {
        kind: "materialization-failed",
        code: "materialization-interrupted",
        state: "partial",
        transient: false,
        changedPaths: [".agents/plugins/marketplace.json"],
        remainingPaths: [".claude-plugin/marketplace.json"],
        nextAction: "Repeat payload:materialize to finish the remaining files.",
      },
      expected: {
        status: "error",
        resultCode: "continuation-required",
        stationId: "payload-materialize.continuation-required",
        failureClass: "continuation",
        transactionState: "partially-completed",
        retrySafety: "unsafe",
        exitCodeHint: 20,
        completedEffectIds: [],
        remainingEffectIds: ["effect:payload-materialized"],
        nextActionId: "maintenance.inspect-continuation",
      },
    },
    {
      name: "unknown",
      mode: "apply",
      command: materializeApply,
      ownerResult: {
        kind: "materialization-failed",
        code: "materialization-state-unobservable",
        state: "unknown",
        transient: false,
        changedPaths: null,
        remainingPaths: null,
        nextAction: "Run payload:check to observe the current state.",
      },
      expected: {
        status: "error",
        resultCode: "recovery-required",
        stationId: "payload-materialize.recovery-required",
        failureClass: "recovery",
        transactionState: "unknown",
        retrySafety: "requires-fresh-inspection",
        exitCodeHint: 20,
        nextActionId: "maintenance.inspect-recovery",
      },
    },
    {
      name: "materialize packaged result",
      mode: "apply",
      command: materializeApply,
      ownerResult: completePackaged(),
      expected: {
        status: "error",
        resultCode: "runtime-failed",
        stationId: "payload-materialize.runtime-failed",
        failureClass: "unexpected",
        transactionState: "unknown",
        retrySafety: "unsafe",
        exitCodeHint: 1,
        nextActionId: "maintenance.contact-support",
      },
    },
    {
      name: "materialize checked result",
      mode: "apply",
      command: materializeApply,
      ownerResult: {
        kind: "checked",
        candidate: literalPayloadCandidate,
        nextAction: "Inspect the payload.",
      },
      expected: {
        status: "error",
        resultCode: "runtime-failed",
        stationId: "payload-materialize.runtime-failed",
        failureClass: "unexpected",
        transactionState: "unknown",
        retrySafety: "unsafe",
        exitCodeHint: 1,
        nextActionId: "maintenance.contact-support",
      },
    },
    {
      name: "check materialized result",
      mode: "inspect",
      command: literalPayloadCheckCommand,
      ownerResult: {
        kind: "materialized",
        candidate: literalPayloadCandidate,
        changedPaths: [],
        removedPaths: [],
        unchangedPaths: [],
        nextAction: "Inspect the payload.",
      },
      expected: {
        status: "error",
        resultCode: "runtime-failed",
        stationId: "payload-check.runtime-failed",
        failureClass: "unexpected",
        transactionState: "unknown",
        retrySafety: "unsafe",
        exitCodeHint: 1,
        nextActionId: "maintenance.contact-support",
      },
    },
    {
      name: "check packaged result",
      mode: "inspect",
      command: literalPayloadCheckCommand,
      ownerResult: completePackaged(),
      expected: {
        status: "error",
        resultCode: "runtime-failed",
        stationId: "payload-check.runtime-failed",
        failureClass: "unexpected",
        transactionState: "unknown",
        retrySafety: "unsafe",
        exitCodeHint: 1,
        nextActionId: "maintenance.contact-support",
      },
    },
    {
      name: "materialized result with empty digest",
      mode: "apply",
      command: materializeApply,
      ownerResult: {
        kind: "materialized",
        candidate: { ...literalPayloadCandidate, payloadSha256: "" },
        changedPaths: [],
        removedPaths: [],
        unchangedPaths: [],
        nextAction: "Inspect the payload.",
      } as unknown as PayloadProductionResult,
      expected: {
        status: "error",
        resultCode: "runtime-failed",
        stationId: "payload-materialize.runtime-failed",
        failureClass: "unexpected",
        transactionState: "unknown",
        retrySafety: "unsafe",
        exitCodeHint: 1,
        nextActionId: "maintenance.contact-support",
      },
    },
    {
      name: "materialized result with malformed files",
      mode: "apply",
      command: materializeApply,
      ownerResult: {
        kind: "materialized",
        candidate: { ...literalPayloadCandidate, files: "not-an-array" },
        changedPaths: [],
        removedPaths: [],
        unchangedPaths: [],
        nextAction: "Inspect the payload.",
      } as unknown as PayloadProductionResult,
      expected: {
        status: "error",
        resultCode: "runtime-failed",
        stationId: "payload-materialize.runtime-failed",
        failureClass: "unexpected",
        transactionState: "unknown",
        retrySafety: "unsafe",
        exitCodeHint: 1,
        nextActionId: "maintenance.contact-support",
      },
    },
    {
      name: "checked result with missing owned files",
      mode: "inspect",
      command: literalPayloadCheckCommand,
      ownerResult: {
        kind: "checked",
        candidate: { ...literalPayloadCandidate, ownedFiles: undefined },
        nextAction: "Inspect the payload.",
      } as unknown as PayloadProductionResult,
      expected: {
        status: "error",
        resultCode: "runtime-failed",
        stationId: "payload-check.runtime-failed",
        failureClass: "unexpected",
        transactionState: "unknown",
        retrySafety: "unsafe",
        exitCodeHint: 1,
        nextActionId: "maintenance.contact-support",
      },
    },
  ] as const satisfies readonly {
    name: string
    mode: "inspect" | "apply"
    command: MaintenanceCommand
    ownerResult: PayloadProductionResult
    expected: Record<string, unknown>
    projection?: {
      kind: "checked" | "materialized"
      candidatePayloadSha256: string
      changedPaths?: readonly string[]
      removedPaths?: readonly string[]
      unchangedPaths?: readonly string[]
    }
  }[]

type PayloadOnlyCommands = ReturnType<typeof createPayloadOnlyCommands>["commands"]
type PayloadMappingOutcome =
  | Awaited<ReturnType<PayloadOnlyCommands["inspect"]>>
  | Awaited<ReturnType<PayloadOnlyCommands["apply"]>>

const normalizedPayloadOutcome = (outcome: PayloadMappingOutcome): Record<string, unknown> => {
  if (outcome.status === "ok" && "expectedEffectIds" in outcome.value) {
    const value = outcome.value as CommandPreview
    return {
      status: "ok",
      resultCode: outcome.resultCode,
      stationId: outcome.stationId,
      expectedEffectIds: value.expectedEffectIds,
      transactionState: value.transactionState,
      nextActionId: value.nextAction.id,
    }
  }
  if (outcome.status === "ok") {
    const value = outcome.value as CommandResult
    return {
      status: "ok",
      resultCode: outcome.resultCode,
      stationId: outcome.stationId,
      completedEffectIds: value.completedEffectIds,
      remainingEffectIds: value.remainingEffectIds,
      transactionState: value.transactionState,
      nextActionId: value.nextAction.id,
    }
  }
  const base = {
    status: "error",
    resultCode: outcome.resultCode,
    stationId: outcome.stationId,
    failureClass: outcome.error.failureClass,
    transactionState: outcome.error.transactionState,
    retrySafety: outcome.error.retrySafety,
    exitCodeHint: outcome.error.exitCodeHint,
    nextActionId: outcome.error.nextAction.id,
  }
  return outcome.error.completedEffectIds === undefined
    ? base
    : {
        ...base,
        completedEffectIds: outcome.error.completedEffectIds,
        remainingEffectIds: outcome.error.remainingEffectIds,
      }
}

test("MC01 one table maps every check and materialize owner result to its exact Station, state, effects, and next action", async () => {
  const rows = payloadResultMappingRows

  expect(rows.length).toBe(15)
  let exercisedCount = 0
  for (const row of rows) {
    const { commands, payloadCalls } = createPayloadOnlyCommands(row.ownerResult)
    const outcome = row.mode === "inspect"
      ? await commands.inspect(row.command)
      : await commands.apply(row.command)
    expect(normalizedPayloadOutcome(outcome), row.name).toEqual(row.expected)
    expect(payloadCalls).toEqual(row.mode === "apply" ? [materializeApply.request] : [])

    if ("projection" in row) {
      expect(outcome.status).toBe("ok")
      if (outcome.status === "ok") {
        expect(outcome.value.agent.kind).toBe(row.projection.kind)
        if (row.projection.kind === "checked") {
          const projected = outcome.value.agent.result as { candidate: { payloadSha256: string } }
          expect(projected.candidate.payloadSha256).toBe(row.projection.candidatePayloadSha256)
        } else {
          const projected = outcome.value.agent.result as {
            candidate: { payloadSha256: string }
            changedPaths: readonly string[]
            removedPaths: readonly string[]
            unchangedPaths: readonly string[]
          }
          expect({
            candidatePayloadSha256: projected.candidate.payloadSha256,
            changedPaths: projected.changedPaths,
            removedPaths: projected.removedPaths,
            unchangedPaths: projected.unchangedPaths,
          }).toEqual({
            candidatePayloadSha256: row.projection.candidatePayloadSha256,
            changedPaths: row.projection.changedPaths,
            removedPaths: row.projection.removedPaths,
            unchangedPaths: row.projection.unchangedPaths,
          })
        }
      }
    }
    exercisedCount += 1
  }
  expect(exercisedCount).toBe(rows.length)
})
