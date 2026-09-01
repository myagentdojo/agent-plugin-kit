import { expect, test } from "bun:test"
import { installedPackage } from "./adapters/contract-subjects"
import { expectedInstalledFiles } from "./fixtures/plugin-consumer"

test("Git installation resolves one complete Full Commit Pin", () => {
  expect(installedPackage.sourceCommit).toMatch(/^[0-9a-f]{40}$/)
  expect(installedPackage.remoteCommit).toBe(installedPackage.sourceCommit)
  expect(installedPackage.resolvedCommit, "contract-absent: the lock must report the temporary Git remote commit").toBe(installedPackage.remoteCommit)
  expect(installedPackage.lockfileSha256).toMatch(/^sha256:[0-9a-f]{64}$/)
})

test("Git installation runs no lifecycle script", () => {
  expect(installedPackage?.lifecycleScriptLedger, "contract-absent: lifecycle execution must be independently observable").toEqual([])
  expect(installedPackage.fixtureEnvironmentKeys).toEqual([
    "FORCE_COLOR",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_NOSYSTEM",
    "GIT_TERMINAL_PROMPT",
    "HOME",
    "LANG",
    "NO_COLOR",
    "PATH",
    "TMPDIR",
    "TZ",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
  ])
  expect(installedPackage.fixtureSensitiveEnvironmentKeys).toEqual([])
  expect(installedPackage.processTimeoutControl).toEqual({
    exitCode: 124,
    timedOut: true,
    descriptorClosure: "closed",
    cleanup: "process-group-killed",
    descendantPidObserved: true,
    descendantTerminated: true,
  })
})

test("installed bytes match the literal package inventory", () => {
  expect(installedPackage?.regularFiles, "contract-absent: installed regular files must match the admitted inventory").toEqual(expectedInstalledFiles)
  expect(installedPackage?.installedBytesSha256).toMatch(/^sha256:[0-9a-f]{64}$/)
  expect(installedPackage.outsideRepository).toBeTrue()
  expect(installedPackage.fixtureRemoved).toBeTrue()
  expect(installedPackage.qualificationInputBindings).toEqual({
    provedInstalledPayloadCells: [{
      id: "cell:personal-payload",
      lineageDigest: installedPackage.installedBytesSha256,
      receiptDigest: installedPackage.installedBytesSha256,
    }],
    hostedLineageCellIds: [],
  })
})
