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

The regression script parses static JSON and the current resolver output. OpenCode
1.15.13 exposes an effective permission array, so the check verifies the semantic
boundary: exactly five enabled/allowed `github_*` operations and no extra allowed
GitHub operation. The installed GitHub MCP server is discovered at runtime (26
tools) and `get_issue` is called in a fresh MCP process. The server does not expose
`get_issue_comments`; comment reads are therefore verified through the fresh `gh
issue view 429 --comments` path. No model narration is treated as permission proof.
