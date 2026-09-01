import { expect, test } from "bun:test"
import { literalHelpProcess, literalUsageProcess } from "../../../src/modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"
import { localLinkContractSubject } from "./adapters/local-link-contract-subject"
import { localLinkCleanupLedger } from "./fixtures/maintenance-cli-process-scenarios"

test("temporary Kit and consumer parents are private and bounded", () => {
  expect(localLinkContractSubject.parentModes).toEqual([0o700, 0o700])
  expect(localLinkContractSubject.receipt).toMatchObject({
    directory_mode: 0o700,
    file_mode: 0o600,
    maximum_retention_days: 7,
  })
})
test("link destinations must be absent before creation", () => {
  expect(localLinkContractSubject.preflightDestinations).toEqual(["absent", "absent"])
  expect(localLinkContractSubject.preexistingDestinationRefused).toBe(true)
})
test("package and binary links retain raw and canonical targets", () =>
  expect(localLinkContractSubject.linkIdentities).toEqual(
    [
      { kind: "package", rawTargetRole: "kit-root", canonicalTargetRole: "kit-root" },
      { kind: "binary", rawTargetRole: "maintenance-shell", canonicalTargetRole: "maintenance-shell" },
    ],
  ))
test("linked binary retains Bun shebang and executable mode", () => {
  expect(localLinkContractSubject.executable).toEqual({ shebang: "#!/usr/bin/env bun", mode: 0o755 })
})
test("foreign cwd fixed help uses an explicit fixed run ID", () => {
  expect(localLinkContractSubject.fixedHelpArgv).toEqual(["maintenance", "--json", "--run-id", "local-link-help", "help"])
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
  expect(localLinkContractSubject.cleanupLedger).toEqual(localLinkCleanupLedger)
})
test("cleanup unlinks binary then package without deleting parents", () => {
  expect(localLinkCleanupLedger.slice(-2)).toEqual(["unlink:binary", "unlink:package"])
  expect(localLinkContractSubject.cleanupLedger.slice(-2)).toEqual(["unlink:binary", "unlink:package"])
  expect(localLinkContractSubject.receipt.links_cleaned).toBe(true)
})
test("before and after digests prove no tracked manifest or lock drift", () => {
  expect(localLinkContractSubject.digestsEqual).toBe(true)
  expect(localLinkContractSubject.receipt.observed_public_cli_executions).toBe(4)
})
