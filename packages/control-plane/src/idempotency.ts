// Positron Control Plane — Idempotency Registry
//
// Jeder mutierende Jobversuch bekommt einen Idempotency Key:
//   run_id:job_id:attempt_id
//
// - `claim` liefert true nur beim ERSTEN Mal (INSERT OR IGNORE).
// - Doppelter Dispatch → claim false → keine zweite Mutation.
// - Doppeltes Completion-Event → claim/complete idempotent → keine doppelte Transition.
// - Worker-Retry nach Transport-Fehler → der Key ist bereits claimed → kontrolliert.

import type Database from 'better-sqlite3';

export type IdempotencyState = 'claimed' | 'completed';

export function idempotencyKey(runId: string, jobId: string, attemptId: string): string {
	return `${runId}:${jobId}:${attemptId}`;
}

export interface IdempotencyEntry {
	key: string;
	state: IdempotencyState;
	result_ref: string | null;
	created_at: string;
	completed_at: string | null;
}

function mapRow(row: Record<string, unknown>): IdempotencyEntry {
	return {
		key: String(row.idem_key),
		state: row.state as IdempotencyState,
		result_ref: row.result_ref ? String(row.result_ref) : null,
		created_at: String(row.created_at),
		completed_at: row.completed_at ? String(row.completed_at) : null,
	};
}

export class IdempotencyRegistry {
	constructor(private readonly db: Database.Database) {}

	/**
	 * Beansprucht einen Idempotency Key.
	 * @returns true wenn der Key NOCH NICHT existierte (erste Ausführung),
	 *          false bei Duplikat.
	 */
	claim(key: string): boolean {
		const inserted = this.db
			.prepare(
				`INSERT OR IGNORE INTO cp_idempotency (idem_key, state, created_at)
				 VALUES (?, 'claimed', ?)`,
			)
			.run(key, new Date().toISOString());
		return inserted.changes > 0;
	}

	/**
	 * Markiert einen Key als completed. Idempotent: Mehrfachaufruf ist sicher.
	 */
	complete(key: string, resultRef: string | null = null): void {
		this.db
			.prepare(
				`UPDATE cp_idempotency SET state = 'completed', result_ref = ?, completed_at = ?
				 WHERE idem_key = ?`,
			)
			.run(resultRef, new Date().toISOString(), key);
	}

	/**
	 * Führt eine mutierende Operation genau einmal aus.
	 * Duplikate bekommen `duplicate: true` und die Operation läuft NICHT erneut.
	 */
	runOnce<T>(key: string, operation: () => T): { duplicate: boolean; result: T | null } {
		if (!this.claim(key)) {
			return { duplicate: true, result: null };
		}
		// Der Key bleibt claimed — ein erneuter Versuch mit gleichem Key ist
		// damit ebenfalls ein Duplikat und wird nicht erneut ausgeführt.
		// Fehler der Operation propagieren (der Key bleibt claimed).
		const result = operation();
		return { duplicate: false, result };
	}

	isCompleted(key: string): boolean {
		const row = this.db.prepare('SELECT state FROM cp_idempotency WHERE idem_key = ?').get(key) as
			| { state: string }
			| undefined;
		return row?.state === 'completed';
	}

	isClaimed(key: string): boolean {
		const row = this.db.prepare('SELECT state FROM cp_idempotency WHERE idem_key = ?').get(key) as
			| { state: string }
			| undefined;
		return row !== undefined;
	}

	get(key: string): IdempotencyEntry | null {
		const row = this.db.prepare('SELECT * FROM cp_idempotency WHERE idem_key = ?').get(key) as
			| Record<string, unknown>
			| undefined;
		return row ? mapRow(row) : null;
	}

	count(): number {
		const row = this.db.prepare('SELECT COUNT(*) as c FROM cp_idempotency').get() as { c: number };
		return Number(row.c);
	}
}
