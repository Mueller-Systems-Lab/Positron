// Issue #385: P0 Runtime Gate Enforcement — Red Tests
//
// These tests verify fail-closed pipeline behavior.
// They verify the post-fix invariants:
//
// P-1: IMPLEMENT blocked → FAILED_BLOCKED (no TEST, VERIFY, COMMIT, PR)
// P-2: IMPLEMENT failed → FAILED_TRANSIENT (retry managed by caller)
// P-3: TEST failed → FAILED_TRANSIENT (never VERIFY)
// P-4: TEST blocked → FAILED_BLOCKED
// P-5: No test commands in supervised/real → FAILED_BLOCKED
// P-6: COMMIT exception → FAILED_BLOCKED (never PR_CREATE, never PUSH)
// P-7: FAILED_BLOCKED is terminal (cannot transition to any mutation phase)
//
// G-1: GateRuntimeMode type exists with 4 variants
// G-2: Real adapters + Fixture/Demo mode → gate mode is 'supervised'
// G-3: AssembleGateEvaluators clears in supervised/real mode

import { beforeEach, describe, expect, it } from 'vitest';
import {
	assembleGateEvaluators,
	clearGateEvaluators,
	gateEvaluatorCount,
	resolveGateRuntimeMode,
	resolveImplementationOutcome,
	resolveTestOutcome,
} from '../gate-evaluator.js';
import type { GateRuntimeMode } from '../gate-evaluator.js';
import { canTransition, createRun, isTerminalPhase, markFailed } from '../state-machine.js';

describe('Issue #385 — GateRuntimeMode Resolution', () => {
	it('all fake adapters → fixture mode', () => {
		const mode = resolveGateRuntimeMode({
			githubMode: 'fake',
			workspaceMode: 'fake',
			opencodeMode: 'fake',
		});
		expect(mode).toBe('fixture');
	});

	it('one real adapter → supervised mode', () => {
		const mode = resolveGateRuntimeMode({
			githubMode: 'real',
			workspaceMode: 'fake',
			opencodeMode: 'fake',
		});
		expect(mode).toBe('supervised');
	});

	it('all real adapters → supervised mode', () => {
		const mode = resolveGateRuntimeMode({
			githubMode: 'real',
			workspaceMode: 'real',
			opencodeMode: 'real',
		});
		expect(mode).toBe('supervised');
	});

	it('POSITRON_GATE_MODE override takes precedence', () => {
		process.env.POSITRON_GATE_MODE = 'demo';
		try {
			const mode = resolveGateRuntimeMode({
				githubMode: 'real',
				workspaceMode: 'real',
				opencodeMode: 'real',
			});
			expect(mode).toBe('demo');
		} finally {
			Reflect.deleteProperty(process.env, 'POSITRON_GATE_MODE');
		}
	});

	it('invalid POSITRON_GATE_MODE falls back to auto-detection', () => {
		process.env.POSITRON_GATE_MODE = 'invalid-mode';
		try {
			const mode = resolveGateRuntimeMode({
				githubMode: 'fake',
				workspaceMode: 'fake',
				opencodeMode: 'fake',
			});
			expect(mode).toBe('fixture');
		} finally {
			Reflect.deleteProperty(process.env, 'POSITRON_GATE_MODE');
		}
	});

	it('GateRuntimeMode type includes all 4 variants', () => {
		// Compile-time check: these must type-check
		const modes: GateRuntimeMode[] = ['fixture', 'demo', 'supervised', 'real'];
		expect(modes).toHaveLength(4);
	});
});

describe('Issue #385 — Gate Assembler Mode Behavior', () => {
	beforeEach(() => {
		clearGateEvaluators();
	});

	it('fixture mode registers fake evaluators', () => {
		assembleGateEvaluators('fixture');
		expect(gateEvaluatorCount()).toBe(8);
	});

	it('demo mode registers fake evaluators', () => {
		assembleGateEvaluators('demo');
		expect(gateEvaluatorCount()).toBe(8);
	});

	it('supervised mode does NOT register fake evaluators', () => {
		assembleGateEvaluators('supervised');
		expect(gateEvaluatorCount()).toBe(0);
	});

	it('real mode does NOT register fake evaluators', () => {
		assembleGateEvaluators('real');
		expect(gateEvaluatorCount()).toBe(0);
	});

	it('switching from fixture to supervised clears evaluators', () => {
		assembleGateEvaluators('fixture');
		expect(gateEvaluatorCount()).toBe(8);
		assembleGateEvaluators('supervised');
		expect(gateEvaluatorCount()).toBe(0);
	});

	it('switching from supervised to fixture registers evaluators', () => {
		assembleGateEvaluators('supervised');
		expect(gateEvaluatorCount()).toBe(0);
		assembleGateEvaluators('fixture');
		expect(gateEvaluatorCount()).toBe(8);
	});
});

describe('Issue #385 — Implementation Outcome Resolution', () => {
	it('success → TEST', () => {
		expect(resolveImplementationOutcome('success')).toBe('TEST');
	});

	it('blocked → FAILED_BLOCKED', () => {
		expect(resolveImplementationOutcome('blocked')).toBe('FAILED_BLOCKED');
	});

	it('failed → RETRY', () => {
		expect(resolveImplementationOutcome('failed')).toBe('RETRY');
	});

	it('skipped → TEST (explicit decision to proceed)', () => {
		expect(resolveImplementationOutcome('skipped')).toBe('TEST');
	});

	it('blocked never returns TEST', () => {
		expect(resolveImplementationOutcome('blocked')).not.toBe('TEST');
	});

	it('failed never returns TEST', () => {
		expect(resolveImplementationOutcome('failed')).not.toBe('TEST');
	});
});

describe('Issue #385 — Test Outcome Resolution', () => {
	const makeReport = (status: 'passed' | 'failed' | 'blocked' | 'skipped') => ({
		status,
		summary: `Tests ${status}`,
		passed: status === 'passed' ? 10 : 0,
		failed: status === 'failed' ? 5 : 0,
		total: 10,
		durationMs: 1000,
	});

	it('passed tests → VERIFY', () => {
		const outcome = resolveTestOutcome(makeReport('passed'), 'supervised', true);
		expect(outcome).toBe('VERIFY');
	});

	it('blocked tests → FAILED_BLOCKED (supervised mode)', () => {
		const outcome = resolveTestOutcome(makeReport('blocked'), 'supervised', true);
		expect(outcome).toBe('FAILED_BLOCKED');
	});

	it('blocked tests → FAILED_BLOCKED (real mode)', () => {
		const outcome = resolveTestOutcome(makeReport('blocked'), 'real', true);
		expect(outcome).toBe('FAILED_BLOCKED');
	});

	it('blocked tests → FAILED_BLOCKED (fixture mode too)', () => {
		// Even in fixture mode, blocked = blocked
		const outcome = resolveTestOutcome(makeReport('blocked'), 'fixture', true);
		expect(outcome).toBe('FAILED_BLOCKED');
	});

	it('failed tests → RETRY (supervised mode)', () => {
		const outcome = resolveTestOutcome(makeReport('failed'), 'supervised', true);
		expect(outcome).toBe('RETRY');
	});

	it('failed tests never returns VERIFY', () => {
		expect(resolveTestOutcome(makeReport('failed'), 'fixture', true)).not.toBe('VERIFY');
		expect(resolveTestOutcome(makeReport('failed'), 'supervised', true)).not.toBe('VERIFY');
		expect(resolveTestOutcome(makeReport('failed'), 'real', true)).not.toBe('VERIFY');
	});

	it('no test commands → FAILED_BLOCKED in supervised mode', () => {
		const outcome = resolveTestOutcome(makeReport('blocked'), 'supervised', false);
		expect(outcome).toBe('FAILED_BLOCKED');
	});

	it('no test commands → FAILED_BLOCKED in real mode', () => {
		const outcome = resolveTestOutcome(makeReport('blocked'), 'real', false);
		expect(outcome).toBe('FAILED_BLOCKED');
	});

	it('no test commands → VERIFY in fixture mode', () => {
		const outcome = resolveTestOutcome(makeReport('blocked'), 'fixture', false);
		expect(outcome).toBe('VERIFY');
	});

	it('no test commands → VERIFY in demo mode', () => {
		const outcome = resolveTestOutcome(makeReport('blocked'), 'demo', false);
		expect(outcome).toBe('VERIFY');
	});

	it('passed tests → VERIFY in all modes', () => {
		expect(resolveTestOutcome(makeReport('passed'), 'fixture', true)).toBe('VERIFY');
		expect(resolveTestOutcome(makeReport('passed'), 'demo', true)).toBe('VERIFY');
		expect(resolveTestOutcome(makeReport('passed'), 'supervised', true)).toBe('VERIFY');
		expect(resolveTestOutcome(makeReport('passed'), 'real', true)).toBe('VERIFY');
	});
});

describe('Issue #385 — COMMIT Failure must NOT reach PR_CREATE', () => {
	it('markFailed with FAILED_BLOCKED produces a blocked run', () => {
		const run = createRun('repo-1', 42, 1);
		const result = markFailed(run, 'FAILED_BLOCKED', 'Commit failed: disk full');
		expect(result.ok).toBe(true);
		expect(result.run.phase).toBe('FAILED_BLOCKED');
		expect(result.run.status).toBe('blocked');
		expect(result.run.lastError).toContain('Commit failed');
	});

	it('FAILED_BLOCKED run cannot transition to PR_CREATE', () => {
		const run = createRun('repo-1', 42, 1);
		const failed = markFailed(run, 'FAILED_BLOCKED', 'Commit failed: disk full');
		expect(canTransition(failed.run.phase, 'PR_CREATE')).toBe(false);
	});

	it('FAILED_BLOCKED run cannot transition to MERGE', () => {
		expect(canTransition('FAILED_BLOCKED', 'MERGE')).toBe(false);
	});

	it('FAILED_BLOCKED run cannot transition to COMMIT', () => {
		expect(canTransition('FAILED_BLOCKED', 'COMMIT')).toBe(false);
	});

	it('FAILED_BLOCKED is a terminal phase', () => {
		expect(isTerminalPhase('FAILED_BLOCKED')).toBe(true);
	});

	it('FAILED_BLOCKED can only transition to CLEANUP', () => {
		expect(canTransition('FAILED_BLOCKED', 'CLEANUP')).toBe(true);
		// Deny all mutation-capable transitions
		expect(canTransition('FAILED_BLOCKED', 'COMMIT')).toBe(false);
		expect(canTransition('FAILED_BLOCKED', 'PR_CREATE')).toBe(false);
		expect(canTransition('FAILED_BLOCKED', 'MERGE')).toBe(false);
		expect(canTransition('FAILED_BLOCKED', 'DONE')).toBe(false);
		expect(canTransition('FAILED_BLOCKED', 'TEST')).toBe(false);
		expect(canTransition('FAILED_BLOCKED', 'VERIFY')).toBe(false);
		expect(canTransition('FAILED_BLOCKED', 'IMPLEMENT')).toBe(false);
	});

	it('FAILED_BLOCKED has finishedAt set', () => {
		const run = createRun('repo-1', 42, 1);
		expect(run.finishedAt).toBeNull();
		const failed = markFailed(run, 'FAILED_BLOCKED', 'Commit failed');
		expect(failed.run.finishedAt).not.toBeNull();
	});
});

describe('Issue #385 — Full Pipeline Negative: mutation calls must be zero after failure', () => {
	it('IMPLEMENT blocked → all downstream mutation phases unreachable', () => {
		const run = createRun('repo-1', 42, 1);
		const blocked = markFailed(run, 'FAILED_BLOCKED', 'Implement blocked: policy');
		expect(blocked.run.phase).toBe('FAILED_BLOCKED');
		// Verify no downstream mutation phase is reachable
		expect(canTransition(blocked.run.phase, 'TEST')).toBe(false);
		expect(canTransition(blocked.run.phase, 'VERIFY')).toBe(false);
		expect(canTransition(blocked.run.phase, 'COMMIT')).toBe(false);
		expect(canTransition(blocked.run.phase, 'PR_CREATE')).toBe(false);
		expect(canTransition(blocked.run.phase, 'MERGE')).toBe(false);
		expect(canTransition(blocked.run.phase, 'DONE')).toBe(false);
	});

	it('COMMIT failed → all downstream mutation phases unreachable', () => {
		const run = createRun('repo-1', 42, 1);
		// Simulate a run that reached COMMIT and then failed
		run.phase = 'COMMIT';
		const failed = markFailed(run, 'FAILED_BLOCKED', 'Commit failed: disk full');
		expect(failed.run.phase).toBe('FAILED_BLOCKED');
		expect(canTransition(failed.run.phase, 'PR_CREATE')).toBe(false);
		expect(canTransition(failed.run.phase, 'MERGE')).toBe(false);
		expect(canTransition(failed.run.phase, 'DONE')).toBe(false);
	});

	it('TEST failed → all downstream mutation phases unreachable', () => {
		const run = createRun('repo-1', 42, 1);
		run.phase = 'TEST';
		const failed = markFailed(run, 'FAILED_BLOCKED', 'Tests blocked: no test commands');
		expect(failed.run.phase).toBe('FAILED_BLOCKED');
		expect(canTransition(failed.run.phase, 'VERIFY')).toBe(false);
		expect(canTransition(failed.run.phase, 'COMMIT')).toBe(false);
		expect(canTransition(failed.run.phase, 'PR_CREATE')).toBe(false);
		expect(canTransition(failed.run.phase, 'MERGE')).toBe(false);
	});

	it('ALL blocked/failed states are terminal and mutation-free', () => {
		const failureKinds = ['FAILED_BLOCKED', 'FAILED', 'FAILED_UNSAFE'] as const;
		const mutationPhases = ['COMMIT', 'PR_CREATE', 'MERGE', 'DONE'] as const;

		for (const kind of failureKinds) {
			const run = createRun('repo-1', 42, 1);
			const failed = markFailed(run, kind, `${kind} test failure`);
			expect(isTerminalPhase(failed.run.phase)).toBe(true);

			for (const phase of mutationPhases) {
				expect(canTransition(failed.run.phase, phase)).toBe(false);
			}
		}
	});
});

describe('Issue #385 — Restart/Resume: blocked runs stay blocked', () => {
	it('FAILED_BLOCKED state is immutable after cold restart simulation', () => {
		// Simulate: run blocks, state is persisted, new instance loads it
		const run = createRun('repo-1', 42, 1);
		const blocked = markFailed(run, 'FAILED_BLOCKED', 'Commit failed');

		// Simulate cold restart: create a new RunState from the persisted data
		const reloaded = createRun('repo-1', 42, 1);
		// Override with persisted state — this simulates loadRunFromDb
		const restarted = {
			...reloaded,
			id: blocked.run.id,
			phase: blocked.run.phase,
			status: blocked.run.status,
			lastError: blocked.run.lastError,
			finishedAt: blocked.run.finishedAt,
		};

		expect(restarted.phase).toBe('FAILED_BLOCKED');
		expect(restarted.status).toBe('blocked');
		expect(isTerminalPhase(restarted.phase)).toBe(true);

		// Even after restart, no mutation phase is reachable
		expect(canTransition(restarted.phase, 'COMMIT')).toBe(false);
		expect(canTransition(restarted.phase, 'PR_CREATE')).toBe(false);
		expect(canTransition(restarted.phase, 'MERGE')).toBe(false);
	});

	it('blocked runs remain blocked after multiple restarts', () => {
		const original = createRun('repo-1', 99, 1);
		const blocked = markFailed(original, 'FAILED_BLOCKED', 'Persistent failure');

		for (let restart = 0; restart < 3; restart++) {
			const reloaded = {
				...createRun('repo-1', 99, 1),
				phase: blocked.run.phase,
				status: blocked.run.status,
				lastError: blocked.run.lastError,
				finishedAt: blocked.run.finishedAt,
			};
			expect(reloaded.phase).toBe('FAILED_BLOCKED');
			expect(isTerminalPhase(reloaded.phase)).toBe(true);
			expect(canTransition(reloaded.phase, 'PR_CREATE')).toBe(false);
			expect(canTransition(reloaded.phase, 'MERGE')).toBe(false);
		}
	});
});
