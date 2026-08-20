// Positron Control Plane — Deterministic Scheduler (P4, Multi-Issue Scheduling)
//
// Oberste Invariante (§32): LLMs besitzen KEINE Scheduling Authority.
// Alle Entscheidungen sind deterministisch:
//
//   1. explicit priority (CRITICAL > HIGH > NORMAL > LOW)
//   2. dependency readiness (alle dependency_refs COMPLETED)
//   3. resource availability (max_active_runs, Repository-Lock, Provider)
//   4. FIFO innerhalb gleicher Priorität (enqueued_at)
//
// Queue → Admission → Resource Claim → Run → Release.
// Persistenz: cp_queue auf der bestehenden SQLite-DB.
// Admission ist atomar (SQLite-Transaktion) — parallele Scheduler-Prozesse
// können dasselbe Item nicht doppelt admitieren (ONE_ADMISSION, §55).

import type Database from 'better-sqlite3';
import {
	QUEUE_PRIORITY_ORDER,
	normalizePriority,
	queueDedupKey,
} from './queue-schema.js';
import type { QueuePriority, QueueState, SchedulerReasonCode } from './queue-schema.js';

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface QueueItemRecord {
	queue_item_id: string;
	source_type: string;
	source_ref: string;
	repository_ref: string;
	run_id: string | null;
	priority: QueuePriority;
	queue_state: QueueState;
	dependency_refs: string[];
	enqueued_at: string;
	admitted_at: string | null;
	started_at: string | null;
	finished_at: string | null;
	reason_code: string | null;
	dedup_key: string | null;
}

export interface SchedulerConfig {
	/** Maximal gleichzeitig aktive Runs (Admission Control, §39) */
	maxActiveRuns: number;
	/**
	 * Provider-Limits (§40): provider → max gleichzeitige Runs.
	 * Leer → keine Provider-basierte Begrenzung.
	 */
	maxConcurrentByProvider?: Record<string, number>;
	/** Aktive Runs je Provider (extern ermittelt — z. B. aus cp_attempts) */
	activeByProvider?: () => Record<string, number>;
	/** Aging: nach N Sekunden Wartezeit steigt ein NORMAL/LOW-Item eine Stufe (default 0 = aus) */
	agingSeconds?: number;
	/** Scheduler-Events (persistiert in cp_scheduler_events, §56) */
	emitEvent?: (event: SchedulerEvent) => void;
}

export interface SchedulerEvent {
	queue_item_id: string;
	run_id: string | null;
	event: string;
	timestamp: string;
	reason_code: string;
}

export interface EnqueueInput {
	source_type: string;
	source_ref: string;
	repository_ref: string;
	priority?: QueuePriority | string;
	dependency_refs?: string[];
	/** Expliziter Re-Run (§49): erlaubt neues Queue-Item trotz dedup */
	forceRerun?: boolean;
}

export interface AdmissionDecision {
	queue_item_id: string;
	admitted: boolean;
	reason_code: SchedulerReasonCode;
	run_id: string | null;
}

// ---------------------------------------------------------------------------
// Store-Operationen (cp_queue)
// ---------------------------------------------------------------------------

export function enqueueItem(db: Database.Database, input: EnqueueInput): QueueItemRecord {
	const dedupKey = queueDedupKey(input.source_type, input.repository_ref, input.source_ref);
	// Duplicate Intake (§48): dasselbe Issue/Task wird nicht unbeabsichtigt
	// doppelt eingeplant. Nur AKTIVE Einträge blockieren (partieller
	// UNIQUE-Index + Vorab-Check); nach COMPLETED/CANCELLED/BLOCKED ist ein
	// neuer Eintrag möglich (Re-Run §49 — die UNIQUE-Constraint ist auf
	// aktive States beschränkt, der Insert mit neuem Eintrag gelingt).
	if (!input.forceRerun) {
		const existing = db
			.prepare(
				`SELECT * FROM cp_queue WHERE dedup_key = ? AND queue_state IN
				 ('QUEUED', 'WAITING_DEPENDENCY', 'WAITING_RESOURCE', 'ADMITTED', 'RUNNING')`,
			)
			.get(dedupKey) as Record<string, unknown> | undefined;
		if (existing) {
			return mapQueueRow(existing);
		}
	}

	const item: QueueItemRecord = {
		queue_item_id: crypto.randomUUID(),
		source_type: input.source_type,
		source_ref: input.source_ref,
		repository_ref: input.repository_ref,
		run_id: null,
		priority: normalizePriority(input.priority),
		queue_state: 'QUEUED',
		dependency_refs: input.dependency_refs ?? [],
		enqueued_at: new Date().toISOString(),
		admitted_at: null,
		started_at: null,
		finished_at: null,
		reason_code: 'READY',
		dedup_key: dedupKey,
	};
	db.prepare(
		`INSERT INTO cp_queue (queue_item_id, source_type, source_ref, repository_ref, run_id,
		   priority, queue_state, dependency_refs, enqueued_at, admitted_at, started_at, finished_at,
		   reason_code, dedup_key)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		item.queue_item_id,
		item.source_type,
		item.source_ref,
		item.repository_ref,
		item.run_id,
		item.priority,
		item.queue_state,
		JSON.stringify(item.dependency_refs),
		item.enqueued_at,
		item.admitted_at,
		item.started_at,
		item.finished_at,
		item.reason_code,
		item.dedup_key,
	);
	return item;
}

export function getQueueItem(db: Database.Database, queueItemId: string): QueueItemRecord | null {
	const row = db.prepare('SELECT * FROM cp_queue WHERE queue_item_id = ?').get(queueItemId) as
		| Record<string, unknown>
		| undefined;
	return row ? mapQueueRow(row) : null;
}

export function listQueueItems(db: Database.Database, state?: QueueState): QueueItemRecord[] {
	const rows = state
		? (db.prepare('SELECT * FROM cp_queue WHERE queue_state = ? ORDER BY enqueued_at ASC').all(state) as Array<
				Record<string, unknown>
			>)
		: (db.prepare('SELECT * FROM cp_queue ORDER BY enqueued_at ASC').all() as Array<
				Record<string, unknown>
			>);
	return rows.map(mapQueueRow);
}

export function updateQueueItem(
	db: Database.Database,
	queueItemId: string,
	update: Partial<Pick<QueueItemRecord, 'queue_state' | 'run_id' | 'admitted_at' | 'started_at' | 'finished_at' | 'reason_code'>>,
): QueueItemRecord | null {
	const existing = getQueueItem(db, queueItemId);
	if (!existing) return null;
	db.prepare(
		`UPDATE cp_queue SET queue_state = ?, run_id = ?, admitted_at = ?, started_at = ?,
		   finished_at = ?, reason_code = ? WHERE queue_item_id = ?`,
	).run(
		update.queue_state ?? existing.queue_state,
		update.run_id ?? existing.run_id,
		update.admitted_at ?? existing.admitted_at,
		update.started_at ?? existing.started_at,
		update.finished_at ?? existing.finished_at,
		update.reason_code ?? existing.reason_code,
		queueItemId,
	);
	return getQueueItem(db, queueItemId);
}

function mapQueueRow(row: Record<string, unknown>): QueueItemRecord {
	return {
		queue_item_id: String(row.queue_item_id),
		source_type: String(row.source_type),
		source_ref: String(row.source_ref),
		repository_ref: String(row.repository_ref),
		run_id: row.run_id ? String(row.run_id) : null,
		priority: normalizePriority(String(row.priority)),
		queue_state: String(row.queue_state) as QueueState,
		dependency_refs: row.dependency_refs
			? (JSON.parse(String(row.dependency_refs)) as string[])
			: [],
		enqueued_at: String(row.enqueued_at),
		admitted_at: row.admitted_at ? String(row.admitted_at) : null,
		started_at: row.started_at ? String(row.started_at) : null,
		finished_at: row.finished_at ? String(row.finished_at) : null,
		reason_code: row.reason_code ? String(row.reason_code) : null,
		dedup_key: row.dedup_key ? String(row.dedup_key) : null,
	};
}

// ---------------------------------------------------------------------------
// Dependencies (§46/§47)
// ---------------------------------------------------------------------------

/**
 * Prüft Dependency-Readyness + erkennt Zyklen.
 * B hängt von A ab (dependency_refs = [A-Ref]). A muss COMPLETED sein.
 * Zyklus (A→B, B→A): DEPENDENCY_CYCLE → BLOCKED (kein ewiges Queue-Warten).
 */
export function dependencyStatus(
	db: Database.Database,
	item: QueueItemRecord,
): { ready: boolean; cycle: boolean; reason: SchedulerReasonCode } {
	if (item.dependency_refs.length === 0) {
		return { ready: true, cycle: false, reason: 'READY' };
	}
	const byRef = new Map<string, QueueItemRecord>();
	for (const q of listQueueItems(db)) {
		byRef.set(q.source_ref, q);
		byRef.set(q.queue_item_id, q);
	}

	// Zyklus-Erkennung ZUERST (§47): A→B, B→A → DEPENDENCY_CYCLE → BLOCKED,
	// unabhängig von der Readyness (sonst würde der Cycle nie erkannt).
	const visited = new Set<string>([item.queue_item_id]);
	const stack: string[] = [...item.dependency_refs];
	while (stack.length > 0) {
		const ref = stack.pop()!;
		const dep = byRef.get(ref);
		if (!dep) continue;
		if (visited.has(dep.queue_item_id)) {
			return { ready: false, cycle: true, reason: 'DEPENDENCY_CYCLE' };
		}
		visited.add(dep.queue_item_id);
		stack.push(...dep.dependency_refs);
	}

	// Alle Dependencies müssen COMPLETED sein (Readyness).
	for (const depRef of item.dependency_refs) {
		const dep = byRef.get(depRef);
		if (!dep || dep.queue_state !== 'COMPLETED') {
			return { ready: false, cycle: false, reason: 'WAITING_DEPENDENCY' };
		}
	}
	return { ready: true, cycle: false, reason: 'READY' };
}

// ---------------------------------------------------------------------------
// Admission Control (§39/§55)
// ---------------------------------------------------------------------------

function countActiveRuns(db: Database.Database): number {
	const row = db
		.prepare("SELECT COUNT(*) AS c FROM cp_queue WHERE queue_state IN ('RUNNING', 'ADMITTED')")
		.get() as { c: number };
	return Number(row.c);
}

function repoHasActiveRun(db: Database.Database, repositoryRef: string): boolean {
	const row = db
		.prepare(
			"SELECT COUNT(*) AS c FROM cp_queue WHERE queue_state IN ('RUNNING', 'ADMITTED') AND repository_ref = ?",
		)
		.get(repositoryRef) as { c: number };
	return Number(row.c) > 0;
}

/**
 * Atomare Admission (§55): ein Queue-Item kann von mehreren Scheduler-
 * Prozessen gleichzeitig versucht werden — SQLite-Transaktion erzwingt
 * EINEN Gewinner (ONE_ADMISSION). Der Verlierer erhält admitted=false.
 *
 * Deterministische Reihenfolge: Priorität → Dependency → Ressourcen → FIFO.
 */
export function admitNext(
	db: Database.Database,
	config: SchedulerConfig,
	now = new Date().toISOString(),
): AdmissionDecision | null {
	const candidates = listQueueItems(db)
		.filter(
			(q) =>
				q.queue_state === 'QUEUED' ||
				q.queue_state === 'WAITING_RESOURCE' ||
				q.queue_state === 'WAITING_DEPENDENCY',
		)
		.map((q) => {
			// Aging (§38): NORMAL/LOW steigen nach agingSeconds Wartezeit eine Stufe
			let priority = q.priority;
			if (config.agingSeconds && config.agingSeconds > 0) {
				const waitedMs = Date.now() - new Date(q.enqueued_at).getTime();
				if (waitedMs > config.agingSeconds * 1000 && priority === 'LOW') priority = 'NORMAL';
				else if (waitedMs > config.agingSeconds * 2000 && priority === 'NORMAL') priority = 'HIGH';
			}
			return { item: q, priority };
		})
		.sort((a, b) => {
			const p = QUEUE_PRIORITY_ORDER[a.priority] - QUEUE_PRIORITY_ORDER[b.priority];
			if (p !== 0) return p;
			return a.item.enqueued_at.localeCompare(b.item.enqueued_at); // FIFO
		});

	for (const { item } of candidates) {
		// Dependency-Readyness (deterministisch, bevor Ressourcen geprüft werden)
		const dep = dependencyStatus(db, item);
		if (dep.cycle) {
			updateQueueItem(db, item.queue_item_id, {
				queue_state: 'BLOCKED',
				reason_code: 'DEPENDENCY_CYCLE',
			});
			continue;
		}
		if (!dep.ready) {
			updateQueueItem(db, item.queue_item_id, {
				queue_state: 'WAITING_DEPENDENCY',
				reason_code: 'WAITING_DEPENDENCY',
			});
			continue;
		}

		// Repository-Lock (§42/§43): keine zwei mutierenden Runs im selben Repo.
		// Wird VOR dem globalen Limit geprüft, damit der spezifischere
		// Reason-Code (REPOSITORY_LOCKED) gewinnt, wenn beides zutrifft.
		if (repoHasActiveRun(db, item.repository_ref)) {
			updateQueueItem(db, item.queue_item_id, {
				queue_state: 'WAITING_RESOURCE',
				reason_code: 'REPOSITORY_LOCKED',
			});
			continue;
		}

		// Ressourcen: globales Limit (§39) — atomar prüfen + claimen
		if (countActiveRuns(db) >= config.maxActiveRuns) {
			updateQueueItem(db, item.queue_item_id, {
				queue_state: 'WAITING_RESOURCE',
				reason_code: 'GLOBAL_RUN_LIMIT',
			});
			continue;
		}

		// Provider-Capacity (§40): falls konfiguriert
		if (config.maxConcurrentByProvider && config.activeByProvider) {
			const active = config.activeByProvider();
			for (const [provider, max] of Object.entries(config.maxConcurrentByProvider)) {
				if ((active[provider] ?? 0) >= max) {
					updateQueueItem(db, item.queue_item_id, {
						queue_state: 'WAITING_RESOURCE',
						reason_code: 'PROVIDER_CAPACITY',
					});
					continue;
				}
			}
		}

		// ADMISSION: atomarer Übergang → ADMITTED
		const admitted = db
			.prepare(
				`UPDATE cp_queue SET queue_state = 'ADMITTED', admitted_at = ?, reason_code = ?
				 WHERE queue_item_id = ? AND queue_state IN
				   ('QUEUED', 'WAITING_RESOURCE', 'WAITING_DEPENDENCY')`,
			)
			.run(now, 'READY', item.queue_item_id);
		if (admitted.changes === 1) {
			emit(config, {
				queue_item_id: item.queue_item_id,
				run_id: null,
				event: 'ADMITTED',
				timestamp: now,
				reason_code: 'READY',
			});
			return {
				queue_item_id: item.queue_item_id,
				admitted: true,
				reason_code: 'READY',
				run_id: null,
			};
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Run-Lifecycle-Hooks (§52/§53)
// ---------------------------------------------------------------------------

export function markRunStarted(
	db: Database.Database,
	queueItemId: string,
	runId: string,
	config?: Pick<SchedulerConfig, 'emitEvent'>,
	now = new Date().toISOString(),
): QueueItemRecord | null {
	const updated = updateQueueItem(db, queueItemId, {
		queue_state: 'RUNNING',
		run_id: runId,
		started_at: now,
		reason_code: 'READY',
	});
	if (updated) {
		emit(config ?? {}, {
			queue_item_id: queueItemId,
			run_id: runId,
			event: 'RUN_STARTED',
			timestamp: now,
			reason_code: 'READY',
		});
	}
	return updated;
}

export function markRunFinished(
	db: Database.Database,
	queueItemId: string,
	state: 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'CANCELLED' | 'TIMEOUT',
	runId: string | null,
	reasonCode: SchedulerReasonCode,
	config?: Pick<SchedulerConfig, 'emitEvent'>,
	now = new Date().toISOString(),
): QueueItemRecord | null {
	const updated = updateQueueItem(db, queueItemId, {
		queue_state: state === 'FAILED' || state === 'TIMEOUT' ? 'COMPLETED' : state,
		finished_at: now,
		reason_code: reasonCode,
	});
	if (updated) {
		emit(config ?? {}, {
			queue_item_id: queueItemId,
			run_id: runId,
			event: 'RUN_FINISHED',
			timestamp: now,
			reason_code: reasonCode,
		});
	}
	return updated;
}

/** Cancellation (§52): QUEUED → CANCELLED; RUNNING → Status + Release. */
export function cancelQueueItem(
	db: Database.Database,
	queueItemId: string,
	now = new Date().toISOString(),
): QueueItemRecord | null {
	const item = getQueueItem(db, queueItemId);
	if (!item) return null;
	if (item.queue_state === 'COMPLETED' || item.queue_state === 'BLOCKED') return item;
	const updated = updateQueueItem(db, queueItemId, {
		queue_state: item.queue_state === 'RUNNING' ? 'RUNNING' : 'CANCELLED',
		finished_at: item.queue_state === 'RUNNING' ? null : now,
		reason_code: 'CANCELLED_BY_USER',
	});
	if (updated && item.queue_state === 'RUNNING') {
		// RUNNING-Item: Ressourcen werden über den Run-Lifecycle freigegeben;
		// die Cancellation wirkt auf den Run (owned workers via Phase-B-Cancel).
		emit({ emitEvent: undefined }, {
			queue_item_id: queueItemId,
			run_id: item.run_id,
			event: 'CANCELLED',
			timestamp: now,
			reason_code: 'CANCELLED_BY_USER',
		});
	}
	return updated;
}

// ---------------------------------------------------------------------------
// Scheduler-Crash-Recovery (§54)
// ---------------------------------------------------------------------------

/**
 * Recovery nach Scheduler-Crash:
 * - ADMITTED-Items ohne laufenden Run → zurück auf QUEUED (Kapazität neu berechnen)
 * - RUNNING-Items: Run-Status wird über die Control-Plane rekonstruiert
 *   (Phase-B-Lease/Fencing); hier wird nur die Queue-Konsistenz wiederhergestellt.
 * - WAITING_*-Items bleiben erhalten (nichts verloren).
 */
export function recoverSchedulerState(
	db: Database.Database,
	isRunAlive: (runId: string) => boolean,
	now = new Date().toISOString(),
): { requeued: string[]; staleAdmitted: string[] } {
	const requeued: string[] = [];
	const staleAdmitted: string[] = [];
	for (const item of listQueueItems(db)) {
		if (item.queue_state === 'ADMITTED') {
			// ADMITTED ohne laufenden Run → stale (Controller-Crash vor Start)
			updateQueueItem(db, item.queue_item_id, {
				queue_state: 'QUEUED',
				reason_code: 'READY',
			});
			requeued.push(item.queue_item_id);
			staleAdmitted.push(item.queue_item_id);
		} else if (item.queue_state === 'RUNNING' && item.run_id && !isRunAlive(item.run_id)) {
			// RUNNING, aber Run existiert nicht mehr → kapazitätsneutral finalisieren
			updateQueueItem(db, item.queue_item_id, {
				queue_state: 'COMPLETED',
				finished_at: now,
				reason_code: 'READY',
			});
			requeued.push(item.queue_item_id);
		}
	}
	return { requeued, staleAdmitted };
}

function emit(
	config: Pick<SchedulerConfig, 'emitEvent'>,
	event: SchedulerEvent,
): void {
	try {
		config.emitEvent?.(event);
	} catch {
		// Events sind Best-Effort — Scheduling darf daran nie scheitern.
	}
}

/**
 * Persistenter Event-Handler (§56): schreibt Scheduler-Events in
 * cp_scheduler_events (timestamp + reason_code). Als `emitEvent` in der
 * SchedulerConfig verwenden, damit die Events durable sind.
 */
export function persistSchedulerEvent(db: Database.Database) {
	return (event: SchedulerEvent): void => {
		db.prepare(
			`INSERT INTO cp_scheduler_events (queue_item_id, run_id, event, timestamp, reason_code)
			 VALUES (?, ?, ?, ?, ?)`,
		).run(event.queue_item_id, event.run_id, event.event, event.timestamp, event.reason_code);
	};
}

/** Liest persistierte Scheduler-Events (introspection, §56) */
export function listSchedulerEvents(
	db: Database.Database,
	queueItemId?: string,
): SchedulerEvent[] {
	const rows = queueItemId
		? (db
				.prepare('SELECT * FROM cp_scheduler_events WHERE queue_item_id = ? ORDER BY event_id ASC')
				.all(queueItemId) as Array<Record<string, unknown>>)
		: (db
				.prepare('SELECT * FROM cp_scheduler_events ORDER BY event_id ASC')
				.all() as Array<Record<string, unknown>>);
	return rows.map((r) => ({
		queue_item_id: String(r.queue_item_id),
		run_id: r.run_id ? String(r.run_id) : null,
		event: String(r.event),
		timestamp: String(r.timestamp),
		reason_code: String(r.reason_code),
	}));
}

// ---------------------------------------------------------------------------
// Kapazitäts-Introspection (§58)
// ---------------------------------------------------------------------------

export function schedulerCapacity(db: Database.Database, config: SchedulerConfig) {
	return {
		maxActiveRuns: config.maxActiveRuns,
		activeRuns: countActiveRuns(db),
		queueDepth: listQueueItems(db).filter((q) =>
			['QUEUED', 'WAITING_DEPENDENCY', 'WAITING_RESOURCE'].includes(q.queue_state),
		).length,
		waitingDependency: listQueueItems(db).filter((q) => q.queue_state === 'WAITING_DEPENDENCY').length,
		waitingResource: listQueueItems(db).filter((q) => q.queue_state === 'WAITING_RESOURCE').length,
	};
}
