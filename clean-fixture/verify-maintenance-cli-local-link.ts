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

type LocalLinkPublicFailure = Readonly<{
  failure: string
  next_action: string
}>

const preflightFailure: LocalLinkPublicFailure = {
  failure: "local-link-preflight-refused",
  next_action: "Restore the Kit, consumer, dependency, or destination preflight invariant, then retry.",
}

const stateRootFailure: LocalLinkPublicFailure = {
  failure: "local-link-preflight-refused",
  next_action: "Repair the private state root to an existing 0700 directory, then retry.",
}

const ownershipFailure: LocalLinkPublicFailure = {
  failure: "local-link-ownership-refused",
  next_action: "Inspect the retained private ownership receipt and restore only proof-owned links before retrying.",
}

const restorationFailure: LocalLinkPublicFailure = {
  failure: "local-link-restoration-refused",
  next_action: "Restore the Kit and consumer repositories to their recorded preflight state, then retry.",
}

const processFailure: LocalLinkPublicFailure = {
  failure: "local-link-process-refused",
  next_action: "Run the focused local-link Contract Test and repair the public-process refusal before retrying.",
}

const unknownFailure: LocalLinkPublicFailure = {
  failure: "local-link-proof-refused",
  next_action: "Run the focused local-link Contract Test and repair its first failing invariant before retrying.",
}

type LocalLinkFailureRule = Readonly<{
  prefixes: readonly string[]
  response: LocalLinkPublicFailure
}>

const localLinkFailureRules: readonly LocalLinkFailureRule[] = [
  {
    prefixes: [
      "run-id-invalid",
      "public-process-scenario-count-invalid",
      "public-process-scenario-catalog-invalid",
      "package-identity-invalid",
      "public-binary",
      "destination-parent-unsafe",
      "destination-parent-escaped",
      "link-destination-preexists",
      "proof-root-escaped",
      "proof-root-unsafe",
      "proof-directory-unsafe",
      "logtape",
      "owner-local-dependency-missing",
      "json-object-required",
      "tracked-index-row-invalid",
      "command-refused",
      "temporary-proof",
    ],
    response: preflightFailure,
  },
  {
    prefixes: ["state-root-must-be-absolute", "state-root-unsafe"],
    response: stateRootFailure,
  },
  {
    prefixes: ["repository", "destination-parent-removed", "owned-link-remained"],
    response: restorationFailure,
  },
  {
    prefixes: [
      "ownership",
      "owned-link-drifted",
      "owned-node-not-symlink",
      "created-link-identity-invalid",
      "partial-link-failure",
      "link-command-audit-missing",
    ],
    response: ownershipFailure,
  },
  {
    prefixes: [
      "network",
      "public-process",
      "process",
      "descriptor",
      "forbidden-command",
      "public-command",
      "scenario-ledger",
      "timeout-control",
      "command-not-allowlisted",
      "diagnostic-order-control",
      "redaction-bypass-control",
    ],
    response: processFailure,
  },
] as const

const matchesFailurePrefix = (failure: string, prefix: string): boolean =>
  failure === prefix || failure.startsWith(`${prefix}-`)

export const localLinkPublicFailureFor = (error: unknown): Readonly<{
  failure: string
  next_action: string
}> => {
  const failure = failurePrefix(error)
  const rule = localLinkFailureRules.find(({ prefixes }) =>
    prefixes.some((prefix) => matchesFailurePrefix(failure, prefix)))
  return rule?.response ?? unknownFailure
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
