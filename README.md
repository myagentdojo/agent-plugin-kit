# Agent Plugin Kit

Contracts and maintenance tooling for Agent Plugin repositories, with a
dependency-free Admission Bootstrap.

The repository currently contains its accepted domain and Repository Topology,
the Source Tree Interface skeleton, and the complete current-stage Contract
Test scaffold. Admission Bootstrap, Qualification Evidence, the Maintenance
Command Contract, and Plugin Payload Production are the current
Deep Module Implementations. The Maintenance Command Facade also implements
deterministic parsing, validation, help, usage-refusal, Source Checkout
Admission, and admitted payload check, materialize, and package dispatch.
Other command execution remains deferred behind the declared Interfaces.

## Start here

- Read [`CONTEXT.md`](CONTEXT.md) for the Ubiquitous Language.
- Read [`CONTEXT-MAP.md`](CONTEXT-MAP.md) to find each current or future owner.
- Read [`AGENTS.md`](AGENTS.md) for the contribution route and exact checks.
- Read [`CODING_STANDARDS.md`](CODING_STANDARDS.md) before Interface, Adapter,
  Contract Test, or Implementation work.

## Accepted shape

Repository Knowledge stays at root and under `docs/`. Package source begins
under the Source Tree at `src/`. Repository Quality Tooling lives under
`tooling/repository-quality/`. Independent cross-Module proof begins under
`clean-fixture/`; it does not own repository policy. Later Contract Tests,
hosted workflows, and every other Implementation path remain deliberately
absent until their owning gate.

The accepted language-to-topology rule and complete placement rationale live in
[`docs/adr/0001-language-to-topology.md`](docs/adr/0001-language-to-topology.md).
The Owner Manifest and dependency Locality decision lives in
[`docs/adr/0002-owner-manifests-and-dependency-locality.md`](docs/adr/0002-owner-manifests-and-dependency-locality.md).
Simple Repository Quality Tooling and Repository Verification ownership live in
[`docs/adr/0005-simple-repository-quality-ownership.md`](docs/adr/0005-simple-repository-quality-ownership.md).
The accepted package contract, publication policy, and Test Design live in
[`docs/adr/0008-package-prepared-plugin-payload.md`](docs/adr/0008-package-prepared-plugin-payload.md).
Check and materialize, including their Source Checkout Admission amendment,
follow [`docs/adr/0009-complete-plugin-payload-check-and-materialize.md`](docs/adr/0009-complete-plugin-payload-check-and-materialize.md).

## Set up a checkout

Use the Bun version pinned by `packageManager` in [`package.json`](package.json).
Keep Git and `gzip` available on PATH for checkout and package-process proof.
From the repository root, install the locked dependencies:

```sh
bun --version
bun install --frozen-lockfile
```

Repeat the install in each isolated worktree. It supplies the owner-local
dependencies and the package-backed agent skills; read
[`.agents/skills/fallow/SKILL.md`](.agents/skills/fallow/SKILL.md) before using
Fallow directly. Keep the lockfile unchanged during setup.

Before starting a change, compare the checkout's Full Commit Pin with the
intended base and the live owning Issue. A local `main` or a vault packet may
predate merged work. Use the packet for product context and the checkout's
Interfaces and Accepted Decisions for implementation.

## Verify the current repository

```sh
bun run check
```

The [`check` script](package.json) composes whitespace, Biome, TypeScript,
current-stage product Contract Tests, repository-quality Contract Tests,
native changed-code Fallow, and Repository Verification. A successful run
includes product and public-process proof; Clean Fixture remains its
independent evidence source. Hosted workflows remain deferred, so retain the
local gate output with the proposed change.

To run only the complete product proof while iterating:

```sh
bun run test:current-stage
```

The current-stage selector at `tooling/current-stage-test-runner.ts` owns its product test-file
inventory, pinned per-file and aggregate counts, JUnit parsing, and process
outcome integrity. Repository Verification does not parse JUnit or mirror
those product counts. When adding a product Contract Test file, update this
inventory and its accepted count evidence, the root selectors, and the owning
Owner Manifest's `test` script together.

## Run one owner's Contract Tests

The ten private Owner Manifests give each current Source Tree owner a tooling
address. They do not add publication, ownership, Interface, or runtime Seams;
the root Package Identity and its accepted subpath exports remain the caller
surface.

Run only one owner's accepted Contract Tests from the repository root:

```sh
bun run --filter @agent-plugin-kit/admission-bootstrap test
```

The same selector shape accepts `@agent-plugin-kit/maintenance-command-contract`,
`@agent-plugin-kit/qualification-evidence`, or
`@agent-plugin-kit/plugin-payload-production`. The private facade owner uses
`@agent-plugin-kit/maintenance-command-facade`. Owners whose Contract Tests
belong to later gates intentionally have no `test` script yet.

For cross-Module or CLI work, select the matching `test:current-stage:*`
script from [`package.json`](package.json). Check the reported files and
non-zero test count against the changed behaviour. Focused proof supports
iteration; finish with `bun run check` rather than repeating its product suite
separately. For Fallow comparison-base selection and failure repair, read
[`docs/agents/fallow.md`](docs/agents/fallow.md).

Before handing back a change, inspect `git status --short` and the intended
diff. Report the changed behaviour, comparison Full Commit Pin, commands and
outcomes, and remaining proof gaps. Keep local verification distinct from
review, merge, Release, and consumer qualification.

## Request work

GitHub Issues is the public request surface. Pull requests are change proposals,
not feature requests. See
[`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).
