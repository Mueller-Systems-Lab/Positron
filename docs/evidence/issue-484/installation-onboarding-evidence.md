# Issue 484 — Installation and onboarding evidence

**Date:** 2026-09-01
**Implementation head:** feature branch for #484
**Baseline main:** `4ec48b61da2b6545eff4bbd4c314f9c0c1dfcb8a`

## Reality and baseline

- Primary workspace contained unrelated changes; they were preserved.
- A clean worktree was created from the actual `origin/main`.
- Local baseline: root tests 2726/2726, Web tests 422/422, build PASS.
- Existing `scripts/doctor.sh` was human-only and did not provide scoped
  status/reason/remediation output.
- A fresh clone at `/tmp/positron-fresh1.PJFY2M` had no `.positron` state and
  passed `quickstart.sh --dry-run`. Its first full start reached the Docker
  image build but was stopped after the container `npm ci` made no progress;
  this is recorded as baseline environment friction, not hidden.
- The host initially had a separate `positron-quickstart` stack using ports
  3000/5173. Only its containers/network were stopped; named volumes were
  retained.

## Bounded change

The existing `scripts/doctor.sh` now exposes:

```text
./scripts/doctor.sh --demo
./scripts/doctor.sh --supervised
./scripts/doctor.sh --demo --json
```

It is read-only and reports `PASS`, `BLOCKED`, `NEEDS_CONFIGURATION`, and
`OPTIONAL` checks with stable reason codes, impact, and next action. It never
prints environment values or installs/enables anything. Runtime readiness
remains owned by `positron.operator-readiness.v1`.

## Focused evidence

- ShellCheck: PASS.
- Doctor tests: 7/7 PASS.
- Root regression after implementation: 2733/2733.
- Web regression after implementation: 422/422.
- Build/typecheck: PASS.
- Contracts: 168/168.
- Integration: 20/20.
- Transfer references: PASS.
- Review execution: PASS.
- Changed-file Biome lint/format: PASS.
- Repo-wide Biome lint retains the pre-existing baseline diagnostics outside
  this slice.

## Security boundary

Doctor JSON tests prove deterministic output without token/provider/model
values. Mutation-flag tests prove the doctor reports unsafe flags and does not
enable real mode, push, or merge. No credentials, database, registry, or
control-plane code was added.

## Remaining qualification

Fresh final environment, complete quickstart stop/restart/health proof,
architecture/security/product review comments, PR checks, visible headed
Playwright, and post-merge qualification remain required before deciding the
v0.2 release gate.
