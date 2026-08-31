import type Database from 'better-sqlite3';

export interface ReadinessResult {
	ready: boolean;
	reason?: string;
	checks: { database: boolean; schema: boolean; integrity: boolean };
}

/** Readiness is deliberately stricter than /api/health (which means alive). */
export function checkReadiness(db: Database.Database): ReadinessResult {
	try {
		const integrity = db.pragma('integrity_check', { simple: true }) === 'ok';
		const hasRuns =
			db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get() !==
			undefined;
		const migration = db.prepare("SELECT value FROM cp_kv WHERE key = 'migration_version'").get() as
			| { value?: string }
			| undefined;
		const schema = hasRuns && migration?.value === '11';
		const ready = integrity && schema;
		return {
			ready,
			reason: ready ? undefined : 'persistent control-plane state is not ready',
			checks: { database: true, schema, integrity },
		};
	} catch {
		return {
			ready: false,
			reason: 'persistent control-plane state is unavailable',
			checks: { database: false, schema: false, integrity: false },
		};
	}
}
