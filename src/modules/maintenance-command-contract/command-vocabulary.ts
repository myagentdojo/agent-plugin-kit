import type { CommandPreview, MaintenanceCommand } from "./interface"
import { resultSchemaVersion } from "./result-vocabulary"

export type CommandDescriptor = {
  route: readonly string[]
  command: MaintenanceCommand["command"]
  interfaceCall: "inspect" | "apply"
  inputs: readonly string[]
  stdin: boolean
  effectClass: CommandPreview["effectClass"]
  protectedInput: "approval" | "authority" | null
  previewRoute: readonly string[] | null
  example: readonly string[]
  nextAction: CommandPreview["nextAction"]
}

export const commandContractSchemaVersion = resultSchemaVersion

const runId = "contract-help-literal"

export const commandVocabulary = [
  {
    route: ["help"],
    command: "help",
    interfaceCall: "inspect",
    inputs: [],
    stdin: false,
    effectClass: "inspect",
    protectedInput: null,
    previewRoute: null,
    example: ["maintenance", "--run-id", runId, "help"],
    nextAction: {
      id: "help.choose-command",
      action: "select_command",
      summary: "Choose one command from the sealed vocabulary.",
      commandId: null,
    },
  },
  {
    route: ["payload", "check"],
    command: "payload:check",
    interfaceCall: "inspect",
    inputs: ["--request"],
    stdin: true,
    effectClass: "inspect",
    protectedInput: null,
    previewRoute: null,
    example: ["maintenance", "--run-id", runId, "payload", "check", "--request", "<FILE>"],
    nextAction: {
      id: "payload-check.inspect-result",
      action: "inspect_state",
      summary: "Inspect the payload check result.",
      commandId: null,
    },
  },
  {
    route: ["payload", "materialize"],
    command: "payload:materialize",
    interfaceCall: "apply",
    inputs: ["--request"],
    stdin: true,
    effectClass: "repository-local",
    protectedInput: null,
    previewRoute: ["payload", "check"],
    example: [
      "maintenance",
      "--run-id",
      runId,
      "payload",
      "materialize",
      "--request",
      "<FILE>",
    ],
    nextAction: {
      id: "payload-materialize.inspect-result",
      action: "inspect_state",
      summary: "Inspect the materialized Plugin Payload.",
      commandId: null,
    },
  },
  {
    route: ["payload", "package"],
    command: "payload:package",
    interfaceCall: "apply",
    inputs: ["--request"],
    stdin: true,
    effectClass: "repository-local",
    protectedInput: null,
    previewRoute: null,
    example: ["maintenance", "--run-id", runId, "payload", "package", "--request", "<FILE>"],
    nextAction: {
      id: "payload-package.inspect-result",
      action: "inspect_state",
      summary: "Inspect the packaged Plugin Payload.",
      commandId: null,
    },
  },
  {
    route: ["runtime", "repair"],
    command: "runtime:repair",
    interfaceCall: "inspect",
    inputs: [],
    stdin: false,
    effectClass: "inspect",
    protectedInput: null,
    previewRoute: null,
    example: ["maintenance", "--run-id", runId, "runtime", "repair"],
    nextAction: {
      id: "runtime-repair.inspect-result",
      action: "inspect_state",
      summary: "Inspect the Runtime Custody result.",
      commandId: null,
    },
  },
  {
    route: ["runtime", "repair", "--apply"],
    command: "runtime:repair-apply",
    interfaceCall: "apply",
    inputs: [],
    stdin: false,
    effectClass: "external",
    protectedInput: null,
    previewRoute: ["runtime", "repair"],
    example: ["maintenance", "--run-id", runId, "runtime", "repair", "--apply"],
    nextAction: {
      id: "runtime-repair-apply.inspect-result",
      action: "inspect_state",
      summary: "Inspect Runtime Custody after repair.",
      commandId: null,
    },
  },
  {
    route: ["release", "inspect"],
    command: "release:inspect",
    interfaceCall: "inspect",
    inputs: ["--request"],
    stdin: true,
    effectClass: "inspect",
    protectedInput: null,
    previewRoute: null,
    example: ["maintenance", "--run-id", runId, "release", "inspect", "--request", "<FILE>"],
    nextAction: {
      id: "release-inspect.review-preview",
      action: "open_docs",
      summary: "Review the preview before requesting apply.",
      commandId: null,
    },
  },
  {
    route: ["release", "apply"],
    command: "release:apply",
    interfaceCall: "apply",
    inputs: ["--request", "--approval"],
    stdin: true,
    effectClass: "external",
    protectedInput: "approval",
    previewRoute: ["release", "inspect"],
    example: [
      "maintenance",
      "--run-id",
      runId,
      "release",
      "apply",
      "--request",
      "<FILE>",
      "--approval",
      "<FILE>",
    ],
    nextAction: {
      id: "release-apply.inspect-result",
      action: "inspect_state",
      summary: "Inspect the release result.",
      commandId: null,
    },
  },
  {
    route: ["harness", "claude", "inspect"],
    command: "harness:claude:inspect",
    interfaceCall: "inspect",
    inputs: ["--request"],
    stdin: true,
    effectClass: "inspect",
    protectedInput: null,
    previewRoute: null,
    example: [
      "maintenance",
      "--run-id",
      runId,
      "harness",
      "claude",
      "inspect",
      "--request",
      "<FILE>",
    ],
    nextAction: {
      id: "harness-claude-inspect.inspect-result",
      action: "inspect_state",
      summary: "Inspect the Claude journey preview.",
      commandId: null,
    },
  },
  {
    route: ["harness", "claude", "apply"],
    command: "harness:claude:apply",
    interfaceCall: "apply",
    inputs: ["--request", "--approval"],
    stdin: true,
    effectClass: "external",
    protectedInput: "approval",
    previewRoute: ["harness", "claude", "inspect"],
    example: [
      "maintenance",
      "--run-id",
      runId,
      "harness",
      "claude",
      "apply",
      "--request",
      "<FILE>",
      "--approval",
      "<FILE>",
    ],
    nextAction: {
      id: "harness-claude-apply.inspect-result",
      action: "inspect_state",
      summary: "Inspect the Claude journey result.",
      commandId: null,
    },
  },
  {
    route: ["harness", "codex", "inspect"],
    command: "harness:codex:inspect",
    interfaceCall: "inspect",
    inputs: ["--request"],
    stdin: true,
    effectClass: "inspect",
    protectedInput: null,
    previewRoute: null,
    example: [
      "maintenance",
      "--run-id",
      runId,
      "harness",
      "codex",
      "inspect",
      "--request",
      "<FILE>",
    ],
    nextAction: {
      id: "harness-codex-inspect.inspect-result",
      action: "inspect_state",
      summary: "Inspect the Codex journey preview.",
      commandId: null,
    },
  },
  {
    route: ["harness", "codex", "apply"],
    command: "harness:codex:apply",
    interfaceCall: "apply",
    inputs: ["--request", "--approval"],
    stdin: true,
    effectClass: "external",
    protectedInput: "approval",
    previewRoute: ["harness", "codex", "inspect"],
    example: [
      "maintenance",
      "--run-id",
      runId,
      "harness",
      "codex",
      "apply",
      "--request",
      "<FILE>",
      "--approval",
      "<FILE>",
    ],
    nextAction: {
      id: "harness-codex-apply.inspect-result",
      action: "inspect_state",
      summary: "Inspect the Codex journey result.",
      commandId: null,
    },
  },
  {
    route: ["canary", "inspect"],
    command: "canary:inspect",
    interfaceCall: "inspect",
    inputs: ["--candidate"],
    stdin: true,
    effectClass: "inspect",
    protectedInput: null,
    previewRoute: null,
    example: ["maintenance", "--run-id", runId, "canary", "inspect", "--candidate", "<FILE>"],
    nextAction: {
      id: "canary-inspect.inspect-result",
      action: "inspect_state",
      summary: "Inspect the canary preview.",
      commandId: null,
    },
  },
  {
    route: ["canary", "qualify"],
    command: "canary:qualify",
    interfaceCall: "apply",
    inputs: ["--candidate", "--authority"],
    stdin: true,
    effectClass: "external",
    protectedInput: "authority",
    previewRoute: ["canary", "inspect"],
    example: [
      "maintenance",
      "--run-id",
      runId,
      "canary",
      "qualify",
      "--candidate",
      "<FILE>",
      "--authority",
      "<FILE>",
    ],
    nextAction: {
      id: "canary-qualify.inspect-result",
      action: "inspect_state",
      summary: "Inspect the canary qualification result.",
      commandId: null,
    },
  },
] as const satisfies readonly CommandDescriptor[]

type CommandFor<C extends MaintenanceCommand["command"]> = Extract<MaintenanceCommand, { command: C }>

type ProtectedInputFor<C extends MaintenanceCommand["command"]> =
  "approval" extends keyof CommandFor<C>
    ? "approval"
    : "authority" extends keyof CommandFor<C>
      ? "authority"
      : null

type DescriptorProtectedInputFor<C extends MaintenanceCommand["command"]> = Extract<
  (typeof commandVocabulary)[number],
  { command: C }
>["protectedInput"]

type ProtectedInputAlignmentFor<C extends MaintenanceCommand["command"]> =
  [DescriptorProtectedInputFor<C>] extends [ProtectedInputFor<C>]
    ? [ProtectedInputFor<C>] extends [DescriptorProtectedInputFor<C>]
      ? true
      : false
    : false

/**
 * Every command whose descriptor `protectedInput` disagrees with its declared
 * command shape, including a command the vocabulary no longer declares. The
 * assertion is derived from the command union, so a new or removed command is
 * covered without restating a per-command list.
 */
type MisalignedProtectedInputCommands = {
  [C in MaintenanceCommand["command"]]: ProtectedInputAlignmentFor<C> extends true ? never : C
}[MaintenanceCommand["command"]]

const protectedInputAlignmentCheck: [MisalignedProtectedInputCommands] extends [never]
  ? true
  : MisalignedProtectedInputCommands = true

void protectedInputAlignmentCheck
