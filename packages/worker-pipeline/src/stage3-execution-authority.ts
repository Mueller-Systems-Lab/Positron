import type {
	Stage3ExecutionAuthorityProvider,
	Stage3ApprovalConsumptionInput,
	Stage3ExecutionIdentity,
} from '@positron/github-adapter';
import { persistApprovalConsumption as persistDurableApprovalConsumption } from '@positron/control-plane';
import type Database from 'better-sqlite3';

type IdentityRow = {
	run_id: string;
	run_status: string;
	run_finished_at: string | null;
	queue_item_id: string;
	repository_ref: string;
	queue_state: string;
	job_id: string;
	job_state: string;
	attempt_id: string;
	attempt_status: string;
	attempt_lease_owner_id: string | null;
	attempt_lease_generation: number;
	attempt_lease_expires_at: string | null;
	workspace_key: string | null;
	workspace_lock_owner_id: string | null;
	workspace_lock_generation: number | null;
	workspace_lock_expires_at: string | null;
	workspace_lock_released_at: string | null;
	reservation_id: string | null;
	reservation_owner_id: string | null;
	reservation_run_id: string | null;
	reservation_status: string | null;
	idempotency_state: string | null;
};

function isLiveExpiry(expiry: string | null, now: number): boolean {
	return expiry === null || new Date(expiry).getTime() > now;
}

function currentIdentity(row: IdentityRow): Stage3ExecutionIdentity {
	return {
		runId: row.run_id,
		queueItemId: row.queue_item_id,
		jobId: row.job_id,
		attemptId: row.attempt_id,
		workspaceKey: row.workspace_key ?? '',
		attemptLeaseOwnerId: row.attempt_lease_owner_id ?? '',
		attemptLeaseGeneration: Number(row.attempt_lease_generation),
		workspaceLockOwnerId: row.workspace_lock_owner_id ?? '',
		workspaceLockGeneration: Number(row.workspace_lock_generation),
		providerReservationId: row.reservation_id ?? '',
		idempotencyKey: `${row.run_id}:${row.job_id}:${row.attempt_id}`,
	};
}

/**
 * The canonical pipeline's read-only authority provider.
 *
 * This is intentionally implemented beside the durable pipeline, not in the
 * GitHub adapter. Every call queries current SQLite rows; no snapshot is
 * retained between preflight and an external mutation.
 */
export function createStage3ExecutionAuthorityProvider(
	db: Database.Database,
): Stage3ExecutionAuthorityProvider {
	return {
		async persistApprovalConsumption(input: Stage3ApprovalConsumptionInput) {
			const record = persistDurableApprovalConsumption(db, input);
			return { consumptionId: record.consumption_id };
		},
		async revalidate(boundIdentity) {
			const row = db
				.prepare(
					`SELECT
						r.id AS run_id, r.status AS run_status, r.finished_at AS run_finished_at,
						q.queue_item_id, q.repository_ref, q.queue_state,
						j.job_id, j.state AS job_state,
						a.attempt_id, a.status AS attempt_status,
						a.lease_owner_id AS attempt_lease_owner_id,
						a.lease_generation AS attempt_lease_generation,
						a.lease_expires_at AS attempt_lease_expires_at,
						w.workspace_key,
						w.owner_id AS workspace_lock_owner_id,
						w.lease_generation AS workspace_lock_generation,
						w.lease_expires_at AS workspace_lock_expires_at,
						w.released_at AS workspace_lock_released_at,
						p.reservation_id,
						p.owner_id AS reservation_owner_id,
						p.run_id AS reservation_run_id,
						p.status AS reservation_status,
						i.state AS idempotency_state
					 FROM runs r
					 JOIN cp_queue q ON q.queue_item_id = ? AND q.run_id = r.id
					 JOIN cp_jobs j ON j.job_id = ? AND j.run_id = r.id
					 JOIN cp_attempts a ON a.attempt_id = ? AND a.job_id = j.job_id AND a.run_id = r.id
					 LEFT JOIN cp_workspace_locks w ON w.workspace_key = q.repository_ref
					 LEFT JOIN cp_provider_reservations p ON p.reservation_id = ?
					 LEFT JOIN cp_idempotency i ON i.idem_key = ?`,
				)
				.get(
					boundIdentity.queueItemId,
					boundIdentity.jobId,
					boundIdentity.attemptId,
					boundIdentity.providerReservationId,
					boundIdentity.idempotencyKey,
				) as IdentityRow | undefined;

			if (!row) return { valid: false, reason: 'STAGE3_CURRENT_AUTHORITY_NOT_FOUND' };
			const identity = currentIdentity(row);
			const now = Date.now();
			const failures: string[] = [];
			if (row.repository_ref !== 'Mueller-Systems-Lab/positron-308-sandbox') {
				failures.push('queue target changed');
			}
			if (row.run_status !== 'active' || row.run_finished_at !== null) {
				failures.push('run is no longer active');
			}
			if (row.queue_state !== 'RUNNING') failures.push('queue item is not running');
			if (row.job_state !== 'pending' && row.job_state !== 'running') {
				failures.push('job is no longer executable');
			}
			if (row.queue_item_id !== boundIdentity.queueItemId) failures.push('queue item changed');
			if (row.run_id !== boundIdentity.runId || row.run_id === '') failures.push('run changed');
			if (row.job_id !== boundIdentity.jobId || row.job_id === '') failures.push('job changed');
			if (row.attempt_id !== boundIdentity.attemptId) failures.push('attempt changed');
			if (row.attempt_status !== 'running') failures.push('attempt is not running');
			if (
				row.attempt_lease_owner_id !== boundIdentity.attemptLeaseOwnerId ||
				row.attempt_lease_generation !== boundIdentity.attemptLeaseGeneration
			) {
				failures.push('attempt lease fence changed');
			}
			if (!row.attempt_lease_owner_id || !isLiveExpiry(row.attempt_lease_expires_at, now)) {
				failures.push('attempt lease expired or missing');
			}
			if (row.workspace_key !== boundIdentity.workspaceKey) failures.push('workspace changed');
			if (row.workspace_lock_owner_id !== boundIdentity.workspaceLockOwnerId) {
				failures.push('workspace lock owner changed');
			}
			if (row.workspace_lock_generation !== boundIdentity.workspaceLockGeneration) {
				failures.push('workspace lock generation changed');
			}
			if (
				row.workspace_lock_released_at !== null ||
				!isLiveExpiry(row.workspace_lock_expires_at, now)
			) {
				failures.push('workspace lock released or expired');
			}
			if (
				row.reservation_id !== boundIdentity.providerReservationId ||
				row.reservation_owner_id !== boundIdentity.queueItemId ||
				row.reservation_run_id !== boundIdentity.runId ||
				row.reservation_status !== 'reserved'
			) {
				failures.push('provider reservation changed or released');
			}
			if (row.idempotency_state !== 'claimed') failures.push('idempotency key is not claimed');
			if (identity.idempotencyKey !== boundIdentity.idempotencyKey) {
				failures.push('idempotency key changed');
			}

			return failures.length === 0
				? { valid: true, currentIdentity: identity }
				: {
						valid: false,
						currentIdentity: identity,
						reason: failures.join('; '),
					};
		},
	};
}
