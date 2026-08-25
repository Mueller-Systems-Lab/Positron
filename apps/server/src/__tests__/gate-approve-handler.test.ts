// Positron — GATE_APPROVE Handler Tests
//
// Issue #332: Tests for the extracted gate-approve-handler adapter.
// Verifies all 6 Stop/Ask decision outcomes route correctly
// and that fail-closed behavior is preserved.
//
// The handler builds pipeline action descriptions from run context
// (e.g., "merge to main branch for issue #42") that match
// Stop/Ask Category A/B policy patterns.

import type { RunState } from '@positron/run-state';
import type { Phase } from '@positron/shared';
import { describe, expect, it } from 'vitest';
import type { GateApproveOutcome } from '../gate-approve-handler.js';
import { handleGateApprove } from '../gate-approve-handler.js';

/** Minimal RunState for handler testing */
function makeRunState(overrides: Partial<RunState> = {}): RunState {
	return {
		id: 'test-run-001',
		repoId: 'test-repo',
		issueNumber: 42,
		branch: 'positron/issue-42-test',
		phase: 'GATE_APPROVE' as Phase,
		status: 'blocked',
		autonomyLevel: 2,
		attempt: 0,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		lastError: null,
		workspacePath: '/tmp/test-ws',
		...overrides,
	};
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALLOW path
// ═══════════════════════════════════════════════════════════════════════════════

describe('handleGateApprove — ALLOW path', () => {
	it('commit action in TEST repo resolves to ALLOW → MERGE', () => {
		const run = makeRunState({
			lastError: 'Human approval required before COMMIT: evidence needed',
			phase: 'GATE_APPROVE',
		});
		const { outcome } = handleGateApprove(run);

		expect(outcome.kind).toBe('TRANSITION');
		if (outcome.kind === 'TRANSITION') {
			expect(outcome.to).toBe('MERGE');
			expect(outcome.message).toContain('ALLOW');
		}
	});

	it('ALLOW produces audit events', () => {
		const run = makeRunState({
			lastError: 'Human approval required before COMMIT',
		});
		const { events } = handleGateApprove(run);

		expect(events.length).toBeGreaterThanOrEqual(1);
		const gateEvent = events.find((e) => e.level === 'GATE');
		expect(gateEvent).toBeTruthy();
		expect(gateEvent?.message).toContain('ALLOW');
	});

	it('pipeline transition in TEST is allowed', () => {
		const run = makeRunState(); // no lastError → uses phase context
		const { outcome } = handleGateApprove(run, 'TEST');

		expect(outcome.kind).toBe('TRANSITION');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// DENY path — merge to main matches Category A pattern
// ═══════════════════════════════════════════════════════════════════════════════

describe('handleGateApprove — DENY path', () => {
	it('merge to main branch is denied (Category A)', () => {
		const run = makeRunState({
			lastError: 'Human approval required before MERGE: merge to main',
		});
		const { outcome } = handleGateApprove(run);

		expect(outcome.kind).toBe('FAILED_BLOCKED');
		if (outcome.kind === 'FAILED_BLOCKED') {
			expect(outcome.message).toContain('DENY');
		}
	});

	it('merge to master branch is denied', () => {
		const run = makeRunState({
			lastError: 'Human approval required before MERGE: merge to master branch',
		});
		const { outcome } = handleGateApprove(run);

		expect(outcome.kind).toBe('FAILED_BLOCKED');
	});

	it('push to main is denied (Category A)', () => {
		const run = makeRunState({
			lastError: 'Human approval required before COMMIT: commit to main branch',
		});
		const { outcome } = handleGateApprove(run);

		expect(outcome.kind).toBe('FAILED_BLOCKED');
	});

	it('DENY produces ERROR-level events', () => {
		const run = makeRunState({
			lastError: 'Human approval required before MERGE: merge to main',
		});
		const { events } = handleGateApprove(run);

		const errorEvent = events.find((e) => e.level === 'ERROR');
		expect(errorEvent).toBeTruthy();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// ASK_HUMAN path — PRODUCTION repo forces ASK_HUMAN for any action
// ═══════════════════════════════════════════════════════════════════════════════

describe('handleGateApprove — ASK_HUMAN / REQUIRE_REVIEW path', () => {
	it('PRODUCTION repo forces review for any action', () => {
		const run = makeRunState({
			lastError: 'Human approval required before COMMIT',
		});
		const { outcome } = handleGateApprove(run, 'PRODUCTION');

		expect(outcome.kind).toBe('STAY');
		if (outcome.kind === 'STAY') {
			expect(outcome.message).toContain('Review required');
		}
	});

	it('CRITICAL repo forces review', () => {
		const run = makeRunState({
			lastError: 'Human approval required before COMMIT',
		});
		const { outcome } = handleGateApprove(run, 'CRITICAL');

		expect(outcome.kind).toBe('STAY');
		if (outcome.kind === 'STAY') {
			expect(outcome.message).toContain('Review required');
		}
	});

	it('STAY events reference required evidence', () => {
		const run = makeRunState({
			lastError: 'Human approval required before COMMIT',
		});
		const { events } = handleGateApprove(run, 'PRODUCTION');

		// Should have GATE-level events from policy evaluation
		const gateEvent = events.find((e) => e.level === 'GATE');
		expect(gateEvent).toBeTruthy();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// REQUIRE_REVIEW path — merge to feature branch (Category B)
// ═══════════════════════════════════════════════════════════════════════════════

describe('handleGateApprove — REQUIRE_REVIEW path', () => {
	it('feature branch merge triggers REQUIRE_REVIEW → STAY', () => {
		const run = makeRunState({
			lastError: 'Human approval required before MERGE: feature branch merge',
		});
		const { outcome } = handleGateApprove(run);

		expect(outcome.kind).toBe('STAY');
		if (outcome.kind === 'STAY') {
			expect(outcome.message).toContain('Review required');
		}
	});

	it('REQUIRE_REVIEW does not auto-proceed', () => {
		const run = makeRunState({
			lastError: 'Human approval required before MERGE: feature branch merge',
		});
		const { outcome } = handleGateApprove(run);
		expect(outcome.kind).toBe('STAY');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// REQUIRE_DRY_RUN path — database migration patterns
// ═══════════════════════════════════════════════════════════════════════════════

describe('handleGateApprove — REQUIRE_DRY_RUN path', () => {
	it('database migration triggers REQUIRE_DRY_RUN → STAY', () => {
		// Action: "database migration" matches Category B pattern
		const run = makeRunState({
			lastError: 'Human approval required before MERGE: database migration needed',
		});
		const { outcome } = handleGateApprove(run);

		expect(outcome.kind).toBe('STAY');
		if (outcome.kind === 'STAY') {
			expect(outcome.message).toContain('Dry-run required');
		}
	});

	it('REQUIRE_DRY_RUN does not proceed to MERGE', () => {
		const run = makeRunState({
			lastError: 'Human approval required before MERGE: database migration needed',
		});
		const { outcome } = handleGateApprove(run);
		expect(outcome.kind).toBe('STAY');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// No lastError fallback
// ═══════════════════════════════════════════════════════════════════════════════

describe('handleGateApprove — no lastError fallback', () => {
	it('without lastError, uses phase context and ALLOWs in TEST', () => {
		const run = makeRunState({ lastError: null });
		const { outcome } = handleGateApprove(run, 'TEST');

		expect(outcome.kind).toBe('TRANSITION');
		if (outcome.kind === 'TRANSITION') {
			expect(outcome.message).toContain('ALLOW');
		}
	});

	it('empty lastError works same as null', () => {
		const run = makeRunState({ lastError: '' });
		const { outcome } = handleGateApprove(run);

		expect(outcome.kind).toBe('TRANSITION');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fail-closed invariants
// ═══════════════════════════════════════════════════════════════════════════════

describe('handleGateApprove — fail-closed invariants', () => {
	it('events array is never empty', () => {
		const run = makeRunState();
		const { events } = handleGateApprove(run);
		expect(events.length).toBeGreaterThanOrEqual(1);
	});

	it('handler does not mutate run state', () => {
		const run = makeRunState({
			lastError: 'Human approval required before MERGE: merge to main',
		});
		const runBefore = { ...run, id: run.id };

		handleGateApprove(run);

		expect(run.id).toBe(runBefore.id);
		expect(run.phase).toBe(runBefore.phase);
		expect(run.lastError).toBe(runBefore.lastError);
	});

	it('non-ALLOW outcomes never produce TRANSITION', () => {
		const run = makeRunState({
			lastError: 'Human approval required before MERGE: merge to main',
		});
		const { outcome } = handleGateApprove(run);

		expect(outcome.kind).not.toBe('TRANSITION');
	});

	it('ALLOW outcome in TEST repo always produces TRANSITION', () => {
		const run = makeRunState({
			lastError: 'Human approval required before COMMIT',
		});
		const { outcome } = handleGateApprove(run, 'TEST');

		expect(outcome.kind).toBe('TRANSITION');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Structural integrity
// ═══════════════════════════════════════════════════════════════════════════════

describe('handleGateApprove — structural integrity', () => {
	it('return type includes both outcome and events', () => {
		const run = makeRunState();
		const result = handleGateApprove(run);

		expect(result).toHaveProperty('outcome');
		expect(result).toHaveProperty('events');
		expect(result.outcome).toBeDefined();
		expect(Array.isArray(result.events)).toBe(true);
	});

	it('outcome has valid kind discriminant', () => {
		const run = makeRunState();
		const { outcome } = handleGateApprove(run);

		const validKinds: GateApproveOutcome['kind'][] = ['TRANSITION', 'FAILED_BLOCKED', 'STAY'];
		expect(validKinds).toContain(outcome.kind);
	});

	it('TRANSITION outcome includes target phase', () => {
		const run = makeRunState({
			lastError: 'Human approval required before COMMIT',
		});
		const { outcome } = handleGateApprove(run, 'TEST');

		if (outcome.kind === 'TRANSITION') {
			expect(outcome.to).toBe('MERGE');
		}
	});

	it('FAILED_BLOCKED outcome includes error message', () => {
		const run = makeRunState({
			lastError: 'Human approval required before MERGE: merge to main',
		});
		const { outcome } = handleGateApprove(run);

		if (outcome.kind === 'FAILED_BLOCKED') {
			expect(outcome.message.length).toBeGreaterThan(0);
		}
	});

	it('STAY outcome includes reason message', () => {
		const run = makeRunState({
			lastError: 'Human approval required before MERGE: feature branch merge',
		});
		const { outcome } = handleGateApprove(run);

		if (outcome.kind === 'STAY') {
			expect(outcome.message.length).toBeGreaterThan(0);
		}
	});
});
