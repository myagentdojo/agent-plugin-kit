export const expectedRootTypeExports = [
  "AdmissionBootstrap",
  "AdmissionResult",
  "AdmissionRefusal",
  "AdmissionRequest",
  "CommandPreview",
  "CommandResult",
  "MaintenanceError",
  "MaintenanceOutcome",
  "MaintenanceApplyRequest",
  "MaintenanceCommand",
  "MaintenanceCommands",
  "MutatingMaintenanceCommand",
  "ResultCode",
  "StationId",
  "EvidenceCell",
  "QualificationEvidence",
  "QualificationOutcome",
  "QualificationRefusal",
  "QualificationRefusalCode",
  "QualificationResult",
  "VerificationProfile",
  "AdmittedIdentity",
  "CandidateIdentity",
  "PackageIdentity",
  "ReleaseIdentity",
  "RepositoryIdentity",
  "SourceIdentity",
  "WorkflowIdentity",
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
  "./admission-bootstrap": ["AdmissionRefusal", "AdmissionRequest", "AdmissionResult", "AdmissionBootstrap"],
  "./plugin-payload-production": ["PayloadProductionRequest", "PreparedPluginPayload", "PayloadProductionResult", "PluginPayloadProduction"],
  "./runtime-custody": ["RuntimeCustodyCommand", "RuntimeCustodyResult"],
  "./release-and-git-engine": [
    "RepositoryIdentity", "SourceIdentity", "ReleaseIdentity", "PackageIdentity",
    "WorkflowIdentity", "CandidateIdentity", "AdmittedIdentity", "AdmissionRequest",
    "AdmissionRefusal", "PackageObservation", "ReleaseRequest", "ReleaseMutationRequest",
    "ReleasePlan", "ReleaseResult", "ReleaseCandidateApproval", "ReleaseAndGitEngine",
  ],
  "./maintenance-command-contract": [
    "EffectClass", "TransactionState", "RetrySafety", "MaintenanceAction", "FailureClass",
    "MaintenanceErrorFailureClass", "NextAction", "MaintenanceApplyRequest",
    "MutatingMaintenanceCommand", "MaintenanceCommand", "ResultCode", "StationId",
    "MaintenanceError", "MaintenanceOutcome", "JsonValue", "AgentPayload", "CommandPreview",
    "CommandResult", "MaintenanceSuccessEnvelopeData", "MaintenanceErrorEnvelopeDataCommon",
    "MaintenanceErrorEnvelopeData", "MaintenanceErrorEnvelopeProjection", "MaintenanceCommands",
  ],
  "./harness-journeys": [
    "ClaudeRequest", "CodexRequest", "ClaudeInspection", "CodexInspection",
    "ClaudeTransitionRequest", "CodexTransitionRequest", "ClaudeTransitionApproval",
    "CodexTransitionApproval", "ClaudeApplyResult", "CodexApplyResult", "HarnessJourneys",
  ],
  "./canary-qualification": [
    "CanaryCandidate", "CanaryPlan", "ProtectedCanaryAuthority", "CanaryResult",
    "CanaryQualification",
  ],
  "./qualification-evidence": [
    "EvidenceCell", "VerificationProfile", "QualificationResult", "QualificationRefusalCode",
    "QualificationRefusal", "QualificationOutcome", "QualificationEvidence",
  ],
  "./reusable-workflow-adapter": [
    "ReusableWorkflowRequest", "ReusableWorkflowResult", "ReusableWorkflowAdapter",
  ],
} as const

export const expectedSubpathRuntimeExports: Readonly<Record<string, readonly string[]>> = {
  ".": [],
  "./admission-bootstrap": ["admissionBootstrap"],
  "./plugin-payload-production": [],
  "./runtime-custody": [],
  "./release-and-git-engine": [],
  "./maintenance-command-contract": [],
  "./harness-journeys": [],
  "./canary-qualification": [],
  "./qualification-evidence": ["VerificationProfile", "qualificationEvidence"],
  "./reusable-workflow-adapter": [],
}

const fixtureReceiptDigest =
  "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const
type VerificationClaim = Extract<QualificationOutcome, { status: "reduced" }>["result"]["claims"][number]["claim"]

function provedClaim(
  claim: VerificationClaim,
  evidenceCellId: `cell:${string}`,
  actualProofLayer: "clean-fixture" | "public-process",
  receiptDigest: `sha256:${string}` = fixtureReceiptDigest,
) {
  return {
    claim,
    nonClaims: [],
    receiptDigests: [receiptDigest],
    evidenceCellIds: [evidenceCellId],
    status: "proved",
    actualProofLayer,
    observationKind: "observed",
    skipRationale: null,
  } as const
}

function skippedClaim(
  claim: VerificationClaim,
  evidenceCellId: `cell:${string}`,
  skipRationale: "hosted-proof-not-run" | "fresh-native-proof-not-run",
) {
  return {
    claim,
    nonClaims: [claim],
    receiptDigests: [],
    evidenceCellIds: [evidenceCellId],
    status: "unknown",
    unknownKind: "skip",
    actualProofLayer: null,
    observationKind: null,
    skipRationale,
  } as const
}

export function expectedPersonalQualification(
  candidate: CandidateIdentity,
  installedBytesSha256: `sha256:${string}`,
): QualificationOutcome {
  return {
    status: "reduced",
    result: {
      schemaVersion: 1,
      candidate,
      profileId: "personal",
      claims: [
        provedClaim("kit.identity.admitted", "cell:personal-admitted", "clean-fixture"),
        provedClaim("kit.command.invoked", "cell:personal-command", "clean-fixture"),
        provedClaim("kit.package.full-commit-pin", "cell:personal-package", "clean-fixture"),
        provedClaim("kit.workflow.full-commit-pin", "cell:personal-workflow", "clean-fixture"),
        provedClaim("plugin-payload.installed", "cell:personal-payload", "clean-fixture", installedBytesSha256),
        provedClaim("runtime.supported-platform", "cell:personal-runtime", "public-process"),
        skippedClaim("harness.claude.fresh-native", "cell:personal-claude", "fresh-native-proof-not-run"),
        skippedClaim("harness.codex.fresh-native", "cell:personal-codex", "fresh-native-proof-not-run"),
      ],
      counts: { selected: 8, covered: 6, skipped: 2, proved: 6, notProved: 0, unknown: 0 },
      nonClaims: ["harness.claude.fresh-native", "harness.codex.fresh-native"],
      receiptDigests: [fixtureReceiptDigest, installedBytesSha256],
    },
  }
}

export function expectedPublicQualification(candidate: CandidateIdentity): QualificationOutcome {
  return {
    status: "reduced",
    result: {
      schemaVersion: 1,
      candidate,
      profileId: "public",
      claims: [
        provedClaim("kit.identity.admitted", "cell:public-admitted", "clean-fixture"),
        provedClaim("kit.command.invoked", "cell:public-command", "clean-fixture"),
        provedClaim("kit.package.full-commit-pin", "cell:public-package", "clean-fixture"),
        provedClaim("kit.workflow.full-commit-pin", "cell:public-workflow", "clean-fixture"),
        skippedClaim("plugin-payload.installed", "cell:public-payload", "hosted-proof-not-run"),
        skippedClaim("runtime.supported-platform", "cell:public-runtime", "hosted-proof-not-run"),
        skippedClaim("release.identity.published", "cell:public-release", "hosted-proof-not-run"),
        skippedClaim("workflow.called-revision", "cell:public-workflow-call", "hosted-proof-not-run"),
        skippedClaim("canary.hosted-qualified", "cell:public-canary", "hosted-proof-not-run"),
        skippedClaim("harness.claude.fresh-native", "cell:public-claude", "fresh-native-proof-not-run"),
        skippedClaim("harness.codex.fresh-native", "cell:public-codex", "fresh-native-proof-not-run"),
      ],
      counts: { selected: 11, covered: 4, skipped: 7, proved: 4, notProved: 0, unknown: 0 },
      nonClaims: [
        "plugin-payload.installed",
        "runtime.supported-platform",
        "release.identity.published",
        "workflow.called-revision",
        "canary.hosted-qualified",
        "harness.claude.fresh-native",
        "harness.codex.fresh-native",
      ],
      receiptDigests: [fixtureReceiptDigest],
    },
  }
}

export const expectedInstalledFiles = [
  ".agents/skills/fallow/SKILL.md",
  ".agents/skills/fallow/agents/openai.yaml",
  ".bun-tag",
  ".claude/skills/fallow/SKILL.md",
  ".claude/skills/fallow/agents/openai.yaml",
  ".coderabbit.yaml",
  ".fallowrc.json",
  ".gitignore",
  ".vscode/settings.json",
  "AGENTS.md",
  "CODING_STANDARDS.md",
  "CONTEXT-MAP.md",
  "CONTEXT.md",
  "README.md",
  "biome.jsonc",
  "bun.lock",
  "bunfig.toml",
  "clean-fixture/audit-maintenance-cli.ts",
  "clean-fixture/personal-verification-profile/contract-tests/adapters/admission-source-projection.ts",
  "clean-fixture/personal-verification-profile/contract-tests/adapters/contract-subjects.ts",
  "clean-fixture/personal-verification-profile/contract-tests/adapters/installed-foundation-contract-subject.ts",
  "clean-fixture/personal-verification-profile/contract-tests/adapters/maintenance-cli-contract-subjects.ts",
  "clean-fixture/personal-verification-profile/contract-tests/admission-and-invocation.test.ts",
  "clean-fixture/personal-verification-profile/contract-tests/fixtures/admission-consumer.ts",
  "clean-fixture/personal-verification-profile/contract-tests/fixtures/admission-invariant-cases.ts",
  "clean-fixture/personal-verification-profile/contract-tests/fixtures/admission-package-projection.json",
  "clean-fixture/personal-verification-profile/contract-tests/fixtures/maintenance-cli-process-scenarios.ts",
  "clean-fixture/personal-verification-profile/contract-tests/fixtures/plugin-consumer.ts",
  "clean-fixture/personal-verification-profile/contract-tests/fixtures/profile-cells.ts",
  "clean-fixture/personal-verification-profile/contract-tests/fresh-native-non-claims.test.ts",
  "clean-fixture/personal-verification-profile/contract-tests/installation-evidence.test.ts",
  "clean-fixture/personal-verification-profile/contract-tests/maintenance-cli-local-link.test.ts",
  "clean-fixture/personal-verification-profile/contract-tests/maintenance-cli.test.ts",
  "clean-fixture/personal-verification-profile/contract-tests/package-export-catalog.test.ts",
  "clean-fixture/public-verification-profile/contract-tests/profile-non-promotion.test.ts",
  "clean-fixture/verify-maintenance-cli-local-link.ts",
  "docs/adr/0001-language-to-topology.md",
  "docs/adr/0002-owner-manifests-and-dependency-locality.md",
  "docs/adr/0003-repository-quality-and-verification-transition.md",
  "docs/adr/0004-public-serialized-validation-and-logical-record-correlation.md",
  "docs/adr/0005-simple-repository-quality-ownership.md",
  "docs/adr/0006-qualification-evidence-public-runtime.md",
  "docs/agents/README.md",
  "docs/agents/biome.md",
  "docs/agents/domain.md",
  "docs/agents/fallow.md",
  "docs/agents/issue-tracker.md",
  "docs/agents/triage-labels.md",
  "package.json",
  "src/adapters/maintenance-command-facade/contract-tests/adapters/diagnostic-recording-adapter.ts",
  "src/adapters/maintenance-command-facade/contract-tests/adapters/event-recording-adapter.ts",
  "src/adapters/maintenance-command-facade/contract-tests/adapters/maintenance-commands-recording-adapter.ts",
  "src/adapters/maintenance-command-facade/contract-tests/adapters/public-process-adapter.ts",
  "src/adapters/maintenance-command-facade/contract-tests/command-surface.test.ts",
  "src/adapters/maintenance-command-facade/contract-tests/fixtures/literal-cli-scenarios.ts",
  "src/adapters/maintenance-command-facade/contract-tests/fixtures/literal-observability-cases.ts",
  "src/adapters/maintenance-command-facade/contract-tests/observability.test.ts",
  "src/adapters/maintenance-command-facade/contract-tests/public-process.test.ts",
  "src/adapters/maintenance-command-facade/implementation/logtape-diagnostic-adapter.ts",
  "src/adapters/maintenance-command-facade/implementation/maintenance-command-facade.ts",
  "src/adapters/maintenance-command-facade/implementation/maintenance-event-adapter.ts",
  "src/adapters/maintenance-command-facade/interface.ts",
  "src/adapters/maintenance-command-facade/maintenance.ts",
  "src/adapters/maintenance-command-facade/package.json",
  "src/adapters/maintenance-command-facade/serialized-values.ts",
  "src/adapters/reusable-workflow-adapter/interface.ts",
  "src/adapters/reusable-workflow-adapter/package.json",
  "src/admission-bootstrap/contract-tests/adapters/admission-contract-harness.ts",
  "src/admission-bootstrap/contract-tests/admitted-identity-before-execution.test.ts",
  "src/admission-bootstrap/contract-tests/identity-refusal.test.ts",
  "src/admission-bootstrap/implementation/admission-bootstrap.ts",
  "src/admission-bootstrap/interface.ts",
  "src/admission-bootstrap/package.json",
  "src/interface.ts",
  "src/modules/canary-qualification/interface.ts",
  "src/modules/canary-qualification/package.json",
  "src/modules/harness-journeys/interface.ts",
  "src/modules/harness-journeys/package.json",
  "src/modules/maintenance-command-contract/branch-stations.ts",
  "src/modules/maintenance-command-contract/command-vocabulary.ts",
  "src/modules/maintenance-command-contract/contract-tests/adapters/mutation-recording-module-adapter.ts",
  "src/modules/maintenance-command-contract/contract-tests/adapters/public-process-adapter.ts",
  "src/modules/maintenance-command-contract/contract-tests/branch-station-catalog.test.ts",
  "src/modules/maintenance-command-contract/contract-tests/effect-class-and-retry-safety.test.ts",
  "src/modules/maintenance-command-contract/contract-tests/fixtures/approval-digest-vectors.ts",
  "src/modules/maintenance-command-contract/contract-tests/fixtures/literal-branch-stations.ts",
  "src/modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results.ts",
  "src/modules/maintenance-command-contract/contract-tests/human-and-agent-result-vocabulary.test.ts",
  "src/modules/maintenance-command-contract/implementation/maintenance-commands.ts",
  "src/modules/maintenance-command-contract/interface.ts",
  "src/modules/maintenance-command-contract/package.json",
  "src/modules/maintenance-command-contract/result-vocabulary.ts",
  "src/modules/maintenance-command-contract/serialized-values.ts",
  "src/modules/plugin-payload-production/interface.ts",
  "src/modules/plugin-payload-production/package.json",
  "src/modules/qualification-evidence/contract-tests/candidate-lineage-reduction.test.ts",
  "src/modules/qualification-evidence/contract-tests/fixtures/evidence-cells.ts",
  "src/modules/qualification-evidence/contract-tests/proof-layer-and-non-claim.test.ts",
  "src/modules/qualification-evidence/implementation/qualification-evidence.ts",
  "src/modules/qualification-evidence/interface.ts",
  "src/modules/qualification-evidence/package.json",
  "src/modules/qualification-evidence/serialized-values.ts",
  "src/modules/release-and-git-engine/interface.ts",
  "src/modules/release-and-git-engine/package.json",
  "src/modules/release-and-git-engine/serialized-values.ts",
  "src/modules/runtime-custody/interface.ts",
  "src/modules/runtime-custody/package.json",
  "tooling/repository-quality/contract-tests/biome-policy.test.ts",
  "tooling/repository-quality/contract-tests/fallow-native.test.ts",
  "tooling/repository-quality/contract-tests/repository-verification.test.ts",
  "tooling/repository-quality/repository-verification.ts",
  "tooling/repository-quality/verify-repository.ts",
  "tsconfig.json",
] as const

export const expectedDependencyFreeHelpRuntimeTrace = [
  "external:zod",
  "src/adapters/maintenance-command-facade/implementation/maintenance-command-facade.ts",
  "src/adapters/maintenance-command-facade/maintenance.ts",
  "src/adapters/maintenance-command-facade/serialized-values.ts",
  "src/modules/maintenance-command-contract/branch-stations.ts",
  "src/modules/maintenance-command-contract/command-vocabulary.ts",
  "src/modules/maintenance-command-contract/implementation/maintenance-commands.ts",
  "src/modules/maintenance-command-contract/result-vocabulary.ts",
  "src/modules/maintenance-command-contract/serialized-values.ts",
] as const

export const expectedBranchStationSourceSha256 =
  "sha256:1e7e52f12c91f2022f6d70a03ac5dcb4b8471621c4e0173b94fbf26ddeb97a37" as const

const legacyLiteralProcessResult = {
  stdout: "{\"schema_version\":1,\"status\":\"ok\",\"run_id\":\"contract-help-literal\",\"data\":{\"contract_id\":\"agent-plugin-kit.maintenance-command-result\",\"result_schema_version\":1,\"command\":\"help\",\"result_code\":\"previewed\",\"station_id\":\"help.previewed\",\"effect_class\":\"inspect\",\"transaction_state\":\"unchanged\",\"retry_safety\":\"safe\",\"expected_effect_ids\":[],\"next_action\":{\"id\":\"help.choose-command\",\"action\":\"select_command\",\"summary\":\"Choose one command from the sealed vocabulary.\"},\"result\":{\"schema_version\":1,\"contract_id\":\"agent-plugin-kit.maintenance-command-result\",\"package_identity\":\"agent-plugin-kit\",\"package_version\":\"0.0.0\",\"binary\":\"agent-plugin-kit\",\"versions\":{\"facade_envelope\":1,\"result\":1,\"error\":1,\"hint\":1,\"diagnostic\":2,\"event\":1},\"global_options\":[\"--json\",\"--quiet\",\"--verbose\",\"--debug\",\"--run-id <ID>\",\"--events <auto|off>\"],\"environment_dependencies\":[{\"name\":\"AGENT_PLUGIN_KIT_EVENT_ENDPOINT\",\"required\":false,\"secret\":false,\"accepted\":\"https-or-loopback-http-without-userinfo-query-fragment\"},{\"name\":\"AGENT_PLUGIN_KIT_EVENT_AUTH\",\"required\":false,\"secret\":true,\"accepted\":\"opaque-never-recorded\"}],\"commands\":[{\"route\":[\"help\"],\"command\":\"help\",\"interface_call\":\"inspect\",\"inputs\":[],\"stdin\":false,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"help\"],\"next_action_id\":\"help.choose-command\"},{\"route\":[\"payload\",\"check\"],\"command\":\"payload:check\",\"interface_call\":\"inspect\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"payload\",\"check\",\"--request\",\"<FILE>\"],\"next_action_id\":\"payload-check.inspect-result\"},{\"route\":[\"payload\",\"materialize\"],\"command\":\"payload:materialize\",\"interface_call\":\"apply\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"repository-local\",\"preview_route\":[\"payload\",\"check\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"payload\",\"materialize\",\"--request\",\"<FILE>\"],\"next_action_id\":\"payload-materialize.inspect-result\"},{\"route\":[\"payload\",\"package\"],\"command\":\"payload:package\",\"interface_call\":\"apply\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"repository-local\",\"preview_route\":[\"payload\",\"check\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"payload\",\"package\",\"--request\",\"<FILE>\"],\"next_action_id\":\"payload-package.inspect-result\"},{\"route\":[\"runtime\",\"repair\"],\"command\":\"runtime:repair\",\"interface_call\":\"inspect\",\"inputs\":[],\"stdin\":false,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"runtime\",\"repair\"],\"next_action_id\":\"runtime-repair.inspect-result\"},{\"route\":[\"runtime\",\"repair\",\"--apply\"],\"command\":\"runtime:repair-apply\",\"interface_call\":\"apply\",\"inputs\":[],\"stdin\":false,\"effect_class\":\"external\",\"preview_route\":[\"runtime\",\"repair\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"runtime\",\"repair\",\"--apply\"],\"next_action_id\":\"runtime-repair-apply.inspect-result\"},{\"route\":[\"release\",\"inspect\"],\"command\":\"release:inspect\",\"interface_call\":\"inspect\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"release\",\"inspect\",\"--request\",\"<FILE>\"],\"next_action_id\":\"release-inspect.review-preview\"},{\"route\":[\"release\",\"apply\"],\"command\":\"release:apply\",\"interface_call\":\"apply\",\"inputs\":[\"--request\",\"--approval\"],\"stdin\":true,\"effect_class\":\"external\",\"preview_route\":[\"release\",\"inspect\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"release\",\"apply\",\"--request\",\"<FILE>\",\"--approval\",\"<FILE>\"],\"next_action_id\":\"release-apply.inspect-result\"},{\"route\":[\"harness\",\"claude\",\"inspect\"],\"command\":\"harness:claude:inspect\",\"interface_call\":\"inspect\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"harness\",\"claude\",\"inspect\",\"--request\",\"<FILE>\"],\"next_action_id\":\"harness-claude-inspect.inspect-result\"},{\"route\":[\"harness\",\"claude\",\"apply\"],\"command\":\"harness:claude:apply\",\"interface_call\":\"apply\",\"inputs\":[\"--request\",\"--approval\"],\"stdin\":true,\"effect_class\":\"external\",\"preview_route\":[\"harness\",\"claude\",\"inspect\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"harness\",\"claude\",\"apply\",\"--request\",\"<FILE>\",\"--approval\",\"<FILE>\"],\"next_action_id\":\"harness-claude-apply.inspect-result\"},{\"route\":[\"harness\",\"codex\",\"inspect\"],\"command\":\"harness:codex:inspect\",\"interface_call\":\"inspect\",\"inputs\":[\"--request\"],\"stdin\":true,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"harness\",\"codex\",\"inspect\",\"--request\",\"<FILE>\"],\"next_action_id\":\"harness-codex-inspect.inspect-result\"},{\"route\":[\"harness\",\"codex\",\"apply\"],\"command\":\"harness:codex:apply\",\"interface_call\":\"apply\",\"inputs\":[\"--request\",\"--approval\"],\"stdin\":true,\"effect_class\":\"external\",\"preview_route\":[\"harness\",\"codex\",\"inspect\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"harness\",\"codex\",\"apply\",\"--request\",\"<FILE>\",\"--approval\",\"<FILE>\"],\"next_action_id\":\"harness-codex-apply.inspect-result\"},{\"route\":[\"canary\",\"inspect\"],\"command\":\"canary:inspect\",\"interface_call\":\"inspect\",\"inputs\":[\"--candidate\"],\"stdin\":true,\"effect_class\":\"inspect\",\"preview_route\":null,\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"canary\",\"inspect\",\"--candidate\",\"<FILE>\"],\"next_action_id\":\"canary-inspect.inspect-result\"},{\"route\":[\"canary\",\"qualify\"],\"command\":\"canary:qualify\",\"interface_call\":\"apply\",\"inputs\":[\"--candidate\",\"--authority\"],\"stdin\":true,\"effect_class\":\"external\",\"preview_route\":[\"canary\",\"inspect\"],\"example\":[\"maintenance\",\"--run-id\",\"contract-help-literal\",\"canary\",\"qualify\",\"--candidate\",\"<FILE>\",\"--authority\",\"<FILE>\"],\"next_action_id\":\"canary-qualify.inspect-result\"}],\"result_semantics\":{\"retry_safety\":[\"safe\",\"unsafe\",\"requires-fresh-inspection\"],\"transaction_state\":[\"unchanged\",\"completed\",\"partially-completed\",\"unknown\"],\"post_dispatch_refusals\":[\"command-refused\",\"retry-deferred\",\"continuation-required\",\"recovery-required\"]},\"exits\":{\"typed\":[{\"family_id\":\"accepted-success\",\"exit\":0,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"completed\",\"previewed\",\"runtime-repair-preview\",\"runtime-repair-unneeded\",\"runtime-repair-applied\"],\"envelope\":true,\"meaning\":\"success\"},{\"family_id\":\"typed-unexpected\",\"exit\":1,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"runtime-failed\",\"runtime-control-invalid\"],\"envelope\":true,\"meaning\":\"typed unexpected failure\"},{\"family_id\":\"usage-refusal\",\"exit\":2,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"usage-refused\",\"runtime-usage-refused\"],\"envelope\":true,\"meaning\":\"usage refusal\"},{\"family_id\":\"state-action-required\",\"exit\":20,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"continuation-required\",\"recovery-required\",\"runtime-bun-missing\",\"runtime-cache-root-unsafe\",\"runtime-repair-required\"],\"envelope\":true,\"meaning\":\"continuation or recovery required\"},{\"family_id\":\"command-refusal\",\"exit\":21,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"command-refused\",\"runtime-host-tool-missing\",\"runtime-not-executable\",\"runtime-unsupported-platform\"],\"envelope\":true,\"meaning\":\"command refused\"},{\"family_id\":\"transient-retry\",\"exit\":22,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"retry-deferred\",\"runtime-download-failed\",\"runtime-lock-held\"],\"envelope\":true,\"meaning\":\"retry deferred\"},{\"family_id\":\"integrity-or-input-refusal\",\"exit\":23,\"owner\":\"Maintenance Command Contract\",\"result_codes\":[\"runtime-archive-hash-mismatch\",\"runtime-archive-member-ambiguous\",\"runtime-archive-member-missing\",\"runtime-archive-size-mismatch\",\"runtime-bundle-mismatch\",\"runtime-bundle-unmapped\",\"runtime-executable-hash-mismatch\",\"runtime-executable-size-mismatch\",\"runtime-executable-version-mismatch\",\"runtime-lock-invalid\",\"runtime-skill-unknown\",\"runtime-url-rejected\"],\"envelope\":true,\"meaning\":\"repair or input change required\"}],\"containment\":[{\"family_id\":\"emergency-containment\",\"exit\":1,\"owner\":\"root emergency writer\",\"result_codes\":[],\"envelope\":false,\"meaning\":\"last-resort process containment\"}]},\"next_actions\":[{\"id\":\"maintenance.contact-support\",\"action\":\"contact_support\",\"command_id\":null,\"failure_class\":\"unexpected\"},{\"id\":\"maintenance.show-help\",\"action\":\"change_input\",\"command_id\":\"help\",\"failure_class\":\"usage\"},{\"id\":\"runtime.inspect-usage\",\"action\":\"open_docs\",\"command_id\":\"help\",\"failure_class\":\"usage\"},{\"id\":\"maintenance.inspect-continuation\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"continuation\"},{\"id\":\"maintenance.inspect-recovery\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.install-admitted-bun\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.repair-cache-root\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.apply-repair\",\"action\":\"run_command\",\"command_id\":\"runtime:repair-apply\",\"failure_class\":\"recovery\"},{\"id\":\"maintenance.inspect-refusal\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"runtime.install-host-tool\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"runtime.repair-executable\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"runtime.select-supported-platform\",\"action\":\"change_input\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"maintenance.retry-command\",\"action\":\"retry\",\"command_id\":null,\"failure_class\":\"transient\"},{\"id\":\"runtime.retry-download\",\"action\":\"retry\",\"command_id\":null,\"failure_class\":\"transient\"},{\"id\":\"runtime.wait-for-lock\",\"action\":\"wait\",\"command_id\":null,\"failure_class\":\"transient\"},{\"id\":\"runtime.inspect-locked-archive\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.inspect-plugin-payload\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.inspect-locked-runtime\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.repair-lock\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"recovery\"},{\"id\":\"runtime.inspect-skill-catalog\",\"action\":\"change_input\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"runtime.inspect-locked-url\",\"action\":\"inspect_state\",\"command_id\":null,\"failure_class\":\"refusal\"},{\"id\":\"events.inspect-configuration\",\"action\":\"repair_state\",\"command_id\":null,\"failure_class\":\"event_delivery\"}],\"privacy\":{\"argv_secret_values\":false,\"stdout\":\"machine-only\",\"diagnostics\":\"stderr\",\"events\":\"redacted-best-effort\",\"persisted_state\":false}}}}\n",
  stderr: "",
  exitCode: 0,
} as const

const expectedHelpEnvelope = JSON.parse(legacyLiteralProcessResult.stdout) as {
  data: {
    next_action: Readonly<Record<string, unknown>>
    result: Readonly<Record<string, unknown>>
  }
}
const { schema_version: resultSchemaVersion, ...expectedHelpResult } = expectedHelpEnvelope.data.result as
  Readonly<Record<string, unknown>> & { schema_version: number }
expectedHelpEnvelope.data.next_action = { ...expectedHelpEnvelope.data.next_action, commandId: null }
expectedHelpEnvelope.data.result = { ...expectedHelpResult, schemaVersion: resultSchemaVersion }

export const literalProcessResult = {
  stdout: `${JSON.stringify(expectedHelpEnvelope)}\n`,
  stderr: "",
  exitCode: 0,
} as const
import type { QualificationOutcome } from "agent-plugin-kit/qualification-evidence"
import type { CandidateIdentity } from "agent-plugin-kit/release-and-git-engine"
