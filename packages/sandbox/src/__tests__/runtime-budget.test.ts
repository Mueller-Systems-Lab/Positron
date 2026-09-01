import { describe, expect, it } from 'vitest';
import { CommandTerminationError, runCommand } from '../command-runner.js';
import { buildRuntimeBudgetContract, runtimeBudgetSlice } from '@positron/shared';

describe('runtime budget execution canaries', () => {
	it('Canary A — healthy fast request completes inside its provider sub-budget', async () => {
		const contract = buildRuntimeBudgetContract({
			budget_id: 'canary-fast',
			attempt_wall_clock_budget_ms: 1_000,
		});
		const result = await runCommand(
			process.execPath,
			['-e', 'process.stdout.write("HEALTHY_FAST")'],
			{
				cwd: process.cwd(),
				runtimeBudget: runtimeBudgetSlice(contract, 'provider'),
				killProcessGroup: true,
			},
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe('HEALTHY_FAST');
	});

	it('Canary B — healthy slow workload is attempt deadline, not provider failure', async () => {
		const contract = buildRuntimeBudgetContract({
			budget_id: 'canary-slow',
			attempt_wall_clock_budget_ms: 25,
		});
		await expect(
			runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 250)'], {
				cwd: process.cwd(),
				timeout: 500,
				runtimeBudget: runtimeBudgetSlice(contract, 'attempt'),
				killProcessGroup: true,
				killGraceMs: 20,
			}),
		).rejects.toMatchObject({
			terminationReason: 'ATTEMPT_DEADLINE_EXCEEDED',
			terminationAuthority: 'attempt',
		});
	});

	it('Canary C — explicit provider transport failure remains provider-owned', () => {
		const error = new CommandTerminationError(
			'fixture provider transport failure',
			'PROVIDER_FAILURE',
			'provider',
			3,
		);
		expect(error.terminationReason).toBe('PROVIDER_FAILURE');
		expect(error.terminationAuthority).toBe('provider');
	});

	it('adversarial canary — kernel cancellation is bounded and cannot be reclassified', async () => {
		const cancellation = new AbortController();
		const running = runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
			cwd: process.cwd(),
			signal: cancellation.signal,
			killProcessGroup: true,
			killGraceMs: 20,
		});
		setTimeout(() => cancellation.abort(), 10);
		await expect(running).rejects.toMatchObject({
			terminationReason: 'CANCELLED_BY_KERNEL',
			terminationAuthority: 'kernel',
		});
	});

	it('Canaries D/E/F — tool, verification, and parent budget reasons are distinct', () => {
		const contract = buildRuntimeBudgetContract({
			budget_id: 'canary-subsystems',
			attempt_wall_clock_budget_ms: 1_000,
		});
		expect(runtimeBudgetSlice(contract, 'tool').timeout_reason).toBe('TOOL_EXECUTION_TIMEOUT');
		expect(runtimeBudgetSlice(contract, 'verification').timeout_reason).toBe(
			'VERIFICATION_DEADLINE_EXCEEDED',
		);
		const parentExpired = { ...contract, parent_budget_ref: 'run-parent', absolute_deadline_ms: 1 };
		expect(runtimeBudgetSlice(parentExpired, 'attempt', 2).timeout_reason).toBe(
			'RUN_BUDGET_EXHAUSTED',
		);
	});
});
