import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PayloadPackageRequest } from "../../interface"
import { createPluginPayloadProduction } from "../../implementation/plugin-payload-production"

/**
 * One packaging attempt in its own process. It stages its artifacts, announces
 * that it is staged, and blocks until the test releases the barrier, so two
 * attempts reach the no-replace publication inside the same window. The barrier
 * is a filesystem readiness marker rather than a timed wait, and the bound only
 * stops a stuck run from hanging the suite.
 */
const barrierDeadlineMs = 30_000

const [requestPath, barrierDirectory, label] = process.argv.slice(2)
if (requestPath === undefined || barrierDirectory === undefined || label === undefined) {
  throw new Error("concurrent publication child requires a request path, barrier directory, and label")
}

const request = JSON.parse(readFileSync(requestPath, "utf8")) as PayloadPackageRequest

const result = await createPluginPayloadProduction({
  interrupt: (point) => {
    if (point !== "staged") return
    writeFileSync(join(barrierDirectory, `staged-${label}`), "")
    const deadline = Date.now() + barrierDeadlineMs
    while (!existsSync(join(barrierDirectory, "go"))) {
      if (Date.now() > deadline) throw new Error("concurrent publication barrier was never released")
      Bun.sleepSync(2)
    }
  },
}).produce(request)

process.stdout.write(JSON.stringify(result))
