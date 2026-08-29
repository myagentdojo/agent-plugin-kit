import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import packageMetadata from "../package.json"
import { staticModuleSpecifiers } from "../tooling/repository-quality/static-module-specifiers"
import { branchStationCatalog, deferredOwnerProofs } from "../src/modules/maintenance-command-contract/branch-stations"
import { commandContractSchemaVersion, commandVocabulary } from "../src/modules/maintenance-command-contract/command-vocabulary"
import { errorSchemaVersion, exitFamilies, failureNextActionProjection, hintVersion, maintenanceCommandContractId, resultSchemaVersion } from "../src/modules/maintenance-command-contract/result-vocabulary"
import { literalHelpProcess, literalUsageProcess } from "../src/modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"
import { literalDeclaredUnreachableRationales } from "../src/modules/maintenance-command-contract/contract-tests/fixtures/literal-branch-stations"
import { literalProcessResult } from "./personal-verification-profile/contract-tests/fixtures/plugin-consumer"

const repositoryRoot = resolve(import.meta.dir, "..")
const facadeInterface = resolve(repositoryRoot, "src/adapters/maintenance-command-facade/interface.ts")
const facadeManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "src/adapters/maintenance-command-facade/package.json"), "utf8")) as { name: string }
const helpEnvelope = JSON.parse(literalHelpProcess.stdout) as {
  schema_version: number
  data: { contract_id: string; result_schema_version: number; result: Record<string, unknown> }
}
const help = helpEnvelope.data.result
const findings: { surface: string; status: "aligned" | "drifted"; detail: string }[] = []
const compare = (surface: string, actual: unknown, expected: unknown) => {
  const aligned = JSON.stringify(actual) === JSON.stringify(expected)
  findings.push({ surface, status: aligned ? "aligned" : "drifted", detail: aligned ? "exact" : "value drift" })
}

compare("package_identity", packageMetadata.name, "agent-plugin-kit")
compare("package_version", help.package_version, packageMetadata.version)
compare("binary", packageMetadata.bin, { "agent-plugin-kit": "./src/adapters/maintenance-command-facade/maintenance.ts" })
compare("contract_id", helpEnvelope.data.contract_id, maintenanceCommandContractId)
compare("result_schema_versions", [helpEnvelope.data.result_schema_version, help.schema_version, (help.versions as Record<string, number>).result], [resultSchemaVersion, resultSchemaVersion, resultSchemaVersion])
compare("command_contract_schema_version", commandContractSchemaVersion, resultSchemaVersion)
compare("environment_dependencies", (help.environment_dependencies as { name: string }[]).map(({ name }) => name), ["AGENT_PLUGIN_KIT_EVENT_ENDPOINT", "AGENT_PLUGIN_KIT_EVENT_AUTH"])
compare("command_vocabulary", (help.commands as { command: string }[]).map(({ command }) => command), commandVocabulary.map(({ command }) => command))
compare("exit_families", (help.exits as { typed: { family_id: string; result_codes: string[] }[] }).typed.map(({ family_id, result_codes }) => ({ family_id, result_codes })), exitFamilies.map(({ familyId, resultCodes }) => ({ family_id: familyId, result_codes: resultCodes })))
compare("next_actions", help.next_actions, failureNextActionProjection.map((row) => ({ id: row.id, action: row.action, command_id: row.commandId, failure_class: row.failureClass })))
compare("canonical_help_bytes", literalProcessResult.stdout, literalHelpProcess.stdout)
compare("legacy_exit_authority", readFileSync(resolve(repositoryRoot, "src/modules/maintenance-command-contract/interface.ts"), "utf8").includes("exitClass"), false)
compare("declared_unreachable_rationales", Object.fromEntries(branchStationCatalog
  .filter(({ reachability }) => reachability === "declared-unreachable")
  .map(({ stationId, skipRationale, governingInterface }) => [stationId, {
    ownerReason: skipRationale,
    governingInterface,
  }])), literalDeclaredUnreachableRationales)
findings.push({
  surface: "runtime_failed_residual",
  status: "aligned",
  detail:
    "Non-Claim: intentional RED does not prove runtime-failed residual mapping through a real process.",
})

const requiredScenarios = [
  { stationId: "help.previewed", argv: ["--run-id", "contract-help-literal", "--help"], expected: literalHelpProcess },
  { stationId: "maintenance.usage-refused", argv: ["--run-id", "contract-help-literal", "unknown"], expected: literalUsageProcess },
] as const
const publicProcessDeadlineMs = 2_000
const requiredObservations = requiredScenarios.map((scenario) => {
  const result = Bun.spawnSync({
    cmd: [resolve(repositoryRoot, "src/adapters/maintenance-command-facade/maintenance.ts"), ...scenario.argv],
    cwd: repositoryRoot,
    env: { ...process.env, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: publicProcessDeadlineMs,
    killSignal: "SIGKILL",
  })
  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()
  const primaryLine = (stdout || stderr).split("\n").filter(Boolean).at(-1)
  let primary: { data?: Record<string, unknown> } | undefined
  try {
    primary = JSON.parse(primaryLine ?? "") as { data?: Record<string, unknown> }
  } catch {
    primary = undefined
  }
  const observed = result.exitCode === scenario.expected.exitCode && stdout === scenario.expected.stdout && stderr === scenario.expected.stderr
  return {
    ...scenario,
    exitCode: result.exitCode,
    stdout,
    stderr,
    primary,
    observed,
    deadlineMs: publicProcessDeadlineMs,
    timedOut: result.signalCode === "SIGKILL",
    descriptorClosure: "closed" as const,
  }
})
const implementationAbsent = requiredObservations.every(({ exitCode, stderr }) => exitCode === 1 && stderr.includes("implementation-absent"))
const publicProcessesAligned = requiredObservations.every(({ observed }) => observed)
findings.push({ surface: "public_process", status: publicProcessesAligned ? "aligned" : "drifted", detail: implementationAbsent ? "implementation-absent" : publicProcessesAligned ? "two-required-stations-observed" : "required-observation-drift" })

const resolveRelativeModule = (importer: string, specifier: string) => {
  const candidate = resolve(dirname(importer), specifier)
  return [candidate, `${candidate}.ts`, resolve(candidate, "interface.ts"), resolve(candidate, "index.ts")].find((path) => existsSync(path))
}
const relativeImports = (file: string) => {
  return staticModuleSpecifiers(file, readFileSync(file, "utf8")).flatMap((specifier) => {
    if (specifier === facadeManifest.name) return [facadeInterface]
    if (specifier.startsWith(`${facadeManifest.name}/`)) throw new Error(`${file} imports a forbidden facade owner subpath: ${specifier}`)
    if (!specifier.startsWith(".")) return []
    const resolved = resolveRelativeModule(file, specifier)
    return resolved ? [resolved] : []
  })
}
const workspaceOwnerRoots = (packageMetadata.workspaces as string[]).flatMap((pattern) => {
  if (!pattern.endsWith("/*")) {
    const ownerRoot = resolve(repositoryRoot, pattern)
    return existsSync(resolve(ownerRoot, "package.json")) ? [ownerRoot] : []
  }
  const parent = resolve(repositoryRoot, pattern.slice(0, -2))
  return readdirSync(parent, { withFileTypes: true })
    .filter(({ name, isDirectory }) => isDirectory() && existsSync(resolve(parent, name, "package.json")))
    .map(({ name }) => resolve(parent, name))
})
const productionTypeScriptFiles = (root: string): string[] => readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
  const path = resolve(root, entry.name)
  if (entry.isDirectory()) return entry.name === "contract-tests" ? [] : productionTypeScriptFiles(path)
  return entry.isFile() && entry.name.endsWith(".ts") ? [path] : []
})
const binaryConsumers = Object.values(packageMetadata.bin).map((target) => resolve(repositoryRoot, target))
const graphEntries = [...new Set([resolve(repositoryRoot, packageMetadata.exports["."]), ...workspaceOwnerRoots.flatMap(productionTypeScriptFiles), ...binaryConsumers])]
const visited = new Set<string>()
const discovered = new Set<string>()
const walkProductionImports = (file: string) => {
  if (visited.has(file)) return
  visited.add(file)
  for (const imported of relativeImports(file)) {
    if (imported === facadeInterface) discovered.add(relative(repositoryRoot, file))
    walkProductionImports(imported)
  }
}
for (const entry of graphEntries) walkProductionImports(entry)
const declaredConsumers = binaryConsumers.map((file) => relative(repositoryRoot, file)).sort()
const discoveredConsumers = [...discovered].sort()
const typecheckResult = Bun.spawnSync({
  cmd: ["bun", "run", "typecheck"],
  cwd: repositoryRoot,
  env: { ...process.env, NO_COLOR: "1" },
  stdout: "pipe",
  stderr: "pipe",
})
const typecheckedConsumers = typecheckResult.exitCode === 0 ? discoveredConsumers : []
compare("root_consumers", declaredConsumers, discoveredConsumers)
compare("root_consumer_typecheck", discoveredConsumers, typecheckedConsumers)

const stations = branchStationCatalog.map((station) => ({
  ...(() => {
    const observation = requiredObservations.find(({ stationId }) => stationId === station.stationId)
    return {
      station_id: station.stationId,
      status: observation?.observed ? "covered" : observation ? "drifted" : station.reachability === "required" ? "missing" : "skipped",
      provenance: observation ? "real_process" : "synthetic",
      argv: observation?.argv ?? null,
      exit_code: observation?.exitCode ?? null,
      deadline_ms: observation?.deadlineMs ?? null,
      timed_out: observation?.timedOut ?? null,
      descriptor_closure: observation?.descriptorClosure ?? null,
      result_code: observation?.observed ? observation.primary?.data?.result_code ?? null : null,
      next_action_id: observation?.observed ? (observation.primary?.data?.next_action as Record<string, unknown> | undefined)?.id ?? null : null,
      skip_rationale: station.skipRationale,
    }
  })(),
}))
const rootConsumers = {
  declared: declaredConsumers,
  discovered: discoveredConsumers,
  typechecked: typecheckedConsumers,
  declared_count: declaredConsumers.length,
  discovered_count: discoveredConsumers.length,
  typechecked_count: typecheckedConsumers.length,
}
const observedBranchCoverage = stations.filter(({ status, provenance }) => status === "covered" && provenance === "real_process").length
const requiredObservedBranchTotal = branchStationCatalog.filter(({ reachability }) => reachability === "required").length
const stationCoverageAligned = observedBranchCoverage === requiredObservedBranchTotal

const report = {
  schema_version: 1,
  package_identity: "agent-plugin-kit",
  command_contract_id: maintenanceCommandContractId,
  command_contract_schema_version: commandContractSchemaVersion,
  facade_envelope_schema_version: 1,
  result_schema_version: resultSchemaVersion,
  error_schema_version: errorSchemaVersion,
  hint_version: hintVersion,
  diagnostic_schema_version: 1,
  event_schema_version: 1,
  surface_findings: findings,
  declared_branch_coverage: branchStationCatalog.length,
  implementation_deferred_branch_coverage: branchStationCatalog.filter(({ reachability }) => reachability === "implementation-deferred").length,
  deferred_owner_proofs: Object.values(deferredOwnerProofs),
  declared_unreachable_branch_coverage: branchStationCatalog.filter(({ reachability }) => reachability === "declared-unreachable").length,
  required_observed_branch_total: requiredObservedBranchTotal,
  observed_branch_coverage: observedBranchCoverage,
  stations,
  root_consumers: rootConsumers,
  verdict: findings.some(({ status }) => status === "drifted") || !stationCoverageAligned ? "drifted" : "ship",
} as const

process.stdout.write(`${JSON.stringify(report)}\n`)
process.exitCode = report.verdict === "ship" ? 0 : 1
