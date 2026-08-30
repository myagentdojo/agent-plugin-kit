import { z } from "zod"
import type {
  CandidateIdentity,
  PackageIdentity,
  ReleaseIdentity,
  RepositoryIdentity,
  SourceIdentity,
  WorkflowIdentity,
} from "./interface"

const commitSchema = z.string().regex(/^[0-9a-f]{40}$/)

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
] as const
const privateIpv4Pattern = /^(?:(?:0|10|127)\.|169\.254\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.)/

function normalizedHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
}

function isPrivateHostname(host: string): boolean {
  return host === "localhost" ||
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
  if (!host.includes(":")) return false
  if (host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89a-f]/.test(host)) return true
  return host.startsWith("::ffff:") && isPrivateIpv4(host.slice("::ffff:".length))
}

function isPrivateRepositoryHost(hostname: string): boolean {
  const host = normalizedHostname(hostname)
  return isPrivateHostname(host) || isPrivateIpv4(host) || isPrivateIpv6(host)
}

function isHttpUrl(url: URL): boolean {
  return url.protocol === "https:" || url.protocol === "http:"
}

function isBareRepositoryOrigin(url: URL): boolean {
  return url.username === "" && url.password === "" && url.search === "" && url.hash === ""
}

function isPublicRepositoryOrigin(value: string): boolean {
  if (value.length === 0 || value !== value.trim() || /[\\\s]/.test(value)) return false
  try {
    const url = new URL(value)
    return (
      isHttpUrl(url) &&
      isBareRepositoryOrigin(url) &&
      url.hostname.length > 0 &&
      !isPrivateRepositoryHost(url.hostname)
    )
  } catch {
    return false
  }
}

export const repositoryIdentitySchema = z.strictObject({
  origin: z.string().refine(isPublicRepositoryOrigin),
})
export const sourceIdentitySchema = z.strictObject({
  repository: repositoryIdentitySchema,
  commit: commitSchema,
})
export const releaseIdentitySchema = z.strictObject({
  reference: z.string().min(1).refine((value) => !/[\\\s]/.test(value)),
  commit: commitSchema,
})
export const packageIdentitySchema = z.strictObject({
  repository: repositoryIdentitySchema,
  commit: commitSchema,
})
export const workflowIdentitySchema = z.strictObject({
  repository: repositoryIdentitySchema,
  path: z.string().min(1).refine((value) =>
    !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes("..")
  ),
  commit: commitSchema,
})

function candidateIdentityFields(candidate: CandidateIdentity): readonly string[] {
  return [
    candidate.source.repository.origin,
    candidate.source.commit,
    candidate.release.reference,
    candidate.release.commit,
    candidate.package.repository.origin,
    candidate.package.commit,
    candidate.workflow.repository.origin,
    candidate.workflow.path,
    candidate.workflow.commit,
  ]
}

export function candidateIdentitiesMatch(left: CandidateIdentity, right: CandidateIdentity): boolean {
  const leftFields = candidateIdentityFields(left)
  const rightFields = candidateIdentityFields(right)
  return leftFields.every((value, index) => value === rightFields[index])
}

export function candidateHasOneFullCommitPin(candidate: CandidateIdentity): boolean {
  return candidate.release.commit === candidate.source.commit &&
    candidate.package.commit === candidate.source.commit &&
    candidate.workflow.commit === candidate.source.commit
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
