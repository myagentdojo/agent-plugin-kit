import type { SourceIdentity } from "../release-and-git-engine/interface"

/**
 * The sibling serialized-value validator is the runtime shape boundary for
 * these declarations. The Implementation owns every semantic refusal: path
 * safety, ordering, uniqueness, containment, byte, hash, mode, projection, and
 * binding agreement. A package request is judged only after Source Checkout
 * Admission and trusted binding; Payload performs no Git or environment
 * discovery and reads only the named Plugin Repository.
 */
export type PayloadRelease = {
  name: string
  version: string
  tag: string
}

export type PreparedFileDeclaration = {
  path: string
  bytes: number
  sha256: `sha256:${string}`
  executable: boolean
}

export type PreparedProjectionRole =
  | "config"
  | "runtime-lock"
  | "bundle-inventory"
  | "skill-inventory"
  | "native-manifest"

export type PreparedProjectionDeclaration = {
  role: PreparedProjectionRole
  path: string
  bytes: number
  sha256: `sha256:${string}`
}

/**
 * The sealed preparation declaration. `files` are unique `plugin/`-relative
 * regular files in code-unit order; `projections` are repository-relative
 * inputs ordered by role then path. `payloadSha256` is the length-framed
 * path/body digest over `files`. `bindingSha256` hashes the UTF-8 JSON array
 * `[1, origin, commit, name, version, tag, files, projections, payloadSha256]`
 * without whitespace, where files are `[path, bytes, sha256, executable]`
 * tuples and projections are `[role, path, bytes, sha256]` tuples.
 */
export type PreparedPayloadDeclaration = {
  sourceIdentity: SourceIdentity
  files: readonly PreparedFileDeclaration[]
  projections: readonly PreparedProjectionDeclaration[]
  payloadSha256: `sha256:${string}`
  bindingSha256: `sha256:${string}`
}

export type PayloadCheckRequest = {
  repositoryRoot: string
  mode: "check"
  sourceIdentity?: SourceIdentity
}

export type PayloadMaterializeRequest = {
  repositoryRoot: string
  mode: "materialize"
  sourceIdentity?: SourceIdentity
}

export type PayloadPackageRequest = {
  repositoryRoot: string
  mode: "package"
  sourceIdentity: SourceIdentity
  release: PayloadRelease
  prepared: PreparedPayloadDeclaration
}

export type PayloadProductionRequest =
  | PayloadCheckRequest
  | PayloadMaterializeRequest
  | PayloadPackageRequest

export type PreparedPluginPayload = {
  regularFiles: readonly string[]
  payloadSha256: `sha256:${string}`
}

export type PayloadArtifactRecord = {
  path: string
  bytes: number
  sha256: `sha256:${string}`
}

export type PayloadArtifacts = {
  archive: PayloadArtifactRecord
  checksums: PayloadArtifactRecord
}

/** Refusals name invalid input or an output conflict and publish nothing. */
export type PayloadRefusalCode =
  | "mode-deferred"
  | "repository-root-invalid"
  | "payload-root-invalid"
  | "source-identity-mismatch"
  | "release-invalid"
  | "declaration-invalid"
  | "binding-mismatch"
  | "payload-digest-mismatch"
  | "unsafe-entry"
  | "undeclared-file"
  | "declared-file-missing"
  | "file-mismatch"
  | "projection-mismatch"
  | "output-conflict"

/** Failures report the publication state actually observed. */
export type PayloadFailureCode =
  | "staging-failed"
  | "compressor-failed"
  | "compressor-deadline"
  | "publication-interrupted"
  | "publication-unobservable"

export type PayloadPublicationState = "none" | "archive-only" | "unknown"

export type PayloadProductionResult =
  | { kind: "checked"; payload?: PreparedPluginPayload; nextAction: string }
  | { kind: "materialized"; payload?: PreparedPluginPayload; nextAction: string }
  | {
      kind: "packaged"
      sourceIdentity: SourceIdentity
      release: PayloadRelease
      bindingSha256: `sha256:${string}`
      payload: PreparedPluginPayload
      artifacts: PayloadArtifacts
      nextAction: string
    }
  | { kind: "refused"; code: PayloadRefusalCode; detail: string; nextAction: string }
  | {
      kind: "failed"
      code: PayloadFailureCode
      publication: PayloadPublicationState
      transient: boolean
      artifacts: { archive: PayloadArtifactRecord | null; checksums: PayloadArtifactRecord | null }
      nextAction: string
    }

/**
 * Package mode validates the declaration against the actual `plugin/` tree,
 * snapshots the bytes once, rechecks them before publication, builds the
 * canonical USTAR/gzip archive and checksum document under `<root>/dist/`,
 * publishes with no-replace operations (archive first, checksums last), and
 * rereads both artifacts before reporting `packaged`. Identical existing
 * output is reused and an exact archive-only state is completed; any other
 * existing output is preserved and refused. Check and materialize are
 * deferred and return `refused` with `mode-deferred`.
 */
export interface PluginPayloadProduction {
  produce(request: PayloadProductionRequest): Promise<PayloadProductionResult>
}
