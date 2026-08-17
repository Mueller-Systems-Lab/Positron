// Positron Control Plane — Split Policy Tests
// SPLIT_PATH mit Limits (max_split_depth, max_subtasks) — keine Task-Explosion

import { describe, expect, it } from 'vitest';
import { evaluateSplit, DEFAULT_SPLIT_LIMITS } from '../split.js';

const validSplit = {
	contract: 'positron.split.v1',
	parent_run_id: 'run_1',
	reason: 'scope too large for a single fix',
	subtasks: [
		{ title: 'part A', acceptance_criteria: ['A works'] },
		{ title: 'part B', acceptance_criteria: ['B works'] },
	],
	dependencies: [['part B']],
	acceptance_criteria: ['A and B work together'],
};

describe('SPLIT_PATH', () => {
	it('allows a valid split within limits', () => {
		const result = evaluateSplit(validSplit, DEFAULT_SPLIT_LIMITS, 0);
		expect(result.verdict).toBe('SPLIT_ALLOWED');
		expect(result.reason_code).toBe('SPLIT_ALLOWED');
	});

	it('denies split at max depth (no recursion explosion)', () => {
		const result = evaluateSplit(validSplit, DEFAULT_SPLIT_LIMITS, 3);
		expect(result.verdict).toBe('SPLIT_DENIED');
		expect(result.reason_code).toBe('SPLIT_DENIED_MAX_DEPTH');
	});

	it('denies split exceeding max_subtasks', () => {
		const manySubtasks = {
			...validSplit,
			subtasks: Array.from({ length: 6 }, (_, i) => ({
				title: `task ${i}`,
				acceptance_criteria: [`task ${i} works`],
			})),
		};
		const result = evaluateSplit(manySubtasks, DEFAULT_SPLIT_LIMITS, 0);
		expect(result.verdict).toBe('SPLIT_DENIED');
		expect(result.reason_code).toBe('SPLIT_DENIED_MAX_SUBTASKS');
	});

	it('denies split without subtasks', () => {
		const result = evaluateSplit({ ...validSplit, subtasks: [] }, DEFAULT_SPLIT_LIMITS, 0);
		expect(result.verdict).toBe('SPLIT_DENIED');
		expect(result.reason_code).toBe('SPLIT_DENIED_NO_SUBTASKS');
	});

	it('denies schema-invalid splits', () => {
		const result = evaluateSplit(
			{ ...validSplit, subtasks: [{ title: 'no criteria' }] },
			DEFAULT_SPLIT_LIMITS,
			0,
		);
		expect(result.verdict).toBe('SPLIT_DENIED');
		expect(result.reason_code).toBe('SPLIT_DENIED_SCHEMA_INVALID');
	});

	it('allows subtasks up to max_subtasks', () => {
		const five = {
			...validSplit,
			subtasks: Array.from({ length: 5 }, (_, i) => ({
				title: `task ${i}`,
				acceptance_criteria: [`task ${i} works`],
			})),
		};
		expect(evaluateSplit(five, DEFAULT_SPLIT_LIMITS, 0).verdict).toBe('SPLIT_ALLOWED');
	});
});
