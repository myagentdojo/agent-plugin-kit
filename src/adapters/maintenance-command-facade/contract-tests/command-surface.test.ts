import { expect, test } from "bun:test"
import { commandContractSchemaVersion, commandVocabulary } from "../../../modules/maintenance-command-contract/command-vocabulary"
import {
  literalHelpPreview,
  literalPayloadOutcome,
} from "../../../modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"
import { actionVocabulary, failureNextActionProjection, resultSchemaVersion, resultVocabulary } from "../../../modules/maintenance-command-contract/result-vocabulary"
import type { ProcessObservation } from "../interface"
import { createMaintenanceCommandFacade } from "../implementation/maintenance-command-facade"
import {
  serializeFacadeSuccessEgress,
  validateFacadeErrorEnvelope,
  validateFacadeSuccessEnvelope,
} from "../serialized-values"
import { createMaintenanceCommandsRecordingAdapter } from "./adapters/maintenance-commands-recording-adapter"
import { literalCommandRows, literalEnvironmentDependencies } from "./fixtures/literal-cli-scenarios"

const absent = (actual: unknown, expected: unknown, claim: string) =>
  expect(actual, `contract-absent: ${claim}`).toEqual(expected)

const projectedRows = commandVocabulary.map((descriptor) => [
  descriptor.route.join(" "),
  descriptor.command,
  descriptor.interfaceCall,
  descriptor.effectClass,
  descriptor.previewRoute?.join(" ") ?? null,
  descriptor.nextAction.id,
])

async function observeCommandSurface() {
  const recording = createMaintenanceCommandsRecordingAdapter()
  const facade = createMaintenanceCommandFacade({ commands: recording.commands })
  const helpObservation = await facade.invoke({
    argv: ["--run-id", "contract-help-literal", "help"],
    environment: {},
    stdin: "",
  })
  const nonHelpObservation = await facade.invoke({
    argv: ["maintenance", "--run-id", "contract-help-literal", "payload", "check", "--request", "-"],
    environment: {},
    stdin: '{"repositoryRoot":"/fixture/plugin","mode":"check"}',
  })
  const invalidArgv = await Promise.all([
    facade.invoke({ argv: ["--json", "--json", "help"], environment: {}, stdin: "" }),
    facade.invoke({ argv: ["--quiet", "--debug", "help"], environment: {}, stdin: "" }),
    facade.invoke({ argv: ["--run-id", "bad/id", "help"], environment: {}, stdin: "" }),
    facade.invoke({ argv: ["--events", "later", "help"], environment: {}, stdin: "" }),
    facade.invoke({ argv: ["help"], environment: {}, stdin: "unexpected" }),
    facade.invoke({
      argv: ["--run-id", "preserved-id", "--json", "--json", "help"],
      environment: {},
      stdin: "",
    }),
  ])
  const invalidHelpPreview = literalHelpPreview.status === "ok"
    ? {
        ...literalHelpPreview,
        value: {
          ...literalHelpPreview.value,
          agent: { schemaVersion: 1 as const, invalid_number: Number.NaN },
        },
      }
    : literalHelpPreview
  const invalidEgressObservation = await createMaintenanceCommandFacade({
    commands: {
      async inspect() {
        return invalidHelpPreview
      },
      async apply() {
        return literalPayloadOutcome
      },
    },
  }).invoke({ argv: ["help"], environment: {}, stdin: "" })
  const trusted = createMaintenanceCommandsRecordingAdapter()
  const trustedOutcome = await createMaintenanceCommandFacade({ commands: trusted.commands })
    .dispatch({ command: "help" })
  const envelope = JSON.parse(helpObservation.stdout) as {
    data: { result_schema_version: number; next_action: { action: string }; result: Record<string, unknown> }
  }
  const discovery = envelope.data.result as {
    schemaVersion: number
    package_identity: string
    binary: string
    commands: { route: string[]; command: string; interface_call: string; effect_class: string; preview_route: string[] | null; next_action_id: string }[]
    environment_dependencies: { name: string }[]
    exits: { typed: { result_codes: string[] }[] }
    next_actions: { id: string; action: string; command_id: string | null; failure_class: string }[]
  }
  const projectError = (observation: ProcessObservation) => {
    const record = JSON.parse(observation.stderr.split("\n").filter(Boolean).at(-1) ?? "{}") as {
      run_id?: string
      data?: { station_id?: string; result_code?: string; next_action?: { id?: string } }
    }
    return {
      exitCode: observation.exitCode,
      stdout: observation.stdout,
      stationId: record.data?.station_id,
      resultCode: record.data?.result_code,
      nextActionId: record.data?.next_action?.id,
      runId: record.run_id,
    }
  }

  return {
    actionVocabulary: [...new Set([envelope.data.next_action.action, ...discovery.next_actions.map(({ action }) => action)])].sort(),
    commandRows: discovery.commands.map(({ route, command, interface_call, effect_class, preview_route, next_action_id }) => [route.join(" "), command, interface_call, effect_class, preview_route?.join(" ") ?? null, next_action_id]),
    dispatchLedger: recording.calls,
    environmentReads: discovery.environment_dependencies.map(({ name }) => name),
    failureNextActions: discovery.next_actions.map(({ id, action, command_id, failure_class }) => ({ id, action, commandId: command_id, failureClass: failure_class })),
    packageIdentity: discovery.package_identity,
    binary: discovery.binary,
    parsedRoutes: discovery.commands.map(({ route }) => route.join(" ")),
    releaseInspectActionId: discovery.commands.find(({ command }) => command === "release:inspect")?.next_action_id,
    resultCodes: discovery.exits.typed.flatMap(({ result_codes }) => result_codes),
    schemaVersions: [discovery.schemaVersion, envelope.data.result_schema_version],
    nonHelp: (() => {
      const { runId: _runId, ...error } = projectError(nonHelpObservation)
      return error
    })(),
    invalidArgv: invalidArgv.map(projectError),
    invalidEgress: invalidEgressObservation,
    envelopes: {
      error: JSON.parse(nonHelpObservation.stderr) as unknown,
      success: JSON.parse(helpObservation.stdout) as unknown,
    },
    trustedDispatch: { calls: trusted.calls, outcome: trustedOutcome },
  }
}

test("fourteen command routes are projected in accepted order", async () => {
  expect(commandVocabulary).toHaveLength(14)
  expect(projectedRows).toEqual(literalCommandRows.map((row) => [...row]))
  absent((await observeCommandSurface())?.commandRows, literalCommandRows, "the facade must project the closed Command Vocabulary")
})
test("command and result schema versions are equal before divergence", async () => {
  expect(commandContractSchemaVersion).toBe(resultSchemaVersion)
  const subject = await observeCommandSurface()
  const success = validateFacadeSuccessEnvelope(subject.envelopes.success)
  const error = validateFacadeErrorEnvelope(subject.envelopes.error)
  absent(subject.schemaVersions, [1, 1], "the facade must preserve pre-divergence schema equality")
  expect(success).toBeDefined()
  expect(error).toBeDefined()
  expect(JSON.parse(JSON.stringify(success))).toEqual(success)
  expect(JSON.parse(JSON.stringify(error))).toEqual(error)
  expect(Object.isFrozen(success)).toBe(true)
  expect(Object.isFrozen(success?.data)).toBe(true)
  expect(Object.isFrozen(success?.data.result)).toBe(true)
  expect(Object.isFrozen(error)).toBe(true)
  expect(Object.isFrozen(error?.error)).toBe(true)
  const successUnknownKey = { ...(subject.envelopes.success as Record<string, unknown>), unexpected: true }
  const successWrongType = { ...(subject.envelopes.success as Record<string, unknown>), run_id: 1 }
  const errorUnknownKey = { ...(subject.envelopes.error as Record<string, unknown>), unexpected: true }
  const errorWrongType = { ...(subject.envelopes.error as Record<string, unknown>), message: 1 }
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  const unsafeRetry = clone(subject.envelopes.success) as { data: { retry_safety: string } }
  unsafeRetry.data.retry_safety = "unsafe"
  const completedTransaction = clone(subject.envelopes.success) as { data: { transaction_state: string } }
  completedTransaction.data.transaction_state = "completed"
  const noncanonicalNextAction = clone(subject.envelopes.success) as { data: { next_action: { id: string } } }
  noncanonicalNextAction.data.next_action.id = "maintenance.contact-support"
  const mismatchedErrorCode = clone(subject.envelopes.error) as { data: { result_code: string } }
  mismatchedErrorCode.data.result_code = "runtime-failed"
  const mismatchedErrorStation = clone(subject.envelopes.error) as { error: { stationId: string } }
  mismatchedErrorStation.error.stationId = "help.previewed"
  expect(validateFacadeSuccessEnvelope(successUnknownKey)).toBeUndefined()
  expect(validateFacadeSuccessEnvelope(successWrongType)).toBeUndefined()
  expect(validateFacadeErrorEnvelope(errorUnknownKey)).toBeUndefined()
  expect(validateFacadeErrorEnvelope(errorWrongType)).toBeUndefined()
  expect(validateFacadeSuccessEnvelope(unsafeRetry)).toBeUndefined()
  expect(validateFacadeSuccessEnvelope(completedTransaction)).toBeUndefined()
  expect(validateFacadeSuccessEnvelope(noncanonicalNextAction)).toBeUndefined()
  expect(validateFacadeErrorEnvelope(mismatchedErrorCode)).toBeUndefined()
  expect(validateFacadeErrorEnvelope(mismatchedErrorStation)).toBeUndefined()
  expect(serializeFacadeSuccessEgress(successWrongType)).toBeUndefined()
  absent(
    subject.invalidEgress,
    {
      exitCode: 1,
      stdout: "",
      stderr: "Maintenance command facade containment failure.\n",
    },
    "invalid Facade egress must use envelope-free containment without validator detail",
  )
})
test("root package identity and binary remain singular", async () => absent(await observeCommandSurface().then((subject) => subject && ({ packageIdentity: subject.packageIdentity, binary: subject.binary })), { packageIdentity: "agent-plugin-kit", binary: "agent-plugin-kit" }, "the facade must report the root Package Identity and binary"))
test("help does not dispatch any apply route", async () => {
  absent((await observeCommandSurface())?.dispatchLedger.filter(({ interfaceCall }) => interfaceCall === "apply").length, 0, "help must not dispatch a later-owner apply route")
})
test("help invokes only the help inspection and typed dispatch remains available", async () => {
  const subject = await observeCommandSurface()
  absent(
    subject && { helpCalls: subject.dispatchLedger, trustedDispatch: subject.trustedDispatch },
    {
      helpCalls: [{ interfaceCall: "inspect", command: { command: "help" } }],
      trustedDispatch: {
        calls: [{ interfaceCall: "inspect", command: { command: "help" } }],
        outcome: literalHelpPreview,
      },
    },
    "help must inspect only help while typed callers retain direct dispatch",
  )
})
test("non-help argv stays a usage refusal without later-owner dispatch", async () => {
  const subject = await observeCommandSurface()
  absent(
    subject && { nonHelp: subject.nonHelp, dispatchLedger: subject.dispatchLedger },
    {
      nonHelp: { exitCode: 2, stdout: "", stationId: "maintenance.usage-refused", resultCode: "usage-refused", nextActionId: "maintenance.show-help" },
      dispatchLedger: [{ interfaceCall: "inspect", command: { command: "help" } }],
    },
    "a non-help root invocation must stay implementation-deferred",
  )
  absent(
    subject?.invalidArgv,
    [
      { exitCode: 2, stdout: "", stationId: "maintenance.usage-refused", resultCode: "usage-refused", nextActionId: "maintenance.show-help", runId: expect.any(String) },
      { exitCode: 2, stdout: "", stationId: "maintenance.usage-refused", resultCode: "usage-refused", nextActionId: "maintenance.show-help", runId: expect.any(String) },
      { exitCode: 2, stdout: "", stationId: "maintenance.usage-refused", resultCode: "usage-refused", nextActionId: "maintenance.show-help", runId: expect.any(String) },
      { exitCode: 2, stdout: "", stationId: "maintenance.usage-refused", resultCode: "usage-refused", nextActionId: "maintenance.show-help", runId: expect.any(String) },
      { exitCode: 2, stdout: "", stationId: "maintenance.usage-refused", resultCode: "usage-refused", nextActionId: "maintenance.show-help", runId: expect.any(String) },
      { exitCode: 2, stdout: "", stationId: "maintenance.usage-refused", resultCode: "usage-refused", nextActionId: "maintenance.show-help", runId: "preserved-id" },
    ],
    "invalid argv must fail closed without discarding an admitted run ID",
  )
})
test("examples use fixed run IDs and safe placeholders", async () => {
  expect(commandVocabulary.every(({ example }) => example.includes("contract-help-literal"))).toBe(true)
  absent((await observeCommandSurface())?.parsedRoutes, commandVocabulary.map(({ route }) => route.join(" ")), "the facade must render deterministic safe examples")
})
test("closed lower snake case action vocabulary is discoverable", async () => {
  expect(actionVocabulary.every((action) => /^[a-z]+(?:_[a-z]+)*$/.test(action))).toBe(true)
  absent((await observeCommandSurface())?.actionVocabulary, [...actionVocabulary].sort(), "the facade must expose the closed action vocabulary")
})
test("failure-only Next Action projection has twenty-two rows", async () => {
  expect(failureNextActionProjection).toHaveLength(22)
  absent((await observeCommandSurface())?.failureNextActions, failureNextActionProjection, "the facade must serialize failure-only Next Actions")
})
test("release inspect has one review-preview success action", async () => {
  expect(commandVocabulary.filter(({ nextAction }) => nextAction.id === "release-inspect.review-preview")).toHaveLength(1)
  absent((await observeCommandSurface())?.releaseInspectActionId, "release-inspect.review-preview", "the facade must preserve the sole release inspect success action")
})
test("every Result Code belongs to exactly one exit family", async () => {
  expect(new Set(resultVocabulary.map(({ resultCode }) => resultCode)).size).toBe(resultVocabulary.length)
  absent((await observeCommandSurface())?.resultCodes, resultVocabulary.map(({ resultCode }) => resultCode), "the facade must project exact Result Vocabulary exits")
})
test("environment dependencies remain exactly endpoint and auth", async () => absent((await observeCommandSurface())?.environmentReads, literalEnvironmentDependencies, "the facade must expose only the two environmental Adapter inputs"))
