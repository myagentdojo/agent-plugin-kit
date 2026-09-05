---
status: accepted
amends:
  - 0007-source-checkout-admission.md
  - 0008-package-prepared-plugin-payload.md
---

# Complete Plugin Payload Check and Materialize Through One Deep Interface

## Context and Problem

Plugin Payload Production already owns package mode behind
`PluginPayloadProduction.produce`. Its check and materialize modes are public
but deliberately return `mode-deferred`. My Second Brain still owns generic
configuration projection, skill inventory, dependency admission, bundle
construction, bundle inventory, notices, and payload-closure checks in several
scripts.

Completing P4 requires those generic mechanics to cross one approved Interface
without moving My Second Brain product values, Runtime Custody, native
capability fixtures, Release, GitHub, workflow, or Canary behaviour into the
Kit. The existing consumer source files combine several owners, so copying
`generate.ts`, `plugin-config.ts`, or `build.ts` wholesale would preserve the
wrong seams.

Nathan accepted the one-deep-seam direction and this exact Interface and Test
Design on 4 September 2026. This record binds implementation to those accepted
details.

## Decision Drivers

- One caller action must validate or produce one complete generic Plugin
  Payload candidate.
- Product values remain caller-owned and cross the Interface as data.
- Check is read-only and materialize is repository-local, deterministic, and
  safely repeatable.
- Configuration, dependency, bundle, inventory, notice, and payload agreement
  must be enforced by one owner.
- Runtime Custody inputs may inform payload production without transferring
  Runtime acquisition, repair, cache, launcher, or platform ownership.
- Package mode and its accepted no-replace publication contract remain stable.
- Public-process and Clean Fixture proof must exercise the same Interface used
  by a real Plugin Consumer.
- The design must not add a transaction framework, public substage commands,
  or another repository verifier.

## Considered Options

### A. Caller supplies one normalized payload configuration to existing modes

The caller projects its product and Runtime Custody sources into one strict
value. Check and materialize accept that value through the existing `produce`
Interface. The enclosing Wire Command `schemaVersion: 1` owns its serialized
shape. The Implementation hides rendering, admission, bundling, inventory, and
materialization order.

### B. The Kit discovers consumer-specific source files

The request remains small, but the Kit must learn the consumer's private config
and Runtime Custody file schemas. Moving or renaming those files would then
change the Kit Implementation even when the public payload behaviour did not.

### C. Expose a public command or Interface for every production substage

Callers would coordinate config, dependency, bundle, inventory, and closure
steps. Partial states and ordering would become public compatibility concerns.

## Decision

Choose Option A. Keep one method and the three existing request modes. Extend
check and materialize with a strict `PluginPayloadConfiguration` value. The
serialized-value owner validates it once at CLI ingress and rejects unknown
fields. Internal typed calls do not revalidate it.

### Normalized configuration

`PluginPayloadConfiguration` has two closed sections and no independent
version key. ADR 0004 assigns version authority to the enclosing Wire Command.
Adding configuration to check and materialize, and removing their optional
`sourceIdentity`, does not transition an accepted command input because both
modes are still deferred and have no accepted request shape beyond their mode
and root. Package keeps its already accepted request unchanged.

The two sections are:

- `plugin` carries the generic metadata needed by Claude and Codex marketplace
  and native-manifest projections: name, display name, version, description,
  author name, repository URL, license, keywords, category, short and long
  descriptions, capabilities, default prompts, brand colour, composer icon,
  logo, and `hookDeclarationPaths`: a unique code-unit ordered list of safe
  payload-relative product-authored hook declaration files.
- `skills` is in unique code-unit ID order. Each entry carries its ID, hook
  dependence, and one production form: model-only, a Bun workspace source, or
  an already prepared payload runtime entry. Workspace entries name a confined
  repository-relative workspace and a payload-relative runtime entry. Prepared
  entries name an existing confined payload-relative runtime entry. Launcher
  identity remains owned by Runtime Custody and does not cross this seam.

The `skillInventory` source projection path names the caller-owned product
skill catalog, such as `runtime/skill-catalog.json`. It is distinct from the
generated installed-skill inventory at `plugin/skill-inventory.json` that the
candidate owns.

Template state, Canary repository or actor values, Runtime versions and
platform assets, credentials, Release Identity, Workflow Identity, and Git
state are not configuration fields. A caller may derive the normalized value
from any product-owned source, but the Kit never reads that private source.

Check and materialize no longer accept `sourceIdentity`. They make no Git or
Release claim. Package mode keeps its required Source Identity, Release, and
sealed preparation declaration unchanged.

### Exact Interface amendment

The accepted public Interface amendment must use the public shapes through
`PayloadMaterializeResult` below. The final two types name an
implementation-private fault-injection seam and are not exported by
`interface.ts`. These are the code-owned contract; the vault specification may
point here but must not own a second TypeScript copy.

```ts
type PayloadCategory =
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

type PayloadHookDependence = "hook-dependent" | "hook-independent"

type PluginPayloadMetadata = {
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

type PayloadSkillProduction =
  | { readonly kind: "model-only" }
  | {
      readonly kind: "workspace"
      readonly workspacePath: string
      readonly entryPath: string
    }
  | {
      readonly kind: "prepared"
      readonly entryPath: string
    }

type PluginPayloadSkillConfiguration = {
  readonly id: string
  readonly hookDependence: PayloadHookDependence
  readonly production: PayloadSkillProduction
}

type PluginPayloadConfiguration = {
  readonly plugin: PluginPayloadMetadata
  readonly skills: readonly PluginPayloadSkillConfiguration[]
}

type PayloadSourceProjectionPaths = {
  readonly config: string
  readonly runtimeLock: string
  readonly skillInventory: string
}

type PayloadCheckRequest = {
  readonly repositoryRoot: string
  readonly mode: "check"
  readonly configuration: PluginPayloadConfiguration
  readonly sourceProjectionPaths: PayloadSourceProjectionPaths
}

type PayloadMaterializeRequest = {
  readonly repositoryRoot: string
  readonly mode: "materialize"
  readonly configuration: PluginPayloadConfiguration
  readonly sourceProjectionPaths: PayloadSourceProjectionPaths
}

type PreparedPayloadCandidate = {
  readonly files: readonly PreparedFileDeclaration[]
  readonly projections: readonly PreparedProjectionDeclaration[]
  readonly ownedFiles: readonly PreparedFileDeclaration[]
  readonly payloadSha256: `sha256:${string}`
}

type PayloadRefusalCode =
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

type PayloadRefusal =
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

type MaterializationFailure =
  | {
      readonly kind: "materialization-failed"
      readonly code:
        | "materialization-staging-failed"
        | "materialization-interrupted"
        | "materialization-verification-failed"
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

type PayloadCheckResult =
  | {
      readonly kind: "checked"
      readonly candidate: PreparedPayloadCandidate
      readonly nextAction: string
    }
  | PayloadRefusal

type PayloadMaterializeResult =
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

// Implementation-private test seam; not part of the public Interface.
type PayloadPublicationPoint =
  | "staged"
  | "archive-published"
  | "checksums-published"
  | "materialization-staged"
  | "materialization-file-published"
  | "materialization-inventory-published"
  | "materialization-verified"

type PluginPayloadProductionOptions = {
  readonly interrupt?: (point: PayloadPublicationPoint, path?: string) => void
}
```

`mode-deferred` leaves the union when check and materialize become complete.
`PayloadRefusal` keeps the accepted shape shown above, with one structured
`paths` addition only for payload drift. Package keeps
`PreparedPluginPayload`, `PayloadPackageRequest`, its `packaged` result, and
its `failed` result exactly as accepted. `PreparedPayloadCandidate` is a new
check/materialize declaration and does not change the package result.

`PayloadProductionResult` is the union of `PayloadCheckResult`,
`PayloadMaterializeResult`, and the unchanged package `packaged`, `refused`,
and `failed` variants; `produce` remains the single method returning that
union.

IR01 unknown configuration fields and IR02 a nested `schemaVersion` are
owner-local serialized-ingress validation cases. They are rejected by the
Plugin Payload Production validator before `produce` runs. When either case,
or the legacy root-only check request, crosses the CLI, Maintenance maps it to
the existing `payload-fragment-invalid` Result Code and invalid-input exit
family without raw validation detail. P13 proves that public-process family.
`configuration-invalid` is reserved for a structurally valid configuration
that reaches `produce` and violates an Implementation-owned semantic bound.

The semantic validator applies these exact bounds:

- Supported single-line text is non-empty after trimming and contains no
  character matched by `/[\u0000-\u001F\u007F]/`.
- `name` is kebab case and at most 64 characters.
- `version` is strict SemVer and at most 64 characters.
- `displayName` and `shortDescription` are supported single-line text and at
  most 30 characters. `description` is supported single-line text and at most
  1024 characters. `author.name` is supported single-line text and at most 80
  characters.
- `repository` is a canonical GitHub HTTPS repository URL of at most 2048
  characters, without credentials, port, query, or fragment.
- `license` is at most 64 characters and matches
  `/^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/`.
- `keywords` contains at most 20 unique normalized entries. Each is supported
  single-line text of at most 64 characters and matches
  `/^[A-Za-z0-9][A-Za-z0-9 ._+-]*$/`.
- `longDescription` is non-empty supported text of at most 1024 characters.
  `capabilities` contains at most 20 case-insensitively unique normalized
  single-line values of at most 120 characters.
- `defaultPrompts` contains at most three unique supported single-line values
  of at most 128 characters, none beginning with `@` after leading whitespace.
- `brandColor` is an uppercase six-digit hexadecimal colour. Both image paths
  match `./assets/<kebab-case>.svg`.
- Skill IDs are unique kebab-case values in code-unit order. Workspace paths,
  entry paths, hook declaration paths, files, projections, and
  result path arrays follow their exact accepted path grammar, uniqueness, and
  ordering rules.
- `skills` is non-empty. A workspace path is a confined repository-relative
  directory. A workspace `entryPath` is the logical runtime entry
  `runtime/<stem>.js`, where `<stem>` is kebab case. Its produced path is
  `runtime/<stem>-<16 lowercase hexadecimal characters from the bundle
  SHA-256>.js`. A prepared entry uses `runtime/<kebab-case>.js` directly.
  Every prepared entry and hook declaration exists as a confined non-symlink
  regular file before candidate construction.
- The three source projection paths are distinct confined repository-relative
  regular files. The Kit hashes their bytes without parsing their private
  schemas, then combines them with the generated bundle inventory and two
  native manifests to return the six accepted projection declarations.

Code-unit order compares UTF-16 code units with `<` and `>` and never uses
locale collation. A confined relative path is non-empty, uses `/`, is not
absolute, contains no backslash, NUL, empty, `.` or `..` segment, and resolves
physically beneath its named root. Every observed ancestor is a non-symlink
directory and every observed leaf is a non-symlink regular file where a file
is required.

The interrupt callback requires `path` only at
`materialization-file-published` and
`materialization-inventory-published`. Package publication points keep calling
the callback without a path, so the accepted package fault seam stays usable.

### Owned candidate

For one accepted configuration and repository root, the Implementation builds
one complete candidate in private staging before comparing or writing:

- repository-root `.claude-plugin/marketplace.json` and
  `.agents/plugins/marketplace.json`;
- payload-root `plugin/.claude-plugin/plugin.json` and
  `plugin/.codex-plugin/plugin.json` native manifests;
- the installed skill inventory;
- every workspace-produced runtime bundle;
- the bundle inventory JSON and shell projection;
- third-party notices; and
- the complete safe `plugin/` regular-file inventory and framed payload digest.

The private staging root is created in the host temporary directory, outside
the real Plugin Repository root. Check deletes it before returning and never
creates a directory, temporary file, or lock beneath the repository root.

The returned `PreparedPayloadCandidate.files` records every `plugin/`-relative
regular file with its byte count, `sha256:` digest, and executable bit.
`projections` records every repository-relative source projection needed to
reconstruct the same candidate. `ownedFiles` records every repository-relative
Kit-owned output, including the two repository-root marketplace manifests; it
is not a subset of `files`. `files` and `ownedFiles` use code-unit path order.
`projections` reuses the accepted `PreparedProjectionDeclaration` order of
role, then path. Every array contains no duplicate path. All result path arrays,
including refusal, materialization failure, `changedPaths`, `removedPaths`,
`unchangedPaths`, and `remainingPaths`, are repository-relative; only `files`
is `plugin/`-relative. This gives the caller enough data to add Source Identity,
Release, and a binding digest for a later package request without changing
package mode's existing result.

Hook declaration files and native capability fixtures remain product-authored
inputs. The candidate includes their safe paths in closure and verifies their
existence, but never renders or rewrites their contents.

The fixed generated-path set is exactly the four marketplace/native manifests,
skill inventory, bundle inventory JSON and shell projection, and third-party
notices. Variable generated paths are workspace bundles selected by the
candidate. The removal set is narrower: a path may be removed only when the
current valid bundle inventory declares it, its basename matches
`/^([a-z0-9]+(?:-[a-z0-9]+)*)-[a-f0-9]{16}\.js$/`, and the new candidate no
longer selects it. The generated bundle inventory records prepared entries
beside workspace bundles, matching the accepted baseline inventory shape.
Invalid or unsafe ownership evidence is a refusal, not deletion. Product-authored
files, prepared runtime entries, hook declarations, native capability fixtures,
and every path outside that removal set are preserved.

The obsolete `plugin/.agents/plugin.json` Codex manifest is outside the owned
removal set. If it exists, check and materialize preserve it and return
`payload-outdated` before any write. The refusal names that exact path and tells
the operator to inspect and remove the legacy manifest before retrying; the Kit
never deletes it automatically.

A missing bundle inventory contributes an empty removal set and never grants
deletion authority. If the remaining payload contains an unclaimed bundle,
check returns `payload-outdated`. Materialize detects the same unclaimed bundle
during candidate comparison, before its first write, and returns
`payload-outdated` with the ordered affected paths. A human must restore a
valid prior inventory or inspect and remove the unclaimed file before either
mode can succeed. A present inventory with invalid shape, unsafe paths, duplicate
ownership, or inconsistent records returns `inventory-invalid`; neither mode
writes or deletes anything.

The Implementation rejects a generated path colliding with a product-authored
path, an escaping path, a symlink or special file, duplicate output, missing
source, or stale bundle mapping.

### Check

Check constructs the complete candidate without changing repository state.

- Equal current outputs return `checked` with the required complete candidate.
- Missing, changed, or obsolete owned bundle outputs return `refused` with
  `payload-outdated`, the affected repository-relative paths in code-unit
  order, and the next action to run materialize.
- Invalid normalized data returns `configuration-invalid`.
- Invalid repository roots reuse `repository-root-invalid`; invalid payload
  roots reuse `payload-root-invalid`; unsafe, escaping, symlinked, or special
  paths reuse `unsafe-entry`; and missing declared files reuse
  `declared-file-missing`.
- Dependency or bundle rejection returns `dependency-refused` or
  `bundle-refused` without publishing output.
- Invalid bundle ownership evidence returns `inventory-invalid` without
  publishing or deleting output.

Check never installs dependencies. The lock and installed-package-store
precondition applies only when at least one skill uses `production.kind:
"workspace"`. A missing committed frozen lock returns `dependency-refused`
and tells the operator to restore it before repeating check. A present frozen
lock with no installed package store also returns `dependency-refused` and
tells the operator to run `bun install --frozen-lockfile` from the Plugin
Repository root before repeating check. Model-only and prepared-only
configurations do not require either workspace dependency input.

### Materialize

Materialize computes and validates the same candidate before touching an owned
output. It writes each changed file through a same-directory temporary file and
atomic rename, preserves executable modes, writes inventories after the bytes
they describe, and removes only obsolete digest-named bundles owned by the
candidate. Equal files are left unchanged.

Materialize never installs dependencies. The same workspace-only missing-lock
and missing-store conditions, Result Code, and repair actions that refuse check
also refuse materialize before its first write.

Cross-file atomicity is not claimed. The existing private
`PayloadPublicationPoint` seam is extended with
`materialization-staged`, `materialization-file-published`,
`materialization-inventory-published`, and `materialization-verified` points.
The optional test interrupt receives the point and the affected path when one
exists. If the process stops after one file rename, a subsequent check reports
the incomplete state and a repeated materialize converges to the same
candidate. Materialize failures use a distinct
`materialization-failed` result so package failure remains unchanged:

- `state: "none"` carries `changedPaths: []`, ordered `remainingPaths`, and a
  `transient` flag;
- `state: "partial"` carries non-empty ordered `changedPaths` and
  `remainingPaths`; and
- `state: "unknown"` carries `changedPaths: null` and `remainingPaths: null`.

Its stable codes are `materialization-staging-failed`,
`materialization-interrupted`, `materialization-verification-failed`, and
`materialization-state-unobservable`. Every variant carries a repair-oriented
next action. Materialize never reports `materialized` without rereading the
complete generated output and payload closure.

A successful result carries the required complete candidate, changed paths,
removed paths, and unchanged paths in code-unit order. A second identical
materialize reports no changed or removed paths.

### Source Checkout Admission compatibility

This record amends ADR 0007 in exactly one place: Source
Checkout Admission may authorize `payload:check` and `payload:materialize` as
well as `payload:package`. All three are repository-local commands.
Check and materialize bind only the exact executing checkout and make no
Release or Workflow Identity claim. Package keeps its existing Source Checkout
Admission contract unchanged. Every non-payload command remains refused before
Admission and protected authority access.

The Maintenance binder still parses once, checks the command against this
closed three-command set, admits once, and binds once. The real-process
scenario set in `clean-fixture/audit-maintenance-cli.ts` owns reconciliation of
the four newly required Branch Stations: check `previewed` and
`command-refused`, and materialize `completed` and `command-refused`.

The existing source-checkout assertion whose public diagnostic is
`Maintenance command is not admitted.` is rewritten. Its replacement proves
that source-checkout Admission can bind real check and materialize requests
while released Admission and every unrelated command retain their accepted
behavior. The installed non-checkout public-process probe continues refusing,
but its expected diagnostic becomes
`Maintenance source checkout is not admitted.`

### Package compatibility

This record amends ADR 0008 in exactly three limited places:

- the package preview statement, so package discovery has no preview route and
  programmatic package inspection keeps its static zero-effect preview;
- Test Design rows P05 to P07, which become the check, materialize, and
  package-inspection cases named below; and
- the Composition and quality policy sentence that says check and materialize
  Branch Stations keep the absent-owner rationale.

It does not reopen ADR 0008's package request, preparation, publication, or
result contract.

Package mode continues validating the caller's sealed preparation declaration
against the actual payload. It does not implicitly run materialize. A caller
that needs fresh output runs check, materialize when needed, then check again
before preparing and packaging the source-bound payload.

The package request, archive format, checksum document, output names,
no-replace publication, Source Identity binding, and package tests from ADR
0008 remain unchanged.

Package no longer advertises check as its preview route. `payload check`
requires normalized configuration that the unchanged package request does not
carry, so package metadata declares `previewRoute: null`. Package still performs
its accepted sealed-preparation validation before no-replace publication. The
former package-preview case is replaced by proof that discovery/help metadata
declares no preview and never synthesizes an invalid check request.

Programmatic `inspect({ command: "payload:package", ... })` preserves the
validated package request and returns the existing static package Command
Preview with zero expected effects. It does not invoke Plugin Payload
Production and does not synthesize a check request. `inspectionInputFor` maps
materialize to check but preserves package as package. Materialize keeps
`previewRoute: ["payload", "check"]`.

### Composition

The Maintenance Command Facade validates wire input and renders the owner
result. The Maintenance Command Contract owns Branch Station and effect mapping:

- clean `checked` and complete `materialized` results to completed results;
- `payload-outdated` and input refusals to command refusal with repair;
- `state: "none"` to retry deferred when transient, otherwise command refusal;
- `state: "partial"` to continuation required with
  `effect:payload-materialized` remaining; and
- `state: "unknown"` to recovery required.

A complete materialize maps `effect:payload-materialized` as completed. All
materialization-failure variants carry `code`, `state`, `transient`,
`changedPaths`, `remainingPaths`, and `nextAction`; `partial` and `unknown`
always use `transient: false`. Package
effects and package failure mapping remain unchanged.

Check `previewed` and `command-refused` Stations, and materialize `completed`
and `command-refused` Stations, become required. Check `retry-deferred` and
`recovery-required` become `declared-unreachable`: `PayloadCheckResult` has no
failure variant that can map to either result, and no accepted input can cause
one. Fault-only materialize retry, continuation, recovery, and runtime-failed
Stations, plus check `runtime-failed`, remain `implementation-deferred` with
the fault-Adapter rationale from ADR 0008 because no accepted CLI input
deliberately causes an interrupted filesystem or unexpected host effect. Owner
Contract Tests prove those typed outcomes and Maintenance mapping without
pretending that an unreachable public-process fault is a CLI proof.

My Second Brain keeps its generation composition root. Its Adapter projects
product-owned configuration into `PluginPayloadConfiguration`, invokes check or
materialize, then separately coordinates Runtime Custody and native capability
fixture owners. Its build and both package callers use the same payload owner.

### Ordered adoption

The Kit ticket is completed, proved, reviewed, merged, and identified by its
full immutable commit before consumer work begins. Only then may a consumer
worktree pin that exact Kit commit and start its Adapter and deletion work.
Consumer proof must never use an unmerged Kit worktree, branch name, local
path, or abbreviated commit as its dependency authority.

## Consequences

- Positive: one Interface gives every Plugin Consumer configuration,
  dependency, bundle, inventory, and closure behaviour.
- Positive: product and Canary configuration stay outside the Kit while their
  generic values remain explicit inputs.
- Positive: callers do not learn internal production order or partial helper
  Interfaces.
- Positive: check is a deterministic repair oracle for interrupted or stale
  materialization.
- Negative: the normalized request is larger than a root-only request.
- Negative: the consumer needs one Adapter that projects its private sources
  into the normalized value.
- Negative: materialize does not promise impossible cross-file atomicity;
  interruption can require a deterministic rerun.
- Neutral: Bun remains the contributor-side bundler and installed dependency
  store. This decision does not change end-user runtime custody.
- Neutral: package mode remains source-bound and independently commissioned.

## Test Design

### Seam and proof layers

The primary seam is `PluginPayloadProduction.produce`. Owner Contract Tests
exercise deterministic input, candidate, refusal, drift, and materialization
semantics. Public-process tests exercise real CLI parsing, streams, exits, and
result projection. Clean Fixture proves a production-only installed consumer.
My Second Brain Adapter tests prove product-source projection and retained
workflow callers.

### Independent result

Expected projection bytes come from test-owned literals. Expected bundle and
payload hashes come from independent `node:crypto` calculations over literal
fixture inputs. Filesystem state is observed through a separate reader after
the call. The unchanged consumer comparison is bound to My Second Brain commit
`cb4f75532f3c52e22782b1591db2c1fe63af757a`, its committed `plugin/` Git tree
`ad2419bef3b5e6678bc45c57933e2da472153b61`, Bun `1.4.0`, `bun.lock` SHA-256
`8bbb9c7366a0f6e6ce5311388423deea2a74df9c68acf8391bf16d798e87e713`, and
`package.json` SHA-256
`5ee024b785c385bef8748ad40375c9a7accf06c381fe40d09b0bf801740756d4`.
An independent fixture reader enumerates the 61 committed baseline files and
compares every payload-relative path, byte sequence, executable bit, and
framed payload digest. Workspace bundles must also be byte-identical because
the Bun and lock inputs are pinned. Generated inventory bytes and executable
modes must remain byte-for-byte equal to that same baseline. The migrated
producer may not generate its own expected values.

### Required focused proof

The implementation specification binds exact case IDs and non-zero counts for:

- strict configuration, every production form, and product-only field refusal;
- exact projection bytes and code-unit ordering;
- frozen dependency admission and rejected lifecycle, native, optional, peer,
  license, parent-resolution, and runtime-loader cases;
- deterministic bundles, notices, inventory, payload closure, and orphan
  cleanup;
- no-write check, drift paths, idempotent materialize, per-file atomic write,
  interrupted convergence, and final reread;
- real CLI check/materialize success and refusal, package no-preview metadata,
  plus owner-level partial and recovery mapping;
- Clean Fixture copied to a temporary directory outside the Kit and source
  checkouts before production-only install and execution; and
- consumer parity, both package callers, product-only locality, and deletion of
  superseded generic mechanics.

The Kit adds exactly 33 cases without inflating the count through repeated
manifest instances: 15 Plugin Payload Production check/materialize cases, 10
input-refusal cases, one table-driven Maintenance mapping case, three net-new
public-process cases beside three rewritten existing cases, and four Clean
Fixture cases. The consumer adds six Adapter cases. Before GREEN, CM01, P05,
and CF01 must fail against the existing deferred modes.

The rewritten existing proof also updates:

- the package `previewRoute` row in
  `src/adapters/maintenance-command-facade/contract-tests/fixtures/literal-cli-scenarios.ts`;
- the corresponding discovery assertion in
  `src/adapters/maintenance-command-facade/contract-tests/command-surface.test.ts`;
- the source-checkout Admission assertion in
  `src/modules/source-checkout-admission/contract-tests/source-checkout-admission.test.ts`;
- the installed non-checkout refusal and check-drift promotion assertions in
  `src/adapters/maintenance-command-facade/contract-tests/maintenance-cli.test.ts`;
- literal Branch Station fixtures, including their expected count, in
  `tooling/repository-quality/literal-branch-stations.ts`;
- the frozen package help `preview_route` in
  `clean-fixture/personal-verification-profile/contract-tests/fixtures/plugin-consumer.ts`;
  and
- the M01 fixture values in
  `src/modules/maintenance-command-contract/contract-tests/package-result-and-admission.test.ts`
  that use the removed optional `payload` result shape.

These are corrections to existing assertions, not net-new cases.

| Owner and test file | Exact cases |
| --- | --- |
| `src/modules/plugin-payload-production/contract-tests/check-materialize.test.ts` | CM01 strict configuration and source projections; CM02 deterministic complete candidate; CM03 four rendered manifests plus preserved hook declarations and native fixtures; CM04 exact skill inventory; CM05 workspace bundle; CM06 prepared runtime entry; CM07 notices; CM08 complete file records, projection records, executable bits, and framed digest; CM09 no-write check with external staging cleanup; CM10 clean check; CM11 ordered drift and missing-inventory behavior; CM12 changed and equal materialize; CM13 executable mode; CM14 named interruption points and repeat convergence; CM15 final independent reread plus invalid-inventory refuse-without-delete. |
| `src/modules/plugin-payload-production/contract-tests/production-input-refusal.test.ts` | IR01 unknown configuration field; IR02 forbidden nested `schemaVersion`; IR03 product-only field; IR04 duplicate or unsorted skill; IR05 unsafe source path; IR06 missing workspace source, hook declaration, or prepared entry; IR07 frozen lock or package store absent with no install; IR08 lifecycle script, optional dependency, or native dependency; IR09 unresolved peer or rejected license; IR10 computed import or runtime-loader escape. |
| `src/modules/maintenance-command-contract/contract-tests/package-result-and-admission.test.ts` | MC01 one table covers checked, refusal, materialized, transient none, non-transient none, partial, unknown, wrong result kind, and incomplete evidence, with exact Branch Station, Transaction State, Retry Safety, completed effects, remaining effects, and Next Action assertions. |
| `src/adapters/maintenance-command-facade/contract-tests/package-public-process.test.ts` | P05 real clean check success; P06 materialize preview through check and real apply success; P07 package discovery has no preview and static inspect preserves package without synthesized check; P12 check drift refusal; P13 check invalid-configuration refusal; P14 materialize invalid-inventory refusal. P05 to P07 rewrite three existing cases; P12 to P14 are the three net additions. |
| `clean-fixture/personal-verification-profile/contract-tests/payload-check-materialize.test.ts` | CF01 production-only install and real check; CF02 fixture copied to a host temporary directory outside both checkouts before real materialize; CF03 no undeclared source, dependency, or parent resolution; CF04 real public-process bytes, streams, and exits. |
| My Second Brain `scripts/plugin-payload-production-adapter.test.ts` | S01 exact source projection; S02 product configuration and Runtime Custody source separation; S03 no-write check; S04 full payload and bundle-byte materialize parity; S05 both package callers; S06 product-only locality. |

Sensitivity proof must include a changed projection byte, dependency
selection, bundle byte, inventory digest, orphan set, unsafe path, executable
mode, missing hook declaration, missing prepared entry, invalid-inventory
refuse-without-delete, write interruption, and publication-order inversion.
Each disposable change must make its owning focused proof RED before the same
harness is restored to GREEN.

Focused proof extends the existing commands:

```sh
bun run test:current-stage:plugin-payload-production
bun run test:current-stage:maintenance-command-contract
bun run test:current-stage:maintenance-cli:process
bun run audit:maintenance-cli
bun run test:current-stage:clean-fixture
bun run check
```

## Non-Claims

- Cross-file atomicity or power-loss durability.
- Dependency installation.
- Runtime acquisition, cache repair, launcher generation, or installed runtime
  execution.
- Native capability fixture or Harness ownership.
- Release, GitHub, workflow, Canary, or hosted distribution ownership.
- Compiled Kit delivery or cross-platform executable embedding.

## Confirmation

Accept the exact Interface and Test Design before the first test edit. Confirm
implementation through the named owner, public-process, Clean Fixture, and
consumer proofs; zero-test, skipped, disabled, or retry-masked runs do not
qualify. Accept the consumer only after obsolete generic scripts and shallow
tests are removed and the independent baseline bytes remain equal.

Revisit this decision if a second consumer cannot express its source through
the normalized configuration, or if a real filesystem requires transactional
publication rather than deterministic check and repair.

## References

- [`0001-language-to-topology.md`](0001-language-to-topology.md)
- [`0004-public-serialized-validation-and-logical-record-correlation.md`](0004-public-serialized-validation-and-logical-record-correlation.md)
- [`0008-package-prepared-plugin-payload.md`](0008-package-prepared-plugin-payload.md)
- [Exact Kit design baseline](https://github.com/myagentdojo/agent-plugin-kit/commit/d0243de4319bbf83130fc8c80793c7f687fb454a)
