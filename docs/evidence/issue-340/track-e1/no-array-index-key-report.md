# Track E1 — `noArrayIndexKey` Implementation Report

**Issue:** #340
**Track:** E1 — `lint/suspicious/noArrayIndexKey`
**Date:** 2026-07-29

---

## 1. Source of Truth

| Field | Value |
|---|---|
| **HISTORICAL_BASE_SHA** | `67064a85e76f4998d3d5e983cf96e745d8a543df` |
| **HISTORICAL_HEAD_SHA** | `dbea8e8c879952db164a0ae6c944d92131f5db20` |
| **CURRENT_BASE_SHA** | `84dac528e1f694848f9dc655f068576ebb3f19b3` |
| **VALIDATED_CODE_SHA** | `2ffc89a14f8e1186a482bf0d14481e26015bd475` |
| **CODE_CI_RUN** | `30449512162` |
| **SELF_REFERENTIAL_SHA_EMBEDDED** | NO |
| **BIOME_VERSION** | 1.9.4 |

---

## 2. Baseline (7 diagnostics)

Captured from `84dac528` (current main) via `npx biome lint . --only=lint/suspicious/noArrayIndexKey --reporter=json`.

| # | File | Category |
|---|---|---|
| 1 | `dashboard/StatusSummary.tsx` | SKELETON |
| 2 | `dashboard/RecentActivity.tsx` | SKELETON |
| 3 | `projects/ProjectsPage.tsx` | DATA_LIST (blockers) |
| 4 | `projects/ProjectsPage.tsx` | DATA_LIST (nextRecommendedRuns) |
| 5 | `runs/RunsPage.tsx` | SKELETON |
| 6 | `shared/LoadingSkeleton.tsx` | SKELETON (table) |
| 7 | `shared/LoadingSkeleton.tsx` | SKELETON (text) |

**SKELETON: 5 | DATA_LIST: 2 | TOTAL: 7**

---

## 3. Key Strategy (Current-Base Closure)

| Strategy | Sites | Mechanism |
|---|---|---|
| **Fixed skeleton slot groups** | 3 (RecentActivity, StatusSummary, RunsPage) | Named `as const` string arrays — compile-time stable keys |
| **Deterministic dynamic slots** | 2 (LoadingSkeleton table + text) | `createSkeletonSlots()` — pure function, prefix-position keys, zero-based position for width calc |
| **Duplicate-safe content keys** | 2 (ProjectsPage blockers + nextRecommendedRuns) | `createStableTextItems()` — deterministic, position-independent, per-value occurrence counter via `JSON.stringify([value, occurrence])` |

```text
FIXED_SKELETON_SLOT_GROUPS:  3
DETERMINISTIC_DYNAMIC_SLOTS:  2
DATA_LIST_LOCATIONS:          2
COMPOUND_INDEX_KEYS:          0
RANDOM_KEYS:                  0
SUPPRESSIONS:                 0
```

---

## 4. Changed Files

| # | File | Change |
|---|---|---|
| 1 | `apps/web/src/components/dashboard/RecentActivity.tsx` | Added `RECENT_ACTIVITY_SKELETON_SLOTS` constant (4 slots) |
| 2 | `apps/web/src/components/dashboard/StatusSummary.tsx` | Added `STATUS_SUMMARY_SKELETON_SLOTS` constant (4 slots) |
| 3 | `apps/web/src/components/shared/LoadingSkeleton.tsx` | Added `SkeletonSlot` interface and `createSkeletonSlots()` export; replaced index keys with deterministic prefix-position keys; removed both `biome-ignore` suppressions |
| 4 | `apps/web/src/components/projects/ProjectsPage.tsx` | Added `StableTextItem` interface and `createStableTextItems()` helper |
| 5 | `apps/web/src/components/runs/RunsPage.tsx` | Added `RUNS_PAGE_SKELETON_SLOTS` constant (8 slots) |
| 6 | `apps/web/src/__tests__/track-e1-no-array-index-key.test.tsx` | 36 focused tests: helper correctness, rendering integrity, skeleton counts, rerender identity, Unicode safety, suppression audit |
| 7 | `docs/evidence/issue-340/track-e1/no-array-index-key-report.md` | This file |

---

## 5. Diagnostics — Current-Base Closure

### 5.1 Targeted noArrayIndexKey

```text
BASE_CAPTURED:    7 (current main 84dac528)
HEAD_CAPTURED:    0 (current branch 2ffc89a)
REPO_WIDE_AFTER:  0
INTRODUCED:       0
SUPPRESSIONS:     0
```

### 5.2 Differential Lint (Current Base 84dac528 → Head 2ffc89a)

```text
NEW:        0
WORSENED:   0
REMOVED:    5 (all noArrayIndexKey unique keys eliminated)
UNCHANGED:  3 (pre-existing errors in RunsPage.tsx — outside Track E1 scope)
IMPROVED:   0
RESULT:     PASS
```

---

## 6. Tests (Current-Base Closure)

All verified at validated code SHA `2ffc89a`:

| Test Suite | Tests | Passed | Failed |
|---|---|---|---|
| **Focused E1 tests** | 36 | 36 | 0 |
| **Web tests** (`@positron/web`) | 366 | 366 | 0 |
| **Full repo tests** | 2392 | 2392 | 0 |
| **E2E (Playwright)** | 26 | 26 | 0 |
| **Differential lint engine** | 90 | 90 | 0 |

Local gate exits:

```text
FORMAT:         PASS
LINT (changed): PASS
TARGETED_NO_ARRAY_INDEX_KEY: 0
BUILD:          PASS
TYPECHECK:      PASS
DIFF_CHECK:     PASS
```

---

## 7. Gates

### Historical CI Runs (Stale Base)

| Run | Commit | Result | Note |
|---|---|---|---|
| 29912525824 | `d846d7c` | failure | Format drift in initial commit |
| 29913783527 | `286ce90b` | failure | Pre-existing repo backlog blocked lint |
| 29920957695 | `ac3ea2c` | failure | Documentation-only, same backlog |

### Current-Base Code CI Run (`30449512162`) — Validated Code SHA `2ffc89a`

```text
WORKFLOW_RUN:         30449512162
WORKFLOW_CONCLUSION:  success
FORMAT_CHECK:         PASS
DIFFERENTIAL_LINT:    PASS
ENGINE_TESTS:         EXECUTED / PASS
FULL_LINT_REPORT:     PASS (advisory)
BUILD:                PASS
TYPECHECK:            PASS
UNIT_TESTS:           PASS
E2E_PLAYWRIGHT:       PASS
MUTATION_FAST:        PASS
MUTATION_SAFETY:      PASS
TOOL_GATEWAY_WINDOWS: PASS
OBSERVABILITY_CONFIG: PASS
```

---

## 8. Compliance

```text
BIOME_CONFIG_CHANGED:     NO
DEPENDENCIES_CHANGED:     NO
LOCKFILE_CHANGED:         NO
WORKFLOW_CHANGED:         NO
REAL_MODE_EXECUTED:       NO
STAGE3_LIVE_EXECUTED:     NO
VISIBLE_UI_TEXT_CHANGED:  NO
API_CALLS_CHANGED:        NO
LIST_ORDER_CHANGED:       NO
SKELETON_COUNTS_CHANGED:  NO
SECURITY_LOGIC_CHANGED:   NO
EXTERNAL_WRITE_ADDED:     NO
```

---

## 9. Suppression Audit

```text
SUPPRESSIONS_BEFORE: 2 (LoadingSkeleton table + text)
SUPPRESSIONS_AFTER:  0
REVIEWED_FILES:      7
MATCHES:             0
```

---

## 10. Remaining Backlog

The general repo-wide Biome lint still fails due to unrelated backlog tracked in Issue #340. This track only addressed `noArrayIndexKey`.

```text
MERGE_AUTHORIZED:         NO
ISSUE340_CLOSED:          NO
```
