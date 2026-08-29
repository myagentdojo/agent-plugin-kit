import { createHash } from "node:crypto"
import { admissionBootstrap } from "../../implementation/admission-bootstrap"
import type { AdmissionBootstrap } from "../../interface"

export function createAdmissionContractHarness(
  assemble?: (environment: { maintenanceState: Uint8Array }) => AdmissionBootstrap,
) {
  const durableBytes = new TextEncoder().encode("maintenance-state:unchanged\n")
  const environment = {
    maintenanceState: durableBytes,
  }
  const bootstrap = assemble?.(environment) ?? admissionBootstrap

  return {
    bootstrap,
    durableDigest() {
      return createHash("sha256").update(durableBytes).digest("hex")
    },
  }
}
