import type { AdmissionBootstrap, AdmissionResult } from "../interface"
import type {
  AdmissionRefusal,
  AdmissionRequest,
  AdmittedIdentity,
  CandidateIdentity,
  PackageIdentity,
  ReleaseIdentity,
  RepositoryIdentity,
  SourceIdentity,
  WorkflowIdentity,
} from "../../modules/release-and-git-engine/interface"

const nextAction = "Correct the mismatched immutable identity observation."

function sameRepository(left: RepositoryIdentity, right: RepositoryIdentity): boolean {
  return left.origin === right.origin
}

function sameSource(left: SourceIdentity, right: SourceIdentity): boolean {
  return sameRepository(left.repository, right.repository) && left.commit === right.commit
}

function sameRelease(left: ReleaseIdentity, right: ReleaseIdentity): boolean {
  return left.reference === right.reference && left.commit === right.commit
}

function samePackage(left: PackageIdentity, right: PackageIdentity): boolean {
  return sameRepository(left.repository, right.repository) && left.commit === right.commit
}

function sameWorkflow(left: WorkflowIdentity, right: WorkflowIdentity): boolean {
  return sameRepository(left.repository, right.repository) &&
    left.path === right.path &&
    left.commit === right.commit
}

function refusal(code: AdmissionRefusal["code"]): AdmissionResult {
  return {
    kind: "refused",
    refusal: { code, nextAction },
  }
}

export const admissionBootstrap: AdmissionBootstrap = {
  admit(request) {
    const candidate: CandidateIdentity = request.candidate

    if (!sameRepository(request.repository, candidate.source.repository)) {
      return refusal("repository-mismatch")
    }
    if (!sameSource(request.provenance, candidate.source)) {
      return refusal("provenance-mismatch")
    }
    if (request.source.commit !== candidate.source.commit) {
      return refusal("source-pin-mismatch")
    }
    if (!sameRelease(request.release, candidate.release)) {
      return refusal("release-pin-mismatch")
    }
    if (!samePackage(request.package, candidate.package)) {
      return refusal("package-pin-mismatch")
    }
    if (!sameWorkflow(request.workflow, candidate.workflow)) {
      return refusal("workflow-pin-mismatch")
    }

    return { kind: "admitted", identity: candidate as AdmittedIdentity }
  },
}
