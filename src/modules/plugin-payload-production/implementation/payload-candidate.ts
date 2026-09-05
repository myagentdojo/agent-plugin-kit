import { builtinModules } from "node:module"
import { tmpdir } from "node:os"
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { createHash } from "node:crypto"
import type {
  PayloadCheckRequest,
  PayloadMaterializeRequest,
  PayloadRefusalCode,
  PayloadSourceProjectionPaths,
  PluginPayloadConfiguration,
  PluginPayloadSkillConfiguration,
  PreparedFileDeclaration,
  PreparedPayloadCandidate,
  PreparedProjectionDeclaration,
  PreparedProjectionRole,
} from "../interface"

export type PayloadCandidateRequest = PayloadCheckRequest | PayloadMaterializeRequest

export type PayloadCandidateFile = {
  path: string
  bytes: Uint8Array
  executable: boolean
}

export type PayloadCandidateBuild = {
  candidate: PreparedPayloadCandidate
  payloadFiles: readonly PayloadCandidateFile[]
  generated: readonly PayloadCandidateFile[]
  generatedByPath: ReadonlyMap<string, PayloadCandidateFile>
  sourceProjectionBytes: ReadonlyMap<string, Uint8Array>
  removedPaths: readonly string[]
}

export class PayloadCandidateRefusal extends Error {
  constructor(readonly code: PayloadRefusalCode, readonly detail: string, readonly paths: readonly string[] = []) {
    super(detail)
    this.name = "PayloadCandidateRefusal"
  }
}

export class MaterializationPublishError extends Error {
  constructor(
    readonly code: "materialization-staging-failed" | "materialization-interrupted" | "materialization-verification-failed" | "materialization-state-unobservable",
    readonly publishedPaths: readonly string[],
    readonly remainingPaths: readonly string[],
    readonly unknownState = false,
    detail = "materialization failed",
  ) {
    super(detail)
    this.name = "MaterializationPublishError"
  }
}

type ExistingBundleInventory = {
  present: boolean
  ownedPaths: ReadonlySet<string>
}

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const sha256Hex = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex")
const prefixed = (hex: string): `sha256:${string}` => `sha256:${hex}`

const generatedPluginPaths = new Set([
  ".claude-plugin/plugin.json",
  ".agents/plugin.json",
  "skill-inventory.json",
  "runtime/bundle-inventory.json",
  "runtime/bundle-inventory.sh",
  "THIRD-PARTY-NOTICES.md",
])
const generatedRepositoryPaths = new Set([
  ".claude-plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
])
const managedBundlePattern = /^([a-z0-9]+(?:-[a-z0-9]+)*)-[a-f0-9]{16}\.js$/u
const skillIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const imagePathPattern = /^\.\/assets\/[a-z0-9]+(?:-[a-z0-9]+)*\.svg$/u
const strictSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*))(?:\.(?:(?:0|[1-9]\d*)|(?:\d*[A-Za-z-][0-9A-Za-z-]*)))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
const hasControlCharacter = (value: string): boolean => [...value].some((character) => {
  const code = character.charCodeAt(0)
  return code <= 0x1f || code === 0x7f
})
const supportedText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && !hasControlCharacter(value)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const permissiveLicenses = new Set(["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD"])
const nodeBuiltinNames = new Set(builtinModules)
const admittedBunBuiltins = new Set(["bun", "bun:sqlite"])
const runtimeEscapeBuiltins = new Set(["module", "node:module", "vm", "node:vm"])

const assertKeys = (value: object, expected: readonly string[], label: string): void => {
  const allowed = new Set(expected)
  const unknown = Object.keys(value).find((key) => !allowed.has(key))
  if (unknown !== undefined) throw new PayloadCandidateRefusal("configuration-invalid", `${label} contains unknown field ${JSON.stringify(unknown)}`)
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) throw new PayloadCandidateRefusal("configuration-invalid", `${label} is missing ${key}`)
  }
}

const normalized = (value: string): string => value.trim().replace(/\s+/gu, " ")

const uniqueNormalized = (values: readonly string[], caseInsensitive = false): boolean => {
  const seen = new Set<string>()
  for (const value of values) {
    const key = caseInsensitive ? normalized(value).toLocaleLowerCase("en-US") : normalized(value)
    if (seen.has(key)) return false
    seen.add(key)
  }
  return true
}

const safeRelativePath = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.includes("\\") && !value.includes("\0") &&
  value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")

const isInside = (path: string, root: string): boolean => path === root || path.startsWith(`${root}${sep}`)

const physicalPath = (root: string, path: string, code: PayloadRefusalCode = "unsafe-entry"): string => {
  if (!safeRelativePath(path)) throw new PayloadCandidateRefusal(code, `${path}: unsafe relative path`)
  let current = root
  const segments = path.split("/")
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment)
    let status: ReturnType<typeof lstatSync>
    try {
      status = lstatSync(current)
    } catch {
      throw new PayloadCandidateRefusal(code, `${path}: path is absent`)
    }
    if (status.isSymbolicLink()) throw new PayloadCandidateRefusal("unsafe-entry", `${path}: path component ${JSON.stringify(segment)} is a symlink`)
    if (index < segments.length - 1 && !status.isDirectory()) throw new PayloadCandidateRefusal(code, `${path}: ancestor is not a directory`)
  }
  return current
}

const regularFile = (root: string, path: string, code: PayloadRefusalCode): string => {
  const absolute = physicalPath(root, path, code)
  const status = lstatSync(absolute)
  if (status.isSymbolicLink() || !status.isFile()) throw new PayloadCandidateRefusal(code, `${path}: not a regular file`)
  return absolute
}

const json = (value: unknown): Uint8Array => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)

const readBytes = (path: string): Uint8Array => new Uint8Array(readFileSync(path))

const framedPayloadDigest = (files: readonly PayloadCandidateFile[]): `sha256:${string}` => {
  const hash = createHash("sha256")
  for (const file of files) {
    const pathBytes = new TextEncoder().encode(file.path)
    const frame = Buffer.alloc(8)
    frame.writeBigUInt64BE(BigInt(pathBytes.byteLength))
    hash.update(frame)
    hash.update(pathBytes)
    frame.writeBigUInt64BE(BigInt(file.bytes.byteLength))
    hash.update(frame)
    hash.update(file.bytes)
  }
  return prefixed(hash.digest("hex"))
}

const fileDeclaration = (file: PayloadCandidateFile): PreparedFileDeclaration => ({
  path: file.path,
  bytes: file.bytes.byteLength,
  sha256: prefixed(sha256Hex(file.bytes)),
  executable: file.executable,
})

const projection = (role: PreparedProjectionRole, path: string, bytes: Uint8Array): PreparedProjectionDeclaration => ({
  role,
  path,
  bytes: bytes.byteLength,
  sha256: prefixed(sha256Hex(bytes)),
})

const sortFiles = (files: readonly PayloadCandidateFile[]): PayloadCandidateFile[] =>
  [...files].sort((left, right) => compareCodeUnits(left.path, right.path))

const sortDeclarations = (files: readonly PreparedFileDeclaration[]): PreparedFileDeclaration[] =>
  [...files].sort((left, right) => compareCodeUnits(left.path, right.path))

const projectionOrder = (left: PreparedProjectionDeclaration, right: PreparedProjectionDeclaration): number =>
  compareCodeUnits(left.role, right.role) || compareCodeUnits(left.path, right.path)

const declaredPluginFile = (root: string, path: string): PayloadCandidateFile => {
  const absolute = regularFile(root, path, "declared-file-missing")
  const status = lstatSync(absolute)
  return { path, bytes: readBytes(absolute), executable: (status.mode & 0o111) !== 0 }
}

const walkPlugin = (pluginRoot: string): PayloadCandidateFile[] => {
  const files: PayloadCandidateFile[] = []
  const walk = (directory: string, prefix: string): void => {
    const entries = readdirSync(directory).sort(compareCodeUnits)
    if (entries.length === 0) throw new PayloadCandidateRefusal("unsafe-entry", `plugin/${prefix}: empty directory`)
    for (const entry of entries) {
      const relativePath = prefix === "" ? entry : `${prefix}/${entry}`
      const absolute = join(directory, entry)
      const status = lstatSync(absolute)
      if (status.isSymbolicLink()) throw new PayloadCandidateRefusal("unsafe-entry", `plugin/${relativePath}: symlink`)
      if (status.isDirectory()) {
        walk(absolute, relativePath)
      } else if (status.isFile()) {
        files.push({ path: relativePath, bytes: readBytes(absolute), executable: (status.mode & 0o111) !== 0 })
      } else {
        throw new PayloadCandidateRefusal("unsafe-entry", `plugin/${relativePath}: special file`)
      }
    }
  }
  walk(pluginRoot, "")
  return files.sort((left, right) => compareCodeUnits(left.path, right.path))
}

type PayloadPluginConfiguration = PluginPayloadConfiguration["plugin"]

const invalidConfiguration = (detail: string): never => {
  throw new PayloadCandidateRefusal("configuration-invalid", detail)
}

const repositoryUrl = (repository: string): URL => {
  try {
    return new URL(repository)
  } catch {
    return invalidConfiguration("repository must be a canonical GitHub HTTPS URL")
  }
}

const validateRepository = (repository: unknown): void => {
  const value = typeof repository === "string"
    ? repository
    : invalidConfiguration("repository must be a canonical GitHub HTTPS URL")
  if (value.length > 2048) {
    invalidConfiguration("repository must be a canonical GitHub HTTPS URL")
  }
  const parsed = repositoryUrl(value)
  const validParts = [
    parsed.protocol === "https:",
    parsed.hostname.toLowerCase() === "github.com",
    parsed.username === "",
    parsed.password === "",
    parsed.port === "",
    parsed.search === "",
    parsed.hash === "",
    /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/u.test(parsed.pathname),
  ]
  if (validParts.includes(false)) {
    invalidConfiguration("repository must be a canonical GitHub HTTPS URL without credentials, port, query, or fragment")
  }
}

const validatePluginIdentity = (plugin: PayloadPluginConfiguration): void => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(plugin.name) || plugin.name.length > 64) invalidConfiguration("plugin.name must be kebab-case and at most 64 characters")
  if (!strictSemver.test(plugin.version) || plugin.version.length > 64) invalidConfiguration("plugin.version must be strict SemVer and at most 64 characters")
  if (!/^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/u.test(plugin.license)) invalidConfiguration("plugin.license is invalid")
}

const validatePluginDescriptions = (plugin: PayloadPluginConfiguration): void => {
  if (!supportedText(plugin.displayName) || plugin.displayName.length > 30) invalidConfiguration("plugin.displayName must be supported text of at most 30 characters")
  if (!supportedText(plugin.description) || plugin.description.length > 1024) invalidConfiguration("plugin.description must be supported text of at most 1024 characters")
  const invalidShort = !supportedText(plugin.shortDescription) || plugin.shortDescription.length > 30
  const invalidLong = !supportedText(plugin.longDescription) || plugin.longDescription.length > 1024
  if (invalidShort || invalidLong) invalidConfiguration("plugin descriptions exceed their bounds")
}

const validatePluginAuthor = (plugin: PayloadPluginConfiguration): void => {
  if (typeof plugin.author !== "object" || plugin.author === null || Array.isArray(plugin.author)) invalidConfiguration("plugin.author must be an object")
  assertKeys(plugin.author, ["name"], "plugin.author")
  if (!supportedText(plugin.author.name) || plugin.author.name.length > 80) invalidConfiguration("plugin.author.name must be supported text of at most 80 characters")
  validateRepository(plugin.repository)
}

const validatePluginKeywords = (plugin: PayloadPluginConfiguration): void => {
  const invalidValue = (value: string): boolean => !supportedText(value) || value.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9 ._+-]*$/u.test(value)
  if (!Array.isArray(plugin.keywords) || plugin.keywords.length > 20 || !uniqueNormalized(plugin.keywords, true) || plugin.keywords.some(invalidValue)) invalidConfiguration("plugin.keywords must be unique supported values")
}

const validatePluginCapabilities = (plugin: PayloadPluginConfiguration): void => {
  const invalidValue = (value: string): boolean => !supportedText(value) || value.length > 120
  if (!Array.isArray(plugin.capabilities) || plugin.capabilities.length > 20 || !uniqueNormalized(plugin.capabilities, true) || plugin.capabilities.some(invalidValue)) invalidConfiguration("plugin.capabilities must be unique supported values")
}

const validatePluginPrompts = (plugin: PayloadPluginConfiguration): void => {
  const invalidValue = (value: string): boolean => !supportedText(value) || value.length > 128 || value.trimStart().startsWith("@")
  if (!Array.isArray(plugin.defaultPrompts) || plugin.defaultPrompts.length > 3 || !uniqueNormalized(plugin.defaultPrompts) || plugin.defaultPrompts.some(invalidValue)) invalidConfiguration("plugin.defaultPrompts are invalid")
}

const validatePluginPresentation = (plugin: PayloadPluginConfiguration): void => {
  const categories = ["Productivity", "Creativity", "Developer Tools", "Business & Operations", "Data & Analytics", "Communication", "Education & Research", "Security", "Finance", "Healthcare", "Travel", "Entertainment", "Other"] as const
  if (!categories.includes(plugin.category)) invalidConfiguration("plugin.category is unsupported")
  if (!/^#[0-9A-F]{6}$/u.test(plugin.brandColor) || !imagePathPattern.test(plugin.composerIcon) || !imagePathPattern.test(plugin.logo)) invalidConfiguration("plugin presentation fields are invalid")
}

const validateHookDeclarationPaths = (paths: readonly string[]): void => {
  if (!Array.isArray(paths) || !uniqueNormalized(paths) || paths.some((path) => !safeRelativePath(path))) invalidConfiguration("hookDeclarationPaths must be unique safe payload paths")
  const sorted = paths.every((path, index) => index === 0 || compareCodeUnits(paths[index - 1] as string, path) < 0)
  if (!sorted) invalidConfiguration("hookDeclarationPaths must be unique in code-unit order")
}

const validateSkillProduction = (skill: PluginPayloadSkillConfiguration): void => {
  const production = skill.production
  if (!isRecord(production)) invalidConfiguration(`skill ${skill.id} production is invalid`)
  const label = `skill ${skill.id}.production`
  switch (production.kind) {
    case "model-only":
      assertKeys(production, ["kind"], label)
      return
    case "workspace":
      assertKeys(production, ["kind", "workspacePath", "entryPath"], label)
      if ([safeRelativePath(production.workspacePath), /^runtime\/[a-z0-9]+(?:-[a-z0-9]+)*\.js$/u.test(production.entryPath)].includes(false)) invalidConfiguration(`skill ${skill.id} workspace paths are invalid`)
      return
    case "prepared":
      assertKeys(production, ["kind", "entryPath"], label)
      if (!/^runtime\/[a-z0-9]+(?:-[a-z0-9]+)*\.js$/u.test(production.entryPath)) invalidConfiguration(`skill ${skill.id} prepared entry is invalid`)
      return
    default:
      invalidConfiguration(`skill ${skill.id} production kind is invalid`)
  }
}

const validateSkill = (
  skill: PluginPayloadSkillConfiguration,
  previous: string,
  ids: Set<string>,
): string => {
  if (!isRecord(skill)) invalidConfiguration("skill must be an object")
  assertKeys(skill, ["id", "hookDependence", "production"], "skill")
  const validIdentity = [
    skillIdPattern.test(skill.id),
    !ids.has(skill.id),
    previous === "" || compareCodeUnits(previous, skill.id) < 0,
  ]
  if (validIdentity.includes(false)) invalidConfiguration("skills must use unique code-unit sorted kebab IDs")
  ids.add(skill.id)
  if (!["hook-dependent", "hook-independent"].includes(skill.hookDependence)) invalidConfiguration(`skill ${skill.id} has invalid hook dependence`)
  validateSkillProduction(skill)
  return skill.id
}

const validateSkills = (skills: readonly PluginPayloadSkillConfiguration[]): void => {
  if (!Array.isArray(skills) || skills.length === 0) invalidConfiguration("skills must not be empty")
  let previous = ""
  const ids = new Set<string>()
  for (const skill of skills) {
    previous = validateSkill(skill, previous, ids)
  }
}

const validateConfiguration = (configuration: PluginPayloadConfiguration): void => {
  if (typeof configuration !== "object" || configuration === null || Array.isArray(configuration)) invalidConfiguration("configuration must be an object")
  assertKeys(configuration, ["plugin", "skills"], "configuration")
  const plugin = configuration.plugin
  if (typeof plugin !== "object" || plugin === null || Array.isArray(plugin)) invalidConfiguration("plugin must be an object")
  assertKeys(plugin, ["name", "displayName", "version", "description", "author", "repository", "license", "keywords", "category", "shortDescription", "longDescription", "capabilities", "defaultPrompts", "brandColor", "composerIcon", "logo", "hookDeclarationPaths"], "plugin")
  validatePluginIdentity(plugin)
  validatePluginDescriptions(plugin)
  validatePluginAuthor(plugin)
  validatePluginKeywords(plugin)
  validatePluginCapabilities(plugin)
  validatePluginPrompts(plugin)
  validatePluginPresentation(plugin)
  validateHookDeclarationPaths(plugin.hookDeclarationPaths)
  validateSkills(configuration.skills)
}

const safePluginPath = (path: string): boolean => safeRelativePath(path) && !generatedPluginPaths.has(path) && !generatedRepositoryPaths.has(path)

const normalizeRoot = (repositoryRoot: string): string => {
  const root = resolve(repositoryRoot)
  try {
    const status = lstatSync(root)
    if (status.isSymbolicLink() || !status.isDirectory()) throw new Error("not a directory")
    return realpathSync(root)
  } catch {
    throw new PayloadCandidateRefusal("repository-root-invalid", "repositoryRoot is not an existing directory")
  }
}

const normalizePluginRoot = (root: string): string => {
  const pluginRoot = join(root, "plugin")
  try {
    const status = lstatSync(pluginRoot)
    if (status.isSymbolicLink() || !status.isDirectory()) throw new Error("not a directory")
  } catch {
    throw new PayloadCandidateRefusal("payload-root-invalid", "plugin/ is not an existing directory")
  }
  return pluginRoot
}

const readProjectionInputs = (root: string, paths: PayloadSourceProjectionPaths): Map<string, Uint8Array> => {
  const values = new Map<string, Uint8Array>()
  const seen = new Set<string>()
  for (const path of [paths.config, paths.runtimeLock, paths.skillInventory]) {
    if (!safeRelativePath(path) || seen.has(path)) throw new PayloadCandidateRefusal("configuration-invalid", "source projection paths must be distinct safe relative paths")
    seen.add(path)
    const absolute = regularFile(root, path, "projection-mismatch")
    values.set(path, readBytes(absolute))
  }
  return values
}

type FrozenWorkspace = {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}
type FrozenPackage = { key: string; name: string; version: string; dependencies?: Record<string, string> }
type FrozenLock = { workspaces?: Record<string, FrozenWorkspace>; packages?: Record<string, unknown> }
type AdmittedDependency = { name: string; version: string; license: string; licenseText?: string; noticeText?: string }
type WorkspaceManifest = { name?: unknown; main?: unknown; dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; imports?: Record<string, unknown> }
type WorkspaceSource = { workspaceRoot: string; manifest: WorkspaceManifest; entry: string }

const parseFrozenLock = (root: string): FrozenLock => {
  const path = join(root, "bun.lock")
  if (!existsSync(path)) throw new PayloadCandidateRefusal("dependency-refused", "bun.lock is missing; restore the committed frozen lock before repeating payload:check")
  try {
    const parsed = Bun.JSONC.parse(new TextDecoder().decode(readBytes(path))) as FrozenLock
    if (typeof parsed !== "object" || parsed === null) throw new Error("lock is not an object")
    return parsed
  } catch {
    throw new PayloadCandidateRefusal("dependency-refused", "bun.lock is invalid JSONC; restore the committed frozen lock before repeating payload:check")
  }
}

const parsedPackage = (key: string, value: unknown): FrozenPackage => {
  if (!Array.isArray(value) || typeof value[0] !== "string") throw new PayloadCandidateRefusal("dependency-refused", `bun.lock package ${JSON.stringify(key)} is malformed`)
  const identity = value[0]
  const at = identity.lastIndexOf("@")
  if (at <= 0 || at === identity.length - 1) throw new PayloadCandidateRefusal("dependency-refused", `bun.lock package ${JSON.stringify(key)} has malformed identity`)
  const metadata = value[2]
  const dependencies = isRecord(metadata) ? (metadata as { dependencies?: Record<string, string> }).dependencies : undefined
  const base = { key, name: identity.slice(0, at), version: identity.slice(at + 1) }
  return dependencies === undefined ? base : { ...base, dependencies }
}

const parsedPackages = (lock: FrozenLock): Map<string, FrozenPackage> => new Map(
  Object.entries(lock.packages ?? {}).map(([key, value]) => [key, parsedPackage(key, value)]),
)

const partialSemver = /^(?:[xX*]|(?:0|[1-9]\d*)(?:\.(?:[xX*]|(?:0|[1-9]\d*)(?:\.(?:[xX*]|0|[1-9]\d*))?))?)$/u

const supportedSemverOperand = (value: string): boolean => strictSemver.test(value) || partialSemver.test(value)

const supportedSemverComparator = (value: string): boolean => {
  const match = /^(?:<=|>=|<|>|=|\^|~)?(.+)$/u.exec(value)
  return match !== null && supportedSemverOperand(match[1] ?? "")
}

const supportedSemverRange = (range: string): boolean => {
  if (range.trim().length === 0) return false
  return range.split("||").every((alternative) => {
    const value = alternative.trim()
    if (value.length === 0) return false
    const hyphen = /^(.+)\s+-\s+(.+)$/u.exec(value)
    if (hyphen !== null) {
      return supportedSemverOperand(hyphen[1]?.trim() ?? "") && supportedSemverOperand(hyphen[2]?.trim() ?? "")
    }
    return value.split(/\s+/u).every(supportedSemverComparator)
  })
}

const versionMatches = (version: string, requested: string): boolean => {
  if (requested === "*" || requested === "latest") return true
  if (requested.startsWith("workspace:")) return true
  return strictSemver.test(version) && supportedSemverRange(requested) && Bun.semver.satisfies(version, requested)
}

const dependencyTarget = (name: string, requested: string): { expectedName: string; range: string } => {
  if (!requested.startsWith("npm:")) return { expectedName: name, range: requested }
  const alias = requested.slice(4)
  const expectedName = alias.split("@")[0] ?? ""
  const separatorLength = alias.includes("@") ? 1 : 0
  return { expectedName, range: alias.slice(expectedName.length + separatorLength) || "*" }
}

const dependencyMatches = (candidate: FrozenPackage, expectedName: string, requested: string, range: string): boolean => {
  if (candidate.name !== expectedName) return false
  return requested.startsWith("workspace:")
    ? candidate.version.startsWith("workspace:")
    : versionMatches(candidate.version, range)
}

const lockDependency = (packages: Map<string, FrozenPackage>, name: string, requested: string, parent?: FrozenPackage): FrozenPackage => {
  const { expectedName, range } = dependencyTarget(name, requested)
  const direct = parent === undefined ? packages.get(name) : packages.get(`${parent.key}/${name}`) ?? packages.get(name)
  const candidates = direct === undefined
    ? [...packages.values()].filter((candidate) => candidate.name === expectedName)
    : [direct]
  const selected = candidates.find((candidate) => dependencyMatches(candidate, expectedName, requested, range))
  if (selected === undefined) throw new PayloadCandidateRefusal("dependency-refused", `bun.lock cannot resolve ${name}@${requested}`)
  return selected
}

const dependencyStore = (root: string, dependency: FrozenPackage): string => {
  for (const storeName of [`${dependency.name}@${dependency.version}`, `${dependency.name.replace("/", "+")}@${dependency.version}`]) {
    const candidate = join(root, "node_modules", ".bun", storeName, "node_modules", dependency.name)
    if (existsSync(join(candidate, "package.json"))) return candidate
  }
  throw new PayloadCandidateRefusal("dependency-refused", `${dependency.name}@${dependency.version} is not present in the installed package store; run bun install --frozen-lockfile`)
}

const readOptionalText = (directory: string, pattern: RegExp): string | undefined => {
  try {
    const entry = readdirSync(directory).sort(compareCodeUnits).find((name) => pattern.test(name))
    return entry === undefined ? undefined : new TextDecoder().decode(readBytes(join(directory, entry)))
  } catch {
    return undefined
  }
}

type DependencyRequest = { name: string; requested: string; parent?: FrozenPackage }

const workspaceDependencyRequests = (
  root: string,
  lock: FrozenLock,
  skills: readonly PluginPayloadSkillConfiguration[],
): DependencyRequest[] => {
  const requests: DependencyRequest[] = []
  for (const skill of skills) {
    if (skill.production.kind !== "workspace") continue
    requests.push(...workspaceRequests(root, lock, skill.production.workspacePath))
  }
  return requests
}

const workspaceRequests = (root: string, lock: FrozenLock, workspacePath: string): DependencyRequest[] => {
  const workspace = lock.workspaces?.[workspacePath]
  if (workspace === undefined) throw new PayloadCandidateRefusal("dependency-refused", `bun.lock has no workspace entry for ${workspacePath}`)
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(new TextDecoder().decode(readBytes(join(root, workspacePath, "package.json")))) as Record<string, unknown>
  } catch {
    throw new PayloadCandidateRefusal("dependency-refused", `${workspacePath}/package.json is missing or invalid`)
  }
  if (manifest.trustedDependencies !== undefined) throw new PayloadCandidateRefusal("dependency-refused", `${workspacePath}/package.json declares trustedDependencies`)
  return Object.entries({ ...(workspace.dependencies ?? {}), ...(workspace.peerDependencies ?? {}) })
    .map(([name, requested]) => ({ name, requested }))
}

const refuseRootTrustedDependencies = (root: string): void => {
  const manifestPath = join(root, "package.json")
  if (!existsSync(manifestPath)) return
  try {
    const manifest = JSON.parse(new TextDecoder().decode(readBytes(manifestPath))) as Record<string, unknown>
    if (manifest.trustedDependencies !== undefined) throw new PayloadCandidateRefusal("dependency-refused", "package.json declares trustedDependencies")
  } catch (error) {
    if (error instanceof PayloadCandidateRefusal) throw error
  }
}

const reachableDependencies = (
  packages: Map<string, FrozenPackage>,
  initial: readonly DependencyRequest[],
): FrozenPackage[] => {
  const reachable = new Map<string, FrozenPackage>()
  const queue = [...initial]
  while (queue.length > 0) {
    const request = queue.pop() as DependencyRequest
    const locked = lockDependency(packages, request.name, request.requested, request.parent)
    if (locked.version.startsWith("workspace:") || reachable.has(locked.key)) continue
    reachable.set(locked.key, locked)
    for (const [name, requested] of Object.entries(locked.dependencies ?? {})) queue.push({ name, requested, parent: locked })
  }
  return [...reachable.values()].sort((left, right) => compareCodeUnits(left.name, right.name) || compareCodeUnits(left.version, right.version))
}

const dependencyManifest = (directory: string, dependency: FrozenPackage): Record<string, unknown> => {
  try {
    return JSON.parse(new TextDecoder().decode(readBytes(join(directory, "package.json")))) as Record<string, unknown>
  } catch {
    throw new PayloadCandidateRefusal("dependency-refused", `${dependency.name}@${dependency.version} package.json is invalid`)
  }
}

const validateDependencyPeers = (
  packages: Map<string, FrozenPackage>,
  dependency: FrozenPackage,
  manifest: Record<string, unknown>,
): void => {
  if (typeof manifest.peerDependencies !== "object" || manifest.peerDependencies === null) return
  const optional = manifest.peerDependenciesMeta as Record<string, { optional?: boolean }> | undefined
  for (const [name, requested] of Object.entries(manifest.peerDependencies as Record<string, string>)) {
    if (optional?.[name]?.optional === true) continue
    try {
      lockDependency(packages, name, requested, dependency)
    } catch {
      throw new PayloadCandidateRefusal("dependency-refused", `${dependency.name}@${dependency.version} has an unresolved peer ${name}`)
    }
  }
}

const admittedDependencyLicense = (
  directory: string,
  dependency: FrozenPackage,
  manifest: Record<string, unknown>,
): string => {
  const scripts = manifest.scripts
  const lifecycleScript = isRecord(scripts) && ["preinstall", "install", "postinstall"].some((name) => Object.hasOwn(scripts, name))
  if (lifecycleScript) throw new PayloadCandidateRefusal("dependency-refused", `${dependency.name}@${dependency.version} declares a lifecycle script`)
  if (manifest.gypfile === true || findNative(directory)) throw new PayloadCandidateRefusal("dependency-refused", `${dependency.name}@${dependency.version} ships a native artifact`)
  const optionalDependencies = manifest.optionalDependencies
  if (isRecord(optionalDependencies) && Object.keys(optionalDependencies).length > 0) throw new PayloadCandidateRefusal("dependency-refused", `${dependency.name}@${dependency.version} declares optionalDependencies`)
  const license = manifest.license
  if (typeof license !== "string" || !permissiveLicenses.has(license)) throw new PayloadCandidateRefusal("dependency-refused", `${dependency.name}@${dependency.version} has a rejected license`)
  return license
}

const admittedDependency = (
  root: string,
  packages: Map<string, FrozenPackage>,
  dependency: FrozenPackage,
): AdmittedDependency => {
  const directory = dependencyStore(root, dependency)
  const manifest = dependencyManifest(directory, dependency)
  const license = admittedDependencyLicense(directory, dependency, manifest)
  validateDependencyPeers(packages, dependency, manifest)
  const licenseText = readOptionalText(directory, /^(license|licence|copying)(\.(md|txt))?$/iu)
  const noticeText = readOptionalText(directory, /^notice(\.(md|txt))?$/iu)
  return {
    name: dependency.name,
    version: dependency.version,
    license,
    ...(licenseText === undefined ? {} : { licenseText }),
    ...(noticeText === undefined ? {} : { noticeText }),
  }
}

const admitWorkspaceDependencies = (root: string, skills: readonly PluginPayloadSkillConfiguration[]): AdmittedDependency[] => {
  if (!skills.some((skill) => skill.production.kind === "workspace")) return []
  const lock = parseFrozenLock(root)
  if (!existsSync(join(root, "node_modules", ".bun"))) throw new PayloadCandidateRefusal("dependency-refused", "the installed package store is missing; run bun install --frozen-lockfile from the Plugin Repository root")
  const packages = parsedPackages(lock)
  const requests = workspaceDependencyRequests(root, lock, skills)
  refuseRootTrustedDependencies(root)
  return reachableDependencies(packages, requests).map((dependency) => admittedDependency(root, packages, dependency))
}

const findNative = (directory: string): string | undefined => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const nested = findNative(join(directory, entry.name))
      if (nested !== undefined) return `${entry.name}/${nested}`
    } else if (entry.name.endsWith(".node") || entry.name === "binding.gyp") return entry.name
  }
  return undefined
}

const allowedRuntimeSpecifier = (specifier: string): boolean => {
  if (specifier.startsWith("node:")) return nodeBuiltinNames.has(specifier.slice(5)) && !runtimeEscapeBuiltins.has(specifier)
  return nodeBuiltinNames.has(specifier) || admittedBunBuiltins.has(specifier)
}

const bundleTextRefusal = (skillId: string, detail: string): PayloadCandidateRefusal => new PayloadCandidateRefusal("bundle-refused", `bundle ${skillId}: ${detail}`)

const validateBundleText = (skillId: string, code: string): void => {
  const executable = code.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/[^\r\n]*/gu, " ").replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/gu, " ")
  if (/\b(?:eval|Function|createRequire|getBuiltinModule)\b|import\s*\.\s*meta|\bglobalThis\b/gu.test(executable)) throw bundleTextRefusal(skillId, "bundle retains a runtime loader or dynamic code generation escape")
  if (/\b(?:import\s*\(|(?:__require|require)\s*\()/gu.test(executable)) {
    const dynamic = /\b(?:import|__require|require)\s*\([^"'`]/u.test(executable)
    if (dynamic) throw bundleTextRefusal(skillId, "bundle retains a computed module load")
  }
  let imports: readonly { path: string }[] = []
  try { imports = new Bun.Transpiler({ loader: "js" }).scanImports(code) } catch { throw bundleTextRefusal(skillId, "bundle imports could not be inspected") }
  for (const entry of imports) {
    if (entry.path.startsWith(".") || allowedRuntimeSpecifier(entry.path)) continue
    throw bundleTextRefusal(skillId, `bundle retains an unadmitted bare specifier ${entry.path}`)
  }
}

const validateWorkspaceSource = (root: string, workspacePath: string): WorkspaceSource => {
  let workspaceRoot = physicalPath(root, workspacePath, "bundle-refused")
  try {
    if (!lstatSync(workspaceRoot).isDirectory()) throw new Error("workspace is not a directory")
    workspaceRoot = realpathSync(workspaceRoot)
  } catch {
    throw new PayloadCandidateRefusal("bundle-refused", `workspace ${workspacePath} is not a real directory`)
  }
  let manifest: WorkspaceManifest
  try { manifest = JSON.parse(new TextDecoder().decode(readBytes(join(workspaceRoot, "package.json")))) as WorkspaceManifest } catch { throw new PayloadCandidateRefusal("bundle-refused", `workspace ${workspacePath}/package.json is missing or invalid`) }
  if (typeof manifest.main !== "string" || manifest.main.length === 0) throw new PayloadCandidateRefusal("bundle-refused", `workspace ${workspacePath} does not declare a main entry`)
  const entry = join(workspaceRoot, manifest.main)
  let realEntry: string
  try { realEntry = realpathSync(entry) } catch { throw new PayloadCandidateRefusal("bundle-refused", `workspace ${workspacePath} main entry is missing`) }
  if (!isInside(realEntry, workspaceRoot) || !lstatSync(realEntry).isFile()) throw new PayloadCandidateRefusal("bundle-refused", `workspace ${workspacePath} main entry escapes the workspace`)
  return { workspaceRoot, manifest, entry }
}

type BundleArtifact = { path: string; bytes: Uint8Array; sha256: string }

const rejectedResolution = (violations: string[], path: string, detail: string): { path: string; external: true } => {
  violations.push(detail)
  return { path, external: true }
}

const resolvedOrRejected = (
  path: string,
  resolveDirectory: string,
  violations: string[],
  classify: (resolved: string) => string | undefined,
  unresolvedDetail: string,
): string | { path: string; external: true } => {
  try {
    const resolved = realpathSync(Bun.resolveSync(path, resolveDirectory))
    const violation = classify(resolved)
    return violation === undefined ? resolved : rejectedResolution(violations, path, violation)
  } catch {
    return rejectedResolution(violations, path, unresolvedDetail)
  }
}

const closedResolutionPlugin = (
  root: string,
  workspaceRoot: string,
  manifest: WorkspaceManifest,
  violations: string[],
): import("bun").BunPlugin => {
  const allowedRoots = [workspaceRoot, realpathSync(join(root, "node_modules"))]
  const bareImports = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...(typeof manifest.name === "string" ? [manifest.name] : []),
  ])
  const admittedPath = (path: string): boolean => allowedRoots.some((candidate) => isInside(path, candidate))
  return {
    name: "payload-closed-resolution",
    setup(builder) {
      builder.onResolve({ filter: /^(?:\.{1,2}\/|\/)/u }, (args) => {
        const classify = (resolved: string): string | undefined => {
          if (!isInside(resolved, root)) return `parent resolution: ${args.path}`
          return admittedPath(resolved) ? undefined : `unadmitted relative import: ${args.path}`
        }
        const resolution = resolvedOrRejected(args.path, args.resolveDir || dirname(args.importer), violations, classify, `unresolved relative import: ${args.path}`)
        if (typeof resolution !== "string") return resolution
        return undefined
      })
      builder.onResolve({ filter: /^[^./]/u }, (args) => {
        if (allowedRuntimeSpecifier(args.path)) return undefined
        const packageName = args.path.startsWith("@") ? args.path.split("/", 2).join("/") : args.path.split("/", 1)[0] ?? ""
        if (!isInside(args.importer, workspaceRoot) || !bareImports.has(packageName)) return rejectedResolution(violations, args.path, `unadmitted import: ${args.path}`)
        const classify = (resolved: string): string | undefined => admittedPath(resolved)
          ? undefined
          : `unadmitted package path: ${args.path}`
        const resolution = resolvedOrRejected(args.path, dirname(args.importer), violations, classify, `unresolved import: ${args.path}`)
        if (typeof resolution !== "string") return resolution
        return undefined
      })
      builder.onLoad({ filter: /\.(?:[cm]?[jt]sx?|json|jsonc)$/u, namespace: "file" }, (args) => {
        try {
          const resolved = realpathSync(args.path)
          if (!admittedPath(resolved)) {
            violations.push(`loaded path escapes: ${args.path}`)
            return { contents: "export default {};", loader: "js" as const }
          }
          if (resolved.endsWith(".node")) {
            violations.push(`native addon: ${args.path}`)
            return { contents: "export default {};", loader: "js" as const }
          }
        } catch {
          violations.push(`unreadable module: ${args.path}`)
        }
        return undefined
      })
    },
  }
}

const bundleWorkspace = async (
  root: string,
  skillId: string,
  workspacePath: string,
  logicalEntryPath: string,
  stagingRoot: string,
): Promise<BundleArtifact> => {
  const { workspaceRoot, manifest, entry } = validateWorkspaceSource(root, workspacePath)
  const outputDirectory = join(stagingRoot, skillId)
  mkdirSync(outputDirectory, { recursive: true })
  const violations: string[] = []
  const plugin = closedResolutionPlugin(root, workspaceRoot, manifest, violations)
  let result: Awaited<ReturnType<typeof Bun.build>>
  try {
    result = await Bun.build({ entrypoints: [entry], outdir: outputDirectory, naming: "bundle.js", target: "bun", format: "esm", splitting: false, sourcemap: "none", minify: { whitespace: true }, env: "disable", plugins: [plugin] })
  } catch (error) {
    throw new PayloadCandidateRefusal("bundle-refused", `bundle ${skillId} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (violations.length > 0) throw new PayloadCandidateRefusal("bundle-refused", `bundle ${skillId}: ${violations[0]}`)
  if (!result.success) throw new PayloadCandidateRefusal("bundle-refused", `bundle ${skillId} failed to build`)
  const outputs = readdirSync(outputDirectory).sort(compareCodeUnits)
  if (outputs.length !== 1 || outputs[0] !== "bundle.js") throw new PayloadCandidateRefusal("bundle-refused", `bundle ${skillId} emitted an unexpected output`)
  const bytes = readBytes(join(outputDirectory, "bundle.js"))
  validateBundleText(skillId, new TextDecoder().decode(bytes))
  const digest = sha256Hex(bytes)
  const stem = logicalEntryPath.slice("runtime/".length, -".js".length)
  return { path: `runtime/${stem}-${digest.slice(0, 16)}.js`, bytes, sha256: digest }
}

const nativeClaudeManifest = (configuration: PluginPayloadConfiguration): Uint8Array => json({
  name: configuration.plugin.name,
  displayName: configuration.plugin.displayName,
  version: configuration.plugin.version,
  defaultEnabled: false,
  description: configuration.plugin.description,
  author: configuration.plugin.author,
  repository: configuration.plugin.repository,
  license: configuration.plugin.license,
  keywords: configuration.plugin.keywords,
  skills: "./skills/",
  hooks: "./hooks/claude/hooks.json",
})

const nativeCodexManifest = (configuration: PluginPayloadConfiguration): Uint8Array => json({
  name: configuration.plugin.name,
  version: configuration.plugin.version,
  description: configuration.plugin.description,
  author: configuration.plugin.author,
  repository: configuration.plugin.repository,
  license: configuration.plugin.license,
  keywords: configuration.plugin.keywords,
  skills: "./skills/",
  hooks: "./hooks/codex/hooks.json",
  interface: {
    displayName: configuration.plugin.displayName,
    shortDescription: configuration.plugin.shortDescription,
    longDescription: configuration.plugin.longDescription,
    developerName: configuration.plugin.author.name,
    category: configuration.plugin.category,
    capabilities: configuration.plugin.capabilities,
    defaultPrompt: configuration.plugin.defaultPrompts,
    brandColor: configuration.plugin.brandColor,
    composerIcon: configuration.plugin.composerIcon,
    logo: configuration.plugin.logo,
  },
})

const claudeMarketplace = (configuration: PluginPayloadConfiguration): Uint8Array => json({
  name: configuration.plugin.name,
  owner: configuration.plugin.author,
  metadata: {
    description: `Marketplace for ${configuration.plugin.displayName}`,
    version: configuration.plugin.version,
  },
  plugins: [{
    name: configuration.plugin.name,
    displayName: configuration.plugin.displayName,
    description: configuration.plugin.description,
    author: configuration.plugin.author,
    source: "./plugin",
    defaultEnabled: false,
  }],
})

const codexMarketplace = (configuration: PluginPayloadConfiguration): Uint8Array => json({
  name: configuration.plugin.name,
  interface: { displayName: configuration.plugin.displayName },
  plugins: [{
    name: configuration.plugin.name,
    source: { source: "local", path: "./plugin" },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: configuration.plugin.category,
  }],
})

const inventoryJson = (bundles: Record<string, { path: string; bytes: number; sha256: string }>, notices: { path: string; bytes: number; sha256: string }): Uint8Array =>
  json({ schemaVersion: 1, bundles, notices })

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

const inventoryShell = (bundles: Record<string, { path: string; bytes: number; sha256: string }>): Uint8Array => {
  const cases = Object.keys(bundles).sort(compareCodeUnits).map((id) => {
    const bundle = bundles[id]
    if (bundle === undefined) throw new Error(`missing bundle record for ${id}`)
    return `\t${shellQuote(id)})\n\tRUNTIME_BUNDLE_PATH=${shellQuote(bundle.path)}\n\tRUNTIME_BUNDLE_BYTES=${shellQuote(String(bundle.bytes))}\n\tRUNTIME_BUNDLE_SHA256=${shellQuote(bundle.sha256)}\n\t;;`
  }).join("\n")
  return new TextEncoder().encode(`#!/bin/sh\n# Generated from bundle-inventory.json by Agent Plugin Kit.\nruntime_inventory_select_bundle() {\n\tcase "$1" in\n${cases}\n\t*) return 1 ;;\n\tesac\n}\n`)
}

const noticesText = (dependencies: readonly { name: string; version: string; license: string; licenseText?: string; noticeText?: string }[]): Uint8Array => {
  const sections = dependencies.map((dependency) => {
    const heading = `## ${dependency.name}@${dependency.version} (${dependency.license})`
    const license = dependency.licenseText?.replace(/\r\n?/gu, "\n").trimEnd() ?? "License text not distributed by the package."
    const notice = dependency.noticeText?.replace(/\r\n?/gu, "\n").trimEnd()
    return `${heading}\n\n${license}\n${notice === undefined ? "" : `\n### Upstream NOTICE\n\n${notice}\n`}`
  })
  return new TextEncoder().encode(`# Third-Party Notices\n\nGenerated from bun.lock. Edit workspace dependencies, run bun install, then bun run build.\n\n${sections.join("\n")}`)
}

const generatedFile = (path: string, bytes: Uint8Array, executable = false): PayloadCandidateFile => ({ path, bytes, executable })

const frameDigest = (files: readonly PayloadCandidateFile[]): `sha256:${string}` => framedPayloadDigest(files)

type BundleInventoryRecord = { path: string; bytes: number; sha256: string }

const parseBundleInventory = (pluginRoot: string): unknown => {
  try {
    // Inventory ownership is deletion authority. Read it through the same
    // physical-file guard as every other declared input so an inventory
    // symlink cannot silently grant authority from outside plugin/.
    const inventoryPath = regularFile(pluginRoot, "runtime/bundle-inventory.json", "inventory-invalid")
    return JSON.parse(new TextDecoder().decode(readBytes(inventoryPath)))
  } catch (error) {
    if (error instanceof PayloadCandidateRefusal) throw error
    throw new PayloadCandidateRefusal("inventory-invalid", "runtime/bundle-inventory.json is not valid JSON")
  }
}

const bundleInventoryEnvelope = (parsed: unknown): Record<string, unknown> => {
  if (!isRecord(parsed)) throw new PayloadCandidateRefusal("inventory-invalid", "runtime/bundle-inventory.json has an invalid schema")
  const validParts = [
    parsed.schemaVersion === 1,
    isRecord(parsed.bundles),
    isRecord(parsed.notices),
    !Object.keys(parsed).some((key) => !["schemaVersion", "bundles", "notices"].includes(key)),
  ]
  if (validParts.includes(false)) throw new PayloadCandidateRefusal("inventory-invalid", "runtime/bundle-inventory.json has an invalid schema")
  return parsed
}

const readBundleInventory = (pluginRoot: string): Record<string, unknown> | undefined => {
  if (!existsSync(join(pluginRoot, "runtime/bundle-inventory.json"))) return undefined
  return bundleInventoryEnvelope(parseBundleInventory(pluginRoot))
}

const hasValidInventoryFileMetadata = (record: Record<string, unknown>): boolean => [
  Number.isSafeInteger(record.bytes),
  typeof record.bytes === "number",
  typeof record.bytes === "number" ? record.bytes >= 0 : false,
  typeof record.sha256 === "string",
  typeof record.sha256 === "string" ? /^[0-9a-f]{64}$/u.test(record.sha256) : false,
].every(Boolean)

const bundleInventoryRecord = (skillId: string, record: unknown): BundleInventoryRecord => {
  if (!skillIdPattern.test(skillId) || !isRecord(record)) throw new PayloadCandidateRefusal("inventory-invalid", "runtime/bundle-inventory.json has an invalid bundle record")
  const validPath = typeof record.path === "string" && [/^runtime\/[a-z0-9]+(?:-[a-z0-9]+)*\.js$/u.test(record.path), managedBundlePattern.test(record.path.slice("runtime/".length))].includes(true)
  const validParts = [
    !Object.keys(record).some((key) => !["path", "bytes", "sha256"].includes(key)),
    validPath,
    hasValidInventoryFileMetadata(record),
  ]
  if (validParts.includes(false)) {
    throw new PayloadCandidateRefusal("inventory-invalid", `runtime/bundle-inventory.json has an invalid record for ${skillId}`)
  }
  return record as BundleInventoryRecord
}

const verifyBundleRecord = (pluginRoot: string, skillId: string, item: BundleInventoryRecord): void => {
  const bytes = readBytes(regularFile(pluginRoot, item.path, "inventory-invalid"))
  if (bytes.byteLength !== item.bytes || sha256Hex(bytes) !== item.sha256) {
    throw new PayloadCandidateRefusal("inventory-invalid", `runtime/bundle-inventory.json record for ${skillId} does not match its file`)
  }
}

const verifyNoticesRecord = (pluginRoot: string, record: unknown): void => {
  if (!isRecord(record)) throw new PayloadCandidateRefusal("inventory-invalid", "runtime/bundle-inventory.json has an invalid notices record")
  const validParts = [
    !Object.keys(record).some((key) => !["path", "bytes", "sha256"].includes(key)),
    record.path === "THIRD-PARTY-NOTICES.md",
    hasValidInventoryFileMetadata(record),
  ]
  if (validParts.includes(false)) {
    throw new PayloadCandidateRefusal("inventory-invalid", "runtime/bundle-inventory.json has an invalid notices record")
  }
  const noticeBytes = readBytes(regularFile(pluginRoot, "THIRD-PARTY-NOTICES.md", "inventory-invalid"))
  if (noticeBytes.byteLength !== record.bytes || sha256Hex(noticeBytes) !== record.sha256) {
    throw new PayloadCandidateRefusal("inventory-invalid", "runtime/bundle-inventory.json notices record does not match its file")
  }
}

const currentBundleInventory = (pluginRoot: string): ExistingBundleInventory => {
  const value = readBundleInventory(pluginRoot)
  if (value === undefined) return { present: false, ownedPaths: new Set() }
  const ownedPaths = new Set<string>()
  for (const [skillId, record] of Object.entries(value.bundles as Record<string, unknown>)) {
    const item = bundleInventoryRecord(skillId, record)
    if (ownedPaths.has(item.path)) throw new PayloadCandidateRefusal("inventory-invalid", "runtime/bundle-inventory.json assigns one path more than once")
    verifyBundleRecord(pluginRoot, skillId, item)
    ownedPaths.add(item.path)
  }
  verifyNoticesRecord(pluginRoot, value.notices)
  return { present: true, ownedPaths }
}

const existingPluginFiles = (pluginRoot: string, selectedBundles: ReadonlySet<string>): PayloadCandidateFile[] =>
  walkPlugin(pluginRoot).filter((file) => {
    if (generatedPluginPaths.has(file.path)) return false
    if (file.path.startsWith("runtime/") && managedBundlePattern.test(file.path.slice("runtime/".length))) return selectedBundles.has(file.path)
    return true
  })

const sameFile = (left: PayloadCandidateFile | undefined, right: PayloadCandidateFile | undefined): boolean =>
  left !== undefined && right !== undefined && left.executable === right.executable && Buffer.compare(left.bytes, right.bytes) === 0

const candidateOwned = (rootGenerated: readonly PayloadCandidateFile[], pluginGenerated: readonly PayloadCandidateFile[]): PreparedFileDeclaration[] =>
  sortDeclarations([
    ...rootGenerated.map((file) => fileDeclaration({ ...file, path: file.path })),
    ...pluginGenerated.map((file) => fileDeclaration({ ...file, path: `plugin/${file.path}` })),
  ])

const validateWorkspaceSources = (root: string, skills: readonly PluginPayloadSkillConfiguration[]): void => {
  for (const skill of skills) {
    if (skill.production.kind === "workspace") validateWorkspaceSource(root, skill.production.workspacePath)
  }
}

type SkillPayloadArtifacts = {
  selectedBundles: Set<string>
  productFiles: PayloadCandidateFile[]
  bundleArtifacts: Map<string, BundleArtifact>
}

const collectSkillPayloadArtifacts = async (
  root: string,
  pluginRoot: string,
  skills: readonly PluginPayloadSkillConfiguration[],
): Promise<SkillPayloadArtifacts> => {
  const selectedBundles = new Set<string>()
  const productFiles = existingPluginFiles(pluginRoot, selectedBundles)
  const bundleArtifacts = new Map<string, BundleArtifact>()
  const stagingRoot = mkdtempSync(join(tmpdir(), "agent-plugin-kit-payload-bundles-"))
  try {
    for (const skill of skills) {
      regularFile(pluginRoot, `skills/${skill.id}/SKILL.md`, "declared-file-missing")
      if (skill.production.kind === "prepared") {
        const entry = declaredPluginFile(pluginRoot, skill.production.entryPath)
        selectedBundles.add(skill.production.entryPath)
        productFiles.push(entry)
      }
      if (skill.production.kind === "workspace") {
        const artifact = await bundleWorkspace(root, skill.id, skill.production.workspacePath, skill.production.entryPath, stagingRoot)
        selectedBundles.add(artifact.path)
        bundleArtifacts.set(skill.id, artifact)
      }
    }
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
  }
  return { selectedBundles, productFiles, bundleArtifacts }
}

const addHookDeclarations = (
  pluginRoot: string,
  hookPaths: readonly string[],
  productFiles: PayloadCandidateFile[],
): void => {
  for (const hookPath of hookPaths) {
    if (!safePluginPath(hookPath)) throw new PayloadCandidateRefusal("configuration-invalid", `hook declaration path collides with a generated output: ${hookPath}`)
    productFiles.push(declaredPluginFile(pluginRoot, hookPath))
  }
}

const bundleInventoryEntries = (
  pluginRoot: string,
  skills: readonly PluginPayloadSkillConfiguration[],
  artifacts: ReadonlyMap<string, BundleArtifact>,
): Record<string, BundleInventoryRecord> => {
  const bundles: Record<string, BundleInventoryRecord> = {}
  for (const skill of skills) {
    if (skill.production.kind === "prepared") {
      const entry = declaredPluginFile(pluginRoot, skill.production.entryPath)
      bundles[skill.id] = { path: skill.production.entryPath, bytes: entry.bytes.byteLength, sha256: sha256Hex(entry.bytes) }
    }
    const artifact = artifacts.get(skill.id)
    if (artifact !== undefined) bundles[skill.id] = { path: artifact.path, bytes: artifact.bytes.byteLength, sha256: artifact.sha256 }
  }
  return bundles
}

const generatedPayloadFiles = (
  configuration: PluginPayloadConfiguration,
  artifacts: ReadonlyMap<string, BundleArtifact>,
  bundles: Record<string, BundleInventoryRecord>,
  notices: Uint8Array,
  bundleInventory: Uint8Array,
): { rootGenerated: PayloadCandidateFile[]; pluginGenerated: PayloadCandidateFile[] } => ({
  pluginGenerated: [
    generatedFile(".claude-plugin/plugin.json", nativeClaudeManifest(configuration)),
    generatedFile(".agents/plugin.json", nativeCodexManifest(configuration)),
    generatedFile("skill-inventory.json", json({
      schemaVersion: 1,
      skills: configuration.skills.map((skill) => ({ id: skill.id, execution: skill.production.kind === "model-only" ? "model-only" : "bun-backed", hookDependence: skill.hookDependence })),
    })),
    ...[...artifacts.values()].map((artifact) => generatedFile(artifact.path, artifact.bytes)),
    generatedFile("THIRD-PARTY-NOTICES.md", notices),
    generatedFile("runtime/bundle-inventory.json", bundleInventory),
    generatedFile("runtime/bundle-inventory.sh", inventoryShell(bundles), true),
  ],
  rootGenerated: [
    generatedFile(".claude-plugin/marketplace.json", claudeMarketplace(configuration)),
    generatedFile(".agents/plugins/marketplace.json", codexMarketplace(configuration)),
  ],
})

const candidateProjections = (
  configuration: PluginPayloadConfiguration,
  paths: PayloadSourceProjectionPaths,
  sourceBytes: ReadonlyMap<string, Uint8Array>,
  bundleInventory: Uint8Array,
): PreparedProjectionDeclaration[] => [
  projection("config", paths.config, sourceBytes.get(paths.config) as Uint8Array),
  projection("runtime-lock", paths.runtimeLock, sourceBytes.get(paths.runtimeLock) as Uint8Array),
  projection("skill-inventory", paths.skillInventory, sourceBytes.get(paths.skillInventory) as Uint8Array),
  projection("bundle-inventory", "plugin/runtime/bundle-inventory.json", bundleInventory),
  projection("native-manifest", "plugin/.agents/plugin.json", nativeCodexManifest(configuration)),
  projection("native-manifest", "plugin/.claude-plugin/plugin.json", nativeClaudeManifest(configuration)),
].sort(projectionOrder)

const removedBundlePaths = (
  pluginRoot: string,
  currentInventory: ExistingBundleInventory,
  selectedBundles: ReadonlySet<string>,
): string[] => {
  const currentManaged = new Set<string>([...currentInventory.ownedPaths].map((path) => `plugin/${path}`))
  const currentBundles = walkPlugin(pluginRoot).filter((file) => file.path.startsWith("runtime/") && managedBundlePattern.test(file.path.slice("runtime/".length)))
  const removed = currentBundles.filter((file) => !selectedBundles.has(file.path) && currentManaged.has(`plugin/${file.path}`))
  const unclaimed = currentBundles.filter((file) => !selectedBundles.has(file.path) && !currentManaged.has(`plugin/${file.path}`))
  if (unclaimed.length > 0) {
    const paths = unclaimed.map((file) => `plugin/${file.path}`).sort(compareCodeUnits)
    throw new PayloadCandidateRefusal("payload-outdated", `unclaimed bundle output requires inventory ownership: ${paths.join(", ")}`, paths)
  }
  return removed.map((file) => `plugin/${file.path}`).sort(compareCodeUnits)
}

const createModelOnlyCandidate = async (
  root: string,
  pluginRoot: string,
  configuration: PluginPayloadConfiguration,
  sourceProjectionPaths: PayloadSourceProjectionPaths,
): Promise<PayloadCandidateBuild> => {
  const currentInventory = currentBundleInventory(pluginRoot)
  validateWorkspaceSources(root, configuration.skills)
  const dependencies = admitWorkspaceDependencies(root, configuration.skills)
  const { selectedBundles, productFiles, bundleArtifacts } = await collectSkillPayloadArtifacts(root, pluginRoot, configuration.skills)
  const projections = readProjectionInputs(root, sourceProjectionPaths)
  addHookDeclarations(pluginRoot, configuration.plugin.hookDeclarationPaths, productFiles)
  const bundles = bundleInventoryEntries(pluginRoot, configuration.skills, bundleArtifacts)
  const notices = noticesText(dependencies)
  const noticesRecord = { path: "THIRD-PARTY-NOTICES.md", bytes: notices.byteLength, sha256: sha256Hex(notices) }
  const bundleInventory = inventoryJson(bundles, noticesRecord)
  const { rootGenerated, pluginGenerated } = generatedPayloadFiles(configuration, bundleArtifacts, bundles, notices, bundleInventory)
  const productPaths = new Set(productFiles.map((file) => file.path))
  const collidingGenerated = pluginGenerated.find((file) => productPaths.has(file.path))
  if (collidingGenerated !== undefined) {
    throw new PayloadCandidateRefusal("output-conflict", `generated output collides with a product-authored file: plugin/${collidingGenerated.path}`)
  }
  const allPluginFiles = sortFiles([...productFiles.filter((file, index, values) => values.findIndex((other) => other.path === file.path) === index), ...pluginGenerated])
  const files = allPluginFiles.map(fileDeclaration)
  const candidate: PreparedPayloadCandidate = {
    files,
    projections: candidateProjections(configuration, sourceProjectionPaths, projections, bundleInventory),
    ownedFiles: candidateOwned(rootGenerated, pluginGenerated),
    payloadSha256: frameDigest(allPluginFiles),
  }
  const generated = [...rootGenerated, ...pluginGenerated]
  const generatedByPath = new Map(generated.map((file) => [file.path, file]))
  const removedPaths = removedBundlePaths(pluginRoot, currentInventory, selectedBundles)
  return {
    candidate,
    payloadFiles: allPluginFiles,
    generated,
    generatedByPath,
    sourceProjectionBytes: projections,
    removedPaths,
  }
}

export async function buildPayloadCandidate(request: PayloadCandidateRequest): Promise<PayloadCandidateBuild> {
  validateConfiguration(request.configuration)
  const root = normalizeRoot(request.repositoryRoot)
  const pluginRoot = normalizePluginRoot(root)
  return await createModelOnlyCandidate(root, pluginRoot, request.configuration, request.sourceProjectionPaths)
}

const outputAncestorsExist = (root: string, path: string): boolean => {
  const segments = path.split("/")
  segments.pop()
  let ancestor = root
  for (const segment of segments) {
    ancestor = join(ancestor, segment)
    try {
      const status = lstatSync(ancestor)
      if (status.isSymbolicLink() || !status.isDirectory()) throw new PayloadCandidateRefusal("output-conflict", `${path}: output ancestor is unsafe`)
    } catch (error) {
      if (error instanceof PayloadCandidateRefusal) throw error
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
      throw new PayloadCandidateRefusal("output-conflict", `${path}: output ancestor is unobservable`)
    }
  }
  return true
}

const readOutputFile = (root: string, declaration: Pick<PreparedFileDeclaration, "path">): PayloadCandidateFile | undefined => {
  const absolute = resolve(root, declaration.path)
  if (!isInside(absolute, root)) throw new PayloadCandidateRefusal("unsafe-entry", `${declaration.path}: output escapes repository root`)
  if (!outputAncestorsExist(root, declaration.path)) return undefined
  try {
    const status = lstatSync(absolute)
    if (status.isSymbolicLink() || !status.isFile()) throw new PayloadCandidateRefusal("output-conflict", `${declaration.path}: output is not a regular file`)
    return { path: declaration.path, bytes: readBytes(absolute), executable: (status.mode & 0o111) !== 0 }
  } catch (error) {
    if (error instanceof PayloadCandidateRefusal) throw error
    return undefined
  }
}

export type CandidateComparison = {
  changedPaths: readonly string[]
  unchangedPaths: readonly string[]
  removedPaths: readonly string[]
}

const compareOwnedOutputs = (root: string, build: PayloadCandidateBuild): { changed: string[]; unchanged: string[] } => {
  const changed: string[] = []
  const unchanged: string[] = []
  for (const declaration of build.candidate.ownedFiles) {
    const actual = readOutputFile(root, declaration)
    const expected: PayloadCandidateFile = { path: declaration.path, bytes: readBytesFromGenerated(build, declaration.path), executable: declaration.executable }
    if (actual === undefined || !sameFile(actual, expected)) changed.push(declaration.path)
    else unchanged.push(declaration.path)
  }
  return { changed, unchanged }
}

const appendProductDrift = (root: string, build: PayloadCandidateBuild, changed: string[]): void => {
  const pluginRoot = join(root, "plugin")
  // Managed digest bundles are represented by generated declarations above.
  // The product closure comparison must therefore retain only declared product
  // files; including selected generated bundles here would report every bundle
  // as an undeclared product file during the final reread.
  const currentProduct = existingPluginFiles(pluginRoot, new Set())
  const candidateProduct = build.candidate.files
    .filter((file) => !generatedPluginPaths.has(file.path) && !(file.path.startsWith("runtime/") && managedBundlePattern.test(file.path.slice("runtime/".length))))
    .map((file) => ({ path: file.path, bytes: readBytesFromCandidate(build, file), executable: file.executable }))
  const candidateByPath = new Map(candidateProduct.map((file) => [file.path, file]))
  const currentByPath = new Map(currentProduct.map((file) => [file.path, file]))
  for (const file of candidateProduct) {
    const current = currentByPath.get(file.path)
    if (current === undefined || !sameFile(current, file)) changed.push(`plugin/${file.path}`)
  }
  for (const file of currentProduct) {
    if (!candidateByPath.has(file.path)) changed.push(`plugin/${file.path}`)
  }
}

const appendSourceProjectionDrift = (root: string, build: PayloadCandidateBuild, changed: string[]): void => {
  // Source projections are caller-owned inputs, but they are part of the
  // candidate's agreement. Reread them independently so a source edit racing
  // a check/materialize build cannot be reported as a clean candidate.
  for (const declaration of build.candidate.projections) {
    if (!["config", "runtime-lock", "skill-inventory"].includes(declaration.role)) continue
    const actual = readOutputFile(root, declaration)
    const expectedBytes = build.sourceProjectionBytes.get(declaration.path)
    if (expectedBytes === undefined) throw new Error(`missing source projection ${declaration.path}`)
    if (actual === undefined || Buffer.compare(actual.bytes, expectedBytes) !== 0) changed.push(declaration.path)
  }
}

export const compareCandidate = (root: string, build: PayloadCandidateBuild, includeRemovals = true): CandidateComparison => {
  const { changed, unchanged } = compareOwnedOutputs(root, build)
  appendProductDrift(root, build, changed)
  appendSourceProjectionDrift(root, build, changed)
  return {
    changedPaths: [...new Set(changed)].sort(compareCodeUnits),
    unchangedPaths: [...new Set(unchanged)].sort(compareCodeUnits),
    removedPaths: includeRemovals ? [...build.removedPaths].sort(compareCodeUnits) : [],
  }
}

const readBytesFromGenerated = (build: PayloadCandidateBuild, path: string): Uint8Array => {
  const generatedPath = path.startsWith("plugin/") ? path.slice("plugin/".length) : path
  const file = build.generatedByPath.get(generatedPath)
  if (file === undefined) throw new Error(`missing generated output ${path}`)
  return file.bytes
}

const readBytesFromCandidate = (build: PayloadCandidateBuild, declaration: PreparedFileDeclaration): Uint8Array => {
  const file = build.payloadFiles.find((candidate) => candidate.path === declaration.path)
  if (file !== undefined) return file.bytes
  throw new Error(`candidate product bytes are unavailable for ${declaration.path}`)
}

const fsyncPath = (path: string): void => {
  const descriptor = openSync(path, "r")
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

const safeOutputParent = (root: string, path: string): string => {
  const segments = path.split("/")
  segments.pop()
  let current = root
  for (const segment of segments) {
    current = join(current, segment)
    if (existsSync(current)) {
      const status = lstatSync(current)
      if (status.isSymbolicLink() || !status.isDirectory()) throw new PayloadCandidateRefusal("unsafe-entry", `${path}: output ancestor is unsafe`)
    } else mkdirSync(current)
  }
  return current
}

const atomicOutput = (root: string, file: PayloadCandidateFile): void => {
  const absolute = join(root, file.path)
  const parent = safeOutputParent(root, file.path)
  const temporary = join(parent, `.${file.path.split("/").at(-1)}.agent-plugin-kit-${process.pid}-${Math.random().toString(16).slice(2)}`)
  try {
    writeFileSync(temporary, file.bytes, { mode: file.executable ? 0o755 : 0o644 })
    chmodSync(temporary, file.executable ? 0o755 : 0o644)
    fsyncPath(temporary)
    renameSync(temporary, absolute)
    try { fsyncPath(parent) } catch {}
  } finally {
    try { unlinkSync(temporary) } catch {}
  }
}

export type MaterializeOptions = {
  interrupt?: (point:
    | "materialization-staged"
    | "materialization-file-published"
    | "materialization-inventory-published"
    | "materialization-verified", path?: string) => void
}

type MaterializationPoint = Parameters<NonNullable<MaterializeOptions["interrupt"]>>[0]
type PublicationInterrupt = (point: MaterializationPoint, path?: string, remainingPaths?: readonly string[]) => void
type StagedGeneratedFile = { path: string; staged: string; file: PayloadCandidateFile }

const publicationInterrupt = (
  options: MaterializeOptions,
  published: string[],
  affectedPaths: readonly string[],
): PublicationInterrupt => (point, path, remainingPaths = affectedPaths) => {
  try {
    options.interrupt?.(point, path)
  } catch (error) {
    const publishedPaths = [...published].sort(compareCodeUnits)
    const publishedSet = new Set(published)
    const remaining = remainingPaths.filter((candidate) => !publishedSet.has(candidate)).sort(compareCodeUnits)
    throw new MaterializationPublishError(
      "materialization-interrupted",
      publishedPaths,
      remaining,
      false,
      error instanceof Error ? error.message : "materialization interrupted",
    )
  }
}

const assertWritableDrift = (build: PayloadCandidateBuild, changed: readonly string[]): void => {
  const generatedPaths = [...build.generatedByPath.keys()]
  const writablePaths = new Set([...generatedPaths, ...generatedPaths.map((path) => `plugin/${path}`)])
  const nonWritableDrift = changed.filter((path) => !writablePaths.has(path))
  if (nonWritableDrift.length > 0) {
    throw new PayloadCandidateRefusal(
      "payload-outdated",
      `Plugin Payload inputs or retained product files changed at ${nonWritableDrift.join(", ")}`,
      nonWritableDrift,
    )
  }
}

const materializationOrder = (path: string): number => {
  if (path === "plugin/runtime/bundle-inventory.json") return 100
  if (path === "plugin/runtime/bundle-inventory.sh") return 110
  if (path.startsWith("plugin/runtime/") && path.endsWith(".js")) return 60
  if (path === "plugin/THIRD-PARTY-NOTICES.md") return 80
  return 20
}

const stageGeneratedFiles = (
  build: PayloadCandidateBuild,
  changed: readonly string[],
  staging: string,
): StagedGeneratedFile[] => [...changed]
  .sort((left, right) => materializationOrder(left) - materializationOrder(right) || compareCodeUnits(left, right))
  .map((path) => {
    const generatedPath = path.startsWith("plugin/") ? path.slice("plugin/".length) : path
    const file = build.generatedByPath.get(generatedPath)
    if (file === undefined) throw new Error(`missing generated output ${path}`)
    const staged = join(staging, generatedPath)
    mkdirSync(dirname(staged), { recursive: true })
    writeFileSync(staged, file.bytes, { mode: file.executable ? 0o755 : 0o644 })
    return { path, staged, file }
  })

const publishGeneratedFiles = (
  root: string,
  files: readonly StagedGeneratedFile[],
  published: string[],
  interrupt: PublicationInterrupt,
): void => {
  for (const item of files) {
    atomicOutput(root, { path: item.path, bytes: readBytes(item.staged), executable: item.file.executable })
    published.push(item.path)
    interrupt("materialization-file-published", item.path)
    if (item.path === "plugin/runtime/bundle-inventory.json") interrupt("materialization-inventory-published", item.path)
  }
}

const removeStaleBundles = (root: string, paths: readonly string[]): void => {
  for (const path of paths) {
    const absolute = join(root, path)
    try {
      const status = lstatSync(absolute)
      if (status.isSymbolicLink() || !status.isFile()) throw new PayloadCandidateRefusal("unsafe-entry", `${path}: stale bundle is unsafe`)
      unlinkSync(absolute)
    } catch (error) {
      if (error instanceof PayloadCandidateRefusal) throw error
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    }
  }
}

const observedPublishedPaths = (root: string, build: PayloadCandidateBuild, changed: readonly string[]): string[] => changed.filter((path) => {
  try {
    const expected = {
      path,
      bytes: readBytesFromGenerated(build, path),
      executable: build.candidate.ownedFiles.find((file) => file.path === path)?.executable ?? false,
    }
    return sameFile(readOutputFile(root, { path }), expected)
  } catch {
    return false
  }
})

export async function materializePayloadCandidate(request: PayloadMaterializeRequest, options: MaterializeOptions = {}): Promise<{ build: PayloadCandidateBuild; comparison: CandidateComparison }> {
  const build = await buildPayloadCandidate(request)
  const root = normalizeRoot(request.repositoryRoot)
  const comparison = compareCandidate(root, build)
  const staging = mkdtempSync(join(tmpdir(), "agent-plugin-kit-payload-"))
  const changed = [...comparison.changedPaths]
  const affectedPaths = [...new Set([...changed, ...comparison.removedPaths])].sort(compareCodeUnits)
  const published: string[] = []
  const interrupt = publicationInterrupt(options, published, affectedPaths)
  try {
    assertWritableDrift(build, changed)
    const generatedFiles = stageGeneratedFiles(build, changed, staging)
    interrupt("materialization-staged", undefined)
    publishGeneratedFiles(root, generatedFiles, published, interrupt)
    removeStaleBundles(root, comparison.removedPaths)
    const final = compareCandidate(root, build, false)
    if (final.changedPaths.length > 0) throw new MaterializationPublishError("materialization-verification-failed", published, [...final.changedPaths, ...comparison.removedPaths], false, "materialization did not verify the complete candidate")
    interrupt("materialization-verified", undefined, [])
    return { build, comparison: { ...comparison, changedPaths: comparison.changedPaths, unchangedPaths: comparison.unchangedPaths, removedPaths: comparison.removedPaths } }
  } catch (error) {
    if (error instanceof MaterializationPublishError) throw error
    const observedPublished = observedPublishedPaths(root, build, changed)
    const remaining = [...changed.filter((path) => !observedPublished.includes(path)), ...comparison.removedPaths]
    if (error instanceof PayloadCandidateRefusal) throw error
    throw new MaterializationPublishError(observedPublished.length === 0 ? "materialization-staging-failed" : "materialization-interrupted", observedPublished, remaining, false, error instanceof Error ? error.message : "materialization failed")
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
