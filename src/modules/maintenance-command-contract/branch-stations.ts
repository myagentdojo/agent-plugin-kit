import type {
  CommandPreview,
  MaintenanceCommand,
  MaintenanceError,
  ResultCode,
  StationId,
} from "./interface"
import { resultVocabulary } from "./result-vocabulary"

type FailureClass = MaintenanceError["failureClass"]
type RetrySafety = CommandPreview["retrySafety"]
type TransactionState = CommandPreview["transactionState"]

export type BranchKind =
  | "execution"
  | "usage"
  | "refusal"
  | "retry"
  | "continuation"
  | "recovery"
  | "unexpected"

export type StationReachability = "required" | "stage-deferred" | "declared-unreachable"

export type BranchStation = {
  stationId: StationId
  commandId: MaintenanceCommand["command"] | "maintenance"
  classification: "success" | "failure"
  branchKind: BranchKind
  precondition: string
  independentObservable: string
  expectedResultCode: ResultCode
  expectedExitClass: 0 | 1 | 2 | 20 | 21 | 22 | 23
  expectedEnvelopeStatus: "ok" | "error"
  expectedRetrySafety: RetrySafety
  expectedTransactionState: TransactionState
  controllingOwnerId:
    | "maintenance-command-contract"
    | "maintenance-command-facade"
    | "plugin-payload-production"
    | "runtime-custody"
    | "release-and-git-engine"
    | "harness-journeys"
    | "canary-qualification"
  owningStage: "P3" | "P4" | "P5" | "P6" | "P7" | "P9"
  reachability: StationReachability
  skipRationale: string | null
  governingInterface: string
  expectedNextActionId: string
  repairRouteCommandId: MaintenanceCommand["command"] | null
  mutationExpectation:
    | { kind: "none" }
    | { kind: "preview"; expectedEffectIds: readonly string[] }
    | {
        kind: "result"
        completedEffectIds: readonly string[]
        remainingEffectIds: readonly string[]
      }
}

export type StageDeferredOwnerStageKey =
  | "plugin-payload-production@P4"
  | "runtime-custody@P5"
  | "release-and-git-engine@P6"
  | "harness-journeys@P7"
  | "canary-qualification@P9"

export type StageDeferredRecord = {
  ownerStage: StageDeferredOwnerStageKey
  stationIds: readonly StationId[]
  futureSelector: string
  expectedTestCount: number
  skipRationale: string
  nonClaim: string
}

export type BranchStationEvidence = {
  stationId: StationId
  status: "covered" | "missing" | "drifted" | "skipped"
  provenance: "real_process" | "synthetic"
  observedResultCode?: ResultCode
  observedExitClass?: number
  skipRationale?: string
}

export type StationMap = {
  commandContractId: "agent-plugin-kit.maintenance-command-result"
  commandContractSchemaVersion: 1
  declaredBranchCoverage: number
  stageDeferredBranchCoverage: number
  declaredUnreachableBranchCoverage: number
  requiredObservedBranchTotal: number
  observedBranchCoverage: number
  stations: readonly BranchStationEvidence[]
}

export type StationMapProjector = (
  catalog: readonly BranchStation[],
  evidence: readonly BranchStationEvidence[],
) => StationMap

export const projectStationMap: StationMapProjector | undefined = undefined

const inspectFailures = [
  "command-refused",
  "retry-deferred",
  "recovery-required",
  "runtime-failed",
] as const satisfies readonly ResultCode[]

const applyFailures = [
  "command-refused",
  "retry-deferred",
  "continuation-required",
  "recovery-required",
  "runtime-failed",
] as const satisfies readonly ResultCode[]

export const runtimeControlResultCodes = [
  "runtime-usage-refused",
  "runtime-bun-missing",
  "runtime-cache-root-unsafe",
  "runtime-repair-required",
  "runtime-host-tool-missing",
  "runtime-not-executable",
  "runtime-unsupported-platform",
  "runtime-download-failed",
  "runtime-lock-held",
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
  "runtime-control-invalid",
] as const satisfies readonly ResultCode[]

const descriptorFor = (resultCode: ResultCode) => {
  const descriptor = resultVocabulary.find((candidate) => candidate.resultCode === resultCode)
  if (descriptor === undefined) throw new Error(`missing Result Vocabulary row ${resultCode}`)
  return descriptor
}

const branchKindFor = (failureClass: FailureClass | null): BranchKind => {
  if (failureClass === null) return "execution"
  if (failureClass === "transient") return "retry"
  return failureClass
}

const station = (input: {
  commandId: BranchStation["commandId"]
  resultCode: ResultCode
  controllingOwnerId: BranchStation["controllingOwnerId"]
  owningStage: BranchStation["owningStage"]
  reachability: StationReachability
  skipRationale?: string
  governingInterface: string
  nextActionId?: string
  repairRouteCommandId?: MaintenanceCommand["command"] | null
  precondition?: string
}): BranchStation => {
  const descriptor = descriptorFor(input.resultCode)
  const commandSlug = input.commandId === "maintenance" ? "maintenance" : input.commandId.replaceAll(":", "-")
  const stationId = `${commandSlug}.${input.resultCode}` as StationId
  const classification = descriptor.exitClass === 0 ? "success" : "failure"
  const inspectionCommands: readonly BranchStation["commandId"][] = [
    "help",
    "payload:check",
    "runtime:repair",
    "release:inspect",
    "harness:claude:inspect",
    "harness:codex:inspect",
    "canary:inspect",
  ]
  const mutationExpectation: BranchStation["mutationExpectation"] =
    input.commandId === "maintenance" ? { kind: "none" }
    : inspectionCommands.includes(input.commandId) ?
      { kind: "preview", expectedEffectIds: [] }
    : {
        kind: "result",
        completedEffectIds: [],
        remainingEffectIds: [],
      }
  return {
    stationId,
    commandId: input.commandId,
    classification,
    branchKind: branchKindFor(descriptor.failureClass),
    precondition: input.precondition ?? "The governing owner returns the declared Result Code.",
    independentObservable: "Public process exit, envelope, Result Code, Station ID, and Next Action agree.",
    expectedResultCode: input.resultCode,
    expectedExitClass: descriptor.exitClass,
    expectedEnvelopeStatus: classification === "success" ? "ok" : "error",
    expectedRetrySafety: descriptor.retrySafety,
    expectedTransactionState: descriptor.transactionState,
    controllingOwnerId: input.controllingOwnerId,
    owningStage: input.owningStage,
    reachability: input.reachability,
    skipRationale: input.skipRationale ?? null,
    governingInterface: input.governingInterface,
    expectedNextActionId: input.nextActionId ?? descriptor.nextAction.id,
    repairRouteCommandId:
      "repairRouteCommandId" in input ? input.repairRouteCommandId ?? null
      : descriptor.nextAction.commandId ?? null,
    mutationExpectation,
  }
}

const deferredRationale = {
  payload:
    "Plugin Payload Production Implementation is absent in P3 and is deferred to P4; supplying a request file proves facade loading only, not an owner outcome. Future selector: bun test src/modules/plugin-payload-production/contract-tests/deterministic-plugin-payload.test.ts src/modules/plugin-payload-production/contract-tests/unsafe-inventory-refusal.test.ts. Non-Claim: P3 claims no Plugin Payload Production result or effect through a real process.",
  runtime:
    "Runtime Custody Implementation is absent in P3 and is deferred to P5; Runtime argv proves dispatch shape only, not custody outcome. Future selector: bun test src/modules/runtime-custody/contract-tests/run-and-repair.test.ts src/modules/runtime-custody/contract-tests/corrupt-custody-refusal.test.ts. Non-Claim: P3 claims no Runtime Custody result, refresh, download, lock, or repair through a real process.",
  release:
    "Release and Git Engine Implementation is absent in P3 and is deferred to P6; request and approval files do not establish a release owner outcome. Future selector: bun test src/modules/release-and-git-engine/contract-tests/candidate-admission-and-convergence.test.ts src/modules/release-and-git-engine/contract-tests/stale-candidate-approval.test.ts. Non-Claim: P3 claims no Release and Git Engine inspection, mutation, or recovery through a real process.",
  harness:
    "Harness Journeys Implementation is absent in P3 and is deferred to P7; request and approval files prove no Harness outcome. Future selector: bun test src/modules/harness-journeys/contract-tests/claude-journey-recovery.test.ts src/modules/harness-journeys/contract-tests/codex-checkout-isolation.test.ts. Non-Claim: P3 claims no Claude or Codex Harness transition, retry, continuation, or recovery through a real process.",
  canary:
    "Canary Qualification Implementation is absent in P3 and is deferred to P9; candidate and authority files do not establish a canary owner outcome. Future selector: bun test src/modules/canary-qualification/contract-tests/trusted-target-derivation.test.ts src/modules/canary-qualification/contract-tests/credential-removal.test.ts. Non-Claim: P3 claims no Canary Qualification inspection, protected effect, or recovery through a real process.",
} as const

const deferredFor = (
  commandId: MaintenanceCommand["command"],
  resultCodes: readonly ResultCode[],
  controllingOwnerId: BranchStation["controllingOwnerId"],
  owningStage: BranchStation["owningStage"],
  rationale: string,
): BranchStation[] =>
  resultCodes.map((resultCode) =>
    station({
      commandId,
      resultCode,
      controllingOwnerId,
      owningStage,
      reachability: "stage-deferred",
      skipRationale: rationale,
      governingInterface: `src/modules/${controllingOwnerId}/interface.ts`,
    }),
  )

const payloadStations = [
  station({
    commandId: "payload:check",
    resultCode: "previewed",
    controllingOwnerId: "plugin-payload-production",
    owningStage: "P4",
    reachability: "stage-deferred",
    skipRationale: deferredRationale.payload,
    governingInterface: "src/modules/plugin-payload-production/interface.ts",
    nextActionId: "payload-check.inspect-result",
    repairRouteCommandId: null,
  }),
  ...deferredFor(
    "payload:check",
    inspectFailures,
    "plugin-payload-production",
    "P4",
    deferredRationale.payload,
  ),
  station({
    commandId: "payload:materialize",
    resultCode: "completed",
    controllingOwnerId: "plugin-payload-production",
    owningStage: "P4",
    reachability: "stage-deferred",
    skipRationale: deferredRationale.payload,
    governingInterface: "src/modules/plugin-payload-production/interface.ts",
    nextActionId: "payload-materialize.inspect-result",
    repairRouteCommandId: null,
  }),
  ...deferredFor(
    "payload:materialize",
    applyFailures,
    "plugin-payload-production",
    "P4",
    deferredRationale.payload,
  ),
  station({
    commandId: "payload:package",
    resultCode: "completed",
    controllingOwnerId: "plugin-payload-production",
    owningStage: "P4",
    reachability: "stage-deferred",
    skipRationale: deferredRationale.payload,
    governingInterface: "src/modules/plugin-payload-production/interface.ts",
    nextActionId: "payload-package.inspect-result",
    repairRouteCommandId: null,
  }),
  ...deferredFor(
    "payload:package",
    applyFailures,
    "plugin-payload-production",
    "P4",
    deferredRationale.payload,
  ),
]

const runtimeStations = [
  station({
    commandId: "runtime:repair",
    resultCode: "runtime-repair-preview",
    controllingOwnerId: "runtime-custody",
    owningStage: "P5",
    reachability: "stage-deferred",
    skipRationale: deferredRationale.runtime,
    governingInterface: "src/modules/runtime-custody/interface.ts",
    repairRouteCommandId: "runtime:repair-apply",
  }),
  station({
    commandId: "runtime:repair",
    resultCode: "runtime-repair-unneeded",
    controllingOwnerId: "runtime-custody",
    owningStage: "P5",
    reachability: "stage-deferred",
    skipRationale: deferredRationale.runtime,
    governingInterface: "src/modules/runtime-custody/interface.ts",
    repairRouteCommandId: null,
  }),
  station({
    commandId: "runtime:repair-apply",
    resultCode: "runtime-repair-applied",
    controllingOwnerId: "runtime-custody",
    owningStage: "P5",
    reachability: "stage-deferred",
    skipRationale: deferredRationale.runtime,
    governingInterface: "src/modules/runtime-custody/interface.ts",
    repairRouteCommandId: "runtime:repair",
  }),
  station({
    commandId: "runtime:repair-apply",
    resultCode: "runtime-repair-unneeded",
    controllingOwnerId: "runtime-custody",
    owningStage: "P5",
    reachability: "stage-deferred",
    skipRationale: deferredRationale.runtime,
    governingInterface: "src/modules/runtime-custody/interface.ts",
    repairRouteCommandId: null,
  }),
  ...deferredFor(
    "runtime:repair",
    runtimeControlResultCodes,
    "runtime-custody",
    "P5",
    deferredRationale.runtime,
  ),
  ...deferredFor(
    "runtime:repair-apply",
    runtimeControlResultCodes,
    "runtime-custody",
    "P5",
    deferredRationale.runtime,
  ),
]

const ownerPairStations = (input: {
  inspectCommand: MaintenanceCommand["command"]
  applyCommand: MaintenanceCommand["command"]
  owner: BranchStation["controllingOwnerId"]
  stage: BranchStation["owningStage"]
  rationale: string
  inspectNextActionId: string
  inspectRepairRouteCommandId: MaintenanceCommand["command"]
  applyNextActionId: string
}): BranchStation[] => [
  station({
    commandId: input.inspectCommand,
    resultCode: "previewed",
    controllingOwnerId: input.owner,
    owningStage: input.stage,
    reachability: "stage-deferred",
    skipRationale: input.rationale,
    governingInterface: `src/modules/${input.owner}/interface.ts`,
    nextActionId: input.inspectNextActionId,
    repairRouteCommandId: input.inspectRepairRouteCommandId,
  }),
  ...deferredFor(
    input.inspectCommand,
    inspectFailures,
    input.owner,
    input.stage,
    input.rationale,
  ),
  station({
    commandId: input.applyCommand,
    resultCode: "completed",
    controllingOwnerId: input.owner,
    owningStage: input.stage,
    reachability: "stage-deferred",
    skipRationale: input.rationale,
    governingInterface: `src/modules/${input.owner}/interface.ts`,
    nextActionId: input.applyNextActionId,
    repairRouteCommandId: null,
  }),
  ...deferredFor(input.applyCommand, applyFailures, input.owner, input.stage, input.rationale),
]

const releaseStations = ownerPairStations({
  inspectCommand: "release:inspect",
  applyCommand: "release:apply",
  owner: "release-and-git-engine",
  stage: "P6",
  rationale: deferredRationale.release,
  inspectNextActionId: "release-inspect.review-preview",
  inspectRepairRouteCommandId: "release:apply",
  applyNextActionId: "release-apply.inspect-result",
})

const harnessStations = [
  ...ownerPairStations({
    inspectCommand: "harness:claude:inspect",
    applyCommand: "harness:claude:apply",
    owner: "harness-journeys",
    stage: "P7",
    rationale: deferredRationale.harness,
    inspectNextActionId: "harness-claude-inspect.inspect-result",
    inspectRepairRouteCommandId: "harness:claude:apply",
    applyNextActionId: "harness-claude-apply.inspect-result",
  }),
  ...ownerPairStations({
    inspectCommand: "harness:codex:inspect",
    applyCommand: "harness:codex:apply",
    owner: "harness-journeys",
    stage: "P7",
    rationale: deferredRationale.harness,
    inspectNextActionId: "harness-codex-inspect.inspect-result",
    inspectRepairRouteCommandId: "harness:codex:apply",
    applyNextActionId: "harness-codex-apply.inspect-result",
  }),
]

const canaryStations = ownerPairStations({
  inspectCommand: "canary:inspect",
  applyCommand: "canary:qualify",
  owner: "canary-qualification",
  stage: "P9",
  rationale: deferredRationale.canary,
  inspectNextActionId: "canary-inspect.inspect-result",
  inspectRepairRouteCommandId: "canary:qualify",
  applyNextActionId: "canary-qualify.inspect-result",
})

const helpUnreachableRationale =
  "No accepted argv, stdin, named file, or owner-local host input can cause the closed static help Interface to return this typed outcome."

const declaredUnreachable = [
  station({
    commandId: "maintenance",
    resultCode: "runtime-failed",
    controllingOwnerId: "maintenance-command-facade",
    owningStage: "P3",
    reachability: "declared-unreachable",
    skipRationale:
      "No accepted argv, stdin, or named file can cause a pre-dispatch facade fault; unit fault Adapters retain containment proof.",
    governingInterface: "src/adapters/maintenance-command-facade/interface.ts",
  }),
  ...(["command-refused", "retry-deferred", "recovery-required", "runtime-failed"] as const).map(
    (resultCode) =>
      station({
        commandId: "help",
        resultCode,
        controllingOwnerId: "maintenance-command-contract",
        owningStage: "P3",
        reachability: "declared-unreachable",
        skipRationale: helpUnreachableRationale,
        governingInterface: "src/modules/maintenance-command-contract/interface.ts",
      }),
  ),
  station({
    commandId: "runtime:repair",
    resultCode: "runtime-repair-applied",
    controllingOwnerId: "runtime-custody",
    owningStage: "P5",
    reachability: "declared-unreachable",
    skipRationale:
      "runtime:repair is inspection-only and cannot request Runtime Custody repair --apply.",
    governingInterface: "src/modules/runtime-custody/interface.ts",
    repairRouteCommandId: null,
  }),
  station({
    commandId: "runtime:repair-apply",
    resultCode: "runtime-repair-preview",
    controllingOwnerId: "runtime-custody",
    owningStage: "P5",
    reachability: "declared-unreachable",
    skipRationale:
      "The apply precondition consumes a fresh preview and returns the final mapped result, never the consumed preview.",
    governingInterface: "src/modules/runtime-custody/interface.ts",
    repairRouteCommandId: "runtime:repair",
  }),
]

export const branchStationCatalog = [
  station({
    commandId: "help",
    resultCode: "previewed",
    controllingOwnerId: "maintenance-command-contract",
    owningStage: "P3",
    reachability: "required",
    governingInterface: "src/modules/maintenance-command-contract/interface.ts",
    nextActionId: "help.choose-command",
    repairRouteCommandId: null,
  }),
  station({
    commandId: "maintenance",
    resultCode: "usage-refused",
    controllingOwnerId: "maintenance-command-facade",
    owningStage: "P3",
    reachability: "required",
    governingInterface: "src/adapters/maintenance-command-facade/interface.ts",
    repairRouteCommandId: "help",
  }),
  ...declaredUnreachable,
  ...payloadStations,
  ...runtimeStations,
  ...releaseStations,
  ...harnessStations,
  ...canaryStations,
] as const satisfies readonly BranchStation[]

export const stageDeferredOwnerStages = {
  "plugin-payload-production@P4": {
    ownerStage: "plugin-payload-production@P4",
    stationIds: payloadStations.map(({ stationId }) => stationId).sort(),
    futureSelector:
      "bun test src/modules/plugin-payload-production/contract-tests/deterministic-plugin-payload.test.ts src/modules/plugin-payload-production/contract-tests/unsafe-inventory-refusal.test.ts",
    expectedTestCount: 8,
    skipRationale: deferredRationale.payload,
    nonClaim: "P3 claims no Plugin Payload Production result or effect through a real process.",
  },
  "runtime-custody@P5": {
    ownerStage: "runtime-custody@P5",
    stationIds: runtimeStations.map(({ stationId }) => stationId).sort(),
    futureSelector:
      "bun test src/modules/runtime-custody/contract-tests/run-and-repair.test.ts src/modules/runtime-custody/contract-tests/corrupt-custody-refusal.test.ts",
    expectedTestCount: 12,
    skipRationale: deferredRationale.runtime,
    nonClaim:
      "P3 claims no Runtime Custody result, refresh, download, lock, or repair through a real process.",
  },
  "release-and-git-engine@P6": {
    ownerStage: "release-and-git-engine@P6",
    stationIds: releaseStations.map(({ stationId }) => stationId).sort(),
    futureSelector:
      "bun test src/modules/release-and-git-engine/contract-tests/candidate-admission-and-convergence.test.ts src/modules/release-and-git-engine/contract-tests/stale-candidate-approval.test.ts",
    expectedTestCount: 12,
    skipRationale: deferredRationale.release,
    nonClaim:
      "P3 claims no Release and Git Engine inspection, mutation, or recovery through a real process.",
  },
  "harness-journeys@P7": {
    ownerStage: "harness-journeys@P7",
    stationIds: harnessStations.map(({ stationId }) => stationId).sort(),
    futureSelector:
      "bun test src/modules/harness-journeys/contract-tests/claude-journey-recovery.test.ts src/modules/harness-journeys/contract-tests/codex-checkout-isolation.test.ts",
    expectedTestCount: 14,
    skipRationale: deferredRationale.harness,
    nonClaim:
      "P3 claims no Claude or Codex Harness transition, retry, continuation, or recovery through a real process.",
  },
  "canary-qualification@P9": {
    ownerStage: "canary-qualification@P9",
    stationIds: canaryStations.map(({ stationId }) => stationId).sort(),
    futureSelector:
      "bun test src/modules/canary-qualification/contract-tests/trusted-target-derivation.test.ts src/modules/canary-qualification/contract-tests/credential-removal.test.ts",
    expectedTestCount: 10,
    skipRationale: deferredRationale.canary,
    nonClaim:
      "P3 claims no Canary Qualification inspection, protected effect, or recovery through a real process.",
  },
} as const satisfies Record<StageDeferredOwnerStageKey, StageDeferredRecord>
