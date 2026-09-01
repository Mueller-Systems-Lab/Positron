# Specification — Deterministic Experiment Budget, Deadline & Timeout Contract

## Status

`IMPLEMENTED_PENDING_LANDING` — issue 478, branch `positron/issue-478-runtime-budget-deadline-contract`.

## Goal

Make runtime termination attributable, bounded, and reproducible across Positron's existing run → job → attempt pipeline. A termination record must identify the exhausted budget, the authority that made the decision, and the downstream cancellation/fencing outcome.

This is general runtime infrastructure. It does not add an exploration strategy, change production routing, reopen Issue #476, reinterpret its evidence, or start a new experiment.

## Existing mechanisms to extend

- `packages/control-plane/src/cancellation.ts` owns abort sources, bounded process termination, and lease heartbeat cleanup.
- `packages/sandbox/src/command-runner.ts` owns child-process execution but currently exposes only a relative generic timeout.
- `packages/opencode-adapter/src/real-adapter.ts` invokes OpenCode with fixed adapter-side timeouts and turns termination into an untyped failed result.
- `cp_jobs`, `cp_attempts`, `cp_transitions`, `cp_dataset_partitions`, and P5 harness/evaluation tables are the existing durable state; no second runtime database or scheduler is introduced.
- Existing attempt terminal-state guards and lease owner/generation fencing remain authoritative for late results.

## Contract v1

The shared `RuntimeBudgetContract` is immutable after freeze and has the contract id `positron.runtime-budget.v1` plus:

```text
contract_version
budget_id
budget_fingerprint
issued_at                         # audit timestamp only
absolute_deadline_ms              # monotonic clock-domain deadline
attempt_wall_clock_budget_ms
provider_request_budget_ms
tool_execution_budget_ms
verification_budget_ms
max_steps
max_tool_calls
max_retries
cancellation_grace_ms
parent_budget_ref
source_policy_ref
provider
model
effective_harness_fingerprint
budget_provenance
```

All durations are finite positive integers, all maxima are bounded by a documented policy maximum, and `cancellation_grace_ms` is bounded. Fingerprints include policy and identity fields needed for comparability but exclude audit timestamps, generated ids, and the absolute clock reading. Secrets, prompts, provider output, and raw command output are not contract fields.

Child derivation computes:

```text
effective_child_deadline = min(requested_child_deadline, remaining_parent_deadline)
```

An absent parent is permitted only for a root run contract. A child cannot widen any duration, deadline, step/call/retry limit, or grace period. `freezeRuntimeBudgetContract` returns a deeply frozen copy and validation rejects post-freeze semantic mutation.

## Timeout and authority taxonomy

The canonical reason codes are:

| Reason | Authority | Meaning |
| --- | --- | --- |
| `PROVIDER_TRANSPORT_TIMEOUT` | `provider` | provider transport/request budget elapsed |
| `PROVIDER_QUEUE_TIMEOUT` | `provider` | provider queue budget elapsed |
| `MODEL_INFERENCE_TIMEOUT` | `model` | model inference budget elapsed |
| `TOOL_EXECUTION_TIMEOUT` | `tool` | owned tool budget elapsed |
| `ATTEMPT_DEADLINE_EXCEEDED` | `attempt` | attempt wall-clock deadline elapsed |
| `VERIFICATION_DEADLINE_EXCEEDED` | `verification` | verification budget elapsed |
| `EXPERIMENT_CELL_DEADLINE_EXCEEDED` | `experiment_cell` | cell deadline elapsed |
| `RUN_BUDGET_EXHAUSTED` | `run` | parent run/job budget exhausted |
| `CANCELLED_BY_KERNEL` | `kernel` | controller cancellation requested |
| `LATE_RESULT_FENCED` | `fencing` | result arrived after terminal/superseded authority |
| `PROVIDER_FAILURE` | `provider` | non-timeout provider/transport failure |
| `EXPERIMENT_CONTRACT_CHANGED` | `kernel` | frozen evaluation contract was altered |
| `RETRY_BUDGET_EXHAUSTED` | `run` | retry would exceed finite parent budget or retry cap |
| `RUNTIME_TERMINATION_UNKNOWN` | `kernel` | no authoritative provider, subsystem, deadline, or cancellation evidence exists |
```

Provider health means only that a neutral transport/model request is viable. Workload runtime-envelope viability is a separate gate. A kernel-owned attempt deadline must never be inferred as `PROVIDER_FAILURE` merely because the provider process was the child being terminated.

## Runtime behavior

1. The kernel creates and freezes the root contract before execution.
2. Each job/attempt derives a bounded child slice from the parent and records its fingerprint/provenance.
3. `runCommand` uses a monotonic clock and the effective child deadline. Its relative legacy timeout remains supported but cannot exceed the runtime slice.
4. Deadline expiry calls the existing cancellation source, propagates the signal to OpenCode/tools, waits the contract grace window, and escalates to the existing owned process-group termination path. Cleanup is bounded and idempotent.
5. Adapter results carry the explicit termination reason and authority. Provider errors are classified as provider failures only when provider evidence exists and no kernel/attempt deadline won the race.
6. Completion continues through existing attempt transition and lease-fencing guards. A late result is observed and fenced, never applied.
7. Retry is permitted only by the existing delta-based retry policy and only when the parent remaining budget and `max_retries` allow it. A retry receives a child budget; it never resets the parent.

## Experiment contract boundary

An evaluation run may execute holdout cells only after a frozen runtime contract contains non-empty calibration and holdout partition fingerprints. The calibration/holdout intersection must be zero. Any mutation after freeze yields `EXPERIMENT_CONTRACT_CHANGED`; old and new samples cannot be combined by this contract.

## Persistence and observability

Migration V12 adds nullable/additive runtime fields to `cp_attempts`, preserving all historical nulls as unknown. Fields include the serialized validated contract, fingerprint, termination reason/authority, elapsed and remaining budget values, cancellation timestamps, and late-result flags. Existing tables, migrations, leases, transitions, and attempt fencing remain the source of truth.

The durable record must expose budget id/fingerprint, attempt id/parent reference, scheduled/started/completed timestamps, elapsed/remaining values, termination reason/authority, observable provider/tool/verification latency, cancellation timestamps, and late-result detected/fenced booleans. No raw prompt, secret, or provider payload is persisted.

## Acceptance mapping

- Contract, hierarchy, timeout taxonomy, experiment freeze, and calibration/holdout rules: shared contract module and contract tests.
- Kernel deadline, bounded cancellation, provider distinction, and OpenCode chain: sandbox/adapter integration and canaries.
- Durability, migration, recovery, idempotency, and fencing: additive V12 schema/store changes and control-plane tests.
- Neutral canaries A–F and adversarial canaries: focused runtime-budget test suite.
- Review and evidence: architecture, security, runtime/research checklists plus issue/PR comments and final visible Playwright gate.

## Out of scope

No new scheduler, runtime database, provider, model, exploration candidate, holdout rerun, productization, release, deploy, or production policy bypass.
