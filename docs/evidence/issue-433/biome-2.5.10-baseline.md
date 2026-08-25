# Issue #433 — Biome 2.5.10 baseline evidence

This report is intentionally baseline evidence, not a lint-cleanup ledger. It contains no source-code fixes and no #340 remediation.

## Context

- `START_MAIN`: `ce287105e53977904628214dfdc7adddd6215761`
- Branch: `positron/issue-433-biome-2-5-10`
- Previous dependency: `@biomejs/biome` `1.9.4`
- Approved dependency: exact `@biomejs/biome` `2.5.10`
- Current verified dependency: `2.5.10`
- `DEEPSEEK_AGENT_USAGE`: `0`

2.5.10 was retained as the approved target even though release discovery is time-sensitive. The npm package page and the official Biome 2.5.10 changelog identified it as the current stable/latest release during this run.

## Configuration migration

The official `biome migrate --write` output was used as input and manually reviewed.

| Intent | Result |
| --- | --- |
| Schema | `https://biomejs.dev/schemas/2.5.10/schema.json` |
| organize imports | `assist.actions.source.organizeImports = "on"`; dry-run only, no imports written |
| formatter/linter/file ignores | migrated from `ignore` to v2 `includes` force-ignore patterns; generated `dist`, coverage, test-result, and Playwright directories are explicitly excluded for parity |
| `noConsoleLog` | manually corrected to v2 `noConsole` with every normal console method except `log` allowed; this preserves the old rule's behavior |
| Tailwind | `css.parser.tailwindDirectives = true`; v3 `@tailwind` remains a visible v2 `noUnknownAtRules` finding rather than being suppressed |
| HTML scope | explicit `!apps/web/index.html` keeps v1 selection intent; v2 otherwise discovers this newly supported HTML file |

The upstream v2 migration fix for renamed rules was verified: release notes document the repair for malformed output when `noConsoleLog` is the final renamed rule. The generated `allow: ["log"]` was not accepted because the v2 rule documentation defines `allow` as permitted methods, which would invert the repository's original intent.

## File-selection parity

The v1.9.4 debug `Process check` inventory and v2.5.10 verbose `Files processed` inventory both contain 548 files after the explicit HTML parity exclusion.

- `OLD_FILE_SET`: 548 files
- `NEW_FILE_SET`: 548 files
- `NEW_MINUS_OLD`: empty
- `OLD_MINUS_NEW`: empty
- `FILE_SELECTION_DELTA`: explained and resolved

Without the explicit parity exclusion, v2 adds `apps/web/index.html` because v2 supports HTML; v2 also internally ignores `package-lock.json`. The final configuration makes the scope transition explicit and does not widen lint/format selection.

## Diagnostic baselines

All commands were read-only (`--max-diagnostics=none` where structured output was collected).

| Command | Biome 1.9.4 | Biome 2.5.10 |
| --- | ---: | ---: |
| selected files | 548 | 548 |
| `check` errors | 4 | 139 |
| `check` warnings | 1,588 | 1,728 |
| `check` infos | 0 | 9 |
| separate `lint` errors | 4 | 4 |
| separate `lint` warnings | 1,588 | 1,728 |
| separate `lint` infos | 0 | 9 |
| format diagnostics | 0 | 9 |
| organize-import diagnostics | 0 | 126 |

The v2 `lint` error delta is four existing/new findings: one `useAriaPropsSupportedByRole` finding and three Tailwind v3 `noUnknownAtRules` findings. New warning/info categories include v2 rule evolution such as `noUnusedImports`, `noUnusedFunctionParameters`, `noUnusedPrivateClassMembers`, `useOptionalChain`, `useParseIntRadix`, `noUselessFragments`, `noImportantStyles`, `useBiomeIgnoreFolder`, and `noUselessEscapeInRegex`. They are recorded, not fixed.

The v2 `check` total additionally includes 126 expected organize-import assist diagnostics and 9 formatter diagnostics. `formatter.expand = "auto"` preserves the prior compact package-manifest formatting where possible; the remaining formatter drift is a separate remediation track. No output was written to source.

## Targeted and stability checks

- Biome 1.9.4 `BlueprintPanel.tsx`: one `lint/a11y/useSemanticElements` error recommending `<output>` for `role="status"`.
- Biome 2.5.10 `BlueprintPanel.tsx`: zero diagnostics; the known false-positive is absent.
- Biome 1.9.4 format check: `Checked 548 files ... No fixes applied`.
- Biome 2.5.10 format check: 9 diagnostics, no writes; formatter drift is deferred as a separate remediation track.
- Biome 2.5.10 organize-import dry-run: 126 diagnostics, no writes; import-order changes are deferred as a separate remediation track.

## Fix-loop result

- Failed fix loops: `1` (the three-loop stop threshold was not reached).
- Fix loop 1: GitHub exposed two Biome-2 fixture incompatibilities in the differential-lint unit suite. The fixture configuration was migrated to v2 `noConsole`, and the clean-file fixture now exports its value so it remains clean under the v2 recommended preset. `formatter.expand = "auto"` was added after the CI format report to preserve compact package-manifest formatting. The local differential suite is now 90/90 PASS; the remaining nine formatter differences are existing v2 semantics and are intentionally deferred.
- One manual configuration correction was required during review: the migration tool's generated `noConsole` allow-list would have allowed `log` rather than preserving the old `noConsoleLog` rule. The list was corrected to allow every normal console method except `log`, then the v2 lint baseline and targeted checks were rerun.
- No source diagnostics were fixed and no broad formatter/import write was run.

## Scope audit

Expected implementation files are `package.json`, `package-lock.json`, `biome.json`, the targeted Biome integration fixture `scripts/ci/differential-biome-lint.test.mjs`, this evidence report, and the #433 Spec/Plan/Tasks. The test fixture change is required for Biome 2 compatibility (`noConsoleLog` → `noConsole` and a clean exported fixture); no runtime source, UI files, workflows, or #340 cleanup files are changed.

The lockfile audit found only the root Biome dependency and its eight platform packages changing from 1.9.4 to 2.5.10. The resolved URLs use the configured npm mirror; this is mechanical lock metadata, not an unrelated dependency change.

## Review classification

The independent review passes were executed with `DEEPSEEK_AGENT_USAGE=0`:

| Review | Role / provider / model / purpose | Result |
| --- | --- | --- |
| Architecture | `architecture reviewer` / OpenAI / GPT-5 / verify tooling-only scope and no runtime or control-plane effect | PASS |
| Security | `security reviewer` / OpenAI / GPT-5 / verify no unsafe ignores, suppressions, disabled security diagnostics, or secrets | PASS |
| Integration | `integration reviewer` / OpenAI / GPT-5 / verify manifest, lockfile, config, and CI alignment | PASS |
| Tooling | `tooling/migration reviewer` / OpenAI / GPT-5 / verify v2 schema and renamed-rule semantics | PASS |

- Architecture: tooling/config only; no runtime or control-plane effect.
- Security: no new ignore, suppression, secret, or security-rule disablement; `gitleaks` is not installed in this environment, so the changed paths were also manually scanned.
- Integration: manifest and lockfile resolve the same exact Biome version; workflows are unchanged.
- Tooling/migration: schema and renamed rules reviewed; `noConsole` semantics corrected manually.
- `CRITICAL`: 0
- `MAJOR`: 0
