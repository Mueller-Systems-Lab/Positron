// Positron — State Machine: Comprehensive Tests (QA-021)
// Covers: transition(), markFailed(), retry(), isFailurePhase()

import { describe, expect, test } from 'vitest';
import type { RunEventData } from '../state-machine.js';
import {
	canTransition,
	createRun,
	isFailurePhase,
	isTerminalPhase,
	markFailed,
	resumeFromEvents,
	retry,
	transition,
} from '../state-machine.js';

// ---------------------------------------------------------------------------
// transition()
// ---------------------------------------------------------------------------
describe('transition', () => {
	test('valid: QUEUED → CLAIMED returns ok and updates phase', () => {
		const run = createRun('repo-1', 42, 2);
		const result = transition(run, 'CLAIMED', 'Claimed by agent');

		expect(result.ok).toBe(true);
		expect(result.run.phase).toBe('CLAIMED');
		expect(result.run.status).toBe('active');
		expect(result.event.message).toBe('Claimed by agent');
		expect(result.event.level).toBe('INFO');
	});

	test('valid: transition to DONE sets status=done and finishedAt', () => {
		const run = createRun('repo-1', 42, 2);
		// Manually set phase so transition is valid per VALID_TRANSITIONS
		run.phase = 'MERGE'; // MERGE → DONE is valid
		const result = transition(run, 'DONE', 'Completed');

		expect(result.ok).toBe(true);
		expect(result.run.phase).toBe('DONE');
		expect(result.run.status).toBe('done');
		expect(result.run.finishedAt).not.toBeNull();
	});

	test('valid: transition to FAILED_TRANSIENT sets status=failed, lastError, finishedAt', () => {
		const run = createRun('repo-1', 42, 2);
		run.phase = 'REPO_SYNC'; // REPO_SYNC → FAILED_TRANSIENT is valid
		const result = transition(run, 'FAILED_TRANSIENT', 'network timeout');

		expect(result.ok).toBe(true);
		expect(result.run.phase).toBe('FAILED_TRANSIENT');
		expect(result.run.status).toBe('failed');
		expect(result.run.lastError).toBe('network timeout');
		expect(result.run.finishedAt).not.toBeNull();
	});

	test('valid: transition to FAILED_BLOCKED sets status=failed', () => {
		const run = createRun('repo-1', 42, 2);
		run.phase = 'IMPLEMENT'; // IMPLEMENT → FAILED_BLOCKED is valid
		const result = transition(run, 'FAILED_BLOCKED', 'blocked reason');

		expect(result.ok).toBe(true);
		expect(result.run.phase).toBe('FAILED_BLOCKED');
		expect(result.run.status).toBe('failed'); // 'failed' because FAILED_BLOCKED starts with 'FAILED'
		expect(result.run.lastError).toBe('blocked reason');
	});

	test('invalid: DONE → QUEUED returns ok=false', () => {
		const run = createRun('repo-1', 42, 2);
		run.phase = 'DONE';
		const result = transition(run, 'QUEUED', 'should not work');

		expect(result.ok).toBe(false);
		expect(result.run.phase).toBe('DONE'); // unchanged
		expect(result.run.lastError).toContain('Invalid transition');
		expect(result.event.level).toBe('ERROR');
	});

	test('invalid: CANCELLED status does not affect phase transition logic', () => {
		// Note: CANCELLED is a RunStatus, not a Phase. Testing that status
		// alone does not affect canTransition behavior.
		const run = createRun('repo-1', 42, 2);
		run.phase = 'FAILED_BLOCKED'; // terminal — no valid transitions
		const result = transition(run, 'IMPLEMENT', 'try to resume blocked');

		expect(result.ok).toBe(false);
		expect(result.run.lastError).toContain('Invalid transition');
	});

	test('transition preserves custom payload', () => {
		const run = createRun('repo-1', 42, 2);
		const payload = { attempt: 1, source: 'manual' };
		const result = transition(run, 'CLAIMED', 'claimed', 'INFO', payload);

		expect(result.ok).toBe(true);
		expect(result.event.payload).toEqual(payload);
	});

	test('transition accepts custom level', () => {
		const run = createRun('repo-1', 42, 2);
		const result = transition(run, 'CLAIMED', 'custom level', 'WARN');

		expect(result.ok).toBe(true);
		expect(result.event.level).toBe('WARN');
	});
});

// ---------------------------------------------------------------------------
// markFailed()
// ---------------------------------------------------------------------------
describe('markFailed', () => {
	test('FAILED_BLOCKED sets status=blocked and preserves reason', () => {
		const run = createRun('repo-1', 42, 2);
		const result = markFailed(run, 'FAILED_BLOCKED', 'merge conflict');

		expect(result.ok).toBe(true);
		expect(result.run.phase).toBe('FAILED_BLOCKED');
		expect(result.run.status).toBe('blocked');
		expect(result.run.lastError).toBe('merge conflict');
		expect(result.run.finishedAt).not.toBeNull();
		expect(result.event.level).toBe('ERROR');
	});

	test('FAILED sets status=blocked (blocked due to permanent failure)', () => {
		const run = createRun('repo-1', 42, 2);
		const result = markFailed(run, 'FAILED', 'permanent error');

		expect(result.ok).toBe(true);
		expect(result.run.phase).toBe('FAILED');
		expect(result.run.status).toBe('blocked');
		expect(result.run.lastError).toBe('permanent error');
		expect(result.run.finishedAt).not.toBeNull();
	});

	test('FAILED_TRANSIENT sets status=failed', () => {
		const run = createRun('repo-1', 42, 2);
		const result = markFailed(run, 'FAILED_TRANSIENT', 'temporary network issue');

		expect(result.ok).toBe(true);
		expect(result.run.phase).toBe('FAILED_TRANSIENT');
		expect(result.run.status).toBe('failed');
		expect(result.run.lastError).toBe('temporary network issue');
		expect(result.run.finishedAt).not.toBeNull();
	});

	test('FAILED_UNSAFE sets status=failed', () => {
		const run = createRun('repo-1', 42, 2);
		const result = markFailed(run, 'FAILED_UNSAFE', 'dangerous operation detected');

		expect(result.ok).toBe(true);
		expect(result.run.phase).toBe('FAILED_UNSAFE');
		expect(result.run.status).toBe('failed');
		expect(result.run.lastError).toBe('dangerous operation detected');
		expect(result.run.finishedAt).not.toBeNull();
	});

	test('event payload contains failedPhase and reason', () => {
		const run = createRun('repo-1', 42, 2);
		run.phase = 'IMPLEMENT';
		const result = markFailed(run, 'FAILED_BLOCKED', 'test failure');

		expect(result.ok).toBe(true);
		expect(result.event.message).toBe('test failure');
		expect(result.event.payload).toEqual({
			failedPhase: 'IMPLEMENT',
			reason: 'test failure',
		});
	});

	test('original run fields are preserved', () => {
		const run = createRun('repo-1', 42, 2);
		run.branch = 'positron/issue-42-test';
		run.workspacePath = '/tmp/workspace';
		const result = markFailed(run, 'FAILED_TRANSIENT', 'error');

		expect(result.ok).toBe(true);
		expect(result.run.repoId).toBe('repo-1');
		expect(result.run.issueNumber).toBe(42);
		expect(result.run.branch).toBe('positron/issue-42-test');
		expect(result.run.workspacePath).toBe('/tmp/workspace');
		expect(result.run.autonomyLevel).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// retry()
// ---------------------------------------------------------------------------
describe('retry', () => {
	test('successful retry from FAILED_TRANSIENT', () => {
		const run = createRun('repo-1', 42, 2);
		run.phase = 'FAILED_TRANSIENT';
		run.lastError = 'previous error';
		run.finishedAt = '2025-01-01T00:00:00Z';
		run.attempt = 3;

		const result = retry(run);

		expect(result.ok).toBe(true);
		expect(result.run.phase).toBe('TEST');
		expect(result.run.status).toBe('active');
		expect(result.run.attempt).toBe(4);
		expect(result.run.lastError).toBeNull();
		expect(result.run.finishedAt).toBeNull();
	});

	test('retry preserves relevant run fields', () => {
		const run = createRun('repo-1', 42, 2);
		run.phase = 'FAILED_TRANSIENT';
		run.branch = 'positron/issue-42-feature';
		run.workspacePath = '/tmp/workspace';

		const result = retry(run);

		expect(result.ok).toBe(true);
		expect(result.run.repoId).toBe('repo-1');
		expect(result.run.issueNumber).toBe(42);
		expect(result.run.branch).toBe('positron/issue-42-feature');
		expect(result.run.workspacePath).toBe('/tmp/workspace');
	});

	test('retry event contains correct phase and attempt info', () => {
		const run = createRun('repo-1', 42, 2);
		run.phase = 'FAILED_TRANSIENT';
		run.attempt = 1;

		const result = retry(run);

		expect(result.ok).toBe(true);
		expect(result.event.phase).toBe('TEST');
		expect(result.event.level).toBe('INFO');
		expect(result.event.message).toContain('Retry attempt 2');
		expect(result.event.payload).toEqual({ previousAttempt: 1 });
	});

	test('retry from FAILED returns ok=false', () => {
		const run = createRun('repo-1', 42, 2);
		run.phase = 'FAILED'; // only FAILED_TRANSIENT can retry

		const result = retry(run);

		expect(result.ok).toBe(false);
		expect(result.run.phase).toBe('FAILED'); // unchanged
		expect(result.event.level).toBe('ERROR');
		expect(result.event.message).toContain('Cannot retry');
		expect(result.event.message).toContain('FAILED_TRANSIENT');
	});

	test('retry from FAILED_BLOCKED returns ok=false', () => {
		const run = createRun('repo-1', 42, 2);
		run.phase = 'FAILED_BLOCKED';

		const result = retry(run);

		expect(result.ok).toBe(false);
		expect(result.run.phase).toBe('FAILED_BLOCKED');
		expect(result.event.message).toContain('Cannot retry');
		expect(result.event.message).toContain('FAILED_BLOCKED');
	});

	test('retry from FAILED_UNSAFE returns ok=false', () => {
		const run = createRun('repo-1', 42, 2);
		run.phase = 'FAILED_UNSAFE';

		const result = retry(run);

		expect(result.ok).toBe(false);
		expect(result.run.phase).toBe('FAILED_UNSAFE');
		expect(result.event.message).toContain('Cannot retry');
	});

	test('retry from DONE returns ok=false', () => {
		const run = createRun('repo-1', 42, 2);
		run.phase = 'DONE';

		const result = retry(run);

		expect(result.ok).toBe(false);
		expect(result.run.phase).toBe('DONE');
		expect(result.event.message).toContain('Cannot retry');
	});

	test('retry from active phase returns ok=false', () => {
		const run = createRun('repo-1', 42, 2);
		run.phase = 'IMPLEMENT';

		const result = retry(run);

		expect(result.ok).toBe(false);
		expect(result.run.phase).toBe('IMPLEMENT');
		expect(result.event.message).toContain('Cannot retry');
	});

	test('retry from QUEUED returns ok=false', () => {
		const run = createRun('repo-1', 42, 2); // phase defaults to QUEUED

		const result = retry(run);

		expect(result.ok).toBe(false);
		expect(result.run.phase).toBe('QUEUED');
		expect(result.event.message).toContain('Cannot retry');
	});

	test('retry error event references the current phase in message', () => {
		const run = createRun('repo-1', 42, 2);
		run.phase = 'DONE';

		const result = retry(run);

		expect(result.ok).toBe(false);
		expect(result.event.message).toContain('DONE');
		expect(result.event.message).toContain('FAILED_TRANSIENT');
	});
});

// ---------------------------------------------------------------------------
// isFailurePhase()
// ---------------------------------------------------------------------------
describe('isFailurePhase', () => {
	test('FAILED is a failure phase', () => {
		expect(isFailurePhase('FAILED')).toBe(true);
	});

	test('FAILED_TRANSIENT is a failure phase', () => {
		expect(isFailurePhase('FAILED_TRANSIENT')).toBe(true);
	});

	test('FAILED_BLOCKED is a failure phase', () => {
		expect(isFailurePhase('FAILED_BLOCKED')).toBe(true);
	});

	test('FAILED_UNSAFE is a failure phase', () => {
		expect(isFailurePhase('FAILED_UNSAFE')).toBe(true);
	});

	// Non-failure phases
	test('DONE is not a failure phase', () => {
		expect(isFailurePhase('DONE')).toBe(false);
	});

	test('QUEUED is not a failure phase', () => {
		expect(isFailurePhase('QUEUED')).toBe(false);
	});

	test('IMPLEMENT is not a failure phase', () => {
		expect(isFailurePhase('IMPLEMENT')).toBe(false);
	});

	test('CLEANUP is not a failure phase', () => {
		expect(isFailurePhase('CLEANUP')).toBe(false);
	});

	test('TEST is not a failure phase', () => {
		expect(isFailurePhase('TEST')).toBe(false);
	});

	test('GATE_APPROVE is not a failure phase', () => {
		expect(isFailurePhase('GATE_APPROVE')).toBe(false);
	});

	test('BLOCKED_PUSH is not a failure phase (it is a blocked phase, not failure)', () => {
		expect(isFailurePhase('BLOCKED_PUSH')).toBe(false);
	});

	test('BLOCKED_MERGE is not a failure phase (it is a blocked phase, not failure)', () => {
		expect(isFailurePhase('BLOCKED_MERGE')).toBe(false);
	});

	test('RESUME_PENDING is not a failure phase', () => {
		expect(isFailurePhase('RESUME_PENDING')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// isTerminalPhase
// ---------------------------------------------------------------------------
describe('isTerminalPhase', () => {
	test('DONE is terminal', () => {
		expect(isTerminalPhase('DONE')).toBe(true);
	});

	test('FAILED is terminal', () => {
		expect(isTerminalPhase('FAILED')).toBe(true);
	});

	test('FAILED_BLOCKED is terminal', () => {
		expect(isTerminalPhase('FAILED_BLOCKED')).toBe(true);
	});

	test('FAILED_UNSAFE is terminal', () => {
		expect(isTerminalPhase('FAILED_UNSAFE')).toBe(true);
	});

	test('CLEANUP is terminal', () => {
		expect(isTerminalPhase('CLEANUP')).toBe(true);
	});

	test('QUEUED is not terminal', () => {
		expect(isTerminalPhase('QUEUED')).toBe(false);
	});

	test('IMPLEMENT is not terminal', () => {
		expect(isTerminalPhase('IMPLEMENT')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// canTransition — branch coverage: unknown from-phase
// ---------------------------------------------------------------------------
describe('canTransition edge cases', () => {
	test('returns false for unknown from-phase', () => {
		// TypeScript enforces Phase type, but runtime must handle invalid values
		expect(canTransition('INVALID' as any, 'DONE')).toBe(false);
	});

	test('returns false for unknown from-phase (empty string)', () => {
		expect(canTransition('' as any, 'QUEUED')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// resumeFromEvents — branch coverage for GATE and non-INFO/GATE levels
// ---------------------------------------------------------------------------
describe('resumeFromEvents', () => {
	test('resumes from empty events (QUEUED)', () => {
		const result = resumeFromEvents('run-1', 'repo-1', 42, []);
		expect(result.phase).toBe('QUEUED');
		expect(result.id).toBe('run-1');
		expect(result.repoId).toBe('repo-1');
		expect(result.issueNumber).toBe(42);
	});

	test('resumes with only INFO events', () => {
		const makeEvent = (phase: string, level: string, msg: string): RunEventData => ({
			id: `evt-${phase}`,
			runId: 'run-1',
			phase: phase as any,
			level: level as any,
			message: msg,
			payload: null,
			createdAt: new Date().toISOString(),
		});
		const events: RunEventData[] = [
			makeEvent('CLAIMED', 'INFO', 'started'),
			makeEvent('REPO_SYNC', 'INFO', 'synced'),
		];
		const result = resumeFromEvents('run-1', 'repo-1', 42, events);
		expect(result.phase).toBe('REPO_SYNC');
	});

	test('resumes with GATE events (covers GATE branch of ||)', () => {
		const makeEvent = (phase: string, level: string, msg: string): RunEventData => ({
			id: `evt-${phase}`,
			runId: 'run-1',
			phase: phase as any,
			level: level as any,
			message: msg,
			payload: null,
			createdAt: new Date().toISOString(),
		});
		const events: RunEventData[] = [makeEvent('QUEUED', 'GATE', 'gate passed')];
		const result = resumeFromEvents('run-1', 'repo-1', 42, events);
		expect(result.phase).toBe('QUEUED');
	});

	test('ignores WARN events (does not advance phase)', () => {
		const makeEvent = (phase: string, level: string, msg: string): RunEventData => ({
			id: `evt-${phase}`,
			runId: 'run-1',
			phase: phase as any,
			level: level as any,
			message: msg,
			payload: null,
			createdAt: new Date().toISOString(),
		});
		const events: RunEventData[] = [makeEvent('IMPLEMENT', 'WARN', 'warning')];
		const result = resumeFromEvents('run-1', 'repo-1', 42, events);
		expect(result.phase).toBe('QUEUED');
	});

	test('ignores ERROR events (does not advance phase)', () => {
		const makeEvent = (phase: string, level: string, msg: string): RunEventData => ({
			id: `evt-${phase}`,
			runId: 'run-1',
			phase: phase as any,
			level: level as any,
			message: msg,
			payload: null,
			createdAt: new Date().toISOString(),
		});
		const events: RunEventData[] = [makeEvent('IMPLEMENT', 'ERROR', 'error')];
		const result = resumeFromEvents('run-1', 'repo-1', 42, events);
		expect(result.phase).toBe('QUEUED');
	});

	test('mixes INFO and GATE events with WARN/ERROR', () => {
		const makeEvent = (phase: string, level: string, msg: string): RunEventData => ({
			id: `evt-${phase}`,
			runId: 'run-1',
			phase: phase as any,
			level: level as any,
			message: msg,
			payload: null,
			createdAt: new Date().toISOString(),
		});
		const events: RunEventData[] = [
			makeEvent('CLAIMED', 'INFO', 'ok'),
			makeEvent('REPO_SYNC', 'WARN', 'warn'),
			makeEvent('ISSUE_CONTEXT', 'GATE', 'gate ok'),
			makeEvent('IMPLEMENT', 'ERROR', 'err'),
		];
		const result = resumeFromEvents('run-1', 'repo-1', 42, events);
		expect(result.phase).toBe('ISSUE_CONTEXT');
		expect(result.id).toBe('run-1');
	});

	test('preserves runId and repoId through resume', () => {
		const makeEvent = (phase: string, level: string, msg: string): RunEventData => ({
			id: `evt-${phase}`,
			runId: 'my-run-id',
			phase: phase as any,
			level: level as any,
			message: msg,
			payload: null,
			createdAt: new Date().toISOString(),
		});
		const events: RunEventData[] = [makeEvent('CLAIMED', 'INFO', 'started')];
		const result = resumeFromEvents('my-run-id', 'my-repo', 99, events);
		expect(result.id).toBe('my-run-id');
		expect(result.repoId).toBe('my-repo');
		expect(result.issueNumber).toBe(99);
	});

	test('resumeFromEvents with HUMAN level does not advance', () => {
		const makeEvent = (phase: string, level: string, msg: string): RunEventData => ({
			id: `evt-${phase}`,
			runId: 'run-1',
			phase: phase as any,
			level: level as any,
			message: msg,
			payload: null,
			createdAt: new Date().toISOString(),
		});
		const events: RunEventData[] = [makeEvent('GATE_APPROVE', 'HUMAN', 'manual')];
		const result = resumeFromEvents('run-1', 'repo-1', 42, events);
		expect(result.phase).toBe('QUEUED');
	});
});
