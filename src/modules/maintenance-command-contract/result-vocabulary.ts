import type {
  EffectClass,
  FailureClass,
  MaintenanceAction,
  MaintenanceError,
  MaintenanceErrorFailureClass,
  NextAction,
  ResultCode,
  RetrySafety,
  TransactionState,
} from "./interface"

export const maintenanceCommandContractId =
  "agent-plugin-kit.maintenance-command-result" as const
export const resultSchemaVersion = 1 as const
export const errorSchemaVersion = 1 as const
export const hintVersion = 1 as const

export const actionVocabulary = [
  "change_input",
  "contact_support",
  "inspect_state",
  "open_docs",
  "repair_state",
  "retry",
  "run_command",
  "select_command",
  "wait",
] as const satisfies readonly MaintenanceError["action"][]

export const effectClassVocabulary = [
  "inspect",
  "repository-local",
  "external",
] as const satisfies readonly EffectClass[]

export const transactionStateVocabulary = [
  "unchanged",
  "completed",
  "partially-completed",
  "unknown",
] as const satisfies readonly TransactionState[]

export const retrySafetyVocabulary = [
  "safe",
  "unsafe",
  "requires-fresh-inspection",
] as const satisfies readonly RetrySafety[]

export const failureClassVocabulary = [
  "usage",
  "refusal",
  "transient",
  "continuation",
  "recovery",
  "unexpected",
  "event_delivery",
] as const satisfies readonly FailureClass[]

export const errorFamilyVocabulary = [
  "input",
  "state_conflict",
  "authentication",
  "authorization_scope",
  "network",
  "transient",
  "runtime",
] as const satisfies readonly MaintenanceError["errorFamily"][]

export const recoverabilityVocabulary = [
  "none",
  "retry",
  "change_input",
  "authenticate",
  "repair_state",
  "contact_support",
] as const satisfies readonly MaintenanceError["recoverability"][]

export const errorSeverityVocabulary = [
  "warning",
  "error",
  "fatal",
] as const satisfies readonly MaintenanceError["severity"][]

const vocabularyExhaustivenessChecks: [
  EffectClass extends (typeof effectClassVocabulary)[number] ? true : false,
  TransactionState extends (typeof transactionStateVocabulary)[number] ? true : false,
  RetrySafety extends (typeof retrySafetyVocabulary)[number] ? true : false,
  FailureClass extends (typeof failureClassVocabulary)[number] ? true : false,
  MaintenanceError["errorFamily"] extends (typeof errorFamilyVocabulary)[number] ? true : false,
  MaintenanceError["recoverability"] extends (typeof recoverabilityVocabulary)[number] ? true : false,
  MaintenanceError["severity"] extends (typeof errorSeverityVocabulary)[number] ? true : false,
  MaintenanceAction extends (typeof actionVocabulary)[number] ? true : false,
] = [true, true, true, true, true, true, true, true]

void vocabularyExhaustivenessChecks

type ExitFamilyId =
  | "accepted-success"
  | "typed-unexpected"
  | "usage-refusal"
  | "state-action-required"
  | "command-refusal"
  | "transient-retry"
  | "integrity-or-input-refusal"

type ResultDescriptor = {
  resultCode: ResultCode
  exitFamilyId: ExitFamilyId
  exitClass: 0 | 1 | 2 | 20 | 21 | 22 | 23
  failureClass: MaintenanceErrorFailureClass | null
  severity: "info" | "warning" | "error" | "fatal"
  retrySafety: RetrySafety
  transactionState: TransactionState
  nextAction: NextAction
}

export const failureClassPolicy = {
  usage: { errorFamily: "input", recoverability: "change_input" },
  refusal: { errorFamily: "authorization_scope", recoverability: "repair_state" },
  transient: { errorFamily: "transient", recoverability: "retry" },
  continuation: { errorFamily: "state_conflict", recoverability: "repair_state" },
  recovery: { errorFamily: "runtime", recoverability: "repair_state" },
  unexpected: { errorFamily: "runtime", recoverability: "contact_support" },
} as const satisfies Record<
  MaintenanceErrorFailureClass,
  Pick<MaintenanceError, "errorFamily" | "recoverability">
>

export const retrySafetyForEffectClass = (effectClass: EffectClass): RetrySafety =>
  effectClass === "inspect" || effectClass === "repository-local"
    ? "safe"
    : "requires-fresh-inspection"

const result = (
  resultCode: ResultCode,
  exitFamilyId: ExitFamilyId,
  exitClass: ResultDescriptor["exitClass"],
  failureClass: MaintenanceErrorFailureClass | null,
  nextAction: NextAction,
  options: Partial<Pick<ResultDescriptor, "severity" | "retrySafety" | "transactionState">> = {},
): ResultDescriptor => ({
  resultCode,
  exitFamilyId,
  exitClass,
  failureClass,
  severity: options.severity ?? (exitClass === 0 ? "info" : "error"),
  retrySafety: options.retrySafety ?? (exitClass === 0 ? "safe" : "requires-fresh-inspection"),
  transactionState: options.transactionState ?? "unchanged",
  nextAction,
})

const action = (
  id: string,
  nextAction: MaintenanceAction,
  summary: string,
  commandId: NextAction["commandId"] = null,
): NextAction => ({ id, action: nextAction, summary, commandId })

const contactSupport = action(
  "maintenance.contact-support",
  "contact_support",
  "Contact support with the redacted run identifier.",
)

export const resultVocabulary = [
  result(
    "completed",
    "accepted-success",
    0,
    null,
    action("maintenance.inspect-result", "inspect_state", "Inspect the completed result."),
    { transactionState: "completed" },
  ),
  result(
    "previewed",
    "accepted-success",
    0,
    null,
    action("maintenance.review-preview", "open_docs", "Review the preview before apply."),
  ),
  result(
    "runtime-repair-preview",
    "accepted-success",
    0,
    null,
    action(
      "runtime.review-repair-preview",
      "open_docs",
      "Review the Runtime Custody repair preview.",
    ),
  ),
  result(
    "runtime-repair-unneeded",
    "accepted-success",
    0,
    null,
    action("runtime.continue", "select_command", "Continue with another maintenance command."),
  ),
  result(
    "runtime-repair-applied",
    "accepted-success",
    0,
    null,
    action(
      "runtime.inspect-after-repair",
      "run_command",
      "Inspect Runtime Custody after repair.",
      "runtime:repair",
    ),
    { transactionState: "completed" },
  ),
  result("runtime-failed", "typed-unexpected", 1, "unexpected", contactSupport, {
    retrySafety: "unsafe",
    transactionState: "unknown",
  }),
  result("runtime-control-invalid", "typed-unexpected", 1, "unexpected", contactSupport, {
    retrySafety: "unsafe",
    transactionState: "unknown",
  }),
  result(
    "usage-refused",
    "usage-refusal",
    2,
    "usage",
    action(
      "maintenance.show-help",
      "change_input",
      "Choose a command from machine discovery.",
      "help",
    ),
    { retrySafety: "safe" },
  ),
  result(
    "runtime-usage-refused",
    "usage-refusal",
    2,
    "usage",
    action("runtime.inspect-usage", "open_docs", "Inspect Runtime Custody usage.", "help"),
    { retrySafety: "safe" },
  ),
  result(
    "continuation-required",
    "state-action-required",
    20,
    "continuation",
    action(
      "maintenance.inspect-continuation",
      "inspect_state",
      "Inspect completed and remaining effects before continuation.",
    ),
    { retrySafety: "unsafe", transactionState: "partially-completed" },
  ),
  result(
    "recovery-required",
    "state-action-required",
    20,
    "recovery",
    action(
      "maintenance.inspect-recovery",
      "inspect_state",
      "Inspect current state before recovery.",
    ),
    { retrySafety: "requires-fresh-inspection", transactionState: "unknown" },
  ),
  result(
    "runtime-bun-missing",
    "state-action-required",
    20,
    "recovery",
    action(
      "runtime.install-admitted-bun",
      "repair_state",
      "Install the admitted Bun runtime.",
    ),
  ),
  result(
    "runtime-cache-root-unsafe",
    "state-action-required",
    20,
    "recovery",
    action("runtime.repair-cache-root", "repair_state", "Repair the Runtime Custody cache root."),
  ),
  result(
    "runtime-repair-required",
    "state-action-required",
    20,
    "recovery",
    action("runtime.apply-repair", "run_command", "Apply the inspected repair.", "runtime:repair-apply"),
  ),
  result(
    "command-refused",
    "command-refusal",
    21,
    "refusal",
    action(
      "maintenance.inspect-refusal",
      "inspect_state",
      "Inspect the governing owner refusal.",
    ),
  ),
  result(
    "runtime-host-tool-missing",
    "command-refusal",
    21,
    "refusal",
    action("runtime.install-host-tool", "repair_state", "Install the required host tool."),
  ),
  result(
    "runtime-not-executable",
    "command-refusal",
    21,
    "refusal",
    action("runtime.repair-executable", "repair_state", "Repair the Runtime Custody executable."),
  ),
  result(
    "runtime-unsupported-platform",
    "command-refusal",
    21,
    "refusal",
    action(
      "runtime.select-supported-platform",
      "change_input",
      "Select a supported Runtime Custody platform.",
    ),
  ),
  result(
    "retry-deferred",
    "transient-retry",
    22,
    "transient",
    action("maintenance.retry-command", "retry", "Retry the same command after the bounded delay."),
    { retrySafety: "safe" },
  ),
  result(
    "runtime-download-failed",
    "transient-retry",
    22,
    "transient",
    action("runtime.retry-download", "retry", "Retry the Runtime Custody download."),
    { retrySafety: "safe" },
  ),
  result(
    "runtime-lock-held",
    "transient-retry",
    22,
    "transient",
    action("runtime.wait-for-lock", "wait", "Wait for the Runtime Custody lock."),
    { retrySafety: "safe" },
  ),
  result(
    "runtime-archive-hash-mismatch",
    "integrity-or-input-refusal",
    23,
    "recovery",
    action("runtime.inspect-locked-archive", "inspect_state", "Inspect the locked Runtime archive."),
  ),
  result(
    "runtime-archive-member-ambiguous",
    "integrity-or-input-refusal",
    23,
    "recovery",
    action("runtime.inspect-locked-archive", "inspect_state", "Inspect the locked Runtime archive."),
  ),
  result(
    "runtime-archive-member-missing",
    "integrity-or-input-refusal",
    23,
    "recovery",
    action("runtime.inspect-locked-archive", "inspect_state", "Inspect the locked Runtime archive."),
  ),
  result(
    "runtime-archive-size-mismatch",
    "integrity-or-input-refusal",
    23,
    "recovery",
    action("runtime.inspect-locked-archive", "inspect_state", "Inspect the locked Runtime archive."),
  ),
  result(
    "runtime-bundle-mismatch",
    "integrity-or-input-refusal",
    23,
    "recovery",
    action("runtime.inspect-plugin-payload", "inspect_state", "Inspect the Plugin Payload mapping."),
  ),
  result(
    "runtime-bundle-unmapped",
    "integrity-or-input-refusal",
    23,
    "recovery",
    action("runtime.inspect-plugin-payload", "inspect_state", "Inspect the Plugin Payload mapping."),
  ),
  result(
    "runtime-executable-hash-mismatch",
    "integrity-or-input-refusal",
    23,
    "recovery",
    action("runtime.inspect-locked-runtime", "inspect_state", "Inspect the locked Runtime executable."),
  ),
  result(
    "runtime-executable-size-mismatch",
    "integrity-or-input-refusal",
    23,
    "recovery",
    action("runtime.inspect-locked-runtime", "inspect_state", "Inspect the locked Runtime executable."),
  ),
  result(
    "runtime-executable-version-mismatch",
    "integrity-or-input-refusal",
    23,
    "recovery",
    action("runtime.inspect-locked-runtime", "inspect_state", "Inspect the locked Runtime executable."),
  ),
  result(
    "runtime-lock-invalid",
    "integrity-or-input-refusal",
    23,
    "recovery",
    action("runtime.repair-lock", "repair_state", "Repair the Runtime Custody lock."),
  ),
  result(
    "runtime-skill-unknown",
    "integrity-or-input-refusal",
    23,
    "refusal",
    action("runtime.inspect-skill-catalog", "change_input", "Inspect the Runtime skill catalog."),
  ),
  result(
    "runtime-url-rejected",
    "integrity-or-input-refusal",
    23,
    "refusal",
    action("runtime.inspect-locked-url", "inspect_state", "Inspect the locked Runtime URL."),
  ),
] as const satisfies readonly ResultDescriptor[]

export const exitFamilies = [
  {
    familyId: "accepted-success",
    exit: 0,
    owner: "Maintenance Command Contract",
    resultCodes: [
      "completed",
      "previewed",
      "runtime-repair-preview",
      "runtime-repair-unneeded",
      "runtime-repair-applied",
    ],
    envelope: true,
    meaning: "success",
  },
  {
    familyId: "typed-unexpected",
    exit: 1,
    owner: "Maintenance Command Contract",
    resultCodes: ["runtime-failed", "runtime-control-invalid"],
    envelope: true,
    meaning: "typed unexpected failure",
  },
  {
    familyId: "usage-refusal",
    exit: 2,
    owner: "Maintenance Command Contract",
    resultCodes: ["usage-refused", "runtime-usage-refused"],
    envelope: true,
    meaning: "usage refusal",
  },
  {
    familyId: "state-action-required",
    exit: 20,
    owner: "Maintenance Command Contract",
    resultCodes: [
      "continuation-required",
      "recovery-required",
      "runtime-bun-missing",
      "runtime-cache-root-unsafe",
      "runtime-repair-required",
    ],
    envelope: true,
    meaning: "continuation or recovery required",
  },
  {
    familyId: "command-refusal",
    exit: 21,
    owner: "Maintenance Command Contract",
    resultCodes: [
      "command-refused",
      "runtime-host-tool-missing",
      "runtime-not-executable",
      "runtime-unsupported-platform",
    ],
    envelope: true,
    meaning: "command refused",
  },
  {
    familyId: "transient-retry",
    exit: 22,
    owner: "Maintenance Command Contract",
    resultCodes: ["retry-deferred", "runtime-download-failed", "runtime-lock-held"],
    envelope: true,
    meaning: "retry deferred",
  },
  {
    familyId: "integrity-or-input-refusal",
    exit: 23,
    owner: "Maintenance Command Contract",
    resultCodes: [
      "runtime-archive-hash-mismatch",
      "runtime-archive-member-ambiguous",
      "runtime-archive-member-missing",
      "runtime-archive-size-mismatch",
      "runtime-bundle-mismatch",
      "runtime-bundle-unmapped",
      "runtime-executable-hash-mismatch",
      "runtime-executable-size-mismatch",
      "runtime-executable-version-mismatch",
      "runtime-lock-invalid",
      "runtime-skill-unknown",
      "runtime-url-rejected",
    ],
    envelope: true,
    meaning: "repair or input change required",
  },
] as const

export const containmentExit = {
  familyId: "emergency-containment",
  exit: 1,
  owner: "root emergency writer",
  resultCodes: [],
  envelope: false,
  meaning: "last-resort process containment",
} as const

const isFailureDescriptor = (
  descriptor: ResultDescriptor,
): descriptor is ResultDescriptor & { failureClass: MaintenanceErrorFailureClass } =>
  descriptor.exitClass !== 0 && descriptor.failureClass !== null

const failureActions = resultVocabulary
  .filter(isFailureDescriptor)
  .map((descriptor) => ({
    id: descriptor.nextAction.id,
    action: descriptor.nextAction.action,
    commandId: descriptor.nextAction.commandId ?? null,
    failureClass: descriptor.failureClass,
  }))

for (const [index, candidate] of failureActions.entries()) {
  const earlier = failureActions.find((row, rowIndex) => rowIndex < index && row.id === candidate.id)
  if (earlier && JSON.stringify(earlier) !== JSON.stringify(candidate)) {
    throw new Error(`conflicting Maintenance Next Action projection: ${candidate.id}`)
  }
}

type FailureNextAction = {
  id: string
  action: MaintenanceAction
  commandId: NextAction["commandId"]
  failureClass: FailureClass
}

export const failureNextActionProjection = [
  ...failureActions.filter(
    (candidate, index, all) => all.findIndex((row) => row.id === candidate.id) === index,
  ),
  {
    id: "events.inspect-configuration",
    action: "repair_state",
    commandId: null,
    failureClass: "event_delivery",
  },
] as const satisfies readonly FailureNextAction[]
