import { describe, expect, it } from 'vitest';
import {
	assertKernelOwnedBudgetMutation,
	buildCalibrationHoldoutContract,
	buildRuntimeBudgetContract,
	classifyRuntimeTermination,
	deriveChildRuntimeBudgetContract,
	evaluateRuntimeRetry,
	freezeRuntimeBudgetContract,
	remainingRuntimeBudgetMs,
	runtimeBudgetSlice,
	validateRuntimeBudgetContract,
} from '../runtime-budget.js';

function base() {
	return buildRuntimeBudgetContract({
		budget_id: 'budget_test',
		now_ms: 1_000,
		issued_at: '2026-09-01T00:00:00.000Z',
		attempt_wall_clock_budget_ms: 1_000,
		provider_request_budget_ms: 500,
		tool_execution_budget_ms: 400,
		verification_budget_ms: 300,
		max_steps: 12,
		max_tool_calls: 20,
		max_retries: 2,
		cancellation_grace_ms: 100,
		provider: 'fixture-provider',
		model: 'fixture-model',
	});
}

describe('positron.runtime-budget.v1', () => {
	it('builds and validates a deterministic, fingerprinted contract', () => {
		const first = base();
		const second = buildRuntimeBudgetContract({
			...first,
			now_ms: 9_000,
			issued_at: '2027-01-01T00:00:00.000Z',
		});
		expect(validateRuntimeBudgetContract(first)).toEqual([]);
		expect(second.budget_fingerprint).toBe(first.budget_fingerprint);
	});

	it('detects semantic tampering and rejects secret-like provenance', () => {
		const tampered = { ...base(), max_steps: 13 };
		expect(validateRuntimeBudgetContract(tampered)).toContain(
			'budget_fingerprint does not match contract',
		);
		const secret = { ...base(), budget_provenance: { token: 'Bearer ghp_should_never_be_here' } };
		expect(validateRuntimeBudgetContract(secret)).toContain(
			'budget_provenance.token contains secret-like material',
		);
	});

	it('freezes the contract and prevents non-kernel mutation authority', () => {
		const frozen = freezeRuntimeBudgetContract(base());
		expect(Object.isFrozen(frozen)).toBe(true);
		expect(Object.isFrozen(frozen.budget_provenance)).toBe(true);
		expect(() => assertKernelOwnedBudgetMutation('model')).toThrow(
			'RUNTIME_BUDGET_MUTATION_DENIED',
		);
		expect(() => assertKernelOwnedBudgetMutation('kernel')).not.toThrow();
	});

	it('derives every child deadline and limit within the remaining parent budget', () => {
		const parent = base();
		const child = deriveChildRuntimeBudgetContract(
			parent,
			{ role: 'attempt', wall_clock_budget_ms: 1_500, max_steps: 99, max_retries: 99 },
			1_400,
		);
		expect(child.absolute_deadline_ms).toBe(2_000);
		expect(child.attempt_wall_clock_budget_ms).toBe(600);
		expect(child.max_steps).toBe(parent.max_steps);
		expect(child.max_retries).toBe(parent.max_retries);
		expect(child.parent_budget_ref).toBe(parent.budget_id);
		expect(remainingRuntimeBudgetMs(child, 1_500)).toBe(500);
		expect(() =>
			deriveChildRuntimeBudgetContract(parent, { role: 'tool', wall_clock_budget_ms: 1 }, 2_000),
		).toThrow('RUN_BUDGET_EXHAUSTED');
	});

	it('assigns explicit owners for provider, tool, verify, attempt, and parent deadlines', () => {
		const contract = base();
		expect(runtimeBudgetSlice(contract, 'provider', 1_000)).toMatchObject({
			timeout_reason: 'PROVIDER_TRANSPORT_TIMEOUT',
			termination_authority: 'provider',
		});
		expect(runtimeBudgetSlice(contract, 'tool', 1_000)).toMatchObject({
			timeout_reason: 'TOOL_EXECUTION_TIMEOUT',
			termination_authority: 'tool',
		});
		expect(runtimeBudgetSlice(contract, 'verification', 1_000)).toMatchObject({
			timeout_reason: 'VERIFICATION_DEADLINE_EXCEEDED',
			termination_authority: 'verification',
		});
		expect(runtimeBudgetSlice(contract, 'attempt', 1_000)).toMatchObject({
			timeout_reason: 'ATTEMPT_DEADLINE_EXCEEDED',
			termination_authority: 'attempt',
		});
		const child = deriveChildRuntimeBudgetContract(
			contract,
			{ role: 'attempt', wall_clock_budget_ms: 100 },
			1_950,
		);
		expect(runtimeBudgetSlice(child, 'tool', 2_000)).toMatchObject({
			timeout_reason: 'RUN_BUDGET_EXHAUSTED',
			termination_authority: 'run',
		});
	});

	it('separates provider health/failure from kernel workload termination', () => {
		expect(classifyRuntimeTermination({ attemptDeadline: true })).toEqual({
			reason: 'ATTEMPT_DEADLINE_EXCEEDED',
			authority: 'attempt',
		});
		expect(classifyRuntimeTermination({ providerFailure: true })).toEqual({
			reason: 'PROVIDER_FAILURE',
			authority: 'provider',
		});
		expect(classifyRuntimeTermination({ providerFailure: true, cancelledByKernel: true })).toEqual({
			reason: 'CANCELLED_BY_KERNEL',
			authority: 'kernel',
		});
		expect(classifyRuntimeTermination({})).toEqual({
			reason: 'RUNTIME_TERMINATION_UNKNOWN',
			authority: 'kernel',
		});
	});

	it('keeps retries inside the finite parent budget and never resets it', () => {
		const parent = base();
		expect(evaluateRuntimeRetry(parent, 0, 500, 1_400)).toEqual({
			allowed: true,
			reason: 'RETRY_ALLOWED',
			remaining_budget_ms: 600,
		});
		expect(evaluateRuntimeRetry(parent, 0, 601, 1_400).reason).toBe('RETRY_BUDGET_EXHAUSTED');
		expect(evaluateRuntimeRetry(parent, 2, 1, 1_400).reason).toBe('RETRY_BUDGET_EXHAUSTED');
	});

	it('freezes calibration and holdout provenance only when disjoint', () => {
		const runtime = base();
		const experiment = buildCalibrationHoldoutContract({
			runtime_budget_fingerprint: runtime.budget_fingerprint,
			calibration_partition_fingerprint: 'calibration-fp',
			holdout_partition_fingerprint: 'holdout-fp',
			calibration_holdout_intersection: 0,
		});
		expect(experiment.frozen).toBe(true);
		expect(experiment.calibration_holdout_intersection).toBe(0);
		expect(() =>
			buildCalibrationHoldoutContract({ ...experiment, calibration_holdout_intersection: 1 }),
		).toThrow('disjoint');
	});
});
