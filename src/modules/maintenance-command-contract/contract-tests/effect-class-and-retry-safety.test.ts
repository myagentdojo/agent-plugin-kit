import { createHash } from "node:crypto"
import { expect, test } from "bun:test"
import { createMaintenanceContractHarness } from "./adapters/mutation-recording-module-adapter"
import { approvalDigestVectors } from "./fixtures/approval-digest-vectors"
import { mutatingRequests } from "./fixtures/literal-command-results"

const digest = (bytes: string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`

async function assertApply(key: keyof typeof mutatingRequests, effectClass: string) {
  const harness = createMaintenanceContractHarness()
  const request = mutatingRequests[key]
  const vector =
    key === "release" ? approvalDigestVectors[0]
    : key === "claude" ? approvalDigestVectors[1]
    : key === "codex" ? approvalDigestVectors[2]
    : undefined

  if (vector) {
    expect(digest(vector.candidateBytes)).toBe(vector.candidateDigest)
    expect(digest(vector.inspectedStateBytes)).toBe(vector.inspectedStateDigest)
    expect(digest(vector.expectedEffectsBytes)).toBe(vector.expectedEffectsDigest)
    expect(digest(vector.approvalBytes)).toBe(vector.approvalDigest)
  }

  const retrySafety =
    key === "materialize" || key === "package" ? "safe" : "requires-fresh-inspection"
  const preview = await harness.inspect(request)
  expect(preview, `contract-absent: ${request.command} must classify before apply`).toMatchObject({
    command: request.command,
    effectClass,
    retrySafety,
  })
  const actual = await harness.apply(request)
  expect(actual, `contract-absent: ${request.command} must preserve exact Retry Safety`).toMatchObject({
    command: request.command,
    retrySafety,
  })
  if (key === "runtime") {
    expect(harness.runtimeSpawnLedger).toEqual([["repair", "--apply"]])
  } else {
    const owner =
      key === "materialize" || key === "package" ? "payload"
      : key === "release" ? "release"
      : key
    expect(harness.applyLedgers[owner]).toEqual([request])
  }
}

test("payload materialize is repository-local", () => assertApply("materialize", "repository-local"))
test("payload package is repository-local", () => assertApply("package", "repository-local"))
test("runtime repair apply transports outside approval", () => assertApply("runtime", "repository-local"))
test("release apply transports only its fixed approval vector", () => assertApply("release", "external"))
test("Claude apply transports only its fixed approval vector", () => assertApply("claude", "repository-local"))
test("Codex apply transports only its fixed approval vector", () => assertApply("codex", "repository-local"))
test("canary qualify transports protected authority", () => assertApply("canary", "external"))

test("inspection requests no capability and writes no durable target", async () => {
  const harness = createMaintenanceContractHarness()
  const durableBefore = harness.durableDigest()
  const actual = await harness.inspect({ command: "release:inspect", request: { candidate: mutatingRequests.release.request.candidate, intent: "readiness" } })

  expect(harness.applyLedgers).toEqual({
    payload: [],
    release: [],
    claude: [],
    codex: [],
    canary: [],
  })
  expect(harness.runtimeSpawnLedger).toEqual([])
  expect(harness.durableDigest()).toBe(durableBefore)
  expect(actual, "contract-absent: inspection must return an immutable preview").toMatchObject({
    effectClass: "inspect",
    transactionState: "unchanged",
  })
})

test("runtime repair apply uses exact argv without a generic approval", async () => {
  const harness = createMaintenanceContractHarness()
  const actual = await harness.apply(mutatingRequests.runtime)

  expect(Object.keys(mutatingRequests.runtime).sort()).toEqual(["argv", "command"])
  expect(mutatingRequests.runtime.argv).toEqual(["repair", "--apply"])
  expect(actual, "contract-absent: exact Runtime Custody argv must be delegated").toMatchObject({
    command: "runtime:repair-apply",
  })
  expect(harness.runtimeSpawnLedger).toEqual([["repair", "--apply"]])
})
