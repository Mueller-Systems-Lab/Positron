# Known Limitations — Positron

## Remote CI

GitHub Actions Quality Gates are now required for merge to `main` via branch protection (6 required checks: `format-check`, `differential-lint`, `build`, `typecheck`, `unit-tests`, `observability-config-check`). Issue [#268](https://github.com/xxammaxx/Positron/issues/268) is CLOSED.

The workflow YAML files are syntactically valid and executable (restored via PR #296, R3-R1 proven via PR #415).

- Remote CI is required for protected-branch merge.
- Local gates remain mandatory pre-PR gates.
- `strict: true` — branch must be up to date before merge.
- `enforce_admins: true` — admins must also pass all checks.
- Advisory jobs (`full-lint-report`, `e2e-playwright`, `mutation-fast`, `mutation-safety`, `tool-gateway-windows`) are not blocking.

## Biome Lint Backlog

`npx biome check .` remains advisory-only due to a known lint backlog ([#340](https://github.com/xxammaxx/Positron/issues/340)). `npx biome format .` passes consistently.

## Full Real Mode Not Productively Validated

- Full Real Mode (human-in-the-loop GitHub operations) has not been productively proven.
- Tracked in Issue [#308](https://github.com/xxammaxx/Positron/issues/308) (YELLOW_VALIDATE, P1).

### Stage Progression Summary (historical)

| Stage | Status | Date |
|-------|--------|------|
| Stage 0 (Fake Mode Baseline) | COMPLETE | 2026-07-07 |
| Stage 1 (ReadOnly Dry Run) | COMPLETE | 2026-07-08 |
| Stage 2 (Write Sandbox) | COMPLETE | 2026-07-13 |
| Stage 3 (Runtime Foundation) | IMPLEMENTED_AND_TESTED_NOT_EXECUTED | 2026-07-14 |

See `docs/evidence/` for full stage evidence reports.

## E2E Testing

### Playwright E2E Tracing Flake (#304, CLOSED)

- E2E Playwright tests had tracing lifecycle instability.
- Issue [#304](https://github.com/xxammaxx/Positron/issues/304) was closed on 2026-07-30.
- E2E tests are not currently required locally.
- CI job `e2e-playwright` is advisory (`continue-on-error: true`).

### E2E Runtime Proof — Auth Contract Verified (Issue #373)

- 2026-07-17: E2E Runtime Proof completed.
- Auth contract confirmed end-to-end with live Server/Redis.
- CI Playwright: 26/26 PASS.

### Auth Contract — RESOLVED (Issue #373)

All 5 frontend admin operations now use `adminRequest()` with the `X-Admin-Token` header:

| Frontend Method | Endpoint | Status |
|----------------|----------|--------|
| `createRepo` | `POST /api/repos` | ✅ Uses adminRequest() |
| `startRun` | `POST /api/repos/:repoId/runs` | ✅ Uses adminRequest() |
| `saveEvidence` | `POST /api/evidence` | ✅ Uses adminRequest() |
| `updateSafety` | `POST /api/safety` | ✅ Uses adminRequest() |
| `cancelRun` | `POST /api/runs/:id/cancel` | ✅ Uses adminRequest() |

Verified via dedicated auth contract test: `apps/web/src/__tests__/api-createRun-auth.test.ts` (163 lines, 5 test cases).

## Open Issues / PRs

PR counts are intentionally not embedded because they become stale.
Use [GitHub's open pull-request view](https://github.com/xxammaxx/Positron/pulls?q=is%3Apr+is%3Aopen) for current state.

At the time of verification (2026-08-02), PR [#417](https://github.com/xxammaxx/Positron/pull/417) was open as the corrective continuation for this documentation run.

Closed epics (not_planned): [#229](https://github.com/xxammaxx/Positron/issues/229), [#243](https://github.com/xxammaxx/Positron/issues/243).

## Stashes

Two stashes remain preserved on `main`:

- `stash@{0}`: "safety: dirty tree before clean workspace policy pr"
- `stash@{1}`: "stash: doc modification from spec phase"

These must not be applied, popped, or dropped without explicit human instruction.

## Active Limitations

<!-- positron:auto-generated:start active-limitations -->
| Item | Status | Issue |
|------|--------|-------|
| Full Real Mode not productively validated | Open | #308 |
| Stage 3 Full Real Mode | IMPLEMENTED_AND_TESTED_NOT_EXECUTED | #308 |
| Biome lint backlog | Open | #340 |
| Admin auth contract mismatches (5 endpoints) | RESOLVED (#373) | — |
| Large epics closed as not_planned | CLOSED | #229, #243 |
| E2E tracing lifecycle (was active limitation) | CLOSED | #304 |
| Portfolio auto-update mechanism | CLOSED | #305 |
| Backlog hygiene | CLOSED | #306 |
| Multi-process workspace lock | CLOSED | #324 |
| PR #417 open (corrective continuation) | In progress | #416 |
<!-- positron:auto-generated:end active-limitations -->

## Resolved Limitations (Reference)

<!-- positron:auto-generated:start resolved-limitations -->
| Item | Resolution |
|------|-----------|
| #268 CI zero-step infrastructure | Resolved via PR #296, #415; CI now required for merge |
| #252 Repository badges/links cleanup | CLOSED |
| #297 Flaky E2E test | Stabilized and CLOSED |
| #298 Biome JSON formatting | Resolved and CLOSED |
| #299 Windows module resolution | Resolved and CLOSED |
| apps/web JSX/TSX test failures | Resolved (all 399 web tests pass at SHA 3a9a116) |
| Demo-run admin auth contract | Fixed and verified (#373) |
| CI Playwright token mismatch | Fixed — CI workflow token aligned |
| CodeRabbit automation | Decommissioned (internal), external pending owner |
<!-- positron:auto-generated:end resolved-limitations -->
