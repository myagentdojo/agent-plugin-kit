import { afterEach, expect, test } from "bun:test"
import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PayloadProductionResult, PreparedProjectionDeclaration } from "../interface"
import { createPluginPayloadProduction } from "../implementation/plugin-payload-production"
import {
	canonicalConfiguration,
	checkRequest,
	cleanupFixture,
	compareCodeUnits,
	createPayloadFixture,
	expectedBundleInventoryShell,
	expectedClaudeManifest,
	expectedClaudeMarketplace,
	expectedCodexManifest,
	expectedCodexMarketplace,
	expectedDependencyNotices,
	expectedSkillInventory,
	expectedWorkspaceBundle,
	independentFramedDigest,
	independentSha256,
	materializeRequest,
	observedFile,
	observedPluginFiles,
	projectionDeclarationFor,
	snapshotRepository,
	temporaryEntries,
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

const produceCheck = (subject: PayloadProductionFixture) =>
	createPluginPayloadProduction().produce(checkRequest(subject))

const produceMaterialize = (subject: PayloadProductionFixture) =>
	createPluginPayloadProduction().produce(materializeRequest(subject))

const expectRefusal = (result: PayloadProductionResult, code: string): void => {
	expect(result).toMatchObject({ kind: "refused", code })
	if (result.kind === "refused") expect(result.nextAction.length).toBeGreaterThan(0)
}

const expectMaterialized = async (subject: PayloadProductionFixture) => {
	const result = await produceMaterialize(subject)
	expect(result.kind).toBe("materialized")
	if (result.kind !== "materialized") throw new Error(`expected materialized result, observed ${JSON.stringify(result)}`)
	return result
}

const declarationOrder = (left: PreparedProjectionDeclaration, right: PreparedProjectionDeclaration): number =>
	compareCodeUnits(left.role, right.role) || compareCodeUnits(left.path, right.path)

const ownedOutputPaths = [
	".agents/plugins/marketplace.json",
	".claude-plugin/marketplace.json",
	"plugin/.claude-plugin/plugin.json",
	"plugin/.codex-plugin/plugin.json",
	"plugin/THIRD-PARTY-NOTICES.md",
	"plugin/runtime/bundle-inventory.json",
	"plugin/runtime/bundle-inventory.sh",
	"plugin/skill-inventory.json",
]

const expectedSourceProjections = (subject: PayloadProductionFixture): PreparedProjectionDeclaration[] =>
	[
		projectionDeclarationFor("config", subject.sourceProjectionPaths.config, new Uint8Array(readFileSync(join(subject.root, subject.sourceProjectionPaths.config)))),
		projectionDeclarationFor("runtime-lock", subject.sourceProjectionPaths.runtimeLock, new Uint8Array(readFileSync(join(subject.root, subject.sourceProjectionPaths.runtimeLock)))),
		projectionDeclarationFor("skill-inventory", subject.sourceProjectionPaths.skillInventory, new Uint8Array(readFileSync(join(subject.root, subject.sourceProjectionPaths.skillInventory)))),
	]

const assertSortedUnique = (paths: readonly string[]): void => {
	expect(new Set(paths).size).toBe(paths.length)
	expect([...paths]).toEqual([...paths].sort(compareCodeUnits))
}

const assertCandidateAgreement = (
	subject: PayloadProductionFixture,
	candidate: Extract<PayloadProductionResult, { kind: "checked" | "materialized" }>["candidate"],
): void => {
	const pluginFiles = observedPluginFiles(subject)
	const expectedFiles = pluginFiles.map((file) => ({
		path: file.path,
		bytes: file.bytes.byteLength,
		sha256: `sha256:${independentSha256(file.bytes)}` as `sha256:${string}`,
		executable: file.executable,
	}))
	expect(candidate.files).toEqual(expectedFiles)
	expect(candidate.payloadSha256).toBe(`sha256:${independentFramedDigest(pluginFiles)}`)

	const projections = [
		...expectedSourceProjections(subject),
		projectionDeclarationFor("bundle-inventory", "plugin/runtime/bundle-inventory.json", new Uint8Array(readFileSync(join(subject.root, "plugin/runtime/bundle-inventory.json")))),
		projectionDeclarationFor("native-manifest", "plugin/.codex-plugin/plugin.json", new Uint8Array(readFileSync(join(subject.root, "plugin/.codex-plugin/plugin.json")))),
		projectionDeclarationFor("native-manifest", "plugin/.claude-plugin/plugin.json", new Uint8Array(readFileSync(join(subject.root, "plugin/.claude-plugin/plugin.json")))),
	].sort(declarationOrder)
	expect(candidate.projections).toEqual(projections)
	assertSortedUnique(candidate.files.map((file) => file.path))
	expect(new Set(candidate.projections.map((projection) => projection.path)).size).toBe(candidate.projections.length)
	expect(candidate.projections).toEqual([...candidate.projections].sort(declarationOrder))

	const owned = ownedOutputPaths.map((path) => {
		const file = observedFile(subject.root, path)
		return {
			path,
			bytes: file.bytes.byteLength,
			sha256: `sha256:${independentSha256(file.bytes)}` as `sha256:${string}`,
			executable: file.executable,
		}
	})
	expect(candidate.ownedFiles).toEqual(owned)
	assertSortedUnique(candidate.ownedFiles.map((file) => file.path))
}

const expectFailurePathPartition = (
	result: Extract<PayloadProductionResult, { kind: "materialization-failed" }>,
	ownedPaths: readonly string[],
): void => {
	if (result.state === "unknown") {
		expect(result.changedPaths).toBeNull()
		expect(result.remainingPaths).toBeNull()
		return
	}
	const changed = [...result.changedPaths].sort(compareCodeUnits)
	const remaining = [...result.remainingPaths].sort(compareCodeUnits)
	expect(new Set([...changed, ...remaining]).size).toBe(ownedPaths.length)
	expect([...new Set([...changed, ...remaining])].sort(compareCodeUnits)).toEqual([...ownedPaths].sort(compareCodeUnits))
	if (result.state === "none") expect(changed).toEqual([])
	else expect(changed.length).toBeGreaterThan(0)
}

test("CM01 accepts strict normalized configuration and all source projections", async () => {
	const subject = fixture()
	const result = await expectMaterialized(subject)
	expect(result.candidate.projections.filter((projection) =>
		projection.role === "config" || projection.role === "runtime-lock" || projection.role === "skill-inventory",
	)).toEqual(expectSourceProjectionRecords(subject))
	expect(result.candidate.projections.map((projection) => projection.role)).toContain("config")
	expect(result.candidate.projections.map((projection) => projection.role)).toContain("runtime-lock")
	expect(result.candidate.projections.map((projection) => projection.role)).toContain("skill-inventory")
	expect(subject.request.configuration).toEqual(canonicalConfiguration)
})

const expectSourceProjectionRecords = (subject: PayloadProductionFixture): PreparedProjectionDeclaration[] =>
	expectedSourceProjections(subject).sort(declarationOrder)

test("CM02 produces a deterministic complete candidate for equal fixture inputs", async () => {
	const first = fixture()
	const second = fixture()
	const firstResult = await expectMaterialized(first)
	const secondResult = await expectMaterialized(second)
	expect(secondResult.candidate).toEqual(firstResult.candidate)
	expect(secondResult.changedPaths).toEqual(firstResult.changedPaths)
	expect(secondResult.removedPaths).toEqual(firstResult.removedPaths)
	expect(readFileSync(join(first.root, "plugin/.claude-plugin/plugin.json"))).toEqual(readFileSync(join(second.root, "plugin/.claude-plugin/plugin.json")))
	expect(readFileSync(join(first.root, "plugin/.codex-plugin/plugin.json"))).toEqual(readFileSync(join(second.root, "plugin/.codex-plugin/plugin.json")))
})

test("CM03 renders exactly four manifests and preserves hook and native inputs", async () => {
	const subject = fixture()
	await expectMaterialized(subject)
	expect(readFileSync(join(subject.root, ".claude-plugin/marketplace.json"), "utf8")).toBe(expectedClaudeMarketplace)
	expect(readFileSync(join(subject.root, ".agents/plugins/marketplace.json"), "utf8")).toBe(expectedCodexMarketplace)
	expect(readFileSync(join(subject.pluginRoot, ".claude-plugin/plugin.json"), "utf8")).toBe(expectedClaudeManifest)
	expect(readFileSync(join(subject.pluginRoot, ".codex-plugin/plugin.json"), "utf8")).toBe(expectedCodexManifest)
	expect(readFileSync(join(subject.pluginRoot, "hooks/claude/hooks.json"), "utf8")).toBe('{"hooks":["claude"]}\n')
	expect(readFileSync(join(subject.pluginRoot, "hooks/codex/hooks.json"), "utf8")).toBe('{"hooks":["codex"]}\n')
	expect(readFileSync(join(subject.pluginRoot, "native/capability.json"), "utf8")).toBe('{"capability":"fixture-native"}\n')
	expect(ownedOutputPaths.filter((path) => path.endsWith("marketplace.json") || path.endsWith("plugin.json"))).toEqual([
		".agents/plugins/marketplace.json",
		".claude-plugin/marketplace.json",
		"plugin/.claude-plugin/plugin.json",
		"plugin/.codex-plugin/plugin.json",
	])
})

test("CM04 writes the exact ordered installed skill inventory", async () => {
	const subject = fixture()
	const result = await expectMaterialized(subject)
	expect(readFileSync(join(subject.pluginRoot, "skill-inventory.json"), "utf8")).toBe(expectedSkillInventory)
	expect(result.candidate.files.find((file) => file.path === "skill-inventory.json")?.sha256).toBe(
		`sha256:${independentSha256(expectedSkillInventory)}`,
	)
})

test("CM05 admits a frozen workspace and records an independently hashed bundle", async () => {
	const subject = fixture({ production: "workspace" })
	const dependencyBefore = snapshotRepository(subject.root).filter((entry) =>
		entry.path === "bun.lock" || entry.path.startsWith("workspace/") || entry.path.startsWith("node_modules/.bun/"),
	)
	const lockBefore = readFileSync(subject.lockPath)
	expect(new TextDecoder().decode(lockBefore)).toContain('"fixture-dependency": "^1.0.0"')
	const result = await expectMaterialized(subject)
	const inventory = JSON.parse(readFileSync(join(subject.pluginRoot, "runtime/bundle-inventory.json"), "utf8")) as {
		bundles: Record<string, { path: string; bytes: number; sha256: string }>
	}
	const bundle = inventory.bundles.beta
	if (bundle === undefined) throw new Error("workspace bundle record is absent")
	expect(bundle.path).toMatch(/^runtime\/beta-[0-9a-f]{16}\.js$/u)
	const observed = observedFile(subject.pluginRoot, bundle.path)
	expect(new TextDecoder().decode(observed.bytes)).toBe(expectedWorkspaceBundle)
	expect(bundle.path).toBe(`runtime/beta-${independentSha256(expectedWorkspaceBundle).slice(0, 16)}.js`)
	expect(bundle.bytes).toBe(observed.bytes.byteLength)
	expect(bundle.sha256).toBe(independentSha256(observed.bytes))
	const declaration = result.candidate.files.find((file) => file.path === bundle.path)
	expect(declaration).toEqual({ path: bundle.path, bytes: bundle.bytes, sha256: `sha256:${bundle.sha256}`, executable: false })
	expect(readFileSync(subject.lockPath)).toEqual(lockBefore)
	expect(snapshotRepository(subject.root).filter((entry) =>
		entry.path === "bun.lock" || entry.path.startsWith("workspace/") || entry.path.startsWith("node_modules/.bun/"),
	)).toEqual(dependencyBefore)
})

test("CM06 preserves and records a prepared runtime entry", async () => {
	const subject = fixture({ production: "prepared" })
	const result = await expectMaterialized(subject)
	const prepared = observedFile(subject.pluginRoot, "runtime/prepared.js")
	expect(prepared.executable).toBe(true)
	expect(result.candidate.files.find((file) => file.path === "runtime/prepared.js")).toEqual({
		path: "runtime/prepared.js",
		bytes: prepared.bytes.byteLength,
		sha256: `sha256:${independentSha256(prepared.bytes)}`,
		executable: true,
	})
	const inventory = JSON.parse(readFileSync(join(subject.pluginRoot, "runtime/bundle-inventory.json"), "utf8")) as {
		bundles: Record<string, { path: string; bytes: number; sha256: string }>
	}
	expect(inventory.bundles).toEqual({
		beta: { path: "runtime/prepared.js", bytes: prepared.bytes.byteLength, sha256: independentSha256(prepared.bytes) },
	})
})

test("CM07 writes third-party notices from admitted dependency license and notice text", async () => {
	const subject = fixture({ production: "workspace" })
	await expectMaterialized(subject)
	const notices = new Uint8Array(readFileSync(join(subject.pluginRoot, "THIRD-PARTY-NOTICES.md")))
	expect(new TextDecoder().decode(notices)).toBe(expectedDependencyNotices)
	expect(new TextDecoder().decode(notices)).not.toContain("9.9.9")
	const inventory = JSON.parse(readFileSync(join(subject.pluginRoot, "runtime/bundle-inventory.json"), "utf8")) as {
		notices: { path: string; bytes: number; sha256: string }
	}
	expect(inventory.notices).toEqual({
		path: "THIRD-PARTY-NOTICES.md",
		bytes: notices.byteLength,
		sha256: independentSha256(notices),
	})
})

test("CM08 returns complete file, projection, owned-file, mode, and framed-digest evidence", async () => {
	const subject = fixture()
	const result = await expectMaterialized(subject)
	assertCandidateAgreement(subject, result.candidate)
	const shell = result.candidate.files.find((file) => file.path === "runtime/bundle-inventory.sh")
	expect(shell?.executable).toBe(false)
	expect(readFileSync(join(subject.pluginRoot, "runtime/bundle-inventory.sh"), "utf8")).toBe(expectedBundleInventoryShell)
	const pluginFiles = observedPluginFiles(subject)
	expect(result.candidate.payloadSha256).toBe(`sha256:${independentFramedDigest(pluginFiles)}`)
})

test("CM09 check performs no repository write and removes external staging", async () => {
	const subject = fixture()
	await expectMaterialized(subject)
	const beforeRepository = snapshotRepository(subject.root)
	const beforeTemporary = temporaryEntries()
	const result = await produceCheck(subject)
	expect(result.kind).toBe("checked")
	expect(snapshotRepository(subject.root)).toEqual(beforeRepository)
	expect(temporaryEntries()).toEqual(beforeTemporary)
})

test("CM10 reports a clean checked candidate after materialization", async () => {
	const subject = fixture()
	const materialized = await expectMaterialized(subject)
	const checked = await produceCheck(subject)
	expect(checked.kind).toBe("checked")
	if (checked.kind !== "checked") return
	expect(checked.candidate).toEqual(materialized.candidate)
	expect(checked.nextAction.length).toBeGreaterThan(0)
})

test("CM11 orders drift paths and gives no deletion authority to a missing inventory", async () => {
	const subject = fixture()
	await expectMaterialized(subject)
	writeFileSync(join(subject.root, ".agents/plugins/marketplace.json"), "drift agents\n")
	writeFileSync(join(subject.root, ".claude-plugin/marketplace.json"), "drift claude\n")
	rmSync(join(subject.pluginRoot, "skill-inventory.json"))
	const drift = await produceCheck(subject)
	expectRefusal(drift, "payload-outdated")
	if (drift.kind === "refused" && drift.code === "payload-outdated") {
		expect(drift.paths).toEqual([
			".agents/plugins/marketplace.json",
			".claude-plugin/marketplace.json",
			"plugin/skill-inventory.json",
		])
	}

	const missing = fixture()
	const orphan = "runtime/legacy-0123456789abcdef.js"
	writeFileSync(join(missing.pluginRoot, orphan), "orphan\n")
	const before = readFileSync(join(missing.pluginRoot, orphan))
	const absentInventory = await produceCheck(missing)
	expectRefusal(absentInventory, "payload-outdated")
	if (absentInventory.kind === "refused" && absentInventory.code === "payload-outdated") expect(absentInventory.paths).toEqual([`plugin/${orphan}`])
	expect(readFileSync(join(missing.pluginRoot, orphan))).toEqual(before)

	const stale = fixture({ production: "workspace" })
	await expectMaterialized(stale)
	const staleBytes = "obsolete bundle\n"
	const staleDigest = independentSha256(staleBytes)
	const stalePath = `runtime/legacy-${staleDigest.slice(0, 16)}.js`
	writeFileSync(join(stale.pluginRoot, stalePath), staleBytes)
	const inventoryPath = join(stale.pluginRoot, "runtime/bundle-inventory.json")
	const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as {
		bundles: Record<string, { path: string; bytes: number; sha256: string }>
	}
	inventory.bundles.legacy = { path: stalePath, bytes: Buffer.byteLength(staleBytes), sha256: staleDigest }
	writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`)
	const removed = await expectMaterialized(stale)
	expect(removed.removedPaths).toEqual([`plugin/${stalePath}`])
	expect(existsSync(join(stale.pluginRoot, stalePath))).toBe(false)
})

test("CM12 materializes changed outputs then converges to an equal no-op", async () => {
	const subject = fixture()
	const first = await expectMaterialized(subject)
	expect(first.changedPaths.length).toBeGreaterThan(0)
	expect(first.changedPaths).toEqual([...first.changedPaths].sort(compareCodeUnits))
	expect(first.removedPaths).toEqual([])
	const beforeEqual = new Map(first.candidate.ownedFiles.map((file) => {
		const status = statSync(join(subject.root, file.path))
		return [file.path, { ino: status.ino, mtimeMs: status.mtimeMs }] as const
	}))
	const second = await expectMaterialized(subject)
	expect(second.changedPaths).toEqual([])
	expect(second.removedPaths).toEqual([])
	expect(second.unchangedPaths).toEqual(first.candidate.ownedFiles.map((file) => file.path))
	for (const [path, metadata] of beforeEqual) {
		const status = statSync(join(subject.root, path))
		expect({ ino: status.ino, mtimeMs: status.mtimeMs }).toEqual(metadata)
	}
})

test("CM13 preserves non-executable inventory mode evidence and repairs a changed generated mode", async () => {
	const subject = fixture()
	const first = await expectMaterialized(subject)
	expect(first.candidate.files.find((file) => file.path === "runtime/bundle-inventory.sh")?.executable).toBe(false)
	expect((statSync(join(subject.pluginRoot, "runtime/bundle-inventory.sh")).mode & 0o111) !== 0).toBe(false)
	chmodSync(join(subject.pluginRoot, "runtime/bundle-inventory.sh"), 0o755)
	const drift = await produceCheck(subject)
	expectRefusal(drift, "payload-outdated")
	if (drift.kind === "refused" && drift.code === "payload-outdated") expect(drift.paths).toContain("plugin/runtime/bundle-inventory.sh")
	const repaired = await expectMaterialized(subject)
	expect(repaired.changedPaths).toContain("plugin/runtime/bundle-inventory.sh")
	expect((statSync(join(subject.pluginRoot, "runtime/bundle-inventory.sh")).mode & 0o111) !== 0).toBe(false)
})

const materializationInterruptionPoints = [
	"materialization-staged",
	"materialization-file-published",
	"materialization-inventory-published",
	"materialization-verified",
] as const

type MaterializationInterruptionPoint = (typeof materializationInterruptionPoints)[number]

const expectInterruptionLocation = (
	target: MaterializationInterruptionPoint,
	seen: ReadonlyArray<readonly [string, string | undefined]>,
): void => {
	if (target === "materialization-staged" || target === "materialization-verified") expect(seen.at(-1)?.[1]).toBeUndefined()
	if (target === "materialization-file-published") expect(seen.at(-1)?.[1]).toBeDefined()
	if (target === "materialization-inventory-published") {
		expect(seen.at(-1)).toEqual(["materialization-inventory-published", "plugin/runtime/bundle-inventory.json"])
	}
}

const assertPublishedInventoryDependencies = (subject: PayloadProductionFixture): void => {
	const inventory = JSON.parse(readFileSync(join(subject.pluginRoot, "runtime/bundle-inventory.json"), "utf8")) as {
		bundles: Record<string, { path: string; bytes: number; sha256: string }>
		notices: { path: string; bytes: number; sha256: string }
	}
	for (const bundle of Object.values(inventory.bundles)) {
		const observed = observedFile(subject.pluginRoot, bundle.path)
		expect(observed.bytes.byteLength).toBe(bundle.bytes)
		expect(independentSha256(observed.bytes)).toBe(bundle.sha256)
	}
	const notices = observedFile(subject.pluginRoot, inventory.notices.path)
	expect(notices.bytes.byteLength).toBe(inventory.notices.bytes)
	expect(independentSha256(notices.bytes)).toBe(inventory.notices.sha256)
}

const verifyMaterializationInterruption = async (target: MaterializationInterruptionPoint): Promise<void> => {
	const subject = fixture()
	const seen: Array<[string, string | undefined]> = []
	let inventoryDependenciesPublished = false
	const interrupted = await createPluginPayloadProduction({
		interrupt: (point, path) => {
			seen.push([point, path])
			if (point === "materialization-inventory-published") {
				assertPublishedInventoryDependencies(subject)
				inventoryDependenciesPublished = true
			}
			if (point === target) throw new Error(`interrupt ${target}`)
		},
	}).produce(materializeRequest(subject))
	expect(interrupted.kind).toBe("materialization-failed")
	if (interrupted.kind !== "materialization-failed") return
	expect(interrupted.code).toBe("materialization-interrupted")
	expect(interrupted.transient).toBe(false)
	expectFailurePathPartition(interrupted, ownedOutputPaths)
	expectInterruptionLocation(target, seen)
	if (target === "materialization-inventory-published") expect(inventoryDependenciesPublished).toBe(true)
	const afterInterrupt = await produceCheck(subject)
	if (target === "materialization-verified") expect(afterInterrupt.kind).toBe("checked")
	else expectRefusal(afterInterrupt, "payload-outdated")
	const repeated = await produceMaterialize(subject)
	expect(repeated.kind).toBe("materialized")
	if (repeated.kind === "materialized") {
		expect(repeated.changedPaths).toEqual([...repeated.changedPaths].sort(compareCodeUnits))
		expect(repeated.removedPaths).toEqual([])
	}
	expect((await produceCheck(subject)).kind).toBe("checked")
}

test("CM14 reports exact named interruption states and converges on repeat materialization", async () => {
	for (const target of materializationInterruptionPoints) await verifyMaterializationInterruption(target)

	const workspace = fixture({ production: "workspace" })
	let interruptedBundlePath: string | undefined
	const interrupted = await createPluginPayloadProduction({
		interrupt: (point, path) => {
			if (point !== "materialization-file-published" || path === undefined || !/^plugin\/runtime\/beta-[0-9a-f]{16}\.js$/u.test(path)) return
			interruptedBundlePath = path
			throw new Error("interrupt after workspace bundle publication")
		},
	}).produce(materializeRequest(workspace))
	expect(interrupted.kind).toBe("materialization-failed")
	expect(interruptedBundlePath).toMatch(/^plugin\/runtime\/beta-[0-9a-f]{16}\.js$/u)
	if (interruptedBundlePath === undefined) throw new Error("workspace bundle publication was not observed")
	expect(existsSync(join(workspace.root, interruptedBundlePath))).toBe(true)
	expect(existsSync(join(workspace.pluginRoot, "runtime/bundle-inventory.json"))).toBe(false)
	const repeated = await produceMaterialize(workspace)
	expect(repeated.kind).toBe("materialized")
	if (repeated.kind === "materialized") expect(repeated.removedPaths).toEqual([])
	expect(existsSync(join(workspace.root, interruptedBundlePath))).toBe(true)
	expect((await produceCheck(workspace)).kind).toBe("checked")
})

test("CM15 independently rereads the final candidate and refuses invalid inventory before writes or deletes", async () => {
	const subject = fixture()
	const materialized = await expectMaterialized(subject)
	assertCandidateAgreement(subject, materialized.candidate)
	const checked = await produceCheck(subject)
	expect(checked.kind).toBe("checked")
	if (checked.kind === "checked") assertCandidateAgreement(subject, checked.candidate)

	const invalid = fixture({ production: "workspace" })
	await expectMaterialized(invalid)
	const orphanBytes = "obsolete\n"
	const orphanDigest = independentSha256(orphanBytes)
	const orphan = `runtime/obsolete-${orphanDigest.slice(0, 16)}.js`
	writeFileSync(join(invalid.pluginRoot, orphan), orphanBytes)
	const inventoryPath = join(invalid.pluginRoot, "runtime/bundle-inventory.json")
	const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as {
		bundles: Record<string, { path: string; bytes: number; sha256: string }>
	}
	const beta = inventory.bundles.beta
	if (beta === undefined) throw new Error("workspace bundle record is absent")
	beta.sha256 = "0".repeat(64)
	writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`)
	const before = snapshotRepository(invalid.root)
	const result = await produceMaterialize(invalid)
	expectRefusal(result, "inventory-invalid")
	expect(snapshotRepository(invalid.root)).toEqual(before)
	expect(existsSync(join(invalid.pluginRoot, orphan))).toBe(true)

	const invalidSchema = fixture()
	await expectMaterialized(invalidSchema)
	const schemaOrphan = "runtime/obsolete-0123456789abcdef.js"
	writeFileSync(join(invalidSchema.pluginRoot, schemaOrphan), "obsolete schema bundle\n")
	writeFileSync(
		join(invalidSchema.pluginRoot, "runtime/bundle-inventory.json"),
		'{"schemaVersion":2,"bundles":{},"notices":{}}\n',
	)
	const schemaBefore = snapshotRepository(invalidSchema.root)
	const schemaResult = await produceMaterialize(invalidSchema)
	expectRefusal(schemaResult, "inventory-invalid")
	expect(snapshotRepository(invalidSchema.root)).toEqual(schemaBefore)
	expect(existsSync(join(invalidSchema.pluginRoot, schemaOrphan))).toBe(true)
})
