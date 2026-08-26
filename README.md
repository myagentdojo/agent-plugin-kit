# Agent Plugin Kit

Dependency-free contracts and maintenance tooling for Agent Plugin
repositories.

The repository currently contains its accepted domain and Repository Topology
scaffold only. No Module Interface, Contract Test, Clean Fixture proof, or
Implementation exists yet, and no maintenance behaviour has moved here.

## Start here

- Read [`CONTEXT.md`](CONTEXT.md) for the Ubiquitous Language.
- Read [`CONTEXT-MAP.md`](CONTEXT-MAP.md) to find each current or future owner.
- Read [`AGENTS.md`](AGENTS.md) for the contribution route and exact checks.
- Read [`CODING_STANDARDS.md`](CODING_STANDARDS.md) before Interface, Adapter,
  Contract Test, or Implementation work.

## Accepted shape

Repository Knowledge stays at root and under `docs/`. Executable package source
will begin under the Source Tree at `src/`. Independent cross-Module and hosted
proof will live under `clean-fixture/`. Those future paths are deliberately
absent until an approved Interface, Contract Test, Test Fixture, Adapter, or
Verification Profile supplies real content.

The accepted language-to-topology rule and complete placement rationale live in
[`docs/adr/0001-language-to-topology.md`](docs/adr/0001-language-to-topology.md).

## Verify the scaffold

```sh
bun run check
```

The check validates the required document owners and pointers and refuses
premature Source Tree, Clean Fixture, or hosted-workflow paths.

## Request work

GitHub Issues is the public request surface. Pull requests are change proposals,
not feature requests. See
[`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).
