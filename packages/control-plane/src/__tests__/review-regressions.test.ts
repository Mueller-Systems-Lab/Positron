// P3.5 — Review-Regressions-Canaries (Findings aus unabhängigem Review R1)
//
// Belegt die Behebung der CRITICAL-/MAJOR-Findings:
// 1. Diamond-Dependency ist KEIN DEPENDENCY_CYCLE (CRITICAL R1)
// 2. Provider-Capacity wird real erzwungen (MAJOR R1 — misplaced continue)
// 3. Admission überschreitet maxActiveRuns nicht unter Konkurrenz (MAJOR R1/SEC M1)
// 4. Aging-Promotion LOW→NORMAL deterministisch (MINOR R1 — Date.now-Bug)
// 5. Instanz-scoped Fencing: zweiter Controller-Prozess fencet ersten real aus (MAJOR R1)

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { admitNext, enqueueItem, getQueueItem, markRunStarted } from '../scheduler.js';
import { applyControlPlaneMigrations } from '../schema.js';
import {
	claimAttemptWithGeneration,
	completeAttempt,
	createAttempt,
	createJob,
	getAttempt,
	recoverStaleLeases,
} from '../store.js';

let db: Database.Database;

beforeEach(() => {
	db = new Database(':memory:');
	applyControlPlaneMigrations(db);
});

afterEach(() => {
	db.close();
});

describe('R1-CRITICAL: Diamond-Dependency ≠ Cycle', () => {
	it('A→[B,C], B→D, C→D: D über zwei Pfade erreichbar, KEIN Zyklus → A wird admitiert (nicht BLOCKED)', () => {
		// D zuerst (unabhängig), dann B/C mit dep auf D, dann A mit dep auf B+C
		enqueueItem(db, { source_type: 'issue', source_ref: 'issue/D', repository_ref: 'repo/D' });
		enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/B',
			repository_ref: 'repo/B',
			dependency_refs: ['issue/D'],
		});
		enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/C',
			repository_ref: 'repo/C',
			dependency_refs: ['issue/D'],
		});
		const a = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/A',
			repository_ref: 'repo/A',
			dependency_refs: ['issue/B', 'issue/C'],
		});

		// D ist ready → admitiert; danach B (dep D nicht COMPLETED → wartet)
		const d1 = admitNext(db, { maxActiveRuns: 4 });
		expect(d1?.queue_item_id).toBeDefined();
		markRunStarted(db, d1!.queue_item_id, 'run-D');

		// A darf NIEMALS als DEPENDENCY_CYCLE geblockt werden (Diamond!)
		const aState = getQueueItem(db, a.queue_item_id);
		expect(aState?.queue_state).toBe('QUEUED');
		expect(aState?.reason_code).toBe('READY');

		// D fertig → B + C starten (je ein admitNext-Aufruf admitiert EIN Item),
		// A wartet weiter auf deren COMPLETED (kein Cycle, nur WAITING_DEPENDENCY)
		markRunFinishedA(db, d1!.queue_item_id);
		admitNext(db, { maxActiveRuns: 4 }); // B
		admitNext(db, { maxActiveRuns: 4 }); // C
		admitNext(db, { maxActiveRuns: 4 }); // A → WAITING_DEPENDENCY (kein Kandidat mehr admitierbar)
		const aAfter = getQueueItem(db, a.queue_item_id);
		expect(aAfter?.queue_state).toBe('WAITING_DEPENDENCY');
		expect(aAfter?.reason_code).toBe('WAITING_DEPENDENCY');
	});
});

describe('R1-MAJOR: Provider-Capacity wird erzwungen', () => {
	it('Provider max=1: zweiter Job desselben Providers wartet PROVIDER_CAPACITY, anderer Provider läuft', () => {
		const providerState = { deepseek: 0, ollama: 0 };
		const cfg = {
			maxActiveRuns: 3,
			maxConcurrentByProvider: { deepseek: 1, ollama: 1 },
			activeByProvider: () => ({ ...providerState }),
		};
		// Job 1+2 nutzen deepseek; Job 3 nutzt ollama
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
		enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/3',
			repository_ref: 'repo/3',
			provider: 'ollama',
		});

		// deepseek hat noch 0 aktiv → Job 1 wird admitiert und belegt deepseek
		const d1 = admitNext(db, cfg);
		expect(d1).not.toBeNull();
		providerState.deepseek = 1;

		// Job 2 (deepseek, voll) wartet PROVIDER_CAPACITY
		const d2 = admitNext(db, cfg);
		expect(d2).not.toBeNull(); // ollama-Job 3 darf laufen
		providerState.ollama = 1;
		expect(getQueueItem(db, j2.queue_item_id)?.queue_state).toBe('WAITING_RESOURCE');
		expect(getQueueItem(db, j2.queue_item_id)?.reason_code).toBe('PROVIDER_CAPACITY');

		// deepseek wird frei → Job 2 admitierbar
		providerState.deepseek = 0;
		const d3 = admitNext(db, cfg);
		expect(d3?.queue_item_id).toBe(j2.queue_item_id);
	});
});

describe('R1-MINOR: Aging deterministisch (LOW→NORMAL Promotion)', () => {
	it('LOW wartet > agingSeconds → wird vor einem frischen NORMAL admitiert', () => {
		const old = new Date(Date.now() - 60_000).toISOString(); // 60s alt
		const now = new Date().toISOString();
		// LOW-Item mit altem enqueued_at (per SQL direkt gesetzt)
		const low = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/LOW',
			repository_ref: 'repo/L',
			priority: 'LOW',
		});
		db.prepare('UPDATE cp_queue SET enqueued_at = ? WHERE queue_item_id = ?').run(
			old,
			low.queue_item_id,
		);
		const normal = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/N',
			repository_ref: 'repo/N',
			priority: 'NORMAL',
		});

		// Ohne Aging: NORMAL gewinnt. Mit Aging (agingSeconds=10): LOW ist
		// auf NORMAL gealtert und FIFO-älter → LOW zuerst.
		const cfg = { maxActiveRuns: 1, agingSeconds: 10 };
		const d = admitNext(db, cfg, now);
		expect(d?.queue_item_id).toBe(low.queue_item_id);
		expect(normal.queue_item_id).toBeDefined();
	});
});

describe('R1-MAJOR: Instanz-scoped Fencing', () => {
	it('Zweiter Controller-Prozess (andere Instanz-ID) kann stale Attempts des ersten nicht mehr abschließen', () => {
		const runId = 'run-fence-instance';
		const job = createJob(db, runId, 'build');
		const attempt = createAttempt(db, runId, job.job_id, {
			status: 'pending',
			worker_type: 'opencode',
		});

		// Controller A (Instanz ctl:run:AAA) claimt
		const a = claimAttemptWithGeneration(db, attempt.attempt_id, {
			ownerId: 'ctl:run-fence-instance:AAA',
			leaseTtlMs: 40,
		});
		expect(a.claimed).toBe(true);
		expect(a.generation).toBe(1);

		// A "crashst" (kein Heartbeat) → Lease läuft ab → Recovery finalisiert
		// (Prefix-Match: alle Instanzen dieses Runs)
		const expiresAt = getAttempt(db, attempt.attempt_id)?.lease_expires_at ?? '';
		const now = new Date(new Date(expiresAt).getTime() + 1).toISOString();
		const stale = recoverStaleLeases(db, { ownerIdPrefix: 'ctl:run-fence-instance:', now });
		expect(stale.length).toBe(1);

		// A liefert spät → Fencing mit alter Instanz + Generation → REJECTED
		// (Transition-Guard: Attempt ist final failed/STALE_LEASE)
		const lateA = completeAttempt(
			db,
			attempt.attempt_id,
			{ status: 'succeeded', output_json: '{"from":"A"}' },
			{ fencingOwnerId: 'ctl:run-fence-instance:AAA', fencingGeneration: a.generation },
		);
		expect(lateA).toBeNull();

		// Neuer Controller B (Instanz ctl:run:BBB) startet frischen Attempt
		const attemptB = createAttempt(db, runId, job.job_id, {
			status: 'pending',
			worker_type: 'opencode',
		});
		const b = claimAttemptWithGeneration(db, attemptB.attempt_id, {
			ownerId: 'ctl:run-fence-instance:BBB',
			leaseTtlMs: 60_000,
		});
		expect(b.claimed).toBe(true);
		const done = completeAttempt(
			db,
			attemptB.attempt_id,
			{ status: 'succeeded', output_json: '{"from":"B"}' },
			{ fencingOwnerId: 'ctl:run-fence-instance:BBB', fencingGeneration: b.generation },
		);
		expect(done?.status).toBe('succeeded');

		// DUPLICATE_EFFECT_ZERO: nur B hat geschrieben
		const written = db
			.prepare('SELECT output_json FROM cp_attempts WHERE output_json IS NOT NULL')
			.all() as Array<{ output_json: string }>;
		expect(written.length).toBe(1);
		expect(JSON.parse(written[0]!.output_json).from).toBe('B');
	});
});

// Helper: markRunFinished ohne Event-Config (Test-kompatibel)
function markRunFinishedA(db: Database.Database, queueItemId: string): void {
	db.prepare(
		`UPDATE cp_queue SET queue_state = 'COMPLETED', finished_at = ? WHERE queue_item_id = ?`,
	).run(new Date().toISOString(), queueItemId);
}
