import { expect, test } from "bun:test"
import { stat } from "node:fs/promises"
import { resolve } from "node:path"
import { literalUsageProcess } from "../../../modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"
import { invokePublicProcess, invokeRetainedDescriptorNegativeControl } from "./adapters/public-process-adapter"
import { fixedHelpScenarios, fixedRunId, fixedUsageScenario } from "./fixtures/literal-cli-scenarios"
import type { ProcessObservation } from "../interface"

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
  expect(records, `contract-absent: ${claim} must emit diagnostic JSONL before the primary envelope`).toHaveLength(2)
  const [diagnostic, primary] = records
  expect(diagnostic).toMatchObject({
    schema_version: 1,
    record_type: "diagnostic",
    sequence: 1,
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
test("root executable has Bun shebang, executable mode, and optional event configuration", async () => {
  const mode = (await stat(resolve(import.meta.dir, "../maintenance.ts"))).mode & 0o111
  expect(mode).not.toBe(0)
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
