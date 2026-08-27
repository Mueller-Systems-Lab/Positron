---
description: Force an independent lifecycle review as a real subtask
agent: review-independent-final
subtask: true
---

Review the active issue and exact change-set context supplied below.

The active issue, PR, base/head SHAs, phase, acceptance criteria, relevant
evidence, CI state, and post-merge gates are supplied by the caller through
`$ARGUMENTS`. Treat that context as evidence to inspect, not as a desired
classification.

Determine independently whether the requested lifecycle transition is ready.

- For PRE_MERGE, assess whether the exact PR head is safe and ready to merge,
  and list any post-merge-only gates.
- For POST_MERGE, assess whether all supplied acceptance criteria are satisfied
  and whether the issue is ready to close.

Report blockers and return the required structured contract with AGENT,
ROLE, PROVIDER, MODEL, PARENT_SESSION, CHILD_SESSION, PURPOSE, FINDINGS,
CRITICAL, MAJOR, and the applicable readiness decision. Do not mutate files,
GitHub, branches, PRs, or issues. Do not launch another agent.

CALLER CONTEXT:

$ARGUMENTS
