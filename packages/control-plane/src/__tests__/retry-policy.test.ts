// Positron Control Plane — Retry Policy Tests
// RETRY_WITH_DELTA / RETRY_WITHOUT_DELTA / ATTEMPT_LIMIT / Blind-Retry-Canary-Basis

import { describe, expect, it } from 'vitest';
import { evaluateRetry, isIdenticalAttempt } from '../retry-policy.js';
import type { AttemptRecord } from '../store.js';

function makeAttempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
	return {
		attempt_id: 'att_1',
		run_id: 'run_1',
		job_id: 'job_1',
		status: 'failed',
		input_contract: 'positron.build-input.v1',
		input_fingerprint: 'fp_input_same',
		output_contract: 'positron.build-result.v1',
		output_fingerprint: 'fp_output',
		output_json: null,
		worker_type: 'opencode',
		provider: 'openai',
		model: 'gpt-4o',
		started_at: '2026-01-01T00:00:00.000Z',
		ended_at: '2026-01-01T00:01:00.000Z',
		failure_class: 'TEST_FAILURE',
		failure_signature: 'unit:sum.test.js',
		new_evidence: null,
		strategy_delta: null,
		result_ref: null,
		tokens: null,
		...overrides,
	};
}

const baseInput = {
	attemptNumber: 2,
	maxAttempts: 3,
	previousAttempt: null,
	inputFingerprint: 'fp_input_same',
	worker: { workerType: 'opencode', provider: 'openai', model: 'gpt-4o' },
	newEvidence: null,
	strategyDelta: null,
	contextFingerprint: null,
};

describe('RETRY_WITH_DELTA', () => {
	it('allows retry when new evidence exists', () => {
		const result = evaluateRetry({
			...baseInput,
			previousAttempt: makeAttempt(),
			newEvidence: 'test output shows add returns a-b instead of a+b',
		});
		expect(result.verdict).toBe('ALLOWED');
		expect(result.reason_code).toBe('RETRY_ALLOWED_WITH_DELTA');
		expect(result.delta).toContain('new_evidence');
	});

	it('allows retry when strategy delta exists', () => {
		const result = evaluateRetry({
			...baseInput,
			previousAttempt: makeAttempt(),
			strategyDelta: 'Rewrite add() with explicit carry handling',
		});
		expect(result.verdict).toBe('ALLOWED');
		expect(result.delta).toContain('strategy_delta');
	});

	it('allows retry when model changes', () => {
		const result = evaluateRetry({
			...baseInput,
			previousAttempt: makeAttempt(),
			worker: { workerType: 'opencode', provider: 'openai', model: 'gpt-4o-mini' },
		});
		expect(result.verdict).toBe('ALLOWED');
		expect(result.delta).toContain('model_change');
	});

	it('allows retry when provider changes', () => {
		const result = evaluateRetry({
			...baseInput,
			previousAttempt: makeAttempt(),
			worker: { workerType: 'opencode', provider: 'anthropic', model: 'claude-3' },
		});
		expect(result.verdict).toBe('ALLOWED');
		expect(result.delta).toContain('provider_change');
	});

	it('allows retry when input fingerprint changes', () => {
		const result = evaluateRetry({
			...baseInput,
			previousAttempt: makeAttempt(),
			inputFingerprint: 'fp_input_changed',
		});
		expect(result.verdict).toBe('ALLOWED');
		expect(result.delta).toContain('input_change');
	});
});

describe('RETRY_WITHOUT_DELTA', () => {
	it('denies retry when nothing changed (RETRY_DENIED_NO_STRATEGY_DELTA)', () => {
		const result = evaluateRetry({
			...baseInput,
			previousAttempt: makeAttempt(),
		});
		expect(result.verdict).toBe('DENIED');
		expect(result.reason_code).toBe('RETRY_DENIED_NO_STRATEGY_DELTA');
		expect(result.delta).toEqual([]);
	});

	it('denies retry when failure signature is missing', () => {
		const result = evaluateRetry({
			...baseInput,
			previousAttempt: makeAttempt({ failure_signature: null }),
		});
		expect(result.verdict).toBe('DENIED');
		expect(result.reason_code).toBe('RETRY_DENIED_NO_FAILURE_SIGNATURE');
	});

	it('denies retry when no previous attempt exists', () => {
		const result = evaluateRetry({ ...baseInput, previousAttempt: null });
		expect(result.verdict).toBe('DENIED');
		expect(result.reason_code).toBe('RETRY_DENIED_NO_PREVIOUS_ATTEMPT');
	});
});

describe('ATTEMPT_LIMIT', () => {
	it('denies retry at the attempt limit', () => {
		const result = evaluateRetry({
			...baseInput,
			attemptNumber: 3,
			maxAttempts: 3,
			previousAttempt: makeAttempt(),
			newEvidence: 'still failing',
		});
		expect(result.verdict).toBe('DENIED');
		expect(result.reason_code).toBe('RETRY_DENIED_ATTEMPT_LIMIT');
	});

	it('allows retry below the limit', () => {
		const result = evaluateRetry({
			...baseInput,
			attemptNumber: 1,
			maxAttempts: 3,
			previousAttempt: makeAttempt(),
			newEvidence: 'x',
		});
		expect(result.verdict).toBe('ALLOWED');
	});
});

describe('isIdenticalAttempt (Blind-Retry-Canary-Basis)', () => {
	it('detects identical attempts', () => {
		const prev = makeAttempt();
		expect(isIdenticalAttempt(prev, baseInput)).toBe(true);
	});

	it('detects non-identical attempts (evidence)', () => {
		const prev = makeAttempt();
		expect(isIdenticalAttempt(prev, { ...baseInput, newEvidence: 'new' })).toBe(false);
	});

	it('detects non-identical attempts (model)', () => {
		const prev = makeAttempt();
		expect(
			isIdenticalAttempt(prev, {
				...baseInput,
				worker: { workerType: 'opencode', provider: 'openai', model: 'other' },
			}),
		).toBe(false);
	});
});
