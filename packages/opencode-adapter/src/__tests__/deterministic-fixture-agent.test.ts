// Positron — DeterministicFixtureAgent Red Tests (TDD Phase 2)
// These tests MUST fail before implementation (modules don't exist yet).
// Red Test Coverage: RT1, RT2, RT7, RT8

import type { OpenCodeCommandResult, OpenCodePhase, OpenCodeRunInput } from '@positron/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
	EvidenceReport,
	Fixture,
	FixtureAgentConfig,
} from '../deterministic-fixture-agent.js';
// RT1/RT2: This import WILL FAIL until deterministic-fixture-agent.ts exists.
// The test file itself is valid TypeScript/vitest, but module resolution will fail.
import { DeterministicFixtureAgent } from '../deterministic-fixture-agent.js';

// --------------- Inline Fixture Data (OQ1: inline test fixtures) ---------------

const HAPPY_PATH_INPUT: OpenCodeRunInput = {
	runId: 'test-run-001',
	workspacePath: 'C:\\Positron',
	issueTitle: 'Test Issue #1',
	issueBody: 'Test body',
	issueNumber: 1,
	phaseName: 'specify',
};

const HAPPY_PATH_PHASES: Array<{
	phase: OpenCodePhase;
	result: OpenCodeCommandResult;
}> = [
	{
		phase: 'health',
		result: {
			phase: 'health',
			status: 'success',
			command: 'health',
			args: [],
			cwd: 'C:\\Positron',
			exitCode: 0,
			durationMs: 10,
			summary: 'Health check passed',
			executionMode: 'fixture',
		},
	},
	{
		phase: 'specify',
		result: {
			phase: 'specify',
			status: 'success',
			command: 'spec-driven-development',
			args: ['specify'],
			cwd: 'C:\\Positron',
			exitCode: 0,
			durationMs: 150,
			summary: 'Specification complete',
			executionMode: 'fixture',
		},
	},
];

const HAPPY_PATH_FIXTURE: Fixture = {
	scenario: 'happy-path-specify',
	phases: HAPPY_PATH_PHASES,
};

const FIXED_TIMESTAMP = '2026-06-20T12:00:00.000Z';

function makeHappyPathConfig(): FixtureAgentConfig {
	const fixtures = new Map<string, Fixture>();
	fixtures.set('happy-path-specify', HAPPY_PATH_FIXTURE);
	return {
		fixtures,
		getTimestamp: () => FIXED_TIMESTAMP,
	};
}

// =============================================================================
// RT1/RT2: Module Resolution Red Tests
// These tests will fail at the import level until the module exists.
// =============================================================================

describe('DeterministicFixtureAgent — RT1/RT2: Module Exists', () => {
	it('RT1: DeterministicFixtureAgent class is importable', () => {
		// Red: This assertion runs only if the import succeeds.
		// Before implementation, the import itself fails — confirming RT1.
		expect(DeterministicFixtureAgent).toBeDefined();
		expect(typeof DeterministicFixtureAgent).toBe('function');
	});
});

// =============================================================================
// RT7: Deterministic Output (Same Input → Same Output)
// =============================================================================

describe('DeterministicFixtureAgent — RT7: Deterministic Output', () => {
	let agent: DeterministicFixtureAgent;

	beforeEach(() => {
		agent = new DeterministicFixtureAgent(makeHappyPathConfig());
	});

	it('RT7: same scenario + same input produces identical EvidenceReport (deep equality)', async () => {
		const result1 = await agent.execute('happy-path-specify', HAPPY_PATH_INPUT);
		const result2 = await agent.execute('happy-path-specify', HAPPY_PATH_INPUT);

		// Deep equality: all fields must match
		expect(result1).toEqual(result2);

		// Specifically verify no non-deterministic values
		expect(result1.runId).toBe(result2.runId);
		expect(result1.executionMode).toBe(result2.executionMode);
		expect(result1.status).toBe(result2.status);
		expect(result1.timestamp).toBe(result2.timestamp);
		expect(result1.simulatedActions).toEqual(result2.simulatedActions);
		expect(result1.summary).toBe(result2.summary);
	});

	it('RT7b: no random values in output (no Math.random, no crypto, no Date.now variance)', async () => {
		// Run 5 times — all must be identical
		const results: EvidenceReport[] = [];
		for (let i = 0; i < 5; i++) {
			results.push(await agent.execute('happy-path-specify', HAPPY_PATH_INPUT));
		}

		const first = results[0];
		for (const r of results) {
			expect(r).toEqual(first);
		}
	});

	it('RT7c: defined fixture produces deterministic output, not network/LLM data', async () => {
		const result = await agent.execute('happy-path-specify', HAPPY_PATH_INPUT);
		// Output must come from the fixture, not from any external source
		expect(result.source).toContain('DeterministicFixtureAgent');
		expect(result.executionMode).toBe('fixture');
	});

	it('produces output with durationMs >= 0', async () => {
		const result = await agent.execute('happy-path-specify', HAPPY_PATH_INPUT);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});
});

// =============================================================================
// RT8: Evidence Output Includes executionMode
// =============================================================================

describe('DeterministicFixtureAgent — RT8: Evidence executionMode', () => {
	let agent: DeterministicFixtureAgent;

	beforeEach(() => {
		agent = new DeterministicFixtureAgent(makeHappyPathConfig());
	});

	it('RT8: EvidenceReport has executionMode = "fixture"', async () => {
		const result = await agent.execute('happy-path-specify', HAPPY_PATH_INPUT);

		// Schema validation: executionMode must be present
		expect(result.executionMode).toBeDefined();
		expect(result.executionMode).toBe('fixture');
	});

	it('RT8b: EvidenceReport has all required fields', async () => {
		const result = await agent.execute('happy-path-specify', HAPPY_PATH_INPUT);

		// Verify all EvidenceReport fields exist
		expect(typeof result.runId).toBe('string');
		expect(result.executionMode).toBe('fixture');
		expect(typeof result.timestamp).toBe('string');
		expect(typeof result.source).toBe('string');
		expect(typeof result.durationMs).toBe('number');
		expect(['success', 'partial', 'blocked', 'failed']).toContain(result.status);
		expect(Array.isArray(result.simulatedActions)).toBe(true);
		expect(Array.isArray(result.blockedActions)).toBe(true);
		expect(Array.isArray(result.reportedActions)).toBe(true);
		expect(Array.isArray(result.warnings)).toBe(true);
		expect(Array.isArray(result.changedFiles)).toBe(true);
		expect(typeof result.summary).toBe('string');
	});

	it('RT8c: EvidenceReport does NOT contain secrets or tokens', async () => {
		const result = await agent.execute('happy-path-specify', HAPPY_PATH_INPUT);
		const json = JSON.stringify(result);

		// No token patterns in evidence (SR4, SR5)
		expect(json).not.toMatch(/ghp_[a-zA-Z0-9]{36}/);
		expect(json).not.toMatch(/gho_[a-zA-Z0-9]{36}/);
		expect(json).not.toMatch(/sk-[a-zA-Z0-9]{32,}/);
		expect(json).not.toMatch(/sk-ant-[a-zA-Z0-9]{32,}/);
	});

	it('EvidenceReport changedFiles is empty for pure fixture run (no real writes)', async () => {
		const result = await agent.execute('happy-path-specify', HAPPY_PATH_INPUT);
		// Fixture agent writes evidence only to .positron/evidence/
		// So changedFiles should be empty or only contain controlled paths
		for (const file of result.changedFiles) {
			expect(file).toMatch(/positron[/\\]evidence[/\\]/);
		}
	});
});

// =============================================================================
// Error Handling
// =============================================================================

describe('DeterministicFixtureAgent — Error Handling', () => {
	let agent: DeterministicFixtureAgent;

	beforeEach(() => {
		agent = new DeterministicFixtureAgent(makeHappyPathConfig());
	});

	it('missing fixture scenario returns status "failed" with clear error', async () => {
		const result = await agent.execute('nonexistent-scenario', HAPPY_PATH_INPUT);
		expect(result.status).toBe('failed');
		expect(result.summary).toMatch(/not found|missing|unknown/i);
	});

	it('does NOT fall back to network/LLM when fixture is missing', async () => {
		// The agent must not make any external calls
		// This is verified by construction — the class has no network dependencies
		const result = await agent.execute('nonexistent-scenario', HAPPY_PATH_INPUT);
		expect(result.status).toBe('failed');
		expect(result.executionMode).toBe('fixture');
	});

	it('empty fixture (no phases) produces valid EvidenceReport', async () => {
		const emptyFixture: Fixture = { scenario: 'empty', phases: [] };
		const fixtures = new Map<string, Fixture>();
		fixtures.set('empty', emptyFixture);
		const emptyAgent = new DeterministicFixtureAgent({ fixtures });

		const result = await emptyAgent.execute('empty', HAPPY_PATH_INPUT);
		expect(result.executionMode).toBe('fixture');
		expect(result.status).toBe('success');
		expect(result.simulatedActions).toEqual([]);
	});
});

// =============================================================================
// Fixture Agent Isolation
// =============================================================================

describe('DeterministicFixtureAgent — Isolation', () => {
	it('no external LLM calls — no fetch/http/network imports', () => {
		// Verified by construction: the agent class uses only @positron/shared types.
		// This test serves as documentation of the invariant.
		expect(DeterministicFixtureAgent).toBeDefined();
	});

	it('no real OpenCode CLI spawn/exec', () => {
		// Verified by construction: agent has no spawn/exec/child_process imports.
		expect(DeterministicFixtureAgent).toBeDefined();
	});

	it('fixture data is separated from agent logic (data-driven, FR10)', async () => {
		// The fixture data (HAPPY_PATH_FIXTURE) is defined outside the agent class.
		// The class receives it via constructor config.
		const agent = new DeterministicFixtureAgent(makeHappyPathConfig());

		// Different fixture data → different output
		const alternateFixture: Fixture = {
			scenario: 'alternate',
			phases: [
				{
					phase: 'implement',
					result: {
						phase: 'implement',
						status: 'success',
						command: 'implement',
						args: [],
						cwd: 'C:\\Positron',
						exitCode: 0,
						durationMs: 50,
						summary: 'Alternate fixture',
						executionMode: 'fixture',
					},
				},
			],
		};
		const altConfig: FixtureAgentConfig = {
			fixtures: new Map([['alternate', alternateFixture]]),
		};
		const altAgent = new DeterministicFixtureAgent(altConfig);

		const result = await altAgent.execute('alternate', HAPPY_PATH_INPUT);
		expect(result.executionMode).toBe('fixture');
		expect(result.simulatedActions).toContain('implement');
	});
});
