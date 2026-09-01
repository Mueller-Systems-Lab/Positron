# Issue 484 — Installation Doctor & Fresh-Environment Onboarding Closure

## Problem

The existing `scripts/doctor.sh` only prints a best-effort summary and can
silently omit checks. A new operator has no deterministic, read-only command
that separates safe demo prerequisites from optional supervised integration
configuration or explains a fixed-port conflict.

## Contract

Extend the existing doctor surface as `positron.install-doctor.v1` with
explicit `--demo` and `--supervised` scopes and optional `--json` output.
Every check has a stable status (`PASS`, `BLOCKED`, `NEEDS_CONFIGURATION`,
`OPTIONAL`, or `UNKNOWN`), a reason code, impact, and safe next action. Demo
checks cover Docker, Compose v2, required quickstart files, curl, and the
documented host ports. Supervised checks additionally report OpenCode,
SpecKit, provider/model, repository configuration, and safety boundaries.

The doctor is read-only, never prints values from environment variables,
never installs or changes credentials, and never enables real mode, push, or
merge. The running backend remains the authority for runtime readiness.

## Acceptance

- Minimum demo prerequisites produce a passing demo result without requiring
  OpenCode, SpecKit, GitHub, provider, or repository configuration.
- Missing Docker, Compose, or an occupied demo port returns a stable reason
  code and actionable remediation.
- Supervised missing OpenCode/provider/model/repository configuration is
  explicit and actionable.
- Human and JSON output are deterministic, repeatable, and secret-free.
- The current quickstart and first-run docs describe the doctor, demo/real
  boundary, status/stop behavior, and retained local state.
- Focused doctor tests plus the repository's normal quality gates pass.
- No new database, registry, control plane, runtime readiness authority,
  automatic installer, or production capability is introduced.
