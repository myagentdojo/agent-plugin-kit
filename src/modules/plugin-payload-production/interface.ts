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

export type PayloadCategory =
  | "Productivity"
  | "Creativity"
  | "Developer Tools"
  | "Business & Operations"
  | "Data & Analytics"
  | "Communication"
  | "Education & Research"
  | "Security"
  | "Finance"
  | "Healthcare"
  | "Travel"
  | "Entertainment"
  | "Other"

export type PayloadHookDependence = "hook-dependent" | "hook-independent"

export type PluginPayloadMetadata = {
  readonly name: string
  readonly displayName: string
  readonly version: string
  readonly description: string
  readonly author: { readonly name: string }
  readonly repository: string
  readonly license: string
  readonly keywords: readonly string[]
  readonly category: PayloadCategory
  readonly shortDescription: string
  readonly longDescription: string
  readonly capabilities: readonly string[]
  readonly defaultPrompts: readonly string[]
  readonly brandColor: `#${string}`
  readonly composerIcon: string
  readonly logo: string
  readonly hookDeclarationPaths: readonly string[]
}

export type PayloadSkillProduction =
  | { readonly kind: "model-only" }
  | { readonly kind: "workspace"; readonly workspacePath: string; readonly entryPath: string }
  | { readonly kind: "prepared"; readonly entryPath: string }

export type PluginPayloadSkillConfiguration = {
  readonly id: string
  readonly hookDependence: PayloadHookDependence
  readonly production: PayloadSkillProduction
}

export type PluginPayloadConfiguration = {
  readonly plugin: PluginPayloadMetadata
  readonly skills: readonly PluginPayloadSkillConfiguration[]
}

export type PayloadSourceProjectionPaths = {
  readonly config: string
  readonly runtimeLock: string
  readonly skillInventory: string
}

export type PayloadCheckRequest = {
  readonly repositoryRoot: string
  mode: "check"
  readonly configuration: PluginPayloadConfiguration
  readonly sourceProjectionPaths: PayloadSourceProjectionPaths
}

export type PayloadMaterializeRequest = {
  readonly repositoryRoot: string
  mode: "materialize"
  readonly configuration: PluginPayloadConfiguration
  readonly sourceProjectionPaths: PayloadSourceProjectionPaths
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

export type PreparedPayloadCandidate = {
  readonly files: readonly PreparedFileDeclaration[]
  readonly projections: readonly PreparedProjectionDeclaration[]
  readonly ownedFiles: readonly PreparedFileDeclaration[]
  readonly payloadSha256: `sha256:${string}`
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
  | "configuration-invalid"
  | "dependency-refused"
  | "bundle-refused"
  | "payload-outdated"
  | "inventory-invalid"

export type PayloadRefusal =
  | {
      readonly kind: "refused"
      readonly code: Exclude<PayloadRefusalCode, "payload-outdated">
      readonly detail: string
      readonly nextAction: string
    }
  | {
      readonly kind: "refused"
      readonly code: "payload-outdated"
      readonly paths: readonly string[]
      readonly detail: string
      readonly nextAction: string
    }

/** Failures report the publication state actually observed. */
export type PayloadFailureCode =
  | "staging-failed"
  | "compressor-failed"
  | "compressor-deadline"
  | "publication-interrupted"
  | "publication-unobservable"

export type PayloadPublicationState = "none" | "archive-only" | "unknown"

export type MaterializationFailure =
  | {
      readonly kind: "materialization-failed"
      readonly code: "materialization-staging-failed" | "materialization-interrupted" | "materialization-verification-failed"
      readonly state: "none"
      readonly transient: boolean
      readonly changedPaths: readonly []
      readonly remainingPaths: readonly string[]
      readonly nextAction: string
    }
  | {
      readonly kind: "materialization-failed"
      readonly code: "materialization-interrupted" | "materialization-verification-failed"
      readonly state: "partial"
      readonly transient: false
      readonly changedPaths: readonly [string, ...string[]]
      readonly remainingPaths: readonly string[]
      readonly nextAction: string
    }
  | {
      readonly kind: "materialization-failed"
      readonly code: "materialization-state-unobservable"
      readonly state: "unknown"
      readonly transient: false
      readonly changedPaths: null
      readonly remainingPaths: null
      readonly nextAction: string
    }

export type PayloadCheckResult =
  | { readonly kind: "checked"; readonly candidate: PreparedPayloadCandidate; readonly nextAction: string }
  | PayloadRefusal

export type PayloadMaterializeResult =
  | {
      readonly kind: "materialized"
      readonly candidate: PreparedPayloadCandidate
      readonly changedPaths: readonly string[]
      readonly removedPaths: readonly string[]
      readonly unchangedPaths: readonly string[]
      readonly nextAction: string
    }
  | PayloadRefusal
  | MaterializationFailure

export type PayloadProductionResult =
  | PayloadCheckResult
  | PayloadMaterializeResult
  | {
      kind: "packaged"
      sourceIdentity: SourceIdentity
      release: PayloadRelease
      bindingSha256: `sha256:${string}`
      payload: PreparedPluginPayload
      artifacts: PayloadArtifacts
      nextAction: string
    }
  | PayloadRefusal
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
 * existing output is preserved and refused. Check and materialize construct
 * and, respectively, inspect or publish a complete normalized payload
 * candidate.
 */
export interface PluginPayloadProduction {
  produce(request: PayloadProductionRequest): Promise<PayloadProductionResult>
}
