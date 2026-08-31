import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { BackupValidationError, backupDatabase, restoreDatabase } from '../backup.js';
import { applyControlPlaneMigrations } from '../schema.js';

const tempRoots: string[] = [];
afterEach(() => {
	for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(): { db: Database.Database; root: string; source: string } {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-465-backup-'));
	tempRoots.push(root);
	const source = path.join(root, 'source.db');
	const db = new Database(source);
	db.exec('CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT NOT NULL);');
	applyControlPlaneMigrations(db);
	db.prepare('INSERT INTO runs VALUES (?, ?)').run('run-465', 'completed');
	db.prepare(
		'INSERT INTO cp_queue (queue_item_id, source_type, source_ref, repository_ref, queue_state, enqueued_at, dedup_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
	).run(
		'queue-465',
		'issue',
		'465',
		'Mueller-Systems-Lab/Positron',
		'COMPLETED',
		'2026-08-31',
		'idem-465',
	);
	db.prepare(
		'INSERT INTO cp_jobs (job_id, run_id, job_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
	).run('job-465', 'run-465', 'build', '2026-08-31', '2026-08-31');
	db.prepare(
		'INSERT INTO cp_attempts (attempt_id, run_id, job_id, status) VALUES (?, ?, ?, ?)',
	).run('attempt-465', 'run-465', 'job-465', 'succeeded');
	db.prepare('INSERT INTO cp_decisions VALUES (?, ?, ?, ?, ?, ?)').run(
		'decision-465',
		'run-465',
		'APPROVE',
		'test',
		'{}',
		'2026-08-31',
	);
	db.prepare(
		'INSERT INTO cp_decision_reconciliations (reconciliation_id, run_id, source_decision_id, job_id, attempt_id, previous_decision, reconciled_decision, reason_code, evidence_refs_json, evidence_hashes_json, created_at, reconciliation_time, provenance_version, resolution_ordinal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
	).run(
		'recon-465',
		'run-465',
		'decision-465',
		'job-465',
		'attempt-465',
		'APPROVE',
		'APPROVE',
		'test',
		'[]',
		'[]',
		'2026-08-31',
		'2026-08-31',
		'v1',
		1,
	);
	db.prepare(
		'INSERT INTO cp_approval_consumptions (consumption_id, approval_fingerprint, run_id, queue_item_id, job_id, attempt_id, repository, repository_id, base_sha, effect_manifest_hash, branch_identity, branch_identity_hash, file_path, file_sha256, commit_metadata_sha256, pr_metadata_sha256, approval_expires_at, consumed_at, idempotency_key, idempotency_key_hash, approval_schema_version, attempt_lease_generation, workspace_lock_generation, provenance_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
	).run(
		'consumption-465',
		'approval-fp',
		'run-465',
		'queue-465',
		'job-465',
		'attempt-465',
		'Mueller-Systems-Lab/Positron',
		'repo-465',
		'base',
		'effect-fp',
		'branch',
		'branch-hash',
		'file',
		'file-hash',
		'commit-hash',
		'pr-hash',
		'2026-09-01',
		'2026-08-31',
		'idem-approval',
		'idem-hash',
		'v1',
		1,
		1,
		'v1',
		'2026-08-31',
	);
	return { db, root, source };
}

describe('Issue #465 online backup and restore contract', () => {
	it('preserves durable state and rejects unsafe restore inputs', async () => {
		const { db, root, source } = fixture();
		const backup = path.join(root, 'backup.db');
		await backupDatabase(db, backup);
		db.close();
		const restored = await restoreDatabase(backup, path.join(root, 'restored.db'));
		expect(restored.prepare('SELECT id FROM runs').get()).toEqual({ id: 'run-465' });
		expect(restored.prepare('SELECT COUNT(*) AS count FROM cp_attempts').get()).toEqual({
			count: 1,
		});
		expect(
			restored.prepare('SELECT COUNT(*) AS count FROM cp_approval_consumptions').get(),
		).toEqual({ count: 1 });
		restored.close();
		await expect(
			restoreDatabase(path.join(root, 'missing.db'), path.join(root, 'new.db')),
		).rejects.toThrow(BackupValidationError);
		expect(fs.existsSync(source)).toBe(true);
	});
});
