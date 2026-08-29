import type { MaintenanceCommands } from "agent-plugin-kit/maintenance-command-contract"
import type { QualificationEvidence } from "agent-plugin-kit/qualification-evidence"
import { createHash } from "node:crypto"

export type InstalledPackageObservation = {
  rootTypeExports: readonly string[]
  publicSubpaths: readonly string[]
  subpathTypeExports: Readonly<Record<string, readonly string[]>>
  regularFiles: readonly string[]
  resolvedCommit: string
  lifecycleScriptLedger: readonly string[]
  installedBytesSha256: `sha256:${string}`
}

const admissionDurableBytes = new TextEncoder().encode("clean-fixture:unchanged\n")
export const admissionDurableDigest = () =>
  createHash("sha256").update(admissionDurableBytes).digest("hex")
export const maintenanceCommands: MaintenanceCommands | undefined = undefined
export const qualificationEvidence: QualificationEvidence | undefined = undefined
export const installedPackage: InstalledPackageObservation | undefined = undefined
const maintenanceExecutable: string | undefined = undefined

export async function invokeMaintenanceProcess(argv: readonly string[]) {
  if (!maintenanceExecutable) return undefined
  const child = Bun.spawn([maintenanceExecutable, ...argv], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}

export const hostedEffectLedger: string[] = []
export const nativeObservationLedger: string[] = []
