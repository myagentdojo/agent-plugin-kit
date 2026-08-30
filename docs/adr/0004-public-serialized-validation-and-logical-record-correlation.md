---
status: accepted
---

# Own Public Serialized Validation and Logical Record Correlation

This Accepted Decision records how the
existing public TypeScript surfaces should own serialized-value validation,
state correlation, and exhaustive handling, and what the Kit Repository may
claim about caller-captured records. It creates no reconstruction operation.

It constrains seven existing Interface owners and creates no new owner:

- `src/modules/maintenance-command-contract/` owns command, result, failure,
  retry, transaction, Next Action, Result Code, and trusted command-binding
  meaning.
- `src/adapters/maintenance-command-facade/` owns the public
  process observation, Diagnostic Record, Event Record, and Event Acceptance
  Interface.
- `src/modules/qualification-evidence/` owns Evidence Cell,
  Verification Profile, reduction, and Qualification Result meaning.
- `src/modules/plugin-payload-production/` owns payload request and
  result meaning.
- `src/modules/release-and-git-engine/` owns repository, release,
  package, workflow, candidate, request, and approval meaning.
- `src/modules/harness-journeys/` owns harness wire request, trusted transition,
  approval, inspection, and result meaning.
- `src/modules/canary-qualification/` owns canary candidate, plan, protected
  authority reference and resolution, authority, and result meaning.

It contains no schema, no Implementation, and no test. It does two things a
purely additive decision cannot do, and both are stated as such below: it
amends `docs/adr/0002-owner-manifests-and-dependency-locality.md`, and it
requires a respecified Repository Qualification Contract under
`docs/adr/0003-repository-quality-and-verification-transition.md` before any
manifest, schema, or test change is admitted.

> **Current repository-quality amendment:** ADR 0005 supersedes ADR 0003's
> lifecycle and count-based transition mechanics. References below to a
> Repository Qualification respecification are historical gates from this
> decision's acceptance. Current work uses ordinary owner Contract Tests and
> lifecycle-neutral Repository Verification; adding valid source or tests does
> not require a mirrored transition contract.

## Decision

Nathan accepted this decision on 28 August 2026. Fresh Sol High and Fable 5
extra-high reviewers independently inspected immutable Kit commit
`b47396abca2321ce3199e147430ed6824e7a96bc` and both returned `ship`. The Fable
review identified one non-blocking glossary precision, applied in this
acceptance checkpoint: trusted plan acceptance is required where a command
obtains a protected capability through a Seam, rather than for every possible
binding.

Nathan accepted one scoped Admission Bootstrap amendment on 30 August 2026
after a fresh Sol High `ship` review. Admission keeps its declaration-only
Interface while its existing public package subpath resolves that declaration
for TypeScript and its private dependency-free Implementation for Bun. This
amendment adds no validator, schema, dependency, owner, Adapter, root runtime
value, or public Implementation path.

### TypeScript boundary

- Repository TypeScript keeps `strict`, `noUncheckedIndexedAccess`,
  `noFallthroughCasesInSwitch`, and `noImplicitOverride` and adds
  `exactOptionalPropertyTypes` and `noImplicitReturns` before public contract
  Implementation begins. Any unrelated diagnostic stops that bounded
  transition rather than authorizing broad repair. The first read-only
  TypeScript 7.0.2 probe found exactly two transition diagnostics. Their
  current owners are the affected observability Contract Test and Repository
  Quality Tooling under ADR 0005. Any additional diagnostic stops the
  transition.
- Enabling `exactOptionalPropertyTypes` changes the meaning of every existing
  optional key, so that transition is a contract change and not a compiler
  setting. The Optional keys and JSON round trip rule below states the
  required meaning for each optional serialized key.
- External input, persisted state, CLI payloads, model output, and tool output
  enter their owning Interface as `unknown`. One successful owner-local parse
  produces the trusted value used by internal typed calls.
- Every public state union uses a literal discriminator and exhaustive
  handling with `never` or an equivalent checked rule.

### Discriminated public state

- `MaintenanceOutcome` and `EventDeliveryResult` keep their existing literal
  `status` discriminators.
- `EvidenceCell` keeps its accepted wire fields and becomes a union whose
  `assertedStatus` and observable form agree: `proved` permits only
  `observed`; `not-proved` permits only `failure` or `proved-absence`; and
  `unknown` permits either a true skip or an `unavailable` or `unknown`
  observation. A skip has null Proof Layer and observable plus one Skip
  Rationale. Every non-skip has a non-null Proof Layer and observable plus a
  null Skip Rationale.
- The reduced claim becomes a `status`-discriminated union. `proved` carries
  an `observed` kind and non-null Proof Layer. `not-proved` carries
  `observed`, `failure`, or `proved-absence` plus a non-null Proof Layer.
  `unknown` distinguishes a true skip with no Proof Layer and one Skip
  Rationale from an `unavailable` or `unknown` observation with a non-null
  Proof Layer and no Skip Rationale.
- The `unknown` branch of both unions carries its own literal
  sub-discriminator so that each union stays expressible as nested
  discriminated unions rather than as a refinement over one flat object. The
  exact sub-discriminator key and its two tokens are selected in the accepted
  schema pass. A schema that expresses the split with a refinement instead of
  a literal key does not satisfy this decision.
- These variants preserve the accepted reduction truth table, profile order,
  input order, resolution precedence, Proof Layer non-promotion, Non-Claims,
  receipt digests, and Evidence Cell identifiers. They add no caller-selected
  final Claim Status.

### Serialized type equivalence

- A Public Serialized Value has exactly one runtime validator and exactly one
  declared TypeScript type, held in proved agreement. `z.infer` is the
  preferred type source and is authoritative only where it reproduces the
  declared type exactly.
- Where inference widens a declared type, the declared type stays
  authoritative for compile time and the schema stays authoritative for
  runtime. Zod 4 can preserve the current `sha256:${string}`,
  `cell:${string}`, and `` `${string}.${ResultCode}` `` template-literal
  types with `z.templateLiteral`; the bidirectional assertion remains required
  so a future schema or library change cannot silently widen them to `string`.
- Every Public Serialized Value carries a compile-time bidirectional
  equivalence assertion: the declared type must be assignable to the inferred
  type and the inferred type must be assignable to the declared type. Either
  direction failing must fail `bun run typecheck`, so widening is caught by
  the compiler and not by review.
- The equivalence assertion is evaluated with `exactOptionalPropertyTypes`
  enabled, so optional-key meaning is part of what it proves.
- Zod 4 is the required major version. The exact version string is selected at
  Implementation admission and pinned identically in every declaring manifest.

### Optional keys and JSON round trip

- Every optional key on a Public Serialized Value is normalized to exactly one
  of two spellings. An omissible key may be absent and is never present with
  the value `undefined`. A nullable key is always present and carries an
  explicit `null`. The existing Interfaces already use both spellings:
  `EvidenceLineage.release` is omissible; `EvidenceCell.observable` is
  nullable. The current `NextAction.commandId?: MaintenanceCommand["command"]
  | null` is a third form and is corrected at Implementation admission to the
  always-present nullable spelling, matching Result Vocabulary projection.
  Pinned literals that currently omit `commandId` are respecified in the same
  Repository Qualification Contract checkpoint.
- No Public Serialized Value carries `undefined` as a value at any depth. That
  rule is what makes `exactOptionalPropertyTypes` safe to enable without
  changing wire meaning.
- Every Public Serialized Value satisfies a JSON round trip: serializing it
  and parsing the result must produce a value that parses under the same
  schema and is equivalent to the original. Because serialization drops an
  `undefined`-valued key, the omissible spelling is what keeps that drop
  meaning-preserving.
- `FacadeInvocation.environment` is a process input, not a Public Serialized
  Value. Its `string | undefined` interior stays as declared and is exempt
  from the two rules above.

### Validation ownership and placement

- Each of the seven owners above declares Owner-Local Validators limited to
  its own Public Serialized Values. No eighth owner and no shared schema
  package is created.
- Validation runs once at untrusted ingress and once at public serialized
  egress. Internal typed calls between owners are not revalidated.
- Domain-only internal types remain ordinary TypeScript and gain no schema.
- Every existing `interface.ts` stays declaration-only apart from its existing
  sentinel constants. It imports no Zod and no validator. Each owner places
  runtime validators in one private owner-local sibling file beside
  `interface.ts`, following the existing private runtime-file pattern. The
  exact sibling filename is selected in the accepted schema pass.
- Validator dependency direction is one way: the private sibling imports Zod
  and its owner's declared types; `interface.ts` never imports the sibling.
  Maintenance Command Contract and the facade may compose validators through
  repository-relative imports. A Plugin Consumer cannot import a validator
  through an accepted package subpath.
- `src/interface.ts` stays type-only. It exports no schema and no runtime
  value, so the root export gains no runtime surface and no Zod import.
- Eight accepted package subpaths continue to resolve directly to declaration-
  only `interface.ts` files. The existing `./admission-bootstrap` subpath is
  the only exception: its ordered `types` condition resolves to the
  declaration-only Interface, while `import` and final `default` resolve to the
  same private Admission Implementation. The Interface declares
  `admissionBootstrap` without importing or re-exporting Implementation, and
  the private Implementation supplies that matching runtime value.
  Owner-Local Validators add no exported name, compatibility surface, or
  subpath type-export catalog entry. Their sibling files enter the installed
  inventory only through the reviewed ADR 0003 respecification.
- The Maintenance Command Facade Adapter Interface stays outside root exports
  under ADR 0002. Repository Qualification owns the current export-surface
  declaration; Facade schemas therefore remain owner-private and add no caller
  surface.
- The nine public subpath names and ten-entry exports map remain exact. Root
  runtime output remains empty; Admission gains exactly `admissionBootstrap`;
  Qualification Evidence preserves its existing `VerificationProfile`
  sentinel; and every other named subpath preserves its empty runtime output.

### Nested command validation composition

- The Maintenance Command Facade Adapter parses argv, file-location, stdin,
  environment, and envelope syntax. JSON loaded by the facade enters as
  `unknown`; the facade owns no nested Module meaning.
- Maintenance Command Contract composes its Command Vocabulary discriminator
  with private Owner-Local Validators imported relatively from Plugin Payload
  Production, Release and Git Engine, Harness Journeys, and Canary
  Qualification.
- Each governing Module validates only the nested Public Serialized Values it
  owns. Maintenance reuses those validators and does not copy their shape.
  The facade does not duplicate the validation, and downstream typed calls do
  not revalidate the trusted value.
- Structural validation cannot manufacture `AdmittedIdentity`,
  `ProtectedCanaryAuthority`, or another protected capability. Maintenance
  Command Contract therefore owns one explicitly versioned, unbranded Wire
  Command union. Each command variant contains only ordinary data and
  unversioned owner-local Wire Fragments plus the existing explicitly
  versioned approval values enumerated below. A successful parse yields that
  Wire Command, never a capability-bearing `MaintenanceCommand`.
- The Facade loads each command-specific file as `unknown`, assembles one
  `schemaVersion`-carrying Wire Command candidate from argv and those unknown
  fragments, and passes that candidate to Maintenance validation. It does not
  interpret a fragment or approval independently. Maintenance selects the outer
  command version and discriminator first, then composes each governing owner
  validator exactly once. An unrecognized outer version is refused before any
  nested parse.
- Admission Bootstrap runs before any Kit Repository Implementation executes.
  Maintenance Command Contract owns one trusted command-binding step that
  attaches the run's `AdmittedIdentity` to an admitted harness Wire Command.
  The binder verifies that any candidate carried by the wire value or approval
  agrees with the admitted identity and refuses disagreement. It never brands
  a parsed `CandidateIdentity`.
- Canary qualification follows one fixed trust order: parse the Wire Command;
  prove its Canary Candidate agrees with the run's `AdmittedIdentity`; obtain
  the `CanaryPlan` through `CanaryQualification.inspect`; receive trusted caller
  acceptance of that inspected plan; only then resolve the opaque protected-
  file reference from `--authority <FILE>` for that admitted candidate and
  accepted plan. The file contents are never parsed or cast as
  `ProtectedCanaryAuthority`; only successful protected-source resolution at
  that point supplies the capability to the trusted binder. `qualify` retains
  its accepted obligation to refresh the plan before using authority. Trusted
  plan acceptance is process-local caller control, not a new wire field,
  serialized approval, or retained capability. The Authority Source receives
  the admitted candidate and exact accepted plan; candidate data never selects
  the protected target.
- The binder is the only route from a parsed Wire Command to the existing
  capability-bearing `MaintenanceCommand`. Its exact call shape is selected in
  the accepted Interface pass; no new owner or public export is created.
- This composition adds no owner, shared schema Module, root export, or
  duplicate validator. It adds private validator siblings and one owner-local
  Canary Qualification Adapter under that Module's future `adapters/` path to
  implement the Authority Source Seam. Exact filenames, validator names, and
  Adapter call shape remain deferred to the accepted Interface pass.

### Ingress strictness and egress projection

Two distinct paths exist and this decision keeps them distinct.

- Untrusted ingress: the value arrives as `unknown` and is parsed strictly.
  Unknown keys are refused. There is no coercion, no default, no transform,
  and no stripping of any kind. A key the schema does not declare produces a
  structured refusal rather than a quietly narrower value.
- Trusted serialized egress: the owner builds the declared allowlist, redacts
  by removing every value outside it, validates the redacted projection,
  freezes it, and then crosses the Seam. That pinned order,
  `build-allowlist`, `redact`, `validate`, `freeze`, `cross-seam`, is
  preserved exactly as
  `src/adapters/maintenance-command-facade/contract-tests/observability.test.ts`
  pins it. Validation runs on the redacted projection, never before it.
- Allowlist removal is an owner-performed, declared step over a value the
  owner produced. It is not schema stripping and it is not silent: the
  allowlist is declared per named value and its effect is observable per named
  value. The earlier "no silent stripping" rule applies to validation only.
- After redaction, any key outside the declared envelope is a fail-closed
  Implementation contract failure. Strict egress validation is what proves the
  allowlist was complete.
- Free-text is the residual. `DiagnosticRecord.message` cannot be proved
  redacted by schema alone, so its redaction stays an owner obligation proved
  by a hostile-value Contract Test rather than a schema claim.

### Machine envelope and version carriers

- The public process envelope is a Public Serialized Value. Its facade-owned
  keys are `schema_version`, `status`, `run_id`, and, on the stderr error
  envelope, `record_type` and `message`. Its `data` object is owned by
  Maintenance Command Contract and carries `contract_id`,
  `result_schema_version`, and the Result Vocabulary fields. The stderr
  envelope also carries the Maintenance-owned closed `error` object, including
  `schemaVersion`, `hintVersion`, `code`, and `agentActions`; strict egress
  validation covers that object rather than treating it as an undeclared key.
- `MaintenanceOutcome` therefore never crosses stdout by itself. The facade
  projects it into the versioned envelope above, so Facade Envelope Version is
  carried by the envelope `schema_version` and Result Schema Version is
  carried by `data.result_schema_version`.
- Hint Version has two declared serialized carriers today: the `versions`
  object inside the help discovery payload and `error.hintVersion` inside the
  stderr error envelope. Result Schema Version is carried independently by
  `data.result_schema_version`; the error detail object's own schema is carried
  by `error.schemaVersion`. This decision adds no version carrier.
- The `agent` payload carried as `data.result` stays a command-scoped open
  record. The envelope schema owns its presence, not its interior. At egress
  it must be JSON-representable, already redacted by the step above, and
  deterministic for one command and one input, and it must carry its own
  explicit version key. Whether each command's `agent` payload earns an
  owner-local schema is a per-command decision deferred to that command's
  Implementation.
- One defect is recorded rather than resolved here: the observed `agent`
  payloads disagree on version spelling. The help discovery payload uses
  `schema_version` while the `payload:materialize` payload uses
  `schemaVersion`. One reviewed decision by Maintenance Command Contract must
  settle that spelling before the first `agent` payload schema is written.

### Refusal and failure meaning

- Invalid ingress becomes an owner-mapped structured refusal that reuses the
  stable existing Result Code and Exit Code semantics where the value crosses
  the public process. It introduces no new Failure Class.
- Invalid egress is a fail-closed Implementation contract failure, not a
  caller error.
- Raw input and raw Zod error detail remain private. Neither reaches a
  Command Preview, a Command Result, an Event Record, or a Diagnostic Record.

Serialized per-cell rejection and multi-cell reducer refusal are separate
channels and are not merged.

- Per-cell agreement between `assertedStatus`, observable kind, Proof Layer,
  and Skip Rationale is enforced at the Qualification Evidence serialized
  ingress schema, which parses `unknown`. Every negative control that pairs a
  status with a forbidden observable, Proof Layer, or Skip Rationale runs
  through that parse.
- A cell that reaches `reduce` is already narrowed. `reduce` does not
  re-validate per-cell agreement and does not need to trust
  `assertedStatus`, because a disagreeing cell is unrepresentable in the
  discriminated type and unparseable at ingress. That is the resolution of the
  apparent conflict between a discriminated `EvidenceCell` and the accepted
  rule that the reducer validates a cell without trusting `assertedStatus`:
  the truth table is unchanged, and only its enforcement point moves from the
  reducer to the owner's parse.
- Multi-cell invariants stay inside `reduce`. They are Evidence Cell
  identifier syntax and uniqueness within one input, input-order resolution
  references, resolution validity against the Proof Layer partial order,
  unresolved-set shape, cross-cell Candidate Lineage agreement, and
  out-of-profile claims. A per-cell schema cannot reach any of them.
- `QualificationEvidence.reduce` gains an owner-local discriminated refusal
  channel, `QualificationOutcome`, discriminated by a literal `status` with
  the tokens `reduced` and `refused`. It is not `MaintenanceOutcome`:
  Qualification Evidence does not own Result Codes, Exit Codes, Station IDs,
  or command meaning, and coupling the two would give it a second vocabulary
  it cannot honour.
- The refusal carries a stable owner-local Qualification Refusal Code drawn
  from a sealed union, distinct from `ResultCode`. The required meanings are
  an empty unresolved set for a selected claim, a claim outside the selected
  profile, Candidate Lineage disagreement, a malformed or duplicated Evidence
  Cell identifier, an invalid resolution reference, an unqualified resolving
  cell, and a mixed unresolved set. The exact code tokens are selected in the
  accepted schema pass. There is no code for status and observable mismatch,
  because that case is refused earlier by the two mechanisms above.
- When a Qualification refusal crosses the public process, Maintenance Command
  Contract owns the mapping from each Qualification Refusal Code to an existing
  Result Code and Exit Family. Result Code and Exit Family are its sealed
  Result Vocabulary, already declared in
  `src/modules/maintenance-command-contract/result-vocabulary.ts`, and the
  Maintenance Command Facade Adapter owns envelopes and parsing but no command
  or result policy. Placing the mapping at the facade would give an Adapter a
  result-policy decision its Interface does not own.
- The refusal meaning stays with Qualification Evidence. The facade projects
  the already-mapped outcome into the versioned envelope and selects nothing.
- Declaring that mapping is a Maintenance Command Contract Interface and Result
  Vocabulary change. It is named here and gated: it is not authorized by this
  proposal, and it routes through the respecified Repository Qualification
  Contract named below, like every other count or surface change.

### Failure Class ownership

- The closed agent-facing Failure Class vocabulary has seven values and
  Maintenance Command Contract owns all seven. Ownership is decided here rather
  than left contested, because a vocabulary with two candidate owners has no
  owner.
- Six of them, `usage`, `refusal`, `transient`, `continuation`, `recovery`, and
  `unexpected`, are the primary meanings and are the only values a
  `MaintenanceError` may carry.
- The seventh value, `event_delivery`, is observation-only. It names Event
  Adapter refusal, exists only on `DiagnosticRecord.failure_class` and
  `EventRecord.failure_class`, and is carried by no `MaintenanceError`. The
  Maintenance Command Facade Adapter projects it onto those records and owns
  neither the token nor its meaning. No Adapter adds a value.
- The deciding evidence is Maintenance-owned executable source, not a
  preference. `src/modules/maintenance-command-contract/result-vocabulary.ts`
  already publishes the Next Action `events.inspect-configuration` with
  `failureClass: "event_delivery"` inside `failureNextActionProjection`, and
  that projection is exactly what the help discovery payload under
  `contract_id` `agent-plugin-kit.maintenance-command-result` serializes as a
  `next_actions` row. A Result Vocabulary value that Maintenance already
  declares and publishes cannot be owned by the Adapter that renders it. That
  makes Maintenance Command Contract the deepest single owner, and it dissolves
  the earlier reading of that payload as counter-evidence.
- One declaration site disagrees with this ownership today, and the required
  Interface amendment is named rather than assumed.
  `src/adapters/maintenance-command-facade/interface.ts` declares
  `type ObservableFailureClass = MaintenanceError["failureClass"] | "event_delivery"`,
  which adds the seventh value at the Adapter. At Implementation admission,
  `src/modules/maintenance-command-contract/interface.ts` declares the sealed
  seven-value Failure Class vocabulary together with the six-value subset that
  `MaintenanceError` carries; `ObservableFailureClass` becomes an alias for the
  Maintenance-owned seven-value vocabulary and adds nothing of its own; and the
  appended literal row in `failureNextActionProjection` is typed by that
  vocabulary rather than by a bare string literal.
- That amendment is gated, not authorized here. It changes a Module Interface,
  so it routes through the respecified Repository Qualification Contract named
  below. Whether the seven-value vocabulary is exported by name on the accepted
  `./maintenance-command-contract` subpath, which would add that name to the
  accepted subpath type-export catalog in
  `clean-fixture/personal-verification-profile/contract-tests/fixtures/plugin-consumer.ts`,
  or is reached through an indexed access on an already-exported type, is a
  deferred naming choice made in the accepted schema pass.
- Root `CONTEXT.md` and `CONTEXT-MAP.md` record this single owner in the same
  change as this proposal.

### Field-scoped vocabulary reading

- Several sealed vocabularies share serialized tokens. `completed` is a Result
  Code, a Transaction State, and an Event Record outcome. `previewed` is a
  Result Code and an Event Record outcome. `unknown` is a Transaction State, a
  Claim Status, and an Observation Kind.
- A token's meaning is determined only by the field that carries it. No
  consumer may reconcile, join, or infer one vocabulary's value from another
  field, and agreement between two such fields is never a contract.
- One Contract Test must prove that no cross-field reconciliation occurs, by
  producing a record whose colliding fields deliberately disagree and showing
  that each field keeps its own meaning.

### Schema versions

- Only explicit schema versions are supported for Public Serialized Values.
  The Maintenance-owned Wire Command carries `schemaVersion: 1`; that one
  version governs its command discriminator and every nested Wire Fragment.
  Plugin Payload Production, Release and Git Engine, Harness Journeys, and
  Canary Qualification fragments do not gain independent version keys merely
  because their validators participate in Maintenance composition.
- Three existing approval documents remain independently versioned Nested
  Public Serialized Values: `ReleaseCandidateApproval`,
  `ClaudeTransitionApproval`, and `CodexTransitionApproval`, each with its
  current owner-required `schemaVersion: 1`. Their accepted CLI files keep that
  field. Wire Command version 1 explicitly accepts only approval version 1.
- Outer and nested version failures are distinct. An unknown Wire Command
  version is a Maintenance-owned structured refusal before nested validation.
  Under recognized Wire Command version 1, an unknown approval version is an
  owner-mapped nested-value refusal composed by Maintenance. Neither failure
  triggers migration, fallback, trusted binding, inspection, or effects.
- A Wire Fragment is never interpreted without its enclosing Wire Command
  version. A Nested Public Serialized Value is never treated as a Wire Fragment
  and retains its independent carrier. If another owner-local value later
  crosses a different Seam independently, that new Public Serialized Value must
  earn its own explicit version carrier.
- Existing egress values keep the field spelling their Interface already uses:
  `schema_version` on Facade records and `schemaVersion` on Maintenance and
  Qualification Evidence values. Unifying that spelling would change an
  Interface and is not proposed here.
- An unknown Wire Command or independently versioned value receives a
  structured refusal. A newly supported version requires a separate schema and
  deliberate union at the owner of that version carrier. No automatic
  migration, upgrade, or fallback is accepted.

### Dependency Locality and Git-distributed resolution

Resolution ownership is decided here rather than deferred to a hoisting
question, because the resolution facts are already knowable.

- The root Package Identity declares Zod as an exact-version production
  dependency. Every Owner Manifest whose owner imports Zod declares the same
  exact version. Both statements must hold; neither alone is sufficient.
- The reason is that Owner Manifests are private and never published, while
  the root Package Identity is what a Git-installing Plugin Consumer resolves.
  `bunfig.toml` pins `[install] auto = "disable"`, so no auto-install rescues
  a production dependency the root manifest does not declare.
- Version agreement is exact string agreement across every declaring manifest.
  No range, no resolution alias, and no Bun catalog is accepted; catalogs
  remain absent under the intentional RED contract.
- This deliberately amends ADR 0002. That decision reserved third-party
  production dependencies to the Source Tree owner that needs them and used
  `@logtape/logtape` as the precedent for facade-only ownership. Root now also
  declares Zod, for the distribution reason above. The earlier claim that
  "ADR 0002 dependency Locality is applied, not amended" was wrong and is
  withdrawn. ADR 0002 gains the matching amendment note at acceptance.
- Admission Bootstrap stays dependency-free, declares no Zod, imports no
  schema, and must be unable to resolve Zod. That property is already machine
  enforced and is proved again by a Clean Fixture non-resolution control.
- Resolution assumes no hoisting. Clean Fixture proof must perform a
  production-only install and execute a real parse through each owner.
- Bundling is an explicit artifact choice. It is not an implicit guarantee,
  and it is not decided here.
- Exact-version agreement has no machine check today. Adding one is part of
  the respecified Repository Qualification Contract named below, not a promise
  made by this decision.

### Logical Record Correlation

- The Kit claims only the within-run correlation invariants carried by records
  the caller already captured. No replayable or reconstruction property is
  introduced.
- The Maintenance Command Facade Adapter Interface owns these wire-level
  invariants because it already owns Diagnostic Record and Event Record. It
  creates no reconstruction operation, reducer, root TypeScript export, or
  retained state owner.
- Callers and Contract Tests inspect caller-captured records directly. A
  test-owned reducer is not production proof and cannot become the contract
  surface.
- Correlation orders only observed records. `sequence` is unique and
  monotonic for each distinct Logical Record within one `run_id`, across both
  Diagnostic Records and Event Records. Two distinct Logical Records cannot
  share a sequence within one run.
- A Diagnostic Record's logical identity is its `run_id` and `sequence` pair.
  The facade assigns that pair once and never reassigns it.
- `DiagnosticPipeline.reset()` discards buffered records without reallocating,
  rewinding, or renumbering `sequence`. The accepted observability evidence
  for that is the post-reset sequence pair `[2, 3]`: the discarded record keeps
  its number and the next record continues from where the run had reached.
- Gaps are allowed, are never filled by inference, and have named accepted
  causes: a record dropped by the bounded 250-record buffer, which also emits
  exactly one truncation record that is itself a Logical Record with its own
  sequence; a record suppressed by the active Diagnostic Mode; an Event Record
  refused at the Event Adapter Seam; and a caller-owned sink that drops what
  it received.
- A repeated observation of the same logical Event Record preserves its
  original `event_id` and `sequence` and is therefore a duplicate, not a
  second Logical Record.
- Duplicates have one named producer, and it is never the Kit.
  `EventAdapter.accept` is invoked exactly once per Logical Event Record.
  Duplicate observations arise only in caller-owned territory: the caller's
  sink, its transport, or an `EventDelivery` second attempt, which redelivers
  the same Logical Record rather than creating a new one.
- The primary command envelope owns terminal outcome. Event Acceptance
  reports only the synchronous result of `EventAdapter.accept` and supplies
  no delivery, settlement, terminal-outcome, or completeness claim.
- Logical Record Correlation claims no completeness. A caller-captured record
  set is evidence only of what the caller captured, never proof that the
  capture was whole.
- `sequence` alone determines within-run ordering. Identifiers are opaque and
  timestamps are observational; neither orders a run.
- The Maintenance Command Facade Adapter Interface owns future injected time
  and identifier Seams for deterministic record production under proof. The
  existing `EventDeliveryClock` is a delay clock, not a time source. Exact
  Seam names and shapes remain deferred; neither becomes a root export.
- The Kit retains no correlation state beyond producing each already-redacted
  record. Existing streams and sinks remain caller-owned, and persisted
  retention is zero days. There is no reconstruction or persistent replay of
  any kind.

### Event identity

- `event_id` provides logical identity and correlation only.
- Opacity is a consumer obligation, not a producer guarantee. A consumer must
  not parse, split, or derive `run_id`, `sequence`, or ordering from
  `event_id`. The producer may derive it, and today's pinned fixture value
  `contract-help-literal.2` is exactly such a derivation, so a rule stated as
  a producer guarantee would already be false.
- One Contract Test must use a non-derived `event_id` and prove that
  correlation, ordering, and duplicate identity still hold.
- A retry reuses the same `event_id` and the original `sequence`, so
  duplicate records may be observed.
- The Maintenance `idempotencyKey` carried by `NextAction` and
  `MaintenanceError` remains unrelated command-retry metadata. It is not an
  event deduplication key.

### Public process and repair meaning

- The existing public process split remains authoritative: deterministic
  machine envelopes use stdout, structured redacted diagnostics use stderr,
  and Event Adapter records use their caller-owned sink. Human text remains
  inside the machine envelope rather than becoming a competing stdout mode.
- Existing Result Code and Exit Code ownership, Command Preview, Transaction
  State, Retry Safety, and one Next Action remain with Maintenance Command
  Contract. This decision creates no competing error, repair, or exit
  vocabulary.
- `unchanged`, `completed`, `partially-completed`, and `unknown` remain the
  countable transaction outcomes. A command-specific repair may earn
  repetition safety through its governing Interface and Contract Tests, but
  this decision makes no general effect-idempotency promise for commands or
  for events.
- Event delivery attempts do not create new logical Event Records. Attempt
  count remains an Event Delivery result, not an Event Record field. Step,
  duration, token usage, and model-quality fields remain absent until an
  owning Interface earns them.

## Non-Claims

This proposal claims none of the following, at any Proof Layer:

- durable replay of a completed run, and persistent replay of any kind
- event delivery, delivery receipt, awaited settlement, or any post-acceptance
  transport outcome
- deduplication or exactly-once behaviour
- effect idempotency in general, for events and for commands alike
- completeness of any caller-captured record set
- retained state, durable queue, persistent telemetry, or analytics
- raw production event or log storage
- cross-run equality or ordering of identifiers or timestamps
- bundling, publication, or package-manager-wide resolution
- semantic truth: a successful parse proves shape and version agreement only.
  It never proves that a value is accurate, current, complete, or produced by
  the owner it names.
- capability issuance from serialized input. No JSON, schema, assertion, or
  caller-supplied field can create `AdmittedIdentity` or
  `ProtectedCanaryAuthority`.

## Implementation admission prerequisites

Two prerequisites must be satisfied before any manifest, schema, Interface, or
test change is made. Neither is optional and neither is a formality.

1. Current Repository Verification under
   `docs/adr/0005-simple-repository-quality-ownership.md`. Owner Manifests and
   their Contract Tests own dependency and schema changes; Repository
   Verification owns exact cross-owner version agreement and the root Zod
   mirror. The implementation checkpoint inventories
   every Interface and contract amendment named here: Maintenance-owned
   Failure Class vocabulary; Maintenance-owned Qualification Refusal Code to
   Result Code and Exit Family mapping; the `EvidenceCell` and Reduced Claim
   discriminated unions; `QualificationEvidence.reduce` returning
   `QualificationOutcome`; new Qualification Evidence accepted-subpath type
   names; the Maintenance-owned versioned Wire Command, unversioned Wire
   Fragments, retained independently versioned approval inputs, explicit
   outer-versus-inner version compatibility, and trusted command-binding split; the
   Canary Authority Source Seam and protected-file reference; nullable
   `NextAction.commandId`; private owner-local validator siblings and their
   installed inventory; the stderr `error` object version carriers; and the two
   named TypeScript strictness repairs. No unnamed count or source-closure
   change is admitted.
2. A matching respecification of the accepted P3 Full Test Design's
   Qualification Evidence brief. That brief pins the reducer as the place
   where a cell is validated without trusting `assertedStatus`, and pins the
   exact two-file, fourteen-test split. This decision keeps the truth table
   and moves its enforcement point to the owner's serialized parse, so the
   brief must be respecified before the first test change rather than
   silently diverged from.

## Implementation admission proof gate

Implementation admission requires four independently observable proof groups.
Each names its owner, its focused selector, and at least one disposable
perturbation that must turn that group RED.

1. **Owner-local schema contracts.** Owner: each of the seven Interface
   owners. Selector: that owner's admitted focused Contract Test script.
   Proves every owner fragment under Maintenance Wire Command version 1 and
   every independently versioned owner value; all three version-1 approvals are
   accepted only under the explicit version-1 outer variants; an unknown outer
   version is refused before nested parsing; an unknown nested approval version
   under recognized outer version 1 receives the governing owner-mapped refusal;
   an extra declared envelope key is refused;
   a wrong field type is refused
   without coercion or defaulting, no raw input or raw Zod detail escapes,
   invalid egress fails closed, the bidirectional equivalence assertion holds,
   the JSON round trip holds, and no cross-field vocabulary reconciliation
   occurs. The Maintenance selector additionally proves every JSON-backed
   command's unbranded Wire Command, exactly-once validator composition, one
   trusted bind after successful Admission, candidate agreement, inspected-plan
   acceptance before authority resolution, and the impossibility of supplying
   either protected capability on the wire.
   Perturbations: admit one extra key at strict ingress; enable one coercion;
   widen one template-literal schema to `string`; spell one optional key so it
   can carry `undefined`; leak raw validation detail into a refusal; accept a
   serialized `identity` or `authority`; bind a raw `CandidateIdentity`; bypass
   or invoke one nested validator twice; bind before Admission succeeds;
   resolve authority before candidate agreement or inspected-plan acceptance;
   interpret a Wire Fragment without its enclosing version; strip an existing
   approval version; accept an approval version not listed for outer version 1;
   or inspect a nested value before refusing an unknown outer version.
2. **Evidence-state contracts.** Owner: Qualification Evidence. Selector:
   `bun run test:intentional-red:qualification-evidence`. Proves every
   accepted Evidence Cell and Reduced Claim variant, per-cell mismatch refusal
   at the serialized parse of `unknown`, and every Qualification Refusal Code
   meaning through `QualificationOutcome`. Perturbations: pair a status with a
   forbidden observable; give a skip cell a Proof Layer; accept a zero-cell
   claim instead of refusing it; accept an out-of-profile claim; let a
   resolving cell resolve from an incomparable Proof Layer.
3. **Logical Record Correlation contracts.** Owner: Maintenance Command Facade
   Adapter. Selector:
   `bun run test:intentional-red:maintenance-cli:observability`. Proves one
   shared within-run sequence space, gaps remaining gaps, duplicate
   observations preserving identity and sequence, terminal outcome only from
   the primary envelope, no reconstruction operation or retained state owner,
   and an independently observable redaction step order. Tests invoke the
   Facade and inspect the records they capture directly. Perturbations: sort by
   timestamp; infer a missing record; renumber sequence at `reset()`; convert
   a retry into a second Logical Record; treat Event Acceptance as terminal;
   derive ordering from `event_id`; substitute a test-owned reducer for direct
   Facade evidence.
4. **Public-process and Clean Fixture contracts.** Owner: Clean Fixture, with
   the facade for stream and envelope bytes. Selector:
   `bun run test:intentional-red:clean-fixture` together with
   `bun run test:intentional-red:maintenance-cli:process`. Proves a
   production-only install with no hoisting assumption, one real parse through
   each schema owner, private validator sibling installation without a new
   package export, exact stdout, stderr, Exit Code, and redaction bytes. It also
   proves that `--authority <FILE>` passes only an opaque reference to the
   Canary Authority Source Seam and never parses file contents as authority.
   The recording Adapter proves the fixed order `parse`, `candidate-agreement`,
   `inspect`, `plan-acceptance`, `authority-resolution`, `bind`, `qualify`.
   Perturbations: remove Zod from the root Package Identity's production
   dependencies and require the production-only install to fail, which is the
   Locality control; make Admission Bootstrap resolve or import Zod and
   require both the static rejection and the public-process sentinel to fail,
   which is the Admission non-resolution control; expose one private validator
   through the package exports map; parse an authority file as a capability;
   drift the exact Zod version between the root manifest and one Owner Manifest.

That gate proves serialized-value validation, discriminated public state, and
Logical Record Correlation. It proves neither reconstruction, durable replay,
nor delivery. Every path above stays absent until its owning gate under the
intentional RED rule in `AGENTS.md`.

One existing defect must be repaired inside group 3 rather than carried
forward: the current redaction Contract Test asserts `redactionContract.order`
against itself, so the pinned step order is not independently observable. The
repaired test must compare an order the pipeline actually produced against the
literal contract order.

## Failure-to-fixture promotion

This is a decision, not an open question. It is owned by the accepted P3 Full
Test Design and restated here in the terms this contract needs.

One observed public-process failure becomes durable regression evidence only
through this exact route, in order:

1. Inspect the private receipt.
2. Classify one concrete failure.
3. Remove private, secret, incidental, and unstable data.
4. Run the sanitization verifier over the candidate fixture.
5. Promote the minimal sanitized value into the owning owner's
   `contract-tests/fixtures/` directory.
6. Add one focused regression through the owning Interface or public process,
   whose expected value is produced independently of the Implementation whose
   claim it supports.
7. Rerun the broader contract suite.

- The sanitization verifier carries two negative controls: a planted secret
  and a planted private path. Either surviving promotion must turn the
  promotion proof RED. A verifier that cannot fail proves nothing.
- An LLM judgment is never the contract oracle, and no LLM-as-judge oracle,
  persistent telemetry, analytics, durable event delivery, or durable replay
  enters through this route.
- Raw receipts remain private XDG state. The promoted fixture contains no
  transcript, credential, private path, raw event stream, or mutable
  remote-state snapshot.
- Any new fixture path and the resulting test-count change are routed through
  the respecified Repository Qualification Contract under ADR 0003, like every
  other count change.

## Known residual risks

Recorded so that acceptance is informed rather than optimistic:

- `DiagnosticRecord.message` is free text and cannot be proved redacted by
  schema alone.
- Exact Zod version agreement across the root manifest and every declaring
  Owner Manifest has no machine check until the respecified Verification
  Transition Contract adds one.
- `EvidenceCell.resolves` referential integrity is unreachable by a per-cell
  schema and depends entirely on the multi-cell rules inside `reduce`.
- Adding Zod changes installed content, while `installed dependency freedom`
  is already a recorded Non-Claim of the intentional RED contract. The two do
  not contradict, but the Non-Claim's wording must be reread at acceptance.
- Parse cost and startup weight at the Admission-adjacent binary are
  unmeasured.
- The Admission-to-Maintenance binding step is the Kit's capability trust
  boundary. Until its capability-negative and exactly-once composition tests
  are admitted, a binder that accepts a parsed `CandidateIdentity` as admitted
  could evade ordinary schema proof.
- Failure Class ownership is decided but not yet expressed in source. Until the
  named Interface amendment is admitted,
  `src/adapters/maintenance-command-facade/interface.ts` still declares
  `event_delivery` locally, so the executable source and this decision disagree
  on the declaration site while agreeing on the owner.

## Deferred choices

Named and deliberately unresolved:

- the exact Zod 4 version string, pinned identically in every declaring
  manifest at Implementation admission
- the exact Qualification Refusal Code tokens
- the exact Result Code and Exit Family each Qualification Refusal Code maps to
- the exact Maintenance-owned Failure Class vocabulary type name, and whether
  it is exported on the accepted `./maintenance-command-contract` subpath or
  reached through an indexed access
- the exact `unknown` sub-discriminator key and its two tokens
- the exact private owner-local validator sibling filename and exported names
  used only by repository-relative composition
- the exact Wire Command type names and trusted command-binding call shape
- the exact Canary Authority Source Seam and protected-file reference type
  names; the accepted meaning of `--authority <FILE>` is not deferred
- the exact injected time and identifier Seam names and shapes
- the reviewed `agent` payload version-key spelling
- downstream GitHub Issue dependency and status changes
- schema, test, manifest, dependency, and lockfile Implementation

## Consequences

- Validation, TypeScript type ownership, and refusal meaning stay with the
  Module or Adapter that already owns the serialized value. Ownership remains
  deep and singular, and orchestration owns no tool contract.
- Logical Record Correlation stays a Facade wire-contract property. It is not a
  reconstruction operation, Module, service, reducer, root export, queue, or
  retained state owner.
- A serialized value has one runtime validator and one declared type, proved
  equivalent at compile time, so no second type source appears and no declared
  type is silently widened.
- Wire Commands contain ordinary validated data only. Maintenance Command
  Contract binds the already-admitted identity and Canary Qualification's
  protected-source authority after validation; neither capability is
  serializable or structurally manufactured.
- Qualification Evidence gains a refusal channel it does not have today, so
  `QualificationEvidence.reduce` changes shape at Implementation and the
  accepted subpath type-export catalog changes with it.
- ADR 0002 is amended, not merely applied. Root and every importing owner
  declare Zod at one exact version.
- ADR 0005's lifecycle-neutral Repository Verification remains the manifest
  and filesystem owner. Schema work changes it only when a new cross-owner
  dependency relationship changes one of its four accepted responsibilities.
- Qualification Refusal Code to Result Code and Exit Family mapping stays with
  Maintenance Command Contract, so the Maintenance Command Facade Adapter gains
  no result policy and keeps projecting only what an owner already decided.
- Failure Class has one owner. Maintenance Command Contract owns all seven
  values; the facade declaration site is amended at Implementation admission
  rather than left as a second owner.
- Root `CONTEXT.md` and `CONTEXT-MAP.md` record the corrected Failure Class
  ownership, the Maintenance-owned refusal mapping, and the one-validator,
  one-declared-type Public Serialized Value rule in the same change as this
  decision.
- The Accepted Decision index in
  [`docs/agents/domain.md`](../agents/domain.md) includes the ADR 0004 row.
  [`docs/agents/README.md`](../agents/README.md) indexes agent documents
  rather than Accepted Decisions and needs no change.
- Admission Bootstrap keeps its dependency-free property and cannot resolve or
  import Zod. Release and Git Engine's declaration-only `interface.ts` remains
  inside the pinned Admission source closure while its private validator sibling
  remains outside that closure.
- Qualification Evidence keeps Proof Layer non-promotion. A passing parse is
  in-process evidence and never promotes a Clean Fixture, hosted, or
  Fresh-Native claim.
- Accepting this ADR admits no downstream implementation ticket. The
  prerequisite gate still requires accepted code, proof, and issue evidence.
