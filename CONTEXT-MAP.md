# Context Map

The Kit Repository currently has one active Domain Context. Root `CONTEXT.md`
governs the system-wide Ubiquitous Language; this map routes each question to
its Accepted Decision, current or future Interface or Adapter, current or
future Contract Tests or independent proof, and future Implementation owner.

Consumer rules: [`docs/agents/domain.md`](docs/agents/domain.md).

## Active context

| Domain Context | Glossary | Accepted Decisions | Scope |
| --- | --- | --- | --- |
| Agent Plugin Kit | [`CONTEXT.md`](CONTEXT.md) | [`docs/adr/`](docs/adr/) | Kit Repository roles, identity and Admission, seven Deep Modules, Reusable Workflow Adapters, Repository Quality Tooling, commands and results, Verification Profiles, and qualification claims. |

## Owner routes

The current Interface, Admission Bootstrap, Maintenance Command Contract,
Qualification Evidence, and Clean Fixture Contract Test paths are current.
Other Contract Test paths, every Implementation path, and hosted workflows are
future and remain absent until their owning artifact has real accepted content.

| Question | Governing language | Decision or proposal | Current or future Interface or Adapter | Current or future Contract Tests or independent proof | Future Implementation |
| --- | --- | --- | --- | --- | --- |
| Where does package source live? | Source Tree | `docs/adr/0001-language-to-topology.md` | `src/interface.ts` | Owner-local paths below | `src/` |
| Where is repository-wide quality policy owned? | Repository Quality Tooling | `docs/adr/0003-repository-quality-and-verification-transition.md`; Fallow guidance: [`docs/agents/fallow.md`](docs/agents/fallow.md) | `tooling/repository-quality/` | `tooling/repository-quality/contract-tests/` | `tooling/repository-quality/fallow-policy.ts` |
| Who governs intentional RED to ticket-local GREEN repository transitions? | Verification Transition Contract | `docs/adr/0003-repository-quality-and-verification-transition.md` | Future `tooling/repository-quality/verification-transition-contract.json` | Repository Quality Tooling Contract Tests and independent Clean Fixture evidence | Repository Quality Tooling verifier |
| How is a Plugin Payload produced? | Plugin Payload Production | `docs/adr/0001-language-to-topology.md` | `src/modules/plugin-payload-production/interface.ts` | `src/modules/plugin-payload-production/contract-tests/` | `src/modules/plugin-payload-production/implementation/` |
| Who owns the portable runtime? | Runtime Custody | `docs/adr/0001-language-to-topology.md` | `src/modules/runtime-custody/interface.ts` | `src/modules/runtime-custody/contract-tests/` | `src/modules/runtime-custody/implementation/` |
| Who owns Admission, readiness, or Git convergence? | Release and Git Engine | `docs/adr/0001-language-to-topology.md` | `src/modules/release-and-git-engine/interface.ts` | `src/modules/release-and-git-engine/contract-tests/` | `src/modules/release-and-git-engine/implementation/` |
| Who owns commands, effects, and results? | Maintenance Command Contract | `docs/adr/0001-language-to-topology.md` | `src/modules/maintenance-command-contract/interface.ts` | `src/modules/maintenance-command-contract/contract-tests/` | `src/modules/maintenance-command-contract/implementation/` |
| How do Claude and Codex journeys differ? | Harness Journeys | `docs/adr/0001-language-to-topology.md` | `src/modules/harness-journeys/interface.ts` | `src/modules/harness-journeys/contract-tests/` | `src/modules/harness-journeys/implementation/` |
| How is a canary candidate qualified? | Canary Qualification | `docs/adr/0001-language-to-topology.md` | `src/modules/canary-qualification/interface.ts` | `src/modules/canary-qualification/contract-tests/` | `src/modules/canary-qualification/implementation/` |
| How are claims reduced without promotion? | Qualification Evidence | `docs/adr/0001-language-to-topology.md` | `src/modules/qualification-evidence/interface.ts` | `src/modules/qualification-evidence/contract-tests/` | `src/modules/qualification-evidence/implementation/` |
| What obtains identity before Kit Repository Implementation? | Admission Bootstrap and Admitted Identity | `docs/adr/0001-language-to-topology.md` | `src/admission-bootstrap/interface.ts`; Admission meaning remains with Release and Git Engine | `src/admission-bootstrap/contract-tests/` | `src/admission-bootstrap/implementation/` |
| Where do reusable workflow calls live? | Reusable Workflow Adapter | `docs/adr/0001-language-to-topology.md` | `src/adapters/reusable-workflow-adapter/interface.ts` | Static proof: `src/adapters/reusable-workflow-adapter/contract-tests/`; hosted proof: `clean-fixture/public-verification-profile/contract-tests/` | `src/adapters/reusable-workflow-adapter/implementation/` |
| Where are cross-Module and higher-layer claims proved? | Clean Fixture and Verification Profile | `docs/adr/0001-language-to-topology.md`; repository-policy split: `docs/adr/0003-repository-quality-and-verification-transition.md` | `clean-fixture/` is outside Source Tree | `clean-fixture/personal-verification-profile/contract-tests/` and `clean-fixture/public-verification-profile/contract-tests/` | Independent proof, not repository governance or package Implementation |
| Where are command and result meanings owned? | Command Vocabulary and Result Vocabulary | `docs/adr/0001-language-to-topology.md` | `src/modules/maintenance-command-contract/command-vocabulary.ts` and `src/modules/maintenance-command-contract/result-vocabulary.ts` | Governing Module Contract Tests | Maintenance Command Contract Implementation |
| Where is the public maintenance binary adapted? | Maintenance Command Facade Adapter, Diagnostic Adapter, and Event Adapter | `docs/adr/0002-owner-manifests-and-dependency-locality.md` | `src/adapters/maintenance-command-facade/interface.ts` | `src/adapters/maintenance-command-facade/contract-tests/` and Clean Fixture | `src/adapters/maintenance-command-facade/implementation/` |
| Which Failure Class value may a record carry? | Failure Class | Root [`CONTEXT.md`](CONTEXT.md) Failure Class entry, carried in proposed `docs/adr/0004-public-serialized-validation-and-logical-record-correlation.md` | All seven values are Maintenance-owned: `src/modules/maintenance-command-contract/interface.ts` with `src/modules/maintenance-command-contract/result-vocabulary.ts`; `src/adapters/maintenance-command-facade/interface.ts` still declares `event_delivery` locally today and is amended at Implementation admission | `src/adapters/maintenance-command-facade/contract-tests/observability.test.ts` | Maintenance Command Contract owns every value and the six carried by Maintenance Error; Maintenance Command Facade Adapter projects them onto records |
| Who validates a Public Serialized Value? | Public Serialized Value and Owner-Local Validator | Proposed `docs/adr/0004-public-serialized-validation-and-logical-record-correlation.md` | The existing Module or Adapter owns one private validator sibling and one declaration-only Interface type proved bidirectionally equivalent; no validator is package-exported | The same owner's Contract Tests and Clean Fixture production-only resolution proof | The same existing owner; no shared schema owner |
| Who composes nested Maintenance Command validation? | Validation Composition, Wire Command, Wire Fragment, Trusted Command Binding, and Command Vocabulary | Proposed `docs/adr/0004-public-serialized-validation-and-logical-record-correlation.md` | Maintenance Command Contract selects one explicit Wire Command version, composes private governing Wire Fragment validators by relative import, then binds only already-admitted identity and protected authority obtained through its owner Seam; the Facade owns wire syntax only | Governing owner Contract Tests, Maintenance Command Contract capability-negative and exactly-once composition proof, and public-process evidence | Maintenance Command Contract for version, composition, and binding; each governing Module for fragment meaning |
| How does `--authority <FILE>` become Protected Canary Authority? | Canary Authority Reference, Canary Authority Source, and Protected Canary Authority | Proposed `docs/adr/0004-public-serialized-validation-and-logical-record-correlation.md` | After wire parse, candidate agreement, Canary inspection, and process-local trusted plan acceptance, Canary Qualification's Authority Source Seam resolves the Facade's opaque protected-file reference for the admitted candidate and accepted plan; Trusted Command Binding receives only the successfully resolved capability | Canary Qualification Contract Tests plus ordered public-process and Clean Fixture negative controls proving the file is never parsed as authority | Owner-local `src/modules/canary-qualification/adapters/` Authority Source Adapter and Maintenance trusted binder |
| Where does a Qualification refusal become a Result Code and Exit Family? | Qualification Refusal Code, Result Code, and Exit Family | Proposed `docs/adr/0004-public-serialized-validation-and-logical-record-correlation.md` | Mapping: `src/modules/maintenance-command-contract/result-vocabulary.ts`; refusal meaning: `src/modules/qualification-evidence/interface.ts` | `src/modules/maintenance-command-contract/contract-tests/` and `src/modules/qualification-evidence/contract-tests/` | Maintenance Command Contract owns the mapping; Maintenance Command Facade Adapter projects the mapped outcome into the envelope |
| Who owns Logical Record Correlation? | Logical Record Correlation and Logical Record | Proposed `docs/adr/0004-public-serialized-validation-and-logical-record-correlation.md` | `src/adapters/maintenance-command-facade/interface.ts` | `src/adapters/maintenance-command-facade/contract-tests/` and public-process evidence inspect caller-captured records directly | Maintenance Command Facade Adapter; no reconstruction operation or retained state owner |
| Where are execution branches declared and reconciled? | Branch Station and Station Map | `docs/adr/0001-language-to-topology.md` | `src/modules/maintenance-command-contract/branch-stations.ts` | `src/modules/maintenance-command-contract/contract-tests/branch-station-catalog.test.ts` | Maintenance Command Contract Implementation |

## Context promotion

Create another Domain Context only when it owns distinct Ubiquitous Language or
Accepted Decisions whose consumers and rate of change differ from the root
context. A Module, Adapter, or large Implementation does not by itself earn a
new context. Until promotion is accepted, root `CONTEXT.md` governs every
future owner named above.
