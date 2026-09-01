import { expect, test } from "bun:test"
import {
  admissionDurableDigest,
  installedAdmission,
  installedPackage,
  invokeMaintenanceProcess,
} from "./adapters/contract-subjects"
import { observeAdmissionSourceImport } from "./adapters/admission-source-projection"
import { literalProcessResult } from "./fixtures/plugin-consumer"

test("public Admission source is dependency-free before maintenance execution", () => {
  const bareSpecifierPerturbation =
    process.env.AGENT_PLUGIN_KIT_ADMISSION_BARE_SPECIFIER_PERTURBATION
  const sourceObservation = observeAdmissionSourceImport(
    bareSpecifierPerturbation === undefined ? undefined : { bareSpecifierPerturbation },
  )
  const before = admissionDurableDigest()

  expect(sourceObservation).toEqual({
    exitCode: 0,
    stdout: "admission-bootstrap:loaded\n",
    stderr: "",
    copiedClosure: [
      "src/admission-bootstrap/implementation/admission-bootstrap.ts",
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
  expect(installedAdmission, "contract-absent: the installed public Admission subpath must admit the Git candidate").toMatchObject({
    kind: "admitted",
    identity: {
      source: { commit: installedPackage.resolvedCommit },
      release: { commit: installedPackage.resolvedCommit },
      package: { commit: installedPackage.resolvedCommit },
      workflow: { commit: installedPackage.resolvedCommit },
    },
  })
  expect(installedPackage.admittedExecutionOrder).toEqual(["admission", "qualification", "maintenance-cli"])
  expect(installedPackage.admissionRefusalControl).toEqual({
    admission: {
      kind: "refused",
      refusal: {
        code: "package-pin-mismatch",
        nextAction: "Correct the mismatched immutable identity observation.",
      },
    },
    startedProcesses: ["admission"],
  })
})

test("public command invocation requires the same Admitted Identity", async () => {
  const actual = await invokeMaintenanceProcess(["--run-id", "contract-help-literal", "--help"])

  expect(installedAdmission.kind).toBe("admitted")
  expect(actual, "contract-absent: a command must run only after public Admission succeeds").toEqual(literalProcessResult)
})

test("public command process preserves stdout stderr and exit", async () => {
  const observed = await invokeMaintenanceProcess(["--run-id", "contract-help-literal", "--help"])

  expect(observed, "contract-absent: public process observations must remain distinct").toEqual(literalProcessResult)
})
