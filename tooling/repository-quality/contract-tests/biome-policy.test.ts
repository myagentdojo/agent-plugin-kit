import { afterAll, expect, test } from "bun:test"
import { copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const repositoryRoot = resolve(import.meta.dir, "../../..")
const biomeExecutable = resolve(repositoryRoot, "node_modules/.bin/biome")
const temporaryRoots: string[] = []

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true })
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function createFixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "agent-plugin-kit-biome-policy-"))
	temporaryRoots.push(root)
	await copyFile(resolve(repositoryRoot, "biome.jsonc"), join(root, "biome.jsonc"))
	await writeFile(join(root, ".gitignore"), "")
	await writeJson(join(root, "package.json"), {
		name: "agent-plugin-kit",
		private: true,
		type: "module",
		workspaces: ["src/admission-bootstrap", "src/modules/*"],
		devDependencies: { typescript: "7.0.2" },
	})
	await writeJson(join(root, "src/admission-bootstrap/package.json"), {
		name: "@agent-plugin-kit/admission-bootstrap",
		private: true,
		type: "module",
	})
	await writeJson(join(root, "src/modules/alpha/package.json"), {
		name: "@agent-plugin-kit/alpha",
		private: true,
		type: "module",
		dependencies: { zod: "4.4.3" },
	})
	return root
}

async function lint(root: string, source: string, path: string): Promise<{
	exitCode: number
	stdout: string
	stderr: string
}> {
	const absolute = join(root, path)
	await mkdir(dirname(absolute), { recursive: true })
	await writeFile(absolute, source)
	const child = Bun.spawn([biomeExecutable, "lint", "--diagnostic-level=error", path], {
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

afterAll(async () => {
	await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })))
})

test("keeps legal Admission source inside its local module boundary", async () => {
	const root = await createFixture()
	const observed = await lint(
		root,
		'import { readFileSync } from "node:fs"\nexport { marker } from "../contract-tests/marker"\nvoid readFileSync\n',
		"src/admission-bootstrap/implementation/allowed.ts",
	)
	expect(observed.exitCode).toBe(0)
	expect(observed.stderr).toBe("")
})

test("refuses Admission package loading and ambient runtime escape routes", async () => {
	const root = await createFixture()
	const observed = await lint(
		root,
		'export { parse } from "zod"\nvoid import("typescript")\nvoid require("node:module")\nvoid eval("0")\nvoid globalThis\nvoid global\n',
		"src/admission-bootstrap/implementation/refused.ts",
	)
	expect(observed.exitCode).toBe(1)
	for (const category of [
		"lint/style/noRestrictedImports",
		"lint/style/noRestrictedGlobals",
		"lint/security/noGlobalEval",
	]) {
		expect(observed.stderr).toContain(category)
	}
	expect(observed.stderr.match(/lint\/style\/noRestrictedImports/g)).toHaveLength(3)
	expect(observed.stderr.match(/lint\/style\/noRestrictedGlobals/g)).toHaveLength(3)
})

test("uses the closest Owner Manifest for direct package declarations", async () => {
	const root = await createFixture()
	const declared = await lint(root, 'import "zod"\n', "src/modules/alpha/contract-tests/declared.ts")
	const undeclared = await lint(
		root,
		'import type ts from "typescript"\nvoid (0 as unknown as ts.Node)\n',
		"src/modules/alpha/contract-tests/undeclared.ts",
	)
	expect(declared.exitCode).toBe(0)
	expect(undeclared.exitCode).toBe(1)
	expect(undeclared.stderr).toContain("lint/correctness/noUndeclaredDependencies")
})

test("keeps public Interface files declaration-only and named", async () => {
	const root = await createFixture()
	const observed = await lint(
		root,
		'export default 1\nexport * from "./other"\nexport enum State { Ready }\nexport const enum Mode { Fast }\nexport namespace Internal {}\n',
		"src/modules/runtime-custody/interface.ts",
	)
	expect(observed.exitCode).toBe(1)
	for (const category of [
		"lint/style/noDefaultExport",
		"lint/performance/noReExportAll",
		"lint/style/noEnum",
		"lint/suspicious/noConstEnum",
		"lint/style/noNamespace",
	]) {
		expect(observed.stderr).toContain(category)
	}
})
