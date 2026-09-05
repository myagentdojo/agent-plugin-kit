import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import type { PayloadProductionResult } from "../interface"
import { createPluginPayloadProduction } from "../implementation/plugin-payload-production"
import { parsePayloadProductionRequest } from "../serialized-values"
import {
	checkRequest,
	canonicalConfiguration,
	cleanupFixture,
	createPayloadFixture,
	materializeRequest,
	snapshotRepository,
	type PayloadProductionFixture,
} from "./fixtures/payload-production-fixture"

const fixtures: PayloadProductionFixture[] = []
const fixture = (options: Parameters<typeof createPayloadFixture>[0] = {}): PayloadProductionFixture => {
	const created = createPayloadFixture(options)
	fixtures.push(created)
	return created
}

afterEach(() => {
	for (const created of fixtures.splice(0)) cleanupFixture(created)
})

const expectRefusal = (result: PayloadProductionResult, code: string): void => {
	expect(result).toMatchObject({ kind: "refused", code })
	if (result.kind === "refused") expect(result.nextAction.length).toBeGreaterThan(0)
}

const expectNoWrite = (
	subject: PayloadProductionFixture,
	before: ReturnType<typeof snapshotRepository>,
	result: PayloadProductionResult,
	code: string,
): void => {
	expectRefusal(result, code)
	expect(snapshotRepository(subject.root)).toEqual(before)
}

const setFrozenDependency = (subject: PayloadProductionFixture, requested: string, version: string): void => {
	writeFileSync(subject.lockPath, `${JSON.stringify({
		workspaces: {
			[subject.workspacePath]: { dependencies: { "fixture-dependency": requested } },
		},
		packages: {
			[`fixture-dependency@${version}`]: [`fixture-dependency@${version}`, "sha512-fixture", {}],
		},
	}, null, 2)}\n`)
	const dependencyRoot = join(subject.storeRoot, `fixture-dependency@${version}`, "node_modules", "fixture-dependency")
	mkdirSync(dependencyRoot, { recursive: true })
	writeFileSync(join(dependencyRoot, "package.json"), `${JSON.stringify({
		name: "fixture-dependency",
		version,
		license: "MIT",
	}, null, 2)}\n`)
	writeFileSync(join(dependencyRoot, "LICENSE.md"), "Fixture dependency license text.\n")
}

test("IR01 rejects an unknown serialized configuration field before produce", () => {
	const subject = fixture()
	const before = snapshotRepository(subject.root)
	const value = {
		...checkRequest(subject),
		configuration: {
			...subject.configuration,
			plugin: { ...subject.configuration.plugin, productOnlyExtension: "must stay in the consumer" },
		},
	}
	expect(parsePayloadProductionRequest(value)).toBeUndefined()
	expect(snapshotRepository(subject.root)).toEqual(before)
})

test("IR02 rejects a nested configuration schemaVersion before produce", () => {
	const subject = fixture()
	const before = snapshotRepository(subject.root)
	const value = {
		...checkRequest(subject),
		configuration: { ...subject.configuration, schemaVersion: 1 },
	}
	expect(parsePayloadProductionRequest(value)).toBeUndefined()
	expect(snapshotRepository(subject.root)).toEqual(before)
})

test("IR03 rejects product-only fields at serialized ingress", () => {
	const subject = fixture()
	const before = snapshotRepository(subject.root)
	const value = {
		...checkRequest(subject),
		configuration: {
			...subject.configuration,
			plugin: { ...subject.configuration.plugin, runtimeVersion: "bun-1.4.0" },
		},
	}
	expect(parsePayloadProductionRequest(value)).toBeUndefined()
	expect(snapshotRepository(subject.root)).toEqual(before)
})

test("IR04 refuses duplicate or unsorted skills after structural ingress validation", async () => {
	for (const skills of [
		[...canonicalConfiguration.skills].reverse(),
		[canonicalConfiguration.skills[0], canonicalConfiguration.skills[0]],
	]) {
		const subject = fixture()
		const before = snapshotRepository(subject.root)
		const value = { ...checkRequest(subject), configuration: { ...subject.configuration, skills } }
		const parsed = parsePayloadProductionRequest(value)
		expect(parsed).toBeDefined()
		if (parsed === undefined) continue
		const result = await createPluginPayloadProduction().produce(parsed)
		expectNoWrite(subject, before, result, "configuration-invalid")
		// The refusal must be checked against the same untouched fixture in each subcase.
		expect(snapshotRepository(subject.root)).toEqual(before)
	}
})

test("IR05 refuses an unsafe source projection path before output publication", async () => {
	const subject = fixture()
	const before = snapshotRepository(subject.root)
	const outsideName = `${basename(subject.root)}-outside-config.json`
	const outsidePath = join(subject.root, "..", outsideName)
	writeFileSync(outsidePath, '{"outside":true}\n')
	try {
		const result = await createPluginPayloadProduction().produce({
			...checkRequest(subject),
			sourceProjectionPaths: { ...subject.sourceProjectionPaths, config: `../${outsideName}` },
		})
		expectNoWrite(subject, before, result, "configuration-invalid")
	} finally {
		rmSync(outsidePath, { force: true })
	}
})

test("IR06 refuses missing workspace source, hook declaration, and prepared entry", async () => {
	const workspace = fixture({ production: "workspace" })
	const workspaceBefore = snapshotRepository(workspace.root)
	rmSync(workspace.workspaceRoot, { recursive: true, force: true })
	const missingWorkspace = await createPluginPayloadProduction().produce(checkRequest(workspace))
	expectRefusal(missingWorkspace, "bundle-refused")
	expect(snapshotRepository(workspace.root)).toEqual(workspaceBefore.filter((entry) => entry.path !== workspace.workspacePath && !entry.path.startsWith(`${workspace.workspacePath}/`)))

	const missingHook = fixture()
	const hookBefore = snapshotRepository(missingHook.root)
	rmSync(join(missingHook.pluginRoot, "hooks/codex"), { recursive: true, force: true })
	const missingHookResult = await createPluginPayloadProduction().produce(checkRequest(missingHook))
	expectRefusal(missingHookResult, "declared-file-missing")
	expect(snapshotRepository(missingHook.root)).toEqual(hookBefore.filter((entry) => entry.path !== "plugin/hooks/codex" && !entry.path.startsWith("plugin/hooks/codex/")))

	const missingPrepared = fixture()
	const preparedBefore = snapshotRepository(missingPrepared.root)
	rmSync(join(missingPrepared.pluginRoot, "runtime"), { recursive: true, force: true })
	const missingPreparedResult = await createPluginPayloadProduction().produce(checkRequest(missingPrepared))
	expectRefusal(missingPreparedResult, "declared-file-missing")
	expect(snapshotRepository(missingPrepared.root)).toEqual(preparedBefore.filter((entry) => entry.path !== "plugin/runtime" && !entry.path.startsWith("plugin/runtime/")))
})

test("IR07 refuses absent frozen lock or package store without installing", async () => {
	const missingLock = fixture({ production: "workspace", includeLock: false })
	const missingLockBefore = snapshotRepository(missingLock.root)
	const lockResult = await createPluginPayloadProduction().produce(checkRequest(missingLock))
	expectRefusal(lockResult, "dependency-refused")
	expect(existsSync(missingLock.lockPath)).toBe(false)
	expect(snapshotRepository(missingLock.root)).toEqual(missingLockBefore)

	const missingStore = fixture({ production: "workspace", includeStore: false })
	const missingStoreBefore = snapshotRepository(missingStore.root)
	const storeResult = await createPluginPayloadProduction().produce(materializeRequest(missingStore))
	expectRefusal(storeResult, "dependency-refused")
	expect(existsSync(missingStore.storeRoot)).toBe(false)
	expect(snapshotRepository(missingStore.root)).toEqual(missingStoreBefore)
})

test("IR08 refuses lifecycle, optional, and native dependency inputs", async () => {
	const cases = [
		{ dependencyManifest: { scripts: { install: "echo forbidden" } } },
		{ dependencyManifest: { optionalDependencies: { "optional-fixture": "1.0.0" } } },
		{ nativeArtifact: "binding.gyp" as const },
	]
	for (const options of cases) {
		const subject = fixture({ production: "workspace", ...options })
		const before = snapshotRepository(subject.root)
		const result = await createPluginPayloadProduction().produce(checkRequest(subject))
		expectRefusal(result, "dependency-refused")
		expect(snapshotRepository(subject.root)).toEqual(before)
	}
})

test("IR09 refuses unresolved peers and rejected dependency licenses", async () => {
	for (const dependencyManifest of [
		{ peerDependencies: { "missing-peer": "1.0.0" } },
		{ license: "GPL-3.0" },
	]) {
		const subject = fixture({ production: "workspace", dependencyManifest })
		const before = snapshotRepository(subject.root)
		const result = await createPluginPayloadProduction().produce(checkRequest(subject))
		expectRefusal(result, "dependency-refused")
		expect(snapshotRepository(subject.root)).toEqual(before)
	}

	for (const [requested, version] of [
		["~1.1.0", "1.10.3"],
		["^2.0.0", "20.1.0"],
		[">1.2.3", "1.2.3"],
		["garbage", "1.2.3"],
	] as const) {
		const subject = fixture({ production: "workspace" })
		setFrozenDependency(subject, requested, version)
		const before = snapshotRepository(subject.root)
		const result = await createPluginPayloadProduction().produce(checkRequest(subject))
		expectNoWrite(subject, before, result, "dependency-refused")
	}
})

test("IR10 refuses computed imports and runtime-loader escapes in workspace bundles", async () => {
	for (const workspaceSource of [
		'export const loaded = import("./" + "dynamic");\n',
		"export const loaded = globalThis;\n",
	]) {
		const subject = fixture({ production: "workspace", workspaceSource })
		const before = snapshotRepository(subject.root)
		const result = await createPluginPayloadProduction().produce(checkRequest(subject))
		expectRefusal(result, "bundle-refused")
		expect(snapshotRepository(subject.root)).toEqual(before)
	}
})
