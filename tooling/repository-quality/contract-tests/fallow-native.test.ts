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
	let document: Record<string, unknown>
	try {
		document = JSON.parse(stdout) as Record<string, unknown>
	} catch (cause) {
		throw new Error(
			`fallow ${argumentsAfterFallow.join(" ")} produced non-JSON stdout (exit ${exitCode})\nstdout:\n${stdout}\nstderr:\n${stderr}`,
			{ cause },
		)
	}
	return { exitCode, stdout, stderr, document }
}

async function checkArchitecture(root: string) {
	return runFallow(
		root,
		"--no-cache",
		"audit",
		"--changed-since",
		"HEAD",
		"--no-type-aware",
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

async function runQualityGatePredicate(source: string, report: Record<string, unknown> | string): Promise<{
	exitCode: number
	stdout: string
	stderr: string
}> {
	const child = Bun.spawn([process.execPath, "-e", source], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, FORCE_COLOR: "0" },
	})
	child.stdin.write(typeof report === "string" ? report : `${JSON.stringify(report)}\n`)
	child.stdin.end()
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	])
	return { exitCode, stdout, stderr }
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
	const repositoryPackageMetadata = (await Bun.file(resolve(repositoryRoot, "package.json")).json()) as {
		scripts: { "quality:fallow": string }
	}
	await writeJson(join(root, "package.json"), {
		name: "fallow-native-fixture",
		private: true,
		type: "module",
		devDependencies: { typescript: "7.0.2" },
		scripts: { "quality:fallow": repositoryPackageMetadata.scripts["quality:fallow"] },
	})
	await symlink(resolve(repositoryRoot, "node_modules/.bin"), join(root, "node_modules/.bin"), "dir")
	const processChild = Bun.spawn(
		[process.execPath, "run", "--silent", "quality:fallow", "--changed-since", "HEAD"],
		{
			cwd: root,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, FORCE_COLOR: "0" },
		},
	)
	const [processExitCode, processStdout, processStderr] = await Promise.all([
		processChild.exited,
		new Response(processChild.stdout).text(),
		new Response(processChild.stderr).text(),
	])
	expect(processExitCode).toBe(1)
	expect(processStdout.endsWith("\n")).toBe(true)
	const processReport = JSON.parse(processStdout) as {
		verdict: string
		_meta: {
			type_aware: {
				required_completeness: string
				identity: { completeness: string }
				projects: unknown
				queries: unknown
			}
		}
	}
	const processTypeAware = processReport._meta.type_aware
	expect(processReport.verdict).toBe("pass")
	expect(processTypeAware.required_completeness).toBe("best-effort")
	expect(processTypeAware.identity.completeness).toBe("unavailable")
	expect(processTypeAware.projects).toEqual([])
	expect(processTypeAware.queries).toEqual([
		expect.objectContaining({
			capability: "type-coupling",
			status: "unavailable",
			reason_code: "no-project",
		}),
	])
	expect(processStderr).toBe("")
})

test("quality Fallow gate re-emits bounded partial evidence and refuses every other gap", async () => {
	const packageMetadata = (await Bun.file(resolve(repositoryRoot, "package.json")).json()) as {
		scripts: { "quality:fallow": string }
	}
	const predicate = packageMetadata.scripts["quality:fallow"].match(/bun -e '\\''(.+)'\\'' --' _$/u)?.[1]
	expect(predicate, "quality:fallow must end with its inline JSON gate predicate").toBeDefined()
	if (predicate === undefined) return
	const boundedEvidence = Array.from({ length: 40 }, (_, index) => ({
		source: {
			path: `src/source-${index}.ts`,
			namespace: "type",
			declaration_kind: "type_alias",
			exported_name: `Source${index}`,
			local_name: `Source${index}`,
			line: 1,
			col: 0,
		},
		target: {
			path: `src/target-${index}.ts`,
			namespace: "type",
			declaration_kind: "type_alias",
			exported_name: `Target${index}`,
			local_name: `Target${index}`,
			line: 1,
			col: 0,
		},
		relation: "public API depends on",
		evidence: { path: `src/source-${index}.ts`, line: 1, col: 0 },
		scope: "project-local-public-signatures",
	}))
	const firstEvidence = boundedEvidence[0]!
	const acceptedReport = {
		kind: "audit",
		verdict: "pass",
		_meta: {
			type_aware: {
				projects: [{ status: "complete", blocking_diagnostic_count: 0 }],
				type_coupling: {
					assertion: "coupling-found",
					status: "partial",
					files: [{ path: "src/index.ts", public_api_depends_on: 0, public_types_used_by: 0, edges: boundedEvidence }],
					omissions: [{ reason_code: "evidence-limit", count: 11 }],
					actions: ["Narrow the query to a specific symbol, entry point, or healthy TypeScript project and retry."],
				},
				queries: [{
					query_id: 0,
					capability: "type-coupling",
					assertion: "coupling-found",
					status: "partial",
					reason_code: "evidence-limit",
					total_evidence_count: 51,
					truncated: true,
					omissions: [{ reason_code: "evidence-limit", count: 11 }],
					actions: ["Narrow the query to a specific symbol, entry point, or healthy TypeScript project and retry."],
				}],
			},
		},
	}
	const accepted = await runQualityGatePredicate(predicate, acceptedReport)
	expect(accepted.exitCode).toBe(0)
	expect(accepted.stderr).toBe("")
	expect(accepted.stdout).toBe(`${JSON.stringify(acceptedReport)}\n`)
	const emptyQueriesReport = {
		...acceptedReport,
		_meta: { type_aware: { ...acceptedReport._meta.type_aware, queries: [] } },
	}
	const emptyQueriesAccepted = await runQualityGatePredicate(predicate, emptyQueriesReport)
	expect(emptyQueriesAccepted.exitCode).toBe(1)
	expect(emptyQueriesAccepted.stderr).toBe("")
	expect(emptyQueriesAccepted.stdout).toBe(`${JSON.stringify(emptyQueriesReport)}\n`)
	for (const [label, report] of [
		["non-pass verdict", { ...acceptedReport, verdict: "fail" }],
		["zero projects", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, projects: [] } } }],
		["incomplete project", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, projects: [{ status: "partial", blocking_diagnostic_count: 0 }] } } }],
		["blocking diagnostic", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, projects: [{ status: "complete", blocking_diagnostic_count: 1 }] } } }],
		["evidence total at ceiling", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, queries: [{ ...acceptedReport._meta.type_aware.queries[0], total_evidence_count: 40, omissions: [{ reason_code: "evidence-limit", count: 0 }] }] } } }],
		["thirty-nine emitted evidence records", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, type_coupling: { ...acceptedReport._meta.type_aware.type_coupling, files: [{ ...acceptedReport._meta.type_aware.type_coupling.files[0], edges: boundedEvidence.slice(0, 39) }] } } } }],
		["forty-one emitted evidence records", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, type_coupling: { ...acceptedReport._meta.type_aware.type_coupling, files: [{ ...acceptedReport._meta.type_aware.type_coupling.files[0], edges: [...boundedEvidence, { ...firstEvidence, source: { ...firstEvidence.source, exported_name: "Extra" } }] } ] } } } }],
		["duplicate emitted evidence records", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, type_coupling: { ...acceptedReport._meta.type_aware.type_coupling, files: [{ ...acceptedReport._meta.type_aware.type_coupling.files[0], edges: boundedEvidence.slice(0, 1).flatMap((edge) => Array.from({ length: 40 }, () => edge)) }] } } } }],
		["missing type-coupling report", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, type_coupling: undefined } } }],
		["different query capability", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, queries: [{ ...acceptedReport._meta.type_aware.queries[0], capability: "symbol-use" }] } } }],
		["different query assertion", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, queries: [{ ...acceptedReport._meta.type_aware.queries[0], assertion: "symbol-used" }] } } }],
		["different query ID", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, queries: [{ ...acceptedReport._meta.type_aware.queries[0], query_id: 1 }] } } }],
		["different partial reason", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, queries: [{ status: "partial", reason_code: "blocking-diagnostics", truncated: true }] } } }],
		["untruncated evidence limit", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, queries: [{ status: "partial", reason_code: "evidence-limit", truncated: false }] } } }],
		["missing evidence count", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, queries: [{ ...acceptedReport._meta.type_aware.queries[0], total_evidence_count: undefined }] } } }],
		["wrong omission shape", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, queries: [{ ...acceptedReport._meta.type_aware.queries[0], omissions: [{ reason_code: "blocking-diagnostics", count: 11 }] }] } } }],
		["wrong omission count", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, queries: [{ ...acceptedReport._meta.type_aware.queries[0], omissions: [{ reason_code: "evidence-limit", count: 0 }] }] } } }],
		["inconsistent omission arithmetic", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, queries: [{ ...acceptedReport._meta.type_aware.queries[0], omissions: [{ reason_code: "evidence-limit", count: 10 }] }] } } }],
		["multiple omissions", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, queries: [{ ...acceptedReport._meta.type_aware.queries[0], omissions: [{ reason_code: "evidence-limit", count: 11 }, { reason_code: "evidence-limit", count: 0 }] }] } } }],
		["wrong coupling omission count", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, type_coupling: { ...acceptedReport._meta.type_aware.type_coupling, omissions: [{ reason_code: "evidence-limit", count: 10 }] } } } }],
		["missing next action", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, queries: [{ ...acceptedReport._meta.type_aware.queries[0], actions: [] }] } } }],
		["wrong next action", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, queries: [{ ...acceptedReport._meta.type_aware.queries[0], actions: ["Accept the evidence gap."] }] } } }],
		["unavailable query", { ...acceptedReport, _meta: { type_aware: { ...acceptedReport._meta.type_aware, queries: [{ status: "unavailable", reason_code: "evidence-limit", truncated: true }] } } }],
		["missing meta", { kind: "audit", verdict: "pass" }],
		["null type-aware", { ...acceptedReport, _meta: { type_aware: null } }],
		[
			"projects not an array",
			{
				...acceptedReport,
				_meta: {
					type_aware: {
						projects: { status: "complete", blocking_diagnostic_count: 0 },
						queries: acceptedReport._meta.type_aware.queries,
					},
				},
			},
		],
		[
			"queries missing",
			{
				...acceptedReport,
				_meta: { type_aware: { projects: acceptedReport._meta.type_aware.projects } },
			},
		],
		[
			"project missing diagnostic count",
			{
				...acceptedReport,
				_meta: {
					type_aware: {
						projects: [{ status: "complete" }],
						queries: acceptedReport._meta.type_aware.queries,
					},
				},
			},
		],
	] as const) {
		const refused = await runQualityGatePredicate(predicate, report)
		expect(refused.exitCode, label).toBe(1)
		expect(refused.stdout, label).toBe(`${JSON.stringify(report)}\n`)
		expect(refused.stderr, label).toBe("")
	}
	const nonJson = await runQualityGatePredicate(predicate, "not json\n")
	expect(nonJson.exitCode).toBe(1)
	expect(nonJson.stdout).toBe("")
	expect(nonJson.stderr).not.toBe("")
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
	const observed = await runFallow(
		repositoryRoot,
		"--no-cache",
		"list",
		"--boundaries",
		"--format",
		"json",
		"--quiet",
	)
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
		"deep-module-private/canary-qualification",
		"deep-module-serialized-values/canary-qualification",
		"deep-module-serialized-values/harness-journeys",
		"deep-module-serialized-values/plugin-payload-production",
		"deep-module-contract-tests/canary-qualification",
		"deep-module-contract-tests/harness-journeys",
		"deep-module-contract-tests/plugin-payload-production",
		"deep-module-contract-tests/release-and-git-engine",
		"deep-modules/harness-journeys",
		"deep-modules/maintenance-command-contract",
		"deep-modules/plugin-payload-production",
		"deep-modules/qualification-evidence",
		"deep-modules/release-and-git-engine",
		"deep-modules/runtime-custody",
		"deep-module-private/maintenance-command-contract",
		"deep-module-private/qualification-evidence",
		"deep-module-serialized-values/release-and-git-engine",
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
				"deep-module-serialized-values/release-and-git-engine",
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
		{
			from: "deep-module-private/canary-qualification",
			allow: ["deep-module-serialized-values/release-and-git-engine"],
		},
		{
			from: "deep-module-serialized-values/canary-qualification",
			allow: ["deep-module-serialized-values/release-and-git-engine"],
		},
		{
			from: "deep-module-serialized-values/harness-journeys",
			allow: [
				"deep-module-serialized-values/plugin-payload-production",
				"deep-module-serialized-values/release-and-git-engine",
			],
		},
		{
			from: "deep-module-serialized-values/plugin-payload-production",
			allow: ["deep-module-serialized-values/release-and-git-engine"],
		},
		{
			from: "deep-module-contract-tests/canary-qualification",
			allow: [
				"deep-module-private/canary-qualification",
				"deep-module-serialized-values/canary-qualification",
			],
		},
		{
			from: "deep-module-contract-tests/harness-journeys",
			allow: ["deep-module-serialized-values/harness-journeys"],
		},
		{
			from: "deep-module-contract-tests/plugin-payload-production",
			allow: ["deep-module-serialized-values/plugin-payload-production"],
		},
		{
			from: "deep-module-contract-tests/release-and-git-engine",
			allow: ["deep-module-serialized-values/release-and-git-engine"],
		},
		{ from: "deep-modules/harness-journeys", allow: [] },
		{ from: "deep-modules/maintenance-command-contract", allow: [] },
		{ from: "deep-modules/plugin-payload-production", allow: [] },
		{
			from: "deep-modules/qualification-evidence",
			allow: [],
		},
		{ from: "deep-modules/release-and-git-engine", allow: [] },
		{ from: "deep-modules/runtime-custody", allow: [] },
		{
			from: "deep-module-private/maintenance-command-contract",
			allow: [
				"deep-module-serialized-values/canary-qualification",
				"deep-module-serialized-values/harness-journeys",
				"deep-module-serialized-values/plugin-payload-production",
				"deep-module-serialized-values/release-and-git-engine",
			],
		},
		{
			from: "deep-module-private/qualification-evidence",
			allow: [
				"deep-modules/qualification-evidence",
				"deep-module-serialized-values/release-and-git-engine",
			],
		},
		{ from: "deep-module-serialized-values/release-and-git-engine", allow: [] },
		{
			from: "source-tree-adapters/maintenance-command-facade",
			allow: ["deep-module-private/maintenance-command-contract"],
		},
		{ from: "source-tree-adapters/reusable-workflow-adapter", allow: [] },
		{
			from: "clean-fixture",
			allow: [
				"admission-bootstrap",
				"deep-module-contract-tests/maintenance-command-contract",
				"deep-modules/qualification-evidence",
				"deep-module-private/maintenance-command-contract",
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
		"deep-module-private/canary-qualification":
			"src/modules/canary-qualification/adapters/protected-file-authority-source.ts",
		"deep-module-serialized-values/canary-qualification":
			"src/modules/canary-qualification/serialized-values.ts",
		"deep-module-serialized-values/harness-journeys":
			"src/modules/harness-journeys/serialized-values.ts",
		"deep-module-serialized-values/plugin-payload-production":
			"src/modules/plugin-payload-production/serialized-values.ts",
		"deep-module-contract-tests/canary-qualification":
			"src/modules/canary-qualification/contract-tests/authority-source.test.ts",
		"deep-module-contract-tests/harness-journeys":
			"src/modules/harness-journeys/contract-tests/serialized-values.test.ts",
		"deep-module-contract-tests/plugin-payload-production":
			"src/modules/plugin-payload-production/contract-tests/serialized-values.test.ts",
		"deep-module-contract-tests/release-and-git-engine":
			"src/modules/release-and-git-engine/contract-tests/serialized-values.test.ts",
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
		"deep-module-serialized-values/release-and-git-engine":
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
		"--no-cache",
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
}, 30_000)

test("refuses unapproved edges, uncovered source, and a weakened approved edge", async () => {
	const root = await createArchitectureFixture()
	await writeFile(
		join(root, "src/modules/release-and-git-engine/future-private.ts"),
		"export const futurePrivate = true\n",
	)
	const sourceTreeInterfacePath = join(root, "src/interface.ts")
	await writeFile(
		sourceTreeInterfacePath,
		`${await Bun.file(sourceTreeInterfacePath).text()}export { futurePrivate } from "./modules/release-and-git-engine/future-private"\n`,
	)
	git(root, "add", "src/modules/release-and-git-engine/future-private.ts", "src/interface.ts")
	const observed = await checkArchitecture(root)
	const deadCode = observed.document.dead_code as Record<string, unknown>
	expect(observed.exitCode).toBe(1)
	expect(observed.stderr).toBe("")
	expect(deadCode.summary).toMatchObject({ boundary_coverage_violations: 1 })
	expect(deadCode.boundary_coverage_violations).toEqual([
		expect.objectContaining({ path: "src/modules/release-and-git-engine/future-private.ts" }),
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
			name: "approved owner serialized-value type import",
			path: "src/modules/canary-qualification/interface.ts",
			source: 'import type { canonicalCandidateIdentityDigest } from "../release-and-git-engine/serialized-values"\n',
			fromZone: "deep-modules/canary-qualification",
			toZone: "deep-module-serialized-values/release-and-git-engine",
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
	if (!qualificationRule.allow?.includes("deep-module-serialized-values/release-and-git-engine")) {
		throw new Error("Qualification Evidence serialized-value edge is missing")
	}
	qualificationRule.allow = qualificationRule.allow.filter(
		(target) => target !== "deep-module-serialized-values/release-and-git-engine",
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
				to_zone: "deep-module-serialized-values/release-and-git-engine",
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
}, 30_000)
