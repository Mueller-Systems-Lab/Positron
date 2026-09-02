# Issue #487 — Positron v0.2.0 Release Specification

## Objective

Qualify and publish Positron v0.2.0 from the actual canonical `main` line, with the annotated tag and stable GitHub Release bound to the same freshly qualified commit.

## Scope

- Align current product version metadata and lockfile metadata to `0.2.0`.
- Add canonical v0.2.0 release notes and update the unreleased changelog section.
- Preserve historical evidence, fake adapter fixtures, unrelated working-tree changes, and safety defaults.
- Qualify fresh installation, regression gates, visible headed Playwright, exact-head PR landing, post-merge main, tag target, and publication state.

## Explicit non-goals

No feature work, dependency upgrades, npm/container publication, deployment, signing-key creation, credential changes, force-push, tag rewrite, or unsupervised Real Mode.

## Acceptance criteria

1. Product manifests and lockfile agree on `0.2.0` without dependency-graph drift.
2. Release notes accurately describe landed v0.2 changes and safety boundaries.
3. Required local/CI, fresh-install, and visible headed-browser gates pass.
4. Release PR lands only at an exact, verified ready head.
5. The frozen qualified main commit is the exact target of annotated tag `v0.2.0`.
6. GitHub Release `v0.2.0` is stable, non-draft, non-prerelease, and independently re-read.
7. Issue #487 is closed only after publication verification; no package publication or deployment occurs.
