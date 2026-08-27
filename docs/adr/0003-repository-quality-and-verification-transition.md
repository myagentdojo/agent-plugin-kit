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
- Repository Quality Tooling is the current logical owner. Its future
  canonical data path is
  `tooling/repository-quality/verification-transition-contract.json`.
- Fallow policy remains in `tooling/repository-quality/fallow-policy.ts` with
  owner-local Contract Tests.
- The current `clean-fixture/intentional-red-contract.json` path is a
  compatibility data location until an accepted Test Design moves the data
  without weakening the exact intentional RED proof. Clean Fixture consumes
  this data but does not own repository transition policy.
- The correction that moves the contract and verifier must preserve Clean
  Fixture as an independent evidence source and keep package Implementation
  outside repository tooling.
- Repository Quality Tooling remains outside Package Identity and cannot
  become a caller-visible Source Tree surface.
