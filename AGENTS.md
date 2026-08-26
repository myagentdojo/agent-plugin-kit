# Agent Plugin Kit

Keep generic plugin-maintenance contracts discoverable, dependency-free at
Admission Bootstrap, and bound to one immutable Source Identity. Keep Product
Behaviour and Plugin Payload ownership in each Plugin Repository.

## Read

1. Read `README.md` for repository scope and current maturity.
2. Read `CONTEXT.md` for canonical terms.
3. Read `CONTEXT-MAP.md` for current and future owners.
4. Read `CODING_STANDARDS.md` for Interface, Adapter, Contract Test,
   Implementation, or review work.

## Authority

- Issues: use GitHub Issues for requests and mutable work state. Read
  `docs/agents/issue-tracker.md` before issue or authority work.
- Pull requests: treat them as change proposals, not the request surface.
- Effects: obtain the approval named by the governing Interface before an
  external effect. Repository creation approval does not authorize commit,
  push, Release, publication, or maintenance extraction.

## Map

- Root: `README.md`, `CONTEXT.md`, `CONTEXT-MAP.md`, `AGENTS.md`,
  `CODING_STANDARDS.md`, and `package.json` own orientation, language,
  navigation, guidance, idioms, and Package Identity.
- Repository Knowledge: `docs/agents/README.md` indexes branch guidance;
  `docs/adr/` owns Accepted Decisions.
- Future package source: `src/` is the Source Tree. Reach its accepted Module,
  Interface, Contract Test, Implementation, and Adapter locations through
  `CONTEXT-MAP.md` and `docs/adr/0001-language-to-topology.md`.
- Future independent proof: `clean-fixture/` owns cross-Module, Candidate
  Lineage, installation, hosted, and Fresh-Native Evidence.

## Invariants

- Language: use the canonical terms in `CONTEXT.md`; route a missing term
  through `docs/agents/domain.md`.
- Modules: keep one small Interface, colocated Contract Tests, future
  Implementation, and only Accepted Decision-backed Adapters in each Module
  owner.
- Tests: keep Test Fixtures and test-only Adapters beneath the owning
  `contract-tests/`; keep independent higher Proof Layers in Clean Fixture.
- Identity: bind Repository, Release, Package, Workflow, and evidence claims to
  one Full Commit Pin before Kit Repository Implementation executes.
- Evidence: preserve `proved`, `not-proved`, and `unknown`; attach a Skip
  Rationale and Non-Claims where evidence does not reach the requested layer.
- Scaffold gate: keep Source Tree, Contract Test, Test Fixture, Adapter, Clean
  Fixture, hosted-workflow, and Implementation paths absent until their current
  approval gate supplies real content.

## Checks

- Scaffold: run `bun run check` from the repository root.
- Review: inspect `git status --short` and the exact intended diff.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `myagentdojo/agent-plugin-kit`; use
process-scoped `ghh` on shared hosts. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label strings. See
`docs/agents/triage-labels.md`.

### Domain docs

One active Domain Context uses root `CONTEXT.md`; root `CONTEXT-MAP.md` routes
questions and lazy future context promotion. See `docs/agents/domain.md`.
