import { literalProcessResult } from "./plugin-consumer"

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
