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
    ...initialGroups.slice(1),
  ],
  aggregate: { files: 17, tests: 104, passed: 1, failed: 103, skipped: 0 },
} as const

async function copyRepositoryFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-plugin-kit-repository-qualification-"))
  temporaryRoots.push(root)
  await cp(repositoryRoot, root, {
    recursive: true,
    filter: (source) => !source.includes(`${join(".git")}`) && !source.includes(`${join("node_modules")}`),
  })
  return root
}

async function observeVerifier(root: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(["bun", "run", "--silent", "verify:repository-qualification"], {
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
  await mutateContract(root, (contract) => {
    contract.proof_groups[0].passed = 1
    contract.proof_groups[0].failed = 2
    contract.proof_groups[0].failure_classes = { "contract-absent": 2 }
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

test("required-path absence or forbidden-path presence is refused", async () => {
  const cases = [
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
})

test("Admission Source Closure drift, escape, or bare dependency is refused", async () => {
  const cases = [
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
          kind: "admission-closure-drift",
          owner: "admission.source_closure",
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

test("shell exit, sentinel, verdict, or proof-schema drift is refused", async () => {
  const cases = [
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
      label: "eleventh root export",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.exports["./maintenance-command-facade"] = "./src/adapters/maintenance-command-facade/interface.ts"
      }),
      expectedOwner: "package_contract.exports",
    },
    {
      label: "Zod dependency",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.devDependencies.zod = "4.0.0"
      }),
      expectedOwner: "package_contract.zod",
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
          kind: "package-contract-drift",
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
})
