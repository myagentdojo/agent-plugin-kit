---
status: accepted
---

# Keep Repository Governance With Repository Quality Tooling

Repository Quality Tooling owns repository-wide quality and transition policy
outside the Source Tree. Its Repository Qualification declaration records the
exact paths, Source Closure, proof groups, and expected RED or GREEN states
allowed at one reviewed repository transition.

Clean Fixture remains an independent Plugin Consumer and higher Proof Layer.
It may supply public-process and cross-Module evidence to Repository
Qualification, but it does not own repository structure, permitted path
changes, group counts, or transition policy.

## Admission Public Subpath Condition Split

The accepted Admission Bootstrap public Seam uses one conditional package
subpath rather than making `interface.ts` executable:

```json
{
  "./admission-bootstrap": {
    "types": "./src/admission-bootstrap/interface.ts",
    "import": "./src/admission-bootstrap/implementation/admission-bootstrap.ts",
    "default": "./src/admission-bootstrap/implementation/admission-bootstrap.ts"
  }
}
```

Repository Qualification owns this condition split through
`repository-qualification-contract.json`,
`verify-repository-qualification.ts`, its owner-local Contract Tests, and the
Clean Fixture `admission-package-projection.json`.

The declaration and verifier must:

- preserve the exact ordered `types`, `import`, and `default` conditions;
- require `import` and `default` to resolve to the same private runtime target;
- discover public types only from the `types` target;
- preserve the exact runtime catalog: the root is empty, Admission exports
  exactly `admissionBootstrap`, Qualification Evidence preserves
  `VerificationProfile`, and the other seven named subpaths are empty;
- hash the Admission runtime target independently from its declaration target;
- derive this exact three-file Admission Source Closure from the runtime
  target: `src/admission-bootstrap/implementation/admission-bootstrap.ts`,
  `src/admission-bootstrap/interface.ts`, and
  `src/modules/release-and-git-engine/interface.ts`; classify only the private
  Admission Implementation as runtime source; keep
  `src/admission-bootstrap/package.json` separately in `owner_manifest`, not in
  `source_closure`; and require the Clean Fixture `copiedClosure` observation to
  equal those three Source Tree paths in sorted order; and
- reject a missing, reordered, additional, or escaped condition or target,
  runtime-value drift, and every additional deep-Implementation export key.

This is current repository-byte truth only. It gives Repository Qualification
no ticket, worktree, review, integration, or progression authority.

## Consequences

- `tooling/repository-quality/` remains one repository-level Module rather
  than splitting Fallow and transition policy into shallow sibling owners.
- Repository Quality Tooling is the current logical owner. Its canonical
  Repository Qualification declaration is
  `tooling/repository-quality/repository-qualification-contract.json`.
- Fallow policy remains in `tooling/repository-quality/fallow-policy.ts` with
  owner-local Contract Tests.
- Repository Qualification owns current repository-byte truth and the reviewed
  RED or GREEN receipt. Clean Fixture remains an independent evidence source
  and does not own repository transition policy.
- Repository Qualification keeps package Implementation outside repository
  tooling.
- Repository Quality Tooling remains outside Package Identity and cannot
  become a caller-visible Source Tree surface.
