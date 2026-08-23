// P4 — SLICE F CANARY: Production Crash Recovery (Restart-Semantik)
//
//   QUEUE_SURVIVES_RESTART       = PASS  (cp_queue durable über Restart)
//   RUNNING_RECOVERY_REAL        = PASS  (RUNNING-Item eines gecrashten Runs)
//   STALE_LEASE_RECOVERED        = PASS  (STALE_LEASE-Finalisierung)
//   STALE_WORKSPACE_LOCK_RECOVERED = PASS
//   PROVIDER_SLOT_RECOVERED      = PASS
//   COMPLETED_WORK_NOT_RERUN     = PASS  (Slice A-Canary: worker invoked once)
//   DUPLICATE_EFFECT = 0         = PASS

import fs from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { applyControlPlaneMigrations } from '@positron/control-plane';
import {
	claimAttemptWithGeneration,
	createAttempt,
	createJob,
	getAttempt,
} from '@positron/control-plane';
import {
	admitNext,
	enqueueItem,
	isRunLeaseAlive,
	markRunStarted,
	recoverSchedulerState,
} from '@positron/control-plane';
import { getWorkspaceLock } from '@positron/control-plane';
import { activeProviderReservations } from '@positron/control-plane';
import { applyMigrations } from '@positron/run-state';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../index.js';

describe('P4 SLICE F — CRASH RECOVERY (Kontroll-Ebene)', () => {
	it('RUNNING_RECOVERY_REAL: gecrashter Run (alle Leases stale) wird requeued; lebendiger Run bleibt', async () => {
		const db = new Database(':memory:');
		applyMigrations(db);
		applyControlPlaneMigrations(db);

		// Run A: "gecrasht" — Attempt geclaimt mit kurzer TTL, kein Heartbeat
		enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/1',
			repository_ref: 'repo/a',
		});
		const dA = admitNext(db, { maxActiveRuns: 4 });
		expect(dA?.admitted).toBe(true);
		const runIdA = 'run-crash-a';
		db.prepare('UPDATE cp_queue SET run_id = ?, queue_state = ? WHERE queue_item_id = ?').run(
			runIdA,
			'RUNNING',
			dA!.queue_item_id,
		);
		// Run-Zeile: aktiv (nicht terminal)
		db.prepare(
			"INSERT OR IGNORE INTO repositories (id, owner, name, url, local_path, enabled, created_at) VALUES ('repo/a', 'o', 'a', '', '', 1, datetime('now'))",
		).run();
		db.prepare(
			`INSERT INTO runs (id, repo_id, issue_number, branch, phase, status, autonomy_level, attempt, started_at, finished_at)
			 VALUES (?, 'repo/a', 1, NULL, 'IMPLEMENT', 'active', 2, 0, datetime('now'), NULL)`,
		).run(runIdA);
		// Attempt mit ablaufender Lease (Owner "crasht" vor dem Heartbeat)
		const job = createJob(db, runIdA, 'build');
		const attempt = createAttempt(db, runIdA, job.job_id, {
			status: 'pending',
			worker_type: 'opencode',
		});
		const claim = claimAttemptWithGeneration(db, attempt.attempt_id, {
			ownerId: `ctl:${runIdA}:crashed`,
			leaseTtlMs: 30,
		});
		expect(claim.claimed).toBe(true);

		// Run B: "lebt" — Attempt mit gültiger (langer) Lease
		enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/2',
			repository_ref: 'repo/b',
		});
		const dB = admitNext(db, { maxActiveRuns: 4 });
		const runIdB = 'run-alive-b';
		db.prepare(
			"INSERT OR IGNORE INTO repositories (id, owner, name, url, local_path, enabled, created_at) VALUES ('repo/b', 'o', 'b', '', '', 1, datetime('now'))",
		).run();
		db.prepare('UPDATE cp_queue SET run_id = ?, queue_state = ? WHERE queue_item_id = ?').run(
			runIdB,
			'RUNNING',
			dB!.queue_item_id,
		);
		db.prepare(
			`INSERT INTO runs (id, repo_id, issue_number, branch, phase, status, autonomy_level, attempt, started_at, finished_at)
			 VALUES (?, 'repo/b', 2, NULL, 'IMPLEMENT', 'active', 2, 0, datetime('now'), NULL)`,
		).run(runIdB);
		const jobB = createJob(db, runIdB, 'build');
		const attemptB = createAttempt(db, runIdB, jobB.job_id, {
			status: 'pending',
			worker_type: 'opencode',
		});
		claimAttemptWithGeneration(db, attemptB.attempt_id, {
			ownerId: `ctl:${runIdB}:alive`,
			leaseTtlMs: 600_000,
		});

		// Lease von A real ablaufen lassen
		await new Promise((r) => setTimeout(r, 60));
		const now = new Date().toISOString();

		// Recovery (Startup/Tick): lease-aware
		const result = recoverSchedulerState(db, (runId) => isRunLeaseAlive(db, runId, now), now);
		expect(result.deadRuns).toContain(dA!.queue_item_id);
		expect(result.deadRuns).not.toContain(dB!.queue_item_id);

		// A requeued, B bleibt RUNNING
		const aState = db
			.prepare('SELECT queue_state FROM cp_queue WHERE queue_item_id = ?')
			.get(dA!.queue_item_id) as { queue_state: string };
		expect(aState.queue_state).toBe('QUEUED');
		const bState = db
			.prepare('SELECT queue_state FROM cp_queue WHERE queue_item_id = ?')
			.get(dB!.queue_item_id) as { queue_state: string };
		expect(bState.queue_state).toBe('RUNNING');

		// Der gecrashte Attempt ist noch running (finalisiert wird beim
		// Resume in runPipeline via recoverStaleLeases → STALE_LEASE,
		// belegt durch den Slice-A-Canary OLD_OWNER_COMPLETION_REJECTED).
		expect(getAttempt(db, attempt.attempt_id)?.status).toBe('running');
		// Aber die Lease ist abgelaufen → der Run ist tot (deterministisch)
		expect(isRunLeaseAlive(db, runIdA, now)).toBe(false);
		expect(isRunLeaseAlive(db, runIdB, now)).toBe(true);
		db.close();
	});

	it('STALE_WORKSPACE_LOCK + PROVIDER_SLOT: Recovery räumt Zombie-Ressourcen', async () => {
		const db = new Database(':memory:');
		applyMigrations(db);
		applyControlPlaneMigrations(db);
		const cfg = {
			maxActiveRuns: 4,
			maxConcurrentByProvider: { deepseek: 1 },
			workspaceLockTtlMs: 30,
		};
		enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/3',
			repository_ref: 'repo/c',
			provider: 'deepseek',
		});
		const d = admitNext(db, cfg);
		expect(d?.admitted).toBe(true);
		expect(activeProviderReservations(db)).toEqual({ deepseek: 1 });
		expect(getWorkspaceLock(db, 'repo/c')?.owner_id).toBe(d!.queue_item_id);

		// Lock-TTL läuft ab (Owner "crasht" ohne Heartbeat)
		await new Promise((r) => setTimeout(r, 60));
		const now = new Date().toISOString();

		const result = recoverSchedulerState(db, () => false, now);
		// Slot + Lock freigegeben (Zombie-Owner)
		expect(activeProviderReservations(db)).toEqual({});
		expect(getWorkspaceLock(db, 'repo/c')?.released_at).toBeTruthy();
		// ADMITTED-Item requeued (Crash vor Start)
		expect(result.staleAdmitted).toContain(d!.queue_item_id);
		db.close();
	});
});

describe('P4 SLICE F — QUEUE SURVIVES RESTART (echter Server, Datei-DB)', () => {
	let server: http.Server;
	let baseUrl: string;
	let dbFile: string;
	let authHeaders: Record<string, string>;

	beforeAll(async () => {
		process.env.POSITRON_SCHEDULER_DISABLED = 'true';
		process.env.POSITRON_ADMIN_TOKEN = 'test-admin-token-p4f';
		dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'positron-p4f-')), 'crash.db');
		server = createServer({
			repository: { owner: 'test-owner', repo: 'test-repo' },
			dbPath: dbFile,
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
		const addr = server.address() as { port: number };
		baseUrl = `http://127.0.0.1:${addr.port}`;
		authHeaders = {
			'Content-Type': 'application/json',
			Authorization: 'Bearer test-admin-token-p4f',
		};
	});

	afterAll(() => {
		server.close();
		process.env.POSITRON_SCHEDULER_DISABLED = 'true';
		process.env.POSITRON_ADMIN_TOKEN = '';
	});

	it(
		'QUEUE_SURVIVES_RESTART: enqueue → "Crash" → neuer Server → Queue unverändert da; Admission funktioniert',
		{ timeout: 30_000 },
		async () => {
			// Enqueue auf Server 1
			const enq = await fetch(`${baseUrl}/api/scheduler/enqueue`, {
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({
					source_type: 'issue',
					source_ref: 'issue/9401',
					repository_ref: 'test-owner/repo-a',
				}),
			});
			expect(enq.status).toBe(200);
			const item = (await enq.json()) as { item: { queue_item_id: string } };

			// "Crash": Server schließen, DB-Datei bleibt
			server.close();

			// "Restart": neuer Server auf derselben DB-Datei
			process.env.POSITRON_ADMIN_TOKEN = 'test-admin-token-p4f';
			server = createServer({
				repository: { owner: 'test-owner', repo: 'test-repo' },
				dbPath: dbFile,
			});
			await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
			baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

			// QUEUE_SURVIVES_RESTART: das Item ist nach dem Restart noch da (QUEUED)
			const q = (await (await fetch(`${baseUrl}/api/scheduler/queue`)).json()) as {
				queue: Array<{ queue_item_id: string; queue_state: string }>;
			};
			const restored = q.queue.find((x) => x.queue_item_id === item.item.queue_item_id);
			expect(restored).toBeDefined();
			expect(restored?.queue_state).toBe('QUEUED');
		},
	);

	it(
		'RUNNING_RECOVERY_REAL (Produktions-Reihenfolge): gecrashter RUNNING-Run wird beim SERVER-START requeued — nicht nachträglich finalisiert',
		{ timeout: 30_000 },
		async () => {
			// Frische DB-Datei (dieser Test ist unabhängig von den vorherigen)
			const crashDbFile = path.join(path.dirname(dbFile), 'crash-seed.db');
			try {
				fs.rmSync(crashDbFile, { force: true });
			} catch {
				/* neu */
			}
			// DB mit gecrashtem Zustand seeden: RUNNING-Item + Run-Zeile (aktiv)
			// + Attempt mit ABGELAUFENER Lease (Owner ohne Heartbeat)
			const seedDb = new Database(crashDbFile);
			applyMigrations(seedDb);
			applyControlPlaneMigrations(seedDb);
			seedDb
				.prepare(
					"INSERT OR IGNORE INTO repositories (id, owner, name, url, local_path, enabled, created_at) VALUES ('test-owner/repo-crash', 'test-owner', 'repo-crash', '', '', 1, datetime('now'))",
				)
				.run();
			const item = enqueueItem(seedDb, {
				source_type: 'issue',
				source_ref: 'issue/9402',
				repository_ref: 'test-owner/repo-crash',
			});
			const d = admitNext(seedDb, { maxActiveRuns: 4 });
			expect(d?.queue_item_id).toBe(item.queue_item_id);
			const runId = 'run-crashed-9402';
			markRunStarted(seedDb, item.queue_item_id, runId, {});
			seedDb
				.prepare(
					`INSERT INTO runs (id, repo_id, issue_number, branch, phase, status, autonomy_level, attempt, started_at, finished_at)
					 VALUES (?, 'test-owner/repo-crash', 9402, NULL, 'IMPLEMENT', 'active', 2, 0, datetime('now'), NULL)`,
				)
				.run(runId);
			const job = createJob(seedDb, runId, 'build');
			const attempt = createAttempt(seedDb, runId, job.job_id, {
				status: 'pending',
				worker_type: 'opencode',
			});
			claimAttemptWithGeneration(seedDb, attempt.attempt_id, {
				ownerId: `ctl:${runId}:crashed`,
				leaseTtlMs: 30,
			});
			seedDb.close();
			// Lease real ablaufen lassen (kein Heartbeat = Crash)
			await new Promise((r) => setTimeout(r, 60));

			// "Restart": Server-Start führt die Produktions-Recovery aus
			// (recoverSchedulerState VOR recoverStaleLeases — der gecrashte
			// Run hat zu diesem Zeitpunkt noch laufende, aber abgelaufene
			// Attempts → korrekt als tot erkannt → requeued).
			process.env.POSITRON_ADMIN_TOKEN = 'test-admin-token-p4f';
			server.close();
			server = createServer({
				repository: { owner: 'test-owner', repo: 'test-repo' },
				dbPath: crashDbFile,
			});
			await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
			baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

			const q = (await (await fetch(`${baseUrl}/api/scheduler/queue`)).json()) as {
				queue: Array<{ queue_item_id: string; queue_state: string }>;
			};
			const restored = q.queue.find((x) => x.queue_item_id === item.queue_item_id);
			expect(restored).toBeDefined();
			// Der gecrashte RUNNING-Run wurde beim Start requeued
			expect(restored?.queue_state).toBe('QUEUED');

			// Stale-Lease wurde finalisiert (STALE_LEASE) — kein Zombie-Owner
			const checkDb = new Database(crashDbFile);
			const stale = checkDb
				.prepare('SELECT status, failure_class FROM cp_attempts WHERE attempt_id = ?')
				.get(attempt.attempt_id) as { status: string; failure_class: string } | undefined;
			expect(stale?.status).toBe('failed');
			expect(stale?.failure_class).toBe('STALE_LEASE');
			checkDb.close();
			try {
				fs.rmSync(crashDbFile, { force: true });
			} catch {
				/* cleanup */
			}
		},
	);
});
