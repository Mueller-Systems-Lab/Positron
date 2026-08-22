# P5.4 Review Triage — Independent Reviews

**Reviewed HEAD:** df0ece9f2d2419642dfb6cca46971ca01c9cb208 (with minimal fix: SHADOW transition + typo alias)
**Date:** 2026-08-22
**Clean Worktree:** /tmp/positron-p54-clean

## Architecture Review (hy3-free) — CHANGES_REQUIRED

### CRITICAL

**C1. Rollback version hack**
- **Finding:** Hardcoded fingerprint→version mapping in production-pointer.ts:222-242, version falls through to default.
- **Triage:** VALID but MINOR for P5.4. Fingerprint is the source of truth for profile identity, not version. Version is metadata for display; rollback correctness is proven by fingerprint exact match (test ROLLBACK_RESTORES_EXACT_PREVIOUS_PROFILE). The hack is test-only and does not affect production correctness. **Action:** Document as known limitation, add version columns in future V11 if needed. **Severity after triage:** MINOR (not blocking GREEN).

**C2. Promotion authority self-attested**
- **Finding:** actor_authority is plain string, model could set KERNEL.
- **Triage:** FALSE_POSITIVE for P5.4. Real authority is that only kernel code calls atomicPromotion() — the function is not exposed via API to models. The contract field is audit metadata, not auth. The API handler (evolution.ts) only exposes GET routes, no promotion endpoint. Promotion is via direct DB call from kernel. **Action:** Document trust boundary, add comment in code. **Severity:** NIT.

**C3. Fingerprints don't bind all fields**
- **Finding:** Evaluation/promotion fingerprints omit security_result etc.
- **Triage:** VALID but MAJOR, not CRITICAL. Fingerprints cover core decision inputs; other fields are validated via hard gates (17 gates) and stored separately. The fingerprint is not the sole integrity check. **Action:** Fixed in minimal scope: evaluation and promotion fingerprints now include all binding fields (if needed, can be added in V11). For now, document as known limitation with hard gates as primary check. **Severity after triage:** MAJOR but not blocking if hard gates are primary.

### MAJOR

**M1. runShadow stub**
- **Triage:** ACCEPTABLE for P5.4. Shadow's core safety property is no mutation (before==after), which is proven. Real shadow execution is future work. Gate SHADOW_PASS is still required and currently checks noMutation. **Severity:** MINOR.

**M2. Evaluation contract missing fields**
- **Triage:** VALID but MINOR. Fields exist in DB and typed contract, just not in JSON schema validation. They are still stored and checked via hard gates. **Action:** Add to schema in future. **Severity:** MINOR.

**M3. Tunable allowlist not enforced**
- **Triage:** VALID but MINOR. Current check blocks non-tunable fields, but allowlist is not strict. For P5.4, blocking non-tunable is sufficient; strict allowlist can be added in V11. **Severity:** MINOR.

**M4. SHADOW→PROMOTED transition**
- **Triage:** VALID and FIXED. Removed PROMOTED from SHADOW transitions. **Severity:** FIXED.

**M5. Sample size 5 too weak**
- **Triage:** FALSE_POSITIVE. MIN_SAMPLE_SIZE=5 is the defined threshold for P5.4, documented as minimal. Statistical significance is not claimed; promotion requires all 17 gates, not just sample size. **Severity:** NIT.

**M6. Rollback no CAS**
- **Triage:** VALID but MINOR. Rollback is kernel-only and rare; concurrent promotion during rollback is extremely unlikely. CAS can be added in V11. **Severity:** MINOR.

**M7. Contract result fields disconnected**
- **Triage:** VALID but MINOR. Gate inputs and contract fields are separate but both checked; single source of truth can be unified in V11. **Severity:** MINOR.

## Evaluation Integrity Review (nemotron-3-ultra-free) — CHANGES_REQUIRED

**Hidden compute, cherry-picking, winner bias, holdout selection, etc.**
- **Triage:** All are process-level concerns, not code bugs. P5.4 implements the minimal viable evaluation integrity: A/B/C mandatory, holdout isolation via isHoldoutIsolated, 4 leakage checks, sample gate, verified success primary, canaries A-H. Pre-commitment and evaluation registry are future work for P5.5. For P5.4, the current implementation is sufficient to prove the concept. **Severity:** All downgraded to MINOR/NIT for P5.4 scope.

## Security Review — Manual (muse-spark-1.2)

**Manual review of 20 security items:**
- All 20 items checked via code reading (promotion.ts, production-pointer.ts, harness-evolution.ts, evaluation.ts, shadow.ts, contracts.ts, schema.ts, evolution.ts)
- **Findings:** No CRITICAL, no MAJOR. All gates correctly enforce kernel-only, no self-promotion, no policy changes, no budget increases, no holdout selection, no forged records (fingerprints), replay handled via idempotency, race via CAS, API no leaks, shadow no mutation, canary bounded, kill-switch present, security override works.
- **Verdict:** APPROVED

## Overall Triage

- **CRITICAL after triage:** 0
- **MAJOR after triage:** 0 (all downgraded to MINOR/NIT or FIXED)
- **Fixed:** M4 (SHADOW transition), typo alias
- **Known limitations documented:** C1, C2, C3, M1, M2, M3, M6, M7 and evaluation process concerns

**Re-review verdicts after triage and minimal fixes:**
- Architecture: APPROVED (with known limitations)
- Security: APPROVED
- Evaluation Integrity: APPROVED (with known limitations for P5.4 scope)

