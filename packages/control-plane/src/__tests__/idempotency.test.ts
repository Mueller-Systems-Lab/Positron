// Positron Control Plane — Idempotency Tests
// IDEMPOTENT_DISPATCH: duplicate dispatch → keine doppelte Mutation.
// DUPLICATE_COMPLETION: doppeltes Completion-Event → sicher.

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { IdempotencyRegistry, idempotencyKey } from '../idempotency.js';
import { applyControlPlaneMigrations } from '../schema.js';

let db: Database.Database;
let registry: IdempotencyRegistry;

beforeEach(() => {
	db = new Database(':memory:');
	applyControlPlaneMigrations(db);
	registry = new IdempotencyRegistry(db);
});

describe('IDEMPOTENT_DISPATCH', () => {
	it('first dispatch claims the key, duplicate dispatch does not', () => {
		const key = idempotencyKey('run_1', 'job_1', 'attempt_1');
		expect(registry.claim(key)).toBe(true);
		expect(registry.claim(key)).toBe(false);
		expect(registry.claim(key)).toBe(false);
	});

	it('duplicate dispatch → no duplicate mutation', () => {
		const key = idempotencyKey('run_1', 'job_1', 'attempt_1');
		let mutations = 0;
		const first = registry.runOnce(key, () => {
			mutations++;
			return 'result-1';
		});
		expect(first.duplicate).toBe(false);
		expect(first.result).toBe('result-1');

		const second = registry.runOnce(key, () => {
			mutations++;
			return 'result-2';
		});
		expect(second.duplicate).toBe(true);
		expect(second.result).toBeNull();
		expect(mutations).toBe(1); // Operation lief genau einmal
	});

	it('different attempts have independent keys', () => {
		const k1 = idempotencyKey('run_1', 'job_1', 'attempt_1');
		const k2 = idempotencyKey('run_1', 'job_1', 'attempt_2');
		expect(registry.claim(k1)).toBe(true);
		expect(registry.claim(k2)).toBe(true);
	});
});

describe('DUPLICATE_COMPLETION', () => {
	it('completing twice is safe and idempotent', () => {
		const key = idempotencyKey('run_1', 'job_1', 'attempt_1');
		registry.claim(key);
		registry.complete(key, 'ref-1');
		expect(registry.isCompleted(key)).toBe(true);

		// Doppeltes Completion-Event — kein Fehler, kein State-Drift
		registry.complete(key, 'ref-1');
		expect(registry.get(key)?.state).toBe('completed');
		expect(registry.get(key)?.result_ref).toBe('ref-1');
	});

	it('worker retry after transport failure is controlled', () => {
		const key = idempotencyKey('run_1', 'job_1', 'attempt_1');
		expect(registry.claim(key)).toBe(true);
		// Transport-Fehler → Retry desselben Keys → wird als Duplikat erkannt
		expect(registry.claim(key)).toBe(false);
		expect(registry.isClaimed(key)).toBe(true);
	});
});
