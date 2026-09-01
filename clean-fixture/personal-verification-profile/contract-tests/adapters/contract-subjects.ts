import { createHash } from "node:crypto"
import {
  installedFoundation,
  installedProcessObservationFor,
} from "./installed-foundation-contract-subject"

export type InstalledPackageObservation = {
  rootTypeExports: readonly string[]
  publicSubpaths: readonly string[]
  subpathTypeExports: Readonly<Record<string, readonly string[]>>
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
  rootRuntimeExports: readonly string[]
  outsideRepository: boolean
  fixtureRemoved: boolean
  qualificationRuntimeTargetPerturbationRefused: boolean
}

const admissionDurableBytes = new TextEncoder().encode("clean-fixture:unchanged\n")
export const admissionDurableDigest = () =>
  createHash("sha256").update(admissionDurableBytes).digest("hex")
export const installedAdmission = installedFoundation.admission
export const installedPersonalQualification = installedFoundation.personalQualification
export const installedPublicQualification = installedFoundation.publicQualification
export const installedPackage: InstalledPackageObservation = installedFoundation.installedPackage

export async function invokeMaintenanceProcess(argv: readonly string[]) {
  if (installedAdmission.kind !== "admitted") return undefined
  return installedProcessObservationFor(argv)
}

export const hostedEffectLedger: string[] = []
export const nativeObservationLedger: string[] = []
