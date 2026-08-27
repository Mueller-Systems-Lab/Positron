---
description: Run review-security as a fresh read-only reviewer child
agent: review-security
subtask: true
---

Review the active Issue #455 and the exact PR #456 context supplied below.
Use only the permissions of review-security. Do not mutate files, GitHub, branches, PRs,
or issues. Return the normal structured reviewer contract with AGENT,
ROLE, PROVIDER, MODEL, PARENT_SESSION, CHILD_SESSION, PURPOSE, FINDINGS,
CRITICAL, and MAJOR.

CALLER CONTEXT:

$ARGUMENTS
