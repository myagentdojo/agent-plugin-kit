import type { SourceIdentity } from "../release-and-git-engine/interface"

type Sha256Digest = `sha256:${string}`

export type PayloadProductionRequest = {
  repositoryRoot: string
  mode: "check" | "materialize" | "package"
  sourceIdentity?: SourceIdentity
}

export type PreparedPluginPayload = {
  regularFiles: readonly string[]
  payloadSha256: Sha256Digest
}

export type PayloadProductionResult = {
  kind: "checked" | "materialized" | "packaged" | "refused"
  payload?: PreparedPluginPayload
  nextAction: string
}

export interface PluginPayloadProduction {
  produce(request: PayloadProductionRequest): Promise<PayloadProductionResult>
}
