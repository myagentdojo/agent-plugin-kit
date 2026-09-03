import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import type { SourceCheckoutAdmissionRequest } from "../../../modules/release-and-git-engine/interface"
import { parseRepositoryIdentity, parseSourceCheckoutAdmissionRequest } from "../../../modules/release-and-git-engine/serialized-values"

export type SourceCheckoutObservationRefusalCode =
  | "kit-root-unresolved"
  | "checkout-toplevel-mismatch"
  | "head-unresolved"
  | "source-tree-dirty"
  | "entry-outside-checkout"
  | "manifest-origin-invalid"
  | "consumer-root-unresolved"
  | "consumer-manifest-uncommitted"
  | "consumer-authority-dirty"
  | "consumer-pin-missing"
  | "consumer-pin-invalid"
  | "consumer-link-mismatch"
  | "git-unavailable"

export type SourceCheckoutObservation =
  | { kind: "observed"; request: SourceCheckoutAdmissionRequest }
  | { kind: "refused"; code: SourceCheckoutObservationRefusalCode }

export type SourceCheckoutObservationInput = {
  entryPath: string
  cwd: string
  environment: Readonly<Record<string, string | undefined>>
}

const commitPattern = /^[0-9a-f]{40}$/
const outputLimit = 1024 * 1024
const gitUnavailable = Symbol("git-unavailable")

const refused = (code: SourceCheckoutObservationRefusalCode): SourceCheckoutObservation => ({ kind: "refused", code })

function kitRootFor(entryPath: string): string | undefined {
  let current: string
  try { current = realpathSync(entryPath) } catch { return undefined }
  try {
    if (!readFileSync(current, "utf8")) return undefined
  } catch { return undefined }
  current = dirname(current)
  while (true) {
    try {
      const manifest = JSON.parse(readFileSync(join(current, "package.json"), "utf8")) as { name?: unknown }
      if (manifest.name === "agent-plugin-kit") return realpathSync(current)
    } catch {}
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function git(
  root: string,
  environment: SourceCheckoutObservationInput["environment"],
  semanticExitCodes: readonly number[],
  ...argumentsAfterGit: string[]
): string | undefined | typeof gitUnavailable {
  const home = mkdtempSync(join(tmpdir(), "agent-plugin-kit-source-checkout-"))
  try {
    chmodSync(home, 0o700)
    const result = Bun.spawnSync(["git", "-C", root, ...argumentsAfterGit], {
      cwd: root,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
      killSignal: "SIGKILL",
      maxBuffer: outputLimit,
      env: {
        PATH: environment.PATH ?? "",
        HOME: home,
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
      },
    })
    if (result.exitCode !== 0) return semanticExitCodes.includes(result.exitCode) ? undefined : gitUnavailable
    return new TextDecoder().decode(result.stdout).replace(/\n$/u, "")
  } catch {
    return gitUnavailable
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

function manifestAtHead(root: string, environment: SourceCheckoutObservationInput["environment"]): Record<string, unknown> | undefined | typeof gitUnavailable {
  const text = git(root, environment, [128], "show", "HEAD:package.json")
  if (text === gitUnavailable) return gitUnavailable
  if (text === undefined) return undefined
  try {
    const parsed = JSON.parse(text)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch { return undefined }
}

type SourceCheckoutFacts = { kitRoot: string; kitHead: string; origin: string }
type ConsumerCheckoutFacts = { pin: { origin: string; commit: string } }

function kitDependencyFor(manifest: Record<string, unknown>): string | SourceCheckoutObservationRefusalCode {
  const dependencies = manifest.dependencies
  if (typeof dependencies !== "object" || dependencies === null || Array.isArray(dependencies)) return "consumer-pin-missing"
  const value = (dependencies as Record<string, unknown>)["agent-plugin-kit"]
  return typeof value === "string" ? value : "consumer-pin-missing"
}

function consumerPinFor(manifest: Record<string, unknown>): { origin: string; commit: string } | SourceCheckoutObservationRefusalCode {
  const value = kitDependencyFor(manifest)
  if (typeof value !== "string") return value
  const match = /^git\+(https:\/\/[^#]+\.git)#(.+)$/u.exec(value)
  if (match === null) return value.startsWith("git+") ? "consumer-pin-invalid" : "consumer-pin-missing"
  const origin = match[1], commit = match[2]
  if (origin === undefined || commit === undefined || parseRepositoryIdentity({ origin }) === undefined || !commitPattern.test(commit)) return "consumer-pin-invalid"
  return { origin, commit }
}

function kitTopLevelFor(kitRoot: string, input: SourceCheckoutObservationInput): string | SourceCheckoutObservation {
  const topLevel = git(kitRoot, input.environment, [128], "rev-parse", "--show-toplevel")
  if (topLevel === gitUnavailable) return refused("git-unavailable")
  if (topLevel === undefined) return refused(existsSync(join(kitRoot, ".git")) ? "git-unavailable" : "checkout-toplevel-mismatch")
  try { return realpathSync(topLevel) === kitRoot ? topLevel : refused("checkout-toplevel-mismatch") } catch { return refused("checkout-toplevel-mismatch") }
}

function kitHeadFor(kitRoot: string, input: SourceCheckoutObservationInput): string | SourceCheckoutObservation {
  const head = git(kitRoot, input.environment, [128], "rev-parse", "--verify", "HEAD^{commit}")
  if (head === gitUnavailable) return refused("git-unavailable")
  return head !== undefined && commitPattern.test(head) ? head : refused("head-unresolved")
}

function cleanKitFor(kitRoot: string, input: SourceCheckoutObservationInput): SourceCheckoutObservation | undefined {
  const status = git(kitRoot, input.environment, [], "status", "--porcelain=v1", "--untracked-files=all")
  if (status === undefined || status === gitUnavailable) return refused("git-unavailable")
  return status === "" ? undefined : refused("source-tree-dirty")
}

function trackedEntryFor(kitRoot: string, input: SourceCheckoutObservationInput): SourceCheckoutObservation | undefined {
  try {
    const entryRelative = relative(kitRoot, realpathSync(input.entryPath))
    const tracked = git(kitRoot, input.environment, [1], "ls-files", "--error-unmatch", "--", entryRelative)
    if (tracked === gitUnavailable) return refused("git-unavailable")
    return !entryRelative.startsWith("..") && tracked !== undefined ? undefined : refused("entry-outside-checkout")
  } catch { return refused("entry-outside-checkout") }
}

function kitOriginFor(kitRoot: string, input: SourceCheckoutObservationInput): string | SourceCheckoutObservation {
  const manifest = manifestAtHead(kitRoot, input.environment)
  if (manifest === gitUnavailable) return refused("git-unavailable")
  const repository = manifest?.repository
  const origin = typeof repository === "object" && repository !== null && !Array.isArray(repository) && typeof (repository as Record<string, unknown>).url === "string"
    ? (repository as Record<string, string>).url : undefined
  return origin !== undefined && parseRepositoryIdentity({ origin }) !== undefined ? origin : refused("manifest-origin-invalid")
}

function sourceCheckoutFactsFor(input: SourceCheckoutObservationInput): SourceCheckoutFacts | SourceCheckoutObservation {
  const kitRoot = kitRootFor(input.entryPath)
  if (kitRoot === undefined) return refused("kit-root-unresolved")
  const topLevel = kitTopLevelFor(kitRoot, input)
  if (typeof topLevel !== "string") return topLevel
  const kitHead = kitHeadFor(kitRoot, input)
  if (typeof kitHead !== "string") return kitHead
  const dirty = cleanKitFor(kitRoot, input)
  if (dirty !== undefined) return dirty
  const entry = trackedEntryFor(kitRoot, input)
  if (entry !== undefined) return entry
  const origin = kitOriginFor(kitRoot, input)
  if (typeof origin !== "string") return origin
  return { kitRoot, kitHead, origin }
}

function consumerRootFor(input: SourceCheckoutObservationInput, kitRoot: string): string | SourceCheckoutObservation {
  const consumerTopLevel = git(input.cwd, input.environment, [128], "rev-parse", "--show-toplevel")
  if (consumerTopLevel === gitUnavailable) return refused("git-unavailable")
  if (consumerTopLevel === undefined) return refused("consumer-root-unresolved")
  try {
    const consumerRoot = realpathSync(consumerTopLevel)
    return consumerRoot === kitRoot ? refused("consumer-root-unresolved") : consumerRoot
  } catch { return refused("consumer-root-unresolved") }
}

function committedConsumerManifestFor(consumerRoot: string, input: SourceCheckoutObservationInput): Record<string, unknown> | undefined | typeof gitUnavailable {
  const head = git(consumerRoot, input.environment, [128], "rev-parse", "--verify", "HEAD^{commit}")
  if (head === gitUnavailable) return gitUnavailable
  if (head === undefined) return undefined
  return manifestAtHead(consumerRoot, input.environment)
}

function cleanConsumerAuthorityFor(consumerRoot: string, input: SourceCheckoutObservationInput): SourceCheckoutObservation | undefined {
  const status = git(consumerRoot, input.environment, [], "status", "--porcelain=v1", "--untracked-files=all", "--", "package.json")
  if (status === undefined || status === gitUnavailable) return refused("git-unavailable")
  return status === "" ? undefined : refused("consumer-authority-dirty")
}

function consumerLinksToKit(consumerRoot: string, kitRoot: string): boolean {
  try { return realpathSync(join(consumerRoot, "node_modules/agent-plugin-kit")) === kitRoot } catch { return false }
}

function consumerCheckoutFactsFor(input: SourceCheckoutObservationInput, kitRoot: string): ConsumerCheckoutFacts | SourceCheckoutObservation {
  const consumerRoot = consumerRootFor(input, kitRoot)
  if (typeof consumerRoot !== "string") return consumerRoot
  const consumerManifest = committedConsumerManifestFor(consumerRoot, input)
  if (consumerManifest === gitUnavailable) return refused("git-unavailable")
  if (consumerManifest === undefined) return refused("consumer-manifest-uncommitted")
  const dirty = cleanConsumerAuthorityFor(consumerRoot, input)
  if (dirty !== undefined) return dirty
  const pin = consumerPinFor(consumerManifest)
  if (typeof pin === "string") return refused(pin)
  if (!consumerLinksToKit(consumerRoot, kitRoot)) return refused("consumer-link-mismatch")
  return { pin }
}

/** Observe only immutable checkout facts. Admission decides whether they agree. */
export function observeSourceCheckout(input: SourceCheckoutObservationInput): SourceCheckoutObservation {
  const sourceFacts = sourceCheckoutFactsFor(input)
  if ("kind" in sourceFacts) return sourceFacts
  const consumerFacts = consumerCheckoutFactsFor(input, sourceFacts.kitRoot)
  if ("kind" in consumerFacts) return consumerFacts
  const request = parseSourceCheckoutAdmissionRequest({
    candidate: { source: { repository: { origin: sourceFacts.origin }, commit: sourceFacts.kitHead }, package: { repository: { origin: sourceFacts.origin }, commit: sourceFacts.kitHead } },
    repository: { origin: consumerFacts.pin.origin }, provenance: { repository: { origin: sourceFacts.origin }, commit: sourceFacts.kitHead }, source: { repository: { origin: consumerFacts.pin.origin }, commit: consumerFacts.pin.commit }, package: { repository: { origin: sourceFacts.origin }, commit: sourceFacts.kitHead },
  })
  return request === undefined ? refused("manifest-origin-invalid") : { kind: "observed", request }
}
