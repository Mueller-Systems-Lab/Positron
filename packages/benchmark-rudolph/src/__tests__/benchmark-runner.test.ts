// Positron — Rudolph Beacon Benchmark Runner Tests (Red Tests)
//
// Tests for benchmark-runner.ts: integration with DeterministicFixtureAgent
// and OpenCodeDryRunAgent, dry-run safety checks.
//
// Red Tests: 12, 13 from the specification

import type { Fixture } from '@positron/opencode-adapter';
import type { OpenCodePhase } from '@positron/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BenchmarkRunner } from '../benchmark-runner.js';
import type { RudolphBenchmarkConfig } from '../benchmark-runner.js';

const FIXED_TIMESTAMP = '2026-12-24T10:00:00Z';

function createBaseConfig(overrides: Partial<RudolphBenchmarkConfig> = {}): RudolphBenchmarkConfig {
	return {
		executionMode: 'fixture',
		runId: 'test-run-001',
		getTimestamp: () => FIXED_TIMESTAMP,
		repo: {
			branch: 'test-branch',
			commitSha: 'abc123def456',
			status: 'clean',
		},
		benchmarkIssues: [
			{ id: 'BENCH-001', title: 'Domain Baseline' },
			{ id: 'BENCH-002', title: 'Deterministic Scan' },
			{ id: 'BENCH-003', title: 'Evidence Contract' },
			{ id: 'BENCH-004', title: 'Traceability' },
			{ id: 'BENCH-005', title: 'Dry-Run Safety' },
		],
		evidenceDir: '.positron/evidence/',
		...overrides,
	};
}

// =============================================================================
// Red Test 12: Dry-run blocks push/PR/merge
// =============================================================================
describe('Red Test 12 — Dry-run blocks risky operations', () => {
	beforeEach(() => {
		process.env['POSITRON_ENABLE_DRY_RUN'] = 'true';
	});

	afterEach(() => {
		Reflect.deleteProperty(process.env, 'POSITRON_ENABLE_DRY_RUN');
	});

	it('dry-run mode blocks git push', async () => {
		const config = createBaseConfig({
			executionMode: 'dry-run',
			runId: 'dry-push-test',
		});

		const runner = new BenchmarkRunner(config);
		const summary = await runner.execute();

		const pushBlocked = summary.safety.blockedActions.some((ba) =>
			ba.operation.toLowerCase().includes('push'),
		);
		expect(pushBlocked).toBe(true);
	});

	it('dry-run mode blocks gh pr create', async () => {
		const config = createBaseConfig({
			executionMode: 'dry-run',
			runId: 'dry-pr-test',
		});

		const runner = new BenchmarkRunner(config);
		const summary = await runner.execute();

		const prBlocked = summary.safety.blockedActions.some((ba) =>
			ba.operation.toLowerCase().includes('pr create'),
		);
		expect(prBlocked).toBe(true);
	});

	it('dry-run mode blocks git merge', async () => {
		const config = createBaseConfig({
			executionMode: 'dry-run',
			runId: 'dry-merge-test',
		});

		const runner = new BenchmarkRunner(config);
		const summary = await runner.execute();

		const mergeBlocked = summary.safety.blockedActions.some((ba) =>
			ba.operation.toLowerCase().includes('merge'),
		);
		expect(mergeBlocked).toBe(true);
	});

	it('dry-run mode blocks git worktree add', async () => {
		const config = createBaseConfig({
			executionMode: 'dry-run',
			runId: 'dry-worktree-test',
		});

		const runner = new BenchmarkRunner(config);
		const summary = await runner.execute();

		const worktreeBlocked = summary.safety.blockedActions.some((ba) =>
			ba.operation.toLowerCase().includes('worktree'),
		);
		expect(worktreeBlocked).toBe(true);
	});

	it('dry-run mode allows read-only operations (git status, gh issue view)', async () => {
		const config = createBaseConfig({
			executionMode: 'dry-run',
			runId: 'dry-read-test',
		});

		const runner = new BenchmarkRunner(config);
		const summary = await runner.execute();

		// Read-only operations should NOT be in blockedActions
		const readOps = ['git status', 'git log', 'gh issue view', 'npm test'];
		for (const op of readOps) {
			const isBlocked = summary.safety.blockedActions.some((ba) =>
				ba.operation.toLowerCase().includes(op.toLowerCase()),
			);
			expect(isBlocked).toBe(false);
		}
	});
});

// =============================================================================
// Red Test 13: Conclusion not GREEN when testing missing
// =============================================================================
describe('Red Test 13 — Conclusion reflects actual evidence', () => {
	it('fixture mode without fixtures → issues are UNKNOWN_EVIDENCE → YELLOW conclusion', async () => {
		const config = createBaseConfig({
			executionMode: 'fixture',
			runId: 'no-fixtures-test',
			fixtureScenarios: new Map(), // empty!
		});

		const runner = new BenchmarkRunner(config);
		const summary = await runner.execute();

		// All issues should be UNKNOWN_EVIDENCE (no fixtures defined)
		for (const issue of summary.issues) {
			expect(issue.status).toBe('UNKNOWN_EVIDENCE');
		}

		// Conclusion should NOT be GREEN
		expect(summary.conclusion.status).not.toBe('GREEN');
	});

	it('conclusion is never GREEN when confidence is zero', async () => {
		const config = createBaseConfig({
			executionMode: 'fixture',
			runId: 'zero-confidence-test',
			fixtureScenarios: new Map(),
		});

		const runner = new BenchmarkRunner(config);
		const summary = await runner.execute();

		expect(summary.conclusion.status).not.toBe('GREEN');
		expect(summary.conclusion.confidence).toBe(0);
	});

	it('fixture mode returns UNKNOWN when no data', async () => {
		const config = createBaseConfig({
			executionMode: 'fixture',
			runId: 'empty-test',
			benchmarkIssues: [],
		});

		const runner = new BenchmarkRunner(config);
		const summary = await runner.execute();

		expect(summary.conclusion.status).toBe('UNKNOWN');
	});
});

// =============================================================================
// Additional: Structure verification
// =============================================================================
describe('BenchmarkRunSummary structure', () => {
	it('all required fields are present in summary', async () => {
		const config = createBaseConfig({
			executionMode: 'fixture',
			runId: 'structure-test',
			fixtureScenarios: new Map(),
		});

		const runner = new BenchmarkRunner(config);
		const summary = await runner.execute();

		expect(summary.runId).toBe('structure-test');
		expect(summary.benchmarkName).toBe('rudolph-beacon');
		expect(summary.executionMode).toBe('fixture');
		expect(summary.timestampUtc).toBe(FIXED_TIMESTAMP);
		expect(summary.repo.branch).toBe('test-branch');
		expect(summary.repo.commitSha).toBe('abc123def456');
		expect(summary.issues).toBeDefined();
		expect(summary.commands).toBeDefined();
		expect(summary.tests).toBeDefined();
		expect(summary.safety).toBeDefined();
		expect(summary.conclusion).toBeDefined();
		expect(summary.capabilityDelta).toBeDefined();
	});

	it('safety.secretsRedacted is true', async () => {
		const config = createBaseConfig({
			executionMode: 'fixture',
			runId: 'safety-test',
			fixtureScenarios: new Map(),
		});

		const runner = new BenchmarkRunner(config);
		const summary = await runner.execute();

		expect(summary.safety.secretsRedacted).toBe(true);
	});

	it('capabilityDelta has all required fields', async () => {
		const config = createBaseConfig({
			executionMode: 'fixture',
			runId: 'delta-test',
			fixtureScenarios: new Map(),
		});

		const runner = new BenchmarkRunner(config);
		const summary = await runner.execute();

		expect(summary.capabilityDelta.newCapabilities).toBeDefined();
		expect(summary.capabilityDelta.unchangedLimitations).toBeDefined();
		expect(summary.capabilityDelta.remainingRisks).toBeDefined();
		expect(summary.capabilityDelta.nextBestStep).toBeDefined();
	});
});

// =============================================================================
// Fixture mode integration
// =============================================================================
describe('Fixture mode with actual fixtures', () => {
	it('processes fixture scenarios and marks issues as DONE', async () => {
		// Create a fixture scenario for BENCH-001
		const fixture: Fixture = {
			scenario: 'Domain Baseline',
			phases: [
				{
					phase: 'specify' as OpenCodePhase,
					result: {
						phase: 'specify' as OpenCodePhase,
						status: 'success',
						command: 'spec-driven-development',
						args: ['specify', 'domain'],
						cwd: '/test',
						exitCode: 0,
						durationMs: 100,
						summary: 'Specification created',
					},
				},
			],
		};

		const fixtureMap = new Map<string, Fixture>();
		fixtureMap.set('benchmark/BENCH-001', fixture);

		const config = createBaseConfig({
			executionMode: 'fixture',
			runId: 'fixture-done-test',
			fixtureScenarios: fixtureMap,
		});

		const runner = new BenchmarkRunner(config);
		const summary = await runner.execute();

		const bench1 = summary.issues.find((i) => i.id === 'BENCH-001');
		expect(bench1).toBeDefined();
		expect(bench1!.status).toBe('DONE');
		expect(bench1!.confidence).toBeGreaterThan(0.7);
	});

	it('issues without fixtures remain UNKNOWN_EVIDENCE', async () => {
		// Only provide fixture for BENCH-001
		const fixture: Fixture = {
			scenario: 'Domain Baseline',
			phases: [
				{
					phase: 'specify' as OpenCodePhase,
					result: {
						phase: 'specify' as OpenCodePhase,
						status: 'success',
						command: 'spec-driven-development',
						args: ['specify'],
						cwd: '/test',
						exitCode: 0,
						durationMs: 100,
						summary: 'Done',
					},
				},
			],
		};

		const fixtureMap = new Map<string, Fixture>();
		fixtureMap.set('benchmark/BENCH-001', fixture);

		const config = createBaseConfig({
			executionMode: 'fixture',
			runId: 'partial-fixture-test',
			fixtureScenarios: fixtureMap,
		});

		const runner = new BenchmarkRunner(config);
		const summary = await runner.execute();

		// BENCH-001 should be DONE
		const bench1 = summary.issues.find((i) => i.id === 'BENCH-001');
		expect(bench1!.status).toBe('DONE');

		// BENCH-002 through BENCH-005 should be UNKNOWN_EVIDENCE (no fixtures)
		for (const id of ['BENCH-002', 'BENCH-003', 'BENCH-004', 'BENCH-005']) {
			const issue = summary.issues.find((i) => i.id === id);
			expect(issue!.status).toBe('UNKNOWN_EVIDENCE');
		}
	});
});

// =============================================================================
// F3 — POSITRON_ENABLE_DRY_RUN restoration contract
// =============================================================================
describe('BenchmarkRunner — POSITRON_ENABLE_DRY_RUN restoration', () => {
	// Each test manages its own env; cleanup after.
	let prevVal: string | undefined;

	beforeEach(() => {
		prevVal = process.env.POSITRON_ENABLE_DRY_RUN;
	});

	afterEach(() => {
		if (prevVal === undefined) {
			Reflect.deleteProperty(process.env, 'POSITRON_ENABLE_DRY_RUN');
		} else {
			process.env.POSITRON_ENABLE_DRY_RUN = prevVal;
		}
		Reflect.deleteProperty(process.env, 'POSITRON_F3_NEIGHBOR');
	});

	// Pflichtfall 1 — variable originally absent remains absent after execute
	it('variable originally absent remains absent after execute', async () => {
		Reflect.deleteProperty(process.env, 'POSITRON_ENABLE_DRY_RUN');

		expect(Object.hasOwn(process.env, 'POSITRON_ENABLE_DRY_RUN')).toBe(false);
		expect(process.env.POSITRON_ENABLE_DRY_RUN).toBeUndefined();

		const runner = new BenchmarkRunner(
			createBaseConfig({
				executionMode: 'dry-run',
				runId: 'f3-absent-test',
			}),
		);
		await runner.execute();

		expect(Object.hasOwn(process.env, 'POSITRON_ENABLE_DRY_RUN')).toBe(false);
		expect(process.env.POSITRON_ENABLE_DRY_RUN).toBeUndefined();
	});

	// Pflichtfall 2 — previous string value is restored exactly
	it('previous string value is restored exactly', async () => {
		process.env.POSITRON_ENABLE_DRY_RUN = 'custom-owner-value';

		const runner = new BenchmarkRunner(
			createBaseConfig({
				executionMode: 'dry-run',
				runId: 'f3-restore-test',
			}),
		);
		await runner.execute();

		expect(process.env.POSITRON_ENABLE_DRY_RUN).toBe('custom-owner-value');
		expect(Object.hasOwn(process.env, 'POSITRON_ENABLE_DRY_RUN')).toBe(true);
	});

	// Pflichtfall 3 — empty string is restored as empty string
	it('empty string is restored as empty string', async () => {
		process.env.POSITRON_ENABLE_DRY_RUN = '';

		const runner = new BenchmarkRunner(
			createBaseConfig({
				executionMode: 'dry-run',
				runId: 'f3-empty-test',
			}),
		);
		await runner.execute();

		expect(process.env.POSITRON_ENABLE_DRY_RUN).toBe('');
		expect(Object.hasOwn(process.env, 'POSITRON_ENABLE_DRY_RUN')).toBe(true);
	});

	// Pflichtfall 4 — neighboring variable unchanged
	it('neighboring variable is unchanged', async () => {
		Reflect.deleteProperty(process.env, 'POSITRON_ENABLE_DRY_RUN');
		process.env.POSITRON_F3_NEIGHBOR = 'neighbor-value';

		const runner = new BenchmarkRunner(
			createBaseConfig({
				executionMode: 'dry-run',
				runId: 'f3-neighbor-test',
			}),
		);
		await runner.execute();

		expect(process.env.POSITRON_F3_NEIGHBOR).toBe('neighbor-value');
		expect(Object.hasOwn(process.env, 'POSITRON_F3_NEIGHBOR')).toBe(true);
	});
});
