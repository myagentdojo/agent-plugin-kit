import { expect, test } from "bun:test"
import { branchStationCatalog } from "../../../src/modules/maintenance-command-contract/branch-stations"
import { installedMaintenanceCliSubject } from "./adapters/maintenance-cli-contract-subjects"
import { expectedInstalledFiles } from "./fixtures/plugin-consumer"
import { cleanFixtureHelpScenarios } from "./fixtures/maintenance-cli-process-scenarios"

const absent = (actual: unknown, expected: unknown, claim: string) => expect(actual, `contract-absent: ${claim}`).toEqual(expected)

test("fixed-run Clean Fixture no-command help is byte exact", () => {
  expect(cleanFixtureHelpScenarios[0].label).toBe("fixed-run no-command")
  absent(installedMaintenanceCliSubject?.observations[0], cleanFixtureHelpScenarios[0].expected, "the Git Clean Fixture must observe no-command help")
})
test("fixed-run Clean Fixture namespaced help is byte exact", () => {
  expect(cleanFixtureHelpScenarios[1].label).toBe("fixed-run namespaced help")
  absent(installedMaintenanceCliSubject?.observations[1], cleanFixtureHelpScenarios[1].expected, "the Git Clean Fixture must observe namespaced help")
})
test("fixed-run Clean Fixture top-level long help is byte exact", () => {
  expect(cleanFixtureHelpScenarios[2].label).toBe("fixed-run top-level long help")
  absent(installedMaintenanceCliSubject?.observations[2], cleanFixtureHelpScenarios[2].expected, "the Git Clean Fixture must observe top-level long help")
})
test("fixed-run Clean Fixture namespaced events-off help ignores invalid endpoint", () => {
  expect(cleanFixtureHelpScenarios[3].label).toBe("fixed-run namespaced events-off help")
  absent(installedMaintenanceCliSubject?.observations[3], cleanFixtureHelpScenarios[3].expected, "events off must win over invalid endpoint configuration")
})
test("Clean Fixture reconciles installed RED inventory and Station Map projection", () => {
  expect(expectedInstalledFiles).toHaveLength(18)
  expect(branchStationCatalog).toHaveLength(118)
  absent(installedMaintenanceCliSubject?.installedFiles, expectedInstalledFiles, "the Git Clean Fixture must prove installed inventory")
  expect(installedMaintenanceCliSubject?.stationMap, "contract-absent: the Git Clean Fixture must project the complete Station Map").toMatchObject({ declared_branch_coverage: 118, required_station_ids: ["help.previewed", "maintenance.usage-refused"] })
})
