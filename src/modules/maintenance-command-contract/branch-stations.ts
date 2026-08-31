import type {
  EffectClass,
  MaintenanceCommand,
  MaintenanceErrorFailureClass,
  RetrySafety,
  ResultCode,
  StationId,
  TransactionState,
} from "./interface"
import {
  maintenanceCommandContractId,
  resultSchemaVersion,
  resultVocabulary,
} from "./result-vocabulary"
import { commandVocabulary } from "./command-vocabulary"

export type BranchKind =
  | "execution"
  | "usage"
  | "refusal"
  | "retry"
  | "continuation"
  | "recovery"
  | "unexpected"

export type StationReachability = "required" | "implementation-deferred" | "declared-unreachable"

export type ControllingOwnerId =
  | "maintenance-command-contract"
  | "maintenance-command-facade"
  | "plugin-payload-production"
  | "runtime-custody"
  | "release-and-git-engine"
  | "harness-journeys"
  | "canary-qualification"

type DeferredOwnerId = Exclude<
  ControllingOwnerId,
  "maintenance-command-contract" | "maintenance-command-facade"
>

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
  controllingOwnerId: ControllingOwnerId
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

type DeferredOwnerProof = {
  controllingOwnerId: DeferredOwnerId
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
  implementationDeferredBranchCoverage: number
  declaredUnreachableBranchCoverage: number
  requiredObservedBranchTotal: number
  observedBranchCoverage: number
  stations: readonly BranchStationEvidence[]
}

export type StationMapProjector = (
  catalog: readonly BranchStation[],
  evidence: readonly BranchStationEvidence[],
) => StationMap

const evidenceForStation = (
  station: BranchStation,
  evidence: readonly BranchStationEvidence[],
): BranchStationEvidence => {
  const matches = evidence.filter(({ stationId }) => stationId === station.stationId)
  const observed = matches[0]
  if (observed === undefined) {
    const skipped: BranchStationEvidence = {
      stationId: station.stationId,
      status: station.reachability === "required" ? "missing" : "skipped",
      provenance: "synthetic",
    }
    if (station.skipRationale !== null) skipped.skipRationale = station.skipRationale
    return skipped
  }

  if (matches.length > 1 ||
    (observed.status === "covered" && observed.provenance === "real_process" &&
      (observed.observedResultCode !== station.expectedResultCode ||
        observed.observedExitClass !== station.expectedExitClass))) {
    return { ...observed, status: "drifted" }
  }
  return observed
}

export const projectStationMap: StationMapProjector = (catalog, evidence) => {
  const stations = catalog.map((station) => evidenceForStation(station, evidence))
  const required = catalog.filter(({ reachability }) => reachability === "required").length
  const observed = stations.filter(({ status, provenance }, index) =>
    catalog[index]?.reachability === "required" &&
    status === "covered" &&
    provenance === "real_process"
  ).length
  return {
    commandContractId: maintenanceCommandContractId,
    commandContractSchemaVersion: resultSchemaVersion,
    declaredBranchCoverage: catalog.length,
    implementationDeferredBranchCoverage: catalog.filter(
      ({ reachability }) => reachability === "implementation-deferred",
    ).length,
    declaredUnreachableBranchCoverage: catalog.filter(
      ({ reachability }) => reachability === "declared-unreachable",
    ).length,
    requiredObservedBranchTotal: required,
    observedBranchCoverage: observed,
    stations,
  }
}

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

const branchKindFor = (failureClass: MaintenanceErrorFailureClass | null): BranchKind => {
  if (failureClass === null) return "execution"
  if (failureClass === "transient") return "retry"
  return failureClass
}

const inspectionCommands: readonly BranchStation["commandId"][] = [
  "help",
  "payload:check",
  "runtime:repair",
  "release:inspect",
  "harness:claude:inspect",
  "harness:codex:inspect",
  "canary:inspect",
]

const mutationExpectationFor = (
  commandId: BranchStation["commandId"],
): BranchStation["mutationExpectation"] => {
  if (commandId === "maintenance") return { kind: "none" }
  if (inspectionCommands.includes(commandId)) return { kind: "preview", expectedEffectIds: [] }
  return { kind: "result", completedEffectIds: [], remainingEffectIds: [] }
}

const expectedRetrySafetyFor = (
  classification: BranchStation["classification"],
  effectClass: EffectClass | undefined,
  declared: RetrySafety,
): RetrySafety => classification === "success" && effectClass === "external"
  ? "requires-fresh-inspection"
  : declared

const repairRouteFor = (
  input: { repairRouteCommandId?: MaintenanceCommand["command"] | null },
  descriptor: ReturnType<typeof descriptorFor>,
): MaintenanceCommand["command"] | null =>
  Object.hasOwn(input, "repairRouteCommandId")
    ? input.repairRouteCommandId ?? null
    : descriptor.nextAction.commandId

const station = (input: {
  commandId: BranchStation["commandId"]
  resultCode: ResultCode
  controllingOwnerId: BranchStation["controllingOwnerId"]
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
  const commandDescriptor = input.commandId === "maintenance"
    ? undefined
    : commandVocabulary.find(({ command }) => command === input.commandId)
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
    expectedRetrySafety: expectedRetrySafetyFor(
      classification,
      commandDescriptor?.effectClass,
      descriptor.retrySafety,
    ),
    expectedTransactionState: descriptor.transactionState,
    controllingOwnerId: input.controllingOwnerId,
    reachability: input.reachability,
    skipRationale: input.skipRationale ?? null,
    governingInterface: input.governingInterface,
    expectedNextActionId: input.nextActionId ?? descriptor.nextAction.id,
    repairRouteCommandId: repairRouteFor(input, descriptor),
    mutationExpectation: mutationExpectationFor(input.commandId),
  }
}

const deferredRationale = {
  payload:
    "Plugin Payload Production Implementation is absent under Intentional RED; supplying a request file proves facade loading only, not an owner outcome. Future selector: bun test src/modules/plugin-payload-production/contract-tests/deterministic-plugin-payload.test.ts src/modules/plugin-payload-production/contract-tests/unsafe-inventory-refusal.test.ts. Non-Claim: Intentional RED does not prove Plugin Payload Production result or effect through a real process.",
  runtime:
    "Runtime Custody Implementation is absent under Intentional RED; Runtime argv proves dispatch shape only, not custody outcome. Future selector: bun test src/modules/runtime-custody/contract-tests/run-and-repair.test.ts src/modules/runtime-custody/contract-tests/corrupt-custody-refusal.test.ts. Non-Claim: Intentional RED does not prove Runtime Custody result, refresh, download, lock, or repair through a real process.",
  release:
    "Release and Git Engine Implementation is absent under Intentional RED; request and approval files do not establish a release owner outcome. Future selector: bun test src/modules/release-and-git-engine/contract-tests/candidate-admission-and-convergence.test.ts src/modules/release-and-git-engine/contract-tests/stale-candidate-approval.test.ts. Non-Claim: Intentional RED does not prove Release and Git Engine inspection, mutation, or recovery through a real process.",
  harness:
    "Harness Journeys Implementation is absent under Intentional RED; request and approval files do not establish a Harness outcome. Future selector: bun test src/modules/harness-journeys/contract-tests/claude-journey-recovery.test.ts src/modules/harness-journeys/contract-tests/codex-checkout-isolation.test.ts. Non-Claim: Intentional RED does not prove Claude or Codex Harness transition, retry, continuation, or recovery through a real process.",
  canary:
    "Canary Qualification Implementation is absent under Intentional RED; candidate and authority files do not establish a canary owner outcome. Future selector: bun test src/modules/canary-qualification/contract-tests/trusted-target-derivation.test.ts src/modules/canary-qualification/contract-tests/credential-removal.test.ts. Non-Claim: Intentional RED does not prove Canary Qualification inspection, protected effect, or recovery through a real process.",
} as const

const deferredFor = (
  commandId: MaintenanceCommand["command"],
  resultCodes: readonly ResultCode[],
  controllingOwnerId: BranchStation["controllingOwnerId"],
  rationale: string,
): BranchStation[] =>
  resultCodes.map((resultCode) =>
    station({
      commandId,
      resultCode,
      controllingOwnerId,
      reachability: "implementation-deferred",
      skipRationale: rationale,
      governingInterface: `src/modules/${controllingOwnerId}/interface.ts`,
    }),
  )

const payloadStations = [
  station({
    commandId: "payload:check",
    resultCode: "previewed",
    controllingOwnerId: "plugin-payload-production",
    reachability: "implementation-deferred",
    skipRationale: deferredRationale.payload,
    governingInterface: "src/modules/plugin-payload-production/interface.ts",
    nextActionId: "payload-check.inspect-result",
    repairRouteCommandId: null,
  }),
  ...deferredFor(
    "payload:check",
    inspectFailures,
    "plugin-payload-production",
    deferredRationale.payload,
  ),
  station({
    commandId: "payload:materialize",
    resultCode: "completed",
    controllingOwnerId: "plugin-payload-production",
    reachability: "implementation-deferred",
    skipRationale: deferredRationale.payload,
    governingInterface: "src/modules/plugin-payload-production/interface.ts",
    nextActionId: "payload-materialize.inspect-result",
    repairRouteCommandId: null,
  }),
  ...deferredFor(
    "payload:materialize",
    applyFailures,
    "plugin-payload-production",
    deferredRationale.payload,
  ),
  station({
    commandId: "payload:package",
    resultCode: "completed",
    controllingOwnerId: "plugin-payload-production",
    reachability: "implementation-deferred",
    skipRationale: deferredRationale.payload,
    governingInterface: "src/modules/plugin-payload-production/interface.ts",
    nextActionId: "payload-package.inspect-result",
    repairRouteCommandId: null,
  }),
  ...deferredFor(
    "payload:package",
    applyFailures,
    "plugin-payload-production",
    deferredRationale.payload,
  ),
]

const runtimeStations = [
  station({
    commandId: "runtime:repair",
    resultCode: "runtime-repair-preview",
    controllingOwnerId: "runtime-custody",
    reachability: "implementation-deferred",
    skipRationale: deferredRationale.runtime,
    governingInterface: "src/modules/runtime-custody/interface.ts",
    repairRouteCommandId: "runtime:repair-apply",
  }),
  station({
    commandId: "runtime:repair",
    resultCode: "runtime-repair-unneeded",
    controllingOwnerId: "runtime-custody",
    reachability: "implementation-deferred",
    skipRationale: deferredRationale.runtime,
    governingInterface: "src/modules/runtime-custody/interface.ts",
    repairRouteCommandId: null,
  }),
  station({
    commandId: "runtime:repair-apply",
    resultCode: "runtime-repair-applied",
    controllingOwnerId: "runtime-custody",
    reachability: "implementation-deferred",
    skipRationale: deferredRationale.runtime,
    governingInterface: "src/modules/runtime-custody/interface.ts",
    repairRouteCommandId: "runtime:repair",
  }),
  station({
    commandId: "runtime:repair-apply",
    resultCode: "runtime-repair-unneeded",
    controllingOwnerId: "runtime-custody",
    reachability: "implementation-deferred",
    skipRationale: deferredRationale.runtime,
    governingInterface: "src/modules/runtime-custody/interface.ts",
    repairRouteCommandId: null,
  }),
  ...deferredFor(
    "runtime:repair",
    runtimeControlResultCodes,
    "runtime-custody",
    deferredRationale.runtime,
  ),
  ...deferredFor(
    "runtime:repair-apply",
    runtimeControlResultCodes,
    "runtime-custody",
    deferredRationale.runtime,
  ),
]

const ownerPairStations = (input: {
  inspectCommand: MaintenanceCommand["command"]
  applyCommand: MaintenanceCommand["command"]
  owner: BranchStation["controllingOwnerId"]
  rationale: string
  inspectNextActionId: string
  inspectRepairRouteCommandId: MaintenanceCommand["command"]
  applyNextActionId: string
}): BranchStation[] => [
  station({
    commandId: input.inspectCommand,
    resultCode: "previewed",
    controllingOwnerId: input.owner,
    reachability: "implementation-deferred",
    skipRationale: input.rationale,
    governingInterface: `src/modules/${input.owner}/interface.ts`,
    nextActionId: input.inspectNextActionId,
    repairRouteCommandId: input.inspectRepairRouteCommandId,
  }),
  ...deferredFor(
    input.inspectCommand,
    inspectFailures,
    input.owner,
    input.rationale,
  ),
  station({
    commandId: input.applyCommand,
    resultCode: "completed",
    controllingOwnerId: input.owner,
    reachability: "implementation-deferred",
    skipRationale: input.rationale,
    governingInterface: `src/modules/${input.owner}/interface.ts`,
    nextActionId: input.applyNextActionId,
    repairRouteCommandId: null,
  }),
  ...deferredFor(input.applyCommand, applyFailures, input.owner, input.rationale),
]

const releaseStations = ownerPairStations({
  inspectCommand: "release:inspect",
  applyCommand: "release:apply",
  owner: "release-and-git-engine",
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
    rationale: deferredRationale.harness,
    inspectNextActionId: "harness-claude-inspect.inspect-result",
    inspectRepairRouteCommandId: "harness:claude:apply",
    applyNextActionId: "harness-claude-apply.inspect-result",
  }),
  ...ownerPairStations({
    inspectCommand: "harness:codex:inspect",
    applyCommand: "harness:codex:apply",
    owner: "harness-journeys",
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
    reachability: "declared-unreachable",
    skipRationale:
      "No accepted argv, stdin, or named file can cause a pre-dispatch facade fault; owner-local fault Adapters retain containment proof.",
    governingInterface: "src/adapters/maintenance-command-facade/interface.ts",
  }),
  ...(["command-refused", "retry-deferred", "recovery-required", "runtime-failed"] as const).map(
    (resultCode) =>
      station({
        commandId: "help",
        resultCode,
        controllingOwnerId: "maintenance-command-contract",
        reachability: "declared-unreachable",
        skipRationale: helpUnreachableRationale,
        governingInterface: "src/modules/maintenance-command-contract/interface.ts",
      }),
  ),
  station({
    commandId: "runtime:repair",
    resultCode: "runtime-repair-applied",
    controllingOwnerId: "runtime-custody",
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
    reachability: "required",
    governingInterface: "src/modules/maintenance-command-contract/interface.ts",
    nextActionId: "help.choose-command",
    repairRouteCommandId: null,
  }),
  station({
    commandId: "maintenance",
    resultCode: "usage-refused",
    controllingOwnerId: "maintenance-command-facade",
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

export const deferredOwnerProofs = {
  "plugin-payload-production": {
    controllingOwnerId: "plugin-payload-production",
    stationIds: payloadStations.map(({ stationId }) => stationId).sort(),
    futureSelector:
      "bun test src/modules/plugin-payload-production/contract-tests/deterministic-plugin-payload.test.ts src/modules/plugin-payload-production/contract-tests/unsafe-inventory-refusal.test.ts",
    expectedTestCount: 8,
    skipRationale: deferredRationale.payload,
    nonClaim: "Intentional RED does not prove Plugin Payload Production result or effect through a real process.",
  },
  "runtime-custody": {
    controllingOwnerId: "runtime-custody",
    stationIds: runtimeStations.map(({ stationId }) => stationId).sort(),
    futureSelector:
      "bun test src/modules/runtime-custody/contract-tests/run-and-repair.test.ts src/modules/runtime-custody/contract-tests/corrupt-custody-refusal.test.ts",
    expectedTestCount: 12,
    skipRationale: deferredRationale.runtime,
    nonClaim:
      "Intentional RED does not prove Runtime Custody result, refresh, download, lock, or repair through a real process.",
  },
  "release-and-git-engine": {
    controllingOwnerId: "release-and-git-engine",
    stationIds: releaseStations.map(({ stationId }) => stationId).sort(),
    futureSelector:
      "bun test src/modules/release-and-git-engine/contract-tests/candidate-admission-and-convergence.test.ts src/modules/release-and-git-engine/contract-tests/stale-candidate-approval.test.ts",
    expectedTestCount: 12,
    skipRationale: deferredRationale.release,
    nonClaim:
      "Intentional RED does not prove Release and Git Engine inspection, mutation, or recovery through a real process.",
  },
  "harness-journeys": {
    controllingOwnerId: "harness-journeys",
    stationIds: harnessStations.map(({ stationId }) => stationId).sort(),
    futureSelector:
      "bun test src/modules/harness-journeys/contract-tests/claude-journey-recovery.test.ts src/modules/harness-journeys/contract-tests/codex-checkout-isolation.test.ts",
    expectedTestCount: 14,
    skipRationale: deferredRationale.harness,
    nonClaim:
      "Intentional RED does not prove Claude or Codex Harness transition, retry, continuation, or recovery through a real process.",
  },
  "canary-qualification": {
    controllingOwnerId: "canary-qualification",
    stationIds: canaryStations.map(({ stationId }) => stationId).sort(),
    futureSelector:
      "bun test src/modules/canary-qualification/contract-tests/trusted-target-derivation.test.ts src/modules/canary-qualification/contract-tests/credential-removal.test.ts",
    expectedTestCount: 10,
    skipRationale: deferredRationale.canary,
    nonClaim:
      "Intentional RED does not prove Canary Qualification inspection, protected effect, or recovery through a real process.",
  },
} as const satisfies Record<DeferredOwnerId, DeferredOwnerProof>
