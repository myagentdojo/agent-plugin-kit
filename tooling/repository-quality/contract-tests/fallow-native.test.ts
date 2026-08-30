import { afterAll, expect, test } from "bun:test"
import { copyFile, cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const repositoryRoot = resolve(import.meta.dir, "../../..")
const fallowExecutable = resolve(repositoryRoot, "node_modules/.bin/fallow")
const temporaryRoots: string[] = []

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function git(root: string, ...argumentsAfterGit: readonly string[]): void {
	const result = Bun.spawnSync(["git", ...argumentsAfterGit], {
		cwd: root,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	})
	if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

async function createFixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "agent-plugin-kit-fallow-native-"))
	temporaryRoots.push(root)
	const config = (await Bun.file(resolve(repositoryRoot, ".fallowrc.json")).json()) as Record<string, unknown>
	delete config.boundaries
	await writeJson(join(root, ".fallowrc.json"), config)
	await writeJson(join(root, "package.json"), {
		name: "fallow-native-fixture",
		private: true,
		type: "module",
		devDependencies: { typescript: "7.0.2" },
	})
	await writeJson(join(root, "tsconfig.json"), {
		compilerOptions: {
			strict: true,
			noEmit: true,
			module: "Preserve",
			moduleResolution: "bundler",
			target: "ESNext",
		},
		include: ["src/**/*.ts"],
	})
	await mkdir(join(root, "node_modules"))
	await mkdir(join(root, "src"))
	await writeFile(join(root, "src/index.ts"), "export const ready = true\n")
	git(root, "init", "-q")
	git(root, "add", ".fallowrc.json", "package.json", "tsconfig.json", "src/index.ts")
	git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "baseline")
	return root
}

async function createArchitectureFixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "agent-plugin-kit-fallow-boundaries-"))
	temporaryRoots.push(root)
	for (const path of ["src", "clean-fixture", "tooling/repository-quality"] as const) {
		await cp(resolve(repositoryRoot, path), join(root, path), { recursive: true })
	}
	for (const path of [".fallowrc.json", "package.json", "tsconfig.json"] as const) {
		await copyFile(resolve(repositoryRoot, path), join(root, path))
	}
	await symlink(resolve(repositoryRoot, "node_modules"), join(root, "node_modules"), "dir")
	git(root, "init", "-q")
	git(root, "add", ".")
	git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "baseline")
	return root
}

async function runFallow(root: string, ...argumentsAfterFallow: readonly string[]): Promise<{
	exitCode: number
	stdout: string
	stderr: string
	document: Record<string, unknown>
}> {
	const child = Bun.spawn([fallowExecutable, ...argumentsAfterFallow], {
		cwd: root,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, FORCE_COLOR: "0" },
	})
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	])
	return { exitCode, stdout, stderr, document: JSON.parse(stdout) as Record<string, unknown> }
}

async function checkArchitecture(root: string) {
	return runFallow(
		root,
		"--no-cache",
		"audit",
		"--changed-since",
		"HEAD",
		"--format",
		"json",
		"--quiet",
	)
}

async function scanArchitecture(root: string) {
	return runFallow(
		root,
		"--no-cache",
		"dead-code",
		"--boundary-violations",
		"--format",
		"json",
		"--quiet",
	)
}

async function audit(root: string, base = "HEAD"): Promise<{
	exitCode: number
	stdout: string
	stderr: string
	document: Record<string, unknown>
}> {
	const child = Bun.spawn(
		[
			fallowExecutable,
			"audit",
			"--format",
			"json",
			"--quiet",
			"--changed-since",
			base,
			"--type-aware",
			"--type-aware-require",
			"complete",
		],
		{
			cwd: root,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, FORCE_COLOR: "0" },
		},
	)
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	])
	return { exitCode, stdout, stderr, document: JSON.parse(stdout) as Record<string, unknown> }
}

afterAll(async () => {
	await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })))
})

test("promotes applicable warn-default findings to a native refusal", async () => {
	const root = await createFixture()
	await writeJson(join(root, "package.json"), {
		name: "fallow-native-fixture",
		private: true,
		type: "module",
		devDependencies: { "left-pad": "1.3.0", typescript: "7.0.2" },
	})
	await writeJson(join(root, "node_modules/left-pad/package.json"), { name: "left-pad", version: "1.3.0" })
	const observed = await audit(root)
	expect(observed.exitCode).toBe(1)
	expect(observed.stderr).toBe("")
	expect(observed.document).toMatchObject({ kind: "audit", version: "3.19.0", verdict: "fail" })
	expect(observed.stdout.endsWith("\n")).toBe(true)
})

test("fails closed when complete type-aware evidence is unavailable", async () => {
	const root = await createFixture()
	await rm(join(root, "tsconfig.json"))
	await writeFile(join(root, "src/index.ts"), "export const ready = false\n")
	const observed = await audit(root)
	const typeAware = (observed.document._meta as Record<string, unknown>).type_aware as Record<string, unknown>
	expect(observed.exitCode).toBe(1)
	expect(observed.stderr).toBe("")
	expect(typeAware).toMatchObject({
		required_completeness: "complete",
		warning_count: 1,
		identity: { backend_family: "typescript-go", completeness: "unavailable" },
	})
})

test("preserves native operational exit two for an invalid comparison base", async () => {
	const root = await createFixture()
	const observed = await audit(root, "refs/heads/does-not-exist")
	expect(observed.exitCode).toBe(2)
	expect(observed.stderr).toBe(
		[
			"Warning: --changed-since failed for ref 'refs/heads/does-not-exist': fatal: ambiguous argument 'refs/heads/does-not-exist...HEAD': unknown revision or path not in the working tree.",
			"Use '--' to separate paths from revisions, like this:",
			"'git <command> [<revision>...] -- [<file>...]'",
			"",
		].join("\n"),
	)
	expect(observed.document).toEqual({
		error: true,
		message:
			"could not determine changed files for base ref 'refs/heads/does-not-exist'. Verify the ref exists in this git repository",
		exit_code: 2,
	})
})

test("resolves the complete architecture policy in first-match order", async () => {
	const observed = await runFallow(repositoryRoot, "list", "--boundaries", "--format", "json", "--quiet")
	const boundaries = observed.document.boundaries as {
		configured: boolean
		zones: Array<{ name: string; file_count: number }>
		rules: Array<{ from: string; allow: string[] }>
		logical_groups: Array<{ name: string; children: string[]; status: string }>
	}
	const config = (await Bun.file(resolve(repositoryRoot, ".fallowrc.json")).json()) as {
		boundaries: {
			rules: Array<{ from: string; allow?: string[]; allowTypeOnly?: string[] }>
		}
	}
	expect(observed.exitCode).toBe(0)
	expect(observed.stderr).toBe("")
	expect(boundaries.configured).toBe(true)
	expect(boundaries.zones.map(({ name }) => name)).toEqual([
		"source-tree-interface",
		"admission-bootstrap",
		"admission-bootstrap-implementation",
		"admission-bootstrap-contract-tests",
		"deep-module-contract-tests/maintenance-command-contract",
		"deep-module-contract-tests/qualification-evidence",
		"maintenance-command-facade-contract-tests",
		"deep-modules/canary-qualification",
		"deep-modules/harness-journeys",
		"deep-modules/maintenance-command-contract",
		"deep-modules/plugin-payload-production",
		"deep-modules/qualification-evidence",
		"deep-modules/release-and-git-engine",
		"deep-modules/runtime-custody",
		"deep-module-private/maintenance-command-contract",
		"deep-module-private/qualification-evidence",
		"deep-module-private/release-and-git-engine",
		"source-tree-adapters/maintenance-command-facade",
		"source-tree-adapters/reusable-workflow-adapter",
		"clean-fixture",
		"repository-quality-tooling",
	])
	expect(boundaries.zones.every(({ file_count }) => file_count > 0)).toBe(true)
	expect(boundaries.rules).toEqual([
		{ from: "source-tree-interface", allow: [] },
		{ from: "admission-bootstrap", allow: [] },
		{ from: "admission-bootstrap-implementation", allow: [] },
		{
			from: "admission-bootstrap-contract-tests",
			allow: ["admission-bootstrap", "admission-bootstrap-implementation", "clean-fixture"],
		},
		{
			from: "deep-module-contract-tests/maintenance-command-contract",
			allow: ["deep-module-private/maintenance-command-contract"],
		},
		{
			from: "deep-module-contract-tests/qualification-evidence",
			allow: [
				"deep-modules/qualification-evidence",
				"deep-module-private/qualification-evidence",
				"deep-module-private/release-and-git-engine",
			],
		},
		{
			from: "maintenance-command-facade-contract-tests",
			allow: [
				"deep-module-contract-tests/maintenance-command-contract",
				"deep-module-private/maintenance-command-contract",
				"source-tree-adapters/maintenance-command-facade",
			],
		},
		{ from: "deep-modules/canary-qualification", allow: [] },
		{ from: "deep-modules/harness-journeys", allow: [] },
		{ from: "deep-modules/maintenance-command-contract", allow: [] },
		{ from: "deep-modules/plugin-payload-production", allow: [] },
		{
			from: "deep-modules/qualification-evidence",
			allow: [],
		},
		{ from: "deep-modules/release-and-git-engine", allow: [] },
		{ from: "deep-modules/runtime-custody", allow: [] },
		{ from: "deep-module-private/maintenance-command-contract", allow: [] },
		{
			from: "deep-module-private/qualification-evidence",
			allow: [
				"deep-modules/qualification-evidence",
				"deep-module-private/release-and-git-engine",
			],
		},
		{ from: "deep-module-private/release-and-git-engine", allow: [] },
		{
			from: "source-tree-adapters/maintenance-command-facade",
			allow: [],
		},
		{ from: "source-tree-adapters/reusable-workflow-adapter", allow: [] },
		{
			from: "clean-fixture",
			allow: [
				"source-tree-interface",
				"admission-bootstrap",
				"admission-bootstrap-implementation",
				"admission-bootstrap-contract-tests",
				"deep-module-contract-tests/maintenance-command-contract",
				"deep-module-contract-tests/qualification-evidence",
				"maintenance-command-facade-contract-tests",
				"deep-modules/canary-qualification",
				"deep-modules/harness-journeys",
				"deep-modules/maintenance-command-contract",
				"deep-modules/plugin-payload-production",
				"deep-modules/qualification-evidence",
				"deep-modules/release-and-git-engine",
				"deep-modules/runtime-custody",
				"deep-module-private/maintenance-command-contract",
				"deep-module-private/qualification-evidence",
				"deep-module-private/release-and-git-engine",
				"source-tree-adapters/maintenance-command-facade",
				"source-tree-adapters/reusable-workflow-adapter",
			],
		},
		{ from: "repository-quality-tooling", allow: [] },
	])
	const representativePathByZone: Readonly<Record<string, string>> = {
		"source-tree-interface": "src/interface.ts",
		"admission-bootstrap": "src/admission-bootstrap/interface.ts",
		"admission-bootstrap-implementation":
			"src/admission-bootstrap/implementation/admission-bootstrap.ts",
		"admission-bootstrap-contract-tests":
			"src/admission-bootstrap/contract-tests/admitted-identity-before-execution.test.ts",
		"deep-module-contract-tests/maintenance-command-contract":
			"src/modules/maintenance-command-contract/contract-tests/branch-station-catalog.test.ts",
		"deep-module-contract-tests/qualification-evidence":
			"src/modules/qualification-evidence/contract-tests/candidate-lineage-reduction.test.ts",
		"maintenance-command-facade-contract-tests":
			"src/adapters/maintenance-command-facade/contract-tests/command-surface.test.ts",
		"deep-modules/canary-qualification": "src/modules/canary-qualification/interface.ts",
		"deep-modules/harness-journeys": "src/modules/harness-journeys/interface.ts",
		"deep-modules/maintenance-command-contract":
			"src/modules/maintenance-command-contract/interface.ts",
		"deep-modules/plugin-payload-production": "src/modules/plugin-payload-production/interface.ts",
		"deep-modules/qualification-evidence": "src/modules/qualification-evidence/interface.ts",
		"deep-modules/release-and-git-engine": "src/modules/release-and-git-engine/interface.ts",
		"deep-modules/runtime-custody": "src/modules/runtime-custody/interface.ts",
		"deep-module-private/maintenance-command-contract":
			"src/modules/maintenance-command-contract/branch-stations.ts",
		"deep-module-private/qualification-evidence":
			"src/modules/qualification-evidence/serialized-values.ts",
		"deep-module-private/release-and-git-engine":
			"src/modules/release-and-git-engine/serialized-values.ts",
		"source-tree-adapters/maintenance-command-facade":
			"src/adapters/maintenance-command-facade/interface.ts",
		"source-tree-adapters/reusable-workflow-adapter":
			"src/adapters/reusable-workflow-adapter/interface.ts",
		"clean-fixture": "clean-fixture/audit-maintenance-cli.ts",
		"repository-quality-tooling": "tooling/repository-quality/verify-repository.ts",
	}
	const guard = await runFallow(
		repositoryRoot,
		"guard",
		...Object.values(representativePathByZone),
		"--format",
		"json",
		"--quiet",
	)
	const guardedFiles = guard.document.files as Array<{
		path: string
		zone: { name: string }
		boundary: { allowed_zones: string[]; allowed_type_only_zones: string[] }
	}>
	expect(guard.exitCode).toBe(0)
	expect(guard.stderr).toBe("")
	for (const rule of config.boundaries.rules) {
		const path = representativePathByZone[rule.from]
		const file = guardedFiles.find((candidate) => candidate.path === path)
		expect(file?.zone.name, rule.from).toBe(rule.from)
		expect(file?.boundary.allowed_zones.toSorted(), `${rule.from} value edges`).toEqual(
			[rule.from, ...(rule.allow ?? [])].toSorted(),
		)
		expect(file?.boundary.allowed_type_only_zones.toSorted(), `${rule.from} type edges`).toEqual(
			(rule.allowTypeOnly ?? []).toSorted(),
		)
	}
	expect(boundaries.logical_groups).toEqual([])
})

test("accepts every architecture edge class and refuses Admission value access", async () => {
	const root = await createArchitectureFixture()
	const acceptedEdgeFiles = [
		"src/modules/maintenance-command-contract/branch-stations.ts",
		"src/interface.ts",
		"src/modules/qualification-evidence/serialized-values.ts",
		"src/adapters/maintenance-command-facade/interface.ts",
		"clean-fixture/audit-maintenance-cli.ts",
	] as const
	for (const [index, relativePath] of acceptedEdgeFiles.entries()) {
		const path = join(root, relativePath)
		await writeFile(
			path,
			`${await Bun.file(path).text()}// Fallow accepted-edge control ${index + 1}: ${relativePath}\n`,
		)
		git(root, "add", relativePath)
	}
	const legal = await checkArchitecture(root)
	expect(legal.exitCode).toBe(0)
	expect(legal.stderr).toBe("")
	expect(legal.document).toMatchObject({ changed_files_count: acceptedEdgeFiles.length, verdict: "pass" })

	const admissionPath = join(root, "src/admission-bootstrap/implementation/admission-bootstrap.ts")
	await writeFile(
		admissionPath,
		`${await Bun.file(admissionPath).text()}import "../../modules/release-and-git-engine/interface"\n`,
	)
	git(root, "add", "src/admission-bootstrap/implementation/admission-bootstrap.ts")
	const refused = await checkArchitecture(root)
	const deadCode = refused.document.dead_code as Record<string, unknown>
	expect(refused.exitCode).toBe(1)
	expect(refused.stderr).toBe("")
	expect(deadCode.summary).toMatchObject({ boundary_violations: 1 })
	expect(deadCode.boundary_violations).toEqual([
		expect.objectContaining({
			from_path: "src/admission-bootstrap/implementation/admission-bootstrap.ts",
			from_zone: "admission-bootstrap-implementation",
			to_zone: "deep-modules/release-and-git-engine",
		}),
	])
})

test("refuses unapproved edges, uncovered source, and a weakened approved edge", async () => {
	const root = await createArchitectureFixture()
	await writeFile(join(root, "src/orphan.ts"), "export const orphan = true\n")
	const sourceTreeInterfacePath = join(root, "src/interface.ts")
	await writeFile(
		sourceTreeInterfacePath,
		`${await Bun.file(sourceTreeInterfacePath).text()}export { orphan } from "./orphan"\n`,
	)
	git(root, "add", "src/orphan.ts", "src/interface.ts")
	const observed = await checkArchitecture(root)
	const deadCode = observed.document.dead_code as Record<string, unknown>
	expect(observed.exitCode).toBe(1)
	expect(observed.stderr).toBe("")
	expect(deadCode.summary).toMatchObject({ boundary_coverage_violations: 1 })
	expect(deadCode.boundary_coverage_violations).toEqual([
		expect.objectContaining({ path: "src/orphan.ts" }),
	])

	const importControls = [
		{
			name: "Admission value import",
			path: "src/admission-bootstrap/implementation/admission-bootstrap.ts",
			source: 'import { CandidateIdentity } from "../../modules/release-and-git-engine/interface"\n',
			fromZone: "admission-bootstrap-implementation",
			toZone: "deep-modules/release-and-git-engine",
		},
		{
			name: "Admission mixed import",
			path: "src/admission-bootstrap/contract-tests/adapters/admission-contract-harness.ts",
			source:
				'import { type CandidateIdentity, SourceIdentity } from "../../../modules/release-and-git-engine/interface"\n',
			fromZone: "admission-bootstrap-contract-tests",
			toZone: "deep-modules/release-and-git-engine",
		},
		{
			name: "Admission side-effect import",
			path: "src/admission-bootstrap/interface.ts",
			source: 'import "../modules/release-and-git-engine/interface"\n',
			fromZone: "admission-bootstrap",
			toZone: "deep-modules/release-and-git-engine",
		},
		{
			name: "unapproved cross-owner type import",
			path: "src/modules/runtime-custody/interface.ts",
			source: 'import type { CandidateIdentity } from "../release-and-git-engine/interface"\n',
			fromZone: "deep-modules/runtime-custody",
			toZone: "deep-modules/release-and-git-engine",
		},
		{
			name: "approved owner private-file type import",
			path: "src/modules/canary-qualification/interface.ts",
			source: 'import type { canonicalCandidateIdentityDigest } from "../release-and-git-engine/serialized-values"\n',
			fromZone: "deep-modules/canary-qualification",
			toZone: "deep-module-private/release-and-git-engine",
		},
		{
			name: "Repository Quality to product import",
			path: "tooling/repository-quality/verify-repository.ts",
			source: 'import "../../src/interface"\n',
			fromZone: "repository-quality-tooling",
			toZone: "source-tree-interface",
		},
		{
			name: "non-public root re-export",
			path: "src/interface.ts",
			source: 'export type { CanaryQualification } from "./modules/canary-qualification/interface"\n',
			fromZone: "source-tree-interface",
			toZone: "deep-modules/canary-qualification",
		},
		{
			name: "public owner private-file root re-export",
			path: "src/interface.ts",
			source:
				'export type { BranchStationDescriptor } from "./modules/maintenance-command-contract/branch-stations"\n',
			fromZone: "source-tree-interface",
			toZone: "deep-module-private/maintenance-command-contract",
		},
		{
			name: "production Facade to Module Contract Test import",
			path: "src/adapters/maintenance-command-facade/interface.ts",
			source:
				'import { literalHelpProcess } from "../../modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"\n',
			fromZone: "source-tree-adapters/maintenance-command-facade",
			toZone: "deep-module-contract-tests/maintenance-command-contract",
		},
		{
			name: "root Interface to Admission Implementation",
			path: "src/interface.ts",
			source:
				'export type { admissionBootstrap } from "./admission-bootstrap/implementation/admission-bootstrap"\n',
			fromZone: "source-tree-interface",
			toZone: "admission-bootstrap-implementation",
		},
		{
			name: "production Admission to Clean Fixture",
			path: "src/admission-bootstrap/implementation/admission-bootstrap.ts",
			source:
				'import { admissionInvariantCases } from "../../../clean-fixture/personal-verification-profile/contract-tests/fixtures/admission-invariant-cases"\n',
			fromZone: "admission-bootstrap-implementation",
			toZone: "clean-fixture",
		},
	] as const

	const importRoot = await createArchitectureFixture()
	const sourcesByPath = new Map<string, string[]>()
	for (const control of importControls) {
		const sources = sourcesByPath.get(control.path) ?? []
		sources.push(control.source)
		sourcesByPath.set(control.path, sources)
	}
	for (const [relativePath, sources] of sourcesByPath) {
		const path = join(importRoot, relativePath)
		await mkdir(dirname(path), { recursive: true })
		const existing = await Bun.file(path).exists() ? await Bun.file(path).text() : ""
		await writeFile(path, `${existing}${sources.join("")}`)
		git(importRoot, "add", relativePath)
	}
	const refusedImports = await checkArchitecture(importRoot)
	const refusedDeadCode = refusedImports.document.dead_code as Record<string, unknown>
	const boundaryViolations = refusedDeadCode.boundary_violations as Array<{
		from_zone: string
		to_zone: string
	}>
	expect(refusedImports.exitCode).toBe(1)
	expect(refusedImports.stderr).toBe("")
	expect(refusedDeadCode.summary).toMatchObject({ boundary_violations: importControls.length })
	expect(boundaryViolations).toHaveLength(importControls.length)
	for (const control of importControls.slice(3)) {
		expect(
			boundaryViolations.filter(
				({ from_zone, to_zone }) => from_zone === control.fromZone && to_zone === control.toZone,
			),
			control.name,
		).toHaveLength(1)
	}
	expect(
		boundaryViolations.filter(
			({ from_zone, to_zone }) =>
				from_zone.startsWith("admission-bootstrap") &&
				to_zone === "deep-modules/release-and-git-engine",
		),
	).toHaveLength(3)

	const sensitivityRoot = await createArchitectureFixture()
	const configPath = join(sensitivityRoot, ".fallowrc.json")
	const config = (await Bun.file(configPath).json()) as {
		boundaries: { rules: Array<{ from: string; allow?: string[] }> }
	}
	const qualificationRule = config.boundaries.rules.find(
		({ from }) => from === "deep-module-private/qualification-evidence",
	)
	if (!qualificationRule) throw new Error("Qualification Evidence boundary rule is missing")
	if (!qualificationRule.allow?.includes("deep-module-private/release-and-git-engine")) {
		throw new Error("Qualification Evidence serialized-value edge is missing")
	}
	qualificationRule.allow = qualificationRule.allow.filter(
		(target) => target !== "deep-module-private/release-and-git-engine",
	)
	await writeJson(configPath, config)
	const sensitivity = await scanArchitecture(sensitivityRoot)
	const sensitivityDeadCode = sensitivity.document as Record<string, unknown>
	expect(sensitivity.exitCode).toBe(1)
	expect(sensitivity.stderr).toBe("")
	expect(sensitivityDeadCode.summary).toMatchObject({ boundary_violations: 2 })
	expect(sensitivityDeadCode.boundary_violations).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				from_zone: "deep-module-private/qualification-evidence",
				to_zone: "deep-module-private/release-and-git-engine",
			}),
		]),
	)
}, 30_000)

test("requires suppression reasons and reports stale suppressions", async () => {
	const invalidRoot = await createArchitectureFixture()
	const invalidConfigPath = join(invalidRoot, ".fallowrc.json")
	const invalidConfig = (await Bun.file(invalidConfigPath).json()) as {
		boundaries: { rules: Array<Record<string, unknown>> }
	}
	invalidConfig.boundaries.rules.push({ from: "missing-owner", allow: ["admission-bootstrap"] })
	await writeJson(invalidConfigPath, invalidConfig)
	const invalid = await runFallow(
		invalidRoot,
		"--no-cache",
		"list",
		"--boundaries",
		"--format",
		"json",
		"--quiet",
	)
	expect(invalid.exitCode).toBe(2)
	expect(invalid.stderr).toBe("")
	expect(invalid.document).toMatchObject({
		error: true,
		exit_code: 2,
		message: expect.stringContaining("references undefined zone 'missing-owner'"),
	})

	const root = await createArchitectureFixture()
	await writeFile(
		join(root, "src/admission-bootstrap/implementation/suppression-controls.ts"),
		[
			"// fallow-ignore-next-line boundary-violation",
			'import "../../modules/release-and-git-engine/interface"',
			"// fallow-ignore-next-line boundary-violation -- stale control",
			'import "../interface"',
			"",
		].join("\n"),
	)
	git(root, "add", "src/admission-bootstrap/implementation/suppression-controls.ts")
	const observed = await checkArchitecture(root)
	const deadCode = observed.document.dead_code as Record<string, unknown>
	const suppressions = deadCode.stale_suppressions as unknown[]
	expect(observed.exitCode).toBe(1)
	expect(observed.stderr).toBe("")
	expect(suppressions.length).toBeGreaterThanOrEqual(2)
	expect(suppressions).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ missing_reason: true }),
			expect.objectContaining({ origin: expect.objectContaining({ reason: "stale control" }) }),
		]),
	)
})
