import { expect, test } from "bun:test"
import {
  branchStationCatalog,
  type BranchStationMembership,
  canonicalNextActionFor,
  deferredOwnerProofs,
  isDeclaredBranchStation,
  projectStationMap,
} from "../branch-stations"
import { commandVocabulary } from "../command-vocabulary"
import { resultVocabulary } from "../result-vocabulary"
import { literalBranchKinds, literalBranchStationIds, literalDeclaredUnreachableRationales, literalDeferredOwnerProofs, literalExitByResultCode, literalImplementationDeferredCounts, literalRepairRouteByResultCode, literalRepairRouteByStationId, literalRequiredStationIds } from "./fixtures/literal-branch-stations"

const implemented = (claim: string) => expect(projectStationMap, `implemented: ${claim}`).toBeFunction()

test("catalog declares exactly 119 deterministic station rows", () => {
  expect(branchStationCatalog).toHaveLength(119)
  expect(branchStationCatalog.map(({ stationId }) => String(stationId))).toEqual([...literalBranchStationIds])
  expect(branchStationCatalog.every(({ commandId, expectedResultCode, classification }) =>
    isDeclaredBranchStation({ commandId, resultCode: expectedResultCode, classification }),
  )).toBe(true)
  const candidateCommandIds: readonly BranchStationMembership["commandId"][] = [
    "maintenance",
    ...commandVocabulary.map(({ command }) => command),
  ]
  const declaredByMembership = candidateCommandIds
    .flatMap((commandId) => resultVocabulary
      .filter(({ resultCode, exitClass }) => isDeclaredBranchStation({
        commandId,
        resultCode,
        classification: exitClass === 0 ? "success" : "failure",
      }))
      .map(({ resultCode }) => `${commandId.replaceAll(":", "-")}.${resultCode}`))
    .sort()
  expect(declaredByMembership).toEqual(
    branchStationCatalog.map(({ stationId }) => String(stationId)).sort(),
  )
  expect(branchStationCatalog.every(({ commandId, expectedResultCode, expectedNextActionId }) =>
    canonicalNextActionFor(commandId, expectedResultCode)?.id === expectedNextActionId,
  )).toBe(true)
  expect(isDeclaredBranchStation({ commandId: "help", resultCode: "runtime-repair-unneeded", classification: "success" })).toBe(false)
  expect(isDeclaredBranchStation({ commandId: "payload:materialize", resultCode: "runtime-repair-applied", classification: "success" })).toBe(false)
  expect(isDeclaredBranchStation({ commandId: "help", resultCode: "completed", classification: "success" })).toBe(false)
  expect(isDeclaredBranchStation({ commandId: "payload:check", resultCode: "usage-refused", classification: "failure" })).toBe(false)
  expect(isDeclaredBranchStation({ commandId: "release:apply", resultCode: "previewed", classification: "success" })).toBe(false)
  expect(isDeclaredBranchStation({ commandId: "runtime:repair-apply", resultCode: "previewed", classification: "success" })).toBe(false)
  expect(canonicalNextActionFor("help", "runtime-repair-unneeded")).toBeUndefined()
  implemented("Station Map projection consumes the closed catalog")
})
test("required current-stage scenarios include check, materialize, and package real-process stations", () => {
  expect(branchStationCatalog.filter(({ reachability }) => reachability === "required").map(({ stationId }) => stationId)).toEqual([...literalRequiredStationIds])
  const packageFaultStations = branchStationCatalog.filter(({ commandId, reachability, expectedResultCode }) => commandId === "payload:package" && reachability === "implementation-deferred" && expectedResultCode !== "previewed")
  expect(packageFaultStations.map(({ expectedResultCode }) => expectedResultCode)).toEqual(["retry-deferred", "continuation-required", "recovery-required", "runtime-failed"])
  expect(packageFaultStations.every(({ skipRationale }) => skipRationale?.includes("fault Adapters"))).toBe(true)
  const deferred = branchStationCatalog.find(({ reachability }) => reachability === "implementation-deferred")
  if (deferred === undefined) throw new Error("missing deferred Branch Station fixture")
  const projected = projectStationMap(branchStationCatalog, [
    {
      stationId: "help.previewed",
      status: "covered",
      provenance: "real_process",
      observedResultCode: "previewed",
      observedExitClass: 0,
    },
    {
      stationId: "maintenance.usage-refused",
      status: "covered",
      provenance: "synthetic",
      observedResultCode: "usage-refused",
      observedExitClass: 2,
    },
    {
      stationId: deferred.stationId,
      status: "covered",
      provenance: "real_process",
      observedResultCode: deferred.expectedResultCode,
      observedExitClass: deferred.expectedExitClass,
    },
  ])
  expect(projected.observedBranchCoverage).toBe(1)
  expect(projected.stations.find(({ stationId }) => stationId === "maintenance.usage-refused")?.status).toBe("drifted")
  const drifted = projectStationMap(branchStationCatalog, [{
    stationId: "help.previewed",
    status: "covered",
    provenance: "real_process",
    observedResultCode: "completed",
    observedExitClass: 0,
  }])
  expect(drifted.observedBranchCoverage).toBe(0)
  expect(drifted.stations.find(({ stationId }) => stationId === "help.previewed")?.status).toBe("drifted")
})
test("declared unreachable rows retain the literal rationales", () => {
  const actual = Object.fromEntries(branchStationCatalog
    .filter(({ reachability }) => reachability === "declared-unreachable")
    .map(({ stationId, skipRationale, governingInterface }) => [stationId, {
      ownerReason: skipRationale,
      governingInterface,
    }]))
  expect(actual).toEqual(literalDeclaredUnreachableRationales)
  implemented("unreachable Branch Stations retain owner rationales")
})
test("branch kind vocabulary is closed and uses retry instead of transient", () => {
  expect([...new Set(branchStationCatalog.map(({ branchKind }) => branchKind))].sort()).toEqual([...literalBranchKinds].sort())
  implemented("Station Map preserves closed branch kinds")
})
test("each station preserves Result Vocabulary exit and failure meaning", () => {
  expect(branchStationCatalog.every((station) => literalExitByResultCode[station.expectedResultCode] === station.expectedExitClass)).toBe(true)
  expect(branchStationCatalog.every((station) => {
    const expected = Object.hasOwn(literalRepairRouteByStationId, station.stationId) ? literalRepairRouteByStationId[station.stationId] : literalRepairRouteByResultCode[station.expectedResultCode] ?? null
    return station.repairRouteCommandId === expected
  })).toBe(true)
  expect(branchStationCatalog
    .filter(({ classification, commandId }) =>
      classification === "success" &&
      commandId !== "maintenance" &&
      [
        "runtime:repair-apply",
        "release:apply",
        "harness:claude:apply",
        "harness:codex:apply",
        "canary:qualify",
      ].includes(commandId)
    )
    .every(({ expectedRetrySafety }) => expectedRetrySafety === "requires-fresh-inspection"))
    .toBe(true)
  implemented("Station Map preserves Result Vocabulary ownership")
})
test("implementation-deferred counts remain local to canonical controlling owners", () => {
  const actual = Object.fromEntries(Object.entries(deferredOwnerProofs).map(([controllingOwnerId, value]) => [controllingOwnerId, value.stationIds.length]))
  expect(actual).toEqual(literalImplementationDeferredCounts)
  implemented("Station Map exposes every deferred station")
})
test("five deferred owner proofs retain selectors rationales and Non-Claims", () => {
  const actual = Object.fromEntries(Object.entries(deferredOwnerProofs).map(([ownerId, { controllingOwnerId, futureSelector, expectedTestCount, skipRationale, nonClaim }]) => [ownerId, {
    controllingOwnerId,
    futureSelector,
    expectedTestCount,
    skipRationale,
    nonClaim,
  }]))
  expect(actual).toEqual(literalDeferredOwnerProofs)
  expect(Object.values(deferredOwnerProofs).every((record) => branchStationCatalog.filter(({ controllingOwnerId, reachability }) => controllingOwnerId === record.controllingOwnerId && reachability === "implementation-deferred").every(({ skipRationale }) => skipRationale?.includes(record.futureSelector) && skipRationale.includes(record.nonClaim)))).toBe(true)
  implemented("Station Map projects exact implementation-deferred proof")
})
test("catalog never infers availability from request inputs", () => {
  expect(branchStationCatalog.every(({ governingInterface }) => governingInterface.endsWith("/interface.ts"))).toBe(true)
  const inspectionCommands = new Set(["help", "payload:check", "runtime:repair", "release:inspect", "harness:claude:inspect", "harness:codex:inspect", "canary:inspect"])
  expect(branchStationCatalog.every(({ commandId, expectedResultCode, mutationExpectation }) => mutationExpectation.kind === (
    commandId === "maintenance"
      ? "none"
      : inspectionCommands.has(commandId) || (commandId === "payload:package" && expectedResultCode === "previewed")
        ? "preview"
        : "result"
  ))).toBe(true)
  implemented("Station Map reconciles evidence without synthetic coverage")
})
