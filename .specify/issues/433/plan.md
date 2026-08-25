# Plan: Biome 2.5.10 Baseline Migration

**Issue:** #433
**Branch:** `positron/issue-433-biome-2-5-10`
**Base:** `ce287105e53977904628214dfdc7adddd6215761`

## Phase 0 — Reproducible context

1. Keep the original dirty worktree untouched.
2. Use the clean branch from fresh `origin/main`.
3. Verify #388 closed, #402 closed after handoff, #340 open, and no open PRs.
4. Record registry/changelog research and exact target decision in #433.

## Phase 1 — v1.9.4 baseline

1. Install repository dependencies with normal npm semantics; do not use `npm ci --ignore-scripts`.
2. Run the pinned 1.9.4 binary and record structured version/config/file-selection/check/lint/format/organize-import/targeted outputs.
3. Preserve baseline artifacts outside the implementation diff when possible; summarize deterministic counts and distributions in the issue/PR.

## Phase 2 — Spec/plan/tasks and migration

1. Review the official v2 migration guidance and the current configuration.
2. Generate migration output as a review input.
3. Apply the minimal reviewed `biome.json` migration and exact dependency update.
4. Update `package-lock.json` only through npm package-manager resolution.
5. Audit the dependency diff and reject unrelated semantic version changes.

## Phase 3 — Compatibility evidence

1. Run exact 2.5.10 version/config parse checks.
2. Compare old/new file sets and explain each delta.
3. Run import organization and formatter checks without writes; classify output.
4. Run the full v2.5.10 diagnostic baseline and classify every new error.
5. Verify `BlueprintPanel.tsx` `role="status"` directly.
6. Confirm CI blocking/advisory semantics from the workflow and do not edit it unless necessary.

## Phase 4 — Validation

Run the required local gates in this order: config/version, targeted diagnostic, format check, diff/dependency/secret audits, build, typecheck, root tests, web tests, and Playwright. Record failures with classification and stop after three failed fix loops. No source diagnostics are repaired as part of this issue.

## Phase 5 — Delivery

1. Run architecture, security, integration, and tooling/migration reviews with role/provider/model/purpose recorded; all are non-DeepSeek.
2. Stage only intended paths and commit using `fix(issue-433): ...` or `docs(issue-433): ...`.
3. Push the feature branch, create one standalone PR, and document all evidence in #433 and the PR.
4. Observe required CI and review status. Do not merge or enable automatic landing.

## Risks and rollback

- Risk: v2 changes selection or diagnostics. Mitigation: exact old/new file-set and diagnostic comparison.
- Risk: migration tool changes intent. Mitigation: manual review against the v1 intent table.
- Risk: native test setup failure. Mitigation: normal install/rebuild and classify binding failures as environment until disproven.
- Rollback: revert the migration commit; restore exact 1.9.4 dependency/config and lock entries.
