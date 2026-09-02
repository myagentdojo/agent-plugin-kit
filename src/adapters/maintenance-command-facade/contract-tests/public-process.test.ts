import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stat } from "node:fs/promises"
import { resolve } from "node:path"
import { literalUsageProcess } from "../../../modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"
import { invokeClosedStreamNegativeControl, invokePublicProcess, invokeRetainedDescriptorNegativeControl } from "./adapters/public-process-adapter"
import { fixedHelpScenarios, fixedRunId, fixedUsageScenario } from "./fixtures/literal-cli-scenarios"
import { outcomeContextContract } from "./fixtures/literal-observability-cases"
import type { ProcessObservation } from "../interface"
import { mutatingRequests } from "../../../modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"

const withJsonFile = async <T>(value: unknown, run: (path: string) => Promise<T>): Promise<T> => {
  const root = mkdtempSync(join(tmpdir(), "agent-plugin-kit-public-process-"))
  const path = join(root, "input.json")
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  try {
    return await run(path)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const invokeAndExpect = async (argv: readonly string[], expected: ProcessObservation, claim: string) => {
  const actual = await invokePublicProcess(argv)
  expect(actual, `contract-absent: ${claim}`).toEqual(expected)
}

const invokeUsageAndExpect = async (
  argv: readonly string[],
  claim: string,
  stdin?: string | ReadableStream<Uint8Array>,
) => {
  const actual = await invokePublicProcess(argv, {}, import.meta.dir, stdin)
  expect(actual.stdout, `contract-absent: ${claim} must not write stdout`).toBe("")
  expect(actual.exitCode, `contract-absent: ${claim} must preserve the usage exit`).toBe(literalUsageProcess.exitCode)
  const records = actual.stderr.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
  expect(records, `contract-absent: ${claim} must emit diagnostic JSONL before the primary envelope`).toHaveLength(3)
  const [context, diagnostic, primary] = records
  expect(context).toEqual({
    schema_version: 2,
    record_type: "diagnostic",
    timestamp: expect.any(String),
    sequence: 1,
    level: outcomeContextContract.level,
    category: ["agent-plugin-kit", "maintenance"],
    event: outcomeContextContract.event,
    run_id: fixedRunId,
    station_id: "maintenance.usage-refused",
    result_code: "usage-refused",
    transaction_state: "unchanged",
    retry_safety: "safe",
    message: outcomeContextContract.usageRefusalMessage,
  })
  expect(diagnostic).toMatchObject({
    schema_version: 2,
    record_type: "diagnostic",
    sequence: 2,
    level: "error",
    category: ["agent-plugin-kit", "maintenance"],
    event: "maintenance.usage-refused",
    run_id: fixedRunId,
    station_id: "maintenance.usage-refused",
    failure_class: "usage",
    result_code: "usage-refused",
    transaction_state: "unchanged",
    retry_safety: "safe",
    next_action: {
      id: "maintenance.show-help",
      action: "change_input",
    },
  })
  expect(diagnostic?.timestamp).toEqual(expect.any(String))
  expect(JSON.stringify(diagnostic)).not.toContain("fixture-secret")
  expect(primary).toEqual(JSON.parse(literalUsageProcess.stderr))
}

test.each([...fixedHelpScenarios])("%s emits canonical help bytes", (scenario: typeof fixedHelpScenarios[number]) =>
  invokeAndExpect(scenario.argv, scenario.expected, `${scenario.label} must use the canonical envelope`))
test("bare zero argv emits help with one generated run ID excluded from equality", async () => {
  const actual = await invokePublicProcess([])
  expect(actual.exitCode, "contract-absent: zero argv must emit a successful help envelope").toBe(0)
  const actualEnvelope = JSON.parse(actual.stdout) as Record<string, unknown>
  const expectedEnvelope = JSON.parse(fixedHelpScenarios[0].expected.stdout) as Record<string, unknown>
  expect(actualEnvelope.run_id).toBeString()
  expect(actualEnvelope.run_id).toMatch(/^[A-Za-z0-9._-]{1,64}$/)
  delete actualEnvelope.run_id
  delete expectedEnvelope.run_id
  expect(actualEnvelope).toEqual(expectedEnvelope)
})
test("unknown command emits typed usage refusal", () => invokeUsageAndExpect(fixedUsageScenario.argv, "unknown usage must emit diagnostic JSONL before the typed refusal envelope"))
test("piped stdin reaches the public Facade and invalidates help", async () => {
  await invokeUsageAndExpect(
    ["--run-id", fixedRunId, "help"],
    "nonempty stdin must reach public help parsing",
    "unexpected",
  )
})
test("whitespace-only stdin invalidates help", async () => {
  await invokeUsageAndExpect(
    ["--run-id", fixedRunId, "help"],
    "every stdin byte must invalidate help",
    "\n",
  )
})
test("the public process refuses stdin without waiting for the producer to close", async () => {
  const openStdin = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("unexpected"))
    },
  })
  await invokeUsageAndExpect(
    ["--run-id", fixedRunId, "help"],
    "stdin refusal must consume bounded input",
    openStdin,
  )
})
test("the real public process parses one request JSON value from explicit stdin", async () => {
  const actual = await invokePublicProcess(
    ["--run-id", fixedRunId, "maintenance", "payload", "check", "--request", "-"],
    {},
    import.meta.dir,
    '{"repositoryRoot":"/fixture/plugin","mode":"check"}\n',
  )
  expect(actual.stdout).toBe("")
  expect(actual.exitCode).toBe(2)
  expect(actual.stderr).toContain('"message":"Maintenance command is not admitted."')
  expect(actual.stderr).not.toContain('"message":"Invalid maintenance command input."')
})
test("explicit request stdin rejects malformed JSON", async () => {
  const actual = await invokePublicProcess(
    ["--run-id", fixedRunId, "maintenance", "payload", "check", "--request", "-"],
    {},
    import.meta.dir,
    '{"repositoryRoot":',
  )
  expect(actual.stdout).toBe("")
  expect(actual.exitCode).toBe(2)
  expect(actual.stderr).toContain('"message":"Invalid maintenance command input."')
})
test("explicit request stdin rejects more than one JSON value", async () => {
  const actual = await invokePublicProcess(
    ["--run-id", fixedRunId, "maintenance", "payload", "check", "--request", "-"],
    {},
    import.meta.dir,
    '{"repositoryRoot":"/fixture/plugin","mode":"check"} {"repositoryRoot":"/fixture/plugin","mode":"check"}',
  )
  expect(actual.stdout).toBe("")
  expect(actual.exitCode).toBe(2)
  expect(actual.stderr).toContain('"message":"Invalid maintenance command input."')
})
test("root executable has Bun shebang, executable mode, and optional event configuration", async () => {
  const mode = (await stat(resolve(import.meta.dir, "../maintenance.ts"))).mode & 0o111
  expect(mode).not.toBe(0)
  const { writeMaintenanceProcessObservation } = await import("../maintenance")
  const stdoutFailureStderr: string[] = []
  expect(writeMaintenanceProcessObservation(fixedHelpScenarios[3].expected, {
    stdout: () => {
      throw new Error("private stdout failure")
    },
    stderr: (value) => {
      stdoutFailureStderr.push(value)
    },
  })).toBe(1)
  expect(stdoutFailureStderr).toEqual(["Maintenance command facade containment failure.\n"])
  const stderrFailureStdout: string[] = []
  const stderrFailureStderr: string[] = []
  expect(writeMaintenanceProcessObservation(literalUsageProcess, {
    stdout: (value) => {
      stderrFailureStdout.push(value)
    },
    stderr: (value) => {
      if (stderrFailureStderr.length === 0) {
        stderrFailureStderr.push("first-write-refused")
        throw new Error("private stderr failure")
      }
      stderrFailureStderr.push(value)
    },
  })).toBe(1)
  expect(stderrFailureStdout).toEqual([])
  expect(stderrFailureStderr).toEqual([
    "first-write-refused",
    "Maintenance command facade containment failure.\n",
  ])
  expect(await invokeClosedStreamNegativeControl("stdout", ["--run-id", fixedRunId, "--help"])).toEqual({
    stdout: "",
    stderr: "Maintenance command facade containment failure.\n",
    exitCode: 1,
  })
  expect(await invokeClosedStreamNegativeControl("stderr", fixedUsageScenario.argv)).toEqual({
    stdout: "",
    stderr: "",
    exitCode: 1,
  })
  expect(await invokeRetainedDescriptorNegativeControl()).toEqual({
    deadlineMs: 100,
    timedOut: true,
    exitObserved: true,
    descriptorClosure: "closed",
    cleanup: "process-group-killed",
    retainedResources: 0,
  })
  await invokeAndExpect(["--run-id", fixedRunId, "--help"], fixedHelpScenarios[3].expected, "the executable shell must load the facade")
  const emptyEventEndpoint = await invokePublicProcess(fixedHelpScenarios[3].argv, {
    AGENT_PLUGIN_KIT_EVENT_ENDPOINT: "",
  })
  expect(emptyEventEndpoint, "an empty optional event endpoint must remain unconfigured").toEqual(fixedHelpScenarios[3].expected)
})
test("hostile color environments preserve exact machine bytes", async () => {
  const actual = await invokePublicProcess(fixedHelpScenarios[3].argv, { FORCE_COLOR: "3", TERM: "xterm-256color", NO_COLOR: "0" })
  expect(actual, "contract-absent: machine output must ignore hostile color environments").toEqual(fixedHelpScenarios[3].expected)
})
test("public process maps an invalid owner fragment without raw validation detail", () => withJsonFile(
  { repositoryRoot: 42, mode: "check" },
  async (path) => {
    const actual = await invokePublicProcess([
      "--run-id",
      fixedRunId,
      "payload",
      "check",
      "--request",
      path,
    ])
    expect(actual.stdout).toBe("")
    expect(actual.exitCode).toBe(2)
    expect(actual.stderr).toContain('"message":"Invalid maintenance command input."')
    expect(actual.stderr).not.toContain(path)
    expect(actual.stderr).not.toContain("ZodError")
  },
))
test("public process maps an unknown nested approval version before binding", () => withJsonFile(
  { ...mutatingRequests.release.approval, schemaVersion: 2 },
  async (approvalPath) => withJsonFile(
    mutatingRequests.release.request,
    async (requestPath) => {
      const actual = await invokePublicProcess([
        "--run-id",
        fixedRunId,
        "release",
        "apply",
        "--request",
        requestPath,
        "--approval",
        approvalPath,
      ])
      expect(actual.stdout).toBe("")
      expect(actual.exitCode).toBe(2)
      expect(actual.stderr).toContain('"message":"Invalid maintenance command input."')
      expect(actual.stderr).not.toContain("ZodError")
    },
  ),
))
test("public process treats authority input as an opaque reference", () => withJsonFile(
  { identity: mutatingRequests.canary.candidate.identity, inertPayloadSha256: mutatingRequests.canary.candidate.inertPayloadSha256 },
  async (candidatePath) => withJsonFile(
    { capabilities: ["forged"], secret: "authority-file-must-not-be-read" },
    async (authorityPath) => {
      const actual = await invokePublicProcess([
        "--run-id",
        fixedRunId,
        "canary",
        "qualify",
        "--candidate",
        candidatePath,
        "--authority",
        authorityPath,
      ])
      expect(actual.stdout).toBe("")
      expect(actual.exitCode).toBe(2)
      expect(actual.stderr).not.toContain("authority-file-must-not-be-read")
      expect(actual.stderr).not.toContain("capabilities")
    },
  ),
))
