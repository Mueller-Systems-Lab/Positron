# Plan: P5.4 Harness Evolution Sandbox

**Issue:** #426
**Branch:** positron/issue-426-harness-evolution
**Base:** 851d448c6e9df22cd9fba078d21fef198ae1190c (P5.3 GREEN)

## 1. Architecture

P5.4 is NOT a new control plane. It is storage/evaluation/policy under existing Control Kernel, same SQLite DB, no new DB.

```
Production Attempts → Evidence → Pattern → Candidate → Store → Validation → A/B/C → Holdout → Sentinels → Shadow → Canary → Promotion Gate → Atomic Pointer → Rollback
```

Reuse: cp_jobs, cp_attempts, cp_decisions, cp_transitions, cp_queue, contracts/fingerprints, scheduler/budget/admission, worker pipeline, profile compiler, P5.3 routing.

## 2. Affected Modules

- `packages/control-plane/src/contracts.ts` — add 3 contracts (candidate, evaluation, promotion-decision)
- `packages/control-plane/src/fingerprint.ts` — candidate fingerprint excludes hypothesis/timestamps
- `packages/control-plane/src/schema.ts` — V10 migration (8 tables)
- `packages/control-plane/src/store.ts` — candidate/evaluation/promotion/shadow/canary/pointer stores
- `packages/control-plane/src/harness-evolution.ts` — candidate lifecycle, tunable allowlist, validation
- `packages/control-plane/src/evaluation.ts` — A/B/C, compute matching, holdout, leakage
- `packages/control-plane/src/promotion.ts` — deterministic gate, authority, hard gates
- `packages/control-plane/src/shadow.ts` — shadow execution, mutation guard
- `packages/control-plane/src/canary.ts` — bounded canary, kill switch
- `packages/control-plane/src/production-pointer.ts` — atomic pointer, CAS, history, rollback
- `packages/control-plane/src/kpis.ts` — P5.4 KPIs (candidate_count, rejection_rate, etc.)
- `packages/control-plane/src/index.ts` — exports
- `apps/server/src/routes/evolution.ts` — API (current, candidates, evaluations, promotion, shadow, canary, rollback)
- `apps/web/src/components/evolution/` — Mission Control panel
- `packages/control-plane/src/__tests__/p54-*.test.ts` — 8 test files
- `packages/worker-pipeline/src/__tests__/p54-real-canary.test.ts` — real canaries A-H

## 3. Data Model (V10)

```sql
cp_harness_candidates (candidate_id PK, parent_profile_id, parent_profile_version, parent_profile_fingerprint, candidate_version, candidate_fingerprint UNIQUE, hypothesis, created_from_evidence_refs JSON, proposer_type, proposer_ref, candidate_profile_ref JSON, created_at, status)
cp_candidate_transitions (transition_id PK, candidate_id FK, previous_status, new_status, reason_code, created_at)
cp_dataset_partitions (partition_id PK, partition_type TRAIN|VALIDATION|HOLDOUT, dataset_fingerprint, partition_fingerprint, task_count, created_at)
cp_harness_evaluations (evaluation_id PK, candidate_id FK, baseline_profile_ref JSON, candidate_profile_ref JSON, compute_matched_profile_ref JSON, dataset_partition FK, task_family, sample_size, verified_success, first_pass_success, attempts_per_success, time_to_verified_success, tool_calls, tokens, cost, regressions JSON, security_result, contract_result, recovery_result, permission_result, scheduler_result, evaluation_fingerprint, reason_code, created_at)
cp_promotion_decisions (decision_id PK, candidate_id FK, current_profile_id, current_profile_fingerprint, candidate_profile_id, candidate_profile_fingerprint, evaluation_refs JSON, holdout_result, compute_matched_result, security_result, contract_result, recovery_result, permission_result, scheduler_budget_result, sample_size, decision, reason_code, policy_version, actor_authority, decision_fingerprint, created_at)
cp_shadow_runs (shadow_run_id PK, candidate_id FK, baseline_ref JSON, candidate_ref JSON, result_metrics JSON, profile_fingerprints JSON, production_pointer_before, production_pointer_after, created_at)
cp_canary_runs (canary_run_id PK, candidate_id FK, bounds JSON, status, metrics JSON, kill_switch_triggered, created_at, ended_at)
cp_production_profile_pointer (pointer_id PK single row, profile_id, profile_version, profile_fingerprint, updated_at, updated_by)
cp_profile_transitions (transition_id PK, previous_profile_id, previous_fingerprint, new_profile_id, new_fingerprint, reason_code, actor_authority, created_at)
```

All additive, idempotent, historical compatible. No existing attempt history mutated.

## 4. Vertical Slices

**A. Contracts + Candidate Store** — 3 contracts, V10 candidate tables, store, fingerprint, tunable allowlist, compiler gate
**B. Evaluation A/B/C + Holdout** — evaluation contract, A/B/C logic, compute matching, holdout partitioning, leakage defense, provenance
**C. Promotion Gate** — promotion contract, deterministic gate, kernel authority, 17 hard gates, security override
**D. Shadow + Canary** — shadow (no mutation), bounded canary, kill switch
**E. Atomic Promotion + Rollback** — pointer, CAS, idempotency, race safety, rollback exact
**F. API/UI/KPIs** — backend truth, Mission Control panel, KPIs
**G. Real Canaries A-H** — 8 canaries with persisted evidence
**H. Reviews + Closure** — independent architecture/security/evaluation reviews, full regression, #426/#422 closure, P5.5 gate

## 5. Dependencies

A → B → C → D → E → F → G → H (sequential, each slice tests before next)

## 6. Risks

- Highest risk tier in P5, independent reviews hard gate → AMBER if not proven
- No fake GREEN: if A/B/C only fixtures → NOT_PROVEN, if holdout not separated → NOT_PROVEN, if promotion only unit test → NOT_PROVEN
- Preserve staged changes (hermes, etc.) — do not reset/clean

## 7. Testing Strategy

Focused tests per slice → package regression → relevant real canary → commit. Final: full backend (2583+), full web (421+), typecheck, build, lint delta. P4, P5.1-5.3 remain GREEN.

## 8. Security

Kernel authority enforced via actor_authority check (must be KERNEL). Candidate cannot expand permissions (kernel ∩ profile). Security regression hard gate overrides performance. No raw prompts/secrets in candidate/evaluation/UI. All decisions reason-coded and auditable.
