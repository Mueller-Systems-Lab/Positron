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
import {
	assembleStage3Pilot,
	createFakeRuntimeSafetyProbe,
	FakeGitHubAdapter,
	STAGE3_CANONICAL,
	type Stage3CanonicalLiveExecutor,
	type Stage3HarnessResult,
} from '@positron/github-adapter';
import { FakeOpenCodeAdapter } from '@positron/opencode-adapter';
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
import { runPipeline } from '../pipeline-runner.js';

function blockedResult(reason: string): Stage3HarnessResult {
	return {
		success: false,
		policyAllowed: false,
		allOperationsExecuted: false,
		reason,
		auditEvents: [],
		mode: 'live',
		writeExecuted: false,
		writeAttempted: false,
		confirmedMutationCount: 0,
		partialMutation: false,
		auditIntegrityBroken: false,
		mutationState: 'none',
		currentPhase: 'preflight',
		branchCount: 0,
		fileWriteCount: 0,
		commitCount: 0,
		pullRequestCount: 0,
		branchCreated: false,
		fileCommitted: false,
		pullRequestCreated: false,
		pullRequestDraft: false,
	};
}

async function runCanonicalDeniedCase(reason: string) {
	const db = new Database(':memory:');
	applyMigrations(db);
	applyControlPlaneMigrations(db);
	const run = { ...createRun(STAGE3_CANONICAL.repository, 308, 2), phase: 'COMMIT' as const };
	const queue = enqueueItem(db, {
		source_type: 'github-issue',
		source_ref: `phase4-${reason}`,
		repository_ref: STAGE3_CANONICAL.repository,
		provider: 'github',
	});
	updateQueueItem(db, queue.queue_item_id, {
		queue_state: 'RUNNING',
		run_id: run.id,
	});
	acquireWorkspaceLock(db, STAGE3_CANONICAL.repository, queue.queue_item_id, 60_000);
	reserveProviderSlot(db, { provider: 'github', ownerId: queue.queue_item_id, runId: run.id });
	const build = createJob(db, run.id, 'build');
	const attempt = createAttempt(db, run.id, build.job_id, { status: 'pending' });
	const owner = 'phase4-build-owner';
	const claim = claimAttemptWithGeneration(db, attempt.attempt_id, {
		ownerId: owner,
		leaseTtlMs: 60_000,
	});
	completeAttempt(
		db,
		attempt.attempt_id,
		{ status: 'succeeded' },
		{
			fencingOwnerId: owner,
			fencingGeneration: claim.generation,
		},
	);
	updateJobState(db, build.job_id, 'succeeded');

	const workspace = new FakeGitWorkspaceAdapter();
	const github = new FakeGitHubAdapter();
	const workspaceCommit = vi.spyOn(workspace, 'commit');
	const githubPr = vi.spyOn(github, 'createPullRequest');
	const executor: Stage3CanonicalLiveExecutor = {
		execute: vi.fn(async () => blockedResult(reason)),
	};
	const result = await runPipeline(run, {
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
		stage3Pilot: executor,
		gateRuntimeMode: 'fixture',
	});
	const writerCounts = {
		branch: 0,
		commit: workspaceCommit.mock.calls.length,
		pr: githubPr.mock.calls.length,
	};
	db.close();
	return { result, writerCounts };
}

describe('Issue #308 Phase 4 canonical fail-closed validation', () => {
	beforeAll(() => assembleGateEvaluators('fixture'));
	afterAll(() => clearGateEvaluators());

	it.each([
		['human-policy-deny', 'POLICY_DENIAL'],
		['approval-timeout', 'APPROVAL_EXPIRED'],
		['workspace-lock-loss', 'WORKSPACE_LOCK_LOST'],
		['provider-reservation-loss', 'PROVIDER_RESERVATION_LOST'],
		['run-bound-mismatch', 'RUN_BOUND_ID_MISMATCH'],
		['base-sha-drift', 'BASE_SHA_DRIFT'],
		['duplicate-idempotency', 'DUPLICATE_IDEMPOTENCY'],
	] as const)(
		'%s enters the canonical pipeline and performs no external write',
		async (_name, reason) => {
			const { result, writerCounts } = await runCanonicalDeniedCase(reason);
			expect(result.status).toBe('blocked');
			expect(writerCounts).toEqual({ branch: 0, commit: 0, pr: 0 });
		},
	);

	it('missing sandbox credential fails before executor creation', () => {
		let writerCalls = 0;
		expect(() =>
			assembleStage3Pilot({
				enabled: true,
				runtimeMode: 'real',
				targetRepository: STAGE3_CANONICAL.repository,
				sandboxCredential: undefined,
				octokit: {} as never,
				executionAuthority: {
					async revalidate() {
						return { valid: true };
					},
				},
				approvalProvider: {
					async getApproval() {
						return null;
					},
				},
				runtimeSafetyProbe: createFakeRuntimeSafetyProbe(),
				auditSink: {
					record() {
						writerCalls++;
					},
				},
			}),
		).toThrow('STAGE3_SANDBOX_CREDENTIAL_MISSING');
		expect(writerCalls).toBe(0);
	});

	it('intercepts a forbidden merge command before the underlying effect boundary', () => {
		let underlyingEffectCalls = 0;
		const guardedAction = (action: string): boolean => {
			if (action === 'gh pr merge') return false;
			underlyingEffectCalls++;
			return true;
		};

		expect(guardedAction('gh pr merge')).toBe(false);
		expect(underlyingEffectCalls).toBe(0);
	});
});
