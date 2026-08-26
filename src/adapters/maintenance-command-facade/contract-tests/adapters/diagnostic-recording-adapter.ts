import type { DiagnosticAdapter, DiagnosticRecord } from "../../interface"

export function createDiagnosticRecordingAdapter(options: { throwOnDispose?: boolean } = {}) {
  const records: DiagnosticRecord[] = []
  const lifecycle: string[] = []
  const adapter: DiagnosticAdapter = {
    record(record) {
      records.push(record)
    },
    flush() {
      lifecycle.push("flush")
    },
    dispose() {
      lifecycle.push("dispose")
      if (options.throwOnDispose) throw new Error("fixture close failure containing fixture-secret-must-not-cross")
    },
  }
  return { adapter, lifecycle, records }
}
