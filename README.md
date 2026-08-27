# Agent Plugin Kit

Contracts and maintenance tooling for Agent Plugin repositories, with a
dependency-free Admission Bootstrap.

The repository currently contains its accepted domain and Repository Topology,
the Source Tree Interface skeleton, and an intentional RED Contract Test
scaffold. No Module Implementation or maintenance behaviour has moved here.

## Start here

- Read [`CONTEXT.md`](CONTEXT.md) for the Ubiquitous Language.
- Read [`CONTEXT-MAP.md`](CONTEXT-MAP.md) to find each current or future owner.
- Read [`AGENTS.md`](AGENTS.md) for the contribution route and exact checks.
- Read [`CODING_STANDARDS.md`](CODING_STANDARDS.md) before Interface, Adapter,
  Contract Test, or Implementation work.

## Accepted shape

Repository Knowledge stays at root and under `docs/`. Package source begins
under the Source Tree at `src/`. Independent cross-Module proof begins under
`clean-fixture/`. Later Contract Tests, hosted workflows, and every
Implementation path remain deliberately absent until their owning gate.

The accepted language-to-topology rule and complete placement rationale live in
[`docs/adr/0001-language-to-topology.md`](docs/adr/0001-language-to-topology.md).
The Owner Manifest and dependency Locality decision lives in
[`docs/adr/0002-owner-manifests-and-dependency-locality.md`](docs/adr/0002-owner-manifests-and-dependency-locality.md).

## Verify the scaffold

```sh
bun run check
```

The check validates the current Interface and the exact RED Contract Test
files, counts, and Admission Proof Layer owned by
[`clean-fixture/intentional-red-contract.json`](clean-fixture/intentional-red-contract.json). It
refuses premature future Contract Tests, hosted workflows, or
Implementation paths.

The exact intentional RED selector is:

```sh
bun run test:intentional-red
```

It must match the canonical files and counts and fail only because the accepted
production contracts are not implemented yet.

## Run one owner's Contract Tests

The ten private Owner Manifests give each current Source Tree owner a tooling
address. They do not add publication, ownership, Interface, or runtime Seams;
the root Package Identity and its accepted subpath exports remain the caller
surface.

Run only one owner's accepted Contract Tests from the repository root:

```sh
bun run --filter @agent-plugin-kit/admission-bootstrap test
```

The same selector shape accepts `@agent-plugin-kit/maintenance-command-contract`
or `@agent-plugin-kit/qualification-evidence`. The private facade owner uses
`@agent-plugin-kit/maintenance-command-facade`. Owners whose Contract Tests
belong to later gates intentionally have no `test` script yet.

## Request work

GitHub Issues is the public request surface. Pull requests are change proposals,
not feature requests. See
[`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).
