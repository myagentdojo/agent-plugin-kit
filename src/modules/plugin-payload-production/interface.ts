import type { SourceIdentity } from "../release-and-git-engine/interface"

export type PayloadProductionRequest = {
  repositoryRoot: string
  mode: "check" | "materialize" | "package"
  sourceIdentity?: SourceIdentity
}

export type PreparedPluginPayload = {
  regularFiles: readonly string[]
  payloadSha256: `sha256:${string}`
}

export type PayloadProductionResult = {
  kind: "checked" | "materialized" | "packaged" | "refused"
  payload?: PreparedPluginPayload
  nextAction: string
}

export interface PluginPayloadProduction {
  produce(request: PayloadProductionRequest): Promise<PayloadProductionResult>
}
