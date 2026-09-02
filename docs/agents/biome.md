# Native Biome Policy

Goal: keep file-local syntax, direct import, global, and dependency policy in
the pinned Biome configuration. Use Fallow for architecture graph policy and
Repository Verification for cross-manifest or filesystem agreement.

## Start

1. Read `biome.jsonc` for the current rule owner and path scope.
2. Run the repository-local `node_modules/.bin/biome` binary.
3. Add a built-in rule only when its native diagnostic replaces repository
   code or closes an accepted local policy gap.

## Commands

```sh
bun run biome:check
bun test tooling/repository-quality/contract-tests/biome-policy.test.ts
```

Use `bun run biome:fix` only after inspecting the proposed files and keeping
the change inside the active task.

## Ownership

- `biome.jsonc` owns enabled rules and path-scoped overrides.
- `biome-policy.test.ts` owns pinned-version positive and negative canaries.
- `.fallowrc.json` owns architecture zones and cross-zone import policy.
- Repository Verification owns cross-manifest and filesystem relationships.

Repair the reported source or the accepted policy owner. Do not add GritQL,
another lint wrapper, or copied rule prose unless a separate accepted decision
proves that the native Biome 2.4.15 rule set cannot express the local rule.
