import { stat } from "node:fs/promises"
import type {
  AdmittedIdentity,
  CandidateIdentity,
} from "../../release-and-git-engine/interface"
import { candidateIdentitiesMatch } from "../../release-and-git-engine/serialized-values"
import type {
  CanaryAuthorityReference,
  CanaryAuthoritySource,
  CanaryAuthoritySourceResolution,
  CanaryPlan,
  ProtectedCanaryAuthority,
} from "../interface"

const protectedAuthority = Object.freeze(Object.create(null)) as ProtectedCanaryAuthority

const sameCandidate = (left: AdmittedIdentity, right: CandidateIdentity): boolean =>
  candidateIdentitiesMatch(left, right)

export const createProtectedFileAuthoritySource = (): CanaryAuthoritySource => ({
  async resolve(
    reference: CanaryAuthorityReference,
    candidate: AdmittedIdentity,
    plan: CanaryPlan,
  ): Promise<CanaryAuthoritySourceResolution> {
    if (reference.length === 0 || reference.includes("\u0000")) {
      return { status: "refused", code: "authority-reference-invalid" }
    }
    if (!sameCandidate(candidate, plan.candidate)) {
      return { status: "refused", code: "authority-candidate-mismatch" }
    }
    if (plan.target.length === 0 || plan.immutableReference.length === 0) {
      return { status: "refused", code: "authority-plan-mismatch" }
    }
    try {
      const source = await stat(reference)
      if (!source.isFile()) return { status: "refused", code: "authority-unavailable" }
    } catch {
      return { status: "refused", code: "authority-unavailable" }
    }
    return { status: "resolved", authority: protectedAuthority }
  },
})

