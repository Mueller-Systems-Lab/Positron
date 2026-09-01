import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { buildRuntimeBudgetContract, runtimeBudgetSlice } from '@positron/shared';
import { applyControlPlaneMigrations, getMigrationVersion } from '../schema.js';
import { classifyFailure } from '../failure.js';
import { completeAttempt, createAttempt, createJob, getAttempt } from '../store.js';

describe('runtime budget durable evidence', () => {
	it('classifies kernel deadline separately from provider transport failure', () => {
		expect(
			classifyFailure({
				stderr: 'timeout while the child was running',
				timeout: true,
				terminationReason: 'ATTEMPT_DEADLINE_EXCEEDED',
				terminationAuthority: 'attempt',
			}),
		).toMatchObject({ signature: 'ATTEMPT_DEADLINE_EXCEEDED' });
		expect(classifyFailure({ stderr: 'provider returned HTTP 503' })).toMatchObject({
			signature: 'PROVIDER_FAILURE',
		});
	});

	it('adds V12 idempotently and preserves historical rows as unknown', () => {
		const db = new Database(':memory:');
		applyControlPlaneMigrations(db);
		const first = (
			db.prepare('PRAGMA table_info(cp_attempts)').all() as Array<{ name: string }>
		).map((column) => column.name);
		applyControlPlaneMigrations(db);
		const second = (
			db.prepare('PRAGMA table_info(cp_attempts)').all() as Array<{ name: string }>
		).map((column) => column.name);
		expect(second).toEqual(first);
		expect(getMigrationVersion(db)).toBe('12');
		const job = createJob(db, 'run_legacy_runtime', 'build');
		const legacy = db.prepare('SELECT * FROM cp_attempts WHERE attempt_id = ?').get('missing');
		expect(legacy).toBeUndefined();
		expect(job.job_id).toContain('job_');
		db.close();
	});

	it('persists the frozen contract, authority, remaining budgets, and fencing evidence', () => {
		const db = new Database(':memory:');
		applyControlPlaneMigrations(db);
		const job = createJob(db, 'run_runtime', 'build');
		const contract = buildRuntimeBudgetContract({
			budget_id: 'budget_persist',
			now_ms: 1_000,
			attempt_wall_clock_budget_ms: 2_000,
		});
		const attempt = createAttempt(db, 'run_runtime', job.job_id, {
			status: 'running',
			runtime_budget_contract: JSON.stringify(contract),
			runtime_budget_fingerprint: contract.budget_fingerprint,
			remaining_budget_at_start_ms: 2_000,
			termination_reason: runtimeBudgetSlice(contract, 'attempt', 2_500).timeout_reason,
			termination_authority: 'attempt',
			cancel_requested_at: '2026-09-01T00:00:02.000Z',
			cancel_completed_at: '2026-09-01T00:00:02.100Z',
			late_result_detected: false,
		});
		const completed = completeAttempt(db, attempt.attempt_id, {
			status: 'timed_out',
			failure_class: 'TIMEOUT',
			failure_signature: 'ATTEMPT_DEADLINE_EXCEEDED',
			elapsed_ms: 2_000,
			remaining_budget_at_finish_ms: 0,
			late_result_detected: true,
			late_result_fenced: true,
		});
		expect(completed).not.toBeNull();
		expect(getAttempt(db, attempt.attempt_id)).toMatchObject({
			runtime_budget_fingerprint: contract.budget_fingerprint,
			termination_reason: 'ATTEMPT_DEADLINE_EXCEEDED',
			termination_authority: 'attempt',
			remaining_budget_at_finish_ms: 0,
			late_result_detected: true,
			late_result_fenced: true,
		});
		expect(
			completeAttempt(db, attempt.attempt_id, {
				status: 'succeeded',
				output_json: '{"late":true}',
			}),
		).toBeNull();
		db.close();
	});
});
