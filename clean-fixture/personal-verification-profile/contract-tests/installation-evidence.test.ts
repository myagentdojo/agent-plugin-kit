import { expect, test } from "bun:test"
import { installedPackage } from "./adapters/contract-subjects"
import { expectedInstalledFiles, fullCommitPin } from "./fixtures/plugin-consumer"

test("Git installation resolves one complete Full Commit Pin", () => {
  expect(fullCommitPin).toMatch(/^[0-9a-f]{40}$/)
  expect(installedPackage?.resolvedCommit, "contract-absent: Git installation must report its immutable commit").toBe(fullCommitPin)
})

test("Git installation runs no lifecycle script", () => {
  expect(installedPackage?.lifecycleScriptLedger, "contract-absent: lifecycle execution must be independently observable").toEqual([])
})

test("installed bytes match the literal package inventory", () => {
  expect(installedPackage?.regularFiles, "contract-absent: installed regular files must match the admitted inventory").toEqual(expectedInstalledFiles)
  expect(installedPackage?.installedBytesSha256).toMatch(/^sha256:[0-9a-f]{64}$/)
})
