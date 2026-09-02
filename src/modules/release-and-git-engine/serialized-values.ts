import { createHash } from "node:crypto"
import { isIP } from "node:net"
import { z } from "zod"
import type {
  AdmissionRefusal,
  AdmissionRequest,
  CandidateIdentity,
  PackageIdentity,
  PackageObservation,
  ReleaseCandidateApproval,
  ReleaseIdentity,
  ReleaseMutationRequest,
  ReleasePlan,
  ReleaseRequest,
  ReleaseResult,
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

function isPrivateRepositoryHost(hostname: string): boolean {
  const host = normalizedHostname(hostname)
  return isPrivateHostname(host) || isIP(host) !== 0
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
  const components = value.split("/")
  return value.length > 0 &&
    value.length <= maxReleaseReferenceLength &&
    releaseReferencePattern.test(value) &&
    !value.startsWith("-") &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.includes("//") &&
    !value.includes("..") &&
    components.every((component) =>
      component.length > 0 &&
      !component.startsWith(".") &&
      !component.endsWith(".") &&
      !component.endsWith(".lock")
    )
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

const sha256Schema = z.templateLiteral(["sha256:", z.string()])
const effectIdsSchema = z.array(z.string()).readonly()

const admissionRequestSchema = z.strictObject({
  candidate: candidateIdentitySchema,
  repository: repositoryIdentitySchema,
  provenance: sourceIdentitySchema,
  source: sourceIdentitySchema,
  release: releaseIdentitySchema,
  package: packageIdentitySchema,
  workflow: workflowIdentitySchema,
})

const admissionRefusalSchema = z.strictObject({
  code: z.enum([
    "repository-mismatch",
    "provenance-mismatch",
    "source-pin-mismatch",
    "release-pin-mismatch",
    "package-pin-mismatch",
    "workflow-pin-mismatch",
  ]),
  nextAction: z.literal("Correct the mismatched immutable identity observation."),
})

const packageObservationSchema = z.strictObject({
  identity: packageIdentitySchema,
  payloadSha256: sha256Schema,
})

export const releaseRequestSchema = z.strictObject({
  candidate: candidateIdentitySchema,
  intent: z.enum(["impact", "readiness", "maintenance", "publication", "resume", "repair"]),
})

export const releaseMutationRequestSchema = z.strictObject({
  candidate: candidateIdentitySchema,
  intent: z.enum(["impact", "readiness", "maintenance", "publication", "resume", "repair"]),
  expectedEffectIds: effectIdsSchema,
})

const releasePlanSchema = z.strictObject({
  candidate: candidateIdentitySchema,
  expectedEffectIds: effectIdsSchema,
  approvalDigest: sha256Schema,
})

const releaseResultSchema = z.strictObject({
  candidate: candidateIdentitySchema,
  completedEffectIds: effectIdsSchema,
  remainingEffectIds: effectIdsSchema,
})

export const releaseCandidateApprovalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  issuer: z.literal("release-and-git-engine"),
  candidate: candidateIdentitySchema,
  candidateIdentitySha256: sha256Schema,
  inspectedStateSha256: sha256Schema,
  expectedEffectsSha256: sha256Schema,
  digest: sha256Schema,
})

// fallow-ignore-next-line code-duplication -- the owner keeps strict JSON boundary validation private and explicit
// fallow-ignore-next-line complexity -- the owner keeps strict JSON boundary validation private and explicit
function isPlainJsonTree(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value !== "object" || seen.has(value)) return false
  seen.add(value)
  let valid = true
  if (Array.isArray(value)) {
    valid = Object.getPrototypeOf(value) === Array.prototype &&
      Reflect.ownKeys(value).every((key) =>
        key === "length" || (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)))
    for (let index = 0; valid && index < value.length; index += 1) {
      if (!Object.hasOwn(value, index) || !isPlainJsonTree(value[index], seen)) valid = false
    }
  } else {
    valid = Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        valid = false
        break
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor) || !isPlainJsonTree(descriptor.value, seen)) {
        valid = false
        break
      }
    }
  }
  seen.delete(value)
  return valid
}

// fallow-ignore-next-line code-duplication -- the owner keeps strict JSON boundary validation private and explicit
const parseValue = <T>(schema: z.ZodType<T>, value: unknown): T | undefined => {
  if (!isPlainJsonTree(value)) return undefined
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

const serializeValue = <T>(schema: z.ZodType<T>, value: T): string => {
  const parsed = parseValue(schema, value)
  if (parsed === undefined) throw new Error("release-and-git-engine: invalid serialized value")
  return JSON.stringify(parsed)
}

export const parseAdmissionRequest = (value: unknown): AdmissionRequest | undefined =>
  parseValue(admissionRequestSchema, value)

export const parseAdmissionRefusal = (value: unknown): AdmissionRefusal | undefined =>
  parseValue(admissionRefusalSchema, value)

export const parseCandidateIdentity = (value: unknown): CandidateIdentity | undefined =>
  parseValue(candidateIdentitySchema, value)

export const parsePackageObservation = (value: unknown): PackageObservation | undefined =>
  parseValue(packageObservationSchema, value)

export const parseReleaseCandidateApproval = (value: unknown): ReleaseCandidateApproval | undefined =>
  parseValue(releaseCandidateApprovalSchema, value)

export const parseReleaseMutationRequest = (value: unknown): ReleaseMutationRequest | undefined =>
  parseValue(releaseMutationRequestSchema, value)

export const parseReleasePlan = (value: unknown): ReleasePlan | undefined =>
  parseValue(releasePlanSchema, value)

export const parseReleaseRequest = (value: unknown): ReleaseRequest | undefined =>
  parseValue(releaseRequestSchema, value)

export const parseReleaseResult = (value: unknown): ReleaseResult | undefined =>
  parseValue(releaseResultSchema, value)

export const serializeAdmissionRequest = (value: AdmissionRequest): string =>
  serializeValue(admissionRequestSchema, value)

export const serializeAdmissionRefusal = (value: AdmissionRefusal): string =>
  serializeValue(admissionRefusalSchema, value)

export const serializeCandidateIdentity = (value: CandidateIdentity): string =>
  serializeValue(candidateIdentitySchema, value)

export const serializePackageObservation = (value: PackageObservation): string =>
  serializeValue(packageObservationSchema, value)

export const serializeReleaseCandidateApproval = (value: ReleaseCandidateApproval): string =>
  serializeValue(releaseCandidateApprovalSchema, value)

export const serializeReleaseMutationRequest = (value: ReleaseMutationRequest): string =>
  serializeValue(releaseMutationRequestSchema, value)

export const serializeReleasePlan = (value: ReleasePlan): string =>
  serializeValue(releasePlanSchema, value)

export const serializeReleaseRequest = (value: ReleaseRequest): string =>
  serializeValue(releaseRequestSchema, value)

export const serializeReleaseResult = (value: ReleaseResult): string =>
  serializeValue(releaseResultSchema, value)

type InferredRepositoryIdentity = z.infer<typeof repositoryIdentitySchema>
type InferredSourceIdentity = z.infer<typeof sourceIdentitySchema>
type InferredReleaseIdentity = z.infer<typeof releaseIdentitySchema>
type InferredPackageIdentity = z.infer<typeof packageIdentitySchema>
type InferredWorkflowIdentity = z.infer<typeof workflowIdentitySchema>
type InferredCandidateIdentity = z.infer<typeof candidateIdentitySchema>
type InferredAdmissionRequest = z.infer<typeof admissionRequestSchema>
type InferredAdmissionRefusal = z.infer<typeof admissionRefusalSchema>
type InferredPackageObservation = z.infer<typeof packageObservationSchema>
type InferredReleaseRequest = z.infer<typeof releaseRequestSchema>
type InferredReleaseMutationRequest = z.infer<typeof releaseMutationRequestSchema>
type InferredReleasePlan = z.infer<typeof releasePlanSchema>
type InferredReleaseResult = z.infer<typeof releaseResultSchema>
type InferredReleaseCandidateApproval = z.infer<typeof releaseCandidateApprovalSchema>

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
  InferredAdmissionRequest extends AdmissionRequest ? true : false,
  AdmissionRequest extends InferredAdmissionRequest ? true : false,
  InferredAdmissionRefusal extends AdmissionRefusal ? true : false,
  AdmissionRefusal extends InferredAdmissionRefusal ? true : false,
  InferredPackageObservation extends PackageObservation ? true : false,
  PackageObservation extends InferredPackageObservation ? true : false,
  InferredReleaseRequest extends ReleaseRequest ? true : false,
  ReleaseRequest extends InferredReleaseRequest ? true : false,
  InferredReleaseMutationRequest extends ReleaseMutationRequest ? true : false,
  ReleaseMutationRequest extends InferredReleaseMutationRequest ? true : false,
  InferredReleasePlan extends ReleasePlan ? true : false,
  ReleasePlan extends InferredReleasePlan ? true : false,
  InferredReleaseResult extends ReleaseResult ? true : false,
  ReleaseResult extends InferredReleaseResult ? true : false,
  InferredReleaseCandidateApproval extends ReleaseCandidateApproval ? true : false,
  ReleaseCandidateApproval extends InferredReleaseCandidateApproval ? true : false,
] = [
  true, true, true, true, true, true, true, true, true, true, true, true,
  true, true, true, true, true, true, true, true, true, true, true, true,
  true, true, true, true,
]

void bidirectionalTypeChecks
