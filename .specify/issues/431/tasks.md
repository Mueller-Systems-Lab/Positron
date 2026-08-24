# Tasks: RealOpenCodeAdapter execution identity binding

- [x] Transfer the validated semantic delta without #429 files.
- [x] Add explicit `--dir`, `--model`, and `--agent` invocation arguments.
- [x] Add missing-model fail-closed coverage.
- [x] Preserve redacted structured errors.
- [x] Persist P5.3 HARNESS diagnosis/routing and real SpecKit artifacts.
- [x] Run focused adapter/pipeline regressions and full required checks.
- [x] Run disposable direct Specify and verify cleanup/no unauthorized effects.
- [x] Record independent architecture, security, and integration reviews.
- [ ] Open a non-draft PR; leave it unmerged pending exact owner authorization.

Validation notes:

- Focused adapter/pipeline and affected integration suites pass (201 tests); the
  adapter/failure-propagation subset passes (34 tests), with the review snapshot
  reporting 42 focused checks after the final hardening change.
- Relevant package typechecks, Biome diagnostics, secret scan, and
  `git diff --check` pass. The repository-wide `npm test` and Playwright runs
  remain blocked by existing frontend dependency/transformation failures
  (`@testing-library/react`, `tailwindcss`, and JSX-in-`.js` parsing).
- Disposable real Specify passes with fenced workspace, explicit model/agent,
  persisted artifact/evidence, no server error, and cleanup.
- Architecture, security, and integration reviews report zero critical/major
  findings for this child scope; security conditions its approval on existing
  upstream #430/workspace-authority controls.
