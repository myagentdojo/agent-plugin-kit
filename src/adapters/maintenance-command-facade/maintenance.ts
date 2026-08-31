#!/usr/bin/env bun
import { createMaintenanceCommands } from "../../modules/maintenance-command-contract/implementation/maintenance-commands"
import { createMaintenanceCommandFacade } from "./implementation/maintenance-command-facade"
import { createLogTapeDiagnosticAdapter } from "./implementation/logtape-diagnostic-adapter"
import { createMaintenanceEventAdapter } from "./implementation/maintenance-event-adapter"

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
const diagnosticRequested = eventEndpoint !== undefined || process.argv.slice(2).some((argument) =>
  argument === "--quiet" || argument === "--verbose" || argument === "--debug",
)
const events = createMaintenanceEventAdapter({
  ...(eventEndpoint === undefined ? {} : { endpoint: eventEndpoint }),
  ...(process.env.AGENT_PLUGIN_KIT_EVENT_AUTH === undefined
    ? {}
    : { authorization: process.env.AGENT_PLUGIN_KIT_EVENT_AUTH }),
})
const facade = createMaintenanceCommandFacade({
  commands,
  ...(diagnosticRequested
    ? { diagnostics: createLogTapeDiagnosticAdapter() }
    : {}),
  ...(events === undefined ? {} : { events }),
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
