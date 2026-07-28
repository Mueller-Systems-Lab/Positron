# Track D2b — `noLabelWithoutControl` Evidence Report

## 1. Reality Refresh

```
PRIMARY_WORKSPACE: /media/xxammaxx/projekte/Positron
PRIMARY_WORKSPACE_DIRTY_PREEXISTING: YES (README.md modified, docs/release/ modified, multiple untracked files)
PRIMARY_WORKSPACE_TOUCHED_BY_THIS_RUN: NO
PRIMARY_WORKSPACE_MODIFIED_TRACKED_COUNT: 2
PRIMARY_WORKSPACE_UNTRACKED_COUNT: 14
PRIMARY_WORKSPACE_STASH_COUNT: 4
```

## 2. PR #377 Metadata Correction

PR #377 body was updated to reflect the correct SVG classification:

```
SVG_DECORATIVE_TOTAL: 14
CLASS_A: 8
CLASS_B: 0
CLASS_C: 3
CLASS_D: 3
CLASS_E: 0
ACCESSIBILITY_TESTS: 31/31 passed
MERGE_COMMIT: e11d875d9a60e098f907ea62226b84965769171d
```

## 3. D2a Process Truth Mirror

Posted on Issue #340. PR #377 is GREEN_SAFE merged. D2a worktree has unexplained changes: `docs/release/ui-workflow-proof-report.md` and `package-lock.json`. Classification: `AMBER_REVIEW_WORKTREE_REALITY_DRIFT`.

## 4. Primary Workspace State

- HEAD: `531ddb82a966adc3618fb5b3962d6b26c8b58a29`
- origin/main: `e11d875d9a60e098f907ea62226b84965769171d`
- Branch: `main`
- Dirty: YES (pre-existing)

## 5. Old D2a Worktree State

```
D2A_WORKTREE_EXISTS: YES
D2A_WORKTREE_DIRTY: YES
D2A_UNEXPLAINED_PATHS:
- docs/release/ui-workflow-proof-report.md (modified)
- package-lock.json (modified)
- docs/release/ui-workflow-proof/ (untracked)
D2A_WORKTREE_REUSED: NO
```

## 6. New D2b Worktree

```
D2B_WORKTREE_PATH: /media/xxammaxx/projekte/Positron-worktrees/issue-340-d2b-label-control
D2B_BRANCH: positron/issue-340-track-d2b-label-control
D2B_BASE_SHA: e11d875d9a60e098f907ea62226b84965769171d
D2B_WORKTREE_INITIAL_CLEAN: YES
D2B_HEAD_EQUALS_ORIGIN_MAIN: YES
```

## 7. Exact Rule Invocation

```bash
npx @biomejs/biome lint . --only=lint/a11y/noLabelWithoutControl --reporter=json
```

## 8. Baseline

```json
{
  "summary": {
    "errors": 7,
    "warnings": 0,
    "unchanged": 383
  }
}
```

7 `noLabelWithoutControl` diagnostics in scope across 4 files.

## 9. Complete Case Table

| # | File | Label Text | Current Element | Implied Control | Class | Fix |
|---|------|-----------|-----------------|-----------------|-------|-----|
| 1 | Repositories.tsx | Owner | `<label>` | `<input type="text">` | A | htmlFor="repo-owner" + id="repo-owner" |
| 2 | Repositories.tsx | Repository-Name | `<label>` | `<input type="text">` | A | htmlFor="repo-name" + id="repo-name" |
| 3 | Dashboard.tsx | Repository | `<label>` | `<input type="text">` | A | htmlFor="dashboard-repo" + id="dashboard-repo" |
| 4 | Dashboard.tsx | Issue-Nummer | `<label>` | `<input type="number">` | A | htmlFor="dashboard-issue" + id="dashboard-issue" |
| 5 | Dashboard.tsx | Autonomie-Level | `<label>` | Radio group (3 radios) | E | `<fieldset>` + `<legend>` |
| 6 | VoiceControls.tsx | Speak these events: | `<label>` | Checkbox group (6 dynamic) | E | `<fieldset>` + `<legend>` |
| 7 | NewRunModal.tsx | Issue URL | `<label>` | `<input type="text">` | A | htmlFor="new-run-issue-url" + id="new-run-issue-url" |

## 10. Classification Summary

```
CLASS_A: 5
CLASS_B: 0
CLASS_C: 0
CLASS_D: 0
CLASS_E: 2
CLASS_F: 0
CLASS_G_AMBIGUOUS: 0
```

## 11. Implementation

### Class A (5 fixes) — htmlFor + id pairs

| # | File | htmlFor | id |
|---|------|---------|-----|
| 1 | Repositories.tsx | `repo-owner` | `repo-owner` |
| 2 | Repositories.tsx | `repo-name` | `repo-name` |
| 3 | Dashboard.tsx | `dashboard-repo` | `dashboard-repo` |
| 4 | Dashboard.tsx | `dashboard-issue` | `dashboard-issue` |
| 5 | NewRunModal.tsx | `new-run-issue-url` | `new-run-issue-url` |

### Class E (2 fixes) — fieldset + legend

| # | File | Change |
|---|------|--------|
| 6 | Dashboard.tsx | `<div>` → `<fieldset>`, `<label>Autonomie-Level</label>` → `<legend>` |
| 7 | VoiceControls.tsx | `<div>` → `<fieldset>`, `<label>Speak these events:</label>` → `<legend>` |

### Invariants Preserved

```
LABEL_TEXT_CHANGED: NO
CONTROL_TYPE_CHANGED: NO
HANDLER_CHANGED: NO
VALIDATION_CHANGED: NO
DEFAULT_VALUE_CHANGED: NO
FORM_SUBMISSION_CHANGED: NO
LAYOUT_CLASS_CHANGED: NO
```

Tailwind Preflight resets `<fieldset>` (border:0, padding:0, margin:0) and `<legend>` (padding:0). No visual regressions.

## 12. ID Strategy

Die fünf in Track D2b eingeführten statischen ID-Literale sind untereinander eindeutig.

Dieser Test rendert keine mehrfachen Komponenteninstanzen. Die Produktionssicherheit der statischen IDs wird zusätzlich durch die aktuelle Router- und Komponentenarchitektur begründet:

- Repositories wird als separate /repos-Route gerendert.
- Dashboard.tsx ist nicht im aktuellen App-Router eingebunden.
- DashboardPage mountet genau eine NewRunModal-Instanz.
- VoiceControls erhielt durch Track D2b keine neuen statischen Control-IDs (bestehende IDs aus D2a).

MULTI_INSTANCE_RENDER_TEST: NOT_APPLICABLE_TO_CURRENT_PRODUCTION_TOPOLOGY
STATIC_ID_NAMESPACE_DUPLICATES: 0
PRODUCTION_ID_COLLISION_PATH: NONE_FOUND

## 13. Targeted Accessibility Tests

```
ACCESSIBILITY_TEST_FILE: apps/web/src/__tests__/track-d2b-label-control-accessibility.test.tsx
ACCESSIBILITY_TESTS: 18/18 passed

Test suites:
- Repositories.tsx Label-Control Associations (3 tests)
- Dashboard.tsx Label-Control Associations (3 tests)
- Dashboard.tsx Autonomie-Level Radio Group (3 tests)
- NewRunModal.tsx Label-Control Association (2 tests)
- VoiceControls.tsx Speak These Events Checkbox Group (6 tests)
- Static D2b ID namespace verification (1 test)
```

Key verifications:
- `getByLabelText()` works for all 5 Class A inputs
- All labels have `for` attribute matching control `id`
- Radio group uses `<fieldset>` + `<legend>` semantics
- Checkbox group uses `<fieldset>` + `<legend>` semantics
- Five declared D2b static ID literals are mutually unique (namespace check — no multi-instance render claim)
- Existing voice-select, rate-slider, volume-slider labels still work (no regression)

## 14. Rule Delta

| Metric | Before | After | Delta |
|--------|-------:|------:|------:|
| `noLabelWithoutControl` diagnostics | 7 | 0 | -7 |
| RULE_EXIT_CODE | 1 | 0 | ✅ |
| NEW_DIAGNOSTICS | 0 | 0 | 0 |

## 15. Complete Gates

### Format & Static
- `npx @biomejs/biome format` (changed files): ✅
- `git diff --check`: ✅
- `npm --workspace @positron/web run typecheck`: ✅ (no errors)
- `npm --workspace @positron/web run build`: ✅ (built successfully)

### Tests
| Suite | Result |
|-------|--------|
| `npm test` (web workspace) | 321/321 ✅ |
| `npm run test:contracts` | 168/168 ✅ |
| `npm run test:integration` | 20/20 ✅ |
| `npx playwright test` (fake mode) | 26/26 ✅ |
| `npm run test:mutation:fast` | 83.06% ✅ |
| `npm run test:mutation:safety` | 84.33% ✅ |
| `npm run observability:validate` | Docker config valid ✅ |

### Scope Gate
```
ARTIFACT_PANEL_CHANGED: NO
PACKAGE_LOCK_CHANGED: NO
BIOME_CONFIG_CHANGED: NO
WORKFLOW_CHANGED: NO
DOCS_RELEASE_CHANGED: NO
NO_SVG_WITHOUT_TITLE_CHANGED: NO
USE_BUTTON_TYPE_CHANGED: NO
UNRELATED_FORMATTING: NO
```

Changed files (5):
1. `apps/web/src/components/Repositories.tsx`
2. `apps/web/src/components/Dashboard.tsx`
3. `apps/web/src/components/VoiceControls.tsx`
4. `apps/web/src/components/dashboard/NewRunModal.tsx`
5. `apps/web/src/__tests__/track-d2b-label-control-accessibility.test.tsx` (new)

## 16. Security

```
REAL_MODE_EXECUTED: NO
STAGE3_EXECUTED: NO
SECRETS_DISCLOSED: NO
```

## 17. Remaining Issue #340 Tracks

- Track D3: `useButtonType` (remaining 2 cases in ArtifactPanel.tsx — BLOCKED)
- Track D4, D5: PLANNED
- Track E: PLANNED

## 18. Acceptance Criteria

```
NO_LABEL_WITHOUT_CONTROL_IN_SCOPE: 0 ✅
UNLABELED_CONTROLS_INTRODUCED: 0 ✅
STATIC_ID_NAMESPACE_DUPLICATES: 0 ✅ (declared literals mutually unique)
LABEL_TARGET_MISMATCHES: 0 ✅
NEW_BIOME_DIAGNOSTICS: 0 ✅
ISSUE340: OPEN (not closed) ✅
MULTI_INSTANCE_RENDER_TEST: NOT_APPLICABLE_TO_CURRENT_PRODUCTION_TOPOLOGY ✅
PRODUCTION_ID_COLLISION_PATH: NONE_FOUND ✅
```

## 19. Merge-Closure Metadata

```
PR_INITIAL_HEAD: 9f3c94bc3979409a5544dba6011d2e791b4e0556

FINAL_SOURCE_FILES_CHANGED_IN_CLOSURE: 0
```
