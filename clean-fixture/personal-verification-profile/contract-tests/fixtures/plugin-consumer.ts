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
] as const

export const fullCommitPin = "1111111111111111111111111111111111111111"

export const literalProcessResult = {
  stdout: '{"schemaVersion":1,"command":"help","exitClass":0}\n',
  stderr: "",
  exitCode: 0,
} as const
