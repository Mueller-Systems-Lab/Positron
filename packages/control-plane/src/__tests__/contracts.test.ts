// Positron Control Plane — Contract Validation Tests
// Matrix: VALID_CONTRACT / INVALID_CONTRACT / UNKNOWN_VERSION / MISSING_REQUIRED_FIELD

import { describe, expect, it } from 'vitest';
import { validateContract } from '../contracts.js';

const validPlan = {
	contract: 'positron.plan.v1',
	run_id: 'run_abc12345',
	repository_ref: 'xxammaxx/Positron',
	repository_head: 'a'.repeat(40),
	targets: { files: ['src/sum.js'], symbols: ['add'] },
	acceptance_criteria: ['add(2, 3) returns 5'],
	required_tests: ['test/sum.test.js'],
	risks: [],
	build_scope: { allowed_files: ['src/', 'test/'] },
	context: { fingerprint: 'fp_1234567890123456' },
};

describe('CONTRACT_VALID', () => {
	it('accepts a valid positron.plan.v1', () => {
		const result = validateContract('positron.plan.v1', validPlan);
		expect(result.ok).toBe(true);
		expect(result.errors).toEqual([]);
		expect(result.version).toBe(1);
	});

	it('accepts a valid positron.verification.v1 with checks', () => {
		const doc = {
			contract: 'positron.verification.v1',
			run_id: 'run_1',
			passed: true,
			checks: [{ name: 'unit tests', passed: true }],
		};
		const result = validateContract('positron.verification.v1', doc);
		expect(result.ok).toBe(true);
	});

	it('accepts a valid positron.decision.v1', () => {
		const doc = {
			contract: 'positron.decision.v1',
			run_id: 'run_1',
			decision: 'DONE',
			reason_code: 'ALL_HARD_GATES_GREEN',
		};
		const result = validateContract('positron.decision.v1', doc);
		expect(result.ok).toBe(true);
	});

	it('accepts a valid positron.finding.v1 with evidence', () => {
		const doc = {
			contract: 'positron.finding.v1',
			category: 'security',
			severity: 'CRITICAL',
			confidence: 'HIGH',
			blocking: true,
			rule: 'NO_SECRETS',
			evidence: { file: 'src/config.ts', symbol: 'apiKey', line_range: [1, 5] },
			recommendation: 'Move secret to env',
		};
		const result = validateContract('positron.finding.v1', doc);
		expect(result.ok).toBe(true);
	});

	it('accepts a valid positron.split.v1', () => {
		const doc = {
			contract: 'positron.split.v1',
			parent_run_id: 'run_1',
			reason: 'scope too large',
			subtasks: [{ title: 'part A', acceptance_criteria: ['A works'] }],
			dependencies: [],
		};
		const result = validateContract('positron.split.v1', doc);
		expect(result.ok).toBe(true);
	});
});

describe('CONTRACT_INVALID', () => {
	it('rejects a plan without acceptance_criteria', () => {
		const doc = { ...validPlan, acceptance_criteria: [] };
		const result = validateContract('positron.plan.v1', doc);
		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => e.includes('acceptance_criteria'))).toBe(true);
	});

	it('rejects a plan without run_id (MISSING_REQUIRED_FIELD)', () => {
		const { run_id: _omit, ...doc } = validPlan;
		const result = validateContract('positron.plan.v1', doc);
		expect(result.ok).toBe(false);
		expect(result.errors).toContain('run_id is required');
	});

	it('rejects a plan with wrong contract marker', () => {
		const doc = { ...validPlan, contract: 'positron.plan.v9' };
		const result = validateContract('positron.plan.v1', doc);
		expect(result.ok).toBe(false);
		expect(result.errors[0]).toContain('contract field must be');
	});

	it('rejects a plan with path traversal in build_scope', () => {
		const doc = {
			...validPlan,
			build_scope: { allowed_files: ['../../etc/passwd'] },
		};
		const result = validateContract('positron.plan.v1', doc);
		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => e.includes('path traversal'))).toBe(true);
	});

	it('rejects verification without checks array', () => {
		const doc = { contract: 'positron.verification.v1', run_id: 'run_1', passed: false };
		const result = validateContract('positron.verification.v1', doc);
		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => e.includes('checks'))).toBe(true);
	});

	it('rejects a finding with unknown severity', () => {
		const doc = {
			contract: 'positron.finding.v1',
			category: 'security',
			severity: 'EXTREME',
			confidence: 'HIGH',
			blocking: true,
		};
		const result = validateContract('positron.finding.v1', doc);
		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => e.includes('severity'))).toBe(true);
	});

	it('rejects a decision with unknown decision value', () => {
		const doc = {
			contract: 'positron.decision.v1',
			run_id: 'run_1',
			decision: 'MAYBE',
			reason_code: 'x',
		};
		const result = validateContract('positron.decision.v1', doc);
		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => e.includes('decision'))).toBe(true);
	});

	it('rejects a split without subtasks', () => {
		const doc = {
			contract: 'positron.split.v1',
			parent_run_id: 'run_1',
			reason: 'x',
			subtasks: [],
		};
		const result = validateContract('positron.split.v1', doc);
		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => e.includes('subtasks'))).toBe(true);
	});
});

describe('CONTRACT_VERSION_REJECT', () => {
	it('rejects an unknown contract id', () => {
		const result = validateContract('positron.unknown.v1', validPlan);
		expect(result.ok).toBe(false);
		expect(result.errors[0]).toContain('UNKNOWN_CONTRACT');
	});

	it('rejects an unsupported version', () => {
		const result = validateContract('positron.plan.v1', validPlan, 99);
		expect(result.ok).toBe(false);
		expect(result.errors[0]).toContain('UNKNOWN_VERSION');
	});

	it('rejects non-object documents', () => {
		const result = validateContract('positron.plan.v1', 'not an object');
		expect(result.ok).toBe(false);
	});
});
