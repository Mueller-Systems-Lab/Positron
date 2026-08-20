// Positron Control Plane — P4 Scheduler Queue (Schema V4)
//
// Durable Intake-Queue für Multi-Issue Scheduling.
// Läuft auf der SELBEN SQLite-DB wie run-state + control-plane
// (keine neue Datenbank, kein Redis/Kafka/Temporal).
//
// Trennung (Auftrag §35):
//   Data Flow:  Issue → Contracts → Run Results      (unverändert, cp_jobs/cp_attempts)
//   Scheduling: Queue → Admission → Resource Claim → Run → Release  (cp_queue)
//
// Queue-State ≠ Run-State: cp_queue bildet die WARTERAUM-/Admission-Sicht;
// der eigentliche Run läuft weiterhin über die bestehende Run-State-Maschine.

export const SCHEDULER_QUEUE_SCHEMA_V4 = `
CREATE TABLE IF NOT EXISTS cp_queue (
  queue_item_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  repository_ref TEXT NOT NULL,
  run_id TEXT,
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  queue_state TEXT NOT NULL DEFAULT 'QUEUED',
  dependency_refs TEXT,
  enqueued_at TEXT NOT NULL,
  admitted_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  reason_code TEXT,
  dedup_key TEXT,
  provider TEXT
);

-- Dedup (§48): UNIQUE nur für AKTIVE Items — nach COMPLETED/CANCELLED/BLOCKED
-- ist ein neuer Eintrag erlaubt (expliziter Re-Run §49, neue run_id, eigene Historie).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cp_queue_dedup_active
  ON cp_queue(dedup_key)
  WHERE queue_state IN ('QUEUED', 'WAITING_DEPENDENCY', 'WAITING_RESOURCE', 'ADMITTED', 'RUNNING');

CREATE INDEX IF NOT EXISTS idx_cp_queue_state ON cp_queue(queue_state);
CREATE INDEX IF NOT EXISTS idx_cp_queue_repo ON cp_queue(repository_ref);
CREATE INDEX IF NOT EXISTS idx_cp_queue_priority ON cp_queue(priority, enqueued_at);
`;

/** Scheduler-Events (§56): wesentliche Übergänge mit timestamp + reason_code */
export const SCHEDULER_EVENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS cp_scheduler_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_item_id TEXT NOT NULL,
  run_id TEXT,
  event TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  reason_code TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cp_scheduler_events_item ON cp_scheduler_events(queue_item_id);
`;

/** Queue-States (Auftrag §34) */
export type QueueState =
	| 'QUEUED'
	| 'WAITING_DEPENDENCY'
	| 'WAITING_RESOURCE'
	| 'ADMITTED'
	| 'RUNNING'
	| 'COMPLETED'
	| 'BLOCKED'
	| 'CANCELLED';

/** Prioritäts-Schema (Auftrag §37) — unbekannte Priorität → NORMAL */
export type QueuePriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

export const QUEUE_PRIORITY_ORDER: Record<QueuePriority, number> = {
	CRITICAL: 0,
	HIGH: 1,
	NORMAL: 2,
	LOW: 3,
};

/** Reason-Codes (Auftrag §57) */
export type SchedulerReasonCode =
	| 'READY'
	| 'WAITING_DEPENDENCY'
	| 'GLOBAL_RUN_LIMIT'
	| 'PROVIDER_CAPACITY'
	| 'REPOSITORY_LOCKED'
	| 'WORKSPACE_LOCKED'
	| 'DEPENDENCY_CYCLE'
	| 'DUPLICATE_INTAKE'
	| 'CANCELLED_BY_USER'
	| 'HEAD_DRIFT';

export function normalizePriority(raw: string | null | undefined): QueuePriority {
	switch (raw) {
		case 'CRITICAL':
		case 'HIGH':
		case 'LOW':
			return raw;
		default:
			return 'NORMAL';
	}
}

/** Deterministischer Dedup-Key (Auftrag §48): source_type:repo:ref */
export function queueDedupKey(sourceType: string, repositoryRef: string, sourceRef: string): string {
	return `${sourceType}:${repositoryRef}:${sourceRef}`;
}
