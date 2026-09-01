import { expect, test } from "bun:test"
import { resolve } from "node:path"
import { installedMaintenanceCliSubject } from "./adapters/maintenance-cli-contract-subjects"
import {
  expectedBranchStationSourceSha256,
  expectedDependencyFreeHelpRuntimeTrace,
  expectedInstalledFiles,
} from "./fixtures/plugin-consumer"
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
  expect(expectedInstalledFiles).toHaveLength(115)
  absent(installedMaintenanceCliSubject?.installedFiles, expectedInstalledFiles, "the Git Clean Fixture must prove installed inventory")
  absent(installedMaintenanceCliSubject.importedFiles, expectedDependencyFreeHelpRuntimeTrace, "dependency-free help must load the exact installed runtime closure")
  expect(installedMaintenanceCliSubject.externalDependencyPerturbationRefused).toBeTrue()
  expect(installedMaintenanceCliSubject.externalDependencyBaselineRestored).toBeTrue()
  expect(installedMaintenanceCliSubject.escapedRuntimePerturbationRefused).toBeTrue()
  expect(installedMaintenanceCliSubject.escapedRuntimeBaselineRestored).toBeTrue()
  expect(installedMaintenanceCliSubject.nonJavaScriptRuntimePerturbationRefused).toBeTrue()
  expect(installedMaintenanceCliSubject.nonJavaScriptRuntimeBaselineRestored).toBeTrue()
  expect(installedMaintenanceCliSubject?.stationMap, "contract-absent: the Git Clean Fixture must parse the installed Station Map bytes").toEqual({
    declared_branch_coverage: 118,
    required_station_ids: ["help.previewed", "maintenance.usage-refused"],
    source_sha256: expectedBranchStationSourceSha256,
  })

  const alignmentAudit = Bun.spawnSync({
    cmd: ["bun", "clean-fixture/audit-maintenance-cli.ts"],
    cwd: resolve(import.meta.dir, "../../.."),
    env: { ...process.env, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(alignmentAudit.exitCode, "contract-absent: the Command Surface Alignment Proof must ship").toBe(0)
  expect(alignmentAudit.stderr.toString(), "contract-absent: the audit must keep diagnostics off its machine stdout contract").toBe("")
  const report = JSON.parse(alignmentAudit.stdout.toString()) as {
    verdict: string
    surface_findings: readonly { status: string }[]
    required_observed_branch_total: number
    observed_branch_coverage: number
    stations: readonly { status: string; provenance: string }[]
  }
  expect(report.verdict, "contract-absent: the audit must emit the accepted ship verdict").toBe("ship")
  expect(report.surface_findings.every(({ status }) => status === "aligned"), "contract-absent: every audited command surface must align").toBe(true)
  expect(report.required_observed_branch_total, "contract-absent: the audit must retain both required Branch Stations").toBe(2)
  expect(report.observed_branch_coverage, "contract-absent: only qualifying real-process evidence may count").toBe(2)
  expect(report.stations.filter(({ status, provenance }) => status === "covered" && provenance === "real_process")).toHaveLength(2)
  expect(report.stations.some(({ status, provenance }) => status === "covered" && provenance !== "real_process"), "contract-absent: synthetic Station Map rows must not count").toBe(false)
})
