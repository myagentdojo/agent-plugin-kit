import { expect, test } from "bun:test"
import type { AdmittedSourceCheckoutIdentity } from "../../release-and-git-engine/interface"
import { bindSourceCheckoutCommand, type TrustedCommandBindingStep } from "../implementation/trusted-command-binding"
import { createMaintenanceContractHarness } from "./adapters/mutation-recording-module-adapter"
import { literalWireCommands } from "./fixtures/literal-wire-commands"

const packageWire = literalWireCommands.find((value) => value.command === "payload:package")
if (packageWire === undefined || packageWire.command !== "payload:package") throw new Error("missing package wire fixture")
const canaryWire = literalWireCommands.find((value) => value.command === "canary:qualify")
if (canaryWire === undefined || canaryWire.command !== "canary:qualify") throw new Error("missing canary wire fixture")
const admitted = { kind: "admitted" as const, identity: {} as AdmittedSourceCheckoutIdentity }

test("M01 package binding parses, checks capability, admits, and binds once", async () => {
  const steps: TrustedCommandBindingStep[] = []
  let admissions = 0
  const result = await bindSourceCheckoutCommand(packageWire, {
    admission: async () => { admissions += 1; return admitted }, trace: (step) => steps.push(step),
  })
  expect(result).toEqual({ status: "bound", command: { command: "payload:package", request: packageWire.request } })
  expect(steps).toEqual(["parse", "capability-check", "admission", "bind"])
  expect(admissions).toBe(1)
})

test("M02 every other valid Wire Command refuses before source admission", async () => {
  const protectedCommands = literalWireCommands.filter((value) => value.command !== "payload:package")
  expect(protectedCommands).toHaveLength(13)
  for (const value of protectedCommands) {
    const steps: TrustedCommandBindingStep[] = []
    let admissions = 0
    expect(await bindSourceCheckoutCommand(value, {
      admission: async () => { admissions += 1; return admitted }, trace: (step) => steps.push(step),
    })).toEqual({ status: "refused", code: "capability-insufficient" })
    expect(steps).toEqual(["parse", "capability-check"])
    expect(admissions).toBe(0)
  }
})

test("M03 released parse refusals precede admission and source refusal stays distinct", async () => {
  for (const [value, code] of [
    [{ schemaVersion: 2, command: "payload:package" }, "wire-version-unsupported"],
    [{ schemaVersion: 1, command: "payload:package", request: { repositoryRoot: "/fixture", mode: "check" } }, "payload-fragment-invalid"],
  ] as const) {
    const steps: TrustedCommandBindingStep[] = []
    expect(await bindSourceCheckoutCommand(value, { admission: async () => admitted, trace: (step) => steps.push(step) }))
      .toEqual({ status: "refused", code })
    expect(steps).toEqual(["parse"])
  }
  const steps: TrustedCommandBindingStep[] = []
  expect(await bindSourceCheckoutCommand(packageWire, { admission: async () => ({ kind: "refused" }), trace: (step) => steps.push(step) }))
    .toEqual({ status: "refused", code: "source-checkout-not-admitted" })
  expect(steps).toEqual(["parse", "capability-check", "admission"])
})

test("M04 a valid canary never reaches its authority collaborators", async () => {
  const steps: TrustedCommandBindingStep[] = []
  const ledgers = { inspect: 0, acceptPlan: 0, resolve: 0, admission: 0 }
  const fullCanaryDependencies = {
    admission: async () => { ledgers.admission += 1; return admitted }, trace: (step: TrustedCommandBindingStep) => steps.push(step),
    canary: {
      async inspect(input: typeof canaryWire.candidate) { ledgers.inspect += 1; return { candidate: input.identity, target: "fixture", immutableReference: "fixture" } },
      acceptPlan: () => { ledgers.acceptPlan += 1; return true },
      authoritySource: { async resolve() { ledgers.resolve += 1; return { status: "resolved" as const, authority: Object.create(null) as never } }, },
    },
  }
  expect(await bindSourceCheckoutCommand(canaryWire, fullCanaryDependencies)).toEqual({ status: "refused", code: "capability-insufficient" })
  expect(steps).toEqual(["parse", "capability-check"])
  expect(ledgers).toEqual({ inspect: 0, acceptPlan: 0, resolve: 0, admission: 0 })
})

test("M05 a source-bound package command applies through the released harness", async () => {
  const bound = await bindSourceCheckoutCommand(packageWire, { admission: async () => admitted })
  expect(bound.status).toBe("bound")
  if (bound.status !== "bound" || bound.command.command !== "payload:package") return
  const harness = createMaintenanceContractHarness()
  expect(await harness.apply(bound.command)).toMatchObject({ status: "ok", value: { command: "payload:package" } })
  expect(harness.applyLedgers.payload).toEqual([{ command: "payload:package", request: packageWire.request }])
})
