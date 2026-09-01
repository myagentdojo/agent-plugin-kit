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

const failurePrefix = (error: unknown): string =>
  error instanceof Error ? error.message.split(":", 1)[0] ?? "" : ""

export const localLinkPublicFailureFor = (error: unknown): Readonly<{
  failure: string
  next_action: string
}> => {
  const failure = failurePrefix(error)
  if ([
    "run-id-invalid",
    "state-root-must-be-absolute",
    "public-process-scenario-count-invalid",
    "public-process-scenario-catalog-invalid",
    "package-identity-invalid",
    "public-binary-invalid",
    "public-binary-identity-invalid",
    "destination-parent-unsafe",
    "destination-parent-escaped",
    "link-destination-preexists",
    "logtape-owner-pin-invalid",
    "logtape-owner-scope-invalid",
    "logtape-locality-invalid",
    "logtape-lock-resolution-invalid",
    "owner-local-dependency-missing",
    "logtape-installed-resolution-not-owner-local",
    "logtape-installed-version-invalid",
  ].includes(failure)) {
    return {
      failure: "local-link-preflight-refused",
      next_action: "Restore the Kit, consumer, dependency, or destination preflight invariant, then retry.",
    }
  }
  if (failure.startsWith("ownership-") || failure.startsWith("owned-link-") ||
    failure === "created-link-identity-invalid") {
    return {
      failure: "local-link-ownership-refused",
      next_action: "Inspect the retained private ownership receipt and restore only proof-owned links before retrying.",
    }
  }
  if (failure.startsWith("repository-") || failure === "destination-parent-removed" ||
    failure === "owned-link-remained") {
    return {
      failure: "local-link-restoration-refused",
      next_action: "Restore the Kit and consumer repositories to their recorded preflight state, then retry.",
    }
  }
  if (failure.startsWith("network-") || failure.startsWith("public-process-") ||
    failure.startsWith("process-") || failure.startsWith("command-")) {
    return {
      failure: "local-link-process-refused",
      next_action: "Run the focused local-link Contract Test and repair the public-process refusal before retrying.",
    }
  }
  return {
    failure: "local-link-proof-refused",
    next_action: "Run the focused local-link Contract Test and repair its first failing invariant before retrying.",
  }
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
      git_state_equal: result.gitStateEqual,
      forbidden_executable_refused: result.forbiddenCommandRefused,
      zero_network_attempts: result.zeroNetworkAttempts,
      timeout_hard_settled: !result.timeoutDescriptorControl.hardSettlementTimedOut,
      descriptor_retaining_descendant: result.timeoutDescriptorControl.descriptorRetainingDescendant,
      retained_receipt_maximum_days: result.receipt.maximum_retention_days,
    })}\n`)
    return 0
  } catch (error) {
    const refusal = localLinkPublicFailureFor(error)
    process.stderr.write(`${JSON.stringify({
      schema_version: 1,
      proof: proofIdentity,
      verdict: "refused",
      ...refusal,
    })}\n`)
    return 1
  }
}

if (import.meta.main) process.exitCode = await verifyMaintenanceCliLocalLink()
