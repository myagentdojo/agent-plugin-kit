import { expect, test } from "bun:test"
import {
  admissionBootstrap,
  admissionDurableDigest,
  admissionImportLedger,
  invokeMaintenanceProcess,
  maintenanceCommands,
} from "./adapters/contract-subjects"
import {
  admissionInvariantCases,
  expectedAdmittedIdentity,
} from "./fixtures/admission-invariant-cases"
import { literalProcessResult } from "./fixtures/plugin-consumer"

test("public Admission completes before Maintenance Command assembly", () => {
  const before = admissionDurableDigest()
  const actual = admissionBootstrap?.admit(admissionInvariantCases[0].request)

  expect(admissionImportLedger).toEqual([])
  expect(admissionDurableDigest()).toBe(before)
  expect(actual, "contract-absent: the public Admission subpath must admit the fixed candidate").toEqual({ kind: "admitted", identity: expectedAdmittedIdentity })
})

test("public command invocation requires the same Admitted Identity", async () => {
  const admission = admissionBootstrap?.admit(admissionInvariantCases[0].request)
  const actual = admission?.kind === "admitted" ? await maintenanceCommands?.inspect({ command: "help" }) : undefined

  expect(actual, "contract-absent: a command must run only after public Admission succeeds").toMatchObject({ command: "help", exitClass: 0 })
})

test("public command process preserves stdout stderr and exit", async () => {
  const observed = await invokeMaintenanceProcess(["help"])

  expect(observed, "contract-absent: public process observations must remain distinct").toEqual(literalProcessResult)
})
