# Native Fallow Quality Gate

Goal: audit the current code-changing delta through Fallow's native JSON and
exit contract. `bun run check` is the complete done condition; its base-free
Fallow step honors `FALLOW_AUDIT_BASE` and otherwise uses native upstream or
remote-default merge-base detection. The repository has no Fallow wrapper or
JSON interpretation layer.

## Start

1. Read root `CONTEXT.md` and `CONTEXT-MAP.md`.
2. Read `.agents/skills/fallow/SKILL.md`, then its version-matched owner at
   `node_modules/fallow/skills/fallow/SKILL.md`.
3. Resolve flags from `node_modules/.bin/fallow`, never from memory.
4. Keep MCP, global installation, PATH overrides, and broad suppressions out of
   this owner.

## Commands

For a dirty code-changing turn:

```sh
bun run --silent quality:fallow --changed-since HEAD
```

For review or handoff, replace `HEAD` with the immutable task-start Full Commit
Pin. A clean comparison to `HEAD` is only an empty-delta smoke check.

The complete repository gate is:

```sh
bun run check
```

It invokes Fallow without a comparison-base argument. Pin
`FALLOW_AUDIT_BASE` to the exact comparison commit for clean-tip review proof;
otherwise Fallow selects the branch upstream or remote-default merge-base.

## Native decisions

The command emits native Fallow JSON on stdout. Preserve it as tool evidence;
do not parse it into another repository contract.

| Exit | Meaning |
| ---: | --- |
| 0 | The native audit passed. |
| 1 | Findings failed the configured policy, or required type-aware evidence was incomplete. |
| 2 | The comparison base, configuration, or native operation was invalid. |

`.fallowrc.json` pins `new-only` attribution, requires complete type-aware
evidence, and promotes every applicable warn-default rule to `error`. This
makes the native exit the gate without a wrapper. Focused pinned-version tests
prove a promoted finding, unavailable type-aware evidence, and invalid-base
exit two.

## Architecture policy

Before changing a TypeScript import edge, inspect the rule that applies:

```sh
node_modules/.bin/fallow guard <FILE> --format json --quiet
```

Inspect the resolved first-match zone order with:

```sh
node_modules/.bin/fallow list --boundaries --format json --quiet
```

`.fallowrc.json` owns the zone graph, type-only edges, complete reachable-source
coverage, and suppression hygiene. Keep an approved value dependency explicit.
Use a type-only import when runtime access is not required, and target the
other Module's Interface rather than its private files. The one accepted
Qualification Evidence value edge reaches Release and Git Engine's private
serialized-value surface through narrow private zones. Module Interfaces,
private production, Module Contract Tests, Adapter production, and Adapter
Contract Tests are explicit first-match lanes, so test access cannot authorize
production and a future private file cannot inherit a public Interface zone.
Admission's Interface, Implementation, and Contract Tests are separated for
the same reason; only its Contract Tests may reach Clean Fixture. Do not add
directory-wide auto-discovery. A new owner or source shape must remain unzoned
until its policy is deliberately accepted. Every inline suppression carries
`-- <reason>`; a missing reason or stale suppression is a native refusal.

Run the focused architecture canary after changing imports or Fallow policy:

```sh
bun run test:quality:fallow-policy
```

## Comparison bases

- Complete gate: leave the CLI base unset so `FALLOW_AUDIT_BASE` or native
  merge-base detection owns selection. Treat a zero-file result as an
  empty-delta smoke, not changed-code review evidence.
- Dirty turn: use `HEAD` so tracked and untracked work remains in scope.
- Review and handoff: use the immutable task-start Full Commit Pin.
- Remote integration: use a freshly resolved remote ref only after that remote
  action is authorized.
- Never disable type-aware analysis or save a count baseline to make a gate
  pass.

## Editor resolution

VS Code resolves both `node_modules/.bin/fallow` and
`node_modules/.bin/fallow-lsp` from this repository. One root
`.fallowrc.json` governs the root and all Owner Manifests. The tracked editor
setting supplies only `fallow.changedSince: "HEAD"` because the repository has
no upstream from which the editor can infer a comparison.

If project-binary resolution fails, stop. Do not change global PATH, set
`fallow.lspPath` or `fallow.configPath`, or add another editor override.

## Runtime state and repair

Fallow may create self-ignored `.fallow/` caches. Inspect them when diagnosing,
but never commit them or place source inside them. Repository Verification
excludes these caches from source discovery before inspecting metadata.

Repair only the reported finding. Do not weaken a Contract Test, add a broad
ignore, or turn the repository into a suppression baseline. TypeScript remains
authoritative for compilation; Fallow type-aware completeness is quality
evidence only. An unzoned reachable source file, unapproved cross-zone edge,
missing suppression reason, or stale suppression fails the complete gate.
