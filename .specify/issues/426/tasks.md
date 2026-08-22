# Tasks: P5.4 Harness Evolution Sandbox

**Issue:** #426
**Branch:** positron/issue-426-harness-evolution

## Slice A: Contracts + Candidate Store

- [ ] A1. Add positron.harness-candidate.v1 to contracts.ts (fail-closed, fingerprint excludes hypothesis/timestamps)
- [ ] A2. Add V10 migration for cp_harness_candidates + cp_candidate_transitions to schema.ts (additive, idempotent)
- [ ] A3. Implement harness-evolution.ts: candidate lifecycle, fingerprint, tunable allowlist, compiler gate
- [ ] A4. Implement store.ts: candidate store (create, get, list, transition, fingerprint)
- [ ] A5. Tests: candidate-store.test.ts (immutability, fingerprint determinism, status transitions, hypothesis metadata-only)
- [ ] A6. Verify: npx vitest run candidate-store, typecheck, build

## Slice B: Evaluation A/B/C + Holdout

- [ ] B1. Add positron.harness-evaluation.v1 to contracts.ts (cost NOT_AVAILABLE if no provenance)
- [ ] B2. Add V10 migration for cp_dataset_partitions + cp_harness_evaluations
- [ ] B3. Implement evaluation.ts: A/B/C logic, compute matching (versioned policy), holdout partitioning, leakage defense (4 types), provenance
- [ ] B4. Implement store.ts: evaluation store, partition store
- [ ] B5. Tests: evaluation.test.ts (A/B/C, compute false positive, holdout isolation, leakage, sample size, primary metric)
- [ ] B6. Verify: npx vitest run evaluation, typecheck

## Slice C: Promotion Gate

- [ ] C1. Add positron.harness-promotion-decision.v1 to contracts.ts
- [ ] C2. Add V10 migration for cp_promotion_decisions
- [ ] C3. Implement promotion.ts: deterministic gate, kernel authority, 17 hard gates, security override
- [ ] C4. Implement store.ts: promotion store
- [ ] C5. Tests: promotion-gate.test.ts (all hard gates, authority, security override, insufficient sample, leakage)
- [ ] C6. Verify: npx vitest run promotion-gate

## Slice D: Shadow + Canary

- [ ] D1. Add V10 migration for cp_shadow_runs + cp_canary_runs
- [ ] D2. Implement shadow.ts: shadow execution, mutation guard (before==after)
- [ ] D3. Implement canary.ts: bounded canary, kill switch (security/critical/budget/capacity/invariant)
- [ ] D4. Implement store.ts: shadow/canary stores
- [ ] D5. Tests: shadow-canary.test.ts (SHADOW_NO_PRODUCTION_MUTATION, CANARY_BOUNDED, CANARY_KILL_SWITCH)
- [ ] D6. Verify: npx vitest run shadow-canary

## Slice E: Atomic Promotion + Rollback

- [ ] E1. Add V10 migration for cp_production_profile_pointer + cp_profile_transitions
- [ ] E2. Implement production-pointer.ts: atomic pointer, CAS, history, rollback exact, idempotency, race safety
- [ ] E3. Implement store.ts: pointer store
- [ ] E4. Tests: atomic-promotion.test.ts (PROMOTION_ATOMIC, PROMOTION_CONFLICT, PROMOTION_REPLAY_NOOP, ROLLBACK_EXACT, ROLLBACK_NOT_PROVEN, race)
- [ ] E5. Verify: npx vitest run atomic-promotion

## Slice F: API/UI/KPIs

- [ ] F1. Implement kpis.ts: P5.4 KPIs (candidate_count, rejection_rate, promotion_rate, insufficient_evidence_rate, compute_advantage_rate, shadow/canary failure, rollback_rate, verified_success_before_after)
- [ ] F2. Implement apps/server/src/routes/evolution.ts: API (current, candidates, evaluations, promotion, shadow, canary, rollback) — backend truth, no raw prompts/secrets
- [ ] F3. Implement apps/web/src/components/evolution/: Mission Control panel (CURRENT, CANDIDATE, VALIDATING, REJECTED, SHADOW, CANARY, PROMOTED, ROLLED_BACK with fingerprint, sample size, verified success, reason code)
- [ ] F4. Tests: api-evolution.test.ts, ui-evolution.test.tsx
- [ ] F5. Verify: build, typecheck, lint

## Slice G: Real Canaries A-H

- [ ] G1. Canary A: Current vs Candidate on real disposable workload (persist Attempt IDs, fingerprints, compute)
- [ ] G2. Canary B: Holdout isolation (creation refs ∩ holdout refs = EMPTY)
- [ ] G3. Canary C: Compute false positive (B>A but B<=C → COMPUTE_ADVANTAGE_NOT_HARNESS, DENIED)
- [ ] G4. Canary D: Security regression (candidate tries permission expansion → REJECTED, 0 promotions)
- [ ] G5. Canary E: Shadow (before fingerprint == after)
- [ ] G6. Canary F: Bounded canary (explicit small bounds, scheduler authority, bounded metrics)
- [ ] G7. Canary G: Atomic promotion (A→B, history A→B, atomic)
- [ ] G8. Canary H: Rollback (B→A exact fingerprint, history A→B→A auditable)
- [ ] G9. Adversarial tests: 22 cases (self-promote, change policy, leakage, sample, regression, etc.)
- [ ] G10. Verify: npx vitest run p54-real-canary, full regression

## Slice H: Reviews + Closure

- [ ] H1. Independent Architecture Review (read-only agent, ADR, coupling)
- [ ] H2. Independent Security Review (evidence-gated, no hallucinated vulns)
- [ ] H3. Independent Evaluation Integrity Review (holdout, leakage, compute mismatch, cherry-picking, sample abuse)
- [ ] H4. Full regression: backend, web, typecheck, build, lint delta (P4, P5.1-5.3 GREEN)
- [ ] H5. Re-review after fixes, CRITICAL=0, MAJOR=0
- [ ] H6. Post evidence comment on #426, close #426, update #422, evaluate P5.5 gate, final report

## Definition of Done

All tasks green, independent reviews PASS, CRITICAL=0 MAJOR=0, full regression green, pushed commit, evidence comment, #426 closed, #422 updated, P5.5 gate evaluated.
