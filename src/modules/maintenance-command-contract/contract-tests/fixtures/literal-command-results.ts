import type {
  CommandPreview,
  CommandResult,
  MaintenanceApplyRequest,
} from "../../interface"
import type { AdmittedIdentity } from "../../../release-and-git-engine/interface"

const candidate = {
  source: {
    repository: { origin: "https://github.com/myagentdojo/example-plugin.git" },
    commit: "1111111111111111111111111111111111111111",
  },
  release: {
    reference: "refs/tags/v1.0.0",
    commit: "1111111111111111111111111111111111111111",
  },
  package: {
    repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" },
    commit: "1111111111111111111111111111111111111111",
  },
  workflow: {
    repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" },
    path: ".github/workflows/plugin-maintenance.yml",
    commit: "1111111111111111111111111111111111111111",
  },
} as const

const admittedIdentity = candidate as AdmittedIdentity

const releaseApproval = {
  schemaVersion: 1,
  issuer: "release-and-git-engine",
  candidate,
  candidateIdentitySha256:
    "sha256:2af031b2b3bc51ced417b607dd3e1d937b01534e37d831c392bf85022e903566",
  inspectedStateSha256:
    "sha256:fe794bd2578428889170ddefe91bd2a6a5e0d3b6755944cd74ceb49d5162533e",
  expectedEffectsSha256:
    "sha256:1709dba6fed3c45dc70a4e0af8f7ffe3b1fb09ec580894b79c0d5a4b680af348",
  digest: "sha256:91fa24c36a2b1c705fa539bdafc160e303a539a8973ec5b48b28453fc5fd9f45",
} as const

export const mutatingRequests = {
  materialize: {
    command: "payload:materialize",
    request: { repositoryRoot: "/fixture/plugin", mode: "materialize" },
  },
  package: {
    command: "payload:package",
    request: { repositoryRoot: "/fixture/plugin", mode: "package" },
  },
  runtime: {
    command: "runtime:repair-apply",
    argv: ["repair", "--apply"],
  },
  release: {
    command: "release:apply",
    request: { candidate, intent: "maintenance", expectedEffectIds: ["effect:release"] },
    approval: releaseApproval,
  },
  claude: {
    command: "harness:claude:apply",
    request: {
      identity: admittedIdentity,
      payload: { regularFiles: ["plugin.json"], payloadSha256: "sha256:6666666666666666666666666666666666666666666666666666666666666666" },
      profileIdentity: "claude-profile",
      expectedEffectIds: ["effect:claude"],
    },
    approval: {
      ...releaseApproval,
      issuer: "harness-journeys:claude",
      inspectedStateSha256:
        "sha256:397ec49639477d57894eea520280ac9691dc54dbbc5c8a45c54ab74c5efe96c7",
      expectedEffectsSha256:
        "sha256:ab481da5474cd171b88431b0bc95eb42ee3c16f077f9c331af33ce372cad415e",
      digest: "sha256:adaf2d0d8c1866d78479c03fc25677ed1a46017af0595c1dd9ab091aa257cb5c",
    },
  },
  codex: {
    command: "harness:codex:apply",
    request: {
      identity: admittedIdentity,
      payload: { regularFiles: ["plugin.json"], payloadSha256: "sha256:8888888888888888888888888888888888888888888888888888888888888888" },
      profileIdentity: "codex-profile",
      checkoutIdentity: "checkout-b",
      expectedEffectIds: ["effect:codex"],
    },
    approval: {
      ...releaseApproval,
      issuer: "harness-journeys:codex",
      inspectedStateSha256:
        "sha256:4a01bec4110a5e1a8eb7b89d81a440e9cfb2d1bc53d5879355d7b40b8adea195",
      expectedEffectsSha256:
        "sha256:70f7eee8841da88a3e731759ba6905b2ab5529d04474d2cab24ec33cce554e54",
      digest: "sha256:335943b90fced29a2da6c4dfba4d8de1cf6ede4a7377d9c94d6a12bafbb4f620",
    },
  },
  canary: {
    command: "canary:qualify",
    candidate: {
      identity: candidate,
      inertPayloadSha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
    authority: {} as never,
  },
} as const satisfies Record<string, MaintenanceApplyRequest>

export const literalHelpPreview: CommandPreview = {
  schemaVersion: 1,
  command: "help",
  effectClass: "inspect",
  expectedEffectIds: [],
  transactionState: "unchanged",
  retrySafety: "safe",
  nextAction: "Choose one command from the sealed vocabulary.",
  human: "Agent Plugin Kit maintenance commands\n",
  agent: { schemaVersion: 1, commands: 14 },
  stderr: "",
  exitClass: 0,
}

export const literalHelpProcess = {
  stdout: '{"schemaVersion":1,"commands":14}\n',
  stderr: "",
  exitCode: 0,
} as const

export const literalUsageProcess = {
  stdout: "",
  stderr: "Unknown maintenance command.\n",
  exitCode: 2,
} as const

export const literalPayloadResult: CommandResult = {
  schemaVersion: 1,
  command: "payload:materialize",
  transactionState: "completed",
  retrySafety: "safe",
  completedEffectIds: ["effect:payload-materialized"],
  remainingEffectIds: [],
  nextAction: "Inspect the materialized Plugin Payload.",
  human: "Plugin Payload materialized.\n",
  agent: { schemaVersion: 1, kind: "materialized" },
  stderr: "",
  exitClass: 0,
}
