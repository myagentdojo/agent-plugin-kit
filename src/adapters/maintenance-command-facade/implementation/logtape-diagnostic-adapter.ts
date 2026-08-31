import {
  configureSync,
  getLogger,
  resetSync,
  type Logger,
  type Sink,
} from "@logtape/logtape"
import type {
  DiagnosticAdapter,
  DiagnosticMode,
  DiagnosticPipeline,
  DiagnosticPipelineAssembly,
  DiagnosticPipelineFactory,
  DiagnosticRecord,
} from "../interface"
import { sanitizeDiagnosticRecord } from "../serialized-values"

const diagnosticCategory = ["agent-plugin-kit", "maintenance"] as const
const logTapeRecordProperty = "__agent_plugin_kit_diagnostic_record"

const writeRecord = (diagnostics: DiagnosticAdapter, record: DiagnosticRecord): void => {
  try {
    diagnostics.record(record)
  } catch {
    // Environmental writers cannot replace the primary Maintenance result.
  }
}

const isTriggerLevel = (level: DiagnosticRecord["level"]): boolean =>
  level === "error" || level === "fatal"

const isSuppressedByMode = (mode: DiagnosticMode, level: DiagnosticRecord["level"]): boolean =>
  (mode === "quiet" && !isTriggerLevel(level)) || (mode === "verbose" && level === "debug")

const isImmediateMode = (mode: DiagnosticMode): boolean =>
  mode === "quiet" || mode === "verbose" || mode === "debug"

type SequenceAllocator = () => number

const localSequenceAllocator = (): SequenceAllocator => {
  let sequence = 0
  return () => {
    sequence += 1
    return sequence
  }
}

const truncationRecordFor = (
  trigger: DiagnosticRecord,
  droppedRecordCount: number,
  sequence: number,
): DiagnosticRecord | undefined =>
  sanitizeDiagnosticRecord({
    ...trigger,
    sequence,
    level: "warning",
    event: "diagnostic.buffer-truncated",
    message: `Diagnostic buffer dropped ${droppedRecordCount} oldest record${droppedRecordCount === 1 ? "" : "s"}.`,
  })

const sequenceRecordFor = (
  record: DiagnosticRecord,
  sequence: number,
): DiagnosticRecord | undefined => sanitizeDiagnosticRecord({ ...record, sequence })

export const createDiagnosticPipeline: DiagnosticPipelineFactory = (
  assembly: DiagnosticPipelineAssembly,
): DiagnosticPipeline => {
  const diagnostics = assembly.diagnostics
  const mode = assembly.mode
  const secrets = assembly.secretValues ?? []
  const allocate = assembly.nextSequence ?? localSequenceAllocator()
  let buffered: DiagnosticRecord[] = []
  let droppedRecordCount = 0
  let highestSequence = 0
  let disposed = false

  const nextSequence = (minimum: number): number => {
    let allocated: number
    try {
      allocated = allocate()
    } catch {
      allocated = minimum
    }
    const sequence = Number.isSafeInteger(allocated) && allocated >= minimum
      ? allocated
      : minimum
    highestSequence = Math.max(highestSequence, sequence)
    return sequence
  }

  const write = (record: DiagnosticRecord): void => writeRecord(diagnostics, record)
  const trigger = (record: DiagnosticRecord): void => {
    if (droppedRecordCount > 0) {
      const truncationSequence = nextSequence(highestSequence + 1)
      const triggerSequence = nextSequence(truncationSequence + 1)
      const truncation = truncationRecordFor(record, droppedRecordCount, truncationSequence)
      const resequencedTrigger = sequenceRecordFor(record, triggerSequence)
      for (const bufferedRecord of buffered) write(bufferedRecord)
      buffered = []
      droppedRecordCount = 0
      if (truncation !== undefined) write(truncation)
      if (resequencedTrigger !== undefined) write(resequencedTrigger)
      else write(record)
    } else {
      for (const bufferedRecord of buffered) write(bufferedRecord)
      buffered = []
      write(record)
    }
    try {
      diagnostics.flush()
    } catch {
      // A throwing environmental flush is contained at this seam.
    }
  }

  return {
    record(value): void {
      if (disposed) return
      const record = sanitizeDiagnosticRecord(value, secrets)
      if (record === undefined) return
      highestSequence = Math.max(highestSequence, record.sequence)
      if (isSuppressedByMode(mode, record.level)) return
      if (isImmediateMode(mode)) {
        write(record)
        return
      }
      if (isTriggerLevel(record.level)) {
        trigger(record)
        return
      }
      if (buffered.length >= assembly.maximumBufferedRecords) {
        buffered.shift()
        droppedRecordCount += 1
      }
      buffered.push(record)
    },

    reset(): void {
      buffered = []
      droppedRecordCount = 0
    },

    dispose(): void {
      if (disposed) return
      disposed = true
      buffered = []
      droppedRecordCount = 0
      try {
        diagnostics.dispose()
      } catch {
        // Disposal is best effort and cannot replace an already-built result.
      }
    },
  }
}

const emitThroughLogTape = (logger: Logger, record: DiagnosticRecord): void => {
  const properties = { [logTapeRecordProperty]: record }
  switch (record.level) {
    case "debug":
      logger.debug(record.message, properties)
      break
    case "info":
      logger.info(record.message, properties)
      break
    case "warning":
      logger.warning(record.message, properties)
      break
    case "error":
      logger.error(record.message, properties)
      break
    case "fatal":
      logger.fatal(record.message, properties)
      break
  }
}

export type LogTapeDiagnosticAdapterOptions = {
  write?: (line: string) => void
}

/** LogTape remains a private facade environmental Adapter, never a root dependency. */
export const createLogTapeDiagnosticAdapter = (
  options: LogTapeDiagnosticAdapterOptions = {},
): DiagnosticAdapter => {
  const write = options.write ?? ((line: string) => process.stderr.write(line))
  let logger: Logger | undefined
  let disposed = false

  const configure = (): void => {
    if (logger !== undefined || disposed) return
    const sink: Sink = (logRecord) => {
      const record = sanitizeDiagnosticRecord(logRecord.properties[logTapeRecordProperty])
      if (record === undefined) return
      try {
        write(`${JSON.stringify(record)}\n`)
      } catch {
        // LogTape suppresses sink errors; preserve that property for stderr.
      }
    }
    try {
      configureSync({
        reset: true,
        sinks: { diagnostic: sink },
        loggers: [
          { category: [...diagnosticCategory], lowestLevel: "debug", sinks: ["diagnostic"] },
          { category: ["logtape", "meta"], lowestLevel: "fatal", sinks: [] },
        ],
      })
      logger = getLogger(diagnosticCategory)
    } catch {
      logger = undefined
    }
  }

  return {
    record(record): void {
      if (disposed) return
      configure()
      if (logger === undefined) return
      try {
        emitThroughLogTape(logger, record)
      } catch {
        // A diagnostic writer failure cannot alter the command result.
      }
    },
    flush(): void {
      // The owner pipeline is synchronous; LogTape's sink has no pending work.
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      if (logger === undefined) return
      logger = undefined
      try {
        resetSync()
      } catch {
        // Reset is deliberately idempotent at the Adapter boundary.
      }
    },
  }
}
