import type {
  AdmissionRefusal,
  AdmissionRequest,
  AdmittedIdentity,
  CandidateIdentity,
} from "agent-plugin-kit/release-and-git-engine"

const sourceCommit = "1111111111111111111111111111111111111111"
const releaseCommit = sourceCommit
const packageCommit = sourceCommit
const workflowCommit = sourceCommit

export const admittedCandidate = {
  source: {
    repository: { origin: "https://github.com/myagentdojo/example-plugin.git" },
    commit: sourceCommit,
  },
  release: { reference: "refs/tags/v1.0.0", commit: releaseCommit },
  package: {
    repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" },
    commit: packageCommit,
  },
  workflow: {
    repository: { origin: "https://github.com/myagentdojo/agent-plugin-kit.git" },
    path: ".github/workflows/plugin-maintenance.yml",
    commit: workflowCommit,
  },
} as const satisfies CandidateIdentity

export const expectedAdmittedIdentity = admittedCandidate as AdmittedIdentity

const agreeingRequest = {
  candidate: admittedCandidate,
  repository: admittedCandidate.source.repository,
  provenance: admittedCandidate.source,
  source: admittedCandidate.source,
  release: admittedCandidate.release,
  package: admittedCandidate.package,
  workflow: admittedCandidate.workflow,
} as const satisfies AdmissionRequest

type AdmissionInvariantCase = {
  id:
    | "identity-agrees"
    | "repository-mismatch"
    | "provenance-mismatch"
    | "source-pin-mismatch"
    | "release-pin-mismatch"
    | "package-pin-mismatch"
    | "workflow-pin-mismatch"
  request: AdmissionRequest
  expected:
    | { kind: "admitted"; identity: CandidateIdentity }
    | { kind: "refused"; code: AdmissionRefusal["code"] }
}

export const admissionInvariantCases = [
  {
    id: "identity-agrees",
    request: agreeingRequest,
    expected: { kind: "admitted", identity: admittedCandidate },
  },
  {
    id: "repository-mismatch",
    request: {
      ...agreeingRequest,
      repository: { origin: "https://github.com/myagentdojo/other-plugin.git" },
    },
    expected: { kind: "refused", code: "repository-mismatch" },
  },
  {
    id: "provenance-mismatch",
    request: {
      ...agreeingRequest,
      provenance: {
        ...agreeingRequest.provenance,
        repository: { origin: "https://github.com/myagentdojo/other-plugin.git" },
      },
    },
    expected: { kind: "refused", code: "provenance-mismatch" },
  },
  {
    id: "source-pin-mismatch",
    request: {
      ...agreeingRequest,
      source: { ...agreeingRequest.source, commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    },
    expected: { kind: "refused", code: "source-pin-mismatch" },
  },
  {
    id: "release-pin-mismatch",
    request: {
      ...agreeingRequest,
      release: { ...agreeingRequest.release, commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    },
    expected: { kind: "refused", code: "release-pin-mismatch" },
  },
  {
    id: "package-pin-mismatch",
    request: {
      ...agreeingRequest,
      package: { ...agreeingRequest.package, commit: "cccccccccccccccccccccccccccccccccccccccc" },
    },
    expected: { kind: "refused", code: "package-pin-mismatch" },
  },
  {
    id: "workflow-pin-mismatch",
    request: {
      ...agreeingRequest,
      workflow: { ...agreeingRequest.workflow, commit: "dddddddddddddddddddddddddddddddddddddddd" },
    },
    expected: { kind: "refused", code: "workflow-pin-mismatch" },
  },
] as const satisfies readonly AdmissionInvariantCase[]
