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
  admit(request: AdmissionRequest): AdmissionResult
}

export { admissionBootstrap } from "./implementation/admission-bootstrap"
