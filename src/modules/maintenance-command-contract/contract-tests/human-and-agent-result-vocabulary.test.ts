import { expect, test } from "bun:test"
import { failureNextActionProjection, resultVocabulary } from "../result-vocabulary"
import { createMaintenanceContractHarness } from "./adapters/mutation-recording-module-adapter"
import {
  literalHelpPreview,
  literalPayloadResult,
  mutatingRequests,
} from "./fixtures/literal-command-results"

test("help returns the canonical tagged preview", async () => {
  const actual = await createMaintenanceContractHarness().inspect({ command: "help" })

  expect(actual, "contract-absent: help must return the canonical tagged preview").toEqual(literalHelpPreview)
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
  expect(actual?.status === "error" ? actual.error.transactionState : undefined).toBe("unknown")
  expect(actual === undefined ? undefined : resultVocabulary.find(({ resultCode }) => resultCode === actual.resultCode)?.exitClass).not.toBe(0)
})

test("governing result status and effects pass through unchanged", async () => {
  const actual = await createMaintenanceContractHarness().apply(mutatingRequests.materialize)
  expect(failureNextActionProjection).toHaveLength(22)
  expect(actual?.status === "ok" ? actual.value : actual, "contract-absent: the governing result must pass through unchanged").toEqual(literalPayloadResult)
})
