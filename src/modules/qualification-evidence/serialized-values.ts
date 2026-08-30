import { createHash } from "node:crypto"
import { z } from "zod"
import { VerificationProfile as verificationProfiles } from "./interface"
import type { CandidateIdentity } from "../release-and-git-engine/interface"
import {
  candidateIdentitySchema,
  packageIdentitySchema,
  releaseIdentitySchema,
  repositoryIdentitySchema,
  sourceIdentitySchema,
  workflowIdentitySchema,
} from "../release-and-git-engine/serialized-values"
import type {
  EvidenceCell,
  QualificationOutcome,
  QualificationRefusal,
  QualificationResult,
  VerificationProfile,
} from "./interface"

const claims = [
  "kit.identity.admitted",
  "kit.command.invoked",
  "kit.package.full-commit-pin",
  "kit.workflow.full-commit-pin",
  "plugin-payload.installed",
  "runtime.supported-platform",
  "release.identity.published",
  "workflow.called-revision",
  "canary.hosted-qualified",
  "harness.claude.fresh-native",
  "harness.codex.fresh-native",
] as const

const proofLayers = ["in-process", "public-process", "clean-fixture", "hosted", "fresh-native"] as const
const skipRationales = [
  "hosted-proof-not-run",
  "fresh-native-proof-not-run",
  "protected-authority-unavailable",
  "platform-not-selected",
  "host-unavailable",
  "not-applicable",
] as const
const lineageMembers = [
  "source",
  "release",
  "package",
  "workflow",
  "installed-payload",
  "hosted-run",
  "platform",
  "receipt",
] as const
const receiptOwners = [
  "plugin-payload-production",
  "runtime-custody",
  "release-and-git-engine",
  "harness-journeys",
  "canary-qualification",
  "reusable-workflow-adapter",
  "clean-fixture",
] as const

const claimSchema = z.enum(claims)
const proofLayerSchema = z.enum(proofLayers)
const skipRationaleSchema = z.enum(skipRationales)
const lineageMemberSchema = z.enum(lineageMembers)
const receiptOwnerSchema = z.enum(receiptOwners)
const digestSchema = z.custom<`sha256:${string}`>(
  (value) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value),
)
const cellIdSchema = z.custom<`cell:${string}`>(
  (value) => typeof value === "string" && /^cell:[a-z][a-z0-9-]{0,63}$/.test(value),
)
const emptyCellIdsSchema = z.custom<readonly []>((value) => Array.isArray(value) && value.length === 0)
const observationCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)
const commitSchema = z.string().regex(/^[0-9a-f]{40}$/)

const hostedRunSchema = z.strictObject({
  provider: z.literal("github-actions"),
  repository: repositoryIdentitySchema,
  runId: z.string().regex(/^[0-9]+$/),
  attempt: z.number().int().positive(),
  headCommit: commitSchema,
})
const platformSchema = z.strictObject({
  os: z.enum(["darwin", "linux"]),
  arch: z.enum(["arm64", "x64"]),
  libc: z.literal("glibc").exactOptional(),
})
const lineageSchema = z.strictObject({
  candidateIdentitySha256: digestSchema,
  source: sourceIdentitySchema,
  release: releaseIdentitySchema.exactOptional(),
  package: packageIdentitySchema.exactOptional(),
  workflow: workflowIdentitySchema.exactOptional(),
  installedPayloadSha256: digestSchema.exactOptional(),
  hostedRun: hostedRunSchema.exactOptional(),
  platform: platformSchema.exactOptional(),
})
const nonClaimsSchema = z.array(claimSchema).readonly()
const receiptSchema = z.strictObject({
  schemaVersion: z.literal(1),
  owner: receiptOwnerSchema,
  receiptSchemaVersion: z.number().int().positive(),
  candidateIdentitySha256: digestSchema,
  digest: digestSchema,
})
const observedSchema = z.strictObject({
  kind: z.literal("observed"),
  code: observationCodeSchema,
  digest: digestSchema.exactOptional(),
})
const notProvedObservableSchema = z.strictObject({
  kind: z.enum(["failure", "proved-absence"]),
  code: observationCodeSchema,
  digest: digestSchema.exactOptional(),
})
const unknownObservableSchema = z.strictObject({
  kind: z.enum(["unavailable", "unknown"]),
  code: observationCodeSchema,
  digest: digestSchema.exactOptional(),
})

const evidenceCellCommonSchema = {
  schemaVersion: z.literal(1),
  id: cellIdSchema,
  candidate: candidateIdentitySchema,
  claim: claimSchema,
  lineage: lineageSchema,
  nonClaims: nonClaimsSchema,
  receipt: receiptSchema.nullable(),
  resolves: z.array(cellIdSchema).readonly(),
} as const

const provedCellSchema = z.strictObject({
  ...evidenceCellCommonSchema,
  assertedStatus: z.literal("proved"),
  actualProofLayer: proofLayerSchema,
  observable: observedSchema,
  skipRationale: z.null(),
})
const notProvedCellSchema = z.strictObject({
  ...evidenceCellCommonSchema,
  assertedStatus: z.literal("not-proved"),
  actualProofLayer: proofLayerSchema,
  observable: notProvedObservableSchema,
  skipRationale: z.null(),
})
const observedUnknownCellSchema = z.strictObject({
  ...evidenceCellCommonSchema,
  assertedStatus: z.literal("unknown"),
  unknownKind: z.literal("observation"),
  actualProofLayer: proofLayerSchema,
  observable: unknownObservableSchema,
  skipRationale: z.null(),
})
const skippedCellSchema = z.strictObject({
  ...evidenceCellCommonSchema,
  assertedStatus: z.literal("unknown"),
  unknownKind: z.literal("skip"),
  actualProofLayer: z.null(),
  observable: z.null(),
  skipRationale: skipRationaleSchema,
  receipt: z.null(),
  resolves: emptyCellIdsSchema,
})
const evidenceCellSchema = z.union([
  provedCellSchema,
  notProvedCellSchema,
  observedUnknownCellSchema,
  skippedCellSchema,
])

const verificationRequirementSchema = z.strictObject({
  claim: claimSchema,
  requiredProofLayer: proofLayerSchema,
  requiredLineage: z.array(lineageMemberSchema).readonly(),
})
const verificationProfileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.enum(["personal", "public"]),
  requirements: z.array(verificationRequirementSchema).readonly(),
})

const reducedClaimCommonSchema = {
  claim: claimSchema,
  nonClaims: nonClaimsSchema,
  receiptDigests: z.array(digestSchema).readonly(),
  evidenceCellIds: z.array(cellIdSchema).readonly(),
} as const
const provedClaimSchema = z.strictObject({
  ...reducedClaimCommonSchema,
  status: z.literal("proved"),
  actualProofLayer: proofLayerSchema,
  observationKind: z.literal("observed"),
  skipRationale: z.null(),
})
const notProvedClaimSchema = z.strictObject({
  ...reducedClaimCommonSchema,
  status: z.literal("not-proved"),
  actualProofLayer: proofLayerSchema,
  observationKind: z.enum(["observed", "failure", "proved-absence"]),
  skipRationale: z.null(),
})
const observedUnknownClaimSchema = z.strictObject({
  ...reducedClaimCommonSchema,
  status: z.literal("unknown"),
  unknownKind: z.literal("observation"),
  actualProofLayer: proofLayerSchema,
  observationKind: z.enum(["unavailable", "unknown"]),
  skipRationale: z.null(),
})
const skippedClaimSchema = z.strictObject({
  ...reducedClaimCommonSchema,
  status: z.literal("unknown"),
  unknownKind: z.literal("skip"),
  actualProofLayer: z.null(),
  observationKind: z.null(),
  skipRationale: skipRationaleSchema,
})
const reducedClaimSchema = z.union([
  provedClaimSchema,
  notProvedClaimSchema,
  observedUnknownClaimSchema,
  skippedClaimSchema,
])
const qualificationResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  candidate: candidateIdentitySchema,
  profileId: z.enum(["personal", "public"]),
  claims: z.array(reducedClaimSchema).readonly(),
  counts: z.strictObject({
    selected: z.number().int().nonnegative(),
    covered: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    proved: z.number().int().nonnegative(),
    notProved: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }),
  nonClaims: nonClaimsSchema,
  receiptDigests: z.array(digestSchema).readonly(),
})
const qualificationRefusalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  code: z.enum([
    "zero-cell",
    "out-of-profile",
    "lineage-disagreement",
    "invalid-cell-id",
    "invalid-resolution",
    "unqualified-resolution",
    "mixed-unresolved",
  ]),
  claim: claimSchema.nullable(),
  evidenceCellId: cellIdSchema.nullable(),
})
const qualificationOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("reduced"), result: qualificationResultSchema }),
  z.strictObject({ status: z.literal("refused"), refusal: qualificationRefusalSchema }),
])

function containsUndefined(value: unknown, seen = new Set<object>()): boolean {
  if (value === undefined) return true
  if (typeof value !== "object" || value === null) return false
  if (seen.has(value)) return true
  seen.add(value)
  const entries = Array.isArray(value) ? value : Object.values(value)
  const result = entries.some((entry) => containsUndefined(entry, seen))
  seen.delete(value)
  return result
}

function parseValue<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  const result = schema.safeParse(value)
  return containsUndefined(value) || !result.success ? undefined : result.data
}

function serializeValue<T>(schema: z.ZodType<T>, value: T): string {
  const parsed = schema.safeParse(value)
  if (containsUndefined(value) || !parsed.success) throw new Error("qualification-evidence: invalid serialized value")
  return JSON.stringify(parsed.data)
}

function isExactProfile(profile: VerificationProfile): boolean {
  const accepted = verificationProfiles[profile.id]
  return profile.schemaVersion === accepted.schemaVersion &&
    profile.id === accepted.id &&
    profile.requirements.length === accepted.requirements.length &&
    profile.requirements.every((requirement, index) => {
      const acceptedRequirement = accepted.requirements[index]
      return acceptedRequirement !== undefined &&
        requirement.claim === acceptedRequirement.claim &&
        requirement.requiredProofLayer === acceptedRequirement.requiredProofLayer &&
        requirement.requiredLineage.length === acceptedRequirement.requiredLineage.length &&
        requirement.requiredLineage.every((member, memberIndex) =>
          member === acceptedRequirement.requiredLineage[memberIndex]
        )
    })
}

export function parseEvidenceCell(value: unknown): EvidenceCell | undefined {
  return parseValue(evidenceCellSchema, value)
}

export function parseVerificationProfile(value: unknown): VerificationProfile | undefined {
  const parsed = parseValue(verificationProfileSchema, value)
  return parsed !== undefined && isExactProfile(parsed) ? parsed : undefined
}

export function parseQualificationResult(value: unknown): QualificationResult | undefined {
  return parseValue(qualificationResultSchema, value)
}

export function parseQualificationRefusal(value: unknown): QualificationRefusal | undefined {
  return parseValue(qualificationRefusalSchema, value)
}

export function parseQualificationOutcome(value: unknown): QualificationOutcome | undefined {
  return parseValue(qualificationOutcomeSchema, value)
}

export function serializeEvidenceCell(value: EvidenceCell): string {
  return serializeValue(evidenceCellSchema, value)
}

export function serializeVerificationProfile(value: VerificationProfile): string {
  if (!isExactProfile(value)) throw new Error("qualification-evidence: invalid serialized value")
  return serializeValue(verificationProfileSchema, value)
}

export function serializeQualificationResult(value: QualificationResult): string {
  return serializeValue(qualificationResultSchema, value)
}

export function serializeQualificationRefusal(value: QualificationRefusal): string {
  return serializeValue(qualificationRefusalSchema, value)
}

export function serializeQualificationOutcome(value: QualificationOutcome): string {
  return serializeValue(qualificationOutcomeSchema, value)
}

type InferredEvidenceCell = z.infer<typeof evidenceCellSchema>
type InferredVerificationProfile = z.infer<typeof verificationProfileSchema>
type InferredQualificationResult = z.infer<typeof qualificationResultSchema>
type InferredQualificationRefusal = z.infer<typeof qualificationRefusalSchema>
type InferredQualificationOutcome = z.infer<typeof qualificationOutcomeSchema>

const bidirectionalTypeChecks: [
  InferredEvidenceCell extends EvidenceCell ? true : false,
  EvidenceCell extends InferredEvidenceCell ? true : false,
  InferredVerificationProfile extends VerificationProfile ? true : false,
  VerificationProfile extends InferredVerificationProfile ? true : false,
  InferredQualificationResult extends QualificationResult ? true : false,
  QualificationResult extends InferredQualificationResult ? true : false,
  InferredQualificationRefusal extends QualificationRefusal ? true : false,
  QualificationRefusal extends InferredQualificationRefusal ? true : false,
  InferredQualificationOutcome extends QualificationOutcome ? true : false,
  QualificationOutcome extends InferredQualificationOutcome ? true : false,
] = [true, true, true, true, true, true, true, true, true, true]

void bidirectionalTypeChecks

export function canonicalCandidateIdentityDigest(candidate: CandidateIdentity): `sha256:${string}` {
  const frame = (value: string): string => {
    const normalized = value.normalize("NFC")
    return `${new TextEncoder().encode(normalized).length}:${normalized}`
  }
  const scalar = (value: string): string => `s${frame(value)}`
  const fields: readonly [string, string][] = [
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
  const encoded = `r${frame("agent-plugin-kit.candidate-identity.v1")}${frame(String(fields.length))}${fields
    .map(([name, value]) => `${frame(name)}${frame(scalar(value))}`)
    .join("")}`
  return `sha256:${createHash("sha256").update(encoded).digest("hex")}`
}
