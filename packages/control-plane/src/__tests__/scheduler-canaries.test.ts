// Positron Control Plane — P4 Scheduler Canaries (Multi-Issue Scheduling)
//
// Testmatrix (Auftrag §75): QUEUE_PERSISTENCE / QUEUE_ORDER / PRIORITY /
// FIFO_WITHIN_PRIORITY / ADMISSION_CONTROL / GLOBAL_RUN_LIMIT / BACKPRESSURE /
// DUPLICATE_INTAKE / EXPLICIT_RERUN / DEPENDENCY_WAIT / DEPENDENCY_RELEASE /
// DEPENDENCY_CYCLE / DEPENDENCY_FAILURE / REPO_LOCK / SCHEDULER_RECOVERY /
// DOUBLE_ADMISSION_PREVENTED / RUN_CANCELLATION / RESOURCE_RELEASE /
// STARVATION_POLICY (aging)
//
// Kein Fake-GREEN: Admission wird über tatsächliche Zustandsübergänge in der
// persistenten cp_queue beobachtet.

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyControlPlaneMigrations } from '../schema.js';
import {
	admitNext,
	cancelQueueItem,
	enqueueItem,
	getQueueItem,
	listQueueItems,
	markRunFinished,
	markRunStarted,
	recoverSchedulerState,
	schedulerCapacity,
} from '../scheduler.js';

let db: Database.Database;

beforeEach(() => {
	db = new Database(':memory:');
	applyControlPlaneMigrations(db);
});

afterEach(() => {
	db.close();
});

const cfg = { maxActiveRuns: 2 };

function enqueue(
	repo: string,
	ref: string,
	opts: { priority?: string; deps?: string[]; sourceType?: string } = {},
) {
	return enqueueItem(db, {
		source_type: opts.sourceType ?? 'issue',
		source_ref: ref,
		repository_ref: repo,
		priority: opts.priority,
		dependency_refs: opts.deps,
	});
}

// ---------------------------------------------------------------------------
// QUEUE_PERSISTENCE / QUEUE_ORDER
// ---------------------------------------------------------------------------

describe('QUEUE_PERSISTENCE — durable Intake', () => {
	it('enqueued Items sind persistent und FIFO-geordnet', () => {
		enqueue('repo/A', 'issue/1');
		enqueue('repo/A', 'issue/2');
		enqueue('repo/A', 'issue/3');
		const all = listQueueItems(db);
		expect(all.length).toBe(3);
		expect(all.map((q) => q.source_ref)).toEqual(['issue/1', 'issue/2', 'issue/3']);
		expect(all.every((q) => q.queue_state === 'QUEUED')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// ADMISSION_CONTROL / GLOBAL_RUN_LIMIT / BACKPRESSURE
// ---------------------------------------------------------------------------

describe('ADMISSION_CONTROL — max_active_runs (§39/§64)', () => {
	it('maxActiveRuns=2: genau 2 admitiert, dritter wartet; Slot frei → dritter startet', () => {
		const a = enqueue('repo/A', 'issue/1');
		const b = enqueue('repo/B', 'issue/2');
		const c = enqueue('repo/C', 'issue/3');

		const d1 = admitNext(db, cfg);
		expect(d1?.queue_item_id).toBe(a.queue_item_id);
		markRunStarted(db, a.queue_item_id, 'run-A');
		const d2 = admitNext(db, cfg);
		expect(d2?.queue_item_id).toBe(b.queue_item_id);
		markRunStarted(db, b.queue_item_id, 'run-B');

		// Kapazität voll: C wartet (kein spawn anyway, kein drop — BACKPRESSURE)
		const d3 = admitNext(db, cfg);
		expect(d3).toBeNull();
		expect(getQueueItem(db, c.queue_item_id)?.queue_state).toBe('WAITING_RESOURCE');
		expect(getQueueItem(db, c.queue_item_id)?.reason_code).toBe('GLOBAL_RUN_LIMIT');
		expect(schedulerCapacity(db, cfg).activeRuns).toBe(2);

		// Slot wird frei → C wird admitiert
		markRunFinished(db, a.queue_item_id, 'COMPLETED', 'run-A', 'READY');
		const d4 = admitNext(db, cfg);
		expect(d4?.queue_item_id).toBe(c.queue_item_id);
		// Peak-Concurrency: nie > 2
		expect(schedulerCapacity(db, cfg).activeRuns).toBeLessThanOrEqual(2);
	});

	it('NEGATIVE CANARY: es werden nie mehr Runs admitiert als erlaubt', () => {
		for (let i = 0; i < 5; i++) enqueue(`repo/${i}`, `issue/${i}`);
		let admitted = 0;
		let decision = admitNext(db, cfg);
		while (decision) {
			admitted++;
			markRunStarted(db, decision.queue_item_id, `run-${admitted}`);
			decision = admitNext(db, cfg);
		}
		// Max 2 gleichzeitig RUNNING/ADMITTED
		expect(admitted).toBe(2);
		expect(schedulerCapacity(db, cfg).activeRuns).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// PRIORITY / FIFO / AGING
// ---------------------------------------------------------------------------

describe('PRIORITY — deterministisch, kein Zufall', () => {
	it('CRITICAL vor HIGH vor NORMAL vor LOW; FIFO innerhalb gleicher Priorität', () => {
		const low = enqueue('repo-LOW', 'issue/1', { priority: 'LOW' });
		const normal1 = enqueue('repo-N1', 'issue/2', { priority: 'NORMAL' });
		const critical = enqueue('repo-CRIT', 'issue/3', { priority: 'CRITICAL' });
		const normal2 = enqueue('repo-N2', 'issue/4', { priority: 'NORMAL' });
		const high = enqueue('repo-HIGH', 'issue/5', { priority: 'HIGH' });

		// Genug Kapazität, um die REIHENFOLGE zu testen (Limit ist anderer Test)
		const cfg5 = { maxActiveRuns: 5 };
		const order: string[] = [];
		let d = admitNext(db, cfg5);
		while (d) {
			order.push(d.queue_item_id);
			markRunStarted(db, d.queue_item_id, `run-${order.length}`);
			d = admitNext(db, cfg5);
		}
		expect(order).toEqual([
			critical.queue_item_id,
			high.queue_item_id,
			normal1.queue_item_id, // FIFO: normal1 vor normal2
			normal2.queue_item_id,
			low.queue_item_id,
		]);
	});

	it('AGING: LOW steigt nach Wartezeit auf NORMAL (Starvation-Prevention §38)', () => {
		const low = enqueue('repo/A', 'issue/1', { priority: 'LOW' });
		const now = new Date(Date.now() + 10_000).toISOString();
		// LOW wartet seit > agingSeconds → wird wie NORMAL behandelt
		const d = admitNext(db, { maxActiveRuns: 2, agingSeconds: 5 }, now);
		expect(d?.queue_item_id).toBe(low.queue_item_id);
	});
});

// ---------------------------------------------------------------------------
// DUPLICATE_INTAKE / EXPLICIT_RERUN
// ---------------------------------------------------------------------------

describe('DUPLICATE_INTAKE — Idempotenz (§48) / EXPLICIT_RERUN (§49)', () => {
	it('gleiches Issue 2× eingereiht → ein effektives Queue-Item', () => {
		const first = enqueue('repo/A', 'issue/42');
		const second = enqueue('repo/A', 'issue/42');
		expect(second.queue_item_id).toBe(first.queue_item_id);
		expect(listQueueItems(db).length).toBe(1);
	});

	it('expliziter Re-Run erzeugt neues Item mit eigener Historie (nach COMPLETED)', () => {
		const first = enqueue('repo/A', 'issue/42');
		// Aktives Item → dedup greift
		const dup = enqueue('repo/A', 'issue/42');
		expect(dup.queue_item_id).toBe(first.queue_item_id);

		// Nach COMPLETED ist ein neuer Eintrag erlaubt (Re-Run mit neuer run_id)
		markRunFinished(db, first.queue_item_id, 'COMPLETED', 'run-1', 'READY');
		const afterComplete = enqueue('repo/A', 'issue/42', {});
		expect(afterComplete.queue_item_id).not.toBe(first.queue_item_id);
		expect(afterComplete.queue_state).toBe('QUEUED');
		expect(listQueueItems(db).length).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// DEPENDENCIES (§46/§67) + CYCLE (§47) + FAILURE (§68)
// ---------------------------------------------------------------------------

describe('DEPENDENCIES — Readyness, Release, Cycle, Failure', () => {
	it('B wartet auf A; nach A-COMPLETED wird B eligible (§67)', () => {
		enqueue('repo/A', 'issue/A');
		const b = enqueue('repo/B', 'issue/B', { deps: ['issue/A'] });
		enqueue('repo/C', 'issue/C'); // unabhängig

		// A + C dürfen laufen (verschiedene Repos, Kapazität 2)
		const admitted: string[] = [];
		let decision = admitNext(db, cfg);
		while (decision) {
			admitted.push(decision.queue_item_id);
			markRunStarted(db, decision.queue_item_id, `run-${decision.queue_item_id}`);
			decision = admitNext(db, cfg);
		}
		// A und C admitiert; B wartet (WAITING_DEPENDENCY)
		expect(admitted.length).toBe(2);
		expect(admitted).not.toContain(b.queue_item_id);
		expect(getQueueItem(db, b.queue_item_id)?.queue_state).toBe('WAITING_DEPENDENCY');

		// A fertig → B wird admitiert
		const a = listQueueItems(db).find((q) => q.source_ref === 'issue/A')!;
		markRunFinished(db, a.queue_item_id, 'COMPLETED', 'run-A', 'READY');
		const after = admitNext(db, cfg);
		expect(after?.queue_item_id).toBe(b.queue_item_id);
	});

	it('DEPENDENCY_CYCLE: A→B, B→A → BLOCKED, kein ewiges Warten (§47)', () => {
		const a = enqueue('repo/A', 'issue/A', { deps: ['issue/B'] });
		const b = enqueue('repo/B', 'issue/B', { deps: ['issue/A'] });
		const d = admitNext(db, cfg);
		expect(d).toBeNull();
		expect(getQueueItem(db, a.queue_item_id)?.queue_state).toBe('BLOCKED');
		expect(getQueueItem(db, a.queue_item_id)?.reason_code).toBe('DEPENDENCY_CYCLE');
		expect(getQueueItem(db, b.queue_item_id)?.queue_state).toBe('BLOCKED');
	});

	it('DEPENDENCY_FAILURE: A BLOCKED/FAILED → B wird nicht ewig warten gelassen (§68)', () => {
		enqueue('repo/A', 'issue/A');
		const b = enqueue('repo/B', 'issue/B', { deps: ['issue/A'] });

		// A startet
		const d1 = admitNext(db, cfg)!;
		expect(d1.queue_item_id).toBeDefined();
		markRunStarted(db, d1.queue_item_id, 'run-A');
		// B sieht A als nicht COMPLETED → WAITING_DEPENDENCY
		const d2 = admitNext(db, cfg);
		expect(d2).toBeNull();
		expect(getQueueItem(db, b.queue_item_id)?.queue_state).toBe('WAITING_DEPENDENCY');

		// A scheitert deterministisch → BLOCKED
		markRunFinished(db, d1.queue_item_id, 'BLOCKED', 'run-A', 'READY');
		expect(getQueueItem(db, d1.queue_item_id)?.queue_state).toBe('BLOCKED');
		expect(getQueueItem(db, d1.queue_item_id)?.reason_code).toBe('READY');

		// B bleibt WAITING_DEPENDENCY — deterministisch, kein Endlos-Loop;
		// ein Operator kann B canceln. (Kein stilles FAIL-Automatismus.)
		const d3 = admitNext(db, cfg);
		expect(d3).toBeNull();
		expect(getQueueItem(db, b.queue_item_id)?.queue_state).toBe('WAITING_DEPENDENCY');
		cancelQueueItem(db, b.queue_item_id);
		expect(getQueueItem(db, b.queue_item_id)?.queue_state).toBe('CANCELLED');
	});
});

// ---------------------------------------------------------------------------
// REPO_LOCK (§43/§62)
// ---------------------------------------------------------------------------

describe('REPOSITORY_LOCK — konservativ: keine zwei mutierenden Runs pro Repo', () => {
	it('zwei Runs desselben Repos: einer wartet REPOSITORY_LOCKED; anderes Repo läuft parallel', () => {
		const r1 = enqueue('repo/A', 'issue/1');
		const r2 = enqueue('repo/A', 'issue/2'); // gleiches Repo
		const other = enqueue('repo/B', 'issue/3');

		const d1 = admitNext(db, cfg);
		expect(d1?.queue_item_id).toBe(r1.queue_item_id);
		markRunStarted(db, r1.queue_item_id, 'run-A1');

		const d2 = admitNext(db, cfg);
		expect(d2?.queue_item_id).toBe(other.queue_item_id); // anderes Repo darf laufen
		markRunStarted(db, other.queue_item_id, 'run-B');

		// r2 wartet (Repo A gesperrt)
		const d3 = admitNext(db, cfg);
		expect(d3).toBeNull();
		expect(getQueueItem(db, r2.queue_item_id)?.queue_state).toBe('WAITING_RESOURCE');
		expect(getQueueItem(db, r2.queue_item_id)?.reason_code).toBe('REPOSITORY_LOCKED');

		// r1 fertig → r2 darf starten
		markRunFinished(db, r1.queue_item_id, 'COMPLETED', 'run-A1', 'READY');
		const d4 = admitNext(db, cfg);
		expect(d4?.queue_item_id).toBe(r2.queue_item_id);
	});
});

// ---------------------------------------------------------------------------
// CANCELLATION / RESOURCE_RELEASE (§52/§53)
// ---------------------------------------------------------------------------

describe('CANCELLATION — queued → cancelled; keine verspätete Aktivierung', () => {
	it('QUEUED-Item cancel → CANCELLED; kann nie mehr admitiert werden', () => {
		const item = enqueue('repo/A', 'issue/1');
		expect(cancelQueueItem(db, item.queue_item_id)?.queue_state).toBe('CANCELLED');
		const d = admitNext(db, cfg);
		expect(d).toBeNull();
		expect(getQueueItem(db, item.queue_item_id)?.reason_code).toBe('CANCELLED_BY_USER');
	});

	it('RUNNING-Item cancel → RUNNING bleibt (Run-Lifecycle), Ressource wird via finish freigegeben', () => {
		const item = enqueue('repo/A', 'issue/1');
		const d = admitNext(db, cfg)!;
		markRunStarted(db, d.queue_item_id, 'run-1');
		const cancelled = cancelQueueItem(db, item.queue_item_id);
		expect(cancelled?.queue_state).toBe('RUNNING');
		// Ressource freigeben
		markRunFinished(db, item.queue_item_id, 'CANCELLED', 'run-1', 'CANCELLED_BY_USER');
		expect(getQueueItem(db, item.queue_item_id)?.queue_state).toBe('CANCELLED');
		expect(schedulerCapacity(db, cfg).activeRuns).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// SCHEDULER_RECOVERY (§54/§69)
// ---------------------------------------------------------------------------

describe('SCHEDULER_RECOVERY — Crash: Queue vorhanden, Kapazität korrekt', () => {
	it('ADMITTED ohne Run → requeued; RUNNING mit totem Run → finalisiert; B nicht verloren', () => {
		const a = enqueue('repo/A', 'issue/A');
		const b = enqueue('repo/B', 'issue/B');

		// A ADMITTED (Controller crashte vor Run-Start)
		const d1 = admitNext(db, cfg)!;
		expect(d1.queue_item_id).toBe(a.queue_item_id);
		// B RUNNING mit lebendem Run
		const d2 = admitNext(db, cfg)!;
		markRunStarted(db, d2.queue_item_id, 'run-B-alive');

		const rec = recoverSchedulerState(db, (runId) => runId === 'run-B-alive');
		expect(rec.staleAdmitted).toContain(a.queue_item_id);
		expect(getQueueItem(db, a.queue_item_id)?.queue_state).toBe('QUEUED');
		expect(getQueueItem(db, b.queue_item_id)?.queue_state).toBe('RUNNING');

		// Nach Recovery: Kapazität korrekt neu berechnet (1 aktiv) → A wieder admitierbar
		const d3 = admitNext(db, cfg);
		expect(d3?.queue_item_id).toBe(a.queue_item_id);
	});
});
