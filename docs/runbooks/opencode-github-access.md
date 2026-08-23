# OpenCode Issue-Orchestrator GitHub Access

## Problem and observed failure

On 2026-08-23, the host `gh` CLI was installed (`2.45.0`), authenticated, and resolved
the Positron repository. A fresh OpenCode Issue-Orchestrator session also had Bash and
could execute `gh`, but the configured GitHub MCP server was not exposed to the agent.

The resolved configuration contained the legacy tool disablement `github_*: false` at
global scope. That setting won over the agent's legacy `github_*: true`, so the MCP
server started but its 26 tools were omitted from the agent tool contract. This was a
tool-routing/configuration failure, not a PATH, HOME, user, repository, or GitHub auth
failure.

## Canonical path

The Issue-Orchestrator uses the GitHub MCP server where its tool contract is available.
For the installed server's missing issue-comment-read operation, the canonical fallback
is the already-authorized Bash `gh` CLI path. No token is copied into project config.

## Fix

`.opencode/opencode.json` enables only the required issue tools for the project, keeps
all GitHub tools denied by default, and grants the narrow issue tool set only to
`issue-orchestrator`. This removes the legacy project-level disablement while
preserving least privilege for other agents and unrelated GitHub operations.

## Regression checks

Run the deterministic contract check:

```bash
./scripts/opencode-github-access-regression.sh
```

The live fresh-session check must be read-only and verify `gh --version`, auth,
repository resolution, issue list, issue read, and issue comments. On the repair run,
all six checks passed after an OpenCode process restart. The MCP probe proved
`github_get_issue` is available; `github_get_issue_comments` is not part of the
installed 26-tool contract, so comment reads are verified through `gh issue view
<number> --comments`.
