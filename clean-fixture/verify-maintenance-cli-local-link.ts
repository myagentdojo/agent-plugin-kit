#!/usr/bin/env bun
import { homedir } from "node:os"
import { resolve } from "node:path"
import { runLocalLinkContractProof } from "./local-link-contract-proof"
import { localLinkProcessScenarios } from "./personal-verification-profile/contract-tests/fixtures/maintenance-cli-process-scenarios"

const proofIdentity = "agent-plugin-kit.maintenance-cli-local-link"
const dotfilesRoot = "/Users/nathanvale/code/dotfiles"

const stateRoot = (): string => {
  const configured = process.env.XDG_STATE_HOME
  return configured === undefined || configured === ""
    ? resolve(homedir(), ".local/state")
    : resolve(configured)
}

const newRunId = (): string => {
  const timestamp = new Date().toISOString().replaceAll(/[^0-9]/gu, "").slice(0, 14)
  return `local-link-${timestamp}-${crypto.randomUUID().slice(0, 8)}`
}

export async function verifyMaintenanceCliLocalLink(): Promise<number> {
  try {
    const result = await runLocalLinkContractProof({
      kitRoot: resolve(import.meta.dir, ".."),
      consumerRoot: dotfilesRoot,
      stateRoot: stateRoot(),
      runId: newRunId(),
      scenarios: localLinkProcessScenarios,
    })
    process.stdout.write(`${JSON.stringify({
      schema_version: 1,
      proof: proofIdentity,
      verdict: "proved",
      run_id: result.receipt.run_id,
      observed_public_cli_executions: result.receipt.observed_public_cli_executions,
      links_cleaned: result.receipt.links_cleaned,
      repository_digests_equal: result.digestsEqual,
      retained_receipt_maximum_days: result.receipt.maximum_retention_days,
    })}\n`)
    return 0
  } catch {
    process.stderr.write(`${JSON.stringify({
      schema_version: 1,
      proof: proofIdentity,
      verdict: "refused",
      failure: "local-link-proof-failed",
      next_action: "Inspect the private ownership receipt and restore the preflight invariant before retrying.",
    })}\n`)
    return 1
  }
}

if (import.meta.main) process.exitCode = await verifyMaintenanceCliLocalLink()
