# Issue Tracker: GitHub

Issues and specifications live in GitHub Issues for
`myagentdojo/agent-plugin-kit`. On a shared host, use the process-scoped
`ghh exec --account myagentdojo --` prefix so another agent cannot redirect the
GitHub identity.

## Operations

- Create: `ghh exec --account myagentdojo -- issue create --title "..." --body "..."`.
- Read: `ghh exec --account myagentdojo -- issue view <number> --json body,comments,labels`.
- List: `ghh exec --account myagentdojo -- issue list --state open --json number,title,body,labels,comments`.
- Comment: `ghh exec --account myagentdojo -- issue comment <number> --body "..."`.
- Label: `ghh exec --account myagentdojo -- issue edit <number> --add-label "..."`.
- Close: `ghh exec --account myagentdojo -- issue close <number> --comment "..."`.

Run the command from this repository so GitHub resolves the `origin` owner. A
standard single-user environment may use the equivalent `gh` command.

## Pull requests as a request surface

**PRs as a request surface: no.** Treat a pull request as a proposed change to
an existing request, not as a feature request entering triage.

GitHub shares one number sequence across issues and pull requests. Resolve an
ambiguous number with `ghh exec --account myagentdojo -- pr view <number>` and
fall back to `issue view`.

## Skill meanings

- Publish to the issue tracker: create a GitHub Issue.
- Fetch the relevant ticket: read its body, comments, and labels.
- Mutable plan or blocker state: update the owning Issue rather than a
  repository document.
