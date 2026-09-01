import { expect, test } from "bun:test"
import { literalHelpProcess, literalUsageProcess } from "../../../src/modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"
import { localLinkContractSubject } from "./adapters/local-link-contract-subject"
import { localLinkCleanupLedger } from "./fixtures/maintenance-cli-process-scenarios"

test("temporary Kit and consumer parents are private and bounded", () => {
  expect(localLinkContractSubject.parentModes).toEqual([0o700, 0o700])
  expect(localLinkContractSubject.parentsPreserved).toBe(true)
  expect(localLinkContractSubject.receiptDeleted).toBe(true)
  expect(localLinkContractSubject.receipt).toMatchObject({
    directory_mode: 0o700,
    file_mode: 0o600,
    maximum_retention_days: 7,
  })
})
test("link destinations must be absent before creation", () => {
  expect(localLinkContractSubject.preflightDestinations).toEqual(["absent", "absent"])
  expect(localLinkContractSubject.preexistingDestinationRefused).toBe(true)
  expect(localLinkContractSubject.failureControls["escaped-parent"]).toEqual({
    refused: true,
    reason: "destination-parent-unsafe",
    parentsPreserved: true,
    linksRemain: false,
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
    },
    secondIdentity: {
      refused: true,
      reason: "owned-link-drifted:package",
      parentsPreserved: true,
      linksRemain: true,
    },
  }))
test("linked binary retains Bun shebang and executable mode", () => {
  expect(localLinkContractSubject.executable).toEqual({ shebang: "#!/usr/bin/env bun", mode: 0o755 })
  expect(localLinkContractSubject.failureControls["mode-shebang-loss"]).toEqual({
    refused: true,
    reason: "public-binary-identity-invalid",
    parentsPreserved: true,
    linksRemain: false,
  })
  expect(localLinkContractSubject.timeoutDescriptorControl).toMatchObject({
    deadlineMs: 100,
    timedOut: true,
    exitObserved: true,
    descriptorClosure: "closed",
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
    stdoutStatus: "ok",
    stderrSequences: [],
    stderrEvents: [],
    primaryEnvelopeChannel: "stdout",
    eventSequenceGap: false,
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
    !receipt.timedOut && receipt.descriptorClosure === "closed" && receipt.retainedResources === 0)).toBe(true)
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
  })
  expect(localLinkContractSubject.failureControls["receipt-write-failure"]).toEqual({
    refused: true,
    reason: "ownership-receipt-write-failure",
    parentsPreserved: true,
    linksRemain: true,
  })
})
test("before and after digests prove no tracked manifest or lock drift", () => {
  expect(localLinkContractSubject.digestsEqual).toBe(true)
  expect(localLinkContractSubject.receipt.observed_public_cli_executions).toBe(4)
  expect(localLinkContractSubject.forbiddenCommandRefused).toBe(true)
  expect(localLinkContractSubject.failureControls["repository-drift"]).toEqual({
    refused: true,
    reason: "repository-state-drifted",
    parentsPreserved: true,
    linksRemain: false,
  })
})
