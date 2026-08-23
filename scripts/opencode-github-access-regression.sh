#!/usr/bin/env bash
set -euo pipefail

# Read-only contract check for the project OpenCode configuration.
# The live agent check remains explicit because it invokes a model session.

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

config="$repo_root/.opencode/opencode.json"
test -f "$config"

grep -q '"github_\*": false' "$config"
grep -q '"github_get_issue": true' "$config"
grep -q '"github_add_issue_comment": true' "$config"
grep -q '"github_\*": "deny"' "$config"
grep -q '"issue-orchestrator"' "$config"

resolved="$(opencode debug config 2>/dev/null)"
grep -q '"github_\*": false' <<<"$resolved"
grep -q '"github_get_issue": true' <<<"$resolved"

agent="$(opencode debug agent issue-orchestrator 2>/dev/null)"
grep -q '"github_\*": "deny"' <<<"$agent"
grep -q '"github_get_issue": "allow"' <<<"$agent"
if grep -q '"github_create_repository": "allow"' <<<"$agent"; then
	echo "unexpected broad GitHub write permission" >&2
	exit 1
fi

command -v gh >/dev/null
gh --version >/dev/null
gh auth status >/dev/null 2>&1
gh repo view --json nameWithOwner >/dev/null
gh issue list --limit 1 --json number >/dev/null

echo "opencode GitHub access contract: PASS"
