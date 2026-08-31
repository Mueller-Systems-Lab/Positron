 # Issue #474 Phase-0 Specification

## Scope

Add a bounded, offline, deterministic value experiment for procedural skill
hypotheses derived from Positron attempt evidence. Reuse the existing P5.4
contracts and evaluation concepts; do not add a store, queue, scheduler,
promotion engine, state machine, or database.

## Contract

The experiment accepts an untrusted candidate projection containing only
metadata, bounded procedural steps, evidence references, compatibility data,
and a fingerprint. A deterministic quality gate returns `ELIGIBLE_FOR_EVALUATION`
only when schema, routing, actionability, resource, portability,
compatibility, secret, kernel-policy, context-budget, and staleness checks pass.
It fails closed and never grants authority.

Experiment arms are predeclared as A (no skill), B (same harness plus skill),
and C (no skill with matched compute/context). Training and holdout references
must be disjoint. Metrics retain verified success, first-pass success,
attempts, time, tool calls, tokens/context provenance, retries, escalations,
regressions, security, and metadata-only exploration telemetry. Unknown values
remain `UNKNOWN`; unverified costs are `NOT_AVAILABLE`.

The value gate is decided deterministically before interpreting results:
`GREEN_SKILL_SPECIALIZATION_VALUE_PROVEN` requires B > A and B > C, sample
size above the predeclared minimum, no leakage or security/permission/
recovery/contract regression, and reproducible bound evidence. Otherwise the
result is an amber/non-promotable outcome. A deliberately harmful candidate
must be rejected by quality gate or utility evaluation.

## Non-goals

No production activation, memory database, candidate persistence migration,
LLM-controlled evaluation, promotion, pointer mutation, permission change,
holdout selection, or cost inference.
