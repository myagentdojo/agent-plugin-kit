import { createHash } from "node:crypto"
import { z } from "zod"
import type {
  CandidateIdentity,
  PackageIdentity,
  ReleaseIdentity,
  RepositoryIdentity,
  SourceIdentity,
  WorkflowIdentity,
} from "./interface"

export const commitSchema = z.string().regex(/^[0-9a-f]{40}$/)

const privateHostnameSuffixes = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".home.arpa",
  ".private",
  ".test",
  ".invalid",
  ".example",
  ".example.com",
  ".example.net",
  ".example.org",
  ".example.edu",
  ".lan",
  ".corp",
  ".localdomain",
] as const
const reservedHostnames = new Set([
  "localhost",
  "localdomain",
  "test",
  "invalid",
  "example",
  "example.com",
  "example.net",
  "example.org",
  "example.edu",
])
const privateIpv4Pattern = /^(?:(?:0|10|127)\.|100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.0\.0\.|192\.0\.2\.|192\.168\.|198\.(?:18|19|51)\.|203\.0\.113\.|(?:22[4-9]|23[0-9]|24[0-9]|25[0-5])\.)/
const privateIpv6Pattern = /^(?:::|f[cd]|fe[89a-f]|ff|100::|2001:(?:2|10|20|db8):|3fff:)/
const privateCheckoutPathPattern = /^\/+(?:users?|home|private|tmp|var|volumes?|mnt|workspaces?)\/[^/]+\/[^/]+(?:\/|$)|^\/+\p{L}:\//iu
const originComponentsPattern = /^(https?):\/\/([^\/?#]*)(\/[^?#]*)?$/i
const maxPathDecodeDepth = 8
const maxRepositoryOriginLength = 2048
const maxReleaseReferenceLength = 512
const maxWorkflowPathLength = 512
const releaseReferencePattern = /^[\p{L}\p{M}\p{N}._/-]+$/u
const workflowPathSegmentPattern = /^[A-Za-z0-9._-]+$/

function normalizedHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
}

function isPrivateHostname(host: string): boolean {
  return reservedHostnames.has(host) ||
    (!host.includes(".") && !host.includes(":")) ||
    privateHostnameSuffixes.some((suffix) => host.endsWith(suffix))
}

function ipv4Octets(host: string): readonly number[] | undefined {
  const parts = host.split(".")
  if (parts.length !== 4 || parts.some((part) => !/^(?:0|[1-9][0-9]{0,2})$/.test(part))) return undefined
  const octets = parts.map(Number)
  return octets.every((octet) => octet <= 255) ? octets : undefined
}

function isPrivateIpv4(host: string): boolean {
  return ipv4Octets(host) !== undefined && privateIpv4Pattern.test(host)
}

function isPrivateIpv6(host: string): boolean {
  return host.includes(":") && privateIpv6Pattern.test(host)
}

function isPrivateRepositoryHost(hostname: string): boolean {
  const host = normalizedHostname(hostname)
  return isPrivateHostname(host) || isPrivateIpv4(host) || isPrivateIpv6(host)
}

function isHttpUrl(url: URL): boolean {
  return url.protocol === "https:" || url.protocol === "http:"
}

function isBareRepositoryOrigin(url: URL): boolean {
  return url.username === "" && url.password === "" && url.port === "" && url.search === "" && url.hash === ""
}

function canonicalPathSpelling(pathname: string): string {
  return pathname.replace(/%([0-9a-f]{2})/gi, (match, encoded: string) => {
    const character = String.fromCharCode(Number.parseInt(encoded, 16))
    return /^[A-Za-z0-9._~-]$/.test(character) ? character : match.toUpperCase()
  })
}

function hasCanonicalOriginSpelling(value: string, url: URL): boolean {
  const components = originComponentsPattern.exec(value)
  if (components === null) return false
  const rawPath = components[3] ?? ""
  const canonicalPath = canonicalPathSpelling(url.pathname)
  return components[1] === url.protocol.slice(0, -1) &&
    components[2] === url.host &&
    !url.hostname.endsWith(".") &&
    (rawPath === "" ? canonicalPath === "/" : rawPath === canonicalPath)
}

function hasPrivateCheckoutPath(pathname: string): boolean {
  let decodedPath = pathname
  try {
    for (let depth = 0; depth < maxPathDecodeDepth; depth += 1) {
      const nextPath = decodeURIComponent(decodedPath)
      if (nextPath === decodedPath) return decodedPath.includes("\\") || privateCheckoutPathPattern.test(decodedPath)
      decodedPath = nextPath
    }
    return true
  } catch {
    return true
  }
}

function isPublicRepositoryOrigin(value: string): boolean {
  if (value.length === 0 || value.length > maxRepositoryOriginLength || value !== value.trim() || /[\\\s]/.test(value)) return false
  try {
    const url = new URL(value)
    return [
      isHttpUrl(url),
      isBareRepositoryOrigin(url),
      hasCanonicalOriginSpelling(value, url),
      url.hostname.length > 0,
      !isPrivateRepositoryHost(url.hostname),
      !hasPrivateCheckoutPath(url.pathname),
    ].every(Boolean)
  } catch {
    return false
  }
}

function isSafeReleaseReference(value: string): boolean {
  return value.length > 0 &&
    value.length <= maxReleaseReferenceLength &&
    releaseReferencePattern.test(value) &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.includes("//") &&
    !value.includes("..")
}

function isSafeWorkflowPath(value: string): boolean {
  const segments = value.split("/")
  return value.length > 0 &&
    value.length <= maxWorkflowPathLength &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && workflowPathSegmentPattern.test(segment))
}

export const repositoryIdentitySchema = z.strictObject({
  origin: z.string().refine(isPublicRepositoryOrigin),
})
export const sourceIdentitySchema = z.strictObject({
  repository: repositoryIdentitySchema,
  commit: commitSchema,
})
export const releaseIdentitySchema = z.strictObject({
  reference: z.string().refine(isSafeReleaseReference),
  commit: commitSchema,
})
export const packageIdentitySchema = z.strictObject({
  repository: repositoryIdentitySchema,
  commit: commitSchema,
})
export const workflowIdentitySchema = z.strictObject({
  repository: repositoryIdentitySchema,
  path: z.string().refine(isSafeWorkflowPath),
  commit: commitSchema,
})

/** Candidate Identity projection shared by matching and digest encoding. */
function candidateIdentityFields(candidate: CandidateIdentity): readonly (readonly [string, string])[] {
  return [
    ["sourceRepositoryOrigin", candidate.source.repository.origin],
    ["sourceCommit", candidate.source.commit],
    ["releaseReference", candidate.release.reference],
    ["releaseCommit", candidate.release.commit],
    ["packageRepositoryOrigin", candidate.package.repository.origin],
    ["packageCommit", candidate.package.commit],
    ["workflowRepositoryOrigin", candidate.workflow.repository.origin],
    ["workflowPath", candidate.workflow.path],
    ["workflowCommit", candidate.workflow.commit],
  ]
}

export function candidateIdentitiesMatch(left: CandidateIdentity, right: CandidateIdentity): boolean {
  const leftFields = candidateIdentityFields(left)
  const rightFields = candidateIdentityFields(right)
  return leftFields.length === rightFields.length && leftFields.every(([, value], index) => value === rightFields[index]?.[1])
}

export function candidateHasOneFullCommitPin(candidate: CandidateIdentity): boolean {
  return candidate.release.commit === candidate.source.commit &&
    candidate.package.commit === candidate.source.commit &&
    candidate.workflow.commit === candidate.source.commit
}

function canonicalCandidateIdentityEncoding(candidate: CandidateIdentity): string {
  const frame = (value: string): string => {
    const normalized = value.normalize("NFC")
    return `${new TextEncoder().encode(normalized).length}:${normalized}`
  }
  const scalar = (value: string): string => `s${frame(value)}`
  const fields = candidateIdentityFields(candidate)
  return `r${frame("agent-plugin-kit.candidate-identity.v1")}${frame(String(fields.length))}${fields
    .map(([name, value]) => `${frame(name)}${frame(scalar(value))}`)
    .join("")}`
}

export function canonicalCandidateIdentityDigest(candidate: CandidateIdentity): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalCandidateIdentityEncoding(candidate)).digest("hex")}`
}

export const candidateIdentitySchema = z.strictObject({
  source: sourceIdentitySchema,
  release: releaseIdentitySchema,
  package: packageIdentitySchema,
  workflow: workflowIdentitySchema,
}).refine(candidateHasOneFullCommitPin)

type InferredRepositoryIdentity = z.infer<typeof repositoryIdentitySchema>
type InferredSourceIdentity = z.infer<typeof sourceIdentitySchema>
type InferredReleaseIdentity = z.infer<typeof releaseIdentitySchema>
type InferredPackageIdentity = z.infer<typeof packageIdentitySchema>
type InferredWorkflowIdentity = z.infer<typeof workflowIdentitySchema>
type InferredCandidateIdentity = z.infer<typeof candidateIdentitySchema>

const bidirectionalTypeChecks: [
  InferredRepositoryIdentity extends RepositoryIdentity ? true : false,
  RepositoryIdentity extends InferredRepositoryIdentity ? true : false,
  InferredSourceIdentity extends SourceIdentity ? true : false,
  SourceIdentity extends InferredSourceIdentity ? true : false,
  InferredReleaseIdentity extends ReleaseIdentity ? true : false,
  ReleaseIdentity extends InferredReleaseIdentity ? true : false,
  InferredPackageIdentity extends PackageIdentity ? true : false,
  PackageIdentity extends InferredPackageIdentity ? true : false,
  InferredWorkflowIdentity extends WorkflowIdentity ? true : false,
  WorkflowIdentity extends InferredWorkflowIdentity ? true : false,
  InferredCandidateIdentity extends CandidateIdentity ? true : false,
  CandidateIdentity extends InferredCandidateIdentity ? true : false,
] = [true, true, true, true, true, true, true, true, true, true, true, true]

void bidirectionalTypeChecks
