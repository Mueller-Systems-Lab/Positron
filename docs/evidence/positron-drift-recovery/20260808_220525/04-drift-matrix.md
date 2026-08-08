# 04 — Positron Full Drift Audit

**Run ID:** 20260808_220525
**Date:** 2026-08-08

---

## Executive Summary

**Is Positron still on course?** Partially. The architecture has evolved significantly from the original Python/FastAPI/React blueprint to a TypeScript/Express/Vite monorepo with 10 packages, a 28-phase state machine, BullMQ/Redis job queue, SQLite persistence, Docker deployment, and extensive testing infrastructure. This evolution is EVIDENCED and intentional, not drift.

**What actually works?** Local gates pass cleanly: build, typecheck, and 2598 combined unit tests. CI/CD pipeline (6 required checks on `main`). Server starts and serves API + UI. Fake-mode runs complete.

**What only works simulated?** Full Real Mode (Stage 3) is implemented in 9+ source files in the github-adapter but was never productively executed. All 4 core adapters (GitHub, Workspace, SpecKit, OpenCode) default to `fake` mode.

**Where is significant drift?** Version numbers (README, package.json, CHANGELOG, Git tags disagree). README Express version is wrong (claims 4, actual 5.1). Test counts in README are stale. Frontend-backend auth contract has 5 known mismatches.

**What became unnecessarily complex?** 14 active worktrees (mostly issue-340 lint tracks), 55 local branches, 85 un-deleted merged remote branches. Server index.ts grew to 4696 lines (monolithic). Duplicate pipeline logic in server and worker (both have `executePhase()`). benchmark-rudolph package has zero external consumers.

**What blocks the actual product goal?** Full Real Mode has never been proven end-to-end. Stage 3 code exists but is classified as IMPLEMENTED_AND_TESTED_NOT_EXECUTED. Without a proven real-mode vertical slice, Positron cannot claim to fulfill its primary mission (GitHub Issue → PR).

---

## North-Star Gap

```
TODAY:
  Positron builds, typechecks, and passes 2598 unit tests in fake mode.
  Server + Web UI run locally. CI gates pass. Docker Compose is configured.
  Full Real Mode is IMPLEMENTED (9 stage3-* files) but NOT EXECUTED.
  The core pipeline (Issue → Spec → Plan → Tasks → Implement → Test → Verify → PR) exists
  in code but the real-mode end-to-end path has never been walked.

TARGET:
  From a repository URL and a real GitHub Issue, Positron can reproducibly:
  1. Understand the repository
  2. Specify requirements
  3. Generate a technical plan
  4. Derive tasks
  5. Implement code
  6. Run tests and fix failures
  7. Generate evidence
  8. Create a commit
  9. Create or reuse a PR
  10. Resume after controlled process interruption
  Without duplicate GitHub mutations, cross-run contamination, secret leakage,
  or direct main-branch mutation.

DELTA:
  Items 1-7 exist in code and are test-covered, but NOT proven in real mode.
  Items 8-9 exist in code but require real-mode execution.
  Item 10 (restart/resume) was validated in fake mode (PR #419).
  Full end-to-end real-mode vertical slice has never been executed.
```

---

## Top Drift Findings (by Product Impact)

### Finding D-001: Version Drift (D8) — CRITICAL

| Field | README | package.json | Git Tags | CHANGELOG |
|-------|--------|-------------|----------|-----------|
| Version | v0.3.0 | 0.1.0 | v0.2.0-rc.1 | ? |

- No v0.3.0 tag exists. No v0.3.0 release exists.
- README badge claims v0.3.0 — this is a fabrication, not a minor oversight.
- **Impact:** Users/contributors see wrong version. Release process is incoherent.
- **Root Cause:** Version was bumped in README badge without corresponding package.json bump, git tag, or release.

### Finding D-002: Full Real Mode Never Proven (D15) — CRITICAL

- Stage 3 code (9 source files in `packages/github-adapter/src/stage3-*`) is marked `IMPLEMENTED_AND_TESTED_NOT_EXECUTED`
- All 4 adapter types (GitHub, Workspace, SpecKit, OpenCode) default to `fake` mode
- The env vars to switch to real mode exist but the path has never been walked end-to-end
- **Impact:** Positron cannot fulfill its primary mission
- **Root Cause:** Development prioritized test infrastructure and lint tracks over the core product path

### Finding D-003: Documentation Drift — README Express Version (D4) — HIGH

- README Tech Stack table says "Express 4"
- Actual dependency: `express ^5.1.0`
- **Impact:** Misleading for developers. Express 5 has breaking changes from 4.

### Finding D-004: Test Count Drift (D5) — HIGH

- README claims 2572 tests at SHA 3a9a116 (2026-08-02)
- Current HEAD (ed70487) has 2598 tests (106 files)
- README also says root tests are 84 files/2173 tests; actual: 88 files/2199 tests
- **Impact:** Every claim in README is stale. Users get wrong expectations.

### Finding D-005: Auth Contract Mismatches (D16) — HIGH

- 5 frontend API methods use `request()` (no admin token) but hit `requireAdmin`-protected endpoints:
  - `createRepo` (POST /api/repos)
  - `startRun` (POST /api/repos/:repoId/runs)
  - `saveEvidence` (POST /api/evidence)
  - `updateSafety` (POST /api/safety)
  - `cancelRun` (POST /api/runs/:id/cancel)
- **Impact:** In real mode with admin token enforcement, these operations will fail from the UI.
- **Root Cause:** Documented in known-limitations.md but never fixed.

### Finding D-006: Monolithic Server (D2) — MEDIUM

- `apps/server/src/index.ts` is 4696 lines
- Contains ALL: adapter resolution, route registration, SSE broadcasting, pipeline orchestration, gate evaluation, demo/CLI handlers
- Duplicate `executePhase()` in worker (`pipeline-runner.ts`, line 414) and server (`index.ts`, line 642)
- **Impact:** Hard to maintain, test, and reason about. Changes risk breaking unrelated features.

### Finding D-007: Branch/Worktree Explosion (D14) — MEDIUM

- 55 local branches, 14 active worktrees, 85 un-deleted merged remote branches
- 9 worktrees are for issue-340 (Biome lint) tracks
- `deletable-branches-manifest.json` exists but branches remain
- **Impact:** Cluttered workspace, confused state. Process overengineering.

### Finding D-008: Unused benchmark-rudolph Package (D12) — MEDIUM

- `packages/benchmark-rudolph/` (1915 lines of source code)
- Zero external consumers — only referenced from within itself
- Issue #279 (Rudolph Beacon) is CLOSED
- **Impact:** Dead code. Included in build chain unnecessarily.

### Finding D-009: 23 Modified + 71 Untracked Files (D19) — MEDIUM

- Working tree has 94 files of uncommitted drift from HEAD
- Includes multiple runcards, reports, and new test files that should be committed or cleaned
- `phase_next.md` (36KB), STATUS.md, NEXT.md, RUNBOOK.md — ad-hoc planning docs outside Git
- **Impact:** What is the real state of the project? Modified source files mean current HEAD may not match what was tested.

### Finding D-010: Evidence Volume vs Product Reality (D19) — LOW

- `docs/evidence/` contains 60+ issue directories with hundreds of markdown files
- `docs/evidence/positron-north-star/` contains 6 run directories (R1-R6) with FINAL-REPORTs
- `docs/evidence/finalization/` contains another run series
- `.opencode/` is 217MB of backups/evidence
- **Impact:** Evidence volume suggests activity but the core product capability (real-mode end-to-end) remains unproven. Evidence =/= product capability.

---

## Architecture Component Map

### Core Components

| Component | Purpose | Runtime? | LOC | Status |
|-----------|---------|----------|-----|--------|
| apps/server | Express backend, REST API, pipeline orchestration, SSE | Yes | 4696 (index.ts) | ACTIVE |
| apps/web | React/Vite/Tailwind frontend | Yes | ~2500 | ACTIVE |
| apps/worker | BullMQ worker, pipeline runner | Yes | 1745 (runner) + 269 (index) | ACTIVE |
| packages/run-state | 28-phase state machine + SQLite persistence | Yes | 1175 | CANONICAL |
| packages/github-adapter | GitHub API (fake/real/readonly) + stage3 policies | Yes | 8897 | ACTIVE (complex) |
| packages/shared | Types, utilities, secret manager, evidence gates | Yes | 4821 | CANONICAL |
| packages/sandbox | Git workspace + test runner + policy enforcement | Yes | 2178 | ACTIVE |
| packages/speckit-adapter | Spec Kit CLI (fake/real) | Yes | 511 | ACTIVE |
| packages/opencode-adapter | OpenCode CLI (fake/real/dry-run) | Yes | 1239 | ACTIVE |
| packages/tool-gateway | MCP tool gateway + audit + scanner | Yes | 2429 | ACTIVE |

### Non-Runtime Components

| Component | Purpose | Status |
|-----------|---------|--------|
| packages/benchmark-rudolph | Controlled real-mode probe (#279) | DEAD CODE (0 external consumers) |
| .agent-governance/ | Agent isolation policies | GOVERNANCE |
| .hermes/ | Hermes Agent config | TOOLING |
| .specify/ | Spec Kit memory (constitution) | CANONICAL |
| .opencode/ | OpenCode config + backups (217MB) | EVIDENCE/HISTORICAL |
| observability/ | Grafana/Prometheus/Alertmanager config | INFRASTRUCTURE |
| docker/ | Dockerfiles for e2e, security, test | INFRASTRUCTURE |
| e2e/ | Playwright E2E tests | TESTING |
| tests/ | Additional test infrastructure | TESTING |

### Duplication Analysis

| Pattern | Location 1 | Location 2 | Severity |
|---------|-----------|-----------|----------|
| executePhase() | apps/server/src/index.ts:642 | apps/worker/src/pipeline-runner.ts:414 | MEDIUM |
| Pipeline orchestration | apps/server/src/index.ts | apps/worker/src/pipeline-runner.ts | MEDIUM |
| Adapter resolution | apps/server/src/index.ts (resolve* functions) | apps/worker (via DI) | LOW |
| Gate evaluation | apps/server/src/index.ts:2558 | packages/run-state/src/state-machine.ts | LOW |

---

## Canonicity Matrix (Selected Claims)

| Claim | Source | Still Current? | Implemented? | Tested? | Verdict |
|-------|--------|---------------|-------------|---------|---------|
| "28-Phase Pipeline" | README, Blueprint | Yes | Yes | Yes | CANONICAL |
| "Evidence-gated progression" | Constitution, README | Yes | Partial | Partial | IMPLEMENTATION_DRIFT |
| "GitHub Issue → PR" (primary mission) | North Star | Yes | Never proven real-mode | Fake-mode only | IMPLEMENTATION_DRIFT |
| "Express 4" | README Tech Stack | No (actual: 5.1) | N/A | N/A | DOCUMENTATION_DRIFT |
| "v0.3.0" | README badge | No (actual: 0.1.0) | N/A | N/A | VERSION_DRIFT |
| "2572 tests" | README | No (actual: 2598) | N/A | N/A | DOCUMENTATION_DRIFT |
| "Stage 3 Full Real Mode" | known-limitations.md | Yes | Yes (code) | No (not executed) | IMPLEMENTATION_DRIFT |
| "Red negative tests for safety" | current-capabilities.md | Yes | Yes | Yes | CANONICAL |
| "Kill-switch blocks merges" | README, Server | Yes | Yes | Yes | CANONICAL |
| "Spec before Code" | Constitution II | Yes | Yes | Yes | CANONICAL |
| "Resume by State" | Constitution VIII | Yes | Yes (PR #419) | Yes | CANONICAL |

---

## Drift Taxonomy (All Findings)

| ID | Category | Severity | Summary |
|----|----------|----------|---------|
| D-001 | D8 VERSION_DRIFT | CRITICAL | README v0.3.0 ≠ package.json 0.1.0 ≠ tags v0.2.0-rc.1 |
| D-002 | D15 FAKE_REAL_MODE_DRIFT | CRITICAL | Full Real Mode never executed, code is IMPLEMENTED_AND_TESTED_NOT_EXECUTED |
| D-003 | D4 DOCUMENTATION_DRIFT | HIGH | README says Express 4, actual dependency is 5.1.0 |
| D-004 | D5 TEST_REALITY_DRIFT | HIGH | README test counts stale (2572 vs actual 2598) |
| D-005 | D16 UI_BACKEND_CONTRACT_DRIFT | HIGH | 5 auth contract mismatches (UI request() vs server requireAdmin) |
| D-006 | D2 ARCHITECTURE_DRIFT | MEDIUM | Server index.ts 4696 lines, duplicate executePhase() in worker |
| D-007 | D14 PROCESS_OVERENGINEERING | MEDIUM | 55 branches, 14 worktrees, 85 un-deleted merged branches |
| D-008 | D12 DEAD_CODE_DRIFT | MEDIUM | benchmark-rudolph package has 0 external consumers |
| D-009 | D19 EVIDENCE_DRIFT | MEDIUM | 94 uncommitted files (23M + 71 untracked) |
| D-010 | D19 EVIDENCE_DRIFT | LOW | Evidence volume > product capability |
| D-011 | D18 GOVERNANCE_DRIFT | LOW | deletable-branches-manifest.json exists but branches not deleted |
| D-012 | D13 DUPLICATION_DRIFT | MEDIUM | Server + worker both have pipeline orchestration logic |
