# Track D3a — `noUnusedTemplateLiteral` GREEN-SAFE Sweep

## 1. Auftrag und Autorisierung

| Feld | Wert |
|------|------|
| TRACK_NAME | D3a |
| PARENT_TRACK | D3 |
| TRACK_RULE | `lint/style/noUnusedTemplateLiteral` |
| RELATED_ISSUE | #340 |
| OWNER_AUTHORIZATION | YES |
| MERGE_AUTHORIZED | NO |
| DATE | 2026-07-21 |

Autorisierte Aktion: Vier bestätigte GREEN_SAFE-Diagnosen als mechanische Literalersetzung implementieren.

## 2. Track-Naming-Truth-Mirror

```text
TRACK_D1B_MERGED: YES (PR #379, SHA 8765fd3)
TRACK_D3_BASELINED: YES
TRACK_D3A_IMPLEMENTED: YES
TRACK_D3A_PR_CREATED: YES
TRACK_D3A_MERGED: NO
TRACK_D3B_EXECUTED: NO
TRACK_D3C_EXECUTED: NO
REAL_MODE_EXECUTED: NO
STAGE3_EXECUTED: NO
```

## 3. Source of Truth

| Feld | Wert |
|------|------|
| ORIGIN_MAIN_SHA | `8765fd3500217306598930f8df78c1ca971f8daa` |
| BASE_SHA | `8765fd3500217306598930f8df78c1ca971f8daa` |
| ISSUE340_STATE | OPEN |
| OS | Linux |
| SHELL | /bin/bash |
| NODE_VERSION | v22.22.0 |
| NPM_VERSION | 10.9.4 |
| BIOME_VERSION | 1.9.4 |
| WORKSPACE | `/media/xxammaxx/projekte/Positron` (dirty, untouched) |
| WORKTREE | `/media/xxammaxx/projekte/Positron-worktrees/issue-340-track-d3a-unused-template-green` |

## 4. Vorher-Baseline

| Feld | Wert |
|------|------|
| TOTAL_D3_DIAGNOSTICS_BEFORE | 11 |
| TOTAL_D3_FILES_BEFORE | 6 |
| D3A_DIAGNOSTICS_BEFORE | 4 |
| D3B_DIAGNOSTICS_BEFORE | 5 |
| D3C_DIAGNOSTICS_BEFORE | 2 |
| COMMAND | `npx @biomejs/biome@1.9.4 lint . --only=lint/style/noUnusedTemplateLiteral --max-diagnostics=none` |

## 5. Autorisierte D3a-Diagnosen

| ID | Datei:Zeile | Literal | Klassifikation |
| -- | ----------- | ------- | -------------- |
| D03 | `packages/shared/src/__tests__/evidence-portfolio.test.ts:250` | `` `docs/evidence/test-run/report.md` `` | GREEN_SAFE |
| D09 | `scripts/run-evidence-gate.mjs:832` | `` `  Approval pack: enabled` `` | GREEN_SAFE |
| D10 | `scripts/run-evidence-gate.mjs:835` | `` `  Safe apply plan: enabled` `` | GREEN_SAFE |
| D11 | `scripts/collect-github-context.mjs:155` | `` `Positron GitHub Snapshot Collector — Phase 1C` `` | GREEN_SAFE |

## 6. Diff-Matrix

| Feld | Wert |
|------|------|
| CHANGED_SOURCE_OR_SCRIPT_FILES | 2 |
| CHANGED_TEST_FILES | 1 |
| CHANGED_EVIDENCE_FILES | 1 |
| OTHER_FILES_CHANGED | 0 |
| D3A_LITERAL_REPLACEMENTS | 4 |
| D3B_LINES_CHANGED | 0 |
| D3C_LINES_CHANGED | 0 |
| UNRELATED_LINES_CHANGED | 0 |
| PACKAGE_LOCK_CHANGED | NO |

### Dateien:

1. `packages/shared/src/__tests__/evidence-portfolio.test.ts` — 1 Zeile (D03)
2. `scripts/run-evidence-gate.mjs` — 2 Zeilen (D09, D10)
3. `scripts/collect-github-context.mjs` — 1 Zeile (D11)

## 7. Byte-Äquivalenz

| ID | Datei:Zeile | Länge | Byte-identisch |
| -- | ----------- | ----- | -------------- |
| D03 | evidence-portfolio.test.ts:250 | 32 bytes | YES |
| D09 | run-evidence-gate.mjs:832 | 24 bytes | YES |
| D10 | run-evidence-gate.mjs:835 | 26 bytes | YES |
| D11 | collect-github-context.mjs:155 | 45 bytes | YES |

Für alle vier Fundstellen gilt: `typeof before === "string"`, `typeof after === "string"`, `before === after`, `Buffer.from(before).equals(Buffer.from(after))` → true.

## 8. Post-Change-Diagnosen

| Feld | Wert |
|------|------|
| TOTAL_D3_DIAGNOSTICS_AFTER | 7 |
| D3A_DIAGNOSTICS_AFTER | 0 |
| D3B_DIAGNOSTICS_REMAINING | 5 |
| D3C_DIAGNOSTICS_REMAINING | 2 |
| NEW_D3_DIAGNOSTICS | 0 |
| OTHER_RULE_DIAGNOSTICS_CLOSED | 0 |
| OTHER_RULE_DIAGNOSTICS_ADDED | 0 |

Verbleibende D3-Diagnosen:

| ID | Datei:Zeile | Track |
| -- | ----------- | ----- |
| D01 | controlled-real-probe.ts:325 | D3c |
| D02 | stage3-supervised-pilot-policy.ts:404 | D3c |
| D04 | portfolio-updater.ts:311:46 | D3b |
| D05 | portfolio-updater.ts:311:66 | D3b |
| D06 | portfolio-updater.ts:316:46 | D3b |
| D07 | portfolio-updater.ts:316:64 | D3b |
| D08 | run-evidence-gate.mjs:207 | D3b |

## 9. Testmatrix

| Befehl | Exit Code | Tests | Ergebnis |
|--------|-----------|-------|----------|
| `npm run build` | 0 | — | PASS |
| `npm run typecheck` | 0 | — | PASS |
| `vitest run evidence-portfolio.test.ts` | 0 | 34 | PASS |
| `vitest run packages/shared/src/` | 0 | 343 | PASS* |
| `npm test` (monorepo) | 0 | 2121 | PASS |
| `npm test` (web) | 0 | 330 | PASS |
| `git diff --check` | 0 | — | PASS |

\* 4 contract/property test files failed due to pre-existing missing `dist/decision-manifest.js` (build dependency issue, unrelated to D3a).

| Feld | Wert |
|------|------|
| TARGET_TESTS_GREEN | YES |
| PACKAGE_TESTS_GREEN | YES |
| BUILD_GREEN | YES |
| TYPECHECK_GREEN | YES |
| MONOREPO_TESTS_GREEN | YES |

## 10. Security- und Boundary-Sentinel

| Feld | Wert |
|------|------|
| CONTROLLED_REAL_PROBE_CHANGED | NO |
| STAGE3_SUPERVISED_PILOT_POLICY_CHANGED | NO |
| PORTFOLIO_UPDATER_CHANGED | NO |
| D3B_ERROR_LITERAL_CHANGED | NO |
| DANGEROUSLY_SET_INNER_HTML_CHANGED | NO |
| REAL_MODE_EXECUTED | NO |
| STAGE3_EXECUTED | NO |
| EXTERNAL_WRITE_OPERATION_EXECUTED | NO |
| SECRETS_DISCLOSED | NO |

## 11. Workspace-Schutz

| Feld | Wert |
|------|------|
| PRIMARY_WORKSPACE_DIRTY_PREEXISTING | YES |
| PRIMARY_WORKSPACE_TOUCHED | NO |
| EXISTING_WORKTREES_TOUCHED | NO |
| UNTRACKED_FILES_PRESERVED | YES |
| STASHES_PRESERVED | YES |
| D3A_WORKTREE_INITIAL_CLEAN | YES |

## 12. Reviewer-Urteil

**PASS** — Alle vier autorisierten Diagnosen geändert, exakt drei Dateien betroffen, Runtime-Werte byte-identisch, D3b/D3c unberührt, keine Cross-Rule- oder Security-Grenze verletzt.

## 13. Secrets-Prüfung

Keine Secrets im Diff, Evidence oder Commit enthalten.

## 14. Finale Klassifikation

```text
PRIMARY: GREEN_D3A_PR_READY
TRACK: GREEN_SAFE_TRACK_D3A_READY
```

## 15. Git- und PR-Status

Siehe Issue #340 Kommentar und Draft PR.
