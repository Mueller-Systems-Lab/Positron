import {
	acquireWorkspaceLock,
	applyControlPlaneMigrations,
	claimAttemptWithGeneration,
	completeAttempt,
	createAttempt,
	createJob,
	enqueueItem,
	reserveProviderSlot,
	updateJobState,
	updateQueueItem,
} from '@positron/control-plane';
import type { Stage3CanonicalLiveExecutor, Stage3HarnessResult } from '@positron/github-adapter';
import { FakeGitHubAdapter, STAGE3_CANONICAL } from '@positron/github-adapter';
import { FakeOpenCodeAdapter } from '@positron/opencode-adapter';
import type { GateRuntimeMode, RunState } from '@positron/run-state';
import {
	applyMigrations,
	assembleGateEvaluators,
	clearGateEvaluators,
	createRun,
} from '@positron/run-state';
import { FakeGitWorkspaceAdapter } from '@positron/sandbox';
import { FakeSpecKitAdapter } from '@positron/speckit-adapter';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runPipeline } from '../index.js';
import type { PipelineDeps } from '../pipeline-runner.js';

function successfulPilotResult(): Stage3HarnessResult {
	return {
		success: true,
		policyAllowed: true,
		allOperationsExecuted: true,
		auditEvents: [],
		mode: 'live',
		writeExecuted: true,
		writeAttempted: true,
		confirmedMutationCount: 3,
		partialMutation: false,
		auditIntegrityBroken: false,
		mutationState: 'complete-verified',
		currentPhase: 'verify',
		branchCount: 1,
		fileWriteCount: 1,
		commitCount: 1,
		pullRequestCount: 1,
		branchCreated: true,
		fileCommitted: true,
		pullRequestCreated: true,
		pullRequestDraft: true,
		branchResult: { ref: `refs/heads/${STAGE3_CANONICAL.targetBranch}`, sha: 'b'.repeat(40) },
		commitResult: { sha: 'c'.repeat(40), url: 'https://github.com/example/commit/c' },
		prResult: {
			number: 308,
			url: 'https://github.com/example/pull/308',
			draft: true,
		},
	};
}

describe('Issue #308 canonical Stage 3 pipeline integration', () => {
	let db: Database.Database;

	beforeAll(() => {
		clearGateEvaluators();
		assembleGateEvaluators('fixture');
	});

	afterAll(() => {
		clearGateEvaluators();
		db?.close();
	});

	it('routes COMMIT → PR_CREATE → MERGE through the bounded executor', async () => {
		db = new Database(':memory:');
		applyMigrations(db);
		applyControlPlaneMigrations(db);

		const run: RunState = {
			...createRun(STAGE3_CANONICAL.repository, 308, 2),
			phase: 'COMMIT',
			status: 'active',
			branch: STAGE3_CANONICAL.targetBranch,
		};
		const queue = enqueueItem(db, {
			source_type: 'github-issue',
			source_ref: 'issue#308-stage3-test',
			repository_ref: STAGE3_CANONICAL.repository,
			provider: 'github',
		});
		updateQueueItem(db, queue.queue_item_id, {
			queue_state: 'RUNNING',
			run_id: run.id,
			admitted_at: new Date().toISOString(),
			started_at: new Date().toISOString(),
		});
		acquireWorkspaceLock(db, STAGE3_CANONICAL.repository, queue.queue_item_id, 60_000);
		reserveProviderSlot(db, {
			provider: 'github',
			ownerId: queue.queue_item_id,
			runId: run.id,
		});

		const buildJob = createJob(db, run.id, 'build');
		const buildAttempt = createAttempt(db, run.id, buildJob.job_id, { status: 'pending' });
		const buildOwner = 'build-owner';
		const buildClaim = claimAttemptWithGeneration(db, buildAttempt.attempt_id, {
			ownerId: buildOwner,
			leaseTtlMs: 60_000,
		});
		completeAttempt(
			db,
			buildAttempt.attempt_id,
			{ status: 'succeeded', result_ref: 'build-ok' },
			{ fencingOwnerId: buildOwner, fencingGeneration: buildClaim.generation },
		);
		updateJobState(db, buildJob.job_id, 'succeeded');

		const workspace = new FakeGitWorkspaceAdapter();
		const github = new FakeGitHubAdapter();
		const commitSpy = vi.spyOn(workspace, 'commit');
		const prSpy = vi.spyOn(github, 'createPullRequest');
		const execute = vi.fn(
			async ({ executionIdentity }: Parameters<Stage3CanonicalLiveExecutor['execute']>[0]) => {
				expect(executionIdentity.runId).toBe(run.id);
				expect(executionIdentity.queueItemId).toBe(queue.queue_item_id);
				expect(executionIdentity.jobId).not.toBe(buildJob.job_id);
				return successfulPilotResult();
			},
		);
		const stage3Pilot: Stage3CanonicalLiveExecutor = { execute };
		const deps: PipelineDeps = {
			db,
			repository: {
				owner: 'Mueller-Systems-Lab',
				repo: 'positron-308-sandbox',
				defaultBranch: 'main',
			},
			workspace,
			speckit: new FakeSpecKitAdapter(),
			opencode: new FakeOpenCodeAdapter(),
			github,
			stage3Pilot,
			gateRuntimeMode: 'fixture' as GateRuntimeMode,
		};

		const result = await runPipeline(run, deps);

		expect(result.phase).toBe('DONE');
		expect(execute).toHaveBeenCalledTimes(1);
		expect(commitSpy).not.toHaveBeenCalled();
		expect(prSpy).not.toHaveBeenCalled();
		expect(
			db
				.prepare(
					"SELECT COUNT(*) AS count FROM run_events WHERE run_id = ? AND message = 'STAGE3_CANONICAL_PILOT_COMPLETED'",
				)
				.get(run.id),
		).toEqual({ count: 1 });
		expect(
			db
				.prepare("SELECT state FROM cp_jobs WHERE run_id = ? AND job_type = 'stage3-pilot'")
				.get(run.id),
		).toMatchObject({
			state: 'succeeded',
		});
	});
});
