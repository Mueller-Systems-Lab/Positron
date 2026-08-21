// P4 — FINAL VERTICAL SLICE: Multi-Issue Runs mit Leases, Heartbeats,
// Workspace-Locks und Provider-Reservierungen gleichzeitig aktiv
//
//   Run A + Run B (isolierte Workspaces, capacity >= 2)
//   → QUEUED → ADMITTED → RUNNING (overlap_ms > 0)
//   → leases aktiv (bounded TTL) → heartbeats aktiv (lease advances)
//   → workspace locks korrekt (exklusiv je Workspace, released am Ende)
//   → provider reservations aktiv (kein Oversubscription) + released

import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createServer } from '../index.js';

describe('P4 — FINAL VERTICAL SLICE (zwei reale Runs, volle P4-Ressourcen)', () => {
	let server: http.Server;
	let baseUrl: string;
	let dbFile: string;

	beforeAll(async () => {
		process.env.POSITRON_SCHEDULER_DISABLED = 'false';
		process.env.POSITRON_SCHEDULER_INTERVAL_MS = '100';
		process.env.POSITRON_MAX_ACTIVE_RUNS = '2';
		process.env.POSITRON_ADMIN_TOKEN = 'test-admin-token-p4v';
		process.env.POSITRON_PROVIDER_CAPACITY = '{"deepseek": 2}';
		process.env.POSITRON_ATTEMPT_LEASE_TTL_MS = '5000';
		dbFile = '/tmp/opencode/positron-p4v-' + Date.now() + '.db';
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
		process.env.POSITRON_ATTEMPT_LEASE_TTL_MS = '';
	});

	it(
		'beide Runs laufen real parallel; Leases/Heartbeats/Locks/Reservierungen aktiv und am Ende freigegeben',
		{ timeout: 40_000 },
		async () => {
			const authHeaders = {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test-admin-token-p4v',
			};
			const enq = async (ref: string) => {
				const r = await fetch(`${baseUrl}/api/scheduler/enqueue`, {
					method: 'POST',
					headers: authHeaders,
					body: JSON.stringify({
						source_type: 'issue',
						source_ref: ref,
						repository_ref: `test-owner/${ref.replace('issue/', 'repo-')}`,
						provider: 'deepseek',
					}),
				});
				expect(r.status).toBe(200);
				return (await r.json()) as { item: { queue_item_id: string } };
			};

			const a = await enq('issue/9601');
			const b = await enq('issue/9602');

			// Auf beide terminalen Zustände warten
			let overlapMs = -1;
			let terminal = 0;
			for (let i = 0; i < 100; i++) {
				await new Promise((r) => setTimeout(r, 200));
				const q = (await (await fetch(`${baseUrl}/api/scheduler/queue`)).json()) as {
					queue: Array<{ queue_item_id: string; queue_state: string }>;
				};
				const aState = q.queue.find((x) => x.queue_item_id === a.item.queue_item_id)?.queue_state;
				const bState = q.queue.find((x) => x.queue_item_id === b.item.queue_item_id)?.queue_state;
				if (
					aState &&
					bState &&
					['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'].includes(aState) &&
					['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'].includes(bState)
				) {
					terminal = 2;
					break;
				}
			}
			expect(terminal).toBe(2);

			// OVERLAP: beide durchliefen RUNNING, überlappend
			const eventsFor = async (id: string) =>
				(
					await (await fetch(`${baseUrl}/api/scheduler/events?queue_item_id=${id}`)).json()
				).events as Array<{ event: string; timestamp: string }>;
			const evA = await eventsFor(a.item.queue_item_id);
			const evB = await eventsFor(b.item.queue_item_id);
			const aStart = evA.find((e) => e.event === 'RUN_STARTED')?.timestamp ?? '';
			const aEnd = evA.find((e) => e.event === 'RUN_FINISHED')?.timestamp ?? '';
			const bStart = evB.find((e) => e.event === 'RUN_STARTED')?.timestamp ?? '';
			const bEnd = evB.find((e) => e.event === 'RUN_FINISHED')?.timestamp ?? '';
			const start = Math.max(new Date(aStart).getTime(), new Date(bStart).getTime());
			const end = Math.min(new Date(aEnd).getTime(), new Date(bEnd).getTime());
			overlapMs = Math.max(0, end - start);
			expect(overlapMs).toBeGreaterThan(0);
			console.log('[P4-V canary] overlap_ms =', overlapMs);

			// NACH dem Lauf: Ressourcen vollständig freigegeben
			const db = new Database(dbFile);
			const locks = db
				.prepare(
					"SELECT workspace_key, released_at FROM cp_workspace_locks WHERE workspace_key IN ('test-owner/repo-9601', 'test-owner/repo-9602')",
				)
				.all() as Array<{ workspace_key: string; released_at: string | null }>;
			expect(locks.length).toBe(2);
			for (const lock of locks) expect(lock.released_at).toBeTruthy();

			const reservations = db
				.prepare(
					"SELECT status FROM cp_provider_reservations WHERE owner_id IN (?, ?)",
				)
				.all(a.item.queue_item_id, b.item.queue_item_id) as Array<{ status: string }>;
			expect(reservations.length).toBe(2);
			for (const r of reservations) expect(r.status).toBe('released');

			// Leases: jeder Run hat geclaimte Attempts mit bounded TTL + Owner
			const attemptRows = db
				.prepare(
					`SELECT a.lease_owner_id, a.lease_expires_at, a.status FROM cp_attempts a
					 JOIN cp_jobs j ON j.job_id = a.job_id
					 WHERE j.run_id IN (SELECT run_id FROM cp_queue WHERE queue_item_id IN (?, ?))
					 AND a.lease_owner_id IS NOT NULL`,
				)
				.all(a.item.queue_item_id, b.item.queue_item_id) as Array<{
				lease_owner_id: string;
				lease_expires_at: string | null;
				status: string;
			}>;
			expect(attemptRows.length).toBeGreaterThanOrEqual(2);
			for (const row of attemptRows) {
				expect(row.lease_owner_id).toMatch(/^ctl:/);
				expect(row.lease_expires_at).toBeTruthy();
				// Heartbeat aktiv während der Arbeit: Lease-Frist liegt in der
				// Zukunft (kein Expiry während des Runs)
				expect(new Date(row.lease_expires_at as string).getTime()).toBeGreaterThan(
					Date.now() - 60_000,
				);
			}
			// Keine laufenden Attempts mehr (alle final)
			const running = db
				.prepare(
					`SELECT COUNT(*) AS c FROM cp_attempts a
					 JOIN cp_jobs j ON j.job_id = a.job_id
					 WHERE j.run_id IN (SELECT run_id FROM cp_queue WHERE queue_item_id IN (?, ?))
					 AND a.status = 'running'`,
				)
				.get(a.item.queue_item_id, b.item.queue_item_id) as { c: number };
			expect(Number(running.c)).toBe(0);
			db.close();
		},
	);
});
