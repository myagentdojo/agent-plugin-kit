# Fallow Repository Quality

Repository Quality Tooling owns the Kit Repository's deterministic changed-code
quality policy. Use this guidance for Fallow setup, changed-code analysis,
warning enforcement, comparison-base selection, editor resolution, and repair.

## Start

1. Read root `CONTEXT.md` and `CONTEXT-MAP.md`.
2. Read `.agents/skills/fallow/SKILL.md`, then its version-matched owner at
   `node_modules/fallow/skills/fallow/SKILL.md`.
3. Resolve live flags from the repository-local executable, never from memory.
4. Keep MCP, MCPorter, official hooks, global installation, and broad
   suppressions outside this owner.

## Commands

For a dirty code-changing turn:

```sh
bun run --silent quality:fallow --changed-since HEAD
```

For task review or handoff, first replace `HEAD` with the immutable task-start
Full Commit Pin. Accept that run only when type-aware attribution is complete
and warning-free. If Fallow reports incompatible base and head semantic
identities, preserve the error and use the reviewed composite proof named in
the project packet; never relabel its syntactic attribution as complete
type-aware evidence. A clean comparison to `HEAD` is only an empty-delta smoke
check.

Run the focused policy proof with:

```sh
bun run test:quality:fallow-policy
```

Run the complete repository gate with:

```sh
bun run check
```

## Machine result

The policy command emits exactly one JSON document on stdout and nothing on
stderr. Interpret its adapter exit before inspecting native details:

| Exit | Decision | Meaning |
| ---: | --- | --- |
| 0 | `accepted` | Warning-free, complete Fallow 3.19.0 evidence has zero introduced findings. |
| 1 | `refused` | Valid analysis completed, but findings violate Kit policy. |
| 2 | `error` | Preflight, comparison, native runtime, schema, completeness, or Adapter evidence is unreliable. |

Use `reason_code` and `repair_hint` as the stable continuation. Preserve the
native `fallow` document as evidence. Never execute a repair hint as a command.
Do not treat native exit 0 as automatic acceptance: warning findings can still
be introduced and therefore refused.

## Comparison bases

- Dirty turn: use `HEAD` so tracked and untracked work remains in scope.
- Review and handoff: attempt the immutable task-start Full Commit Pin and
  require warning-free semantic attribution. If semantic identities are
  incompatible, fail closed and follow the packet's reviewed composite proof.
- Remote integration: use a freshly resolved `origin/main` only after that
  remote and action are separately approved. It never replaces the task pin.
- Missing or unresolved bases and all type-aware warnings fail closed. Do not
  substitute an implicit branch, disable type-aware analysis, or save a count
  baseline.

## Editor resolution

VS Code must resolve both `node_modules/.bin/fallow` and
`node_modules/.bin/fallow-lsp` from this repository. One root `.fallowrc.json`
governs the root plus all ten workspace packages. Tracked
`.vscode/settings.json` supplies only `fallow.changedSince: "HEAD"` because
this repository has no upstream from which the editor can infer a comparison.

After final dependency, policy, and editor setup, restart or reload the Fallow
language server and verify:

- CLI and LSP both report 3.19.0 from the repository;
- the root config reaches 11 roots and ten workspaces;
- `Fallow: Audit Changed Files` returns a parsed verdict against `HEAD`; and
- no PATH mismatch, managed-download 404, missing-config warning, or package
  dependency-location warning remains.

If project-binary resolution fails, stop. Do not change global PATH, set
`fallow.lspPath` or `fallow.configPath`, or add another editor override.

## Runtime state and repair

Fallow may create a self-ignored `.fallow/` runtime cache at the repository
root and at each invoked workspace root. Inspect these caches when diagnosing,
but never commit them or place TypeScript source inside them; Repository
Qualification refuses TypeScript found in any `.fallow/` directory. The
tracked Codex and Claude skills are small version-matched pointers into ignored
`node_modules`; a frozen Bun install must restore their target.

Repair only the named refusal. Do not delete or weaken an accepted Contract
Test, add a broad ignore, or turn the existing inventory into a suppression
baseline. TypeScript remains authoritative for compilation; Fallow type-aware
completeness is quality evidence only.
