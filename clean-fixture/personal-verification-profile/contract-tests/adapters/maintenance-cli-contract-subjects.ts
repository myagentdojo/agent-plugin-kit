import type { ProcessObservation } from "../../../../src/adapters/maintenance-command-facade/interface"
import { installedFoundation } from "./installed-foundation-contract-subject"

export type InstalledMaintenanceCliObservation = {
  observations: readonly ProcessObservation[]
  importedFiles: readonly string[]
  cwd: string
  installedFiles: readonly string[]
  stationMap: Readonly<Record<string, unknown>>
}

export type LocalLinkContractSubject = {
  invokeFourPublicExecutions(): Promise<readonly ProcessObservation[]>
  cleanupLedger: readonly string[]
  parentModes: readonly number[]
  preflightDestinations: readonly string[]
  linkIdentities: readonly [
    { kind: "package"; rawTargetRole: "kit-root"; canonicalTargetRole: "kit-root" },
    { kind: "binary"; rawTargetRole: "maintenance-shell"; canonicalTargetRole: "maintenance-shell" },
  ]
  executable: { shebang: string; mode: number }
  fixedHelpArgv: readonly string[]
  receipt: Readonly<Record<string, unknown>>
  digestsEqual: boolean
}

export const installedMaintenanceCliSubject: InstalledMaintenanceCliObservation =
  installedFoundation.installedMaintenanceCli
export const localLinkContractSubject: LocalLinkContractSubject | undefined = undefined
