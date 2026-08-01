// Positron — OpenCodeDryRunAgent Red Tests (TDD Phase 2)
// These tests MUST fail before implementation (modules don't exist yet).
// Red Test Coverage: RT1, RT2, RT3, RT4, RT5, RT6, RT8

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenCodeRunInput } from '@positron/shared';
// RT1/RT2: This import WILL FAIL until dry-run-agent.ts exists.
import { OpenCodeDryRunAgent } from '../dry-run-agent.js';
import type { ActionPlan, DryRunAgentConfig, EvidenceReport } from '../dry-run-agent.js';

// --------------- Test Constants ---------------

const TEST_INPUT: OpenCodeRunInput = {
	runId: 'test-run-002',
	workspacePath: 'C:\\Positron',
	issueTitle: 'Test Dry-Run Issue',
	issueBody: 'Testing dry-run safety',
	issueNumber: 263,
};

const READ_ACTION: ActionPlan = {
	operation: 'git status',
	phase: 'analyze',
};

const WRITE_ACTION: ActionPlan = {
	operation: 'write file',
	target: 'C:\\SomePath\\outside\\file.txt',
};

const PUSH_ACTION: ActionPlan = {
	operation: 'git push',
	target: 'origin main',
};

const PR_CREATE_ACTION: ActionPlan = {
	operation: 'gh pr create',
	target: 'main',
};

const MERGE_ACTION: ActionPlan = {
	operation: 'git merge',
	target: 'feature-branch',
};

const BRANCH_DELETE_ACTION: ActionPlan = {
	operation: 'git branch -d',
	target: 'feature-branch',
};

const FORCE_PUSH_ACTION: ActionPlan = {
	operation: 'git push --force',
	target: 'origin main',
};

const WORKTREE_ACTION: ActionPlan = {
	operation: 'git worktree add',
	target: 'C:\\Positron\\new-worktree',
};

const NPM_INSTALL_ACTION: ActionPlan = {
	operation: 'npm install',
	target: 'some-package',
};

const GIT_COMMIT_ACTION: ActionPlan = {
	operation: 'git commit',
};

// --------------- Env Helpers ---------------

function preserveEnv() {
	const orig = {
		POSITRON_ENABLE_DRY_RUN: process.env['POSITRON_ENABLE_DRY_RUN'],
		POSITRON_ENABLE_PUSH: process.env['POSITRON_ENABLE_PUSH'],
		POSITRON_MERGE_KILL_SWITCH: process.env['POSITRON_MERGE_KILL_SWITCH'],
		NODE_ENV: process.env['NODE_ENV'],
	};
	return () => {
		process.env['POSITRON_ENABLE_DRY_RUN'] = orig.POSITRON_ENABLE_DRY_RUN;
		process.env['POSITRON_ENABLE_PUSH'] = orig.POSITRON_ENABLE_PUSH;
		process.env['POSITRON_MERGE_KILL_SWITCH'] = orig.POSITRON_MERGE_KILL_SWITCH;
		process.env['NODE_ENV'] = orig.NODE_ENV;
	};
}

function enableDryRun() {
	process.env['POSITRON_ENABLE_DRY_RUN'] = 'true';
}

// =============================================================================
// RT1/RT2: Module Resolution Red Tests
// =============================================================================

describe('OpenCodeDryRunAgent — RT1/RT2: Module Exists', () => {
	it('RT2: OpenCodeDryRunAgent class is importable', () => {
		// Red: This assertion runs only if the import succeeds.
		// Before implementation, the import itself fails — confirming RT2.
		expect(OpenCodeDryRunAgent).toBeDefined();
		expect(typeof OpenCodeDryRunAgent).toBe('function');
	});
});

// =============================================================================
// RT3: Dry-Run Blocks File Write Outside Temp Path
// =============================================================================

describe('OpenCodeDryRunAgent — RT3: Blocked File Write', () => {
	let restoreEnv: () => void;

	beforeEach(() => {
		restoreEnv = preserveEnv();
		enableDryRun();
	});

	afterEach(() => {
		restoreEnv();
	});

	it('RT3: file write outside controlled path is blocked', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([WRITE_ACTION], TEST_INPUT);

		expect(result.blockedActions.length).toBeGreaterThan(0);
		const blocked = result.blockedActions.find((a) => a.operation === 'write file');
		expect(blocked).toBeDefined();
		expect(blocked!.reason).toMatch(/write|controlled|path/i);
		expect(result.status).not.toBe('success');
	});

	it('RT3b: blocked file write is recorded with reason, not executed', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([WRITE_ACTION], TEST_INPUT);

		// No file should actually be created
		expect(result.blockedActions.find((a) => a.operation === 'write file')).toBeDefined();
		expect(result.changedFiles).toEqual([]);
	});

	it('RT3c: file writes within .positron/test-artifacts are allowed (controlled path)', async () => {
		const agent = new OpenCodeDryRunAgent();
		const controlledWrite: ActionPlan = {
			operation: 'write file',
			target: '.positron/test-artifacts/test-output.txt',
		};
		const result = await agent.analyzeActions([controlledWrite], TEST_INPUT);

		// Controlled path writes should be simulated, not blocked
		const blocked = result.blockedActions.find((a) => a.operation === 'write file');
		expect(blocked).toBeUndefined();
	});
});

// =============================================================================
// RT4: Dry-Run Blocks GitHub Push
// =============================================================================

describe('OpenCodeDryRunAgent — RT4: Blocked GitHub Push', () => {
	let restoreEnv: () => void;

	beforeEach(() => {
		restoreEnv = preserveEnv();
		enableDryRun();
		// Push kill switch: push blocked unless explicitly enabled
		process.env['POSITRON_ENABLE_PUSH'] = 'false';
	});

	afterEach(() => {
		restoreEnv();
	});

	it('RT4: GitHub push is blocked with reason citing POSITRON_ENABLE_PUSH', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([PUSH_ACTION], TEST_INPUT);

		const blocked = result.blockedActions.find((a) => a.operation === 'git push');
		expect(blocked).toBeDefined();
		expect(blocked!.reason).toMatch(/POSITRON_ENABLE_PUSH/i);
	});

	it('RT4b: force push is also blocked', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([FORCE_PUSH_ACTION], TEST_INPUT);

		const blocked = result.blockedActions.find((a) => a.operation.includes('push'));
		expect(blocked).toBeDefined();
		expect(blocked!.reason).toMatch(/POSITRON_ENABLE_PUSH/i);
	});

	it('no actual git push command is executed', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([PUSH_ACTION], TEST_INPUT);

		// Ensure no real side effects — push is classified as blocked
		expect(result.executionMode).toBe('dry-run');
		expect(result.status).toBe('blocked');
	});
});

// =============================================================================
// RT5: Dry-Run Blocks PR Creation
// =============================================================================

describe('OpenCodeDryRunAgent — RT5: Blocked PR Creation', () => {
	let restoreEnv: () => void;

	beforeEach(() => {
		restoreEnv = preserveEnv();
		enableDryRun();
	});

	afterEach(() => {
		restoreEnv();
	});

	it('RT5: gh pr create is blocked with reason citing GitHub write block', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([PR_CREATE_ACTION], TEST_INPUT);

		const blocked = result.blockedActions.find((a) => a.operation === 'gh pr create');
		expect(blocked).toBeDefined();
		expect(blocked!.reason).toMatch(/PR|pull request|write|blocked/i);
	});
});

// =============================================================================
// RT6: Dry-Run Blocks Merge and Branch Delete
// =============================================================================

describe('OpenCodeDryRunAgent — RT6: Blocked Merge / Branch Delete', () => {
	let restoreEnv: () => void;

	beforeEach(() => {
		restoreEnv = preserveEnv();
		enableDryRun();
		// Merge kill switch: merge blocked unless explicitly disabled
		process.env['POSITRON_MERGE_KILL_SWITCH'] = 'true';
	});

	afterEach(() => {
		restoreEnv();
	});

	it('RT6: git merge is blocked with reason citing POSITRON_MERGE_KILL_SWITCH', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([MERGE_ACTION], TEST_INPUT);

		const blocked = result.blockedActions.find((a) => a.operation === 'git merge');
		expect(blocked).toBeDefined();
		expect(blocked!.reason).toMatch(/POSITRON_MERGE_KILL_SWITCH/i);
	});

	it('RT6b: git branch -d is blocked with reason citing POSITRON_MERGE_KILL_SWITCH', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([BRANCH_DELETE_ACTION], TEST_INPUT);

		const blocked = result.blockedActions.find((a) => a.operation === 'git branch -d');
		expect(blocked).toBeDefined();
		expect(blocked!.reason).toMatch(/POSITRON_MERGE_KILL_SWITCH/i);
	});

	it('RT6c: no actual git merge or branch delete is executed', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([MERGE_ACTION, BRANCH_DELETE_ACTION], TEST_INPUT);

		expect(result.executionMode).toBe('dry-run');
		expect(result.status).toBe('blocked');
	});
});

// =============================================================================
// RT8: Evidence Output Includes executionMode
// =============================================================================

describe('OpenCodeDryRunAgent — RT8: Evidence executionMode', () => {
	let restoreEnv: () => void;

	beforeEach(() => {
		restoreEnv = preserveEnv();
		enableDryRun();
	});

	afterEach(() => {
		restoreEnv();
	});

	it('RT8: EvidenceReport has executionMode = "dry-run"', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([READ_ACTION], TEST_INPUT);

		expect(result.executionMode).toBeDefined();
		expect(result.executionMode).toBe('dry-run');
	});

	it('RT8b: EvidenceReport has all required fields', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([READ_ACTION], TEST_INPUT);

		expect(typeof result.runId).toBe('string');
		expect(result.executionMode).toBe('dry-run');
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

	it('RT8c: EvidenceReport does NOT contain secrets or tokens (SR4, SR5)', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([PUSH_ACTION], TEST_INPUT);
		const json = JSON.stringify(result);

		expect(json).not.toMatch(/ghp_[a-zA-Z0-9]{36}/);
		expect(json).not.toMatch(/gho_[a-zA-Z0-9]{36}/);
		expect(json).not.toMatch(/sk-[a-zA-Z0-9]{32,}/);
		expect(json).not.toMatch(/sk-ant-[a-zA-Z0-9]{32,}/);
	});
});

// =============================================================================
// Additional Safety Tests (Beyond RT1-RT9)
// =============================================================================

describe('OpenCodeDryRunAgent — Kill Switch Integration', () => {
	let restoreEnv: () => void;

	beforeEach(() => {
		restoreEnv = preserveEnv();
		enableDryRun();
	});

	afterEach(() => {
		restoreEnv();
	});

	it('acknowledges POSITRON_MERGE_KILL_SWITCH in warnings when active', async () => {
		process.env['POSITRON_MERGE_KILL_SWITCH'] = 'true';

		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([MERGE_ACTION], TEST_INPUT);

		expect(result.warnings).toContainEqual(expect.stringMatching(/POSITRON_MERGE_KILL_SWITCH/i));
	});

	it('warns when POSITRON_ENABLE_PUSH is not true', async () => {
		process.env['POSITRON_ENABLE_PUSH'] = 'false';

		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([PUSH_ACTION], TEST_INPUT);

		const hasWarning = result.warnings.some((w) => /POSITRON_ENABLE_PUSH/i.test(w));
		expect(hasWarning).toBe(true);
	});

	it('never bypasses kill switches — reports "would be blocked" not "would succeed"', async () => {
		process.env['POSITRON_MERGE_KILL_SWITCH'] = 'true';

		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([MERGE_ACTION], TEST_INPUT);

		// Merge must show as blocked, not simulated or success
		const blocked = result.blockedActions.find((a) => a.operation === 'git merge');
		expect(blocked).toBeDefined();
		expect(blocked!.reason).not.toMatch(/would succeed/i);
	});
});

describe('OpenCodeDryRunAgent — POSITRON_ENABLE_DRY_RUN Gate', () => {
	let restoreEnv: () => void;

	beforeEach(() => {
		restoreEnv = preserveEnv();
	});

	afterEach(() => {
		restoreEnv();
	});

	it('throws when POSITRON_ENABLE_DRY_RUN is not "true"', () => {
		process.env['POSITRON_ENABLE_DRY_RUN'] = 'false';
		process.env['NODE_ENV'] = 'production';

		expect(() => new OpenCodeDryRunAgent()).toThrow(/POSITRON_ENABLE_DRY_RUN/i);
	});

	it('allows construction when POSITRON_ENABLE_DRY_RUN is "true"', () => {
		enableDryRun();

		expect(() => new OpenCodeDryRunAgent()).not.toThrow();
	});

	it('allows construction in test environment even without explicit env var', () => {
		process.env['NODE_ENV'] = 'test';
		Reflect.deleteProperty(process.env, 'POSITRON_ENABLE_DRY_RUN');

		expect(Object.hasOwn(process.env, 'POSITRON_ENABLE_DRY_RUN')).toBe(false);

		expect(() => new OpenCodeDryRunAgent()).not.toThrow();
	});
});

describe('OpenCodeDryRunAgent — Operation Classification (ADR-C)', () => {
	let restoreEnv: () => void;

	beforeEach(() => {
		restoreEnv = preserveEnv();
		enableDryRun();
	});

	afterEach(() => {
		restoreEnv();
	});

	// Simulated operations (read-only, side-effect-free)
	it('git status is simulated (read-only)', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([READ_ACTION], TEST_INPUT);
		expect(result.simulatedActions).toContain('git status');
		expect(result.blockedActions).toEqual([]);
	});

	it('git log is simulated', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions(
			[{ operation: 'git log', phase: 'analyze' }],
			TEST_INPUT,
		);
		expect(result.simulatedActions).toContain('git log');
	});

	it('git diff is simulated', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([{ operation: 'git diff' }], TEST_INPUT);
		expect(result.simulatedActions).toContain('git diff');
	});

	it('gh issue view is simulated', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([{ operation: 'gh issue view' }], TEST_INPUT);
		expect(result.simulatedActions).toContain('gh issue view');
	});

	// Blocked operations (writes, destructive)
	it('git worktree add is blocked', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([WORKTREE_ACTION], TEST_INPUT);

		const blocked = result.blockedActions.find((a) => a.operation === 'git worktree add');
		expect(blocked).toBeDefined();
	});

	it('npm install is blocked', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([NPM_INSTALL_ACTION], TEST_INPUT);

		const blocked = result.blockedActions.find((a) => a.operation === 'npm install');
		expect(blocked).toBeDefined();
	});

	it('git commit is blocked', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.analyzeActions([GIT_COMMIT_ACTION], TEST_INPUT);

		const blocked = result.blockedActions.find((a) => a.operation === 'git commit');
		expect(blocked).toBeDefined();
	});
});

describe('OpenCodeDryRunAgent — runSlashCommand', () => {
	let restoreEnv: () => void;

	beforeEach(() => {
		restoreEnv = preserveEnv();
		enableDryRun();
	});

	afterEach(() => {
		restoreEnv();
	});

	it('runSlashCommand never executes actual command', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.runSlashCommand('spec-driven-development', TEST_INPUT);

		expect(result.executionMode).toBe('dry-run');
		// Command should not actually execute — no real side effects
		expect(result.simulatedActions.length).toBeGreaterThanOrEqual(0);
		expect(result.changedFiles).toEqual([]);
	});

	it('runSlashCommand returns EvidenceReport, not OpenCodeCommandResult', async () => {
		const agent = new OpenCodeDryRunAgent();
		const result = await agent.runSlashCommand('spec-driven-development', TEST_INPUT);

		// Must conform to EvidenceReport interface
		expect(result.executionMode).toBe('dry-run');
		expect(typeof result.runId).toBe('string');
		expect(typeof result.summary).toBe('string');
	});
});

describe('OpenCodeDryRunAgent — Constructor Config', () => {
	let restoreEnv: () => void;

	beforeEach(() => {
		restoreEnv = preserveEnv();
		enableDryRun();
	});

	afterEach(() => {
		restoreEnv();
	});

	it('accepts custom evidenceDir', () => {
		const config: DryRunAgentConfig = {
			evidenceDir: '.positron/custom-evidence/',
		};
		expect(() => new OpenCodeDryRunAgent(config)).not.toThrow();
	});

	it('accepts additional blocked operations', async () => {
		const config: DryRunAgentConfig = {
			blockedOperations: ['custom-dangerous-op'],
		};
		const agent = new OpenCodeDryRunAgent(config);
		const result = await agent.analyzeActions([{ operation: 'custom-dangerous-op' }], TEST_INPUT);

		const blocked = result.blockedActions.find((a) => a.operation === 'custom-dangerous-op');
		expect(blocked).toBeDefined();
	});
});
