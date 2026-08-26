import { createHash } from "node:crypto"
import type { AdmissionBootstrap } from "../../interface"

type AdmissionTestEnvironment = {
  observeImport(owner: string): void
  maintenanceState: Uint8Array
}

type AdmissionTestAssembly = (
  environment: AdmissionTestEnvironment,
) => AdmissionBootstrap

export function createAdmissionContractHarness(assemble?: AdmissionTestAssembly) {
  const importedOwners: string[] = []
  const durableBytes = new TextEncoder().encode("maintenance-state:unchanged\n")
  const environment: AdmissionTestEnvironment = {
    observeImport: (owner) => importedOwners.push(owner),
    maintenanceState: durableBytes,
  }
  const bootstrap = assemble?.(environment)

  return {
    bootstrap,
    importedOwners,
    durableDigest() {
      return createHash("sha256").update(durableBytes).digest("hex")
    },
  }
}
