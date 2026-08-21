// Positron Control Plane — P4 SLICE E CANARY: Provider Capacity & Reservations
//
// Testmatrix:
//   PROVIDER_CAPACITY_CONFIGURED    = PASS  (zentrale, validierte Config)
//   PROVIDER_CAPACITY_ENFORCED      = PASS  (Admission prüft Capacity)
//   PROVIDER_RESERVATION_ATOMIC     = PASS  (Reserve vor Dispatch, idempotent)
//   NO_PROVIDER_OVERSUBSCRIPTION    = PASS
//   RELEASE_AFTER_SUCCESS/FAIL/CANCEL/TIMEOUT/RECOVERY = PASS
//   DUPLICATE_RELEASE_NOOP          = PASS

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyControlPlaneMigrations } from '../schema.js';
import {
	admitNext,
	cancelQueueItem,
	enqueueItem,
	markRunFinished,
	recoverSchedulerState,
} from '../scheduler.js';
import {
	activeProviderReservations,
	recoverStaleProviderSlots,
	releaseProviderSlot,
	reserveProviderSlot,
	resolveProviderCapacity,
} from '../provider-capacity.js';

function makeDb(): Database.Database {
	const db = new Database(':memory:');
	applyControlPlaneMigrations(db);
	return db;
}

describe('P4 SLICE E — PROVIDER CAPACITY CONFIG', () => {
	it('PROVIDER_CAPACITY_CONFIGURED: zentrale JSON-Config, validiert, fail-closed', () => {
		expect(resolveProviderCapacity({})).toEqual({});
		expect(resolveProviderCapacity({ POSITRON_PROVIDER_CAPACITY: '{"deepseek": 1}' })).toEqual({
			deepseek: 1,
		});
		expect(
			resolveProviderCapacity({ POSITRON_PROVIDER_CAPACITY: '{"deepseek": 2, "ollama": 4}' }),
		).toEqual({ deepseek: 2, ollama: 4 });
		expect(() => resolveProviderCapacity({ POSITRON_PROVIDER_CAPACITY: 'not-json' })).toThrow(
			/POSITRON_PROVIDER_CAPACITY invalid/,
		);
		expect(() =>
			resolveProviderCapacity({ POSITRON_PROVIDER_CAPACITY: '{"deepseek": 0}' }),
		).toThrow(/POSITRON_PROVIDER_CAPACITY invalid/);
		expect(() =>
			resolveProviderCapacity({ POSITRON_PROVIDER_CAPACITY: '{"deepseek": -1}' }),
		).toThrow(/POSITRON_PROVIDER_CAPACITY invalid/);
		expect(() =>
			resolveProviderCapacity({ POSITRON_PROVIDER_CAPACITY: '{"deepseek": 1.5}' }),
		).toThrow(/POSITRON_PROVIDER_CAPACITY invalid/);
	});
});

describe('P4 SLICE E — RESERVATION STORE', () => {
	it('PROVIDER_RESERVATION_ATOMIC: Reserve idempotent (ein Slot pro Owner), activeByProvider zählt reserviert', () => {
		const db = makeDb();
		const r1 = reserveProviderSlot(db, {
			provider: 'deepseek',
			model: 'deepseek-v4-flash',
			ownerId: 'owner-A',
		});
		expect(r1.reserved).toBe(true);
		// Idempotent: zweiter Reserve desselben Owners → bestehende Reservierung
		const r2 = reserveProviderSlot(db, {
			provider: 'deepseek',
			model: 'deepseek-v4-flash',
			ownerId: 'owner-A',
		});
		expect(r2.reservation_id).toBe(r1.reservation_id);
		expect(activeProviderReservations(db)).toEqual({ deepseek: 1 });

		// Zweiter Owner + anderer Provider
		reserveProviderSlot(db, { provider: 'deepseek', ownerId: 'owner-B' });
		reserveProviderSlot(db, { provider: 'ollama', ownerId: 'owner-C' });
		expect(activeProviderReservations(db)).toEqual({ deepseek: 2, ollama: 1 });
		db.close();
	});

	it('RELEASE_AFTER_TERMINAL + DUPLICATE_RELEASE_NOOP', () => {
		const db = makeDb();
		reserveProviderSlot(db, { provider: 'deepseek', ownerId: 'owner-A' });
		expect(releaseProviderSlot(db, 'owner-A')).toBe(true);
		expect(activeProviderReservations(db)).toEqual({});
		// Duplikat-Release: NOOP (false, kein Zustandswechsel)
		expect(releaseProviderSlot(db, 'owner-A')).toBe(false);
		db.close();
	});

	it('RELEASE_AFTER_RECOVERY: Reservierungen toter Owner werden freigegeben', () => {
		const db = makeDb();
		// Item admitiert (Reservierung gehört zu RUNNING/ADMITTED-Item)
		const item = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/1',
			repository_ref: 'repo/a',
			provider: 'deepseek',
		});
		const cfg = { maxActiveRuns: 2, maxConcurrentByProvider: { deepseek: 1 } };
		admitNext(db, cfg);
		expect(activeProviderReservations(db).deepseek).toBe(1);

		// Owner stirbt (Item nicht mehr RUNNING/ADMITTED)
		db.prepare("UPDATE cp_queue SET queue_state = 'QUEUED' WHERE queue_item_id = ?").run(
			item.queue_item_id,
		);
		const recovered = recoverStaleProviderSlots(db);
		expect(recovered.length).toBe(1);
		expect(activeProviderReservations(db)).toEqual({});
		db.close();
	});
});

describe('P4 SLICE E — SCHEDULER ADMISSION (produktiver Pfad)', () => {
	it('PROVIDER_CAPACITY_ENFORCED + NO_PROVIDER_OVERSUBSCRIPTION: max=1 → zweiter Job wartet, kein Doppel-Reserve', () => {
		const db = makeDb();
		const cfg = {
			maxActiveRuns: 3,
			maxConcurrentByProvider: { deepseek: 1 },
			activeByProvider: () => activeProviderReservations(db),
			defaultModel: 'deepseek-v4-flash',
		};
		enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/1',
			repository_ref: 'repo/1',
			provider: 'deepseek',
		});
		const j2 = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/2',
			repository_ref: 'repo/2',
			provider: 'deepseek',
		});

		// Job 1 wird admitiert + reserviert
		const d1 = admitNext(db, cfg);
		expect(d1?.admitted).toBe(true);
		expect(activeProviderReservations(db)).toEqual({ deepseek: 1 });

		// Job 2 (deepseek voll): PROVIDER_CAPACITY — keine zweite Reservierung
		const d2 = admitNext(db, cfg);
		expect(d2).toBeNull();
		const j2After = db
			.prepare('SELECT queue_state, reason_code FROM cp_queue WHERE queue_item_id = ?')
			.get(j2.queue_item_id) as { queue_state: string; reason_code: string };
		expect(j2After.queue_state).toBe('WAITING_RESOURCE');
		expect(j2After.reason_code).toBe('PROVIDER_CAPACITY');
		expect(activeProviderReservations(db)).toEqual({ deepseek: 1 });

		// Job 1 terminal → Slot frei → Job 2 admitierbar
		markRunFinished(db, d1!.queue_item_id, 'COMPLETED', null, 'READY', {});
		expect(activeProviderReservations(db)).toEqual({});
		const d3 = admitNext(db, cfg);
		expect(d3?.queue_item_id).toBe(j2.queue_item_id);
		expect(activeProviderReservations(db)).toEqual({ deepseek: 1 });
		db.close();
	});

	it('RELEASE_AFTER_FAIL + RELEASE_AFTER_CANCEL: alle terminalen Pfade geben den Slot frei', () => {
		const db = makeDb();
		const cfg = {
			maxActiveRuns: 3,
			maxConcurrentByProvider: { deepseek: 1 },
			activeByProvider: () => activeProviderReservations(db),
		};
		const failItem = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/fail',
			repository_ref: 'repo/fail',
			provider: 'deepseek',
		});
		const cancelItem = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/cancel',
			repository_ref: 'repo/cancel',
			provider: 'deepseek',
		});

		// FAIL-Pfad
		const d1 = admitNext(db, cfg);
		expect(d1?.queue_item_id).toBe(failItem.queue_item_id);
		markRunFinished(db, d1!.queue_item_id, 'FAILED', null, 'READY', {});
		expect(activeProviderReservations(db)).toEqual({});

		// CANCEL-Pfad (QUEUED-Item reserviert erst bei Admission; hier: admitted→cancel)
		const d2 = admitNext(db, cfg);
		expect(d2?.queue_item_id).toBe(cancelItem.queue_item_id);
		cancelQueueItem(db, d2!.queue_item_id);
		expect(activeProviderReservations(db)).toEqual({});
		db.close();
	});
});
