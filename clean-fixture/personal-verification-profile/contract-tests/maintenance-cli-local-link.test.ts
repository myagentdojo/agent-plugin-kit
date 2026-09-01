import { expect, test } from "bun:test"
import { literalHelpProcess, literalUsageProcess } from "../../../src/modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"
import { localLinkContractSubject } from "./adapters/local-link-contract-subject"
import { localLinkCleanupLedger } from "./fixtures/maintenance-cli-process-scenarios"
import { localLinkPublicFailureFor } from "../../verify-maintenance-cli-local-link"

test("temporary Kit and consumer parents are private and bounded", () => {
  expect(localLinkContractSubject.parentModes).toEqual([0o700, 0o700])
  expect(localLinkContractSubject.parentsPreserved).toBe(true)
  expect(localLinkContractSubject.receiptDeleted).toBe(true)
  expect(localLinkContractSubject.receipt).toMatchObject({
    directory_mode: 0o700,
    file_mode: 0o600,
    maximum_retention_days: 7,
  })
  expect(localLinkContractSubject.temporaryProofControls).toEqual({
    wrongParentRefused: true,
    preexistingMarkerRefused: true,
    substitutedRootRefused: true,
  })
  expect(localLinkPublicFailureFor(new Error("link-destination-preexists"))).toEqual({
    failure: "local-link-preflight-refused",
    next_action: "Restore the Kit, consumer, dependency, or destination preflight invariant, then retry.",
  })
  expect(localLinkPublicFailureFor(new Error("ownership-receipt-link-drifted:package"))).toEqual({
    failure: "local-link-ownership-refused",
    next_action: "Inspect the retained private ownership receipt and restore only proof-owned links before retrying.",
  })
  const preflight = {
    failure: "local-link-preflight-refused",
    next_action: "Restore the Kit, consumer, dependency, or destination preflight invariant, then retry.",
  } as const
  const stateRoot = {
    failure: "local-link-preflight-refused",
    next_action: "Repair the private state root to an existing 0700 directory, then retry.",
  } as const
  const ownership = {
    failure: "local-link-ownership-refused",
    next_action: "Inspect the retained private ownership receipt and restore only proof-owned links before retrying.",
  } as const
  const restoration = {
    failure: "local-link-restoration-refused",
    next_action: "Restore the Kit and consumer repositories to their recorded preflight state, then retry.",
  } as const
  const process = {
    failure: "local-link-process-refused",
    next_action: "Run the focused local-link Contract Test and repair the public-process refusal before retrying.",
  } as const
  const proofFallback = {
    failure: "local-link-proof-refused",
    next_action: "Run the focused local-link Contract Test and repair its first failing invariant before retrying.",
  } as const
  const failureCases = [
    ["run-id-invalid", preflight],
    ["state-root-must-be-absolute", stateRoot],
    ["state-root-unsafe", stateRoot],
    ["public-process-scenario-count-invalid", preflight],
    ["public-process-scenario-catalog-invalid", preflight],
    ["package-identity-invalid", preflight],
    ["public-binary-not-regular", preflight],
    ["destination-parent-unsafe", preflight],
    ["destination-parent-escaped", preflight],
    ["link-destination-preexists", preflight],
    ["proof-root-escaped", preflight],
    ["proof-root-unsafe", preflight],
    ["proof-directory-unsafe", preflight],
    ["logtape-owner-pin-invalid", preflight],
    ["owner-local-dependency-missing", preflight],
    ["json-object-required", preflight],
    ["tracked-index-row-invalid", preflight],
    ["command-refused:git:1", preflight],
    ["temporary-proof-marker-invalid", preflight],
    ["ownership-receipt-invalid", ownership],
    ["ownership-receipt-link-invalid", ownership],
    ["ownership-receipt-state-drifted:package", ownership],
    ["ownership-receipt-link-drifted:package", ownership],
    ["owned-link-drifted:binary", ownership],
    ["owned-node-not-symlink", ownership],
    ["created-link-identity-invalid", ownership],
    ["partial-link-failure", ownership],
    ["link-command-audit-missing", ownership],
    ["repository-state-drifted", restoration],
    ["destination-parent-removed", restoration],
    ["owned-link-remained", restoration],
    ["network-attempt-detected", process],
    ["public-process-diagnostic-value-drift", process],
    ["diagnostic-next-action-invalid", process],
    ["process-settlement-deadline-exceeded", process],
    ["descriptor-retaining-descendant-not-observed", process],
    ["unexpected-descriptor-retaining-descendant", process],
    ["public-command-audit-missing", process],
    ["forbidden-command-was-allowlisted", process],
    ["scenario-ledger-drift", process],
    ["timeout-control-missing", process],
    ["command-not-allowlisted", process],
    ["diagnostic-order-control-unavailable", process],
    ["redaction-bypass-control-unavailable", process],
    ["opaque-helper-failure:private-value", proofFallback],
  ] as const
  for (const [message, expected] of failureCases) {
    expect(localLinkPublicFailureFor(new Error(message))).toEqual(expected)
  }
})
test("link destinations must be absent before creation", () => {
  expect(localLinkContractSubject.preflightDestinations).toEqual(["absent", "absent"])
  expect(localLinkContractSubject.preexistingDestinationRefused).toBe(true)
  expect(localLinkContractSubject.failureControls["escaped-parent"]).toEqual({
    refused: true,
    reason: "destination-parent-unsafe",
    parentsPreserved: true,
    linksRemain: false,
    receiptRemaining: false,
  })
  expect(localLinkContractSubject.failureControls["partial-link"]).toEqual({
    refused: true,
    reason: "partial-link-failure",
    parentsPreserved: true,
    linksRemain: false,
    receiptRemaining: false,
  })
})
test("package and binary links retain raw and canonical targets", () =>
  expect({
    identities: localLinkContractSubject.linkIdentities,
    retargeted: localLinkContractSubject.failureControls["retargeted-link"],
    secondIdentity: localLinkContractSubject.failureControls["second-identity"],
  }).toEqual({
    identities: [
      { kind: "package", rawTargetRole: "kit-root", canonicalTargetRole: "kit-root" },
      { kind: "binary", rawTargetRole: "maintenance-shell", canonicalTargetRole: "maintenance-shell" },
    ],
    retargeted: {
      refused: true,
      reason: "owned-link-drifted:binary",
      parentsPreserved: true,
      linksRemain: true,
      receiptRemaining: true,
    },
    secondIdentity: {
      refused: true,
      reason: "owned-link-drifted:package",
      parentsPreserved: true,
      linksRemain: true,
      receiptRemaining: true,
    },
  }))
test("linked binary retains Bun shebang and executable mode", () => {
  expect(localLinkContractSubject.executable).toEqual({ shebang: "#!/usr/bin/env bun", mode: 0o755 })
  expect(localLinkContractSubject.failureControls["mode-shebang-loss"]).toEqual({
    refused: true,
    reason: "public-binary-identity-invalid",
    parentsPreserved: true,
    linksRemain: false,
    receiptRemaining: false,
  })
  expect(localLinkContractSubject.timeoutDescriptorControl).toMatchObject({
    deadlineMs: 100,
    hardSettlementDeadlineMs: 1000,
    timedOut: true,
    hardSettlementTimedOut: false,
    exitObserved: true,
    descriptorClosure: "closed",
    descriptorRetainingDescendant: true,
    cleanup: "process-group-killed",
    retainedResources: 0,
  })
})
test("foreign cwd fixed help uses an explicit fixed run ID", () => {
  expect(localLinkContractSubject.fixedHelpArgv).toEqual(["maintenance", "--json", "--run-id", "local-link-help", "help"])
  expect(localLinkContractSubject.publicObservability[0]).toEqual({
    runId: "local-link-help",
    exitCode: literalHelpProcess.exitCode,
    stdoutRecordCount: 1,
    stderrRecordCount: 0,
    stdoutRecordTypes: ["envelope"],
    stderrRecordTypes: [],
    stdoutStatus: "ok",
    stderrSequences: [],
    stderrEvents: [],
    stationIds: ["help.previewed"],
    resultCodes: ["previewed"],
    nextActionIds: ["help.choose-command"],
    primaryEnvelopeChannel: "stdout",
    eventSequenceGap: false,
    noExtraRecords: true,
    safeContext: true,
    redacted: true,
  })
})
test("cleanup ledger pins exactly four public CLI executions", async () => {
  expect(localLinkCleanupLedger.filter((entry) => entry.startsWith("execute:"))).toHaveLength(4)
  expect(localLinkCleanupLedger.filter((entry) => entry.startsWith("ln:"))).toHaveLength(2)
  const observations = localLinkContractSubject.observations
  expect(observations).toHaveLength(4)
  expect(observations[0]?.exitCode).toBe(literalHelpProcess.exitCode)
  expect(observations[0]?.stdout).toContain('"run_id":"local-link-help"')
  expect(observations[0]?.stderr).toBe(literalHelpProcess.stderr)
  expect(observations[1]?.exitCode).toBe(literalUsageProcess.exitCode)
  expect(observations[1]?.stdout).toBe(literalUsageProcess.stdout)
  expect(observations[1]?.stderr).toContain('"run_id":"local-link-usage"')
  expect(observations[2]?.exitCode).toBe(literalHelpProcess.exitCode)
  expect(observations[2]?.stdout).toContain('"run_id":"local-link-event"')
  expect(observations[2]?.stderr).toContain('"event":"event.delivery-failed"')
  expect(observations[3]?.exitCode).toBe(literalUsageProcess.exitCode)
  expect(observations[3]?.stdout).toBe(literalUsageProcess.stdout)
  expect(observations[3]?.stderr.split("\n").filter(Boolean).at(-1)).toContain('"record_type":"error_envelope"')
  expect(localLinkContractSubject.processCleanupReceipts).toHaveLength(4)
  expect(localLinkContractSubject.processCleanupReceipts.every((receipt) =>
    !receipt.timedOut && !receipt.hardSettlementTimedOut && receipt.descriptorClosure === "closed" &&
    !receipt.descriptorRetainingDescendant && receipt.retainedResources === 0)).toBe(true)
  expect(localLinkContractSubject.publicObservability).toEqual([
    expect.objectContaining({ runId: "local-link-help", exitCode: literalHelpProcess.exitCode, stdoutStatus: "ok" }),
    expect.objectContaining({ runId: "local-link-usage", exitCode: literalUsageProcess.exitCode, stderrSequences: [1, 2] }),
    expect.objectContaining({ runId: "local-link-event", exitCode: literalHelpProcess.exitCode, eventSequenceGap: true }),
    expect.objectContaining({ runId: "local-link-second-refusal", exitCode: literalUsageProcess.exitCode, stderrSequences: [1, 2] }),
  ])
  expect(localLinkContractSubject.auditLedger.filter((entry) => entry.kind === "timeout-probe")).toHaveLength(1)
  expect(localLinkContractSubject.auditLedger.filter((entry) => entry.kind === "public-process")).toHaveLength(4)
  expect(localLinkContractSubject.auditLedger.some((entry) => entry.executable === "npm")).toBe(false)
  expect(localLinkContractSubject.cleanupLedger).toEqual(localLinkCleanupLedger)
})
test("cleanup unlinks binary then package without deleting parents", () => {
  expect(localLinkCleanupLedger.slice(-2)).toEqual(["unlink:binary", "unlink:package"])
  expect(localLinkContractSubject.cleanupLedger.slice(-2)).toEqual(["unlink:binary", "unlink:package"])
  expect(localLinkContractSubject.receipt.links_cleaned).toBe(true)
  expect(localLinkContractSubject.receiptDeleted).toBe(true)
  expect(localLinkContractSubject.auditLedger.filter((entry) => entry.operation === "unlink")).toEqual([
    { operation: "unlink", kind: "binary" },
    { operation: "unlink", kind: "package" },
  ])
  expect(localLinkContractSubject.failureControls["receipt-tamper"]).toEqual({
    refused: true,
    reason: "ownership-receipt-tampered",
    parentsPreserved: true,
    linksRemain: true,
    receiptRemaining: true,
  })
  expect(localLinkContractSubject.failureControls["receipt-write-failure"]).toEqual({
    refused: true,
    reason: "ownership-receipt-write-failure",
    parentsPreserved: true,
    linksRemain: false,
    receiptRemaining: false,
  })
  expect(localLinkContractSubject.failureControls["receipt-link-substitution"]).toEqual({
    refused: true,
    reason: "ownership-receipt-link-drifted:package",
    parentsPreserved: true,
    linksRemain: true,
    receiptRemaining: true,
  })
})
test("before and after digests prove no tracked manifest or lock drift", () => {
  expect(localLinkContractSubject.digestsEqual).toBe(true)
  expect(localLinkContractSubject.gitStateEqual).toBe(true)
  expect(localLinkContractSubject.zeroNetworkAttempts).toBe(true)
  expect(localLinkContractSubject.receipt.observed_public_cli_executions).toBe(4)
  expect(localLinkContractSubject.forbiddenCommandRefused).toBe(true)
  expect(localLinkContractSubject.failureControls["repository-drift"]).toEqual({
    refused: true,
    reason: "repository-state-drifted",
    parentsPreserved: true,
    linksRemain: false,
    receiptRemaining: false,
  })
  for (const fault of ["manifest-lock-drift", "staged-index-drift", "commit-ref-drift"] as const) {
    expect(localLinkContractSubject.failureControls[fault]).toEqual({
      refused: true,
      reason: "repository-state-drifted",
      parentsPreserved: true,
      linksRemain: false,
      receiptRemaining: false,
    })
  }
  expect(localLinkContractSubject.failureControls["parent-deletion"]).toEqual({
    refused: true,
    reason: "destination-parent-removed",
    parentsPreserved: false,
    linksRemain: false,
    receiptRemaining: true,
  })
  expect(localLinkContractSubject.failureControls["network-primitive"]).toEqual({
    refused: true,
    reason: "network-attempt-detected",
    parentsPreserved: true,
    linksRemain: false,
    receiptRemaining: false,
  })
  expect(localLinkContractSubject.failureControls["diagnostic-order"]).toEqual({
    refused: true,
    reason: "public-process-diagnostic-value-drift",
    parentsPreserved: true,
    linksRemain: false,
    receiptRemaining: false,
  })
  expect(localLinkContractSubject.failureControls["redaction-bypass"]).toEqual({
    refused: true,
    reason: "public-process-redaction-drift",
    parentsPreserved: true,
    linksRemain: false,
    receiptRemaining: false,
  })
  expect(localLinkContractSubject.failureControls["missing-owner-local-dependency"]).toEqual({
    refused: true,
    reason: "owner-local-dependency-missing",
    parentsPreserved: true,
    linksRemain: false,
    receiptRemaining: false,
  })
  expect(localLinkContractSubject.failureControls["receipt-schema"]).toEqual({
    refused: true,
    reason: "ownership-receipt-invalid",
    parentsPreserved: true,
    linksRemain: true,
    receiptRemaining: true,
  })
  expect(localLinkContractSubject.failureControls["receipt-mistyped"]).toEqual({
    refused: true,
    reason: "ownership-receipt-invalid",
    parentsPreserved: true,
    linksRemain: true,
    receiptRemaining: true,
  })
})
