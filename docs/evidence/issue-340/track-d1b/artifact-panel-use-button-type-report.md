# Track D1b — ArtifactPanel `useButtonType` Closure Report

## 1. Benennungs-Truth-Mirror

- Track D1 closed 51 `useButtonType` cases outside of `ArtifactPanel.tsx`.
- Two `useButtonType` source diagnostics in `ArtifactPanel.tsx` were excluded from D1 due to the security boundary (`dangerouslySetInnerHTML`).
- These two remaining cases are treated as **Track D1b**.
- The designation **Track D3** remains reserved for `noUnusedTemplateLiteral` per existing evidence.
- The existing `noDangerouslySetInnerHtml` finding is NOT part of D1b and remains open for a separate security track.

## 2. Reality Refresh

| Check | Value |
|---|---|
| `origin/main` SHA | `ee47b41b37e607f6f74650b5f9125a39e56d9d87` |
| PR #378 merged | YES (2026-07-20T19:43:59Z) |
| `ArtifactPanel.tsx` changed since expected SHA | NO |
| Issue #340 state | OPEN |
| Primary workspace dirty (pre-existing) | YES (README.md, docs/release/) |
| Primary workspace touched by this run | NO |

## 3. Worktree Isolation

| Check | Value |
|---|---|
| Branch | `positron/issue-340-track-d1b-artifact-button-type` |
| Worktree path | `/media/xxammaxx/projekte/Positron-worktrees/issue-340-d1b-artifact-button-type` |
| Initial HEAD | `ee47b41b37e607f6f74650b5f9125a39e56d9d87` |
| Initial clean | YES |
| HEAD equals origin/main | YES |
| No collision with existing worktrees/branches | YES |

## 4. Biome Version

```
Version: 1.9.4
```

## 5. Exact Rule Invocation

```bash
npx @biomejs/biome@1.9.4 lint \
  apps/web/src/components/ArtifactPanel.tsx \
  --only=lint/a11y/useButtonType
```

## 6. Baseline

**Before**: 2 `useButtonType` violations

1. Download button (line ~83): missing `type` prop
2. Tab button inside `TABS.map()` (line ~95): missing `type` prop

**After**: 0 violations — "Checked 1 file in 1465µs. No fixes applied." (exit 0)

## 7. Two-Case Classification

| # | Button | Handler | Form Context | Target Type |
|---|---|---|---|---|
| 1 | Download | `handleDownload` | none | `button` |
| 2 | Tab selection | `setActiveTab(tab.kind)` | none | `button` |

## 8. Form Context Verification

```bash
rg -n '<form|onSubmit|<ArtifactPanel' apps/web/src
```

Result: Only `<ArtifactPanel runId={run.id} />` in `RunDetail.tsx:327` — no form ancestor.
- `ARTIFACT_PANEL_FORM_ANCESTOR_FOUND`: NO
- `ARTIFACT_PANEL_ON_SUBMIT_CONTEXT_FOUND`: NO

## 9. Exact Source Diff

```diff
@@ -81,6 +81,7 @@
 				<h3 ...>Artefakte</h3>
 				{artifact && (
 					<button
+						type="button"
 						onClick={handleDownload}
 						className="..."
 					>
@@ -93,6 +94,7 @@
 			<div className="flex gap-1 mb-3">
 				{TABS.map((tab) => (
 					<button
+						type="button"
 						key={tab.kind}
 						onClick={() => setActiveTab(tab.kind)}
 						className={`...`}
```

- **Lines added**: 2
- **Lines removed**: 0
- **`type="button"` additions**: 2
- **Source button nodes changed**: 2
- **Indentation preserved**: YES (6 tabs, matching existing props)

## 10. Focused Tests

Test file: `apps/web/src/__tests__/artifact-panel-button-type.test.tsx`

| # | Test | Status |
|---|---|---|
| 1 | download button has `type="button"` | ✅ |
| 2 | all four tab buttons have `type="button"` | ✅ |
| 3 | five total rendered buttons all have `type="button"` | ✅ |
| 4 | tab click does not submit enclosing form | ✅ |
| 5 | download click does not submit enclosing form | ✅ |
| 6 | tab click triggers artifact fetch for correct kind | ✅ |
| 7 | download creates blob and triggers anchor click | ✅ |
| 8 | error state when artifact fetch fails | ✅ |
| 9 | fallback error for non-Error rejections | ✅ |

All 9 tests pass.

## 11. Form Submit Negative Tests

- `FORM_SUBMIT_CALLS_AFTER_TAB_CLICK`: 0
- `FORM_SUBMIT_CALLS_AFTER_DOWNLOAD_CLICK`: 0

## 12. Security Sentinel

| Check | Value |
|---|---|
| `HIGHLIGHT_DIFF_LINE` changed | NO |
| `renderContent` changed | NO |
| `dangerouslySetInnerHTML` changed | NO |
| `artifact.content` handling changed | NO |
| `createObjectURL`/`revokeObjectURL` changed | NO |
| Download handler changed | NO |
| Tab handler changed | NO |
| Security line CONTENT diff | MATCH (line numbers shifted +2 only) |

## 13. Rule Delta

| Metric | Before | After |
|---|---|---|
| `useButtonType` diagnostics | 2 | 0 |
| Affected files | 1 | 0 |
| Rule exit code | error | 0 |
| New diagnostics | — | 0 |

## 14. Full Gates

| Gate | Status |
|---|---|
| `git diff --check` | ✅ clean |
| Test file format (Biome) | ✅ clean |
| Web typecheck (`tsc --noEmit`) | ✅ pass |
| Web build (`tsc && vite build`) | ✅ pass (pre-existing node:* externalization warnings only) |
| D1b unit tests (9 tests) | ✅ all pass |
| Web test suite (175 of 248 pass) | ✅ D1b tests pass; 73 pre-existing `decision-manifest.js` failures unrelated |
| Monorepo test suite (1152 of 1153 pass) | ✅ D1b no regression; 1 pre-existing shared build failure |

## 15. Remaining `dangerouslySetInnerHTML` Finding

| Check | Value |
|---|---|
| `dangerouslySetInnerHTML` present | YES |
| `dangerouslySetInnerHTML` changed | NO |
| Existing security finding closed | NO |
| Existing security finding remains RED_BLOCK | YES |
| HTML escaping changed | NO |
| Artifact content trust model changed | NO |
| Security fix included | NO |

## 16. Final Commit and PR Head

- Branch: `positron/issue-340-track-d1b-artifact-button-type`
- Commits: See git log on branch
- PR: Draft against `main`
- Merge: NOT authorized

## 17. Issue #340

Issue #340 remains OPEN. This track closes only the two `useButtonType` diagnostics in `ArtifactPanel.tsx`.
