export const diagnosticModes = ["quiet", "verbose", "debug"] as const
export const diagnosticModeContract = {
  quiet: { writtenLevels: ["error", "fatal"], bufferedLevels: [] },
  default: { writtenLevels: ["error", "fatal"], bufferedLevels: ["debug", "info", "warning"] },
  verbose: { writtenLevels: ["info", "warning", "error", "fatal"], bufferedLevels: [] },
  debug: { writtenLevels: ["debug", "info", "warning", "error", "fatal"], bufferedLevels: [] },
} as const
export const hostileColorEnvironment = {
  FORCE_COLOR: "3",
  TERM: "xterm-256color",
  NO_COLOR: "0",
} as const
export const fixedEventFailure = {
  endpoint: "http://127.0.0.1:9/events",
  event: "event.delivery-failed",
  stationId: "help.previewed",
  resultCode: "previewed",
  failureClass: "event_delivery",
  nextActionId: "events.inspect-configuration",
} as const
export const outcomeContextContract = {
  event: "maintenance.outcome-context",
  level: "info",
  usageRefusalMessage: 'Maintenance command reached result code "usage-refused".',
  previewedMessage: 'Maintenance command reached result code "previewed".',
  completedMessage: 'Maintenance command reached result code "completed".',
} as const

export const bufferedSequence = [1, 2, 3, 4] as const
export const lifecycleContract = {
  configureCalls: 1,
  disposeCalls: 1,
  resetLedger: ["case-1:reset", "case-2:reset"],
  doubleDispose: "no-op",
  throwingClose: { primaryResultPreserved: true, stdoutWrites: 0, redacted: true },
  successfulTeardown: { bufferedRecordsDiscarded: true },
} as const
