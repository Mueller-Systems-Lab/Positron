// P4 — SLICE C CANARY: Real Multi-Issue Concurrency (bounded, produktiver Scheduler)
//
// Beweise über die ECHTE Server-Runtime (Scheduler-Loop + runFullPipeline):
//
//   MULTI_ISSUE_PARALLELISM_REAL  = PASS  (zwei Runs überlappen real: overlap_ms > 0)
//   CAPACITY_1_SERIAL             = PASS  (Kapazität 1 → keine Überlappung)
//   CAPACITY_2_OVERLAP            = PASS
//   NO_OVERSUBSCRIPTION           = PASS  (nie mehr als maxActiveRuns parallel)
//   PRIORITY_PRESERVED / FIFO_PRESERVED (deterministische Admission-Reihenfolge)

import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../index.js';

interface SchedulerEvent {
	queue_item_id: string;
	event: string;
	timestamp: string;
}

async function enqueue(
	baseUrl: string,
	authHeaders: Record<string, string>,
	sourceRef: string,
	repositoryRef: string,
): Promise<string> {
	const enq = await fetch(`${baseUrl}/api/scheduler/enqueue`, {
		method: 'POST',
		headers: authHeaders,
		body: JSON.stringify({
			source_type: 'issue',
			source_ref: sourceRef,
			repository_ref: repositoryRef,
		}),
	});
	expect(enq.status).toBe(200);
	const body = (await enq.json()) as { item: { queue_item_id: string } };
	return body.item.queue_item_id;
}

async function waitTerminal(baseUrl: string, queueItemIds: string[], timeoutMs = 20_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const q = (await (await fetch(`${baseUrl}/api/scheduler/queue`)).json()) as {
			queue: Array<{ queue_item_id: string; queue_state: string }>;
		};
		const all = queueItemIds.every((id) => {
			const item = q.queue.find((x) => x.queue_item_id === id);
			return item && ['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'].includes(item.queue_state);
		});
		if (all) return;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error(`items not terminal: ${queueItemIds.join(',')}`);
}

async function getEvents(baseUrl: string, queueItemId: string): Promise<SchedulerEvent[]> {
	const res = (await (
		await fetch(`${baseUrl}/api/scheduler/events?queue_item_id=${queueItemId}`)
	).json()) as { events: SchedulerEvent[] };
	return res.events;
}

/** Überlappung zweier Runs aus persistierten Scheduler-Events (ms). */
function overlapMs(a: SchedulerEvent[], b: SchedulerEvent[]): number {
	const aStart = a.find((e) => e.event === 'RUN_STARTED')?.timestamp ?? '';
	const aEnd = a.find((e) => e.event === 'RUN_FINISHED')?.timestamp ?? '';
	const bStart = b.find((e) => e.event === 'RUN_STARTED')?.timestamp ?? '';
	const bEnd = b.find((e) => e.event === 'RUN_FINISHED')?.timestamp ?? '';
	if (!aStart || !aEnd || !bStart || !bEnd) return -1;
	// max(0, min(aEnd, bEnd) - max(aStart, bStart))
	const start = Math.max(new Date(aStart).getTime(), new Date(bStart).getTime());
	const end = Math.min(new Date(aEnd).getTime(), new Date(bEnd).getTime());
	return Math.max(0, end - start);
}

/** Maximal beobachtete gleichzeitige RUNNING-Runs aus Events (Sweep). */
function maxConcurrentRuns(allEvents: SchedulerEvent[]): number {
	const deltas: Array<{ t: number; d: number }> = [];
	for (const e of allEvents) {
		if (e.event === 'RUN_STARTED') deltas.push({ t: new Date(e.timestamp).getTime(), d: 1 });
		if (e.event === 'RUN_FINISHED') deltas.push({ t: new Date(e.timestamp).getTime(), d: -1 });
	}
	deltas.sort((x, y) => x.t - y.t);
	let cur = 0;
	let max = 0;
	for (const { d } of deltas) {
		cur += d;
		if (cur > max) max = cur;
	}
	return max;
}

describe('P4 SLICE C — CAPACITY_2_OVERLAP (zwei Runs, isolierte Workspaces)', () => {
	let server: http.Server;
	let baseUrl: string;

	beforeAll(async () => {
		process.env.POSITRON_SCHEDULER_DISABLED = 'false';
		process.env.POSITRON_SCHEDULER_INTERVAL_MS = '100';
		process.env.POSITRON_MAX_ACTIVE_RUNS = '2';
		process.env.POSITRON_ADMIN_TOKEN = 'test-admin-token-p4c';
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
		process.env.POSITRON_SCHEDULER_DISABLED = 'true';
		process.env.POSITRON_ADMIN_TOKEN = '';
	});

	it(
		'MULTI_ISSUE_PARALLELISM_REAL: A.start < B.end UND B.start < A.end → overlap_ms > 0',
		{ timeout: 30_000 },
		async () => {
			const authHeaders = {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test-admin-token-p4c',
			};
			// Zwei unabhängige Runs in isolierten Workspaces (verschiedene Repo-Refs)
			const idA = await enqueue(baseUrl, authHeaders, 'issue/9301', 'test-owner/repo-a');
			const idB = await enqueue(baseUrl, authHeaders, 'issue/9302', 'test-owner/repo-b');

			await waitTerminal(baseUrl, [idA, idB]);

			const eventsA = await getEvents(baseUrl, idA);
			const eventsB = await getEvents(baseUrl, idB);

			// Beide durchliefen den vollen Zyklus
			for (const [name, evts] of [
				['A', eventsA],
				['B', eventsB],
			] as const) {
				const kinds = evts.map((e) => e.event);
				expect(kinds).toContain('ADMITTED');
				expect(kinds).toContain('RUN_STARTED');
				expect(kinds).toContain('RUN_FINISHED');
				void name;
			}

			// FIFO/PRIORITY: gleiche Priorität → A vor B admitiert
			const aAdmitted = eventsA.find((e) => e.event === 'ADMITTED')?.timestamp ?? '';
			const bAdmitted = eventsB.find((e) => e.event === 'ADMITTED')?.timestamp ?? '';
			expect(new Date(aAdmitted).getTime()).toBeLessThanOrEqual(
				new Date(bAdmitted).getTime(),
			);

			// REALER OVERLAP
			const overlap = overlapMs(eventsA, eventsB);
			expect(overlap).toBeGreaterThan(0);
			console.log('[P4-C canary] overlap_ms =', overlap);

			// NO_OVERSUBSCRIPTION: nie mehr als maxActiveRuns (2) parallel
			const all = [...eventsA, ...eventsB];
			expect(maxConcurrentRuns(all)).toBeLessThanOrEqual(2);
			expect(maxConcurrentRuns(all)).toBe(2); // beide liefen WIRKLICH parallel
		},
	);
});

describe('P4 SLICE C — CAPACITY_1_SERIAL', () => {
	let server: http.Server;
	let baseUrl: string;

	beforeAll(async () => {
		process.env.POSITRON_SCHEDULER_DISABLED = 'false';
		process.env.POSITRON_SCHEDULER_INTERVAL_MS = '100';
		process.env.POSITRON_MAX_ACTIVE_RUNS = '1';
		process.env.POSITRON_ADMIN_TOKEN = 'test-admin-token-p4c1';
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
		process.env.POSITRON_SCHEDULER_DISABLED = 'true';
		process.env.POSITRON_ADMIN_TOKEN = '';
	});

	it(
		'CAPACITY_1_SERIAL: zweiter Run wartet, bis der erste terminal ist (overlap_ms = 0)',
		{ timeout: 30_000 },
		async () => {
			const authHeaders = {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test-admin-token-p4c1',
			};
			const idA = await enqueue(baseUrl, authHeaders, 'issue/9311', 'test-owner/repo-a');
			const idB = await enqueue(baseUrl, authHeaders, 'issue/9312', 'test-owner/repo-b');

			await waitTerminal(baseUrl, [idA, idB]);

			const eventsA = await getEvents(baseUrl, idA);
			const eventsB = await getEvents(baseUrl, idB);
			const overlap = overlapMs(eventsA, eventsB);
			if (overlap !== 0) {
				console.log('[P4-C serial dbg] A:', JSON.stringify(eventsA.map((e) => `${e.event}@${e.timestamp}`)));
				console.log('[P4-C serial dbg] B:', JSON.stringify(eventsB.map((e) => `${e.event}@${e.timestamp}`)));
			}
			expect(overlap).toBe(0);

			// B wurde erst nach A's Abschluss gestartet (kein Overlap, seriell)
			const aEnd = eventsA.find((e) => e.event === 'RUN_FINISHED')?.timestamp ?? '';
			const bStart = eventsB.find((e) => e.event === 'RUN_STARTED')?.timestamp ?? '';
			expect(new Date(bStart).getTime()).toBeGreaterThanOrEqual(new Date(aEnd).getTime());

			const all = [...eventsA, ...eventsB];
			expect(maxConcurrentRuns(all)).toBeLessThanOrEqual(1);
		},
	);
});
