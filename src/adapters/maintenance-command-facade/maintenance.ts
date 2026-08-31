#!/usr/bin/env bun
import { createMaintenanceCommands } from "../../modules/maintenance-command-contract/implementation/maintenance-commands"
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

const eventEndpoint = process.env.AGENT_PLUGIN_KIT_EVENT_ENDPOINT
const facade = createMaintenanceCommandFacade({
  commands,
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
const detectStdin = async (): Promise<string> => {
  if (process.stdin.isTTY) return ""
  for await (const chunk of Bun.stdin.stream()) {
    if (chunk.byteLength > 0) return "present"
  }
  return ""
}
const runMaintenanceProcess = async (): Promise<void> => {
  const stdin = await detectStdin()
  const observation = await facade.invoke({
    argv: process.argv.slice(2),
    environment: {
      AGENT_PLUGIN_KIT_EVENT_ENDPOINT: process.env.AGENT_PLUGIN_KIT_EVENT_ENDPOINT,
      AGENT_PLUGIN_KIT_EVENT_AUTH: process.env.AGENT_PLUGIN_KIT_EVENT_AUTH,
    },
    stdin,
  })
  process.exitCode = writeMaintenanceProcessObservation(observation, {
    stdout: (value) => {
      process.stdout.write(value)
    },
    stderr: (value) => {
      process.stderr.write(value)
    },
  })
}

if (import.meta.main) await runMaintenanceProcess()
