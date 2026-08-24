// Positron Control Plane — KPI Tests
// Invarianten: BlindRetryRate = 0, DuplicateMutationRate = 0,
// SecurityHardBlockEnforcement = 100 % (über reale persistierte Daten)

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { assertKpiInvariants, computeKpis } from '../kpis.js';
import { applyControlPlaneMigrations } from '../schema.js';
import {
	completeAttempt,
	createAttempt,
	createJob,
	storeDecision,
	storeTransition,
	updateJobState,
} from '../store.js';

function seedRun(
	db: Database.Database,
	runId: string,
	opts: { attempts?: number; done?: boolean } = {},
) {
	const buildJob = createJob(db, runId, 'build');
	const attempts = opts.attempts ?? 1;
	for (let i = 0; i < attempts; i++) {
		const a = createAttempt(db, runId, buildJob.job_id, {
			input_contract: 'positron.build-input.v1',
			input_fingerprint: `fp_${runId}_${i}`,
			worker_type: 'opencode',
			started_at: `2026-01-01T00:00:0${i}.000Z`,
		});
		completeAttempt(db, a.attempt_id, {
			status: 'succeeded',
			ended_at: `2026-01-01T00:00:0${i}.100Z`,
		});
	}
	updateJobState(db, buildJob.job_id, opts.done === false ? 'failed' : 'succeeded');

	storeTransition(db, runId, 'PLAN', 'BUILD', 'PLAN_GATE_APPROVED');
	storeTransition(db, runId, 'BUILD', 'VERIFY', 'BUILD_RESULT_OK');
	storeDecision(
		db,
		runId,
		opts.done === false ? 'SPLIT' : 'DONE',
		opts.done === false ? 'RETRY_DENIED_ATTEMPT_LIMIT' : 'ALL_HARD_GATES_GREEN',
		JSON.stringify({ decision: opts.done === false ? 'SPLIT' : 'DONE' }),
	);
}

describe('KPIs from real persisted data', () => {
	it('computes first-pass success rate and mean attempts to done', () => {
		const db = new Database(':memory:');
		applyControlPlaneMigrations(db);
		seedRun(db, 'run_a', { attempts: 1, done: true }); // first pass
		seedRun(db, 'run_b', { attempts: 3, done: true }); // fix path
		seedRun(db, 'run_c', { attempts: 2, done: false }); // split

		const kpis = computeKpis(db);
		expect(kpis.runs_total).toBe(3);
		expect(kpis.done_runs).toBe(2);
		expect(kpis.first_pass_success_rate).toBe(0.5);
		expect(kpis.mean_attempts_to_done).toBe(2);
		expect(kpis.trace_completeness).toBe(1);
	});

	it('duplicate mutations are counted but idempotency keeps the rate at 0 for real runs', () => {
		const db = new Database(':memory:');
		applyControlPlaneMigrations(db);
		seedRun(db, 'run_a', { attempts: 1, done: true });
		seedRun(db, 'run_b', { attempts: 1, done: true });

		const kpis = computeKpis(db);
		expect(kpis.duplicate_mutation_rate).toBe(0);
		expect(assertKpiInvariants(kpis)).toEqual([]);
	});

	it('blind retry rate is 0 when retry policy gates all retries', () => {
		const db = new Database(':memory:');
		applyControlPlaneMigrations(db);
		seedRun(db, 'run_a', { attempts: 1, done: true });
		seedRun(db, 'run_b', { attempts: 2, done: false });

		const kpis = computeKpis(db);
		expect(kpis.blind_retry_rate).toBe(0);
		expect(assertKpiInvariants(kpis)).toEqual([]);
	});

	it('security hard block enforcement is 100% when blocking findings are recorded', () => {
		const db = new Database(':memory:');
		applyControlPlaneMigrations(db);
		seedRun(db, 'run_a', { attempts: 1, done: true });

		// Run mit SECURITY_BLOCK-Entscheidung inkl. blockierender Findings
		storeDecision(
			db,
			'run_sec',
			'BLOCKED',
			'SECURITY_BLOCK',
			JSON.stringify({
				contract: 'positron.decision.v1',
				run_id: 'run_sec',
				decision: 'BLOCKED',
				reason_code: 'SECURITY_BLOCK',
				basis: {
					blocking_findings: [
						{ severity: 'CRITICAL', rule: 'SECRET_LEAK', evidence: { file: 'src/env.ts' } },
					],
				},
			}),
		);

		const kpis = computeKpis(db);
		expect(kpis.security_block_enforcement_rate).toBe(1);
		expect(assertKpiInvariants(kpis)).toEqual([]);
	});

	it('security block without recorded findings is flagged by the invariant check', () => {
		const db = new Database(':memory:');
		applyControlPlaneMigrations(db);
		storeDecision(
			db,
			'run_bad',
			'BLOCKED',
			'SECURITY_BLOCK',
			JSON.stringify({ decision: 'BLOCKED', reason_code: 'SECURITY_BLOCK', basis: {} }),
		);

		const kpis = computeKpis(db);
		expect(kpis.security_block_enforcement_rate).toBe(0);
		const violations = assertKpiInvariants(kpis);
		expect(violations.some((v) => v.includes('security_block_enforcement_rate'))).toBe(true);
	});

	it('contract validation and plan gate rejection rates are computed from decisions', () => {
		const db = new Database(':memory:');
		applyControlPlaneMigrations(db);
		storeDecision(db, 'r1', 'BLOCKED', 'CONTRACT_INVALID', '{}');
		storeDecision(db, 'r2', 'BLOCKED', 'PLAN_GATE_REJECTED', '{}');
		storeDecision(db, 'r3', 'DONE', 'ALL_HARD_GATES_GREEN', '{}');

		const kpis = computeKpis(db);
		expect(kpis.contract_validation_failure_rate).toBeCloseTo(1 / 3);
		expect(kpis.plan_gate_rejection_rate).toBeCloseTo(1 / 3);
	});

	it('p50/p95 stage durations are computed from attempt timestamps', () => {
		const db = new Database(':memory:');
		applyControlPlaneMigrations(db);
		const job = createJob(db, 'run_t', 'verify');
		for (let i = 0; i < 4; i++) {
			const a = createAttempt(db, 'run_t', job.job_id, {
				started_at: `2026-01-01T00:00:0${i}.000Z`,
			});
			completeAttempt(db, a.attempt_id, {
				status: 'succeeded',
				ended_at: `2026-01-01T00:00:0${i}.${String(100 + i * 100).padStart(3, '0')}Z`,
			});
		}
		const kpis = computeKpis(db);
		expect(kpis.p50_stage_duration_ms).toBeGreaterThanOrEqual(100);
		expect(kpis.p95_stage_duration_ms).toBeGreaterThanOrEqual(100);
	});
});
