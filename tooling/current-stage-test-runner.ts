import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"

export const currentStageTestFiles = [
	"clean-fixture/personal-verification-profile/contract-tests/package-export-catalog.test.ts",
	"src/admission-bootstrap/contract-tests/admitted-identity-before-execution.test.ts",
	"src/admission-bootstrap/contract-tests/identity-refusal.test.ts",
	"src/modules/maintenance-command-contract/contract-tests/effect-class-and-retry-safety.test.ts",
	"src/modules/maintenance-command-contract/contract-tests/human-and-agent-result-vocabulary.test.ts",
	"src/modules/maintenance-command-contract/contract-tests/branch-station-catalog.test.ts",
	"src/modules/maintenance-command-contract/contract-tests/wire-command-and-binding.test.ts",
	"src/modules/qualification-evidence/contract-tests/candidate-lineage-reduction.test.ts",
	"src/modules/qualification-evidence/contract-tests/proof-layer-and-non-claim.test.ts",
	"clean-fixture/personal-verification-profile/contract-tests/admission-and-invocation.test.ts",
	"clean-fixture/personal-verification-profile/contract-tests/installation-evidence.test.ts",
	"clean-fixture/personal-verification-profile/contract-tests/fresh-native-non-claims.test.ts",
	"clean-fixture/public-verification-profile/contract-tests/profile-non-promotion.test.ts",
	"clean-fixture/personal-verification-profile/contract-tests/maintenance-cli.test.ts",
	"clean-fixture/personal-verification-profile/contract-tests/maintenance-cli-local-link.test.ts",
	"src/adapters/maintenance-command-facade/contract-tests/command-surface.test.ts",
	"src/adapters/maintenance-command-facade/contract-tests/public-process.test.ts",
	"src/adapters/maintenance-command-facade/contract-tests/observability.test.ts",
	"src/modules/plugin-payload-production/contract-tests/serialized-values.test.ts",
	"src/modules/release-and-git-engine/contract-tests/serialized-values.test.ts",
	"src/modules/harness-journeys/contract-tests/serialized-values.test.ts",
	"src/modules/canary-qualification/contract-tests/serialized-values.test.ts",
	"src/modules/canary-qualification/contract-tests/authority-source.test.ts",
] as const

const expectedTests = [3, 2, 6, 9, 7, 8, 8, 8, 7, 3, 3, 2, 2, 8, 8, 12, 14, 12, 3, 3, 4, 3, 3] as const
const expectedTestsByFile = new Map<string, number>(currentStageTestFiles.map((file, index) => [file, expectedTests[index] ?? 0]))
export const currentStageExpectedTestCount = 138

export type GuardCode =
	| "selector-duplicate" | "selector-missing" | "selector-unexpected" | "selector-order" | "selector-file-missing" | "selector-discovery"
	| "forbidden-test-directive" | "report-malformed" | "report-file-drift" | "report-count-mismatch" | "report-skipped" | "report-failed"
	| "test-process-failed" | "test-process-timeout"
export type GuardResult = Readonly<{ ok: true }> | Readonly<{ ok: false; code: GuardCode; detail: string }>
type Failure = Extract<GuardResult, { ok: false }>
const fail = (code: GuardCode, detail: string): Failure => ({ ok: false, code, detail })
const same = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((value, index) => value === right[index])

function walk(root: string, relative: string, found: string[]): void {
	for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
		const path = join(relative, entry.name)
		if (entry.isDirectory()) walk(root, path, found)
		if (entry.isFile()) {
			const file = path.split(sep).join("/")
			if (/(?:^|\/)contract-tests\/.+\.test\.ts$/u.test(file) && !file.startsWith("tooling/repository-quality/")) found.push(file)
		}
	}
}

export function discoverCurrentStageTestFiles(root: string): readonly string[] {
	const found: string[] = []
	for (const directory of ["src", "clean-fixture", "tooling"]) {
		try { walk(root, directory, found) } catch { return [] }
	}
	return found.sort()
}

export function validateCurrentStageDiscovery(root: string): GuardResult {
	const discovered = discoverCurrentStageTestFiles(root)
	const expected = [...currentStageTestFiles].sort()
	return same(discovered, expected) ? { ok: true } : fail("selector-discovery", `expected=${expected.join(",")} discovered=${discovered.join(",")}`)
}

export function validateCurrentStageSelection(actual: readonly string[]): GuardResult {
	const duplicate = actual.find((file, index) => actual.indexOf(file) !== index)
	if (duplicate !== undefined) return fail("selector-duplicate", duplicate)
	const missing = currentStageTestFiles.find((file) => !actual.includes(file))
	if (missing !== undefined) return fail("selector-missing", missing)
	const unexpected = actual.find((file) => !expectedTestsByFile.has(file))
	if (unexpected !== undefined) return fail("selector-unexpected", unexpected)
	const index = actual.findIndex((file, position) => file !== currentStageTestFiles[position])
	return index === -1 && actual.length === currentStageTestFiles.length ? { ok: true } : fail("selector-order", `index=${index}`)
}

export function validateCurrentStageFiles(root: string, files: readonly string[]): GuardResult {
	for (const file of files) try { if (!statSync(join(root, file)).isFile()) return fail("selector-file-missing", file) } catch { return fail("selector-file-missing", file) }
	return { ok: true }
}

function quotedEnd(source: string, index: number): number {
	const quote = source[index] ?? ""; index += 1
	while (index < source.length && source[index] !== quote) index += source[index] === "\\" ? 2 : 1
	return index + 1
}
function commentEnd(source: string, index: number): number | undefined {
	if (source[index] !== "/") return undefined
	if (source[index + 1] === "/") { const end = source.indexOf("\n", index + 2); return end === -1 ? source.length : end + 1 }
	if (source[index + 1] === "*") { const end = source.indexOf("*/", index + 2); return end === -1 ? source.length : end + 2 }
	return undefined
}
function template(source: string, index: number): readonly [string, number] {
	let output = "", cursor = index + 1
	while (cursor < source.length && source[cursor] !== "`") {
		if (source[cursor] === "\\") { cursor += 2; continue }
		if (source[cursor] === "$" && source[cursor + 1] === "{") { const [expression, end] = scrub(source, cursor + 2, true); output += ` ${expression} `; cursor = end + 1; continue }
		cursor += 1
	}
	return [output, cursor + 1]
}
function ignored(source: string, index: number): readonly [string, number] | undefined {
	const value = source[index] ?? ""
	if (value === "`") return template(source, index)
	if (value === "'" || value === '"') return ["", quotedEnd(source, index)]
	const end = commentEnd(source, index)
	return end === undefined ? undefined : ["", end]
}
function brace(value: string, stopAtBrace: boolean, depth: number): readonly [boolean, number] {
	if (!stopAtBrace || value !== "}") return [false, value === "{" ? depth + 1 : depth]
	return depth === 0 ? [true, depth] : [false, depth - 1]
}
function scrub(source: string, start = 0, stopAtBrace = false): readonly [string, number] {
	let output = "", index = start, depth = 0
	while (index < source.length) {
		const value = source[index] ?? "", [closed, nextDepth] = brace(value, stopAtBrace, depth)
		if (closed) return [output, index]
		depth = nextDepth; const skipped = ignored(source, index)
		if (skipped !== undefined) { output += ` ${skipped[0]} `; index = skipped[1]; continue }
		output += value; index += 1
	}
	return [output, index]
}

export function forbiddenTestDirectiveIn(source: string): boolean {
	const [code] = scrub(source)
	if (/\b(?:xit|xtest|xdescribe)\s*\(/u.test(code)) return true
	for (const match of code.matchAll(/\b(?:test|it|describe)((?:\s*\.\s*[A-Za-z_$][\w$]*)+)\s*\(/gu)) {
		if ((match[1] ?? "").split(".").some((part) => /^(?:only|skip|todo|if|onlyIf|skipIf|todoIf)$/u.test(part.trim()))) return true
	}
	return false
}

export function validateCurrentStageSources(root: string, files: readonly string[]): GuardResult {
	for (const file of files) {
		try { if (forbiddenTestDirectiveIn(readFileSync(join(root, file), "utf8"))) return fail("forbidden-test-directive", file) }
		catch { return fail("selector-file-missing", file) }
	}
	return { ok: true }
}

type Suite = { file: string; tests: number; cases: number; failures: number; errors: number; skipped: number; outcomeFailures: number; outcomeErrors: number; outcomeSkipped: number }
type Document = { tests: number; failures: number; errors: number; skipped: number; suites: Suite[] }
type Tag = { name: string; closing: boolean; selfClosing: boolean; attributes: Record<string, string> }
const allowed = {
	testsuites: ["name", "tests", "assertions", "failures", "errors", "skipped", "time"],
	testsuite: ["name", "file", "tests", "assertions", "failures", "errors", "skipped", "time", "hostname"],
	testcase: ["name", "classname", "time", "file", "line", "assertions"],
	outcome: ["message", "type"],
} as const

function attributes(raw: string): Record<string, string> | undefined {
	const result: Record<string, string> = Object.create(null) as Record<string, string>
	let index = 0
	while (index < raw.length) {
		if (/^\s*$/u.test(raw.slice(index))) return result
		const match = /\s+([A-Za-z][\w.-]*)="([^"<>]*)"/uy
		match.lastIndex = index
		const item = match.exec(raw)
		if (item === null || result[item[1] ?? ""] !== undefined) return undefined
		result[item[1] ?? ""] = item[2] ?? ""; index = match.lastIndex
	}
	return result
}

function tag(raw: string): Tag | undefined {
	if (raw.startsWith("/")) { const match = /^\/([A-Za-z][\w.-]*)\s*$/u.exec(raw); return match === null ? undefined : { name: match[1] ?? "", closing: true, selfClosing: false, attributes: {} } }
	const selfClosing = raw.endsWith("/")
	const match = /^([A-Za-z][\w.-]*)(.*)$/us.exec(selfClosing ? raw.slice(0, -1) : raw)
	if (match === null) return undefined
	const parsed = attributes(match[2] ?? "")
	return parsed === undefined ? undefined : { name: match[1] ?? "", closing: false, selfClosing, attributes: parsed }
}

const number = (value: string | undefined): number | undefined => value !== undefined && /^(?:0|[1-9][0-9]*)$/u.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined
const validAttributes = (input: Record<string, string>, names: readonly string[], required: readonly string[]): boolean => Object.keys(input).every((name) => names.includes(name)) && required.every((name) => input[name] !== undefined) && Object.entries(input).every(([name, value]) => !["tests", "assertions", "failures", "errors", "skipped", "line"].includes(name) || number(value) !== undefined)

type Outcome = "failure" | "error" | "skipped"
type State = { root?: Document; suite: Suite | undefined; testcase: { outcome?: Outcome } | undefined; stack: string[] }
const outcomes = new Set<Outcome>(["failure", "error", "skipped"])
const rootFrom = (attributes: Record<string, string>): Document => ({ tests: number(attributes.tests) ?? -1, failures: number(attributes.failures) ?? -1, errors: number(attributes.errors) ?? 0, skipped: number(attributes.skipped) ?? -1, suites: [] })
const suiteFrom = (attributes: Record<string, string>): Suite => ({ file: attributes.file ?? "", tests: number(attributes.tests) ?? -1, cases: 0, failures: number(attributes.failures) ?? -1, errors: number(attributes.errors) ?? 0, skipped: number(attributes.skipped) ?? -1, outcomeFailures: 0, outcomeErrors: 0, outcomeSkipped: 0 })

function openRoot(state: State, current: Tag): boolean {
	if (state.root !== undefined || state.stack.at(-1) !== undefined || current.selfClosing) return false
	if (!validAttributes(current.attributes, allowed.testsuites, ["tests", "failures", "skipped"])) return false
	state.root = rootFrom(current.attributes); return true
}
function openSuite(state: State, current: Tag): boolean {
	if (state.root === undefined || state.stack.at(-1) !== "testsuites" || current.selfClosing) return false
	if (!validAttributes(current.attributes, allowed.testsuite, ["file", "tests", "failures", "skipped"])) return false
	state.suite = suiteFrom(current.attributes); state.root.suites.push(state.suite); return true
}
function openCase(state: State, current: Tag): boolean {
	if (state.suite === undefined || state.stack.at(-1) !== "testsuite") return false
	if (!validAttributes(current.attributes, allowed.testcase, ["name"])) return false
	state.testcase = {}; if (current.selfClosing) { state.suite.cases += 1; state.testcase = undefined }; return true
}
function openOutcome(state: State, current: Tag): boolean {
	const testcase = state.testcase
	if (!outcomes.has(current.name as Outcome) || state.stack.at(-1) !== "testcase" || testcase === undefined || testcase.outcome !== undefined) return false
	if (!validAttributes(current.attributes, allowed.outcome, [])) return false
	testcase.outcome = current.name as Outcome; return true
}
function open(state: State, current: Tag): Failure | undefined {
	const valid = current.name === "testsuites" ? openRoot(state, current) : current.name === "testsuite" ? openSuite(state, current) : current.name === "testcase" ? openCase(state, current) : openOutcome(state, current)
	if (!valid) return fail("report-malformed", "document shape")
	if (!current.selfClosing) state.stack.push(current.name)
	return undefined
}
function closeCase(state: State): Failure | undefined {
	if (state.suite === undefined || state.testcase === undefined) return fail("report-malformed", "testcase")
	state.suite.cases += 1
	if (state.testcase.outcome === "failure") state.suite.outcomeFailures += 1
	if (state.testcase.outcome === "error") state.suite.outcomeErrors += 1
	if (state.testcase.outcome === "skipped") state.suite.outcomeSkipped += 1
	state.testcase = undefined; return undefined
}
function close(state: State, name: string): Failure | undefined {
	if (state.stack.pop() !== name) return fail("report-malformed", "tag stack")
	if (name === "testcase") return closeCase(state)
	if (name === "testsuite") state.suite = undefined
	return undefined
}
function textIsAllowed(text: string, parent: string | undefined): boolean {
	return /^\s*$/u.test(text) || outcomes.has(parent as Outcome)
}
function readTag(xml: string, openAt: number): readonly [Tag, number] | Failure {
	const closeAt = xml.indexOf(">", openAt + 1)
	if (closeAt === -1) return fail("report-malformed", "unclosed tag")
	const current = tag(xml.slice(openAt + 1, closeAt))
	if (current === undefined || current.name.startsWith("?") || current.name.startsWith("!")) return fail("report-malformed", "tag")
	return [current, closeAt + 1]
}
function step(xml: string, index: number, state: State): number | Failure {
	const openAt = xml.indexOf("<", index), text = xml.slice(index, openAt === -1 ? xml.length : openAt)
	if (!textIsAllowed(text, state.stack.at(-1))) return fail("report-malformed", "text")
	if (openAt === -1) return xml.length
	const parsed = readTag(xml, openAt)
	if ("ok" in parsed) return parsed
	const [current, next] = parsed
	const result = current.closing ? close(state, current.name) : open(state, current)
	return result === undefined ? next : result
}
function document(xml: string): Document | Failure {
	const declaration = '<?xml version="1.0" encoding="UTF-8"?>'
	if (!xml.startsWith(declaration)) return fail("report-malformed", "XML declaration")
	const state: State = { stack: [], suite: undefined, testcase: undefined }; let index = declaration.length
	while (index < xml.length) {
		const result = step(xml, index, state)
		if (typeof result !== "number") return result
		index = result
	}
	return state.root === undefined || state.stack.length !== 0 || state.suite !== undefined || state.testcase !== undefined ? fail("report-malformed", "document closure") : state.root
}

function inventoryResult(document: Document): GuardResult {
	const files = document.suites.map(({ file }) => file)
	return document.suites.length > 0 && new Set(files).size === files.length && same([...files].sort(), [...currentStageTestFiles].sort()) ? { ok: true } : fail("report-file-drift", files.join(","))
}
function suiteCountsResult(item: Suite): GuardResult {
	const expected = expectedTestsByFile.get(item.file)
	if (expected === undefined || item.tests !== expected || item.cases !== expected) return fail("report-count-mismatch", item.file)
	return { ok: true }
}
function suiteOutcomeResult(item: Suite): GuardResult {
	const failed = item.failures + item.errors + item.outcomeFailures + item.outcomeErrors
	if (failed > 0) return fail("report-failed", item.file)
	if (item.skipped + item.outcomeSkipped > 0) return fail("report-skipped", item.file)
	const countsMatch = item.failures === item.outcomeFailures && item.errors === item.outcomeErrors && item.skipped === item.outcomeSkipped
	return countsMatch ? { ok: true } : fail("report-count-mismatch", item.file)
}
function rootResult(document: Document): GuardResult {
	const totals = document.suites.reduce((total, item) => ({ tests: total.tests + item.cases, failures: total.failures + item.failures, errors: total.errors + item.errors, skipped: total.skipped + item.skipped }), { tests: 0, failures: 0, errors: 0, skipped: 0 })
	if (document.failures > 0 || document.errors > 0) return fail("report-failed", "root")
	if (document.skipped > 0) return fail("report-skipped", "root")
	return document.tests === currentStageExpectedTestCount && document.tests === totals.tests && document.failures === totals.failures && document.errors === totals.errors && document.skipped === totals.skipped ? { ok: true } : fail("report-count-mismatch", `tests=${document.tests}`)
}
export function validateJunitReport(xml: string): GuardResult {
	const parsed = document(xml); if (!("suites" in parsed)) return parsed
	const inventory = inventoryResult(parsed); if (!inventory.ok) return inventory
	for (const suite of parsed.suites) for (const result of [suiteCountsResult(suite), suiteOutcomeResult(suite)]) if (!result.ok) return result
	return rootResult(parsed)
}

export type CurrentStageProcessResult = Readonly<{ exitCode: number; signalCode: NodeJS.Signals | null; report: string }>
export function validateCurrentStageProcess(result: CurrentStageProcessResult): GuardResult {
	if (result.signalCode !== null) return fail("test-process-timeout", result.signalCode)
	return result.exitCode === 0 ? validateJunitReport(result.report) : fail("test-process-failed", `exit=${result.exitCode}`)
}

type SettledCurrentStageChild = Readonly<{ exitCode: number; signalCode: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean; pid: number }>
const pause = (milliseconds: number): Promise<void> => new Promise((done) => setTimeout(done, milliseconds))
const processGroupExists = (pid: number): boolean => {
	try { process.kill(-pid, 0); return true } catch (error) {
		if (error instanceof Error && "code" in error) {
			if (error.code === "ESRCH") return false
			if (error.code === "EPERM") return true
		}
		throw error
	}
}
const waitForProcessGroupSettlement = async (pid: number): Promise<void> => {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (!processGroupExists(pid)) return
		await pause(10)
	}
	if (processGroupExists(pid)) throw new Error("current-stage process group did not settle")
}
type SpawnedCurrentStageChild = Readonly<{ child: ReturnType<typeof Bun.spawn>; natural: Promise<[number, string, string]> }>
const terminateProcessGroup = (child: ReturnType<typeof Bun.spawn>): void => { process.kill(-child.pid, "SIGKILL") }
const bestEffortTerminateProcessGroup = (child: ReturnType<typeof Bun.spawn>): void => { try { terminateProcessGroup(child) } catch {} }
function spawnCurrentStageChild(command: readonly string[], cwd: string): SpawnedCurrentStageChild {
	if (process.platform === "win32") throw new Error("current-stage process settlement requires POSIX process groups")
	const child = Bun.spawn({ cmd: [...command], cwd, detached: true, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
	if (!(child.stdout instanceof ReadableStream) || !(child.stderr instanceof ReadableStream)) throw new Error("current-stage process did not receive pipe streams")
	return { child, natural: Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]) }
}
function processGroupDeadline(child: ReturnType<typeof Bun.spawn>, deadlineMs: number): Readonly<{ timer: ReturnType<typeof setTimeout>; fired: Promise<Readonly<{ settled: false }>> }> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const fired = new Promise<Readonly<{ settled: false }>>((resolveDeadline, rejectDeadline) => { timer = setTimeout(() => { try { terminateProcessGroup(child); resolveDeadline({ settled: false }) } catch { rejectDeadline(new Error("current-stage process-group termination failed")) } }, deadlineMs) })
	if (timer === undefined) throw new Error("current-stage deadline was not scheduled")
	return { timer, fired }
}
const settleAfterDeadline = async (natural: Promise<[number, string, string]>): Promise<[number, string, string]> => Promise.race([natural, pause(1_000).then(() => { throw new Error("current-stage process group did not settle") })])
async function settleCurrentStageChild(command: readonly string[], cwd: string, deadlineMs: number, beforeDeadline?: (child: ReturnType<typeof Bun.spawn>) => Promise<void>): Promise<SettledCurrentStageChild> {
	const { child, natural } = spawnCurrentStageChild(command, cwd)
	let settled = false
	try {
		await beforeDeadline?.(child)
		const deadline = processGroupDeadline(child, deadlineMs)
		const observed = await Promise.race([natural.then((value) => ({ settled: true as const, value })), deadline.fired])
		clearTimeout(deadline.timer)
		const [exitCode, stdout, stderr] = observed.settled ? observed.value : await settleAfterDeadline(natural)
		if (!observed.settled) await waitForProcessGroupSettlement(child.pid)
		settled = true
		return { exitCode, signalCode: child.signalCode, stdout, stderr, timedOut: !observed.settled, pid: child.pid }
	} finally { if (!settled) bestEffortTerminateProcessGroup(child) }
}

export async function proveCurrentStageTimeoutCleanup(): Promise<Readonly<{ timedOut: boolean; childSettled: boolean; childTerminated: boolean; descendantTerminated: boolean; streamsSettled: boolean; temporaryStateCleaned: boolean; signalCode: NodeJS.Signals | null }>> {
	const root = mkdtempSync(join(tmpdir(), "agent-plugin-kit-timeout-proof-")), ready = join(root, "ready"), descendantPath = join(root, "descendant.pid")
	const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true } catch { return false } }
	let result: Omit<Awaited<ReturnType<typeof proveCurrentStageTimeoutCleanup>>, "temporaryStateCleaned"> | undefined
	try {
		const script = `const fs = require("node:fs"); const descendant = Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"], stdin: "ignore", stdout: "inherit", stderr: "inherit" }); fs.writeFileSync(${JSON.stringify(descendantPath)}, String(descendant.pid)); fs.writeFileSync(${JSON.stringify(ready)}, "ready"); setInterval(() => {}, 1000)`
		let descendant = 0
		const execution = await settleCurrentStageChild([process.execPath, "-e", script], root, 50, async () => {
			for (let attempt = 0; attempt < 100 && !existsSync(ready); attempt += 1) await pause(5)
			if (!existsSync(ready)) throw new Error("timeout descendant did not become ready")
			descendant = Number.parseInt(readFileSync(descendantPath, "utf8"), 10)
			if (!Number.isSafeInteger(descendant) || !alive(descendant)) throw new Error("timeout descendant was not retained")
		})
		result = { timedOut: execution.timedOut, childSettled: Number.isInteger(execution.exitCode), childTerminated: !alive(execution.pid), descendantTerminated: !alive(descendant), streamsSettled: true, signalCode: execution.signalCode }
	} finally { rmSync(root, { recursive: true, force: true }) }
	if (result === undefined) throw new Error("timeout proof did not settle")
	return { ...result, temporaryStateCleaned: !existsSync(root) }
}

const report = (result: Failure): void => { process.stderr.write(`${JSON.stringify({ command: "test:current-stage", ...result })}\n`) }
async function run(): Promise<number> {
	const root = resolve(import.meta.dir, ".."), selected = process.argv.slice(2)
	for (const result of [validateCurrentStageDiscovery(root), validateCurrentStageSelection(selected), validateCurrentStageFiles(root, selected), validateCurrentStageSources(root, selected)]) if (!result.ok) { report(result); return 1 }
	const temporaryRoot = mkdtempSync(join(tmpdir(), "agent-plugin-kit-current-stage-")), reportPath = join(temporaryRoot, "junit.xml")
	try {
		const child = await settleCurrentStageChild([process.execPath, "test", "--reporter=junit", "--reporter-outfile", reportPath, ...selected], root, 120_000)
		process.stdout.write(child.stdout); process.stderr.write(child.stderr)
		const result = validateCurrentStageProcess({ exitCode: child.exitCode, signalCode: child.signalCode, report: existsSync(reportPath) ? readFileSync(reportPath, "utf8") : "" })
		if (!result.ok) report(result); return result.ok ? 0 : 1
	} finally { rmSync(temporaryRoot, { recursive: true, force: true }) }
}
if (import.meta.main) process.exitCode = await run()
