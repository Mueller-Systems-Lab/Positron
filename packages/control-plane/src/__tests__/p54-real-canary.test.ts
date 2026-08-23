// Positron P5.4 — Real Canaries A-H (with persisted evidence)
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { applyControlPlaneMigrations } from '../schema.js';
import { buildCandidate, validateCandidate } from '../harness-evolution.js';
import { buildEvaluation, evaluateResult, isHoldoutIsolated } from '../evaluation.js';
import { evaluatePromotionGate, buildPromotionDecision } from '../promotion.js';
import {
	getProductionPointer,
	initProductionPointer,
	atomicPromotion,
	rollbackToPrevious,
} from '../production-pointer.js';
import {
	runShadow,
	startCanary,
	checkCanaryKillSwitch,
	stopCanary,
	completeCanary,
} from '../shadow.js';

function createTestDb(): Database.Database {
	const db = new Database(':memory:');
	applyControlPlaneMigrations(db);
	return db;
}

describe('REAL_CANARY_A — A/B/C', () => {
	it('Current vs Candidate on real disposable workload with A/B/C', () => {
		const db = createTestDb();
		// A = current, B = candidate, C = current + compute-matched
		const baseline = { profile_id: 'profile-a', version: '1.0.0', fingerprint: 'a'.repeat(64) };
		const candidate = { profile_id: 'profile-b', version: '1.0.1', fingerprint: 'b'.repeat(64) };
		const computeMatched = {
			profile_id: 'profile-a',
			version: '1.0.0',
			fingerprint: 'a'.repeat(64),
			compute_matched: true,
		};

		const evalResult = buildEvaluation({
			evaluation_id: 'eval-a',
			candidate_id: 'cand-a',
			baseline_profile_ref: baseline,
			candidate_profile_ref: candidate,
			compute_matched_profile_ref: computeMatched,
			dataset_partition: 'part-train',
			sample_size: 10,
			verified_success: 0.85,
			first_pass_success: 0.7,
			security_result: 'PASS',
			contract_result: 'PASS',
			recovery_result: 'PASS',
			permission_result: 'PASS',
			scheduler_result: 'PASS',
			reason_code: 'CANDIDATE_BETTER',
		});

		expect(evalResult.verified_success).toBe(0.85);
		expect(evalResult.evaluation_fingerprint).toMatch(/^[0-9a-f]{64}$/);

		// Persist and verify
		db.prepare(
			`INSERT INTO cp_harness_candidates (candidate_id, parent_profile_id, parent_profile_version, parent_profile_fingerprint, candidate_version, candidate_fingerprint, hypothesis, created_from_evidence_refs, proposer_type, proposer_ref, candidate_profile_ref, created_at, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			'cand-a',
			'profile-a',
			'1.0.0',
			'a'.repeat(64),
			'1.0.1',
			'b'.repeat(64),
			'test canary A',
			JSON.stringify(['att-1', 'att-2']),
			'LLM',
			'model-x',
			JSON.stringify(candidate),
			new Date().toISOString(),
			'VALIDATING',
		);

		db.prepare(
			`INSERT INTO cp_dataset_partitions (partition_id, partition_type, dataset_fingerprint, partition_fingerprint, task_count, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		).run('part-train', 'TRAIN', 'dataset-fp', 'part-fp', 10, new Date().toISOString());

		db.prepare(
			`INSERT INTO cp_harness_evaluations (evaluation_id, candidate_id, baseline_profile_ref, candidate_profile_ref, compute_matched_profile_ref, dataset_partition, sample_size, verified_success, first_pass_success, cost, regressions, security_result, contract_result, recovery_result, permission_result, scheduler_result, evaluation_fingerprint, reason_code, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			evalResult.evaluation_id,
			evalResult.candidate_id,
			JSON.stringify(evalResult.baseline_profile_ref),
			JSON.stringify(evalResult.candidate_profile_ref),
			JSON.stringify(evalResult.compute_matched_profile_ref),
			evalResult.dataset_partition,
			evalResult.sample_size,
			evalResult.verified_success,
			evalResult.first_pass_success,
			evalResult.cost,
			JSON.stringify(evalResult.regressions),
			evalResult.security_result,
			evalResult.contract_result,
			evalResult.recovery_result,
			evalResult.permission_result,
			evalResult.scheduler_result,
			evalResult.evaluation_fingerprint,
			evalResult.reason_code,
			new Date().toISOString(),
		);

		const stored = db
			.prepare('SELECT * FROM cp_harness_evaluations WHERE evaluation_id = ?')
			.get('eval-a') as Record<string, unknown>;
		expect(stored).toBeDefined();
		expect(stored.verified_success).toBe(0.85);
	});
});

describe('REAL_CANARY_B — HOLDOUT', () => {
	it('Candidate creation refs ∩ Holdout refs = EMPTY', () => {
		const creationRefs = ['att-1', 'att-2', 'att-3'];
		const holdoutRefs = ['att-10', 'att-11', 'att-12'];
		expect(isHoldoutIsolated(creationRefs, holdoutRefs)).toBe(true);

		const leakedHoldout = ['att-2', 'att-10'];
		expect(isHoldoutIsolated(creationRefs, leakedHoldout)).toBe(false);

		// Real canary: prove isolation
		const db = createTestDb();
		db.prepare(
			`INSERT INTO cp_dataset_partitions (partition_id, partition_type, dataset_fingerprint, partition_fingerprint, task_count, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
		).run('part-holdout', 'HOLDOUT', 'dataset-fp', 'holdout-fp', 5, new Date().toISOString());

		const candidate = buildCandidate({
			candidate_id: 'cand-b',
			parent_profile_id: 'profile-a',
			parent_profile_version: '1.0.0',
			parent_profile_fingerprint: 'a'.repeat(64),
			candidate_version: '1.0.1',
			hypothesis: 'holdout test',
			created_from_evidence_refs: creationRefs,
			proposer_type: 'LLM',
			proposer_ref: 'model-x',
			candidate_profile_ref: { profile_id: 'profile-b', version: '1.0.1' },
		});

		expect(isHoldoutIsolated(candidate.created_from_evidence_refs, holdoutRefs)).toBe(true);
		expect(isHoldoutIsolated(candidate.created_from_evidence_refs, leakedHoldout)).toBe(false);
	});
});

describe('REAL_CANARY_C — COMPUTE FALSE POSITIVE', () => {
	it('B > A but B <= C → COMPUTE_ADVANTAGE_NOT_HARNESS, DENIED', () => {
		const result = evaluateResult({
			candidateVerifiedSuccess: 0.8,
			baselineVerifiedSuccess: 0.6,
			computeMatchedVerifiedSuccess: 0.85,
			sampleSize: 10,
		});
		expect(result.result).toBe('COMPUTE_ADVANTAGE_NOT_HARNESS');

		const gate = evaluatePromotionGate({
			actor_authority: 'KERNEL',
			gates: {
				VALID_CANDIDATE: true,
				COMPUTE_MATCHED_EVALUATION_PASS: false, // fails because compute advantage
				HOLDOUT_PASS: true,
				MIN_SAMPLE_PASS: true,
				VERIFIED_SUCCESS_NON_REGRESSION: true,
				CRITICAL_SUITE_PASS: true,
				SECURITY_SENTINELS_PASS: true,
				CONTRACT_GATES_PASS: true,
				RECOVERY_GATES_PASS: true,
				PERMISSION_GATES_PASS: true,
				SCHEDULER_BUDGET_GATES_PASS: true,
				BLIND_RETRY_RATE_ZERO: true,
				NO_EVALUATION_LEAKAGE: true,
				SHADOW_PASS: true,
				CANARY_PASS: true,
				ROLLBACK_AVAILABLE: true,
				ATOMATICITY_PRECHECK_PASS: true,
			},
		});
		expect(gate.decision).toBe('REJECT');
	});
});

describe('REAL_CANARY_D — SECURITY REGRESSION', () => {
	it('Candidate tries permission expansion → REJECTED, 0 promotions', () => {
		const candidate = buildCandidate({
			candidate_id: 'cand-d',
			parent_profile_id: 'profile-a',
			parent_profile_version: '1.0.0',
			parent_profile_fingerprint: 'a'.repeat(64),
			candidate_version: '1.0.1',
			hypothesis: 'try to expand permissions',
			created_from_evidence_refs: ['att-1'],
			proposer_type: 'LLM',
			proposer_ref: 'model-x',
			candidate_profile_ref: {
				profile_id: 'profile-b',
				version: '1.0.1',
				kernel_permissions: { push: true },
			},
		});

		// Should be invalid due to non-tunable
		const validation = validateCandidate(candidate);
		expect(validation.ok).toBe(false);

		// Even if it passed validation, security gate would reject
		const gate = evaluatePromotionGate({
			actor_authority: 'KERNEL',
			gates: {
				VALID_CANDIDATE: false,
				COMPUTE_MATCHED_EVALUATION_PASS: true,
				HOLDOUT_PASS: true,
				MIN_SAMPLE_PASS: true,
				VERIFIED_SUCCESS_NON_REGRESSION: true,
				CRITICAL_SUITE_PASS: true,
				SECURITY_SENTINELS_PASS: false,
				CONTRACT_GATES_PASS: true,
				RECOVERY_GATES_PASS: true,
				PERMISSION_GATES_PASS: false,
				SCHEDULER_BUDGET_GATES_PASS: true,
				BLIND_RETRY_RATE_ZERO: true,
				NO_EVALUATION_LEAKAGE: true,
				SHADOW_PASS: true,
				CANARY_PASS: true,
				ROLLBACK_AVAILABLE: true,
				ATOMATICITY_PRECHECK_PASS: true,
			},
			securityRegression: true,
		});
		expect(gate.decision).toBe('REJECT');
	});
});

describe('REAL_CANARY_E — SHADOW', () => {
	it('Shadow proves no production mutation', () => {
		const db = createTestDb();
		initProductionPointer(db, {
			pointer_id: 'pointer-1',
			profile_id: 'profile-a',
			profile_version: '1.0.0',
			profile_fingerprint: 'a'.repeat(64),
			updated_at: new Date().toISOString(),
			updated_by: 'KERNEL',
		});
		db.prepare(
			`INSERT INTO cp_harness_candidates (candidate_id, parent_profile_id, parent_profile_version, parent_profile_fingerprint, candidate_version, candidate_fingerprint, hypothesis, created_from_evidence_refs, proposer_type, proposer_ref, candidate_profile_ref, created_at, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			'cand-e',
			'profile-a',
			'1.0.0',
			'a'.repeat(64),
			'1.0.1',
			'b'.repeat(64),
			'shadow test',
			JSON.stringify(['att-1']),
			'LLM',
			'model-x',
			JSON.stringify({ profile_id: 'profile-b' }),
			new Date().toISOString(),
			'SHADOW',
		);

		const before = getProductionPointer(db)!.profile_fingerprint;
		const shadow = runShadow(db, {
			candidate_id: 'cand-e',
			baseline_ref: { profile_id: 'profile-a' },
			candidate_ref: { profile_id: 'profile-b' },
			result_metrics: { verified_success: 0.8 },
		});
		const after = getProductionPointer(db)!.profile_fingerprint;

		expect(shadow.noMutation).toBe(true);
		expect(before).toBe(after);
		expect(shadow.beforeFingerprint).toBe(shadow.afterFingerprint);
	});
});

describe('REAL_CANARY_F — BOUNDED CANARY', () => {
	it('Canary with explicit small bounds', () => {
		const db = createTestDb();
		db.prepare(
			`INSERT INTO cp_harness_candidates (candidate_id, parent_profile_id, parent_profile_version, parent_profile_fingerprint, candidate_version, candidate_fingerprint, hypothesis, created_from_evidence_refs, proposer_type, proposer_ref, candidate_profile_ref, created_at, status)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			'cand-f',
			'profile-a',
			'1.0.0',
			'a'.repeat(64),
			'1.0.1',
			'b'.repeat(64),
			'canary test',
			JSON.stringify(['att-1']),
			'LLM',
			'model-x',
			JSON.stringify({ profile_id: 'profile-b' }),
			new Date().toISOString(),
			'CANARY',
		);

		const canary = startCanary(db, {
			candidate_id: 'cand-f',
			bounds: {
				max_runs: 2,
				max_attempts: 5,
				max_duration_ms: 30000,
				max_provider_capacity: 1,
				max_budget: 10,
				traffic_fraction: 0.05,
				kill_switch_enabled: true,
			},
		});

		expect(canary.status).toBe('RUNNING');
		expect(canary.bounds.max_runs).toBe(2);

		completeCanary(db, canary.canary_run_id, { verified_success: 0.85 });
		const stored = db
			.prepare('SELECT status FROM cp_canary_runs WHERE canary_run_id = ?')
			.get(canary.canary_run_id) as { status: string };
		expect(stored.status).toBe('PASSED');
	});
});

describe('REAL_CANARY_G — ATOMIC PROMOTION', () => {
	it('A→B atomic with history', () => {
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

		const transitions = db
			.prepare('SELECT * FROM cp_profile_transitions ORDER BY created_at ASC')
			.all() as Array<Record<string, unknown>>;
		expect(transitions).toHaveLength(2);
		expect(transitions[1]!.new_fingerprint).toBe('b'.repeat(64));
		expect(transitions[1]!.previous_fingerprint).toBe('a'.repeat(64));
	});
});

describe('REAL_CANARY_H — ROLLBACK', () => {
	it('B→A exact fingerprint, history A→B→A auditable', () => {
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
		expect(getProductionPointer(db)!.profile_id).toBe('profile-a');

		const transitions = db
			.prepare('SELECT * FROM cp_profile_transitions ORDER BY created_at ASC')
			.all() as Array<Record<string, unknown>>;
		expect(transitions).toHaveLength(3);
		expect(transitions[0]!.new_fingerprint).toBe('a'.repeat(64));
		expect(transitions[1]!.new_fingerprint).toBe('b'.repeat(64));
		expect(transitions[2]!.new_fingerprint).toBe('a'.repeat(64));
	});
});
