// Issue #421 (P4) — Scheduler-API Endpunkte (Backend Truth, §58)
//
// Beweist:
// - GET /api/scheduler/queue (Liste + Kapazität, read-only)
// - GET /api/scheduler/active (aktive Runs, read-only)
// - GET /api/scheduler/capacity (globale Kapazität, read-only)
// - POST /api/scheduler/enqueue (write — admin-auth)
// - POST /api/scheduler/tick (deterministische Admission — admin-auth)
// - POST /api/scheduler/items/:id/cancel (cancel — admin-auth)
// - write-Endpunkte verweigern ohne Admin-Token (401)

import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../index.js';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
	process.env.POSITRON_ADMIN_TOKEN = 'test-admin-token-p4';
	server = createServer({
		repository: { owner: 'test-owner', repo: 'test-repo' },
		dbPath: ':memory:',
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
	const addr = server.address() as { port: number };
	baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
	server.close();
	delete process.env.POSITRON_ADMIN_TOKEN;
});

describe('GET /api/scheduler/* (read-only, no auth)', () => {
	it('queue: leere Queue + Kapazität (max_active_runs aus env/default 2)', async () => {
		const res = await fetch(`${baseUrl}/api/scheduler/queue`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			queue: unknown[];
			capacity: { maxActiveRuns: number; activeRuns: number };
		};
		expect(Array.isArray(body.queue)).toBe(true);
		expect(body.capacity.maxActiveRuns).toBeGreaterThan(0);
		expect(body.capacity.activeRuns).toBe(0);
	});

	it('active: leere Liste ohne Auth', async () => {
		const res = await fetch(`${baseUrl}/api/scheduler/active`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { activeRuns: unknown[] };
		expect(Array.isArray(body.activeRuns)).toBe(true);
	});

	it('capacity: liefert aktive/wartende Kennzahlen', async () => {
		const res = await fetch(`${baseUrl}/api/scheduler/capacity`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			maxActiveRuns: number;
			activeRuns: number;
			queueDepth: number;
			waitingDependency: number;
			waitingResource: number;
		};
		expect(typeof body.queueDepth).toBe('number');
		expect(typeof body.waitingDependency).toBe('number');
	});

	it('events: leere Event-Liste ohne Auth', async () => {
		const res = await fetch(`${baseUrl}/api/scheduler/events`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { events: unknown[] };
		expect(Array.isArray(body.events)).toBe(true);
	});
});

describe('POST /api/scheduler/* (write — requireAdmin)', () => {
	it('enqueue verweigert ohne Token (401)', async () => {
		const res = await fetch(`${baseUrl}/api/scheduler/enqueue`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				source_type: 'issue',
				source_ref: 'issue/1',
				repository_ref: 'repo/A',
			}),
		});
		expect(res.status).toBe(401);
	});

	it('enqueue + tick + queue: voller Lifecycle mit Token', async () => {
		const authHeaders = {
			'Content-Type': 'application/json',
			Authorization: 'Bearer test-admin-token-p4',
		};
		// Enqueue
		const enq = await fetch(`${baseUrl}/api/scheduler/enqueue`, {
			method: 'POST',
			headers: authHeaders,
			body: JSON.stringify({
				source_type: 'issue',
				source_ref: 'issue/42',
				repository_ref: 'repo/A',
				priority: 'HIGH',
			}),
		});
		expect(enq.status).toBe(200);
		const enqBody = (await enq.json()) as { item: { queue_item_id: string; queue_state: string } };
		expect(enqBody.item.queue_state).toBe('QUEUED');

		// Queue-Liste enthält das Item
		const queue = (await (await fetch(`${baseUrl}/api/scheduler/queue`)).json()) as {
			queue: Array<{ queue_item_id: string; queue_state: string }>;
		};
		expect(queue.queue.some((q) => q.queue_item_id === enqBody.item.queue_item_id)).toBe(true);

		// Tick admitiert deterministisch (Kapazität frei)
		const tick = await fetch(`${baseUrl}/api/scheduler/tick`, {
			method: 'POST',
			headers: authHeaders,
		});
		expect(tick.status).toBe(200);
		const tickBody = (await tick.json()) as {
			decision: { queue_item_id: string; admitted: boolean };
		};
		expect(tickBody.decision.queue_item_id).toBe(enqBody.item.queue_item_id);
		expect(tickBody.decision.admitted).toBe(true);

		// Cancel
		const cancel = await fetch(
			`${baseUrl}/api/scheduler/items/${enqBody.item.queue_item_id}/cancel`,
			{ method: 'POST', headers: authHeaders },
		);
		expect(cancel.status).toBe(200);
		const cancelBody = (await cancel.json()) as { cancelled: { queue_state: string } };
		expect(['CANCELLED', 'RUNNING']).toContain(cancelBody.cancelled.queue_state);

		// Events persistiert (ADMITTED sichtbar)
		const events = (await (
			await fetch(
				`${baseUrl}/api/scheduler/events?queue_item_id=${enqBody.item.queue_item_id}`,
			)
		).json()) as { events: Array<{ event: string }> };
		expect(events.events.map((e) => e.event)).toContain('ADMITTED');
	});

	it('enqueue mit fehlenden Pflichtfeldern → 400', async () => {
		const res = await fetch(`${baseUrl}/api/scheduler/enqueue`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test-admin-token-p4',
			},
			body: JSON.stringify({ source_type: 'issue' }),
		});
		expect(res.status).toBe(400);
	});
});
