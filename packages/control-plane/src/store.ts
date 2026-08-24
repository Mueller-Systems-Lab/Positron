// Positron Control Plane — Job/Attempt-Persistenz (Store)
//
// Hierarchie: run → job → attempt
// Jeder Attempt speichert Input/Output-Contract, Fingerprints, Worker-/
// Provider-/Modell-Informationen, Failure-Klassifikation, neue Evidenz und
// Strategie-Delta. Die Historie ist unveränderlich (kein Überschreiben).

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export type JobType =
	| 'intake'
	| 'baseline'
	| 'specify'
	| 'clarify'
	| 'research'
	| 'plan'
	| 'tasks'
	| 'analyze'
	| 'plan_gate'
	| 'build'
	| 'verify'
	| 'review'
	| 'decide'
	| 'fix'
	| 'split';

export type JobState = 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'skipped';

export interface JobRecord {
	job_id: string;
	run_id: string;
	job_type: JobType;
	state: JobState;
	parent_job_id: string | null;
	created_at: string;
	updated_at: string;
}

// Kanonische Attempt-Status-Taxonomie (durable execution lifecycle):
//
//   pending  → angelegt, noch nicht zur Ausführung geclaimt
//   running  → vom Worker geclaimt, Ausführung läuft
//   succeeded / failed / blocked / timed_out / denied → final
//
// Gültige Übergänge:
//   pending  → running            (atomarer Claim, genau ein Claimer)
//   pending/running → succeeded | failed | blocked | timed_out | denied
//   succeeded → failed             (fachliche Reklassifikation build+verify,
//                                    NUR mit failure_class + failure_signature)
//
// Finale Zustände sind unveränderlich: verspätete Ergebnisse (Late Results)
// und doppelte Completions überschreiben NIE einen finalen Attempt.
export type AttemptStatus =
	| 'pending'
	| 'running'
	| 'succeeded'
	| 'failed'
	| 'blocked'
	| 'timed_out'
	| 'denied';

export interface AttemptRecord {
	attempt_id: string;
	run_id: string;
	job_id: string;
	status: AttemptStatus;
	input_contract: string | null;
	input_fingerprint: string | null;
	output_contract: string | null;
	output_fingerprint: string | null;
	output_json: string | null;
	worker_type: string | null;
	provider: string | null;
	model: string | null;
	started_at: string;
	ended_at: string | null;
	failure_class: string | null;
	failure_signature: string | null;
	new_evidence: string | null;
	strategy_delta: string | null;
	result_ref: string | null;
	tokens: number | null;
	/** Fix-/Retry-Kette: vorheriger Attempt desselben fachlichen Schritts */
	previous_attempt_id: string | null;
	// ── P3.5 Lease/Fencing (Phase B) ──────────────────────────────────────
	/** Besitzer des Attempts (Worker-/Controller-Instanz) */
	lease_owner_id: string | null;
	/** Fencing-Token: wird bei jedem Re-Claim erhöht; alte Generation verliert Autorität */
	lease_generation: number;
	/** Heartbeat-Deadline (ISO); abgelaufen → stale */
	lease_expires_at: string | null;
	/** Claim-Zeitpunkt (Diagnose) */
	claimed_at: string | null;
	// ── P5.1 Harness Profile Identity & Provenance (V7) ──────────────────
	/** Modell-Harness-Profil (Identity-Ebene B); NULL → LEGACY_PROFILE_UNSPECIFIED */
	harness_profile_id: string | null;
	/** Version des Modell-Harness-Profils */
	harness_profile_version: string | null;
	/** Effektiver Harness-Fingerprint (SHA-256 über semantische Konfiguration) */
	harness_fingerprint: string | null;
	/** Validierter positron.harness-profile-ref.v1 Contract (JSON) */
	harness_profile_ref: string | null;
	/** Aufgabenprofil (Identity-Ebene C); Korrespondenz job_type */
	task_profile_id: string | null;
	task_profile_version: string | null;
	/** Kanonischer Task-Typ */
	task_type: string | null;
	/** Technischer Model-Adapter (nur wenn tatsächlich bekannt) */
	provider_adapter_id: string | null;
	provider_adapter_version: string | null;
	/** KNOWN | PROVENANCE_UNAVAILABLE | LEGACY_PROFILE_UNSPECIFIED */
	model_provenance_status: string | null;
	// ── P5.2 Effective Runtime Configuration (V8) ─────────────────────────
	/** Validierter positron.effective-harness.v1 Contract (JSON) */
	effective_harness_config: string | null;
	/** SHA-256 der Effective Config (ohne Runtime-Werte) */
	effective_harness_fingerprint: string | null;
	// ── P5.3 Two-Axis Failure Diagnosis & Routing (V9) ───────────────────
	/** Failure-Domain: HARNESS | EXECUTION | STRATEGY | CAPABILITY | UNKNOWN */
	failure_domain: string | null;
	/** Reason Code der Diagnose-Policy */
	diagnosis_reason_code: string | null;
	/** SHA-256 der Diagnose */
	diagnosis_fingerprint: string | null;
	/** Routing-Action: RETRY_WITH_* | ESCALATE_MODEL_PROFILE | INSPECT_BLOCK | NO_RETRY */
	routing_action: string | null;
	/** Reason Code der Routing-Policy */
	routing_reason_code: string | null;
	/** SHA-256 der Routing-Entscheidung */
	routing_fingerprint: string | null;
}

export function createId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso(): string {
	return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Lease-TTL-Konfiguration (P4 — zentral, validiert, bounded)
// ---------------------------------------------------------------------------

/**
 * P4: Zentraler Default der Attempt-Lease-TTL (5 Minuten).
 * Kein Magic Infinity, kein undefined: jeder produktive Claim trägt eine
 * reale bounded TTL, damit abgelaufene Leases deterministisch recovered
 * werden können (kein Zombie-Owner, der nach einem Crash weiter mutiert).
 */
export const DEFAULT_ATTEMPT_LEASE_TTL_MS = 300_000;

/**
 * P4: Löst die Attempt-Lease-TTL aus der zentralen Runtime-Konfiguration.
 *
 * - `POSITRON_ATTEMPT_LEASE_TTL_MS` (Millisekunden) überschreibt den Default.
 * - Ungültige Werte (nicht numerisch, nicht endlich, <= 0) werfen — Fail-Closed:
 *   eine kaputte Konfiguration darf nie zu einer unbegrenzten Lease führen.
 * - Tests steuern eine kontrolliert kleine TTL über dieselbe Variable oder
 *   über `deps.attemptLeaseTtlMs`.
 */
export function resolveAttemptLeaseTtlMs(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env.POSITRON_ATTEMPT_LEASE_TTL_MS;
	if (raw === undefined || raw.trim() === '') {
		return DEFAULT_ATTEMPT_LEASE_TTL_MS;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(
			`POSITRON_ATTEMPT_LEASE_TTL_MS invalid: '${raw}' — must be a positive finite number of milliseconds`,
		);
	}
	return Math.floor(parsed);
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export function createJob(
	db: Database.Database,
	runId: string,
	jobType: JobType,
	parentJobId: string | null = null,
): JobRecord {
	const job: JobRecord = {
		job_id: createId('job'),
		run_id: runId,
		job_type: jobType,
		state: 'pending',
		parent_job_id: parentJobId,
		created_at: nowIso(),
		updated_at: nowIso(),
	};
	db.prepare(
		`INSERT INTO cp_jobs (job_id, run_id, job_type, state, parent_job_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	).run(
		job.job_id,
		job.run_id,
		job.job_type,
		job.state,
		job.parent_job_id,
		job.created_at,
		job.updated_at,
	);
	return job;
}

export function getJob(db: Database.Database, jobId: string): JobRecord | null {
	const row = db.prepare('SELECT * FROM cp_jobs WHERE job_id = ?').get(jobId) as
		| Record<string, unknown>
		| undefined;
	return row ? mapJobRow(row) : null;
}

export function listJobs(db: Database.Database, runId: string): JobRecord[] {
	const rows = db
		.prepare('SELECT * FROM cp_jobs WHERE run_id = ? ORDER BY created_at ASC')
		.all(runId) as Array<Record<string, unknown>>;
	return rows.map(mapJobRow);
}

export function updateJobState(
	db: Database.Database,
	jobId: string,
	state: JobState,
): JobRecord | null {
	db.prepare('UPDATE cp_jobs SET state = ?, updated_at = ? WHERE job_id = ?').run(
		state,
		nowIso(),
		jobId,
	);
	return getJob(db, jobId);
}

function mapJobRow(row: Record<string, unknown>): JobRecord {
	return {
		job_id: String(row.job_id),
		run_id: String(row.run_id),
		job_type: row.job_type as JobType,
		state: row.state as JobState,
		parent_job_id: row.parent_job_id ? String(row.parent_job_id) : null,
		created_at: String(row.created_at),
		updated_at: String(row.updated_at),
	};
}

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

export function createAttempt(
	db: Database.Database,
	runId: string,
	jobId: string,
	initial: Partial<AttemptRecord> = {},
): AttemptRecord {
	const attempt: AttemptRecord = {
		attempt_id: initial.attempt_id ?? createId('att'),
		run_id: runId,
		job_id: jobId,
		// P3: Default ist 'pending' (Claim via claimAttempt → running).
		// Ein Attempt darf nicht ungeclaimt als 'running' starten.
		status: initial.status ?? 'pending',
		input_contract: initial.input_contract ?? null,
		input_fingerprint: initial.input_fingerprint ?? null,
		output_contract: initial.output_contract ?? null,
		output_fingerprint: initial.output_fingerprint ?? null,
		output_json: initial.output_json ?? null,
		worker_type: initial.worker_type ?? null,
		provider: initial.provider ?? null,
		model: initial.model ?? null,
		started_at: initial.started_at ?? nowIso(),
		ended_at: initial.ended_at ?? null,
		failure_class: initial.failure_class ?? null,
		failure_signature: initial.failure_signature ?? null,
		new_evidence: initial.new_evidence ?? null,
		strategy_delta: initial.strategy_delta ?? null,
		result_ref: initial.result_ref ?? null,
		tokens: initial.tokens ?? null,
		previous_attempt_id: initial.previous_attempt_id ?? null,
		lease_owner_id: initial.lease_owner_id ?? null,
		lease_generation: initial.lease_generation ?? 0,
		lease_expires_at: initial.lease_expires_at ?? null,
		claimed_at: initial.claimed_at ?? null,
		// P5.1: Harness Profile Identity (additiv, nullable — Legacy kompatibel)
		harness_profile_id: initial.harness_profile_id ?? null,
		harness_profile_version: initial.harness_profile_version ?? null,
		harness_fingerprint: initial.harness_fingerprint ?? null,
		harness_profile_ref: initial.harness_profile_ref ?? null,
		task_profile_id: initial.task_profile_id ?? null,
		task_profile_version: initial.task_profile_version ?? null,
		task_type: initial.task_type ?? null,
		provider_adapter_id: initial.provider_adapter_id ?? null,
		provider_adapter_version: initial.provider_adapter_version ?? null,
		model_provenance_status: initial.model_provenance_status ?? null,
		// P5.2: Effective Runtime Configuration (additiv, nullable)
		effective_harness_config: initial.effective_harness_config ?? null,
		effective_harness_fingerprint: initial.effective_harness_fingerprint ?? null,
		// P5.3: Two-Axis Failure Diagnosis & Routing (additiv, nullable)
		failure_domain: initial.failure_domain ?? null,
		diagnosis_reason_code: initial.diagnosis_reason_code ?? null,
		diagnosis_fingerprint: initial.diagnosis_fingerprint ?? null,
		routing_action: initial.routing_action ?? null,
		routing_reason_code: initial.routing_reason_code ?? null,
		routing_fingerprint: initial.routing_fingerprint ?? null,
	};
	db.prepare(
		`INSERT INTO cp_attempts (attempt_id, run_id, job_id, status, input_contract, input_fingerprint,
		   output_contract, output_fingerprint, output_json, worker_type, provider, model, started_at,
		   ended_at, failure_class, failure_signature, new_evidence, strategy_delta, result_ref, tokens,
		   previous_attempt_id, lease_owner_id, lease_generation, lease_expires_at, claimed_at,
		   harness_profile_id, harness_profile_version, harness_fingerprint, harness_profile_ref,
		   task_profile_id, task_profile_version, task_type, provider_adapter_id, provider_adapter_version,
		   model_provenance_status, effective_harness_config, effective_harness_fingerprint,
		   failure_domain, diagnosis_reason_code, diagnosis_fingerprint, routing_action, routing_reason_code, routing_fingerprint)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		attempt.attempt_id,
		attempt.run_id,
		attempt.job_id,
		attempt.status,
		attempt.input_contract,
		attempt.input_fingerprint,
		attempt.output_contract,
		attempt.output_fingerprint,
		attempt.output_json,
		attempt.worker_type,
		attempt.provider,
		attempt.model,
		attempt.started_at,
		attempt.ended_at,
		attempt.failure_class,
		attempt.failure_signature,
		attempt.new_evidence,
		attempt.strategy_delta,
		attempt.result_ref,
		attempt.tokens,
		attempt.previous_attempt_id,
		attempt.lease_owner_id,
		attempt.lease_generation,
		attempt.lease_expires_at,
		attempt.claimed_at,
		attempt.harness_profile_id,
		attempt.harness_profile_version,
		attempt.harness_fingerprint,
		attempt.harness_profile_ref,
		attempt.task_profile_id,
		attempt.task_profile_version,
		attempt.task_type,
		attempt.provider_adapter_id,
		attempt.provider_adapter_version,
		attempt.model_provenance_status,
		attempt.effective_harness_config,
		attempt.effective_harness_fingerprint,
		attempt.failure_domain,
		attempt.diagnosis_reason_code,
		attempt.diagnosis_fingerprint,
		attempt.routing_action,
		attempt.routing_reason_code,
		attempt.routing_fingerprint,
	);
	return attempt;
}

/**
 * Atomarer Claim (Lease) eines Attempts: `pending → running`.
 * SQLite-Transaktions-Semantik genügt: nur EIN Claimer gewinnt; ein zweiter
 * (paralleler) Claim desselben Attempts erhält `false` und darf NICHT ausführen.
 *
 * P3.5 (Phase B): Claim setzt eine durable Lease:
 *   - `lease_owner_id` — Besitzer (Worker-/Controller-Instanz)
 *   - `lease_generation` — Fencing-Token, bei jedem Claim +1
 *   - `lease_expires_at` — Heartbeat-Deadline (jetzt + leaseTtlMs)
 *
 * Rückgabe: `{ claimed: boolean; generation: number }` — die Generation ist
 * der Fencing-Token, den der Besitzer bei `completeAttempt` vorweisen muss.
 */
export interface ClaimResult {
	claimed: boolean;
	generation: number;
}

export function claimAttempt(
	db: Database.Database,
	attemptId: string,
	options: { ownerId?: string; leaseTtlMs?: number } = {},
): boolean {
	const now = nowIso();
	const expiresAt = options.leaseTtlMs
		? new Date(Date.now() + options.leaseTtlMs).toISOString()
		: null;
	const res = db
		.prepare(
			`UPDATE cp_attempts
			 SET status = 'running',
			     lease_owner_id = ?,
			     lease_generation = lease_generation + 1,
			     lease_expires_at = ?,
			     claimed_at = ?
			 WHERE attempt_id = ? AND status = 'pending'`,
		)
		.run(options.ownerId ?? null, expiresAt, now, attemptId);
	return res.changes === 1;
}

/** Wie `claimAttempt`, liefert aber den Fencing-Token (Generation) zurück. */
export function claimAttemptWithGeneration(
	db: Database.Database,
	attemptId: string,
	options: { ownerId?: string; leaseTtlMs?: number } = {},
): ClaimResult {
	const claimed = claimAttempt(db, attemptId, options);
	const attempt = getAttempt(db, attemptId);
	return {
		claimed,
		generation: attempt?.lease_generation ?? 0,
	};
}

/**
 * Lease-Heartbeat: verlängert `lease_expires_at` für einen laufenden Attempt.
 * Nur der aktuelle Besitzer (`lease_owner_id`) darf erneuern; fremde Besitzer
 * erhalten `false` (Fencing — kein fremder Heartbeat hält eine Lease am Leben).
 */
export function renewAttemptLease(
	db: Database.Database,
	attemptId: string,
	ownerId: string,
	leaseTtlMs: number,
): boolean {
	const expiresAt = new Date(Date.now() + leaseTtlMs).toISOString();
	const res = db
		.prepare(
			`UPDATE cp_attempts SET lease_expires_at = ?
			 WHERE attempt_id = ? AND lease_owner_id = ? AND status = 'running'`,
		)
		.run(expiresAt, attemptId, ownerId);
	return res.changes === 1;
}

/**
 * Prüft, ob die Lease eines laufenden Attempts noch gültig ist.
 * `false` → abgelaufen (stale) oder fremder Besitzer.
 */
export function isAttemptLeaseValid(
	db: Database.Database,
	attemptId: string,
	ownerId: string | null,
): boolean {
	const attempt = getAttempt(db, attemptId);
	if (!attempt || attempt.status !== 'running') return false;
	if (ownerId !== null && attempt.lease_owner_id !== ownerId) return false;
	if (attempt.lease_expires_at === null) return true; // kein Lease-TTL gesetzt → gültig
	return new Date(attempt.lease_expires_at).getTime() > Date.now();
}

/**
 * Stale-Lease-Recovery (deterministisch):
 *
 * Findet alle `running`-Attempts, deren Lease abgelaufen ist (kein Heartbeat).
 * Der alte Besitzer hat seine Autorität VERLOREN:
 *   - Status wird auf `failed` mit failure_class `STALE_LEASE` finalisiert
 *     (kein paralleler Re-Start desselben mutierenden Attempts!)
 *   - `recoverable=true` signalisiert dem Orchestrator, dass ein NEUER
 *     Attempt (frische generation) nach der Retry-/Run-Semantik starten darf
 *
 * Rückgabe: Liste der stale Attempt-Records (finalisiert).
 */
export function recoverStaleLeases(
	db: Database.Database,
	options: { ownerId?: string | null; ownerIdPrefix?: string | null; now?: string } = {},
): AttemptRecord[] {
	const now = options.now ?? nowIso();
	const stale = db
		.prepare(
			`SELECT * FROM cp_attempts
			 WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`,
		)
		.all(now) as Array<Record<string, unknown>>;

	const recovered: AttemptRecord[] = [];
	for (const row of stale) {
		const attempt = mapAttemptRow(row);
		if (options.ownerId !== undefined && attempt.lease_owner_id !== options.ownerId) {
			// Fremder Attempt: NICHT hier recoveren (Eigentümer-Kontext respektieren).
			continue;
		}
		if (
			options.ownerIdPrefix !== undefined &&
			options.ownerIdPrefix !== null &&
			!(attempt.lease_owner_id ?? '').startsWith(options.ownerIdPrefix)
		) {
			// Prefix-Filter (z. B. `ctl:<runId>:`): nur Leases dieses Runs.
			continue;
		}
		const updated = completeAttempt(db, attempt.attempt_id, {
			status: 'failed',
			failure_class: 'STALE_LEASE',
			failure_signature: `lease-expired at ${attempt.lease_expires_at}`,
		});
		if (updated) recovered.push(updated);
	}
	return recovered;
}

/**
 * P5.1 — Bindet eine validierte Harness-Referenz atomar an einen Attempt.
 *
 * @deprecated Nicht verdrahtet: Die kanonische Bindung erfolgt ATOMAR über
 * `createAttempt` (Insert inkl. P5.1-Feldern) in `trackJobAttempt`
 * (worker-pipeline) und den produktiven Pfaden von `durable-run.ts`
 * (PROFILE_REF_BOUND_BEFORE_EXECUTION). Diese Funktion bleibt als
 * expliziter Re-Bind-Pfad für künftige Szenarien verfügbar und ist
 * idempotent/mismatch-geschützt — sie wird aktuell von keinem produktiven
 * Pfad aufgerufen und ist NICHT Teil des Security-Contracts.
 *
 * Die Profilidentität ist Teil des tatsächlichen Execution Contexts und wird
 * VOR der Modell-Ausführung gebunden. Idempotent: bereits gebundene
 * identische Refs sind ein No-op; ein semantischer Mismatch (anderer
 * Fingerprint auf demselben Attempt) wird abgelehnt (kein nachträgliches
 * Umschreiben der Historie).
 *
 * @returns `true` bei erfolgreicher Bindung, `false` bei Mismatch/finalem Attempt
 */
export function bindHarnessProfileToAttempt(
	db: Database.Database,
	attemptId: string,
	ref: {
		harness_profile_id: string;
		harness_profile_version: string;
		harness_fingerprint: string;
		harness_profile_ref: string;
		task_profile_id: string;
		task_profile_version: string;
		task_type: string;
		provider_adapter_id: string | null;
		provider_adapter_version: string | null;
		model_provenance_status: string;
	},
): boolean {
	return db.transaction((): boolean => {
		const existing = getAttempt(db, attemptId);
		if (!existing) return false;
		if (
			existing.status === 'failed' ||
			existing.status === 'blocked' ||
			existing.status === 'timed_out' ||
			existing.status === 'denied' ||
			existing.status === 'succeeded'
		) {
			// Finale Attempts sind unveränderlich — keine nachträgliche Bindung.
			return false;
		}
		if (
			existing.harness_fingerprint !== null &&
			existing.harness_fingerprint !== ref.harness_fingerprint
		) {
			// Semantischer Mismatch: die gebundene Konfiguration widerspricht
			// der bereits persistierten — ablehnen statt überschreiben.
			return false;
		}
		const res = db
			.prepare(
				`UPDATE cp_attempts SET
				   harness_profile_id = ?,
				   harness_profile_version = ?,
				   harness_fingerprint = ?,
				   harness_profile_ref = ?,
				   task_profile_id = ?,
				   task_profile_version = ?,
				   task_type = ?,
				   provider_adapter_id = ?,
				   provider_adapter_version = ?,
				   model_provenance_status = ?
				 WHERE attempt_id = ?`,
			)
			.run(
				ref.harness_profile_id,
				ref.harness_profile_version,
				ref.harness_fingerprint,
				ref.harness_profile_ref,
				ref.task_profile_id,
				ref.task_profile_version,
				ref.task_type,
				ref.provider_adapter_id,
				ref.provider_adapter_version,
				ref.model_provenance_status,
				attemptId,
			);
		return res.changes === 1;
	})();
}

export function getAttempt(db: Database.Database, attemptId: string): AttemptRecord | null {
	const row = db.prepare('SELECT * FROM cp_attempts WHERE attempt_id = ?').get(attemptId) as
		| Record<string, unknown>
		| undefined;
	return row ? mapAttemptRow(row) : null;
}

export function listAttempts(db: Database.Database, runId: string): AttemptRecord[] {
	const rows = db
		.prepare('SELECT * FROM cp_attempts WHERE run_id = ? ORDER BY started_at ASC')
		.all(runId) as Array<Record<string, unknown>>;
	return rows.map(mapAttemptRow);
}

export function listJobAttempts(db: Database.Database, jobId: string): AttemptRecord[] {
	const rows = db
		.prepare('SELECT * FROM cp_attempts WHERE job_id = ? ORDER BY started_at ASC')
		.all(jobId) as Array<Record<string, unknown>>;
	return rows.map(mapAttemptRow);
}

/**
 * Prüft, ob eine Attempt-Transition valide ist (Late-Result-/Duplicate-Completion-Policy).
 *
 * - `pending`/`running` → beliebige Finalisierung (inkl. Teil-Update ohne Statuswechsel)
 * - `succeeded` → `failed` NUR als fachliche Reklassifikation build+verify
 *   (deterministisch aus der Verification: failure_class + failure_signature vorhanden)
 * - finale Zustände (`failed`/`blocked`/`timed_out`/`denied`) und identische
 *   Folge-Completions → blockiert: keine Überschreibung, keine zweite Mutation
 */
export function canTransitionAttempt(
	from: AttemptStatus,
	to: AttemptStatus,
	update: Partial<AttemptRecord>,
): boolean {
	if (from === 'succeeded') {
		return to === 'failed' && Boolean(update.failure_class) && Boolean(update.failure_signature);
	}
	if (from === 'failed' || from === 'blocked' || from === 'timed_out' || from === 'denied') {
		return false;
	}
	return true;
}

export function completeAttempt(
	db: Database.Database,
	attemptId: string,
	update: Partial<AttemptRecord>,
	options: { fencingOwnerId?: string | null; fencingGeneration?: number } = {},
): AttemptRecord | null {
	// Atomare Finalisierung: Read-Modify-Write in EINER SQLite-Transaktion,
	// damit Late-Result/Duplicate-Completion unter Konkurrenz (mehrere
	// Worker-Prozesse auf derselben DB) den Transition-Guard nicht umgehen
	// (Security-Review F4 — TOCTOU-Schutz).
	return db.transaction((): AttemptRecord | null => {
		const existing = getAttempt(db, attemptId);
		if (!existing) return null;
		// P3.5 (Phase B) — Fencing: Wenn der Aufrufer einen Lease-Token
		// vorweist, muss er der aktuelle Besitzer UND Generation sein.
		// Ein stale Worker (alte Generation / fremder Owner) verliert:
		//   STALE_EXECUTION_RESULT → REJECTED (kein State-Update).
		if (options.fencingOwnerId !== undefined || options.fencingGeneration !== undefined) {
			const ownerOk =
				options.fencingOwnerId === undefined || existing.lease_owner_id === options.fencingOwnerId;
			const genOk =
				options.fencingGeneration === undefined ||
				existing.lease_generation === options.fencingGeneration;
			if (!ownerOk || !genOk) {
				return null;
			}
		}
		const to = update.status ?? existing.status;
		if (!canTransitionAttempt(existing.status, to, update)) {
			// Late Result / Duplicate Completion: finaler Attempt bleibt unverändert.
			return null;
		}
		// Security-Review m2: Fencing zusätzlich im UPDATE-WHERE — der Write
		// greift nur, wenn Owner UND Generation beim Schreiben noch stimmen
		// (verhindert ein letztes Fenster zwischen Read und Write unter
		// Konkurrenz; BEGIN DEFERRED serialisiert den Write-Lock).
		// Nur anwenden, wenn der Aufrufer explizite Fencing-Optionen setzt;
		// Legacy-Attempts (lease_owner_id NULL) bleiben kompatibel.
		const fence = options.fencingOwnerId !== undefined || options.fencingGeneration !== undefined;
		const whereOwner =
			options.fencingOwnerId !== undefined ? options.fencingOwnerId : existing.lease_owner_id;
		const whereGen =
			options.fencingGeneration !== undefined
				? options.fencingGeneration
				: existing.lease_generation;
		const base = `UPDATE cp_attempts SET status = ?, output_contract = ?, output_fingerprint = ?, output_json = ?,
			   ended_at = ?, failure_class = ?, failure_signature = ?, new_evidence = ?, strategy_delta = ?,
			   result_ref = ?, tokens = ?, previous_attempt_id = ?,
			   failure_domain = ?, diagnosis_reason_code = ?, diagnosis_fingerprint = ?,
			   routing_action = ?, routing_reason_code = ?, routing_fingerprint = ?
			 WHERE attempt_id = ?`;
		const fenced = fence ? ' AND lease_owner_id = ? AND lease_generation = ?' : '';
		const res = db
			.prepare(base + fenced)
			.run(
				to,
				update.output_contract ?? existing.output_contract,
				update.output_fingerprint ?? existing.output_fingerprint,
				update.output_json ?? existing.output_json,
				update.ended_at ?? nowIso(),
				update.failure_class ?? existing.failure_class,
				update.failure_signature ?? existing.failure_signature,
				update.new_evidence ?? existing.new_evidence,
				update.strategy_delta ?? existing.strategy_delta,
				update.result_ref ?? existing.result_ref,
				update.tokens ?? existing.tokens,
				update.previous_attempt_id ?? existing.previous_attempt_id,
				update.failure_domain ?? existing.failure_domain,
				update.diagnosis_reason_code ?? existing.diagnosis_reason_code,
				update.diagnosis_fingerprint ?? existing.diagnosis_fingerprint,
				update.routing_action ?? existing.routing_action,
				update.routing_reason_code ?? existing.routing_reason_code,
				update.routing_fingerprint ?? existing.routing_fingerprint,
				attemptId,
				...(fence ? [whereOwner, whereGen] : []),
			);
		if (res.changes === 0) {
			// Fencing-Konflikt beim Write (Owner/Generation seit Read geändert)
			return null;
		}
		return getAttempt(db, attemptId);
	})();
}

export function mapAttemptRow(row: Record<string, unknown>): AttemptRecord {
	return {
		attempt_id: String(row.attempt_id),
		run_id: String(row.run_id),
		job_id: String(row.job_id),
		status: row.status as AttemptStatus,
		input_contract: row.input_contract ? String(row.input_contract) : null,
		input_fingerprint: row.input_fingerprint ? String(row.input_fingerprint) : null,
		output_contract: row.output_contract ? String(row.output_contract) : null,
		output_fingerprint: row.output_fingerprint ? String(row.output_fingerprint) : null,
		output_json: row.output_json ? String(row.output_json) : null,
		worker_type: row.worker_type ? String(row.worker_type) : null,
		provider: row.provider ? String(row.provider) : null,
		model: row.model ? String(row.model) : null,
		started_at: String(row.started_at),
		ended_at: row.ended_at ? String(row.ended_at) : null,
		failure_class: row.failure_class ? String(row.failure_class) : null,
		failure_signature: row.failure_signature ? String(row.failure_signature) : null,
		new_evidence: row.new_evidence ? String(row.new_evidence) : null,
		strategy_delta: row.strategy_delta ? String(row.strategy_delta) : null,
		result_ref: row.result_ref ? String(row.result_ref) : null,
		tokens: row.tokens !== null && row.tokens !== undefined ? Number(row.tokens) : null,
		previous_attempt_id: row.previous_attempt_id ? String(row.previous_attempt_id) : null,
		lease_owner_id: row.lease_owner_id ? String(row.lease_owner_id) : null,
		lease_generation:
			row.lease_generation !== null && row.lease_generation !== undefined
				? Number(row.lease_generation)
				: 0,
		lease_expires_at: row.lease_expires_at ? String(row.lease_expires_at) : null,
		claimed_at: row.claimed_at ? String(row.claimed_at) : null,
		harness_profile_id: row.harness_profile_id ? String(row.harness_profile_id) : null,
		harness_profile_version: row.harness_profile_version
			? String(row.harness_profile_version)
			: null,
		harness_fingerprint: row.harness_fingerprint ? String(row.harness_fingerprint) : null,
		harness_profile_ref: row.harness_profile_ref ? String(row.harness_profile_ref) : null,
		task_profile_id: row.task_profile_id ? String(row.task_profile_id) : null,
		task_profile_version: row.task_profile_version ? String(row.task_profile_version) : null,
		task_type: row.task_type ? String(row.task_type) : null,
		provider_adapter_id: row.provider_adapter_id ? String(row.provider_adapter_id) : null,
		provider_adapter_version: row.provider_adapter_version
			? String(row.provider_adapter_version)
			: null,
		model_provenance_status: row.model_provenance_status
			? String(row.model_provenance_status)
			: null,
		effective_harness_config: row.effective_harness_config
			? String(row.effective_harness_config)
			: null,
		effective_harness_fingerprint: row.effective_harness_fingerprint
			? String(row.effective_harness_fingerprint)
			: null,
		failure_domain: row.failure_domain ? String(row.failure_domain) : null,
		diagnosis_reason_code: row.diagnosis_reason_code ? String(row.diagnosis_reason_code) : null,
		diagnosis_fingerprint: row.diagnosis_fingerprint ? String(row.diagnosis_fingerprint) : null,
		routing_action: row.routing_action ? String(row.routing_action) : null,
		routing_reason_code: row.routing_reason_code ? String(row.routing_reason_code) : null,
		routing_fingerprint: row.routing_fingerprint ? String(row.routing_fingerprint) : null,
	};
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export interface DecisionRecord {
	decision_id: string;
	run_id: string;
	decision: string;
	reason_code: string;
	contract_json: string;
	created_at: string;
}

export function storeDecision(
	db: Database.Database,
	runId: string,
	decision: string,
	reasonCode: string,
	contractJson: string,
	createdAt?: string,
): DecisionRecord {
	const record: DecisionRecord = {
		decision_id: createId('dec'),
		run_id: runId,
		decision,
		reason_code: reasonCode,
		contract_json: contractJson,
		created_at: createdAt ?? nowIso(),
	};
	db.prepare(
		`INSERT INTO cp_decisions (decision_id, run_id, decision, reason_code, contract_json, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	).run(
		record.decision_id,
		record.run_id,
		record.decision,
		record.reason_code,
		record.contract_json,
		record.created_at,
	);
	return record;
}

export function listDecisions(db: Database.Database, runId: string): DecisionRecord[] {
	const rows = db
		.prepare('SELECT * FROM cp_decisions WHERE run_id = ? ORDER BY created_at ASC')
		.all(runId) as Array<Record<string, unknown>>;
	return rows.map((row) => ({
		decision_id: String(row.decision_id),
		run_id: String(row.run_id),
		decision: String(row.decision),
		reason_code: String(row.reason_code),
		contract_json: String(row.contract_json),
		created_at: String(row.created_at),
	}));
}

// ---------------------------------------------------------------------------
// Transitions (maschinenlesbare State Changes mit reason_code)
// ---------------------------------------------------------------------------

export interface TransitionRecord {
	transition_id: string;
	run_id: string;
	previous_state: string;
	new_state: string;
	reason_code: string;
	created_at: string;
}

export function storeTransition(
	db: Database.Database,
	runId: string,
	previousState: string,
	newState: string,
	reasonCode: string,
): TransitionRecord {
	const record: TransitionRecord = {
		transition_id: createId('tr'),
		run_id: runId,
		previous_state: previousState,
		new_state: newState,
		reason_code: reasonCode,
		created_at: nowIso(),
	};
	db.prepare(
		`INSERT INTO cp_transitions (transition_id, run_id, previous_state, new_state, reason_code, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	).run(
		record.transition_id,
		record.run_id,
		record.previous_state,
		record.new_state,
		record.reason_code,
		record.created_at,
	);
	return record;
}

export function listTransitions(db: Database.Database, runId: string): TransitionRecord[] {
	const rows = db
		.prepare('SELECT * FROM cp_transitions WHERE run_id = ? ORDER BY created_at ASC')
		.all(runId) as Array<Record<string, unknown>>;
	return rows.map((row) => ({
		transition_id: String(row.transition_id),
		run_id: String(row.run_id),
		previous_state: String(row.previous_state),
		new_state: String(row.new_state),
		reason_code: String(row.reason_code),
		created_at: String(row.created_at),
	}));
}
