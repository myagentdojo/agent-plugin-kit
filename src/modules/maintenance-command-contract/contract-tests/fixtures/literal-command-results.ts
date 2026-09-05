import type {
  CommandPreview,
  CommandResult,
  MaintenanceApplyRequest,
  MaintenanceCommand,
  MaintenanceOutcome,
} from "../../interface"
import type { AdmittedIdentity } from "../../../release-and-git-engine/interface"
import type {
  PayloadCheckRequest,
  PayloadMaterializeRequest,
  PluginPayloadConfiguration,
  PreparedPayloadCandidate,
} from "../../../plugin-payload-production/interface"

const literalHelpAgent = JSON.parse("{\"schema_version\":1,\"contract_id\":\"agent-plugin-kit.maintenance-command-result\",\"package_identity\":\"agent-plugin-kit\",\"package_version\":\"0.0.0\",\"binary\":\"agent-plugin-kit\",\"versions\":{\"facade_envelope\":1,\"result\":1,\"error\":1,\"hint\":1,\"diagnostic\":2,\"event\":1},\"global_options\":[\"--json\",\"--quiet\",\"--verbose\",\"--debug\",\"--run-id <ID>\",\"--events <auto|off>\"],\"environment_dependencies\":[{\"name\":\"AGENT_PLUGIN_KIT_EVENT_ENDPOINT\",\"required\":false,\"secret\":false,\"accepted\":\"https-or-loopback-http-without-userinfo-query-fragment\"},{\"name\":\"AGENT_PLUGIN_KIT_EVENT_AUTH\",\"required\":false,\"secret\":true,\"accepted\":\"opaque-never-recorded\"}],\"commands\":[{\"route\":[\"help\"],\"command\":\"help\",\"interface_call\":\"inspect\",\"inputs\":[],\"stdin\":false,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"help\"],\"next_action_id\":\"help.choose-command\"},{\"route\":[\"payload\",\"check\"],\"command\":\"payload:check\",\"interface_call\":\"inspect\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"payload\",\"check\",\"--request\",\"<FILE>\"],\"next_action_id\":\"payload-check.inspect-result\"},{\"route\":[\"payload\",\"materialize\"],\"command\":\"payload:materialize\",\"interface_call\":\"apply\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"repository-local\",\"preview_route\":[\"payload\",\"check\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"payload\",\"materialize\",\"--request\",\"<FILE>\"],\"next_action_id\":\"payload-materialize.inspect-result\"},{\"route\":[\"payload\",\"package\"],\"command\":\"payload:package\",\"interface_call\":\"apply\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"repository-local\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"payload\",\"package\",\"--request\",\"<FILE>\"],\"next_action_id\":\"payload-package.inspect-result\"},{\"route\":[\"runtime\",\"repair\"],\"command\":\"runtime:repair\",\"interface_call\":\"inspect\",\"inputs\":[],\"stdin\":false,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"runtime\",\"repair\"],\"next_action_id\":\"runtime-repair.inspect-result\"},{\"route\":[\"runtime\",\"repair\",\"--apply\"],\"command\":\"runtime:repair-apply\",\"interface_call\":\"apply\",\"inputs\":[],\"stdin\":false,\"effect_class\":\"external\",\"preview_route\":[\"runtime\",\"repair\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"runtime\",\"repair\",\"--apply\"],\"next_action_id\":\"runtime-repair-apply.inspect-result\"},{\"route\":[\"release\",\"inspect\"],\"command\":\"release:inspect\",\"interface_call\":\"inspect\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"release\",\"inspect\",\"--request\",\"<FILE>\"],\"next_action_id\":\"release-inspect.review-preview\"},{\"route\":[\"release\",\"apply\"],\"command\":\"release:apply\",\"interface_call\":\"apply\",\"inputs\":[\"--request\",\"--approval\"],\"stdin\":true,\"effect_class\":\"external\",\"preview_route\":[\"release\",\"inspect\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"release\",\"apply\",\"--request\",\"<FILE>\",\"--approval\",\"<FILE>\"],\"next_action_id\":\"release-apply.inspect-result\"},{\"route\":[\"harness\",\"claude\",\"inspect\"],\"command\":\"harness:claude:inspect\",\"interface_call\":\"inspect\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"harness\",\"claude\",\"inspect\",\"--request\",\"<FILE>\"],\"next_action_id\":\"harness-claude-inspect.inspect-result\"},{\"route\":[\"harness\",\"claude\",\"apply\"],\"command\":\"harness:claude:apply\",\"interface_call\":\"apply\",\"inputs\":[\"--request\",\"--approval\"],\"stdin\":true,\"effect_class\":\"external\",\"preview_route\":[\"harness\",\"claude\",\"inspect\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"harness\",\"claude\",\"apply\",\"--request\",\"<FILE>\",\"--approval\",\"<FILE>\"],\"next_action_id\":\"harness-claude-apply.inspect-result\"},{\"route\":[\"harness\",\"codex\",\"inspect\"],\"command\":\"harness:codex:inspect\",\"interface_call\":\"inspect\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"harness\",\"codex\",\"inspect\",\"--request\",\"<FILE>\"],\"next_action_id\":\"harness-codex-inspect.inspect-result\"},{\"route\":[\"harness\",\"codex\",\"apply\"],\"command\":\"harness:codex:apply\",\"interface_call\":\"apply\",\"inputs\":[\"--request\",\"--approval\"],\"stdin\":true,\"effect_class\":\"external\",\"preview_route\":[\"harness\",\"codex\",\"inspect\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"harness\",\"codex\",\"apply\",\"--request\",\"<FILE>\",\"--approval\",\"<FILE>\"],\"next_action_id\":\"harness-codex-apply.inspect-result\"},{\"route\":[\"canary\",\"inspect\"],\"command\":\"canary:inspect\",\"interface_call\":\"inspect\",\"inputs\":[\"--candidate\"],\"stdin\":true,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"canary\",\"inspect\",\"--candidate\",\"<FILE>\"],\"next_action_id\":\"canary-inspect.inspect-result\"},{\"route\":[\"canary\",\"qualify\"],\"command\":\"canary:qualify\",\"interface_call\":\"apply\",\"inputs\":[\"--candidate\",\"--authority\"],\"stdin\":true,\"effect_class\":\"external\",\"preview_route\":[\"canary\",\"inspect\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"canary\",\"qualify\",\"--candidate\",\"<FILE>\",\"--authority\",\"<FILE>\"],\"next_action_id\":\"canary-qualify.inspect-result\"}],\"result_semantics\":{\"retry_safety\":[\"safe\",\"unsafe\",\"requires-fresh-inspection\"],\"transaction_state\":[\"unchanged\",\"completed\",\"partially-completed\",\"unknown\"],\"post_dispatch_refusals\":[\"command-refused\",\"retry-deferred\",\"continuation-required\",\"recovery-required\"]},\"exits\":{\"typed\":[{\"family_id\":\"accepted-success\",\"exit\":0,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"completed\",\"previewed\",\"runtime-repair-preview\",\"runtime-repair-unneeded\",\"runtime-repair-applied\"],\"envelope\":true,\"meaning\":\"success\"},{\"family_id\":\"typed-unexpected\",\"exit\":1,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"runtime-failed\",\"runtime-control-invalid\"],\"envelope\":true,\"meaning\":\"typed unexpected failure\"},{\"family_id\":\"usage-refusal\",\"exit\":2,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"usage-refused\",\"runtime-usage-refused\"],\"envelope\":true,\"meaning\":\"usage refusal\"},{\"family_id\":\"state-action-required\",\"exit\":20,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"continuation-required\",\"recovery-required\",\"runtime-bun-missing\",\"runtime-cache-root-unsafe\",\"runtime-repair-required\"],\"envelope\":true,\"meaning\":\"continuation or recovery required\"},{\"family_id\":\"command-refusal\",\"exit\":21,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"command-refused\",\"runtime-host-tool-missing\",\"runtime-not-executable\",\"runtime-unsupported-platform\"],\"envelope\":true,\"meaning\":\"command refused\"},{\"family_id\":\"transient-retry\",\"exit\":22,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"retry-deferred\",\"runtime-download-failed\",\"runtime-lock-held\"],\"envelope\":true,\"meaning\":\"retry deferred\"},{\"family_id\":\"integrity-or-input-refusal\",\"exit\":23,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"runtime-archive-hash-mismatch\",\"runtime-archive-member-ambiguous\",\"runtime-archive-member-missing\",\"runtime-archive-size-mismatch\",\"runtime-bundle-mismatch\",\"runtime-bundle-unmapped\",\"runtime-executable-hash-mismatch\",\"runtime-executable-size-mismatch\",\"runtime-executable-version-mismatch\",\"runtime-lock-invalid\",\"runtime-skill-unknown\",\"runtime-url-rejected\"],\"envelope\":true,\"meaning\":\"repair or input change required\"}],\"containment\":[{\"family_id\":\"emergency-containment\",\"exit\":1,\"owner\":\"root emergency writer\",\"result_codes\":[],\"envelope\":false,\"meaning\":\"last-resort process containment\"}]},\"next_actions\":[{\"id\":\"maintenance.contact-support\",\"action\":\"contact_support\",\"command_id\":null,\"failure_class\":\"unexpected\"},{\"id\":\"maintenance.show-help\",\"action\":\"change_input\",\"command_id\":\"help\",\"failure_class\":\"usage\"},{\"id\":\"runtime.inspect-usage\",\"action\":\"open_docs\",\"command_id\":\"help\",\"failure_class\":\"usage\"},{\"id\":\"maintenance.inspect-continuation\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"continuation\"},{\"id\":\"maintenance.inspect-recovery\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.install-admitted-bun\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.repair-cache-root\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.apply-repair\",\"action\":\"run_command\",\"command_id\":\"runtime:repair-apply\",\"failure_class\":\"recovery\"},{\"id\":\"maintenance.inspect-refusal\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"runtime.install-host-tool\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"runtime.repair-executable\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"runtime.select-supported-platform\",\"action\":\"change_input\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"maintenance.retry-command\",\"action\":\"retry\",\"command_id\":null,\"failure_class\":\"transient\"},{\"id\":\"runtime.retry-download\",\"action\":\"retry\",\"command_id\":null,\"failure_class\":\"transient\"},{\"id\":\"runtime.wait-for-lock\",\"action\":\"wait\",\"command_id\":null,\"failure_class\":\"transient\"},{\"id\":\"runtime.inspect-locked-archive\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.inspect-plugin-payload\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.inspect-locked-runtime\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.repair-lock\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.inspect-skill-catalog\",\"action\":\"change_input\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"runtime.inspect-locked-url\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"events.inspect-configuration\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"event_delivery\"}],\"privacy\":{\"argv_secret_values\":false,\"stdout\":\"machine-only\",\"diagnostics\":\"stderr\",\"events\":\"redacted-best-effort\",\"persisted_state\":false}}") as Readonly<Record<string, unknown>>

const {
  schema_version: _legacyHelpSchemaVersion,
  ...literalHelpAgentFields
} = literalHelpAgent as Readonly<Record<string, unknown>> & { schema_version: 1 }

const canonicalLiteralHelpAgent = {
  ...literalHelpAgentFields,
  schemaVersion: 1,
} as const

const candidate = {
  source: {
    repository: { origin: "https://github.com/myagentdojo/example-plugin.git" },
    commit: "1111111111111111111111111111111111111111",
  },
  release: {
    reference: "refs/tags/v1.0.0",
    commit: "1111111111111111111111111111111111111111",
  },
  package: {
    repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" },
    commit: "1111111111111111111111111111111111111111",
  },
  workflow: {
    repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" },
    path: ".github/workflows/plugin-maintenance.yml",
    commit: "1111111111111111111111111111111111111111",
  },
} as const

const admittedIdentity = candidate as AdmittedIdentity

const releaseApproval = {
  schemaVersion: 1,
  issuer: "release-and-git-engine",
  candidate,
  candidateIdentitySha256:
    "sha256:2af031b2b3bc51ced417b607dd3e1d937b01534e37d831c392bf85022e903566",
  inspectedStateSha256:
    "sha256:fe794bd2578428889170ddefe91bd2a6a5e0d3b6755944cd74ceb49d5162533e",
  expectedEffectsSha256:
    "sha256:1709dba6fed3c45dc70a4e0af8f7ffe3b1fb09ec580894b79c0d5a4b680af348",
  digest: "sha256:91fa24c36a2b1c705fa539bdafc160e303a539a8973ec5b48b28453fc5fd9f45",
} as const

const pluginSourceIdentity = {
  repository: { origin: "https://github.com/myagentdojo/example-plugin.git" },
  commit: "1111111111111111111111111111111111111111",
} as const

const literalPayloadConfiguration = {
  plugin: {
    name: "example-plugin",
    displayName: "Example Plugin",
    version: "1.0.0",
    description: "Example Plugin",
    author: { name: "Example Author" },
    repository: "https://github.com/myagentdojo/example-plugin",
    license: "MIT",
    keywords: ["example"],
    category: "Developer Tools",
    shortDescription: "Example Plugin",
    longDescription: "Example Plugin for maintenance contract fixtures.",
    capabilities: ["payload"],
    defaultPrompts: ["Inspect the payload."],
    brandColor: "#123456",
    composerIcon: "./assets/example.svg",
    logo: "./assets/example.svg",
    hookDeclarationPaths: [],
  },
  skills: [{
    id: "example",
    hookDependence: "hook-independent",
    production: { kind: "model-only" },
  }],
} as const satisfies PluginPayloadConfiguration

const literalPayloadSourceProjectionPaths = {
  config: "plugin.config.json",
  runtimeLock: "runtime.lock.json",
  skillInventory: "skill-catalog.json",
} as const

export const literalPayloadCheckRequest = {
  repositoryRoot: "/fixture/plugin",
  mode: "check",
  configuration: literalPayloadConfiguration,
  sourceProjectionPaths: literalPayloadSourceProjectionPaths,
} as const satisfies PayloadCheckRequest

export const literalPayloadCheckCommand = {
  command: "payload:check",
  request: literalPayloadCheckRequest,
} as const satisfies Extract<MaintenanceCommand, { command: "payload:check" }>

export const literalPayloadMaterializeRequest = {
  ...literalPayloadCheckRequest,
  mode: "materialize",
} as const satisfies PayloadMaterializeRequest

export const literalPayloadCandidate = {
  files: [],
  projections: [],
  ownedFiles: [],
  payloadSha256: `sha256:${"0".repeat(64)}`,
} as const satisfies PreparedPayloadCandidate

/** Literal well-formed package request; its digests are structural fixtures, not proof. */
export const literalPackageRequest = {
  repositoryRoot: "/fixture/plugin",
  mode: "package",
  sourceIdentity: pluginSourceIdentity,
  release: { name: "example-plugin", version: "1.0.0", tag: "v1.0.0" },
  prepared: {
    sourceIdentity: pluginSourceIdentity,
    files: [{ path: ".claude-plugin/plugin.json", bytes: 2, sha256: `sha256:${"a".repeat(64)}`, executable: false }],
    projections: [
      { role: "bundle-inventory", path: "runtime/bundle-inventory.json", bytes: 2, sha256: `sha256:${"b".repeat(64)}` },
      { role: "runtime-lock", path: "runtime/runtime.lock.json", bytes: 2, sha256: `sha256:${"c".repeat(64)}` },
    ],
    payloadSha256: `sha256:${"d".repeat(64)}`,
    bindingSha256: `sha256:${"e".repeat(64)}`,
  },
} as const satisfies Extract<MaintenanceApplyRequest, { command: "payload:package" }>["request"]

export const mutatingRequests = {
  materialize: {
    command: "payload:materialize",
    request: literalPayloadMaterializeRequest,
  },
  package: {
    command: "payload:package",
    request: literalPackageRequest,
  },
  runtime: {
    command: "runtime:repair-apply",
    argv: ["repair", "--apply"],
  },
  release: {
    command: "release:apply",
    request: { candidate, intent: "maintenance", expectedEffectIds: ["effect:release"] },
    approval: releaseApproval,
  },
  claude: {
    command: "harness:claude:apply",
    request: {
      identity: admittedIdentity,
      payload: { regularFiles: ["plugin.json"], payloadSha256: "sha256:6666666666666666666666666666666666666666666666666666666666666666" },
      profileIdentity: "claude-profile",
      expectedEffectIds: ["effect:claude"],
    },
    approval: {
      ...releaseApproval,
      issuer: "harness-journeys:claude",
      inspectedStateSha256:
        "sha256:397ec49639477d57894eea520280ac9691dc54dbbc5c8a45c54ab74c5efe96c7",
      expectedEffectsSha256:
        "sha256:ab481da5474cd171b88431b0bc95eb42ee3c16f077f9c331af33ce372cad415e",
      digest: "sha256:adaf2d0d8c1866d78479c03fc25677ed1a46017af0595c1dd9ab091aa257cb5c",
    },
  },
  codex: {
    command: "harness:codex:apply",
    request: {
      identity: admittedIdentity,
      payload: { regularFiles: ["plugin.json"], payloadSha256: "sha256:8888888888888888888888888888888888888888888888888888888888888888" },
      profileIdentity: "codex-profile",
      checkoutIdentity: "checkout-b",
      expectedEffectIds: ["effect:codex"],
    },
    approval: {
      ...releaseApproval,
      issuer: "harness-journeys:codex",
      inspectedStateSha256:
        "sha256:4a01bec4110a5e1a8eb7b89d81a440e9cfb2d1bc53d5879355d7b40b8adea195",
      expectedEffectsSha256:
        "sha256:70f7eee8841da88a3e731759ba6905b2ab5529d04474d2cab24ec33cce554e54",
      digest: "sha256:335943b90fced29a2da6c4dfba4d8de1cf6ede4a7377d9c94d6a12bafbb4f620",
    },
  },
  canary: {
    command: "canary:qualify",
    candidate: {
      identity: candidate,
      inertPayloadSha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
    authority: {} as never,
  },
} as const satisfies Record<string, MaintenanceApplyRequest>

export const literalHelpPreview: MaintenanceOutcome<CommandPreview> = {
  status: "ok",
  resultCode: "previewed",
  stationId: "help.previewed",
  value: {
    schemaVersion: 1,
    command: "help",
    effectClass: "inspect",
    expectedEffectIds: [],
    transactionState: "unchanged",
    retrySafety: "safe",
    nextAction: {
      id: "help.choose-command",
      action: "select_command",
      summary: "Choose one command from the sealed vocabulary.",
      commandId: null,
    },
    human: "Agent Plugin Kit maintenance commands\n",
    agent: canonicalLiteralHelpAgent,
    stderr: "",
  },
}

const literalHelpEnvelope = {
  schema_version: 1,
  status: "ok",
  run_id: "contract-help-literal",
  data: {
    contract_id: "agent-plugin-kit.maintenance-command-result",
    result_schema_version: 1,
    command: "help",
    result_code: "previewed",
    station_id: "help.previewed",
    effect_class: "inspect",
    transaction_state: "unchanged",
    retry_safety: "safe",
    expected_effect_ids: [],
    next_action: literalHelpPreview.value.nextAction,
    result: literalHelpPreview.value.agent,
  },
}

export const literalHelpProcess = {
  stdout: `${JSON.stringify(literalHelpEnvelope)}\n`,
  stderr: "",
  exitCode: 0,
} as const

export const literalUsageProcess = {
  stdout: "",
  stderr: `${JSON.stringify({
    record_type: "error_envelope",
    schema_version: 1,
    status: "error",
    message: "Unknown maintenance command.",
    run_id: "contract-help-literal",
    data: {
      contract_id: "agent-plugin-kit.maintenance-command-result",
      result_schema_version: 1,
      command: "maintenance",
      result_code: "usage-refused",
      station_id: "maintenance.usage-refused",
      transaction_state: "unchanged",
      retry_safety: "safe",
      next_action: {
        id: "maintenance.show-help",
        action: "change_input",
        summary: "Choose a command from machine discovery.",
        commandId: "help",
      },
    },
    error: {
      schemaVersion: 1,
      name: "MaintenanceCommandError",
      code: "usage-refused",
      action: "change_input",
      errorFamily: "input",
      hintVersion: 1,
      severity: "error",
      recoverability: "change_input",
      retryable: false,
      exitCodeHint: 2,
      failureClass: "usage",
      stationId: "maintenance.usage-refused",
      agentActions: [{
        nextActionId: "maintenance.show-help",
        action: "change_input",
        summary: "Choose a command from machine discovery.",
      }],
    },
  })}\n`,
  exitCode: 2,
} as const

export const literalPayloadResult: CommandResult = {
  schemaVersion: 1,
  command: "payload:materialize",
  transactionState: "completed",
  retrySafety: "safe",
  completedEffectIds: ["effect:payload-materialized"],
  remainingEffectIds: [],
  nextAction: {
    id: "payload-materialize.inspect-result",
    action: "inspect_state",
    summary: "Inspect the materialized Plugin Payload.",
    commandId: null,
  },
  human: "Plugin Payload materialized.\n",
  agent: {
    schemaVersion: 1,
    kind: "materialized",
    result: {
      kind: "materialized",
      candidate: literalPayloadCandidate,
      changedPaths: [],
      removedPaths: [],
      unchangedPaths: [],
      nextAction: "Inspect the payload.",
    },
  },
  stderr: "",
}

export const literalPayloadOutcome: MaintenanceOutcome<CommandResult> = {
  status: "ok",
  resultCode: "completed",
  stationId: "payload-materialize.completed",
  value: literalPayloadResult,
}
