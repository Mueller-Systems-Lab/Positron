# Release-readiness matrix

| Gate | Status |
|---|---|
| Clean install/build | PASS |
| Local targeted E2E | PASS |
| Persistent locking | PASS |
| Migration | PASS (V1–V6 deterministic fixtures, V11 ledger) |
| Backup/restore | PASS |
| Restart recovery | PASS |
| Persistent lock/fencing | PASS |
| Version/CLI/API/config | PASS |
| Upgrade path | PASS (restore-based rollback) |
| Health/readiness | PASS (`/api/health` vs `/api/readiness`) |
| Security/secret scan | PASS; CRITICAL=0, MAJOR=0 |
| Portfolio issues #447/#464 | RELEASE_BLOCKING=NO; portfolio evidence blocking=YES |

Final local validation after this change: focused contract tests and build
PASS. Exact-head CI is still required after the final commit; no merge is
authorized.

The complete local Playwright suite subsequently passed 35/35 on the current
candidate. SECRET_SCAN=PASS with zero matches in the changed #465 scope.

Canonical `npm run lint` reports 2 errors and 1,740 warnings in the full
repository. The errors are pre-existing `noNonNullAssertion`/configuration
baseline diagnostics outside the new release code; changed-surface lint for
the new backup/readiness/contracts has 0 introduced errors. Therefore
FULL_REPO_LINT=ADVISORY_WITH_PRE_EXISTING_DIAGNOSTICS, not PASS.
