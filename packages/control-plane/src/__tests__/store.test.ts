// Positron Control Plane — Store Tests
// DURABLE_RUN_MODEL: run → job → attempt persistent; Historie unveränderlich

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach } from 'vitest';
import { applyControlPlaneMigrations } from '../schema.js';
import {
	createJob,
	createAttempt,
	completeAttempt,
	listAttempts,
	listJobs,
	updateJobState,
	storeDecision,
	listDecisions,
	storeTransition,
	listTransitions,
} from '../store.js';

let db: Database.Database;

beforeEach(() => {
	db = new Database(':memory:');
	applyControlPlaneMigrations(db);
});

describe('RUN_JOB_ATTEMPT_MODEL', () => {
	it('creates and lists jobs per run', () => {
		const job = createJob(db, 'run_1', 'plan');
		expect(job.job_id).toMatch(/^job_/);
		expect(job.state).toBe('pending');

		const second = createJob(db, 'run_1', 'build', job.job_id);
		expect(second.parent_job_id).toBe(job.job_id);

		const jobs = listJobs(db, 'run_1');
		expect(jobs).toHaveLength(2);
		expect(jobs.map((j) => j.job_type)).toEqual(['plan', 'build']);
	});

	it('updates job state', () => {
		const job = createJob(db, 'run_1', 'verify');
		const updated = updateJobState(db, job.job_id, 'succeeded');
		expect(updated?.state).toBe('succeeded');
		expect(updated?.updated_at).toBeTruthy();
	});

	it('creates attempts with contracts and fingerprints', () => {
		const job = createJob(db, 'run_1', 'build');
		const attempt = createAttempt(db, 'run_1', job.job_id, {
			input_contract: 'positron.build-input.v1',
			input_fingerprint: 'fp_in',
			worker_type: 'opencode',
			provider: 'openai',
			model: 'gpt-4o',
		});
		expect(attempt.status).toBe('running');
		expect(attempt.input_fingerprint).toBe('fp_in');
		expect(attempt.ended_at).toBeNull();
	});

	it('completes attempts without losing history', () => {
		const job = createJob(db, 'run_1', 'build');
		const attempt = createAttempt(db, 'run_1', job.job_id);
		const completed = completeAttempt(db, attempt.attempt_id, {
			status: 'failed',
			output_contract: 'positron.build-result.v1',
			output_fingerprint: 'fp_out',
			failure_class: 'TEST_FAILURE',
			failure_signature: 'unit:sum.test.js',
			new_evidence: 'test output: expected 5, got 3',
			strategy_delta: 'fix carry logic',
		});
		expect(completed?.status).toBe('failed');
		expect(completed?.failure_class).toBe('TEST_FAILURE');
		expect(completed?.new_evidence).toContain('expected 5');
		expect(completed?.ended_at).toBeTruthy();
	});

	it('multiple attempts remain fully traceable (attempt history preserved)', () => {
		const job = createJob(db, 'run_1', 'build');
		const a1 = createAttempt(db, 'run_1', job.job_id, {
			input_fingerprint: 'fp_same',
			worker_type: 'opencode',
			provider: 'openai',
			model: 'gpt-4o',
		});
		completeAttempt(db, a1.attempt_id, {
			status: 'failed',
			failure_class: 'TEST_FAILURE',
			failure_signature: 'unit:sum.test.js',
		});
		const a2 = createAttempt(db, 'run_1', job.job_id, {
			input_fingerprint: 'fp_same',
			worker_type: 'opencode',
			provider: 'openai',
			model: 'gpt-4o',
			strategy_delta: 'correct boundary validation before parser',
		});
		completeAttempt(db, a2.attempt_id, { status: 'succeeded' });

		const attempts = listAttempts(db, 'run_1');
		expect(attempts).toHaveLength(2);
		expect(attempts[0]?.status).toBe('failed');
		expect(attempts[0]?.strategy_delta).toBeNull();
		expect(attempts[1]?.status).toBe('succeeded');
		expect(attempts[1]?.strategy_delta).toContain('correct boundary validation');
	});

	it('stores and lists decisions', () => {
		storeDecision(db, 'run_1', 'DONE', 'ALL_HARD_GATES_GREEN', '{"decision":"DONE"}');
		const decisions = listDecisions(db, 'run_1');
		expect(decisions).toHaveLength(1);
		expect(decisions[0]?.reason_code).toBe('ALL_HARD_GATES_GREEN');
	});

	it('stores and lists transitions with reason codes', () => {
		storeTransition(db, 'run_1', 'PLAN', 'BUILD', 'PLAN_GATE_APPROVED');
		storeTransition(db, 'run_1', 'BUILD', 'VERIFY', 'BUILD_RESULT_OK');
		const transitions = listTransitions(db, 'run_1');
		expect(transitions).toHaveLength(2);
		expect(transitions[0]?.previous_state).toBe('PLAN');
		expect(transitions[0]?.new_state).toBe('BUILD');
		expect(transitions[0]?.reason_code).toBe('PLAN_GATE_APPROVED');
	});
});
