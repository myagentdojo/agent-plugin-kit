export const sourceCheckoutNotAdmittedMessage = "Maintenance source checkout is not admitted."
export const sourceCheckoutPayloadRefusalMessage = 'Maintenance command failed with result code "command-refused".'

export function sourceCheckoutPackageArguments(request: string): string[] {
  return ["--run-id", "source-checkout", "maintenance", "payload", "package", "--request", request]
}
