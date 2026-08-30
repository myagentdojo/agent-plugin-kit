import { afterAll, expect, test } from "bun:test"
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import {
  NonliteralModuleSpecifierError,
  staticModuleSpecifiers,
} from "../static-module-specifiers.ts"
import { isDescendantRelativePath } from "../verify-repository-qualification.ts"

const repositoryRoot = resolve(import.meta.dir, "../../..")
const temporaryRoots: string[] = []
const temporaryReceiptDirectories: string[] = []

const runtimeSourceFinding = {
  kind: "admission-closure-drift",
  owner: "admission.runtime_source_paths",
  repair_id: "restore-repository-bytes",
} as const

const emptyRuntimeOutputSha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
const runtimeCustodyCrossOwnerReexportSha256 = "bcd6b7f38ab1d03cfe2a7d8b45d27c527231eb6752472ea798a1fe3daca9d26b"
const runtimeCustodyDotPrefixedReexportSha256 = "5e1d1f9c0afc2f804f887373dc709231ef8152711f155d59dc943084ab9dabd7"
const runtimeCustodyCtsDeclarationReexportSha256 = "3f31f9265cc942d0fdbf6766356ea73450cdb04c794793ce6041f8c291f36210"
const runtimeCustodyDeclarationReexportSha256 = "701dc68d78cc7db409dd44252b16e3f9bc3be231279710407f82b72bc6cae838"
const runtimeCustodyMtsDeclarationReexportSha256 = "fc695e39e894132e7fbbf5b80d86923db5630b9d249dd58024da60f1ffd4cbf8"
const runtimeCustodySymlinkEscapeSha256 = "6057a279a505664aeb4ebc294ddfea8fe84f416d7194799ff4935d30e2a5aa86"
const runtimeCustodyValueReexportSha256 = "e90983cb0c73421c56ac37d4cba36cb5308c3addd681a2b995acea850dacb725"
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
  await symlink(join(repositoryRoot, "node_modules"), join(root, "node_modules"), "dir")
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

type IndependentCounts = {
  files: number
  tests: number
  passed: number
  failed: number
  skipped: number
  failure_classes: Readonly<Record<string, number>>
}

type IndependentSuite = Omit<IndependentCounts, "files"> & { file: string }
type IndependentProcess = IndependentCounts & { suites: readonly IndependentSuite[] }
type CurrentDeclaration = {
  proof_groups: readonly { id: string; files: readonly string[] }[]
  aggregate: { selected_files: readonly string[] }
}

async function buildIndependentSuccessReceipt(root: string): Promise<Record<string, unknown>> {
  const declarationPath = join(root, "tooling/repository-quality/repository-qualification-contract.json")
  const declaration = JSON.parse(await readFile(declarationPath, "utf8")) as CurrentDeclaration
  const aggregate = await observeIndependentTests(root, declaration.aggregate.selected_files)
  const groups = declaration.proof_groups.map((group) => ({
    id: group.id,
    ...independentGroupCounts(aggregate.suites, group.files),
  }))
  return {
    schema_version: 1,
    command: "verify:repository-qualification",
    status: "qualified",
    mode: "complete",
    contract: "tooling/repository-quality/repository-qualification-contract.json",
    groups,
    aggregate: {
      files: aggregate.files,
      tests: aggregate.tests,
      passed: aggregate.passed,
      failed: aggregate.failed,
      skipped: aggregate.skipped,
    },
  }
}

function independentGroupCounts(
  suites: readonly IndependentSuite[],
  files: readonly string[],
): IndependentCounts {
  const selected = files.map((file) => {
    const suite = suites.find((candidate) => candidate.file === file)
    if (suite === undefined) throw new Error(`independent test process omitted ${file}`)
    return suite
  })
  return selected.reduce(
    (total, suite) => ({
      files: total.files + 1,
      tests: total.tests + suite.tests,
      passed: total.passed + suite.passed,
      failed: total.failed + suite.failed,
      skipped: total.skipped + suite.skipped,
      failure_classes: mergeIndependentFailureClasses(total.failure_classes, suite.failure_classes),
    }),
    { files: 0, tests: 0, passed: 0, failed: 0, skipped: 0, failure_classes: {} },
  )
}

async function observeIndependentTests(
  root: string,
  files: readonly string[],
): Promise<IndependentProcess> {
  const receiptDirectory = await mkdtemp(join(tmpdir(), "agent-plugin-kit-independent-proof-"))
  temporaryReceiptDirectories.push(receiptDirectory)
  const receiptPath = join(receiptDirectory, "receipt.xml")
  const child = Bun.spawn([
    "bun",
    "test",
    ...files,
    "--reporter=junit",
    "--reporter-outfile",
    receiptPath,
  ], {
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  })
  const [exitCode, , ] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  const receipt = await readFile(receiptPath, "utf8")
  const observed = parseIndependentReceipt(receipt, files)
  const expectedExitCode = observed.failed === 0 ? 0 : 1
  if (exitCode !== expectedExitCode) {
    throw new Error(`independent test process exit ${exitCode} did not match ${expectedExitCode}`)
  }
  return observed
}

function parseIndependentReceipt(source: string, files: readonly string[]): IndependentProcess {
  const root = xmlTag(source, "testsuites")
  const suites = [...source.matchAll(/<testsuite\b[^>]*>[\s\S]*?<\/testsuite>/g)].map((match) => match[0] as string)
  const observedFiles = suites.map((suite) => xmlAttribute(xmlTag(suite, "testsuite"), "file"))
  if (suites.length !== files.length || JSON.stringify([...observedFiles].sort()) !== JSON.stringify([...files].sort())) {
    throw new Error("independent test process did not report the selected files")
  }
  const tests = xmlInteger(root, "tests")
  const failed = xmlInteger(root, "failures")
  const skipped = xmlInteger(root, "skipped")
  const parsedSuites = suites.map((suite) => parseIndependentSuite(suite))
  const failureCount = parsedSuites.reduce((total, suite) => total + suite.failed, 0)
  const skippedCount = parsedSuites.reduce((total, suite) => total + suite.skipped, 0)
  const testCount = parsedSuites.reduce((total, suite) => total + suite.tests, 0)
  if (failureCount !== failed || skippedCount !== skipped || testCount !== tests || failed + skipped > tests) {
    throw new Error("independent test process reported inconsistent JUnit counts")
  }
  return {
    files: suites.length,
    tests,
    passed: tests - failed - skipped,
    failed,
    skipped,
    failure_classes: mergeIndependentFailureClasses({}, ...parsedSuites.map((suite) => suite.failure_classes)),
    suites: parsedSuites,
  }
}

function parseIndependentSuite(source: string): IndependentSuite {
  const tag = xmlTag(source, "testsuite")
  const file = xmlAttribute(tag, "file")
  const tests = xmlInteger(tag, "tests")
  const failed = xmlInteger(tag, "failures")
  const skipped = xmlInteger(tag, "skipped")
  const failureTags = [...source.matchAll(/<failure\b[^>]*>/g)].map((match) => match[0] as string)
  if (failureTags.length !== failed || failed + skipped > tests) {
    throw new Error(`independent test process reported inconsistent counts for ${file}`)
  }
  return {
    file,
    tests,
    passed: tests - failed - skipped,
    failed,
    skipped,
    failure_classes: independentFailureClasses(failureTags),
  }
}

function xmlTag(source: string, name: string): string {
  const match = source.match(new RegExp(`<${name}\\b[^>]*>`))
  if (match === null) throw new Error(`independent test process omitted <${name}>`)
  return match[0]
}

function xmlAttribute(tag: string, attribute: string): string {
  const match = tag.match(new RegExp(`\\b${attribute}="([^"]*)"`))
  if (match?.[1] === undefined) throw new Error(`independent test process omitted ${attribute}`)
  return match[1]
}

function xmlInteger(tag: string, attribute: string): number {
  const value = Number(xmlAttribute(tag, attribute))
  if (!Number.isInteger(value) || value < 0) throw new Error(`independent test process reported invalid ${attribute}`)
  return value
}

function independentFailureClasses(failureTags: readonly string[]): Readonly<Record<string, number>> {
  const classes: Record<string, number> = {}
  for (const tag of failureTags) {
    const message = xmlAttribute(tag, "message")
    const failureClass = message.match(/(?:^|[\s"'(])([a-z][a-z0-9-]*-[a-z0-9-]*):/)?.[1]
    if (failureClass === undefined) throw new Error("independent test process omitted a failure class")
    classes[failureClass] = (classes[failureClass] ?? 0) + 1
  }
  return classes
}

function mergeIndependentFailureClasses(
  ...failureClasses: readonly Readonly<Record<string, number>>[]
): Readonly<Record<string, number>> {
  const merged: Record<string, number> = {}
  for (const classes of failureClasses) {
    for (const [failureClass, count] of Object.entries(classes)) {
      merged[failureClass] = (merged[failureClass] ?? 0) + count
    }
  }
  return merged
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

function proofGroup(contract: Record<string, any>, id: string): Record<string, any> {
  const group = contract.proof_groups.find((candidate: { id?: string }) => candidate.id === id)
  if (group === undefined) throw new Error(`fixture omitted proof group ${id}`)
  return group
}

function extendAdmissionRuntimeSourcePaths(
  contract: Record<string, any>,
  paths: readonly string[],
): void {
  contract.admission.runtime_source_paths = [
    ...new Set([...contract.admission.runtime_source_paths, ...paths]),
  ].sort()
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

async function addAdmissionRuntimeSources(
  root: string,
  paths: readonly string[],
  includeInClosure = true,
): Promise<void> {
  await Promise.all(paths.map((path) => writeFile(
    join(root, path),
    'export const runtimeMarker = "runtime"\nexport type RuntimeMarker = typeof runtimeMarker\n',
  )))
  if (includeInClosure) {
    const imports = paths.map((path, index) => {
      const name = path.split("/").at(-1)?.replace(".ts", "")
      return `import type { RuntimeMarker as RuntimeMarker${index} } from "./${name}"\ntype AdmissionRuntimeMarker${index} = RuntimeMarker${index}\n`
    }).join("")
    await mutateTextFile(
      root,
      "src/admission-bootstrap/interface.ts",
      (source) => `${source}\n${imports}`,
    )
  }
  await mutateContract(root, (contract) => {
    contract.structure.required_paths.push(...paths)
    if (includeInClosure) contract.admission.source_closure.push(...paths)
  })
}

async function addCrossOwnerValueReexport(root: string): Promise<void> {
  const implementationDirectory = "src/modules/release-and-git-engine/implementation"
  const implementationPath = `${implementationDirectory}/cross-owner.ts`
  await mkdir(join(root, implementationDirectory), { recursive: true })
  await writeFile(join(root, implementationPath), "export const crossOwnerValue = {}\n")
  await mutateTextFile(
    root,
    "src/modules/runtime-custody/interface.ts",
    (source) => `${source}\nexport { crossOwnerValue } from "../release-and-git-engine/implementation/cross-owner"\n`,
  )
  await mutateContract(root, (contract) => {
    contract.structure.required_paths.push(implementationPath)
    contract.structure.forbidden_paths = contract.structure.forbidden_paths
      .filter((path: string) => path !== implementationDirectory)
    contract.structure.forbidden_source_path_segments = contract.structure.forbidden_source_path_segments
      .filter((segment: string) => segment !== "implementation")
    contract.package_contract.runtime_output_sha256["./runtime-custody"] =
      runtimeCustodyCrossOwnerReexportSha256
  })
}

async function addSymlinkedOwnerEscapeReexport(root: string): Promise<void> {
  const targetDirectory = "src/modules/release-and-git-engine/implementation"
  const targetPath = `${targetDirectory}/cross-owner.ts`
  const linkedDirectory = "src/modules/runtime-custody/implementation"
  await mkdir(join(root, targetDirectory), { recursive: true })
  await writeFile(join(root, targetPath), "export const crossOwnerValue = {}\n")
  await symlink("../release-and-git-engine/implementation", join(root, linkedDirectory))
  await mutateTextFile(
    root,
    "src/modules/runtime-custody/interface.ts",
    (source) => `${source}\nexport { crossOwnerValue } from "./implementation/cross-owner"\n`,
  )
  await mutateContract(root, (contract) => {
    contract.structure.required_paths.push(linkedDirectory, targetPath)
    contract.structure.forbidden_paths = contract.structure.forbidden_paths
      .filter((path: string) => path !== linkedDirectory && path !== targetDirectory)
    contract.structure.forbidden_source_path_segments = contract.structure.forbidden_source_path_segments
      .filter((segment: string) => segment !== "implementation")
    contract.package_contract.runtime_output_sha256["./runtime-custody"] =
      runtimeCustodySymlinkEscapeSha256
  })
}

async function addRuntimeCustodyValueReexport(
  root: string,
  implementationSource: string,
  specifier = "./implementation/runtime-custody",
  runtimeSha256 = runtimeCustodyValueReexportSha256,
  implementationName = "runtime-custody.ts",
): Promise<void> {
  const implementationDirectory = "src/modules/runtime-custody/implementation"
  const implementationPath = `${implementationDirectory}/${implementationName}`
  await mkdir(join(root, implementationDirectory), { recursive: true })
  await writeFile(join(root, implementationPath), implementationSource)
  await mutateTextFile(
    root,
    "src/modules/runtime-custody/interface.ts",
    (source) => `${source}\nexport { runtimeCustodyValue } from "${specifier}"\n`,
  )
  await mutateContract(root, (contract) => {
    contract.structure.required_paths.push(implementationPath)
    contract.structure.forbidden_paths = contract.structure.forbidden_paths
      .filter((path: string) => path !== implementationDirectory)
    contract.structure.forbidden_source_path_segments = contract.structure.forbidden_source_path_segments
      .filter((segment: string) => segment !== "implementation")
    contract.package_contract.runtime_output_sha256["./runtime-custody"] = runtimeSha256
  })
}

async function addEscapedModuleLiteralValueReexport(root: string): Promise<void> {
  const implementationDirectory = "src/modules/runtime-custody/implementation"
  const runtimeTargetPath = `${implementationDirectory}/runtime-custody.ts`
  const verifierTargetPath = `${implementationDirectory}/\\u0072untime-custody.ts`
  await mkdir(join(root, implementationDirectory), { recursive: true })
  await writeFile(join(root, runtimeTargetPath), "export class runtimeCustodyValue {}\n")
  await writeFile(join(root, verifierTargetPath), "export const runtimeCustodyValue = {}\n")
  await mutateTextFile(
    root,
    "src/modules/runtime-custody/interface.ts",
    (source) => `${source}\nexport { runtimeCustodyValue } from "./implementation/\\u0072untime-custody"\n`,
  )
  await mutateContract(root, (contract) => {
    contract.structure.required_paths.push(runtimeTargetPath, verifierTargetPath)
    contract.structure.forbidden_paths = contract.structure.forbidden_paths
      .filter((path: string) => path !== implementationDirectory)
    contract.structure.forbidden_source_path_segments = contract.structure.forbidden_source_path_segments
      .filter((segment: string) => segment !== "implementation")
    contract.package_contract.runtime_output_sha256["./runtime-custody"] =
      runtimeCustodyValueReexportSha256
  })
}

afterAll(async () => {
  await Promise.all([
    ...temporaryRoots.map((root) => rm(root, { recursive: true, force: true })),
    ...temporaryReceiptDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  ])
})

test("the initial repository declaration qualifies the exact mixed RED baseline", async () => {
  const root = await copyRepositoryFixture()
  const expected = await buildIndependentSuccessReceipt(root)
  const observation = await observeVerifier(root)
  expect(observation.exitCode).toBe(0)
  expect(observation.stderr).toBe("")
  expect(observation.stdout).toBe(`${JSON.stringify(expected)}\n`)
  expect(JSON.parse(observation.stdout)).toEqual(expected)
})

test("an additional independently observed GREEN transition qualifies", async () => {
  const root = await copyRepositoryFixture()
  await mutateTextFile(
    root,
    "clean-fixture/personal-verification-profile/contract-tests/package-export-catalog.test.ts",
    (source) => `${source}\ntest("fixture-local GREEN transition", () => {\n  expect(true).toBe(true)\n})\n`,
  )
  await mutateContract(root, (contract) => {
    for (const groupId of ["kit-interface", "clean-fixture"]) {
      const group = proofGroup(contract, groupId)
      group.tests += 1
      group.passed += 1
    }
    contract.aggregate.tests += 1
    contract.aggregate.passed += 1
  })
  const expected = await buildIndependentSuccessReceipt(root)
  const observation = await observeVerifier(root)
  expect(observation.exitCode).toBe(0)
  expect(observation.stderr).toBe("")
  expect(observation.stdout).toBe(`${JSON.stringify(expected)}\n`)
  expect(JSON.parse(observation.stdout)).toEqual(expected)
})

test("group and aggregate count imbalance is refused", async () => {
  const cases = [
    {
      label: "group",
      mutate: (contract: Record<string, any>) => {
        contract.proof_groups[0].failed += 1
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
        contract.aggregate.failed += 1
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
    (source) => {
      const marker = 'test("workflow pin mismatch fails closed"'
      const start = source.indexOf(marker)
      if (start < 0) throw new Error("workspace selector fixture test was not found")
      const nextTest = source.indexOf('\ntest("', start + marker.length)
      return nextTest < 0
        ? source.slice(0, start)
        : `${source.slice(0, start)}${source.slice(nextTest + 1)}`
    },
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
  expect(independentFailureClasses(['<failure message="error: contract-absent: prefixed failure">'])).toEqual({
    "contract-absent": 1,
  })

  const cases = [
    {
      label: "absent failure class",
      mutate: async (root: string) => {
        await mutateTextFile(
          root,
          "clean-fixture/personal-verification-profile/contract-tests/package-export-catalog.test.ts",
          (source) => `${source}\ntest("fixture-local undeclared failure class", () => {\n  expect(false, "contract-absent: fixture-local failure must be declared").toBeTrue()\n})\n`,
        )
        await mutateContract(root, (contract) => {
          for (const groupId of ["kit-interface", "clean-fixture"]) {
            const group = proofGroup(contract, groupId)
            group.tests += 1
            group.failed += 1
          }
          contract.aggregate.tests += 1
          contract.aggregate.failed += 1
        })
      },
    },
    {
      label: "unknown failure class",
      mutate: (root: string) => mutateContract(root, (contract) => {
        contract.proof_groups[0].failure_classes.unknown = 3
      }),
    },
    {
      label: "miscounted failure class",
      mutate: (root: string) => mutateContract(root, (contract) => {
        const current = contract.proof_groups[0].failure_classes["contract-absent"] ?? 0
        contract.proof_groups[0].failure_classes["contract-absent"] = current + 1
      }),
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
      label: "nested Source Tree node_modules TypeScript file present",
      mutate: async (root: string) => {
        const directory = join(root, "src/modules/runtime-custody/node_modules")
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, "hidden.ts"), "export const hidden = undefined\n")
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
        const path = join(root, "src/modules/runtime-custody/implementation/index.ts")
        await mkdir(join(root, "src/modules/runtime-custody/implementation"), { recursive: true })
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
        const forbiddenSegment = "fixture-forbidden-segment"
        await mutateContract(root, (contract) => {
          contract.structure.forbidden_source_path_segments.push(forbiddenSegment)
        })
        const directory = join(root, "src/modules/unlisted-owner", forbiddenSegment)
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

  const generatedDependencyRoot = await copyRepositoryFixture()
  const generatedDependencyTarget = join(generatedDependencyRoot, "node_modules/zod")
  const generatedDependencyDirectory = join(
    generatedDependencyRoot,
    "src/modules/qualification-evidence/node_modules",
  )
  await mkdir(generatedDependencyTarget, { recursive: true })
  await writeFile(join(generatedDependencyTarget, "package.json"), "{}\n")
  await mkdir(generatedDependencyDirectory, { recursive: true })
  await symlink(generatedDependencyTarget, join(generatedDependencyDirectory, "zod"), "dir")
  const generatedDependencyExpected = await buildIndependentSuccessReceipt(generatedDependencyRoot)
  const generatedDependencyObservation = await observeVerifier(generatedDependencyRoot)
  expect(generatedDependencyObservation.exitCode, generatedDependencyObservation.stderr).toBe(0)
  expect(generatedDependencyObservation.stderr).toBe("")
  expect(generatedDependencyObservation.stdout).toBe(`${JSON.stringify(generatedDependencyExpected)}\n`)

  const cacheRoot = await copyRepositoryFixture()
  const cacheDirectory = join(cacheRoot, ".fallow/runtime-custody")
  await mkdir(cacheDirectory, { recursive: true })
  await writeFile(join(cacheDirectory, "cache.bin"), "repository-local runtime cache\n")
  const cacheExpected = await buildIndependentSuccessReceipt(cacheRoot)
  const cacheObservation = await observeVerifier(cacheRoot)
  expect(cacheObservation.exitCode, cacheObservation.stderr).toBe(0)
  expect(cacheObservation.stderr).toBe("")
  expect(cacheObservation.stdout).toBe(`${JSON.stringify(cacheExpected)}\n`)

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
}, 15_000)

test("Admission Source Closure and runtime-source drift, escape, or bare dependency is refused", async () => {
  const cases = [
    {
      label: "runtime source declaration duplicates a path",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          const existingPath = contract.admission.runtime_source_paths[0] ??
            "src/admission-bootstrap/interface.ts"
          contract.admission.runtime_source_paths = [
            ...contract.admission.runtime_source_paths,
            existingPath,
            existingPath,
          ]
        })
      },
      expectedFinding: runtimeSourceFinding,
    },
    {
      label: "runtime source declaration is unsorted",
      mutate: async (root: string) => {
        const paths = [
          "src/admission-bootstrap/runtime-a.ts",
          "src/admission-bootstrap/runtime-b.ts",
        ] as const
        await addAdmissionRuntimeSources(root, paths)
        await mutateContract(root, (contract) => {
          contract.admission.runtime_source_paths = [
            ...new Set([...contract.admission.runtime_source_paths, ...paths]),
          ].sort().reverse()
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "runtime source declaration names an absent path",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, ["src/admission-bootstrap/missing.ts"])
        })
      },
      expectedFinding: runtimeSourceFinding,
    },
    {
      label: "runtime source declaration escapes the Source Closure",
      mutate: async (root: string) => {
        const path = "src/admission-bootstrap/runtime-outside-closure.ts"
        await addAdmissionRuntimeSources(root, [path], false)
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [path])
        })
      },
      expectedFinding: runtimeSourceFinding,
    },
    {
      label: "runtime-bearing source is omitted from declaration",
      mutate: async (root: string) => {
        await addAdmissionRuntimeSources(root, ["src/admission-bootstrap/runtime-omitted.ts"])
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "declared runtime source is runtime-empty",
      mutate: async (root: string) => {
        const runtimePath = "src/admission-bootstrap/runtime-empty.ts"
        await addAdmissionRuntimeSources(root, [runtimePath])
        await writeFile(
          join(root, runtimePath),
          "export type RuntimeEmpty = never\n",
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [runtimePath])
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "public Admission Interface runtime drift remains protected",
      mutate: async (root: string) => {
        await mutateTextFile(
          root,
          "src/admission-bootstrap/interface.ts",
          (source) => `${source}\nexport const hiddenRuntime = 1\n`,
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, ["src/admission-bootstrap/interface.ts"])
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.runtime_source_paths",
        repair_id: "restore-repository-bytes",
      },
    },
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
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.owner_manifest",
        repair_id: "restore-repository-bytes",
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
      label: "computed nonliteral import after control-condition regex brace in template substitution",
      mutate: async (root: string) => {
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(
          path,
          `${await readFile(path, "utf8")}\nconst dynamicDependency = "zod"\n` +
            '`' +
            '${(() => { if (true) /}/.test("}") })() ? import(dynamicDependency) : undefined}' +
            '`\n',
        )
      },
    },
    {
      label: "computed nonliteral require between divisions after property named if",
      mutate: async (root: string) => {
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(
          path,
          `${await readFile(path, "utf8")}\n` +
            'const controlLookalike = { if: (_value: boolean) => 1 }\n' +
            'const dynamicDependency = "zod"\n' +
            'controlLookalike.if(true) / require(dynamicDependency) / 2\n',
        )
      },
    },
    {
      label: "escaped require between divisions after multiline property named if",
      mutate: async (root: string) => {
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(
          path,
          `${await readFile(path, "utf8")}\n` +
            'const controlLookalike = { if: (_value: boolean) => 1 }\n' +
            'const dynamicDependency = "zod"\n' +
            'controlLookalike.\nif(true) / requ\\u0069re(dynamicDependency) / 2\n',
        )
      },
    },
    {
      label: "computed nonliteral require with an escaped identifier",
      mutate: async (root: string) => {
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(
          path,
          `${await readFile(path, "utf8")}\n` +
            'const dynamicDependency = "zod"\n' +
            'requ\\u0069re(dynamicDependency)\n',
        )
      },
    },
    {
      label: "aliased require loader reference",
      mutate: async (root: string) => {
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(
          path,
          `${await readFile(path, "utf8")}\n` +
            'const admissionRequire = require\n' +
            'admissionRequire("zod")\n',
        )
      },
    },
    {
      label: "node module createRequire loader reference",
      mutate: async (root: string) => {
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(
          path,
          `${await readFile(path, "utf8")}\n` +
            'import { createRequire } from "node:module"\n' +
            'createRequire(import.meta.url)("zod")\n',
        )
      },
    },
    {
      label: "dynamically recovered require loader reference",
      mutate: async (root: string) => {
        const runtimePath = "src/admission-bootstrap/runtime-dynamic-loader.ts"
        await addAdmissionRuntimeSources(root, [runtimePath])
        await mutateTextFile(
          root,
          runtimePath,
          (source) => `${source}\nconst load = eval("require")\nload("zod")\n`,
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [runtimePath])
        })
      },
    },
    {
      label: "declared runtime source recovers loader through parenthesized eval",
      mutate: async (root: string) => {
        const runtimePath = "src/admission-bootstrap/runtime-recovered-loader.ts"
        await addAdmissionRuntimeSources(root, [runtimePath])
        await mutateTextFile(
          root,
          runtimePath,
          (source) => `${source}\nconst load = (eval)("require")\nload("zod")\n`,
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [runtimePath])
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "declared runtime source recovers loader through parenthesized require argument",
      mutate: async (root: string) => {
        const runtimePath = "src/admission-bootstrap/runtime-parenthesized-require.ts"
        await addAdmissionRuntimeSources(root, [runtimePath])
        await mutateTextFile(
          root,
          runtimePath,
          (source) => `${source}\nconst load = eval(("require"))\nload("zod")\n`,
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [runtimePath])
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "declared runtime source recovers loader through type-wrapped require argument",
      mutate: async (root: string) => {
        const runtimePath = "src/admission-bootstrap/runtime-type-wrapped-require.ts"
        await addAdmissionRuntimeSources(root, [runtimePath])
        await mutateTextFile(
          root,
          runtimePath,
          (source) => `${source}\nconst load = eval("require" as string)\nload("zod")\n`,
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [runtimePath])
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "declared runtime source recovers loader through indirect eval",
      mutate: async (root: string) => {
        const runtimePath = "src/admission-bootstrap/runtime-indirect-eval-require.ts"
        await addAdmissionRuntimeSources(root, [runtimePath])
        await mutateTextFile(
          root,
          runtimePath,
          (source) => `${source}\nconst load = (0, eval)("require")\nload("zod")\n`,
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [runtimePath])
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "declared runtime source recovers loader through optional eval",
      mutate: async (root: string) => {
        const runtimePath = "src/admission-bootstrap/runtime-optional-eval-require.ts"
        await addAdmissionRuntimeSources(root, [runtimePath])
        await mutateTextFile(
          root,
          runtimePath,
          (source) => `${source}\nconst load = eval?.("require")\nload?.("zod")\n`,
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [runtimePath])
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "declared runtime source uses unqualified global eval",
      mutate: async (root: string) => {
        const runtimePath = "src/admission-bootstrap/runtime-global-eval.ts"
        await addAdmissionRuntimeSources(root, [runtimePath])
        await mutateTextFile(
          root,
          runtimePath,
          (source) => `${source}\nconst computed = eval("1 + 1")\nvoid computed\n`,
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [runtimePath])
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "declared runtime source recovers loader through template eval",
      mutate: async (root: string) => {
        const runtimePath = "src/admission-bootstrap/runtime-template-eval-require.ts"
        await addAdmissionRuntimeSources(root, [runtimePath])
        await mutateTextFile(
          root,
          runtimePath,
          (source) => `${source}\nconst load = eval(\`require\`)\nload("zod")\n`,
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [runtimePath])
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "declared runtime source recovers loader through concatenated eval",
      mutate: async (root: string) => {
        const runtimePath = "src/admission-bootstrap/runtime-concatenated-eval-require.ts"
        await addAdmissionRuntimeSources(root, [runtimePath])
        await mutateTextFile(
          root,
          runtimePath,
          (source) => `${source}\nconst load = eval("requ" + "ire")\nload("zod")\n`,
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [runtimePath])
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "declared runtime source captures the global eval value",
      mutate: async (root: string) => {
        const runtimePath = "src/admission-bootstrap/runtime-aliased-global-eval.ts"
        await addAdmissionRuntimeSources(root, [runtimePath])
        await mutateTextFile(
          root,
          runtimePath,
          (source) => `${source}\nconst run = eval\nrun('import("zod")')\n`,
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [runtimePath])
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "declared runtime source invokes global eval through call",
      mutate: async (root: string) => {
        const runtimePath = "src/admission-bootstrap/runtime-global-eval-call.ts"
        await addAdmissionRuntimeSources(root, [runtimePath])
        await mutateTextFile(
          root,
          runtimePath,
          (source) => `${source}\neval.call(undefined, 'import("zod")')\n`,
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [runtimePath])
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "declared runtime source captures globalThis eval",
      mutate: async (root: string) => {
        const runtimePath = "src/admission-bootstrap/runtime-global-this-eval.ts"
        await addAdmissionRuntimeSources(root, [runtimePath])
        await mutateTextFile(
          root,
          runtimePath,
          (source) => `${source}\nconst run = globalThis["eval"]\nrun('import("zod")')\n`,
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [runtimePath])
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "declared runtime source destructures eval from globalThis",
      mutate: async (root: string) => {
        const runtimePath = "src/admission-bootstrap/runtime-destructured-global-eval.ts"
        await addAdmissionRuntimeSources(root, [runtimePath])
        await mutateTextFile(
          root,
          runtimePath,
          (source) => `${source}\nconst { eval: run } = globalThis\nrun('import("zod")')\n`,
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [runtimePath])
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "declared runtime source aliases globalThis before eval access",
      mutate: async (root: string) => {
        const runtimePath = "src/admission-bootstrap/runtime-aliased-global-this.ts"
        await addAdmissionRuntimeSources(root, [runtimePath])
        await mutateTextFile(
          root,
          runtimePath,
          (source) => `${source}\nconst globals = globalThis\nglobals.eval('import("zod")')\n`,
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [runtimePath])
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "declared runtime source destructures computed eval from globalThis",
      mutate: async (root: string) => {
        const runtimePath = "src/admission-bootstrap/runtime-computed-destructured-eval.ts"
        await addAdmissionRuntimeSources(root, [runtimePath])
        await mutateTextFile(
          root,
          runtimePath,
          (source) => `${source}\nconst { ["eval"]: run } = globalThis\nrun('import("zod")')\n`,
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [runtimePath])
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "declared runtime source computes eval property on globalThis",
      mutate: async (root: string) => {
        const runtimePath = "src/admission-bootstrap/runtime-dynamic-global-eval.ts"
        await addAdmissionRuntimeSources(root, [runtimePath])
        await mutateTextFile(
          root,
          runtimePath,
          (source) => `${source}\nconst property = "eval"\nglobalThis[property]('import("zod")')\n`,
        )
        await mutateContract(root, (contract) => {
          extendAdmissionRuntimeSourcePaths(contract, [runtimePath])
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.source_closure",
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "computed nonliteral require between divisions after keyword-named property",
      mutate: async (root: string) => {
        const path = join(root, "src/admission-bootstrap/interface.ts")
        await writeFile(
          path,
          `${await readFile(path, "utf8")}\n` +
            'const keywordLookalike = { return: 1 }\n' +
            'const dynamicDependency = "zod"\n' +
            'keywordLookalike.return / require(dynamicDependency) / 2\n',
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
      label: "Admission projection export conditions are missing",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          delete contract.admission.projection.exports["./admission-bootstrap"].default
        })
        await mutateJsonFile(
          root,
          "clean-fixture/personal-verification-profile/contract-tests/fixtures/admission-package-projection.json",
          (projection) => {
            delete projection.exports["./admission-bootstrap"].default
          },
        )
      },
      expectedFinding: {
        kind: "unknown-contract-key",
        owner: 'admission.projection.exports["./admission-bootstrap"].default',
        repair_id: "restore-current-declaration",
      },
      expectedCode: "contract-invalid",
      expectedExitCode: 2,
    },
    {
      label: "Admission projection export conditions are reordered",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          const entry = contract.admission.projection.exports["./admission-bootstrap"]
          contract.admission.projection.exports["./admission-bootstrap"] = {
            default: entry.default,
            types: entry.types,
            import: entry.import,
          }
        })
        await mutateJsonFile(
          root,
          "clean-fixture/personal-verification-profile/contract-tests/fixtures/admission-package-projection.json",
          (projection) => {
            const entry = projection.exports["./admission-bootstrap"]
            projection.exports["./admission-bootstrap"] = {
              default: entry.default,
              types: entry.types,
              import: entry.import,
            }
          },
        )
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: 'admission.projection.exports["./admission-bootstrap"]',
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "Admission projection export conditions have an additional key",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          contract.admission.projection.exports["./admission-bootstrap"].development =
            "./src/admission-bootstrap/implementation/admission-bootstrap.ts"
        })
      },
      expectedFinding: {
        kind: "unknown-contract-key",
        owner: 'admission.projection.exports["./admission-bootstrap"].development',
        repair_id: "restore-current-declaration",
      },
      expectedCode: "contract-invalid",
      expectedExitCode: 2,
    },
    {
      label: "Admission projection runtime targets are unequal",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          contract.admission.projection.exports["./admission-bootstrap"].default =
            "./src/admission-bootstrap/interface.ts"
        })
        await mutateJsonFile(
          root,
          "clean-fixture/personal-verification-profile/contract-tests/fixtures/admission-package-projection.json",
          (projection) => {
            projection.exports["./admission-bootstrap"].default =
              "./src/admission-bootstrap/interface.ts"
          },
        )
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: 'admission.projection.exports["./admission-bootstrap"]',
        repair_id: "restore-repository-bytes",
      },
    },
    {
      label: "Admission projection export target escapes the repository",
      mutate: async (root: string) => {
        await mutateContract(root, (contract) => {
          contract.admission.projection.exports["./admission-bootstrap"].import = "../outside.ts"
        })
        await mutateJsonFile(
          root,
          "clean-fixture/personal-verification-profile/contract-tests/fixtures/admission-package-projection.json",
          (projection) => {
            projection.exports["./admission-bootstrap"].import = "../outside.ts"
          },
        )
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: 'admission.projection.exports["./admission-bootstrap"]',
        repair_id: "restore-repository-bytes",
      },
    },
  ] as const

  const localRuntimeSource = `
import "node:fs"
import type { ReleaseIdentity } from "../modules/release-and-git-engine/interface"
type RuntimeIdentity = ReleaseIdentity
const local = { eval: (value: string) => value }
local . eval("require")
local /* comment */ . eval("require")
const localGlobal = { globalThis: local }
localGlobal /* comment */ . globalThis . eval("require")
`
  expect(staticModuleSpecifiers("runtime.ts", localRuntimeSource)).toEqual([
    "node:fs",
    "../modules/release-and-git-engine/interface",
  ])

  await Promise.all(cases.map(async (row) => {
    const root = await copyRepositoryFixture()
    await row.mutate(root)
    const finding = "expectedFinding" in row
      ? row.expectedFinding
      : {
          kind: "admission-closure-drift",
          owner: "admission.source_closure",
          repair_id: "restore-repository-bytes",
        }
    const code = "expectedCode" in row ? row.expectedCode : "repository-unqualified"
    const exitCode = "expectedExitCode" in row ? row.expectedExitCode : 1
    const expected = {
      schema_version: 1,
      command: "verify:repository-qualification",
      status: "refused",
      mode: "complete",
      code,
      findings: [finding],
    } as const
    const observation = await observeVerifier(root)
    expect(observation.exitCode, row.label).toBe(exitCode)
    expect(observation.stdout, row.label).toBe("")
    expect(observation.stderr, row.label).toBe(`${JSON.stringify(expected)}\n`)
    expect(JSON.parse(observation.stderr), row.label).toEqual(expected)
  }))

  const lookalikes = `
/*
/// <reference types="not-a-block-comment-dependency" />
import type { NotACommentDependency } from "not-a-comment-dependency"
eval("require")
*/
type NotAStringDependency = 'export type * from "not-a-string-dependency"'
type NotATemplateDependency = \`import { type NotATemplateDependency } from "not-a-template-dependency"\`
type NotAEvalString = 'eval("require")'
type NotAEvalTemplate = \`eval("require")\`
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

  const expected = await buildIndependentSuccessReceipt(root)
  const observation = await observeVerifier(root)
  expect(observation.exitCode, observation.stderr).toBe(0)
  expect(observation.stderr).toBe("")
  expect(observation.stdout).toBe(`${JSON.stringify(expected)}\n`)
  expect(JSON.parse(observation.stdout)).toEqual(expected)

  const divisionPrefix = "const value = 10 "
  const probe = `/__agent_plugin_kit_regex_probe_${divisionPrefix.length}__/`
  const collidingProbeSource = `${divisionPrefix}/ requ\\u0069re(dynamicDependency) / 2\n` +
    `const probeCollision = ${JSON.stringify(probe)}\n`
  expect(
    () => staticModuleSpecifiers("colliding-regex-probe.ts", collidingProbeSource),
    "the inserted slash probe must be classified independently from matching source text",
  ).toThrow(NonliteralModuleSpecifierError)
}, 15_000)

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
}, 15_000)

test("root check, ten exports, exact Zod agreement, or Owner Manifest locality drift is refused", async () => {
  expect(isDescendantRelativePath(resolve(tmpdir(), "cross-volume-target.ts"))).toBeFalse()

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
      label: "Admission root export condition is missing",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        delete packageJson.exports["./admission-bootstrap"].default
      }),
      expectedOwner: "package_contract.exports",
    },
    {
      label: "Admission root export conditions are reordered",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        const entry = packageJson.exports["./admission-bootstrap"]
        packageJson.exports["./admission-bootstrap"] = {
          default: entry.default,
          types: entry.types,
          import: entry.import,
        }
      }),
      expectedOwner: "package_contract.exports",
    },
    {
      label: "Admission root export has an additional condition",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.exports["./admission-bootstrap"].development =
          "./src/admission-bootstrap/implementation/admission-bootstrap.ts"
      }),
      expectedOwner: "package_contract.exports",
    },
    {
      label: "Admission root export runtime targets are unequal",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.exports["./admission-bootstrap"].default =
          "./src/admission-bootstrap/interface.ts"
      }),
      expectedOwner: "package_contract.exports",
    },
    {
      label: "Admission root export target escapes the repository",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.exports["./admission-bootstrap"].import = "../outside.ts"
      }),
      expectedOwner: "package_contract.exports",
    },
    {
      label: "Admission root declaration target drifts",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.exports["./admission-bootstrap"].types = "./src/interface.ts"
      }),
      expectedOwner: "package_contract.exports",
    },
    {
      label: "Admission deep Implementation export key is added",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/admission-bootstrap/implementation/admission-bootstrap.ts",
        (source) => `${source}\nexport const hiddenImplementation = 1\n`,
      ),
      expectedOwner: 'package_contract.runtime_output_sha256["./admission-bootstrap"]',
    },
    {
      label: "public type catalog and package exports disagree",
      mutate: (root: string) => mutateContract(root, (contract) => {
        delete contract.package_contract.type_exports["./runtime-custody"]
      }),
      expectedOwner: "package_contract.type_exports",
    },
    {
      label: "public runtime catalog and package exports disagree",
      mutate: (root: string) => mutateContract(root, (contract) => {
        delete contract.package_contract.runtime_output_sha256["./runtime-custody"]
      }),
      expectedOwner: "package_contract.runtime_output_sha256",
    },
    {
      label: "root Interface runtime export added",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/interface.ts",
        (source) => `${source}\nexport const hiddenRuntime = 1\n`,
      ),
      expectedOwner: 'package_contract.runtime_output_sha256["."]',
    },
    {
      label: "root Interface declared function added",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/interface.ts",
        (source) => `${source}\nexport declare function HiddenPublicValue(): void\n`,
      ),
      expectedOwner: 'package_contract.runtime_output_sha256["."]',
    },
    {
      label: "root Interface declared const added",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/interface.ts",
        (source) => `${source}\nexport declare const HiddenPublicValue: string\n`,
      ),
      expectedOwner: 'package_contract.runtime_output_sha256["."]',
    },
    {
      label: "root Interface same-line public type added",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/interface.ts",
        (source) => `${source.trimEnd()}; export type HiddenPublicType = string\n`,
      ),
      expectedOwner: 'package_contract.type_exports["."]',
    },
    {
      label: "root Interface same-line declared const added",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/interface.ts",
        (source) => `${source.trimEnd()}; export declare const HiddenPublicValue: string\n`,
      ),
      expectedOwner: 'package_contract.runtime_output_sha256["."]',
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
      label: "public subpath runtime value added",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\nexport const HiddenRuntimeSurface = 1\n`,
      ),
      expectedOwner: 'package_contract.runtime_output_sha256["./runtime-custody"]',
    },
    {
      label: "public subpath declared value added",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\nexport declare const HiddenRuntimeSurface: string\n`,
      ),
      expectedOwner: 'package_contract.runtime_output_sha256["./runtime-custody"]',
    },
    {
      label: "public subpath ambient global value added",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\ndeclare global { const HiddenRuntimeSurface: string }\n`,
      ),
      expectedOwner: 'package_contract.runtime_output_sha256["./runtime-custody"]',
    },
    {
      label: "public subpath ambient module value added",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\ndeclare module "agent-plugin-kit/runtime-custody" { const HiddenRuntimeSurface: string }\n`,
      ),
      expectedOwner: 'package_contract.runtime_output_sha256["./runtime-custody"]',
    },
    {
      label: "public named value re-export keeps a stale runtime digest",
      mutate: (root: string) => addRuntimeCustodyValueReexport(
        root,
        "export const runtimeCustodyValue = {}\n",
        "./implementation/runtime-custody",
        emptyRuntimeOutputSha256,
      ),
      expectedOwner: 'package_contract.runtime_output_sha256["./runtime-custody"]',
    },
    {
      label: "public class re-export remains type-catalog drift",
      mutate: (root: string) => addRuntimeCustodyValueReexport(
        root,
        "export class runtimeCustodyValue {}\n",
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public enum re-export remains type-catalog drift",
      mutate: (root: string) => addRuntimeCustodyValueReexport(
        root,
        "export enum runtimeCustodyValue { fixture }\n",
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public cross-owner const re-export remains type-catalog drift",
      mutate: addCrossOwnerValueReexport,
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public dual-space target re-export remains type-catalog drift",
      mutate: (root: string) => addRuntimeCustodyValueReexport(
        root,
        "export const runtimeCustodyValue = {}\nexport interface runtimeCustodyValue {}\n",
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public dollar-suffixed const target remains type-catalog drift",
      mutate: (root: string) => addRuntimeCustodyValueReexport(
        root,
        "export const runtimeCustodyValue$other = {}\n",
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public declaration-only const target remains type-catalog drift",
      mutate: (root: string) => addRuntimeCustodyValueReexport(
        root,
        "export const runtimeCustodyValue: unknown\n",
        "./implementation/runtime-custody.d.ts",
        runtimeCustodyDeclarationReexportSha256,
        "runtime-custody.d.ts",
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public string-lookalike const target remains type-catalog drift",
      mutate: (root: string) => addRuntimeCustodyValueReexport(
        root,
        'export const marker = "export const runtimeCustodyValue = fixture"\n',
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public initialized declaration-file target remains type-catalog drift",
      mutate: (root: string) => addRuntimeCustodyValueReexport(
        root,
        "export const runtimeCustodyValue = {}\n",
        "./implementation/runtime-custody.d.ts",
        runtimeCustodyDeclarationReexportSha256,
        "runtime-custody.d.ts",
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public initialized MTS declaration-file target remains type-catalog drift",
      mutate: (root: string) => addRuntimeCustodyValueReexport(
        root,
        "export const runtimeCustodyValue = {}\n",
        "./implementation/runtime-custody.d.mts",
        runtimeCustodyMtsDeclarationReexportSha256,
        "runtime-custody.d.mts",
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public initialized CTS declaration-file target remains type-catalog drift",
      mutate: (root: string) => addRuntimeCustodyValueReexport(
        root,
        "export const runtimeCustodyValue = {}\n",
        "./implementation/runtime-custody.d.cts",
        runtimeCustodyCtsDeclarationReexportSha256,
        "runtime-custody.d.cts",
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public untranspilable const target remains type-catalog drift",
      mutate: (root: string) => addRuntimeCustodyValueReexport(
        root,
        "export const runtimeCustodyValue =",
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public escaped-suffix const target remains type-catalog drift",
      mutate: (root: string) => addRuntimeCustodyValueReexport(
        root,
        "export const runtimeCustodyValue\\u0024other = {}\n",
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public Unicode-suffixed const target remains type-catalog drift",
      mutate: (root: string) => addRuntimeCustodyValueReexport(
        root,
        "export const runtimeCustodyValueÅ = {}\n",
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public escaped dual-space target re-export remains type-catalog drift",
      mutate: (root: string) => addRuntimeCustodyValueReexport(
        root,
        "export const runtimeCustodyValue = {}\nexport interface \\u0072untimeCustodyValue {}\n",
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public string-literal type target re-export remains type-catalog drift",
      mutate: (root: string) => addRuntimeCustodyValueReexport(
        root,
        "export const runtimeCustodyValue = {}\ntype ShadowRuntimeCustody = never\nexport type { ShadowRuntimeCustody as \"runtimeCustodyValue\" }\n",
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public symlinked owner escape remains type-catalog drift",
      mutate: addSymlinkedOwnerEscapeReexport,
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public escaped module-literal target remains type-catalog drift",
      mutate: addEscapedModuleLiteralValueReexport,
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public dot-prefixed external-looking target remains type-catalog drift",
      mutate: (root: string) => addRuntimeCustodyValueReexport(
        root,
        "export const runtimeCustodyValue = {}\n",
        ".x/../implementation/runtime-custody",
        runtimeCustodyDotPrefixedReexportSha256,
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public interface with an escaped identifier",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\nexport interface \\u0048iddenPublicType {}\n`,
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public interface with an escape after a non-ASCII identifier character",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\nexport interface Å\\u0062 {}\n`,
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "public interface with a non-ASCII identifier",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\nexport interface Å {}\n`,
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
      label: "nested type export cannot replace a top-level public type",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source.replace(
          "export type RuntimeCustodyResult =",
          "type RuntimeCustodyResult =",
        )}\nnamespace Internal {\n  export type RuntimeCustodyResult = never\n}\n`,
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "regex text after type declaration replaces top-level export",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => source.replace(
          "export type RuntimeCustodyResult =",
          'type Internal = string\n/export type RuntimeCustodyResult = never/.test("")\ntype RemovedRuntimeCustodyResult =',
        ),
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "property named export cannot replace a following private type declaration",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => source.replace(
          "export type RuntimeCustodyResult =",
          "declare const publicLookalike: { export: unknown }\n" +
            "type Prior = typeof publicLookalike.export\n" +
            "type RuntimeCustodyResult =",
        ),
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "declared public interface added",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\nexport declare interface HiddenPublicType {}\n`,
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "declared public type added",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\nexport declare type HiddenPublicType = string\n`,
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
      label: "tab-separated named type re-export added",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\nexport { type\tRuntimeCustodyResult as TabSeparatedRuntimeResult }\n`,
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "newline-separated named type re-export added",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\nexport { type\nRuntimeCustodyResult as NewlineSeparatedRuntimeResult }\n`,
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
      label: "unsupported default class declaration fails closed",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\nexport default class HiddenPublicType {}\n`,
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "indented default class declaration fails closed",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\n  export default class HiddenPublicType {}\n`,
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "named class declaration fails closed",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\n  export class HiddenPublicType {}\n`,
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "decorated named class declaration fails closed",
      mutate: (root: string) => mutateTextFile(
        root,
        "src/modules/runtime-custody/interface.ts",
        (source) => `${source}\n@sealed export class HiddenPublicType {}\n`,
      ),
      expectedOwner: 'package_contract.type_exports["./runtime-custody"]',
    },
    {
      label: "Zod dev dependency duplication",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.devDependencies.zod = "4.0.0"
      }),
      expectedOwner: "package_contract.dev_dependencies",
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
      label: "root production dependency drift",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.dependencies = { "undeclared-root-dependency": "1.0.0" }
      }),
      expectedOwner: "package_contract.dependencies",
    },
    {
      label: "root production dependency range",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.dependencies = { "undeclared-root-dependency": "^1.0.0" }
      }),
      expectedOwner: "package_contract.dependencies",
    },
    {
      label: "root production dependency alias",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.dependencies = { "undeclared-root-dependency": "npm:zod@4.4.3" }
      }),
      expectedOwner: "package_contract.dependencies",
    },
    {
      label: "root production dependency protocol",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.dependencies = { "undeclared-root-dependency": "workspace:*" }
      }),
      expectedOwner: "package_contract.dependencies",
    },
    {
      label: "root production dependency empty version",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.dependencies = { "undeclared-root-dependency": "" }
      }),
      expectedOwner: "package_contract.dependencies",
    },
    {
      label: "root production dependency non-string version",
      mutate: (root: string) => mutateJsonFile(root, "package.json", (packageJson) => {
        packageJson.dependencies = { "undeclared-root-dependency": 1 }
      }),
      expectedOwner: "package_contract.dependencies",
    },
    {
      label: "root production dependency has no owner",
      mutate: async (root: string) => {
        await mutateJsonFile(root, "package.json", (packageJson) => {
          packageJson.dependencies = { "unowned-dependency": "1.0.0" }
        })
        await mutateContract(root, (contract) => {
          contract.package_contract.dependencies = { "unowned-dependency": "1.0.0" }
        })
      },
      expectedOwner: 'package_contract.dependencies["unowned-dependency"]',
    },
    {
      label: "root and owner production dependency versions disagree",
      mutate: async (root: string) => {
        await mutateJsonFile(root, "package.json", (packageJson) => {
          packageJson.dependencies = { zod: "4.4.3" }
        })
        await mutateJsonFile(
          root,
          "src/modules/qualification-evidence/package.json",
          (packageJson) => {
            packageJson.dependencies = { zod: "4.4.2" }
          },
        )
        await mutateContract(root, (contract) => {
          contract.package_contract.dependencies = { zod: "4.4.3" }
          contract.package_contract.forbidden_dependency_names =
            contract.package_contract.forbidden_dependency_names.filter((name: string) => name !== "zod")
          contract.owner_manifests.qualification_evidence.dependencies = { zod: "4.4.2" }
        })
      },
      expectedOwner: 'owner_manifests.qualification_evidence.dependencies["zod"]',
    },
    {
      label: "root-mirrored production dependency is missing from root",
      mutate: async (root: string) => {
        await mutateJsonFile(root, "package.json", (packageJson) => {
          delete packageJson.dependencies
        })
        await mutateContract(root, (contract) => {
          contract.package_contract.dependencies = {}
          contract.package_contract.root_mirrored_dependencies = ["zod"]
        })
      },
      expectedOwner: 'package_contract.root_mirrored_dependencies["zod"]',
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
      label: "owner production dependency range",
      mutate: (root: string) => mutateJsonFile(
        root,
        "src/modules/runtime-custody/package.json",
        (packageJson) => {
          packageJson.dependencies = { "undeclared-owner-dependency": "~1.0.0" }
        },
      ),
      expectedOwner: "owner_manifests.runtime_custody",
    },
    {
      label: "owner production dependency non-string version",
      mutate: (root: string) => mutateJsonFile(
        root,
        "src/modules/runtime-custody/package.json",
        (packageJson) => {
          packageJson.dependencies = { "undeclared-owner-dependency": 1 }
        },
      ),
      expectedOwner: "owner_manifests.runtime_custody",
    },
    {
      label: "shared owner-only dependency versions disagree",
      mutate: async (root: string) => {
        await mutateJsonFile(
          root,
          "src/adapters/maintenance-command-facade/package.json",
          (packageJson) => {
            packageJson.dependencies = { "@logtape/logtape": "2.3.1" }
          },
        )
        await mutateJsonFile(root, "src/modules/runtime-custody/package.json", (packageJson) => {
          packageJson.dependencies = { "@logtape/logtape": "2.3.0" }
        })
        await mutateContract(root, (contract) => {
          contract.package_contract.forbidden_dependency_names =
            contract.package_contract.forbidden_dependency_names.filter(
              (name: string) => name !== "@logtape/logtape",
            )
          contract.owner_manifests.maintenance_facade.dependencies = {
            "@logtape/logtape": "2.3.1",
          }
          contract.owner_manifests.runtime_custody.dependencies = {
            "@logtape/logtape": "2.3.0",
          }
        })
      },
      expectedOwner: 'owner_manifests.maintenance_facade.dependencies["@logtape/logtape"]',
    },
    {
      label: "Admission production dependency",
      mutate: async (root: string) => {
        await mutateJsonFile(root, "src/admission-bootstrap/package.json", (packageJson) => {
          packageJson.dependencies = { "admission-dependency": "1.0.0" }
        })
        await mutateContract(root, (contract) => {
          contract.owner_manifests.admission.dependencies = { "admission-dependency": "1.0.0" }
        })
      },
      expectedFinding: {
        kind: "admission-closure-drift",
        owner: "admission.owner_manifest",
        repair_id: "restore-repository-bytes",
      },
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

  const sharedZodRoot = await copyRepositoryFixture()
  await mutateJsonFile(sharedZodRoot, "package.json", (packageJson) => {
    packageJson.dependencies = { zod: "4.4.3" }
  })
  for (const path of [
    "src/modules/qualification-evidence/package.json",
    "src/modules/maintenance-command-contract/package.json",
  ]) {
    await mutateJsonFile(sharedZodRoot, path, (packageJson) => {
      packageJson.dependencies = { zod: "4.4.3" }
    })
  }
  await mutateContract(sharedZodRoot, (contract) => {
    contract.package_contract.dependencies = { zod: "4.4.3" }
    contract.package_contract.root_mirrored_dependencies = ["zod"]
    contract.package_contract.forbidden_dependency_names =
      contract.package_contract.forbidden_dependency_names.filter((name: string) => name !== "zod")
    contract.owner_manifests.qualification_evidence.dependencies = { zod: "4.4.3" }
    contract.owner_manifests.maintenance_command_contract.dependencies = { zod: "4.4.3" }
  })
  const positiveStructureExpected = {
    schema_version: 1,
    command: "verify:repository-qualification",
    status: "qualified",
    mode: "structure-only",
    contract: "tooling/repository-quality/repository-qualification-contract.json",
    groups: [],
    aggregate: null,
  } as const
  const sharedZodObservation = await observeVerifier(sharedZodRoot, ["--structure-only"])
  expect(sharedZodObservation.exitCode, sharedZodObservation.stderr).toBe(0)
  expect(sharedZodObservation.stderr).toBe("")
  expect(sharedZodObservation.stdout).toBe(`${JSON.stringify(positiveStructureExpected)}\n`)
  expect(JSON.parse(sharedZodObservation.stdout)).toEqual(positiveStructureExpected)

  const ownerOnlyLogTapeRoot = await copyRepositoryFixture()
  await mutateJsonFile(
    ownerOnlyLogTapeRoot,
    "src/adapters/maintenance-command-facade/package.json",
    (packageJson) => {
      packageJson.dependencies = { "@logtape/logtape": "2.3.1" }
    },
  )
  await mutateContract(ownerOnlyLogTapeRoot, (contract) => {
    contract.package_contract.forbidden_dependency_names =
      contract.package_contract.forbidden_dependency_names.filter(
        (name: string) => name !== "@logtape/logtape",
      )
    contract.owner_manifests.maintenance_facade.dependencies = {
      "@logtape/logtape": "2.3.1",
    }
  })
  const ownerOnlyLogTapeObservation = await observeVerifier(
    ownerOnlyLogTapeRoot,
    ["--structure-only"],
  )
  expect(ownerOnlyLogTapeObservation.exitCode, ownerOnlyLogTapeObservation.stderr).toBe(0)
  expect(ownerOnlyLogTapeObservation.stderr).toBe("")
  expect(ownerOnlyLogTapeObservation.stdout).toBe(
    `${JSON.stringify(positiveStructureExpected)}\n`,
  )
  expect(JSON.parse(ownerOnlyLogTapeObservation.stdout)).toEqual(positiveStructureExpected)

  const digitLeadingPrereleaseRoot = await copyRepositoryFixture()
  await mutateJsonFile(
    digitLeadingPrereleaseRoot,
    "src/modules/runtime-custody/package.json",
    (packageJson) => {
      packageJson.dependencies = { "valid-prerelease-dependency": "1.2.3-1alpha" }
    },
  )
  await mutateContract(digitLeadingPrereleaseRoot, (contract) => {
    contract.owner_manifests.runtime_custody.dependencies = {
      "valid-prerelease-dependency": "1.2.3-1alpha",
    }
  })
  const digitLeadingPrereleaseObservation = await observeVerifier(
    digitLeadingPrereleaseRoot,
    ["--structure-only"],
  )
  expect(
    digitLeadingPrereleaseObservation.exitCode,
    digitLeadingPrereleaseObservation.stderr,
  ).toBe(0)
  expect(digitLeadingPrereleaseObservation.stderr).toBe("")
  expect(digitLeadingPrereleaseObservation.stdout).toBe(
    `${JSON.stringify(positiveStructureExpected)}\n`,
  )
  expect(JSON.parse(digitLeadingPrereleaseObservation.stdout)).toEqual(
    positiveStructureExpected,
  )

  const lexicalRoot = await copyRepositoryFixture()
  await mutateTextFile(
    lexicalRoot,
    "src/modules/runtime-custody/interface.ts",
    (source) => `${source}
/* export type CommentOnlyType = never */
/* export interface \\u0048iddenCommentType {} */
type ValueOnlyMarker = "value-only"
type RuntimeCustodyResultValue = undefined
type AtMarker = "@"
type EscapedTypeString = "export interface \\u0048iddenStringType {}"
type EscapedTypeTemplate = \`export interface \\u0048iddenTemplateType {}\`
`,
  )
  const lexicalExpected = await buildIndependentSuccessReceipt(lexicalRoot)
  const lexicalObservation = await observeVerifier(lexicalRoot)
  expect(lexicalObservation.exitCode, lexicalObservation.stderr).toBe(0)
  expect(lexicalObservation.stderr).toBe("")
  expect(lexicalObservation.stdout).toBe(`${JSON.stringify(lexicalExpected)}\n`)
  expect(JSON.parse(lexicalObservation.stdout)).toEqual(lexicalExpected)

  const valueReexportRoot = await copyRepositoryFixture()
  await addRuntimeCustodyValueReexport(
    valueReexportRoot,
    "export const runtimeCustodyValue = {}\n",
  )
  const valueReexportExpected = {
    schema_version: 1,
    command: "verify:repository-qualification",
    status: "qualified",
    mode: "structure-only",
    contract: "tooling/repository-quality/repository-qualification-contract.json",
    groups: [],
    aggregate: null,
  } as const
  const valueReexportObservation = await observeVerifier(valueReexportRoot, ["--structure-only"])
  expect(valueReexportObservation.exitCode, valueReexportObservation.stderr).toBe(0)
  expect(valueReexportObservation.stderr).toBe("")
  expect(valueReexportObservation.stdout).toBe(`${JSON.stringify(valueReexportExpected)}\n`)
  expect(JSON.parse(valueReexportObservation.stdout)).toEqual(valueReexportExpected)

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
}, 30_000)

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
      label: "Admission runtime source paths is a scalar",
      owner: "admission.runtime_source_paths",
      mutate: (contract: Record<string, any>) => {
        contract.admission.runtime_source_paths = "src/admission-bootstrap/interface.ts"
      },
    },
    {
      label: "Admission runtime source path is not a string",
      owner: "admission.runtime_source_paths",
      mutate: (contract: Record<string, any>) => {
        contract.admission.runtime_source_paths = [1]
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
    {
      label: "root dependency range is not an exact version",
      owner: 'package_contract.dependencies["zod"]',
      mutate: (contract: Record<string, any>) => {
        contract.package_contract.dependencies = { zod: "^4.4.3" }
      },
    },
    {
      label: "root dependency alias is not an exact version",
      owner: 'package_contract.dependencies["zod"]',
      mutate: (contract: Record<string, any>) => {
        contract.package_contract.dependencies = { zod: "npm:zod@4.4.3" }
      },
    },
    {
      label: "root dependency protocol is not an exact version",
      owner: 'package_contract.dependencies["zod"]',
      mutate: (contract: Record<string, any>) => {
        contract.package_contract.dependencies = { zod: "workspace:*" }
      },
    },
    {
      label: "root dependency empty version is refused",
      owner: 'package_contract.dependencies["zod"]',
      mutate: (contract: Record<string, any>) => {
        contract.package_contract.dependencies = { zod: "" }
      },
    },
    {
      label: "numeric prerelease identifier with a leading zero is refused",
      owner: 'package_contract.dependencies["zod"]',
      mutate: (contract: Record<string, any>) => {
        contract.package_contract.dependencies = { zod: "1.2.3-01" }
      },
    },
    {
      label: "root dependency non-string version is refused",
      owner: "package_contract.dependencies",
      mutate: (contract: Record<string, any>) => {
        contract.package_contract.dependencies = { zod: 4 }
      },
    },
    {
      label: "owner dependency range is not an exact version",
      owner: 'owner_manifests.qualification_evidence.dependencies["zod"]',
      mutate: (contract: Record<string, any>) => {
        contract.owner_manifests.qualification_evidence.dependencies = { zod: "~4.4.3" }
      },
    },
    {
      label: "root-mirrored dependency names are unique",
      owner: "package_contract.root_mirrored_dependencies",
      mutate: (contract: Record<string, any>) => {
        contract.package_contract.root_mirrored_dependencies = ["zod", "zod"]
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
