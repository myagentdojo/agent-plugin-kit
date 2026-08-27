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
- Package source: `src/` is the Source Tree. Reach its current Interface and
  Contract Test owners, and its deferred Implementation and Adapter owners,
  through `CONTEXT-MAP.md` and `docs/adr/0001-language-to-topology.md`.
- Independent proof: `clean-fixture/` owns current cross-Module Contract Tests
  and future Candidate Lineage, installation, hosted, and Fresh-Native Evidence.
  `clean-fixture/intentional-red-contract.json` owns the exact intentional RED
  Contract Test files, counts, and Admission Proof Layer.

## Invariants

- Language: use the canonical terms in `CONTEXT.md`; route a missing term
  through `docs/agents/domain.md`.
- Names: use Ubiquitous Language for durable paths and identifiers. Keep
  roadmap stages, transient phase numbers, and ambiguous codenames in planning
  evidence, not repository names.
- Modules: keep one small Interface, colocated Contract Tests, future
  Implementation, and only Accepted Decision-backed Adapters in each Module
  owner.
- Tests: keep Test Fixtures and test-only Adapters beneath the owning
  `contract-tests/`; keep independent higher Proof Layers in Clean Fixture.
- Identity: bind Repository, Release, Package, Workflow, and evidence claims to
  one Full Commit Pin before Kit Repository Implementation executes.
- Evidence: preserve `proved`, `not-proved`, and `unknown`; attach a Skip
  Rationale and Non-Claims where evidence does not reach the requested layer.
- Intentional RED gate: preserve
  `clean-fixture/intentional-red-contract.json`. Keep later Contract Tests,
  hosted workflows, and every Implementation path absent until their owning
  gate.

## Checks

- Complete gate: run `bun run check` from the repository root. It runs
  `git diff --check`, Biome, TypeScript, structure verification, focused Fallow
  policy Contract Tests, changed-code Fallow policy, and exact intentional RED
  verification.
- Changed-code quality: run
  `bun run --silent quality:fallow --changed-since HEAD` after a dirty
  code-changing turn. For comparison-base policy, JSON interpretation, editor
  resolution, or repair, read `docs/agents/fallow.md`.
- Focused quality Contract Tests: run `bun run test:quality:fallow-policy`.
- Machine-pinned RED: run `bun run verify:intentional-red`. The verifier exits
  zero only
  after each child test process exits one with the exact expected
  `contract-absent` failures.
- Direct intentional RED: run `bun run test:intentional-red`. Read the exact expected files
  and counts from `clean-fixture/intentional-red-contract.json`; exit one is evidence,
  not a GREEN Implementation claim.
- Focused RED: run `bun run test:intentional-red:kit-interface`,
  `bun run test:intentional-red:admission-bootstrap`,
  `bun run test:intentional-red:maintenance-command-contract`,
  `bun run test:intentional-red:qualification-evidence`, or
  `bun run test:intentional-red:clean-fixture`.
- CLI RED: run `bun run test:intentional-red:maintenance-cli:unit`,
  `bun run test:intentional-red:maintenance-cli:catalog`,
  `bun run test:intentional-red:maintenance-cli:process`,
  `bun run test:intentional-red:maintenance-cli:observability`,
  `bun run test:intentional-red:maintenance-cli:clean-fixture`,
  `bun run test:intentional-red:maintenance-cli:local-link`, or the exact combined selector
  `bun run test:intentional-red:maintenance-cli`.
- CLI shells: `bun run audit:maintenance-cli` and
  `bun run verify:maintenance-cli:local-link` intentionally exit one in RED.
- Workspace RED: run
  `bun run --filter @agent-plugin-kit/admission-bootstrap test`,
  `bun run --filter @agent-plugin-kit/maintenance-command-contract test`, or
  `bun run --filter @agent-plugin-kit/qualification-evidence test`, or
  `bun run --filter @agent-plugin-kit/maintenance-command-facade test`.
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

### Repository quality

Repository Quality Tooling owns changed-code Fallow policy, comparison bases,
machine results, and repair guidance. See `docs/agents/fallow.md`.
