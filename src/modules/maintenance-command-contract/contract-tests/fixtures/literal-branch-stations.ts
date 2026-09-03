export const literalRequiredStationIds = [
  "help.previewed",
  "maintenance.usage-refused",
  "payload-package.completed",
  "payload-package.command-refused",
] as const

const literalDeclaredUnreachableStationIds = [
  "maintenance.runtime-failed",
  "help.command-refused",
  "help.retry-deferred",
  "help.recovery-required",
  "help.runtime-failed",
  "runtime-repair.runtime-repair-applied",
  "runtime-repair-apply.runtime-repair-preview",
] as const

type DeclaredUnreachableStationId =
  (typeof literalDeclaredUnreachableStationIds)[number]

type SkipRationale = Readonly<{
  ownerReason: string
  governingInterface: string
}>

export const literalDeclaredUnreachableRationales = {
  "maintenance.runtime-failed": {
    ownerReason:
      "No accepted argv, stdin, or named file can cause a pre-dispatch facade fault; owner-local fault Adapters retain containment proof.",
    governingInterface: "src/adapters/maintenance-command-facade/interface.ts",
  },
  "help.command-refused": {
    ownerReason:
      "No accepted argv, stdin, named file, or owner-local host input can cause the closed static help Interface to return this typed outcome.",
    governingInterface: "src/modules/maintenance-command-contract/interface.ts",
  },
  "help.retry-deferred": {
    ownerReason:
      "No accepted argv, stdin, named file, or owner-local host input can cause the closed static help Interface to return this typed outcome.",
    governingInterface: "src/modules/maintenance-command-contract/interface.ts",
  },
  "help.recovery-required": {
    ownerReason:
      "No accepted argv, stdin, named file, or owner-local host input can cause the closed static help Interface to return this typed outcome.",
    governingInterface: "src/modules/maintenance-command-contract/interface.ts",
  },
  "help.runtime-failed": {
    ownerReason:
      "No accepted argv, stdin, named file, or owner-local host input can cause the closed static help Interface to return this typed outcome.",
    governingInterface: "src/modules/maintenance-command-contract/interface.ts",
  },
  "runtime-repair.runtime-repair-applied": {
    ownerReason:
      "runtime:repair is inspection-only and cannot request Runtime Custody repair --apply.",
    governingInterface: "src/modules/runtime-custody/interface.ts",
  },
  "runtime-repair-apply.runtime-repair-preview": {
    ownerReason:
      "The apply precondition consumes a fresh preview and returns the final mapped result, never the consumed preview.",
    governingInterface: "src/modules/runtime-custody/interface.ts",
  },
} as const satisfies Record<DeclaredUnreachableStationId, SkipRationale>

export const literalBranchKinds = [
  "execution",
  "usage",
  "refusal",
  "retry",
  "continuation",
  "recovery",
  "unexpected",
] as const

export const literalImplementationDeferredCounts = {
  "plugin-payload-production": 15,
  "runtime-custody": 48,
  "release-and-git-engine": 11,
  "harness-journeys": 22,
  "canary-qualification": 11,
} as const

export const literalDeferredOwnerProofs = {
  "plugin-payload-production": {
    controllingOwnerId: "plugin-payload-production",
    futureSelector:
      "bun test src/modules/plugin-payload-production/contract-tests/deterministic-plugin-payload.test.ts src/modules/plugin-payload-production/contract-tests/unsafe-inventory-refusal.test.ts",
    expectedTestCount: 38,
    skipRationale:
      "Plugin Payload Production check and materialize modes remain deferred in the current stage; supplying a request file proves facade loading only, not an owner outcome. Future selector: bun test src/modules/plugin-payload-production/contract-tests/deterministic-plugin-payload.test.ts src/modules/plugin-payload-production/contract-tests/unsafe-inventory-refusal.test.ts. Non-Claim: The current-stage proof does not prove Plugin Payload Production check, materialize, or fault-only package failure outcomes through a real process.",
    nonClaim:
      "The current-stage proof does not prove Plugin Payload Production check, materialize, or fault-only package failure outcomes through a real process.",
  },
  "runtime-custody": {
    controllingOwnerId: "runtime-custody",
    futureSelector:
      "bun test src/modules/runtime-custody/contract-tests/run-and-repair.test.ts src/modules/runtime-custody/contract-tests/corrupt-custody-refusal.test.ts",
    expectedTestCount: 12,
    skipRationale:
      "Runtime Custody Implementation remains absent in the current stage; Runtime argv proves dispatch shape only, not custody outcome. Future selector: bun test src/modules/runtime-custody/contract-tests/run-and-repair.test.ts src/modules/runtime-custody/contract-tests/corrupt-custody-refusal.test.ts. Non-Claim: The current-stage proof does not prove Runtime Custody result, refresh, download, lock, or repair through a real process.",
    nonClaim:
      "The current-stage proof does not prove Runtime Custody result, refresh, download, lock, or repair through a real process.",
  },
  "release-and-git-engine": {
    controllingOwnerId: "release-and-git-engine",
    futureSelector:
      "bun test src/modules/release-and-git-engine/contract-tests/candidate-admission-and-convergence.test.ts src/modules/release-and-git-engine/contract-tests/stale-candidate-approval.test.ts",
    expectedTestCount: 12,
    skipRationale:
      "Release and Git Engine Implementation remains absent in the current stage; request and approval files do not establish a release owner outcome. Future selector: bun test src/modules/release-and-git-engine/contract-tests/candidate-admission-and-convergence.test.ts src/modules/release-and-git-engine/contract-tests/stale-candidate-approval.test.ts. Non-Claim: The current-stage proof does not prove Release and Git Engine inspection, mutation, or recovery through a real process.",
    nonClaim:
      "The current-stage proof does not prove Release and Git Engine inspection, mutation, or recovery through a real process.",
  },
  "harness-journeys": {
    controllingOwnerId: "harness-journeys",
    futureSelector:
      "bun test src/modules/harness-journeys/contract-tests/claude-journey-recovery.test.ts src/modules/harness-journeys/contract-tests/codex-checkout-isolation.test.ts",
    expectedTestCount: 14,
    skipRationale:
      "Harness Journeys Implementation remains absent in the current stage; request and approval files do not establish a Harness outcome. Future selector: bun test src/modules/harness-journeys/contract-tests/claude-journey-recovery.test.ts src/modules/harness-journeys/contract-tests/codex-checkout-isolation.test.ts. Non-Claim: The current-stage proof does not prove Claude or Codex Harness transition, retry, continuation, or recovery through a real process.",
    nonClaim:
      "The current-stage proof does not prove Claude or Codex Harness transition, retry, continuation, or recovery through a real process.",
  },
  "canary-qualification": {
    controllingOwnerId: "canary-qualification",
    futureSelector:
      "bun test src/modules/canary-qualification/contract-tests/trusted-target-derivation.test.ts src/modules/canary-qualification/contract-tests/credential-removal.test.ts",
    expectedTestCount: 10,
    skipRationale:
      "Canary Qualification Implementation remains absent in the current stage; candidate and authority files do not establish a canary owner outcome. Future selector: bun test src/modules/canary-qualification/contract-tests/trusted-target-derivation.test.ts src/modules/canary-qualification/contract-tests/credential-removal.test.ts. Non-Claim: The current-stage proof does not prove Canary Qualification inspection, protected effect, or recovery through a real process.",
    nonClaim:
      "The current-stage proof does not prove Canary Qualification inspection, protected effect, or recovery through a real process.",
  },
} as const

const inspectFamily = ["command-refused", "retry-deferred", "recovery-required", "runtime-failed"] as const
const applyFamily = ["command-refused", "retry-deferred", "continuation-required", "recovery-required", "runtime-failed"] as const
const runtimeCodes = [
  "runtime-usage-refused", "runtime-bun-missing", "runtime-cache-root-unsafe",
  "runtime-repair-required", "runtime-host-tool-missing", "runtime-not-executable",
  "runtime-unsupported-platform", "runtime-download-failed", "runtime-lock-held",
  "runtime-archive-hash-mismatch", "runtime-archive-member-ambiguous",
  "runtime-archive-member-missing", "runtime-archive-size-mismatch",
  "runtime-bundle-mismatch", "runtime-bundle-unmapped",
  "runtime-executable-hash-mismatch", "runtime-executable-size-mismatch",
  "runtime-executable-version-mismatch", "runtime-lock-invalid", "runtime-skill-unknown",
  "runtime-url-rejected", "runtime-control-invalid",
] as const

const ids = (slug: string, codes: readonly string[]) => codes.map((code) => `${slug}.${code}`)
const ownerPair = (inspectSlug: string, applySlug: string) => [
  `${inspectSlug}.previewed`, ...ids(inspectSlug, inspectFamily),
  `${applySlug}.completed`, ...ids(applySlug, applyFamily),
]

export const literalBranchStationIds = [
  "help.previewed",
  "maintenance.usage-refused",
  ...literalDeclaredUnreachableStationIds,
  "payload-check.previewed", ...ids("payload-check", inspectFamily),
  "payload-materialize.completed", ...ids("payload-materialize", applyFamily),
  "payload-package.completed", ...ids("payload-package", applyFamily),
  "runtime-repair.runtime-repair-preview",
  "runtime-repair.runtime-repair-unneeded",
  "runtime-repair-apply.runtime-repair-applied",
  "runtime-repair-apply.runtime-repair-unneeded",
  ...ids("runtime-repair", runtimeCodes),
  ...ids("runtime-repair-apply", runtimeCodes),
  ...ownerPair("release-inspect", "release-apply"),
  ...ownerPair("harness-claude-inspect", "harness-claude-apply"),
  ...ownerPair("harness-codex-inspect", "harness-codex-apply"),
  ...ownerPair("canary-inspect", "canary-qualify"),
] as const

export const literalExitByResultCode: Readonly<Record<string, number>> = {
  completed: 0, previewed: 0, "runtime-repair-preview": 0,
  "runtime-repair-unneeded": 0, "runtime-repair-applied": 0,
  "runtime-failed": 1, "runtime-control-invalid": 1,
  "usage-refused": 2, "runtime-usage-refused": 2,
  "continuation-required": 20, "recovery-required": 20,
  "runtime-bun-missing": 20, "runtime-cache-root-unsafe": 20,
  "runtime-repair-required": 20, "command-refused": 21,
  "runtime-host-tool-missing": 21, "runtime-not-executable": 21,
  "runtime-unsupported-platform": 21, "retry-deferred": 22,
  "runtime-download-failed": 22, "runtime-lock-held": 22,
  "runtime-archive-hash-mismatch": 23, "runtime-archive-member-ambiguous": 23,
  "runtime-archive-member-missing": 23, "runtime-archive-size-mismatch": 23,
  "runtime-bundle-mismatch": 23, "runtime-bundle-unmapped": 23,
  "runtime-executable-hash-mismatch": 23, "runtime-executable-size-mismatch": 23,
  "runtime-executable-version-mismatch": 23, "runtime-lock-invalid": 23,
  "runtime-skill-unknown": 23, "runtime-url-rejected": 23,
}

export const literalRepairRouteByResultCode: Readonly<Record<string, string | null>> = {
  "usage-refused": "help", "runtime-usage-refused": "help",
  "runtime-repair-applied": "runtime:repair", "runtime-repair-required": "runtime:repair-apply",
}

export const literalRepairRouteByStationId: Readonly<Record<string, string | null>> = {
  "help.previewed": null,
  "payload-check.previewed": null,
  "payload-materialize.completed": null,
  "payload-package.completed": null,
  "runtime-repair.runtime-repair-preview": "runtime:repair-apply",
  "runtime-repair.runtime-repair-unneeded": null,
  "runtime-repair.runtime-repair-applied": null,
  "runtime-repair-apply.runtime-repair-applied": "runtime:repair",
  "runtime-repair-apply.runtime-repair-unneeded": null,
  "runtime-repair-apply.runtime-repair-preview": "runtime:repair",
  "release-inspect.previewed": "release:apply",
  "release-apply.completed": null,
  "harness-claude-inspect.previewed": "harness:claude:apply",
  "harness-claude-apply.completed": null,
  "harness-codex-inspect.previewed": "harness:codex:apply",
  "harness-codex-apply.completed": null,
  "canary-inspect.previewed": "canary:qualify",
  "canary-qualify.completed": null,
}
