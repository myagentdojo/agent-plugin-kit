# Coding Standards

Kit-specific implementation and review idioms. `CONTEXT.md` owns canonical
terms, `CONTEXT-MAP.md` owns navigation, Accepted Decisions own architecture,
and repository checks own mechanically enforced rules.

## Module and Interface ownership

- Give each Module one Interface that contains every caller-visible invariant,
  ordering rule, refusal meaning, and observable result.
- Keep Implementation knowledge, internal Seams, and environmental custody
  behind that Interface.
- Put a production Adapter only at an Accepted Decision-backed Seam where
  behaviour actually varies.
- Import another Module or Adapter through its Interface. Use a value edge only
  for required runtime behaviour; use a type-only edge for type knowledge.

## Results and refusals

- Return a Command Preview, Command Result, or explicit refusal with one Next
  Action.
- Keep completed effects, remaining effects, Transaction State, and Retry
  Safety explicit after any attempted effect.
- Keep machine-readable output deterministic; keep diagnostics outside its
  structured result channel.

## Sealed vocabularies

- Give Command Vocabulary and Result Vocabulary one owner in Maintenance
  Command Contract.
- Import each sealed vocabulary from its owner. Treat a second declaration as
  drift, not convenience.

## Effects and Candidate Approval

- Classify every Maintenance Command by Effect Class before capability is
  acquired.
- Bind Candidate Approval to the Candidate Identity, refreshed state, and
  expected effects. Reinspect when any binding input changes.
- Keep inspection free of repository-local mutation and external effects.

## Adapter and external-effect custody

- Give each external effect one governing Interface and one Adapter role at
  its Seam.
- Record requested and completed effects through an independently inspectable
  ledger or resulting state.
- Distinguish creation from readiness; dispatch only after the owned readiness
  observable succeeds.

## Deterministic text and identity

- Compare identity through Repository Identity and the complete Full Commit
  Pin, never a branch, tag, short commit, or display string.
- Bind Release, Package, Workflow, installed bytes, hosted observations, and
  evidence to one Candidate Identity before promoting a claim.
- Keep canonical text, ordering, and checksums stable for identical admitted
  inputs.

## Contract Tests and Independent Observables

- Cross the same accepted Interface used by production callers.
- Derive expected results from test-owned literals, independently admitted
  constants, durable-state readers, public streams, process exits, or hosted
  observations outside the Implementation path.
- Name one disposable perturbation that makes the Contract Test RED, then
  restore GREEN in the same harness.

## Executable architecture enforcement

- Enforce each accepted architecture decision with the cheapest suitable
  executable owner: Fallow for import graphs, source coverage, and direct-call
  restrictions; Biome for file-local syntax and dependency declarations;
  TypeScript for type constraints; and Bun Contract Tests for runtime or
  domain semantics.
- Keep Repository Verification only for irreducible cross-manifest and
  filesystem relationships. Do not add a bespoke verifier when a pinned
  native tool proves the same invariant with equally clear repair guidance.

## Test Fixture, fake, and test-only Adapter ownership

- Keep each Test Fixture and fake with its owning `contract-tests/` folder.
- Keep test-only Adapters private to that folder and out of the package surface.
- Give every sealed fake or Test Fixture one owner; reuse it rather than copying
  its vocabulary.

## Proof Layer non-promotion

- Record the Proof Layer that produced each Independent Observable.
- Preserve `proved`, `not-proved`, and `unknown`; require a Skip Rationale for
  every uncovered Verification Profile claim.
- Attach explicit Non-Claims whenever mechanics evidence does not reach hosted,
  installation, trust, UI, delegation, or Fresh-Native Evidence.
