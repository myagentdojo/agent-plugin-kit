import type {
  CommandPreview,
  FailureClass,
  MaintenanceCommand,
  MaintenanceCommands,
  MaintenanceErrorEnvelopeData,
  MaintenanceErrorEnvelopeProjection,
  MaintenanceOutcome,
  MaintenanceSuccessEnvelopeData,
  ResultCode,
  StationId,
} from "../../modules/maintenance-command-contract/interface"

export type DiagnosticMessage =
  | `Maintenance command failed with result code "${ResultCode}".`
  | "Inspect the configured event transport; do not repeat the command solely to replay its event."
  | `Diagnostic buffer dropped ${number} oldest record.`
  | `Diagnostic buffer dropped ${number} oldest records.`

export type DiagnosticRecord = Readonly<{
  schema_version: 1
  record_type: "diagnostic"
  timestamp: string
  sequence: number
  level: "debug" | "info" | "warning" | "error" | "fatal"
  category: readonly ["agent-plugin-kit", "maintenance"]
  event: string
  run_id: string
  command?: MaintenanceCommand["command"]
  station_id?: StationId
  failure_class?: FailureClass
  result_code?: ResultCode
  transaction_state?: CommandPreview["transactionState"]
  retry_safety?: CommandPreview["retrySafety"]
  next_action?: CommandPreview["nextAction"]
  dropped_record_count?: number
  message: DiagnosticMessage
}>

export type EventRecord = Readonly<{
  schema_version: 1
  event_id: string
  occurred_at: string
  sequence: number
  run_id: string
  command: MaintenanceCommand["command"]
  station_id: StationId
  outcome: "previewed" | "completed" | "refused" | "failed"
  result_code: ResultCode
  failure_class?: FailureClass
  transaction_state: CommandPreview["transactionState"]
  retry_safety: CommandPreview["retrySafety"]
  next_action_id: string
}>

export type EventAcceptance =
  | { status: "accepted" }
  | { status: "refused" }

export interface DiagnosticAdapter {
  record(record: DiagnosticRecord): void
  flush(): void
  dispose(): void
}

export interface EventAdapter {
  accept(record: EventRecord): EventAcceptance
}

export type FacadeInvocation = {
  argv: readonly string[]
  environment: Readonly<Record<string, string | undefined>>
  stdin: string
}

export type ProcessObservation = {
  stdout: string
  stderr: string
  exitCode: number
}

/** The Facade owns only the closed public process envelope around Maintenance data. */
export type FacadeSuccessEnvelope = {
  schema_version: 1
  status: "ok"
  run_id: string
  data: MaintenanceSuccessEnvelopeData
}

/** The Facade owns only the closed public process envelope around Maintenance failures. */
export type FacadeErrorEnvelope = {
  record_type: "error_envelope"
  schema_version: 1
  status: "error"
  message: string
  run_id: string
  data: MaintenanceErrorEnvelopeData
  error: MaintenanceErrorEnvelopeProjection
}

export interface MaintenanceCommandFacade {
  invoke(invocation: FacadeInvocation): Promise<ProcessObservation>
  dispatch(command: MaintenanceCommand): Promise<MaintenanceOutcome<unknown>>
}

export type FacadeCorrelationSources = {
  now: () => string
  eventId: () => string
}

export type MaintenanceCommandFacadeAssembly = {
  commands: MaintenanceCommands
  diagnosticFactory?: () => Promise<DiagnosticAdapter | undefined>
  eventFactory?: () => Promise<EventAdapter | undefined>
  correlation?: FacadeCorrelationSources
}

export type DiagnosticMode = "quiet" | "default" | "verbose" | "debug"

export interface DiagnosticPipeline {
  record(record: DiagnosticRecord): void
  reset(): void
  dispose(): void
}

export type DiagnosticEgressStep =
  | "build-allowlist"
  | "canonicalize"
  | "validate"
  | "freeze"
  | "cross-seam"

export type DiagnosticPipelineAssembly = {
  mode: DiagnosticMode
  maximumBufferedRecords: 250
  diagnostics: DiagnosticAdapter
  secretValues?: readonly string[]
  nextSequence: () => number
  egressTrace?: (step: DiagnosticEgressStep) => void
}

export interface EventDeliveryClock {
  sleep(milliseconds: 250): Promise<void>
}

export interface EventTransport {
  deliver(record: EventRecord): Promise<void>
}

export type EventDeliveryResult =
  | { status: "delivered"; attempts: 1 | 2 }
  | { status: "failed"; attempts: 2 }

export interface EventDelivery {
  deliver(record: EventRecord): Promise<EventDeliveryResult>
}

export type EventDeliveryAssembly = {
  clock: EventDeliveryClock
  transport: EventTransport
  attemptTimeoutMs: 250
  maximumAttempts: 2
}

export type MaintenanceCommandFacadeFactory = (
  assembly: MaintenanceCommandFacadeAssembly,
) => MaintenanceCommandFacade
export type DiagnosticPipelineFactory = (
  assembly: DiagnosticPipelineAssembly,
) => DiagnosticPipeline
export type EventDeliveryFactory = (
  assembly: EventDeliveryAssembly,
) => EventDelivery

export const maintenanceCommandFacade: MaintenanceCommandFacade | undefined = undefined
