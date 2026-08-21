// P4 — SLICE G CANARY: Security Hard Block durch den produktiven Scheduler-Pfad
//
// Pfad: scheduler → admission (Workspace-Lock + Provider-Reservierung)
//       → runPipeline → verify → review-Findings → buildDecision → SECURITY_BLOCK
//
// Erwartung: BLOCKED / SECURITY_BLOCK (NIE DONE) + ALLE Ressourcen freigegeben:
//   lease (Attempt final), workspace lock (released), provider reservation
//   (released).

import type http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createServer } from '../index.js';

const BLOCKING_FINDINGS = JSON.stringify([
	{
		contract: 'positron.finding.v1',
		category: 'security',
		severity: 'CRITICAL',
		confidence: 'high',
		blocking: true,
		rule: 'secrets-in-repo',
		evidence: { file: 'src/secret.ts', symbol: 'apiKey' },
	},
]);

describe('P4 SLICE G — SECURITY_HARD_BLOCK_PRODUCTIVE_PATH', () => {
	let server: http.Server;
	let baseUrl: string;
	let dbFile: string;

	beforeAll(async () => {
		process.env.POSITRON_SCHEDULER_DISABLED = 'false';
		process.env.POSITRON_SCHEDULER_INTERVAL_MS = '100';
		process.env.POSITRON_MAX_ACTIVE_RUNS = '2';
		process.env.POSITRON_ADMIN_TOKEN = 'test-admin-token-p4g';
		process.env.POSITRON_PROVIDER_CAPACITY = '{"deepseek": 1}';
		process.env.POSITRON_REVIEW_FINDINGS = BLOCKING_FINDINGS;
		dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'positron-p4g-')), 'g.db');
		server = createServer({
			repository: { owner: 'test-owner', repo: 'test-repo' },
			dbPath: dbFile,
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
		const addr = server.address() as { port: number };
		baseUrl = `http://127.0.0.1:${addr.port}`;
	});

	afterAll(() => {
		server.close();
		process.env.POSITRON_SCHEDULER_DISABLED = 'true';
		process.env.POSITRON_ADMIN_TOKEN = '';
		process.env.POSITRON_PROVIDER_CAPACITY = '';
		process.env.POSITRON_REVIEW_FINDINGS = '';
	});

	it(
		'SECURITY_BLOCK: blockierendes CRITICAL-Finding → BLOCKED, Ressourcen freigegeben, kein DONE',
		{ timeout: 40_000 },
		async () => {
			const authHeaders = {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test-admin-token-p4g',
			};
			const enq = await fetch(`${baseUrl}/api/scheduler/enqueue`, {
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({
					source_type: 'issue',
					source_ref: 'issue/9500',
					repository_ref: 'test-owner/repo-sec',
					provider: 'deepseek',
				}),
			});
			expect(enq.status).toBe(200);
			const item = (await enq.json()) as { item: { queue_item_id: string } };

			// Auf terminalen Zustand warten
			let terminal = '';
			for (let i = 0; i < 100; i++) {
				await new Promise((r) => setTimeout(r, 200));
				const q = (await (await fetch(`${baseUrl}/api/scheduler/queue`)).json()) as {
					queue: Array<{ queue_item_id: string; queue_state: string }>;
				};
				const cur = q.queue.find((x) => x.queue_item_id === item.item.queue_item_id);
				if (cur && ['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'].includes(cur.queue_state)) {
					terminal = cur.queue_state;
					break;
				}
			}
			expect(terminal).not.toBe('COMPLETED'); // NIE DONE bei SECURITY_BLOCK
			expect(['FAILED', 'BLOCKED']).toContain(terminal);

			// cp_decisions: SECURITY_BLOCK (produktiver Pfad, persistiert)
			const db = new Database(dbFile);
			const decision = db
				.prepare(
					"SELECT decision, reason_code FROM cp_decisions WHERE run_id IN (SELECT run_id FROM cp_queue WHERE queue_item_id = ?)",
				)
				.get(item.item.queue_item_id) as { decision: string; reason_code: string } | undefined;
			expect(decision).toBeDefined();
			expect(decision?.decision).toBe('BLOCKED');
			expect(decision?.reason_code).toBe('SECURITY_BLOCK');

			// Ressourcen freigegeben:
			//   - Workspace Lock released
			const lock = db
				.prepare('SELECT released_at FROM cp_workspace_locks WHERE workspace_key = ?')
				.get('test-owner/repo-sec') as { released_at: string | null } | undefined;
			expect(lock?.released_at).toBeTruthy();
			//   - Provider-Reservierung released
			const reservation = db
				.prepare(
					"SELECT status FROM cp_provider_reservations WHERE owner_id = ?",
				)
				.get(item.item.queue_item_id) as { status: string } | undefined;
			expect(reservation?.status).toBe('released');
			//   - Attempts final (keine running Attempts mehr)
			const runningAttempts = db
				.prepare(
					`SELECT COUNT(*) AS c FROM cp_attempts a
					 JOIN cp_jobs j ON j.job_id = a.job_id
					 WHERE j.run_id IN (SELECT run_id FROM cp_queue WHERE queue_item_id = ?)
					 AND a.status = 'running'`,
				)
				.get(item.item.queue_item_id) as { c: number };
			expect(Number(runningAttempts.c)).toBe(0);
			db.close();
		},
	);
});
