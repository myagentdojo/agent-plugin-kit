import type { AdmissionBootstrap, AdmissionResult, SourceCheckoutAdmissionResult } from "../interface"
import type {
  AdmissionRefusal,
  AdmissionRequest,
  AdmittedIdentity,
  AdmittedSourceCheckoutIdentity,
  CandidateIdentity,
  PackageIdentity,
  ReleaseIdentity,
  RepositoryIdentity,
  SourceIdentity,
  SourceCheckoutAdmissionRefusal,
  SourceCheckoutAdmissionRequest,
  WorkflowIdentity,
} from "../../modules/release-and-git-engine/interface"

const nextAction = "Correct the mismatched immutable identity observation."
const fullCommitPinPattern = /^[0-9a-f]{40}$/

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

function releaseAgrees(request: AdmissionRequest, candidate: CandidateIdentity): boolean {
  return sameRelease(request.release, candidate.release) &&
    candidate.release.commit === candidate.source.commit
}

function packageAgrees(request: AdmissionRequest, candidate: CandidateIdentity): boolean {
  return samePackage(request.package, candidate.package) &&
    candidate.package.commit === candidate.source.commit
}

function workflowAgrees(request: AdmissionRequest, candidate: CandidateIdentity): boolean {
  return sameWorkflow(request.workflow, candidate.workflow) &&
    candidate.workflow.commit === candidate.source.commit
}

function admittedIdentity(candidate: CandidateIdentity): AdmittedIdentity {
  const sourceRepository = Object.freeze({ origin: candidate.source.repository.origin })
  const packageRepository = Object.freeze({ origin: candidate.package.repository.origin })
  const workflowRepository = Object.freeze({ origin: candidate.workflow.repository.origin })

  return Object.freeze({
    source: Object.freeze({
      repository: sourceRepository,
      commit: candidate.source.commit,
    }),
    release: Object.freeze({
      reference: candidate.release.reference,
      commit: candidate.release.commit,
    }),
    package: Object.freeze({
      repository: packageRepository,
      commit: candidate.package.commit,
    }),
    workflow: Object.freeze({
      repository: workflowRepository,
      path: candidate.workflow.path,
      commit: candidate.workflow.commit,
    }),
  }) as AdmittedIdentity
}

function refusal(code: AdmissionRefusal["code"]): AdmissionResult {
  return {
    kind: "refused",
    refusal: { code, nextAction },
  }
}

function sourceCheckoutRefusal(code: SourceCheckoutAdmissionRefusal["code"]): SourceCheckoutAdmissionResult {
  return { kind: "refused", refusal: { code, nextAction } }
}

function admittedSourceCheckoutIdentity(request: SourceCheckoutAdmissionRequest): AdmittedSourceCheckoutIdentity {
  return Object.freeze({
    profile: "source-checkout",
    source: Object.freeze({
      repository: Object.freeze({ origin: request.candidate.source.repository.origin }),
      commit: request.candidate.source.commit,
    }),
    package: Object.freeze({
      repository: Object.freeze({ origin: request.candidate.package.repository.origin }),
      commit: request.candidate.package.commit,
    }),
  }) as AdmittedSourceCheckoutIdentity
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
    if (!sameSource(request.source, candidate.source)) {
      return refusal("source-pin-mismatch")
    }
    if (!fullCommitPinPattern.test(candidate.source.commit)) {
      return refusal("source-pin-mismatch")
    }
    if (!releaseAgrees(request, candidate)) {
      return refusal("release-pin-mismatch")
    }
    if (!packageAgrees(request, candidate)) {
      return refusal("package-pin-mismatch")
    }
    if (!workflowAgrees(request, candidate)) {
      return refusal("workflow-pin-mismatch")
    }

    return { kind: "admitted", identity: admittedIdentity(candidate) }
  },
  admitSourceCheckout(request) {
    const candidate = request.candidate
    if (!sameRepository(request.repository, candidate.source.repository)) return sourceCheckoutRefusal("repository-mismatch")
    if (!sameSource(request.provenance, candidate.source)) return sourceCheckoutRefusal("provenance-mismatch")
    if (!sameSource(request.source, candidate.source) || !fullCommitPinPattern.test(candidate.source.commit)) {
      return sourceCheckoutRefusal("source-pin-mismatch")
    }
    if (!samePackage(request.package, candidate.package) ||
      !sameRepository(candidate.package.repository, candidate.source.repository) ||
      candidate.package.commit !== candidate.source.commit) return sourceCheckoutRefusal("package-pin-mismatch")
    return { kind: "admitted", identity: admittedSourceCheckoutIdentity(request) }
  },
}
