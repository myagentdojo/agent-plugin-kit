import type {
  CommandPreview,
  CommandResult,
  MaintenanceApplyRequest,
  MaintenanceCommand,
  MaintenanceCommands,
} from "../../interface"

export type MaintenanceContractHarness = {
  readonly commands: MaintenanceCommands | undefined
  readonly applyLedgers: Readonly<Record<string, MaintenanceApplyRequest[]>>
  readonly runtimeSpawnLedger: (readonly string[])[]
  durableDigest(): string
  inspect(command: MaintenanceCommand): Promise<CommandPreview | undefined>
  apply(request: MaintenanceApplyRequest): Promise<CommandResult | undefined>
}

export type MaintenanceTestCollaborators = {
  recordApply(owner: string, request: MaintenanceApplyRequest): void
  recordRuntimeSpawn(argv: readonly string[]): void
  readDurableTargets(): Readonly<Record<string, string>>
  mutateDurableTarget(target: string, value: string): void
}

type MaintenanceTestAssembly = (
  collaborators: MaintenanceTestCollaborators,
) => MaintenanceCommands

export function createMaintenanceContractHarness(
  assemble?: MaintenanceTestAssembly,
): MaintenanceContractHarness {
  const applyLedgers: Record<string, MaintenanceApplyRequest[]> = {
    payload: [],
    release: [],
    claude: [],
    codex: [],
    canary: [],
  }
  const runtimeSpawnLedger: (readonly string[])[] = []
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
    recordRuntimeSpawn(argv) {
      runtimeSpawnLedger.push([...argv])
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
import { createHash } from "node:crypto"
