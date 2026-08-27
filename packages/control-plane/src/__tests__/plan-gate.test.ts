// Positron Control Plane — Plan Gate Tests
// PLAN_GATE_APPROVE / PLAN_GATE_REJECT / deterministische Fehlerliste

import { describe, expect, it } from 'vitest';
import { evaluatePlanGate, isPlanApproved, planGateBlocked } from '../plan-gate.js';

const HEAD = 'a'.repeat(40);

const validPlan = {
	contract: 'positron.plan.v1',
	run_id: 'run_abc12345',
	repository_ref: 'Mueller-Systems-Lab/Positron',
	repository_head: HEAD,
	targets: { files: ['src/sum.js'], symbols: ['add'] },
	acceptance_criteria: ['add(2, 3) returns 5'],
	required_tests: ['test/sum.test.js'],
	risks: [],
	build_scope: { allowed_files: ['src/', 'test/'] },
	context: { fingerprint: 'fp_1234567890123456' },
};

describe('PLAN_GATE_APPROVE', () => {
	it('approves a structurally valid plan', () => {
		const result = evaluatePlanGate(validPlan);
		expect(result.status).toBe('APPROVED');
		expect(result.reason_code).toBe('PLAN_GATE_APPROVED');
		expect(result.plan_fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(isPlanApproved(result)).toBe(true);
	});

	it('approves with matching expected repository identity and head', () => {
		const result = evaluatePlanGate(validPlan, 'Mueller-Systems-Lab/Positron', HEAD);
		expect(result.status).toBe('APPROVED');
	});
});

describe('PLAN_GATE_REJECT', () => {
	it('rejects schema-invalid plans', () => {
		const result = evaluatePlanGate({ ...validPlan, acceptance_criteria: [] });
		expect(result.status).toBe('REJECTED');
		expect(result.errors.length).toBeGreaterThan(0);
	});

	it('rejects missing acceptance criteria', () => {
		const result = evaluatePlanGate({ ...validPlan, acceptance_criteria: [] });
		expect(result.status).toBe('REJECTED');
		expect(result.errors.some((e) => e.includes('acceptance_criteria'))).toBe(true);
	});

	it('rejects repository HEAD mismatch', () => {
		const result = evaluatePlanGate(validPlan, 'Mueller-Systems-Lab/Positron', 'b'.repeat(40));
		expect(result.status).toBe('REJECTED');
		expect(result.errors.some((e) => e.includes('repository_head mismatch'))).toBe(true);
	});

	it('rejects repository identity mismatch', () => {
		const result = evaluatePlanGate(validPlan, 'other/repo', HEAD);
		expect(result.status).toBe('REJECTED');
		expect(result.errors.some((e) => e.includes('repository_ref mismatch'))).toBe(true);
	});

	it('rejects malformed repository_head', () => {
		const result = evaluatePlanGate({ ...validPlan, repository_head: 'not-a-sha' });
		expect(result.status).toBe('REJECTED');
		expect(result.errors.some((e) => e.includes('repository_head'))).toBe(true);
	});

	it('rejects plans with forbidden mutations', () => {
		const result = evaluatePlanGate({
			...validPlan,
			acceptance_criteria: ['run git push after changes'],
		});
		expect(result.status).toBe('REJECTED');
		expect(result.errors.some((e) => e.includes('forbidden mutation'))).toBe(true);
	});

	it('rejects empty build scope', () => {
		const result = evaluatePlanGate({
			...validPlan,
			build_scope: { allowed_files: [] },
		});
		expect(result.status).toBe('REJECTED');
		expect(result.errors.some((e) => e.includes('build_scope'))).toBe(true);
	});

	it('rejects missing context fingerprint', () => {
		const result = evaluatePlanGate({
			...validPlan,
			context: { fingerprint: 'short' },
		});
		expect(result.status).toBe('REJECTED');
		expect(result.errors.some((e) => e.includes('context.fingerprint'))).toBe(true);
	});

	it('rejects empty required tests', () => {
		const result = evaluatePlanGate({ ...validPlan, required_tests: [] });
		expect(result.status).toBe('REJECTED');
		expect(result.errors.some((e) => e.includes('required_tests'))).toBe(true);
	});

	it('rejected plans never carry a fingerprint', () => {
		const result = evaluatePlanGate({ ...validPlan, repository_head: 'bad' });
		expect(result.plan_fingerprint).toBeNull();
	});
});

describe('PLAN_GATE_BLOCKED', () => {
	it('blocks when the gate cannot be evaluated', () => {
		const result = planGateBlocked('PLAN_ARTIFACT_MISSING', ['plan artifact not found']);
		expect(result.status).toBe('BLOCKED');
		expect(result.reason_code).toBe('PLAN_ARTIFACT_MISSING');
		expect(isPlanApproved(result)).toBe(false);
	});

	it('only APPROVED releases the build', () => {
		expect(isPlanApproved(evaluatePlanGate(validPlan))).toBe(true);
		expect(isPlanApproved(evaluatePlanGate({ ...validPlan, acceptance_criteria: [] }))).toBe(false);
	});
});
