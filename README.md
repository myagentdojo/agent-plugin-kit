# Agent Plugin Kit

Contracts and maintenance tooling for Agent Plugin repositories, with a
dependency-free Admission Bootstrap.

The repository currently contains its accepted domain and Repository Topology,
the Source Tree Interface skeleton, and the complete current-stage Contract
Test scaffold. Admission Bootstrap, Qualification Evidence, the Maintenance
Command Contract, and Plugin Payload Production package mode are the current
Deep Module Implementations. The Maintenance Command Facade also implements
deterministic parsing, validation, help, usage-refusal, Source Checkout
Admission, and admitted `payload:package` dispatch. Payload check and
materialize and every other apply and inspect execution remain absent.

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

## Verify the current repository

```sh
bun run check
```

The check runs Biome, TypeScript, focused repository-quality Contract Tests,
native changed-code Fallow, and lifecycle-neutral Repository Verification.
Product and public-process behaviour remains with ordinary Bun Contract Tests;
Clean Fixture remains an independent evidence source.

The product current-stage selector is:

```sh
bun run test:current-stage
```

It exercises the current product Contract Tests directly. It is a complete
green proof for the accepted current-stage behaviour. The current-stage
selector at `tooling/current-stage-test-runner.ts` owns its product test-file
inventory, pinned per-file and aggregate counts, JUnit parsing, and process
outcome integrity. Repository Verification does not parse JUnit or mirror
those product counts.

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

## Request work

GitHub Issues is the public request surface. Pull requests are change proposals,
not feature requests. See
[`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).
