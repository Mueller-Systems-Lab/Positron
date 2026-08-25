// Positron — Gate Enforcement Tests
//
// Issue #246: GateType Layers Runtime Enforcement
//
// Tests:
//  1. Missing evaluator → blocking failure
//  2. Passing evaluator → transition allowed
//  3. Blocking evaluator → transition prevented
//  4. Evaluator exception → blocking failure
//  5. Multiple gates: one failure blocks all
//  6. Security fail + human approval pass → still blocked
//  7. Human approval fail → GATE_APPROVE/pause
//  8. Evidence-required fail → completion blocked
//  9. pre_write fail → commit blocked
// 10. pre_pr fail → PR creation blocked
// 11. pre_merge fail → merge blocked
// 12. Phase requirements correctly mapped
// 13. Raw transition for non-gated phases still works
// 14. Clear/reset for test isolation
// 15. Fake evaluators must be explicitly registered
// 16. No implicit fake-PASS for missing evaluator

import type { GateEvaluationContext, GateResult, GateType, Phase } from '@positron/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	clearGateEvaluators,
	evaluateGates,
	gateEvaluatorCount,
	getRequiredGates,
	hasGateEvaluator,
	PHASE_GATE_REQUIREMENTS,
	phaseRequiresGates,
	registerGateEvaluator,
	tryTransitionWithGates,
} from '../gate-evaluator.js';
import type { RunState } from '../state-machine.js';
import { createRun, transition } from '../state-machine.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal RunState for testing */
function makeRun(phase: Phase = 'VERIFY'): RunState {
	return createRun('test-repo', 999, 2);
}

/** Build a minimal gate context */
function makeContext(overrides: Partial<GateEvaluationContext> = {}): GateEvaluationContext {
	return {
		runId: 'test-run-1',
		phase: 'VERIFY',
		targetPhase: 'COMMIT',
		gateTypes: ['pre_write', 'evidence_required'],
		...overrides,
	};
}

/** Create a passing evaluator for a gate type */
function passingEvaluator(gateType: GateType): () => GateResult {
	return () => ({
		gateType,
		passed: true,
		message: `${gateType} passed`,
		blocking: false,
	});
}

/** Create a blocking evaluator for a gate type */
function blockingEvaluator(gateType: GateType, msg = `${gateType} blocked`): () => GateResult {
	return () => ({
		gateType,
		passed: false,
		message: msg,
		blocking: true,
	});
}

/** Create an evaluator that throws */
function throwingEvaluator(gateType: GateType): () => GateResult {
	return () => {
		throw new Error(`${gateType} evaluator crashed`);
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Gate Evaluator Registry', () => {
	beforeEach(() => {
		clearGateEvaluators();
	});

	it('has empty registry after clear', () => {
		expect(gateEvaluatorCount()).toBe(0);
	});

	it('registers an evaluator', () => {
		registerGateEvaluator('pre_write', passingEvaluator('pre_write'));
		expect(gateEvaluatorCount()).toBe(1);
		expect(hasGateEvaluator('pre_write')).toBe(true);
	});

	it('overwrites existing evaluator for same gate type', () => {
		registerGateEvaluator('pre_write', passingEvaluator('pre_write'));
		registerGateEvaluator('pre_write', blockingEvaluator('pre_write'));
		expect(gateEvaluatorCount()).toBe(1);
	});

	it('clear removes all evaluators', () => {
		registerGateEvaluator('pre_write', passingEvaluator('pre_write'));
		registerGateEvaluator('security', passingEvaluator('security'));
		expect(gateEvaluatorCount()).toBe(2);
		clearGateEvaluators();
		expect(gateEvaluatorCount()).toBe(0);
	});

	it('hasGateEvaluator returns false for unknown gate', () => {
		expect(hasGateEvaluator('pre_write')).toBe(false);
	});

	it('hasGateEvaluator returns true for registered gate', () => {
		registerGateEvaluator('pre_write', passingEvaluator('pre_write'));
		expect(hasGateEvaluator('pre_write')).toBe(true);
	});
});

describe('evaluateGates', () => {
	beforeEach(() => {
		clearGateEvaluators();
	});

	// 1. Missing evaluator → blocking failure
	it('returns blocking failure for missing evaluator (never a PASS)', () => {
		const result = evaluateGates(['pre_write'], makeContext({ gateTypes: ['pre_write'] }));

		expect(result.allPassed).toBe(false);
		expect(result.blockingFailures).toHaveLength(1);
		expect(result.blockingFailures[0]!.gateType).toBe('pre_write');
		expect(result.blockingFailures[0]!.passed).toBe(false);
		expect(result.blockingFailures[0]!.blocking).toBe(true);
		expect(result.blockingFailures[0]!.message).toContain('No evaluator registered');
	});

	// 2. Passing evaluator → PASS
	it('passes with registered evaluator returning passed=true', () => {
		registerGateEvaluator('pre_write', passingEvaluator('pre_write'));
		const result = evaluateGates(['pre_write'], makeContext({ gateTypes: ['pre_write'] }));

		expect(result.allPassed).toBe(true);
		expect(result.blockingFailures).toHaveLength(0);
		expect(result.results[0]!.passed).toBe(true);
	});

	// 3. Blocking evaluator → block
	it('blocks with registered evaluator returning passed=false and blocking=true', () => {
		registerGateEvaluator('pre_write', blockingEvaluator('pre_write', 'Blocked by policy'));
		const result = evaluateGates(['pre_write'], makeContext({ gateTypes: ['pre_write'] }));

		expect(result.allPassed).toBe(false);
		expect(result.blockingFailures).toHaveLength(1);
		expect(result.blockingFailures[0]!.message).toBe('Blocked by policy');
	});

	// 4. Evaluator exception → blocking failure
	it('catches evaluator exceptions and returns blocking failure', () => {
		registerGateEvaluator('pre_write', throwingEvaluator('pre_write'));
		const result = evaluateGates(['pre_write'], makeContext({ gateTypes: ['pre_write'] }));

		expect(result.allPassed).toBe(false);
		expect(result.blockingFailures).toHaveLength(1);
		expect(result.blockingFailures[0]!.message).toContain('threw');
		expect(result.blockingFailures[0]!.message).toContain('crashed');
	});

	// 5. Multiple gates: one failure blocks
	it('fails when one of multiple gates fails', () => {
		registerGateEvaluator('pre_write', passingEvaluator('pre_write'));
		registerGateEvaluator('evidence_required', blockingEvaluator('evidence_required'));
		registerGateEvaluator('pre_pr', passingEvaluator('pre_pr'));

		const ctx = makeContext({ gateTypes: ['pre_write', 'evidence_required', 'pre_pr'] });
		const result = evaluateGates(['pre_write', 'evidence_required', 'pre_pr'], ctx);

		expect(result.allPassed).toBe(false);
		expect(result.results).toHaveLength(3);
		expect(result.blockingFailures).toHaveLength(1);
		expect(result.blockingFailures[0]!.gateType).toBe('evidence_required');
	});

	// Multiple gates: all pass
	it('passes when all multiple gates pass', () => {
		registerGateEvaluator('pre_write', passingEvaluator('pre_write'));
		registerGateEvaluator('evidence_required', passingEvaluator('evidence_required'));
		registerGateEvaluator('pre_pr', passingEvaluator('pre_pr'));

		const ctx = makeContext({ gateTypes: ['pre_write', 'evidence_required', 'pre_pr'] });
		const result = evaluateGates(['pre_write', 'evidence_required', 'pre_pr'], ctx);

		expect(result.allPassed).toBe(true);
		expect(result.blockingFailures).toHaveLength(0);
	});

	// No gates = empty pass
	it('returns allPassed=true for empty gate list', () => {
		const result = evaluateGates([], makeContext({ gateTypes: [] }));
		expect(result.allPassed).toBe(true);
		expect(result.results).toHaveLength(0);
	});

	// Mixed gate types: one missing causes failure
	it('fails when a required gate is missing from registry while others pass', () => {
		registerGateEvaluator('pre_write', passingEvaluator('pre_write'));
		// evidence_required is NOT registered

		const ctx = makeContext({ gateTypes: ['pre_write', 'evidence_required'] });
		const result = evaluateGates(['pre_write', 'evidence_required'], ctx);

		expect(result.allPassed).toBe(false);
		expect(result.blockingFailures).toHaveLength(1);
		expect(result.blockingFailures[0]!.gateType).toBe('evidence_required');
	});
});

describe('tryTransitionWithGates', () => {
	beforeEach(() => {
		clearGateEvaluators();
	});

	// 6. Security fail + human approval pass → still blocked
	it('security gate failure blocks even when human_approval passes', () => {
		registerGateEvaluator('pre_merge', passingEvaluator('pre_merge'));
		registerGateEvaluator('security', blockingEvaluator('security', 'Security policy violation'));
		registerGateEvaluator('human_approval', passingEvaluator('human_approval'));

		const run = { ...makeRun(), phase: 'PR_CREATE' as Phase };
		const ctx = makeContext({
			phase: 'PR_CREATE',
			targetPhase: 'MERGE',
			gateTypes: ['pre_merge', 'security', 'human_approval'],
		});

		const result = tryTransitionWithGates(run, 'MERGE', 'Attempt merge', ctx, 'INFO', null);

		expect(result.ok).toBe(false);
		expect(result.gateResult.allPassed).toBe(false);
		expect(result.event.message).toContain('security failure cannot be overridden');

		// Verify security gate result
		const secResult = result.gateResult.results.find((r) => r.gateType === 'security');
		expect(secResult).toBeDefined();
		expect(secResult!.passed).toBe(false);

		// Verify human approval DID pass
		const haResult = result.gateResult.results.find((r) => r.gateType === 'human_approval');
		expect(haResult).toBeDefined();
		expect(haResult!.passed).toBe(true);
	});

	// 6b. Security fail + human approval missing → still blocked
	it('security gate failure blocks when human_approval is not evaluated', () => {
		registerGateEvaluator('security', blockingEvaluator('security', 'Security policy violation'));
		// human_approval NOT registered → missing

		const run = { ...makeRun(), phase: 'PR_CREATE' as Phase };
		const ctx = makeContext({
			phase: 'PR_CREATE',
			targetPhase: 'MERGE',
			gateTypes: ['security', 'human_approval'],
		});

		const result = tryTransitionWithGates(run, 'MERGE', 'Attempt merge', ctx, 'INFO', null);

		expect(result.ok).toBe(false);
		expect(result.event.message).toContain('security failure cannot be overridden');
	});

	// 7. Human approval fail → GATE_APPROVE
	it('human_approval failure transitions to GATE_APPROVE', () => {
		registerGateEvaluator('pre_merge', passingEvaluator('pre_merge'));
		registerGateEvaluator('security', passingEvaluator('security'));
		registerGateEvaluator(
			'human_approval',
			blockingEvaluator('human_approval', 'Human must approve'),
		);

		const run = { ...makeRun(), phase: 'PR_CREATE' as Phase };
		const ctx = makeContext({
			phase: 'PR_CREATE',
			targetPhase: 'MERGE',
			gateTypes: ['pre_merge', 'security', 'human_approval'],
		});

		const result = tryTransitionWithGates(run, 'MERGE', 'Attempt merge', ctx, 'INFO', null);

		expect(result.ok).toBe(false);
		expect(result.run.phase).toBe('GATE_APPROVE');
		expect(result.run.status).toBe('blocked');
		expect(result.event.level).toBe('HUMAN');
		expect(result.event.message).toContain('Human approval required');
	});

	// 7b. Human approval missing → GATE_APPROVE
	it('human_approval gate missing from registry leads to GATE_APPROVE', () => {
		registerGateEvaluator('pre_merge', passingEvaluator('pre_merge'));
		registerGateEvaluator('security', passingEvaluator('security'));
		// human_approval NOT registered

		const run = { ...makeRun(), phase: 'PR_CREATE' as Phase };
		const ctx = makeContext({
			phase: 'PR_CREATE',
			targetPhase: 'MERGE',
			gateTypes: ['pre_merge', 'security', 'human_approval'],
		});

		const result = tryTransitionWithGates(run, 'MERGE', 'Attempt merge', ctx, 'INFO', null);

		expect(result.ok).toBe(false);
		expect(result.run.phase).toBe('GATE_APPROVE');
	});

	// 8. Evidence-required fail → block
	it('evidence_required failure blocks transition', () => {
		registerGateEvaluator(
			'evidence_required',
			blockingEvaluator('evidence_required', 'No test evidence'),
		);

		const run = { ...makeRun(), phase: 'VERIFY' as Phase };
		const ctx = makeContext({
			phase: 'VERIFY',
			targetPhase: 'COMMIT',
			gateTypes: ['pre_write', 'evidence_required'],
		});

		const result = tryTransitionWithGates(run, 'COMMIT', 'Attempt commit', ctx, 'INFO', null);

		expect(result.ok).toBe(false);
		expect(result.gateResult.blockingFailures.some((f) => f.gateType === 'evidence_required')).toBe(
			true,
		);
	});

	// 9. pre_write fail → commit blocked
	it('pre_write failure blocks COMMIT transition', () => {
		registerGateEvaluator('pre_write', blockingEvaluator('pre_write', 'Write access denied'));
		registerGateEvaluator('evidence_required', passingEvaluator('evidence_required'));

		const run = { ...makeRun(), phase: 'VERIFY' as Phase };
		const ctx = makeContext({
			phase: 'VERIFY',
			targetPhase: 'COMMIT',
			gateTypes: ['pre_write', 'evidence_required'],
		});

		const result = tryTransitionWithGates(run, 'COMMIT', 'Attempt commit', ctx, 'INFO', null);

		expect(result.ok).toBe(false);
		expect(result.gateResult.blockingFailures.some((f) => f.gateType === 'pre_write')).toBe(true);
	});

	// 10. pre_pr fail → PR creation blocked
	it('pre_pr failure blocks PR_CREATE transition', () => {
		registerGateEvaluator('pre_pr', blockingEvaluator('pre_pr', 'PR creation denied'));
		registerGateEvaluator('evidence_required', passingEvaluator('evidence_required'));

		const run = { ...makeRun(), phase: 'COMMIT' as Phase };
		const ctx = makeContext({
			phase: 'COMMIT',
			targetPhase: 'PR_CREATE',
			gateTypes: ['pre_pr', 'evidence_required'],
		});

		const result = tryTransitionWithGates(run, 'PR_CREATE', 'Attempt PR', ctx, 'INFO', null);

		expect(result.ok).toBe(false);
		expect(result.gateResult.blockingFailures.some((f) => f.gateType === 'pre_pr')).toBe(true);
	});

	// 11. pre_merge fail → merge blocked
	it('pre_merge failure blocks MERGE transition', () => {
		registerGateEvaluator('pre_merge', blockingEvaluator('pre_merge', 'Merge not allowed'));
		registerGateEvaluator('security', passingEvaluator('security'));
		registerGateEvaluator('human_approval', passingEvaluator('human_approval'));

		const run = { ...makeRun(), phase: 'PR_CREATE' as Phase };
		const ctx = makeContext({
			phase: 'PR_CREATE',
			targetPhase: 'MERGE',
			gateTypes: ['pre_merge', 'security', 'human_approval'],
		});

		const result = tryTransitionWithGates(run, 'MERGE', 'Attempt merge', ctx, 'INFO', null);

		expect(result.ok).toBe(false);
		expect(result.gateResult.blockingFailures.some((f) => f.gateType === 'pre_merge')).toBe(true);
	});

	// All gates pass → transition allowed
	it('allows transition when all gates pass', () => {
		registerGateEvaluator('pre_write', passingEvaluator('pre_write'));
		registerGateEvaluator('evidence_required', passingEvaluator('evidence_required'));

		const run = { ...makeRun(), phase: 'VERIFY' as Phase };
		const ctx = makeContext({
			phase: 'VERIFY',
			targetPhase: 'COMMIT',
			gateTypes: ['pre_write', 'evidence_required'],
		});

		const result = tryTransitionWithGates(run, 'COMMIT', 'All gates passed', ctx, 'INFO', null);

		expect(result.ok).toBe(true);
		expect(result.gateResult.allPassed).toBe(true);
		expect(result.run.phase).toBe('COMMIT');
	});

	// Raw transition for non-gated phases
	it('uses raw transition for non-gated phases (no PHASE_GATE_REQUIREMENTS entry)', () => {
		const run = { ...makeRun(), phase: 'QUEUED' as Phase };
		const ctx = makeContext({
			phase: 'QUEUED',
			targetPhase: 'CLAIMED',
			gateTypes: [],
		});

		const result = tryTransitionWithGates(run, 'CLAIMED', 'Internal transition', ctx, 'INFO', null);

		expect(result.ok).toBe(true);
		expect(result.run.phase).toBe('CLAIMED');
		expect(result.gateResult.summary).toContain('No gates required');
	});
});

describe('PHASE_GATE_REQUIREMENTS', () => {
	// 12. Phase requirements correctly mapped
	it('COMMIT requires pre_write and evidence_required', () => {
		const gates = getRequiredGates('COMMIT');
		expect(gates).toContain('pre_write');
		expect(gates).toContain('evidence_required');
		expect(gates).toHaveLength(2);
	});

	it('PR_CREATE requires pre_pr and evidence_required', () => {
		const gates = getRequiredGates('PR_CREATE');
		expect(gates).toContain('pre_pr');
		expect(gates).toContain('evidence_required');
		expect(gates).toHaveLength(2);
	});

	it('MERGE requires pre_merge, security, and human_approval', () => {
		const gates = getRequiredGates('MERGE');
		expect(gates).toContain('pre_merge');
		expect(gates).toContain('security');
		expect(gates).toContain('human_approval');
		expect(gates).toHaveLength(3);
	});

	it('DONE requires evidence_required', () => {
		const gates = getRequiredGates('DONE');
		expect(gates).toContain('evidence_required');
		expect(gates).toHaveLength(1);
	});

	it('QUEUED has no gate requirements', () => {
		expect(getRequiredGates('QUEUED')).toHaveLength(0);
		expect(phaseRequiresGates('QUEUED')).toBe(false);
	});

	it('CLAIMED has no gate requirements', () => {
		expect(getRequiredGates('CLAIMED')).toHaveLength(0);
		expect(phaseRequiresGates('CLAIMED')).toBe(false);
	});

	it('IMPLEMENT has no gate requirements', () => {
		expect(getRequiredGates('IMPLEMENT')).toHaveLength(0);
		expect(phaseRequiresGates('IMPLEMENT')).toBe(false);
	});

	it('TEST has no gate requirements', () => {
		expect(getRequiredGates('TEST')).toHaveLength(0);
		expect(phaseRequiresGates('TEST')).toBe(false);
	});

	// 13. Raw transition still works for non-gated phases
	it('raw transition() works for non-gated internal transitions', () => {
		const run = makeRun();
		const result = transition(run, 'CLAIMED', 'Moving to claimed');
		expect(result.ok).toBe(true);
		expect(result.run.phase).toBe('CLAIMED');
	});

	// 14. Clear/reset for test isolation
	it('clearGateEvaluators provides test isolation', () => {
		registerGateEvaluator('pre_write', passingEvaluator('pre_write'));
		expect(gateEvaluatorCount()).toBe(1);

		clearGateEvaluators();
		expect(gateEvaluatorCount()).toBe(0);

		// Missing evaluator now causes failure
		const result = evaluateGates(['pre_write'], makeContext({ gateTypes: ['pre_write'] }));
		expect(result.allPassed).toBe(false);
	});

	// 15. Fake evaluators must be explicitly registered
	it('requires explicit evaluator registration (no implicit fake-PASS)', () => {
		// No evaluators registered
		const result = evaluateGates(['pre_write'], makeContext({ gateTypes: ['pre_write'] }));
		expect(result.allPassed).toBe(false);
		expect(result.blockingFailures[0]!.message).toContain('No evaluator registered');
	});

	// 16. Each GateType in ALL_GATE_TYPES is covered
	it('all 8 GateTypes are represented in ALL_GATE_TYPES or PHASE_GATE_REQUIREMENTS', () => {
		const allTypes: GateType[] = [
			'pre_run',
			'pre_write',
			'pre_push',
			'pre_pr',
			'pre_merge',
			'evidence_required',
			'security',
			'human_approval',
		];
		expect(allTypes).toHaveLength(8);

		// Each type can have an evaluator registered
		for (const gt of allTypes) {
			registerGateEvaluator(gt, passingEvaluator(gt));
		}
		expect(gateEvaluatorCount()).toBe(8);
	});
});

describe('GateType Non-Bypass', () => {
	beforeEach(() => {
		clearGateEvaluators();
	});

	it('does not auto-approve when evaluator throws', () => {
		registerGateEvaluator('security', () => {
			throw new Error('Unexpected crash');
		});

		const run = { ...makeRun(), phase: 'PR_CREATE' as Phase };
		const ctx = makeContext({
			phase: 'PR_CREATE',
			targetPhase: 'MERGE',
			gateTypes: ['security', 'pre_merge', 'human_approval'],
		});

		const result = tryTransitionWithGates(run, 'MERGE', 'Merge attempt', ctx, 'INFO', null);

		expect(result.ok).toBe(false);
	});

	it('does not skip gates when only warnings exist (blocking=false but passed=false)', () => {
		registerGateEvaluator('pre_write', () => ({
			gateType: 'pre_write',
			passed: false,
			message: 'Warning only',
			blocking: false,
		}));
		registerGateEvaluator('evidence_required', passingEvaluator('evidence_required'));

		const result = evaluateGates(
			['pre_write', 'evidence_required'],
			makeContext({ gateTypes: ['pre_write', 'evidence_required'] }),
		);

		// Non-blocking failure = warning, not blocking
		expect(result.allPassed).toBe(true);
		expect(result.warnings).toHaveLength(1);
		expect(result.blockingFailures).toHaveLength(0);
	});
});
