# Tasks: Biome 2.5.10 Baseline Migration

## Ownership and evidence

- [x] T1 Record role/provider/model/purpose for every agent execution; prove `DEEPSEEK_AGENT_USAGE=0`.
- [x] T2 Post accepted, repository-context, web-research, specification, plan, tasks, implementation, test, fix-loop, and PR status comments to #433.
- [x] T3 Preserve original dirty worktree fingerprint and record `START_MAIN`.

## Baseline and migration

- [x] T4 Install dependencies using supported native dependency setup.
- [x] T5 Capture deterministic Biome 1.9.4 version/config/file-selection/check/lint/format/import/BlueprintPanel baseline.
- [x] T6 Verify registry and official Biome source for exact 2.5.10 and relevant v2 migration/fix notes.
- [x] T7 Generate and manually review official v2 migration output.
- [x] T8 Pin `@biomejs/biome` to exact `2.5.10`; update lockfile only for Biome-related metadata.
- [x] T9 Migrate schema, organizeImports, selection, noConsole, and Tailwind directives as required by verified semantics.

## Compatibility analysis

- [x] T10 Prove v2 config parses and binary version is exact.
- [x] T11 Enumerate `OLD_FILE_SET`, `NEW_FILE_SET`, `NEW_MINUS_OLD`, and `OLD_MINUS_NEW`; explain every delta.
- [x] T12 Run import-organize dry-run and classify expected semantics, drift, and risk; do not write imports.
- [x] T13 Run formatter check without writes and classify any baseline drift.
- [x] T14 Run exact 2.5.10 check/lint baseline and classify every new error.
- [x] T15 Verify BlueprintPanel `role="status"` false-positive absence without changing the component.
- [x] T16 Verify CI blocking/advisory semantics and confirm no workflow change is needed.

## Gates

- [x] T17 Run config/version and targeted Biome gates.
- [x] T18 Run build and typecheck.
- [x] T19 Run root tests and web tests; explain count changes.
- [x] T20 Run Playwright E2E.
- [x] T21 Run secret scan, `git diff --check`, and dependency-diff audit.
- [x] T22 Record every failure, retry, and fix-loop classification; stop after three failed fix loops.

## Review and delivery

- [x] T23 Complete architecture review: no runtime/control-plane effect.
- [x] T24 Complete security review: no unsafe ignores/suppressions or secret exposure.
- [x] T25 Complete integration review: dependency/config/CI agree on 2.5.10.
- [x] T26 Complete tooling/migration review: semantics are faithful.
- [x] T27 Stage explicit intended files, inspect diff, and commit with issue-433 convention.
- [x] T28 Push branch and create standalone PR; report exact head.
- [ ] T29 Observe all required CI jobs/reviews; report 11-CI status and do not merge.
- [ ] T30 Publish final acceptance mapping and exact Owner Gate request.
