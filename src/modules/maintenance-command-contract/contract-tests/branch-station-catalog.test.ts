import { expect, test } from "bun:test"
import { branchStationCatalog, projectStationMap, deferredOwnerProofs } from "../branch-stations"
import { literalBranchKinds, literalBranchStationIds, literalDeclaredUnreachableRationales, literalDeferredOwnerProofs, literalExitByResultCode, literalImplementationDeferredCounts, literalRepairRouteByResultCode, literalRepairRouteByStationId, literalRequiredStationIds } from "./fixtures/literal-branch-stations"

const absent = (claim: string) => expect(projectStationMap, `contract-absent: ${claim}`).toBeDefined()

test("catalog declares exactly 118 deterministic station rows", () => {
  expect(branchStationCatalog).toHaveLength(118)
  expect(branchStationCatalog.map(({ stationId }) => String(stationId))).toEqual([...literalBranchStationIds])
  absent("Station Map projection must consume the closed catalog")
})
test("required Intentional RED scenarios are exactly help and usage", () => {
  expect(branchStationCatalog.filter(({ reachability }) => reachability === "required").map(({ stationId }) => stationId)).toEqual([...literalRequiredStationIds])
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
test("declared unreachable rows retain the seven literal rationales", () => {
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
  absent("Station Map must preserve Result Vocabulary ownership")
})
test("implementation-deferred counts remain local to canonical controlling owners", () => {
  const actual = Object.fromEntries(Object.entries(deferredOwnerProofs).map(([controllingOwnerId, value]) => [controllingOwnerId, value.stationIds.length]))
  expect(actual).toEqual(literalImplementationDeferredCounts)
  absent("Station Map must expose every deferred station")
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
  absent("Station Map must project exact implementation-deferred proof")
})
test("catalog never infers availability from request inputs", () => {
  expect(branchStationCatalog.every(({ governingInterface }) => governingInterface.endsWith("/interface.ts"))).toBe(true)
  const inspectionCommands = new Set(["help", "payload:check", "runtime:repair", "release:inspect", "harness:claude:inspect", "harness:codex:inspect", "canary:inspect"])
  expect(branchStationCatalog.every(({ commandId, mutationExpectation }) => mutationExpectation.kind === (commandId === "maintenance" ? "none" : inspectionCommands.has(commandId) ? "preview" : "result"))).toBe(true)
  absent("Station Map must reconcile evidence without synthetic coverage")
})
