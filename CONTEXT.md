# Agent Plugin Kit

This context names the shared plugin-maintenance system, its ownership roles,
its seven deep Modules, and the evidence needed to trust one immutable
Candidate Identity across Plugin Repositories.

## Language

### Design language

**Module**:
Anything with one Interface and one Implementation, at any scale.
_Avoid_: Component, service, unit

**Interface**:
Everything a caller must know to use a Module correctly, including invariants,
ordering, error meanings, required configuration, and observable results.
_Avoid_: API, signature, contract when referring only to a type declaration

**Implementation**:
The behaviour hidden inside a Module and owned behind its Interface.
_Avoid_: Adapter, when the role at a Seam is what matters

**Depth**:
The Leverage a Module provides for the amount of Interface a caller must learn.
A deep Module hides substantial behaviour behind a small Interface.
_Avoid_: Implementation size, line-count ratio

**Seam**:
The location where a Module's Interface permits behaviour to vary without an
edit at that location.
_Avoid_: Boundary, extension point

**Adapter**:
A concrete participant that satisfies an Interface at a Seam.
_Avoid_: Implementation, when the replaceable role is what matters

**Leverage**:
The capability callers gain from one small Interface across many uses.

**Locality**:
The concentration of change, knowledge, defects, and verification in one
Module rather than across its callers.

**Deep Module**:
A Module whose small Interface provides high Leverage and keeps its
Implementation knowledge local.
_Avoid_: Large component, shared service

### Domain language and repository knowledge

**Ubiquitous Language**:
The canonical terms used consistently by maintainers, Interfaces,
Implementations, Adapters, evidence, and Repository Guidance.
_Avoid_: Naming convention, terminology list

**Domain Context**:
A coherent owner of distinct Ubiquitous Language and Accepted Decisions that
may govern one Module, several Modules, or no Module.
_Avoid_: Module, folder, package

**Context Map**:
The navigation owner that routes a domain question to its governing Domain
Context, Accepted Decision owner, Module Interface, and Implementation owner.
_Avoid_: Folder index, Module map

**Repository Topology**:
The arrangement of repository owners whose names and locations follow the
Ubiquitous Language and preserve Module Locality.
_Avoid_: Folder layout, code organization

**Source Tree**:
The package-source owner containing the Kit Repository Interface, Admission
Bootstrap, the seven Deep Modules, and production Reusable Workflow Adapter
source.
_Avoid_: Source folder, code bucket, shared source

**Owner Manifest**:
The private, never-published manifest that gives one Source Tree owner a
tooling address for its Contract Tests and its owner-local dependencies. It
adds no Interface, Seam, ownership, or Package Identity; the root Package
Identity remains the only caller surface.
_Avoid_: Workspace package, npm package, sub-package, second package identity

**Repository Guidance**:
The non-executable instructions that route agents and maintainers to the
correct tracker, Domain Context, Accepted Decisions, and ownership rules.
_Avoid_: Miscellaneous documentation, contributor notes

**Repository Knowledge**:
The non-executable owner that keeps Repository Guidance and Accepted Decisions
local rather than scattering them through Modules and Adapters.
_Avoid_: Docs bucket, wiki, notes

**Repository Quality Tooling**:
The repository-local Module that owns deterministic changed-code quality,
comparison-base selection, repository transition policy, tool-result
interpretation, and repair guidance across the Kit Repository. It stays
outside the Source Tree because it governs repository maintenance rather than
caller-visible Package Identity.
_Avoid_: Lint script, Fallow wrapper, Source Tree Module

**Repository Qualification**:
The Repository Quality Tooling-owned declaration of the exact paths, source
closure, proof groups, and expected RED or GREEN states permitted at one
reviewed repository transition. Clean Fixture may supply independent evidence
to it but does not own repository policy.
_Avoid_: Test count snapshot, Clean Fixture contract, implementation ticket

**Accepted Decision**:
A reviewed, durable choice that constrains more than one change and records
the real trade-off that selected it.
_Avoid_: Plan, preference, status note

### Repository and ownership roles

**Kit Repository**:
A repository that owns generic plugin-maintenance Modules, Admission Bootstrap,
Reusable Workflow Adapters, and Qualification Evidence. Plugin Repositories
consume it while retaining Product Behaviour and Plugin Payload ownership.
_Avoid_: Shared repository, common library

**Plugin Repository**:
A repository that owns one plugin's source, Product Behaviour, Plugin Payload,
release history, and use of the Kit Repository.
_Avoid_: Plugin, when repository ownership matters

**Plugin Consumer**:
A Plugin Repository that invokes an Admitted Identity from the Kit Repository
while retaining its own Product Behaviour, Plugin Payload, and release history.
_Avoid_: Downstream client, thin wrapper

**Plugin Payload**:
The complete distributable content representing one plugin version across its
supported Harnesses.
_Avoid_: Bundle, package, plugin folder

**Reference Implementation**:
The accepted immutable My Second Brain Source Identity used to characterize
Generic Maintenance Candidates before their ownership moves to the Kit
Repository.
_Avoid_: Latest main, template source

**Legacy Template Evidence**:
The immutable Agent Plugin Template Release Identity retained for compatibility
and regression evidence, not as a competing maintenance owner.
_Avoid_: Reference implementation, active template

**Successor Template**:
The future product-neutral Plugin Repository scaffold derived only after a
proved Plugin Consumer exposes the residual shape the Kit Repository cannot
supply.
_Avoid_: Legacy template, Kit Repository

**Generic Maintenance Candidate**:
Behaviour observed in the Reference Implementation that may earn shared
ownership only after its Interface and product exclusions are proved.
_Avoid_: Shared code, reusable helper

**Product Behaviour**:
Behaviour whose meaning belongs to one Plugin Repository and remains owned by
that Plugin Repository.
_Avoid_: Generic maintenance

### Identity and admission

**Repository Identity**:
The canonical source origin of one Plugin Repository or the Kit Repository.
_Avoid_: Remote name, checkout path

**Full Commit Pin**:
The complete immutable Git commit identifier selected for one Source Identity.
_Avoid_: Branch, tag, short SHA, latest

**Source Identity**:
One Repository Identity paired with one Full Commit Pin.
_Avoid_: Version, branch identity

**Candidate Identity**:
One Source Identity together with its Release Identity, Package Identity, and
Workflow Identity, used to bind every observation.
_Avoid_: Build number, mutable ref

**Candidate Lineage**:
The agreement that Source Identity, Release Identity, Package Identity,
Workflow Identity, installed bytes, hosted run, platform, and receipt
observations belong to one Candidate Identity.
_Avoid_: Source Provenance, when cross-layer agreement is meant

**Source Provenance**:
Evidence that the source of a Candidate Identity matches its Repository
Identity and Full Commit Pin.
_Avoid_: Candidate Lineage, origin string alone

**Release Identity**:
An immutable release reference whose published source resolves to one Full
Commit Pin.
_Avoid_: Version string, release branch

**Package Identity**:
The Git-distributed Kit Repository package resolved from one Candidate
Identity.
_Avoid_: npm package, archive name

**Workflow Identity**:
One reusable workflow identifier paired with the same Full Commit Pin as its
Package Identity.
_Avoid_: Workflow name, workflow branch

**Admitted Identity**:
A Candidate Identity whose Repository Identity, Source Provenance, Release
Identity, Package Identity, Workflow Identity, and Full Commit Pin agree
before Kit Repository Implementation executes.
_Avoid_: Trusted latest, installed version

**Admission**:
The fail-closed identity judgment owned by Release and Git Engine that produces
an Admitted Identity or an explicit refusal.
_Avoid_: Installation, checkout success

**Admission Bootstrap**:
The dependency-free mechanism through which a Plugin Consumer obtains or
refuses an Admitted Identity before Kit Repository Implementation executes.
Release and Git Engine remains the single owner of Admission meaning.
_Avoid_: Installer, setup hook, package lifecycle script

**Clean Fixture**:
An isolated Plugin Consumer example with independently controlled Source
Identity, Release Identity, Package Identity, Workflow Identity, and invocation
observations.
_Avoid_: Sample repository, production canary

### Deep Modules

**Plugin Payload Production**:
The Deep Module that owns validation, safe inventory, projection, dependency
closure, deterministic Plugin Payload production, packaging, and checksums.
_Avoid_: Build scripts, payload helpers

**Runtime Custody**:
The Deep Module that owns acquisition, verification, private cache publication,
repair, and execution of the one approved portable runtime.
_Avoid_: Runtime manager, setup runtime, second runtime tier

**Release and Git Engine**:
The Deep Module that owns Admission, readiness, immutable release binding, Git
convergence, publication preview, and repair decisions.
_Avoid_: Release scripts, Git helpers

**Maintenance Command Contract**:
The Deep Module that owns the sealed Command Vocabulary, Result Vocabulary,
parsing meanings, effect classification, rendering meanings, exits, retry
safety, recovery state, and continuation.
_Avoid_: CLI helpers, command registry

**Harness Journeys**:
The Deep Module that owns separately typed Claude and Codex inspection,
approval binding, state transition, verification, and exact recovery journeys.
_Avoid_: Host workflow, shared optional state

**Canary Qualification**:
The Deep Module that owns trusted target derivation, inert candidate
publication, protected authority, transport observation, hosted observation,
and candidate-bound qualification.
_Avoid_: Canary scripts, candidate-selected target

**Qualification Evidence**:
The Deep Module that owns evidence schema, Candidate Lineage, Proof Layer
ordering, Claim Status reduction, Skip Rationale accounting, Non-Claims, and
redaction.
_Avoid_: Proof report helpers, capability framework

**Reusable Workflow Adapter**:
A thin remote Adapter that exposes stable workflow inputs, outputs,
permissions, environments, checks, and one Full Commit Pin while leaving
deterministic policy in the governing Deep Module.
_Avoid_: Workflow Module, CI engine, shared workflow logic

### Commands and results

**Command Vocabulary**:
The sealed versioned set of maintenance commands and their meanings.
_Avoid_: Command registry, free-form action

**Maintenance Command**:
One member of the Command Vocabulary with a declared Effect Class.
_Avoid_: Task, operation, script

**Effect Class**:
The canonical classification of whether a Maintenance Command can inspect,
change repository-local state, or cause an external effect.
_Avoid_: Safety level, command kind

**Candidate Approval**:
A human-authorized value bound to one Candidate Identity, inspected state, and
expected effects.
_Avoid_: Confirmation flag, blanket permission

**Command Preview**:
The read-only result that binds a Maintenance Command to refreshed state,
expected effects, recovery meaning, and its Candidate Approval digest.
_Avoid_: Dry run, plan output

**Command Result**:
The structured outcome of one Maintenance Command, including completed and
remaining effects and one Next Action.
_Avoid_: CLI output, log

**Result Vocabulary**:
The versioned meanings shared by human and machine renderings of Command
Previews, Command Results, and refusals.
_Avoid_: JSON shape, response schema

**Transaction State**:
The Result Vocabulary value that says what durable transition state is known
after inspection or attempted effects.
_Avoid_: Progress, status string

**Retry Safety**:
The Result Vocabulary value that says whether repeating a Maintenance Command
is safe, unsafe, or requires fresh inspection.
_Avoid_: Idempotent, retryable

**Completed Effect**:
An effect independently known to have occurred for the bound Candidate
Identity.
_Avoid_: Attempted step, successful command

**Remaining Effect**:
An expected effect independently known not to have completed for the bound
Candidate Identity.
_Avoid_: Todo, unchecked step

**Next Action**:
The single actionable continuation carried by every Command Preview, Command
Result, or refusal.
_Avoid_: Hint, generic rerun

**Maintenance Command Facade Adapter**:
The single private Adapter that projects Maintenance Command Contract meaning
through the root Package Identity binary. It owns parsing and envelopes, but
no command or result policy.
_Avoid_: CLI module, command owner

**Diagnostic Adapter**:
The environmental Seam for structured stderr diagnostics and bounded
fingers-crossed buffering.
_Avoid_: Observability Module, logger owner

**Event Adapter**:
The environmental Seam for synchronous best-effort event acceptance.
_Avoid_: Event Module, durable queue

**Branch Station**:
One deterministic command and Result Code identity in the execution-only
catalog, with its controlling owner, reachability, and Independent Observable.
_Avoid_: Generic branch, test case

**Station Map**:
The projection of Branch Station declarations and real evidence without
synthetic coverage promotion.
_Avoid_: Coverage percentage, route registry

**Result Code**:
The stable lower-kebab machine discriminant for one meaning within the
versioned Result Vocabulary.
_Avoid_: Result Vocabulary

**Exit Code**:
The numeric public-process result produced for one accepted outcome or
containment path.
_Avoid_: Exit Class, Result Code

**Exit Family**:
The Result Vocabulary mapping that groups Result Codes under one Exit Code,
owner, envelope rule, and stable meaning.
_Avoid_: Exit Class, Failure Class

**Maintenance Outcome**:
The tagged owner result carrying one Result Code and Station ID with either a
Command value or Maintenance Error.
_Avoid_: Process envelope, inferred status

**Maintenance Error**:
The typed `MaintenanceCommandError` refusal or failure detail whose exit hint,
failure meaning, retry, recovery, and Next Action remain Maintenance-owned.
_Avoid_: Facade error, thrown exception

**Station ID**:
The deterministic `<command-slug>.<result-code>` identity of one Branch
Station.
_Avoid_: Event ID, test name

**Declared Branch Coverage**:
The catalog count and status including visible implementation-deferred and
declared-unreachable Branch Stations.
_Avoid_: Observed coverage, percentage

**Observed Branch Coverage**:
The count of required Branch Stations reconciled by qualifying `real_process`
evidence.
_Avoid_: Synthetic coverage, declared count

**Observation Provenance**:
The declared origin of Branch Station evidence as `real_process` or
`synthetic`. Only `real_process` evidence can satisfy Observed Branch Coverage.
_Avoid_: Source Provenance, Candidate Lineage

**Implementation-Deferred Branch**:
A real Branch Station whose owner Implementation is absent under Intentional
RED and whose Skip Rationale names the controlling owner, future selector, and
Non-Claim.
_Avoid_: Unreachable branch, omitted branch

**Failure Class**:
The closed agent-facing failure vocabulary of seven values, owned entirely by
Maintenance Command Contract. Six are primary meanings, `usage`, `refusal`,
`transient`, `continuation`, `recovery`, and `unexpected`, and are the only
values a Maintenance Error carries. The seventh, `event_delivery`, is
observation-only: it names Event Adapter refusal, appears only on a Diagnostic
Record or Event Record, and is carried by no Maintenance Error. The Maintenance
Command Facade Adapter projects Failure Class onto those records and owns no
value. No Adapter adds a value.
_Avoid_: Exit Family, error message, an Adapter-owned failure class

**Diagnostic Record**:
The closed redacted stderr projection accepted by the Diagnostic Adapter Seam.
_Avoid_: Raw logger record, primary envelope

**Event Record**:
The closed redacted event projection accepted synchronously by the Event
Adapter Seam.
_Avoid_: Diagnostic Record, arbitrary payload

**Event Acceptance**:
The synchronous `accepted` or `refused` result of `EventAdapter.accept`,
observed without waiting for event delivery or settlement.
_Avoid_: Delivery receipt, awaited transport

**Public Serialized Value**:
A version-controlled value crossing an untrusted ingress or serialized egress
at an existing Interface. Its schema version is carried either by the value's
own envelope or by the enclosing Wire Command under which a Wire Fragment is
interpreted. Its owner validates it once and holds exactly one runtime validator
and exactly one declared TypeScript type, proved bidirectionally equivalent at
compile time. `z.infer` is authoritative only where it reproduces the declared
type exactly; where inference widens, the declared type stays authoritative for
compile time and the validator stays authoritative for runtime.
_Avoid_: Internal typed value, shared schema package, inferred type as the sole
source of truth

**Owner-Local Validator**:
The runtime validator held in a private sibling file by the same Module or
Adapter that owns a Public Serialized Value. It narrows an `unknown` value once
without moving domain meaning into a caller, Adapter, shared schema owner, or
public package subpath. The owner's `interface.ts` remains declaration-only.
_Avoid_: Validation helper, central schema registry, caller-owned schema

**Validation Composition**:
The reuse of governing Owner-Local Validators when one public value contains
values owned by other Modules. Composition preserves each owner's meaning and
adds no duplicate validator or shared schema owner.
_Avoid_: Schema duplication, Facade validation policy, shared schema Module

**Wire Command**:
A Maintenance-owned, explicitly versioned, unbranded Public Serialized Value
assembled from CLI and file input. It contains ordinary data, owner-local Wire
Fragments, and explicitly enumerated Nested Public Serialized Values, and can
never carry Admitted Identity, Protected Canary Authority, or another protected
capability.
_Avoid_: Maintenance Command, serialized capability, typed command cast

**Wire Fragment**:
An unversioned owner-local component interpreted only inside one explicitly
versioned Wire Command. Its governing Module owns its declared type and
validator; it has no independent compatibility claim unless it later crosses a
different Seam as its own Public Serialized Value.
_Avoid_: Independent envelope, unversioned public contract, shared wire type

**Nested Public Serialized Value**:
A value with its own schema-version carrier embedded inside another versioned
Public Serialized Value. The enclosing and nested versions are validated
independently and their accepted combinations are explicit.
_Avoid_: Wire Fragment, inherited version, implicit compatibility

**Trusted Command Binding**:
The Maintenance Command Contract sequence that takes one successfully parsed
Wire Command, proves candidate agreement with the run's already-admitted
identity, and, where the command obtains a protected capability through a Seam,
proves trusted acceptance of the inspected plan before obtaining that
capability. It is the only route to a capability-bearing Maintenance Command.
_Avoid_: Validation, branding parsed input, command hydration

**Canary Authority Reference**:
The opaque protected-file reference accepted from `--authority <FILE>`. The
reference is ordinary wire data; it is resolved by Canary Qualification's
Authority Source Seam and is never itself Protected Canary Authority.
_Avoid_: Serialized authority, authority payload, authority JSON

**Canary Authority Source**:
The Canary Qualification Seam whose owner-local Adapter resolves a Canary
Authority Reference against a protected source only after candidate agreement
and inspected-plan acceptance, then either refuses it or supplies Protected
Canary Authority to Trusted Command Binding.
_Avoid_: Authority parser, caller-provided capability, Zod authority schema

**Logical Record**:
One Diagnostic Record or Event Record assigned a sequence within a run. A
repeated observation with the same logical identity and sequence is a
duplicate observation, not a second Logical Record.
_Avoid_: Delivery attempt, log line

**Logical Record Correlation**:
The Facade-owned ordering, identity, gap, duplicate, and terminal-outcome
invariants carried by caller-captured Diagnostic Records and Event Records
within one run. Callers judge those records directly; the Kit exposes no
reconstruction operation and claims no replay, completeness, delivery, or
cross-run ordering.
_Avoid_: Transient Reconstruction, replay, retained event store, record reducer

**Facade Envelope Version**:
The independently incremented version of the public process envelope.
_Avoid_: Result Schema Version

**Result Schema Version**:
The independently incremented version of Maintenance result meaning and help
payload shape.
_Avoid_: Facade Envelope Version

**Hint Version**:
The independently incremented version of machine repair semantics.
_Avoid_: Result Schema Version

**Command Surface Alignment Proof**:
The independent reconciliation of Command Vocabulary, discovery, argv,
process, Branch Station, and consumer surfaces without dispatch ownership.
_Avoid_: Runtime implementation, whole-program coverage

### Verification and claims

**Verification Profile**:
A named selection of claims and required Proof Layer evidence whose reduction
is owned by Qualification Evidence through one Interface.
_Avoid_: Test suite, environment preset

**Contract Test**:
A test that crosses the accepted Interface for its behaviour at the Seam and
judges an Independent Observable without depending on Implementation knowledge.
_Avoid_: Helper test, implementation test, source scan

**Test Fixture**:
A test-owned value, state, or repository tree whose literal meaning is
independent from the Implementation and varies a Contract Test scenario.
_Avoid_: Sample data, shared fixture, second fixture vocabulary

**Personal Verification Profile**:
The Verification Profile for private or local use that may prove isolated
mechanics without claiming public hosted delivery.
_Avoid_: Development mode, reduced public profile

**Public Verification Profile**:
The Verification Profile whose claims require the applicable public hosted
and immutable identity evidence.
_Avoid_: CI mode, personal profile with more tests

**Proof Layer**:
The canonical claim level at which an Independent Observable was produced,
such as in-process, public process, clean fixture, hosted, or fresh-native.
_Avoid_: Confidence level, test tier

**Independent Observable**:
An expected or observed value produced independently from the Implementation
whose claim it supports.
_Avoid_: Recomputed expectation, implementation echo

**Evidence Cell**:
One Candidate Identity-bound observation naming its Proof Layer, Independent
Observable, Claim Status, Skip Rationale when applicable, and explicit
Non-Claims.
_Avoid_: Test result, receipt

**Claim Status**:
The evidence conclusion `proved`, `not-proved`, or `unknown`, preserved without
promoting a lower Proof Layer.
_Avoid_: Pass or fail, when absence and uncertainty differ

**Non-Claim**:
A statement that an observation does not prove a named higher-layer behaviour.
_Avoid_: Disclaimer, omitted claim

**Skip Rationale**:
The non-empty reason an Evidence Cell does not cover a claim in its
Verification Profile.
_Avoid_: Optional note, silent skip

**Qualification Result**:
The Candidate Identity-bound reduction of Evidence Cells into covered,
skipped, proved, not-proved, unknown, and non-claim conclusions.
_Avoid_: Proof report, test summary

**Hosted Evidence**:
An observation produced by the public remote system that owns the claimed
Release Identity or reusable workflow behaviour.
_Avoid_: Workflow text, local simulation

**Fresh-Native Evidence**:
A private human-operated observation from a fresh Harness client, promoted
only as bounded conclusions and receipt identity.
_Avoid_: Direct handler mechanics, raw transcript

**Harness**:
An agent environment that discovers, installs, and executes a Plugin Payload.
Claude and Codex remain distinct Harnesses.
_Avoid_: Host, runtime environment
