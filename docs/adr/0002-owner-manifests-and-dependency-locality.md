---
status: accepted
---

# Keep Owner Manifests and Dependencies Local to Their Owners

The ten existing private manifests are Owner Manifests, one for each current
Source Tree owner represented by the repository workspace. They give tooling
an owner-local address while the root Package Identity remains the only caller
surface.

## Decision

- A third-party dependency belongs to the Source Tree owner that needs it and
  is declared in that owner's Owner Manifest.
- Admission Bootstrap owns no third-party dependency.
- Root dev tooling remains root-owned and does not make every Module an owner
  of those dev dependencies.
- Owner Manifests remain private and are never published.
- The root Package Identity and its existing ten-entry public export surface
  remain the only caller surface.
- No Bun catalog is accepted now. Exact owner-local pins are sufficient.
  Version agreement becomes enforceable only when the same third-party
  dependency appears in more than one Owner Manifest.
- Linker semantics remain unpinned until a concrete failure requires a
  reviewed decision.
- The existing `src/adapters/*` workspace glob admits the private Maintenance
  Command Facade Adapter owner. Its Interface stays outside root exports; the
  root Package Identity owns the sole public binary mapping.
- A future exact `@logtape/logtape@2.3.1` pin belongs only to the facade Owner
  Manifest. It is absent in intentional RED and never belongs to root or
  Admission Bootstrap.
- `clean-fixture/intentional-red-contract.json` owns the exact Admission manifest,
  source, and Proof Layer enforcement. The behavioral source-level
  dependency-free claim remains owned by the independent public-process
  sentinel, not a source scan.

## Consequences

- Dependency knowledge and verification stay local to the Module, Admission
  Bootstrap, or Adapter owner that needs the dependency.
- Root development tooling can support every owner without redistributing
  ownership of its dependencies.
- An Owner Manifest adds no Interface, Seam, ownership, or Package Identity.
- Tooling can address an owner's Contract Tests without expanding the root
  caller surface.
- A shared version rule enters repository checks only after more than one Owner
  Manifest declares the same third-party dependency.

## Amendment by ADR 0004

Accepted ADR 0004 introduces one distribution-specific exception for Zod. The
root Package Identity and every importing Owner Manifest declare the same exact
Zod version because the root Package Identity is what a Git-installing Plugin
Consumer resolves. This root declaration supplies distribution, not runtime
ownership. Each importing Source Tree owner still owns its private validator
and dependency use; Admission Bootstrap remains dependency-free.
