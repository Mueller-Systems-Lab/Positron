// Issue #421 (P1) — Control-Plane API Endpunkte (read-only)
//
// Beweist:
// - GET /api/runs/:id/control-plane exponiert jobs/attempts/decisions/transitions
// - GET /api/kpis liefert deterministische KPIs + Invarianten
// - Beide Endpunkte sind read-only (kein Admin-Token nötig, keine Mutation)

import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../index.js';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
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
});

describe('GET /api/kpis', () => {
	it('returns deterministic KPIs with invariants (read-only, no auth)', async () => {
		const res = await fetch(`${baseUrl}/api/kpis`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			kpis: {
				runs_total: number;
				blind_retry_rate: number;
				duplicate_mutation_rate: number;
				security_block_enforcement_rate: number | null;
			};
			invariants: { violations: string[] };
		};
		expect(typeof body.kpis.runs_total).toBe('number');
		// Leere DB: keine Violation der Kern-Invarianten
		expect(body.kpis.blind_retry_rate).toBe(0);
		expect(body.kpis.duplicate_mutation_rate).toBe(0);
		expect(body.invariants.violations).toEqual([]);
	});
});

describe('GET /api/runs/:id/control-plane', () => {
	it('returns empty control-plane state for unknown runs (read-only, no auth)', async () => {
		const res = await fetch(`${baseUrl}/api/runs/unknown-run-123/control-plane`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			run_id: string;
			jobs: unknown[];
			attempts: unknown[];
			decisions: unknown[];
			transitions: unknown[];
		};
		expect(body.run_id).toBe('unknown-run-123');
		expect(body.jobs).toEqual([]);
		expect(body.attempts).toEqual([]);
		expect(body.decisions).toEqual([]);
		expect(body.transitions).toEqual([]);
	});
});
