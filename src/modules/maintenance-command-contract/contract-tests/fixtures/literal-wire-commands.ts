import type { WireCommand } from "../../interface"
import {
  literalPackageRequest,
  literalPayloadCheckRequest,
  literalPayloadMaterializeRequest,
  mutatingRequests,
} from "./literal-command-results"

const candidate = mutatingRequests.release.request.candidate
const payload = mutatingRequests.claude.request.payload

export const literalWireCommands: readonly WireCommand[] = [
  { schemaVersion: 1, command: "help" },
  { schemaVersion: 1, command: "payload:check", request: literalPayloadCheckRequest },
  { schemaVersion: 1, command: "payload:materialize", request: literalPayloadMaterializeRequest },
  { schemaVersion: 1, command: "payload:package", request: literalPackageRequest },
  { schemaVersion: 1, command: "runtime:repair", argv: ["repair"] },
  { schemaVersion: 1, command: "runtime:repair-apply", argv: ["repair", "--apply"] },
  { schemaVersion: 1, command: "release:inspect", request: { candidate, intent: "maintenance" } },
  { schemaVersion: 1, command: "release:apply", request: mutatingRequests.release.request, approval: mutatingRequests.release.approval },
  { schemaVersion: 1, command: "harness:claude:inspect", request: { candidate, payload, profileIdentity: "claude-profile" } },
  { schemaVersion: 1, command: "harness:claude:apply", request: { candidate, payload, profileIdentity: "claude-profile", expectedEffectIds: ["effect:claude"] }, approval: mutatingRequests.claude.approval },
  { schemaVersion: 1, command: "harness:codex:inspect", request: { candidate, payload, profileIdentity: "codex-profile", checkoutIdentity: "checkout-b" } },
  { schemaVersion: 1, command: "harness:codex:apply", request: { candidate, payload, profileIdentity: "codex-profile", checkoutIdentity: "checkout-b", expectedEffectIds: ["effect:codex"] }, approval: mutatingRequests.codex.approval },
  { schemaVersion: 1, command: "canary:inspect", candidate: { identity: candidate, inertPayloadSha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" } },
  { schemaVersion: 1, command: "canary:qualify", candidate: { identity: candidate, inertPayloadSha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }, authority: "/protected/authority" },
] as const
