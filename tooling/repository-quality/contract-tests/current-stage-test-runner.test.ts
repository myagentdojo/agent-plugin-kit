import { expect, test } from "bun:test"
import { dirname, join, resolve } from "node:path"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import {
	currentStageTestFiles,
	discoverCurrentStageTestFiles,
	forbiddenTestDirectiveIn,
	proveCurrentStageTimeoutCleanup,
	validateCurrentStageDiscovery,
	validateCurrentStageProcess,
	validateCurrentStageSelection,
	validateJunitReport,
	type GuardResult,
} from "../../current-stage-test-runner"

const root = resolve(import.meta.dir, "../../..")
const expectFailure = (result: GuardResult, code: string): void => expect(result).toMatchObject({ ok: false, code })
const junitRows = [
	["clean-fixture/personal-verification-profile/contract-tests/package-export-catalog.test.ts", 3], ["src/admission-bootstrap/contract-tests/admitted-identity-before-execution.test.ts", 2], ["src/admission-bootstrap/contract-tests/identity-refusal.test.ts", 6], ["src/modules/maintenance-command-contract/contract-tests/effect-class-and-retry-safety.test.ts", 9], ["src/modules/maintenance-command-contract/contract-tests/human-and-agent-result-vocabulary.test.ts", 7], ["src/modules/maintenance-command-contract/contract-tests/branch-station-catalog.test.ts", 8], ["src/modules/qualification-evidence/contract-tests/candidate-lineage-reduction.test.ts", 8], ["src/modules/qualification-evidence/contract-tests/proof-layer-and-non-claim.test.ts", 7], ["clean-fixture/personal-verification-profile/contract-tests/admission-and-invocation.test.ts", 3], ["clean-fixture/personal-verification-profile/contract-tests/installation-evidence.test.ts", 3], ["clean-fixture/personal-verification-profile/contract-tests/fresh-native-non-claims.test.ts", 2], ["clean-fixture/public-verification-profile/contract-tests/profile-non-promotion.test.ts", 2], ["clean-fixture/personal-verification-profile/contract-tests/maintenance-cli.test.ts", 5], ["clean-fixture/personal-verification-profile/contract-tests/maintenance-cli-local-link.test.ts", 8], ["src/adapters/maintenance-command-facade/contract-tests/command-surface.test.ts", 12], ["src/adapters/maintenance-command-facade/contract-tests/public-process.test.ts", 11], ["src/adapters/maintenance-command-facade/contract-tests/observability.test.ts", 12],
] as const
const validJunit = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="bun test" tests="108" assertions="0" failures="0" skipped="0" time="0">\n${junitRows.map(([file, count]) => `  <testsuite name="${file}" file="${file}" tests="${count}" assertions="0" failures="0" skipped="0" time="0">${Array.from({ length: count }, (_, index) => `<testcase name="case-${index}" file="${file}" time="0" assertions="0" />`).join("")}</testsuite>`).join("\n")}\n</testsuites>`

test("accepts only the ordered 17-file current-stage selector", () => {
	expect(validateCurrentStageSelection(currentStageTestFiles)).toEqual({ ok: true })
	for (const [files, code] of [[ [...currentStageTestFiles, currentStageTestFiles[0] ?? ""], "selector-duplicate" ], [currentStageTestFiles.slice(0, -1), "selector-missing"], [[...currentStageTestFiles, "unknown.test.ts"], "selector-unexpected"], [[currentStageTestFiles[1] ?? "", currentStageTestFiles[0] ?? "", ...currentStageTestFiles.slice(2)], "selector-order"]] as const) expectFailure(validateCurrentStageSelection(files), code)
})

test("independently discovers the exact eligible product inventory", () => {
	expect(discoverCurrentStageTestFiles(root)).toEqual([...currentStageTestFiles].sort())
	expect(validateCurrentStageDiscovery(root)).toEqual({ ok: true })
	const fixture = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "agent-plugin-kit-current-stage-"))
	try {
		for (const file of currentStageTestFiles) { const path = join(fixture, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, "export {}\n") }
		const omitted = join(fixture, "src/new-owner/contract-tests/omitted.test.ts"); mkdirSync(dirname(omitted), { recursive: true }); writeFileSync(omitted, 'test("omitted")\n')
		expectFailure(validateCurrentStageDiscovery(fixture), "selector-discovery")
	} finally { rmSync(fixture, { recursive: true, force: true }) }
})

test("refuses disabled or focused Bun directives but ignores non-code text", () => {
	for (const source of ["test.skip('x')", "it.todo('x')", "describe.only('x')", "test.concurrent.only('x')", "test.onlyIf(true)('x')", "xit('x')", "xtest('x')", "xdescribe('x')", "`${test.skip('x')}`"]) expect(forbiddenTestDirectiveIn(source)).toBe(true)
	for (const source of ["test('x')", "test.concurrent('x')", "// test.skip('x')", "/* it.only('x') */", "const value = \"describe.todo('x')\"", "const value = `test.skip('x')`"]) expect(forbiddenTestDirectiveIn(source)).toBe(false)
})

test("accepts literal Bun JUnit and refuses malformed, incomplete, non-green, or drifted documents", () => {
	expect(validateJunitReport(validJunit)).toEqual({ ok: true })
	const first = junitRows[0]?.[0] ?? ""
	for (const [report, code] of [
		[validJunit.replace('tests="108"', 'tests="107"'), "report-count-mismatch"], [validJunit.replace(`file="${first}"`, 'file="unknown.test.ts"'), "report-file-drift"], [validJunit.replace(`name="case-0" file="${first}" time="0" assertions="0" />`, `name="case-0" file="${first}" time="0" assertions="0"><failure /></testcase>`), "report-failed"], [validJunit.replace(`name="case-0" file="${first}" time="0" assertions="0" />`, `name="case-0" file="${first}" time="0" assertions="0"><error>details</error></testcase>`), "report-failed"], [validJunit.replace(`name="case-0" file="${first}" time="0" assertions="0" />`, `name="case-0" file="${first}" time="0" assertions="0"><skipped /></testcase>`), "report-skipped"], [validJunit.replace(`tests="3" assertions="0" failures="0"`, `tests="2" assertions="0" failures="0"`), "report-count-mismatch"], [`junk${validJunit}`, "report-malformed"], [`${validJunit}junk`, "report-malformed"], [validJunit.replace("</testsuites>", "<unknown /></testsuites>"), "report-malformed"], [validJunit.replace("</testsuite>", ""), "report-malformed"], [validJunit.replace("failures=\"0\"", "failures=\"no\""), "report-malformed"], ["<?xml version=\"1.0\" encoding=\"UTF-8\"?><testsuites tests=\"0\" failures=\"0\" skipped=\"0\"></testsuites>", "report-file-drift"],
	] as const) expectFailure(validateJunitReport(report), code)
})

test("refuses failed or timed-out children and kills a descriptor-retaining process group", async () => {
	expectFailure(validateCurrentStageProcess({ exitCode: 1, signalCode: null, report: validJunit }), "test-process-failed")
	expectFailure(validateCurrentStageProcess({ exitCode: 0, signalCode: "SIGKILL", report: validJunit }), "test-process-timeout")
	const proof = await proveCurrentStageTimeoutCleanup()
	expect(proof).toMatchObject({ timedOut: true, childSettled: true, childTerminated: true, descendantTerminated: true, streamsSettled: true, temporaryStateCleaned: true, signalCode: "SIGKILL" })
})
