#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
category="${1:?usage: .gates/admit-blocker.sh CATEGORY EVIDENCE_FILE}"
evidence="${2:?usage: .gates/admit-blocker.sh CATEGORY EVIDENCE_FILE}"

case "$category" in
	OWNER_AUTH_REQUIRED|OWNER_2FA_REQUIRED|OWNER_PERMISSION_REQUIRED|PAID_ACTION_APPROVAL_REQUIRED|SAFETY_POLICY_BLOCK|PROVEN_EXTERNAL_SERVICE_OUTAGE) ;;
	TOOL_MISSING|MCP_MISSING|BROWSER_MISSING|PLAYWRIGHT_MISSING|DEPENDENCY_MISSING|DNS_TRANSIENT|ISSUE_CONTEXT_MISSING|TEST_FAILURE|BUILD_FAILURE|CONFIG_ERROR|LOCAL_SERVICE_FAILURE|DIRECT_GITHUB_API_MUTATION|GH_MUTATION)
		printf 'BLOCKER_REJECTED=%s\n' "$category" >&2
		exit 1
		;;
	*) printf 'BLOCKER_REJECTED=UNKNOWN_CATEGORY\n' >&2; exit 1 ;;
esac

[[ -f "$evidence" ]] || { printf 'BLOCKER_REJECTED=EVIDENCE_MISSING\n' >&2; exit 1; }
for required in 'root cause' 'recovery' 'minimum owner action'; do
	grep -qi "$required" "$evidence" || { printf 'BLOCKER_REJECTED=EVIDENCE_INCOMPLETE\n' >&2; exit 1; }
done
printf 'BLOCKER_ADMITTED=%s\nEVIDENCE=%s\n' "$category" "$evidence"
