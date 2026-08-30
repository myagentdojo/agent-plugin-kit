import { lstatSync, readFileSync, readdirSync, realpathSync, type Dirent, type Stats } from "node:fs"
import { basename, isAbsolute, relative, resolve, sep } from "node:path"

export type RepositoryFinding = Readonly<{
	code:
		| "export-target-invalid"
		| "owner-manifest-invalid"
		| "dependency-locality-invalid"
		| "source-path-escape"
	path: string
	repair: string
}>

export type RepositoryOperationalError = Readonly<{
	code: "manifest-unreadable" | "filesystem-unreadable"
	path: string
	repair: string
}>

export type RepositoryVerification =
	| Readonly<{ ok: true }>
	| Readonly<{
			ok: false
			kind: "repository-findings"
			findings: readonly [RepositoryFinding, ...RepositoryFinding[]]
	  }>
	| Readonly<{ ok: false; kind: "operational-error"; error: RepositoryOperationalError }>

export type RepositoryProcessEnvelope =
	| Readonly<{ schemaVersion: 1; decision: "qualified"; findings: readonly []; error: null }>
	| Readonly<{
			schemaVersion: 1
			decision: "refused"
			findings: readonly [RepositoryFinding, ...RepositoryFinding[]]
			error: null
	  }>
	| Readonly<{
			schemaVersion: 1
			decision: "error"
			findings: readonly []
			error: RepositoryOperationalError
	  }>

export type RepositoryErrorDiagnostic =
	`repository-verification error ${RepositoryOperationalError["code"]} ${string}: ${string}\n`

export type RepositoryProcessResult =
	| Readonly<{
			exitCode: 0
			envelope: Extract<RepositoryProcessEnvelope, { decision: "qualified" }>
			stderr: ""
	  }>
	| Readonly<{
			exitCode: 1
			envelope: Extract<RepositoryProcessEnvelope, { decision: "refused" }>
			stderr: ""
	  }>
	| Readonly<{
			exitCode: 2
			envelope: Extract<RepositoryProcessEnvelope, { decision: "error" }>
			stderr: RepositoryErrorDiagnostic
	  }>

type JsonObject = Record<string, unknown>
type Owner = Readonly<{ root: string; path: string; manifestPath: string; manifest: JsonObject }>

const dependencyFields = ["dependencies", "optionalDependencies", "peerDependencies"] as const
const allDependencyFields = [...dependencyFields, "devDependencies"] as const
const sourceExtensions = [".ts", ".tsx", ".mts", ".cts"] as const
const excludedSourceEntries = new Set([".git", ".fallow", "node_modules", "dist", "coverage"])

function posixPath(path: string): string {
	return path.split(sep).join("/") || "."
}

function repositoryPath(root: string, path: string): string {
	return posixPath(relative(root, path))
}

function contained(root: string, path: string): boolean {
	const candidate = relative(root, path)
	return candidate === "" || (!candidate.startsWith(`..${sep}`) && candidate !== ".." && !isAbsolute(candidate))
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0
}

function finding(code: RepositoryFinding["code"], path: string): RepositoryFinding {
	const repair =
		code === "export-target-invalid"
			? `Make ${path} a regular repository-contained export target.`
			: code === "owner-manifest-invalid"
				? `Repair ${path} so it satisfies the Owner Manifest discovery and shape contract.`
				: code === "dependency-locality-invalid"
					? `Align dependency declarations in ${path} with the exact owner and root versions.`
					: `Replace ${path} with a regular path contained by the canonical repository root.`
	return { code, path, repair }
}

function operationalError(code: RepositoryOperationalError["code"], path: string): RepositoryOperationalError {
	const repair =
		code === "manifest-unreadable"
			? `Repair ${path} so it is readable valid JSON, then rerun repository verification.`
			: `Repair filesystem access for ${path}, then rerun repository verification.`
	return { code, path, repair }
}

function readManifest(
	root: string,
	path: string,
): Readonly<{ ok: true; value: JsonObject }> | Readonly<{ ok: false; error: RepositoryOperationalError }> {
	const displayPath = repositoryPath(root, path)
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return { ok: false, error: operationalError("manifest-unreadable", displayPath) }
		}
		return { ok: true, value: parsed as JsonObject }
	} catch {
		return { ok: false, error: operationalError("manifest-unreadable", displayPath) }
	}
}

function objectField(value: JsonObject, key: string): JsonObject | undefined {
	const field = value[key]
	return typeof field === "object" && field !== null && !Array.isArray(field) ? (field as JsonObject) : undefined
}

type DependencyInspection = Readonly<{ values: ReadonlyMap<string, string>; valid: boolean }>

function inspectDependencies(manifest: JsonObject, fields: readonly string[]): DependencyInspection {
	const dependencies = new Map<string, string>()
	let valid = true
	for (const field of fields) {
		const value = manifest[field]
		if (value === undefined) continue
		const entries = objectField(manifest, field)
		if (entries === undefined) {
			valid = false
			continue
		}
		for (const [name, version] of Object.entries(entries)) {
			if (typeof version !== "string" || dependencies.has(name)) {
				valid = false
				continue
			}
			dependencies.set(name, version)
		}
	}
	return { values: dependencies, valid }
}

function workspacePatternValid(pattern: string): boolean {
	if (pattern === "" || isAbsolute(pattern) || pattern.includes("\\") || !pattern.startsWith("src/")) return false
	const segments = pattern.split("/")
	if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false
	const starSegments = segments.filter((segment) => segment.includes("*"))
	return starSegments.length === 0 || (starSegments.length === 1 && segments.at(-1) === "*" && pattern.endsWith("/*"))
}

function sortedEntries(root: string, path: string): readonly Dirent<string>[] | RepositoryOperationalError {
	try {
		return readdirSync(path, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))
	} catch {
		return operationalError("filesystem-unreadable", repositoryPath(root, path))
	}
}

type MetadataResult =
	| Readonly<{ ok: true; metadata: Stats }>
	| Readonly<{ ok: false; missing: true }>
	| Readonly<{ ok: false; missing: false; error: RepositoryOperationalError }>

function inspectMetadata(root: string, path: string): MetadataResult {
	try {
		return { ok: true, metadata: lstatSync(path) }
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: false, missing: true }
		return { ok: false, missing: false, error: operationalError("filesystem-unreadable", repositoryPath(root, path)) }
	}
}

function workspaceMatches(
	root: string,
	pattern: string,
): Readonly<{ ok: true; paths: readonly string[] }> | Readonly<{ ok: false; error: RepositoryOperationalError }> {
	if (!pattern.endsWith("/*")) {
		const path = resolve(root, pattern)
		const metadata = inspectMetadata(root, path)
		if (!metadata.ok) return metadata.missing ? { ok: true, paths: [] } : { ok: false, error: metadata.error }
		return { ok: true, paths: [path] }
	}
	const parent = resolve(root, pattern.slice(0, -2))
	const metadata = inspectMetadata(root, parent)
	if (!metadata.ok) return metadata.missing ? { ok: true, paths: [] } : { ok: false, error: metadata.error }
	if (!metadata.metadata.isDirectory()) return { ok: true, paths: [] }
	const entries = sortedEntries(root, parent)
	if ("code" in entries) return { ok: false, error: entries }
	return {
		ok: true,
		paths: entries
			.filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
			.map((entry) => resolve(parent, entry.name)),
	}
}

function declaredWorkspacePatterns(manifest: JsonObject, findings: RepositoryFinding[]): readonly string[] | undefined {
	const patterns = manifest.workspaces
	if (!Array.isArray(patterns) || patterns.some((pattern) => typeof pattern !== "string")) {
		findings.push(finding("owner-manifest-invalid", "package.json#workspaces"))
		return undefined
	}
	const typedPatterns = patterns as string[]
	if (new Set(typedPatterns).size !== typedPatterns.length || typedPatterns.some((pattern) => !workspacePatternValid(pattern))) {
		findings.push(finding("owner-manifest-invalid", "package.json#workspaces"))
		return undefined
	}
	return typedPatterns
}

function collectWorkspaceMatches(
	root: string,
	patterns: readonly string[],
	findings: RepositoryFinding[],
): Readonly<{ ok: true; matches: ReadonlyMap<string, number> }> | Readonly<{ ok: false; error: RepositoryOperationalError }> {
	const matches = new Map<string, number>()
	for (const pattern of patterns) {
		const matched = workspaceMatches(root, pattern)
		if (!matched.ok) return matched
		if (matched.paths.length === 0) findings.push(finding("owner-manifest-invalid", "package.json#workspaces"))
		for (const path of matched.paths) matches.set(path, (matches.get(path) ?? 0) + 1)
	}
	if ([...matches.values()].some((count) => count > 1)) {
		findings.push(finding("owner-manifest-invalid", "package.json#workspaces"))
	}
	return { ok: true, matches }
}

function readOwnerManifest(
	root: string,
	ownerRoot: string,
	ownerPath: string,
	findings: RepositoryFinding[],
): Readonly<{ ok: true; owner?: Owner }> | Readonly<{ ok: false; error: RepositoryOperationalError }> {
	const absoluteManifestPath = resolve(ownerRoot, "package.json")
	const manifestPath = repositoryPath(root, absoluteManifestPath)
	const manifestMetadata = inspectMetadata(root, absoluteManifestPath)
	if (!manifestMetadata.ok) {
		if (!manifestMetadata.missing) return { ok: false, error: manifestMetadata.error }
		findings.push(finding("owner-manifest-invalid", manifestPath))
		return { ok: true }
	}
	if (manifestMetadata.metadata.isSymbolicLink()) {
		findings.push(finding("source-path-escape", manifestPath))
		return { ok: true }
	}
	if (!manifestMetadata.metadata.isFile()) {
		findings.push(finding("owner-manifest-invalid", manifestPath))
		return { ok: true }
	}
	const manifest = readManifest(root, absoluteManifestPath)
	if (!manifest.ok) return manifest
	return { ok: true, owner: { root: ownerRoot, path: ownerPath, manifestPath, manifest: manifest.value } }
}

function readOwner(
	root: string,
	ownerRoot: string,
	findings: RepositoryFinding[],
): Readonly<{ ok: true; owner?: Owner }> | Readonly<{ ok: false; error: RepositoryOperationalError }> {
	const ownerPath = repositoryPath(root, ownerRoot)
	const ownerMetadata = inspectMetadata(root, ownerRoot)
	if (!ownerMetadata.ok) {
		if (!ownerMetadata.missing) return { ok: false, error: ownerMetadata.error }
		findings.push(finding("owner-manifest-invalid", `${ownerPath}/package.json`))
		return { ok: true }
	}
	if (ownerMetadata.metadata.isSymbolicLink()) {
		findings.push(finding("source-path-escape", ownerPath))
		return { ok: true }
	}
	if (!ownerMetadata.metadata.isDirectory()) {
		findings.push(finding("owner-manifest-invalid", `${ownerPath}/package.json`))
		return { ok: true }
	}

	return readOwnerManifest(root, ownerRoot, ownerPath, findings)
}

function discoverOwners(
	root: string,
	manifest: JsonObject,
	findings: RepositoryFinding[],
): Readonly<{ ok: true; owners: readonly Owner[] }> | Readonly<{ ok: false; error: RepositoryOperationalError }> {
	const patterns = declaredWorkspacePatterns(manifest, findings)
	if (patterns === undefined) return { ok: true, owners: [] }
	const matches = collectWorkspaceMatches(root, patterns, findings)
	if (!matches.ok) return matches

	const owners: Owner[] = []
	for (const ownerRoot of [...matches.matches.keys()].sort((left, right) =>
		compareText(repositoryPath(root, left), repositoryPath(root, right)),
	)) {
		const result = readOwner(root, ownerRoot, findings)
		if (!result.ok) return result
		if (result.owner !== undefined) owners.push(result.owner)
	}
	return { ok: true, owners }
}

function checkOwnerShapes(rootName: string, owners: readonly Owner[], findings: RepositoryFinding[]): void {
	for (const owner of owners) {
		const valid =
			owner.manifest.name === `@${rootName}/${basename(owner.root)}` &&
			owner.manifest.private === true &&
			owner.manifest.type === "module"
		if (!valid) findings.push(finding("owner-manifest-invalid", owner.manifestPath))
	}
}

function dependencyVersions(
	owners: readonly Owner[],
	findings: RepositoryFinding[],
): ReadonlyMap<string, ReadonlyMap<string, readonly string[]>> {
	const dependencies = new Map<string, Map<string, string[]>>()
	for (const owner of owners) {
		const inspected = inspectDependencies(owner.manifest, allDependencyFields)
		if (!inspected.valid) findings.push(finding("dependency-locality-invalid", owner.manifestPath))
		for (const [name, version] of inspectDependencies(owner.manifest, dependencyFields).values) {
			const versions = dependencies.get(name) ?? new Map<string, string[]>()
			const paths = versions.get(version) ?? []
			paths.push(owner.manifestPath)
			versions.set(version, paths)
			dependencies.set(name, versions)
		}
	}
	return dependencies
}

function checkDependencyVersions(
	rootManifest: JsonObject,
	versions: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>,
	findings: RepositoryFinding[],
): void {
	for (const dependencyVersions of versions.values()) {
		if (dependencyVersions.size < 2) continue
		for (const path of dependencyVersions.values()) {
			for (const manifestPath of path) findings.push(finding("dependency-locality-invalid", manifestPath))
		}
	}
	const zodVersions = versions.get("zod")
	if (zodVersions === undefined || zodVersions.size !== 1) return
	const [zodVersion] = zodVersions.keys()
	const rootDependencies = inspectDependencies(rootManifest, allDependencyFields)
	if (!rootDependencies.valid || rootDependencies.values.get("zod") !== zodVersion) {
		findings.push(finding("dependency-locality-invalid", "package.json"))
	}
}

function checkAdmissionDependencies(owners: readonly Owner[], findings: RepositoryFinding[]): void {
	const admission = owners.find((owner) => owner.path === "src/admission-bootstrap")
	if (admission === undefined) {
		findings.push(finding("owner-manifest-invalid", "package.json#workspaces"))
		return
	}
	const dependencies = inspectDependencies(admission.manifest, allDependencyFields)
	const hasDependency = !dependencies.valid || dependencies.values.size > 0
	if (hasDependency) findings.push(finding("dependency-locality-invalid", admission.manifestPath))
}

function checkOwnerManifests(rootManifest: JsonObject, owners: readonly Owner[], findings: RepositoryFinding[]): void {
	const rootName = typeof rootManifest.name === "string" ? rootManifest.name : ""
	checkOwnerShapes(rootName, owners, findings)
	checkDependencyVersions(rootManifest, dependencyVersions(owners, findings), findings)
	checkAdmissionDependencies(owners, findings)
}

function collectExportTargets(value: unknown, targets: string[]): boolean {
	if (typeof value === "string") {
		targets.push(value)
		return true
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false
	const values = Object.values(value)
	return values.length > 0 && values.every((entry) => collectExportTargets(entry, targets))
}

function admissionExportValid(value: unknown): boolean {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false
	const record = value as JsonObject
	return (
		JSON.stringify(Object.keys(record)) === JSON.stringify(["types", "import", "default"]) &&
		record.types === "./src/admission-bootstrap/interface.ts" &&
		record.import === "./src/admission-bootstrap/implementation/admission-bootstrap.ts" &&
		record.default === "./src/admission-bootstrap/implementation/admission-bootstrap.ts"
	)
}

function normalizedExportTarget(target: string): Readonly<{ normalized: string; displayPath: string }> | undefined {
	const normalized = target.startsWith("./") ? target.slice(2) : target
	if (normalized === "" || isAbsolute(target) || normalized.startsWith("../")) return undefined
	return { normalized, displayPath: posixPath(normalized) }
}

function inspectExportMetadata(
	root: string,
	absolute: string,
	displayPath: string,
	findings: RepositoryFinding[],
): RepositoryOperationalError | undefined {
	const metadata = inspectMetadata(root, absolute)
	if (!metadata.ok) {
		if (!metadata.missing) return metadata.error
		findings.push(finding("export-target-invalid", displayPath))
		return undefined
	}
	if (metadata.metadata.isSymbolicLink()) {
		findings.push(finding("source-path-escape", displayPath))
		return undefined
	}
	if (!metadata.metadata.isFile()) {
		findings.push(finding("export-target-invalid", displayPath))
		return undefined
	}
	try {
		if (!contained(root, realpathSync(absolute))) findings.push(finding("source-path-escape", displayPath))
		return undefined
	} catch {
		return operationalError("filesystem-unreadable", displayPath)
	}
}

function inspectExportTarget(
	root: string,
	target: string,
	findings: RepositoryFinding[],
): RepositoryOperationalError | undefined {
	const targetPath = normalizedExportTarget(target)
	if (targetPath === undefined) {
		findings.push(finding("export-target-invalid", posixPath(target)))
		return undefined
	}
	return inspectExportMetadata(root, resolve(root, targetPath.normalized), targetPath.displayPath, findings)
}

function checkExports(root: string, manifest: JsonObject, findings: RepositoryFinding[]): RepositoryOperationalError | undefined {
	const exports = objectField(manifest, "exports")
	if (exports === undefined) {
		findings.push(finding("export-target-invalid", "package.json#exports"))
		return undefined
	}
	if (!admissionExportValid(exports["./admission-bootstrap"])) {
		findings.push(finding("owner-manifest-invalid", "package.json#exports./admission-bootstrap"))
	}

	const targets: string[] = []
	if (!collectExportTargets(exports, targets)) {
		findings.push(finding("export-target-invalid", "package.json#exports"))
	}
	for (const target of [...new Set(targets)].sort(compareText)) {
		const error = inspectExportTarget(root, target, findings)
		if (error !== undefined) return error
	}
	return undefined
}

function inspectSourceEntry(
	root: string,
	directory: string,
	entry: Dirent<string>,
	findings: RepositoryFinding[],
): RepositoryOperationalError | undefined {
	if (excludedSourceEntries.has(entry.name)) return undefined
	const absolute = resolve(directory, entry.name)
	const displayPath = repositoryPath(root, absolute)
	if (entry.isSymbolicLink()) {
		findings.push(finding("source-path-escape", displayPath))
		return undefined
	}
	if (entry.isDirectory()) return walkSourceDirectory(root, absolute, findings)
	if (!entry.isFile() || !sourceExtensions.some((extension) => entry.name.endsWith(extension))) return undefined
	try {
		if (!contained(root, realpathSync(absolute))) findings.push(finding("source-path-escape", displayPath))
		return undefined
	} catch {
		return operationalError("filesystem-unreadable", displayPath)
	}
}

function walkSourceDirectory(
	root: string,
	directory: string,
	findings: RepositoryFinding[],
): RepositoryOperationalError | undefined {
	const entries = sortedEntries(root, directory)
	if ("code" in entries) return entries
	for (const entry of entries) {
		const error = inspectSourceEntry(root, directory, entry, findings)
		if (error !== undefined) return error
	}
	return undefined
}

function checkSourceTree(root: string, findings: RepositoryFinding[]): RepositoryOperationalError | undefined {
	return walkSourceDirectory(root, resolve(root, "src"), findings)
}

function uniqueSorted(findings: readonly RepositoryFinding[]): readonly RepositoryFinding[] {
	const unique = new Map(findings.map((item) => [`${item.code}\0${item.path}\0${item.repair}`, item]))
	return [...unique.values()].sort(
		(left, right) =>
			compareText(left.code, right.code) || compareText(left.path, right.path) || compareText(left.repair, right.repair),
	)
}

export function projectRepositoryVerification(result: RepositoryVerification): RepositoryProcessResult {
	if (result.ok) {
		return {
			exitCode: 0,
			envelope: { schemaVersion: 1, decision: "qualified", findings: [], error: null },
			stderr: "",
		}
	}
	if (result.kind === "repository-findings") {
		return {
			exitCode: 1,
			envelope: { schemaVersion: 1, decision: "refused", findings: result.findings, error: null },
			stderr: "",
		}
	}
	return {
		exitCode: 2,
		envelope: { schemaVersion: 1, decision: "error", findings: [], error: result.error },
		stderr: `repository-verification error ${result.error.code} ${result.error.path}: ${result.error.repair}\n`,
	}
}

export function verifyRepository(requestedRoot: string): RepositoryVerification {
	let root: string
	try {
		root = realpathSync(requestedRoot)
	} catch {
		return { ok: false, kind: "operational-error", error: operationalError("filesystem-unreadable", ".") }
	}
	const rootManifest = readManifest(root, resolve(root, "package.json"))
	if (!rootManifest.ok) return { ok: false, kind: "operational-error", error: rootManifest.error }

	const findings: RepositoryFinding[] = []
	const owners = discoverOwners(root, rootManifest.value, findings)
	if (!owners.ok) return { ok: false, kind: "operational-error", error: owners.error }
	checkOwnerManifests(rootManifest.value, owners.owners, findings)
	const exportError = checkExports(root, rootManifest.value, findings)
	if (exportError !== undefined) return { ok: false, kind: "operational-error", error: exportError }
	const sourceError = checkSourceTree(root, findings)
	if (sourceError !== undefined) return { ok: false, kind: "operational-error", error: sourceError }

	const sorted = uniqueSorted(findings)
	const [first, ...remaining] = sorted
	return first === undefined
		? { ok: true }
		: { ok: false, kind: "repository-findings", findings: [first, ...remaining] }
}
