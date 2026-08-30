import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
	acquireExternalMutationLock,
	assertExternalMutationWriter,
	getExternalMutationLock,
	openMutationLockDatabase,
	recoverExpiredExternalMutationLocks,
	releaseExternalMutationLock,
	renewExternalMutationLock,
} from '../persistent-mutation-lock.js';

function db(): Database.Database {
	return openMutationLockDatabase(':memory:');
}

describe('persistent external mutation lock', () => {
	it('enforces exclusive fenced ownership and generation', () => {
		const database = db();
		const first = acquireExternalMutationLock(
			database,
			'repo/main',
			'worker-a',
			1000,
			'2026-01-01T00:00:00.000Z',
		)!;
		expect(first.generation).toBe(1);
		expect(
			acquireExternalMutationLock(
				database,
				'repo/main',
				'worker-b',
				1000,
				'2026-01-01T00:00:00.100Z',
			),
		).toBeNull();
		expect(() =>
			assertExternalMutationWriter(
				database,
				{ resource_key: 'repo/main', owner_id: 'worker-a', generation: first.generation },
				'2026-01-01T00:00:00.500Z',
			),
		).not.toThrow();
		database.close();
	});

	it('recovers expired ownership and fences stale writers', () => {
		const database = db();
		const first = acquireExternalMutationLock(
			database,
			'repo/main',
			'worker-a',
			10,
			'2026-01-01T00:00:00.000Z',
		)!;
		expect(recoverExpiredExternalMutationLocks(database, '2026-01-01T00:00:00.011Z')).toBe(1);
		const second = acquireExternalMutationLock(
			database,
			'repo/main',
			'worker-b',
			1000,
			'2026-01-01T00:00:01.000Z',
		)!;
		expect(second.generation).toBe(2);
		expect(() =>
			assertExternalMutationWriter(
				database,
				{ resource_key: 'repo/main', owner_id: first.owner_id, generation: first.generation },
				'2026-01-01T00:00:01.001Z',
			),
		).toThrow(/FENCE_VIOLATION/);
		expect(renewExternalMutationLock(database, first, 1000, '2026-01-01T00:00:01.002Z')).toBe(
			false,
		);
		expect(releaseExternalMutationLock(database, first)).toBe(false);
		expect(releaseExternalMutationLock(database, second)).toBe(true);
		database.close();
	});

	it('persists across independent database connections', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-lock-'));
		const file = path.join(directory, 'control-plane.db');
		const firstDb = openMutationLockDatabase(file);
		const lock = acquireExternalMutationLock(firstDb, 'repo/main', 'worker-a', 1000)!;
		firstDb.close();
		const secondDb = openMutationLockDatabase(file);
		expect(getExternalMutationLock(secondDb, 'repo/main')?.generation).toBe(lock?.generation);
		expect(acquireExternalMutationLock(secondDb, 'repo/main', 'worker-b', 1000)).toBeNull();
		secondDb.close();
		fs.rmSync(directory, { recursive: true, force: true });
	});
});
