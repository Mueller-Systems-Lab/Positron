// Positron P5.4 — Evolution API (backend truth, no raw prompts/secrets)
import type { IncomingMessage, ServerResponse } from 'node:http';
import type Database from 'better-sqlite3';
import { computeEvolutionKpis } from '@positron/control-plane';

export function handleEvolutionRoutes(
	req: IncomingMessage,
	res: ServerResponse,
	db: Database.Database,
	url: URL,
): boolean {
	const pathname = url.pathname;

	// GET /api/evolution/current — current production pointer
	if (pathname === '/api/evolution/current' && req.method === 'GET') {
		try {
			const pointer = db.prepare('SELECT * FROM cp_production_profile_pointer LIMIT 1').get() as Record<string, unknown> | undefined;
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ pointer: pointer ?? null }));
			return true;
		} catch (e) {
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: String(e) }));
			return true;
		}
	}

	// GET /api/evolution/candidates — list candidates
	if (pathname === '/api/evolution/candidates' && req.method === 'GET') {
		try {
			const candidates = db.prepare('SELECT candidate_id, parent_profile_id, candidate_version, candidate_fingerprint, status, created_at FROM cp_harness_candidates ORDER BY created_at DESC').all();
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ candidates }));
			return true;
		} catch (e) {
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: String(e) }));
			return true;
		}
	}

	// GET /api/evolution/evaluations — list evaluations
	if (pathname === '/api/evolution/evaluations' && req.method === 'GET') {
		try {
			const evaluations = db.prepare('SELECT evaluation_id, candidate_id, sample_size, verified_success, reason_code, created_at FROM cp_harness_evaluations ORDER BY created_at DESC').all();
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ evaluations }));
			return true;
		} catch (e) {
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: String(e) }));
			return true;
		}
	}

	// GET /api/evolution/kpis — evolution KPIs
	if (pathname === '/api/evolution/kpis' && req.method === 'GET') {
		try {
			const kpis = computeEvolutionKpis(db);
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(kpis));
			return true;
		} catch (e) {
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: String(e) }));
			return true;
		}
	}

	// GET /api/evolution/transitions — profile transitions
	if (pathname === '/api/evolution/transitions' && req.method === 'GET') {
		try {
			const transitions = db.prepare('SELECT * FROM cp_profile_transitions ORDER BY created_at ASC').all();
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ transitions }));
			return true;
		} catch (e) {
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: String(e) }));
			return true;
		}
	}

	return false;
}
