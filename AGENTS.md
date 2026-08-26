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
- Package source: `src/` is the Source Tree. Reach its current Interface and P3
  Contract Test owners, and its deferred Implementation and Adapter owners, through
  `CONTEXT-MAP.md` and `docs/adr/0001-language-to-topology.md`.
- Independent proof: `clean-fixture/` owns current P3 cross-Module Contract Tests
  and future Candidate Lineage, installation, hosted, and Fresh-Native Evidence.
  `clean-fixture/p3-red-contract.json` owns the exact P3 RED Contract Test
  files, counts, and Admission Proof Layer.

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
- P3 RED gate: preserve `clean-fixture/p3-red-contract.json`. Keep P4 through
  P9 Contract Tests, hosted workflows, and every Implementation path absent
  until their owning gate.

## Checks

- Complete gate: run `bun run check` from the repository root. It exits zero only
  when formatting, types, structure, fixtures, and the exact intentional RED
  contract all agree.
- Machine-pinned RED: run `bun run verify:p3:red`. The verifier exits zero only
  after each child test process exits one with the exact expected
  `contract-absent` failures.
- Direct intentional RED: run `bun run test:p3`. Read the exact expected files
  and counts from `clean-fixture/p3-red-contract.json`; exit one is evidence,
  not a GREEN Implementation claim.
- Focused RED: run `bun run test:p3:kit-interface`,
  `bun run test:p3:admission-bootstrap`,
  `bun run test:p3:maintenance-command-contract`,
  `bun run test:p3:qualification-evidence`, or
  `bun run test:p3:clean-fixture`.
- Workspace RED: run
  `bun run --filter @agent-plugin-kit/admission-bootstrap test`,
  `bun run --filter @agent-plugin-kit/maintenance-command-contract test`, or
  `bun run --filter @agent-plugin-kit/qualification-evidence test`.
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
