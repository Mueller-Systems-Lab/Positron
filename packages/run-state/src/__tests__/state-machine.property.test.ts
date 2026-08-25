/**
 * State Machine Property-Based Tests (QA-024)
 *
 * Systematically verifies central invariants of the Positron state machine
 * against randomly generated inputs using fast-check.
 *
 * Invariants tested:
 *  1. VALID_TRANSITIONS consistency with canTransition/transition
 *  2. Terminal phases are truly terminal
 *  3. Failure phase classification is correct
 *  4. Invalid transitions don't silently corrupt run state
 *  5. Valid transitions set target phase correctly
 *  6. Retry only works from FAILED_TRANSIENT
 *  7. markFailed always produces a failure phase
 *  8. No transition chain skips forbidden edges
 *
 * Generators produce no real secrets. All values are synthetic fakes.
 */

import type { RunEventData, RunState } from '@positron/run-state';
import {
	canTransition,
	createRun,
	isFailurePhase,
	isTerminalPhase,
	markFailed,
	resumeFromEvents,
	retry,
	transition,
	VALID_TRANSITIONS,
} from '@positron/run-state';
import type { Phase } from '@positron/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

// =========================================================================
// Generators (Phase 4)
// =========================================================================

/** All 28 phases as a constant array for generators */
const ALL_PHASES: Phase[] = Object.keys(VALID_TRANSITIONS) as Phase[];

/** Arbitrary: any valid phase */
const phaseArb = fc.constantFrom(...ALL_PHASES);

/** Arbitrary: non-terminal phase (has at least one non-CLEANUP outgoing transition) */
const nonTerminalPhaseArb = fc.constantFrom(
	...ALL_PHASES.filter((p) => {
		const targets = VALID_TRANSITIONS[p] as readonly Phase[];
		// #244: Phases that only go to CLEANUP are terminal
		return targets.some((t) => t !== 'CLEANUP');
	}),
);

/** Arbitrary: terminal phase (no outgoing transitions, or only to CLEANUP) */
const terminalPhaseArb = fc.constantFrom(
	...ALL_PHASES.filter((p) => {
		const targets = VALID_TRANSITIONS[p] as readonly Phase[];
		// #244: Phases with only CLEANUP transition are still terminal
		if (targets.length === 0) return true;
		if (targets.length === 1 && targets[0] === 'CLEANUP') return true;
		return false;
	}),
);

/** Arbitrary: failure phase */
const failurePhaseArb = fc.constantFrom<
	'FAILED' | 'FAILED_TRANSIENT' | 'FAILED_BLOCKED' | 'FAILED_UNSAFE'
>('FAILED', 'FAILED_TRANSIENT', 'FAILED_BLOCKED', 'FAILED_UNSAFE');

/** Arbitrary: a valid (from, to) pair */
const validTransitionArb = fc
	.constantFrom(...ALL_PHASES)
	.chain((from) => {
		const targets = VALID_TRANSITIONS[from] as readonly Phase[];
		if (targets.length === 0) return fc.constant(null);
		return fc.tuple(fc.constant(from), fc.constantFrom(...targets));
	})
	.filter((t): t is [Phase, Phase] => t !== null);

/** Arbitrary: an invalid (from, to) pair */
const invalidTransitionArb = fc
	.constantFrom(...ALL_PHASES)
	.chain((from) => {
		const allowed = new Set(VALID_TRANSITIONS[from] as readonly Phase[]);
		const forbidden = ALL_PHASES.filter((p) => !allowed.has(p));
		if (forbidden.length === 0) return fc.constant(null);
		return fc.tuple(fc.constant(from), fc.constantFrom(...forbidden));
	})
	.filter((t): t is [Phase, Phase] => t !== null);

/** Arbitrary: a complete RunState with random phase */
const runStateArb: fc.Arbitrary<RunState> = fc.record({
	id: fc.uuid({ version: 4 }),
	repoId: fc.constant('test-owner/test-repo'),
	issueNumber: fc.integer({ min: 1, max: 99999 }),
	branch: fc.constant(null),
	phase: phaseArb,
	status: fc.constantFrom(
		'active' as const,
		'blocked' as const,
		'done' as const,
		'failed' as const,
	),
	autonomyLevel: fc.integer({ min: 0, max: 4 }),
	attempt: fc.integer({ min: 1, max: 10 }),
	startedAt: fc.constant(new Date().toISOString()),
	finishedAt: fc.constant(null),
	lastError: fc.constant(null),
	workspacePath: fc.constant(null),
});

/** Arbitrary: a run in FAILED_TRANSIENT */
const failedTransientRunArb: fc.Arbitrary<RunState> = runStateArb.map((run) => ({
	...run,
	phase: 'FAILED_TRANSIENT' as Phase,
	status: 'failed' as const,
	finishedAt: new Date().toISOString(),
	lastError: 'previous transient failure',
}));

/** Arbitrary: a failure kind */
type FailureKind = 'FAILED' | 'FAILED_TRANSIENT' | 'FAILED_BLOCKED' | 'FAILED_UNSAFE';
const failureKindArb = fc.constantFrom<FailureKind>(
	'FAILED',
	'FAILED_TRANSIENT',
	'FAILED_BLOCKED',
	'FAILED_UNSAFE',
);

/** Arbitrary: a safe message (no real secrets) */
const safeMessageArb = fc.oneof(
	fc.constant('test failure'),
	fc.constant('network timeout'),
	fc.constant('disk full'),
	fc.constant('merge conflict detected'),
	fc.string({ minLength: 4, maxLength: 20 }).map((s) => `error-${s}`),
);

/** Arbitrary: a safe payload (no real secrets) */
const safePayloadArb = fc.oneof(
	fc.constant(null),
	fc.record({
		fakeToken: fc.constant('ghp_fake_1234567890'),
		key: fc.constant('test-key'),
	}),
	fc.dictionary(fc.constantFrom('source', 'code', 'context'), fc.constant('fake-value')),
);

/** Arbitrary: a valid event level */
const eventLevelArb = fc.constantFrom<'INFO' | 'WARN' | 'ERROR' | 'GATE' | 'HUMAN'>(
	'INFO',
	'WARN',
	'ERROR',
	'GATE',
	'HUMAN',
);

/**
 * Arbitrary: a transition chain of valid transitions (length 2-20).
 *
 * Constructive generator: builds connected chains directly by starting from a
 * random valid transition and extending the chain step-by-step through valid
 * outgoing edges. This replaces the previous rejection-based
 * `fc.array(...).filter(...)` approach, which was extremely inefficient for
 * sparse transition graphs (28 phases, few valid edges per phase). Under
 * full-suite parallelism, the old generator caused Invariant 8 to time out at
 * 5000ms because fast-check had to discard thousands of rejected arrays before
 * finding 500 connected ones.
 */
const transitionChainArb: fc.Arbitrary<[Phase, Phase][]> = fc
	.tuple(validTransitionArb, fc.integer({ min: 2, max: 20 }))
	.map(([seed, targetLength]) => {
		const chain: [Phase, Phase][] = [seed];
		let currentPhase: Phase = seed[1];

		while (chain.length < targetLength) {
			const nextTargets = VALID_TRANSITIONS[currentPhase] as readonly Phase[];
			if (nextTargets.length === 0) break; // reached terminal phase

			// Deterministic but varied selection: cycle through available targets
			const nextPhase = nextTargets[chain.length % nextTargets.length]!;
			chain.push([currentPhase, nextPhase]);
			currentPhase = nextPhase;
		}

		return chain;
	});

// =========================================================================
// Invariant 1: VALID_TRANSITIONS consistency
// =========================================================================
describe('Invariant 1: VALID_TRANSITIONS <-> canTransition/transition', () => {
	it('every valid pair returns true from canTransition', () => {
		fc.assert(
			fc.property(validTransitionArb, ([from, to]) => {
				expect(canTransition(from, to)).toBe(true);
			}),
			{ numRuns: 1000 },
		);
	});

	it('every invalid pair returns false from canTransition', () => {
		fc.assert(
			fc.property(invalidTransitionArb, ([from, to]) => {
				expect(canTransition(from, to)).toBe(false);
			}),
			{ numRuns: 1000 },
		);
	});

	it('valid transitions succeed via transition()', () => {
		fc.assert(
			fc.property(
				validTransitionArb,
				safeMessageArb,
				eventLevelArb,
				safePayloadArb,
				([from, to], msg, level, payload) => {
					const run: RunState = {
						id: 'test-id',
						repoId: 'owner/repo',
						issueNumber: 42,
						branch: null,
						phase: from,
						status: 'active',
						autonomyLevel: 0,
						attempt: 1,
						startedAt: new Date().toISOString(),
						finishedAt: null,
						lastError: null,
						workspacePath: null,
					};
					const result = transition(run, to, msg, level, payload);
					expect(result.ok).toBe(true);
					expect(result.run.phase).toBe(to);
				},
			),
			{ numRuns: 1000 },
		);
	});

	it('no phase transitions to itself (reflexive check)', () => {
		fc.assert(
			fc.property(phaseArb, (phase: Phase) => {
				expect(canTransition(phase, phase)).toBe(false);
			}),
			{ numRuns: 1000 },
		);
	});
});

// =========================================================================
// Invariant 2: Terminal phases remain terminal
// =========================================================================
describe('Invariant 2: Terminal phases', () => {
	it('terminal phases have isTerminalPhase() = true', () => {
		fc.assert(
			fc.property(terminalPhaseArb, (phase: Phase) => {
				expect(isTerminalPhase(phase)).toBe(true);
			}),
			{ numRuns: 1000 },
		);
	});

	it('non-terminal phases have isTerminalPhase() = false', () => {
		fc.assert(
			fc.property(nonTerminalPhaseArb, (phase: Phase) => {
				expect(isTerminalPhase(phase)).toBe(false);
			}),
			{ numRuns: 1000 },
		);
	});

	it('terminal phases cannot transition to any non-CLEANUP phase', () => {
		fc.assert(
			fc.property(terminalPhaseArb, phaseArb, (terminal: Phase, target: Phase) => {
				// #244: CLEANUP is the only valid transition from terminal phases
				if (target === 'CLEANUP') return;
				expect(canTransition(terminal, target)).toBe(false);
			}),
			{ numRuns: 1000 },
		);
	});

	it('terminal phases block transition() calls', () => {
		fc.assert(
			fc.property(
				terminalPhaseArb,
				nonTerminalPhaseArb,
				safeMessageArb,
				(terminal: Phase, target: Phase, msg: string) => {
					if (terminal === target) return;
					const run: RunState = {
						id: 'test-id',
						repoId: 'owner/repo',
						issueNumber: 42,
						branch: null,
						phase: terminal,
						status: 'active',
						autonomyLevel: 0,
						attempt: 1,
						startedAt: new Date().toISOString(),
						finishedAt: null,
						lastError: null,
						workspacePath: null,
					};
					const result = transition(run, target, msg);
					expect(result.ok).toBe(false);
					expect(result.run.phase).toBe(terminal);
				},
			),
			{ numRuns: 500 },
		);
	});
});

// =========================================================================
// Invariant 3: Failure phase classification
// =========================================================================
describe('Invariant 3: Failure phase classification', () => {
	it('all failure phases return isFailurePhase() = true', () => {
		fc.assert(
			fc.property(failurePhaseArb, (phase: FailureKind) => {
				expect(isFailurePhase(phase)).toBe(true);
			}),
			{ numRuns: 1000 },
		);
	});

	it('non-failure phases return isFailurePhase() = false', () => {
		fc.assert(
			fc.property(phaseArb, (phase: Phase) => {
				if (
					phase === 'FAILED' ||
					phase === 'FAILED_TRANSIENT' ||
					phase === 'FAILED_BLOCKED' ||
					phase === 'FAILED_UNSAFE'
				) {
					return;
				}
				expect(isFailurePhase(phase)).toBe(false);
			}),
			{ numRuns: 1000 },
		);
	});

	it('all failure phases start with "FAILED"', () => {
		fc.assert(
			fc.property(failurePhaseArb, (phase: FailureKind) => {
				expect(phase.startsWith('FAILED')).toBe(true);
			}),
			{ numRuns: 1000 },
		);
	});

	it('isFailurePhase is equivalent to phase.startsWith("FAILED")', () => {
		fc.assert(
			fc.property(phaseArb, (phase: Phase) => {
				const isFailure = isFailurePhase(phase);
				const startsWithFailed = phase.startsWith('FAILED');
				expect(isFailure).toBe(startsWithFailed);
			}),
			{ numRuns: 1000 },
		);
	});
});

// =========================================================================
// Invariant 4: Invalid transitions don't corrupt run state
// =========================================================================
describe('Invariant 4: Invalid transitions preserve run integrity', () => {
	it('invalid transition preserves run phase', () => {
		fc.assert(
			fc.property(
				invalidTransitionArb,
				runStateArb,
				safeMessageArb,
				([from, to]: [Phase, Phase], run: RunState, msg: string) => {
					const input = { ...run, phase: from };
					const result = transition(input, to, msg);

					expect(result.ok).toBe(false);
					expect(result.run.phase).toBe(from);
					expect(result.run.id).toBe(input.id);
					expect(result.run.repoId).toBe(input.repoId);
					expect(result.run.issueNumber).toBe(input.issueNumber);
					expect(result.event.level).toBe('ERROR');
				},
			),
			{ numRuns: 1000 },
		);
	});

	it('invalid transition sets lastError', () => {
		fc.assert(
			fc.property(
				invalidTransitionArb,
				runStateArb,
				safeMessageArb,
				([from, to]: [Phase, Phase], run: RunState, msg: string) => {
					const input = { ...run, phase: from };
					const result = transition(input, to, msg);
					expect(result.ok).toBe(false);
					expect(result.run.lastError).toBeDefined();
					expect(result.run.lastError!).toContain('Invalid transition');
					expect(result.run.lastError!).toContain(from);
					expect(result.run.lastError!).toContain(to);
				},
			),
			{ numRuns: 500 },
		);
	});
});

// =========================================================================
// Invariant 5: Valid transitions set target phase correctly
// =========================================================================
describe('Invariant 5: Valid transition correctness', () => {
	it('valid transition preserves run identity', () => {
		fc.assert(
			fc.property(
				validTransitionArb,
				safeMessageArb,
				eventLevelArb,
				(
					[from, to]: [Phase, Phase],
					msg: string,
					level: 'INFO' | 'WARN' | 'ERROR' | 'GATE' | 'HUMAN',
				) => {
					const run: RunState = {
						id: 'test-id',
						repoId: 'owner/repo',
						issueNumber: 42,
						branch: 'positron/issue-42-test',
						phase: from,
						status: 'active',
						autonomyLevel: 2,
						attempt: 1,
						startedAt: '2024-01-01T00:00:00.000Z',
						finishedAt: null,
						lastError: null,
						workspacePath: '/tmp/test',
					};

					const result = transition(run, to, msg, level);
					expect(result.ok).toBe(true);
					expect(result.run.id).toBe(run.id);
					expect(result.run.repoId).toBe(run.repoId);
					expect(result.run.issueNumber).toBe(run.issueNumber);
					expect(result.run.phase).toBe(to);

					expect(result.event.runId).toBe(run.id);
					expect(result.event.phase).toBe(to);
					expect(result.event.message).toBe(msg);
					expect(result.event.level).toBe(level);
				},
			),
			{ numRuns: 1000 },
		);
	});

	it('transition to DONE sets correct status and finishedAt', () => {
		const doneTransitionArb = validTransitionArb.filter(([_, to]: [Phase, Phase]) => to === 'DONE');

		fc.assert(
			fc.property(doneTransitionArb, safeMessageArb, ([from, _to]: [Phase, Phase], msg: string) => {
				const run: RunState = {
					id: 'test-id',
					repoId: 'owner/repo',
					issueNumber: 42,
					branch: null,
					phase: from,
					status: 'active',
					autonomyLevel: 0,
					attempt: 1,
					startedAt: new Date().toISOString(),
					finishedAt: null,
					lastError: null,
					workspacePath: null,
				};
				const result = transition(run, 'DONE', msg);
				expect(result.ok).toBe(true);
				expect(result.run.status).toBe('done');
				expect(result.run.finishedAt).toBeDefined();
			}),
			{ numRuns: 500 },
		);
	});
});

// =========================================================================
// Invariant 6: Retry only from FAILED_TRANSIENT
// =========================================================================
describe('Invariant 6: Retry restrictions', () => {
	it('retry from FAILED_TRANSIENT always succeeds', () => {
		fc.assert(
			fc.property(failedTransientRunArb, (run: RunState) => {
				const result = retry(run);
				expect(result.ok).toBe(true);
				expect(result.run.phase).toBe('TEST');
				expect(result.run.status).toBe('active');
				expect(result.run.attempt).toBe(run.attempt + 1);
				expect(result.run.lastError).toBeNull();
				expect(result.run.finishedAt).toBeNull();
				expect(result.run.id).toBe(run.id);
			}),
			{ numRuns: 1000 },
		);
	});

	it('retry from any other phase fails', () => {
		fc.assert(
			fc.property(phaseArb, runStateArb, (phase: Phase, baseRun: RunState) => {
				if (phase === 'FAILED_TRANSIENT') return;
				const run = { ...baseRun, phase };
				const result = retry(run);
				expect(result.ok).toBe(false);
				expect(result.run.phase).toBe(phase);
				expect(result.run.id).toBe(run.id);
				expect(result.event.level).toBe('ERROR');
				expect(result.event.message).toContain('Cannot retry');
			}),
			{ numRuns: 1000 },
		);
	});

	it('TEST is a valid target from FAILED_TRANSIENT', () => {
		const targets = VALID_TRANSITIONS['FAILED_TRANSIENT'];
		expect(targets).toContain('TEST');
	});
});

// =========================================================================
// Invariant 7: markFailed produces a failure phase
// =========================================================================
describe('Invariant 7: markFailed guarantees', () => {
	it('markFailed always returns ok:true', () => {
		fc.assert(
			fc.property(
				runStateArb,
				failureKindArb,
				safeMessageArb,
				(run: RunState, kind: FailureKind, reason: string) => {
					const result = markFailed(run, kind, reason);
					expect(result.ok).toBe(true);
				},
			),
			{ numRuns: 1000 },
		);
	});

	it('markFailed result phase is always a failure phase', () => {
		fc.assert(
			fc.property(
				runStateArb,
				failureKindArb,
				safeMessageArb,
				(run: RunState, kind: FailureKind, reason: string) => {
					const result = markFailed(run, kind, reason);
					expect(isFailurePhase(result.run.phase)).toBe(true);
					expect(result.run.phase).toBe(kind);
				},
			),
			{ numRuns: 1000 },
		);
	});

	it('markFailed preserves run identity', () => {
		fc.assert(
			fc.property(
				runStateArb,
				failureKindArb,
				safeMessageArb,
				(run: RunState, kind: FailureKind, reason: string) => {
					const result = markFailed(run, kind, reason);
					expect(result.run.id).toBe(run.id);
					expect(result.run.repoId).toBe(run.repoId);
					expect(result.run.issueNumber).toBe(run.issueNumber);
				},
			),
			{ numRuns: 1000 },
		);
	});

	it('markFailed sets finishedAt and lastError', () => {
		fc.assert(
			fc.property(
				runStateArb,
				failureKindArb,
				safeMessageArb,
				(run: RunState, kind: FailureKind, reason: string) => {
					const result = markFailed(run, kind, reason);
					expect(result.run.finishedAt).toBeDefined();
					expect(new Date(result.run.finishedAt!).getTime()).toBeGreaterThan(0);
					expect(result.run.lastError).toBe(reason);
				},
			),
			{ numRuns: 1000 },
		);
	});

	it('markFailed includes failedPhase and reason in event payload', () => {
		fc.assert(
			fc.property(
				runStateArb,
				failureKindArb,
				safeMessageArb,
				(run: RunState, kind: FailureKind, reason: string) => {
					const result = markFailed(run, kind, reason);
					expect(result.event.level).toBe('ERROR');
					expect(result.event.payload).toBeDefined();
					expect(result.event.payload!.failedPhase).toBe(run.phase);
					expect(result.event.payload!.reason).toBe(reason);
				},
			),
			{ numRuns: 1000 },
		);
	});

	it('markFailed status mapping is correct', () => {
		fc.assert(
			fc.property(
				runStateArb,
				failureKindArb,
				safeMessageArb,
				(run: RunState, kind: FailureKind, reason: string) => {
					const result = markFailed(run, kind, reason);
					if (kind === 'FAILED_BLOCKED' || kind === 'FAILED') {
						expect(result.run.status).toBe('blocked');
					} else {
						expect(result.run.status).toBe('failed');
					}
				},
			),
			{ numRuns: 1000 },
		);
	});
});

// =========================================================================
// Invariant 8: No transition chain skips forbidden edges
// =========================================================================
describe('Invariant 8: Transition chain integrity', () => {
	it('every edge in a valid chain satisfies canTransition', () => {
		fc.assert(
			fc.property(transitionChainArb, safeMessageArb, (chain: [Phase, Phase][], msg: string) => {
				if (chain.length === 0) return;
				// Start at the chain's first phase
				const first = chain[0]![0];
				let run: RunState = {
					id: 'chain-test',
					repoId: 'owner/repo',
					issueNumber: 42,
					branch: null,
					phase: first,
					status: 'active',
					autonomyLevel: 0,
					attempt: 1,
					startedAt: new Date().toISOString(),
					finishedAt: null,
					lastError: null,
					workspacePath: null,
				};

				for (const [from, to] of chain) {
					expect(from).toBe(run.phase);
					expect(canTransition(run.phase, to)).toBe(true);

					const result = transition(run, to, msg);
					expect(result.ok).toBe(true);
					run = result.run;
				}

				expect(ALL_PHASES).toContain(run.phase);
			}),
			{ numRuns: 500 },
		);
	});

	it('transition chain never silently skips an invalid edge', () => {
		fc.assert(
			fc.property(
				fc.array(validTransitionArb, { minLength: 1, maxLength: 5 }),
				invalidTransitionArb,
				safeMessageArb,
				(prefix: [Phase, Phase][], [badFrom, badTo]: [Phase, Phase], msg: string) => {
					let run = createRun('owner/repo', 42, 0);
					for (const [_, to] of prefix) {
						if (!canTransition(run.phase, to)) continue;
						const result = transition(run, to, msg);
						run = result.run;
					}

					if (run.phase === badFrom) {
						const result = transition(run, badTo, msg);
						expect(result.ok).toBe(false);
						expect(result.run.phase).toBe(run.phase);
					}
				},
			),
			{ numRuns: 500 },
		);
	});
});

// =========================================================================
// Additional: createRun invariant
// =========================================================================
describe('createRun invariants', () => {
	it('always returns a run in QUEUED phase', () => {
		fc.assert(
			fc.property(
				fc.constant('owner/repo'),
				fc.integer({ min: 1, max: 99999 }),
				fc.integer({ min: 0, max: 4 }),
				(repoId: string, issueNumber: number, autonomyLevel: number) => {
					const run = createRun(repoId, issueNumber, autonomyLevel);
					expect(run.phase).toBe('QUEUED');
					expect(run.status).toBe('active');
					expect(run.attempt).toBe(1);
					expect(run.branch).toBeNull();
					expect(run.finishedAt).toBeNull();
					expect(run.lastError).toBeNull();
					expect(run.workspacePath).toBeNull();
				},
			),
			{ numRuns: 1000 },
		);
	});

	it('generates unique IDs', () => {
		fc.assert(
			fc.property(fc.constant(null), () => {
				const ids = new Set<string>();
				for (let i = 0; i < 100; i++) {
					ids.add(createRun('owner/repo', 1, 0).id);
				}
				expect(ids.size).toBe(100);
			}),
			{ numRuns: 100 },
		);
	});

	it('startedAt is a valid ISO date string within the last minute', () => {
		fc.assert(
			fc.property(fc.constant(null), () => {
				const run = createRun('owner/repo', 1, 0);
				const startedTime = new Date(run.startedAt).getTime();
				const now = Date.now();
				expect(startedTime).toBeGreaterThan(now - 60000);
				expect(startedTime).toBeLessThanOrEqual(now + 1000);
			}),
			{ numRuns: 100 },
		);
	});
});

// =========================================================================
// Additional: resumeFromEvents invariants
// =========================================================================
describe('resumeFromEvents invariants', () => {
	it('preserves runId in output', () => {
		fc.assert(
			fc.property(
				fc.uuid({ version: 4 }),
				fc.constant('owner/repo'),
				fc.integer({ min: 1, max: 99999 }),
				fc.array(
					fc.record<RunEventData>({
						id: fc.uuid({ version: 4 }),
						runId: fc.uuid({ version: 4 }),
						phase: phaseArb,
						level: fc.constantFrom('INFO' as const, 'ERROR' as const),
						message: fc.constant('event'),
						payload: fc.constant(null),
						createdAt: fc.constant(new Date().toISOString()),
					}),
					{ minLength: 0, maxLength: 10 },
				),
				(runId: string, repoId: string, issueNumber: number, events: RunEventData[]) => {
					const fixedEvents = events.map((e) => ({ ...e, runId }));
					const run = resumeFromEvents(runId, repoId, issueNumber, fixedEvents);
					expect(run.id).toBe(runId);
					expect(run.repoId).toBe(repoId);
					expect(run.status).toBe('active');
					expect(run.attempt).toBe(1);
				},
			),
			{ numRuns: 500 },
		);
	});

	it('empty events result in QUEUED phase', () => {
		fc.assert(
			fc.property(
				fc.uuid({ version: 4 }),
				fc.constant('owner/repo'),
				fc.integer({ min: 1, max: 99999 }),
				(runId: string, repoId: string, issueNumber: number) => {
					const run = resumeFromEvents(runId, repoId, issueNumber, []);
					expect(run.phase).toBe('QUEUED');
				},
			),
			{ numRuns: 100 },
		);
	});

	it('only INFO and GATE level events advance the phase', () => {
		fc.assert(
			fc.property(
				fc.uuid({ version: 4 }),
				fc.constant('owner/repo'),
				fc.integer({ min: 1, max: 99999 }),
				(runId: string, repoId: string, issueNumber: number) => {
					const events: RunEventData[] = [
						{
							id: 'e1',
							runId,
							phase: 'CLAIMED',
							level: 'ERROR',
							message: 'error',
							payload: null,
							createdAt: new Date().toISOString(),
						},
						{
							id: 'e2',
							runId,
							phase: 'IMPLEMENT',
							level: 'WARN',
							message: 'warn',
							payload: null,
							createdAt: new Date().toISOString(),
						},
						{
							id: 'e3',
							runId,
							phase: 'DONE',
							level: 'HUMAN',
							message: 'human',
							payload: null,
							createdAt: new Date().toISOString(),
						},
					];
					const run = resumeFromEvents(runId, repoId, issueNumber, events);
					expect(run.phase).toBe('QUEUED');
				},
			),
			{ numRuns: 100 },
		);
	});
});

// =========================================================================
// Negative Assurance (Phase 7)
// =========================================================================
describe('Negative Assurance: generator coverage', () => {
	it('invalidTransitionArb actually produces invalid pairs', () => {
		fc.assert(
			fc.property(invalidTransitionArb, ([from, to]: [Phase, Phase]) => {
				expect(canTransition(from, to)).toBe(false);
			}),
			{ numRuns: 500 },
		);
	});

	it('validTransitionArb produces pairs that exist in VALID_TRANSITIONS', () => {
		fc.assert(
			fc.property(validTransitionArb, ([from, to]: [Phase, Phase]) => {
				const allowed = VALID_TRANSITIONS[from] as readonly Phase[];
				expect(allowed).toBeDefined();
				expect(allowed.includes(to)).toBe(true);
			}),
			{ numRuns: 500 },
		);
	});

	it('failurePhaseArb never produces a non-failure phase', () => {
		fc.assert(
			fc.property(failurePhaseArb, (phase: FailureKind) => {
				expect(isFailurePhase(phase)).toBe(true);
			}),
			{ numRuns: 500 },
		);
	});

	it('transitionChainArb produces connected chains', () => {
		fc.assert(
			fc.property(transitionChainArb, (chain: [Phase, Phase][]) => {
				for (let i = 0; i < chain.length - 1; i++) {
					expect(chain[i]![1]).toBe(chain[i + 1]![0]);
				}
			}),
			{ numRuns: 200 },
		);
	});
});
