---
status: accepted
supersedes: 0003-repository-quality-and-verification-transition.md
---

# Keep Repository Quality Small and Lifecycle-Neutral

Repository quality is a composition of ordinary tools. No repository-local
tool owns tickets, worktrees, review state, temporary RED or GREEN counts, or
implementation progression.

## Decision

Each tool owns one proof kind:

- Biome 2.4.15 owns file-local syntax, import, global, and direct
  import-to-manifest declaration rules.
- TypeScript owns type correctness.
- Bun Contract Tests own product and public-process behaviour.
- native Fallow 3.19.0 owns changed-code quality, architecture zones,
  cross-zone import policy, reachable-source coverage, and suppression hygiene.
- Repository Verification owns only unavoidable cross-owner manifest and
  filesystem relationships.

Repository Verification exposes one function:

```ts
verifyRepository(root: string): RepositoryVerification
```

Its process adapter emits one schema-versioned JSON object and exits zero for
`qualified`, one for `refused`, or two for an operational `error`.

## Repository Verification Boundary

The verifier retains four responsibilities:

1. Root export targets are regular files contained by the repository.
2. Owner Manifests match workspace paths, stay private ESM owners, and use one
   exact version for shared production dependencies. When owners use Zod, the
   root mirrors that exact version.
3. Admission declares no dependency of any kind and preserves the ordered
   `types`, `import`, and `default` export relationship.
4. Source and export paths cannot escape through symlinks.

It derives these facts from the root manifest, discovered Owner Manifests, and
the filesystem. It accepts no parallel contract or path inventory and does not
query Git.

## Local Static Policy

Biome configuration is the source of truth for local policy. Scoped overrides
keep Admission free of bare packages, CommonJS loading, ambient globals, and
global evaluation. Interface files use named declaration forms. Biome's
`noUndeclaredDependencies` checks direct imports against the closest Owner
Manifest. Focused pinned-version canaries protect this configuration.

## Changed-Code Quality

Fallow runs directly and promotes every applicable warn-default rule to
`error`. Fallow 3.19.0 has a fixed 40-item evidence-output ceiling for its
project-wide `type-coupling` query, so the repository runs type-aware analysis
in best-effort mode and pipes the native JSON through one inline, fail-closed
predicate. The predicate accepts only that exact truncated `type-coupling`
shape when every TypeScript project is complete with zero blocking diagnostics;
it rejects every other partial or unavailable query and always re-emits the
unchanged native report. Its ordered zones classify the Source Tree,
Clean Fixture, and Repository Quality Tooling. Every Module Interface, private
production lane, Contract Test lane, and Adapter is explicit. Directory-wide
auto-discovery is intentionally absent: it would silently grant a public
Interface zone to a future private file. First-match order gives specific
Interfaces and Contract Tests their own policy before a broader accepted
private-production lane. A new owner or unrecognised source shape remains
unzoned and fails closed until this decision is updated. Explicit rules admit
only accepted value or type-only edges. Reachable source coverage and
reasoned, non-stale suppressions fail closed.

The repository does not normalize Fallow JSON or maintain a Fallow helper.
Pinned-version tests prove the inline compatibility predicate, a promoted
finding, incomplete type-aware evidence, an invalid comparison base, resolved
zone order, accepted and refused edges, reachable unzoned source, and
suppression hygiene.

## Clean Fixture Boundary

Clean Fixture remains independent product and public-process proof. Its
Admission source projection owns its expected copied closure. Its maintenance
audit owns a private runtime graph observation. Neither imports repository
governance as a product oracle.

## Consequences

- Adding source inside an accepted private-production or Contract Test lane
  does not require a repository-policy respecification. Adding an owner,
  Interface, Adapter, or new source shape does.
- Product failures stay with their owning Contract Tests.
- Repository Verification changes only when a real cross-owner or filesystem
  invariant changes.
- Repository orchestration and mutable GitHub state remain outside this code
  repository.
- ADR 0003's contract mirror, transition receipt, proof groups, exact counts,
  output parsers, and shared scanners are removed.
