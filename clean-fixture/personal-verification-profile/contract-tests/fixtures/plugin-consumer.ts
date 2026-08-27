export const expectedRootTypeExports = [
  "AdmissionBootstrap",
  "AdmissionRequest",
  "AdmissionResult",
  "AdmissionRefusal",
  "MaintenanceCommands",
  "MaintenanceCommand",
  "MutatingMaintenanceCommand",
  "MaintenanceApplyRequest",
  "CommandPreview",
  "CommandResult",
  "ResultCode",
  "StationId",
  "MaintenanceOutcome",
  "MaintenanceError",
  "QualificationEvidence",
  "VerificationProfile",
  "EvidenceCell",
  "QualificationResult",
  "RepositoryIdentity",
  "SourceIdentity",
  "ReleaseIdentity",
  "PackageIdentity",
  "WorkflowIdentity",
  "CandidateIdentity",
  "AdmittedIdentity",
] as const

export const expectedPublicSubpaths = [
  ".",
  "./admission-bootstrap",
  "./plugin-payload-production",
  "./runtime-custody",
  "./release-and-git-engine",
  "./maintenance-command-contract",
  "./harness-journeys",
  "./canary-qualification",
  "./qualification-evidence",
  "./reusable-workflow-adapter",
] as const

export const expectedSubpathTypeExports = {
  "./admission-bootstrap": ["AdmissionBootstrap", "AdmissionResult", "AdmissionRequest", "AdmissionRefusal"],
  "./plugin-payload-production": ["PluginPayloadProduction", "PayloadProductionRequest", "PayloadProductionResult", "PreparedPluginPayload"],
  "./runtime-custody": ["RuntimeCustodyCommand", "RuntimeCustodyResult"],
  "./release-and-git-engine": [
    "ReleaseAndGitEngine", "ReleaseRequest", "ReleaseMutationRequest", "ReleasePlan",
    "ReleaseResult", "ReleaseCandidateApproval", "AdmissionRequest", "AdmissionRefusal",
    "RepositoryIdentity", "SourceIdentity", "ReleaseIdentity", "PackageIdentity",
    "WorkflowIdentity", "CandidateIdentity", "AdmittedIdentity", "PackageObservation",
  ],
  "./maintenance-command-contract": [
    "MaintenanceCommands", "MaintenanceCommand", "MutatingMaintenanceCommand",
    "MaintenanceApplyRequest", "CommandPreview", "CommandResult",
    "ResultCode", "StationId", "MaintenanceOutcome", "MaintenanceError",
  ],
  "./harness-journeys": [
    "HarnessJourneys", "ClaudeRequest", "ClaudeInspection", "ClaudeTransitionRequest",
    "ClaudeTransitionApproval", "ClaudeApplyResult", "CodexRequest", "CodexInspection",
    "CodexTransitionRequest", "CodexTransitionApproval", "CodexApplyResult",
  ],
  "./canary-qualification": [
    "CanaryQualification", "CanaryCandidate", "CanaryPlan",
    "ProtectedCanaryAuthority", "CanaryResult",
  ],
  "./qualification-evidence": [
    "QualificationEvidence", "VerificationProfile", "EvidenceCell", "QualificationResult",
  ],
  "./reusable-workflow-adapter": [
    "ReusableWorkflowAdapter", "ReusableWorkflowRequest", "ReusableWorkflowResult",
  ],
} as const

export const expectedInstalledFiles = [
  "package.json",
  "src/interface.ts",
  "src/admission-bootstrap/interface.ts",
  "src/modules/plugin-payload-production/interface.ts",
  "src/modules/runtime-custody/interface.ts",
  "src/modules/release-and-git-engine/interface.ts",
  "src/modules/maintenance-command-contract/interface.ts",
  "src/modules/harness-journeys/interface.ts",
  "src/modules/canary-qualification/interface.ts",
  "src/modules/qualification-evidence/interface.ts",
  "src/adapters/reusable-workflow-adapter/interface.ts",
  "src/adapters/maintenance-command-facade/interface.ts",
  "src/adapters/maintenance-command-facade/maintenance.ts",
  "src/modules/maintenance-command-contract/command-vocabulary.ts",
  "src/modules/maintenance-command-contract/result-vocabulary.ts",
  "src/modules/maintenance-command-contract/branch-stations.ts",
] as const

export const fullCommitPin = "1111111111111111111111111111111111111111"

export const literalProcessResult = {
  stdout: "{\"schema_version\":1,\"status\":\"ok\",\"run_id\":\"contract-help-literal\",\"data\":{\"contract_id\":\"agent-plugin-kit.maintenance-command-result\",\"result_schema_version\":1,\"command\":\"help\",\"result_code\":\"previewed\",\"station_id\":\"help.previewed\",\"effect_class\":\"inspect\",\"transaction_state\":\"unchanged\",\"retry_safety\":\"safe\",\"expected_effect_ids\":[],\"next_action\":{\"id\":\"help.choose-command\",\"action\":\"select_command\",\"summary\":\"Choose one command from the sealed vocabulary.\"},\"result\":{\"schema_version\":1,\"contract_id\":\"agent-plugin-kit.maintenance-command-result\",\"package_identity\":\"agent-plugin-kit\",\"package_version\":\"0.0.0\",\"binary\":\"agent-plugin-kit\",\"versions\":{\"facade_envelope\":1,\"result\":1,\"error\":1,\"hint\":1,\"diagnostic\":1,\"event\":1},\"global_options\":[\"--json\",\"--quiet\",\"--verbose\",\"--debug\",\"--run-id <ID>\",\"--events <auto|off>\"],\"environment_dependencies\":[{\"name\":\"AGENT_PLUGIN_KIT_EVENT_ENDPOINT\",\"required\":false,\"secret\":false,\"accepted\":\"https-or-loopback-http-without-userinfo-query-fragment\"},{\"name\":\"AGENT_PLUGIN_KIT_EVENT_AUTH\",\"required\":false,\"secret\":true,\"accepted\":\"opaque-never-recorded\"}],\"commands\":[{\"route\":[\"help\"],\"command\":\"help\",\"interface_call\":\"inspect\",\"inputs\":[],\"stdin\":false,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"help\"],\"next_action_id\":\"help.choose-command\"},{\"route\":[\"payload\",\"check\"],\"command\":\"payload:check\",\"interface_call\":\"inspect\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"payload\",\"check\",\"--request\",\"<FILE>\"],\"next_action_id\":\"payload-check.inspect-result\"},{\"route\":[\"payload\",\"materialize\"],\"command\":\"payload:materialize\",\"interface_call\":\"apply\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"repository-local\",\"preview_route\":[\"payload\",\"check\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"payload\",\"materialize\",\"--request\",\"<FILE>\"],\"next_action_id\":\"payload-materialize.inspect-result\"},{\"route\":[\"payload\",\"package\"],\"command\":\"payload:package\",\"interface_call\":\"apply\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"repository-local\",\"preview_route\":[\"payload\",\"check\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"payload\",\"package\",\"--request\",\"<FILE>\"],\"next_action_id\":\"payload-package.inspect-result\"},{\"route\":[\"runtime\",\"repair\"],\"command\":\"runtime:repair\",\"interface_call\":\"inspect\",\"inputs\":[],\"stdin\":false,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"runtime\",\"repair\"],\"next_action_id\":\"runtime-repair.inspect-result\"},{\"route\":[\"runtime\",\"repair\",\"--apply\"],\"command\":\"runtime:repair-apply\",\"interface_call\":\"apply\",\"inputs\":[],\"stdin\":false,\"effect_class\":\"external\",\"preview_route\":[\"runtime\",\"repair\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"runtime\",\"repair\",\"--apply\"],\"next_action_id\":\"runtime-repair-apply.inspect-result\"},{\"route\":[\"release\",\"inspect\"],\"command\":\"release:inspect\",\"interface_call\":\"inspect\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"release\",\"inspect\",\"--request\",\"<FILE>\"],\"next_action_id\":\"release-inspect.review-preview\"},{\"route\":[\"release\",\"apply\"],\"command\":\"release:apply\",\"interface_call\":\"apply\",\"inputs\":[\"--request\",\"--approval\"],\"stdin\":true,\"effect_class\":\"external\",\"preview_route\":[\"release\",\"inspect\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"release\",\"apply\",\"--request\",\"<FILE>\",\"--approval\",\"<FILE>\"],\"next_action_id\":\"release-apply.inspect-result\"},{\"route\":[\"harness\",\"claude\",\"inspect\"],\"command\":\"harness:claude:inspect\",\"interface_call\":\"inspect\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"harness\",\"claude\",\"inspect\",\"--request\",\"<FILE>\"],\"next_action_id\":\"harness-claude-inspect.inspect-result\"},{\"route\":[\"harness\",\"claude\",\"apply\"],\"command\":\"harness:claude:apply\",\"interface_call\":\"apply\",\"inputs\":[\"--request\",\"--approval\"],\"stdin\":true,\"effect_class\":\"external\",\"preview_route\":[\"harness\",\"claude\",\"inspect\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"harness\",\"claude\",\"apply\",\"--request\",\"<FILE>\",\"--approval\",\"<FILE>\"],\"next_action_id\":\"harness-claude-apply.inspect-result\"},{\"route\":[\"harness\",\"codex\",\"inspect\"],\"command\":\"harness:codex:inspect\",\"interface_call\":\"inspect\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"harness\",\"codex\",\"inspect\",\"--request\",\"<FILE>\"],\"next_action_id\":\"harness-codex-inspect.inspect-result\"},{\"route\":[\"harness\",\"codex\",\"apply\"],\"command\":\"harness:codex:apply\",\"interface_call\":\"apply\",\"inputs\":[\"--request\",\"--approval\"],\"stdin\":true,\"effect_class\":\"external\",\"preview_route\":[\"harness\",\"codex\",\"inspect\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"harness\",\"codex\",\"apply\",\"--request\",\"<FILE>\",\"--approval\",\"<FILE>\"],\"next_action_id\":\"harness-codex-apply.inspect-result\"},{\"route\":[\"canary\",\"inspect\"],\"command\":\"canary:inspect\",\"interface_call\":\"inspect\",\"inputs\":[\"--candidate\"],\"stdin\":true,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"canary\",\"inspect\",\"--candidate\",\"<FILE>\"],\"next_action_id\":\"canary-inspect.inspect-result\"},{\"route\":[\"canary\",\"qualify\"],\"command\":\"canary:qualify\",\"interface_call\":\"apply\",\"inputs\":[\"--candidate\",\"--authority\"],\"stdin\":true,\"effect_class\":\"external\",\"preview_route\":[\"canary\",\"inspect\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"canary\",\"qualify\",\"--candidate\",\"<FILE>\",\"--authority\",\"<FILE>\"],\"next_action_id\":\"canary-qualify.inspect-result\"}],\"result_semantics\":{\"retry_safety\":[\"safe\",\"unsafe\",\"requires-fresh-inspection\"],\"transaction_state\":[\"unchanged\",\"completed\",\"partially-completed\",\"unknown\"],\"post_dispatch_refusals\":[\"command-refused\",\"retry-deferred\",\"continuation-required\",\"recovery-required\"]},\"exits\":{\"typed\":[{\"family_id\":\"accepted-success\",\"exit\":0,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"completed\",\"previewed\",\"runtime-repair-preview\",\"runtime-repair-unneeded\",\"runtime-repair-applied\"],\"envelope\":true,\"meaning\":\"success\"},{\"family_id\":\"typed-unexpected\",\"exit\":1,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"runtime-failed\",\"runtime-control-invalid\"],\"envelope\":true,\"meaning\":\"typed unexpected failure\"},{\"family_id\":\"usage-refusal\",\"exit\":2,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"usage-refused\",\"runtime-usage-refused\"],\"envelope\":true,\"meaning\":\"usage refusal\"},{\"family_id\":\"state-action-required\",\"exit\":20,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"continuation-required\",\"recovery-required\",\"runtime-bun-missing\",\"runtime-cache-root-unsafe\",\"runtime-repair-required\"],\"envelope\":true,\"meaning\":\"continuation or recovery required\"},{\"family_id\":\"command-refusal\",\"exit\":21,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"command-refused\",\"runtime-host-tool-missing\",\"runtime-not-executable\",\"runtime-unsupported-platform\"],\"envelope\":true,\"meaning\":\"command refused\"},{\"family_id\":\"transient-retry\",\"exit\":22,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"retry-deferred\",\"runtime-download-failed\",\"runtime-lock-held\"],\"envelope\":true,\"meaning\":\"retry deferred\"},{\"family_id\":\"integrity-or-input-refusal\",\"exit\":23,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"runtime-archive-hash-mismatch\",\"runtime-archive-member-ambiguous\",\"runtime-archive-member-missing\",\"runtime-archive-size-mismatch\",\"runtime-bundle-mismatch\",\"runtime-bundle-unmapped\",\"runtime-executable-hash-mismatch\",\"runtime-executable-size-mismatch\",\"runtime-executable-version-mismatch\",\"runtime-lock-invalid\",\"runtime-skill-unknown\",\"runtime-url-rejected\"],\"envelope\":true,\"meaning\":\"repair or input change required\"}],\"containment\":[{\"family_id\":\"emergency-containment\",\"exit\":1,\"owner\":\"root emergency writer\",\"result_codes\":[],\"envelope\":false,\"meaning\":\"last-resort process containment\"}]},\"next_actions\":[{\"id\":\"maintenance.contact-support\",\"action\":\"contact_support\",\"command_id\":null,\"failure_class\":\"unexpected\"},{\"id\":\"maintenance.show-help\",\"action\":\"change_input\",\"command_id\":\"help\",\"failure_class\":\"usage\"},{\"id\":\"runtime.inspect-usage\",\"action\":\"open_docs\",\"command_id\":\"help\",\"failure_class\":\"usage\"},{\"id\":\"maintenance.inspect-continuation\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"continuation\"},{\"id\":\"maintenance.inspect-recovery\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.install-admitted-bun\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.repair-cache-root\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.apply-repair\",\"action\":\"run_command\",\"command_id\":\"runtime:repair-apply\",\"failure_class\":\"recovery\"},{\"id\":\"maintenance.inspect-refusal\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"runtime.install-host-tool\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"runtime.repair-executable\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"runtime.select-supported-platform\",\"action\":\"change_input\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"maintenance.retry-command\",\"action\":\"retry\",\"command_id\":null,\"failure_class\":\"transient\"},{\"id\":\"runtime.retry-download\",\"action\":\"retry\",\"command_id\":null,\"failure_class\":\"transient\"},{\"id\":\"runtime.wait-for-lock\",\"action\":\"wait\",\"command_id\":null,\"failure_class\":\"transient\"},{\"id\":\"runtime.inspect-locked-archive\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.inspect-plugin-payload\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.inspect-locked-runtime\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.repair-lock\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.inspect-skill-catalog\",\"action\":\"change_input\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"runtime.inspect-locked-url\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"events.inspect-configuration\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"event_delivery\"}],\"privacy\":{\"argv_secret_values\":false,\"stdout\":\"machine-only\",\"diagnostics\":\"stderr\",\"events\":\"redacted-best-effort\",\"persisted_state\":false}}}}\n",
  stderr: "",
  exitCode: 0,
} as const
