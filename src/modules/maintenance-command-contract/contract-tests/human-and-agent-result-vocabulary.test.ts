import { expect, test } from "bun:test"
import { failureNextActionProjection, resultVocabulary } from "../result-vocabulary"
import {
  parseCommandPreview,
  parseCommandResult,
  parseMaintenanceError,
  parseMaintenancePreviewOutcome,
  parseMaintenanceResultOutcome,
  serializeMaintenancePreviewOutcome,
  serializeMaintenanceResultOutcome,
} from "../serialized-values"
import { createMaintenanceContractHarness } from "./adapters/mutation-recording-module-adapter"
import {
  literalHelpPreview,
  literalPayloadResult,
  mutatingRequests,
} from "./fixtures/literal-command-results"

test("help returns the canonical tagged preview", async () => {
  const actual = await createMaintenanceContractHarness().inspect({ command: "help" })

  expect(actual, "contract-absent: help must return the canonical tagged preview").toEqual(literalHelpPreview)
  if (actual === undefined) throw new Error("missing help outcome")
  expect(parseMaintenancePreviewOutcome(JSON.parse(serializeMaintenancePreviewOutcome(actual)))).toEqual(actual)
  expect(actual.status === "ok" ? parseCommandPreview(actual.value) : undefined).toEqual(
    actual.status === "ok" ? actual.value : undefined,
  )
})

test("usage refusal retains sealed Result Vocabulary meaning", () => {
  const actual = resultVocabulary.find(({ resultCode }) => resultCode === "usage-refused")

  expect(actual, "contract-absent: usage refusal must remain a sealed Result Vocabulary row").toEqual({
    resultCode: "usage-refused",
    exitFamilyId: "usage-refusal",
    exitClass: 2,
    failureClass: "usage",
    severity: "error",
    retrySafety: "safe",
    transactionState: "unchanged",
    nextAction: {
      id: "maintenance.show-help",
      action: "change_input",
      summary: "Choose a command from machine discovery.",
      commandId: "help",
    },
  })
})

test("human output remains deterministic", async () => {
  const actual = await createMaintenanceContractHarness().apply(mutatingRequests.materialize)
  expect(actual?.status === "ok" ? actual.value.human : undefined, "contract-absent: human output must be literal").toBe(literalPayloadResult.human)
})

test("agent output remains isolated on the machine channel", async () => {
  const actual = await createMaintenanceContractHarness().apply(mutatingRequests.materialize)
  expect(actual?.status === "ok" ? actual.value.agent : undefined, "contract-absent: agent output must preserve the governing value").toEqual(literalPayloadResult.agent)
})

test("diagnostics remain on stderr", async () => {
  const actual = await createMaintenanceContractHarness().apply(mutatingRequests.materialize)
  expect(actual?.status === "ok" ? actual.value.stderr : undefined, "contract-absent: successful results must preserve empty diagnostics").toBe("")
})

test("unknown Transaction State never exits zero", async () => {
  const actual = await createMaintenanceContractHarness().apply(mutatingRequests.release)
  expect(actual, "contract-absent: unknown durable state must return a typed result").toBeDefined()
  if (actual === undefined || actual.status !== "error") throw new Error("missing recovery error outcome")
  expect(actual.error.transactionState).toBe("unknown")
  const descriptor = resultVocabulary.find(({ resultCode }) => resultCode === actual.resultCode)
  expect(descriptor?.exitClass).not.toBe(0)
  expect(parseMaintenanceError(actual.error)).toEqual(actual.error)
  expect(parseMaintenanceResultOutcome(JSON.parse(serializeMaintenanceResultOutcome(actual)))).toEqual(actual)
})

test("governing result status and effects pass through unchanged", async () => {
  const harness = createMaintenanceContractHarness()
  const actual = await harness.apply(mutatingRequests.materialize)
  expect(failureNextActionProjection).toHaveLength(22)
  expect(actual?.status === "ok" ? actual.value : actual, "contract-absent: the governing result must pass through unchanged").toEqual(literalPayloadResult)
  if (actual === undefined) throw new Error("missing payload outcome")
  expect(parseMaintenanceResultOutcome(JSON.parse(serializeMaintenanceResultOutcome(actual)))).toEqual(actual)
  expect(parseCommandResult({ ...literalPayloadResult, extra: true })).toBeUndefined()
  expect(parseCommandResult({ ...literalPayloadResult, schemaVersion: 2 })).toBeUndefined()
  expect(parseCommandResult({ ...literalPayloadResult, nextAction: { ...literalPayloadResult.nextAction, commandId: undefined } })).toBeUndefined()
  expect(parseCommandResult({ ...literalPayloadResult, agent: { schemaVersion: 1, invalid: () => undefined } })).toBeUndefined()

  for (const request of [mutatingRequests.release, mutatingRequests.claude, mutatingRequests.codex, mutatingRequests.canary]) {
    await harness.inspect(request)
    const ownerOutcome = await harness.apply(request)
    expect(ownerOutcome?.status === "ok" ? ownerOutcome.value.agent.result : undefined).toBeDefined()
  }
  const codex = createMaintenanceContractHarness()
  await codex.inspect(mutatingRequests.codex)
  const codexOutcome = await codex.apply(mutatingRequests.codex)
  expect(codexOutcome?.status === "ok" ? codexOutcome.value.agent.result : undefined).toMatchObject({
    freshTaskCommand: ["task"],
  })
})
