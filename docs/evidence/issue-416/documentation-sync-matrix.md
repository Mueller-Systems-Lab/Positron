# Documentation Synchronization Matrix — Issue #416

| Claim ID | File | Old Claim | Evidence | New Claim | Status |
|---|---|---|---|---|---|
| TEST_ROOT_COUNT | README, capabilities | 1375 tests / 64 files → 1897 / 78 files | T2 JSON | 2173 tests / 84 files | SYNCED |
| TEST_WEB_COUNT | README, capabilities | 196 tests / 8 files → 205 / 9 files | T3 JSON | 399 tests / 18 files | SYNCED |
| TEST_COMBINED_UNIQUE | README, capabilities | 1571 → 2326 (with overlap) | File overlap = 0 | 2572 / 102 files | SYNCED |
| CI_REQUIRED_CHECKS | Policy, README, capabilities | advisory-only | Branch protection API | 6 required checks | SYNCED |
| CI_ADVISORY_JOBS | Policy, capabilities | not distinguished | Workflow continue-on-error | 5 advisory jobs | SYNCED |
| CI_POLICY_VERSION | Policy | v1 (advisory-only) | Branch protection + PR #415 | v2 (local-first, remote-required) | SYNCED |
| ISSUE_268_STATUS | Policy, README, changelog, capabilities | OPEN / advisory tracker | GitHub API | CLOSED | SYNCED |
| NODE_RUNTIME | README | Node.js 24 | CI uses Node 22, dev uses 24 | CI-pinned 22, dev verified 24 | SYNCED |
| CI_DIAGRAM | local-ci-flow.mmd | advisory-only edge | Branch protection | Required + advisory paths | SYNCED |
| TEST_COMMAND_CONTRACT | README, capabilities, contributing | manual steps | T1 execution | Self-contained npm test | SYNCED |
| BUILD_PRETEST_CONTRACT | Capabilities | not documented | T1 log | pretest → build → vitest | SYNCED |

## Corrective Continuation (2026-08-02)

| Claim ID | File | Old Claim | Evidence | New Claim | Status |
|---|---|---|---|---|---|
| CORR_304 | capabilities, limitations, README | #304 presented as active/open | GitHub API: CLOSED 2026-07-30 | CLOSED — moved to Resolved/Retired | CORRECTED |
| CORR_305 | capabilities, limitations | #305 presented as active/open | GitHub API: CLOSED 2026-06-27 | CLOSED — moved to Resolved/Retired | CORRECTED |
| CORR_306 | capabilities, limitations | #306 presented as active/open | GitHub API: CLOSED 2026-06-27 | CLOSED — moved to Resolved/Retired | CORRECTED |
| CORR_229 | capabilities, limitations | #229 presented as active/open | GitHub API: CLOSED, state_reason=not_planned | CLOSED — not_planned | CORRECTED |
| CORR_243 | capabilities, limitations | #243 presented as active/open | GitHub API: CLOSED, state_reason=not_planned | CLOSED — not_planned | CORRECTED |
| CORR_215 | capabilities | #215 presented as active | GitHub API: CLOSED 2026-06-28 | CLOSED | CORRECTED |
| CORR_324 | limitations | #324 "Not implemented" | GitHub API: CLOSED 2026-07-30 | CLOSED | CORRECTED |
| CORR_PR_COUNT | limitations | "No open PRs at audit time" | PR #417 is open | Volatile claim removed; qualified historical reference added | CORRECTED |
| CORR_CHANGED_FILES | PR body | "7 changed files" | GitHub API: changedFiles=9 | 9 changed files | CORRECTED |

- All application source files: 0 changes
- All test files: 0 changes
- All workflow files: 0 changes
- All package files: 0 changes
- All dependency/lockfile files: 0 changes
- All historical evidence and release records: 0 changes
