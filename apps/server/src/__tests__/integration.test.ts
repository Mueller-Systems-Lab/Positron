import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createServer } from '../index.js';

let server: http.Server;
let baseUrl: string;
const repository = { owner: 'test-owner', repo: 'test-repo' };
// Dev default token, same as in index.ts
const DEV_ADMIN_TOKEN = 'positron-admin-dev';

beforeAll(async () => {
	// Set the admin token via env so SecretManager picks it up (env provider first)
	process.env['POSITRON_ADMIN_TOKEN'] = DEV_ADMIN_TOKEN;
	server = createServer({ repository, dbPath: ':memory:' });
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
	const addr = server.address() as { port: number };
	baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
	Reflect.deleteProperty(process.env, 'POSITRON_ADMIN_TOKEN');
	server.close();
});

async function post(path: string, body: unknown) {
	return fetch(`${baseUrl}${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${DEV_ADMIN_TOKEN}`,
		},
		body: JSON.stringify(body),
	});
}

async function postUnauth(path: string, body: unknown) {
	return fetch(`${baseUrl}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

async function postWrongToken(path: string, body: unknown) {
	return fetch(`${baseUrl}${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: 'Bearer wrong-token-123',
		},
		body: JSON.stringify(body),
	});
}

async function get(path: string) {
	return fetch(`${baseUrl}${path}`);
}

async function getWithToken(path: string, token: string) {
	return fetch(`${baseUrl}${path}`, {
		headers: { 'X-Admin-Token': token },
	});
}

describe('POST /api/repos/:repoId/runs', () => {
	// QA-027: Reactivated — the POST /api/repos/:repoId/runs route has an
	// inline fallback (runFullPipeline) that runs synchronously when
	// BullMQ/Redis is unavailable. Tests go through this fallback path
	// and complete in-process. ~500ms BullMQ connection timeout per test.
	test('vollständiger Run durchläuft alle Phasen — erreicht DONE', async () => {
		// Fake-Adapter simuliert jetzt Änderungen nach prepareWorkspace
		// → Run erreicht COMMIT → PR_CREATE → MERGE (dry-run) → DONE
		const res = await post('/api/repos/repo-1/runs', {
			issueNumber: 42,
			autonomyLevel: 2,
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			run: {
				phase: string;
				status: string;
				attempt: number;
				repoId: string;
				lastError: string | null;
			};
			events: Array<{ phase: string }>;
			eventCount: number;
		};
		expect(body.run.phase).toBe('DONE');
		expect(body.run.status).toBe('done');
		expect(body.run.repoId).toBe('test-repo');
		// Sollte deutlich mehr Events haben als vorher (da der Run komplett durchläuft)
		expect(body.eventCount).toBeGreaterThanOrEqual(15);
	});

	test('zwei aufeinanderfolgende Runs — beide erreichen DONE', async () => {
		const r1 = await post('/api/repos/repo-1/runs', { issueNumber: 1 });
		const b1 = (await r1.json()) as {
			run: { id: string; phase: string; lastError: string | null };
		};
		expect(b1.run.phase).toBe('DONE');

		const r2 = await post('/api/repos/repo-2/runs', { issueNumber: 2 });
		const b2 = (await r2.json()) as { run: { id: string; phase: string } };
		expect(b2.run.phase).toBe('DONE');
		expect(b2.run.id).not.toBe(b1.run.id);
	});
});

describe('GET /api/runs', () => {
	test('listet alle Runs', async () => {
		const createRes = await post('/api/repos/repo-a/runs', { issueNumber: 1 });
		expect(createRes.status).toBe(200);
		const res = await get('/api/runs');
		const body = (await res.json()) as {
			runs: Array<unknown>;
			total?: number;
			pagination?: { total: number };
		};
		// Support both new paginated format and old format
		const runList = body.runs ?? [];
		const total = body.pagination?.total ?? body.total ?? runList.length;
		expect(total).toBeGreaterThanOrEqual(1);
	});
});

describe('GET /api/health', () => {
	test('Health-Endpunkt antwortet', async () => {
		const res = await get('/api/health');
		const body = (await res.json()) as { status: string };
		expect(body.status).toBe('ok');
	});
});

describe('Run Resume', () => {
	// QA-027: Reactivated — same inline fallback as above.
	test('Run-Details via GET /api/runs/:id', async () => {
		const create = await post('/api/repos/repo/runs', { issueNumber: 99 });
		const createBody = (await create.json()) as { run: { id: string } };
		const res = await get(`/api/runs/${createBody.run.id}`);
		const body = (await res.json()) as {
			run: { phase: string };
			events: Array<unknown>;
		};
		// Run sollte DONE sein, nicht FAILED_BLOCKED
		expect(body.run.phase).toBe('DONE');
		expect(body.events.length).toBeGreaterThan(0);
	});
});

describe('Admin Auth Middleware', () => {
	test('GET /api/admin/stats ohne Token → 401', async () => {
		const res = await get('/api/admin/stats');
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain('admin token');
	});

	test('GET /api/admin/stats mit falschem Token → 401', async () => {
		const res = await getWithToken('/api/admin/stats', 'wrong-token');
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain('admin token');
	});

	test('GET /api/admin/stats mit gültigem Token → 200', async () => {
		const res = await getWithToken('/api/admin/stats', DEV_ADMIN_TOKEN);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			runs: { total: number };
			repositories: number;
		};
		expect(body).toHaveProperty('runs');
		expect(body.runs).toHaveProperty('total');
		expect(body).toHaveProperty('repositories');
		expect(body).toHaveProperty('events');
		expect(body).toHaveProperty('artifacts');
	});
});

// --- RED_HOLD remediation: Write-endpoint auth tests ---
describe('Write Endpoint Auth (RED_HOLD remediation)', () => {
	test('POST /api/repos/:repoId/runs ohne Token → 401', async () => {
		const res = await postUnauth('/api/repos/repo-1/runs', { issueNumber: 1 });
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain('admin token');
	});

	test('POST /api/repos/:repoId/runs mit falschem Token → 401', async () => {
		const res = await postWrongToken('/api/repos/repo-1/runs', { issueNumber: 1 });
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain('admin token');
	});

	test('POST /api/repos/:repoId/runs mit gültigem Token → 200', async () => {
		const res = await post('/api/repos/repo-1/runs', { issueNumber: 1 });
		expect(res.status).toBe(200);
	});

	test('POST /api/evidence ohne Token → 401', async () => {
		const res = await postUnauth('/api/evidence', { runId: 'test', kind: 'log', content: 'test' });
		expect(res.status).toBe(401);
	});

	test('POST /api/runs/:id/control ohne Token → 401', async () => {
		const res = await postUnauth('/api/runs/test-id/control', { action: 'pause' });
		expect(res.status).toBe(401);
	});

	test('POST /api/webhook/test ohne Token → 401', async () => {
		const res = await postUnauth('/api/webhook/test', { message: 'test' });
		expect(res.status).toBe(401);
	});

	test('POST /api/demo/blueprint ohne Token → 401', async () => {
		const res = await postUnauth('/api/demo/blueprint', { blueprint: '# Test' });
		expect(res.status).toBe(401);
	});

	test('POST /api/demo-runs ohne Token → 401', async () => {
		const res = await postUnauth('/api/demo-runs', { issueNumber: 99 });
		expect(res.status).toBe(401);
	});

	test('POST /api/runs/:id/gate ohne Token → 401', async () => {
		const res = await postUnauth('/api/runs/test-id/gate', { decision: 'approve' });
		expect(res.status).toBe(401);
	});

	test('POST /api/runs/:id/cancel ohne Token → 401', async () => {
		const res = await postUnauth('/api/runs/test-id/cancel', {});
		expect(res.status).toBe(401);
	});

	test('GET read-only endpoints bleiben ohne Token erreichbar', async () => {
		const healthRes = await get('/api/health');
		expect(healthRes.status).toBe(200);

		const runsRes = await get('/api/runs');
		expect(runsRes.status).toBe(200);

		const safetyRes = await get('/api/safety');
		expect(safetyRes.status).toBe(200);
	});

	test('Authorization: Bearer header wird ebenfalls akzeptiert', async () => {
		const res = await post('/api/repos/repo-1/runs', { issueNumber: 42 });
		expect(res.status).toBe(200);
	});
});
