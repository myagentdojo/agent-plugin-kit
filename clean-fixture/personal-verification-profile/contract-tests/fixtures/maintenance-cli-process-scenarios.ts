import { literalProcessResult } from "./plugin-consumer"
import type { LocalLinkProcessScenario } from "../../../local-link-contract-proof"

export const cleanFixtureHelpScenarios = [
  { label: "fixed-run no-command", argv: ["--run-id", "contract-help-literal"], expected: literalProcessResult },
  { label: "fixed-run namespaced help", argv: ["maintenance", "--run-id", "contract-help-literal", "help"], expected: literalProcessResult },
  { label: "fixed-run top-level long help", argv: ["--run-id", "contract-help-literal", "--help"], expected: literalProcessResult },
  {
    label: "fixed-run namespaced events-off help",
    argv: ["maintenance", "--run-id", "contract-help-literal", "--events", "off", "help"],
    environment: { AGENT_PLUGIN_KIT_EVENT_ENDPOINT: "not-a-url" },
    expected: literalProcessResult,
  },
] as const

export const localLinkCleanupLedger = [
  "ln:-s:package",
  "ln:-s:binary",
  "execute:maintenance --json --run-id local-link-help help",
  "execute:--run-id local-link-usage unknown",
  "execute:--events auto --run-id local-link-event maintenance help",
  "execute:--run-id local-link-second-refusal unknown",
  "unlink:binary",
  "unlink:package",
] as const

export const localLinkProcessScenarios = [
  {
    ledger: localLinkCleanupLedger[2],
    argv: ["maintenance", "--json", "--run-id", "local-link-help", "help"],
    expected: { exitCode: 0, runId: "local-link-help", stdoutStatus: "ok" },
  },
  {
    ledger: localLinkCleanupLedger[3],
    argv: ["--run-id", "local-link-usage", "unknown"],
    expected: {
      exitCode: 2,
      runId: "local-link-usage",
      diagnosticEvent: "maintenance.usage-refused",
      finalStderrRecordType: "error_envelope",
    },
  },
  {
    ledger: localLinkCleanupLedger[4],
    argv: ["--events", "auto", "--run-id", "local-link-event", "maintenance", "help"],
    environment: { AGENT_PLUGIN_KIT_EVENT_ENDPOINT: "http://127.0.0.1:9/events" },
    expected: {
      exitCode: 0,
      runId: "local-link-event",
      stdoutStatus: "ok",
      diagnosticEvent: "event.delivery-failed",
    },
  },
  {
    ledger: localLinkCleanupLedger[5],
    argv: ["--run-id", "local-link-second-refusal", "unknown"],
    expected: {
      exitCode: 2,
      runId: "local-link-second-refusal",
      diagnosticEvent: "maintenance.usage-refused",
      finalStderrRecordType: "error_envelope",
    },
  },
] as const satisfies readonly LocalLinkProcessScenario[]
