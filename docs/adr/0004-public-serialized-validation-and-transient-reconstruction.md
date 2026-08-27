---
status: proposed
---

# Own Public Serialized Validation and Claim Only Transient Reconstruction

This is a proposal for review, not an Accepted Decision. It records how the
existing public TypeScript surfaces should own serialized-value validation,
state correlation, and exhaustive handling, and what the Kit Repository may
claim about rebuilding a run from observed records.

It constrains three existing Interface owners and creates no new owner:

- `src/modules/maintenance-command-contract/interface.ts` owns command,
  result, failure, retry, transaction, Next Action, and Result Code meaning.
- `src/adapters/maintenance-command-facade/interface.ts` owns the public
  process observation, Diagnostic Record, Event Record, and Event Acceptance
  Interface.
- `src/modules/qualification-evidence/interface.ts` owns Evidence Cell,
  Verification Profile, reduction, and Qualification Result meaning.

It contains no schema, no Implementation, and no test.

## Proposed decision

### TypeScript boundary

- Repository TypeScript keeps `strict`, `noUncheckedIndexedAccess`,
  `noFallthroughCasesInSwitch`, and `noImplicitOverride` and adds
  `exactOptionalPropertyTypes` and `noImplicitReturns` before public contract
  Implementation begins. Any unrelated diagnostic stops that bounded
  transition rather than authorizing broad repair.
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
- These variants preserve the accepted reduction truth table, profile order,
  Proof Layer non-promotion, Non-Claims, receipt digests, and Evidence Cell
  identifiers. They add no caller-selected final Claim Status.

### Validation ownership and placement

- Each of the three owners above declares owner-local Zod schemas limited to
  its own public serialized values. No fourth owner and no shared schema
  package is created.
- Validation runs once at untrusted ingress and once at public serialized
  egress. Internal typed calls between owners are not revalidated.
- Each owner exports its strict schemas from its existing `interface.ts` and
  derives the corresponding TypeScript type with `z.infer`, so one serialized
  value never gains a second type source.
- Domain-only internal types remain ordinary TypeScript and gain no schema.
- The Maintenance Command Facade Adapter Interface stays outside root exports
  under ADR 0002. Its schemas are owner-private and add no caller surface.

### Dependency Locality

- Every owner that imports Zod pins it as a production dependency in that
  owner's Owner Manifest, under the rule accepted in ADR 0002.
- Admission Bootstrap remains dependency-free and imports no schema.
- Resolution assumes no hoisting. Clean Fixture proof must perform a
  production-only install and execute a real parse through each owner.
- Bundling is an explicit artifact choice. It is not an implicit guarantee,
  and it is not decided here.

### Refusal and failure meaning

- Invalid ingress becomes an owner-mapped structured refusal that reuses the
  stable existing Result Code and Exit Code semantics. It introduces no new
  Failure Class.
- Invalid egress is a fail-closed Implementation contract failure, not a
  caller error.
- Raw input and raw Zod error detail remain private. Neither reaches a
  Command Preview, a Command Result, an Event Record, or a Diagnostic Record.

### Strictness

- Public schemas are validation-only. They reject unknown fields and perform
  no coercion, no defaults, no transforms, and no silent stripping.
- Strictness applies to declared envelope keys. `CommandPreview.agent`,
  `CommandResult.agent`, and `FacadeInvocation.environment` remain
  deliberately open records whose interiors are not schema-owned.

### Schema versions

- Only explicit schema versions are supported. Each owner keeps the field
  spelling its Interface already uses: `schema_version` on the facade wire
  records, `schemaVersion` on the Maintenance and Qualification Evidence
  envelopes. Unifying that spelling would change an Interface and is not
  proposed here.
- An unknown version value receives a structured refusal.
- A newly supported version requires a separate owner-local schema and a
  deliberate union. No automatic migration, upgrade, or fallback is accepted.

### Transient reconstruction

- The Kit claims only transient within-run reconstruction from records the
  caller already captured. No positive replayable property is introduced.
- The Maintenance Command Facade Adapter Interface owns this wire-level
  semantic because it already owns Diagnostic Record and Event Record. It
  creates no root TypeScript export and no retained reconstruction service.
  An independent caller or Contract Test may reduce captured public records;
  the production Kit need not expose a reconstruction function.
- Reconstruction orders only observed records. `sequence` is unique and
  monotonic for each distinct logical record within one `run_id`, across both
  Diagnostic Records and Event Records. A repeated observation of the same
  logical Event Record preserves its original `event_id` and `sequence` and
  is therefore a duplicate, not a second logical record. Gaps are allowed and
  are never filled by inference.
- The primary command envelope owns terminal outcome. Event Acceptance
  reports only the synchronous result of `EventAdapter.accept` and supplies
  no delivery, settlement, terminal-outcome, or completeness claim.
- `sequence` alone determines within-run ordering. Identifiers are opaque and
  timestamps are observational; neither orders a run.
- The Maintenance Command Facade Adapter Interface owns future injected time
  and identifier Seams for deterministic record production under proof. The
  existing `EventDeliveryClock` is a delay clock, not a time source. Exact
  Seam names and shapes remain deferred; neither becomes a root export.
- Reconstruction is a pure operation over caller-supplied, already-redacted
  in-memory records. The Kit retains no reconstruction state, existing
  streams and sinks remain caller-owned, and persisted retention is zero
  days.

### Event identity

- `event_id` provides logical identity and correlation only.
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
  this decision makes no general effect-idempotency promise.
- Event delivery attempts do not create new logical Event Records. Attempt
  count remains an Event Delivery result, not an Event Record field. Step,
  duration, token usage, and model-quality fields remain absent until an
  owning Interface earns them.

## Non-Claims

This proposal claims none of the following, at any Proof Layer:

- durable replay of a completed run
- event delivery, delivery receipt, or awaited settlement
- deduplication or exactly-once behaviour
- event effect idempotency
- retained state, durable queue, persistent telemetry, or analytics
- raw production event or log storage
- cross-run equality or ordering of identifiers or timestamps

## Implementation admission proof gate

Implementation admission requires three Proof Layers, each with negative
controls:

- Owner-local Contract Tests for schema behaviour and transient
  reconstruction semantics.
- Public-process tests for real CLI streams, envelopes, exits, redaction, and
  refusal.
- Clean Fixture tests for production-only Zod resolution and an actual parse
  through each owner.

That gate proves serialized-value validation, discriminated public state, and
transient reconstruction. It
proves neither durable replay nor delivery. Every path above stays absent
until its owning gate under the intentional RED rule in `AGENTS.md`.

## Test Design acceptance question

Open question for the owning Test Design: what exact process promotes one
observed public-process failure into a sanitized, minimal, code-owned
deterministic fixture?

The answer must preserve this sequence in order:

1. Inspect real evidence.
2. Classify one concrete failure.
3. Remove private, secret, incidental, and unstable data.
4. Promote a minimal fixture.
5. Add a focused regression through the owning Interface or public process.
6. Rerun the broader contract suite.

Raw receipts remain private XDG state. The promoted fixture is deterministic
regression evidence. The answer must not introduce an LLM-as-judge oracle,
persistent telemetry, analytics, durable event delivery, or durable replay.

## Deferred choices

Named and deliberately unresolved:

- the exact Zod version
- the exact stable validation Result Codes
- the exact schema export names
- the exact injected time and identifier Seam names and shapes
- any owner-local reconstruction input or result type names
- downstream GitHub Issue dependency and status changes
- schema, test, manifest, dependency, and lockfile Implementation

Two questions surfaced by this review and left open:

- Zod would be the first third-party dependency declared by more than one
  Owner Manifest, which is the exact condition ADR 0002 named for making
  version agreement enforceable. The enforcement mechanism is not selected.
- Owner Manifests are private and never published, while the root Package
  Identity is Git-distributed. Whether a Plugin Consumer resolves Zod without
  hoisting is what the Clean Fixture production-only install must falsify
  before acceptance.

## Consequences

- Validation, TypeScript type ownership, and refusal meaning stay with the
  Module or Adapter that already owns the serialized value. Ownership remains
  deep and singular, and orchestration owns no tool contract.
- Transient Reconstruction stays a Facade wire-contract property, not a new
  Module, service, root export, queue, or retained state owner.
- The schema becomes the single source of type truth for a serialized value,
  so no second type source appears beside an existing Interface.
- ADR 0002 dependency Locality is applied, not amended. Its version-agreement
  condition becomes live once Zod enters more than one Owner Manifest.
- Admission Bootstrap keeps its dependency-free property, so Admission is
  unaffected by this proposal.
- Qualification Evidence keeps Proof Layer non-promotion. A passing parse is
  in-process evidence and never promotes a Clean Fixture, hosted, or
  Fresh-Native claim.
- Accepting this ADR admits no downstream implementation ticket. The
  prerequisite gate still requires accepted code, proof, and issue evidence.
