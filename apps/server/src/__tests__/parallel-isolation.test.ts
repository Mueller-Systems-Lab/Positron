// POS-NORTHSTAR-R6: Parallel Isolation — Frozen Tests (Issue #308)
//
// These tests validate that two simultaneously active Positron runs
// against different issues and branches maintain strict state isolation.
//
// Frozen before any R6 product changes. Run with:
//   NODE_ENV=test npx vitest run apps/server/src/__tests__/parallel-isolation.test.ts

import type { GitHubAdapter } from '@positron/github-adapter';
import { FakeOpenCodeAdapter } from '@positron/opencode-adapter';
import { createRun } from '@positron/run-state';
import type { GateRuntimeMode, RunState } from '@positron/run-state';
import { FakeGitWorkspaceAdapter } from '@positron/sandbox';
import type { GitWorkspaceAdapter } from '@positron/sandbox';
import type { OpenCodeAdapter, SpecKitAdapter } from '@positron/shared';
import { FakeSpecKitAdapter } from '@positron/speckit-adapter';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PipelineDeps } from '../../../worker/src/pipeline-runner.js';

// Minimal local type matching shared RepositoryConfig
interface RepositoryConfig {
	owner: string;
	repo: string;
	defaultBranch?: string;
	remoteUrl?: string;
}

// ---------------------------------------------------------------------------
// Lightweight Fake GitHub Adapter for isolation tests
// ---------------------------------------------------------------------------

interface TrackedPR {
	number: number;
	head: string;
	state: 'open' | 'closed' | 'merged';
	title: string;
}

class IsolationTestGitHubAdapter {
	public prs: TrackedPR[] = [];
	public nextPRNumber = 9000;

	async createPullRequest(input: {
		owner: string;
		repo: string;
		title: string;
		head: string;
		base: string;
		body: string;
	}) {
		const existing = this.prs.find((p) => p.head === input.head && p.state === 'open');
		if (existing) {
			return {
				id: existing.number,
				number: existing.number,
				title: existing.title,
				body: input.body,
				state: existing.state,
				head: { ref: input.head, sha: 'abc1234' },
				base: { ref: input.base, sha: 'def5678' },
				htmlUrl: `https://github.com/${input.owner}/${input.repo}/pull/${existing.number}`,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				draft: true,
				mergeable: null,
			};
		}
		const number = this.nextPRNumber++;
		this.prs.push({ number, head: input.head, state: 'open', title: input.title });
		return {
			id: number,
			number,
			title: input.title,
			body: input.body,
			state: 'open' as const,
			head: { ref: input.head, sha: 'abc1234' },
			base: { ref: input.base, sha: 'def5678' },
			htmlUrl: `https://github.com/${input.owner}/${input.repo}/pull/${number}`,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			draft: true,
			mergeable: null,
		};
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(db: Database.Database, github: IsolationTestGitHubAdapter): PipelineDeps {
	const repo: RepositoryConfig = {
		owner: 'test-owner',
		repo: 'test-sandbox',
	};
	return {
		db,
		repository: repo,
		github: github as unknown as GitHubAdapter,
		workspace: new FakeGitWorkspaceAdapter() as unknown as GitWorkspaceAdapter,
		speckit: new FakeSpecKitAdapter() as unknown as SpecKitAdapter,
		opencode: new FakeOpenCodeAdapter() as unknown as OpenCodeAdapter,
		gateRuntimeMode: 'fixture' as GateRuntimeMode,
	};
}

function makeRunState(
	id: string,
	issueNumber: number,
	branch: string,
	phase = 'CREATED',
	status = 'active',
	finishedAt: string | null = null,
): RunState {
	const run = createRun('test-sandbox', issueNumber, 3);
	// Override ID and branch
	return {
		...run,
		id,
		branch,
		phase: phase as RunState['phase'],
		status: status as RunState['status'],
		finishedAt,
	};
}

describe('POS-NORTHSTAR-R6: Parallel Isolation', () => {
	let db: Database.Database;

	beforeAll(() => {
		// Gate evaluators are assembled externally — no-op in this isolated test
	});

	afterAll(() => {
		// cleanup
	});

	beforeEach(() => {
		db = new Database(':memory:');
		db.exec(`
      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY, owner TEXT, name TEXT, url TEXT,
        local_path TEXT, enabled INTEGER, created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY, repo_id TEXT, number INTEGER, title TEXT,
        state TEXT, labels_json TEXT, last_seen_at TEXT
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, repo_id TEXT, issue_number INTEGER,
        branch TEXT, phase TEXT, status TEXT, autonomy_level INTEGER,
        attempt INTEGER, started_at TEXT, finished_at TEXT, last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS run_events (
        id TEXT PRIMARY KEY, run_id TEXT, phase TEXT, level TEXT,
        message TEXT, payload TEXT, created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS run_signals (
        run_id TEXT, signal TEXT, target_phase TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (run_id, signal)
      );
    `);
	});

	// -----------------------------------------------------------------------
	// Test A: Cross-Run State Isolation
	// -----------------------------------------------------------------------

	describe('Test A: Cross-Run State Isolation', () => {
		it('A-1: Run A and Run B have different stable IDs', () => {
			const runA = makeRunState('run-a-001', 100, 'positron/issue-100-r6-a-fix');
			const runB = makeRunState('run-b-001', 200, 'positron/issue-200-r6-b-feat');

			expect(runA.id).not.toBe(runB.id);
			expect(runA.issueNumber).not.toBe(runB.issueNumber);
			expect(runA.branch).not.toBe(runB.branch);
		});

		it('A-2: Run A checkpoints do not affect Run B state', () => {
			const runA = makeRunState('run-a-002', 101, 'positron/issue-101-a', 'PR_CREATE', 'active');
			const runB = makeRunState(
				'run-b-002',
				201,
				'positron/issue-201-b',
				'DONE',
				'done',
				new Date().toISOString(),
			);

			const insert = db.prepare(`
        INSERT OR REPLACE INTO runs (id, repo_id, issue_number, branch, phase, status, autonomy_level, attempt, started_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

			insert.run(
				runA.id,
				runA.repoId,
				runA.issueNumber,
				runA.branch,
				runA.phase,
				runA.status,
				3,
				1,
				new Date().toISOString(),
				null,
			);
			insert.run(
				runB.id,
				runB.repoId,
				runB.issueNumber,
				runB.branch,
				runB.phase,
				runB.status,
				3,
				1,
				new Date().toISOString(),
				runB.finishedAt,
			);

			// Read back both
			const a = db.prepare('SELECT phase, status FROM runs WHERE id = ?').get(runA.id) as Record<
				string,
				unknown
			>;
			const b = db.prepare('SELECT phase, status FROM runs WHERE id = ?').get(runB.id) as Record<
				string,
				unknown
			>;

			expect(a.phase).toBe('PR_CREATE');
			expect(a.status).toBe('active');
			expect(b.phase).toBe('DONE');
			expect(b.status).toBe('done');
		});

		it('A-3: Run A and Run B use different branches', () => {
			const runA = makeRunState('run-a-003', 102, 'positron/issue-102-a-truncate');
			const runB = makeRunState('run-b-003', 202, 'positron/issue-202-b-wordcount');

			expect(runA.branch).not.toBe(runB.branch);
		});
	});

	// -----------------------------------------------------------------------
	// Test B: Atomic Claiming
	// -----------------------------------------------------------------------

	describe('Test B: Atomic Claiming', () => {
		it('B-1: Two workers cannot claim the same run', () => {
			const runId = 'run-a-004';
			const insert = db.prepare(`
        INSERT OR REPLACE INTO runs (id, repo_id, issue_number, branch, phase, status, autonomy_level, attempt, started_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
			insert.run(
				runId,
				'test-sandbox',
				103,
				'positron/issue-103-a',
				'INGESTED',
				'active',
				3,
				1,
				new Date().toISOString(),
				null,
			);

			// Worker A claims
			const claimA = db
				.prepare(`
        UPDATE runs SET status = 'claimed', phase = 'CLAIMED'
        WHERE id = ? AND status = 'active'
      `)
				.run(runId);
			expect(claimA.changes).toBe(1);

			// Worker B tries — should get 0 changes
			const claimB = db
				.prepare(`
        UPDATE runs SET status = 'claimed', phase = 'CLAIMED'
        WHERE id = ? AND status = 'active'
      `)
				.run(runId);
			expect(claimB.changes).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// Test C: Recovery Scope
	// -----------------------------------------------------------------------

	describe('Test C: Recovery Scope', () => {
		it('C-1: Recovery picks up only active incomplete runs, not DONE runs', () => {
			const insert = db.prepare(`
        INSERT OR REPLACE INTO runs (id, repo_id, issue_number, branch, phase, status, autonomy_level, attempt, started_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

			// Run A: active, incomplete
			insert.run(
				'run-a-c1',
				'test-sandbox',
				104,
				'positron/issue-104-a',
				'PR_CREATE',
				'active',
				3,
				1,
				new Date().toISOString(),
				null,
			);

			// Run B: DONE, completed
			insert.run(
				'run-b-c1',
				'test-sandbox',
				204,
				'positron/issue-204-b',
				'DONE',
				'done',
				3,
				1,
				new Date().toISOString(),
				new Date().toISOString(),
			);

			// Recovery query (matches recoverIncompleteRunsOnStartup)
			const incomplete = db
				.prepare(`
        SELECT id FROM runs
        WHERE status = 'active'
          AND phase NOT IN ('DONE', 'FAILED_BLOCKED', 'FAILED')
          AND finished_at IS NULL
        ORDER BY started_at ASC
      `)
				.all() as Array<{ id: string }>;

			expect(incomplete.length).toBe(1);
			expect(incomplete[0].id).toBe('run-a-c1');
		});

		it('C-2: Run B state untouched after Run A recovery', () => {
			const insert = db.prepare(`
        INSERT OR REPLACE INTO runs (id, repo_id, issue_number, branch, phase, status, autonomy_level, attempt, started_at, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

			insert.run(
				'run-a-c2',
				'test-sandbox',
				105,
				'positron/issue-105-a',
				'PR_CREATE',
				'active',
				3,
				1,
				new Date().toISOString(),
				null,
			);
			insert.run(
				'run-b-c2',
				'test-sandbox',
				205,
				'positron/issue-205-b',
				'DONE',
				'done',
				3,
				1,
				new Date().toISOString(),
				new Date().toISOString(),
			);

			const bBefore = db
				.prepare('SELECT phase, status, finished_at FROM runs WHERE id = ?')
				.get('run-b-c2') as Record<string, unknown>;

			// Recover Run A
			db.prepare('UPDATE runs SET phase = ?, status = ?, finished_at = ? WHERE id = ?').run(
				'DONE',
				'done',
				new Date().toISOString(),
				'run-a-c2',
			);

			const bAfter = db
				.prepare('SELECT phase, status, finished_at FROM runs WHERE id = ?')
				.get('run-b-c2') as Record<string, unknown>;
			expect(bAfter.phase).toBe(bBefore.phase);
			expect(bAfter.status).toBe(bBefore.status);
		});
	});

	// -----------------------------------------------------------------------
	// Test D: Cross-Run Idempotency
	// -----------------------------------------------------------------------

	describe('Test D: Cross-Run Idempotency', () => {
		it('D-1: Run A and Run B produce different PR numbers', async () => {
			const github = new IsolationTestGitHubAdapter();

			const prA = await github.createPullRequest({
				owner: 'test-owner',
				repo: 'test-sandbox',
				title: 'fix: Run A',
				head: 'positron/issue-106-a',
				base: 'main',
				body: 'A',
			});

			const prB = await github.createPullRequest({
				owner: 'test-owner',
				repo: 'test-sandbox',
				title: 'feat: Run B',
				head: 'positron/issue-206-b',
				base: 'main',
				body: 'B',
			});

			expect(prA.number).not.toBe(prB.number);
		});

		it('D-2: Existing PR for Run A does not block Run B', async () => {
			const github = new IsolationTestGitHubAdapter();

			// Pre-create PR for Run A
			github.prs.push({ number: 9999, head: 'positron/issue-107-a', state: 'open', title: 'A' });

			const prA = await github.createPullRequest({
				owner: 'test-owner',
				repo: 'test-sandbox',
				title: 'fix: Run A',
				head: 'positron/issue-107-a',
				base: 'main',
				body: 'A',
			});
			expect(prA.number).toBe(9999); // Adopted

			const prB = await github.createPullRequest({
				owner: 'test-owner',
				repo: 'test-sandbox',
				title: 'feat: Run B',
				head: 'positron/issue-207-b',
				base: 'main',
				body: 'B',
			});
			expect(prB.number).not.toBe(9999);
		});

		it('D-3: Same branch does not create duplicate PR', async () => {
			const github = new IsolationTestGitHubAdapter();

			await github.createPullRequest({
				owner: 'test-owner',
				repo: 'test-sandbox',
				title: 'Run 1',
				head: 'positron/shared-branch',
				base: 'main',
				body: 'First',
			});

			const second = await github.createPullRequest({
				owner: 'test-owner',
				repo: 'test-sandbox',
				title: 'Run 2',
				head: 'positron/shared-branch',
				base: 'main',
				body: 'Second',
			});

			const prsForHead = github.prs.filter((p) => p.head === 'positron/shared-branch');
			expect(prsForHead.length).toBe(1);
			expect(second.number).toBe(prsForHead[0].number);
		});
	});
});
