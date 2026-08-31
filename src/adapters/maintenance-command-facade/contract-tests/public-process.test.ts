import { expect, test } from "bun:test"
import { stat } from "node:fs/promises"
import { resolve } from "node:path"
import { invokePublicProcess, invokeRetainedDescriptorNegativeControl } from "./adapters/public-process-adapter"
import { fixedHelpScenarios, fixedRunId, fixedUsageScenario } from "./fixtures/literal-cli-scenarios"
import type { ProcessObservation } from "../interface"

const invokeAndExpect = async (argv: readonly string[], expected: ProcessObservation, claim: string) => {
  const actual = await invokePublicProcess(argv)
  expect(actual, `contract-absent: ${claim}`).toEqual(expected)
}

test("fixed-run no-command emits canonical help bytes", () => invokeAndExpect(fixedHelpScenarios[0].argv, fixedHelpScenarios[0].expected, "no-command help must use the canonical envelope"))
test("fixed-run namespaced help emits canonical help bytes", () => invokeAndExpect(fixedHelpScenarios[1].argv, fixedHelpScenarios[1].expected, "namespaced help must use the canonical envelope"))
test("fixed-run short help emits canonical help bytes", () => invokeAndExpect(fixedHelpScenarios[2].argv, fixedHelpScenarios[2].expected, "short help must use the canonical envelope"))
test("fixed-run long help emits canonical help bytes", () => invokeAndExpect(fixedHelpScenarios[3].argv, fixedHelpScenarios[3].expected, "long help must use the canonical envelope"))
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
test("unknown command emits typed usage refusal", () => invokeAndExpect(fixedUsageScenario.argv, fixedUsageScenario.expected, "unknown usage must emit the typed refusal envelope"))
test("piped stdin reaches the public Facade and invalidates help", async () => {
  const actual = await invokePublicProcess(
    ["--run-id", fixedRunId, "help"],
    {},
    import.meta.dir,
    "unexpected",
  )
  expect(actual, "contract-absent: nonempty stdin must reach public help parsing").toEqual(
    fixedUsageScenario.expected,
  )
})
test("whitespace-only stdin invalidates help", async () => {
  const actual = await invokePublicProcess(
    ["--run-id", fixedRunId, "help"],
    {},
    import.meta.dir,
    "\n",
  )
  expect(actual, "contract-absent: every stdin byte must invalidate help").toEqual(
    fixedUsageScenario.expected,
  )
})
test("the public process refuses stdin without waiting for the producer to close", async () => {
  const openStdin = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("unexpected"))
    },
  })
  const actual = await invokePublicProcess(
    ["--run-id", fixedRunId, "help"],
    {},
    import.meta.dir,
    openStdin,
  )
  expect(actual, "contract-absent: stdin refusal must consume bounded input").toEqual(
    fixedUsageScenario.expected,
  )
})
test("root executable has Bun shebang and executable mode", async () => {
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
})
test("hostile color environments preserve exact machine bytes", async () => {
  const actual = await invokePublicProcess(fixedHelpScenarios[3].argv, { FORCE_COLOR: "3", TERM: "xterm-256color", NO_COLOR: "0" })
  expect(actual, "contract-absent: machine output must ignore hostile color environments").toEqual(fixedHelpScenarios[3].expected)
})
