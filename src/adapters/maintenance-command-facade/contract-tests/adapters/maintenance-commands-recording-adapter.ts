import type {
  MaintenanceCommand,
  MaintenanceCommands,
  MaintenanceOutcome,
} from "../../../../modules/maintenance-command-contract/interface"
import {
  literalHelpPreview,
  literalPayloadOutcome,
} from "../../../../modules/maintenance-command-contract/contract-tests/fixtures/literal-command-results"

const commandRefusal = (stationId: `${string}.command-refused`): MaintenanceOutcome<never> => ({
  status: "error",
  resultCode: "command-refused",
  stationId,
  error: {
    name: "MaintenanceCommandError",
    exitCodeHint: 21,
    failureClass: "refusal",
    errorFamily: "authorization_scope",
    severity: "error",
    action: "inspect_state",
    retryable: false,
    recoverability: "repair_state",
    retrySafety: "requires-fresh-inspection",
    transactionState: "unchanged",
    nextAction: {
      id: "maintenance.inspect-refusal",
      action: "inspect_state",
      summary: "Inspect the refusal before changing state.",
      commandId: null,
    },
  },
})

export function createMaintenanceCommandsRecordingAdapter(options: { refusalStationId?: `${string}.command-refused` } = {}) {
  const calls: { interfaceCall: "inspect" | "apply"; command: MaintenanceCommand }[] = []
  const commands: MaintenanceCommands = {
    async inspect(command) {
      calls.push({ interfaceCall: "inspect", command })
      if (options.refusalStationId) return commandRefusal(options.refusalStationId)
      return literalHelpPreview
    },
    async apply(request) {
      calls.push({ interfaceCall: "apply", command: request })
      if (options.refusalStationId) return commandRefusal(options.refusalStationId)
      return literalPayloadOutcome
    },
  }
  return { calls, commands }
}
