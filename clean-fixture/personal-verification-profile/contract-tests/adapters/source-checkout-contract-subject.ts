export const sourceCheckoutOwnerAbsentMessage = "Maintenance command owner is not implemented."
export const sourceCheckoutNotAdmittedMessage = "Maintenance source checkout is not admitted."
export const sourceCheckoutCandidateNewFiles = [
  "clean-fixture/personal-verification-profile/contract-tests/adapters/source-checkout-contract-subject.ts",
  "clean-fixture/personal-verification-profile/contract-tests/fixtures/source-checkout-admission-cases.ts",
  "clean-fixture/personal-verification-profile/contract-tests/source-checkout-admission.test.ts",
  "docs/adr/0007-source-checkout-admission.md",
  "src/adapters/maintenance-command-facade/contract-tests/source-checkout-observation.test.ts",
  "src/adapters/maintenance-command-facade/implementation/source-checkout-observation.ts",
  "src/admission-bootstrap/contract-tests/source-checkout-admission.test.ts",
  "src/modules/maintenance-command-contract/contract-tests/fixtures/literal-wire-commands.ts",
  "src/modules/maintenance-command-contract/contract-tests/source-checkout-binding.test.ts",
] as const

export function sourceCheckoutPackageArguments(request: string): string[] {
  return ["--run-id", "source-checkout", "maintenance", "payload", "package", "--request", request]
}
