// Positron Control Plane — Persistenter Workspace Lock (P4, Slice D)
//
// Mutation-Exklusivität auf Workspace-Ebene:
//
//   same mutable workspace            → genau EIN mutierender Owner
//   verschiedene isolierte Workspaces → parallel erlaubt
//
// Lock-Identity: die Workspace-Identity wird aus der tatsächlichen
// Workspace-Zuordnung abgeleitet (`repository_ref` im Scheduler — isolierte
// disposable Workspaces sind 1:1 an einen repository_ref gebunden). Es wird
// NICHT pauschal nur owner/name gelockt, wenn isolierte Workspaces parallel
// zulässig sind.
//
// Lease-/Fence-Semantik (konsistent zu Attempt-Leases):
//   - `lease_owner_id`   — Queue-Item/Run, der den Workspace hält
//   - `lease_generation` — Fencing-Token; Reclaim (stale) erzeugt eine neue
//                          Generation, der alte Owner verliert Autorität
//   - `lease_expires_at` — Heartbeat-Deadline; abgelaufen → stale → Reclaim
//
// Kein in-place "Wiederbeleben" des alten Owners: Reclaim schreibt den neuen
// Owner + frische Generation; der alte Owner kann weder erneuern noch
// freigeben (Owner-/Generations-Check im UPDATE-WHERE).

import type Database from 'better-sqlite3';

export const WORKSPACE_LOCK_SCHEMA_V5 = `
CREATE TABLE IF NOT EXISTS cp_workspace_locks (
  workspace_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  lease_generation INTEGER NOT NULL DEFAULT 0,
  lease_expires_at TEXT,
  acquired_at TEXT NOT NULL,
  released_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cp_workspace_locks_owner ON cp_workspace_locks(owner_id);
`;

/** Default-TTL des Workspace-Locks (10 Minuten; Heartbeat hält am Leben). */
export const DEFAULT_WORKSPACE_LOCK_TTL_MS = 600_000;

export interface WorkspaceLock {
	workspace_key: string;
	owner_id: string;
	lease_generation: number;
	lease_expires_at: string | null;
	acquired_at: string;
	released_at: string | null;
}

/**
 * Zentrale, validierte Workspace-Lock-TTL.
 * `POSITRON_WORKSPACE_LOCK_TTL_MS` (ms) überschreibt den Default;
 * ungültige Werte werfen (Fail-Closed — nie eine unbegrenzte Lock-Dauer).
 */
export function resolveWorkspaceLockTtlMs(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env.POSITRON_WORKSPACE_LOCK_TTL_MS;
	if (raw === undefined || raw.trim() === '') {
		return DEFAULT_WORKSPACE_LOCK_TTL_MS;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(
			`POSITRON_WORKSPACE_LOCK_TTL_MS invalid: '${raw}' — must be a positive finite number of milliseconds`,
		);
	}
	return Math.floor(parsed);
}

function mapLockRow(row: Record<string, unknown>): WorkspaceLock {
	return {
		workspace_key: String(row.workspace_key),
		owner_id: String(row.owner_id),
		lease_generation: Number(row.lease_generation ?? 0),
		lease_expires_at: row.lease_expires_at ? String(row.lease_expires_at) : null,
		acquired_at: String(row.acquired_at),
		released_at: row.released_at ? String(row.released_at) : null,
	};
}

export function getWorkspaceLock(
	db: Database.Database,
	workspaceKey: string,
): WorkspaceLock | null {
	const row = db
		.prepare('SELECT * FROM cp_workspace_locks WHERE workspace_key = ?')
		.get(workspaceKey) as Record<string, unknown> | undefined;
	return row ? mapLockRow(row) : null;
}

/**
 * Atomarer Lock-Acquire (Claim): der Workspace gehört dem ersten Claimer.
 * Ein fremder gültiger Lock (nicht abgelaufen, anderer Owner) → false.
 * Ein STALE Lock (abgelaufen) wird deterministisch übernommen (Reclaim):
 * neuer Owner + frische Generation (FENCE_ADVANCED) — der alte Owner ist
 * danach gefenced (kann weder erneuern noch freigeben).
 */
export function acquireWorkspaceLock(
	db: Database.Database,
	workspaceKey: string,
	ownerId: string,
	ttlMs: number,
	now = new Date().toISOString(),
): { acquired: boolean; generation: number; reclaimed: boolean } {
	return db.transaction((): { acquired: boolean; generation: number; reclaimed: boolean } => {
		const existing = getWorkspaceLock(db, workspaceKey);
		if (existing && existing.released_at === null && existing.lease_expires_at !== null) {
			if (new Date(existing.lease_expires_at).getTime() > new Date(now).getTime()) {
				// Gültiger fremder Lock → exklusiv, kein paralleler mutierender Owner
				if (existing.owner_id !== ownerId) {
					return { acquired: false, generation: existing.lease_generation, reclaimed: false };
				}
				// Identischer Owner (Re-Entry): Lock erneuern
				const expiresAt = new Date(new Date(now).getTime() + ttlMs).toISOString();
				db.prepare(
					`UPDATE cp_workspace_locks SET lease_expires_at = ?, lease_generation = lease_generation + 1
					 WHERE workspace_key = ? AND owner_id = ?`,
				).run(expiresAt, workspaceKey, ownerId);
				const updated = getWorkspaceLock(db, workspaceKey);
				return {
					acquired: true,
					generation: updated?.lease_generation ?? 0,
					reclaimed: false,
				};
			}
		}
		// Frei oder stale → Claim/Reclaim mit frischer Generation
		const generation = (existing?.lease_generation ?? 0) + 1;
		const expiresAt = new Date(new Date(now).getTime() + ttlMs).toISOString();
		db.prepare(
			`INSERT INTO cp_workspace_locks (workspace_key, owner_id, lease_generation, lease_expires_at, acquired_at, released_at)
			 VALUES (?, ?, ?, ?, ?, NULL)
			 ON CONFLICT(workspace_key) DO UPDATE SET
			   owner_id = excluded.owner_id,
			   lease_generation = excluded.lease_generation,
			   lease_expires_at = excluded.lease_expires_at,
			   acquired_at = excluded.acquired_at,
			   released_at = NULL`,
		).run(workspaceKey, ownerId, generation, expiresAt, now);
		return { acquired: true, generation, reclaimed: existing !== null };
	})();
}

/**
 * Lock-Heartbeat: verlängert `lease_expires_at` — NUR für den aktuellen
 * Owner. Ein alter Owner (nach Reclaim) oder ein fremder Owner erhält false
 * (Fencing — kein fremder Heartbeat hält einen Lock am Leben).
 */
export function renewWorkspaceLock(
	db: Database.Database,
	workspaceKey: string,
	ownerId: string,
	ttlMs: number,
): boolean {
	const expiresAt = new Date(Date.now() + ttlMs).toISOString();
	const res = db
		.prepare(
			`UPDATE cp_workspace_locks SET lease_expires_at = ?
			 WHERE workspace_key = ? AND owner_id = ? AND released_at IS NULL`,
		)
		.run(expiresAt, workspaceKey, ownerId);
	return res.changes === 1;
}

export function isWorkspaceLockValid(
	db: Database.Database,
	workspaceKey: string,
	ownerId: string,
	now = new Date().toISOString(),
): boolean {
	const lock = getWorkspaceLock(db, workspaceKey);
	if (!lock || lock.released_at !== null || lock.owner_id !== ownerId) return false;
	if (lock.lease_expires_at === null) return true;
	return new Date(lock.lease_expires_at).getTime() > new Date(now).getTime();
}

/**
 * Fenced Release: nur der aktuelle Owner (und optional die Generation)
 * darf freigeben. Ein alter Owner (Reclaim durch Dritte) kann den Lock des
 * neuen Besitzers NICHT freigeben — Update-WHERE verweigert (0 Zeilen).
 */
export function releaseWorkspaceLock(
	db: Database.Database,
	workspaceKey: string,
	ownerId: string,
	generation?: number,
): boolean {
	const res =
		generation !== undefined
			? db
					.prepare(
						`UPDATE cp_workspace_locks SET released_at = ?
						 WHERE workspace_key = ? AND owner_id = ? AND lease_generation = ? AND released_at IS NULL`,
					)
					.run(new Date().toISOString(), workspaceKey, ownerId, generation)
			: db
					.prepare(
						`UPDATE cp_workspace_locks SET released_at = ?
						 WHERE workspace_key = ? AND owner_id = ? AND released_at IS NULL`,
					)
					.run(new Date().toISOString(), workspaceKey, ownerId);
	return res.changes === 1;
}

/**
 * Stale-Lock-Recovery: abgelaufene Locks (kein Heartbeat, Owner gecrasht)
 * werden freigegeben — ein neuer Owner kann den Workspace deterministisch
 * übernehmen (Reclaim erzeugt die frische Generation).
 */
export function recoverStaleWorkspaceLocks(
	db: Database.Database,
	now = new Date().toISOString(),
): WorkspaceLock[] {
	const stale = db
		.prepare(
			`SELECT * FROM cp_workspace_locks
			 WHERE released_at IS NULL AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`,
		)
		.all(now) as Array<Record<string, unknown>>;
	const recovered: WorkspaceLock[] = [];
	for (const row of stale) {
		db.prepare('UPDATE cp_workspace_locks SET released_at = ? WHERE workspace_key = ?').run(
			now,
			String(row.workspace_key),
		);
		recovered.push(mapLockRow({ ...row, released_at: now }));
	}
	return recovered;
}
