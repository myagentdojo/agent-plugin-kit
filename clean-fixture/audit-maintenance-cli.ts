import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { z } from "zod"
import packageMetadata from "../package.json"
import {
  branchStationCatalog,
  deferredOwnerProofs,
  projectStationMap,
  type BranchStationEvidence,
} from "../src/modules/maintenance-command-contract/branch-stations"
import { commandContractSchemaVersion, commandVocabulary } from "../src/modules/maintenance-command-contract/command-vocabulary"
import { containmentExit, errorSchemaVersion, exitFamilies, failureNextActionProjection, hintVersion, maintenanceCommandContractId, resultSchemaVersion, resultVocabulary, transactionStateVocabulary } from "../src/modules/maintenance-command-contract/result-vocabulary"
import type { ResultCode } from "../src/modules/maintenance-command-contract/interface"
import { literalHelpProcess, literalUsageProcess } from "../src/modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"
import { literalDeclaredUnreachableRationales, literalRequiredStationIds } from "../src/modules/maintenance-command-contract/contract-tests/fixtures/literal-branch-stations"
import { literalProcessResult } from "./personal-verification-profile/contract-tests/fixtures/plugin-consumer"

const repositoryRoot = resolve(import.meta.dir, "..")
const facadeImplementation = resolve(repositoryRoot, "src/adapters/maintenance-command-facade/implementation/maintenance-command-facade.ts")
const facadeInterface = resolve(repositoryRoot, "src/adapters/maintenance-command-facade/interface.ts")
const facadeManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "src/adapters/maintenance-command-facade/package.json"), "utf8")) as { name: string }

const resultCodes = resultVocabulary.map(({ resultCode }) => resultCode) as [ResultCode, ...ResultCode[]]
const resultCodeSchema = z.enum(resultCodes)
const exitCodeSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(20),
  z.literal(21),
  z.literal(22),
  z.literal(23),
])
const reachabilitySchema = z.enum(["required", "implementation-deferred", "declared-unreachable"])
const stationStatusSchema = z.enum(["covered", "missing", "drifted", "skipped"])
const provenanceSchema = z.enum(["real_process", "synthetic"])
const consumerBindingSchema = z.strictObject({
  consumer: z.string().min(1),
  target: z.enum(["interface", "implementation"]),
  import_kind: z.enum(["type-only", "runtime"]),
})
const surfaceFindingSchema = z.strictObject({
  surface: z.string().min(1),
  status: z.enum(["aligned", "drifted"]),
  detail: z.string().min(1),
})
const stationSchema = z.strictObject({
  station_id: z.string().min(1),
  expected_reachability: reachabilitySchema,
  expected_result_code: resultCodeSchema,
  expected_exit_code: exitCodeSchema,
  expected_next_action_id: z.string().min(1),
  expected_envelope_status: z.enum(["ok", "error"]),
  expected_transaction_state: z.enum(transactionStateVocabulary),
  status: stationStatusSchema,
  provenance: provenanceSchema,
  argv: z.array(z.string()).nullable(),
  exit_code: z.number().int().nullable(),
  deadline_ms: z.number().int().positive().nullable(),
  timed_out: z.boolean().nullable(),
  result_code: resultCodeSchema.nullable(),
  next_action_id: z.string().min(1).nullable(),
  skip_rationale: z.string().nullable(),
})
const deferredOwnerProofSchema = z.strictObject({
  controllingOwnerId: z.string().min(1),
  stationIds: z.array(z.string().min(1)),
  futureSelector: z.string().min(1),
  expectedTestCount: z.number().int().nonnegative(),
  skipRationale: z.string().min(1),
  nonClaim: z.string().min(1),
})
const rootConsumerSchema = z.strictObject({
  declared: z.array(z.string()),
  discovered: z.array(z.string()),
  typechecked: z.array(z.string()),
  declared_bindings: z.array(consumerBindingSchema),
  discovered_bindings: z.array(consumerBindingSchema),
  typechecked_bindings: z.array(consumerBindingSchema),
  declared_count: z.number().int().nonnegative(),
  discovered_count: z.number().int().nonnegative(),
  typechecked_count: z.number().int().nonnegative(),
})

export const auditReportSchema = z.strictObject({
  schema_version: z.literal(1),
  package_identity: z.literal("agent-plugin-kit"),
  command_contract_id: z.literal(maintenanceCommandContractId),
  command_contract_schema_version: z.literal(commandContractSchemaVersion),
  facade_envelope_schema_version: z.literal(1),
  result_schema_version: z.literal(resultSchemaVersion),
  error_schema_version: z.literal(errorSchemaVersion),
  hint_version: z.literal(hintVersion),
  diagnostic_schema_version: z.literal(2),
  event_schema_version: z.literal(1),
  surface_findings: z.array(surfaceFindingSchema),
  declared_branch_coverage: z.number().int().nonnegative(),
  implementation_deferred_branch_coverage: z.number().int().nonnegative(),
  deferred_owner_proofs: z.array(deferredOwnerProofSchema),
  declared_unreachable_branch_coverage: z.number().int().nonnegative(),
  required_observed_branch_total: z.number().int().nonnegative(),
  observed_branch_coverage: z.number().int().nonnegative(),
  stations: z.array(stationSchema),
  root_consumers: rootConsumerSchema,
  verdict: z.enum(["ship", "drifted"]),
})

export type AuditReport = z.infer<typeof auditReportSchema>
export type AuditStation = z.infer<typeof stationSchema>
export type RootConsumerReport = z.infer<typeof rootConsumerSchema>

const canonicalRequiredStations = branchStationCatalog.filter(({ reachability }) => reachability === "required")
const canonicalStationIds = branchStationCatalog.map(({ stationId }) => stationId)

const stationExpectationAligned = (actual: AuditStation, expected: (typeof branchStationCatalog)[number]): boolean =>
  JSON.stringify({
    reachability: actual.expected_reachability,
    resultCode: actual.expected_result_code,
    exitCode: actual.expected_exit_code,
    nextActionId: actual.expected_next_action_id,
    envelopeStatus: actual.expected_envelope_status,
    transactionState: actual.expected_transaction_state,
    skipRationale: actual.skip_rationale,
  }) === JSON.stringify({
    reachability: expected.reachability,
    resultCode: expected.expectedResultCode,
    exitCode: expected.expectedExitClass,
    nextActionId: expected.expectedNextActionId,
    envelopeStatus: expected.expectedEnvelopeStatus,
    transactionState: expected.expectedTransactionState,
    skipRationale: expected.skipRationale,
  })

export const requiredStationProjectionAligned = (
  stations: readonly AuditStation[],
): boolean => {
  if (JSON.stringify(stations.map(({ station_id }) => station_id)) !== JSON.stringify(canonicalStationIds)) return false
  if (new Set(stations.map(({ station_id }) => station_id)).size !== stations.length) return false
  if (JSON.stringify(canonicalRequiredStations.map(({ stationId }) => stationId)) !== JSON.stringify(literalRequiredStationIds)) return false

  const required = canonicalRequiredStations.every((expected) => {
    const actual = stations.find(({ station_id }) => station_id === expected.stationId)
    if (actual === undefined) return false
    return [
      stationExpectationAligned(actual, expected),
      actual.status === "covered",
      actual.provenance === "real_process",
      actual.result_code === expected.expectedResultCode,
      actual.exit_code === expected.expectedExitClass,
      actual.next_action_id === expected.expectedNextActionId,
    ].every(Boolean)
  })
  if (!required) return false

  const observed = stations.filter(({ status, provenance }) => status === "covered" && provenance === "real_process")
  const observedCountAligned = observed.length === canonicalRequiredStations.length
  const observedReachabilityAligned = observed.every(({ expected_reachability }) => expected_reachability === "required")
  const catalogFieldsAligned = stations.every((actual) => {
    const expected = branchStationCatalog.find(({ stationId }) => stationId === actual.station_id)
    return expected !== undefined && stationExpectationAligned(actual, expected)
  })
  return [observedCountAligned, observedReachabilityAligned, catalogFieldsAligned].every(Boolean)
}

const consumerBindingKey = ({ consumer, target, import_kind }: z.infer<typeof consumerBindingSchema>): string =>
  `${consumer}\u0000${target}\u0000${import_kind}`

const consumerBindingsEqual = (
  left: readonly z.infer<typeof consumerBindingSchema>[],
  right: readonly z.infer<typeof consumerBindingSchema>[],
): boolean => JSON.stringify(left.map(consumerBindingKey).sort()) === JSON.stringify(right.map(consumerBindingKey).sort())

export const rootConsumerEnumerationAligned = (
  consumers: RootConsumerReport,
): boolean => {
  const pathsEqual = JSON.stringify(consumers.declared) === JSON.stringify(consumers.discovered) &&
    JSON.stringify(consumers.discovered) === JSON.stringify(consumers.typechecked)
  const bindingsEqual = consumerBindingsEqual(consumers.declared_bindings, consumers.discovered_bindings) &&
    consumerBindingsEqual(consumers.discovered_bindings, consumers.typechecked_bindings)
  const countsMatch = consumers.declared_count === consumers.declared.length &&
    consumers.discovered_count === consumers.discovered.length &&
    consumers.typechecked_count === consumers.typechecked.length
  const bindingPaths = (bindings: readonly z.infer<typeof consumerBindingSchema>[]): string[] =>
    [...new Set(bindings.map(({ consumer }) => consumer))].sort()
  const noDuplicateBindings = (bindings: readonly z.infer<typeof consumerBindingSchema>[]): boolean =>
    new Set(bindings.map(consumerBindingKey)).size === bindings.length
  return pathsEqual && bindingsEqual && countsMatch &&
    JSON.stringify(consumers.declared) === JSON.stringify(bindingPaths(consumers.declared_bindings)) &&
    JSON.stringify(consumers.discovered) === JSON.stringify(bindingPaths(consumers.discovered_bindings)) &&
    JSON.stringify(consumers.typechecked) === JSON.stringify(bindingPaths(consumers.typechecked_bindings)) &&
    noDuplicateBindings(consumers.declared_bindings) &&
    noDuplicateBindings(consumers.discovered_bindings) &&
    noDuplicateBindings(consumers.typechecked_bindings)
}

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
compare("contract_ids", [helpEnvelope.data.contract_id, help.contract_id], [maintenanceCommandContractId, maintenanceCommandContractId])
compare("result_schema_versions", [helpEnvelope.data.result_schema_version, help.schemaVersion, (help.versions as Record<string, number>).result], [resultSchemaVersion, resultSchemaVersion, resultSchemaVersion])
compare("help_version_carriers", {
  envelope: helpEnvelope.schema_version,
  result: helpEnvelope.data.result_schema_version,
  help: help.schemaVersion,
  facade: (help.versions as Record<string, number>).facade_envelope,
  error: (help.versions as Record<string, number>).error,
  hint: (help.versions as Record<string, number>).hint,
  diagnostic: (help.versions as Record<string, number>).diagnostic,
  event: (help.versions as Record<string, number>).event,
}, {
  envelope: 1,
  result: resultSchemaVersion,
  help: resultSchemaVersion,
  facade: 1,
  error: errorSchemaVersion,
  hint: hintVersion,
  diagnostic: 2,
  event: 1,
})
compare("command_contract_schema_version", commandContractSchemaVersion, resultSchemaVersion)
compare("environment_dependencies", (help.environment_dependencies as { name: string }[]).map(({ name }) => name), ["AGENT_PLUGIN_KIT_EVENT_ENDPOINT", "AGENT_PLUGIN_KIT_EVENT_AUTH"])
compare("command_vocabulary", (help.commands as { command: string }[]).map(({ command }) => command), commandVocabulary.map(({ command }) => command))
compare("exit_families", (help.exits as { typed: { family_id: string; exit: number; owner: string; result_codes: string[]; envelope: boolean; meaning: string }[] }).typed.map(({ family_id, exit, owner, result_codes, envelope, meaning }) => ({ family_id, exit, owner, result_codes, envelope, meaning })), exitFamilies.map(({ familyId, exit, owner, resultCodes, envelope, meaning }) => ({ family_id: familyId, exit, owner, result_codes: resultCodes, envelope, meaning })))
compare("containment_exit", (help.exits as { containment: { family_id: string; exit: number; owner: string; result_codes: string[]; envelope: boolean; meaning: string }[] }).containment, [{
  family_id: containmentExit.familyId,
  exit: containmentExit.exit,
  owner: containmentExit.owner,
  result_codes: containmentExit.resultCodes,
  envelope: containmentExit.envelope,
  meaning: containmentExit.meaning,
}])
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
const usageDiagnosticExpectations = [
  {
    timestamp: true,
    schema_version: 2,
    record_type: "diagnostic",
    sequence: 1,
    category: ["agent-plugin-kit", "maintenance"],
    event: "maintenance.outcome-context",
    run_id: "contract-help-literal",
    station_id: "maintenance.usage-refused",
    result_code: "usage-refused",
    transaction_state: "unchanged",
    retry_safety: "safe",
    message: 'Maintenance command reached result code "usage-refused".',
    level: "info",
  },
  {
    timestamp: true,
    schema_version: 2,
    record_type: "diagnostic",
    sequence: 2,
    category: ["agent-plugin-kit", "maintenance"],
    event: "maintenance.usage-refused",
    run_id: "contract-help-literal",
    station_id: "maintenance.usage-refused",
    failure_class: "usage",
    result_code: "usage-refused",
    transaction_state: "unchanged",
    retry_safety: "safe",
    message: 'Maintenance command failed with result code "usage-refused".',
    level: "error",
    next_action: {
      id: "maintenance.show-help",
      action: "change_input",
      summary: "Choose a command from machine discovery.",
      commandId: "help",
    },
  },
] as const
const jsonRecordFor = (line: string): Record<string, unknown> | undefined => {
  try {
    const parsed = JSON.parse(line) as unknown
    return typeof parsed === "object" && parsed !== null
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}
const jsonLinesFor = (stream: string): string[] | undefined => {
  if (!stream.endsWith("\n")) return undefined
  const lines = stream.slice(0, -1).split("\n")
  return lines.every((line) => line !== "") ? lines : undefined
}
const normalizedDiagnosticFor = (record: Record<string, unknown> | undefined): unknown => {
  if (record === undefined) return undefined
  const { timestamp, ...stableFields } = record
  return {
    timestamp: typeof timestamp === "string" && !Number.isNaN(Date.parse(timestamp)),
    ...stableFields,
  }
}
const usageDiagnosticsMatch = (stderr: string, expectedPrimary: string): boolean => {
  const lines = jsonLinesFor(stderr)
  if (lines === undefined || lines.length !== 3 || lines[2] !== expectedPrimary) return false
  const diagnostics = lines.slice(0, 2).map(jsonRecordFor).map(normalizedDiagnosticFor)
  return JSON.stringify(diagnostics) === JSON.stringify(usageDiagnosticExpectations)
}
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
  const parsedPrimary = jsonRecordFor(primaryLine ?? "")
  const data = typeof parsedPrimary?.data === "object" && parsedPrimary.data !== null && !Array.isArray(parsedPrimary.data)
    ? parsedPrimary.data as Record<string, unknown>
    : undefined
  const primary: { data?: Record<string, unknown> } = data === undefined ? {} : { data }
  const observed = result.exitCode === scenario.expected.exitCode &&
    stdout === scenario.expected.stdout &&
    (scenario.stationId === "maintenance.usage-refused"
      ? stdout === "" && usageDiagnosticsMatch(stderr, scenario.expected.stderr.trimEnd())
      : stderr === scenario.expected.stderr)
  return {
    ...scenario,
    exitCode: result.exitCode,
    stdout,
    stderr,
    primary,
    observed,
    deadlineMs: publicProcessDeadlineMs,
    timedOut: result.signalCode === "SIGKILL",
  }
})
const implementationAbsent = requiredObservations.every(({ exitCode, stderr }) => exitCode === 1 && stderr.includes("implementation-absent"))
const publicProcessesAligned = requiredObservations.every(({ observed }) => observed)
findings.push({ surface: "public_process", status: publicProcessesAligned ? "aligned" : "drifted", detail: implementationAbsent ? "implementation-absent" : publicProcessesAligned ? "two-required-stations-observed" : "required-observation-drift" })

const resolveRelativeModule = (importer: string, specifier: string) => {
  const candidate = resolve(dirname(importer), specifier)
  return [candidate, `${candidate}.ts`, resolve(candidate, "interface.ts"), resolve(candidate, "index.ts")].find((path) => existsSync(path))
}
type ConsumerImport = z.infer<typeof consumerBindingSchema>

const declaredConsumerBindings = [
  {
    consumer: "src/adapters/maintenance-command-facade/implementation/logtape-diagnostic-adapter.ts",
    target: "interface",
    import_kind: "type-only",
  },
  {
    consumer: "src/adapters/maintenance-command-facade/implementation/maintenance-command-facade.ts",
    target: "interface",
    import_kind: "type-only",
  },
  {
    consumer: "src/adapters/maintenance-command-facade/implementation/maintenance-event-adapter.ts",
    target: "interface",
    import_kind: "type-only",
  },
  {
    consumer: "src/adapters/maintenance-command-facade/maintenance.ts",
    target: "implementation",
    import_kind: "runtime",
  },
  {
    consumer: "src/adapters/maintenance-command-facade/maintenance.ts",
    target: "interface",
    import_kind: "type-only",
  },
  {
    consumer: "src/adapters/maintenance-command-facade/serialized-values.ts",
    target: "interface",
    import_kind: "type-only",
  },
] as const satisfies readonly ConsumerImport[]

type ModuleSpecifier = {
  specifier: string
  importKind: "type-only" | "runtime"
}

const moduleSpecifiersFor = (file: string): ModuleSpecifier[] => {
  const loader = file.endsWith(".tsx") ? "tsx" : "ts"
  const source = readFileSync(file, "utf8").replace(/^#![^\n]*\n/, "")
  const scan = (value: string): string[] => new Bun.Transpiler({ loader }).scan(value).imports.map(({ path }) => path)
  const runtimeSpecifiers = new Set(scan(source))
  const typeAwareSource = source
    .replaceAll("import type", "import")
    .replace(/\b(import|export)(\s*\{\s*)type\b/g, "$1$2")
  return [...new Set(scan(typeAwareSource))].map((specifier) => ({
    specifier,
    importKind: runtimeSpecifiers.has(specifier) ? "runtime" : "type-only",
  }))
}
const relativeImports = (file: string) => {
  return moduleSpecifiersFor(file).flatMap(({ specifier, importKind }) => {
    if (specifier === facadeManifest.name) return [{ resolved: facadeInterface, importKind }]
    if (specifier.startsWith(`${facadeManifest.name}/`)) throw new Error(`${file} imports a forbidden facade owner subpath: ${specifier}`)
    if (!specifier.startsWith(".")) return []
    const resolved = resolveRelativeModule(file, specifier)
    return resolved ? [{ resolved, importKind }] : []
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
const discoveredBindings: ConsumerImport[] = []
const discoveredBindingKeys = new Set<string>()
const walkProductionImports = (file: string) => {
  if (visited.has(file)) return
  visited.add(file)
  for (const { resolved, importKind } of relativeImports(file)) {
    const target = resolved === facadeInterface ? "interface" : resolved === facadeImplementation ? "implementation" : undefined
    if (target !== undefined) {
      const binding: ConsumerImport = {
        consumer: relative(repositoryRoot, file),
        target,
        import_kind: importKind,
      }
      const key = consumerBindingKey(binding)
      if (!discoveredBindingKeys.has(key)) {
        discoveredBindingKeys.add(key)
        discoveredBindings.push(binding)
      }
    }
    walkProductionImports(resolved)
  }
}
for (const entry of graphEntries) walkProductionImports(entry)
const sortConsumerBindings = (bindings: readonly ConsumerImport[]): ConsumerImport[] =>
  [...bindings].sort((left, right) => consumerBindingKey(left).localeCompare(consumerBindingKey(right)))
const consumerPathsFor = (bindings: readonly ConsumerImport[]): string[] =>
  [...new Set(bindings.map(({ consumer }) => consumer))].sort()
const declaredBindings = sortConsumerBindings(declaredConsumerBindings)
const discoveredConsumerBindings = sortConsumerBindings(discoveredBindings)
const declaredConsumers = consumerPathsFor(declaredBindings)
const discoveredConsumers = consumerPathsFor(discoveredConsumerBindings)
const typecheckResult = Bun.spawnSync({
  cmd: ["bun", "run", "typecheck"],
  cwd: repositoryRoot,
  env: { ...process.env, NO_COLOR: "1" },
  stdout: "pipe",
  stderr: "pipe",
})
const typecheckedConsumers = typecheckResult.exitCode === 0 ? discoveredConsumers : []
const typecheckedConsumerBindings = typecheckResult.exitCode === 0 ? discoveredConsumerBindings : []
compare("root_consumers", declaredConsumers, discoveredConsumers)
compare("root_consumer_typecheck", discoveredConsumers, typecheckedConsumers)
compare("root_consumer_bindings", declaredBindings, discoveredConsumerBindings)
compare("root_consumer_binding_typecheck", discoveredConsumerBindings, typecheckedConsumerBindings)

const processEvidence: BranchStationEvidence[] = requiredObservations.map((observation) => {
  const resultCode = resultCodeSchema.safeParse(observation.primary.data?.result_code)
  return {
    stationId: observation.stationId,
    status: observation.observed ? "covered" : "drifted",
    provenance: "real_process",
    ...(resultCode.success ? { observedResultCode: resultCode.data } : {}),
    observedExitClass: observation.exitCode,
  }
})
const projectedStationMap = projectStationMap(branchStationCatalog, processEvidence)
type RequiredObservation = (typeof requiredObservations)[number]

const projectionStatusFor = (projection: BranchStationEvidence | undefined): AuditStation["status"] =>
  projection === undefined ? "drifted" : projection.status
const projectionProvenanceFor = (projection: BranchStationEvidence | undefined): AuditStation["provenance"] =>
  projection === undefined ? "synthetic" : projection.provenance

const observationFieldsFor = (observation: RequiredObservation | undefined) => {
  if (observation === undefined) {
    return { argv: null, exit_code: null, deadline_ms: null, timed_out: null }
  }
  return {
    argv: [...observation.argv],
    exit_code: observation.exitCode,
    deadline_ms: observation.deadlineMs,
    timed_out: observation.timedOut,
  }
}

const observedResultCodeFor = (observation: RequiredObservation | undefined): ResultCode | null => {
  const result = resultCodeSchema.safeParse(observation === undefined ? undefined : observation.primary.data?.result_code)
  return result.success ? result.data : null
}
const observedNextActionIdFor = (observation: RequiredObservation | undefined): string | null => {
  const nextAction = observation === undefined ? undefined : observation.primary.data?.next_action
  if (typeof nextAction !== "object" || nextAction === null || !("id" in nextAction) || typeof nextAction.id !== "string") return null
  return nextAction.id
}
const stationObservedValuesFor = (status: AuditStation["status"], observation: RequiredObservation | undefined) => {
  if (status !== "covered") return { result_code: null, next_action_id: null }
  return {
    result_code: observedResultCodeFor(observation),
    next_action_id: observedNextActionIdFor(observation),
  }
}
const auditStationFor = (
  station: (typeof branchStationCatalog)[number],
  projection: BranchStationEvidence | undefined,
  observation: RequiredObservation | undefined,
): AuditStation => {
  const status = projectionStatusFor(projection)
  return {
    station_id: station.stationId,
    expected_reachability: station.reachability,
    expected_result_code: station.expectedResultCode,
    expected_exit_code: station.expectedExitClass,
    expected_next_action_id: station.expectedNextActionId,
    expected_envelope_status: station.expectedEnvelopeStatus,
    expected_transaction_state: station.expectedTransactionState,
    status,
    provenance: projectionProvenanceFor(projection),
    ...observationFieldsFor(observation),
    ...stationObservedValuesFor(status, observation),
    skip_rationale: station.skipRationale,
  }
}
const stations: AuditStation[] = branchStationCatalog.map((station, index) => auditStationFor(
  station,
  projectedStationMap.stations[index],
  requiredObservations.find(({ stationId }) => stationId === station.stationId),
))
const rootConsumers = {
  declared: declaredConsumers,
  discovered: discoveredConsumers,
  typechecked: typecheckedConsumers,
  declared_bindings: declaredBindings,
  discovered_bindings: discoveredConsumerBindings,
  typechecked_bindings: typecheckedConsumerBindings,
  declared_count: declaredConsumers.length,
  discovered_count: discoveredConsumers.length,
  typechecked_count: typecheckedConsumers.length,
}
const observedBranchCoverage = projectedStationMap.observedBranchCoverage
const requiredObservedBranchTotal = projectedStationMap.requiredObservedBranchTotal
const stationCoverageAligned = requiredStationProjectionAligned(stations)
findings.push({ surface: "branch_station_projection", status: stationCoverageAligned ? "aligned" : "drifted", detail: stationCoverageAligned ? "exact-required-stations" : "station-projection-drift" })

const report = {
  schema_version: 1,
  package_identity: "agent-plugin-kit",
  command_contract_id: maintenanceCommandContractId,
  command_contract_schema_version: commandContractSchemaVersion,
  facade_envelope_schema_version: 1,
  result_schema_version: resultSchemaVersion,
  error_schema_version: errorSchemaVersion,
  hint_version: hintVersion,
  diagnostic_schema_version: 2,
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

if (import.meta.main) {
  const parsedReport = auditReportSchema.safeParse(report)
  if (!parsedReport.success) {
    process.stderr.write("Command Surface Alignment report failed schema validation.\n")
    process.exitCode = 1
  } else {
    process.stdout.write(`${JSON.stringify(parsedReport.data)}\n`)
    process.exitCode = parsedReport.data.verdict === "ship" ? 0 : 1
  }
}
