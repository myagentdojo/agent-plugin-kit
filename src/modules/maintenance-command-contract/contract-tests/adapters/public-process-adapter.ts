export type PublicProcessObservation = {
  stdout: string
  stderr: string
  exitCode: number
}

export function createPublicProcessAdapter(executable?: string) {
  return {
    async invoke(argv: readonly string[]): Promise<PublicProcessObservation | undefined> {
      if (!executable) return undefined

      const child = Bun.spawn([executable, ...argv], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      return { stdout, stderr, exitCode }
    },
  }
}
