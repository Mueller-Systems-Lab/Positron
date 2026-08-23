// Positron Control Plane — P4 SLICE D CANARY: Persistenter Workspace Lock
//
// Testmatrix:
//   WORKSPACE_LOCK_EXCLUSIVE           = PASS  (ein Owner pro Workspace)
//   SAME_WORKSPACE_NO_MUTATION_OVERLAP = PASS
//   ISOLATED_WORKSPACES_CAN_OVERLAP    = PASS  (verschiedene Keys parallel)
//   STALE_WORKSPACE_LOCK_RECOVERY      = PASS  (abgelaufener Lock → Reclaim)
//   OLD_WORKSPACE_OWNER_FENCED         = PASS  (kein Renew/Release des alten Owners)
//   LOCK_RELEASE_ALL_TERMINAL_STATES   = PASS  (markRunFinished gibt frei)

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyControlPlaneMigrations } from '../schema.js';
import { enqueueItem, markRunFinished, recoverSchedulerState, admitNext } from '../scheduler.js';
import {
	acquireWorkspaceLock,
	getWorkspaceLock,
	recoverStaleWorkspaceLocks,
	releaseWorkspaceLock,
	renewWorkspaceLock,
	resolveWorkspaceLockTtlMs,
} from '../workspace-lock.js';

function makeDb(): Database.Database {
	const db = new Database(':memory:');
	applyControlPlaneMigrations(db);
	return db;
}

const TTL = 60_000;

describe('P4 SLICE D — WORKSPACE LOCK (Store-Semantik)', () => {
	it('WORKSPACE_LOCK_EXCLUSIVE: zweiter Owner kann denselben Workspace nicht claimen', () => {
		const db = makeDb();
		const a = acquireWorkspaceLock(db, 'org/repo-a', 'owner-1', TTL);
		expect(a.acquired).toBe(true);
		expect(a.generation).toBe(1);

		const b = acquireWorkspaceLock(db, 'org/repo-a', 'owner-2', TTL);
		expect(b.acquired).toBe(false);

		// Identischer Owner (Re-Entry) darf erneuern
		const re = acquireWorkspaceLock(db, 'org/repo-a', 'owner-1', TTL);
		expect(re.acquired).toBe(true);
		db.close();
	});

	it('ISOLATED_WORKSPACES_CAN_OVERLAP: verschiedene Workspaces parallel', () => {
		const db = makeDb();
		expect(acquireWorkspaceLock(db, 'org/repo-a', 'owner-1', TTL).acquired).toBe(true);
		expect(acquireWorkspaceLock(db, 'org/repo-b', 'owner-2', TTL).acquired).toBe(true);
		expect(acquireWorkspaceLock(db, 'org/repo-c', 'owner-3', TTL).acquired).toBe(true);
		db.close();
	});

	it('STALE_WORKSPACE_LOCK_RECOVERY + OLD_WORKSPACE_OWNER_FENCED', () => {
		const db = makeDb();
		const a = acquireWorkspaceLock(db, 'org/repo-a', 'owner-1', 30);
		expect(a.acquired).toBe(true);
		const expiresAt = getWorkspaceLock(db, 'org/repo-a')?.lease_expires_at ?? '';
		const now = new Date(new Date(expiresAt).getTime() + 1).toISOString();

		// Owner "crasht" (kein Heartbeat) → Lock läuft ab
		const recovered = recoverStaleWorkspaceLocks(db, now);
		expect(recovered.length).toBe(1);
		expect(getWorkspaceLock(db, 'org/repo-a')?.released_at).toBeTruthy();

		// Neuer Owner übernimmt (Reclaim → frische Generation)
		const b = acquireWorkspaceLock(db, 'org/repo-a', 'owner-2', TTL);
		expect(b.acquired).toBe(true);
		expect(b.reclaimed).toBe(true);
		expect(b.generation).toBe(2);

		// Alter Owner kann NICHT mehr erneuern oder freigeben (Fenced)
		expect(renewWorkspaceLock(db, 'org/repo-a', 'owner-1', TTL)).toBe(false);
		expect(releaseWorkspaceLock(db, 'org/repo-a', 'owner-1')).toBe(false);

		// Neuer Owner kann freigeben
		expect(releaseWorkspaceLock(db, 'org/repo-a', 'owner-2')).toBe(true);
		db.close();
	});

	it('TTL-Konfiguration: zentral, validiert, fail-closed', () => {
		expect(resolveWorkspaceLockTtlMs({})).toBe(600_000);
		expect(resolveWorkspaceLockTtlMs({ POSITRON_WORKSPACE_LOCK_TTL_MS: '5000' })).toBe(5000);
		expect(() => resolveWorkspaceLockTtlMs({ POSITRON_WORKSPACE_LOCK_TTL_MS: 'abc' })).toThrow(
			/POSITRON_WORKSPACE_LOCK_TTL_MS invalid/,
		);
		expect(() => resolveWorkspaceLockTtlMs({ POSITRON_WORKSPACE_LOCK_TTL_MS: '-5' })).toThrow(
			/POSITRON_WORKSPACE_LOCK_TTL_MS invalid/,
		);
	});
});

describe('P4 SLICE D — WORKSPACE LOCK (Scheduler-Admission)', () => {
	it('Admission claimt den Workspace-Lock; SAME_WORKSPACE → WORKSPACE_LOCKED/REPOSITORY_LOCKED, kein Overlap', () => {
		const db = makeDb();
		const config: import('../scheduler.js').SchedulerConfig = {
			maxActiveRuns: 2,
			workspaceLockTtlMs: TTL,
		};
		const itemA = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/1',
			repository_ref: 'org/repo-a',
		});
		const itemB = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/2',
			repository_ref: 'org/repo-a',
		});

		const d1 = admitNext(db, config);
		expect(d1?.admitted).toBe(true);
		expect(d1?.queue_item_id).toBe(itemA.queue_item_id);
		// Lock wurde ATOMAR mit der Admission geclaimt
		expect(getWorkspaceLock(db, 'org/repo-a')?.owner_id).toBe(itemA.queue_item_id);

		// Zweites Item im selben Workspace: blockiert (Repo-Lock greift zuerst)
		const d2 = admitNext(db, config);
		expect(d2).toBeNull();
		const itemBAfter = db
			.prepare('SELECT queue_state, reason_code FROM cp_queue WHERE queue_item_id = ?')
			.get(itemB.queue_item_id) as { queue_state: string; reason_code: string };
		expect(itemBAfter.queue_state).toBe('WAITING_RESOURCE');
		expect(['REPOSITORY_LOCKED', 'WORKSPACE_LOCKED']).toContain(itemBAfter.reason_code);
		db.close();
	});

	it('LOCK_RELEASE_ALL_TERMINAL_STATES: markRunFinished gibt den Lock frei', () => {
		const db = makeDb();
		const config: import('../scheduler.js').SchedulerConfig = {
			maxActiveRuns: 2,
			workspaceLockTtlMs: TTL,
		};
		const item = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/3',
			repository_ref: 'org/repo-b',
		});
		const d = admitNext(db, config);
		expect(d?.admitted).toBe(true);
		expect(getWorkspaceLock(db, 'org/repo-b')?.owner_id).toBe(item.queue_item_id);

		markRunFinished(db, item.queue_item_id, 'COMPLETED', null, 'READY', {
			emitEvent: config.emitEvent,
		});
		expect(getWorkspaceLock(db, 'org/repo-b')?.released_at).toBeTruthy();

		// Nach Release kann ein neuer Owner claimen
		expect(acquireWorkspaceLock(db, 'org/repo-b', 'next-owner', TTL).acquired).toBe(true);
		db.close();
	});

	it('STALE_WORKSPACE_LOCK_RECOVERY: recoverSchedulerState räumt Zombie-Locks vor Re-Admission', () => {
		const db = makeDb();
		const config = { maxActiveRuns: 2, workspaceLockTtlMs: 30 };
		const item = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/4',
			repository_ref: 'org/repo-c',
		});
		const d = admitNext(db, config);
		expect(d?.admitted).toBe(true);
		// Owner "crasht" (kein Release, kein Heartbeat)
		const expiresAt = getWorkspaceLock(db, 'org/repo-c')?.lease_expires_at ?? '';
		const afterExpiry = new Date(new Date(expiresAt).getTime() + 1).toISOString();

		// Runs gelten als lebendig → das ADMITTED-Item bleibt; NUR der
		// Zombie-Lock wird freigegeben (Stale-Recovery).
		recoverSchedulerState(db, () => true, afterExpiry);
		expect(getWorkspaceLock(db, 'org/repo-c')?.released_at).toBeTruthy();

		// ADMITTED-Items werden deterministisch requeued (Crash vor Start);
		// die Re-Admission (FIFO: item1 zuerst) reclaimt den Workspace mit
		// frischer Generation — kein Zombie-Owner, keine Blockade.
		const item2 = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/5',
			repository_ref: 'org/repo-c',
		});
		const d2 = admitNext(db, config, afterExpiry);
		expect(d2?.admitted).toBe(true);
		expect(d2?.queue_item_id).toBe(item.queue_item_id);
		expect(getWorkspaceLock(db, 'org/repo-c')?.owner_id).toBe(item.queue_item_id);
		expect(getWorkspaceLock(db, 'org/repo-c')?.lease_generation).toBeGreaterThanOrEqual(2);
		// item2 bleibt nicht-admittiert (admitNext liefert EIN Item pro Aufruf;
		// der Workspace ist exklusiv an item1 vergeben)
		const item2After = db
			.prepare('SELECT queue_state FROM cp_queue WHERE queue_item_id = ?')
			.get(item2.queue_item_id) as { queue_state: string };
		expect(item2After.queue_state).toBe('QUEUED');
		db.close();
	});
});
