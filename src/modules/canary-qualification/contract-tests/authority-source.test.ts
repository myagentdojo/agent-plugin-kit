import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AdmittedIdentity } from "../../release-and-git-engine/interface"
import type { CanaryPlan } from "../interface"
import { createProtectedFileAuthoritySource } from "../adapters/protected-file-authority-source"

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
const plan: CanaryPlan = {
  candidate,
  target: "github://myagentdojo/example-plugin",
  immutableReference: "refs/tags/v1.0.0",
}

test("protected-file authority source resolves an existing opaque reference", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-plugin-kit-authority-"))
  const path = join(root, "authority.json")
  await writeFile(path, '{"authority":true,"candidate":"hostile"}')
  try {
    const resolution = await createProtectedFileAuthoritySource().resolve(path, admittedIdentity, plan)
    expect(resolution.status).toBe("resolved")
    if (resolution.status === "resolved") expect(resolution.authority).toBeDefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("protected-file authority source refuses missing or empty references", async () => {
  const source = createProtectedFileAuthoritySource()
  const missing = await source.resolve("/does/not/exist", admittedIdentity, plan)
  const empty = await source.resolve("", admittedIdentity, plan)
  expect(missing).toEqual({ status: "refused", code: "authority-unavailable" })
  expect(empty).toEqual({ status: "refused", code: "authority-reference-invalid" })
})

test("protected-file authority source is candidate and plan bound without parsing file contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-plugin-kit-authority-"))
  const path = join(root, "authority.txt")
  await writeFile(path, "not JSON and not a capability")
  try {
    const source = createProtectedFileAuthoritySource()
    const alteredPlan = { ...plan, candidate: { ...candidate, source: { ...candidate.source, commit: "2222222222222222222222222222222222222222" } } }
    const resolution = await source.resolve(path, admittedIdentity, alteredPlan)
    expect(resolution).toEqual({ status: "refused", code: "authority-candidate-mismatch" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
