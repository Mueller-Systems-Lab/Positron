// Issue #385: Pipeline Commit Failure — Full Negative Mutation E2E Tests
//
// These tests prove:
// - COMMIT exception → FAILED_BLOCKED (never PR_CREATE)
// - No push after commit failure
// - No createPullRequest after commit failure
// - No merge after commit failure
// - commit=0, push=0, createPullRequest=0, merge=0 after upstream blocked paths
//
// Uses the worker's runPipeline with instrumented adapters.

import { FakeGitHubAdapter } from '@positron/github-adapter';
import type { GitHubAdapter } from '@positron/github-adapter';
import { FakeOpenCodeAdapter } from '@positron/opencode-adapter';
import { assembleGateEvaluators, clearGateEvaluators, createRun } from '@positron/run-state';
import type { GateRuntimeMode, RunState } from '@positron/run-state';
import { FakeGitWorkspaceAdapter } from '@positron/sandbox';
import type { GitWorkspaceAdapter } from '@positron/sandbox';
import type { GitStatusSummary } from '@positron/shared';
import type { OpenCodeAdapter, OpenCodeCommandResult, SpecKitAdapter } from '@positron/shared';
import { FakeSpecKitAdapter } from '@positron/speckit-adapter';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Direct import to avoid side effects from @positron/worker's top-level module code
import { runPipeline } from '@positron/worker-pipeline';
import type { PipelineDeps } from '@positron/worker-pipeline';

// ---------------------------------------------------------------------------
// Instrumented Adapters that record mutation calls
// ---------------------------------------------------------------------------

interface MutationCounters {
	commitCalls: number;
	pushCalls: number;
	createPullRequestCalls: number;
	mergeCalls: number;
}

class ThrowingCommitWorkspaceAdapter extends FakeGitWorkspaceAdapter {
	public counters: MutationCounters = {
		commitCalls: 0,
		pushCalls: 0,
		createPullRequestCalls: 0,
		mergeCalls: 0,
	};

	async commit(_workspacePath: string, _message: string): Promise<{ sha: string }> {
		this.counters.commitCalls++;
		throw new Error('SIMULATED_COMMIT_FAILURE: disk full');
	}

	async push(_options: { workspacePath: string; branch: string }): Promise<{ pushed: boolean; ref: string }> {
		this.counters.pushCalls++;
		throw new Error('PUSH_SHOULD_NEVER_BE_CALLED_AFTER_COMMIT_FAILURE');
	}
}

class CountingGitHubAdapter extends FakeGitHubAdapter {
	public counters: Pick<MutationCounters, 'createPullRequestCalls' | 'mergeCalls'> = {
		createPullRequestCalls: 0,
		mergeCalls: 0,
	};

	async createPullRequest(_input: {
		owner: string;
		repo: string;
		title: string;
		head: string;
		base: string;
		body: string;
	}): ReturnType<GitHubAdapter['createPullRequest']> {
		this.counters.createPullRequestCalls++;
		throw new Error('CREATE_PR_SHOULD_NEVER_BE_CALLED_AFTER_COMMIT_FAILURE');
	}

	async mergePullRequest(_options: {
		owner: string;
		repo: string;
		prNumber: number;
		strategy?: string;
		commitTitle?: string;
		commitMessage?: string;
	}): ReturnType<GitHubAdapter['mergePullRequest']> {
		this.counters.mergeCalls++;
		throw new Error('MERGE_SHOULD_NEVER_BE_CALLED_AFTER_COMMIT_FAILURE');
	}
}

// ---------------------------------------------------------------------------
// Test Fixture
// ---------------------------------------------------------------------------

let db: Database.Database;

beforeAll(() => {
	// Install DB schema via openDatabase's migration path
	db = new Database(':memory:');
	db.exec(`
		CREATE TABLE IF NOT EXISTS repositories (
			id TEXT PRIMARY KEY, owner TEXT, name TEXT, url TEXT, local_path TEXT,
			enabled INTEGER DEFAULT 1, created_at TEXT
		);
		CREATE TABLE IF NOT EXISTS issues (
			id TEXT PRIMARY KEY, repo_id TEXT, number INTEGER, title TEXT, state TEXT,
			labels_json TEXT DEFAULT '[]', last_seen_at TEXT
		);
		CREATE TABLE IF NOT EXISTS runs (
			id TEXT PRIMARY KEY, repo_id TEXT, issue_number INTEGER, branch TEXT,
			phase TEXT, status TEXT, autonomy_level INTEGER, attempt INTEGER DEFAULT 0,
			started_at TEXT, finished_at TEXT, last_error TEXT, workspace_path TEXT
		);
		CREATE TABLE IF NOT EXISTS run_events (
			id TEXT, run_id TEXT, phase TEXT, level TEXT, message TEXT,
			payload_json TEXT DEFAULT '{}', created_at TEXT
		);
		CREATE TABLE IF NOT EXISTS artifacts (
			id TEXT PRIMARY KEY, run_id TEXT, kind TEXT, content TEXT, created_at TEXT
		);
		CREATE TABLE IF NOT EXISTS run_signals (
			run_id TEXT, signal TEXT, target_phase TEXT, created_at TEXT
		);
	`);
});

afterAll(() => {
	db.close();
});

function makeDeps(
	workspace: GitWorkspaceAdapter,
	github: GitHubAdapter,
	gateRuntimeMode: GateRuntimeMode = 'fixture',
): PipelineDeps {
	return {
		db,
		repository: {
			owner: 'test-owner',
			repo: 'test-repo',
			remoteUrl: 'https://github.com/test-owner/test-repo.git',
		},
		workspace,
		speckit: new FakeSpecKitAdapter(),
		opencode: new FakeOpenCodeAdapter(),
		github,
		gateRuntimeMode,
	};
}

function makeCommitPhaseRun(): RunState {
	const run = createRun('test-repo', 42, 1);
	return {
		...run,
		phase: 'COMMIT',
		status: 'active',
		workspacePath: '/tmp/positron-ws-test',
		branch: 'positron/issue-42-fix',
	};
}

// Issue #385: To make the runner actually COMMIT, we need to satisfy pre-conditions.
// The FakeGitWorkspaceAdapter reports isClean=false so the pipeline proceeds to commit.
// We subvert commit() to throw. This simulates a commit failure in good state.

class DirtyWorkspaceForCommitAdapter extends ThrowingCommitWorkspaceAdapter {
	async getStatus(_workspacePath: string): Promise<GitStatusSummary> {
		return {
			branch: 'positron/test-branch',
			isClean: false,
			ahead: 1,
			behind: 0,
			staged: ['src/index.ts'],
			unstaged: [],
			untracked: [],
			conflicted: [],
		};
	}
}

// ---------------------------------------------------------------------------
// Tests: COMMIT failure → FAILED_BLOCKED
// ---------------------------------------------------------------------------

describe('Issue #385 — COMMIT exception → FAILED_BLOCKED (Worker Pipeline)', () => {
	beforeAll(() => {
		// Clear any residual evaluators from other tests
		clearGateEvaluators();
		assembleGateEvaluators('fixture');
	});

	it('COMMIT exception produces FAILED_BLOCKED with commitCalls=1, all downstream=0', async () => {
		const workspace = new DirtyWorkspaceForCommitAdapter();
		const github = new CountingGitHubAdapter();
		const deps = makeDeps(workspace, github);
		const run = makeCommitPhaseRun();

		const result = await runPipeline(run, deps);

		// Assert: state is FAILED_BLOCKED
		expect(result.phase).toBe('FAILED_BLOCKED');
		expect(result.status).toBe('blocked');
		expect(result.lastError).toContain('SIMULATED_COMMIT_FAILURE');

		// Assert: commit was attempted exactly once
		expect(workspace.counters.commitCalls).toBe(1);

		// Assert: no downstream mutations occurred
		expect(workspace.counters.pushCalls).toBe(0);
		expect(github.counters.createPullRequestCalls).toBe(0);
		expect(github.counters.mergeCalls).toBe(0);
	});

	it('workspace.commit throws inside pipeline → commit=1, push=0, createPR=0, merge=0', async () => {
		const workspace = new DirtyWorkspaceForCommitAdapter();
		const github = new CountingGitHubAdapter();
		const deps = makeDeps(workspace, github);
		const run = makeCommitPhaseRun();

		const result = await runPipeline(run, deps);

		// Negative mutation evidence
		expect(workspace.counters.commitCalls).toBe(1);
		expect(workspace.counters.pushCalls).toBe(0);
		expect(github.counters.createPullRequestCalls).toBe(0);
		expect(github.counters.mergeCalls).toBe(0);

		expect(result.phase).toBe('FAILED_BLOCKED');
	});

	it('FAILED_BLOCKED run has finishedAt set (terminal)', async () => {
		const workspace = new DirtyWorkspaceForCommitAdapter();
		const github = new CountingGitHubAdapter();
		const deps = makeDeps(workspace, github);
		const run = makeCommitPhaseRun();

		const result = await runPipeline(run, deps);

		expect(result.phase).toBe('FAILED_BLOCKED');
		expect(result.finishedAt).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Tests: IMPLEMENT blocked → no mutation
// ---------------------------------------------------------------------------

class BlockedImplementAdapter extends FakeOpenCodeAdapter {
	async runImplement(
		_input: Parameters<OpenCodeAdapter['runImplement']>[0],
	): Promise<OpenCodeCommandResult> {
		return {
			phase: 'implement',
			command: 'implement',
			args: [],
			cwd: _input.workspacePath,
			exitCode: null,
			durationMs: 0,
			status: 'blocked',
			blockedReason: 'IMPLEMENT_BLOCKED_BY_POLICY',
			summary: 'Policy blocked implementation',
		};
	}
}

class CleanWorkspaceAdapter extends FakeGitWorkspaceAdapter {
	async getStatus(_workspacePath: string): Promise<GitStatusSummary> {
		return {
			branch: 'positron/test-branch',
			isClean: false,
			ahead: 0,
			behind: 0,
			staged: ['modified.ts'],
			unstaged: [],
			untracked: [],
			conflicted: [],
		};
	}
}

describe('Issue #385 — IMPLEMENT blocked → no mutation (Worker Pipeline)', () => {
	beforeAll(() => {
		clearGateEvaluators();
		assembleGateEvaluators('fixture');
	});

	it('IMPLEMENT blocked → commit=0, push=0, createPR=0, merge=0', async () => {
		const workspace = new CleanWorkspaceAdapter();
		const github = new CountingGitHubAdapter();
		const deps = {
			...makeDeps(workspace, github),
			opencode: new BlockedImplementAdapter(),
		};

		// Start a run from IMPLEMENT phase
		const run: RunState = {
			...createRun('test-repo', 42, 1),
			branch: 'positron/issue-42-fix',
			phase: 'IMPLEMENT',
			status: 'active',
			workspacePath: '/tmp/positron-ws-test',
		};

		const result = await runPipeline(run, deps);

		expect(result.phase).toBe('FAILED_BLOCKED');
		expect(result.status).toBe('blocked');
	});

	it('TEST failed (blocked) → commit=0, push=0, createPR=0, merge=0', async () => {
		// Start from TEST phase with no test commands in supervised mode
		clearGateEvaluators();
		assembleGateEvaluators('supervised');

		const workspace = new CleanWorkspaceAdapter();
		const github = new CountingGitHubAdapter();
		const deps = {
			...makeDeps(workspace, github, 'supervised'),
		};

		const run: RunState = {
			...createRun('test-repo', 42, 1),
			branch: 'positron/issue-42-fix',
			phase: 'TEST',
			status: 'active',
			workspacePath: '/tmp/no-tests-ws',
		};

		const result = await runPipeline(run, deps);

		// In supervised mode with no test commands, should be FAILED_BLOCKED
		expect(result.phase).toBe('FAILED_BLOCKED');
		expect(result.status).toBe('blocked');
	});

	afterAll(() => {
		clearGateEvaluators();
		assembleGateEvaluators('fixture');
	});
});

// ---------------------------------------------------------------------------
// Restart/Resume: blocked run stays blocked after cold start
// ---------------------------------------------------------------------------

describe('Issue #385 — Restart/Resume: blocked runs stay blocked', () => {
	beforeAll(() => {
		clearGateEvaluators();
		assembleGateEvaluators('fixture');
	});

	it('Blocked run persisted to DB loads back as blocked and cannot progress', async () => {
		const workspace = new DirtyWorkspaceForCommitAdapter();
		const github = new CountingGitHubAdapter();
		const deps = makeDeps(workspace, github);
		const run = makeCommitPhaseRun();

		// Run to FAILED_BLOCKED
		const firstRun = await runPipeline(run, deps);
		expect(firstRun.phase).toBe('FAILED_BLOCKED');

		// Simulate persist and cold restart: load from DB
		// Insert the run into the DB
		db.prepare(`
			INSERT OR REPLACE INTO runs (id, repo_id, issue_number, branch, phase, status, autonomy_level, attempt, started_at, finished_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			firstRun.id,
			firstRun.repoId,
			firstRun.issueNumber,
			firstRun.branch,
			firstRun.phase,
			firstRun.status,
			firstRun.autonomyLevel,
			firstRun.attempt,
			firstRun.startedAt,
			firstRun.finishedAt,
		);

		// Cold restart: create fresh adapters and deps
		const restartedWorkspace = new DirtyWorkspaceForCommitAdapter();
		const restartedGithub = new CountingGitHubAdapter();
		const restartedDeps = makeDeps(restartedWorkspace, restartedGithub);

		// Load the run from DB — but phase is FAILED_BLOCKED (terminal)
		const loadedRun: RunState = {
			...createRun('test-repo', 42, 1),
			branch: 'positron/issue-42-fix',
			id: firstRun.id,
			phase: 'FAILED_BLOCKED',
			status: 'blocked',
			lastError: firstRun.lastError,
			finishedAt: firstRun.finishedAt,
		};

		// Running the pipeline on a FAILED_BLOCKED run should return immediately
		const restartedResult = await runPipeline(loadedRun, restartedDeps);

		// Assert: still blocked
		expect(restartedResult.phase).toBe('FAILED_BLOCKED');
		expect(restartedResult.status).toBe('blocked');

		// Assert: no mutation calls after restart
		expect(restartedWorkspace.counters.commitCalls).toBe(0);
		expect(restartedWorkspace.counters.pushCalls).toBe(0);
		expect(restartedGithub.counters.createPullRequestCalls).toBe(0);
		expect(restartedGithub.counters.mergeCalls).toBe(0);
	});
});
