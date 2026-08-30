import { afterAll, expect, test } from "bun:test"
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
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
	await copyFile(resolve(repositoryRoot, ".fallowrc.json"), join(root, ".fallowrc.json"))
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
	expect(observed.document).toEqual({
		error: true,
		message:
			"could not determine changed files for base ref 'refs/heads/does-not-exist'. Verify the ref exists in this git repository",
		exit_code: 2,
	})
})
