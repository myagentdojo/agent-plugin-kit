import { expect, test } from "bun:test"
import {
  admissionBootstrap,
  admissionDurableDigest,
  invokeMaintenanceProcess,
  maintenanceCommands,
} from "./adapters/contract-subjects"
import { observeAdmissionSourceImport } from "./adapters/admission-source-projection"
import {
  admissionInvariantCases,
  expectedAdmittedIdentity,
} from "./fixtures/admission-invariant-cases"
import { literalProcessResult } from "./fixtures/plugin-consumer"

test("public Admission source is dependency-free before maintenance execution", () => {
  const bareSpecifierPerturbation =
    process.env.AGENT_PLUGIN_KIT_ADMISSION_BARE_SPECIFIER_PERTURBATION
  const sourceObservation = observeAdmissionSourceImport(
    bareSpecifierPerturbation === undefined ? undefined : { bareSpecifierPerturbation },
  )
  const before = admissionDurableDigest()
  const actual = admissionBootstrap?.admit(admissionInvariantCases[0].request)

  expect(sourceObservation).toEqual({
    exitCode: 0,
    stdout: "admission-bootstrap:loaded\n",
    stderr: "",
    copiedClosure: [
      "src/admission-bootstrap/interface.ts",
      "src/modules/release-and-git-engine/interface.ts",
    ],
    consumerSource:
      'await import("agent-plugin-kit/admission-bootstrap")\nconsole.log("admission-bootstrap:loaded")\n',
    ambientNodeModules: [],
    outsideRepository: true,
    fixtureRemoved: true,
  })
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
