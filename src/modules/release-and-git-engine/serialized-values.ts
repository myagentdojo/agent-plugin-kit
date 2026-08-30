import { z } from "zod"
import type {
  CandidateIdentity,
  PackageIdentity,
  ReleaseIdentity,
  RepositoryIdentity,
  SourceIdentity,
  WorkflowIdentity,
} from "./interface"

const commitSchema = z.string().regex(/^[0-9a-f]{40}$/)

function isPublicRepositoryOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.hostname.length > 0
    )
  } catch {
    return false
  }
}

export const repositoryIdentitySchema = z.strictObject({
  origin: z.string().refine(isPublicRepositoryOrigin),
})
export const sourceIdentitySchema = z.strictObject({
  repository: repositoryIdentitySchema,
  commit: commitSchema,
})
export const releaseIdentitySchema = z.strictObject({
  reference: z.string().min(1).refine((value) => !/[\\\s]/.test(value)),
  commit: commitSchema,
})
export const packageIdentitySchema = z.strictObject({
  repository: repositoryIdentitySchema,
  commit: commitSchema,
})
export const workflowIdentitySchema = z.strictObject({
  repository: repositoryIdentitySchema,
  path: z.string().min(1).refine((value) =>
    !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes("..")
  ),
  commit: commitSchema,
})
export const candidateIdentitySchema = z.strictObject({
  source: sourceIdentitySchema,
  release: releaseIdentitySchema,
  package: packageIdentitySchema,
  workflow: workflowIdentitySchema,
}).refine((candidate) =>
  candidate.release.commit === candidate.source.commit &&
  candidate.package.commit === candidate.source.commit &&
  candidate.workflow.commit === candidate.source.commit
)

type InferredRepositoryIdentity = z.infer<typeof repositoryIdentitySchema>
type InferredSourceIdentity = z.infer<typeof sourceIdentitySchema>
type InferredReleaseIdentity = z.infer<typeof releaseIdentitySchema>
type InferredPackageIdentity = z.infer<typeof packageIdentitySchema>
type InferredWorkflowIdentity = z.infer<typeof workflowIdentitySchema>
type InferredCandidateIdentity = z.infer<typeof candidateIdentitySchema>

const bidirectionalTypeChecks: [
  InferredRepositoryIdentity extends RepositoryIdentity ? true : false,
  RepositoryIdentity extends InferredRepositoryIdentity ? true : false,
  InferredSourceIdentity extends SourceIdentity ? true : false,
  SourceIdentity extends InferredSourceIdentity ? true : false,
  InferredReleaseIdentity extends ReleaseIdentity ? true : false,
  ReleaseIdentity extends InferredReleaseIdentity ? true : false,
  InferredPackageIdentity extends PackageIdentity ? true : false,
  PackageIdentity extends InferredPackageIdentity ? true : false,
  InferredWorkflowIdentity extends WorkflowIdentity ? true : false,
  WorkflowIdentity extends InferredWorkflowIdentity ? true : false,
  InferredCandidateIdentity extends CandidateIdentity ? true : false,
  CandidateIdentity extends InferredCandidateIdentity ? true : false,
] = [true, true, true, true, true, true, true, true, true, true, true, true]

void bidirectionalTypeChecks
