export type RuntimeCustodyCommand =
  | readonly ["--help"]
  | readonly ["run", string, "--", ...string[]]
  | readonly ["repair"]
  | readonly ["repair", "--apply"]

type RuntimeCustodyControlCode =
  | "REPAIR_PREVIEW"
  | "REPAIR_UNNEEDED"
  | "REPAIR_APPLIED"
  | "USAGE"
  | "BUN_MISSING"
  | "CACHE_ROOT_UNSAFE"
  | "REPAIR_REQUIRED"
  | "HOST_TOOL_MISSING"
  | "RUNTIME_NOT_EXECUTABLE"
  | "UNSUPPORTED_PLATFORM"
  | "DOWNLOAD_FAILED"
  | "LOCK_HELD"
  | "ARCHIVE_HASH_MISMATCH"
  | "ARCHIVE_MEMBER_AMBIGUOUS"
  | "ARCHIVE_MEMBER_MISSING"
  | "ARCHIVE_SIZE_MISMATCH"
  | "BUNDLE_MISMATCH"
  | "BUNDLE_UNMAPPED"
  | "EXECUTABLE_HASH_MISMATCH"
  | "EXECUTABLE_SIZE_MISMATCH"
  | "EXECUTABLE_VERSION_MISMATCH"
  | "LOCK_INVALID"
  | "SKILL_UNKNOWN"
  | "URL_REJECTED"

type RuntimeCustodyControl = {
  schemaVersion: 1
  ok: boolean
  code: RuntimeCustodyControlCode
  sideEffects: readonly [] | readonly ["published-runtime"]
  retrySafe: boolean
  nextAction: string
  runtime?: { version: string; executableSha256: string }
  state?: { before: "valid" | "missing" | "corrupt" }
}

export type RuntimeCustodyResult =
  | {
      kind: "control"
      control: RuntimeCustodyControl
      stderr: string
      exitClass: 0 | 2 | 20 | 21 | 22 | 23
    }
  | {
      kind: "skill-process"
      stdout: Uint8Array
      stderr: Uint8Array
      exitCode: number
    }
