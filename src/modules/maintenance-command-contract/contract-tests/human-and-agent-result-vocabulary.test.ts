import { expect, test } from "bun:test"
import type { RuntimeCustodyCommand } from "../../runtime-custody/interface"
import { createMaintenanceContractHarness } from "./adapters/mutation-recording-module-adapter"
import { createPublicProcessAdapter } from "./adapters/public-process-adapter"
import {
  literalHelpProcess,
  literalHelpPreview,
  literalPayloadResult,
  literalUsageProcess,
  mutatingRequests,
} from "./fixtures/literal-command-results"

test("help preserves runtime --help discovery and exits zero", async () => {
  const runtimeHelp: RuntimeCustodyCommand = ["--help"]
  const actual = await createPublicProcessAdapter().invoke(runtimeHelp)

  expect(runtimeHelp).toEqual(["--help"])
  expect(literalHelpPreview.exitClass).toBe(0)
  expect(actual, "contract-absent: help must preserve public process streams").toEqual(literalHelpProcess)
})

test("unknown usage is a typed exit-two refusal", async () => {
  const actual = await createPublicProcessAdapter().invoke(["unknown"])

  expect(actual, "contract-absent: unknown usage must refuse through the public process").toEqual(literalUsageProcess)
})

test("human output remains deterministic", async () => {
  const actual = await createMaintenanceContractHarness().apply(mutatingRequests.materialize)
  expect(actual?.human, "contract-absent: human output must be literal").toBe(literalPayloadResult.human)
})

test("agent output remains isolated on the machine channel", async () => {
  const actual = await createMaintenanceContractHarness().apply(mutatingRequests.materialize)
  expect(actual?.agent, "contract-absent: agent output must preserve the governing value").toEqual(literalPayloadResult.agent)
})

test("diagnostics remain on stderr", async () => {
  const actual = await createMaintenanceContractHarness().apply(mutatingRequests.materialize)
  expect(actual?.stderr, "contract-absent: successful results must preserve empty diagnostics").toBe("")
})

test("unknown Transaction State never exits zero", async () => {
  const actual = await createMaintenanceContractHarness().apply(mutatingRequests.release)
  expect(actual, "contract-absent: unknown durable state must return a typed result").toBeDefined()
  expect(actual?.transactionState).toBe("unknown")
  expect(actual?.exitClass).not.toBe(0)
})

test("governing result status and effects pass through unchanged", async () => {
  const actual = await createMaintenanceContractHarness().apply(mutatingRequests.materialize)
  expect(actual, "contract-absent: the governing result must pass through unchanged").toEqual(literalPayloadResult)
})
