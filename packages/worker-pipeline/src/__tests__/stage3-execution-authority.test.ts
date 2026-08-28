import {
	acquireWorkspaceLock,
	applyControlPlaneMigrations,
	claimAttemptWithGeneration,
	createAttempt,
	createJob,
	enqueueItem,
	IdempotencyRegistry,
	reserveProviderSlot,
	updateQueueItem,
} from '@positron/control-plane';
import { STAGE3_CANONICAL } from '@positron/github-adapter';
import { applyMigrations, createRun } from '@positron/run-state';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createStage3ExecutionAuthorityProvider } from '../stage3-execution-authority.js';

let db: Database.Database;

function setup() {
	db = new Database(':memory:');
	applyMigrations(db);
	applyControlPlaneMigrations(db);
	db.prepare(
		`INSERT INTO repositories (id, owner, name, url, default_branch)
		 VALUES ('repo-308', 'Mueller-Systems-Lab', 'positron-308-sandbox', 'https://github.com/Mueller-Systems-Lab/positron-308-sandbox', 'main')`,
	).run();
	const run = createRun(STAGE3_CANONICAL.repository, 308, 2);
	db.prepare(
		`INSERT INTO runs (id, repo_id, issue_number, phase, status, autonomy_level, attempt, started_at)
		 VALUES (?, 'repo-308', 308, 'COMMIT', 'active', 2, 1, ?)`,
	).run(run.id, run.startedAt);
	const queue = enqueueItem(db, {
		source_type: 'github-issue',
		source_ref: `issue#308-${run.id}`,
		repository_ref: STAGE3_CANONICAL.repository,
		provider: 'github',
	});
	updateQueueItem(db, queue.queue_item_id, {
		queue_state: 'RUNNING',
		run_id: run.id,
		started_at: new Date().toISOString(),
	});
	const lock = acquireWorkspaceLock(db, STAGE3_CANONICAL.repository, queue.queue_item_id, 60_000);
	const reservation = reserveProviderSlot(db, {
		provider: 'github',
		ownerId: queue.queue_item_id,
		runId: run.id,
	});
	const job = createJob(db, run.id, 'stage3-pilot');
	const attempt = createAttempt(db, run.id, job.job_id, { status: 'pending' });
	const ownerId = 'ctl:authority-test';
	const claim = claimAttemptWithGeneration(db, attempt.attempt_id, {
		ownerId,
		leaseTtlMs: 60_000,
	});
	const idempotencyKey = `${run.id}:${job.job_id}:${attempt.attempt_id}`;
	expect(new IdempotencyRegistry(db).claim(idempotencyKey)).toBe(true);
	return {
		run,
		queue,
		job,
		attempt,
		ownerId,
		generation: claim.generation,
		lockGeneration: lock.generation,
		reservationId: reservation.reservation_id,
		identity: {
			runId: run.id,
			queueItemId: queue.queue_item_id,
			jobId: job.job_id,
			attemptId: attempt.attempt_id,
			workspaceKey: STAGE3_CANONICAL.repository,
			attemptLeaseOwnerId: ownerId,
			attemptLeaseGeneration: claim.generation,
			workspaceLockOwnerId: queue.queue_item_id,
			workspaceLockGeneration: lock.generation,
			providerReservationId: reservation.reservation_id,
			idempotencyKey,
		},
	};
}

describe('Stage3 authoritative execution authority', () => {
	afterEach(() => db.close());

	it('reads a valid current identity from the durable control plane', async () => {
		const { identity } = setup();
		const result = await createStage3ExecutionAuthorityProvider(db).revalidate(identity);
		expect(result.valid).toBe(true);
		expect(result.currentIdentity).toEqual(identity);
	});

	it.each([
		[
			'lease owner changed',
			(s: ReturnType<typeof setup>) =>
				db
					.prepare('UPDATE cp_attempts SET lease_owner_id = ? WHERE attempt_id = ?')
					.run('other-owner', s.attempt.attempt_id),
		],
		[
			'lease generation changed',
			(s: ReturnType<typeof setup>) =>
				db
					.prepare(
						'UPDATE cp_attempts SET lease_generation = lease_generation + 1 WHERE attempt_id = ?',
					)
					.run(s.attempt.attempt_id),
		],
		[
			'workspace lock released',
			(s: ReturnType<typeof setup>) =>
				db
					.prepare('UPDATE cp_workspace_locks SET released_at = ? WHERE workspace_key = ?')
					.run(new Date().toISOString(), STAGE3_CANONICAL.repository),
		],
		[
			'workspace lock owner changed',
			(s: ReturnType<typeof setup>) =>
				db
					.prepare('UPDATE cp_workspace_locks SET owner_id = ? WHERE workspace_key = ?')
					.run('other-owner', STAGE3_CANONICAL.repository),
		],
		[
			'provider reservation released',
			(s: ReturnType<typeof setup>) =>
				db
					.prepare(
						"UPDATE cp_provider_reservations SET status = 'released' WHERE reservation_id = ?",
					)
					.run(s.reservationId),
		],
		[
			'provider reservation identity changed',
			(s: ReturnType<typeof setup>) =>
				db
					.prepare(
						'UPDATE cp_provider_reservations SET reservation_id = ? WHERE reservation_id = ?',
					)
					.run('other-reservation', s.reservationId),
		],
		[
			'attempt completed',
			(s: ReturnType<typeof setup>) =>
				db
					.prepare("UPDATE cp_attempts SET status = 'succeeded' WHERE attempt_id = ?")
					.run(s.attempt.attempt_id),
		],
		[
			'queue target changed',
			(s: ReturnType<typeof setup>) =>
				db
					.prepare('UPDATE cp_queue SET repository_ref = ? WHERE queue_item_id = ?')
					.run('other/repository', s.queue.queue_item_id),
		],
		[
			'idempotency completed',
			(s: ReturnType<typeof setup>) =>
				db
					.prepare("UPDATE cp_idempotency SET state = 'completed' WHERE idem_key = ?")
					.run(s.identity.idempotencyKey),
		],
	])('%s fails closed before a writer call', async (_name, mutate) => {
		const state = setup();
		mutate(state);
		let writerCalls = 0;
		const result = await createStage3ExecutionAuthorityProvider(db).revalidate(state.identity);
		if (result.valid) writerCalls++;
		expect(result.valid).toBe(false);
		expect(writerCalls).toBe(0);
		expect(result.reason).toBeTruthy();
	});
});
