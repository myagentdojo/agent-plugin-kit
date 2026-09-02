import type {
  CanaryAuthoritySource,
  CanaryCandidate,
  CanaryPlan,
} from "../../canary-qualification/interface"
import type {
  AdmittedIdentity,
  CandidateIdentity,
} from "../../release-and-git-engine/interface"
import type {
  MaintenanceCommand,
  WireCommand,
} from "../interface"
import {
  candidateIdentitiesMatch,
} from "../../release-and-git-engine/serialized-values"
import { parseWireCommand } from "../serialized-values"

export type TrustedCommandBindingRefusalCode =
  | "wire-version-unsupported"
  | "wire-command-invalid"
  | "payload-fragment-invalid"
  | "release-fragment-invalid"
  | "release-approval-invalid"
  | "claude-fragment-invalid"
  | "claude-approval-invalid"
  | "codex-fragment-invalid"
  | "codex-approval-invalid"
  | "canary-fragment-invalid"
  | "canary-authority-reference-invalid"
  | "candidate-mismatch"
  | "plan-not-accepted"
  | "authority-reference-invalid"
  | "authority-candidate-mismatch"
  | "authority-plan-mismatch"
  | "authority-unavailable"

export type TrustedCommandBindingRefusal = {
  status: "refused"
  code: TrustedCommandBindingRefusalCode
}

export type TrustedCommandBindingResult =
  | { status: "bound"; command: MaintenanceCommand }
  | TrustedCommandBindingRefusal

export type CanaryBindingDependencies = {
  inspect(candidate: CanaryCandidate): Promise<CanaryPlan>
  acceptPlan(plan: CanaryPlan): boolean | Promise<boolean>
  authoritySource: CanaryAuthoritySource
}

export type TrustedCommandBindingStep =
  | "parse"
  | "candidate-agreement"
  | "inspect"
  | "plan-acceptance"
  | "authority-resolution"
  | "bind"
  | "qualify"

export type TrustedCommandBindingDependencies = {
  admittedIdentity: AdmittedIdentity
  canary?: CanaryBindingDependencies
  trace?: (step: TrustedCommandBindingStep) => void
}

type WireCommandRecord = Record<string, unknown>

const isRecord = (value: unknown): value is WireCommandRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const refusal = (code: TrustedCommandBindingRefusalCode): TrustedCommandBindingRefusal => ({
  status: "refused",
  code,
})

/**
 * Map structural failures to an owner-owned refusal without retaining the
 * input or exposing Zod's diagnostic tree. Version selection is kept distinct
 * because an unsupported outer version is refused before nested validation.
 */
export function wireCommandRefusalFor(value: unknown): TrustedCommandBindingRefusal {
  if (isRecord(value)) {
    const version = Object.getOwnPropertyDescriptor(value, "schemaVersion")
    if (version !== undefined && "value" in version && version.value !== 1) {
      return refusal("wire-version-unsupported")
    }
    const command = Object.getOwnPropertyDescriptor(value, "command")
    if (command !== undefined && "value" in command && typeof command.value === "string") {
      const nested = Object.getOwnPropertyDescriptor(value, "approval")
      if (nested !== undefined && "value" in nested && isRecord(nested.value)) {
        const approvalVersion = Object.getOwnPropertyDescriptor(nested.value, "schemaVersion")
        if (approvalVersion !== undefined && "value" in approvalVersion && approvalVersion.value !== 1) {
          if (command.value === "release:apply") return refusal("release-approval-invalid")
          if (command.value === "harness:claude:apply") return refusal("claude-approval-invalid")
          if (command.value === "harness:codex:apply") return refusal("codex-approval-invalid")
        }
      }
      if (command.value.startsWith("payload:")) return refusal("payload-fragment-invalid")
      if (command.value.startsWith("release:")) return refusal("release-fragment-invalid")
      if (command.value === "harness:claude:inspect" || command.value === "harness:claude:apply") {
        return refusal("claude-fragment-invalid")
      }
      if (command.value === "harness:codex:inspect" || command.value === "harness:codex:apply") {
        return refusal("codex-fragment-invalid")
      }
      if (command.value.startsWith("canary:")) return refusal("canary-fragment-invalid")
    }
  }
  return refusal("wire-command-invalid")
}

const candidateFor = (command: WireCommand): CandidateIdentity | undefined => {
  switch (command.command) {
    case "release:inspect":
    case "release:apply":
      return command.request.candidate
    case "harness:claude:inspect":
    case "harness:claude:apply":
    case "harness:codex:inspect":
    case "harness:codex:apply":
      return command.request.candidate
    case "canary:inspect":
    case "canary:qualify":
      return command.candidate.identity
    default:
      return undefined
  }
}

const candidateAgrees = (command: WireCommand, admittedIdentity: AdmittedIdentity): boolean => {
  const candidate = candidateFor(command)
  if (candidate === undefined) return true
  if (!candidateIdentitiesMatch(candidate, admittedIdentity)) return false
  if (command.command === "release:apply" && !candidateIdentitiesMatch(command.approval.candidate, admittedIdentity)) return false
  if (command.command === "harness:claude:apply" && !candidateIdentitiesMatch(command.approval.candidate, admittedIdentity)) return false
  if (command.command === "harness:codex:apply" && !candidateIdentitiesMatch(command.approval.candidate, admittedIdentity)) return false
  return true
}

const boundCommandFor = (
  command: WireCommand,
  admittedIdentity: AdmittedIdentity,
): MaintenanceCommand => {
  switch (command.command) {
    case "help":
      return { command: "help" }
    case "payload:check":
      return { command: "payload:check", request: command.request }
    case "payload:materialize":
      return { command: "payload:materialize", request: command.request }
    case "payload:package":
      return { command: "payload:package", request: command.request }
    case "runtime:repair":
      return { command: "runtime:repair", argv: command.argv }
    case "runtime:repair-apply":
      return { command: "runtime:repair-apply", argv: command.argv }
    case "release:inspect":
      return { command: "release:inspect", request: command.request }
    case "release:apply":
      return { command: "release:apply", request: command.request, approval: command.approval }
    case "harness:claude:inspect":
      return {
        command: command.command,
        request: {
          identity: admittedIdentity,
          payload: command.request.payload,
          profileIdentity: command.request.profileIdentity,
        },
      }
    case "harness:claude:apply":
      return {
        command: command.command,
        request: {
          identity: admittedIdentity,
          payload: command.request.payload,
          profileIdentity: command.request.profileIdentity,
          expectedEffectIds: command.request.expectedEffectIds,
        },
        approval: command.approval,
      }
    case "harness:codex:inspect":
      return {
        command: command.command,
        request: {
          identity: admittedIdentity,
          payload: command.request.payload,
          profileIdentity: command.request.profileIdentity,
          checkoutIdentity: command.request.checkoutIdentity,
        },
      }
    case "harness:codex:apply":
      return {
        command: command.command,
        request: {
          identity: admittedIdentity,
          payload: command.request.payload,
          profileIdentity: command.request.profileIdentity,
          checkoutIdentity: command.request.checkoutIdentity,
          expectedEffectIds: command.request.expectedEffectIds,
        },
        approval: command.approval,
      }
    case "canary:inspect":
      return { command: "canary:inspect", candidate: command.candidate }
    case "canary:qualify":
      throw new Error("canary authority must be resolved before binding")
  }
}

const authorityReferenceFor = (command: WireCommand): string | undefined =>
  command.command === "canary:qualify" ? command.authority : undefined

const canaryCandidateFor = (command: WireCommand): CanaryCandidate | undefined =>
  command.command === "canary:qualify" ? command.candidate : undefined

const bindParsedWireCommand = async (
  command: WireCommand,
  dependencies: TrustedCommandBindingDependencies,
): Promise<TrustedCommandBindingResult> => {
  dependencies.trace?.("candidate-agreement")
  if (!candidateAgrees(command, dependencies.admittedIdentity)) return refusal("candidate-mismatch")

  const canaryCandidate = canaryCandidateFor(command)
  if (canaryCandidate === undefined) {
    const bound = boundCommandFor(command, dependencies.admittedIdentity)
    dependencies.trace?.("bind")
    return { status: "bound", command: bound }
  }

  const canary = dependencies.canary
  if (canary === undefined) return refusal("authority-unavailable")
  const reference = authorityReferenceFor(command)
  if (reference === undefined || reference.length === 0) return refusal("canary-authority-reference-invalid")

  dependencies.trace?.("inspect")
  const plan = await canary.inspect(canaryCandidate)
  if (!candidateIdentitiesMatch(plan.candidate, dependencies.admittedIdentity)) {
    return refusal("candidate-mismatch")
  }
  dependencies.trace?.("plan-acceptance")
  if (!(await canary.acceptPlan(plan))) return refusal("plan-not-accepted")
  dependencies.trace?.("authority-resolution")
  const resolution = await canary.authoritySource.resolve(
    reference,
    dependencies.admittedIdentity,
    plan,
  )
  if (resolution.status !== "resolved") return refusal(resolution.code)

  dependencies.trace?.("bind")
  return {
    status: "bound",
    command: {
      command: "canary:qualify",
      candidate: canaryCandidate,
      authority: resolution.authority,
    },
  }
}

/**
 * Parse and bind one untrusted Wire Command. The only capability introduced by
 * this function is the caller-owned admitted identity (or a protected
 * authority returned by Canary Qualification's source); serialized input is
 * never branded or cast into either capability.
 */
export async function bindTrustedCommand(
  value: unknown,
  dependencies: TrustedCommandBindingDependencies,
): Promise<TrustedCommandBindingResult> {
  dependencies.trace?.("parse")
  const command = parseWireCommand(value)
  if (command === undefined) return wireCommandRefusalFor(value)
  return bindParsedWireCommand(command, dependencies)
}

/** Bind a command that has already crossed the structural parse boundary. */
async function bindParsedTrustedCommand(
  command: WireCommand,
  dependencies: TrustedCommandBindingDependencies,
): Promise<TrustedCommandBindingResult> {
  return bindParsedWireCommand(command, dependencies)
}
