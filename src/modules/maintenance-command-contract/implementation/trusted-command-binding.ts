import type {
  CanaryAuthoritySource,
  CanaryCandidate,
  CanaryPlan,
} from "../../canary-qualification/interface"
import type {
  AdmittedIdentity,
  AdmittedSourceCheckoutIdentity,
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
  | "capability-insufficient"
  | "source-checkout-not-admitted"

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
  | "capability-check"
  | "admission"

export type TrustedCommandBindingDependencies = {
  admittedIdentity: AdmittedIdentity
  canary?: CanaryBindingDependencies
  trace?: (step: TrustedCommandBindingStep) => void
}

export type SourceCheckoutAdmissionSource = () => Promise<
  | { kind: "admitted"; identity: AdmittedSourceCheckoutIdentity }
  | { kind: "refused" }
>

export type SourceCheckoutBindingDependencies = {
  admission: SourceCheckoutAdmissionSource
  trace?: (step: TrustedCommandBindingStep) => void
}

type WireCommandRecord = Record<string, unknown>

const isRecord = (value: unknown): value is WireCommandRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value)

type DataProperty = Readonly<{ present: boolean; value: unknown }>

const dataPropertyFor = (record: WireCommandRecord, key: string): DataProperty => {
	const descriptor = Object.getOwnPropertyDescriptor(record, key)
	if (descriptor === undefined || !("value" in descriptor)) {
		return { present: false, value: undefined }
	}
	return { present: true, value: descriptor.value }
}

const refusal = (code: TrustedCommandBindingRefusalCode): TrustedCommandBindingRefusal => ({
	status: "refused",
	code,
})

const approvalRefusalFor = (
	command: string,
	approval: unknown,
): TrustedCommandBindingRefusal | undefined => {
	if (!isRecord(approval)) return undefined
	const version = dataPropertyFor(approval, "schemaVersion")
	if (!version.present || version.value === 1) return undefined
	switch (command) {
		case "release:apply":
			return refusal("release-approval-invalid")
		case "harness:claude:apply":
			return refusal("claude-approval-invalid")
		case "harness:codex:apply":
			return refusal("codex-approval-invalid")
		default:
			return undefined
	}
}

const fragmentRefusalFor = (
	command: string,
): TrustedCommandBindingRefusal | undefined => {
	if (command.startsWith("payload:")) return refusal("payload-fragment-invalid")
	if (command.startsWith("release:")) return refusal("release-fragment-invalid")
	switch (command) {
		case "harness:claude:inspect":
		case "harness:claude:apply":
			return refusal("claude-fragment-invalid")
		case "harness:codex:inspect":
		case "harness:codex:apply":
			return refusal("codex-fragment-invalid")
	default:
		return command.startsWith("canary:") ? refusal("canary-fragment-invalid") : undefined
	}
}

/**
 * Map structural failures to an owner-owned refusal without retaining the
 * input or exposing Zod's diagnostic tree. Version selection is kept distinct
 * because an unsupported outer version is refused before nested validation.
 */
function wireCommandRefusalFor(value: unknown): TrustedCommandBindingRefusal {
	if (!isRecord(value)) return refusal("wire-command-invalid")
	const version = dataPropertyFor(value, "schemaVersion")
	if (version.present && version.value !== 1) return refusal("wire-version-unsupported")
	const command = dataPropertyFor(value, "command")
	if (!command.present || typeof command.value !== "string") {
		return refusal("wire-command-invalid")
	}
	const approval = dataPropertyFor(value, "approval")
	return approvalRefusalFor(command.value, approval.present ? approval.value : undefined)
		?? fragmentRefusalFor(command.value)
		?? refusal("wire-command-invalid")
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

type PayloadWireCommand = Extract<
	WireCommand,
	{ command: "payload:check" | "payload:materialize" | "payload:package" }
>
type RuntimeWireCommand = Extract<
	WireCommand,
	{ command: "runtime:repair" | "runtime:repair-apply" }
>
type ReleaseWireCommand = Extract<
	WireCommand,
	{ command: "release:inspect" | "release:apply" }
>
type HarnessWireCommand = Extract<
	WireCommand,
	{
		command:
			| "harness:claude:inspect"
			| "harness:claude:apply"
			| "harness:codex:inspect"
			| "harness:codex:apply"
	}
>
type CanaryQualifyWireCommand = Extract<WireCommand, { command: "canary:qualify" }>

const isPayloadWireCommand = (command: WireCommand): command is PayloadWireCommand =>
	command.command.startsWith("payload:")

const isRuntimeWireCommand = (command: WireCommand): command is RuntimeWireCommand =>
	command.command.startsWith("runtime:")

const isReleaseWireCommand = (command: WireCommand): command is ReleaseWireCommand =>
	command.command.startsWith("release:")

const isHarnessWireCommand = (command: WireCommand): command is HarnessWireCommand =>
	command.command.startsWith("harness:")

const isCanaryQualifyCommand = (command: WireCommand): command is CanaryQualifyWireCommand =>
	command.command === "canary:qualify"

const boundPayloadCommandFor = (command: PayloadWireCommand): MaintenanceCommand => {
	switch (command.command) {
		case "payload:check":
			return { command: "payload:check", request: command.request }
		case "payload:materialize":
			return { command: "payload:materialize", request: command.request }
		case "payload:package":
			return { command: "payload:package", request: command.request }
	}
}

const boundRuntimeCommandFor = (command: RuntimeWireCommand): MaintenanceCommand => {
	switch (command.command) {
		case "runtime:repair":
			return { command: "runtime:repair", argv: command.argv }
		case "runtime:repair-apply":
			return { command: "runtime:repair-apply", argv: command.argv }
	}
}

const boundReleaseCommandFor = (command: ReleaseWireCommand): MaintenanceCommand => {
	switch (command.command) {
		case "release:inspect":
			return { command: "release:inspect", request: command.request }
		case "release:apply":
			return { command: "release:apply", request: command.request, approval: command.approval }
	}
}

const boundHarnessCommandFor = (
	command: HarnessWireCommand,
	admittedIdentity: AdmittedIdentity,
): MaintenanceCommand => {
	switch (command.command) {
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
	}
}

const boundCommandFor = (
	command: WireCommand,
	admittedIdentity: AdmittedIdentity,
): MaintenanceCommand => {
	if (command.command === "help") return { command: "help" }
	if (isPayloadWireCommand(command)) return boundPayloadCommandFor(command)
	if (isRuntimeWireCommand(command)) return boundRuntimeCommandFor(command)
	if (isReleaseWireCommand(command)) return boundReleaseCommandFor(command)
	if (isHarnessWireCommand(command)) return boundHarnessCommandFor(command, admittedIdentity)
	if (command.command === "canary:inspect") {
		return { command: "canary:inspect", candidate: command.candidate }
	}
	throw new Error("canary authority must be resolved before binding")
}

const inspectAndAcceptCanaryPlan = async (
	command: CanaryQualifyWireCommand,
	dependencies: TrustedCommandBindingDependencies,
): Promise<CanaryPlan | TrustedCommandBindingRefusal> => {
	const canary = dependencies.canary
	if (canary === undefined) return refusal("authority-unavailable")
	dependencies.trace?.("inspect")
	const plan = await canary.inspect(command.candidate)
	if (!candidateIdentitiesMatch(plan.candidate, dependencies.admittedIdentity)) {
		return refusal("candidate-mismatch")
	}
	dependencies.trace?.("plan-acceptance")
	if (!(await canary.acceptPlan(plan))) return refusal("plan-not-accepted")
	return plan
}

const resolveCanaryCommand = async (
	command: CanaryQualifyWireCommand,
	plan: CanaryPlan,
	dependencies: TrustedCommandBindingDependencies,
): Promise<TrustedCommandBindingResult> => {
	const canary = dependencies.canary
	if (canary === undefined) return refusal("authority-unavailable")
	dependencies.trace?.("authority-resolution")
	const resolution = await canary.authoritySource.resolve(
		command.authority,
		dependencies.admittedIdentity,
		plan,
	)
	if (resolution.status !== "resolved") return refusal(resolution.code)

	dependencies.trace?.("bind")
	return {
		status: "bound",
		command: {
			command: "canary:qualify",
			candidate: command.candidate,
			authority: resolution.authority,
		},
	}
}

const bindCanaryWireCommand = async (
	command: CanaryQualifyWireCommand,
	dependencies: TrustedCommandBindingDependencies,
): Promise<TrustedCommandBindingResult> => {
	if (command.authority.length === 0) return refusal("canary-authority-reference-invalid")
	const plan = await inspectAndAcceptCanaryPlan(command, dependencies)
	if ("status" in plan) return plan
	return resolveCanaryCommand(command, plan, dependencies)
}

const bindParsedWireCommand = async (
	command: WireCommand,
	dependencies: TrustedCommandBindingDependencies,
): Promise<TrustedCommandBindingResult> => {
	dependencies.trace?.("candidate-agreement")
	if (!candidateAgrees(command, dependencies.admittedIdentity)) return refusal("candidate-mismatch")

	if (!isCanaryQualifyCommand(command)) {
		const bound = boundCommandFor(command, dependencies.admittedIdentity)
		dependencies.trace?.("bind")
		return { status: "bound", command: bound }
	}
	return bindCanaryWireCommand(command, dependencies)
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

/**
 * Bind the single command that Source Checkout Admission can authorize. The
 * parsed Wire Command remains ordinary data; only Admission produces identity.
 */
export async function bindSourceCheckoutCommand(
  value: unknown,
  dependencies: SourceCheckoutBindingDependencies,
): Promise<TrustedCommandBindingResult> {
  dependencies.trace?.("parse")
  const command = parseWireCommand(value)
  if (command === undefined) return wireCommandRefusalFor(value)
  dependencies.trace?.("capability-check")
  if (command.command !== "payload:package") return refusal("capability-insufficient")
  dependencies.trace?.("admission")
  const admitted = await dependencies.admission()
  if (admitted.kind !== "admitted") return refusal("source-checkout-not-admitted")
  dependencies.trace?.("bind")
  return { status: "bound", command: { command: "payload:package", request: command.request } }
}

/** Bind a command that has already crossed the structural parse boundary. */
async function bindParsedTrustedCommand(
  command: WireCommand,
  dependencies: TrustedCommandBindingDependencies,
): Promise<TrustedCommandBindingResult> {
  return bindParsedWireCommand(command, dependencies)
}
