---
status: accepted
---

# Keep Repository Governance With Repository Quality Tooling

Repository Quality Tooling owns repository-wide quality and transition policy
outside the Source Tree. Its Verification Transition Contract declares the
exact paths, Source Closure, proof groups, and expected RED or GREEN states
allowed at one reviewed repository transition.

Clean Fixture remains an independent Plugin Consumer and higher Proof Layer.
It may supply public-process and cross-Module evidence to the Verification
Transition Contract, but it does not own repository structure, permitted path
changes, group counts, or transition policy.

## Consequences

- `tooling/repository-quality/` remains one repository-level Module rather
  than splitting Fallow and transition policy into shallow sibling owners.
- Repository Quality Tooling is the current logical owner. Its canonical
  Repository Qualification declaration is
  `tooling/repository-quality/repository-qualification-contract.json`.
- Fallow policy remains in `tooling/repository-quality/fallow-policy.ts` with
  owner-local Contract Tests.
- Repository Qualification owns current repository-byte truth and the reviewed
  RED or GREEN receipt. Clean Fixture remains an independent evidence source
  and does not own repository transition policy.
- Repository Qualification keeps package Implementation outside repository
  tooling.
- Repository Quality Tooling remains outside Package Identity and cannot
  become a caller-visible Source Tree surface.
