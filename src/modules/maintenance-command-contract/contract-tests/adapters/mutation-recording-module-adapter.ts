import { createHash } from "node:crypto"
import type {
  CommandPreview,
  CommandResult,
  MaintenanceApplyRequest,
  MaintenanceCommand,
  MaintenanceCommands,
  MaintenanceOutcome,
} from "../../interface"
import type { CanaryQualification } from "../../../canary-qualification/interface"
import type {
  ClaudeApplyResult,
  ClaudeInspection,
  ClaudeRequest,
  ClaudeTransitionApproval,
  ClaudeTransitionRequest,
  CodexApplyResult,
  CodexInspection,
  CodexRequest,
  CodexTransitionApproval,
  CodexTransitionRequest,
  HarnessJourneys,
} from "../../../harness-journeys/interface"
import type { PluginPayloadProduction } from "../../../plugin-payload-production/interface"
import type {
  ReleaseAndGitEngine,
  ReleaseResult,
} from "../../../release-and-git-engine/interface"
import type { RuntimeCustodyResult } from "../../../runtime-custody/interface"
import {
  createMaintenanceCommands,
  type MaintenanceCommandDependencies,
  type MaintenanceInspectionInput,
} from "../../implementation/maintenance-commands"

export type MaintenanceContractHarness = {
  readonly commands: MaintenanceCommands
  readonly applyLedgers: Readonly<Record<string, MaintenanceApplyRequest[]>>
  readonly runtimeSpawnLedger: RuntimeSpawnRecord[]
  readonly ownerInspectionLedger: readonly unknown[]
  /**
   * Every object the Implementation handed to an inspection handler, observed
   * through the owner-local pre-handler seam. It is the stripped object itself,
   * not a collaborator's view of it, so protected-input stripping is observable
   * even for a command whose owner never sees the outer request.
   */
  readonly inspectionInputLedger: readonly MaintenanceInspectionInput[]
  durableDigest(): string
  inspect(command: MaintenanceCommand): Promise<MaintenanceOutcome<CommandPreview>>
  apply(request: MaintenanceApplyRequest): Promise<MaintenanceOutcome<CommandResult>>
}

// fallow-ignore-next-line unused-type -- exported test collaborator contract is intentionally used by the harness annotation
export type MaintenanceTestCollaborators = {
  recordApply(owner: string, request: MaintenanceApplyRequest): void
  invokeRuntime(argv: readonly string[]): RuntimeCustodyResult
  readDurableTargets(): Readonly<Record<string, string>>
  mutateDurableTarget(target: string, value: string): void
}

export type RuntimeSpawnRecord = {
  argv: readonly string[]
  result: RuntimeCustodyResult
}

export function runtimeControl(
  code: Extract<RuntimeCustodyResult, { kind: "control" }>["control"]["code"],
  options: {
    ok?: boolean
    sideEffects?: readonly [] | readonly ["published-runtime"]
    exitClass?: 0 | 2 | 20 | 21 | 22 | 23
    state?: { before: "valid" | "missing" | "corrupt" }
    stderr?: string
  } = {},
): RuntimeCustodyResult {
  return {
    kind: "control",
    control: {
      schemaVersion: 1,
      ok: options.ok ?? (options.exitClass === undefined || options.exitClass === 0),
      code,
      sideEffects: options.sideEffects ?? [],
      retrySafe: code === "REPAIR_PREVIEW" || code === "REPAIR_UNNEEDED",
      nextAction: "Inspect the Runtime Custody result.",
      ...(options.state === undefined ? {} : { state: options.state }),
    },
    stderr: options.stderr ?? "",
    exitClass: options.exitClass ?? 0,
  }
}

export function createMaintenanceContractHarness(
  options: {
    runtimeResults?: readonly RuntimeCustodyResult[]
    releaseResult?: ReleaseResult
  } = {},
): MaintenanceContractHarness {
  const applyLedgers: Record<string, MaintenanceApplyRequest[]> = {
    payload: [],
    release: [],
    claude: [],
    codex: [],
    canary: [],
  }
  const runtimeSpawnLedger: RuntimeSpawnRecord[] = []
  const ownerInspectionLedger: unknown[] = []
  const inspectionInputLedger: MaintenanceInspectionInput[] = []
  const runtimeResults = [...(options.runtimeResults ?? [
    runtimeControl("REPAIR_PREVIEW", { state: { before: "missing" } }),
    runtimeControl("REPAIR_APPLIED", {
      sideEffects: ["published-runtime"],
    }),
  ])]
  const durableTargets: Record<string, string> = {
    repository: "unchanged",
    profile: "unchanged",
  }
  const testCollaborators: MaintenanceTestCollaborators = {
    recordApply(owner, request) {
      const ledger = applyLedgers[owner]
      if (!ledger) throw new Error(`unknown test collaborator ${owner}`)
      ledger.push(request)
    },
    invokeRuntime(argv) {
      const result = runtimeResults.shift()
      if (!result) throw new Error(`missing Runtime result fixture for ${argv.join(" ")}`)
      runtimeSpawnLedger.push({ argv: [...argv], result })
      return result
    },
    readDurableTargets() {
      return { ...durableTargets }
    },
    mutateDurableTarget(target, value) {
      durableTargets[target] = value
    },
  }

  const payload: PluginPayloadProduction = {
    async produce(request) {
      if (request.mode === "check") return { kind: "checked", nextAction: "Inspect the payload." }
      if (request.mode === "materialize") {
        const ownerRequest = { ...request, mode: "materialize" as const }
        testCollaborators.recordApply("payload", { command: "payload:materialize", request: ownerRequest })
        testCollaborators.mutateDurableTarget("repository", request.mode)
        return { kind: "materialized", nextAction: "Inspect the payload." }
      }
      const ownerRequest = { ...request, mode: "package" as const }
      testCollaborators.recordApply("payload", { command: "payload:package", request: ownerRequest })
      testCollaborators.mutateDurableTarget("profile", request.mode)
      return { kind: "packaged", nextAction: "Inspect the payload." }
    },
  }

  const runtime: MaintenanceCommandDependencies["runtime"] = async (argv) =>
    testCollaborators.invokeRuntime(argv)

  const release: ReleaseAndGitEngine = {
    async inspect(request) {
      ownerInspectionLedger.push(request)
      return { candidate: request.candidate, expectedEffectIds: ["effect:release"], approvalDigest: "sha256:fixture" }
    },
    async apply(request, approval) {
      testCollaborators.recordApply("release", { command: "release:apply", request, approval })
      return options.releaseResult ?? {
        candidate: request.candidate,
        completedEffectIds: request.expectedEffectIds,
        remainingEffectIds: [],
      }
    },
  }

  function inspectHarness(request: ClaudeRequest): Promise<ClaudeInspection>
  function inspectHarness(request: CodexRequest): Promise<CodexInspection>
  async function inspectHarness(request: ClaudeRequest | CodexRequest): Promise<ClaudeInspection | CodexInspection> {
    ownerInspectionLedger.push(request)
    return "checkoutIdentity" in request
      ? { candidate: request.identity, profileIdentity: request.profileIdentity, expectedEffectIds: ["effect:codex"], checkoutIdentity: request.checkoutIdentity }
      : { candidate: request.identity, profileIdentity: request.profileIdentity, expectedEffectIds: ["effect:claude"] }
  }

  function applyHarness(request: ClaudeTransitionRequest, approval: ClaudeTransitionApproval): Promise<ClaudeApplyResult>
  function applyHarness(request: CodexTransitionRequest, approval: CodexTransitionApproval): Promise<CodexApplyResult>
  async function applyHarness(
    request: ClaudeTransitionRequest | CodexTransitionRequest,
    approval: ClaudeTransitionApproval | CodexTransitionApproval,
  ): Promise<ClaudeApplyResult | CodexApplyResult> {
    if ("checkoutIdentity" in request) {
      if (approval.issuer !== "harness-journeys:codex") throw new Error("unexpected Codex approval issuer")
      testCollaborators.recordApply("codex", { command: "harness:codex:apply", request, approval })
      return { completedEffectIds: request.expectedEffectIds, remainingEffectIds: [], freshTaskCommand: ["task"] }
    }
    if (approval.issuer !== "harness-journeys:claude") throw new Error("unexpected Claude approval issuer")
    testCollaborators.recordApply("claude", { command: "harness:claude:apply", request, approval })
    return { completedEffectIds: request.expectedEffectIds, remainingEffectIds: [] }
  }

  const harness: HarnessJourneys = {
    inspect: inspectHarness,
    apply: applyHarness,
  }

  const canary: CanaryQualification = {
    async inspect(candidate) {
      ownerInspectionLedger.push(candidate)
      return { candidate: candidate.identity, target: "fixture", immutableReference: "fixture" }
    },
    async qualify(candidate, _authority) {
      testCollaborators.recordApply("canary", { command: "canary:qualify", candidate, authority: _authority })
      return { candidate: candidate.identity, hostedRunId: "fixture", installedPayloadSha256: candidate.inertPayloadSha256 }
    },
  }

  const assembled: MaintenanceCommandDependencies = { payload, runtime, release, harness, canary }
  const commands = createMaintenanceCommands(assembled, (input) => {
    inspectionInputLedger.push(input)
  })

  return {
    commands,
    applyLedgers,
    runtimeSpawnLedger,
    ownerInspectionLedger,
    inspectionInputLedger,
    durableDigest() {
      return createHash("sha256")
        .update(JSON.stringify(durableTargets))
        .digest("hex")
    },
    inspect: async (command) => commands.inspect(command),
    apply: async (request) => commands.apply(request),
  }
}
