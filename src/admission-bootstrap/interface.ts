import type {
  AdmissionRefusal,
  AdmissionRequest,
  AdmittedIdentity,
} from "../modules/release-and-git-engine/interface"

export type { AdmissionRefusal, AdmissionRequest }

export type AdmissionResult =
  | { kind: "admitted"; identity: AdmittedIdentity }
  | { kind: "refused"; refusal: AdmissionRefusal }

export interface AdmissionBootstrap {
  /**
   * Admits only when every Repository, Source Provenance, Source, Release,
   * Package, and Workflow observation agrees with one Candidate Identity and
   * the Candidate Source commit is exactly 40 lowercase hexadecimal digits.
   *
   * Refusal precedence is repository, provenance, source pin, release pin,
   * package pin, then workflow pin. An admitted identity is detached from the
   * caller's request and deeply frozen before it is returned.
   */
  admit(request: AdmissionRequest): AdmissionResult
}

export declare const admissionBootstrap: AdmissionBootstrap
