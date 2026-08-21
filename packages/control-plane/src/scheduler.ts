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
import {
	DEFAULT_WORKSPACE_LOCK_TTL_MS,
	acquireWorkspaceLock,
	recoverStaleWorkspaceLocks,
	releaseWorkspaceLock,
} from './workspace-lock.js';

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
	/** Provider, den dieser Run nutzt (für Provider-Capacity §40/§65) */
	provider: string | null;
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
	/**
	 * P4 (Slice D): TTL des persistenten Workspace-Locks (ms).
	 * Default: DEFAULT_WORKSPACE_LOCK_TTL_MS (10 min).
	 */
	workspaceLockTtlMs?: number;
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
	/** Provider für Provider-Capacity (§40/§65) */
	provider?: string;
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
	// Review-Fix: Check + Insert in EINER Transaktion — konkurrierende
	// Duplikate liefern das bestehende Item (idempotent) statt UNIQUE-Error.
	return db.transaction((): QueueItemRecord => {
		if (!input.forceRerun) {
			const existing = db
				.prepare(
					`SELECT * FROM cp_queue WHERE dedup_key = ? AND queue_state IN
					 ('QUEUED', 'WAITING_DEPENDENCY', 'WAITING_RESOURCE', 'ADMITTED', 'RUNNING')`,
				)
				.get(dedupKey) as Record<string, unknown> | undefined;
			if (existing) {
				// Idempotenter Duplicate-Intake: bestehendes Item zurückgeben
				const record = mapQueueRow(existing);
				record.reason_code = 'DUPLICATE_INTAKE';
				return record;
			}
		}

		try {
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
				provider: input.provider ?? null,
			};
			db.prepare(
				`INSERT INTO cp_queue (queue_item_id, source_type, source_ref, repository_ref, run_id,
				   priority, queue_state, dependency_refs, enqueued_at, admitted_at, started_at, finished_at,
				   reason_code, dedup_key, provider)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
				item.provider,
			);
			return item;
		} catch (err) {
			// M4 (Architektur-Review): forceRerun kann mit einem requeued/
			// aktiven Item desselben dedup_key kollidieren (partieller
			// UNIQUE-Index). Idempotent auf das bestehende aktive Item
			// zurückfallen statt SQLITE_CONSTRAINT nach außen zu reichen.
			const active = db
				.prepare(
					`SELECT * FROM cp_queue WHERE dedup_key = ? AND queue_state IN
					 ('QUEUED', 'WAITING_DEPENDENCY', 'WAITING_RESOURCE', 'ADMITTED', 'RUNNING')`,
				)
				.get(dedupKey) as Record<string, unknown> | undefined;
			if (active) return mapQueueRow(active);
			throw err;
		}
	})();
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
		provider: row.provider ? String(row.provider) : null,
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
	//
	// Review-Fix (P3.5-Review R1): DFS-PATH-basierte Erkennung — ein Zyklus
	// liegt NUR vor, wenn ein Knoten auf dem AKTUELLEN DFS-Pfad erneut
	// erreicht wird. Ein Diamond (A→[B,C], B→D, C→D) ist KEIN Zyklus:
	// D wird über zwei Pfade erreicht, aber nie auf demselben Pfad wiederholt.
	// Drei-Farben-Markierung: 0=unbesucht, 1=auf aktuellem Pfad (grau),
	// 2=fertig erkundet (schwarz).
	const color = new Map<string, number>([[item.queue_item_id, 1]]);
	const pathStack: Array<{ ref: string; deps: string[]; index: number }> = [
		{ ref: item.queue_item_id, deps: item.dependency_refs, index: 0 },
	];
	while (pathStack.length > 0) {
		const frame = pathStack[pathStack.length - 1]!;
		if (frame.index >= frame.deps.length) {
			color.set(frame.ref, 2); // fertig erkundet
			pathStack.pop();
			continue;
		}
		const ref = frame.deps[frame.index]!;
		frame.index++;
		const dep = byRef.get(ref);
		if (!dep) continue;
		const depColor = color.get(dep.queue_item_id) ?? 0;
		if (depColor === 1) {
			// Auf dem aktuellen Pfad erneut erreicht → echter Zyklus
			return { ready: false, cycle: true, reason: 'DEPENDENCY_CYCLE' };
		}
		if (depColor === 2) continue; // bereits vollständig erkundet
		color.set(dep.queue_item_id, 1);
		pathStack.push({ ref: dep.queue_item_id, deps: dep.dependency_refs, index: 0 });
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
	// Aging (§38): NORMAL/LOW steigen nach agingSeconds Wartezeit eine Stufe.
	// Deterministisch: basiert auf dem injizierten `now` (Review-Fix — kein
	// verstecktes Date.now(), sonst ist der Scheduler nicht reproduzierbar).
	const nowMs = new Date(now).getTime();
	const candidates = listQueueItems(db)
		.filter(
			(q) =>
				q.queue_state === 'QUEUED' ||
				q.queue_state === 'WAITING_RESOURCE' ||
				q.queue_state === 'WAITING_DEPENDENCY',
		)
		.map((q) => {
			let priority = q.priority;
			if (config.agingSeconds && config.agingSeconds > 0) {
				const waitedMs = nowMs - new Date(q.enqueued_at).getTime();
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

	// Admission-Loop in EINER SQLite-Transaktion (Review-Fix R1/M1 +
	// Security M1): Kapazität/Repo-Lock/Provider werden innerhalb der
	// Transaktion erneut geprüft (BEGIN IMMEDIATE serialisiert konkurrierende
	// Scheduler-Prozesse auf derselben DB) → kein double-admission über das
	// Limit, kein Repo-Lock-Bypass unter Konkurrenz.
	const admission = db.transaction((): AdmissionDecision | null => {
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

			// Provider-Capacity (§40/§65): falls konfiguriert, blockiert NUR
			// Items, deren eigener Provider voll ist. Review-Fix R1: der
			// `continue` muss den ÄUSSEREN Loop fortsetzen (Item wird NICHT
			// admitiert), nicht nur die Provider-Schleife.
			let providerBlocked = false;
			if (item.provider && config.maxConcurrentByProvider && config.activeByProvider) {
				const active = config.activeByProvider();
				const max = config.maxConcurrentByProvider[item.provider];
				if (max !== undefined && (active[item.provider] ?? 0) >= max) {
					updateQueueItem(db, item.queue_item_id, {
						queue_state: 'WAITING_RESOURCE',
						reason_code: 'PROVIDER_CAPACITY',
					});
					providerBlocked = true;
				}
			}
			if (providerBlocked) continue;

			// P4 (Slice D): Persistenter Workspace Lock — Mutation-Exklusivität
			// über den QUEUE-State hinaus (überlebt Scheduler-/Worker-Crashs,
			// lease-/fence-aware). Workspace-Identity = repository_ref des Items
			// (isolierte disposable Workspaces sind 1:1 daran gebunden).
			// Der Lock wird ATOMAR innerhalb der Admission-Transaktion geclaimt
			// (nach ALLEN Prüfungen): konkurrierende Scheduler-Prozesse können
			// denselben Workspace nicht doppelt vergeben. Ein fremder gültiger
			// Lock blockiert (WORKSPACE_LOCKED); ein stale Lock wird per
			// Reclaim mit frischer Generation übernommen (FENCE_ADVANCED).
			const lockTtlMs = config.workspaceLockTtlMs ?? DEFAULT_WORKSPACE_LOCK_TTL_MS;
			const lock = acquireWorkspaceLock(db, item.repository_ref, item.queue_item_id, lockTtlMs, now);
			if (!lock.acquired) {
				updateQueueItem(db, item.queue_item_id, {
					queue_state: 'WAITING_RESOURCE',
					reason_code: 'WORKSPACE_LOCKED',
				});
				continue;
			}
			if (lock.reclaimed) {
				emit(config, {
					queue_item_id: item.queue_item_id,
					run_id: null,
					event: 'WORKSPACE_LOCK_RECLAIMED',
					timestamp: now,
					reason_code: 'WORKSPACE_LOCKED',
				});
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
	});
	return admission.immediate();
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
	// M5 (Architektur-Review): state-guarded — nur ADMITTED darf zu RUNNING
	// wechseln; ein doppelter Dispatch überschreibt keine finalen Items.
	const res = db
		.prepare(
			`UPDATE cp_queue SET queue_state = 'RUNNING', run_id = ?, started_at = ?, reason_code = 'READY'
			 WHERE queue_item_id = ? AND queue_state = 'ADMITTED'`,
		)
		.run(runId, now, queueItemId);
	if (res.changes !== 1) return null;
	const updated = getQueueItem(db, queueItemId);
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
	// M1 (Architektur-Review): FAILED/TIMEOUT sind EIGENE terminale States —
	// sie werden NICHT zu COMPLETED kollabiert, sonst würden abhängige Runs
	// nach einer fehlgeschlagenen Dependency fälschlich freigegeben.
	const queueState = state === 'COMPLETED' ? 'COMPLETED' : state;
	const updated = updateQueueItem(db, queueItemId, {
		queue_state: queueState as QueueState,
		finished_at: now,
		reason_code: reasonCode,
	});
	if (updated) {
		// P4 (Slice D): Lock-Release für ALLE terminalen Zustände
		// (COMPLETED/FAILED/BLOCKED/CANCELLED/TIMEOUT) — gefenced auf den
		// Owner (queue_item_id); ein alter Owner nach Reclaim kann den
		// Lock des neuen Besitzers nicht freigeben.
		try {
			releaseWorkspaceLock(db, updated.repository_ref, queueItemId);
		} catch {
			/* Lock-Release ist best-effort — darf Finalisierung nie verhindern */
		}
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
	config?: Pick<SchedulerConfig, 'emitEvent'>,
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
	if (updated) {
		// P4 (Slice D): Cancel eines terminalen QUEUED/WAITING-Items gibt den
		// Workspace-Lock frei (falls gehalten — RUNNING-Items release im
		// markRunFinished-Pfad).
		if (updated.queue_state === 'CANCELLED') {
			try {
				releaseWorkspaceLock(db, updated.repository_ref, queueItemId);
			} catch {
				/* best-effort */
			}
		}
		// Event wird über die übergebene Config persistiert (Review-Fix:
		// `emit({emitEvent: undefined})` hat das Event still verworfen).
		emit(config ?? {}, {
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
 * - RUNNING-Items mit totem Run → zurück auf QUEUED für einen kontrollierten
 *   Re-Run (Review-Fix: ein toter Run ist KEIN Erfolg — COMPLETED/READY wäre
 *   irreführend und würde das Item dauerhaft aus der Kapazität nehmen)
 * - WAITING_*-Items bleiben erhalten (nichts verloren).
 */
export function recoverSchedulerState(
	db: Database.Database,
	isRunAlive: (runId: string) => boolean,
	now = new Date().toISOString(),
): { requeued: string[]; staleAdmitted: string[]; deadRuns: string[] } {
	const requeued: string[] = [];
	const staleAdmitted: string[] = [];
	const deadRuns: string[] = [];
	// P4 (Slice D): Stale Workspace-Locks (Owner gecrasht, kein Heartbeat)
	// werden VOR der Re-Admission freigegeben — sonst blockiert ein
	// Zombie-Lock den Workspace dauerhaft.
	recoverStaleWorkspaceLocks(db, now);
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
			// RUNNING, aber Run existiert nicht mehr → requeue für kontrollierten
			// Re-Run (Retry-Semantik entscheidet über den neuen Attempt;
			// kein stilles COMPLETED/READY).
			updateQueueItem(db, item.queue_item_id, {
				queue_state: 'QUEUED',
				reason_code: 'READY',
			});
			requeued.push(item.queue_item_id);
			deadRuns.push(item.queue_item_id);
		}
	}
	return { requeued, staleAdmitted, deadRuns };
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
