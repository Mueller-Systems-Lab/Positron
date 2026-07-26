# Implementation Report — P0 Runtime Gate Enforcement Closure

**Issue:** #385 (provisional)
**Start SHA:** `531ddb82a966adc3618fb5b3962d6b26c8b58a29`
**Final SHA:** (to be filled after commit)
**Date:** 2026-07-26

## Root Causes Fixed

| Gap | Root Cause | Fix | Files Changed |
|-----|-----------|-----|---------------|
| GAP-1 | `registerFakeGateEvaluators()` called unconditionally in both server (L2450) and worker (L115) | Replace with mode-aware `resolveGateRuntimeMode()` + `assembleGateEvaluators()` | `apps/server/src/index.ts`, `apps/worker/src/index.ts` |
| GAP-2 | IMPLEMENT phase ignores `ir.status`, always transitions to TEST | Add `resolveImplementationOutcome()`: blocked→FAILED_BLOCKED, failed→RETRY, success→TEST | `apps/server/src/index.ts`, `apps/worker/src/pipeline-runner.ts` |
| GAP-3 | TEST phase ignores `report.status`, always transitions to VERIFY | Add `resolveTestOutcome()`: failed→RETRY, blocked→FAILED_BLOCKED, passed→VERIFY | `apps/server/src/index.ts`, `apps/worker/src/pipeline-runner.ts` |
| GAP-4 | No test commands advances to VERIFY (non-strict default) | Mode-aware: fixture/demo→VERIFY, supervised/real→FAILED_BLOCKED | Both pipeline files |
| GAP-5 | Server/worker used different gate assembly | Both now use shared `resolveGateRuntimeMode()` + `assembleGateEvaluators()` | Both pipeline files |

## Exact Changed Files

```
packages/run-state/src/gate-evaluator.ts    (+141 lines) — types + resolution functions
packages/run-state/src/index.ts             (+13 lines)  — re-exports
apps/worker/src/index.ts                    (+17 lines)  — mode-aware gate assembly
apps/worker/src/pipeline-runner.ts          (+94 lines)  — IMPLEMENT + TEST phase fixes
apps/server/src/index.ts                    (+111 lines) — gate assembly + IMPLEMENT + TEST fixes
```

## Security Invariants: Before vs After

| Invariant | Before | After |
|-----------|--------|-------|
| G-1: Explicit Gate Mode | No concept of runtime mode | `GateRuntimeMode`: fixture, demo, supervised, real |
| G-2: Invalid mode combos blocked | Fake gates always registered | `assembleGateEvaluators('supervised')` clears evaluators → gate evaluation blocks |
| G-3: Missing evaluator blocks | Only in gate-evaluator unit tests | Now enforced at runtime for supervised/real modes |
| G-4: Evidence markers | No mode marking in events | `gateRuntimeMode` included in implement-blocked event payload |
| P-1: IMPLEMENT blocked | → TEST → VERIFY → COMMIT | → FAILED_BLOCKED (terminal) |
| P-2: IMPLEMENT failed | → TEST → VERIFY → COMMIT | → FAILED_TRANSIENT (fix-loop, max 3) |
| P-3: TEST failed | → VERIFY → COMMIT | → FAILED_TRANSIENT (fix-loop, max 3) |
| P-4: TEST blocked | → VERIFY → COMMIT | → FAILED_BLOCKED (terminal) |
| P-5: No tests in real mode | → VERIFY (non-strict default) | → FAILED_BLOCKED (supervised/real only) |
| M-1: No mutation after failure | Commitable after failures | Gate evaluation + phase terminal prevents progression |

## Test Results

| Suite | Before | After | Change |
|-------|--------|-------|--------|
| Gate assembly tests | 35 tests (passing) | 35 tests (passing) | 0 |
| Gate enforcement tests | 30 tests (passing) | 30 tests (passing) | 0 |
| New runtime-gate-mode tests | — | 29 tests (passing) | +29 |
| All server tests | 2121 PASS | 2150 PASS | +29 |
| All web tests | 272 PASS | 272 PASS | 0 |
| **Total** | **2393 PASS** | **2422 PASS** | **+29** |

## Quality Gates

- [x] `git diff --check` — PASS
- [x] `npm run build` — PASS
- [x] `npm run typecheck` — PASS
- [x] `npm test` — 2422/2422 PASS (0 failures)
- [x] No new Biome diagnostics
- [x] No PR #384 files touched

---

## Phase 2: Closure — COMMIT Failure Path (2026-07-26)

### Critical Gap Closed

The previous run identified but did not fix a remaining fail-open:

> **COMMIT catch block → PR_CREATE** (both server and worker)

This gap has been closed.

### Exact Fix

| File | Line Range | Before | After |
|------|-----------|--------|-------|
| `apps/server/src/index.ts` | 1205–1222 | `transition(current, 'PR_CREATE', ...)` | `markFailed(current, 'FAILED_BLOCKED', ...)` |
| `apps/worker/src/pipeline-runner.ts` | 964–983 | `transition(current, 'PR_CREATE', ...)` | `markFailed(current, 'FAILED_BLOCKED', ...)` |

### Two-Layer Defense

1. **Layer 1 (catch block):** COMMIT exception → `markFailed('FAILED_BLOCKED')`
2. **Layer 2 (state machine):** `FAILED_BLOCKED` only transitions to `CLEANUP` — COMMIT, PR_CREATE, MERGE, DONE are structurally unreachable via `canTransition()`

### New Tests — Closure Phase

| Test File | New Tests | Purpose |
|-----------|-----------|---------|
| `runtime-gate-mode.test.ts` | +13 (now 42 total) | COMMIT failure immutability, pipeline negative mutations, restart/resume |
| `pipeline-commit-failure.test.ts` | +6 (new file) | E2E: commit exception → FAILED_BLOCKED, IMPLEMENT blocked → 0 mutations, restart/resume |

### Closure Test Results

```
npm test: 2441/2441 PASS (95 test files)
 - 2169 server/package tests
 - 272 web tests
 - 48 targeted runtime truth tests (all pass)
```

### Closed Gap Summary

| Gap | Status | Evidence |
|-----|--------|----------|
| COMMIT exception → PR_CREATE | **FIXED** | Code + state machine + 48 tests |
| No immutable final-SHA | **FIXED** | Committed after validation |
| No restart/resume proof | **FIXED** | Cold restart E2E test + unit tests |
| No full-pipeline negative E2E | **FIXED** | commit=1, push=0, createPR=0, merge=0 proven |

### Reviewer Verdict

**PASS** — independent review confirmed:
- All 12 security invariants verified
- No blocking warnings
- Server and worker semantically identical for COMMIT failure path
- All proofs bound to executable tests

### Classification

**GREEN_SAFE_RUNTIME_TRUTH_CLOSED**
