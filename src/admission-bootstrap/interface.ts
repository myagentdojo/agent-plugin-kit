import type {
  AdmissionRefusal,
  AdmissionRequest,
  AdmittedIdentity,
  AdmittedSourceCheckoutIdentity,
  SourceCheckoutAdmissionRefusal,
  SourceCheckoutAdmissionRequest,
} from "../modules/release-and-git-engine/interface"

export type { AdmissionRefusal, AdmissionRequest, SourceCheckoutAdmissionRequest, SourceCheckoutAdmissionRefusal, AdmittedSourceCheckoutIdentity }

export type AdmissionResult =
  | { kind: "admitted"; identity: AdmittedIdentity }
  | { kind: "refused"; refusal: AdmissionRefusal }

export type SourceCheckoutAdmissionResult =
  | { kind: "admitted"; identity: AdmittedSourceCheckoutIdentity }
  | { kind: "refused"; refusal: SourceCheckoutAdmissionRefusal }

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
  /**
   * Admits the physical source-checkout profile only after repository,
   * provenance, source-pin, and package-pin checks, in that refusal order.
   * The accepted package pin must be the full lowercase 40-hex source commit.
   * An admitted result is a detached, deeply frozen identity containing only
   * the source-checkout profile, source, and package observations.
   */
  admitSourceCheckout(request: SourceCheckoutAdmissionRequest): SourceCheckoutAdmissionResult
}

export declare const admissionBootstrap: AdmissionBootstrap
