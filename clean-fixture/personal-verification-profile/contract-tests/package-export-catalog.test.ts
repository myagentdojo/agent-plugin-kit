import { expect, test } from "bun:test"
import packageMetadata from "../../../package.json"
import { installedPackage } from "./adapters/contract-subjects"
import {
  expectedInstalledFiles,
  expectedPublicSubpaths,
  expectedRootTypeExports,
  expectedSubpathTypeExports,
} from "./fixtures/plugin-consumer"

test("the root package exposes exactly the accepted type catalog", () => {
  expect(Object.keys(packageMetadata.exports).sort()).toEqual([...expectedPublicSubpaths].sort())
  expect(installedPackage?.rootTypeExports, "contract-absent: installed root type exports must be independently observed").toEqual(expectedRootTypeExports)
})

test("the Git package exposes exactly nine accepted public subpaths", () => {
  expect(Object.keys(packageMetadata.exports)).toEqual([...expectedPublicSubpaths])
  expect(installedPackage?.publicSubpaths, "contract-absent: installed public subpaths must be importable").toEqual([...expectedPublicSubpaths])
  expect(installedPackage?.subpathTypeExports, "contract-absent: public subpaths must expose exact accepted names").toEqual(expectedSubpathTypeExports)
})

test("Implementation and proof paths remain private in the installed inventory", () => {
  expect(Object.keys(packageMetadata.exports).some((path) => /implementation|contract-tests|fixtures/.test(path))).toBeFalse()
  expect(installedPackage?.regularFiles, "contract-absent: installed bytes must expose only the accepted package inventory").toEqual(expectedInstalledFiles)
})
