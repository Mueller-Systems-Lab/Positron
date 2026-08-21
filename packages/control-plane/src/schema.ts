// Positron Control Plane — DB-Schema (Migrationen auf bestehender SQLite-DB)

import type Database from 'better-sqlite3';
import { PROVIDER_RESERVATION_SCHEMA_V6 } from './provider-capacity.js';
import { SCHEDULER_EVENTS_SCHEMA, SCHEDULER_QUEUE_SCHEMA_V4 } from './queue-schema.js';
import { WORKSPACE_LOCK_SCHEMA_V5 } from './workspace-lock.js';

/**
 * Control-Plane-Migrationen. Laufen auf der SELBEN SQLite-DB wie run-state
 * (keine neue Datenbank). Wird via `applyControlPlaneMigrations(db)` angewendet.
 */
export const CONTROL_PLANE_SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS cp_jobs (
  job_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  parent_job_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cp_attempts (
  attempt_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  input_contract TEXT,
  input_fingerprint TEXT,
  output_contract TEXT,
  output_fingerprint TEXT,
  output_json TEXT,
  worker_type TEXT,
  provider TEXT,
  model TEXT,
  started_at TEXT,
  ended_at TEXT,
  failure_class TEXT,
  failure_signature TEXT,
  new_evidence TEXT,
  strategy_delta TEXT,
  result_ref TEXT,
  tokens INTEGER
);

CREATE TABLE IF NOT EXISTS cp_decisions (
  decision_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  contract_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cp_idempotency (
  idem_key TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'claimed',
  result_ref TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS cp_transitions (
  transition_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  previous_state TEXT NOT NULL,
  new_state TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cp_jobs_run_id ON cp_jobs(run_id);
CREATE INDEX IF NOT EXISTS idx_cp_attempts_run_id ON cp_attempts(run_id);
CREATE INDEX IF NOT EXISTS idx_cp_attempts_job_id ON cp_attempts(job_id);
CREATE INDEX IF NOT EXISTS idx_cp_decisions_run_id ON cp_decisions(run_id);
CREATE INDEX IF NOT EXISTS idx_cp_transitions_run_id ON cp_transitions(run_id);
`;

function columnExists(db: Database.Database, table: string, column: string): boolean {
	const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
	return cols.some((c) => c.name === column);
}

/**
 * V2: `previous_attempt_id` — Fix-/Retry-Attempts referenzieren den vorherigen
 * Attempt (fachliche Kette, keine überschriebene Historie). Idempotent für
 * bestehende Datenbanken (Soak-DB, Produktion).
 */
function applyV2(db: Database.Database): void {
	if (!columnExists(db, 'cp_attempts', 'previous_attempt_id')) {
		db.exec('ALTER TABLE cp_attempts ADD COLUMN previous_attempt_id TEXT');
	}
}

/**
 * V3 (P3.5/Phase B — Runtime Hardening): durable Lease + Fencing.
 *
 * `lease_owner_id`       — wer den Attempt hält (Worker-/Controller-Instanz)
 * `lease_generation`     — Fencing-Token: wird bei JEDEM Re-Claim erhöht;
 *                          alte Besitzer (Generation n-1) verlieren Autorität
 * `lease_expires_at`     — Heartbeat-Deadline (ISO). Abgelaufen → stale
 * `claimed_at`           — Claim-Zeitpunkt (Diagnose)
 *
 * Idempotent für bestehende Datenbanken (V1/V2-Bestände, Soak-DB).
 */
function applyV3(db: Database.Database): void {
	if (!columnExists(db, 'cp_attempts', 'lease_owner_id')) {
		db.exec('ALTER TABLE cp_attempts ADD COLUMN lease_owner_id TEXT');
	}
	if (!columnExists(db, 'cp_attempts', 'lease_generation')) {
		db.exec('ALTER TABLE cp_attempts ADD COLUMN lease_generation INTEGER NOT NULL DEFAULT 0');
	}
	if (!columnExists(db, 'cp_attempts', 'lease_expires_at')) {
		db.exec('ALTER TABLE cp_attempts ADD COLUMN lease_expires_at TEXT');
	}
	if (!columnExists(db, 'cp_attempts', 'claimed_at')) {
		db.exec('ALTER TABLE cp_attempts ADD COLUMN claimed_at TEXT');
	}
}

/**
 * V7 (P5.1 — Harness Profile Identity, Provenance & Metrics Foundation).
 *
 * Additive, nullable P5.1-Telemetrie-Spalten auf `cp_attempts`:
 *
 *   harness_profile_id        — Modell-Harness-Profil (Identity-Ebene B)
 *   harness_profile_version   — versionierte Profil-Konfiguration
 *   harness_fingerprint       — effektiver Harness-Fingerprint (SHA-256,
 *                               kanonische Fingerprint-Primitive)
 *   harness_profile_ref       — validierter positron.harness-profile-ref.v1
 *                               Contract (JSON, reproduzierbare Semantik)
 *   task_profile_id           — Aufgabenprofil (Identity-Ebene C)
 *   task_profile_version      — Profil-Version des Aufgabenprofils
 *   task_type                 — kanonischer Task-Typ (Korrespondenz job_type)
 *   provider_adapter_id       — technischer Model-Adapter (nur wenn bekannt)
 *   provider_adapter_version  — Adapter-Version (nur wenn tatsächlich bekannt)
 *   model_provenance_status   — KNOWN | PROVENANCE_UNAVAILABLE |
 *                               LEGACY_PROFILE_UNSPECIFIED (kein Erfinden)
 *
 * Alle Spalten sind NULLABLE (kein DEFAULT): historische Attempts (V1–V6)
 * bleiben ohne P5-Felder lesbar und werden als LEGACY_PROFILE_UNSPECIFIED /
 * PROVENANCE_UNAVAILABLE dargestellt — es wird NIE rückwirkend ein Profil
 * erfunden. Migration ist additiv, idempotent, forward-safe und
 * backward-compatible; keine bestehende Control-Plane-Invariante ändert sich.
 */
function applyV7(db: Database.Database): void {
	const v7Columns: Array<[string, string]> = [
		['harness_profile_id', 'TEXT'],
		['harness_profile_version', 'TEXT'],
		['harness_fingerprint', 'TEXT'],
		['harness_profile_ref', 'TEXT'],
		['task_profile_id', 'TEXT'],
		['task_profile_version', 'TEXT'],
		['task_type', 'TEXT'],
		['provider_adapter_id', 'TEXT'],
		['provider_adapter_version', 'TEXT'],
		['model_provenance_status', 'TEXT'],
	];
	for (const [column, type] of v7Columns) {
		if (!columnExists(db, 'cp_attempts', column)) {
			db.exec(`ALTER TABLE cp_attempts ADD COLUMN ${column} ${type}`);
		}
	}
}

export function applyControlPlaneMigrations(db: Database.Database): void {
	db.exec(CONTROL_PLANE_SCHEMA_V1);
	applyV2(db);
	applyV3(db);
	// P4 (Multi-Issue Scheduling): durable Intake-Queue (V4, idempotent)
	db.exec(SCHEDULER_QUEUE_SCHEMA_V4);
	db.exec(SCHEDULER_EVENTS_SCHEMA);
	// P4 (Slice D): persistenter Workspace Lock (V5, idempotent)
	db.exec(WORKSPACE_LOCK_SCHEMA_V5);
	// P4 (Slice E): Provider-Capacity-Reservierungen (V6, idempotent)
	db.exec(PROVIDER_RESERVATION_SCHEMA_V6);
	// P5.1: Harness Profile Identity & Provenance (V7, idempotent)
	applyV7(db);
}
