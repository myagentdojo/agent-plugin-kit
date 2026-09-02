import { expect, test } from "bun:test"
import type {
  AdmittedIdentity,
  CandidateIdentity,
} from "../../release-and-git-engine/interface"
import {
  bindTrustedCommand,
  type TrustedCommandBindingStep,
} from "../implementation/trusted-command-binding"
import {
  parseWireCommand,
  serializeWireCommand,
} from "../serialized-values"
import type { WireCommand } from "../interface"
import { mutatingRequests } from "./fixtures/literal-command-results"

const candidate = mutatingRequests.release.request.candidate
const admittedIdentity = mutatingRequests.claude.request.identity
const payload = mutatingRequests.claude.request.payload

const wireCommands: readonly WireCommand[] = [
  { schemaVersion: 1, command: "help" },
  { schemaVersion: 1, command: "payload:check", request: { repositoryRoot: "/fixture/plugin", mode: "check" } },
  { schemaVersion: 1, command: "payload:materialize", request: { repositoryRoot: "/fixture/plugin", mode: "materialize" } },
  { schemaVersion: 1, command: "payload:package", request: { repositoryRoot: "/fixture/plugin", mode: "package" } },
  { schemaVersion: 1, command: "runtime:repair", argv: ["repair"] },
  { schemaVersion: 1, command: "runtime:repair-apply", argv: ["repair", "--apply"] },
  { schemaVersion: 1, command: "release:inspect", request: { candidate, intent: "maintenance" } },
  { schemaVersion: 1, command: "release:apply", request: mutatingRequests.release.request, approval: mutatingRequests.release.approval },
  { schemaVersion: 1, command: "harness:claude:inspect", request: { candidate, payload, profileIdentity: "claude-profile" } },
  { schemaVersion: 1, command: "harness:claude:apply", request: { candidate, payload, profileIdentity: "claude-profile", expectedEffectIds: ["effect:claude"] }, approval: mutatingRequests.claude.approval },
  { schemaVersion: 1, command: "harness:codex:inspect", request: { candidate, payload, profileIdentity: "codex-profile", checkoutIdentity: "checkout-b" } },
  { schemaVersion: 1, command: "harness:codex:apply", request: { candidate, payload, profileIdentity: "codex-profile", checkoutIdentity: "checkout-b", expectedEffectIds: ["effect:codex"] }, approval: mutatingRequests.codex.approval },
  { schemaVersion: 1, command: "canary:inspect", candidate: { identity: candidate, inertPayloadSha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" } },
  { schemaVersion: 1, command: "canary:qualify", candidate: { identity: candidate, inertPayloadSha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }, authority: "/protected/authority" },
]

const canary = wireCommands[12]
if (canary === undefined || canary.command !== "canary:inspect") throw new Error("missing canary fixture")
const canaryCandidate = canary.candidate
const canaryQualify = wireCommands[13]
if (canaryQualify === undefined || canaryQualify.command !== "canary:qualify") throw new Error("missing canary qualify fixture")
const helpWire = wireCommands[0]!
const payloadCheckWire = wireCommands[1]!
const releaseApplyWire = wireCommands[7] as Extract<WireCommand, { command: "release:apply" }>
const claudeApplyWire = wireCommands[9] as Extract<WireCommand, { command: "harness:claude:apply" }>
const codexApplyWire = wireCommands[11] as Extract<WireCommand, { command: "harness:codex:apply" }>

test("Maintenance Wire Command version 1 round trips every unbranded command", () => {
  for (const command of wireCommands) {
    const serialized = serializeWireCommand(command)
    expect(parseWireCommand(JSON.parse(serialized))).toEqual(command)
  }
})

test("Wire Command ingress is strict, capability-negative, and owner-mapped", () => {
  expect(parseWireCommand({ ...helpWire, unexpected: true })).toBeUndefined()
  expect(parseWireCommand({ ...payloadCheckWire, request: { repositoryRoot: 42, mode: "check" } })).toBeUndefined()
  expect(parseWireCommand({ ...claudeApplyWire, request: { ...claudeApplyWire.request, identity: admittedIdentity } })).toBeUndefined()
  expect(parseWireCommand({ ...canaryQualify, authority: {} })).toBeUndefined()
  expect(() => serializeWireCommand({ ...helpWire, unexpected: undefined } as unknown as WireCommand)).toThrow(
    "maintenance-command-contract: invalid serialized value",
  )
})

test("nested owner validators are composed exactly once", () => {
  const cases: readonly [WireCommand, readonly string[]][] = [
    [wireCommands[1]!, ["plugin-payload-production.request"]],
    [wireCommands[2]!, ["plugin-payload-production.request"]],
    [wireCommands[3]!, ["plugin-payload-production.request"]],
    [wireCommands[6]!, ["release-and-git-engine.request"]],
    [releaseApplyWire, ["release-and-git-engine.request", "release-and-git-engine.approval"]],
    [wireCommands[8]!, ["harness-journeys.request"]],
    [claudeApplyWire, ["harness-journeys.request", "harness-journeys.approval"]],
    [wireCommands[10]!, ["harness-journeys.request"]],
    [codexApplyWire, ["harness-journeys.request", "harness-journeys.approval"]],
    [wireCommands[12]!, ["canary-qualification.candidate"]],
    [canaryQualify, ["canary-qualification.candidate", "canary-qualification.authority"]],
  ]
  for (const [command, expected] of cases) {
    const observed: string[] = []
    expect(parseWireCommand(command, (owner) => observed.push(owner))).toEqual(command)
    expect(observed, `contract-absent: ${command.command} must consult each nested owner once`).toEqual([...expected])
  }
})

test("nested validation composition short-circuits unknown outer versions", () => {
  const observed: string[] = []
  expect(parseWireCommand({ ...releaseApplyWire, schemaVersion: 2 }, (owner) => observed.push(owner))).toBeUndefined()
  expect(observed).toEqual([])
})

test("nested validation trace rejects bypass and double-invocation mutations", () => {
  const expected = ["release-and-git-engine.request", "release-and-git-engine.approval"]
  const assertExactTrace = (observed: readonly string[]) => {
    expect(observed, "contract-absent: nested owner validation must remain exactly once").toEqual(expected)
  }
  expect(() => assertExactTrace(["release-and-git-engine.approval"])).toThrow()
  expect(() => assertExactTrace([
    "release-and-git-engine.request",
    "release-and-git-engine.request",
    "release-and-git-engine.approval",
  ])).toThrow()
})

test("unknown outer version is refused before nested validation", async () => {
  const steps: TrustedCommandBindingStep[] = []
  const result = await bindTrustedCommand({
    ...releaseApplyWire,
    schemaVersion: 2,
    approval: undefined,
  }, {
    admittedIdentity,
    trace: (step) => steps.push(step),
  })
  expect(result).toEqual({ status: "refused", code: "wire-version-unsupported" })
  expect(steps).toEqual(["parse"])
})

test("version-1 outer variants preserve each independent approval version", () => {
  for (const command of [releaseApplyWire, claudeApplyWire, codexApplyWire]) {
    expect(parseWireCommand(command)).toEqual(command)
  }
  expect(parseWireCommand({ ...releaseApplyWire, approval: { ...releaseApplyWire.approval, schemaVersion: 2 } })).toBeUndefined()
  expect(parseWireCommand({ ...claudeApplyWire, approval: { ...claudeApplyWire.approval, issuer: "harness-journeys:codex" } })).toBeUndefined()
  expect(parseWireCommand({ ...codexApplyWire, approval: { ...codexApplyWire.approval, issuer: "harness-journeys:claude" } })).toBeUndefined()
})

test("binding attaches only the already admitted identity", async () => {
  const result = await bindTrustedCommand(claudeApplyWire, { admittedIdentity })
  expect(result.status).toBe("bound")
  if (result.status !== "bound" || result.command.command !== "harness:claude:apply") return
  expect(result.command.request.identity).toBe(admittedIdentity)
  expect(result.command.request).not.toHaveProperty("candidate")
  expect(result.command).not.toHaveProperty("schemaVersion")
})

test("candidate agreement refuses disagreement before any owner binding", async () => {
  const changedCandidate: CandidateIdentity = {
    ...candidate,
    release: { ...candidate.release, reference: "refs/tags/v2.0.0" },
  }
  const releaseInspectWire = wireCommands[6] as Extract<WireCommand, { command: "release:inspect" }>
  const changedWire = { ...releaseInspectWire, request: { ...releaseInspectWire.request, candidate: changedCandidate } }
  const result = await bindTrustedCommand(changedWire, { admittedIdentity })
  expect(result).toEqual({ status: "refused", code: "candidate-mismatch" })
  const changedApproval = {
    ...releaseApplyWire,
    approval: { ...releaseApplyWire.approval, candidate: changedCandidate },
  }
  expect(await bindTrustedCommand(changedApproval, { admittedIdentity })).toEqual({
    status: "refused",
    code: "candidate-mismatch",
  })
})

test("Canary binding preserves parse, agreement, inspect, acceptance, resolution, and bind order", async () => {
  const steps: TrustedCommandBindingStep[] = []
  const source = {
    async resolve(reference: string, identity: AdmittedIdentity, plan: { candidate: CandidateIdentity; target: string; immutableReference: string }) {
      expect(reference).toBe("/protected/authority")
      expect(identity).toBe(admittedIdentity)
      expect(plan.candidate).toEqual(admittedIdentity)
      return { status: "resolved" as const, authority: Object.create(null) as never }
    },
  }
  const result = await bindTrustedCommand(canaryQualify, {
    admittedIdentity,
    trace: (step) => steps.push(step),
    canary: {
      async inspect(input) {
        expect(input).toEqual(canaryCandidate)
        return { candidate: input.identity, target: "fixture", immutableReference: "fixture" }
      },
      acceptPlan(plan) {
        expect(plan.candidate).toEqual(admittedIdentity)
        return true
      },
      authoritySource: source,
    },
  })
  expect(result.status).toBe("bound")
  expect(steps).toEqual(["parse", "candidate-agreement", "inspect", "plan-acceptance", "authority-resolution", "bind"])
})

test("Canary binding refuses plan acceptance or source resolution without using wire authority", async () => {
  const refusedByPlan = await bindTrustedCommand(canaryQualify, {
    admittedIdentity,
    canary: {
      async inspect(input) {
        return { candidate: input.identity, target: "fixture", immutableReference: "fixture" }
      },
      acceptPlan: () => false,
      authoritySource: { resolve: async () => ({ status: "resolved", authority: Object.create(null) as never }) },
    },
  })
  expect(refusedByPlan).toEqual({ status: "refused", code: "plan-not-accepted" })

  const refusedBySource = await bindTrustedCommand(canaryQualify, {
    admittedIdentity,
    canary: {
      async inspect(input) {
        return { candidate: input.identity, target: "fixture", immutableReference: "fixture" }
      },
      acceptPlan: () => true,
      authoritySource: { resolve: async () => ({ status: "refused", code: "authority-plan-mismatch" }) },
    },
  })
  expect(refusedBySource).toEqual({ status: "refused", code: "authority-plan-mismatch" })
})
