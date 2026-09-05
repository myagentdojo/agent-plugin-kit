import { createHash } from "node:crypto"
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import type { Stats } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type {
	PayloadCheckRequest,
	PayloadMaterializeRequest,
	PluginPayloadConfiguration,
	PreparedProjectionDeclaration,
} from "../../interface"

/**
 * Test-owned fixture and oracle for CM01-CM15 and IR01-IR10.
 *
 * The generated bodies below are deliberately literal. They do not import a
 * renderer, candidate builder, or implementation helper. Hashes and framed
 * digests are recomputed from bytes with node:crypto by the functions below.
 */

export type FixtureProduction = "model-only" | "prepared" | "workspace"

export type PayloadProductionFixture = {
	root: string
	pluginRoot: string
	workspaceRoot: string
	workspacePath: string
	workspaceEntry: string
	lockPath: string
	storeRoot: string
	dependencyRoot: string
	dependencyManifestPath: string
	sourceProjectionPaths: {
		config: string
		runtimeLock: string
		skillInventory: string
	}
	configuration: PluginPayloadConfiguration
	request: PayloadCheckRequest
	productPaths: readonly string[]
}

export type FixtureOptions = {
	production?: FixtureProduction
	workspaceSource?: string
	workspaceMain?: string
	includeLock?: boolean
	includeStore?: boolean
	dependencyManifest?: Record<string, unknown>
	nativeArtifact?: "binding.gyp" | "addon.node"
}

const fixtureSource = {
	config: '{"product":"fixture-config","revision":1}\n',
	runtimeLock: '{"runtime":"fixture-lock","revision":1}\n',
	skillInventory: '{"skills":["alpha","beta"]}\n',
} as const

const fixtureFiles = {
	alphaSkill: "# Alpha\n",
	betaSkill: "# Beta\n",
	claudeHooks: '{"hooks":["claude"]}\n',
	codexHooks: '{"hooks":["codex"]}\n',
	nativeCapability: '{"capability":"fixture-native"}\n',
	preparedRuntime: 'export const prepared = "fixture";\n',
} as const

export const canonicalConfiguration: PluginPayloadConfiguration = {
	plugin: {
		name: "fixture-plugin",
		displayName: "Fixture Plugin",
		version: "1.2.3",
		description: "Fixture plugin for payload contracts.",
		author: { name: "Fixture Author" },
		repository: "https://github.com/example/fixture-plugin.git",
		license: "MIT",
		keywords: ["fixture", "payload"],
		category: "Developer Tools",
		shortDescription: "Fixture payload",
		longDescription: "Fixture payload for the accepted payload production contract.",
		capabilities: ["payload-check", "payload-materialize"],
		defaultPrompts: ["Check this payload"],
		brandColor: "#123ABC",
		composerIcon: "./assets/fixture-plugin.svg",
		logo: "./assets/fixture-plugin.svg",
		hookDeclarationPaths: ["hooks/claude/hooks.json", "hooks/codex/hooks.json"],
	},
	skills: [
		{ id: "alpha", hookDependence: "hook-independent", production: { kind: "model-only" } },
		{ id: "beta", hookDependence: "hook-dependent", production: { kind: "prepared", entryPath: "runtime/prepared.js" } },
	],
}

export const expectedClaudeManifest = `{
  "name": "fixture-plugin",
  "displayName": "Fixture Plugin",
  "version": "1.2.3",
  "defaultEnabled": false,
  "description": "Fixture plugin for payload contracts.",
  "author": {
    "name": "Fixture Author"
  },
  "repository": "https://github.com/example/fixture-plugin.git",
  "license": "MIT",
  "keywords": [
    "fixture",
    "payload"
  ],
  "skills": "./skills/",
  "hooks": "./hooks/claude/hooks.json"
}
`

export const expectedCodexManifest = `{
  "name": "fixture-plugin",
  "version": "1.2.3",
  "description": "Fixture plugin for payload contracts.",
  "author": {
    "name": "Fixture Author"
  },
  "repository": "https://github.com/example/fixture-plugin.git",
  "license": "MIT",
  "keywords": [
    "fixture",
    "payload"
  ],
  "skills": "./skills/",
  "hooks": "./hooks/codex/hooks.json",
  "interface": {
    "displayName": "Fixture Plugin",
    "shortDescription": "Fixture payload",
    "longDescription": "Fixture payload for the accepted payload production contract.",
    "developerName": "Fixture Author",
    "category": "Developer Tools",
    "capabilities": [
      "payload-check",
      "payload-materialize"
    ],
    "defaultPrompt": [
      "Check this payload"
    ],
    "brandColor": "#123ABC",
    "composerIcon": "./assets/fixture-plugin.svg",
    "logo": "./assets/fixture-plugin.svg"
  }
}
`

export const expectedClaudeMarketplace = `{
  "name": "fixture-plugin",
  "owner": {
    "name": "Fixture Author"
  },
  "metadata": {
    "description": "Marketplace for Fixture Plugin",
    "version": "1.2.3"
  },
  "plugins": [
    {
      "name": "fixture-plugin",
      "displayName": "Fixture Plugin",
      "description": "Fixture plugin for payload contracts.",
      "author": {
        "name": "Fixture Author"
      },
      "source": "./plugin",
      "defaultEnabled": false
    }
  ]
}
`

export const expectedCodexMarketplace = `{
  "name": "fixture-plugin",
  "interface": {
    "displayName": "Fixture Plugin"
  },
  "plugins": [
    {
      "name": "fixture-plugin",
      "source": {
        "source": "local",
        "path": "./plugin"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Developer Tools"
    }
  ]
}
`

export const expectedSkillInventory = `{
  "schemaVersion": 1,
  "skills": [
    {
      "id": "alpha",
      "execution": "model-only",
      "hookDependence": "hook-independent"
    },
    {
      "id": "beta",
      "execution": "bun-backed",
      "hookDependence": "hook-dependent"
    }
  ]
}
`

export const expectedDependencyNotices = `# Third-Party Notices

Generated from bun.lock. Edit workspace dependencies, run bun install, then bun run build.

## fixture-dependency@1.0.0 (MIT)

Fixture dependency license text.

### Upstream NOTICE

Fixture dependency notice.
`

export const expectedWorkspaceBundle = '// @bun\nvar beta="workspace";export{beta};\n'

const writeFile = (path: string, bytes: Uint8Array | string, executable = false): void => {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, bytes)
	chmodSync(path, executable ? 0o755 : 0o644)
}

const dependencyLock = `{
  "workspaces": {
    "workspace/beta": {
      "dependencies": {
        "fixture-dependency": "^1.0.0"
      }
    }
  },
  "packages": {
    "fixture-dependency@9.9.9": [
      "fixture-dependency@9.9.9",
      "sha512-decoy",
      {}
    ],
    "fixture-dependency@1.0.0": [
      "fixture-dependency@1.0.0",
      "sha512-fixture",
      {}
    ]
  }
}
`

export const createPayloadFixture = (options: FixtureOptions = {}): PayloadProductionFixture => {
	const production = options.production ?? "prepared"
	const root = mkdtempSync(join(tmpdir(), "agent-plugin-kit-payload-contract-"))
	const pluginRoot = join(root, "plugin")
	const workspacePath = "workspace/beta"
	const workspaceRoot = join(root, workspacePath)
	const workspaceEntry = options.workspaceMain ?? "src/index.ts"
	const lockPath = join(root, "bun.lock")
	const storeRoot = join(root, "node_modules", ".bun")
	const dependencyRoot = join(storeRoot, "fixture-dependency@1.0.0", "node_modules", "fixture-dependency")
	const dependencyManifestPath = join(dependencyRoot, "package.json")
	const sourceProjectionPaths = {
		config: "inputs/config.json",
		runtimeLock: "inputs/runtime-lock.json",
		skillInventory: "inputs/skill-catalog.json",
	}

	mkdirSync(pluginRoot, { recursive: true })
	writeFile(join(root, sourceProjectionPaths.config), fixtureSource.config)
	writeFile(join(root, sourceProjectionPaths.runtimeLock), fixtureSource.runtimeLock)
	writeFile(join(root, sourceProjectionPaths.skillInventory), fixtureSource.skillInventory)

	const productPaths = [
		"skills/alpha/SKILL.md",
		"skills/beta/SKILL.md",
		"hooks/claude/hooks.json",
		"hooks/codex/hooks.json",
		"native/capability.json",
	]
	writeFile(join(pluginRoot, "skills/alpha/SKILL.md"), fixtureFiles.alphaSkill)
	writeFile(join(pluginRoot, "skills/beta/SKILL.md"), fixtureFiles.betaSkill)
	writeFile(join(pluginRoot, "hooks/claude/hooks.json"), fixtureFiles.claudeHooks)
	writeFile(join(pluginRoot, "hooks/codex/hooks.json"), fixtureFiles.codexHooks)
	writeFile(join(pluginRoot, "native/capability.json"), fixtureFiles.nativeCapability)

	if (production === "prepared") {
		writeFile(join(pluginRoot, "runtime/prepared.js"), fixtureFiles.preparedRuntime, true)
		productPaths.push("runtime/prepared.js")
	}

	if (production === "workspace") {
		writeFile(join(workspaceRoot, "package.json"), JSON.stringify({ name: "@fixture/beta", main: workspaceEntry }, null, 2) + "\n")
		writeFile(join(workspaceRoot, workspaceEntry), options.workspaceSource ?? 'export const beta = "workspace";\n')
		if (options.includeLock ?? true) writeFile(lockPath, dependencyLock)
		if (options.includeStore ?? true) {
			const decoyRoot = join(storeRoot, "fixture-dependency@9.9.9", "node_modules", "fixture-dependency")
			writeFile(join(decoyRoot, "package.json"), JSON.stringify({
				name: "fixture-dependency",
				version: "9.9.9",
				license: "MIT",
			}, null, 2) + "\n")
			writeFile(join(decoyRoot, "LICENSE.md"), "Decoy dependency license text.\n")
			const manifest = {
				name: "fixture-dependency",
				version: "1.0.0",
				license: "MIT",
				...options.dependencyManifest,
			}
			writeFile(dependencyManifestPath, JSON.stringify(manifest, null, 2) + "\n")
			writeFile(join(dependencyRoot, "LICENSE.md"), "Fixture dependency license text.\n")
			writeFile(join(dependencyRoot, "NOTICE.md"), "Fixture dependency notice.\n")
			if (options.nativeArtifact !== undefined) writeFile(join(dependencyRoot, options.nativeArtifact), "native fixture\n")
		}
	}

	const skills = canonicalConfiguration.skills.map((skill) => {
		if (production !== "workspace" || skill.id !== "beta") return skill
		return { ...skill, production: { kind: "workspace" as const, workspacePath, entryPath: "runtime/beta.js" } }
	})
	const normalizedSkills = production === "model-only"
		? skills.map((skill) =>
			skill.id === "beta" ? { ...skill, production: { kind: "model-only" as const } } : skill,
		)
		: skills
	const configuration: PluginPayloadConfiguration = {
		...canonicalConfiguration,
		skills: normalizedSkills,
	}
	return {
		root,
		pluginRoot,
		workspaceRoot,
		workspacePath,
		workspaceEntry,
		lockPath,
		storeRoot,
		dependencyRoot,
		dependencyManifestPath,
		sourceProjectionPaths,
		configuration,
		request: {
			repositoryRoot: root,
			mode: "check",
			configuration,
			sourceProjectionPaths,
		},
		productPaths,
	}
}

export const checkRequest = (fixture: PayloadProductionFixture, changes: Partial<PayloadCheckRequest> = {}): PayloadCheckRequest => ({
	...fixture.request,
	...changes,
})

export const materializeRequest = (
	fixture: PayloadProductionFixture,
	changes: Partial<PayloadMaterializeRequest> = {},
): PayloadMaterializeRequest => ({
	...fixture.request,
	mode: "materialize",
	...changes,
})

export const independentSha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex")

const frame = (length: number): Uint8Array => {
	const bytes = new Uint8Array(8)
	new DataView(bytes.buffer).setBigUint64(0, BigInt(length), false)
	return bytes
}

export type ObservedFile = {
	path: string
	bytes: Uint8Array
	executable: boolean
}

export const independentFramedDigest = (files: readonly ObservedFile[]): string => {
	const hash = createHash("sha256")
	for (const file of files) {
		const pathBytes = new TextEncoder().encode(file.path)
		hash.update(frame(pathBytes.byteLength))
		hash.update(pathBytes)
		hash.update(frame(file.bytes.byteLength))
		hash.update(file.bytes)
	}
	return hash.digest("hex")
}

export const compareCodeUnits = (left: string, right: string): number =>
	left < right ? -1 : left > right ? 1 : 0

export const observedFile = (root: string, path: string): ObservedFile => {
	const absolute = join(root, path)
	const status = lstatSync(absolute)
	if (!status.isFile() || status.isSymbolicLink()) throw new Error(`${path} is not a regular fixture file`)
	return { path, bytes: new Uint8Array(readFileSync(absolute)), executable: (status.mode & 0o111) !== 0 }
}

type FixtureEntry = {
	path: string
	absolute: string
	status: Stats
}

const walkFixture = (root: string, visit: (entry: FixtureEntry) => void): void => {
	const walk = (directory: string, prefix: string): void => {
		for (const name of readdirSync(directory).sort(compareCodeUnits)) {
			const path = prefix === "" ? name : `${prefix}/${name}`
			const absolute = join(directory, name)
			const status = lstatSync(absolute)
			visit({ path, absolute, status })
			if (status.isDirectory()) walk(absolute, path)
		}
	}
	walk(root, "")
}

export const observedPluginFiles = (fixture: PayloadProductionFixture): ObservedFile[] => {
	const files: ObservedFile[] = []
	walkFixture(fixture.pluginRoot, ({ path, status }) => {
		if (status.isSymbolicLink()) throw new Error(`plugin/${path} is a symlink`)
		if (status.isFile()) files.push(observedFile(fixture.pluginRoot, path))
		else if (!status.isDirectory()) throw new Error(`plugin/${path} is not a regular file`)
	})
	return files.sort((left, right) => compareCodeUnits(left.path, right.path))
}

export const projectionDeclarationFor = (
	role: PreparedProjectionDeclaration["role"],
	path: string,
	bytes: Uint8Array,
): PreparedProjectionDeclaration => ({
	role,
	path,
	bytes: bytes.byteLength,
	sha256: `sha256:${independentSha256(bytes)}`,
})

export type SnapshotEntry =
	| { kind: "directory"; path: string }
	| { kind: "file"; path: string; bytes: Uint8Array; mode: number }
	| { kind: "symlink"; path: string; target: string }

export const snapshotRepository = (root: string): SnapshotEntry[] => {
	const entries: SnapshotEntry[] = []
	walkFixture(root, ({ path, absolute, status }) => {
		if (status.isSymbolicLink()) entries.push({ kind: "symlink", path, target: readlinkSync(absolute) })
		else if (status.isDirectory()) entries.push({ kind: "directory", path })
		else if (status.isFile()) entries.push({ kind: "file", path, bytes: new Uint8Array(readFileSync(absolute)), mode: status.mode & 0o777 })
		else throw new Error(`${path} is a special file`)
	})
	return entries.sort((left, right) => compareCodeUnits(left.path, right.path))
}

export const temporaryEntries = (): string[] =>
	readdirSync(tmpdir()).filter((entry) => entry.startsWith("agent-plugin-kit-payload-")).sort(compareCodeUnits)

export const cleanupFixture = (fixture: PayloadProductionFixture): void => {
	if (existsSync(fixture.root)) rmSync(fixture.root, { recursive: true, force: true })
}
