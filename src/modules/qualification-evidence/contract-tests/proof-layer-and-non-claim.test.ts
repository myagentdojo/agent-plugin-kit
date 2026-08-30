import { expect, test } from "bun:test"
import type {
  EvidenceCell,
  QualificationOutcome,
  QualificationRefusal,
  QualificationResult,
  VerificationProfile,
} from "../interface"
import { qualificationEvidence } from "../implementation/qualification-evidence"
import {
  parseEvidenceCell,
  parseQualificationOutcome,
  parseQualificationRefusal,
  parseQualificationResult,
  parseVerificationProfile,
  serializeEvidenceCell,
  serializeQualificationOutcome,
  serializeQualificationRefusal,
  serializeQualificationResult,
  serializeVerificationProfile,
} from "../serialized-values"
import {
  candidate,
  failureCell,
  observedCell,
  personalEvidenceCells,
  personalProfile,
  provedAbsenceCell,
  publicEvidenceCells,
  publicProfile,
  skipCell,
  unavailableCell,
  unknownObservationCell,
} from "./fixtures/evidence-cells"

function reducedFixture(profile: VerificationProfile = personalProfile): QualificationResult {
  const outcome = qualificationEvidence.reduce({ candidate, profile, cells: personalEvidenceCells() })
  if (outcome.status !== "reduced") throw new Error("expected reduced fixture")
  return outcome.result
}

function refusedFixture(): QualificationRefusal {
  const outcome = qualificationEvidence.reduce({ candidate, profile: personalProfile, cells: [] })
  if (outcome.status !== "refused") throw new Error("expected refused fixture")
  return outcome.refusal
}

function reducedMissingLineageFixture(): QualificationResult {
  const cells = personalEvidenceCells().map((cell) => {
    if (cell.claim !== "kit.identity.admitted") return cell
    const { workflow: _workflow, ...lineage } = cell.lineage
    return { ...cell, lineage }
  })
  const outcome = qualificationEvidence.reduce({ candidate, profile: personalProfile, cells })
  if (outcome.status !== "reduced") throw new Error("expected missing-lineage reduced fixture")
  return outcome.result
}

function replaceReducedClaim(
  result: QualificationResult,
  replacement: QualificationResult["claims"][number],
): QualificationResult {
  return {
    ...result,
    claims: result.claims.map((claim) => claim.claim === replacement.claim ? replacement : claim),
  }
}

function expectInvalidQualificationResult(value: QualificationResult): void {
  expect(parseQualificationResult(value)).toBeUndefined()
  expect(() => serializeQualificationResult(value)).toThrow("qualification-evidence: invalid serialized value")
}

test("declared and inferred values make exact JSON round trips", () => {
  const cell = observedCell()
  const profile = personalProfile
  const result = reducedFixture()
  const refusal = refusedFixture()
  const reducedOutcome: QualificationOutcome = { status: "reduced", result }
  const refusedOutcome: QualificationOutcome = { status: "refused", refusal }

  expect(parseEvidenceCell(JSON.parse(serializeEvidenceCell(cell)))).toEqual(cell)
  expect(parseVerificationProfile(JSON.parse(serializeVerificationProfile(profile)))).toEqual(profile)
  expect(parseQualificationResult(JSON.parse(serializeQualificationResult(result)))).toEqual(result)
  expect(parseQualificationRefusal(JSON.parse(serializeQualificationRefusal(refusal)))).toEqual(refusal)
  expect(parseQualificationOutcome(JSON.parse(serializeQualificationOutcome(reducedOutcome)))).toEqual(reducedOutcome)
  expect(parseQualificationOutcome(JSON.parse(serializeQualificationOutcome(refusedOutcome)))).toEqual(refusedOutcome)
})

test("ingress accepts all seven Evidence Cell forms and both exact profiles", () => {
  const variants: readonly EvidenceCell[] = [
    observedCell({ id: "cell:observed-qualified" }),
    observedCell({ id: "cell:observed-insufficient", actualProofLayer: "public-process" }),
    failureCell("kit.identity.admitted", "cell:failure"),
    provedAbsenceCell("kit.identity.admitted", "cell:proved-absence"),
    unavailableCell("kit.identity.admitted", "cell:unavailable"),
    unknownObservationCell("kit.identity.admitted", "cell:unknown-observation"),
    skipCell("kit.identity.admitted", "cell:skip-variant"),
  ]

  for (const variant of variants) {
    expect(parseEvidenceCell(JSON.parse(serializeEvidenceCell(variant)))).toEqual(variant)
  }
  const reorderedCandidateCell = {
    ...observedCell(),
    candidate: {
      workflow: candidate.workflow,
      package: candidate.package,
      release: candidate.release,
      source: candidate.source,
    },
  }
  expect(parseEvidenceCell(reorderedCandidateCell)).toEqual(reorderedCandidateCell)
  expect(parseVerificationProfile(JSON.parse(serializeVerificationProfile(personalProfile)))).toEqual(personalProfile)
  expect(parseVerificationProfile(JSON.parse(serializeVerificationProfile(publicProfile)))).toEqual(publicProfile)
})

test("strict ingress rejects mismatches, unknown fields, versions, coercion, defaults, undefined, and raw detail", () => {
  const cell = observedCell()
  const invalidProfileVersion = { ...personalProfile, schemaVersion: 2 }
  const invalidProfileOrder = { ...personalProfile, requirements: [...personalProfile.requirements].reverse() }
  const invalidValues: readonly unknown[] = [
    { ...cell, assertedStatus: "proved", observable: { kind: "failure", code: "BAD_STATUS" } },
    { ...cell, assertedStatus: "proved", actualProofLayer: null },
    { ...cell, extraField: "not-allowed" },
    { ...cell, schemaVersion: 2 },
    { ...cell, receipt: { ...cell.receipt!, receiptSchemaVersion: "1" } },
    { ...cell, observable: { kind: "observed" } },
    { ...cell, receipt: undefined },
    { ...cell, raw: { secret: "private" } },
    { ...skipCell("kit.identity.admitted"), observable: { kind: "observed", code: "BAD_SKIP" } },
    { ...skipCell("harness.claude.fresh-native"), skipRationale: "unsupported-rationale" },
    {
      ...cell,
      candidate: {
        ...cell.candidate,
        release: { ...cell.candidate.release, commit: "2222222222222222222222222222222222222222" },
      },
    },
    invalidProfileVersion,
    invalidProfileOrder,
  ]

  for (const value of invalidValues) {
    expect(parseEvidenceCell(value)).toBeUndefined()
  }
  const invalidOrigins = [
    "http://localhost/Users/nathan/private-repo",
    "https://127.0.0.1/myagentdojo/example-plugin.git",
    "https://10.0.0.4/myagentdojo/example-plugin.git",
    "https://192.168.1.4/myagentdojo/example-plugin.git",
    "https://100.64.0.1/myagentdojo/example-plugin.git",
    "https://100.127.255.254/myagentdojo/example-plugin.git",
    "https://192.0.2.10/myagentdojo/example-plugin.git",
    "https://198.51.100.10/myagentdojo/example-plugin.git",
    "https://203.0.113.10/myagentdojo/example-plugin.git",
    "https://[::1]/myagentdojo/example-plugin.git",
    "https://[::ffff:c0a8:104]/myagentdojo/example-plugin.git",
    "https://example.com/myagentdojo/example-plugin.git",
    "https://subdomain.example.com/myagentdojo/example-plugin.git",
    "https://private.private/myagentdojo/example-plugin.git",
    "https://github.com:443/myagentdojo/example-plugin.git",
    "https://GitHub.com/myagentdojo/example-plugin.git",
    "https://github.com./myagentdojo/example-plugin.git",
    "https://git.internal/myagentdojo/example-plugin.git",
    "https://github.com/Users/nathan/private-repo",
    "https://github.com/%2525252FUsers/nathan/private-repo",
    "https://github.com/a/../example-plugin.git",
    "https://github.com/%6dyagentdojo/example-plugin.git",
  ]
  for (const origin of invalidOrigins) {
    expect(parseEvidenceCell({
      ...cell,
      candidate: {
        source: { ...cell.candidate.source, repository: { origin } },
        release: cell.candidate.release,
        package: cell.candidate.package,
        workflow: cell.candidate.workflow,
      },
    })).toBeUndefined()
  }
  for (const origin of [
    "https://github.com/home/agent-plugin-kit.git",
    "https://github.com/workspaces/agent-plugin-kit.git",
  ]) {
    expect(parseEvidenceCell({
      ...cell,
      candidate: {
        ...cell.candidate,
        source: { ...cell.candidate.source, repository: { origin } },
      },
    })).toBeDefined()
  }
  expect(parseVerificationProfile(invalidProfileVersion)).toBeUndefined()
  expect(parseVerificationProfile(invalidProfileOrder)).toBeUndefined()
  expect(() => serializeEvidenceCell(invalidValues[7] as EvidenceCell)).toThrow(
    /^qualification-evidence: invalid serialized value$/,
  )
})

test("profiles retain exact order and lineage while Proof Layer satisfaction is reflexive and incomparable at the top", () => {
  expect(personalProfile.schemaVersion).toBe(1)
  expect(publicProfile.schemaVersion).toBe(1)
  expect(personalProfile.requirements.map(({ claim }) => claim)).toEqual([
    "kit.identity.admitted",
    "kit.command.invoked",
    "kit.package.full-commit-pin",
    "kit.workflow.full-commit-pin",
    "plugin-payload.installed",
    "runtime.supported-platform",
    "harness.claude.fresh-native",
    "harness.codex.fresh-native",
  ])
  expect(publicProfile.requirements.map(({ claim }) => claim)).toEqual([
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
  ])
  expect(personalProfile.requirements[0]?.requiredLineage).toEqual(["source", "release", "package", "workflow"])
  expect(personalProfile.requirements[5]?.requiredProofLayer).toBe("public-process")
  expect(publicProfile.requirements[4]?.requiredProofLayer).toBe("hosted")
  expect(publicProfile.requirements[9]?.requiredProofLayer).toBe("fresh-native")

  const reflexive = reducedFixture()
  expect(reflexive.claims[0]).toMatchObject({ status: "proved", actualProofLayer: "clean-fixture" })

  const hostedAsFresh = publicEvidenceCells().map((cell) =>
    cell.claim === "harness.claude.fresh-native"
      ? observedCell({ id: "cell:hosted-as-fresh", claim: cell.claim, actualProofLayer: "hosted" })
      : cell,
  )
  const hostedAsFreshOutcome = qualificationEvidence.reduce({ candidate, profile: publicProfile, cells: hostedAsFresh })
  expect(hostedAsFreshOutcome.status).toBe("reduced")
  if (hostedAsFreshOutcome.status === "reduced") {
    expect(hostedAsFreshOutcome.result.claims.find(({ claim }) => claim === "harness.claude.fresh-native")).toMatchObject({
      status: "not-proved",
      actualProofLayer: "hosted",
    })
  }

  const freshAsHosted = publicEvidenceCells().map((cell) =>
    cell.claim === "plugin-payload.installed"
      ? observedCell({ id: "cell:fresh-as-hosted", claim: cell.claim, actualProofLayer: "fresh-native" })
      : cell,
  )
  const freshAsHostedOutcome = qualificationEvidence.reduce({ candidate, profile: publicProfile, cells: freshAsHosted })
  expect(freshAsHostedOutcome.status).toBe("reduced")
  if (freshAsHostedOutcome.status === "reduced") {
    expect(freshAsHostedOutcome.result.claims.find(({ claim }) => claim === "plugin-payload.installed")).toMatchObject({
      status: "not-proved",
      actualProofLayer: "fresh-native",
    })
  }

  const lowerCannotPromote = personalEvidenceCells().map((cell) =>
    cell.claim === "kit.identity.admitted"
      ? observedCell({ id: "cell:public-process-as-clean-fixture", actualProofLayer: "public-process" })
      : cell,
  )
  const lowerCannotPromoteOutcome = qualificationEvidence.reduce({
    candidate,
    profile: personalProfile,
    cells: lowerCannotPromote,
  })
  expect(lowerCannotPromoteOutcome.status).toBe("reduced")
  if (lowerCannotPromoteOutcome.status === "reduced") {
    expect(lowerCannotPromoteOutcome.result.claims[0]).toMatchObject({
      status: "not-proved",
      actualProofLayer: "public-process",
    })
  }

  const higherSatisfiesLower = personalEvidenceCells().map((cell) =>
    cell.claim === "runtime.supported-platform"
      ? observedCell({
          id: "cell:clean-fixture-as-public-process",
          claim: cell.claim,
          actualProofLayer: "clean-fixture",
        })
      : cell,
  )
  const higherSatisfiesLowerOutcome = qualificationEvidence.reduce({
    candidate,
    profile: personalProfile,
    cells: higherSatisfiesLower,
  })
  expect(higherSatisfiesLowerOutcome.status).toBe("reduced")
  if (higherSatisfiesLowerOutcome.status === "reduced") {
    expect(higherSatisfiesLowerOutcome.result.claims.find(({ claim }) =>
      claim === "runtime.supported-platform"
    )).toMatchObject({
      status: "proved",
      actualProofLayer: "clean-fixture",
    })
  }

  const missingRequiredLineage = reducedMissingLineageFixture()
  expect(missingRequiredLineage.claims[0]).toMatchObject({
    status: "not-proved",
    actualProofLayer: "clean-fixture",
    observationKind: "observed",
  })
  expect(parseQualificationResult(JSON.parse(serializeQualificationResult(missingRequiredLineage))))
    .toEqual(missingRequiredLineage)
})

test("reduced and refused outcomes preserve counts, skip distinction, and never promote a weak observation", () => {
  const reduced = reducedFixture()
  const reducedOutcome: QualificationOutcome = { status: "reduced", result: reduced }
  const refusal = refusedFixture()
  const refusedOutcome: QualificationOutcome = { status: "refused", refusal }
  expect(parseQualificationOutcome(JSON.parse(serializeQualificationOutcome(reducedOutcome)))).toEqual(reducedOutcome)
  expect(parseQualificationOutcome(JSON.parse(serializeQualificationOutcome(refusedOutcome)))).toEqual(refusedOutcome)

  const observedUnknownCells = personalEvidenceCells().map((cell) =>
    cell.claim === "runtime.supported-platform"
      ? unavailableCell(cell.claim, "cell:runtime-unavailable")
      : cell,
  )
  const observedUnknown = qualificationEvidence.reduce({ candidate, profile: personalProfile, cells: observedUnknownCells })
  expect(observedUnknown.status).toBe("reduced")
  if (observedUnknown.status === "reduced") {
    expect(observedUnknown.result.counts).toEqual({ selected: 8, covered: 6, skipped: 2, proved: 5, notProved: 0, unknown: 1 })
    expect(observedUnknown.result.claims.find(({ claim }) => claim === "runtime.supported-platform")).toMatchObject({
      status: "unknown",
      unknownKind: "observation",
      observationKind: "unavailable",
    })
  }
  const stateVariants = [
    [failureCell("runtime.supported-platform", "cell:runtime-failure"), { status: "not-proved", observationKind: "failure" }],
    [provedAbsenceCell("runtime.supported-platform", "cell:runtime-absence"), { status: "not-proved", observationKind: "proved-absence" }],
    [unavailableCell("runtime.supported-platform", "cell:runtime-unavailable-state"), { status: "unknown", unknownKind: "observation", observationKind: "unavailable" }],
    [unknownObservationCell("runtime.supported-platform", "cell:runtime-unknown-state"), { status: "unknown", unknownKind: "observation", observationKind: "unknown" }],
  ] as const
  for (const [replacement, expected] of stateVariants) {
    const cells = personalEvidenceCells().map((cell) =>
      cell.claim === "runtime.supported-platform" ? replacement : cell,
    )
    const outcome = qualificationEvidence.reduce({ candidate, profile: personalProfile, cells })
    expect(outcome.status).toBe("reduced")
    if (outcome.status !== "reduced") continue
    expect(outcome.result.claims.find(({ claim }) => claim === "runtime.supported-platform")).toMatchObject(expected)
  }
  expect(reduced.claims.find(({ claim }) => claim === "harness.claude.fresh-native")).toMatchObject({
    status: "unknown",
    unknownKind: "skip",
    skipRationale: "fresh-native-proof-not-run",
  })
})

test("serialized egress is allowlisted, preserves bounded evidence, and fails closed", () => {
  const result = reducedFixture()
  const admittedClaim = result.claims[0]
  const claudeClaim = result.claims.find(({ claim }) => claim === "harness.claude.fresh-native")
  if (admittedClaim?.status !== "proved") throw new Error("expected admitted proved claim")
  if (claudeClaim?.status !== "unknown" || claudeClaim.unknownKind !== "skip") {
    throw new Error("expected Claude skip claim")
  }
  const refusal = refusedFixture()
  const reducedSerialized = serializeQualificationResult(result)
  const refusalSerialized = serializeQualificationRefusal(refusal)
  const reducedOutcome: QualificationOutcome = { status: "reduced", result }
  const refusedOutcome: QualificationOutcome = { status: "refused", refusal }

  expect(parseQualificationResult(JSON.parse(reducedSerialized))).toEqual(result)
  expect(parseQualificationRefusal(JSON.parse(refusalSerialized))).toEqual(refusal)
  expect(parseQualificationOutcome(JSON.parse(serializeQualificationOutcome(reducedOutcome)))).toEqual(reducedOutcome)
  expect(parseQualificationOutcome(JSON.parse(serializeQualificationOutcome(refusedOutcome)))).toEqual(refusedOutcome)
  expect(reducedSerialized).toContain("workflow.called-revision")
  expect(reducedSerialized).toContain("sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc")
  expect(reducedSerialized).not.toContain("raw")
  expect(reducedSerialized).not.toContain("private")

  expect(() => serializeQualificationResult({ ...result, extraField: true } as QualificationResult)).toThrow(
    "qualification-evidence: invalid serialized value",
  )
  expect(() => serializeQualificationRefusal({ ...refusal, code: "raw" } as unknown as QualificationRefusal)).toThrow(
    "qualification-evidence: invalid serialized value",
  )
  expect(() => serializeQualificationOutcome({
    status: "reduced",
    result: { ...result, schemaVersion: 2 },
  } as unknown as QualificationOutcome)).toThrow("qualification-evidence: invalid serialized value")
  expect(() => serializeQualificationResult({
    ...result,
    candidate: {
      ...result.candidate,
      package: {
        ...result.candidate.package,
        repository: { origin: "https://github.com/Users/nathan/private-repo" },
      },
    },
  } as QualificationResult)).toThrow("qualification-evidence: invalid serialized value")

  const insufficientProvedLayer = replaceReducedClaim(result, {
    ...admittedClaim,
    actualProofLayer: "in-process",
  })
  expectInvalidQualificationResult(insufficientProvedLayer)

  const incomparableProvedLayer = replaceReducedClaim(result, {
    claim: claudeClaim.claim,
    nonClaims: claudeClaim.nonClaims,
    receiptDigests: claudeClaim.receiptDigests,
    evidenceCellIds: claudeClaim.evidenceCellIds,
    status: "proved",
    actualProofLayer: "hosted",
    observationKind: "observed",
    skipRationale: null,
  })
  expectInvalidQualificationResult({
    ...incomparableProvedLayer,
    counts: { selected: 8, covered: 7, skipped: 1, proved: 7, notProved: 0, unknown: 0 },
  })

  const nonSkippableClaim = replaceReducedClaim(result, {
    claim: admittedClaim.claim,
    nonClaims: admittedClaim.nonClaims,
    receiptDigests: admittedClaim.receiptDigests,
    evidenceCellIds: admittedClaim.evidenceCellIds,
    status: "unknown",
    unknownKind: "skip",
    actualProofLayer: null,
    observationKind: null,
    skipRationale: "fresh-native-proof-not-run",
  })
  expectInvalidQualificationResult({
    ...nonSkippableClaim,
    counts: { selected: 8, covered: 5, skipped: 3, proved: 5, notProved: 0, unknown: 0 },
  })

  const inapplicableSkipRationale = replaceReducedClaim(result, {
    ...claudeClaim,
    skipRationale: "hosted-proof-not-run",
  })
  expectInvalidQualificationResult(inapplicableSkipRationale)

  const duplicateEvidenceCellId = {
    ...result,
    claims: result.claims.map((claim, index) =>
      index === 0
        ? { ...claim, evidenceCellIds: [...claim.evidenceCellIds, claim.evidenceCellIds[0]!] }
        : claim,
    ),
  }
  expect(parseQualificationResult(duplicateEvidenceCellId)).toBeUndefined()
  expect(() => serializeQualificationResult(duplicateEvidenceCellId as QualificationResult)).toThrow(
    "qualification-evidence: invalid serialized value",
  )

  const emptyClaimEvidenceCellIds = {
    ...result,
    claims: result.claims.map((claim, index) =>
      index === 0 ? { ...claim, evidenceCellIds: [] } : claim,
    ),
  }
  expect(parseQualificationResult(emptyClaimEvidenceCellIds)).toBeUndefined()
  expect(() => serializeQualificationResult(emptyClaimEvidenceCellIds as QualificationResult)).toThrow(
    "qualification-evidence: invalid serialized value",
  )

  const duplicateClaimNonClaim = {
    ...result,
    claims: result.claims.map((claim, index) =>
      index === 0 ? { ...claim, nonClaims: [...claim.nonClaims, claim.nonClaims[0]!] } : claim,
    ),
  }
  expect(parseQualificationResult(duplicateClaimNonClaim)).toBeUndefined()
  expect(() => serializeQualificationResult(duplicateClaimNonClaim as QualificationResult)).toThrow(
    "qualification-evidence: invalid serialized value",
  )

  const duplicateClaimReceiptDigest = {
    ...result,
    claims: result.claims.map((claim, index) =>
      index === 0 ? { ...claim, receiptDigests: [...claim.receiptDigests, claim.receiptDigests[0]!] } : claim,
    ),
  }
  expect(parseQualificationResult(duplicateClaimReceiptDigest)).toBeUndefined()
  expect(() => serializeQualificationResult(duplicateClaimReceiptDigest as QualificationResult)).toThrow(
    "qualification-evidence: invalid serialized value",
  )

  const reorderedNonClaims = { ...result, nonClaims: [...result.nonClaims].reverse() }
  expect(parseQualificationResult(reorderedNonClaims)).toBeUndefined()
  expect(() => serializeQualificationResult(reorderedNonClaims as QualificationResult)).toThrow(
    "qualification-evidence: invalid serialized value",
  )

  const duplicateReceiptDigest = {
    ...result,
    receiptDigests: [...result.receiptDigests, result.receiptDigests[0]!],
  }
  expect(parseQualificationResult(duplicateReceiptDigest)).toBeUndefined()
  expect(() => serializeQualificationResult(duplicateReceiptDigest as QualificationResult)).toThrow(
    "qualification-evidence: invalid serialized value",
  )
})
