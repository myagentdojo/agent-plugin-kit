export const sourceCheckoutAdmissionCases = {
  admittedPayloadRefusal: { title: "admitted package checkout reaches the Payload refusal for a nonexistent payload root" },
  committedWrongPin: { title: "a committed wrong pin refuses source admission" },
  uncommittedRestoration: { title: "an uncommitted restored pin cannot authorize source admission" },
  committedRestoration: { title: "a committed restored pin reaches the Payload owner" },
  dirtyCheckout: { title: "a dirty Kit source refuses admission" },
  gitInstalledCopy: { title: "a production Git install of the same commit refuses without source metadata" },
  protectedCommand: { title: "protected commands remain in their existing refusal family" },
} as const
