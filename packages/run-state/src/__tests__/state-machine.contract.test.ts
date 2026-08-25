/**
 * State Machine Contract Tests (QA-023)
 *
 * Verifies the PUBLIC API contract of @positron/run-state's state machine.
 * Tests exported behavior guarantees, NOT internal implementation details.
 *
 * Contract guarantees:
 * - createRun() produces a well-formed RunState with expected shape
 * - transition() accepts valid transitions and rejects invalid ones
 * - markFailed() produces defined failure states
 * - retry() only works from FAILED_TRANSIENT
 * - isTerminalPhase() identifies phases with no outgoing transitions
 * - isFailurePhase() identifies error phases
 * - VALID_TRANSITIONS is a complete map with all 28 phases
 */

import type { RunState } from '@positron/run-state';
import {
	canTransition,
	createRun,
	isFailurePhase,
	isTerminalPhase,
	markFailed,
	retry,
	transition,
	VALID_TRANSITIONS,
} from '@positron/run-state';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<RunState> = {}): RunState {
	return {
		id: 'test-run-id',
		repoId: 'test-owner/test-repo',
		issueNumber: 42,
		branch: null,
		phase: 'QUEUED',
		status: 'active',
		autonomyLevel: 0,
		attempt: 1,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		lastError: null,
		workspacePath: null,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Contract: createRun()
// ---------------------------------------------------------------------------
describe('createRun() contract', () => {
	it('returns a RunState with all required fields', () => {
		const run = createRun('owner/repo', 42, 0);

		expect(run).toBeDefined();
		expect(typeof run.id).toBe('string');
		expect(run.id.length).toBeGreaterThan(0);
		expect(run.repoId).toBe('owner/repo');
		expect(run.issueNumber).toBe(42);
		expect(run.autonomyLevel).toBe(0);
		expect(run.phase).toBe('QUEUED');
		expect(run.status).toBe('active');
		expect(run.attempt).toBe(1);
		expect(run.branch).toBeNull();
		expect(run.finishedAt).toBeNull();
		expect(run.lastError).toBeNull();
		expect(run.workspacePath).toBeNull();
		expect(typeof run.startedAt).toBe('string');
	});

	it('generates unique IDs for each run', () => {
		const run1 = createRun('a/b', 1, 0);
		const run2 = createRun('a/b', 2, 0);
		expect(run1.id).not.toBe(run2.id);
	});

	it('always starts in QUEUED phase with active status', () => {
		const run = createRun('a/b', 1, 2);
		expect(run.phase).toBe('QUEUED');
		expect(run.status).toBe('active');
	});

	it('accepts autonomyLevel values 0 through 4', () => {
		for (let level = 0; level <= 4; level++) {
			const run = createRun('a/b', 1, level);
			expect(run.autonomyLevel).toBe(level);
		}
	});
});

// ---------------------------------------------------------------------------
// Contract: VALID_TRANSITIONS
// ---------------------------------------------------------------------------
describe('VALID_TRANSITIONS contract', () => {
	it('contains entries for all 28 phases', () => {
		// All 28 phases must be present as keys
		const phases = [
			'QUEUED',
			'CLAIMED',
			'REPO_SYNC',
			'ISSUE_CONTEXT',
			'WEB_RESEARCH',
			'SPECIFY',
			'CLARIFY_OPTIONAL',
			'PLAN',
			'TASKS',
			'ANALYZE',
			'REVIEW',
			'IMPLEMENT',
			'TEST',
			'VERIFY',
			'COMMIT',
			'PR_CREATE',
			'MERGE',
			'DONE',
			'FAILED',
			'FAILED_TRANSIENT',
			'FAILED_BLOCKED',
			'FAILED_UNSAFE',
			'BLOCKED_PUSH',
			'BLOCKED_MERGE',
			'GATE_APPROVE',
			'GATE_REVISE',
			'RESUME_PENDING',
			'CLEANUP',
		];
		for (const phase of phases) {
			expect(VALID_TRANSITIONS).toHaveProperty(phase);
		}
	});

	it('is readonly (type-level enforcement)', () => {
		// VALID_TRANSITIONS is declared as Readonly<Record<...>>
		// This is a compile-time contract: we verify it exists and has entries
		expect(Object.keys(VALID_TRANSITIONS).length).toBe(28);
	});

	it('contains no duplicate targets in any transition', () => {
		for (const [phase, targets] of Object.entries(VALID_TRANSITIONS)) {
			const unique = new Set(targets);
			expect(unique.size).toBe(targets.length);
		}
	});
});

// ---------------------------------------------------------------------------
// Contract: canTransition()
// ---------------------------------------------------------------------------
describe('canTransition() contract', () => {
	it('returns true for valid transitions', () => {
		expect(canTransition('QUEUED', 'CLAIMED')).toBe(true);
		expect(canTransition('CLAIMED', 'REPO_SYNC')).toBe(true);
		expect(canTransition('IMPLEMENT', 'TEST')).toBe(true);
		expect(canTransition('MERGE', 'DONE')).toBe(true);
	});

	it('returns false for invalid transitions', () => {
		expect(canTransition('QUEUED', 'DONE')).toBe(false);
		expect(canTransition('DONE', 'QUEUED')).toBe(false);
		expect(canTransition('CLAIMED', 'DONE')).toBe(false);
	});

	it('returns false for terminal phases as source', () => {
		const terminalPhases = [
			'DONE',
			'FAILED',
			'FAILED_BLOCKED',
			'FAILED_UNSAFE',
			'CLEANUP',
		] as const;
		for (const terminal of terminalPhases) {
			expect(canTransition(terminal, 'QUEUED')).toBe(false);
		}
	});

	it('returns false for unknown phase', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(canTransition('UNKNOWN_PHASE' as any, 'QUEUED')).toBe(false);
	});

	it('is consistent with VALID_TRANSITIONS map', () => {
		// Every entry in the map must return true from canTransition
		for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
			for (const to of targets) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				expect(canTransition(from as any, to as any)).toBe(true);
			}
		}
	});
});

// ---------------------------------------------------------------------------
// Contract: transition()
// ---------------------------------------------------------------------------
describe('transition() contract', () => {
	it('returns ok:true on valid transition', () => {
		const run = makeRun({ phase: 'QUEUED' });
		const result = transition(run, 'CLAIMED', 'moving to claimed');

		expect(result.ok).toBe(true);
		expect(result.run.phase).toBe('CLAIMED');
		expect(result.event).toBeDefined();
		expect(result.event.phase).toBe('CLAIMED');
		expect(result.event.message).toBe('moving to claimed');
	});

	it('returns ok:false on invalid transition', () => {
		const run = makeRun({ phase: 'QUEUED' });
		const result = transition(run, 'DONE', 'cannot jump');

		expect(result.ok).toBe(false);
		expect(result.run.phase).toBe('QUEUED'); // unchanged
		expect(result.run.lastError).toBeDefined();
		expect(result.event.level).toBe('ERROR');
	});

	it('preserves run identity on valid transition', () => {
		const run = makeRun({ phase: 'QUEUED' });
		const result = transition(run, 'CLAIMED', 'move');

		expect(result.run.id).toBe(run.id);
		expect(result.run.repoId).toBe(run.repoId);
		expect(result.run.issueNumber).toBe(run.issueNumber);
	});

	it('preserves run identity on invalid transition', () => {
		const run = makeRun({ phase: 'QUEUED' });
		const result = transition(run, 'DONE', 'nope');

		expect(result.run.id).toBe(run.id);
	});

	it('sets status to done on DONE transition', () => {
		const run = makeRun({ phase: 'MERGE' });
		const result = transition(run, 'DONE', 'completed');

		expect(result.ok).toBe(true);
		expect(result.run.status).toBe('done');
		expect(result.run.finishedAt).toBeDefined();
	});

	it('sets status to failed on FAILED transitions', () => {
		const run = makeRun({ phase: 'CLAIMED' });
		const result = transition(run, 'FAILED_BLOCKED', 'blocked by merge');

		expect(result.ok).toBe(true);
		expect(result.run.status).toBe('failed');
		expect(result.run.finishedAt).toBeDefined();
		expect(result.run.lastError).toBe('blocked by merge');
	});

	it('sets status to active on non-terminal transitions', () => {
		const run = makeRun({ phase: 'QUEUED' });
		const result = transition(run, 'CLAIMED', 'claimed');

		expect(result.ok).toBe(true);
		expect(result.run.status).toBe('active');
		expect(result.run.finishedAt).toBeNull();
	});

	it('generates an event with stable shape', () => {
		const run = makeRun({ phase: 'QUEUED' });
		const result = transition(run, 'CLAIMED', 'claiming', 'INFO', {
			key: 'val',
		});

		expect(result.event.id).toBeDefined();
		expect(result.event.runId).toBe(run.id);
		expect(result.event.phase).toBe('CLAIMED');
		expect(result.event.level).toBe('INFO');
		expect(result.event.message).toBe('claiming');
		expect(result.event.payload).toEqual({ key: 'val' });
		expect(result.event.createdAt).toBeDefined();
	});

	it('applies full transition chain from QUEUED to DONE', () => {
		const chain: Array<{ from: string; to: string }> = [
			{ from: 'QUEUED', to: 'CLAIMED' },
			{ from: 'CLAIMED', to: 'REPO_SYNC' },
			{ from: 'REPO_SYNC', to: 'ISSUE_CONTEXT' },
			{ from: 'ISSUE_CONTEXT', to: 'WEB_RESEARCH' },
			{ from: 'WEB_RESEARCH', to: 'SPECIFY' },
			{ from: 'SPECIFY', to: 'PLAN' },
			{ from: 'PLAN', to: 'TASKS' },
			{ from: 'TASKS', to: 'ANALYZE' },
			{ from: 'ANALYZE', to: 'REVIEW' },
			{ from: 'REVIEW', to: 'IMPLEMENT' },
			{ from: 'IMPLEMENT', to: 'TEST' },
			{ from: 'TEST', to: 'VERIFY' },
			{ from: 'VERIFY', to: 'COMMIT' },
			{ from: 'COMMIT', to: 'PR_CREATE' },
			{ from: 'PR_CREATE', to: 'MERGE' },
			{ from: 'MERGE', to: 'DONE' },
		];

		let run = makeRun();
		for (const step of chain) {
			const result = transition(run, step.to as any, `step: ${step.to}`);
			expect(result.ok).toBe(true);
			run = result.run;
		}
		expect(run.phase).toBe('DONE');
		expect(run.status).toBe('done');
	});
});

// ---------------------------------------------------------------------------
// Contract: markFailed()
// ---------------------------------------------------------------------------
describe('markFailed() contract', () => {
	it('always returns ok:true', () => {
		const run = makeRun({ phase: 'QUEUED' });
		const result = markFailed(run, 'FAILED', 'test failure');
		expect(result.ok).toBe(true);
	});

	it('sets phase to the specified failure kind', () => {
		const kinds = ['FAILED', 'FAILED_TRANSIENT', 'FAILED_BLOCKED', 'FAILED_UNSAFE'] as const;
		for (const kind of kinds) {
			const run = makeRun();
			const result = markFailed(run, kind, 'reason');
			expect(result.run.phase).toBe(kind);
		}
	});

	it('sets status based on failure kind', () => {
		// FAILED and FAILED_BLOCKED → blocked
		const run1 = makeRun();
		expect(markFailed(run1, 'FAILED', 'x').run.status).toBe('blocked');
		expect(markFailed(run1, 'FAILED_BLOCKED', 'x').run.status).toBe('blocked');

		// FAILED_TRANSIENT and FAILED_UNSAFE → failed
		const run2 = makeRun();
		expect(markFailed(run2, 'FAILED_TRANSIENT', 'x').run.status).toBe('failed');
		expect(markFailed(run2, 'FAILED_UNSAFE', 'x').run.status).toBe('failed');
	});

	it('sets finishedAt to current time', () => {
		const run = makeRun();
		const result = markFailed(run, 'FAILED', 'reason');
		expect(result.run.finishedAt).toBeDefined();
		expect(new Date(result.run.finishedAt!).getTime()).toBeGreaterThan(0);
	});

	it('sets lastError to the provided reason', () => {
		const run = makeRun();
		const result = markFailed(run, 'FAILED', 'disk full');
		expect(result.run.lastError).toBe('disk full');
	});

	it('generates an event with failure metadata in payload', () => {
		const run = makeRun({ phase: 'IMPLEMENT' });
		const result = markFailed(run, 'FAILED_BLOCKED', 'merge conflict');

		expect(result.event.level).toBe('ERROR');
		expect(result.event.phase).toBe('FAILED_BLOCKED');
		expect(result.event.payload).toEqual({
			failedPhase: 'IMPLEMENT',
			reason: 'merge conflict',
		});
	});

	it('preserves run identity', () => {
		const run = makeRun();
		const result = markFailed(run, 'FAILED', 'reason');
		expect(result.run.id).toBe(run.id);
		expect(result.run.repoId).toBe(run.repoId);
		expect(result.run.issueNumber).toBe(run.issueNumber);
	});
});

// ---------------------------------------------------------------------------
// Contract: retry()
// ---------------------------------------------------------------------------
describe('retry() contract', () => {
	it('returns ok:true from FAILED_TRANSIENT', () => {
		const run = makeRun({ phase: 'FAILED_TRANSIENT', status: 'failed' });
		const result = retry(run);

		expect(result.ok).toBe(true);
		expect(result.run.phase).toBe('TEST');
		expect(result.run.status).toBe('active');
		expect(result.run.lastError).toBeNull();
		expect(result.run.finishedAt).toBeNull();
		expect(result.run.attempt).toBe(2);
	});

	it('returns ok:false from non-FAILED_TRANSIENT phases', () => {
		const nonRetryable = [
			'QUEUED',
			'CLAIMED',
			'DONE',
			'FAILED',
			'FAILED_BLOCKED',
			'FAILED_UNSAFE',
			'IMPLEMENT',
			'TEST',
		];

		for (const phase of nonRetryable) {
			const run = makeRun({ phase: phase as any });
			const result = retry(run);

			expect(result.ok).toBe(false);
			expect(result.run.phase).toBe(phase); // unchanged
			expect(result.event.level).toBe('ERROR');
		}
	});

	it('increments attempt counter on successful retry', () => {
		const run = makeRun({ phase: 'FAILED_TRANSIENT', attempt: 3 });
		const result = retry(run);

		expect(result.run.attempt).toBe(4);
	});

	it('generates event with retry metadata', () => {
		const run = makeRun({ phase: 'FAILED_TRANSIENT', attempt: 1 });
		const result = retry(run);

		expect(result.event.level).toBe('INFO');
		expect(result.event.phase).toBe('TEST');
		expect(result.event.payload).toEqual({ previousAttempt: 1 });
		expect(result.event.message).toContain('Retry attempt 2');
	});

	it('preserves run identity on retry', () => {
		const run = makeRun({ phase: 'FAILED_TRANSIENT' });
		const result = retry(run);

		expect(result.run.id).toBe(run.id);
		expect(result.run.repoId).toBe(run.repoId);
	});

	it('gives same result for multiple retries (idempotent state)', () => {
		const run = makeRun({ phase: 'FAILED_TRANSIENT', attempt: 1 });
		const result1 = retry(run);
		const result2 = retry(run);

		// Both retries from the same input should produce same attempt increment
		expect(result1.run.attempt).toBe(2);
		expect(result2.run.attempt).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Contract: isTerminalPhase()
// ---------------------------------------------------------------------------
describe('isTerminalPhase() contract', () => {
	it('returns true for phases with no outgoing transitions', () => {
		const terminal = ['DONE', 'FAILED', 'FAILED_BLOCKED', 'FAILED_UNSAFE', 'CLEANUP'];
		for (const phase of terminal) {
			expect(isTerminalPhase(phase as any)).toBe(true);
		}
	});

	it('returns false for active phases', () => {
		const active = ['QUEUED', 'CLAIMED', 'IMPLEMENT', 'TEST', 'MERGE'];
		for (const phase of active) {
			expect(isTerminalPhase(phase as any)).toBe(false);
		}
	});

	it('is consistent with VALID_TRANSITIONS', () => {
		for (const [phase, targets] of Object.entries(VALID_TRANSITIONS)) {
			// #244: Phases with only CLEANUP transition are still terminal
			const onlyCleanup = targets.length === 1 && targets[0] === 'CLEANUP';
			const isTerminal = targets.length === 0 || onlyCleanup;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect(isTerminalPhase(phase as any)).toBe(isTerminal);
		}
	});
});

// ---------------------------------------------------------------------------
// Contract: isFailurePhase()
// ---------------------------------------------------------------------------
describe('isFailurePhase() contract', () => {
	it('returns true for all failure phases', () => {
		const failures = ['FAILED', 'FAILED_TRANSIENT', 'FAILED_BLOCKED', 'FAILED_UNSAFE'];
		for (const phase of failures) {
			expect(isFailurePhase(phase as any)).toBe(true);
		}
	});

	it('returns false for non-failure phases', () => {
		const nonFailures = ['QUEUED', 'DONE', 'IMPLEMENT', 'TEST', 'CLEANUP', 'MERGE'];
		for (const phase of nonFailures) {
			expect(isFailurePhase(phase as any)).toBe(false);
		}
	});

	it('returns false for blocked/approval phases', () => {
		expect(isFailurePhase('BLOCKED_PUSH' as any)).toBe(false);
		expect(isFailurePhase('BLOCKED_MERGE' as any)).toBe(false);
		expect(isFailurePhase('GATE_APPROVE' as any)).toBe(false);
		expect(isFailurePhase('GATE_REVISE' as any)).toBe(false);
	});
});
