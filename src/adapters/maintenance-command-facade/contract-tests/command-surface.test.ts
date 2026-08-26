import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { commandContractSchemaVersion, commandVocabulary } from "../../../modules/maintenance-command-contract/command-vocabulary"
import { actionVocabulary, failureNextActionProjection, resultSchemaVersion, resultVocabulary } from "../../../modules/maintenance-command-contract/result-vocabulary"
import { mutatingRequests } from "../../../modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"
import { createMaintenanceCommandFacade, type ProcessObservation } from "../interface"
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
  if (createMaintenanceCommandFacade === undefined) {
    expect(createMaintenanceCommandFacade, "contract-absent: the facade factory must cross the accepted public Interface").toBeFunction()
    return undefined
  }
  const recording = createMaintenanceCommandsRecordingAdapter()
  const facade = createMaintenanceCommandFacade({ commands: recording.commands })
  const fixtureRoot = await mkdtemp(resolve(tmpdir(), "agent-plugin-kit-cli-unit-"))
  const fixturePath = (name: string) => resolve(fixtureRoot, `${name}.json`)
  const requestPaths: Partial<Record<(typeof commandVocabulary)[number]["command"], string>> = {
    "payload:check": fixturePath("payload-check"),
    "payload:materialize": fixturePath("payload-materialize"),
    "payload:package": fixturePath("payload-package"),
    "release:inspect": fixturePath("release-inspect"),
    "release:apply": fixturePath("release-apply"),
    "harness:claude:inspect": fixturePath("claude-inspect"),
    "harness:claude:apply": fixturePath("claude-apply"),
    "harness:codex:inspect": fixturePath("codex-inspect"),
    "harness:codex:apply": fixturePath("codex-apply"),
  }
  const approvalPaths = {
    "release:apply": fixturePath("release-approval"),
    "harness:claude:apply": fixturePath("claude-approval"),
    "harness:codex:apply": fixturePath("codex-approval"),
  } as const
  const candidatePath = resolve(fixtureRoot, "candidate.json")
  const authorityPath = resolve(fixtureRoot, "authority.json")
  await Promise.all([
    writeFile(requestPaths["payload:check"] as string, JSON.stringify({ ...mutatingRequests.materialize.request, mode: "check" })),
    writeFile(requestPaths["payload:materialize"] as string, JSON.stringify(mutatingRequests.materialize.request)),
    writeFile(requestPaths["payload:package"] as string, JSON.stringify(mutatingRequests.package.request)),
    writeFile(requestPaths["release:inspect"] as string, JSON.stringify(mutatingRequests.release.request)),
    writeFile(requestPaths["release:apply"] as string, JSON.stringify(mutatingRequests.release.request)),
    writeFile(requestPaths["harness:claude:inspect"] as string, JSON.stringify(mutatingRequests.claude.request)),
    writeFile(requestPaths["harness:claude:apply"] as string, JSON.stringify(mutatingRequests.claude.request)),
    writeFile(requestPaths["harness:codex:inspect"] as string, JSON.stringify(mutatingRequests.codex.request)),
    writeFile(requestPaths["harness:codex:apply"] as string, JSON.stringify(mutatingRequests.codex.request)),
    writeFile(approvalPaths["release:apply"], JSON.stringify(mutatingRequests.release.approval)),
    writeFile(approvalPaths["harness:claude:apply"], JSON.stringify(mutatingRequests.claude.approval)),
    writeFile(approvalPaths["harness:codex:apply"], JSON.stringify(mutatingRequests.codex.approval)),
    writeFile(candidatePath, JSON.stringify(mutatingRequests.canary.candidate)),
    writeFile(authorityPath, "{}"),
  ])
  let helpObservation: ProcessObservation | undefined
  let refusalObservation: ProcessObservation | undefined
  let mismatchObservation: ProcessObservation | undefined
  try {
    const invocations = commandVocabulary.map(({ command, example }) => ({
      argv: example.map((token, index) => {
        if (token !== "<FILE>") return token
        const option = example[index - 1]
        const replacement = option === "--approval" ? approvalPaths[command as keyof typeof approvalPaths]
          : option === "--candidate" ? candidatePath
          : option === "--authority" ? authorityPath
          : requestPaths[command]
        if (!replacement) throw new Error(`missing ${option} fixture for ${command}`)
        return replacement
      }),
      environment: {},
      stdin: "",
    }))
    const observations = []
    for (const invocation of invocations) observations.push(await facade.invoke(invocation))
    helpObservation = observations[0]
    const mutatingInvocation = invocations[2]
    if (!mutatingInvocation) throw new Error("missing payload materialize route invocation")
    const refusing = createMaintenanceCommandsRecordingAdapter({ refusalStationId: "payload-materialize.command-refused" })
    refusalObservation = await createMaintenanceCommandFacade({ commands: refusing.commands }).invoke(mutatingInvocation)
    const mismatched = createMaintenanceCommandsRecordingAdapter({ refusalStationId: "release-apply.command-refused" })
    mismatchObservation = await createMaintenanceCommandFacade({ commands: mismatched.commands }).invoke(mutatingInvocation)
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
  if (!helpObservation || !refusalObservation || !mismatchObservation) throw new Error("command route corpus did not produce all required observations")
  const envelope = JSON.parse(helpObservation.stdout) as {
    data: { result_schema_version: number; next_action: { action: string }; result: Record<string, unknown> }
  }
  const discovery = envelope.data.result as {
    schema_version: number
    package_identity: string
    binary: string
    commands: { route: string[]; command: string; interface_call: string; effect_class: string; preview_route: string[] | null; next_action_id: string }[]
    environment_dependencies: { name: string }[]
    exits: { typed: { result_codes: string[] }[] }
    next_actions: { id: string; action: string; command_id: string | null; failure_class: string }[]
  }
  const projectError = (observation: ProcessObservation) => {
    const record = JSON.parse(observation.stderr.split("\n").filter(Boolean).at(-1) ?? "{}") as {
      data?: { station_id?: string; result_code?: string; next_action?: { id?: string } }
    }
    return {
      exitCode: observation.exitCode,
      stdout: observation.stdout,
      stationId: record.data?.station_id,
      resultCode: record.data?.result_code,
      nextActionId: record.data?.next_action?.id,
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
    schemaVersions: [discovery.schema_version, envelope.data.result_schema_version],
    refusal: projectError(refusalObservation),
    mismatch: projectError(mismatchObservation),
  }
}

test("fourteen command routes are projected in accepted order", async () => {
  expect(commandVocabulary).toHaveLength(14)
  expect(projectedRows).toEqual(literalCommandRows.map((row) => [...row]))
  absent((await observeCommandSurface())?.commandRows, literalCommandRows, "the facade must project the closed Command Vocabulary")
})
test("command and result schema versions are equal before divergence", async () => {
  expect(commandContractSchemaVersion).toBe(resultSchemaVersion)
  absent((await observeCommandSurface())?.schemaVersions, [1, 1], "the facade must preserve pre-divergence schema equality")
})
test("root package identity and binary remain singular", async () => absent(await observeCommandSurface().then((subject) => subject && ({ packageIdentity: subject.packageIdentity, binary: subject.binary })), { packageIdentity: "agent-plugin-kit", binary: "agent-plugin-kit" }, "the facade must report the root Package Identity and binary"))
test("parser routes apply commands only through apply", async () => {
  expect(commandVocabulary.filter(({ interfaceCall }) => interfaceCall === "apply")).toHaveLength(7)
  absent((await observeCommandSurface())?.dispatchLedger.filter(({ interfaceCall }) => interfaceCall === "apply").length, 7, "the facade must dispatch apply routes only through MaintenanceCommands.apply")
})
test("parser routes inspections only through inspect", async () => {
  expect(commandVocabulary.filter(({ interfaceCall }) => interfaceCall === "inspect")).toHaveLength(7)
  absent((await observeCommandSurface())?.dispatchLedger.filter(({ interfaceCall }) => interfaceCall === "inspect").length, 7, "the facade must dispatch inspection routes only through MaintenanceCommands.inspect")
})
test("mutating routes own preview routes and effect classes", async () => {
  const subject = await observeCommandSurface()
  absent(
    subject && { commandRows: subject.commandRows, refusal: subject.refusal, mismatch: subject.mismatch },
    {
      commandRows: literalCommandRows,
      refusal: { exitCode: 21, stdout: "", stationId: "payload-materialize.command-refused", resultCode: "command-refused", nextActionId: "maintenance.inspect-refusal" },
      mismatch: { exitCode: 1, stdout: "", stationId: "maintenance.runtime-failed", resultCode: "runtime-failed", nextActionId: "maintenance.contact-support" },
    },
    "the facade must retain owner-supplied preview and effect meaning while containing a mismatched Station ID",
  )
})
test("examples use fixed run IDs and safe placeholders", async () => {
  expect(commandVocabulary.every(({ example }) => example.includes("p3-help-literal"))).toBe(true)
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
