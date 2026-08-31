#!/usr/bin/env bun
import { createMaintenanceCommands } from "../../modules/maintenance-command-contract/implementation/maintenance-commands"
import { createMaintenanceCommandFacade } from "./implementation/maintenance-command-facade"

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
const stdin = await detectStdin()
const observation = await facade.invoke({
  argv: process.argv.slice(2),
  environment: {
    AGENT_PLUGIN_KIT_EVENT_ENDPOINT: process.env.AGENT_PLUGIN_KIT_EVENT_ENDPOINT,
    AGENT_PLUGIN_KIT_EVENT_AUTH: process.env.AGENT_PLUGIN_KIT_EVENT_AUTH,
  },
  stdin,
})

if (observation.stdout !== "") process.stdout.write(observation.stdout)
if (observation.stderr !== "") process.stderr.write(observation.stderr)
process.exitCode = observation.exitCode
