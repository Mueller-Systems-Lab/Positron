// POS-NORTHSTAR-R5: Recovery & Resume — RED Tests (Issue #308)
//
// These tests prove the defect: after a controller crash between
// remote PR creation and local checkpoint, Positron creates a
// SECOND PR instead of adopting the existing one.
//
// RED condition: at least one of the following must fail before fix:
//   - second PR created (primary target)
//   - run ID changes after restart
//   - existing PR not recognized
//   - duplicate branch/commit created

import { FakeGitHubAdapter } from '@positron/github-adapter';
import type { GitHubAdapter } from '@positron/github-adapter';
import { FakeOpenCodeAdapter } from '@positron/opencode-adapter';
import {
	assembleGateEvaluators,
	clearGateEvaluators,
	createRun,
	transition,
} from '@positron/run-state';
import type { GateRuntimeMode, RunState } from '@positron/run-state';
import { FakeGitWorkspaceAdapter } from '@positron/sandbox';
import type { GitWorkspaceAdapter } from '@positron/sandbox';
import type { OpenCodeAdapter, SpecKitAdapter } from '@positron/shared';
import { FakeSpecKitAdapter } from '@positron/speckit-adapter';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPipeline } from '../../../worker/src/pipeline-runner.js';
import type { PipelineDeps } from '../../../worker/src/pipeline-runner.js';

// ---------------------------------------------------------------------------
// Instrumented Adapter: records PR creation and can simulate existing PR
// ---------------------------------------------------------------------------

class RecoveryTestGitHubAdapter extends FakeGitHubAdapter {
	public createPRCalls: Array<{
		owner: string;
		repo: string;
		head: string;
		base: string;
	}> = [];
	public existingPRs: Array<{
		number: number;
		head: string;
		state: string;
	}> = [];
	public mergeCalls = 0;

	async createPullRequest(input: {
		owner: string;
		repo: string;
		title: string;
		head: string;
		base: string;
		body: string;
	}): ReturnType<GitHubAdapter['createPullRequest']> {
		this.createPRCalls.push({
			owner: input.owner,
			repo: input.repo,
			head: input.head,
			base: input.base,
		});

		// Check if a PR already exists for this head ref
		const existing = this.existingPRs.find((p) => p.head === input.head && p.state === 'open');
		if (existing) {
			// In real GitHub, this would fail with "A pull request already exists"
			// For the RED test, we simulate the duplicate:
			// The adapter creates ANOTHER PR (different number) — this is the bug
			return {
				number: existing.number + 100, // Simulated duplicate PR number
				htmlUrl: `https://github.com/${input.owner}/${input.repo}/pull/${existing.number + 100}`,
				state: 'open',
				nodeId: `PR_dup_${existing.number + 100}`,
			};
		}

		const prNumber = 100 + this.createPRCalls.length;
		return {
			number: prNumber,
			htmlUrl: `https://github.com/${input.owner}/${input.repo}/pull/${prNumber}`,
			state: 'open',
			nodeId: `PR_node_${prNumber}`,
		};
	}

	async listPullRequests(input: {
		owner: string;
		repo: string;
		head?: string;
		state?: string;
	}): Promise<
		Array<{
			number: number;
			htmlUrl: string;
			state: string;
			nodeId: string;
			head: { ref: string };
			base: { ref: string };
		}>
	> {
		if (input.head) {
			const headRef = input.head.includes(':') ? input.head.split(':')[1] : input.head;
			return this.existingPRs
				.filter((p) => p.head === headRef)
				.map((p) => ({
					number: p.number,
					htmlUrl: `https://github.com/${input.owner}/${input.repo}/pull/${p.number}`,
					state: p.state,
					nodeId: `PR_node_${p.number}`,
					head: { ref: p.head },
					base: { ref: 'main' },
				}));
		}
		return [];
	}

	async mergePullRequest(_input: {
		owner: string;
		repo: string;
		prNumber: number;
		strategy: string;
		commitTitle: string;
		commitMessage: string;
	}): Promise<{ merged: boolean; sha?: string }> {
		this.mergeCalls++;
		return { merged: false }; // Never actually merge in tests
	}
}

// ---------------------------------------------------------------------------
// Test Fixture
// ---------------------------------------------------------------------------

let db: Database.Database;

beforeAll(() => {
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
	// Assemble gate evaluators (required for pipeline to pass gates)
	clearGateEvaluators();
	assembleGateEvaluators('fixture');
});

afterAll(() => {
	clearGateEvaluators();
	db.close();
});

function makeDeps(
	github: GitHubAdapter,
	opts?: { gateRuntimeMode?: GateRuntimeMode },
): PipelineDeps {
	return {
		db,
		repository: {
			owner: 'test-owner',
			repo: 'test-repo',
			remoteUrl: 'https://github.com/test-owner/test-repo.git',
		},
		workspace: new FakeGitWorkspaceAdapter(),
		speckit: new FakeSpecKitAdapter(),
		opencode: new FakeOpenCodeAdapter(),
		github,
		gateRuntimeMode: opts?.gateRuntimeMode ?? 'fixture',
	};
}

function makePRCreatePhaseRun(issueNumber: number, branchName: string): RunState {
	const run = createRun('test-repo', issueNumber, 1);
	return {
		...run,
		phase: 'PR_CREATE',
		status: 'active',
		workspacePath: '/tmp/positron-ws-test',
		branch: branchName,
	};
}

// ---------------------------------------------------------------------------
// RED Test 1: Duplicate PR After Crash Without Resume Logic
// ---------------------------------------------------------------------------

describe('RED: Recovery & Resume — Duplicate PR after crash', () => {
	it('RED-1: creates a second PR when pipeline re-runs PR_CREATE with existing remote PR', async () => {
		// Bug: When the controller crashes after PR creation but before local
		// checkpoint, re-running PR_CREATE creates a SECOND pull request.
		// This reproduces the exact R5 fault scenario.

		const github = new RecoveryTestGitHubAdapter();

		// Simulate: First run already created PR #101 on GitHub
		github.existingPRs.push({
			number: 101,
			head: 'positron/issue-42-test-fix',
			state: 'open',
		});

		const run = makePRCreatePhaseRun(42, 'positron/issue-42-test-fix');

		// Run the pipeline from PR_CREATE
		const deps = makeDeps(github);
		await runPipeline(run, deps);

		// RED ASSERTION: The pipeline should detect the existing PR and adopt it.
		// Bug: Instead, it creates a NEW PR (createPullRequest is called)
		// After fix: createPRCalls.length should be 0 (no new PR created)
		expect(github.createPRCalls.length).toBe(0);
		// This assertion FAILS because the current code always creates a PR
		// without checking for existing ones — proving the RED condition.
	}, 30000);

	it('RED-2: does not check for existing PR before creating a new one', async () => {
		// This test verifies the absence of the pre-check logic.
		// After fix, this test will verify the pre-check exists.

		const github = new RecoveryTestGitHubAdapter();

		// Pre-populate with existing PR
		github.existingPRs.push({
			number: 99,
			head: 'positron/issue-55-test-fix',
			state: 'open',
		});

		const run = makePRCreatePhaseRun(55, 'positron/issue-55-test-fix');

		const deps = makeDeps(github);
		await runPipeline(run, deps);

		// RED: Pipeline should adopt existing PR, not create a new one
		// After fix: createPRCalls.length should be 0
		expect(github.createPRCalls.length).toBe(0);
	}, 30000);
});
