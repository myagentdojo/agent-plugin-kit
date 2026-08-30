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
- native Fallow 3.19.0 owns changed-code quality.
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

Fallow runs directly. The repository config requires complete type-aware
evidence and promotes every applicable warn-default rule to `error`, so the
native process exit is the gate. The repository does not parse or normalize
Fallow JSON. Pinned-version tests prove a promoted finding, incomplete
type-aware evidence, and an invalid comparison base.

## Clean Fixture Boundary

Clean Fixture remains independent product and public-process proof. Its
Admission source projection owns its expected copied closure. Its maintenance
audit owns a private runtime graph observation. Neither imports repository
governance as a product oracle.

## Consequences

- Adding valid source or a Contract Test does not require a repository-policy
  respecification.
- Product failures stay with their owning Contract Tests.
- Repository Verification changes only when a real cross-owner or filesystem
  invariant changes.
- Repository orchestration and mutable GitHub state remain outside this code
  repository.
- ADR 0003's contract mirror, transition receipt, proof groups, exact counts,
  output parsers, and shared scanners are removed.
