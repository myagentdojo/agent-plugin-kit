import { projectRepositoryVerification, verifyRepository } from "./repository-verification"

const result = projectRepositoryVerification(verifyRepository(process.cwd()))

process.stdout.write(`${JSON.stringify(result.envelope)}\n`)
process.stderr.write(result.stderr)
process.exitCode = result.exitCode
