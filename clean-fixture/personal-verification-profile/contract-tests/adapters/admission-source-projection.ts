import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, parse, relative, resolve } from "node:path"
import p3RedContract from "../../../p3-red-contract.json"

const repositoryRoot = resolve(import.meta.dir, "../../../../")

function walkFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    const absolute = join(directory, entry.name)
    return entry.isDirectory() ? walkFiles(absolute, relative) : [relative]
  })
}

function ancestorNodeModules(start: string): string[] {
  const found = new Set<string>()
  for (const startPath of new Set([resolve(start), realpathSync(start)])) {
    let current = startPath
    while (true) {
      const candidate = join(current, "node_modules")
      if (existsSync(candidate)) found.add(candidate)
      const parent = dirname(current)
      if (parent === current || current === parse(current).root) break
      current = parent
    }
  }
  return [...found].sort()
}

export type AdmissionSourceObservation = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly copiedClosure: readonly string[]
  readonly consumerSource: string
  readonly ambientNodeModules: readonly string[]
  readonly outsideRepository: boolean
  readonly fixtureRemoved: boolean
}

export function observeAdmissionSourceImport(options?: {
  readonly bareSpecifierPerturbation?: string
}): AdmissionSourceObservation {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "agent-plugin-kit-admission-"))
  let observation: Omit<AdmissionSourceObservation, "fixtureRemoved">

  try {
    const projection = JSON.parse(
      readFileSync(join(repositoryRoot, p3RedContract.admission.projectionFixture), "utf8"),
    ) as typeof p3RedContract.admission.projection
    writeFileSync(join(fixtureRoot, "package.json"), `${JSON.stringify(projection, null, 2)}\n`, {
      mode: 0o600,
    })

    for (const relative of p3RedContract.admission.sourceClosure) {
      const destination = join(fixtureRoot, relative)
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
      copyFileSync(join(repositoryRoot, relative), destination)
    }
    if (options?.bareSpecifierPerturbation !== undefined) {
      const entry = join(fixtureRoot, p3RedContract.admission.sourceEntry)
      writeFileSync(
        entry,
        `${readFileSync(entry, "utf8")}\nimport ${JSON.stringify(options.bareSpecifierPerturbation)}\n`,
      )
    }

    const childPath = join(fixtureRoot, "admission-consumer.ts")
    copyFileSync(join(repositoryRoot, p3RedContract.admission.consumerFixture), childPath)
    const processResult = Bun.spawnSync({
      cmd: ["bun", `--config=${join(repositoryRoot, "bunfig.toml")}`, childPath],
      cwd: fixtureRoot,
      env: { PATH: process.env.PATH },
      stdout: "pipe",
      stderr: "pipe",
    })

    observation = {
      exitCode: processResult.exitCode,
      stdout: processResult.stdout.toString(),
      stderr: processResult.stderr.toString(),
      copiedClosure: walkFiles(join(fixtureRoot, "src")).map((file) => `src/${file}`).sort(),
      consumerSource: readFileSync(childPath, "utf8"),
      ambientNodeModules: ancestorNodeModules(fixtureRoot),
      outsideRepository: relative(repositoryRoot, fixtureRoot).startsWith(".."),
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }

  return { ...observation, fixtureRemoved: !existsSync(fixtureRoot) }
}
