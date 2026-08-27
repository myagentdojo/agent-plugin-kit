# Context Map

The Kit Repository currently has one active Domain Context. Root `CONTEXT.md`
governs the system-wide Ubiquitous Language; this map routes each question to
its Accepted Decision, current or future Interface or Adapter, current or
future Contract Tests or independent proof, and future Implementation owner.

Consumer rules: [`docs/agents/domain.md`](docs/agents/domain.md).

## Active context

| Domain Context | Glossary | Accepted Decisions | Scope |
| --- | --- | --- | --- |
| Agent Plugin Kit | [`CONTEXT.md`](CONTEXT.md) | [`docs/adr/`](docs/adr/) | Kit Repository roles, identity and Admission, seven Deep Modules, Reusable Workflow Adapters, commands and results, Verification Profiles, and qualification claims. |

## Owner routes

The current Interface, Admission Bootstrap, Maintenance Command Contract,
Qualification Evidence, and Clean Fixture Contract Test paths are current.
Other Contract Test paths, every Implementation path, and hosted workflows are
future and remain absent until their owning stage.

| Question | Governing language | Accepted Decision | Current or future Interface or Adapter | Current or future Contract Tests or independent proof | Future Implementation |
| --- | --- | --- | --- | --- | --- |
| Where does package source live? | Source Tree | `docs/adr/0001-language-to-topology.md` | `src/interface.ts` | Owner-local paths below | `src/` |
| Where is repository-wide quality policy owned? | Repository Quality Tooling | Repository policy, not package architecture | `tooling/repository-quality/` | `tooling/repository-quality/contract-tests/` | `tooling/repository-quality/fallow-policy.ts` |
| How is a Plugin Payload produced? | Plugin Payload Production | `docs/adr/0001-language-to-topology.md` | `src/modules/plugin-payload-production/interface.ts` | `src/modules/plugin-payload-production/contract-tests/` | `src/modules/plugin-payload-production/implementation/` |
| Who owns the portable runtime? | Runtime Custody | `docs/adr/0001-language-to-topology.md` | `src/modules/runtime-custody/interface.ts` | `src/modules/runtime-custody/contract-tests/` | `src/modules/runtime-custody/implementation/` |
| Who owns Admission, readiness, or Git convergence? | Release and Git Engine | `docs/adr/0001-language-to-topology.md` | `src/modules/release-and-git-engine/interface.ts` | `src/modules/release-and-git-engine/contract-tests/` | `src/modules/release-and-git-engine/implementation/` |
| Who owns commands, effects, and results? | Maintenance Command Contract | `docs/adr/0001-language-to-topology.md` | `src/modules/maintenance-command-contract/interface.ts` | `src/modules/maintenance-command-contract/contract-tests/` | `src/modules/maintenance-command-contract/implementation/` |
| How do Claude and Codex journeys differ? | Harness Journeys | `docs/adr/0001-language-to-topology.md` | `src/modules/harness-journeys/interface.ts` | `src/modules/harness-journeys/contract-tests/` | `src/modules/harness-journeys/implementation/` |
| How is a canary candidate qualified? | Canary Qualification | `docs/adr/0001-language-to-topology.md` | `src/modules/canary-qualification/interface.ts` | `src/modules/canary-qualification/contract-tests/` | `src/modules/canary-qualification/implementation/` |
| How are claims reduced without promotion? | Qualification Evidence | `docs/adr/0001-language-to-topology.md` | `src/modules/qualification-evidence/interface.ts` | `src/modules/qualification-evidence/contract-tests/` | `src/modules/qualification-evidence/implementation/` |
| What obtains identity before Kit Repository Implementation? | Admission Bootstrap and Admitted Identity | `docs/adr/0001-language-to-topology.md` | `src/admission-bootstrap/interface.ts`; Admission meaning remains with Release and Git Engine | `src/admission-bootstrap/contract-tests/` | `src/admission-bootstrap/implementation/` |
| Where do reusable workflow calls live? | Reusable Workflow Adapter | `docs/adr/0001-language-to-topology.md` | `src/adapters/reusable-workflow-adapter/interface.ts` | Static proof: `src/adapters/reusable-workflow-adapter/contract-tests/`; hosted proof: `clean-fixture/public-verification-profile/contract-tests/` | `src/adapters/reusable-workflow-adapter/implementation/` |
| Where are cross-Module and higher-layer claims proved? | Clean Fixture and Verification Profile | `docs/adr/0001-language-to-topology.md` | `clean-fixture/` is outside Source Tree | `clean-fixture/personal-verification-profile/contract-tests/` and `clean-fixture/public-verification-profile/contract-tests/` | Independent proof, not package Implementation |
| Where are command and result meanings owned? | Command Vocabulary and Result Vocabulary | `docs/adr/0001-language-to-topology.md` | `src/modules/maintenance-command-contract/command-vocabulary.ts` and `src/modules/maintenance-command-contract/result-vocabulary.ts` | Governing Module Contract Tests | Maintenance Command Contract Implementation |
| Where is the public maintenance binary adapted? | Maintenance Command Facade Adapter, Diagnostic Adapter, and Event Adapter | `docs/adr/0002-owner-manifests-and-dependency-locality.md` | `src/adapters/maintenance-command-facade/interface.ts` | `src/adapters/maintenance-command-facade/contract-tests/` and Clean Fixture | `src/adapters/maintenance-command-facade/implementation/` |
| Where are execution branches declared and reconciled? | Branch Station and Station Map | `docs/adr/0001-language-to-topology.md` | `src/modules/maintenance-command-contract/branch-stations.ts` | `src/modules/maintenance-command-contract/contract-tests/branch-station-catalog.test.ts` | Maintenance Command Contract Implementation |

## Context promotion

Create another Domain Context only when it owns distinct Ubiquitous Language or
Accepted Decisions whose consumers and rate of change differ from the root
context. A Module, Adapter, or large Implementation does not by itself earn a
new context. Until promotion is accepted, root `CONTEXT.md` governs every
future owner named above.
