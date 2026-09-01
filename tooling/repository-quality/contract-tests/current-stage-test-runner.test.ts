import { expect, test } from "bun:test"
import {
	currentStageExpectedTestCount,
	currentStageTestCounts,
	currentStageTestFiles,
	forbiddenTestDirectiveIn,
	validateCurrentStageProcess,
	validateCurrentStageSelection,
	validateJunitReport,
	type GuardResult,
} from "../../current-stage-test-runner"

function expectFailure(result: GuardResult, code: string): void {
	expect(result).toMatchObject({ ok: false, code })
}

function validJunitReport(): string {
	const suites = currentStageTestFiles
		.map((file) => {
			const count = currentStageTestCounts[file]
			const cases = Array.from(
				{ length: count },
				(_, index) => `<testcase name="case-${index}" file="${file}" />`,
			).join("")
			return `<testsuite file="${file}" tests="${count}" assertions="0" failures="0" skipped="0">${cases}</testsuite>`
		})
		.join("")
	return `<testsuites tests="${currentStageExpectedTestCount}" assertions="0" failures="0" skipped="0">${suites}</testsuites>`
}

test("accepts the exact current-stage selector and rejects selector drift", () => {
	expect(validateCurrentStageSelection(currentStageTestFiles)).toEqual({ ok: true })
	expectFailure(validateCurrentStageSelection([...currentStageTestFiles, currentStageTestFiles[0]]), "selector-duplicate")
	expectFailure(validateCurrentStageSelection(currentStageTestFiles.slice(0, -1)), "selector-missing")
	expectFailure(validateCurrentStageSelection([...currentStageTestFiles, "unknown.test.ts"]), "selector-unexpected")
	expectFailure(
		validateCurrentStageSelection([
			currentStageTestFiles[1] ?? "",
			currentStageTestFiles[0] ?? "",
			...currentStageTestFiles.slice(2),
		]),
		"selector-order",
	)
})

test("refuses focused or skipped test directives in current-stage sources", () => {
	for (const directive of ["only", "skip", "todo", "onlyIf", "skipIf", "todoIf"]) {
		expect(forbiddenTestDirectiveIn(`test.${directive}("forbidden")`)).toBe(true)
	}
	expect(forbiddenTestDirectiveIn('test("allowed")')).toBe(false)
})

test("accepts the complete JUnit proof and rejects incomplete or malformed reports", () => {
	const report = validJunitReport()
	expect(validateJunitReport(report)).toEqual({ ok: true })
	expectFailure(validateJunitReport(report.replace(`tests="${currentStageExpectedTestCount}"`, 'tests="0"')), "report-count-mismatch")
	const firstSuite = `<testsuite file="${currentStageTestFiles[0]}"`
	expectFailure(validateJunitReport(report.replace(firstSuite, `${firstSuite} skipped="1"`)), "report-skipped")
	expectFailure(validateJunitReport(report.replace('file="clean-fixture/', 'file="unknown-fixture/')), "report-file-drift")
	expectFailure(validateJunitReport("<testsuites>"), "report-malformed")
})

test("fails closed when the test process fails or times out", () => {
	const report = validJunitReport()
	expectFailure(validateCurrentStageProcess({ exitCode: 1, signalCode: null, report }), "test-process-failed")
	expectFailure(validateCurrentStageProcess({ exitCode: 0, signalCode: "SIGKILL", report }), "test-process-timeout")
})
