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

/**
 * V8 (P5.2 — Static Model Profiles & Safe Runtime Compilation).
 *
 * Additive Referenzen der kompilierten Effective Runtime Configuration am
 * Attempt (gleiche DB, keine neuen Tabellen):
 *
 *   effective_harness_config      — validierter positron.effective-harness.v1
 *                                   Contract (JSON; reproduzierbar
 *                                   rekonstruierbare Effective Config inkl.
 *                                   effective permissions Kernel ∩ Profil)
 *   effective_harness_fingerprint — SHA-256 der Effective Config (ohne
 *                                   Runtime-Werte)
 *
 * NULLABLE: historische Attempts (V1–V7) bleiben unverändert lesbar;
 * P5.1-Referenzen (harness_profile_id etc.) bleiben bestehen.
 */
function applyV8(db: Database.Database): void {
	if (!columnExists(db, 'cp_attempts', 'effective_harness_config')) {
		db.exec('ALTER TABLE cp_attempts ADD COLUMN effective_harness_config TEXT');
	}
	if (!columnExists(db, 'cp_attempts', 'effective_harness_fingerprint')) {
		db.exec('ALTER TABLE cp_attempts ADD COLUMN effective_harness_fingerprint TEXT');
	}
}

/**
 * V9 (P5.3 — Two-Axis Failure Diagnosis & Evidence-Based Routing).
 *
 * Additive, nullable Diagnose-/Routing-Spalten auf `cp_attempts`:
 *
 *   failure_domain          — HARNESS | EXECUTION | STRATEGY | CAPABILITY | UNKNOWN
 *   diagnosis_reason_code   — reason code der Diagnose-Policy
 *   diagnosis_fingerprint   — SHA-256 der Diagnose (ohne Runtime)
 *   routing_action          — RETRY_WITH_* | ESCALATE_MODEL_PROFILE | INSPECT_BLOCK | NO_RETRY
 *   routing_reason_code     — reason code der Routing-Policy
 *   routing_fingerprint     — SHA-256 der Routing-Entscheidung
 *
 * NULLABLE: historische Attempts (V1–V8) bleiben ohne P5.3-Felder lesbar
 * und werden als UNKNOWN / NOT_APPLICABLE dargestellt — keine retroaktive
 * Capability-Erfindung. Migration ist additiv, idempotent, forward-safe.
 */
function applyV9(db: Database.Database): void {
	const v9Columns: Array<[string, string]> = [
		['failure_domain', 'TEXT'],
		['diagnosis_reason_code', 'TEXT'],
		['diagnosis_fingerprint', 'TEXT'],
		['routing_action', 'TEXT'],
		['routing_reason_code', 'TEXT'],
		['routing_fingerprint', 'TEXT'],
	];
	for (const [column, type] of v9Columns) {
		if (!columnExists(db, 'cp_attempts', column)) {
			db.exec(`ALTER TABLE cp_attempts ADD COLUMN ${column} ${type}`);
		}
	}
}

/**
 * V10 (P5.4 — Harness Evolution Sandbox, Compute-Matched Evaluation & Deterministic Promotion).
 *
 * Additive, idempotent, historical compatible. Same SQLite DB, no new DB.
 * 8 neue Tabellen für Candidate Lifecycle, Evaluation, Promotion, Shadow, Canary, Pointer.
 * Keine bestehende Attempt-Historie wird verändert.
 */
export const CONTROL_PLANE_SCHEMA_V10 = `
CREATE TABLE IF NOT EXISTS cp_harness_candidates (
  candidate_id TEXT PRIMARY KEY,
  parent_profile_id TEXT NOT NULL,
  parent_profile_version TEXT NOT NULL,
  parent_profile_fingerprint TEXT NOT NULL,
  candidate_version TEXT NOT NULL,
  candidate_fingerprint TEXT NOT NULL UNIQUE,
  hypothesis TEXT NOT NULL,
  created_from_evidence_refs TEXT NOT NULL,
  proposer_type TEXT NOT NULL,
  proposer_ref TEXT NOT NULL,
  candidate_profile_ref TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cp_candidate_transitions (
  transition_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES cp_harness_candidates(candidate_id),
  previous_status TEXT,
  new_status TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cp_dataset_partitions (
  partition_id TEXT PRIMARY KEY,
  partition_type TEXT NOT NULL,
  dataset_fingerprint TEXT NOT NULL,
  partition_fingerprint TEXT NOT NULL,
  task_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cp_harness_evaluations (
  evaluation_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES cp_harness_candidates(candidate_id),
  baseline_profile_ref TEXT NOT NULL,
  candidate_profile_ref TEXT NOT NULL,
  compute_matched_profile_ref TEXT NOT NULL,
  dataset_partition TEXT NOT NULL REFERENCES cp_dataset_partitions(partition_id),
  task_family TEXT,
  sample_size INTEGER NOT NULL,
  verified_success REAL NOT NULL,
  first_pass_success REAL NOT NULL,
  attempts_per_success REAL,
  time_to_verified_success REAL,
  tool_calls INTEGER,
  tokens INTEGER,
  cost TEXT NOT NULL,
  regressions TEXT NOT NULL,
  security_result TEXT NOT NULL,
  contract_result TEXT NOT NULL,
  recovery_result TEXT NOT NULL,
  permission_result TEXT NOT NULL,
  scheduler_result TEXT NOT NULL,
  evaluation_fingerprint TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cp_promotion_decisions (
  decision_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES cp_harness_candidates(candidate_id),
  current_profile_id TEXT NOT NULL,
  current_profile_fingerprint TEXT NOT NULL,
  candidate_profile_id TEXT NOT NULL,
  candidate_profile_fingerprint TEXT NOT NULL,
  evaluation_refs TEXT NOT NULL,
  holdout_result TEXT NOT NULL,
  compute_matched_result TEXT NOT NULL,
  security_result TEXT NOT NULL,
  contract_result TEXT NOT NULL,
  recovery_result TEXT NOT NULL,
  permission_result TEXT NOT NULL,
  scheduler_budget_result TEXT NOT NULL,
  sample_size INTEGER NOT NULL,
  decision TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  actor_authority TEXT NOT NULL,
  decision_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cp_shadow_runs (
  shadow_run_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES cp_harness_candidates(candidate_id),
  baseline_ref TEXT NOT NULL,
  candidate_ref TEXT NOT NULL,
  result_metrics TEXT NOT NULL,
  profile_fingerprints TEXT NOT NULL,
  production_pointer_before TEXT NOT NULL,
  production_pointer_after TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cp_canary_runs (
  canary_run_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES cp_harness_candidates(candidate_id),
  bounds TEXT NOT NULL,
  status TEXT NOT NULL,
  metrics TEXT NOT NULL,
  kill_switch_triggered INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS cp_production_profile_pointer (
  pointer_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  profile_fingerprint TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cp_profile_transitions (
  transition_id TEXT PRIMARY KEY,
  previous_profile_id TEXT,
  previous_fingerprint TEXT,
  new_profile_id TEXT NOT NULL,
  new_fingerprint TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  actor_authority TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cp_candidates_fingerprint ON cp_harness_candidates(candidate_fingerprint);
CREATE INDEX IF NOT EXISTS idx_cp_candidates_status ON cp_harness_candidates(status);
CREATE INDEX IF NOT EXISTS idx_cp_candidate_transitions_candidate ON cp_candidate_transitions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_cp_evaluations_candidate ON cp_harness_evaluations(candidate_id);
CREATE INDEX IF NOT EXISTS idx_cp_promotion_candidate ON cp_promotion_decisions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_cp_shadow_candidate ON cp_shadow_runs(candidate_id);
CREATE INDEX IF NOT EXISTS idx_cp_canary_candidate ON cp_canary_runs(candidate_id);
`;

function applyV10(db: Database.Database): void {
	db.exec(CONTROL_PLANE_SCHEMA_V10);
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
	// P5.2: Effective Runtime Configuration (V8, idempotent)
	applyV8(db);
	// P5.3: Two-Axis Failure Diagnosis & Routing (V9, idempotent)
	applyV9(db);
	// P5.4: Harness Evolution Sandbox (V10, idempotent)
	applyV10(db);
}
