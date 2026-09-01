import { createHash } from "node:crypto"
import {
  installedFoundation,
  installedProcessObservationFor,
} from "./installed-foundation-contract-subject"

export type InstalledPackageObservation = {
  rootTypeExports: readonly string[]
  rootRuntimeExports: readonly string[]
  publicSubpaths: readonly string[]
  subpathTypeExports: Readonly<Record<string, readonly string[]>>
  subpathRuntimeExports: Readonly<Record<string, readonly string[]>>
  regularFiles: readonly string[]
  sourceCommit: string
  remoteCommit: string
  resolvedCommit: string
  lockfileSha256: `sha256:${string}`
  publicTypeResolution: {
    readonly exitCode: number
    readonly stdout: string
    readonly stderr: string
  }
  fixtureEnvironmentKeys: readonly string[]
  fixtureSensitiveEnvironmentKeys: readonly string[]
  lifecycleScriptLedger: readonly string[]
  installedBytesSha256: `sha256:${string}`
  installedInventoryPerturbationControl: typeof installedFoundation.installedPackage.installedInventoryPerturbationControl
  outsideRepository: boolean
  fixtureRemoved: boolean
  qualificationRuntimeTargetPerturbationRefused: boolean
  admittedExecutionOrder: typeof installedFoundation.installedPackage.admittedExecutionOrder
  admissionRefusalControl: typeof installedFoundation.installedPackage.admissionRefusalControl
  publicSurfacePerturbationControl: typeof installedFoundation.installedPackage.publicSurfacePerturbationControl
  qualificationInputBindings: typeof installedFoundation.installedPackage.qualificationInputBindings
  processTimeoutControl: typeof installedFoundation.installedPackage.processTimeoutControl
}

const admissionDurableBytes = new TextEncoder().encode("clean-fixture:unchanged\n")
export const admissionDurableDigest = () =>
  createHash("sha256").update(admissionDurableBytes).digest("hex")
export const installedAdmission = installedFoundation.admission
export const installedPersonalQualification = installedFoundation.personalQualification
export const installedPublicQualification = installedFoundation.publicQualification
export const installedPackage: InstalledPackageObservation = installedFoundation.installedPackage

export async function invokeMaintenanceProcess(argv: readonly string[]) {
  return installedProcessObservationFor(argv)
}

export const hostedEffectLedger: string[] = []
export const nativeObservationLedger: string[] = []
