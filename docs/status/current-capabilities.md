# Current Capabilities — Positron

## Status

As of 2026-08-02 at SHA `3a9a116` (post R3-R2 test-truth and documentation synchronization).

## Local Gates

| Gate | Result |
|------|--------|
| `git diff --check` | PASS |
| `npx biome format .` | PASS |
| `npm run build` | PASS |
| `npm run typecheck` | PASS |
| `npm test` (root) | PASS — **2173/2173** (84 test files, Vitest 4.1.7, node) |
| `npm test` (web) | PASS — **399/399** (18 test files, Vitest 1.6.1, jsdom) |
| **Combined Unique Unit** | **2572/2572** (102 files, 0 overlap) |
| `npx biome check .` | advisory-only (known lint backlog, [#340](https://github.com/xxammaxx/Positron/issues/340)) |

## Required CI Checks (Branch Protection)

6 checks are required for merge to `main`:

| Check | Description |
|-------|-------------|
| `format-check` | Biome format — all files |
| `differential-lint` | Differential Biome lint — new/worsened only |
| `build` | TypeScript build — all packages |
| `typecheck` | TypeScript typecheck |
| `unit-tests` | `npm ci` → `npm test` (self-contained: pretest → build → root + Web Vitest) |
| `observability-config-check` | Prometheus/Alertmanager config validation |

Advisory CI jobs: `full-lint-report`, `e2e-playwright`, `mutation-fast`, `mutation-safety`, `tool-gateway-windows`.

CI policy: [`.opencode/policies/ci-policy.md`](.opencode/policies/ci-policy.md) (v2, effective 2026-08-02).

## Implemented Capabilities

### CI Policy v2

- Local gates are mandatory pre-PR gates.
- Remote CI is required for protected-branch merge (6 required checks).
- Advisory jobs are explicitly labeled.
- Manual reruns and workflow edits require authorization.
- Policy supersedes CI Policy v1 (2026-06-21).

### Rudolph Beacon Benchmark (#279, CLOSED)

- `packages/benchmark-rudolph/` package on main with controlled real-mode probe.
- Red-negative tests for safety gate enforcement.
- PR #295 merged; Issue #279 closed.
- CodeRabbit decommissioned as part of this track.

### CI Recovery (#268, CLOSED)

- PR #296 merged: repaired workflow configuration and formatting gates.
- PR #415 merged (R3-R1): proved self-contained clean-checkout test contract.
- GitHub Actions Quality Gates are syntactically valid and executable.
- Remote CI is now required for merge (branch protection).

### Post-268 Fixes (#297/#298/#299, CLOSED)

- **#297:** Flaky Playwright E2E test stabilized.
- **#298:** Biome JSON formatting warnings resolved.
- **#299:** Windows runner module resolution fixed (PR #303).

### Post-Merge Quality Gates Fix (#371/#372/#373, CLOSED)

- **#371:** DashboardPage crash (TypeError on `undefined.replace()`) repaired.
- **#373:** Auth contract fixed — `startDemoRun()` now uses `adminRequest()`.
- E2E Runtime Proof (2026-07-17): local Playwright run confirmed auth contract end-to-end.

### Portfolio Gap Discovery (PR #309, MERGED)

- Comprehensive audit of all 14 open + 91 closed issues.
- 24 capability areas assessed.
- 4 new issues created: #305, #306, #307, #308.

### DeterministicFixtureAgent / OpenCodeDryRunAgent

- Reproducible fixture-based adapter testing.
- Safe dry-run simulation for risky OpenCode actions.

### Tool Gateway with Red Team Tests

- MCP tool gateway enforces: shell injection blocking, path traversal prevention, secret redaction, egress policy, prompt injection detection, autonomy level gating, and approval bypass prevention.

### Safety Architecture

- Kill-switch, push gate, evidence-gated progression, audit trail enforcement.
- Max fix loops: automatic stop after 3 failed attempts.

### Stage 1–3: Read-Only → Write → Runtime Foundation (#308)

- Stage 1: Real GitHub adapter read operations validated (7/7 reads, 0 writes).
- Stage 2: Single controlled write to `xxammaxx/positron-sandbox#1`.
- Stage 3: Runtime Foundation implemented with 345 github-adapter tests.
- Five remediation modules integrated via PR #370.

## Test Breakdown

At SHA `3a9a116` (2026-08-02):

| Suite | Files | Tests | Runner |
|-------|-------|-------|--------|
| Root (packages + apps/server) | 84 | 2173 | Vitest 4.1.7 |
| Web (apps/web) | 18 | 399 | Vitest 1.6.1 |
| **Combined Unique Unit** | **102** | **2572** | — |

Root and Web test files are provably disjoint (0 overlap).

## Active Backlog

For the live backlog, use the [GitHub open-issues view](https://github.com/xxammaxx/Positron/issues?q=is%3Aissue+is%3Aopen).
This document lists only limitations directly relevant to the verified
capability snapshot at SHA `3a9a116`.

Currently open issues relevant to this capability snapshot:

| Issue | Title | Risk | Priority |
|-------|-------|------|----------|
| #308 | Validation: Supervised Full Real Mode pilot | YELLOW | P1 |
| #340 | Repo hygiene: resolve repo-wide Biome lint backlog | YELLOW | P2 |
| #416 | Docs: synchronize post-R3 test truth and CI policy | GREEN_SAFE | P2 |

## Resolved / Retired

Issues that were previously tracked as active but are now closed:

| Issue | Title | Resolution |
|-------|-------|------------|
| #304 | Stabilize Playwright tracing lifecycle | CLOSED (2026-07-30) |
| #305 | Evidence Portfolio: Automate post-run updates | CLOSED (2026-06-27) |
| #306 | Backlog Hygiene: milestones, labels, taxonomy | CLOSED (2026-06-27) |
| #229 | MCP Bootstrap Epic | CLOSED — not_planned (2026-07-30) |
| #243 | Agentic Baseline Epic | CLOSED — not_planned (2026-07-30) |
| #215 | GATE_APPROVE safety integration | CLOSED (2026-06-28) |
| #324 | Multi-process workspace lock | CLOSED (2026-07-30) |

## Evidence References

<!-- positron:auto-generated:start evidence-refs -->
| Issue/PR | Description | Status |
|----------|-------------|--------|
| #268 | CI infrastructure tracker | CLOSED |
| #279 | Rudolph Beacon benchmark | CLOSED |
| #296 | CI workflow repair | Merged |
| #309 | Portfolio Gap Discovery | Merged |
| #372 / #373 | Demo-Run Admin Auth Contract Repair | CLOSED |
| #414 | R3 CI Contract Evidence | CLOSED |
| #415 | R3-R1 CI Self-Contained Proof | Merged |
| #416 | R3-R2 Test-Truth and Doc Sync | OPEN |
<!-- positron:auto-generated:end evidence-refs -->
