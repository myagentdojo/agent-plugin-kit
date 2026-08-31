import { resolve } from "node:path"
import type { ProcessObservation } from "../../interface"

export type ProcessCleanupReceipt = {
  deadlineMs: number
  timedOut: boolean
  exitObserved: boolean
  descriptorClosure: "closed"
  cleanup: "natural" | "process-group-killed"
  retainedResources: 0
}

export async function invokeBoundedProcess(
  command: readonly string[],
  options: {
    cwd: string
    environment?: Readonly<Record<string, string>>
    deadlineMs?: number
    stdin?: string | ReadableStream<Uint8Array>
  },
): Promise<{ observation: ProcessObservation; cleanup: ProcessCleanupReceipt }> {
  const deadlineMs = options.deadlineMs ?? 2_000
  const processResult = Bun.spawn([...command], {
    cwd: options.cwd,
    detached: true,
    env: { ...process.env, ...options.environment },
    stdin: typeof options.stdin === "string"
      ? new TextEncoder().encode(options.stdin)
      : options.stdin ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = new Response(processResult.stdout).text()
  const stderr = new Response(processResult.stderr).text()
  let deadlineTriggered = false
  const natural = Promise.all([stdout, stderr, processResult.exited]).then(([stdout, stderr, exitCode]) => ({
    observation: { stdout, stderr, exitCode: deadlineTriggered ? 124 : exitCode },
    cleanup: {
      deadlineMs,
      timedOut: deadlineTriggered,
      exitObserved: true,
      descriptorClosure: "closed" as const,
      cleanup: deadlineTriggered ? "process-group-killed" as const : "natural" as const,
      retainedResources: 0 as const,
    },
  }))
  let deadlineHandle: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<{ observation: ProcessObservation; cleanup: ProcessCleanupReceipt }>((resolveDeadline) => {
    deadlineHandle = setTimeout(async () => {
      deadlineTriggered = true
      try {
        process.kill(-processResult.pid, "SIGKILL")
      } catch {
        processResult.kill("SIGKILL")
      }
      const [capturedStdout, capturedStderr] = await Promise.all([stdout, stderr])
      await processResult.exited
      resolveDeadline({
        observation: { stdout: capturedStdout, stderr: capturedStderr, exitCode: 124 },
        cleanup: { deadlineMs, timedOut: true, exitObserved: true, descriptorClosure: "closed", cleanup: "process-group-killed", retainedResources: 0 },
      })
    }, deadlineMs)
  })
  const result = await Promise.race([natural, deadline])
  if (deadlineHandle) clearTimeout(deadlineHandle)
  return result
}

export async function invokeRetainedDescriptorNegativeControl(): Promise<ProcessCleanupReceipt> {
  const script = 'const retained = Bun.spawn(["/bin/sleep", "10"], { stdout: "inherit", stderr: "inherit" }); retained.unref()'
  return (await invokeBoundedProcess([process.execPath, "-e", script], { cwd: import.meta.dir, deadlineMs: 100 })).cleanup
}

export async function invokePublicProcess(
  argv: readonly string[],
  environment: Readonly<Record<string, string>> = {},
  cwd = import.meta.dir,
  stdin?: string | ReadableStream<Uint8Array>,
): Promise<ProcessObservation> {
  const executable = resolve(import.meta.dir, "../../maintenance.ts")
  return (await invokeBoundedProcess([executable, ...argv], {
    cwd,
    environment,
    ...(stdin === undefined ? {} : { stdin }),
  })).observation
}
