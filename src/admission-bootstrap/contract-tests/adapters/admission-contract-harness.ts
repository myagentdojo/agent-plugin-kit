import { createHash } from "node:crypto"
import type { AdmissionBootstrap } from "../../interface"

type AdmissionTestEnvironment = {
  maintenanceState: Uint8Array
}

type AdmissionTestAssembly = (
  environment: AdmissionTestEnvironment,
) => AdmissionBootstrap

export function createAdmissionContractHarness(assemble?: AdmissionTestAssembly) {
  const durableBytes = new TextEncoder().encode("maintenance-state:unchanged\n")
  const environment: AdmissionTestEnvironment = {
    maintenanceState: durableBytes,
  }
  const bootstrap = assemble?.(environment)

  return {
    bootstrap,
    durableDigest() {
      return createHash("sha256").update(durableBytes).digest("hex")
    },
  }
}
