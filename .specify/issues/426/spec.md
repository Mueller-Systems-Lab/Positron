# Specification: P5.4 Harness Evolution Sandbox

**Issue:** #426
**Parent:** #422
**Blocked by:** #425, #424, #423, P4 GREEN
**Status:** Approved
**Date:** 2026-08-22
**Branch:** positron/issue-426-harness-evolution
**Base HEAD:** 851d448c6e9df22cd9fba078d21fef198ae1190c

## 1. Purpose

Enable Positron to generate and evaluate new harness candidates from real execution evidence, with compute-matched evaluation, holdout isolation, shadow, bounded canary, deterministic promotion, and rollback — all under Positron Control Kernel authority.

**Invariant:** MODELS MAY PROPOSE. MODELS MAY NOT PROMOTE. EVALUATION PROVES. POSITRON PROMOTES.

## 2. Non-Goals

- Reimplement P5.1-P5.3 (profile provenance, compiler, diagnosis/routing remain)
- New control plane, queue, state machine, or external platform
- Training/fine-tuning model weights
- Candidate self-promotion or direct production mutation
- Candidate changing kernel policy, security sentinels, evaluation criteria, budgets, holdout
- New database (same SQLite control plane DB)
- Invented costs or token counts
- Auto-merge/push/deploy/release

## 3. Architecture

```
Production Attempts → Structured Evidence → Pattern Analysis → Candidate Proposal → Candidate Store → Validation → A/B/C Evaluation → Holdout → Regression + Security Sentinels → Shadow → Bounded Canary → Deterministic Promotion Gate → Atomic Pointer Change → Rollback
```

Control authority remains POSITRON CONTROL KERNEL. No candidate/LLM/evaluator may mutate production.

## 4. Data Contracts

### 4.1 positron.harness-candidate.v1
- candidate_id, parent_profile_id, parent_profile_version, parent_profile_fingerprint, candidate_version, candidate_fingerprint, hypothesis (metadata only), created_from_evidence_refs, proposer_type, proposer_ref, candidate_profile_ref, created_at (excluded from fingerprint), status (PROPOSED, VALIDATING, REJECTED, SHADOW, CANARY, PROMOTED, ROLLED_BACK)
- Fingerprint: deterministic, semantic, no runtime IDs/timestamps, hypothesis excluded

### 4.2 positron.harness-evaluation.v1
- evaluation_id, candidate_id, baseline_profile_ref, candidate_profile_ref, compute_matched_profile_ref, dataset_partition, task_family, sample_size, verified_success, first_pass_success, attempts_per_success, time_to_verified_success, tool_calls, tokens (only if real), cost (only if real price+token provenance else NOT_AVAILABLE), regressions, security_result, contract_result, recovery_result, permission_result, scheduler_result, evaluation_fingerprint, reason_code

### 4.3 positron.harness-promotion-decision.v1
- candidate_id, current_profile_id, current_profile_fingerprint, candidate_profile_id, candidate_profile_fingerprint, evaluation_refs, holdout_result, compute_matched_result, security_result, contract_result, recovery_result, permission_result, scheduler_budget_result, sample_size, decision (PROMOTE, REJECT, INSUFFICIENT_EVIDENCE, ROLLBACK_REQUIRED), reason_code, policy_version, actor_authority, decision_fingerprint

## 5. Candidate Store

Same SQLite DB, no new DB. Tables: cp_harness_candidates, cp_candidate_transitions, cp_harness_evaluations, cp_dataset_partitions, cp_promotion_decisions, cp_shadow_runs, cp_canary_runs, cp_production_profile_pointer, cp_profile_transitions. Immutable identity, auditable transitions, new version/new fingerprint on change, never overwrite V1.

## 6. Evaluation

- A/B/C mandatory: A=current, B=candidate, C=current+compute-matched budget. B>A but B<=C → COMPUTE_ADVANTAGE_NOT_HARNESS, not PROMOTION_APPROVED
- Compute matching: deterministic, versioned policy, multiple measures (attempts, model calls, token budget, reasoning budget, wall clock), no fake precision
- Holdout: TRAIN/DISCOVERY, VALIDATION, HOLDOUT strict partitioning, candidate creation has no HOLDOUT access, persist partition fingerprint
- Leakage defense: 4 types (TRAIN↔HOLDOUT, REPOSITORY, TASK-FAMILY, CANDIDATE-EVALUATOR), proposer cannot select holdout/change policy/declare success/promote, leakage → EVALUATION_INVALID, REJECTED
- Primary metric: VERIFIED_SUCCESS_RATE, secondary: FIRST_PASS, ATTEMPTS_PER_SUCCESS, TIME_TO_SUCCESS, TOOL_CALLS, TOKENS, ESCALATION_RATE, REGRESSION_RATE
- Sample size gate: deterministic minimum thresholds, size 1 → INSUFFICIENT_EVIDENCE, never PROMOTED
- Results: CANDIDATE_BETTER, NO_MEANINGFUL_DIFFERENCE, BASELINE_BETTER, COMPUTE_ADVANTAGE_NOT_HARNESS, INSUFFICIENT_EVIDENCE, EVALUATION_INVALID, SECURITY_REGRESSION, CRITICAL_REGRESSION

## 7. Promotion

- Authority: ONLY kernel may PROMOTE, LLM/candidate/evaluator/review/UI/OpenCode NO, explicit kernel path, tests for self-promotion
- Hard gates (ALL must pass): VALID_CANDIDATE, COMPUTE_MATCHED_EVALUATION_PASS, HOLDOUT_PASS, MIN_SAMPLE_PASS, VERIFIED_SUCCESS_NON_REGRESSION, CRITICAL_SUITE_PASS, SECURITY_SENTINELS_PASS, CONTRACT_GATES_PASS, RECOVERY_GATES_PASS, PERMISSION_GATES_PASS, SCHEDULER_BUDGET_GATES_PASS, BLIND_RETRY_RATE_ZERO, NO_EVALUATION_LEAKAGE, SHADOW_PASS, CANARY_PASS, ROLLBACK_AVAILABLE, ATOMATICITY_PRECHECK_PASS
- Security regression overrides performance: +20% verified success but security regression → REJECT, no weighted average
- Candidate cannot change kernel policy, sentinels, metrics, thresholds, holdout, budgets, promotion/rollback policy — only tunable surface (reasoning mode, model profile choices, task profile knobs, context strategy, tool subset, retrieval strategy, timeout/max steps within kernel max, compaction strategy)

## 8. Shadow & Canary

- Shadow: may evaluate real tasks, never mutate production pointer/routing/writes, persist shadow_run_id, candidate_id, baseline/candidate refs, metrics, fingerprints, prove before==after
- Canary: only after offline/holdout/regression/security/shadow, bounded by max_runs, max_attempts, max_duration, max_provider_capacity, max_budget, traffic fraction, kill switch, no unbounded exposure
- Kill switch: security/critical regression, repeated failure, budget/capacity exceeded, invariant violation → CANARY_STOPPED, not promoted, pointer remains safe

## 9. Production Pointer

- Kernel-owned, exact ID/version/fingerprint, atomic, auditable, recoverable, immutable history, never overwrite content, pointer switches A→B, history preserved
- Atomic promotion: preconditions expected_current_fingerprint, candidate_fingerprint, gate fingerprints, conflict if changed → PROMOTION_CONFLICT, no partial, CAS semantics
- Idempotent: duplicate identical request → no second mutation, tests for NOOP
- Rollback: must know previous ID/version/fingerprint before promotion, atomic → exact prior fingerprint, not similar, ROLLBACK_RESTORES_EXACT_PREVIOUS_PROFILE, must be testable before promotion or blocked with ROLLBACK_NOT_PROVEN

## 10. Acceptance Criteria

- [ ] Candidate Store exists with immutable identity, provenance, status
- [ ] Candidates versioned and fingerprinted
- [ ] Evaluation Records persist A/B/C refs and metrics/reasons
- [ ] Holdout/training partitions separate and enforced
- [ ] A/B/C compute-matched comparison mandatory
- [ ] Primary metric verified success; small samples → INSUFFICIENT_EVIDENCE
- [ ] Shadow cannot mutate production
- [ ] Canary bounded and auditable
- [ ] Promotion deterministic, atomic, kernel-authorized, cannot be self-triggered
- [ ] Security, Contract, Recovery, Permission, Scheduler/Budget, blind-retry gates required
- [ ] Rejection on security/verified-success regression and rollback proven
- [ ] Production unchanged until promotion; rollback restores previous
- [ ] No raw prompts/secrets in candidate/evaluation/UI

## 11. Tests

CANDIDATE_CANNOT_SELF_PROMOTE, MODEL_CANNOT_SELF_PROMOTE, CANDIDATE_CANNOT_CHANGE_KERNEL_POLICY, TRAIN_HOLDOUT_SEPARATION, COMPUTE_MATCHED_BASELINE_REQUIRED, INSUFFICIENT_SAMPLE_DENIES_PROMOTION, SECURITY_REGRESSION_DENIES_PROMOTION, VERIFIED_SUCCESS_REGRESSION_DENIES_PROMOTION, SHADOW_NO_PRODUCTION_MUTATION, CANARY_BOUNDED, PROMOTION_ATOMIC, ROLLBACK_RESTORES_PREVIOUS_PROFILE, fingerprint determinism, leakage negatives, contract/recovery/permission/scheduler regression, race/idempotency

## 12. Real Canaries A-H

A: Current vs Candidate on real disposable workload
B: Candidate vs compute-matched Current
C: Hidden holdout never used to create candidate (isolation proof)
D: Security-regression candidate rejected
E: Shadow proves no mutation
F: Bounded canary with explicit small bounds
G: Atomic promotion A→B with history
H: Rollback B→A exact fingerprint

## 13. Security Invariants

Unchanged: SECURITY_HARD_BLOCK, EXECUTION_CONTEXT_REQUIRED, ATTEMPT_CLAIM_EXCLUSIVE, IDEMPOTENT_DISPATCH, DUPLICATE_COMPLETION_NOOP, LATE_RESULT_FENCING, Contract Validation, PLAN_READ_ONLY, Provider Secret Isolation, no auto push/merge/deploy. Effective permissions = kernel ∩ profile.

## 14. Evidence Rules

Metadata-first, no prompts/responses/tokens/headers/.env/secrets in telemetry. Tokens only if provider-reported, costs only with price+token provenance else NOT_AVAILABLE. No statistical decision with sample 1. Candidate/holdout strictly separated. Every decision deterministic, reason-coded, auditable.
