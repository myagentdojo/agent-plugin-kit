---
status: accepted
---

# Admit Exact Source Checkouts for Package-Only Commands

## Context and Problem

Released Admission requires Repository, Source Provenance, Release, Package,
and Workflow identities to agree before Kit Repository Implementation executes.
A Plugin Consumer using a local Kit checkout has no Release or Workflow
identity to supply. Inventing either observation would weaken the released
contract and overstate the evidence. The Kit needs a narrow source-checkout
capability that identifies the exact executing checkout without granting a
released or protected command.

## Decision

- Source Checkout Admission is a second, separately branded capability beside
  released Admitted Identity. It contains only Source Identity and Package
  Identity, carries `profile: "source-checkout"`, and cannot substitute for a
  released Admitted Identity.
- A committed consumer root `package.json` at consumer HEAD is the sole pin
  authority. Its dependency must be
  `git+https://<canonical-origin>.git#<40-lowercase-hex>`. The committed Kit
  `package.json#repository.url` at Kit HEAD supplies canonical origin; a Git
  remote URL is not identity.
- Admission requires the executing entry to be tracked in the exact Kit Git
  top level, the whole non-ignored Kit tree to be clean, and the consumer's
  installed Kit link to resolve to that physical checkout. The consumer must
  be a separate Git repository. Only its root authority manifest is checked
  for dirtiness, so unrelated consumer output remains outside this judgment.
- The Maintenance Command Facade composition root owns read-only Source
  Checkout Observation. It receives only the executing entry, working
  directory, and environment; it accepts no Wire Command or request JSON.
  Fixed, bounded, scrubbed Git invocations observe identity facts. Admission
  Bootstrap judges the observations and creates the capability.
- Maintenance parses one Wire Command, checks capability, admits once, and
  binds once. Source Checkout Admission uses `committed-pin` for
  `payload:check` and `payload:materialize`, and `committed-manifest` for
  `payload:package`. Every other command refuses before Admission and before
  protected authority access.
- Until Plugin Payload Production supplies a collaborator,
  `payload:package` with an admitted source checkout projects the existing
  usage-refusal family with the message "Maintenance command owner is not
  implemented." Admission refusal projects "Maintenance source checkout is
  not admitted." This decision creates no successful packaging claim.
- Admission Bootstrap remains dependency-free. Release and Git Engine owns the
  declaration-only identity values and private strict validators. The Facade
  Fallow edge widening is limited to the accepted value and type edges under
  ADR 0005.
- The Facade Contract Test zone may value-import Admission Bootstrap
  Implementation solely to prove that F01's observed request is admitted. This
  is a test-only proof edge, not a production Facade dependency.
- Admission Bootstrap Contract Tests may value-import Release and Git Engine's
  private serialized validator solely for A05 strict boundary validation. This
  is a pinned test proof edge; Admission production remains dependency-free.

## Amendment to ADR 0004

Nathan accepted this scoped amendment on 3 September 2026:

> Admission observation in the composition root, Wire Command validation,
> help, and refusal projection precede Admission. Deep Module Implementation
> dispatch through `MaintenanceCommands` follows Admission and trusted binding.
> Admission observation is read-only, effect-free, and bounded to identity
> facts of the executing checkout and its consumer.

This distinguishes admission-related shell work from Deep Module
Implementation dispatch. It does not broaden pre-Admission execution beyond
the stated observation, validation, help, and refusal projection.

## Development metadata amendment

Nathan accepted this scoped amendment on 6 September 2026. Initialization
changes the consumer package version before `generate:check`; development
checks must retain the committed Kit pin without requiring an unrelated
metadata commit.

- Maintenance Command Contract selects `committed-pin` only after parsing and
  admitting the command vocabulary for `payload:check` or
  `payload:materialize`. It selects `committed-manifest` for `payload:package`.
- Source Checkout Observation receives that policy from the composition root,
  without accepting a Wire Command, request paths, or caller-supplied identity.
  Its default remains `committed-manifest`.
- Under `committed-pin`, the consumer manifest at HEAD remains the sole pin
  authority. The index and regular working manifest must both contain the same
  exact Kit dependency string. Other metadata may differ. Missing, malformed,
  untracked, symlinked, or pin-changing authority refuses.
- Packaging retains full consumer-manifest cleanliness. Every route retains
  clean executing Kit source, exact checkout identity, physical link checks,
  and fail-closed Git observation. Released and protected commands are unchanged.

This supersedes only the whole-consumer-manifest cleanliness requirement for
check and materialize. It does not admit uncommitted Kit upgrades. Requiring a
metadata commit would interrupt initialization; weakening every command would
unnecessarily change packaging policy.

Confirmation: F04 Git-observation cases, M01 command-policy selection, and CF04
real materialize/check after a version edit, with package and changed-pin
refusal controls. Existing counts are retained by extending those cases.

## Consequences retained

- Positive: local package work can prove an exact physical source checkout
  without fabricating Release or Workflow evidence.
- Positive: released Admission, protected commands, public runtime exports,
  help loading, and Station vocabulary retain their existing contracts.
- Negative: Git-installed copies, dirty Kit checkouts, uncommitted consumer
  authority, noncanonical pins, unresolved Git, and link mismatches refuse
  rather than being inferred trustworthy.
- Neutral: publisher authenticity, installed dependency bytes, consumer
  identity, generated output, Git internals, and mutation after observation
  remain outside this capability's claim.
- Neutral: My Second Brain consumer adoption and Plugin Payload Production
  remain separate owner decisions.

## Confirmation

Confirm the decision through owner-local strict-value and Admission Bootstrap
Contract Tests, Maintenance binding and real Git-observation Contract Tests,
and the Clean Fixture public process. The proof must preserve exact refusal
bytes, one parse and admission sequence, the help runtime trace, released and
protected command behaviour, and the dependency-free Admission closure.

## References

- [Issue 21](https://github.com/myagentdojo/agent-plugin-kit/issues/21)
- [Issue 22](https://github.com/myagentdojo/agent-plugin-kit/issues/22)
- [`0004-public-serialized-validation-and-logical-record-correlation.md`](0004-public-serialized-validation-and-logical-record-correlation.md)
- [`0005-simple-repository-quality-ownership.md`](0005-simple-repository-quality-ownership.md)
