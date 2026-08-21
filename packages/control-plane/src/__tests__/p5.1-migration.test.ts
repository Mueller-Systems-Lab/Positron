// Positron Control Plane — P5.1 Migration & Historical Compatibility Tests
//
// Matrix:
//   MIGRATION_FROM_CANONICAL_P4   (V1–V6 Bestand → V7 additiv, legacy lesbar)
//   MIGRATION_IDEMPOTENT          (zweiter Durchlauf verändert nichts)
//   HISTORICAL_ATTEMPT_COMPATIBILITY (alte Rows ohne P5.1-Felder lesbar)
//   NO_RETROACTIVE_PROFILE_INVENTION (Migration erfindet keine Profile)
//   HARNESS_PROFILE_ID_PERSISTED / HARNESS_PROFILE_VERSION_PERSISTED
//   MODEL_ADAPTER_PROVENANCE_PERSISTED
//   TASK_PROFILE_ID_PERSISTED / TASK_PROFILE_VERSION_PERSISTED
//   EFFECTIVE_HARNESS_FINGERPRINT_PERSISTED

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { PROVENANCE_KNOWN, buildHarnessProfileRef } from '../harness-profile.js';
import { PROVIDER_RESERVATION_SCHEMA_V6 } from '../provider-capacity.js';
import { SCHEDULER_EVENTS_SCHEMA, SCHEDULER_QUEUE_SCHEMA_V4 } from '../queue-schema.js';
import { CONTROL_PLANE_SCHEMA_V1, applyControlPlaneMigrations } from '../schema.js';
import { createAttempt, createJob, getAttempt } from '../store.js';
import { WORKSPACE_LOCK_SCHEMA_V5 } from '../workspace-lock.js';

/**
 * Baut eine DB im kanonischen P4-Zustand (Schema V1–V6, OHNE V7-Spalten)
 * inkl. historischer Attempt-Daten — die Baseline, von der P5.1 migriert.
 */
function createCanonicalP4Db(): Database.Database {
	const db = new Database(':memory:');
	db.exec(CONTROL_PLANE_SCHEMA_V1);
	// V2 (previous_attempt_id) — manuell wie im P4-Code-Stand:
	db.exec('ALTER TABLE cp_attempts ADD COLUMN previous_attempt_id TEXT');
	// V3 (Lease/Fencing):
	db.exec('ALTER TABLE cp_attempts ADD COLUMN lease_owner_id TEXT');
	db.exec('ALTER TABLE cp_attempts ADD COLUMN lease_generation INTEGER NOT NULL DEFAULT 0');
	db.exec('ALTER TABLE cp_attempts ADD COLUMN lease_expires_at TEXT');
	db.exec('ALTER TABLE cp_attempts ADD COLUMN claimed_at TEXT');
	// V4/V5/V6 (P4-Tabellen):
	db.exec(SCHEDULER_QUEUE_SCHEMA_V4);
	db.exec(SCHEDULER_EVENTS_SCHEMA);
	db.exec(WORKSPACE_LOCK_SCHEMA_V5);
	db.exec(PROVIDER_RESERVATION_SCHEMA_V6);
	return db;
}

function v7Columns(db: Database.Database): string[] {
	const cols = db.prepare('PRAGMA table_info(cp_attempts)').all() as Array<{ name: string }>;
	return cols.map((c) => c.name);
}

/**
 * Legt eine historische Attempt-Row im exakten P4-Spaltenformat an
 * (OHNE V7-Spalten) — simuliert echte Daten aus der P4-Ära.
 */
function insertP4LegacyAttempt(
	db: Database.Database,
	runId: string,
	jobId: string,
	attemptId: string,
): void {
	db.prepare(
		`INSERT INTO cp_attempts (attempt_id, run_id, job_id, status, input_contract,
		   input_fingerprint, output_contract, output_fingerprint, worker_type, provider, model,
		   started_at, ended_at, failure_class, failure_signature, new_evidence, strategy_delta,
		   result_ref, tokens, previous_attempt_id, lease_owner_id, lease_generation,
		   lease_expires_at, claimed_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		attemptId,
		runId,
		jobId,
		'succeeded',
		'positron.build-input.v1',
		'fp_legacy_input',
		'positron.build-result.v1',
		'fp_legacy_output',
		'opencode',
		'openai',
		'gpt-4o',
		'2026-08-01T10:00:00.000Z',
		'2026-08-01T10:05:00.000Z',
		null,
		null,
		null,
		null,
		null,
		null,
		null,
		null,
		0,
		null,
		null,
	);
}

describe('MIGRATION_FROM_CANONICAL_P4', () => {
	it('adds nullable V7 columns without touching legacy rows', () => {
		const db = createCanonicalP4Db();
		// Historische Attempts (P4-Zeit, ohne P5.1-Felder):
		const job = createJob(db, 'run_legacy', 'build');
		insertP4LegacyAttempt(db, 'run_legacy', job.job_id, 'att_legacy_1');

		// P5.1-Migration anwenden:
		applyControlPlaneMigrations(db);

		const columns = v7Columns(db);
		for (const col of [
			'harness_profile_id',
			'harness_profile_version',
			'harness_fingerprint',
			'harness_profile_ref',
			'task_profile_id',
			'task_profile_version',
			'task_type',
			'provider_adapter_id',
			'provider_adapter_version',
			'model_provenance_status',
		]) {
			expect(columns).toContain(col);
		}

		// HISTORICAL_ATTEMPT_COMPATIBILITY: alte Row bleibt lesbar,
		// P5.1-Felder NULL (kein Erfinden).
		const after = getAttempt(db, 'att_legacy_1')!;
		expect(after.harness_profile_id).toBeNull();
		expect(after.harness_fingerprint).toBeNull();
		expect(after.task_type).toBeNull();
		expect(after.model_provenance_status).toBeNull();
		expect(after.provider).toBe('openai');
		expect(after.model).toBe('gpt-4o');
	});

	it('NO_RETROACTIVE_PROFILE_INVENTION: migration never writes profile values', () => {
		const db = createCanonicalP4Db();
		const job = createJob(db, 'run_x', 'build');
		insertP4LegacyAttempt(db, 'run_x', job.job_id, 'att_legacy_2');

		applyControlPlaneMigrations(db);

		const row = db
			.prepare(
				'SELECT harness_profile_id, harness_fingerprint FROM cp_attempts WHERE attempt_id = ?',
			)
			.get('att_legacy_2') as {
			harness_profile_id: string | null;
			harness_fingerprint: string | null;
		};
		expect(row.harness_profile_id).toBeNull();
		expect(row.harness_fingerprint).toBeNull();
	});
});

describe('MIGRATION_IDEMPOTENT', () => {
	it('applying migrations twice is a no-op', () => {
		const db = createCanonicalP4Db();
		applyControlPlaneMigrations(db);
		const columnsAfterFirst = v7Columns(db).join(',');
		const firstSchema = db
			.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cp_attempts'")
			.get() as { sql: string };

		applyControlPlaneMigrations(db);
		applyControlPlaneMigrations(db);

		const columnsAfterThird = v7Columns(db).join(',');
		const thirdSchema = db
			.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cp_attempts'")
			.get() as { sql: string };
		expect(columnsAfterThird).toBe(columnsAfterFirst);
		expect(thirdSchema.sql).toBe(firstSchema.sql);
	});
});

describe('P5.1 PERSISTENCE FIELDS', () => {
	it('HARNESS_PROFILE_ID_PERSISTED / HARNESS_PROFILE_VERSION_PERSISTED', () => {
		const db = new Database(':memory:');
		applyControlPlaneMigrations(db);
		const ref = buildHarnessProfileRef({
			harness_profile_id: 'profile-x',
			harness_profile_version: '4.2.0',
			task_profile_id: 'plan-contract',
			task_profile_version: '1.0.0',
			task_type: 'plan',
			provider: 'openrouter',
			model: 'deepseek-v4-flash',
			model_provenance_status: PROVENANCE_KNOWN,
			semantics: { model_profile: { id: 'profile-x', version: '4.2.0' } },
		});
		const job = createJob(db, 'run_p', 'plan');
		const attempt = createAttempt(db, 'run_p', job.job_id, {
			status: 'succeeded',
			harness_profile_id: ref.harness_profile_id,
			harness_profile_version: ref.harness_profile_version,
			harness_fingerprint: ref.effective_harness_fingerprint,
			harness_profile_ref: JSON.stringify(ref),
			task_profile_id: ref.task_profile_id,
			task_profile_version: ref.task_profile_version,
			task_type: ref.task_type,
			provider_adapter_id: ref.provider_adapter_id,
			provider_adapter_version: ref.provider_adapter_version,
			model_provenance_status: ref.model_provenance_status,
		});
		const loaded = getAttempt(db, attempt.attempt_id)!;
		expect(loaded.harness_profile_id).toBe('profile-x');
		expect(loaded.harness_profile_version).toBe('4.2.0');
		expect(loaded.harness_fingerprint).toBe(ref.effective_harness_fingerprint);
		expect(loaded.task_profile_id).toBe('plan-contract');
		expect(loaded.task_profile_version).toBe('1.0.0');
		expect(loaded.task_type).toBe('plan');
		expect(loaded.provider_adapter_id).toBeNull(); // nicht erfunden
		expect(loaded.model_provenance_status).toBe('KNOWN');
	});
});
