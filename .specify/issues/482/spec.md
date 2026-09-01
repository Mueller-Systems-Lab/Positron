# Issue 482 — Operator Readiness & Guided Supervised Setup

## Problem

The backend already distinguishes process health from durable readiness, but the
operator UI only exposes a coarse health summary. A new operator cannot tell
whether demo work, provider execution, repository access, or a supervised run
is currently possible without reading repository internals.

## Contract

Expose a read-only `positron.operator-readiness.v1` response from the backend.
It contains an explicit overall status, safe component statuses, reason codes,
human messages, remediation hints, evidence references, and a check timestamp.
The endpoint reuses the existing database readiness, adapter health, repository
configuration, and safety state authorities. It never returns credentials.

## Acceptance

- Demo mode reports `READY_DEMO` only when durable state is ready.
- Missing OpenCode reports `EXECUTABLE_NOT_FOUND` and a safe remediation hint.
- Provider/runtime and repository failures are explicit and actionable.
- A real/supervised readiness claim is blocked while the safety kill switch or
  required mutation gate is disabled.
- The dashboard presents the backend result and one safe next action.
- No new database, control plane, provider registry, or repository registry.
