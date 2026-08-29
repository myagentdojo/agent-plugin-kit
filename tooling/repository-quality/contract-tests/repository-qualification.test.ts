import { afterAll, expect, test } from "bun:test"
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const repositoryRoot = resolve(import.meta.dir, "../../..")
const temporaryRoots: string[] = []

// Test-owned independent oracle: these literal receipts intentionally restate
// the accepted repository contract so the public verifier cannot define its
// own expected result.
const initialGroups = [
  { id: "kit-interface", files: 1, tests: 3, passed: 0, failed: 3, skipped: 0, failure_classes: { "contract-absent": 3 } },
  { id: "admission-bootstrap", files: 2, tests: 8, passed: 0, failed: 8, skipped: 0, failure_classes: { "contract-absent": 8 } },
  { id: "maintenance-command-contract", files: 3, tests: 24, passed: 0, failed: 24, skipped: 0, failure_classes: { "contract-absent": 24 } },
  { id: "qualification-evidence", files: 2, tests: 14, passed: 0, failed: 14, skipped: 0, failure_classes: { "contract-absent": 14 } },
  { id: "clean-fixture", files: 7, tests: 26, passed: 0, failed: 26, skipped: 0, failure_classes: { "contract-absent": 26 } },
  { id: "maintenance-cli-unit", files: 1, tests: 12, passed: 0, failed: 12, skipped: 0, failure_classes: { "contract-absent": 12 } },
  { id: "maintenance-cli-catalog", files: 1, tests: 8, passed: 0, failed: 8, skipped: 0, failure_classes: { "contract-absent": 8 } },
  { id: "maintenance-cli-process", files: 1, tests: 8, passed: 0, failed: 8, skipped: 0, failure_classes: { "contract-absent": 8 } },
  { id: "maintenance-cli-observability", files: 1, tests: 12, passed: 0, failed: 12, skipped: 0, failure_classes: { "contract-absent": 12 } },
  { id: "maintenance-cli-clean-fixture", files: 1, tests: 5, passed: 0, failed: 5, skipped: 0, failure_classes: { "contract-absent": 5 } },
  { id: "maintenance-cli-local-link", files: 1, tests: 8, passed: 0, failed: 8, skipped: 0, failure_classes: { "contract-absent": 8 } },
  { id: "maintenance-cli", files: 6, tests: 53, passed: 0, failed: 53, skipped: 0, failure_classes: { "contract-absent": 53 } },
] as const

const initialSuccess = {
  schema_version: 1,
  command: "verify:repository-qualification",
  status: "qualified",
  mode: "complete",
  contract: "tooling/repository-quality/repository-qualification-contract.json",
  groups: initialGroups,
  aggregate: { files: 17, tests: 104, passed: 0, failed: 104, skipped: 0 },
} as const

const mixedSuccess = {
  schema_version: 1,
  command: "verify:repository-qualification",
  status: "qualified",
  mode: "complete",
  contract: "tooling/repository-quality/repository-qualification-contract.json",
  groups: [
    { id: "kit-interface", files: 1, tests: 3, passed: 1, failed: 2, skipped: 0, failure_classes: { "contract-absent": 2 } },
    ...initialGroups.slice(1, 4),
    { id: "clean-fixture", files: 7, tests: 26, passed: 1, failed: 25, skipped: 0, failure_classes: { "contract-absent": 25 } },
    ...initialGroups.slice(5),
  ],
  aggregate: { files: 17, tests: 104, passed: 1, failed: 103, skipped: 0 },
} as const

async function copyRepositoryFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-plugin-kit-repository-qualification-"))
  temporaryRoots.push(root)
  await cp(repositoryRoot, root, {
    recursive: true,
    filter: (source) => {
      const segments = source.slice(repositoryRoot.length).split(/[\\/]/)
      return !segments.includes(".git") &&
        !segments.includes("node_modules") &&
        !segments.includes(".fallow")
    },
  })
  return root
}

async function observeVerifier(
  root: string,
  argumentsAfterScript: readonly string[] = [],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(["bun", "run", "--silent", "verify:repository-qualification", ...argumentsAfterScript], {
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

async function mutateContract(
  root: string,
  mutate: (contract: Record<string, any>) => void,
): Promise<void> {
  const path = join(root, "tooling/repository-quality/repository-qualification-contract.json")
  const contract = JSON.parse(await readFile(path, "utf8")) as Record<string, any>
  mutate(contract)
  await writeFile(path, `${JSON.stringify(contract, null, 2)}\n`)
}

async function mutateJsonFile(
  root: string,
  relativePath: string,
  mutate: (value: Record<string, any>) => void,
): Promise<void> {
  const path = join(root, relativePath)
  const value = JSON.parse(await readFile(path, "utf8")) as Record<string, any>
  mutate(value)
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function mutateTextFile(
  root: string,
  relativePath: string,
  mutate: (source: string) => string,
): Promise<void> {
  const path = join(root, relativePath)
  const source = await readFile(path, "utf8")
  await writeFile(path, mutate(source))
}

afterAll(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })))
})

test("the initial repository declaration qualifies the exact mixed RED baseline", async () => {
  const root = await copyRepositoryFixture()
  const observation = await observeVerifier(root)
  expect(observation.exitCode).toBe(0)
  expect(observation.stderr).toBe("")
  expect(observation.stdout).toBe(`${JSON.stringify(initialSuccess)}\n`)
  expect(JSON.parse(observation.stdout)).toEqual(initialSuccess)
})

test("a literal mixed RED and GREEN declaration qualifies", async () => {
  const root = await copyRepositoryFixture()
  await mutateTextFile(
    root,
    "clean-fixture/personal-verification-profile/contract-tests/package-export-catalog.test.ts",
    (source) => {
      const assertion = '  expect(installedPackage?.rootTypeExports, "contract-absent: installed root type exports must be independently observed").toEqual(expectedRootTypeExports)\n'
      if (!source.includes(assertion)) throw new Error("mixed fixture assertion was not found")
      return source.replace(assertion, "")
    },
  )
  await mutateContract(root, (contract) => {
    contract.proof_groups[0].passed = 1
    contract.proof_groups[0].failed = 2
    contract.proof_groups[0].failure_classes = { "contract-absent": 2 }
    contract.proof_groups[4].passed = 1
    contract.proof_groups[4].failed = 25
    contract.proof_groups[4].failure_classes = { "contract-absent": 25 }
    contract.aggregate.passed = 1
    contract.aggregate.failed = 103
    contract.aggregate.failure_classes = { "contract-absent": 103 }
  })
  const observation = await observeVerifier(root)
  expect(observation.exitCode).toBe(0)
  expect(observation.stderr).toBe("")
  expect(observation.stdout).toBe(`${JSON.stringify(mixedSuccess)}\n`)
  expect(JSON.parse(observation.stdout)).toEqual(mixedSuccess)
})

test("group and aggregate count imbalance is refused", async () => {
  const cases = [
    {
      label: "group",
      mutate: (contract: Record<string, any>) => {
        contract.proof_groups[0].failed = 2
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "count-mismatch",
            owner: "proof_groups[0]",
            repair_id: "restore-current-declaration",
          },
        ],
      },
    },
    {
      label: "aggregate",
      mutate: (contract: Record<string, any>) => {
        contract.aggregate.failed = 103
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "count-mismatch",
            owner: "aggregate",
            repair_id: "restore-current-declaration",
          },
        ],
      },
    },
  ] as const

  for (const row of cases) {
    const root = await copyRepositoryFixture()
    await mutateContract(root, row.mutate)
    const observation = await observeVerifier(root)
    expect(observation.exitCode, row.label).toBe(1)
    expect(observation.stdout, row.label).toBe("")
    expect(observation.stderr, row.label).toBe(`${JSON.stringify(row.expected)}\n`)
    expect(JSON.parse(observation.stderr), row.label).toEqual(row.expected)
  }
})

test("selector discovery or aggregate de-duplication drift is refused", async () => {
  const cases = [
    {
      label: "duplicate group selector file",
      mutate: (contract: Record<string, any>) => {
        contract.proof_groups[0].files.push(contract.proof_groups[0].files[0])
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "selector-drift",
            owner: "proof_groups[0].files",
            repair_id: "restore-current-declaration",
          },
        ],
      },
    },
    {
      label: "aggregate file count",
      mutate: (contract: Record<string, any>) => {
        contract.aggregate.files = 18
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "selector-drift",
            owner: "aggregate.files",
            repair_id: "restore-current-declaration",
          },
        ],
      },
    },
    {
      label: "repository quality test count",
      mutate: (contract: Record<string, any>) => {
        contract.repository_quality_tests[0].tests = 17
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "selector-drift",
            owner: "repository_quality_tests[0]",
            repair_id: "restore-current-declaration",
          },
        ],
      },
    },
    {
      label: "repository quality test omitted",
      mutate: (contract: Record<string, any>) => {
        contract.repository_quality_tests.pop()
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "selector-drift",
            owner: "repository_quality_tests",
            repair_id: "restore-current-declaration",
          },
        ],
      },
    },
    {
      label: "focused script binding drift",
      mutate: (contract: Record<string, any>) => {
        contract.proof_groups[0].script = "test:intentional-red:admission-bootstrap"
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "selector-drift",
            owner: "proof_groups[0].script",
            repair_id: "restore-current-declaration",
          },
        ],
      },
    },
    {
      label: "aggregate script binding drift",
      mutate: (contract: Record<string, any>) => {
        contract.aggregate.script = "test:intentional-red:kit-interface"
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "selector-drift",
            owner: "aggregate.script",
            repair_id: "restore-current-declaration",
          },
        ],
      },
    },
    {
      label: "workspace selector command drift",
      mutate: (contract: Record<string, any>) => {
        contract.workspace_selectors[0].command[3] = "@agent-plugin-kit/qualification-evidence"
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "selector-drift",
            owner: "workspace_selectors[0]",
            repair_id: "restore-current-declaration",
          },
        ],
      },
    },
  ] as const

  for (const row of cases) {
    const root = await copyRepositoryFixture()
    await mutateContract(root, row.mutate)
    const observation = await observeVerifier(root)
    expect(observation.exitCode, row.label).toBe(1)
    expect(observation.stdout, row.label).toBe("")
    expect(observation.stderr, row.label).toBe(`${JSON.stringify(row.expected)}\n`)
    expect(JSON.parse(observation.stderr), row.label).toEqual(row.expected)
  }

  const workspaceRoot = await copyRepositoryFixture()
  await mutateTextFile(
    workspaceRoot,
    "src/admission-bootstrap/contract-tests/identity-refusal.test.ts",
    (source) => source.replace(
      'test("workflow pin mismatch fails closed", () => assertRefusal(6))',
      'test("workflow pin mismatch fails closed", () => {})',
    ),
  )
  const workspaceExpected = {
    schema_version: 1,
    command: "verify:repository-qualification",
    status: "refused",
    mode: "complete",
    code: "proof-process-failed",
    findings: [
      {
        kind: "proof-process-failed",
        owner: "workspace_selectors[0]",
        repair_id: "repair-proof-process",
      },
    ],
  } as const
  const workspaceObservation = await observeVerifier(workspaceRoot)
  expect(workspaceObservation.exitCode).toBe(1)
  expect(workspaceObservation.stdout).toBe("")
  expect(workspaceObservation.stderr).toBe(`${JSON.stringify(workspaceExpected)}\n`)
  expect(JSON.parse(workspaceObservation.stderr)).toEqual(workspaceExpected)
})

test("an absent, unknown, or miscounted test-failure class is refused", async () => {
  const cases = [
    {
      label: "absent failure class",
      mutate: (contract: Record<string, any>) => {
        delete contract.proof_groups[0].failure_classes["contract-absent"]
      },
    },
    {
      label: "unknown failure class",
      mutate: (contract: Record<string, any>) => {
        contract.proof_groups[0].failure_classes.unknown = 3
      },
    },
    {
      label: "miscounted failure class",
      mutate: (contract: Record<string, any>) => {
        contract.proof_groups[0].failure_classes["contract-absent"] = 2
      },
    },
  ] as const

  for (const row of cases) {
    const root = await copyRepositoryFixture()
    await mutateContract(root, row.mutate)
    const expected = {
      schema_version: 1,
      command: "verify:repository-qualification",
      status: "refused",
      mode: "complete",
      code: "repository-unqualified",
      findings: [
        {
          kind: "failure-class-drift",
          owner: "proof_groups[0].failure_classes",
          repair_id: "restore-current-declaration",
        },
      ],
    } as const
    const observation = await observeVerifier(root)
    expect(observation.exitCode, row.label).toBe(1)
    expect(observation.stdout, row.label).toBe("")
    expect(observation.stderr, row.label).toBe(`${JSON.stringify(expected)}\n`)
    expect(JSON.parse(observation.stderr), row.label).toEqual(expected)
  }
})

test("required-path or declared-structure drift is refused", async () => {
  const cases = [
    {
      label: "Bun install policy drift",
      mutate: async (root: string) => {
        await writeFile(join(root, "bunfig.toml"), '[install]\nauto = "force"\n')
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "path-drift",
            owner: "bun",
            repair_id: "restore-repository-bytes",
          },
        ],
      },
    },
    {
      label: "required path absent",
      mutate: async (root: string) => {
        await rm(join(root, "src/interface.ts"))
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "path-drift",
            owner: "structure.required_paths",
            repair_id: "restore-repository-bytes",
          },
        ],
      },
    },
    {
      label: "undeclared Source Tree file present",
      mutate: async (root: string) => {
        await writeFile(join(root, "src/modules/runtime-custody/runtime.ts"), "export const runtime = undefined\n")
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "path-drift",
            owner: "structure.required_paths",
            repair_id: "restore-current-declaration",
          },
        ],
      },
    },
    {
      label: "current Source Tree declaration absent",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          contract.structure.required_paths = contract.structure.required_paths.filter(
            (path: string) => path !== "src/modules/runtime-custody/interface.ts",
          )
        })
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "path-drift",
            owner: "structure.required_paths",
            repair_id: "restore-current-declaration",
          },
        ],
      },
    },
    {
      label: "repository quality module-specifier helper declaration absent",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          contract.structure.required_paths = contract.structure.required_paths.filter(
            (path: string) => path !== "tooling/repository-quality/static-module-specifiers.ts",
          )
        })
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "path-drift",
            owner: "structure.required_paths",
            repair_id: "restore-current-declaration",
          },
        ],
      },
    },
    {
      label: "forbidden path present",
      mutate: async (root: string) => {
        const path = join(root, "src/modules/qualification-evidence/implementation/index.ts")
        await mkdir(join(root, "src/modules/qualification-evidence/implementation"), { recursive: true })
        await writeFile(path, "export {}\n")
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "path-drift",
            owner: "structure.forbidden_paths",
            repair_id: "restore-repository-bytes",
          },
        ],
      },
    },
    {
      label: "unexpected Implementation path segment present",
      mutate: async (root: string) => {
        const directory = join(root, "src/modules/unlisted-owner/implementation")
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, "index.ts"), "export {}\n")
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "path-drift",
            owner: "structure.forbidden_source_path_segments",
            repair_id: "restore-repository-bytes",
          },
        ],
      },
    },
    {
      label: "Maintenance Contract public-process adapter absent",
      mutate: async (root: string) => {
        await rm(
          join(
            root,
            "src/modules/maintenance-command-contract/contract-tests/adapters/public-process-adapter.ts",
          ),
        )
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "path-drift",
            owner: "structure.required_paths",
            repair_id: "restore-repository-bytes",
          },
        ],
      },
    },
    {
      label: "retired contract path present",
      mutate: async (root: string) => {
        await writeFile(join(root, "clean-fixture/intentional-red-contract.json"), "{}\n")
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "path-drift",
            owner: "structure.forbidden_paths",
            repair_id: "restore-repository-bytes",
          },
        ],
      },
    },
    {
      label: "retired verifier path present",
      mutate: async (root: string) => {
        await writeFile(join(root, "clean-fixture/verify-intentional-red-contract.ts"), "export {}\n")
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "path-drift",
            owner: "structure.forbidden_paths",
            repair_id: "restore-repository-bytes",
          },
        ],
      },
    },
    {
      label: "required agent pointer absent",
      mutate: async (root: string) => {
        await mutateTextFile(root, "AGENTS.md", (source) => source.replace(
          "tooling/repository-quality/repository-qualification-contract.json",
          "tooling/repository-quality/removed-contract.json",
        ))
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "path-drift",
            owner: "structure.required_agent_pointers",
            repair_id: "restore-repository-bytes",
          },
        ],
      },
    },
    {
      label: "required context term absent",
      mutate: async (root: string) => {
        await mutateTextFile(root, "CONTEXT.md", (source) => source.replace(
          "**Repository Quality Tooling**:",
          "**Repository Quality Policy**:",
        ))
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "path-drift",
            owner: "structure.required_context_terms",
            repair_id: "restore-repository-bytes",
          },
        ],
      },
    },
    {
      label: "required context-map route absent",
      mutate: async (root: string) => {
        await mutateTextFile(root, "CONTEXT-MAP.md", (source) => source.replace(
          "| Where is repository-wide quality policy owned? | Repository Quality Tooling |",
          "| Where is repository-wide quality policy owned? | Repository Quality Policy |",
        ))
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "path-drift",
            owner: "structure.required_context_map_routes",
            repair_id: "restore-repository-bytes",
          },
        ],
      },
    },
    {
      label: "required agent index link absent",
      mutate: async (root: string) => {
        await mutateTextFile(root, "docs/agents/README.md", (source) => source.replace(
          "[`fallow.md`](fallow.md)",
          "[`fallow.md`](removed-fallow.md)",
        ))
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "repository-unqualified",
        findings: [
          {
            kind: "path-drift",
            owner: "structure.required_agent_index_links",
            repair_id: "restore-repository-bytes",
          },
        ],
      },
    },
  ] as const

  for (const row of cases) {
    const root = await copyRepositoryFixture()
    await row.mutate(root)
    const observation = await observeVerifier(root)
    expect(observation.exitCode, row.label).toBe(1)
    expect(observation.stdout, row.label).toBe("")
    expect(observation.stderr, row.label).toBe(`${JSON.stringify(row.expected)}\n`)
    expect(JSON.parse(observation.stderr), row.label).toEqual(row.expected)
  }

  const cacheRoot = await copyRepositoryFixture()
  const cacheDirectory = join(cacheRoot, ".fallow/runtime-custody")
  await mkdir(cacheDirectory, { recursive: true })
  await writeFile(join(cacheDirectory, "cache.bin"), "repository-local runtime cache\n")
  const cacheObservation = await observeVerifier(cacheRoot)
  expect(cacheObservation.exitCode, cacheObservation.stderr).toBe(0)
  expect(cacheObservation.stderr).toBe("")
  expect(cacheObservation.stdout).toBe(`${JSON.stringify(initialSuccess)}\n`)

  const nestedCacheExpected = {
    schema_version: 1,
    command: "verify:repository-qualification",
    status: "refused",
    mode: "complete",
    code: "repository-unqualified",
    findings: [
      {
        kind: "path-drift",
        owner: "structure.required_paths",
        repair_id: "restore-current-declaration",
      },
    ],
  } as const
  for (const extension of [".ts", ".mts", ".cts", ".tsx"] as const) {
    const nestedCacheRoot = await copyRepositoryFixture()
    const nestedCacheDirectory = join(nestedCacheRoot, "src/modules/runtime-custody/.fallow")
    await mkdir(nestedCacheDirectory, { recursive: true })
    await writeFile(join(nestedCacheDirectory, `runtime${extension}`), "nested runtime cache\n")
    const nestedCacheObservation = await observeVerifier(nestedCacheRoot)
    expect(nestedCacheObservation.exitCode, extension).toBe(1)
    expect(nestedCacheObservation.stdout, extension).toBe("")
    expect(nestedCacheObservation.stderr, extension).toBe(`${JSON.stringify(nestedCacheExpected)}\n`)
    expect(JSON.parse(nestedCacheObservation.stderr), extension).toEqual(nestedCacheExpected)
  }
})

test("Admission Source Closure drift, escape, or bare dependency is refused", async () => {
  const cases = [
    {
      label: "sentinel count drift",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          contract.admission.sentinel_count = 2
        })
      },
    },
    {
      label: "sentinel name drift",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          contract.admission.sentinel_name = "invented Admission sentinel"
        })
      },
    },
    {
      label: "forbidden Admission self-report",
      mutate: async (root: string) => {
        await mutateTextFile(
          root,
          "src/admission-bootstrap/interface.ts",
          (source) => `${source}\nconst admissionImportLedger = []\n`,
        )
      },
    },
    {
      label: "forbidden Clean Fixture Admission self-report",
      mutate: async (root: string) => {
        await mutateTextFile(
          root,
          "clean-fixture/personal-verification-profile/contract-tests/adapters/contract-subjects.ts",
          (source) => `${source}\nexport const admissionImportLedger: string[] = []\n`,
        )
      },
    },
    {
      label: "Admission Non-Claims drift",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          contract.admission.non_claims.pop()
        })
      },
    },
    {
      label: "first GREEN implementation transition drift",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          contract.admission.first_green_implementation_transition = "The first GREEN change may defer re-scoping."
        })
      },
    },
    {
      label: "declared closure drift",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          contract.admission.source_closure = ["src/admission-bootstrap/interface.ts"]
        })
      },
    },
    {
      label: "closure escapes Source Tree",
      mutate: async (root: string) => {
        await writeFile(join(root, "outside-admission.ts"), "export type OutsideAdmission = never\n")
        const path = join(root, "src/admission-bootstrap/interface.ts")
        const source = await readFile(path, "utf8")
        await writeFile(path, source.replace("../modules/release-and-git-engine/interface", "../../outside-admission"))
      },
    },
    {
      label: "bare dependency import",
      mutate: async (root: string) => {
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(path, `${await readFile(path, "utf8")}\nimport "zod"\n`)
      },
    },
    {
      label: "triple-slash package dependency",
      mutate: async (root: string) => {
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(path, `/// <reference types="bun" />\n${await readFile(path, "utf8")}`)
      },
    },
    {
      label: "triple-slash path escapes Source Tree",
      mutate: async (root: string) => {
        await writeFile(join(root, "outside-admission.ts"), "export type OutsideAdmission = never\n")
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(path, `/// <reference path="../../outside-admission.ts" />\n${await readFile(path, "utf8")}`)
      },
    },
    {
      label: "triple-slash AMD dependency",
      mutate: async (root: string) => {
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(path, `/// <amd-dependency path="legacy-admission" />\n${await readFile(path, "utf8")}`)
      },
    },
    {
      label: "array Admission dependency field",
      mutate: async (root: string) => {
        await mutateJsonFile(root, "src/admission-bootstrap/package.json", (packageJson) => {
          packageJson.dependencies = []
        })
      },
    },
    {
      label: "type-only star dependency export",
      mutate: async (root: string) => {
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(path, `${await readFile(path, "utf8")}\nexport type * from "typescript"\n`)
      },
    },
    {
      label: "inline type-only dependency import",
      mutate: async (root: string) => {
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(path, `${await readFile(path, "utf8")}\nimport { type Node } from "typescript"\n`)
      },
    },
    {
      label: "commented type-only dependency import",
      mutate: async (root: string) => {
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(
          path,
          `${await readFile(path, "utf8")}\nimport type /* dependency */ { Node } from "typescript"\n`,
        )
      },
    },
    {
      label: "commented type-only dependency export",
      mutate: async (root: string) => {
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(
          path,
          `${await readFile(path, "utf8")}\nexport /* declaration */ type { Node } /* source */ from "typescript"\n`,
        )
      },
    },
    {
      label: "unreferenced Admission production dependency import",
      mutate: async (root: string) => {
        await writeFile(
          join(root, "src/admission-bootstrap/unreferenced-production-source.ts"),
          'import "fallow"\nexport type UnreferencedProductionSource = never\n',
        )
      },
      expectedFinding: {
        kind: "path-drift",
        owner: "structure.required_paths",
        repair_id: "restore-current-declaration",
      },
    },
    {
      label: "computed nonliteral dynamic dependency import",
      mutate: async (root: string) => {
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(
          path,
          `${await readFile(path, "utf8")}\nconst dynamicDependency = "zod"\nawait import(dynamicDependency)\n`,
        )
      },
    },
    {
      label: "computed nonliteral dynamic dependency import in template substitution",
      mutate: async (root: string) => {
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(
          path,
          `${await readFile(path, "utf8")}\nconst dynamicDependency = "zod"\n\`${"${await import(dynamicDependency)}"}\`\n`,
        )
      },
    },
    {
      label: "computed nonliteral import after regex brace in template substitution",
      mutate: async (root: string) => {
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(
          path,
          `${await readFile(path, "utf8")}\nconst dynamicDependency = "zod"\n` +
            '`' +
            '${/}/.test("}") ? import(dynamicDependency) : undefined}' +
            '`\n',
        )
      },
    },
    {
      label: "Admission projection disagrees with root Package Identity",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          contract.admission.projection.name = "drifted-agent-plugin-kit"
        })
        await mutateJsonFile(
          root,
          "clean-fixture/personal-verification-profile/contract-tests/fixtures/admission-package-projection.json",
          (projection) => {
            projection.name = "drifted-agent-plugin-kit"
          },
        )
      },
    },
    {
      label: "Admission projection type disagrees with root Package Identity",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          contract.admission.projection.type = "commonjs"
        })
        await mutateJsonFile(
          root,
          "clean-fixture/personal-verification-profile/contract-tests/fixtures/admission-package-projection.json",
          (projection) => {
            projection.type = "commonjs"
          },
        )
      },
    },
    {
      label: "Admission projection export disagrees with root Package Identity",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          contract.admission.projection.exports["./admission-bootstrap"] = "./src/admission-bootstrap/drifted.ts"
        })
        await mutateJsonFile(
          root,
          "clean-fixture/personal-verification-profile/contract-tests/fixtures/admission-package-projection.json",
          (projection) => {
            projection.exports["./admission-bootstrap"] = "./src/admission-bootstrap/drifted.ts"
          },
        )
      },
    },
  ] as const

  for (const row of cases) {
    const root = await copyRepositoryFixture()
    await row.mutate(root)
    const finding = "expectedFinding" in row
      ? row.expectedFinding
      : {
          kind: "admission-closure-drift",
          owner: "admission.source_closure",
          repair_id: "restore-repository-bytes",
        }
    const expected = {
      schema_version: 1,
      command: "verify:repository-qualification",
      status: "refused",
      mode: "complete",
      code: "repository-unqualified",
      findings: [finding],
    } as const
    const observation = await observeVerifier(root)
    expect(observation.exitCode, row.label).toBe(1)
    expect(observation.stdout, row.label).toBe("")
    expect(observation.stderr, row.label).toBe(`${JSON.stringify(expected)}\n`)
    expect(JSON.parse(observation.stderr), row.label).toEqual(expected)
  }

  const lookalikes = `
/*
/// <reference types="not-a-block-comment-dependency" />
import type { NotACommentDependency } from "not-a-comment-dependency"
*/
const notAStringDependency = 'export type * from "not-a-string-dependency"'
const notATemplateDependency = \`import { type NotATemplateDependency } from "not-a-template-dependency"\`
`
  const root = await copyRepositoryFixture()
  await mutateTextFile(
    root,
    "src/admission-bootstrap/interface.ts",
    (source) => `${lookalikes}${source}`,
  )
  await mutateTextFile(
    root,
    "src/adapters/maintenance-command-facade/maintenance.ts",
    (source) => source.replace("#!/usr/bin/env bun\n", `#!/usr/bin/env bun\n${lookalikes}`),
  )

  const observation = await observeVerifier(root)
  expect(observation.exitCode, observation.stderr).toBe(0)
  expect(observation.stderr).toBe("")
  expect(observation.stdout).toBe(`${JSON.stringify(initialSuccess)}\n`)
  expect(JSON.parse(observation.stdout)).toEqual(initialSuccess)
})

test("shell exit, sentinel, verdict, or proof-schema drift is refused", async () => {
  const cases = [
    {
      label: "declared shell script route",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          contract.shells.maintenance_cli.script = "verify:maintenance-cli:local-link"
        })
      },
      expectedOwner: "shells.maintenance_cli.script",
    },
    {
      label: "declared shell exit",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          contract.shells.maintenance_cli.red_exit = 0
        })
      },
      expectedOwner: "shells.maintenance_cli.red_exit",
    },
    {
      label: "declared shell verdict",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          contract.shells.maintenance_cli.red_verdict = "ship"
        })
      },
      expectedOwner: "shells.maintenance_cli.red_verdict",
    },
    {
      label: "observed shell sentinel",
      mutate: async (root: string) => {
        const path = join(root, "clean-fixture/verify-maintenance-cli-local-link.ts")
        await writeFile(path, (await readFile(path, "utf8")).replaceAll("implementation-absent", "drifted"))
      },
      expectedOwner: "shells.maintenance_cli_local_link.red_sentinel",
    },
    {
      label: "observed proof schema",
      mutate: async (root: string) => {
        const path = join(root, "clean-fixture/verify-maintenance-cli-local-link.ts")
        await writeFile(path, (await readFile(path, "utf8")).replace("schema_version: 1", "schema_version: 2"))
      },
      expectedOwner: "shells.maintenance_cli_local_link.proof_schema_version",
    },
  ] as const

  for (const row of cases) {
    const root = await copyRepositoryFixture()
    await row.mutate(root)
    const expected = {
      schema_version: 1,
      command: "verify:repository-qualification",
      status: "refused",
      mode: "complete",
      code: "repository-unqualified",
      findings: [
        {
          kind: "shell-drift",
          owner: row.expectedOwner,
          repair_id: "restore-repository-bytes",
        },
      ],
    } as const
    const observation = await observeVerifier(root)
    expect(observation.exitCode, row.label).toBe(1)
    expect(observation.stdout, row.label).toBe("")
    expect(observation.stderr, row.label).toBe(`${JSON.stringify(expected)}\n`)
    expect(JSON.parse(observation.stderr), row.label).toEqual(expected)
  }

  const structureOnlyRoot = await copyRepositoryFixture()
  await mutateContract(structureOnlyRoot, (contract) => {
    contract.shells.maintenance_cli.red_exit = 0
  })
  const structureOnlyExpected = {
    schema_version: 1,
    command: "verify:repository-qualification",
    status: "refused",
    mode: "structure-only",
    code: "repository-unqualified",
    findings: [
      {
        kind: "shell-drift",
        owner: "shells.maintenance_cli.red_exit",
        repair_id: "restore-repository-bytes",
      },
    ],
  } as const
  const structureOnlyObservation = await observeVerifier(structureOnlyRoot, ["--structure-only"])
  expect(structureOnlyObservation.exitCode).toBe(1)
  expect(structureOnlyObservation.stdout).toBe("")
  expect(structureOnlyObservation.stderr).toBe(`${JSON.stringify(structureOnlyExpected)}\n`)
  expect(JSON.parse(structureOnlyObservation.stderr)).toEqual(structureOnlyExpected)

  // Test-owned independent oracle: process failures have a stable refusal
  // receipt even when the reporter or observed test process is malformed.
  const processCases = [
    {
      label: "unexpected static module scanner failure",
      expectedOwner: "verifier",
      mutate: async (root: string) => {
        await mutateTextFile(root, "tooling/repository-quality/static-module-specifiers.ts", (source) => {
          const declaration = "export function staticModuleSpecifiers(file: string, source: string): string[] {\n"
          if (!source.includes(declaration)) throw new Error("static module scanner declaration was not found")
          return source.replace(
            declaration,
            `${declaration}  throw new Error("unexpected internal module scanner failure")\n`,
          )
        })
      },
    },
    {
      label: "missing JUnit reporter receipt",
      expectedOwner: "workspace_selectors[0]",
      mutate: async (root: string) => {
        await mutateTextFile(root, "tooling/repository-quality/verify-repository-qualification.ts", (source) => {
          const expected = "--reporter=junit"
          if (!source.includes(expected)) throw new Error("JUnit reporter invocation was not found")
          return source.replace(expected, "--reporter=missing-reporter")
        })
      },
    },
    {
      label: "observed test process count mismatch",
      expectedOwner: "proof_groups[0]",
      mutate: async (root: string) => {
        await mutateTextFile(
          root,
          "clean-fixture/personal-verification-profile/contract-tests/package-export-catalog.test.ts",
          (source) => `${source}\ntest("drifted process fixture", () => { throw new Error("contract-absent: process drift") })\n`,
        )
      },
    },
  ] as const

  for (const row of processCases) {
    const root = await copyRepositoryFixture()
    await row.mutate(root)
    const expected = {
      schema_version: 1,
      command: "verify:repository-qualification",
      status: "refused",
      mode: "complete",
      code: "proof-process-failed",
      findings: [
        {
          kind: "proof-process-failed",
          owner: row.expectedOwner,
          repair_id: "repair-proof-process",
        },
      ],
    } as const
    const observation = await observeVerifier(root)
    expect(observation.exitCode, row.label).toBe(1)
    expect(observation.stdout, row.label).toBe("")
    expect(observation.stderr, row.label).toBe(`${JSON.stringify(expected)}\n`)
    expect(JSON.parse(observation.stderr), row.label).toEqual(expected)
  }
})

test("root check, ten exports, exact Zod agreement, or Owner Manifest locality drift is refused", async () => {
  const cases = [
    {
      label: "root check composition",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.scripts.check = packageJson.scripts.check.replace(
          " && bun run test:quality:repository-qualification",
          "",
        )
      }),
      expectedOwner: "package_contract.scripts.check",
    },
    {
      label: "Fallow command body",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.scripts["quality:fallow"] = "fallow check"
      }),
      expectedOwner: "package_contract.scripts.quality:fallow",
    },
    {
      label: "undeclared root script",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.scripts["quality:undeclared"] = "bun run tooling/undeclared.ts"
      }),
      expectedOwner: "package_contract.scripts.quality:undeclared",
    },
    {
      label: "eleventh root export",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.exports["./maintenance-command-facade"] = "./src/adapters/maintenance-command-facade/interface.ts"
      }),
      expectedOwner: "package_contract.exports",
    },
    {
      label: "public type catalog and package exports disagree",
      mutate: (root: string) => mutateContract(root, (contract) => {
        delete contract.package_contract.type_exports["./runtime-custody"]
      }),
      expectedOwner: "package_contract.type_exports",
    },
    {
      label: "public type export added",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\nexport type RuntimeCustodyState = "ready"\n`,
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public type export removed",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => source.replace("export type RuntimeCustodyCommand =", "type RuntimeCustodyCommand ="),
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public type export renamed",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => source.replace("RuntimeCustodyResult", "RuntimeExecutionResult"),
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "aliased named type re-export added",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\nexport { type RuntimeCustodyResult as RuntimeExecutionResult }\n`,
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "indeterminate star type re-export fails closed",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\nexport type * from "../release-and-git-engine/interface"\n`,
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "unsupported default type declaration fails closed",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\nexport default interface HiddenPublicType {}\n`,
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "Zod dependency",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.devDependencies.zod = "4.0.0"
      }),
      expectedOwner: "package_contract.forbidden_dependency_names.zod",
    },
    {
      label: "LogTape dependency",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.dependencies = { "@logtape/logtape": "2.3.1" }
      }),
      expectedOwner: "package_contract.forbidden_dependency_names.@logtape/logtape",
    },
    {
      label: "malformed root dependency field",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.dependencies = "zod@4.0.0"
      }),
      expectedOwner: "package_contract.dependencies",
    },
    {
      label: "array root dependency field",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.dependencies = []
      }),
      expectedOwner: "package_contract.dependencies",
    },
    {
      label: "SideQuest dependency",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.dependencies = { "@sidequest/core": "1.0.0" }
      }),
      expectedOwner: "package_contract.forbidden_dependency_name_fragments.sidequest",
    },
    {
      label: "Bun catalog",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.catalog = { zod: "4.0.0" }
      }),
      expectedOwner: "package_contract.catalogs_allowed",
    },
    {
      label: "package manager",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.packageManager = "bun@1.3.14"
      }),
      expectedOwner: "package_contract",
    },
    {
      label: "exact root devDependencies",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        delete packageJson.devDependencies.typescript
      }),
      expectedOwner: "package_contract.dev_dependencies",
    },
    {
      label: "facade dependency locality",
      mutate: (root: string) => mutateJsonFile(
        root,
        "src/adapters/maintenance-command-facade/package.json",
        (packageJson) => {
          packageJson.dependencies = { "not-yet-admitted": "1.0.0" }
        },
      ),
      expectedOwner: "owner_manifests.maintenance_facade",
    },
    {
      label: "owner manifest inventory",
      mutate: (root: string) => mutateContract(root, (contract) => {
        delete contract.owner_manifests.runtime_custody
      }),
      expectedOwner: "owner_manifests",
    },
    {
      label: "extra Owner Manifest on disk",
      mutate: async (root: string) => {
        const directory = join(root, "src/modules/unexpected-owner")
        await mkdir(directory, { recursive: true })
        await writeFile(
          join(directory, "package.json"),
          `${JSON.stringify({ name: "@agent-plugin-kit/unexpected-owner", private: true, type: "module" }, null, 2)}\n`,
        )
      },
      expectedFinding: {
        kind: "path-drift",
        owner: "structure.required_paths",
        repair_id: "restore-current-declaration",
      },
    },
    {
      label: "owner manifest privacy",
      mutate: (root: string) => mutateJsonFile(
        root,
        "src/modules/runtime-custody/package.json",
        (packageJson) => {
          packageJson.private = false
        },
      ),
      expectedOwner: "owner_manifests.runtime_custody",
    },
    {
      label: "owner manifest identity",
      mutate: (root: string) => mutateJsonFile(
        root,
        "src/modules/runtime-custody/package.json",
        (packageJson) => {
          packageJson.name = "@agent-plugin-kit/drifted-runtime-custody"
        },
      ),
      expectedOwner: "owner_manifests.runtime_custody",
    },
    {
      label: "owner manifest type",
      mutate: (root: string) => mutateJsonFile(
        root,
        "src/modules/runtime-custody/package.json",
        (packageJson) => {
          packageJson.type = "commonjs"
        },
      ),
      expectedOwner: "owner_manifests.runtime_custody",
    },
    {
      label: "owner manifest exports",
      mutate: (root: string) => mutateJsonFile(
        root,
        "src/modules/runtime-custody/package.json",
        (packageJson) => {
          packageJson.exports = { ".": "./drifted.ts" }
        },
      ),
      expectedOwner: "owner_manifests.runtime_custody",
    },
    {
      label: "malformed owner dependency field",
      mutate: (root: string) => mutateJsonFile(
        root,
        "src/modules/runtime-custody/package.json",
        (packageJson) => {
          packageJson.dependencies = "zod@4.0.0"
        },
      ),
      expectedOwner: "package_contract.dependencies",
    },
    {
      label: "array owner dependency field",
      mutate: (root: string) => mutateJsonFile(
        root,
        "src/modules/runtime-custody/package.json",
        (packageJson) => {
          packageJson.dependencies = []
        },
      ),
      expectedOwner: "package_contract.dependencies",
    },
  ] as const

  for (const row of cases) {
    const root = await copyRepositoryFixture()
    await row.mutate(root)
    const finding = "expectedFinding" in row
      ? row.expectedFinding
      : {
          kind: "package-contract-drift",
          owner: row.expectedOwner,
          repair_id: "restore-repository-bytes",
        }
    const expected = {
      schema_version: 1,
      command: "verify:repository-qualification",
      status: "refused",
      mode: "complete",
      code: "repository-unqualified",
      findings: [finding],
    } as const
    const observation = await observeVerifier(root)
    expect(observation.exitCode, row.label).toBe(1)
    expect(observation.stdout, row.label).toBe("")
    expect(observation.stderr, row.label).toBe(`${JSON.stringify(expected)}\n`)
    expect(JSON.parse(observation.stderr), row.label).toEqual(expected)
  }

  const lexicalRoot = await copyRepositoryFixture()
  await mutateTextFile(
    lexicalRoot,
    "src/modules/runtime-custody/interface.ts",
    (source) => `${source}
/* export type CommentOnlyType = never */
export const valueOnlyRuntimeMarker = "value-only"
export const RuntimeCustodyResult = undefined
`,
  )
  const lexicalObservation = await observeVerifier(lexicalRoot)
  expect(lexicalObservation.exitCode, lexicalObservation.stderr).toBe(0)
  expect(lexicalObservation.stderr).toBe("")
  expect(lexicalObservation.stdout).toBe(`${JSON.stringify(initialSuccess)}\n`)

  const structureOnlyRoot = await copyRepositoryFixture()
  await mutateJsonFile(structureOnlyRoot, "package.json", (packageJson) => {
    packageJson.exports["./maintenance-command-facade"] = "./src/adapters/maintenance-command-facade/interface.ts"
  })
  const structureOnlyExpected = {
    schema_version: 1,
    command: "verify:repository-qualification",
    status: "refused",
    mode: "structure-only",
    code: "repository-unqualified",
    findings: [
      {
        kind: "package-contract-drift",
        owner: "package_contract.exports",
        repair_id: "restore-repository-bytes",
      },
    ],
  } as const
  const structureOnlyObservation = await observeVerifier(structureOnlyRoot, ["--structure-only"])
  expect(structureOnlyObservation.exitCode).toBe(1)
  expect(structureOnlyObservation.stdout).toBe("")
  expect(structureOnlyObservation.stderr).toBe(`${JSON.stringify(structureOnlyExpected)}\n`)
  expect(JSON.parse(structureOnlyObservation.stderr)).toEqual(structureOnlyExpected)

  const fallowCases = [
    {
      label: "Fallow config",
      owner: "fallow.config",
      mutate: (root: string) => mutateJsonFile(root, ".fallowrc.json", (config) => {
        config.audit.gate = "all"
      }),
    },
    {
      label: "VS Code Fallow comparison",
      owner: "fallow.vscode_settings",
      mutate: (root: string) => mutateJsonFile(root, ".vscode/settings.json", (settings) => {
        settings["fallow.changedSince"] = "origin/main"
      }),
    },
    {
      label: "Fallow runtime-state ignore",
      owner: "fallow.gitignore_line",
      mutate: (root: string) => mutateTextFile(root, ".gitignore", (source) =>
        source.replace("/.fallow/\n", "")),
    },
    {
      label: "Fallow skill version",
      owner: "fallow.skill_files",
      mutate: (root: string) => mutateTextFile(root, ".agents/skills/fallow/SKILL.md", (source) =>
        source.replace("version=3.19.0", "version=3.18.0")),
    },
  ] as const

  for (const row of fallowCases) {
    const root = await copyRepositoryFixture()
    await row.mutate(root)
    const expected = {
      schema_version: 1,
      command: "verify:repository-qualification",
      status: "refused",
      mode: "complete",
      code: "repository-unqualified",
      findings: [
        {
          kind: "path-drift",
          owner: row.owner,
          repair_id: "restore-repository-bytes",
        },
      ],
    } as const
    const observation = await observeVerifier(root)
    expect(observation.exitCode, row.label).toBe(1)
    expect(observation.stdout, row.label).toBe("")
    expect(observation.stderr, row.label).toBe(`${JSON.stringify(expected)}\n`)
    expect(JSON.parse(observation.stderr), row.label).toEqual(expected)
  }
})

test("unknown orchestration or Git-shaped declaration keys are refused", async () => {
  const keys = ["issue", "checkpoint", "predecessor", "reviewer", "git_history"] as const
  for (const key of keys) {
    const root = await copyRepositoryFixture()
    await mutateContract(root, (contract) => {
      contract[key] = "must-not-be-interpreted"
    })
    const expected = {
      schema_version: 1,
      command: "verify:repository-qualification",
      status: "refused",
      mode: "complete",
      code: "contract-invalid",
      findings: [
        {
          kind: "unknown-contract-key",
          owner: key,
          repair_id: "restore-current-declaration",
        },
      ],
    } as const
    const observation = await observeVerifier(root)
    expect(observation.exitCode, key).toBe(2)
    expect(observation.stdout, key).toBe("")
    expect(observation.stderr, key).toBe(`${JSON.stringify(expected)}\n`)
    expect(JSON.parse(observation.stderr), key).toEqual(expected)
  }

  const nestedRoot = await copyRepositoryFixture()
  await mutateContract(nestedRoot, (contract) => {
    contract.package_contract.foo = "must-not-be-interpreted"
  })
  // Test-owned independent oracle: a nested unknown key is reported at its
  // exact declaration owner rather than being rewritten as a root key.
  const nestedExpected = {
    schema_version: 1,
    command: "verify:repository-qualification",
    status: "refused",
    mode: "complete",
    code: "contract-invalid",
    findings: [
      {
        kind: "unknown-contract-key",
        owner: "package_contract.foo",
        repair_id: "restore-current-declaration",
      },
    ],
  } as const
  const nestedObservation = await observeVerifier(nestedRoot)
  expect(nestedObservation.exitCode).toBe(2)
  expect(nestedObservation.stdout).toBe("")
  expect(nestedObservation.stderr).toBe(`${JSON.stringify(nestedExpected)}\n`)
  expect(JSON.parse(nestedObservation.stderr)).toEqual(nestedExpected)

  // Test-owned independent oracle: malformed scalar, array, integer, and enum
  // fields are declaration refusals, never internal proof-process failures.
  const shapeCases = [
    {
      label: "array field is a scalar",
      owner: "structure.required_paths",
      mutate: (contract: Record<string, any>) => {
        contract.structure.required_paths = "README.md"
      },
    },
    {
      label: "integer field is a string",
      owner: "proof_groups[0].tests",
      mutate: (contract: Record<string, any>) => {
        contract.proof_groups[0].tests = "3"
      },
    },
    {
      label: "enum field is unknown",
      owner: "admission.proof_layer",
      mutate: (contract: Record<string, any>) => {
        contract.admission.proof_layer = "durable-replay"
      },
    },
    {
      label: "record field is an array",
      owner: "owner_manifests",
      mutate: (contract: Record<string, any>) => {
        contract.owner_manifests = []
      },
    },
  ] as const

  for (const row of shapeCases) {
    const root = await copyRepositoryFixture()
    await mutateContract(root, row.mutate)
    const expected = {
      schema_version: 1,
      command: "verify:repository-qualification",
      status: "refused",
      mode: "complete",
      code: "contract-invalid",
      findings: [
        {
          kind: "unknown-contract-key",
          owner: row.owner,
          repair_id: "restore-current-declaration",
        },
      ],
    } as const
    const observation = await observeVerifier(root)
    expect(observation.exitCode, row.label).toBe(2)
    expect(observation.stdout, row.label).toBe("")
    expect(observation.stderr, row.label).toBe(`${JSON.stringify(expected)}\n`)
    expect(JSON.parse(observation.stderr), row.label).toEqual(expected)
  }

  // Test-owned independent oracle: usage, declaration, and internal-process
  // failures must all use one canonical stderr refusal line.
  const processCases = [
    {
      label: "duplicated structure-only argv",
      argumentsAfterScript: ["--structure-only", "--structure-only"],
      mutate: async (_root: string) => {},
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "usage",
        findings: [
          {
            kind: "unknown-contract-key",
            owner: "argv",
            repair_id: "restore-current-declaration",
          },
        ],
      },
    },
    {
      label: "invalid argv",
      argumentsAfterScript: ["--invalid"],
      mutate: async (_root: string) => {},
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "usage",
        findings: [
          {
            kind: "unknown-contract-key",
            owner: "argv",
            repair_id: "restore-current-declaration",
          },
        ],
      },
    },
    {
      label: "invalid JSON declaration",
      argumentsAfterScript: [],
      mutate: async (root: string) => {
        await writeFile(
          join(root, "tooling/repository-quality/repository-qualification-contract.json"),
          "{ invalid json\n",
        )
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "contract-invalid",
        findings: [
          {
            kind: "unknown-contract-key",
            owner: "tooling/repository-quality/repository-qualification-contract.json",
            repair_id: "restore-current-declaration",
          },
        ],
      },
    },
    {
      label: "unexpected internal failure",
      argumentsAfterScript: [],
      mutate: async (root: string) => {
        await mutateTextFile(root, "tooling/repository-quality/verify-repository-qualification.ts", (source) => {
          const invocation = "  const observation = verifyRepository(contract)"
          if (!source.includes(invocation)) throw new Error("verifier invocation was not found")
          return source.replace(invocation, '  throw new Error("unexpected internal verifier failure")\n  const observation = verifyRepository(contract)')
        })
      },
      expected: {
        schema_version: 1,
        command: "verify:repository-qualification",
        status: "refused",
        mode: "complete",
        code: "proof-process-failed",
        findings: [
          {
            kind: "proof-process-failed",
            owner: "verifier",
            repair_id: "repair-proof-process",
          },
        ],
      },
    },
  ] as const

  for (const row of processCases) {
    const root = await copyRepositoryFixture()
    await row.mutate(root)
    const observation = await observeVerifier(root, row.argumentsAfterScript)
    expect(observation.exitCode, row.label).toBe(row.expected.code === "usage" || row.expected.code === "contract-invalid" ? 2 : 1)
    expect(observation.stdout, row.label).toBe("")
    expect(observation.stderr, row.label).toBe(`${JSON.stringify(row.expected)}\n`)
    expect(JSON.parse(observation.stderr), row.label).toEqual(row.expected)
  }
})
