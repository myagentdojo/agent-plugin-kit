import { expect, test } from "bun:test"
import { branchStationCatalog, projectStationMap, stageDeferredOwnerStages } from "../branch-stations"
import { literalBranchKinds, literalBranchStationIds, literalDeclaredUnreachableRationales, literalExitByResultCode, literalRepairRouteByResultCode, literalRepairRouteByStationId, literalRequiredStationIds, literalStageCounts } from "./fixtures/literal-branch-stations"

const absent = (claim: string) => expect(projectStationMap, `contract-absent: ${claim}`).toBeDefined()

test("catalog declares exactly 118 deterministic station rows", () => {
  expect(branchStationCatalog).toHaveLength(118)
  expect(branchStationCatalog.map(({ stationId }) => String(stationId))).toEqual([...literalBranchStationIds])
  absent("Station Map projection must consume the closed catalog")
})
test("required P3 scenarios are exactly help and usage", () => {
  expect(branchStationCatalog.filter(({ reachability }) => reachability === "required").map(({ stationId }) => stationId)).toEqual([...literalRequiredStationIds])
  absent("required Branch Stations must project observed evidence")
})
test("declared unreachable rows are exactly five P3 and two P5", () => {
  const actual = Object.fromEntries(branchStationCatalog
    .filter(({ reachability }) => reachability === "declared-unreachable")
    .map(({ stationId, skipRationale, governingInterface }) => [stationId, {
      ownerReason: skipRationale,
      governingInterface,
    }]))
  expect(actual).toEqual(literalDeclaredUnreachableRationales)
  absent("unreachable Branch Stations must retain owner rationales")
})
test("branch kind vocabulary is closed and uses retry instead of transient", () => {
  expect([...new Set(branchStationCatalog.map(({ branchKind }) => branchKind))].sort()).toEqual([...literalBranchKinds].sort())
  absent("Station Map must preserve closed branch kinds")
})
test("each station preserves Result Vocabulary exit and failure meaning", () => {
  expect(branchStationCatalog.every((station) => literalExitByResultCode[station.expectedResultCode] === station.expectedExitClass)).toBe(true)
  expect(branchStationCatalog.every((station) => {
    const expected = Object.hasOwn(literalRepairRouteByStationId, station.stationId) ? literalRepairRouteByStationId[station.stationId] : literalRepairRouteByResultCode[station.expectedResultCode] ?? null
    return station.repairRouteCommandId === expected
  })).toBe(true)
  absent("Station Map must preserve Result Vocabulary ownership")
})
test("stage deferred counts are P4 17 P5 48 P6 11 P7 22 P9 11", () => {
  const actual = Object.fromEntries(Object.entries(stageDeferredOwnerStages).map(([key, value]) => [key.slice(-2), value.stationIds.length]))
  expect(actual).toEqual(literalStageCounts)
  absent("Station Map must expose every deferred station")
})
test("five owner-stage records retain selectors rationales and Non-Claims", () => {
  expect(Object.values(stageDeferredOwnerStages)).toHaveLength(5)
  expect(Object.values(stageDeferredOwnerStages).every(({ futureSelector, skipRationale, nonClaim }) => futureSelector.startsWith("bun test ") && skipRationale.length > 0 && nonClaim.startsWith("P3 claims no"))).toBe(true)
  expect(Object.values(stageDeferredOwnerStages).every((record) => branchStationCatalog.filter(({ controllingOwnerId, owningStage, reachability }) => `${controllingOwnerId}@${owningStage}` === record.ownerStage && reachability === "stage-deferred").every(({ skipRationale }) => skipRationale?.includes(record.ownerStage.slice(-2)) && skipRationale.includes(record.futureSelector) && skipRationale.includes(record.nonClaim)))).toBe(true)
  absent("Station Map must project exact owner-stage deferrals")
})
test("catalog never infers availability from request inputs", () => {
  expect(branchStationCatalog.every(({ governingInterface }) => governingInterface.endsWith("/interface.ts"))).toBe(true)
  const inspectionCommands = new Set(["help", "payload:check", "runtime:repair", "release:inspect", "harness:claude:inspect", "harness:codex:inspect", "canary:inspect"])
  expect(branchStationCatalog.every(({ commandId, mutationExpectation }) => mutationExpectation.kind === (commandId === "maintenance" ? "none" : inspectionCommands.has(commandId) ? "preview" : "result"))).toBe(true)
  absent("Station Map must reconcile evidence without synthetic coverage")
})
