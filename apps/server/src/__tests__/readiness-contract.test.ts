import { applyControlPlaneMigrations } from '@positron/control-plane';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { checkReadiness } from '../readiness.js';

describe('Issue #465 health/readiness contract', () => {
	it('reports ready only when durable schema and integrity are available', () => {
		const db = new Database(':memory:');
		db.exec('CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT NOT NULL)');
		expect(checkReadiness(db).ready).toBe(false);
		applyControlPlaneMigrations(db);
		expect(checkReadiness(db)).toMatchObject({
			ready: true,
			checks: { database: true, schema: true, integrity: true },
		});
		db.close();
	});
});
