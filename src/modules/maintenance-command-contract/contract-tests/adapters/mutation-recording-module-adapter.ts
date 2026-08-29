import { createHash } from "node:crypto"
import type {
  CommandPreview,
  CommandResult,
  MaintenanceApplyRequest,
  MaintenanceCommand,
  MaintenanceCommands,
  MaintenanceOutcome,
} from "../../interface"

export type MaintenanceContractHarness = {
  readonly commands: MaintenanceCommands | undefined
  readonly applyLedgers: Readonly<Record<string, MaintenanceApplyRequest[]>>
  readonly runtimeSpawnLedger: RuntimeSpawnRecord[]
  durableDigest(): string
  inspect(command: MaintenanceCommand): Promise<MaintenanceOutcome<CommandPreview> | undefined>
  apply(request: MaintenanceApplyRequest): Promise<MaintenanceOutcome<CommandResult> | undefined>
}

export type MaintenanceTestCollaborators = {
  recordApply(owner: string, request: MaintenanceApplyRequest): void
  recordRuntimeSpawn(argv: readonly string[], control?: RuntimeControlObservation): void
  invokeRuntime(argv: readonly string[]): RuntimeControlObservation
  readDurableTargets(): Readonly<Record<string, string>>
  mutateDurableTarget(target: string, value: string): void
}

export type RuntimeControlObservation = {
  code: "REPAIR_PREVIEW" | "REPAIR_UNNEEDED" | "USAGE" | "INVALID_CONTROL"
  schemaVersion: 1
  state?: { before: "valid" | "missing" | "corrupt" }
}

export type RuntimeSpawnRecord = {
  argv: readonly string[]
  control: RuntimeControlObservation | null
}

export function createMaintenanceContractHarness(
  assemble?: (collaborators: MaintenanceTestCollaborators) => MaintenanceCommands,
  options: { runtimeControls?: readonly RuntimeControlObservation[] } = {},
): MaintenanceContractHarness {
  const applyLedgers: Record<string, MaintenanceApplyRequest[]> = {
    payload: [],
    release: [],
    claude: [],
    codex: [],
    canary: [],
  }
  const runtimeSpawnLedger: RuntimeSpawnRecord[] = []
  const runtimeControls = [...(options.runtimeControls ?? [])]
  const durableTargets: Record<string, string> = {
    repository: "unchanged",
    profile: "unchanged",
  }
  const commands = assemble?.({
    recordApply(owner, request) {
      const ledger = applyLedgers[owner]
      if (!ledger) throw new Error(`unknown test collaborator ${owner}`)
      ledger.push(request)
    },
    recordRuntimeSpawn(argv, control) {
      runtimeSpawnLedger.push({ argv: [...argv], control: control ?? null })
    },
    invokeRuntime(argv) {
      const control = runtimeControls.shift()
      if (!control) throw new Error(`missing Runtime control fixture for ${argv.join(" ")}`)
      runtimeSpawnLedger.push({ argv: [...argv], control })
      return control
    },
    readDurableTargets() {
      return { ...durableTargets }
    },
    mutateDurableTarget(target, value) {
      durableTargets[target] = value
    },
  })

  return {
    commands,
    applyLedgers,
    runtimeSpawnLedger,
    durableDigest() {
      return createHash("sha256")
        .update(JSON.stringify(durableTargets))
        .digest("hex")
    },
    inspect: async (command) => commands?.inspect(command),
    apply: async (request) => commands?.apply(request),
  }
}
