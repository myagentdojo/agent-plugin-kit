import type { EventAcceptance, EventAdapter, EventDeliveryClock, EventRecord, EventTransport } from "../../interface"

export function createEventRecordingAdapter(acceptance: EventAcceptance = { status: "accepted" }) {
  const records: EventRecord[] = []
  const adapter: EventAdapter = {
    accept(record) {
      records.push(record)
      return acceptance
    },
  }
  return { adapter, records }
}

export function createFakeClockRecordingAdapter(outcome: "success" | "failure" = "success") {
  const sleeps: number[] = []
  const clock: EventDeliveryClock = {
    async sleep(milliseconds) {
      sleeps.push(milliseconds)
      if (outcome === "failure") throw new Error("fixture clock failure")
    },
  }
  return { clock, sleeps }
}

export function createTransportRecordingAdapter(outcomes: readonly ("success" | "failure" | "timeout")[]) {
  const records: EventRecord[] = []
  let attempt = 0
  const transport: EventTransport = {
    async deliver(record) {
      records.push(record)
      const outcome = outcomes[attempt++] ?? "failure"
      if (outcome === "failure") throw new Error("fixture transport failure")
      if (outcome === "timeout") return await new Promise<void>(() => undefined)
    },
  }
  return { records, transport }
}
