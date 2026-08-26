---
status: accepted
---

# Derive Repository Topology from Ubiquitous Language

The Kit Repository projects canonical domain owners into one conventional
Source Tree, keeps Repository Knowledge at root and under `docs/`, and keeps
independent Clean Fixture proof outside package source. Nathan accepted this
shape because it makes every Module, Interface, Contract Test, Test Fixture,
Adapter, future Implementation, and higher Proof Layer discoverable without a
generic bucket or hidden human convention.

## Consequences

- `src/` is the Source Tree and will contain the Kit Repository Interface,
  Admission Bootstrap, seven Deep Modules, and production Reusable Workflow
  Adapter source.
- Each Module will repeat `interface.ts`, `contract-tests/`, future
  `implementation/`, and only Accepted Decision-backed production `adapters/`.
- Each owner's Test Fixtures and test-only Adapters will remain beneath its
  `contract-tests/` folder.
- `clean-fixture/` will own cross-Module, Candidate Lineage, installation,
  hosted, and Fresh-Native Evidence through Personal and Public Verification
  Profiles.
- Additional Domain Contexts will be promoted lazily only when vocabulary or
  Accepted Decisions genuinely diverge.
- A future path enters Git only when its approved owner supplies real content;
  the scaffold creates no empty Interface, Contract Test, Test Fixture,
  Adapter, Clean Fixture, hosted-workflow, or Implementation path.

Non-normative follow-on: [ADR 0002](0002-owner-manifests-and-dependency-locality.md)
records Owner Manifest and dependency Locality for the owners established here;
it does not amend this decision.
