# Domain Documents

Use the Kit Repository's canonical language and Accepted Decisions before
changing a name, owner, Interface, Adapter, Contract Test, or Repository
Topology.

## Read

1. Read root `CONTEXT.md` for the system-wide Ubiquitous Language.
2. Read root `CONTEXT-MAP.md` to route the question to its current or future
   owner.
3. Use the Accepted Decision index below and read the relevant decision before
   changing architecture.

Root `CONTEXT.md` is the only active Domain Context. `CONTEXT-MAP.md` exists as
the navigation owner and does not imply one context per Module. Create a local
context lazily only after distinct vocabulary or Accepted Decisions prove the
root context insufficient.

## Accepted Decisions

| Decision | Governs |
| --- | --- |
| [`0001-language-to-topology.md`](../adr/0001-language-to-topology.md) | Ubiquitous Language to Repository Topology. |
| [`0002-owner-manifests-and-dependency-locality.md`](../adr/0002-owner-manifests-and-dependency-locality.md) | Owner Manifests and owner-local dependency Locality. |
| [`0003-repository-quality-and-verification-transition.md`](../adr/0003-repository-quality-and-verification-transition.md) | Superseded historical transition design. |
| [`0004-public-serialized-validation-and-logical-record-correlation.md`](../adr/0004-public-serialized-validation-and-logical-record-correlation.md) | Owner-local Public Serialized Value validation, trusted capability binding, and Logical Record Correlation. |
| [`0005-simple-repository-quality-ownership.md`](../adr/0005-simple-repository-quality-ownership.md) | Biome, TypeScript, native Fallow, Repository Verification, and Clean Fixture proof ownership. |
| [`0006-qualification-evidence-public-runtime.md`](../adr/0006-qualification-evidence-public-runtime.md) | Qualification Evidence public reducer ownership and installed-consumer proof. |
| [`0007-source-checkout-admission.md`](../adr/0007-source-checkout-admission.md) | Exact physical Source Checkout Admission for package-only commands. |
| [`0008-package-prepared-plugin-payload.md`](../adr/0008-package-prepared-plugin-payload.md) | Prepared Plugin Payload packaging, no-replace publication, result mapping, and its Test Design. |

## Accepted structure

```text
/
├── CONTEXT.md
├── CONTEXT-MAP.md
├── package.json                          (root Package Identity)
├── docs/adr/
├── tooling/repository-quality/           (lifecycle-neutral repository quality)
│   ├── contract-tests/
│   ├── repository-verification.ts
│   └── verify-repository.ts
├── src/                                  (Source Tree)
│   ├── interface.ts
│   ├── admission-bootstrap/
│   │   ├── package.json                  (Owner Manifest)
│   │   ├── interface.ts
│   │   ├── contract-tests/
│   │   └── implementation/               (future)
│   ├── modules/<canonical-module>/
│   │   ├── package.json                  (Owner Manifest)
│   │   ├── interface.ts
│   │   ├── contract-tests/
│   │   │   ├── fixtures/
│   │   │   └── adapters/
│   │   └── implementation/               (present for Plugin Payload Production package mode; future elsewhere)
│   └── adapters/reusable-workflow-adapter/
│       ├── package.json                  (Owner Manifest)
│       ├── interface.ts
│       ├── contract-tests/               (future)
│       └── implementation/               (future)
└── clean-fixture/                        (independent proof)
```

Future paths remain absent until their owning artifact has approved real content. Use the exact
terms from `CONTEXT.md` in issues, filenames, test names, and proposals. Surface
an ADR conflict instead of silently overriding it.
