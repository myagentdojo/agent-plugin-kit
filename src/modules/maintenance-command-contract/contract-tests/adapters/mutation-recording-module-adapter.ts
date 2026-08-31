import { createHash } from "node:crypto"
import type {
  CommandPreview,
  CommandResult,
  MaintenanceApplyRequest,
  MaintenanceCommand,
  MaintenanceCommandCollaborators,
  MaintenanceCommands,
  MaintenanceOutcome,
} from "../../interface"
import { createMaintenanceCommands } from "../../implementation/maintenance-commands"

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

type ClaudeRequest = Extract<
  MaintenanceCommand,
  { command: "harness:claude:inspect" }
>["request"]
type CodexRequest = Extract<
  MaintenanceCommand,
  { command: "harness:codex:inspect" }
>["request"]
type ClaudeTransitionRequest = Extract<
  MaintenanceApplyRequest,
  { command: "harness:claude:apply" }
>["request"]
type CodexTransitionRequest = Extract<
  MaintenanceApplyRequest,
  { command: "harness:codex:apply" }
>["request"]
type ClaudeTransitionApproval = Extract<
  MaintenanceApplyRequest,
  { command: "harness:claude:apply" }
>["approval"]
type CodexTransitionApproval = Extract<
  MaintenanceApplyRequest,
  { command: "harness:codex:apply" }
>["approval"]
type ClaudeInspection = {
  candidate: ClaudeRequest["identity"]
  profileIdentity: string
  expectedEffectIds: readonly string[]
}
type CodexInspection = ClaudeInspection & { checkoutIdentity: string }
type ClaudeApplyResult = {
  completedEffectIds: readonly string[]
  remainingEffectIds: readonly string[]
}
type CodexApplyResult = ClaudeApplyResult & { freshTaskCommand: readonly string[] }

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
  const runtimeControls = [...(options.runtimeControls ?? [{
    code: "REPAIR_PREVIEW",
    schemaVersion: 1,
    state: { before: "missing" },
  }])]
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
  }

  const payload: MaintenanceCommandCollaborators["payload"] = {
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

  const runtime: MaintenanceCommandCollaborators["runtime"] = {
    async invoke(argv) {
      if (argv.length === 1) return testCollaborators.invokeRuntime(argv)
      testCollaborators.recordRuntimeSpawn(argv)
      return { code: "REPAIR_APPLIED", schemaVersion: 1, state: { before: "missing" } }
    },
  }

  const release: MaintenanceCommandCollaborators["release"] = {
    async inspect(request) {
      return { candidate: request.candidate, expectedEffectIds: ["effect:release"], approvalDigest: "sha256:fixture" }
    },
    async apply(request, approval) {
      testCollaborators.recordApply("release", { command: "release:apply", request, approval })
      return { candidate: request.candidate, completedEffectIds: request.expectedEffectIds, remainingEffectIds: [] }
    },
  }

  function inspectHarness(request: ClaudeRequest): Promise<ClaudeInspection>
  function inspectHarness(request: CodexRequest): Promise<CodexInspection>
  async function inspectHarness(request: ClaudeRequest | CodexRequest): Promise<ClaudeInspection | CodexInspection> {
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

  const harness: MaintenanceCommandCollaborators["harness"] = {
    inspect: inspectHarness,
    apply: applyHarness,
  }

  const canary: MaintenanceCommandCollaborators["canary"] = {
    async inspect(candidate) {
      return { candidate: candidate.identity, target: "fixture", immutableReference: "fixture" }
    },
    async qualify(candidate, _authority) {
      testCollaborators.recordApply("canary", { command: "canary:qualify", candidate, authority: _authority })
      return { candidate: candidate.identity, hostedRunId: "fixture", installedPayloadSha256: candidate.inertPayloadSha256 }
    },
  }

  const assembled: MaintenanceCommandCollaborators = { payload, runtime, release, harness, canary }
  const commands = assemble?.(testCollaborators) ?? createMaintenanceCommands(assembled)

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
