import { expect, test } from "bun:test"
import {
  parseCommandPreview,
  parseCommandResult,
  parseMaintenanceError,
  parseMaintenancePreviewOutcome,
  parseMaintenanceResultOutcome,
  serializeMaintenancePreviewOutcome,
  serializeMaintenanceResultOutcome,
} from "../serialized-values"
import type { MaintenanceResultOutcome } from "../serialized-values"
import { createMaintenanceContractHarness } from "./adapters/mutation-recording-module-adapter"
import {
  literalHelpPreview,
  literalPayloadOutcome,
  literalPayloadResult,
  mutatingRequests,
} from "./fixtures/literal-command-results"

function assertFrozenResult(actual: MaintenanceResultOutcome) {
  expect(Object.isFrozen(actual)).toBeTrue()
  if (actual.status !== "ok") throw new Error("missing payload result")
  expect(Object.isFrozen(actual.value)).toBeTrue()
  expect(Object.isFrozen(actual.value.nextAction)).toBeTrue()
  expect(Object.isFrozen(actual.value.agent)).toBeTrue()
  expect(Object.isFrozen(actual.value.completedEffectIds)).toBeTrue()
}

function hostileAgentValues(): readonly Record<PropertyKey, unknown>[] {
  class NonJsonValue {}
  const cyclic: Record<string, unknown> = { schemaVersion: 1 }
  cyclic.self = cyclic
  const accessor = { schemaVersion: 1 } as Record<string, unknown>
  Object.defineProperty(accessor, "secret", { enumerable: true, get: () => "hidden" })
  const symbolKeyed = { schemaVersion: 1 } as Record<PropertyKey, unknown>
  symbolKeyed[Symbol("hidden")] = "hidden"
  return [
    { schemaVersion: 1, value: new Map([["key", "value"]]) },
    { schemaVersion: 1, value: new Date(0) },
    { schemaVersion: 1, value: new NonJsonValue() },
    { schemaVersion: 1, value: Number.POSITIVE_INFINITY },
    cyclic,
    accessor,
    symbolKeyed,
  ]
}

function assertHostileAgentValuesAreRejected() {
  for (const agent of hostileAgentValues()) {
    expect(parseCommandResult({ ...literalPayloadResult, agent })).toBeUndefined()
  }
}

async function assertOwnerResultsArePreserved() {
  const harness = createMaintenanceContractHarness()
  for (const request of [
    mutatingRequests.release,
    mutatingRequests.claude,
    mutatingRequests.codex,
    mutatingRequests.canary,
  ]) {
    await harness.inspect(request)
    const ownerOutcome = await harness.apply(request)
    const agentResult = ownerOutcome.status === "ok" ? ownerOutcome.value.agent.result : undefined
    expect(agentResult).toBeDefined()
    expect(agentResult).not.toHaveProperty("stderr")
    expect(agentResult).not.toHaveProperty("authority")
    expect(agentResult).not.toHaveProperty("capabilities")
  }
  const codex = createMaintenanceContractHarness()
  await codex.inspect(mutatingRequests.codex)
  const codexOutcome = await codex.apply(mutatingRequests.codex)
  expect(codexOutcome.status === "ok" ? codexOutcome.value.agent.result : undefined).toMatchObject({
    freshTaskCommand: ["task"],
  })
}

async function assertHostileOutcomeRelationshipsAreRejected() {
  if (literalPayloadOutcome.status !== "ok") throw new Error("expected literal payload outcome")
  if (literalHelpPreview.status !== "ok") throw new Error("expected literal help preview")
  const invalidResultOutcomes: readonly unknown[] = [
    { ...literalPayloadOutcome, stationId: "payload-materialize.previewed" },
    { ...literalPayloadOutcome, stationId: "not-a-real-command.completed" },
    {
      ...literalPayloadOutcome,
      resultCode: "command-refused",
      stationId: "payload-materialize.command-refused",
    },
    {
      ...literalPayloadOutcome,
      value: { ...literalPayloadOutcome.value, remainingEffectIds: ["effect:pending"] },
    },
    {
      ...literalPayloadOutcome,
      value: { ...literalPayloadOutcome.value, transactionState: "unchanged" },
    },
    {
      ...literalPayloadOutcome,
      value: { ...literalPayloadOutcome.value, retrySafety: "unsafe" },
    },
    {
      ...literalPayloadOutcome,
      resultCode: "recovery-required",
      stationId: "payload-materialize.recovery-required",
      value: { ...literalPayloadOutcome.value, transactionState: "unknown", completedEffectIds: [] },
    },
    {
      ...literalPayloadOutcome,
      value: { ...literalPayloadOutcome.value, transactionState: "unchanged", completedEffectIds: [] },
    },
  ]
  for (const outcome of invalidResultOutcomes) {
    expect(parseMaintenanceResultOutcome(outcome)).toBeUndefined()
  }
  const invalidPreviewOutcomes: readonly unknown[] = [
    {
      ...literalHelpPreview,
      value: { ...literalHelpPreview.value, effectClass: "external" },
    },
    {
      ...literalHelpPreview,
      value: { ...literalHelpPreview.value, transactionState: "completed" },
    },
    {
      ...literalHelpPreview,
      resultCode: "completed",
      stationId: "help.completed",
      value: { ...literalHelpPreview.value, transactionState: "completed" },
    },
  ]
  for (const outcome of invalidPreviewOutcomes) {
    expect(parseMaintenancePreviewOutcome(outcome)).toBeUndefined()
  }

  const recoveryOutcome = await createMaintenanceContractHarness().apply(mutatingRequests.release)
  if (recoveryOutcome.status !== "error") throw new Error("expected recovery error outcome")
  const invalidErrorOutcomes: readonly unknown[] = [
    { ...recoveryOutcome, error: { ...recoveryOutcome.error, exitCodeHint: 1 } },
    { ...recoveryOutcome, error: { ...recoveryOutcome.error, failureClass: "refusal" } },
    { ...recoveryOutcome, error: { ...recoveryOutcome.error, errorFamily: "input" } },
    { ...recoveryOutcome, error: { ...recoveryOutcome.error, recoverability: "retry" } },
    { ...recoveryOutcome, error: { ...recoveryOutcome.error, retryable: true } },
    { ...recoveryOutcome, error: { ...recoveryOutcome.error, retrySafety: "safe" } },
    { ...recoveryOutcome, error: { ...recoveryOutcome.error, transactionState: "completed" } },
    { ...recoveryOutcome, stationId: "not-a-real-command.recovery-required" },
  ]
  for (const outcome of invalidErrorOutcomes) {
    expect(parseMaintenanceResultOutcome(outcome)).toBeUndefined()
  }
}

test("help returns the canonical tagged preview", async () => {
  const actual = await createMaintenanceContractHarness().inspect({ command: "help" })

  expect(actual, "implemented: help returns the canonical tagged preview").toEqual(literalHelpPreview)
  expect(parseMaintenancePreviewOutcome(JSON.parse(serializeMaintenancePreviewOutcome(actual)))).toEqual(actual)
  expect(actual.status === "ok" ? parseCommandPreview(actual.value) : undefined).toEqual(
    actual.status === "ok" ? actual.value : undefined,
  )
})

test("usage refusal retains sealed Result Vocabulary meaning", async () => {
  const actual = await createMaintenanceContractHarness().inspect({ command: "help" })

  expect(actual, "implemented: help exposes usage refusal meaning through the production Interface").toMatchObject({
    status: "ok",
    resultCode: "previewed",
  })
  if (actual.status !== "ok") throw new Error("expected help preview")
  expect(actual.value.agent).toMatchObject({
    exits: {
      typed: expect.arrayContaining([{
        family_id: "usage-refusal",
        exit: 2,
        owner: "Maintenance Command Contract",
        result_codes: ["usage-refused", "runtime-usage-refused"],
        envelope: true,
        meaning: "usage refusal",
      }]),
    },
  })
  const nextActions = actual.value.agent.next_actions
  expect(nextActions, "implemented: help exposes the usage refusal Next Action").toEqual(
    expect.arrayContaining([{
      id: "maintenance.show-help",
      action: "change_input",
      command_id: "help",
      failure_class: "usage",
    }]),
  )
  expect(Array.isArray(nextActions) ? nextActions.length : undefined).toBe(22)
})

test("human output remains deterministic", async () => {
  const actual = await createMaintenanceContractHarness().apply(mutatingRequests.materialize)
  expect(actual.status === "ok" ? actual.value.human : undefined, "implemented: human output is literal").toBe(literalPayloadResult.human)
})

test("agent output remains isolated on the machine channel", async () => {
  const actual = await createMaintenanceContractHarness().apply(mutatingRequests.materialize)
  expect(actual.status === "ok" ? actual.value.agent : undefined, "implemented: agent output preserves the governing value").toEqual(literalPayloadResult.agent)
})

test("diagnostics remain on stderr", async () => {
  const actual = await createMaintenanceContractHarness().apply(mutatingRequests.materialize)
  expect(actual.status === "ok" ? actual.value.stderr : undefined, "implemented: successful results preserve empty diagnostics").toBe("")
})

test("unknown Transaction State never exits zero", async () => {
  const actual = await createMaintenanceContractHarness().apply(mutatingRequests.release)
  expect(actual, "implemented: unknown durable state returns a typed result").toMatchObject({ status: "error" })
  if (actual.status !== "error") throw new Error("expected recovery error outcome")
  expect(actual.error.transactionState).toBe("unknown")
  expect(actual.error.exitCodeHint).not.toBe(0)
  expect(parseMaintenanceError(actual.error)).toEqual(actual.error)
  expect(parseMaintenanceResultOutcome(JSON.parse(serializeMaintenanceResultOutcome(actual)))).toEqual(actual)
})

test("governing result status and effects pass through unchanged", async () => {
  const harness = createMaintenanceContractHarness()
  const actual = await harness.apply(mutatingRequests.materialize)
  expect(actual.status === "ok" ? actual.value : actual, "implemented: the governing result passes through unchanged").toEqual(literalPayloadResult)
  expect(parseMaintenanceResultOutcome(JSON.parse(serializeMaintenanceResultOutcome(actual)))).toEqual(actual)
  expect(parseCommandResult({ ...literalPayloadResult, extra: true })).toBeUndefined()
  expect(parseCommandResult({ ...literalPayloadResult, schemaVersion: 2 })).toBeUndefined()
  expect(parseCommandResult({ ...literalPayloadResult, nextAction: { ...literalPayloadResult.nextAction, commandId: undefined } })).toBeUndefined()
  expect(parseCommandResult({ ...literalPayloadResult, agent: { schemaVersion: 1, invalid: () => undefined } })).toBeUndefined()
  assertFrozenResult(actual)
  assertHostileAgentValuesAreRejected()
  expect(parseMaintenanceResultOutcome(literalPayloadOutcome)).toEqual(literalPayloadOutcome)
  expect(parseMaintenancePreviewOutcome(literalHelpPreview)).toEqual(literalHelpPreview)
  await assertHostileOutcomeRelationshipsAreRejected()
  await assertOwnerResultsArePreserved()
})
