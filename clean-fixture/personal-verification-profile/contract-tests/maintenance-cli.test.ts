import { expect, test } from "bun:test"
import { resolve } from "node:path"
import {
  auditReportSchema,
  requiredStationProjectionAligned,
  rootConsumerEnumerationAligned,
} from "../../audit-maintenance-cli"
import { observeAdmissionSourceImport } from "./adapters/admission-source-projection"
import {
  installedMaintenanceCliSubject,
  productionOwnerProof,
} from "./adapters/maintenance-cli-contract-subjects"
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
test("Clean Fixture reconciles installed current-stage inventory and Station Map projection", () => {
  expect(expectedInstalledFiles).toHaveLength(136)
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
  const reportResult = auditReportSchema.safeParse(JSON.parse(alignmentAudit.stdout.toString()) as unknown)
  expect(reportResult.success, "contract-absent: the audit report must validate from unknown").toBeTrue()
  if (!reportResult.success) return
  const report = reportResult.data
  expect(report.verdict, "contract-absent: the audit must emit the accepted ship verdict").toBe("ship")
  expect(report.surface_findings.every(({ status }) => status === "aligned"), "contract-absent: every audited command surface must align").toBe(true)
  expect(report.required_observed_branch_total, "contract-absent: the audit must retain both required Branch Stations").toBe(2)
  expect(report.observed_branch_coverage, "contract-absent: only qualifying real-process evidence may count").toBe(2)
  expect(report.stations.filter(({ status, provenance }) => status === "covered" && provenance === "real_process")).toHaveLength(2)
  expect(report.stations.some(({ status, provenance }) => status === "covered" && provenance !== "real_process"), "contract-absent: synthetic Station Map rows must not count").toBe(false)
  expect(requiredStationProjectionAligned(report.stations), "contract-absent: exact required Station Map fields must reconcile").toBeTrue()

  const substitutedStation = report.stations.map((station) => station.station_id === "help.previewed"
    ? { ...station, station_id: "payload-check.previewed" }
    : station)
  expect(requiredStationProjectionAligned(substitutedStation), "contract-absent: a station substitution must drift").toBeFalse()
  const promotedDeferredStation = report.stations.map((station) => station.station_id === "payload-check.previewed"
    ? { ...station, status: "covered" as const, provenance: "real_process" as const }
    : station)
  expect(requiredStationProjectionAligned(promotedDeferredStation), "contract-absent: deferred promotion must not count").toBeFalse()

  expect(report.root_consumers.discovered_bindings.some(({ target, import_kind }) => target === "interface" && import_kind === "type-only"), "contract-absent: type-only Facade Interface imports must be enumerated").toBeTrue()
  expect(report.root_consumers.discovered_bindings.some(({ target, import_kind }) => target === "implementation" && import_kind === "runtime"), "contract-absent: runtime Facade Implementation imports must be enumerated").toBeTrue()
  expect(rootConsumerEnumerationAligned(report.root_consumers), "contract-absent: consumer bindings must reconcile").toBeTrue()
  const omittedTypeOnlyBinding = {
    ...report.root_consumers,
    discovered_bindings: report.root_consumers.discovered_bindings.filter(({ import_kind }) => import_kind !== "type-only"),
  }
  expect(rootConsumerEnumerationAligned(omittedTypeOnlyBinding), "contract-absent: omitting a type-only consumer must drift").toBeFalse()

  expect(report.surface_findings.find(({ surface }) => surface === "help_version_carriers")?.status).toBe("aligned")
  expect(report.surface_findings.find(({ surface }) => surface === "exit_families")?.status).toBe("aligned")
  expect(report.surface_findings.find(({ surface }) => surface === "containment_exit")?.status).toBe("aligned")
  expect(report.stations.every((station) => !Object.hasOwn(station, "descriptor_closure")), "contract-absent: unsupported descriptor settlement must not be asserted").toBeTrue()
  expect(auditReportSchema.safeParse({ ...report, schema_version: 2 }).success, "contract-absent: an unknown audit schema version must be refused").toBeFalse()
  expect(auditReportSchema.safeParse({ ...report, unexpected: true }).success, "contract-absent: an unknown audit field must be refused").toBeFalse()
  const descriptorClaim = {
    ...report,
    stations: report.stations.map((station) => ({ ...station, descriptor_closure: "closed" })),
  }
  expect(auditReportSchema.safeParse(descriptorClaim).success, "contract-absent: an unsupported descriptor claim must be refused").toBeFalse()
})

test("Clean Fixture production install observes every owner through public surfaces", async () => {
  const proof = await productionOwnerProof()
  expect(proof.parseOwners).toEqual({
    "plugin-payload-production": true,
    "release-and-git-engine": true,
    "harness-journeys": true,
    "canary-qualification": true,
    "qualification-evidence": true,
    "maintenance-command-facade": true,
    "maintenance-command-contract": true,
  })
  expect(proof.installedPrivateValidatorPaths).toEqual([
    "src/modules/plugin-payload-production/serialized-values.ts",
    "src/modules/release-and-git-engine/serialized-values.ts",
    "src/modules/harness-journeys/serialized-values.ts",
    "src/modules/canary-qualification/serialized-values.ts",
    "src/modules/qualification-evidence/serialized-values.ts",
    "src/modules/maintenance-command-contract/serialized-values.ts",
    "src/adapters/maintenance-command-facade/serialized-values.ts",
  ])
  expect(proof.publicValidatorExports).toEqual([])
  expect(proof.zodVersions).toEqual({
    "package.json": "4.4.3",
    "src/modules/plugin-payload-production/package.json": "4.4.3",
    "src/modules/release-and-git-engine/package.json": "4.4.3",
    "src/modules/harness-journeys/package.json": "4.4.3",
    "src/modules/canary-qualification/package.json": "4.4.3",
    "src/modules/qualification-evidence/package.json": "4.4.3",
    "src/modules/maintenance-command-contract/package.json": "4.4.3",
    "src/adapters/maintenance-command-facade/package.json": "4.4.3",
  })
})

test("Clean Fixture proves Admission Bootstrap cannot resolve Zod", () => {
  const observation = observeAdmissionSourceImport({ bareSpecifierPerturbation: "zod" })
  expect(observation.exitCode).not.toBe(0)
  expect(observation.stdout).toBe("")
  expect(observation.stderr).toContain("Cannot find package 'zod'")
  expect(observation.ambientNodeModules).toEqual([])
  expect(observation.fixtureRemoved).toBeTrue()
})

test("Clean Fixture distinguishes public command refusal from invalid input", async () => {
  const proof = await productionOwnerProof()
  expect(Object.keys(proof.publicProcess).sort()).toEqual([
    "canaryInspect",
    "canaryQualify",
    "harnessClaudeInspect",
    "harnessCodexInspect",
    "help",
    "payloadCheck",
    "releaseInspect",
  ])
  const commandObservations = Object.entries(proof.publicProcess)
    .filter(([label]) => label !== "help")
    .map(([, observation]) => observation)
  expect(commandObservations.every((observation) => observation.exitCode === 2)).toBeTrue()
  expect(commandObservations.every((observation) => observation.stdoutEmpty)).toBeTrue()
  expect(commandObservations.every((observation) => observation.maintenanceNotAdmitted)).toBeTrue()
  expect(commandObservations.every((observation) => !observation.invalidInput)).toBeTrue()
  expect(proof.invalidInput).toEqual({
    exitCode: 2,
    stdoutEmpty: true,
    maintenanceNotAdmitted: false,
    invalidInput: true,
  })
  expect(proof.qualification).toEqual({ status: "refused", code: "zero-cell" })
})
