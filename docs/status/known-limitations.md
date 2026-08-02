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

### Playwright E2E Tracing Flake (#304, OPEN)

- E2E Playwright tests have tracing lifecycle instability.
- E2E tests are not currently required locally.
- CI job `e2e-playwright` is advisory (`continue-on-error: true`).
- Tracked in Issue [#304](https://github.com/xxammaxx/Positron/issues/304) (YELLOW, P2).

### E2E Runtime Proof — Auth Contract Verified (Issue #373)

- 2026-07-17: E2E Runtime Proof completed.
- Auth contract confirmed end-to-end with live Server/Redis.
- CI Playwright: 26/26 PASS.

### Pending Admin Auth Mismatches

The following frontend API methods use `request()` (no admin token) but hit server endpoints protected by `requireAdmin`:

| Frontend Method | Endpoint | Server Middleware |
|----------------|----------|-------------------|
| `createRepo` | `POST /api/repos` | `requireAdmin` |
| `startRun` | `POST /api/repos/:repoId/runs` | `requireAdmin` |
| `saveEvidence` | `POST /api/evidence` | `requireAdmin` |
| `updateSafety` | `POST /api/safety` | `requireAdmin` |
| `cancelRun` | `POST /api/runs/:id/cancel` | `requireAdmin` |

## Open Issues / PRs

- No open PRs at audit time (2026-08-02).
- #229 MCP Bootstrap Epic: Large epic requiring decomposition.
- #243 Agentic Baseline Epic: Large epic requiring decomposition.

## Stashes

Two stashes remain preserved on `main`:

- `stash@{0}`: "safety: dirty tree before clean workspace policy pr"
- `stash@{1}`: "stash: doc modification from spec phase"

These must not be applied, popped, or dropped without explicit human instruction.

## Active Limitations

<!-- positron:auto-generated:start active-limitations -->
| Item | Status | Issue |
|------|--------|-------|
| E2E tracing lifecycle flake | Open | #304 |
| Portfolio auto-update mechanism | Open | #305 |
| Backlog hygiene | Open | #306 |
| Full Real Mode not productively validated | Open | #308 |
| Stage 3 Full Real Mode | IMPLEMENTED_AND_TESTED_NOT_EXECUTED | #308 |
| Large epics need decomposition | Open | #229, #243 |
| Biome lint backlog | Open | #340 |
| Multi-process workspace lock | Not implemented | #324 |
| Remaining admin auth mismatches (5 endpoints) | Identified in #373 | — |
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
