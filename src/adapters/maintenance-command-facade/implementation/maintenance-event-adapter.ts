import type {
  EventAcceptance,
  EventAdapter,
  EventDelivery,
  EventDeliveryAssembly,
  EventDeliveryFactory,
  EventDeliveryResult,
  EventRecord,
} from "../interface"

const loopbackHosts = new Set(["127.0.0.1", "[::1]", "localhost"])

const parsedEndpoint = (endpoint: string | undefined): URL | undefined => {
  if (endpoint === undefined || endpoint === "") return undefined
  try {
    return new URL(endpoint)
  } catch {
    return undefined
  }
}

const acceptedScheme = (url: URL): boolean =>
  url.protocol === "https:" || (url.protocol === "http:" && loopbackHosts.has(url.hostname))

const acceptedEndpoint = (endpoint: string | undefined): boolean => {
  const url = parsedEndpoint(endpoint)
  if (url === undefined) return false
  return acceptedScheme(url) && url.username === "" && url.password === "" && url.search === "" && url.hash === ""
}

const attempt = async (
  assembly: EventDeliveryAssembly,
  record: EventRecord,
): Promise<"success" | "failure" | "timeout"> => {
  const delivery = Promise.resolve()
    .then(() => assembly.transport.deliver(record))
    .then(() => "success" as const, () => "failure" as const)
  const timeout = Promise.resolve()
    .then(() => assembly.clock.sleep(assembly.attemptTimeoutMs))
    .then(() => "timeout" as const, () => "timeout" as const)
  return Promise.race([delivery, timeout])
}

/**
 * Event settlement is deliberately separate from Event Acceptance.  It is
 * independently testable with a fake clock and never manufactures a command
 * result, error, or Branch Station.
 */
export const createEventDelivery: EventDeliveryFactory = (
  assembly: EventDeliveryAssembly,
): EventDelivery => ({
  async deliver(value: EventRecord): Promise<EventDeliveryResult> {
    for (let attemptNumber = 1; attemptNumber <= assembly.maximumAttempts; attemptNumber += 1) {
      const result = await attempt(assembly, value)
      if (result === "success") return { status: "delivered", attempts: attemptNumber as 1 | 2 }
    }
    return { status: "failed", attempts: 2 }
  },
})

export type MaintenanceEventAdapterOptions = {
  endpoint?: string
}

/**
 * No production transport is selected in this ticket.  A syntactically
 * accepted endpoint therefore refuses synchronously; the refusal is observed
 * by the facade without retaining work or touching the network.
 */
export const createMaintenanceEventAdapter = (
  options: MaintenanceEventAdapterOptions,
): EventAdapter | undefined => {
  if (!acceptedEndpoint(options.endpoint)) return undefined
  return {
    accept(_record): EventAcceptance {
      return { status: "refused" }
    },
  }
}
