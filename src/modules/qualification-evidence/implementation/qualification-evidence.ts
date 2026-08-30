import type { CandidateIdentity } from "../../release-and-git-engine/interface"
import {
  candidateHasOneFullCommitPin,
  candidateIdentitiesMatch,
} from "../../release-and-git-engine/serialized-values"
import type {
  EvidenceCell,
  QualificationEvidence,
  QualificationOutcome,
  QualificationRefusalCode,
  QualificationResult,
  VerificationProfile,
} from "../interface"
import { canonicalCandidateIdentityDigest } from "../serialized-values"

type ProofLayer = Exclude<EvidenceCell["actualProofLayer"], null>
type VerificationClaim = EvidenceCell["claim"]
type VerificationRequirement = VerificationProfile["requirements"][number]
type LineageMember = VerificationRequirement["requiredLineage"][number]
type NonSkipEvidenceCell = Exclude<EvidenceCell, { unknownKind: "skip" }>
type ReducedClaim = QualificationResult["claims"][number]

const cellIdPattern = /^cell:[a-z][a-z0-9-]{0,63}$/
const proofLayerSatisfaction: Record<ProofLayer, readonly ProofLayer[]> = {
  "in-process": ["in-process"],
  "public-process": ["in-process", "public-process"],
  "clean-fixture": ["in-process", "public-process", "clean-fixture"],
  hosted: ["in-process", "public-process", "clean-fixture", "hosted"],
  "fresh-native": ["in-process", "public-process", "clean-fixture", "fresh-native"],
}

function assertNever(value: never): never {
  throw new Error(`qualification-evidence: unhandled variant ${String(value)}`)
}

function sameCandidate(left: CandidateIdentity, right: CandidateIdentity): boolean {
  return candidateIdentitiesMatch(left, right)
}

function sameOptional<T>(expected: T, actual: T | undefined, same: (left: T, right: T) => boolean): boolean {
  return actual === undefined || same(expected, actual)
}

function sameReceiptDigest(candidateDigest: `sha256:${string}`, receipt: NonSkipEvidenceCell["receipt"]): boolean {
  return receipt === null || receipt.candidateIdentitySha256 === candidateDigest
}

function hostedRunMatches(candidate: CandidateIdentity, cell: EvidenceCell): boolean {
  const hostedRun = cell.lineage.hostedRun
  return hostedRun === undefined || (
    hostedRun.repository.origin === candidate.source.repository.origin &&
    hostedRun.headCommit === candidate.source.commit
  )
}

function lineageMatchesCandidate(
  candidate: CandidateIdentity,
  cell: EvidenceCell,
  candidateDigest: `sha256:${string}`,
): boolean {
  return [
    candidateHasOneFullCommitPin(candidate),
    sameCandidate(cell.candidate, candidate),
    cell.lineage.candidateIdentitySha256 === candidateDigest,
    sameOptional(
      candidate.source,
      cell.lineage.source,
      (expected, actual) => expected.repository.origin === actual.repository.origin && expected.commit === actual.commit,
    ),
    sameOptional(
      candidate.release,
      cell.lineage.release,
      (expected, actual) => expected.reference === actual.reference && expected.commit === actual.commit,
    ),
    sameOptional(
      candidate.package,
      cell.lineage.package,
      (expected, actual) => expected.repository.origin === actual.repository.origin && expected.commit === actual.commit,
    ),
    sameOptional(
      candidate.workflow,
      cell.lineage.workflow,
      (expected, actual) => expected.repository.origin === actual.repository.origin &&
        expected.path === actual.path &&
        expected.commit === actual.commit,
    ),
    hostedRunMatches(candidate, cell),
    sameReceiptDigest(candidateDigest, cell.receipt),
  ].every(Boolean)
}

function payloadDigestDisagrees(
  previous: `sha256:${string}` | undefined,
  current: `sha256:${string}` | undefined,
): boolean {
  return previous !== undefined && current !== undefined && previous !== current
}

function sameProofLayer(actual: ProofLayer, required: ProofLayer): boolean {
  return proofLayerSatisfaction[actual].includes(required)
}

function layerCanResolve(resolver: ProofLayer, earlier: ProofLayer): boolean {
  return sameProofLayer(resolver, earlier)
}

const lineagePresence: Record<LineageMember, (cell: NonSkipEvidenceCell) => boolean> = {
  source: () => true,
  release: (cell) => cell.lineage.release !== undefined,
  package: (cell) => cell.lineage.package !== undefined,
  workflow: (cell) => cell.lineage.workflow !== undefined,
  "installed-payload": (cell) => cell.lineage.installedPayloadSha256 !== undefined,
  "hosted-run": (cell) => cell.lineage.hostedRun !== undefined,
  platform: (cell) => cell.lineage.platform !== undefined,
  receipt: (cell) => cell.receipt !== null,
}

function hasRequiredLineage(cell: NonSkipEvidenceCell, requirement: VerificationRequirement): boolean {
  return requirement.requiredLineage.every((member) => lineagePresence[member](cell))
}

function isSkip(cell: EvidenceCell): cell is Extract<EvidenceCell, { unknownKind: "skip" }> {
  return cell.assertedStatus === "unknown" && cell.unknownKind === "skip"
}

function isNonSkip(cell: EvidenceCell): cell is NonSkipEvidenceCell {
  return !isSkip(cell)
}

function cellIsQualified(cell: NonSkipEvidenceCell, requirement: VerificationRequirement): boolean {
  return cell.assertedStatus === "proved" &&
    sameProofLayer(cell.actualProofLayer, requirement.requiredProofLayer) &&
    hasRequiredLineage(cell, requirement)
}

function cellStatus(cell: NonSkipEvidenceCell, requirement: VerificationRequirement): "proved" | "not-proved" | "unknown" {
  switch (cell.assertedStatus) {
    case "proved":
      return cellIsQualified(cell, requirement) ? "proved" : "not-proved"
    case "not-proved":
      return "not-proved"
    case "unknown":
      return "unknown"
    default:
      return assertNever(cell)
  }
}

function hasInvalidIds(cells: readonly EvidenceCell[]): `cell:${string}` | null {
  const seen = new Set<string>()
  for (const cell of cells) {
    if (!cellIdPattern.test(cell.id) || seen.has(cell.id)) return cell.id
    seen.add(cell.id)
  }
  return null
}

function hasOutOfProfileCell(cells: readonly EvidenceCell[], profile: VerificationProfile): EvidenceCell | null {
  const selected = new Set(profile.requirements.map(({ claim }) => claim))
  return cells.find((cell) => !selected.has(cell.claim)) ?? null
}

type IndexedCell = { cell: EvidenceCell; index: number }

function isInvalidResolutionTarget(
  source: EvidenceCell,
  targetId: `cell:${string}`,
  sourceIndex: number,
  target: IndexedCell | undefined,
  seen: ReadonlySet<string>,
): boolean {
  return [
    target === undefined,
    seen.has(targetId),
    target?.index !== undefined && target.index >= sourceIndex,
    target?.cell.claim !== source.claim,
    target !== undefined && !sameCandidate(target.cell.candidate, source.candidate),
  ].some(Boolean)
}

function hasInvalidResolution(cells: readonly EvidenceCell[]): EvidenceCell | null {
  const byId = new Map(cells.map((cell, index) => [cell.id, { cell, index }]))
  for (const [index, cell] of cells.entries()) {
    const seen = new Set<string>()
    for (const targetId of cell.resolves) {
      if (isInvalidResolutionTarget(cell, targetId, index, byId.get(targetId), seen)) return cell
      seen.add(targetId)
    }
    if (isSkip(cell) && cell.resolves.length > 0) return cell
  }
  return null
}

function hasLineageDisagreement(candidate: CandidateIdentity, cells: readonly EvidenceCell[]): EvidenceCell | null {
  const candidateDigest = canonicalCandidateIdentityDigest(candidate)
  let installedPayloadDigest: `sha256:${string}` | undefined
  for (const cell of cells) {
    if (!lineageMatchesCandidate(candidate, cell, candidateDigest)) return cell
    const currentPayloadDigest = cell.lineage.installedPayloadSha256
    if (payloadDigestDisagrees(installedPayloadDigest, currentPayloadDigest)) return cell
    installedPayloadDigest = currentPayloadDigest ?? installedPayloadDigest
  }
  return null
}

function resolverIsUnqualified(
  cell: EvidenceCell,
  requirement: VerificationRequirement | undefined,
  byId: ReadonlyMap<string, EvidenceCell>,
): boolean {
  if (requirement === undefined || !isNonSkip(cell) || !cellIsQualified(cell, requirement)) return true
  return cell.resolves.some((targetId) => {
    const target = byId.get(targetId)
    return target !== undefined && isNonSkip(target) && !layerCanResolve(cell.actualProofLayer, target.actualProofLayer)
  })
}

function hasUnqualifiedResolution(cells: readonly EvidenceCell[], profile: VerificationProfile): EvidenceCell | null {
  const requirements = new Map(profile.requirements.map((requirement) => [requirement.claim, requirement]))
  const byId = new Map(cells.map((cell) => [cell.id, cell]))
  return cells.find((cell) => cell.resolves.length > 0 && resolverIsUnqualified(cell, requirements.get(cell.claim), byId)) ?? null
}

function appendUnique<T>(target: T[], values: readonly T[]): void {
  for (const value of values) if (!target.includes(value)) target.push(value)
}

function claimMetadata(claimCells: readonly EvidenceCell[]): Pick<ReducedClaim, "evidenceCellIds" | "nonClaims" | "receiptDigests"> {
  const nonClaims: VerificationClaim[] = []
  const receiptDigests: `sha256:${string}`[] = []
  for (const cell of claimCells) {
    appendUnique(nonClaims, cell.nonClaims)
    if (cell.receipt !== null) appendUnique(receiptDigests, [cell.receipt.digest])
  }
  return { evidenceCellIds: claimCells.map(({ id }) => id), nonClaims, receiptDigests }
}

function skipClaim(requirement: VerificationRequirement, metadata: Pick<ReducedClaim, "evidenceCellIds" | "nonClaims" | "receiptDigests">, skip: Extract<EvidenceCell, { unknownKind: "skip" }>): ReducedClaim {
  return {
    claim: requirement.claim,
    ...metadata,
    status: "unknown",
    unknownKind: "skip",
    actualProofLayer: null,
    observationKind: null,
    skipRationale: skip.skipRationale,
  }
}

type Decisive = { cell: NonSkipEvidenceCell; status: "proved" | "not-proved" | "unknown" }

function firstDecisive(statuses: readonly Decisive[]): Decisive | undefined {
  return statuses.find(({ status }) => status === "not-proved") ??
    statuses.find(({ status }) => status === "unknown") ??
    statuses.find(({ status }) => status === "proved")
}

function unknownObservationKind(cell: NonSkipEvidenceCell): "unavailable" | "unknown" {
  switch (cell.assertedStatus) {
    case "unknown":
      return cell.observable.kind
    case "proved":
    case "not-proved":
      return "unknown"
    default:
      return assertNever(cell)
  }
}

function notProvedObservationKind(cell: NonSkipEvidenceCell): "observed" | "failure" | "proved-absence" {
  switch (cell.assertedStatus) {
    case "proved":
    case "unknown":
      return "observed"
    case "not-proved":
      return cell.observable.kind
    default:
      return assertNever(cell)
  }
}

function decisiveClaim(
  requirement: VerificationRequirement,
  metadata: Pick<ReducedClaim, "evidenceCellIds" | "nonClaims" | "receiptDigests">,
  decisive: Decisive | undefined,
): ReducedClaim {
  if (decisive === undefined) {
    return {
      claim: requirement.claim,
      ...metadata,
      status: "unknown",
      unknownKind: "observation",
      actualProofLayer: "in-process",
      observationKind: "unknown",
      skipRationale: null,
    }
  }
  switch (decisive.status) {
    case "proved":
      return {
        claim: requirement.claim,
        ...metadata,
        status: "proved",
        actualProofLayer: decisive.cell.actualProofLayer,
        observationKind: "observed",
        skipRationale: null,
      }
    case "unknown": {
      return {
        claim: requirement.claim,
        ...metadata,
        status: "unknown",
        unknownKind: "observation",
        actualProofLayer: decisive.cell.actualProofLayer,
        observationKind: unknownObservationKind(decisive.cell),
        skipRationale: null,
      }
    }
    case "not-proved": {
      return {
        claim: requirement.claim,
        ...metadata,
        status: "not-proved",
        actualProofLayer: decisive.cell.actualProofLayer,
        observationKind: notProvedObservationKind(decisive.cell),
        skipRationale: null,
      }
    }
    default:
      return assertNever(decisive.status)
  }
}

function hasMixedUnresolved(unresolved: readonly EvidenceCell[]): boolean {
  const first = unresolved[0]
  return unresolved.some(isSkip) && !(unresolved.length === 1 && first !== undefined && isSkip(first))
}

function reducedClaim(
  requirement: VerificationRequirement,
  claimCells: readonly EvidenceCell[],
  unresolved: readonly EvidenceCell[],
): ReducedClaim {
  const metadata = claimMetadata(claimCells)
  const first = unresolved[0]
  if (unresolved.length === 1 && first !== undefined && isSkip(first)) return skipClaim(requirement, metadata, first)
  const statuses = unresolved.filter(isNonSkip).map((cell) => ({ cell, status: cellStatus(cell, requirement) }))
  return decisiveClaim(requirement, metadata, firstDecisive(statuses))
}

type RefusedOutcome = Extract<QualificationOutcome, { status: "refused" }>

function refusal(
  code: QualificationRefusalCode,
  claim: VerificationClaim | null = null,
  evidenceCellId: `cell:${string}` | null = null,
): RefusedOutcome {
  return { status: "refused", refusal: { schemaVersion: 1, code, claim, evidenceCellId } }
}

function validateReductionInput(input: {
  candidate: CandidateIdentity
  profile: VerificationProfile
  cells: readonly EvidenceCell[]
}): QualificationOutcome | null {
  const checks: readonly (() => QualificationOutcome | null)[] = [
    () => {
      const invalidId = hasInvalidIds(input.cells)
      return invalidId === null ? null : refusal("invalid-cell-id", null, invalidId)
    },
    () => {
      const outOfProfile = hasOutOfProfileCell(input.cells, input.profile)
      return outOfProfile === null ? null : refusal("out-of-profile", outOfProfile.claim, outOfProfile.id)
    },
    () => {
      const invalidResolution = hasInvalidResolution(input.cells)
      return invalidResolution === null ? null : refusal("invalid-resolution", invalidResolution.claim, invalidResolution.id)
    },
    () => {
      const lineageDisagreement = hasLineageDisagreement(input.candidate, input.cells)
      return lineageDisagreement === null ? null : refusal("lineage-disagreement", lineageDisagreement.claim, lineageDisagreement.id)
    },
    () => {
      const unqualifiedResolution = hasUnqualifiedResolution(input.cells, input.profile)
      return unqualifiedResolution === null ? null : refusal("unqualified-resolution", unqualifiedResolution.claim, unqualifiedResolution.id)
    },
  ]
  for (const check of checks) {
    const failure = check()
    if (failure !== null) return failure
  }
  return null
}

type ClaimReduction = { kind: "claim"; value: ReducedClaim } | { kind: "refusal"; value: RefusedOutcome }

function reduceRequirement(
  requirement: VerificationRequirement,
  cells: readonly EvidenceCell[],
  resolvedIds: ReadonlySet<string>,
): ClaimReduction {
  const claimCells = cells.filter((cell) => cell.claim === requirement.claim)
  const unresolved = claimCells.filter((cell) => !resolvedIds.has(cell.id))
  if (unresolved.length === 0) return { kind: "refusal", value: refusal("zero-cell", requirement.claim) }
  if (hasMixedUnresolved(unresolved)) {
    return { kind: "refusal", value: refusal("mixed-unresolved", requirement.claim, unresolved[0]?.id ?? null) }
  }
  return { kind: "claim", value: reducedClaim(requirement, claimCells, unresolved) }
}

function reduceClaims(input: {
  candidate: CandidateIdentity
  profile: VerificationProfile
  cells: readonly EvidenceCell[]
}): QualificationOutcome {
  const resolvedIds = new Set(input.cells.flatMap((cell) => cell.resolves))
  const claims: ReducedClaim[] = []
  const nonClaims: VerificationClaim[] = []
  const receiptDigests: `sha256:${string}`[] = []
  let skipped = 0
  let proved = 0
  let notProved = 0
  let unknown = 0
  for (const requirement of input.profile.requirements) {
    const reduction = reduceRequirement(requirement, input.cells, resolvedIds)
    switch (reduction.kind) {
      case "refusal":
        return reduction.value
      case "claim":
        break
      default:
        return assertNever(reduction)
    }
    const claim = reduction.value
    claims.push(claim)
    appendUnique(nonClaims, claim.nonClaims)
    appendUnique(receiptDigests, claim.receiptDigests)
    switch (claim.status) {
      case "proved":
        proved += 1
        break
      case "not-proved":
        notProved += 1
        break
      case "unknown":
        switch (claim.unknownKind) {
          case "skip":
            skipped += 1
            break
          case "observation":
            unknown += 1
            break
          default:
            assertNever(claim)
        }
        break
      default:
        assertNever(claim)
    }
  }
  return {
    status: "reduced",
    result: {
      schemaVersion: 1,
      candidate: input.candidate,
      profileId: input.profile.id,
      claims,
      counts: {
        selected: input.profile.requirements.length,
        covered: input.profile.requirements.length - skipped,
        skipped,
        proved,
        notProved,
        unknown,
      },
      nonClaims,
      receiptDigests,
    },
  }
}

function reduceEvidence(input: {
  candidate: CandidateIdentity
  profile: VerificationProfile
  cells: readonly EvidenceCell[]
}): QualificationOutcome {
  const validation = validateReductionInput(input)
  if (validation !== null) return validation
  return reduceClaims(input)
}

export const qualificationEvidence: QualificationEvidence = {
  reduce: reduceEvidence,
}
