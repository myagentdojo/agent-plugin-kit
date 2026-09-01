---
status: accepted
amends: 0004-public-serialized-validation-and-logical-record-correlation.md
---

# Expose the Qualification Evidence Reducer Through Its Public Subpath

Clean Fixture must reduce both accepted Verification Profiles through the real
Qualification Evidence implementation. A private Implementation import or a
test-owned reducer would prove a different system.

## Decision

- `agent-plugin-kit/qualification-evidence` preserves the existing
  `VerificationProfile` sentinel and also exports the single production
  `qualificationEvidence` value declared by the Qualification Evidence
  Interface and implemented by its existing private Implementation.
- The root `agent-plugin-kit` export remains type-only and gains no runtime
  value.
- The public subpath uses ordered `types`, `import`, and `default` targets. The
  declaration target remains `interface.ts`; both runtime conditions resolve
  to the same existing Implementation file.
- Qualification Evidence retains sole ownership of reduction. No wrapper,
  second reducer, schema package, service, or orchestration layer is created.
- Clean Fixture Contract Tests prove the public subpath resolves to the
  production reducer through an installed-consumer process.

## Amendment to ADR 0004

ADR 0004 previously preserved only the `VerificationProfile` sentinel at this
subpath and required every non-Admission subpath to keep empty runtime output.
This decision narrows that rule: Qualification Evidence now exposes its
existing sentinel and its reducer. Admission Bootstrap and Qualification
Evidence are the two public subpaths with named runtime values. All other
subpaths and the root export keep their accepted runtime shape.

## Non-Claims

This decision does not prove publication, Git dependency installation, hosted
execution, Fresh-Native execution, or any Verification Profile claim. It only
makes the existing reducer reachable through the public Package Identity.
