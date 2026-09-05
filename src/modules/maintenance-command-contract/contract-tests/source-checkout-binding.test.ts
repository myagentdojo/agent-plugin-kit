import { expect, test } from "bun:test"
import type { AdmittedSourceCheckoutIdentity } from "../../release-and-git-engine/interface"
import type { MaintenanceCommand } from "../interface"
import { bindSourceCheckoutCommand, type TrustedCommandBindingStep } from "../implementation/trusted-command-binding"
import { createMaintenanceContractHarness } from "./adapters/mutation-recording-module-adapter"
import { literalWireCommands } from "./fixtures/literal-wire-commands"

const checkWire = literalWireCommands.find((value) => value.command === "payload:check")
const materializeWire = literalWireCommands.find((value) => value.command === "payload:materialize")
const packageWire = literalWireCommands.find((value) => value.command === "payload:package")
if (checkWire === undefined || checkWire.command !== "payload:check") throw new Error("missing check wire fixture")
if (materializeWire === undefined || materializeWire.command !== "payload:materialize") throw new Error("missing materialize wire fixture")
if (packageWire === undefined || packageWire.command !== "payload:package") throw new Error("missing package wire fixture")
const canaryWire = literalWireCommands.find((value) => value.command === "canary:qualify")
if (canaryWire === undefined || canaryWire.command !== "canary:qualify") throw new Error("missing canary wire fixture")
const admitted = { kind: "admitted" as const, identity: {} as AdmittedSourceCheckoutIdentity }

test("M01 all repository-local payload bindings parse, check capability, admit, and bind once", async () => {
  const payloadWires = [checkWire, materializeWire, packageWire] as const
  let admissions = 0
  for (const wire of payloadWires) {
    const steps: TrustedCommandBindingStep[] = []
    const result = await bindSourceCheckoutCommand(wire, {
      admission: async () => { admissions += 1; return admitted }, trace: (step) => steps.push(step),
    })
    const expected: MaintenanceCommand = (() => {
      switch (wire.command) {
        case "payload:check": return { command: "payload:check", request: wire.request }
        case "payload:materialize": return { command: "payload:materialize", request: wire.request }
        case "payload:package": return { command: "payload:package", request: wire.request }
      }
    })()
    expect(result).toEqual({ status: "bound", command: expected })
    expect(steps).toEqual(["parse", "capability-check", "admission", "bind"])
  }
  expect(admissions).toBe(payloadWires.length)
})

test("M02 every other valid Wire Command refuses before source admission", async () => {
  const protectedCommands = literalWireCommands.filter((value) => !["payload:check", "payload:materialize", "payload:package"].includes(value.command))
  expect(protectedCommands).toHaveLength(11)
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
