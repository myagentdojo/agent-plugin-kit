import { expect, test } from "bun:test"
import { literalHelpProcess, literalUsageProcess } from "../../../src/modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"
import { localLinkContractSubject } from "./adapters/maintenance-cli-contract-subjects"
import { localLinkCleanupLedger } from "./fixtures/maintenance-cli-process-scenarios"

const absent = (actual: unknown, expected: unknown, claim: string) => expect(actual, `contract-absent: ${claim}`).toEqual(expected)

test("temporary Kit and consumer parents are private and bounded", () => absent(localLinkContractSubject?.parentModes, [0o700, 0o700], "the receipt-owned proof must allocate bounded temporary parents"))
test("link destinations must be absent before creation", () => absent(localLinkContractSubject?.preflightDestinations, ["absent", "absent"], "the receipt-owned proof must fail closed on preexisting destinations"))
test("package and binary links retain raw and canonical targets", () =>
  absent(
    localLinkContractSubject?.linkIdentities,
    [
      { kind: "package", rawTargetRole: "kit-root", canonicalTargetRole: "kit-root" },
      { kind: "binary", rawTargetRole: "maintenance-shell", canonicalTargetRole: "maintenance-shell" },
    ],
    "the receipt-owned proof must verify raw and canonical link identity",
  ))
test("linked binary retains Bun shebang and executable mode", () => absent(localLinkContractSubject?.executable, { shebang: "#!/usr/bin/env bun", mode: 0o755 }, "the receipt-owned proof must verify executable identity"))
test("foreign cwd fixed help uses an explicit fixed run ID", () => absent(localLinkContractSubject?.fixedHelpArgv, ["maintenance", "--json", "--run-id", "local-link-help", "help"], "the linked public binary must emit fixed-run help outside both repositories"))
test("cleanup ledger pins exactly four public CLI executions", async () => {
  expect(localLinkCleanupLedger.filter((entry) => entry.startsWith("execute:"))).toHaveLength(4)
  expect(localLinkCleanupLedger.filter((entry) => entry.startsWith("ln:"))).toHaveLength(2)
  const observations = await localLinkContractSubject?.invokeFourPublicExecutions()
  absent(observations?.length, 4, "the local-link seam must execute the public binary exactly four times")
  expect(observations?.[0]?.exitCode).toBe(literalHelpProcess.exitCode)
  expect(observations?.[0]?.stdout).toContain('"run_id":"local-link-help"')
  expect(observations?.[0]?.stderr).toBe(literalHelpProcess.stderr)
  expect(observations?.[1]?.exitCode).toBe(literalUsageProcess.exitCode)
  expect(observations?.[1]?.stdout).toBe(literalUsageProcess.stdout)
  expect(observations?.[1]?.stderr).toContain('"run_id":"local-link-usage"')
  expect(observations?.[2]?.exitCode).toBe(literalHelpProcess.exitCode)
  expect(observations?.[2]?.stdout).toContain('"run_id":"local-link-event"')
  expect(observations?.[2]?.stderr).toContain('"event":"event.delivery-failed"')
  expect(observations?.[3]?.exitCode).toBe(literalUsageProcess.exitCode)
  expect(observations?.[3]?.stdout).toBe(literalUsageProcess.stdout)
  expect(observations?.[3]?.stderr.split("\n").filter(Boolean).at(-1)).toContain('"record_type":"error_envelope"')
  absent(localLinkContractSubject?.cleanupLedger, localLinkCleanupLedger, "the local-link receipt must pin two links and four executions")
})
test("cleanup unlinks binary then package without deleting parents", () => {
  expect(localLinkCleanupLedger.slice(-2)).toEqual(["unlink:binary", "unlink:package"])
  absent(localLinkContractSubject?.cleanupLedger.slice(-2), ["unlink:binary", "unlink:package"], "the local-link proof must own reversible cleanup")
})
test("before and after digests prove no tracked manifest or lock drift", () => absent(localLinkContractSubject?.digestsEqual, true, "the local-link receipt must prove both repositories unchanged"))
