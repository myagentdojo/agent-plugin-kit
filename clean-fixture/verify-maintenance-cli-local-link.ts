const receipt = {
  schema_version: 1,
  proof: "agent-plugin-kit.maintenance-cli-local-link",
  run_id: "p3-help-literal",
  expected_public_cli_executions: 4,
  observed_public_cli_executions: 0,
  fixed_help_argv: [
    "maintenance",
    "--json",
    "--run-id",
    "p3-local-link-help",
    "help",
  ],
  expected_cleanup_ledger: [
    "ln:-s:package",
    "ln:-s:binary",
    "execute:maintenance --json --run-id p3-local-link-help help",
    "execute:--run-id p3-local-link-usage unknown",
    "execute:--events auto --run-id p3-local-link-event maintenance help",
    "execute:--run-id p3-local-link-second-refusal unknown",
    "unlink:binary",
    "unlink:package",
  ],
  sentinel: "implementation-absent",
  verdict: "implementation-absent",
} as const

process.stdout.write(`${JSON.stringify(receipt)}\n`)
process.exitCode = 1
