import {
  installedFoundation,
  type ProcessObservation,
} from "./installed-foundation-contract-subject"

export type InstalledMaintenanceCliObservation = {
  observations: readonly ProcessObservation[]
  importedFiles: readonly string[]
  cwd: string
  installedFiles: readonly string[]
  externalDependencyPerturbationRefused: boolean
  externalDependencyBaselineRestored: boolean
  escapedRuntimePerturbationRefused: boolean
  escapedRuntimeBaselineRestored: boolean
  nonJavaScriptRuntimePerturbationRefused: boolean
  nonJavaScriptRuntimeBaselineRestored: boolean
  stationMap: Readonly<Record<string, unknown>>
}

export const installedMaintenanceCliSubject: InstalledMaintenanceCliObservation =
  installedFoundation.installedMaintenanceCli
