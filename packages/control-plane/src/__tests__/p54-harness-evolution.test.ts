import Database from 'better-sqlite3';
// Positron P5.4 — Harness Evolution Tests (Adversarial + Canaries)
import { beforeEach, describe, expect, it } from 'vitest';
import { validateContract } from '../contracts.js';
import {
	buildEvaluation,
	checkLeakage,
	computeMatchedBudget,
	evaluateResult,
	hasLeakage,
	isComputeMatched,
	isHoldoutIsolated,
	MIN_SAMPLE_SIZE,
} from '../evaluation.js';
import {
	buildCandidate,
	computeCandidateFingerprint,
	isNonTunableField,
	isTunableField,
	isValidTransition,
	validateCandidate,
} from '../harness-evolution.js';
import { computeEvolutionKpis } from '../kpis.js';
import {
	atomicPromotion,
	getProductionPointer,
	getProfileTransitions,
	initProductionPointer,
	rollbackToPrevious,
} from '../production-pointer.js';
import {
	buildPromotionDecision,
	evaluatePromotionGate,
	HARD_GATES,
	isKernelAuthority,
} from '../promotion.js';
import { applyControlPlaneMigrations } from '../schema.js';
import {
	checkCanaryKillSwitch,
	completeCanary,
	isCanaryBounded,
	runShadow,
	startCanary,
	stopCanary,
} from '../shadow.js';

function createTestDb(): Database.Database {
	const db = new Database(':memory:');
	applyControlPlaneMigrations(db);
	return db;
}

// ---------------------------------------------------------------------------
// CANDIDATE
// ---------------------------------------------------------------------------

describe('CANDIDATE_STORE', () => {
	it('candidate is versioned and fingerprinted deterministically', () => {
		const c1 = buildCandidate({
			candidate_id: 'cand-1',
			parent_profile_id: 'profile-a',
			parent_profile_version: '1.0.0',
			parent_profile_fingerprint: 'a'.repeat(64),
			candidate_version: '1.0.1',
			hypothesis: 'improve context strategy',
			created_from_evidence_refs: ['att-1', 'att-2'],
			proposer_type: 'LLM',
			proposer_ref: 'model-x',
			candidate_profile_ref: { profile_id: 'profile-b', version: '1.0.1' },
		});
		const c2 = buildCandidate({
			candidate_id: 'cand-1',
			parent_profile_id: 'profile-a',
			parent_profile_version: '1.0.0',
			parent_profile_fingerprint: 'a'.repeat(64),
			candidate_version: '1.0.1',
			hypothesis: 'different hypothesis but same semantics should differ? hypothesis excluded',
			created_from_evidence_refs: ['att-2', 'att-1'],
			proposer_type: 'LLM',
			proposer_ref: 'model-x',
			candidate_profile_ref: { profile_id: 'profile-b', version: '1.0.1' },
		});
		// Fingerprint excludes hypothesis and is sorted, so same semantics → same fingerprint
		expect(c1.candidate_fingerprint).toBe(c2.candidate_fingerprint);
		expect(c1.candidate_fingerprint).toMatch(/^[0-9a-f]{64}$/);
	});

	it('CANDIDATE_FINGERPRINT deterministic', () => {
		const input = {
			candidate_id: 'cand-1',
			parent_profile_id: 'profile-a',
			parent_profile_version: '1.0.0',
			parent_profile_fingerprint: 'a'.repeat(64),
			candidate_version: '1.0.1',
			hypothesis: 'test',
			created_from_evidence_refs: ['att-1'],
			proposer_type: 'LLM',
			proposer_ref: 'model-x',
			candidate_profile_ref: { profile_id: 'profile-b', version: '1.0.1' },
			status: 'PROPOSED' as const,
		};
		const fp1 = computeCandidateFingerprint(
			input as unknown as Parameters<typeof computeCandidateFingerprint>[0],
		);
		const fp2 = computeCandidateFingerprint(
			input as unknown as Parameters<typeof computeCandidateFingerprint>[0],
		);
		expect(fp1).toBe(fp2);
	});

	it('CANDIDATE_IMMUTABILITY: new version on change, not overwrite', () => {
		const c1 = buildCandidate({
			candidate_id: 'cand-1',
			parent_profile_id: 'profile-a',
			parent_profile_version: '1.0.0',
			parent_profile_fingerprint: 'a'.repeat(64),
			candidate_version: '1.0.1',
			hypothesis: 'v1',
			created_from_evidence_refs: ['att-1'],
			proposer_type: 'LLM',
			proposer_ref: 'model-x',
			candidate_profile_ref: { profile_id: 'profile-b', version: '1.0.1' },
		});
		const c2 = buildCandidate({
			candidate_id: 'cand-1',
			parent_profile_id: 'profile-a',
			parent_profile_version: '1.0.0',
			parent_profile_fingerprint: 'a'.repeat(64),
			candidate_version: '1.0.2',
			hypothesis: 'v2',
			created_from_evidence_refs: ['att-1'],
			proposer_type: 'LLM',
			proposer_ref: 'model-x',
			candidate_profile_ref: { profile_id: 'profile-b', version: '1.0.2' },
		});
		expect(c1.candidate_version).not.toBe(c2.candidate_version);
		expect(c1.candidate_fingerprint).not.toBe(c2.candidate_fingerprint);
	});

	it('hypothesis is metadata, not executable', () => {
		const c = buildCandidate({
			candidate_id: 'cand-1',
			parent_profile_id: 'profile-a',
			parent_profile_version: '1.0.0',
			parent_profile_fingerprint: 'a'.repeat(64),
			candidate_version: '1.0.1',
			hypothesis: 'try kernel_policy change',
			created_from_evidence_refs: ['att-1'],
			proposer_type: 'LLM',
			proposer_ref: 'model-x',
			candidate_profile_ref: { profile_id: 'profile-b', version: '1.0.1' },
		});
		const result = validateCandidate(c);
		expect(result.ok).toBe(false);
		expect(result.errors.join(' ')).toContain('executable policy');
	});

	it('candidate contract validates', () => {
		const c = buildCandidate({
			candidate_id: 'cand-1',
			parent_profile_id: 'profile-a',
			parent_profile_version: '1.0.0',
			parent_profile_fingerprint: 'a'.repeat(64),
			candidate_version: '1.0.1',
			hypothesis: 'improve reasoning',
			created_from_evidence_refs: ['att-1'],
			proposer_type: 'LLM',
			proposer_ref: 'model-x',
			candidate_profile_ref: { profile_id: 'profile-b', version: '1.0.1' },
		});
		const result = validateContract(
			'positron.harness-candidate.v1',
			c as unknown as Record<string, unknown>,
			1,
		);
		expect(result.ok).toBe(true);
	});

	it('status transitions auditable', () => {
		expect(isValidTransition('PROPOSED', 'VALIDATING')).toBe(true);
		expect(isValidTransition('PROPOSED', 'REJECTED')).toBe(true);
		expect(isValidTransition('PROPOSED', 'PROMOTED')).toBe(false);
		expect(isValidTransition('PROMOTED', 'ROLLED_BACK')).toBe(true);
		expect(isValidTransition('REJECTED', 'PROMOTED')).toBe(false);
	});
});

describe('TUNABLE_SURFACE_ALLOWLIST', () => {
	it('tunable fields are allowlisted', () => {
		expect(isTunableField('reasoning_mode')).toBe(true);
		expect(isTunableField('context_strategy')).toBe(true);
		expect(isTunableField('tool_subset')).toBe(true);
	});
	it('non-tunable fields are blocked', () => {
		expect(isNonTunableField('security_permissions')).toBe(true);
		expect(isNonTunableField('kernel_permissions')).toBe(true);
		expect(isNonTunableField('scheduler_authority')).toBe(true);
	});
	it('CANDIDATE_CANNOT_CHANGE_KERNEL_POLICY', () => {
		const c = buildCandidate({
			candidate_id: 'cand-1',
			parent_profile_id: 'profile-a',
			parent_profile_version: '1.0.0',
			parent_profile_fingerprint: 'a'.repeat(64),
			candidate_version: '1.0.1',
			hypothesis: 'test',
			created_from_evidence_refs: ['att-1'],
			proposer_type: 'LLM',
			proposer_ref: 'model-x',
			candidate_profile_ref: {
				profile_id: 'profile-b',
				version: '1.0.1',
				kernel_permissions: { push: true },
			},
		});
		const result = validateCandidate(c);
		expect(result.ok).toBe(false);
		expect(result.errors.join(' ')).toContain('not tunable');
	});
});

// ---------------------------------------------------------------------------
// EVALUATION A/B/C
// ---------------------------------------------------------------------------

describe('A_B_C_EVALUATION', () => {
	it('COMPUTE_MATCHED_BASELINE_REQUIRED', () => {
		const baseline = {
			attempts: 1,
			model_calls: 1,
			token_budget: 1000,
			reasoning_budget: 100,
			wall_clock_ms: 1000,
		};
		const candidate = {
			attempts: 3,
			model_calls: 3,
			token_budget: 3000,
			reasoning_budget: 300,
			wall_clock_ms: 3000,
		};
		const matched = computeMatchedBudget(baseline, candidate);
		expect(matched.attempts).toBe(3);
		expect(matched.token_budget).toBe(3000);
		expect(isComputeMatched(baseline, candidate, matched)).toBe(true);
		expect(isComputeMatched(baseline, candidate, baseline)).toBe(false);
	});

	it('B > A but B <= C → COMPUTE_ADVANTAGE_NOT_HARNESS', () => {
		const result = evaluateResult({
			candidateVerifiedSuccess: 0.8,
			baselineVerifiedSuccess: 0.6,
			computeMatchedVerifiedSuccess: 0.85,
			sampleSize: 10,
		});
		expect(result.result).toBe('COMPUTE_ADVANTAGE_NOT_HARNESS');
		expect(result.reason_code).toBe('COMPUTE_ADVANTAGE_NOT_HARNESS');
	});

	it('B > C → CANDIDATE_BETTER', () => {
		const result = evaluateResult({
			candidateVerifiedSuccess: 0.9,
			baselineVerifiedSuccess: 0.6,
			computeMatchedVerifiedSuccess: 0.7,
			sampleSize: 10,
		});
		expect(result.result).toBe('CANDIDATE_BETTER');
	});

	it('evaluation contract validates', () => {
		const evalContract = buildEvaluation({
			evaluation_id: 'eval-1',
			candidate_id: 'cand-1',
			baseline_profile_ref: { profile_id: 'profile-a', version: '1.0.0' },
			candidate_profile_ref: { profile_id: 'profile-b', version: '1.0.1' },
			compute_matched_profile_ref: {
				profile_id: 'profile-a',
				version: '1.0.0',
				compute_matched: true,
			},
			dataset_partition: 'part-1',
			sample_size: 10,
			verified_success: 0.8,
			first_pass_success: 0.6,
			security_result: 'PASS',
			contract_result: 'PASS',
			recovery_result: 'PASS',
			permission_result: 'PASS',
			scheduler_result: 'PASS',
			reason_code: 'CANDIDATE_BETTER',
		});
		const result = validateContract(
			'positron.harness-evaluation.v1',
			evalContract as unknown as Record<string, unknown>,
			1,
		);
		expect(result.ok).toBe(true);
		expect(evalContract.cost).toBe('NOT_AVAILABLE');
	});
});

describe('HOLDOUT_AND_LEAKAGE', () => {
	it('TRAIN_HOLDOUT_SEPARATION', () => {
		expect(isHoldoutIsolated(['att-1', 'att-2'], ['att-3', 'att-4'])).toBe(true);
		expect(isHoldoutIsolated(['att-1', 'att-2'], ['att-2', 'att-3'])).toBe(false);
	});

	it('REPOSITORY_LEAKAGE_REJECTED', () => {
		const checks = checkLeakage({
			creationEvidenceRefs: ['att-1'],
			holdoutEvidenceRefs: ['att-2'],
			repositoryRefs: ['att-2'],
			taskFamilyRefs: [],
			evaluatorRefs: [],
			proposerRefs: ['proposer-1'],
		});
		const repoCheck = checks.find((c) => c.type === 'REPOSITORY')!;
		expect(repoCheck.detected).toBe(true);
		expect(hasLeakage(checks)).toBe(true);
	});

	it('TASK_FAMILY_LEAKAGE_REJECTED', () => {
		const checks = checkLeakage({
			creationEvidenceRefs: ['task-family-a'],
			holdoutEvidenceRefs: ['task-family-a'],
			repositoryRefs: [],
			taskFamilyRefs: ['task-family-a'],
			evaluatorRefs: [],
			proposerRefs: [],
		});
		const taskCheck = checks.find((c) => c.type === 'TASK_FAMILY')!;
		expect(taskCheck.detected).toBe(true);
	});

	it('EVALUATOR_LEAKAGE_REJECTED', () => {
		const checks = checkLeakage({
			creationEvidenceRefs: ['att-1'],
			holdoutEvidenceRefs: ['att-2'],
			repositoryRefs: [],
			taskFamilyRefs: [],
			evaluatorRefs: ['proposer-1'],
			proposerRefs: ['proposer-1'],
		});
		const evalCheck = checks.find((c) => c.type === 'CANDIDATE_EVALUATOR')!;
		expect(evalCheck.detected).toBe(true);
	});

	it('leakage → EVALUATION_INVALID', () => {
		const result = evaluateResult({
			candidateVerifiedSuccess: 0.9,
			baselineVerifiedSuccess: 0.6,
			computeMatchedVerifiedSuccess: 0.7,
			sampleSize: 10,
			hasLeakage: true,
		});
		expect(result.result).toBe('EVALUATION_INVALID');
	});
});

describe('SAMPLE_SIZE_GATE', () => {
	it('INSUFFICIENT_SAMPLE_DENIES_PROMOTION', () => {
		const result = evaluateResult({
			candidateVerifiedSuccess: 0.9,
			baselineVerifiedSuccess: 0.6,
			computeMatchedVerifiedSuccess: 0.7,
			sampleSize: 1,
		});
		expect(result.result).toBe('INSUFFICIENT_EVIDENCE');
	});
	it('MIN_SAMPLE_PASS requires threshold', () => {
		const result = evaluateResult({
			candidateVerifiedSuccess: 0.9,
			baselineVerifiedSuccess: 0.6,
			computeMatchedVerifiedSuccess: 0.7,
			sampleSize: MIN_SAMPLE_SIZE,
		});
		expect(result.result).toBe('CANDIDATE_BETTER');
	});
});

describe('PRIMARY_METRIC', () => {
	it('VERIFIED_SUCCESS_PRIMARY', () => {
		const result = evaluateResult({
			candidateVerifiedSuccess: 0.5,
			baselineVerifiedSuccess: 0.6,
			computeMatchedVerifiedSuccess: 0.6,
			sampleSize: 10,
		});
		expect(result.result).toBe('BASELINE_BETTER');
	});
	it('SECURITY_REGRESSION overrides', () => {
		const result = evaluateResult({
			candidateVerifiedSuccess: 0.9,
			baselineVerifiedSuccess: 0.6,
			computeMatchedVerifiedSuccess: 0.7,
			sampleSize: 10,
			securityRegression: true,
		});
		expect(result.result).toBe('SECURITY_REGRESSION');
	});
});

// ---------------------------------------------------------------------------
// PROMOTION GATE
// ---------------------------------------------------------------------------

describe('PROMOTION_GATE', () => {
	it('CANDIDATE_CANNOT_SELF_PROMOTE', () => {
		const result = evaluatePromotionGate({
			actor_authority: 'CANDIDATE',
			gates: Object.fromEntries(HARD_GATES.map((g) => [g, true])) as Record<
				(typeof HARD_GATES)[number],
				boolean
			>,
		});
		expect(result.decision).toBe('REJECT');
		expect(result.reason_code).toContain('NOT_KERNEL_AUTHORITY');
	});

	it('MODEL_CANNOT_SELF_PROMOTE', () => {
		const result = evaluatePromotionGate({
			actor_authority: 'MODEL',
			gates: Object.fromEntries(HARD_GATES.map((g) => [g, true])) as Record<
				(typeof HARD_GATES)[number],
				boolean
			>,
		});
		expect(result.decision).toBe('REJECT');
	});

	it('EVALUATOR_CANNOT_PROMOTE', () => {
		const result = evaluatePromotionGate({
			actor_authority: 'EVALUATOR',
			gates: Object.fromEntries(HARD_GATES.map((g) => [g, true])) as Record<
				(typeof HARD_GATES)[number],
				boolean
			>,
		});
		expect(result.decision).toBe('REJECT');
	});

	it('KERNEL can promote when all gates pass', () => {
		const result = evaluatePromotionGate({
			actor_authority: 'KERNEL',
			gates: Object.fromEntries(HARD_GATES.map((g) => [g, true])) as Record<
				(typeof HARD_GATES)[number],
				boolean
			>,
		});
		expect(result.decision).toBe('PROMOTE');
		expect(result.allGatesPassed).toBe(true);
	});

	it('SECURITY_REGRESSION_DENIES_PROMOTION', () => {
		const result = evaluatePromotionGate({
			actor_authority: 'KERNEL',
			gates: Object.fromEntries(HARD_GATES.map((g) => [g, true])) as Record<
				(typeof HARD_GATES)[number],
				boolean
			>,
			securityRegression: true,
		});
		expect(result.decision).toBe('REJECT');
		expect(result.reason_code).toContain('SECURITY_REGRESSION');
	});

	it('VERIFIED_SUCCESS_REGRESSION_DENIES_PROMOTION', () => {
		const gates = Object.fromEntries(HARD_GATES.map((g) => [g, true])) as Record<
			(typeof HARD_GATES)[number],
			boolean
		>;
		gates.VERIFIED_SUCCESS_NON_REGRESSION = false;
		const result = evaluatePromotionGate({
			actor_authority: 'KERNEL',
			gates,
			verifiedSuccessRegression: true,
		});
		expect(result.decision).toBe('REJECT');
	});

	it('CRITICAL_REGRESSION_DENIES_PROMOTION', () => {
		const gates = Object.fromEntries(HARD_GATES.map((g) => [g, true])) as Record<
			(typeof HARD_GATES)[number],
			boolean
		>;
		gates.CRITICAL_SUITE_PASS = false;
		const result = evaluatePromotionGate({
			actor_authority: 'KERNEL',
			gates,
			criticalRegression: true,
		});
		expect(result.decision).toBe('REJECT');
	});

	it('INSUFFICIENT_SAMPLE_DENIES_PROMOTION', () => {
		const gates = Object.fromEntries(HARD_GATES.map((g) => [g, true])) as Record<
			(typeof HARD_GATES)[number],
			boolean
		>;
		gates.MIN_SAMPLE_PASS = false;
		const result = evaluatePromotionGate({
			actor_authority: 'KERNEL',
			gates,
			sampleSize: 1,
			minSampleSize: 5,
		});
		expect(result.decision).toBe('INSUFFICIENT_EVIDENCE');
	});

	it('ROLLBACK_UNAVAILABLE_DENIES_PROMOTION', () => {
		const gates = Object.fromEntries(HARD_GATES.map((g) => [g, true])) as Record<
			(typeof HARD_GATES)[number],
			boolean
		>;
		gates.ROLLBACK_AVAILABLE = false;
		const result = evaluatePromotionGate({
			actor_authority: 'KERNEL',
			gates,
			rollbackAvailable: false,
		});
		expect(result.decision).toBe('REJECT');
		expect(result.reason_code).toContain('ROLLBACK_NOT_PROVEN');
	});

	it('promotion decision contract validates', () => {
		const decision = buildPromotionDecision({
			candidate_id: 'cand-1',
			current_profile_id: 'profile-a',
			current_profile_fingerprint: 'a'.repeat(64),
			candidate_profile_id: 'profile-b',
			candidate_profile_fingerprint: 'b'.repeat(64),
			evaluation_refs: ['eval-1'],
			holdout_result: 'PASS',
			compute_matched_result: 'PASS',
			security_result: 'PASS',
			contract_result: 'PASS',
			recovery_result: 'PASS',
			permission_result: 'PASS',
			scheduler_budget_result: 'PASS',
			sample_size: 10,
			decision: 'PROMOTE',
			reason_code: 'PROMOTE_ALL_GATES_PASSED',
			actor_authority: 'KERNEL',
		});
		const result = validateContract(
			'positron.harness-promotion-decision.v1',
			decision as unknown as Record<string, unknown>,
			1,
		);
		expect(result.ok).toBe(true);
	});

	it('PROMOTION_GATE_DETERMINISTIC', () => {
		const input = {
			actor_authority: 'KERNEL',
			gates: Object.fromEntries(HARD_GATES.map((g) => [g, true])) as Record<
				(typeof HARD_GATES)[number],
				boolean
			>,
		};
		const r1 = evaluatePromotionGate(input);
		const r2 = evaluatePromotionGate(input);
		expect(r1).toEqual(r2);
	});
});

// ---------------------------------------------------------------------------
// SHADOW & CANARY
// ---------------------------------------------------------------------------

describe('SHADOW_NO_PRODUCTION_MUTATION', () => {
	it('shadow does not mutate production pointer', () => {
		const db = createTestDb();
		initProductionPointer(db, {
			pointer_id: 'pointer-1',
			profile_id: 'profile-a',
			profile_version: '1.0.0',
			profile_fingerprint: 'a'.repeat(64),
			updated_at: new Date().toISOString(),
			updated_by: 'KERNEL',
		});
		// Insert candidate for FK
		db.prepare(
			`INSERT INTO cp_harness_candidates (candidate_id, parent_profile_id, parent_profile_version, parent_profile_fingerprint, candidate_version, candidate_fingerprint, hypothesis, created_from_evidence_refs, proposer_type, proposer_ref, candidate_profile_ref, created_at, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			'cand-1',
			'profile-a',
			'1.0.0',
			'a'.repeat(64),
			'1.0.1',
			'b'.repeat(64),
			'test',
			JSON.stringify(['att-1']),
			'LLM',
			'model-x',
			JSON.stringify({ profile_id: 'profile-b' }),
			new Date().toISOString(),
			'SHADOW',
		);
		const before = getProductionPointer(db)!.profile_fingerprint;
		const result = runShadow(db, {
			candidate_id: 'cand-1',
			baseline_ref: { profile_id: 'profile-a' },
			candidate_ref: { profile_id: 'profile-b' },
			result_metrics: { verified_success: 0.8 },
		});
		const after = getProductionPointer(db)!.profile_fingerprint;
		expect(result.noMutation).toBe(true);
		expect(result.beforeFingerprint).toBe(before);
		expect(result.afterFingerprint).toBe(after);
		expect(before).toBe(after);
	});
});

describe('CANARY_BOUNDED', () => {
	it('canary is bounded', () => {
		const bounds = {
			max_runs: 5,
			max_attempts: 10,
			max_duration_ms: 60000,
			max_provider_capacity: 2,
			max_budget: 100,
			traffic_fraction: 0.1,
			kill_switch_enabled: true,
		};
		expect(isCanaryBounded(bounds)).toBe(true);
		expect(isCanaryBounded({ ...bounds, max_runs: 0 })).toBe(false);
		expect(isCanaryBounded({ ...bounds, traffic_fraction: 2 })).toBe(false);
	});

	it('CANARY_KILL_SWITCH', () => {
		const db = createTestDb();
		db.prepare(
			`INSERT INTO cp_harness_candidates (candidate_id, parent_profile_id, parent_profile_version, parent_profile_fingerprint, candidate_version, candidate_fingerprint, hypothesis, created_from_evidence_refs, proposer_type, proposer_ref, candidate_profile_ref, created_at, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			'cand-1',
			'profile-a',
			'1.0.0',
			'a'.repeat(64),
			'1.0.1',
			'b'.repeat(64),
			'test',
			JSON.stringify(['att-1']),
			'LLM',
			'model-x',
			JSON.stringify({ profile_id: 'profile-b' }),
			new Date().toISOString(),
			'CANARY',
		);
		const canary = startCanary(db, {
			candidate_id: 'cand-1',
			bounds: {
				max_runs: 5,
				max_attempts: 10,
				max_duration_ms: 60000,
				max_provider_capacity: 2,
				max_budget: 100,
				traffic_fraction: 0.1,
				kill_switch_enabled: true,
			},
		});
		const check = checkCanaryKillSwitch(db, canary.canary_run_id, { securityRegression: true });
		expect(check.shouldStop).toBe(true);
		stopCanary(db, canary.canary_run_id, check.reason, true);
		const runs = db
			.prepare('SELECT status, kill_switch_triggered FROM cp_canary_runs WHERE canary_run_id = ?')
			.get(canary.canary_run_id) as { status: string; kill_switch_triggered: number };
		expect(runs.status).toBe('STOPPED');
		expect(runs.kill_switch_triggered).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// ATOMIC PROMOTION & ROLLBACK
// ---------------------------------------------------------------------------

describe('PROMOTION_ATOMIC', () => {
	it('atomic promotion succeeds with correct expected fingerprint', () => {
		const db = createTestDb();
		initProductionPointer(db, {
			pointer_id: 'pointer-1',
			profile_id: 'profile-a',
			profile_version: '1.0.0',
			profile_fingerprint: 'a'.repeat(64),
			updated_at: new Date().toISOString(),
			updated_by: 'KERNEL',
		});
		const result = atomicPromotion(db, {
			expected_current_fingerprint: 'a'.repeat(64),
			candidate_profile_id: 'profile-b',
			candidate_profile_version: '1.0.1',
			candidate_fingerprint: 'b'.repeat(64),
			reason_code: 'PROMOTE_ALL_GATES_PASSED',
			actor_authority: 'KERNEL',
		});
		expect(result.ok).toBe(true);
		expect(getProductionPointer(db)!.profile_fingerprint).toBe('b'.repeat(64));
		expect(getProfileTransitions(db)).toHaveLength(2);
	});

	it('PROMOTION_CONFLICT when expected fingerprint mismatches', () => {
		const db = createTestDb();
		initProductionPointer(db, {
			pointer_id: 'pointer-1',
			profile_id: 'profile-a',
			profile_version: '1.0.0',
			profile_fingerprint: 'a'.repeat(64),
			updated_at: new Date().toISOString(),
			updated_by: 'KERNEL',
		});
		const result = atomicPromotion(db, {
			expected_current_fingerprint: 'x'.repeat(64),
			candidate_profile_id: 'profile-b',
			candidate_profile_version: '1.0.1',
			candidate_fingerprint: 'b'.repeat(64),
			reason_code: 'PROMOTE',
			actor_authority: 'KERNEL',
		});
		expect(result.ok).toBe(false);
		expect(result.reason_code).toBe('PROMOTION_CONFLICT');
		expect(getProductionPointer(db)!.profile_fingerprint).toBe('a'.repeat(64));
	});

	it('PROMOTION_RACE_SAFE: concurrent promotions, one wins', () => {
		const db = createTestDb();
		initProductionPointer(db, {
			pointer_id: 'pointer-1',
			profile_id: 'profile-a',
			profile_version: '1.0.0',
			profile_fingerprint: 'a'.repeat(64),
			updated_at: new Date().toISOString(),
			updated_by: 'KERNEL',
		});
		const r1 = atomicPromotion(db, {
			expected_current_fingerprint: 'a'.repeat(64),
			candidate_profile_id: 'profile-b',
			candidate_profile_version: '1.0.1',
			candidate_fingerprint: 'b'.repeat(64),
			reason_code: 'PROMOTE',
			actor_authority: 'KERNEL',
		});
		expect(r1.ok).toBe(true);
		const r2 = atomicPromotion(db, {
			expected_current_fingerprint: 'a'.repeat(64),
			candidate_profile_id: 'profile-c',
			candidate_profile_version: '1.0.2',
			candidate_fingerprint: 'c'.repeat(64),
			reason_code: 'PROMOTE',
			actor_authority: 'KERNEL',
		});
		expect(r2.ok).toBe(false);
		expect(r2.reason_code).toBe('PROMOTION_CONFLICT');
		expect(getProductionPointer(db)!.profile_fingerprint).toBe('b'.repeat(64));
	});

	it('PROMOTION_REPLAY_NOOP: duplicate promotion is noop', () => {
		const db = createTestDb();
		initProductionPointer(db, {
			pointer_id: 'pointer-1',
			profile_id: 'profile-a',
			profile_version: '1.0.0',
			profile_fingerprint: 'a'.repeat(64),
			updated_at: new Date().toISOString(),
			updated_by: 'KERNEL',
		});
		atomicPromotion(db, {
			expected_current_fingerprint: 'a'.repeat(64),
			candidate_profile_id: 'profile-b',
			candidate_profile_version: '1.0.1',
			candidate_fingerprint: 'b'.repeat(64),
			reason_code: 'PROMOTE',
			actor_authority: 'KERNEL',
		});
		const duplicate = atomicPromotion(db, {
			expected_current_fingerprint: 'b'.repeat(64),
			candidate_profile_id: 'profile-b',
			candidate_profile_version: '1.0.1',
			candidate_fingerprint: 'b'.repeat(64),
			reason_code: 'PROMOTE',
			actor_authority: 'KERNEL',
		});
		expect(duplicate.ok).toBe(true);
		expect(duplicate.isDuplicate).toBe(true);
		expect(duplicate.reason_code).toBe('PROMOTION_DUPLICATE_NOOP');
		expect(getProfileTransitions(db)).toHaveLength(2); // no new transition for duplicate
	});

	it('CANDIDATE_CANNOT_SELF_PROMOTE via pointer', () => {
		const db = createTestDb();
		initProductionPointer(db, {
			pointer_id: 'pointer-1',
			profile_id: 'profile-a',
			profile_version: '1.0.0',
			profile_fingerprint: 'a'.repeat(64),
			updated_at: new Date().toISOString(),
			updated_by: 'KERNEL',
		});
		const result = atomicPromotion(db, {
			expected_current_fingerprint: 'a'.repeat(64),
			candidate_profile_id: 'profile-b',
			candidate_profile_version: '1.0.1',
			candidate_fingerprint: 'b'.repeat(64),
			reason_code: 'PROMOTE',
			actor_authority: 'CANDIDATE',
		});
		expect(result.ok).toBe(false);
	});
});

describe('ROLLBACK', () => {
	it('ROLLBACK_RESTORES_EXACT_PREVIOUS_PROFILE', () => {
		const db = createTestDb();
		initProductionPointer(db, {
			pointer_id: 'pointer-1',
			profile_id: 'profile-a',
			profile_version: '1.0.0',
			profile_fingerprint: 'a'.repeat(64),
			updated_at: new Date().toISOString(),
			updated_by: 'KERNEL',
		});
		atomicPromotion(db, {
			expected_current_fingerprint: 'a'.repeat(64),
			candidate_profile_id: 'profile-b',
			candidate_profile_version: '1.0.1',
			candidate_fingerprint: 'b'.repeat(64),
			reason_code: 'PROMOTE',
			actor_authority: 'KERNEL',
		});
		expect(getProductionPointer(db)!.profile_fingerprint).toBe('b'.repeat(64));
		const rollback = rollbackToPrevious(db, 'KERNEL');
		expect(rollback.ok).toBe(true);
		expect(getProductionPointer(db)!.profile_fingerprint).toBe('a'.repeat(64));
		expect(getProfileTransitions(db)).toHaveLength(3);
		expect(getProfileTransitions(db)[2]!.new_fingerprint).toBe('a'.repeat(64));
	});

	it('ROLLBACK_NOT_PROVEN when no previous', () => {
		const db = createTestDb();
		initProductionPointer(db, {
			pointer_id: 'pointer-1',
			profile_id: 'profile-a',
			profile_version: '1.0.0',
			profile_fingerprint: 'a'.repeat(64),
			updated_at: new Date().toISOString(),
			updated_by: 'KERNEL',
		});
		const rollback = rollbackToPrevious(db, 'KERNEL');
		expect(rollback.ok).toBe(false);
		expect(rollback.reason_code).toBe('ROLLBACK_NOT_PROVEN');
	});

	it('rollback history auditable A→B→A', () => {
		const db = createTestDb();
		initProductionPointer(db, {
			pointer_id: 'pointer-1',
			profile_id: 'profile-a',
			profile_version: '1.0.0',
			profile_fingerprint: 'a'.repeat(64),
			updated_at: new Date().toISOString(),
			updated_by: 'KERNEL',
		});
		atomicPromotion(db, {
			expected_current_fingerprint: 'a'.repeat(64),
			candidate_profile_id: 'profile-b',
			candidate_profile_version: '1.0.1',
			candidate_fingerprint: 'b'.repeat(64),
			reason_code: 'PROMOTE',
			actor_authority: 'KERNEL',
		});
		rollbackToPrevious(db, 'KERNEL');
		const transitions = getProfileTransitions(db);
		expect(transitions).toHaveLength(3);
		expect(transitions[0]!.new_fingerprint).toBe('a'.repeat(64));
		expect(transitions[1]!.new_fingerprint).toBe('b'.repeat(64));
		expect(transitions[2]!.new_fingerprint).toBe('a'.repeat(64));
	});
});

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

describe('P5_4_KPIS', () => {
	it('evolution KPIs computed', () => {
		const db = createTestDb();
		// Insert candidate
		db.prepare(
			`INSERT INTO cp_harness_candidates (candidate_id, parent_profile_id, parent_profile_version, parent_profile_fingerprint, candidate_version, candidate_fingerprint, hypothesis, created_from_evidence_refs, proposer_type, proposer_ref, candidate_profile_ref, created_at, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			'cand-1',
			'profile-a',
			'1.0.0',
			'a'.repeat(64),
			'1.0.1',
			'b'.repeat(64),
			'test',
			JSON.stringify(['att-1']),
			'LLM',
			'model-x',
			JSON.stringify({ profile_id: 'profile-b' }),
			new Date().toISOString(),
			'REJECTED',
		);
		const kpis = computeEvolutionKpis(db);
		expect(kpis.candidate_count).toBe(1);
		expect(kpis.candidate_rejection_rate).toBe(1);
		expect(kpis.candidate_promotion_rate).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// CONTRACTS
// ---------------------------------------------------------------------------

describe('P5_4_CONTRACTS', () => {
	it('all 3 contracts are known', () => {
		expect(
			validateContract(
				'positron.harness-candidate.v1',
				{
					contract: 'positron.harness-candidate.v1',
					candidate_id: 'cand-1',
					parent_profile_id: 'p-a',
					parent_profile_version: '1.0.0',
					parent_profile_fingerprint: 'a'.repeat(64),
					candidate_version: '1.0.1',
					candidate_fingerprint: 'b'.repeat(64),
					hypothesis: 'test',
					created_from_evidence_refs: ['att-1'],
					proposer_type: 'LLM',
					proposer_ref: 'model-x',
					candidate_profile_ref: { profile_id: 'p-b' },
					created_at: new Date().toISOString(),
					status: 'PROPOSED',
				} as unknown as Record<string, unknown>,
				1,
			).ok,
		).toBe(true);
	});
});
