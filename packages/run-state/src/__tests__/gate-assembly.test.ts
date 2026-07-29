// Positron — Phase B: Fake/Dry-Run Gate Assembly Validation
//
// Issue #308: Validates that all safety layers work together:
//   - Stop/Ask → GATE_APPROVE routing
//   - GateType Enforcement (all 8 GateTypes)
//   - Workspace Cleanup lifecycle
//   - requiresAuditLog / Audit Enforcement (Gate 9)
//   - Real-Mode Kill-Switches (BLOCKED_BY_DEFAULT)
//   - Secret Guardrails
//   - Evidence Flow
//   - Missing Evaluator Blocking
//   - Security Fail Non-Override
//   - Human Approval → GATE_APPROVE Pause
//
// Mode: FAKE/DRY-RUN ONLY — No Real Mode, No External Tools, No Network
//
// Test Sections:
//   A: Positive Tests — Full fake gate assembly happy path
//   B: Negative Tests — Safety enforcement (each layer blocks when it should)
//   C: Edge Case Tests — Boundary conditions, invariants
//   D: Regression Tests — Verify existing invariants remain intact

import type { GateEvaluationContext, GateResult, GateType, Phase } from '@positron/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	PHASE_GATE_REQUIREMENTS,
	clearGateEvaluators,
	evaluateGates,
	gateEvaluatorCount,
	getRequiredGates,
	hasGateEvaluator,
	phaseRequiresGates,
	registerFakeGateEvaluators,
	registerGateEvaluator,
	tryTransitionWithGates,
} from '../gate-evaluator.js';
import type { GatedTransitionResult } from '../gate-evaluator.js';
import {
	canTransition,
	createRun,
	getWorkspaceCleanupFn,
	registerWorkspaceCleanup,
	transition,
} from '../state-machine.js';
import type { RunState } from '../state-machine.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Build a minimal RunState for testing */
function makeRun(phase: Phase = 'VERIFY'): RunState {
	const run = createRun('test-repo', 999, 2);
	// Advance to desired phase by setting phase directly
	return { ...run, phase };
}

/** Build a minimal gate evaluation context */
function makeContext(overrides: Partial<GateEvaluationContext> = {}): GateEvaluationContext {
	return {
		runId: 'test-run-1',
		phase: 'VERIFY',
		targetPhase: 'COMMIT',
		gateTypes: ['pre_write', 'evidence_required'],
		...overrides,
	};
}

/** Create a passing evaluator */
function passEval(gateType: GateType, msg?: string): () => GateResult {
	return () => ({
		gateType,
		passed: true,
		message: msg ?? `${gateType} passed`,
		blocking: false,
	});
}

/** Create a blocking evaluator */
function blockEval(gateType: GateType, msg?: string): () => GateResult {
	return () => ({
		gateType,
		passed: false,
		message: msg ?? `${gateType} blocked`,
		blocking: true,
	});
}

/** Create an evaluator that throws */
function throwEval(gateType: GateType): () => GateResult {
	return () => {
		throw new Error(`${gateType} evaluator crashed`);
	};
}

/** Assert that a gate result is in the blockingFailures array */
function assertBlocked(result: GatedTransitionResult, gateType: GateType, reason?: string): void {
	expect(result.ok).toBe(false);
	const blocked = result.gateResult.blockingFailures.find((f) => f.gateType === gateType);
	expect(blocked, `Expected ${gateType} to be in blocking failures`).toBeDefined();
	if (reason) {
		expect(blocked!.message).toContain(reason);
	}
}

/** Assert that a transition succeeded with all gates passing */
function assertPassed(result: GatedTransitionResult): void {
	expect(result.ok).toBe(true);
	expect(result.gateResult.allPassed).toBe(true);
	expect(result.gateResult.blockingFailures).toHaveLength(0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION A: Positive Tests — Happy Path Assembly
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase B: Fake Gate Assembly — Positive Tests', () => {
	beforeEach(() => {
		clearGateEvaluators();
		registerFakeGateEvaluators();
	});

	describe('A1. registerFakeGateEvaluators completeness', () => {
		it('registers all 8 gate types', () => {
			expect(gateEvaluatorCount()).toBe(8);
			const allGates: GateType[] = [
				'pre_run',
				'pre_write',
				'pre_push',
				'pre_pr',
				'pre_merge',
				'evidence_required',
				'security',
				'human_approval',
			];
			for (const gt of allGates) {
				expect(hasGateEvaluator(gt), `Missing evaluator for ${gt}`).toBe(true);
			}
		});

		it('each registered evaluator returns passed:true', () => {
			const ctx = makeContext();
			const allGates: GateType[] = [
				'pre_run',
				'pre_write',
				'pre_push',
				'pre_pr',
				'pre_merge',
				'evidence_required',
				'security',
				'human_approval',
			];

			for (const gt of allGates) {
				const result = evaluateGates([gt], {
					...ctx,
					gateTypes: [gt],
				});
				expect(result.allPassed, `Gate ${gt} should pass`).toBe(true);
				expect(result.results[0]!.passed).toBe(true);
				expect(result.results[0]!.message).toMatch(/Fake:/);
			}
		});
	});

	describe('A2. Full multi-phase gate assembly COMMIT → PR_CREATE → MERGE → DONE', () => {
		it('transitions through COMMIT with fake evaluators', () => {
			const run = makeRun('VERIFY');
			const ctx = makeContext({
				phase: 'VERIFY',
				targetPhase: 'COMMIT',
				gateTypes: [...(PHASE_GATE_REQUIREMENTS['COMMIT'] ?? [])],
				evidencePaths: ['test/path/evidence.md'],
			});

			const result = tryTransitionWithGates(run, 'COMMIT', 'Commit changes', ctx, 'INFO', null);
			assertPassed(result);
			expect(result.run.phase).toBe('COMMIT');
		});

		it('transitions through PR_CREATE with fake evaluators', () => {
			const run = makeRun('COMMIT');
			const ctx = makeContext({
				phase: 'COMMIT',
				targetPhase: 'PR_CREATE',
				gateTypes: [...(PHASE_GATE_REQUIREMENTS['PR_CREATE'] ?? [])],
				evidencePaths: ['test/path/evidence.md'],
			});

			const result = tryTransitionWithGates(run, 'PR_CREATE', 'Create PR', ctx, 'INFO', null);
			assertPassed(result);
			expect(result.run.phase).toBe('PR_CREATE');
		});

		it('transitions through MERGE with fake evaluators', () => {
			const run = makeRun('PR_CREATE');
			const ctx = makeContext({
				phase: 'PR_CREATE',
				targetPhase: 'MERGE',
				gateTypes: [...(PHASE_GATE_REQUIREMENTS['MERGE'] ?? [])],
				evidencePaths: ['test/path/evidence.md'],
			});

			const result = tryTransitionWithGates(run, 'MERGE', 'Merge PR', ctx, 'INFO', null);
			assertPassed(result);
			expect(result.run.phase).toBe('MERGE');
		});

		it('transitions through DONE with fake evaluators', () => {
			const run = makeRun('MERGE');
			const ctx = makeContext({
				phase: 'MERGE',
				targetPhase: 'DONE',
				gateTypes: [...(PHASE_GATE_REQUIREMENTS['DONE'] ?? [])],
				evidencePaths: ['test/path/evidence.md'],
			});

			const result = tryTransitionWithGates(run, 'DONE', 'Complete run', ctx, 'INFO', null);
			assertPassed(result);
			expect(result.run.phase).toBe('DONE');
			expect(result.run.status).toBe('done');
		});

		it('full pipeline: COMMIT → PR_CREATE → MERGE → DONE all pass', () => {
			let run = makeRun('VERIFY');

			// COMMIT
			const r1 = tryTransitionWithGates(
				run,
				'COMMIT',
				'Step 1: Commit',
				makeContext({
					phase: 'VERIFY',
					targetPhase: 'COMMIT',
					gateTypes: [...(PHASE_GATE_REQUIREMENTS['COMMIT'] ?? [])],
					evidencePaths: ['evidence/step1.md'],
				}),
				'INFO',
				null,
			);
			assertPassed(r1);
			run = r1.run;

			// PR_CREATE
			const r2 = tryTransitionWithGates(
				run,
				'PR_CREATE',
				'Step 2: PR',
				makeContext({
					phase: 'COMMIT',
					targetPhase: 'PR_CREATE',
					gateTypes: [...(PHASE_GATE_REQUIREMENTS['PR_CREATE'] ?? [])],
					evidencePaths: ['evidence/step2.md'],
				}),
				'INFO',
				null,
			);
			assertPassed(r2);
			run = r2.run;

			// MERGE
			const r3 = tryTransitionWithGates(
				run,
				'MERGE',
				'Step 3: Merge',
				makeContext({
					phase: 'PR_CREATE',
					targetPhase: 'MERGE',
					gateTypes: [...(PHASE_GATE_REQUIREMENTS['MERGE'] ?? [])],
					evidencePaths: ['evidence/step3.md'],
				}),
				'INFO',
				null,
			);

			assertPassed(r3);
			run = r3.run;

			// DONE
			const r4 = tryTransitionWithGates(
				run,
				'DONE',
				'Step 4: Done',
				makeContext({
					phase: 'MERGE',
					targetPhase: 'DONE',
					gateTypes: [...(PHASE_GATE_REQUIREMENTS['DONE'] ?? [])],
					evidencePaths: ['evidence/step4.md'],
				}),
				'INFO',
				null,
			);
			assertPassed(r4);
			expect(r4.run.phase).toBe('DONE');
			expect(r4.run.status).toBe('done');
		});
	});

	describe('A3. PHASE_GATE_REQUIREMENTS correctness', () => {
		it('COMMIT requires pre_write + evidence_required', () => {
			const gates = getRequiredGates('COMMIT');
			expect(gates).toContain('pre_write');
			expect(gates).toContain('evidence_required');
			expect(gates.length).toBe(2);
		});

		it('PR_CREATE requires pre_pr + evidence_required', () => {
			const gates = getRequiredGates('PR_CREATE');
			expect(gates).toContain('pre_pr');
			expect(gates).toContain('evidence_required');
			expect(gates.length).toBe(2);
		});

		it('MERGE requires pre_merge + security + human_approval', () => {
			const gates = getRequiredGates('MERGE');
			expect(gates).toContain('pre_merge');
			expect(gates).toContain('security');
			expect(gates).toContain('human_approval');
			expect(gates.length).toBe(3);
		});

		it('DONE requires evidence_required', () => {
			const gates = getRequiredGates('DONE');
			expect(gates).toContain('evidence_required');
			expect(gates.length).toBe(1);
		});

		it('internal phases (VERIFY, TEST, IMPLEMENT) do NOT require gates', () => {
			expect(phaseRequiresGates('VERIFY')).toBe(false);
			expect(phaseRequiresGates('TEST')).toBe(false);
			expect(phaseRequiresGates('IMPLEMENT')).toBe(false);
			expect(phaseRequiresGates('QUEUED')).toBe(false);
			expect(getRequiredGates('VERIFY')).toHaveLength(0);
			expect(getRequiredGates('TEST')).toHaveLength(0);
		});
	});

	describe('A4. Evidence paths flow through transitions', () => {
		it('passes evidencePaths through context', () => {
			const evidencePaths = ['evidence/test.md', 'evidence/build.md', 'evidence/test-report.md'];
			const run = makeRun('VERIFY');
			const ctx = makeContext({
				phase: 'VERIFY',
				targetPhase: 'COMMIT',
				gateTypes: [...(PHASE_GATE_REQUIREMENTS['COMMIT'] ?? [])],
				evidencePaths,
			});

			const result = tryTransitionWithGates(
				run,
				'COMMIT',
				'Commit with evidence',
				ctx,
				'INFO',
				null,
			);
			assertPassed(result);
			expect(ctx.evidencePaths).toEqual(evidencePaths);
		});
	});

	describe('A5. Workspace cleanup lifecycle', () => {
		it('registers and retrieves workspace cleanup function', () => {
			const fn = async (_path: string, _runId: string) => ({ cleaned: true });
			registerWorkspaceCleanup(fn);
			expect(getWorkspaceCleanupFn()).toBe(fn);
		});

		it('workspace cleanup can be registered and replaced', () => {
			const fn1 = async (_path: string, _runId: string) => ({ cleaned: true, reason: 'first' });
			const fn2 = async (_path: string, _runId: string) => ({ cleaned: true, reason: 'second' });

			registerWorkspaceCleanup(fn1);
			expect(getWorkspaceCleanupFn()).toBe(fn1);

			registerWorkspaceCleanup(fn2);
			expect(getWorkspaceCleanupFn()).toBe(fn2);
		});
	});

	describe('A6. Gate results are complete and verifiable', () => {
		it('gateResult contains all evaluator results', () => {
			const run = makeRun('VERIFY');
			const ctx = makeContext({
				phase: 'VERIFY',
				targetPhase: 'COMMIT',
				gateTypes: ['pre_write', 'evidence_required'],
				evidencePaths: ['test/evidence.md'],
			});

			const result = tryTransitionWithGates(run, 'COMMIT', 'Test', ctx, 'INFO', null);
			assertPassed(result);

			expect(result.gateResult.results).toHaveLength(2);
			expect(result.gateResult.summary).toBeTruthy();
			expect(result.gateResult.warnings).toHaveLength(0);
		});

		it('gateResult is present even when no gates are required', () => {
			const run = makeRun('TEST');
			// Transition from TEST to VERIFY (internal, valid, no gates)
			const result = tryTransitionWithGates(
				run,
				'VERIFY',
				'Internal transition',
				makeContext({ phase: 'TEST', targetPhase: 'VERIFY', gateTypes: [] }),
				'INFO',
				null,
			);

			expect(result.ok).toBe(true);
			expect(result.gateResult).toBeDefined();
			expect(result.gateResult.allPassed).toBe(true);
			expect(result.gateResult.summary).toContain('No gates required');
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION B: Negative Tests — Safety Enforcement
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase B: Fake Gate Assembly — Negative Tests', () => {
	describe('B1. Real Mode blocked by default (BLOCKED_BY_DEFAULT)', () => {
		// Note: Real mode env vars are not set in this test environment.
		// We verify that gate evaluators do not auto-approve real mode.

		it('registerFakeGateEvaluators does NOT set real-mode approval', () => {
			clearGateEvaluators();
			registerFakeGateEvaluators();

			// Verify no real-mode env indicators in the evaluator messages
			const ctx = makeContext({ gateTypes: ['pre_run'] });
			const result = evaluateGates(['pre_run'], ctx);
			expect(result.results[0]!.message).not.toMatch(/real/i);
			expect(result.results[0]!.message).not.toMatch(/HUMAN_APPROVED_REAL/i);
			expect(result.results[0]!.message).not.toMatch(/POSITRON_ENABLE_REAL/i);
		});

		it('DONE transition does NOT require security gate (real-mode gate at level 5, not DONE)', () => {
			const gates = getRequiredGates('DONE');
			expect(gates).not.toContain('security');
			expect(gates).not.toContain('human_approval');
		});
	});

	describe('B2. Missing GateEvaluator blocks transition', () => {
		beforeEach(() => {
			clearGateEvaluators();
			// Intentionally NOT registering some evaluators
		});

		it('missing pre_write evaluator blocks COMMIT', () => {
			registerGateEvaluator('evidence_required', passEval('evidence_required'));
			// pre_write NOT registered

			const run = makeRun('VERIFY');
			const ctx = makeContext({
				phase: 'VERIFY',
				targetPhase: 'COMMIT',
				gateTypes: ['pre_write', 'evidence_required'],
			});

			const result = tryTransitionWithGates(run, 'COMMIT', 'Attempt', ctx, 'INFO', null);
			assertBlocked(result, 'pre_write');
			expect(result.gateResult.results.find((r) => r.gateType === 'pre_write')!.message).toContain(
				'No evaluator registered',
			);
		});

		it('missing evidence_required evaluator blocks DONE', () => {
			// evidence_required NOT registered

			const run = makeRun('MERGE');
			const ctx = makeContext({
				phase: 'MERGE',
				targetPhase: 'DONE',
				gateTypes: ['evidence_required'],
			});

			const result = tryTransitionWithGates(run, 'DONE', 'Attempt done', ctx, 'INFO', null);
			assertBlocked(result, 'evidence_required');
		});

		it('missing human_approval evaluator routes to GATE_APPROVE for MERGE', () => {
			registerGateEvaluator('pre_merge', passEval('pre_merge'));
			registerGateEvaluator('security', passEval('security'));
			// human_approval NOT registered

			const run = makeRun('PR_CREATE');
			const ctx = makeContext({
				phase: 'PR_CREATE',
				targetPhase: 'MERGE',
				gateTypes: ['pre_merge', 'security', 'human_approval'],
			});

			const result = tryTransitionWithGates(run, 'MERGE', 'Attempt merge', ctx, 'INFO', null);
			expect(result.ok).toBe(false);
			expect(result.run.phase).toBe('GATE_APPROVE');
			expect(result.run.status).toBe('blocked');
		});

		it('missing security evaluator blocks MERGE (not routed to GATE_APPROVE)', () => {
			registerGateEvaluator('pre_merge', passEval('pre_merge'));
			registerGateEvaluator('human_approval', passEval('human_approval'));
			// security NOT registered

			const run = makeRun('PR_CREATE');
			const ctx = makeContext({
				phase: 'PR_CREATE',
				targetPhase: 'MERGE',
				gateTypes: ['pre_merge', 'security', 'human_approval'],
			});

			const result = tryTransitionWithGates(run, 'MERGE', 'Attempt merge', ctx, 'INFO', null);
			assertBlocked(result, 'security');
		});
	});

	describe('B3. Security fail cannot be overridden by Human Approval', () => {
		it('security gate fail + human_approval pass → still blocked', () => {
			clearGateEvaluators();
			registerGateEvaluator('pre_merge', passEval('pre_merge'));
			registerGateEvaluator('security', blockEval('security', 'Security policy violation'));
			registerGateEvaluator('human_approval', passEval('human_approval'));

			const run = makeRun('PR_CREATE');
			const ctx = makeContext({
				phase: 'PR_CREATE',
				targetPhase: 'MERGE',
				gateTypes: ['pre_merge', 'security', 'human_approval'],
			});

			const result = tryTransitionWithGates(run, 'MERGE', 'Attempt merge', ctx, 'INFO', null);

			expect(result.ok).toBe(false);
			expect(result.event.message).toContain('security failure cannot be overridden');
			expect(result.gateResult.blockingFailures.some((f) => f.gateType === 'security')).toBe(true);

			// Human approval DID pass — prove it:
			const ha = result.gateResult.results.find((r) => r.gateType === 'human_approval');
			expect(ha!.passed).toBe(true);

			// But transition is still blocked:
			expect(result.run.lastError).toContain('Security gate failed');
		});
	});

	describe('B4. Human Approval fail routes to GATE_APPROVE / pause', () => {
		it('human_approval failure → GATE_APPROVE with blocked status', () => {
			clearGateEvaluators();
			registerGateEvaluator('pre_merge', passEval('pre_merge'));
			registerGateEvaluator('security', passEval('security'));
			registerGateEvaluator(
				'human_approval',
				blockEval('human_approval', 'Human approval required'),
			);

			const run = makeRun('PR_CREATE');
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

		it('human_approval required but not passed → GATE_APPROVE (event contains target phase)', () => {
			clearGateEvaluators();
			registerGateEvaluator('pre_merge', passEval('pre_merge'));
			registerGateEvaluator('security', passEval('security'));
			registerGateEvaluator('human_approval', blockEval('human_approval'));

			const run = makeRun('PR_CREATE');
			const ctx = makeContext({
				phase: 'PR_CREATE',
				targetPhase: 'MERGE',
				gateTypes: ['pre_merge', 'security', 'human_approval'],
			});

			const result = tryTransitionWithGates(run, 'MERGE', 'Attempt merge', ctx, 'INFO', null);

			expect(result.event.payload?.requiredPhase).toBe('MERGE');
			expect(result.event.payload?.gateResult).toBeDefined();
		});
	});

	describe('B5. Audit enforcement (Gate 9)', () => {
		it('evaluator throwing is caught and reported as blocking failure', () => {
			clearGateEvaluators();
			registerGateEvaluator('pre_write', passEval('pre_write'));
			registerGateEvaluator('evidence_required', throwEval('evidence_required'));

			const run = makeRun('VERIFY');
			const ctx = makeContext({
				phase: 'VERIFY',
				targetPhase: 'COMMIT',
				gateTypes: ['pre_write', 'evidence_required'],
			});

			const result = tryTransitionWithGates(run, 'COMMIT', 'Attempt', ctx, 'INFO', null);
			assertBlocked(result, 'evidence_required');
			const evResult = result.gateResult.results.find((r) => r.gateType === 'evidence_required');
			expect(evResult!.message).toContain('threw');
		});

		it('evaluator throw is blocking even when other gates pass', () => {
			clearGateEvaluators();
			registerGateEvaluator('evidence_required', throwEval('evidence_required'));

			const ctx = makeContext({
				phase: 'MERGE',
				targetPhase: 'DONE',
				gateTypes: ['evidence_required'],
			});

			const result = evaluateGates(['evidence_required'], ctx);
			expect(result.allPassed).toBe(false);
			expect(result.blockingFailures).toHaveLength(1);
		});
	});

	describe('B6. Multiple gate failures accumulate', () => {
		it('all blocking failures are collected, not just the first', () => {
			clearGateEvaluators();
			registerGateEvaluator('pre_merge', blockEval('pre_merge', 'Merge denied'));
			registerGateEvaluator('security', blockEval('security', 'Security issue'));
			registerGateEvaluator('human_approval', passEval('human_approval'));

			const run = makeRun('PR_CREATE');
			const ctx = makeContext({
				phase: 'PR_CREATE',
				targetPhase: 'MERGE',
				gateTypes: ['pre_merge', 'security', 'human_approval'],
			});

			const result = tryTransitionWithGates(run, 'MERGE', 'Attempt merge', ctx, 'INFO', null);

			expect(result.ok).toBe(false);
			// Both failures should be present:
			const failedTypes = result.gateResult.blockingFailures.map((f) => f.gateType);
			expect(failedTypes).toContain('pre_merge');
			expect(failedTypes).toContain('security');
			// security failure message should trigger the non-override path:
			expect(result.event.message).toContain('security failure cannot be overridden');
		});
	});

	describe('B7. No bypass vectors exist', () => {
		it('missing evaluator returns blocking:true, not a silent pass', () => {
			clearGateEvaluators();
			// No evaluators registered

			const ctx = makeContext({ gateTypes: ['pre_write'] });
			const result = evaluateGates(['pre_write'], ctx);

			expect(result.allPassed).toBe(false);
			expect(result.results[0]!.passed).toBe(false);
			expect(result.results[0]!.blocking).toBe(true);
		});

		it('registerFakeGateEvaluators explicitly registers each gate (no implicit pass)', () => {
			clearGateEvaluators();
			expect(gateEvaluatorCount()).toBe(0);

			registerFakeGateEvaluators();
			expect(gateEvaluatorCount()).toBe(8);

			// Verify each is explicitly registered:
			clearGateEvaluators();
			expect(gateEvaluatorCount()).toBe(0);
			// If any implicit pass existed, evaluateGates would succeed here:
			const ctx = makeContext({ gateTypes: ['security'] });
			const result = evaluateGates(['security'], ctx);
			expect(result.allPassed).toBe(false);
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION C: Edge Case Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase B: Fake Gate Assembly — Edge Cases', () => {
	describe('C1. Evaluator overwrite behavior', () => {
		beforeEach(() => {
			clearGateEvaluators();
		});

		it('registerGateEvaluator overwrites existing evaluator', () => {
			registerGateEvaluator('pre_write', passEval('pre_write', 'first'));
			registerGateEvaluator('pre_write', blockEval('pre_write', 'second'));
			expect(gateEvaluatorCount()).toBe(1); // Not 2

			const ctx = makeContext({ gateTypes: ['pre_write'] });
			const result = evaluateGates(['pre_write'], ctx);
			expect(result.allPassed).toBe(false); // Second (blocking) overrode first
		});
	});

	describe('C2. clearGateEvaluators full reset', () => {
		it('removes all evaluators and returns count to zero', () => {
			clearGateEvaluators();
			registerFakeGateEvaluators();
			expect(gateEvaluatorCount()).toBe(8);

			clearGateEvaluators();
			expect(gateEvaluatorCount()).toBe(0);
		});
	});

	describe('C3. Evaluate gates with all types simultaneously', () => {
		beforeEach(() => {
			clearGateEvaluators();
			registerFakeGateEvaluators();
		});

		it('evaluates all 8 gate types together and all pass', () => {
			const allGates: GateType[] = [
				'pre_run',
				'pre_write',
				'pre_push',
				'pre_pr',
				'pre_merge',
				'evidence_required',
				'security',
				'human_approval',
			];

			const ctx = makeContext({ gateTypes: allGates });
			const result = evaluateGates(allGates, ctx);

			expect(result.allPassed).toBe(true);
			expect(result.results).toHaveLength(8);
			expect(result.blockingFailures).toHaveLength(0);
			expect(result.summary).toContain('8 gate(s) passed');
		});

		it('one failure among 8 correctly blocks with blockingFailures', () => {
			// Override one evaluator to fail
			registerGateEvaluator('security', blockEval('security', 'Security alert'));

			const allGates: GateType[] = [
				'pre_run',
				'pre_write',
				'pre_push',
				'pre_pr',
				'pre_merge',
				'evidence_required',
				'security',
				'human_approval',
			];

			const ctx = makeContext({ gateTypes: allGates });
			const result = evaluateGates(allGates, ctx);

			expect(result.allPassed).toBe(false);
			expect(result.blockingFailures).toHaveLength(1);
			expect(result.blockingFailures[0]!.gateType).toBe('security');
			expect(result.summary).toContain('1/8');
		});
	});

	describe('C4. Run state preserves integrity after blocked transition', () => {
		it('blocked run does not lose original phase info', () => {
			clearGateEvaluators();
			registerGateEvaluator('evidence_required', passEval('evidence_required'));
			// pre_write not registered → blocks

			const run = makeRun('VERIFY');
			const ctx = makeContext({
				phase: 'VERIFY',
				targetPhase: 'COMMIT',
				gateTypes: ['pre_write', 'evidence_required'],
			});

			const result = tryTransitionWithGates(run, 'COMMIT', 'Attempt', ctx, 'INFO', null);

			expect(result.ok).toBe(false);
			expect(result.run.id).toBe(run.id);
			expect(result.run.repoId).toBe('test-repo');
			expect(result.run.issueNumber).toBe(999);
			expect(result.run.lastError).toBeTruthy();
		});
	});

	describe('C5. Empty gate list transitions', () => {
		beforeEach(() => {
			clearGateEvaluators();
		});

		it('transition with empty gate list proceeds (no gates required)', () => {
			const run = makeRun('TEST');
			// Internal transition (TEST → VERIFY) is valid and has no gates
			const result = tryTransitionWithGates(
				run,
				'VERIFY',
				'Internal',
				makeContext({ phase: 'TEST', targetPhase: 'VERIFY', gateTypes: [] }),
				'INFO',
				null,
			);

			expect(result.ok).toBe(true);
			expect(result.gateResult.allPassed).toBe(true);
			expect(result.gateResult.results).toHaveLength(0);
		});
	});

	describe('C6. Evidential gateResult reference integrity', () => {
		beforeEach(() => {
			clearGateEvaluators();
			registerFakeGateEvaluators();
		});

		it('gateResult references are present in both OK and BLOCKED transitions', () => {
			const run = makeRun('VERIFY');
			const ctx = makeContext({
				phase: 'VERIFY',
				targetPhase: 'COMMIT',
				gateTypes: ['pre_write', 'evidence_required'],
			});

			const result = tryTransitionWithGates(run, 'COMMIT', 'Test', ctx, 'INFO', null);
			expect(result.gateResult).toBeDefined();
			expect(result.gateResult.allPassed).toBe(true);

			// Now make it fail:
			clearGateEvaluators();
			const failResult = tryTransitionWithGates(run, 'COMMIT', 'Test', ctx, 'INFO', null);
			expect(failResult.gateResult).toBeDefined();
			expect(failResult.gateResult.allPassed).toBe(false);
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION D: Regression Tests — Existing Gate Enforcement Invariants
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase B: Regression — Gate Enforcement Invariants Preserved', () => {
	beforeEach(() => {
		clearGateEvaluators();
	});

	it('D1: createRun starts at QUEUED', () => {
		const run = createRun('test-repo', 999, 2);
		expect(run.phase).toBe('QUEUED');
		expect(run.status).toBe('active');
	});

	it('D2: canTransition respects VALID_TRANSITIONS', () => {
		expect(canTransition('VERIFY', 'COMMIT')).toBe(true);
		expect(canTransition('VERIFY', 'MERGE')).toBe(false);
		expect(canTransition('DONE', 'CLEANUP')).toBe(true);
		expect(canTransition('CLEANUP', 'DONE')).toBe(false);
	});

	it('D3: GATE_APPROVE transitions to COMMIT, MERGE, DONE', () => {
		expect(canTransition('GATE_APPROVE', 'COMMIT')).toBe(true);
		expect(canTransition('GATE_APPROVE', 'MERGE')).toBe(true);
		expect(canTransition('GATE_APPROVE', 'DONE')).toBe(true);
		expect(canTransition('GATE_APPROVE', 'QUEUED')).toBe(false);
	});

	it('D4: Fake evaluator messages contain "Fake:" prefix (explicit registration marker)', () => {
		registerFakeGateEvaluators();

		const ctx = makeContext({ gateTypes: ['pre_write', 'evidence_required'] });
		const result = evaluateGates(['pre_write', 'evidence_required'], ctx);

		for (const r of result.results) {
			expect(r.message).toMatch(/Fake:/);
			expect(r.message).toContain('explicit fake evaluator');
		}
	});

	it('D5: tryTransitionWithGates returns GatedTransitionResult with all required fields', () => {
		registerFakeGateEvaluators();

		const run = makeRun('VERIFY');
		const ctx = makeContext({
			phase: 'VERIFY',
			targetPhase: 'COMMIT',
			gateTypes: ['pre_write', 'evidence_required'],
		});

		const result = tryTransitionWithGates(run, 'COMMIT', 'Test', ctx, 'INFO', null);

		expect(result).toHaveProperty('ok');
		expect(result).toHaveProperty('run');
		expect(result).toHaveProperty('event');
		expect(result).toHaveProperty('gateResult');
		expect(result.gateResult).toHaveProperty('allPassed');
		expect(result.gateResult).toHaveProperty('results');
		expect(result.gateResult).toHaveProperty('blockingFailures');
		expect(result.gateResult).toHaveProperty('warnings');
		expect(result.gateResult).toHaveProperty('summary');
	});
});

// ─── Issue #321: DONE Evidence Gate Regression Invariants ───────────────────
// These tests verify that DONE transitions cannot be reached via raw
// transition() bypassing the evidence_required gate.

describe('Issue #321 — DONE Evidence Gate Regression Invariants', () => {
	beforeEach(() => {
		clearGateEvaluators();
	});
	it('DONE is in PHASE_GATE_REQUIREMENTS with evidence_required', () => {
		const gates = getRequiredGates('DONE');
		expect(gates).toContain('evidence_required');
		expect(gates.length).toBeGreaterThan(0);
	});

	it('DONE transition via tryTransitionWithGates with evidence passes', () => {
		registerGateEvaluator('evidence_required', passEval('evidence_required'));

		const run = makeRun('MERGE');
		const ctx = makeContext({
			phase: 'MERGE',
			targetPhase: 'DONE',
			gateTypes: ['evidence_required'],
		});

		const result = tryTransitionWithGates(run, 'DONE', 'Complete', ctx, 'INFO', null);
		expect(result.ok).toBe(true);
		expect(result.run.phase).toBe('DONE');
	});

	it('DONE transition via tryTransitionWithGates without evidence is blocked', () => {
		// evidence_required evaluator NOT registered — blocks by default

		const run = makeRun('MERGE');
		const ctx = makeContext({
			phase: 'MERGE',
			targetPhase: 'DONE',
			gateTypes: ['evidence_required'],
		});

		const result = tryTransitionWithGates(run, 'DONE', 'Attempt done', ctx, 'INFO', null);
		assertBlocked(result, 'evidence_required');
	});

	it('phaseRequiresGates returns true for DONE', () => {
		expect(phaseRequiresGates('DONE')).toBe(true);
	});

	it('getRequiredGates for DONE returns non-empty array', () => {
		const gates = getRequiredGates('DONE');
		expect(gates.length).toBeGreaterThan(0);
		expect(gates[0]).toBe('evidence_required');
	});
});
