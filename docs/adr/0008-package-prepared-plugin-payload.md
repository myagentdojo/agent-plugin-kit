---
status: accepted
---

# Package Prepared Plugin Payloads Through the Admitted Kit CLI

## Context and Problem

Source Checkout Admission (ADR 0007) admits an exact physical Kit checkout for
`payload:package`, but the admitted command returned an owner-absent refusal.
The Reference Implementation owns generic archive and checksum mechanics beside
its product preparation. One shared owner must package an already prepared
Plugin Payload with independent artifact evidence before that duplicate can be
retired.

## Decision

Nathan accepted the package contract and Test Design on 3 September 2026 and
commissioned this implementation under
[Issue 25](https://github.com/myagentdojo/agent-plugin-kit/issues/25) and
specification [Issue 24](https://github.com/myagentdojo/agent-plugin-kit/issues/24).
This decision promotes that acceptance to the code owner. It creates no new
owner, dependency, public export, Result Code, Exit Family, or Failure Class.

### Package request

- `PluginPayloadProduction.produce` keeps its three modes. `check` and
  `materialize` return `refused` until their own gate; a package preview maps
  to `check`, so it remains an honest deferred refusal.
- A package request names the Plugin Repository root, the explicit plugin
  Source Identity, the release `name`, `version`, and `tag` (`v<version>`),
  and a sealed preparation declaration. The plugin Source Identity is distinct
  from the Kit's Admitted Source Checkout Identity. Payload performs no Git or
  environment discovery.
- The declaration lists every regular file under `<root>/plugin/` as
  `{ path, bytes, sha256, executable }` in unique code-unit path order, plus
  projections `{ role, path, bytes, sha256 }` for `config`, `runtime-lock`,
  `bundle-inventory`, `skill-inventory`, and `native-manifest` inputs, the
  framed `payloadSha256`, and the preparation `bindingSha256`. Exactly one
  `runtime-lock` and one `bundle-inventory` projection are required because
  the checksum document binds both. A projection inside `plugin/` must also be
  a declared file with the same bytes.
- `bindingSha256` is the SHA-256 of the UTF-8 JSON array
  `[1, origin, commit, name, version, tag, files, projections, payloadSha256]`
  with no whitespace and no trailing newline. File tuples are
  `[path, bytes, sha256, executable]`; projection tuples are
  `[role, path, bytes, sha256]` ordered by role then path with code-unit
  comparison. Digests inside the Interface carry the `sha256:` prefix.
- `payloadSha256` keeps the framed digest: for each file in order, the
  eight-byte big-endian length of the UTF-8 path, the path, the eight-byte
  big-endian body length, then the body. Executable modes are bound by the
  declaration and the archive, never by the payload digest.
- Owner-local validators check shape at ingress. The Implementation refuses
  traversal, absolute paths, NUL, empty or `.`/`..` segments, unsorted or
  duplicate paths, symlinks, special files, empty directories, containment
  escape, undeclared or missing files, byte, hash, or mode mismatch, stale
  projection bytes, and binding disagreement. Valid newline and long paths are
  preserved.

### Artifacts

- Output is fixed to `<root>/dist/<name>-<version>.tar.gz` and
  `<root>/dist/<name>-<version>.checksums.json`.
- The archive is a USTAR tar of `<name>-<version>/` with directories at
  `0755`, executable files at `0755`, other files at `0644`, zero uid, gid,
  and mtime, `root` owner names, each directory listed beside its descendants
  in code-unit order, then gzip through the host `gzip -n -9 -c`.
- The checksum document is two-space JSON with a trailing newline and, in
  order, `repository`, `sourceCommit`, `tag`, `plugin`, `version`, `archive`,
  `archiveBytes`, `archiveSha256`, `runtimeLockSha256`,
  `bundleInventorySha256`, `payloadInventorySha256`, and the fixed integrity
  `evidence` sentence. Hex digests inside the document carry no prefix. The
  document's own hash is returned by the Interface, never embedded.
- A `packaged` result carries the source identity, release, binding, the
  regular-file inventory with payload digest, and both artifact records
  `{ path, bytes, sha256 }`. No success field is optional.

### Publication and failure

- Snapshot bytes once. Immediately before publication recheck every source
  input against that snapshot: the exact regular-file closure and its safety,
  each declared file's bytes and executable mode, and every projection. A
  source changed while the archive was compressed is refused and nothing is
  published. Stage privately under `dist/`, then publish archive first and
  checksums last with atomic no-replace link operations. Reread both files
  before success.
- Identical complete output is reusable. An exact archive without checksums
  is completed. A different archive, a different checksum document, a
  checksum-only state, or an unsafe existing path is preserved and refused.
  Concurrent identical attempts converge; conflicting concurrent candidates
  preserve the winner and refuse the other.
- Compression is bounded by a thirty-second deadline and runs in its own
  process group; on failure or deadline the group is terminated and reaped.
  Failure removes only invocation-owned temporary state.
- A `refused` result names its reason and one repair action and has no
  published effect. A `failed` result reports `none`, `archive-only`, or
  `unknown` publication, whether the failure is transient, and any artifact
  record it observed. The publication owner classifies every publication-phase
  fault against the artifacts actually present, so a fault after the archive is
  linked never reports an unchanged repository, and an output entry owned by
  another candidate stays a preserved conflict.
- Every projection path is resolved physically: each component from the
  repository root is inspected, so a symlinked ancestor cannot carry a regular
  leaf outside the named repository.
- Maintenance maps `packaged` with complete evidence to `completed` and
  `effect:payload-packaged`; `refused` to `command-refused`; `failed`
  `archive-only` to `continuation-required` with the archive effect completed
  and the checksum effect remaining; `failed` `unknown` to
  `recovery-required`; `failed` `none` to `retry-deferred` only when
  transient and otherwise to `command-refused`; a wrong owner result kind or
  incomplete artifact evidence to `runtime-failed`, never to a completed
  effect.

### Composition and quality policy

- The Facade composition root supplies the real Payload Implementation through
  a lazy import after Source Checkout Admission and trusted binding. The
  owner-absent replacement is removed. Released and protected commands keep
  their refusal families, Admission Bootstrap stays dependency-free, and the
  help runtime trace is unchanged.
- `.fallowrc.json` gains one explicit private-production zone for
  `src/modules/plugin-payload-production/implementation/`. Only the accepted
  value edges are admitted: the Facade and the Payload, Facade, and Clean
  Fixture Contract Test lanes may reach it. Repository Verification and the
  public export map are unchanged.
- Branch Stations: `payload-package.completed` and
  `payload-package.command-refused` become required and are reconciled by the
  Command Surface Alignment Proof through a real admitted process. The four
  remaining `payload:package` failure Stations stay implementation-deferred
  with a rationale naming their in-process fault-Adapter proof, because the
  closed reachability vocabulary has no fault-injection value and a
  declared-unreachable Station cannot cross egress. Check and materialize
  Stations keep the absent-owner rationale.

### Test Design

| Owner | Cases |
| --- | --- |
| `src/modules/plugin-payload-production/contract-tests/deterministic-plugin-payload.test.ts` | D01 to D20: exact paths, bytes, and modes; repeat stability under changed mtimes; code-unit ordering; newline paths; framing ambiguity; directory-adjacent descendants; literal USTAR/gzip digest; representable long paths; checksum identity and projection hashes; D10 to D18 nine checksum-field mutations refused with bytes preserved; product-only skill change; executable-bit-only change. |
| `src/modules/plugin-payload-production/contract-tests/unsafe-inventory-refusal.test.ts` | U01 to U18: internal, external, dangling, and nested-escape symlinks; Unix socket; empty directory; unrepresentable USTAR component; undeclared file; missing declared file; changed bytes, including a change during compression; source mismatch; stale projection, including a symlinked projection ancestor; compressor failure with descendant reaping; deadline; descriptor-retaining descendant; archive-only interruption, link fault after archive publication, unobservable artifact, and completion; identical and conflicting concurrent publication through two real processes released by one barrier. |
| `src/modules/maintenance-command-contract/contract-tests/package-result-and-admission.test.ts` | M01 wrong owner kind; M02 missing artifact evidence; M03 refusal keeps repair meaning; M05 unobservable publication maps to recovery. M04 stays Admission-owned. |
| `src/adapters/maintenance-command-facade/contract-tests/package-public-process.test.ts` | P02 real-binary malformed input; P03 source mismatch; P05 check, P06 materialize, and P07 package preview deferred; P08 checksum-only conflict; P09 unsafe output; P10 archive-only failure; P11 pre-publication failure. |
| `clean-fixture/personal-verification-profile/contract-tests/payload-package.test.ts` | C01 independent extraction; C02 byte, C03 mode, and C04 projection-hash sensitivity; C05 interrupted process cleanup and recovery; C06 second product and Canary-style consumer; C07 admitted real-process success. |

Fixtures are test-owned literals. Expected values come from OS tools, an
independent archive reader, `node:crypto`, and test-owned framing and binding
oracles, never from the Implementation. The successful Admission fixture
sends a well-formed package request naming a nonexistent payload root and
expects the Payload refusal; refused Admission still invokes no Payload.

## Non-Claims

No hosted, installed-consumer, Release, Workflow, Fresh-Native, publisher
authenticity, two-file atomicity, power-loss durability, or cross-platform
compressor equality claim. Consumer adoption, generation, bundling, Runtime
Custody, compiled delivery, and the rest of P4 remain separate.

## References

- [Issue 24](https://github.com/myagentdojo/agent-plugin-kit/issues/24)
- [Issue 25](https://github.com/myagentdojo/agent-plugin-kit/issues/25)
- [`0004-public-serialized-validation-and-logical-record-correlation.md`](0004-public-serialized-validation-and-logical-record-correlation.md)
- [`0005-simple-repository-quality-ownership.md`](0005-simple-repository-quality-ownership.md)
- [`0007-source-checkout-admission.md`](0007-source-checkout-admission.md)
