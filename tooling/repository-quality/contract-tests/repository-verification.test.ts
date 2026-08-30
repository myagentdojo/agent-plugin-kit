import { afterAll, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { type RepositoryFinding, verifyRepository } from "../repository-verification"

type JsonObject = Record<string, unknown>

const verifierPath = resolve(import.meta.dir, "../verify-repository.ts")
const temporaryRoots: string[] = []

const rootManifest = {
	name: "agent-plugin-kit",
	private: true,
	type: "module",
	workspaces: ["src/admission-bootstrap", "src/modules/*"],
	devDependencies: { zod: "4.4.3" },
	exports: {
		".": "./src/interface.ts",
		"./admission-bootstrap": {
			types: "./src/admission-bootstrap/interface.ts",
			import: "./src/admission-bootstrap/implementation/admission-bootstrap.ts",
			default: "./src/admission-bootstrap/implementation/admission-bootstrap.ts",
		},
		"./alpha": "./src/modules/alpha/interface.ts",
		"./beta": "./src/modules/beta/interface.ts",
	},
} satisfies JsonObject

const ownerManifest = (name: string, dependencies: JsonObject = {}) => ({
	name,
	private: true,
	type: "module",
	dependencies,
	exports: { ".": "./interface.ts" },
})

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function createFixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "agent-plugin-kit-repository-verification-"))
	temporaryRoots.push(root)
	await writeJson(join(root, "package.json"), rootManifest)
	await writeJson(
		join(root, "src/admission-bootstrap/package.json"),
		ownerManifest("@agent-plugin-kit/admission-bootstrap"),
	)
	await writeJson(join(root, "src/modules/alpha/package.json"), ownerManifest("@agent-plugin-kit/alpha", { zod: "4.4.3" }))
	await writeJson(join(root, "src/modules/beta/package.json"), ownerManifest("@agent-plugin-kit/beta", { zod: "4.4.3" }))
	for (const path of [
		"src/interface.ts",
		"src/admission-bootstrap/interface.ts",
		"src/admission-bootstrap/implementation/admission-bootstrap.ts",
		"src/modules/alpha/interface.ts",
		"src/modules/beta/interface.ts",
	]) {
		await mkdir(dirname(join(root, path)), { recursive: true })
		await writeFile(join(root, path), "export type Marker = true\n")
	}
	return root
}

async function mutateJson(path: string, mutate: (value: JsonObject) => void): Promise<void> {
	const value = JSON.parse(await readFile(path, "utf8")) as JsonObject
	mutate(value)
	await writeJson(path, value)
}

async function observeCli(root: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const child = Bun.spawn(["bun", "run", verifierPath], {
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
	return { exitCode, stdout, stderr }
}

const independentRepair = {
	"export-target-invalid": (path: string) => `Make ${path} a regular repository-contained export target.`,
	"owner-manifest-invalid": (path: string) =>
		`Repair ${path} so it satisfies the Owner Manifest discovery and shape contract.`,
	"dependency-locality-invalid": (path: string) =>
		`Align dependency declarations in ${path} with the exact owner and root versions.`,
	"source-path-escape": (path: string) =>
		`Replace ${path} with a regular path contained by the canonical repository root.`,
} satisfies Record<RepositoryFinding["code"], (path: string) => string>

function expectedFinding(code: RepositoryFinding["code"], path: string): RepositoryFinding {
	return { code, path, repair: independentRepair[code](path) }
}

function repositoryFindings(root: string): readonly RepositoryFinding[] {
	const result = verifyRepository(root)
	if (result.ok) return []
	if (result.kind === "operational-error") throw new Error(`unexpected operational error: ${result.error.code}`)
	return result.findings
}

afterAll(async () => {
	await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })))
})

test("qualifies the repository through the function and process Interfaces", async () => {
	const root = await createFixture()
	expect(verifyRepository(root)).toEqual({ ok: true })
	const observed = await observeCli(root)
	expect(observed).toEqual({
		exitCode: 0,
		stdout: `${JSON.stringify({ schemaVersion: 1, decision: "qualified", findings: [], error: null })}\n`,
		stderr: "",
	})
})

const manifestMutations = [
	{
		name: "invalid workspace grammar",
		mutate: async (root: string) => {
			await mutateJson(join(root, "package.json"), (manifest) => {
				manifest.workspaces = ["src/**"]
			})
		},
		expected: [expectedFinding("owner-manifest-invalid", "package.json#workspaces")],
	},
	{
		name: "unmatched workspace",
		mutate: async (root: string) => {
			await mutateJson(join(root, "package.json"), (manifest) => {
				manifest.workspaces = ["src/admission-bootstrap", "src/missing"]
			})
		},
		expected: [expectedFinding("owner-manifest-invalid", "package.json#workspaces")],
	},
	{
		name: "unmatched wildcard workspace",
		mutate: async (root: string) => {
			await mutateJson(join(root, "package.json"), (manifest) => {
				manifest.workspaces = ["src/missing/*"]
			})
		},
		expected: [expectedFinding("owner-manifest-invalid", "package.json#workspaces")],
	},
	{
		name: "overlapping workspace",
		mutate: async (root: string) => {
			await mutateJson(join(root, "package.json"), (manifest) => {
				manifest.workspaces = ["src/modules/*", "src/modules/alpha"]
			})
		},
		expected: [expectedFinding("owner-manifest-invalid", "package.json#workspaces")],
	},
	{
		name: "owner name drift",
		mutate: async (root: string) => {
			await mutateJson(join(root, "src/modules/alpha/package.json"), (manifest) => {
				manifest.name = "@agent-plugin-kit/wrong"
			})
		},
		expected: [expectedFinding("owner-manifest-invalid", "src/modules/alpha/package.json")],
	},
	{
		name: "shared dependency version drift",
		mutate: async (root: string) => {
			await mutateJson(join(root, "src/modules/alpha/package.json"), (manifest) => {
				manifest.dependencies = { zod: "4.4.2" }
			})
		},
		expected: [
			expectedFinding("dependency-locality-invalid", "src/modules/alpha/package.json"),
			expectedFinding("dependency-locality-invalid", "src/modules/beta/package.json"),
		],
	},
	{
		name: "root Zod mirror drift",
		mutate: async (root: string) => {
			await mutateJson(join(root, "package.json"), (manifest) => {
				manifest.devDependencies = {}
			})
		},
		expected: [expectedFinding("dependency-locality-invalid", "package.json")],
	},
	{
		name: "Admission dependency drift",
		mutate: async (root: string) => {
			await mutateJson(join(root, "src/admission-bootstrap/package.json"), (manifest) => {
				manifest.devDependencies = { zod: "4.4.3" }
			})
		},
		expected: [expectedFinding("dependency-locality-invalid", "src/admission-bootstrap/package.json")],
	},
	{
		name: "Admission export order drift",
		mutate: async (root: string) => {
			await mutateJson(join(root, "package.json"), (manifest) => {
				const exports = manifest.exports as JsonObject
				exports["./admission-bootstrap"] = {
					import: "./src/admission-bootstrap/implementation/admission-bootstrap.ts",
					types: "./src/admission-bootstrap/interface.ts",
					default: "./src/admission-bootstrap/implementation/admission-bootstrap.ts",
				}
			})
		},
		expected: [expectedFinding("owner-manifest-invalid", "package.json#exports./admission-bootstrap")],
	},
] as const

for (const scenario of manifestMutations) {
	test(`refuses ${scenario.name}`, async () => {
		const root = await createFixture()
		await scenario.mutate(root)
		expect(repositoryFindings(root)).toEqual(scenario.expected)
	})
}

test("refuses malformed and conflicting dependency declarations", async () => {
	const malformed = await createFixture()
	await mutateJson(join(malformed, "src/modules/alpha/package.json"), (manifest) => {
		manifest.dependencies = { zod: 4 }
	})
	expect(repositoryFindings(malformed)).toEqual([
		expectedFinding("dependency-locality-invalid", "src/modules/alpha/package.json"),
	])

	const conflicting = await createFixture()
	await mutateJson(join(conflicting, "src/modules/alpha/package.json"), (manifest) => {
		manifest.optionalDependencies = { zod: "4.4.2" }
	})
	expect(repositoryFindings(conflicting)).toEqual([
		expectedFinding("dependency-locality-invalid", "src/modules/alpha/package.json"),
	])
})

test("refuses invalid export leaves and a redirected Admission runtime", async () => {
	const invalidLeaf = await createFixture()
	await mutateJson(join(invalidLeaf, "package.json"), (manifest) => {
		const exports = manifest.exports as JsonObject
		exports["./alpha"] = { default: 42 }
	})
	expect(repositoryFindings(invalidLeaf)).toEqual([
		expectedFinding("export-target-invalid", "package.json#exports"),
	])

	const redirected = await createFixture()
	await mutateJson(join(redirected, "package.json"), (manifest) => {
		const exports = manifest.exports as JsonObject
		exports["./admission-bootstrap"] = {
			types: "./src/admission-bootstrap/interface.ts",
			import: "./src/modules/alpha/interface.ts",
			default: "./src/modules/alpha/interface.ts",
		}
	})
	expect(repositoryFindings(redirected)).toEqual([
		expectedFinding("owner-manifest-invalid", "package.json#exports./admission-bootstrap"),
	])
})

test("refuses missing and escaping export targets with deterministic repairs", async () => {
	const root = await createFixture()
	const outside = await mkdtemp(join(tmpdir(), "agent-plugin-kit-outside-export-"))
	temporaryRoots.push(outside)
	await writeFile(join(outside, "escape.ts"), "export {}\n")
	await rm(join(root, "src/modules/alpha/interface.ts"))
	await rm(join(root, "src/modules/beta/interface.ts"))
	await symlink(join(outside, "escape.ts"), join(root, "src/modules/beta/interface.ts"))

	const result = verifyRepository(root)
	expect(result).toEqual({
		ok: false,
		kind: "repository-findings",
		findings: [
			{
				code: "export-target-invalid",
				path: "src/modules/alpha/interface.ts",
				repair: "Make src/modules/alpha/interface.ts a regular repository-contained export target.",
			},
			{
				code: "source-path-escape",
				path: "src/modules/beta/interface.ts",
				repair: "Replace src/modules/beta/interface.ts with a regular path contained by the canonical repository root.",
			},
		],
	})
})

test("refuses included source symlinks but ignores excluded metadata symlinks", async () => {
	const root = await createFixture()
	const outside = await mkdtemp(join(tmpdir(), "agent-plugin-kit-outside-source-"))
	temporaryRoots.push(outside)
	await writeFile(join(outside, "escape.ts"), "export {}\n")
	await symlink(join(outside, "escape.ts"), join(root, "src/modules/alpha/escape.ts"))
	await symlink(outside, join(root, "src/modules/alpha/.fallow"))
	expect(repositoryFindings(root)).toEqual([
		expectedFinding("source-path-escape", "src/modules/alpha/escape.ts"),
	])
})

test("maps malformed manifests and inaccessible roots to operational exit two", async () => {
	const root = await createFixture()
	await writeFile(join(root, "src/modules/alpha/package.json"), "not json\n")
	const malformed = await observeCli(root)
	expect(malformed.exitCode).toBe(2)
	expect(JSON.parse(malformed.stdout)).toEqual({
		schemaVersion: 1,
		decision: "error",
		findings: [],
		error: {
			code: "manifest-unreadable",
			path: "src/modules/alpha/package.json",
			repair:
				"Repair src/modules/alpha/package.json so it is readable valid JSON, then rerun repository verification.",
		},
	})
	expect(malformed.stderr).toBe(
		"repository-verification error manifest-unreadable src/modules/alpha/package.json: Repair src/modules/alpha/package.json so it is readable valid JSON, then rerun repository verification.\n",
	)
	expect(verifyRepository(join(root, "missing"))).toEqual({
		ok: false,
		kind: "operational-error",
		error: {
			code: "filesystem-unreadable",
			path: ".",
			repair: "Repair filesystem access for ., then rerun repository verification.",
		},
	})
})

test("prints one refusal envelope and keeps policy diagnostics off stderr", async () => {
	const root = await createFixture()
	await mutateJson(join(root, "src/modules/alpha/package.json"), (manifest) => {
		manifest.name = "@agent-plugin-kit/wrong"
	})
	const observed = await observeCli(root)
	const findings = [expectedFinding("owner-manifest-invalid", "src/modules/alpha/package.json")]
	expect(observed).toEqual({
		exitCode: 1,
		stdout: `${JSON.stringify({ schemaVersion: 1, decision: "refused", findings, error: null })}\n`,
		stderr: "",
	})
})
