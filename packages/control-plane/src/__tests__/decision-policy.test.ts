// Positron Control Plane — Decision Policy Tests
// SECURITY_HARD_BLOCK / deterministische Entscheidungen mit reason_code

import { describe, expect, it } from 'vitest';
import type { FindingContract, VerificationContract } from '../contracts.js';
import { buildDecision } from '../decision-policy.js';

function makeVerification(passed: boolean, checks: Array<{ name: string }>): VerificationContract {
	return {
		contract: 'positron.verification.v1',
		run_id: 'run_1',
		passed,
		checks: checks.map((c) => ({ name: c.name, passed, kind: 'unit' as const, duration_ms: 5 })),
		...(passed ? {} : { failure_class: 'TEST_FAILURE' as const, failure_signature: 'unit:a' }),
	};
}

function makeFinding(overrides: Partial<FindingContract>): FindingContract {
	return {
		contract: 'positron.finding.v1',
		category: 'quality',
		severity: 'LOW',
		confidence: 'MEDIUM',
		blocking: false,
		evidence: {},
		...overrides,
	};
}

const base = { run_id: 'run_1' };

describe('SECURITY_HARD_BLOCK', () => {
	it('blocks even when all technical gates are green', () => {
		const decision = buildDecision({
			...base,
			verification: makeVerification(true, [{ name: 'unit' }, { name: 'build' }]),
			findings: [
				makeFinding({
					category: 'security',
					severity: 'CRITICAL',
					blocking: true,
					rule: 'SECRET_LEAK',
					evidence: { file: 'src/env.ts' },
				}),
			],
		});
		expect(decision.decision).toBe('BLOCKED');
		expect(decision.reason_code).toBe('SECURITY_BLOCK');
	});

	it('blocks on HIGH blocking security findings too', () => {
		const decision = buildDecision({
			...base,
			verification: makeVerification(true, [{ name: 'unit' }]),
			findings: [makeFinding({ category: 'security', severity: 'HIGH', blocking: true })],
		});
		expect(decision.decision).toBe('BLOCKED');
	});

	it('2 of 3 passed is never DONE with a blocking security finding', () => {
		const decision = buildDecision({
			...base,
			verification: makeVerification(true, [{ name: 'unit' }]),
			findings: [
				makeFinding({ category: 'correctness', severity: 'MEDIUM', blocking: false }),
				makeFinding({ category: 'quality', severity: 'MEDIUM', blocking: false }),
				makeFinding({ category: 'security', severity: 'CRITICAL', blocking: true }),
			],
		});
		expect(decision.decision).toBe('BLOCKED');
	});

	it('non-blocking security findings do not block', () => {
		const decision = buildDecision({
			...base,
			verification: makeVerification(true, [{ name: 'unit' }]),
			findings: [makeFinding({ category: 'security', severity: 'LOW', blocking: false })],
		});
		expect(decision.decision).toBe('DONE');
	});
});

describe('deterministic decisions', () => {
	it('invalid contract → BLOCKED', () => {
		const decision = buildDecision({
			...base,
			verification: makeVerification(true, [{ name: 'unit' }]),
			findings: [],
			contractErrors: ['plan missing acceptance_criteria'],
		});
		expect(decision.decision).toBe('BLOCKED');
		expect(decision.reason_code).toBe('CONTRACT_INVALID');
	});

	it('rejected plan → BLOCKED', () => {
		const decision = buildDecision({
			...base,
			verification: makeVerification(true, [{ name: 'unit' }]),
			findings: [],
			planGateStatus: 'REJECTED',
		});
		expect(decision.decision).toBe('BLOCKED');
		expect(decision.reason_code).toBe('PLAN_GATE_REJECTED');
	});

	it('no verification → BLOCKED (never DONE without deterministic gates)', () => {
		const decision = buildDecision({ ...base, verification: null, findings: [] });
		expect(decision.decision).toBe('BLOCKED');
		expect(decision.reason_code).toBe('NO_VERIFICATION');
	});

	it('failed verification + useful delta → FIX', () => {
		const decision = buildDecision({
			...base,
			verification: makeVerification(false, [{ name: 'unit' }]),
			findings: [],
			retry: {
				verdict: 'ALLOWED',
				reason_code: 'RETRY_ALLOWED_WITH_DELTA',
				delta: ['new_evidence'],
			},
		});
		expect(decision.decision).toBe('FIX');
		expect(decision.reason_code).toBe('VERIFY_FAILED_WITH_DELTA');
	});

	it('failed verification + retry exhausted → SPLIT', () => {
		const decision = buildDecision({
			...base,
			verification: makeVerification(false, [{ name: 'unit' }]),
			findings: [],
			retry: {
				verdict: 'DENIED',
				reason_code: 'RETRY_DENIED_NO_STRATEGY_DELTA',
				delta: [],
			},
		});
		expect(decision.decision).toBe('SPLIT');
		expect(decision.reason_code).toBe('RETRY_DENIED_NO_STRATEGY_DELTA');
	});

	it('all hard gates green → DONE', () => {
		const decision = buildDecision({
			...base,
			verification: makeVerification(true, [{ name: 'unit' }, { name: 'build' }, { name: 'lint' }]),
			findings: [],
		});
		expect(decision.decision).toBe('DONE');
		expect(decision.reason_code).toBe('ALL_HARD_GATES_GREEN');
	});
});
