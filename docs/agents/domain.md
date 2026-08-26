# Domain Documents

Use the Kit Repository's canonical language and Accepted Decisions before
changing a name, owner, Interface, Adapter, Contract Test, or Repository
Topology.

## Read

1. Read root `CONTEXT.md` for the system-wide Ubiquitous Language.
2. Read root `CONTEXT-MAP.md` to route the question to its current or future
   owner.
3. Read the relevant `docs/adr/` decision before changing architecture.

Root `CONTEXT.md` is the only active Domain Context. `CONTEXT-MAP.md` exists as
the navigation owner and does not imply one context per Module. Create a local
context lazily only after distinct vocabulary or Accepted Decisions prove the
root context insufficient.

## Accepted structure

```text
/
├── CONTEXT.md
├── CONTEXT-MAP.md
├── docs/adr/
├── src/                                  (future Source Tree)
│   ├── admission-bootstrap/
│   ├── modules/<canonical-module>/
│   │   ├── interface.ts
│   │   ├── contract-tests/
│   │   │   ├── fixtures/
│   │   │   └── adapters/
│   │   └── implementation/
│   └── adapters/reusable-workflow-adapter/
└── clean-fixture/                        (future independent proof)
```

Future paths remain absent until their owning artifact has approved real
content. Use the exact terms from `CONTEXT.md` in issues, filenames, test names,
and proposals. Surface an ADR conflict instead of silently overriding it.
