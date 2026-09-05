import { literalHelpProcess, literalUsageProcess } from "../../../../modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"

export const fixedRunId = "contract-help-literal"
export const fixedHelpScenarios = [
  { label: "fixed-run no-command", argv: ["--run-id", fixedRunId], expected: literalHelpProcess },
  { label: "fixed-run namespaced help", argv: ["maintenance", "--run-id", fixedRunId, "help"], expected: literalHelpProcess },
  { label: "fixed-run short help", argv: ["--run-id", fixedRunId, "-h"], expected: literalHelpProcess },
  { label: "fixed-run long help", argv: ["--run-id", fixedRunId, "--help"], expected: literalHelpProcess },
] as const

export const literalCommandRows = [
  ["help", "help", "inspect", "inspect", null, "help.choose-command"],
  ["payload check", "payload:check", "inspect", "inspect", null, "payload-check.inspect-result"],
  ["payload materialize", "payload:materialize", "apply", "repository-local", "payload check", "payload-materialize.inspect-result"],
  ["payload package", "payload:package", "apply", "repository-local", null, "payload-package.inspect-result"],
  ["runtime repair", "runtime:repair", "inspect", "inspect", null, "runtime-repair.inspect-result"],
  ["runtime repair --apply", "runtime:repair-apply", "apply", "external", "runtime repair", "runtime-repair-apply.inspect-result"],
  ["release inspect", "release:inspect", "inspect", "inspect", null, "release-inspect.review-preview"],
  ["release apply", "release:apply", "apply", "external", "release inspect", "release-apply.inspect-result"],
  ["harness claude inspect", "harness:claude:inspect", "inspect", "inspect", null, "harness-claude-inspect.inspect-result"],
  ["harness claude apply", "harness:claude:apply", "apply", "external", "harness claude inspect", "harness-claude-apply.inspect-result"],
  ["harness codex inspect", "harness:codex:inspect", "inspect", "inspect", null, "harness-codex-inspect.inspect-result"],
  ["harness codex apply", "harness:codex:apply", "apply", "external", "harness codex inspect", "harness-codex-apply.inspect-result"],
  ["canary inspect", "canary:inspect", "inspect", "inspect", null, "canary-inspect.inspect-result"],
  ["canary qualify", "canary:qualify", "apply", "external", "canary inspect", "canary-qualify.inspect-result"],
] as const

export const literalEnvironmentDependencies = [
  "AGENT_PLUGIN_KIT_EVENT_ENDPOINT",
  "AGENT_PLUGIN_KIT_EVENT_AUTH",
] as const

export const fixedUsageScenario = {
  argv: ["--run-id", fixedRunId, "unknown"],
  expected: literalUsageProcess,
} as const
