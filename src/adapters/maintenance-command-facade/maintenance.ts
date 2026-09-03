#!/usr/bin/env bun
import { createMaintenanceCommands } from "../../modules/maintenance-command-contract/implementation/maintenance-commands"
import {
  bindSourceCheckoutCommand,
} from "../../modules/maintenance-command-contract/implementation/trusted-command-binding"
import { createMaintenanceCommandFacade } from "./implementation/maintenance-command-facade"
import type { ProcessObservation } from "./interface"

const writerContainmentFailure = "Maintenance command facade containment failure.\n"

export type ProcessWriters = Readonly<{
  stdout: (value: string) => void
  stderr: (value: string) => void
}>

const writeContainmentFailure = (writeStderr: ProcessWriters["stderr"]): void => {
  try {
    writeStderr(writerContainmentFailure)
  } catch {
    // The root has no third process stream. Containment must stop here.
  }
}

const installProcessStreamFailureContainment = (): ((nominalExitCode: number) => number) => {
  let streamFailure = false
  let fallbackAttempted = false
  const contain = (): void => {
    streamFailure = true
    process.exitCode = 1
    if (fallbackAttempted) return
    fallbackAttempted = true
    writeContainmentFailure((value) => {
      process.stderr.write(value)
    })
  }
  process.stdout.on("error", contain)
  process.stderr.on("error", contain)
  return (nominalExitCode) => streamFailure ? 1 : nominalExitCode
}

export const writeMaintenanceProcessObservation = (
  observation: ProcessObservation,
  writers: ProcessWriters,
): number => {
  try {
    if (observation.stdout !== "") writers.stdout(observation.stdout)
  } catch {
    writeContainmentFailure(writers.stderr)
    return 1
  }

  try {
    if (observation.stderr !== "") writers.stderr(observation.stderr)
  } catch {
    writeContainmentFailure(writers.stderr)
    return 1
  }

  return observation.exitCode
}

const unavailable = async (..._arguments: unknown[]): Promise<never> => {
  throw new Error("later Maintenance owner is not admitted in this process")
}

const commands = createMaintenanceCommands({
  payload: { produce: unavailable },
  runtime: unavailable,
  release: { inspect: unavailable, apply: unavailable },
  harness: { inspect: unavailable, apply: unavailable },
  canary: { inspect: unavailable, qualify: unavailable },
})

const sourceCheckoutAdmission = async () => {
  try {
    const [{ observeSourceCheckout }, { admissionBootstrap }] = await Promise.all([
      import("./implementation/source-checkout-observation"),
      import("../../admission-bootstrap/implementation/admission-bootstrap"),
    ])
    const observation = observeSourceCheckout({ entryPath: import.meta.path, cwd: process.cwd(), environment: process.env })
    return observation.kind === "observed"
      ? admissionBootstrap.admitSourceCheckout(observation.request)
      : { kind: "refused" as const }
  } catch {
    return { kind: "refused" as const }
  }
}

const eventEndpoint = process.env.AGENT_PLUGIN_KIT_EVENT_ENDPOINT
const facade = createMaintenanceCommandFacade({
  commands,
  wireBinding: async (value) => {
    const bound = await bindSourceCheckoutCommand(value, { admission: sourceCheckoutAdmission })
    return bound.status === "bound"
      ? { status: "refused", code: "payload-owner-absent" }
      : bound
  },
  diagnosticFactory: async () => {
    const { createLogTapeDiagnosticAdapter } = await import("./implementation/logtape-diagnostic-adapter")
    return createLogTapeDiagnosticAdapter()
  },
  ...(eventEndpoint === undefined || eventEndpoint === ""
    ? {}
    : {
        eventFactory: async () => {
          const { createMaintenanceEventAdapter } = await import("./implementation/maintenance-event-adapter")
          return createMaintenanceEventAdapter({ endpoint: eventEndpoint })
        },
      }),
})
const stdinInputOptions = new Set(["--request", "--approval", "--candidate", "--authority"])
const explicitInputReadsStdin = (argv: readonly string[]): boolean =>
  argv.some((token, index) => stdinInputOptions.has(token) && argv[index + 1] === "-")

const readCompleteStdin = async (): Promise<string> => {
  const decoder = new TextDecoder()
  let value = ""
  for await (const chunk of Bun.stdin.stream()) {
    value += decoder.decode(chunk, { stream: true })
  }
  return value + decoder.decode()
}

const detectStdin = async (argv: readonly string[]): Promise<string> => {
  if (process.stdin.isTTY) return ""
  if (explicitInputReadsStdin(argv)) return readCompleteStdin()
  for await (const chunk of Bun.stdin.stream()) {
    if (chunk.byteLength > 0) return "present"
  }
  return ""
}
const runMaintenanceProcess = async (): Promise<void> => {
  const containedExitCode = installProcessStreamFailureContainment()
  const argv = process.argv.slice(2)
  const stdin = await detectStdin(argv)
  const observation = await facade.invoke({
    argv,
    environment: {
      AGENT_PLUGIN_KIT_EVENT_ENDPOINT: process.env.AGENT_PLUGIN_KIT_EVENT_ENDPOINT,
      AGENT_PLUGIN_KIT_EVENT_AUTH: process.env.AGENT_PLUGIN_KIT_EVENT_AUTH,
    },
    stdin,
  })
  process.exitCode = containedExitCode(writeMaintenanceProcessObservation(observation, {
    stdout: (value) => {
      process.stdout.write(value)
    },
    stderr: (value) => {
      process.stderr.write(value)
    },
  }))
}

if (import.meta.main) await runMaintenanceProcess()
