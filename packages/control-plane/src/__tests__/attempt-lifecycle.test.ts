// P3 — Attempt-Lifecycle: Claiming, Transition-Guard, Late Results,
// Duplicate Completion, Fix-Referenzierung (previous_attempt_id)

import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { applyControlPlaneMigrations } from '../schema.js';
import {
	claimAttempt,
	completeAttempt,
	createAttempt,
	createJob,
	createId,
	getAttempt,
	listJobAttempts,
} from '../store.js';

function openDb(): Database.Database {
	const db = new Database(':memory:');
	applyControlPlaneMigrations(db);
	return db;
}

describe('attempt lifecycle (P3)', () => {
	it('ATTEMPT_CLAIM_EXCLUSIVE — pending → running nur für genau einen Claimer', () => {
		const db = openDb();
		const job = createJob(db, 'run_1', 'build');
		const attempt = createAttempt(db, 'run_1', job.job_id, { status: 'pending' });
		expect(attempt.status).toBe('pending');

		expect(claimAttempt(db, attempt.attempt_id)).toBe(true);
		expect(getAttempt(db, attempt.attempt_id)?.status).toBe('running');
		// Zweiter (paralleler) Claim desselben Attempts: abgelehnt
		expect(claimAttempt(db, attempt.attempt_id)).toBe(false);
		// Kein Claim auf nicht-existierendem Attempt
		expect(claimAttempt(db, 'att_unknown')).toBe(false);
	});

	it('ATTEMPT_LIFECYCLE — pending→running→succeeded ist die kanonische Kette', () => {
		const db = openDb();
		const job = createJob(db, 'run_1', 'baseline');
		const attempt = createAttempt(db, 'run_1', job.job_id, { status: 'pending' });
		expect(claimAttempt(db, attempt.attempt_id)).toBe(true);
		const done = completeAttempt(db, attempt.attempt_id, {
			status: 'succeeded',
			output_contract: 'positron.baseline.v1',
			output_fingerprint: 'fp',
			result_ref: 'ref',
		});
		expect(done?.status).toBe('succeeded');
		expect(done?.ended_at).not.toBeNull();
	});

	it('DUPLICATE_COMPLETION — zweite Completion auf finalem Attempt ist eine No-Op (keine zweite Mutation)', () => {
		const db = openDb();
		const job = createJob(db, 'run_1', 'build');
		const attempt = createAttempt(db, 'run_1', job.job_id);
		completeAttempt(db, attempt.attempt_id, {
			status: 'succeeded',
			output_fingerprint: 'fp-1',
			result_ref: 'result-1',
		});
		// Identisches Ergebnis ein zweites Mal zustellen
		const second = completeAttempt(db, attempt.attempt_id, {
			status: 'succeeded',
			output_fingerprint: 'fp-1',
			result_ref: 'result-1',
		});
		expect(second).toBeNull();
		const row = getAttempt(db, attempt.attempt_id);
		expect(row?.status).toBe('succeeded');
		expect(row?.output_fingerprint).toBe('fp-1');
		expect(row?.result_ref).toBe('result-1');
	});

	it('LATE_RESULT_IGNORED — verspätetes Ergebnis nach timed_out überschreibt den finalen Attempt nicht', () => {
		const db = openDb();
		const job = createJob(db, 'run_1', 'build');
		const attempt = createAttempt(db, 'run_1', job.job_id, { status: 'pending' });
		claimAttempt(db, attempt.attempt_id);
		completeAttempt(db, attempt.attempt_id, {
			status: 'timed_out',
			failure_class: 'TIMEOUT',
			failure_signature: 'timeout-120s',
		});
		// Worker liefert verspätet ein Erfolgs-Ergebnis
		const late = completeAttempt(db, attempt.attempt_id, {
			status: 'succeeded',
			output_contract: 'positron.build-result.v1',
			output_fingerprint: 'fp-late',
		});
		expect(late).toBeNull();
		const row = getAttempt(db, attempt.attempt_id);
		expect(row?.status).toBe('timed_out');
		expect(row?.output_fingerprint).toBeNull();
		// Kein TIMED_OUT → SUCCEEDED
	});

	it('NO_INVALID_TRANSITION — finale Zustände sind unveränderlich (failed/blocked/denied → nichts)', () => {
		const db = openDb();
		const job = createJob(db, 'run_1', 'build');
		for (const finalStatus of ['failed', 'blocked', 'denied', 'timed_out'] as const) {
			const attempt = createAttempt(db, 'run_1', job.job_id, { status: finalStatus });
			const attemptId = attempt.attempt_id;
			// Versuch, den finalen Zustand zu ändern
			expect(
				completeAttempt(db, attemptId, { status: 'succeeded' }),
				`${finalStatus} → succeeded muss blockiert werden`,
			).toBeNull();
			expect(completeAttempt(db, attemptId, { status: 'failed' })).toBeNull();
			expect(getAttempt(db, attemptId)?.status).toBe(finalStatus);
		}
	});

	it('VERIFY_RECLASSIFY — succeeded → failed ist nur mit failure_class + failure_signature erlaubt (build+verify)', () => {
		const db = openDb();
		const job = createJob(db, 'run_1', 'build');
		const attempt = createAttempt(db, 'run_1', job.job_id);
		completeAttempt(db, attempt.attempt_id, {
			status: 'succeeded',
			output_contract: 'positron.build-result.v1',
		});
		// Ohne Failure-Klassifikation: blockiert
		expect(completeAttempt(db, attempt.attempt_id, { status: 'failed' })).toBeNull();
		// Mit deterministischer Klassifikation aus der Verification: erlaubt
		const reclassified = completeAttempt(db, attempt.attempt_id, {
			status: 'failed',
			failure_class: 'TEST_FAILURE',
			failure_signature: 'verify:test-a failed',
		});
		expect(reclassified?.status).toBe('failed');
		expect(reclassified?.failure_class).toBe('TEST_FAILURE');
	});

	it('FIX_CHAIN — previous_attempt_id referenziert den vorherigen Attempt (keine überschriebene Historie)', () => {
		const db = openDb();
		const job = createJob(db, 'run_1', 'build');
		const attempt1 = createAttempt(db, 'run_1', job.job_id, {
			status: 'pending',
			attempt_id: createId('att'),
			input_contract: 'positron.build-input.v1',
			input_fingerprint: 'fp-in-1',
		});
		claimAttempt(db, attempt1.attempt_id);
		completeAttempt(db, attempt1.attempt_id, { status: 'failed', failure_class: 'TEST_FAILURE', failure_signature: 's1' });

		const attempt2 = createAttempt(db, 'run_1', job.job_id, {
			status: 'pending',
			attempt_id: createId('att'),
			input_contract: 'positron.build-input.v1',
			input_fingerprint: 'fp-in-2',
			previous_attempt_id: attempt1.attempt_id,
		});
		expect(attempt2.previous_attempt_id).toBe(attempt1.attempt_id);
		claimAttempt(db, attempt2.attempt_id);
		completeAttempt(db, attempt2.attempt_id, { status: 'succeeded' });

		const history = listJobAttempts(db, job.job_id);
		expect(history).toHaveLength(2);
		expect(history[0]!.status).toBe('failed');
		expect(history[1]!.status).toBe('succeeded');
		expect(history[1]!.previous_attempt_id).toBe(attempt1.attempt_id);
	});

	it('MIGRATION_V2 — applyControlPlaneMigrations ist idempotent und erweitert bestehende DBs', () => {
		const db = new Database(':memory:');
		db.exec(`
			CREATE TABLE cp_attempts (
				attempt_id TEXT PRIMARY KEY,
				run_id TEXT NOT NULL,
				job_id TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'running'
			);
		`);
		applyControlPlaneMigrations(db);
		// Spalte wurde ergänzt (bestehende DB)
		const cols = db.prepare('PRAGMA table_info(cp_attempts)').all() as Array<{ name: string }>;
		expect(cols.map((c) => c.name)).toContain('previous_attempt_id');
		// Idempotenz: zweiter Lauf wirft nicht
		applyControlPlaneMigrations(db);
		applyControlPlaneMigrations(db);
	});
});
