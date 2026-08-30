import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export const EXTERNAL_MUTATION_LOCK_SCHEMA = `
CREATE TABLE IF NOT EXISTS cp_external_mutation_locks (
  resource_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  renewed_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED'))
);
CREATE INDEX IF NOT EXISTS idx_cp_external_mutation_locks_owner
  ON cp_external_mutation_locks(owner_id);
`;

export interface ExternalMutationLock {
	resource_key: string;
	owner_id: string;
	generation: number;
	acquired_at: string;
	expires_at: string;
	renewed_at: string;
	status: 'ACTIVE' | 'RELEASED';
}

export function openMutationLockDatabase(dbPath: string): Database.Database {
	const directory = path.dirname(dbPath);
	fs.mkdirSync(directory, { recursive: true });
	const db = new Database(dbPath);
	db.pragma('journal_mode = WAL');
	db.pragma('busy_timeout = 5000');
	db.exec(EXTERNAL_MUTATION_LOCK_SCHEMA);
	return db;
}

function row(db: Database.Database, resourceKey: string): ExternalMutationLock | null {
	const value = db
		.prepare('SELECT * FROM cp_external_mutation_locks WHERE resource_key = ?')
		.get(resourceKey) as ExternalMutationLock | undefined;
	return value ?? null;
}

export function acquireExternalMutationLock(
	db: Database.Database,
	resourceKey: string,
	ownerId: string,
	ttlMs: number,
	now = new Date().toISOString(),
): ExternalMutationLock | null {
	if (!resourceKey || !ownerId || !Number.isFinite(ttlMs) || ttlMs <= 0) return null;
	return db.transaction(() => {
		const current = row(db, resourceKey);
		const currentExpiry = current ? new Date(current.expires_at).getTime() : 0;
		if (
			current?.status === 'ACTIVE' &&
			currentExpiry > new Date(now).getTime() &&
			current.owner_id !== ownerId
		) {
			return null;
		}
		const generation = (current?.generation ?? 0) + 1;
		const expiresAt = new Date(new Date(now).getTime() + Math.floor(ttlMs)).toISOString();
		db.prepare(
			`INSERT INTO cp_external_mutation_locks
			 (resource_key, owner_id, generation, acquired_at, expires_at, renewed_at, status)
			 VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
			 ON CONFLICT(resource_key) DO UPDATE SET owner_id=excluded.owner_id,
			 generation=excluded.generation, acquired_at=excluded.acquired_at,
			 expires_at=excluded.expires_at, renewed_at=excluded.renewed_at, status='ACTIVE'`,
		).run(resourceKey, ownerId, generation, now, expiresAt, now);
		return row(db, resourceKey);
	})();
}

export function renewExternalMutationLock(
	db: Database.Database,
	lock: Pick<ExternalMutationLock, 'resource_key' | 'owner_id' | 'generation'>,
	ttlMs: number,
	now = new Date().toISOString(),
): boolean {
	const expiresAt = new Date(new Date(now).getTime() + Math.floor(ttlMs)).toISOString();
	const result = db
		.prepare(
			`UPDATE cp_external_mutation_locks SET expires_at = ?, renewed_at = ?
		 WHERE resource_key = ? AND owner_id = ? AND generation = ? AND status = 'ACTIVE'`,
		)
		.run(expiresAt, now, lock.resource_key, lock.owner_id, lock.generation);
	return result.changes === 1;
}

export function releaseExternalMutationLock(
	db: Database.Database,
	lock: Pick<ExternalMutationLock, 'resource_key' | 'owner_id' | 'generation'>,
): boolean {
	const result = db
		.prepare(
			`UPDATE cp_external_mutation_locks SET status = 'RELEASED', renewed_at = ?
		 WHERE resource_key = ? AND owner_id = ? AND generation = ? AND status = 'ACTIVE'`,
		)
		.run(new Date().toISOString(), lock.resource_key, lock.owner_id, lock.generation);
	return result.changes === 1;
}

export function recoverExpiredExternalMutationLocks(
	db: Database.Database,
	now = new Date().toISOString(),
): number {
	return db
		.prepare(
			`UPDATE cp_external_mutation_locks SET status = 'RELEASED', renewed_at = ?
		 WHERE status = 'ACTIVE' AND expires_at <= ?`,
		)
		.run(now, now).changes;
}

export function assertExternalMutationWriter(
	db: Database.Database,
	lock: Pick<ExternalMutationLock, 'resource_key' | 'owner_id' | 'generation'>,
	now = new Date().toISOString(),
): void {
	const current = row(db, lock.resource_key);
	if (
		!current ||
		current.status !== 'ACTIVE' ||
		current.owner_id !== lock.owner_id ||
		current.generation !== lock.generation ||
		new Date(current.expires_at).getTime() <= new Date(now).getTime()
	) {
		throw new Error(`EXTERNAL_MUTATION_FENCE_VIOLATION: ${lock.resource_key}`);
	}
}

export function getExternalMutationLock(
	db: Database.Database,
	resourceKey: string,
): ExternalMutationLock | null {
	return row(db, resourceKey);
}
