export const literalRequiredStationIds = [
  "help.previewed",
  "maintenance.usage-refused",
] as const

export const literalDeclaredUnreachableStationIds = [
  "maintenance.runtime-failed",
  "help.command-refused",
  "help.retry-deferred",
  "help.recovery-required",
  "help.runtime-failed",
  "runtime-repair.runtime-repair-applied",
  "runtime-repair-apply.runtime-repair-preview",
] as const

export type DeclaredUnreachableStationId =
  (typeof literalDeclaredUnreachableStationIds)[number]

export type SkipRationale = Readonly<{
  ownerReason: string
  governingInterface: string
}>

export const literalDeclaredUnreachableRationales = {
  "maintenance.runtime-failed": {
    ownerReason:
      "No accepted argv, stdin, or named file can cause a pre-dispatch facade fault; unit fault Adapters retain containment proof.",
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

export const literalStageCounts = { P4: 17, P5: 48, P6: 11, P7: 22, P9: 11 } as const

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
  ...literalRequiredStationIds,
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
