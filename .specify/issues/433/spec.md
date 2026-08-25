# Specification: Biome 2.5.10 Baseline Migration

**Issue:** #433
**Evaluation:** #402
**Deferred backlog:** #340
**Branch:** `positron/issue-433-biome-2-5-10`
**Base:** `ce287105e53977904628214dfdc7adddd6215761` (`origin/main`)
**Status:** Approved implementation scope
**Target:** `@biomejs/biome` exact `2.5.10`
**DeepSeek usage:** `0`

## 1. Purpose

Migrate the repository's Biome toolchain from 1.9.4 to the Owner-approved exact v2.5.10 baseline while preserving intended configuration and CI semantics. The migration is a tooling-only track. Existing diagnostics remain evidence; they are not cleanup work.

## 2. Scope

- Change only the root Biome dependency from `1.9.4` to exact `2.5.10`.
- Update only lockfile entries mechanically caused by that dependency.
- Migrate `biome.json` using Biome's official migration support as input, with manual review.
- Analyze file-selection parity, import organization, formatter stability, and diagnostic deltas.
- Verify the `BlueprintPanel.tsx` `role="status"` diagnostic directly.
- Preserve blocking versus advisory CI behavior.
- Add only scoped evidence required by repository policy.

## 3. Non-goals and invariants

- No #340 lint remediation, broad auto-fix, source cleanup, UI change, or format/import write.
- No workflow changes unless a Biome-2 compatibility defect objectively requires one; advisory gates cannot become blocking and blocking gates cannot be weakened.
- No dependency upgrades other than `@biomejs/biome` and unavoidable lock metadata.
- No #308 Phase 3/4, P5.5, P6, release, deployment, merge, or DeepSeek agent.
- Rollback is a revert of the migration commit restoring the prior exact dependency/config pair.

## 4. Configuration intent to preserve

| v1 intent | v2 expression to verify |
| --- | --- |
| Schema validation | v2 schema URL/version |
| `organizeImports.enabled` | `assist.actions.source.organizeImports` |
| formatter/linter ignored paths | v2 `includes`/selection semantics with explicit parity evidence |
| `linter.rules.suspicious.noConsoleLog` | `noConsole` |
| Tailwind directives | v2 CSS parser configuration, if required by repository files |
| known file exclusions and `ignoreUnknown` | equivalent v2 file-selection behavior |

The migration output is accepted only if JSON parses, Biome accepts it, and every semantic delta is understood.

## 5. Baseline contract

Capture deterministic v1.9.4 and v2.5.10 results for version, config, selected files, `check`, separate `lint`, format check, safe import-organize dry-run, and the BlueprintPanel target. Record errors, warnings, infos, rule/category distributions, old/new file sets, and classifications for every new error. Do not silently widen scope.

## 6. Acceptance criteria

- [ ] Manifest and installed binary resolve exactly to 2.5.10.
- [ ] Config parses under 2.5.10 and preserves intended semantics.
- [ ] `NEW_MINUS_OLD` and `OLD_MINUS_NEW` file-set deltas are enumerated and explained.
- [ ] Import and formatter differences are dry-run evidence only; no repository-wide writes.
- [ ] BlueprintPanel `role="status"` no longer emits the known `<output>` false-positive.
- [ ] CI semantics are unchanged and no workflow is edited unnecessarily.
- [ ] Build, typecheck, root tests, web tests, Playwright, config, format check, secret scan, diff check, and dependency audit are executed and reported.
- [ ] Source-code changes are zero unless proven mandatory for v2 compatibility.
- [ ] Critical and major independent review findings are zero.
- [ ] PR is created but not merged; final landing requires an exact-head Owner Gate.
