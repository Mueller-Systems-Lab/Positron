// Positron Control Plane — Provider Capacity & Reservations (P4, Slice E)
//
// Provider-Capacity produktiv verdrahten:
//
//   - KEINE erfundenen API-Limits: falls ein Provider keine echte Capacity
//     meldet, wird die Positron-konfigurierte conservative Capacity verwendet
//     (POSITRON_PROVIDER_CAPACITY, JSON { provider: max_concurrent }).
//   - Atomic: Reserve VOR dem Dispatch (innerhalb der Admission-Transaktion),
//     Release NACH jedem terminalen Zustand.
//   - Admission prüft Capacity über die aktiven Reservierungen.
//
// Reservierungstabelle: cp_provider_reservations
//   provider, model, owner_id (queue_item_id), status reserved/released

import type Database from 'better-sqlite3';

export const PROVIDER_RESERVATION_SCHEMA_V6 = `
CREATE TABLE IF NOT EXISTS cp_provider_reservations (
  reservation_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT,
  owner_id TEXT NOT NULL,
  run_id TEXT,
  status TEXT NOT NULL DEFAULT 'reserved',
  reserved_at TEXT NOT NULL,
  released_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cp_provider_reservations_provider ON cp_provider_reservations(provider, status);
CREATE INDEX IF NOT EXISTS idx_cp_provider_reservations_owner ON cp_provider_reservations(owner_id);
`;

export interface ProviderReservation {
	reservation_id: string;
	provider: string;
	model: string | null;
	owner_id: string;
	run_id: string | null;
	status: 'reserved' | 'released';
	reserved_at: string;
	released_at: string | null;
}

/**
 * Zentrale, validierte Provider-Capacity-Konfiguration.
 *
 * `POSITRON_PROVIDER_CAPACITY` = JSON-Objekt `{ "<provider>": <max_concurrent> }`.
 * Ungültig (kein JSON, nicht-positiv, nicht-ganzzahlig) → Fail-Closed (Error).
 * Nicht konfigurierte Provider sind NICHT begrenzt (keine erfundenen Limits).
 */
export function resolveProviderCapacity(env: NodeJS.ProcessEnv = process.env): Record<string, number> {
	const raw = env.POSITRON_PROVIDER_CAPACITY;
	if (raw === undefined || raw.trim() === '') {
		return {};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error(`POSITRON_PROVIDER_CAPACITY invalid: '${raw}' — must be a JSON object`);
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error(`POSITRON_PROVIDER_CAPACITY invalid: '${raw}' — must be a JSON object`);
	}
	const out: Record<string, number> = {};
	for (const [provider, value] of Object.entries(parsed as Record<string, unknown>)) {
		const n = Number(value);
		if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
			throw new Error(
				`POSITRON_PROVIDER_CAPACITY invalid for '${provider}': '${String(value)}' — must be a positive integer`,
			);
		}
		out[provider] = n;
	}
	return out;
}

function mapReservationRow(row: Record<string, unknown>): ProviderReservation {
	return {
		reservation_id: String(row.reservation_id),
		provider: String(row.provider),
		model: row.model ? String(row.model) : null,
		owner_id: String(row.owner_id),
		run_id: row.run_id ? String(row.run_id) : null,
		status: String(row.status) as ProviderReservation['status'],
		reserved_at: String(row.reserved_at),
		released_at: row.released_at ? String(row.released_at) : null,
	};
}

/**
 * Aktive Reservierungen je Provider (admission-Capacity-Sicht).
 */
export function activeProviderReservations(db: Database.Database): Record<string, number> {
	const rows = db
		.prepare(
			"SELECT provider, COUNT(*) AS n FROM cp_provider_reservations WHERE status = 'reserved' GROUP BY provider",
		)
		.all() as Array<{ provider: string; n: number }>;
	const out: Record<string, number> = {};
	for (const r of rows) out[r.provider] = Number(r.n);
	return out;
}

/**
 * ATOMARES Reserve: genau EINE Reservierung pro Owner+Provider (idempotent).
 * Ein zweiter Reserve-Aufruf desselben Owners liefert die bestehende
 * Reservierung zurück (kein Doppel-Count). Konkurrierende Scheduler-Prozesse
 * serialisiert SQLite (BEGIN IMMEDIATE der Admission-Transaktion).
 */
export function reserveProviderSlot(
	db: Database.Database,
	input: { provider: string; model?: string | null; ownerId: string; runId?: string | null; now?: string },
): { reserved: boolean; reservation_id: string } {
	const now = input.now ?? new Date().toISOString();
	return db.transaction((): { reserved: boolean; reservation_id: string } => {
		const existing = db
			.prepare(
				"SELECT * FROM cp_provider_reservations WHERE owner_id = ? AND provider = ? AND status = 'reserved' LIMIT 1",
			)
			.get(input.ownerId, input.provider) as Record<string, unknown> | undefined;
		if (existing) {
			return {
				reserved: true,
				reservation_id: String(existing.reservation_id),
			};
		}
		const reservationId = `res_${crypto.randomUUID()}`;
		db.prepare(
			`INSERT INTO cp_provider_reservations (reservation_id, provider, model, owner_id, run_id, status, reserved_at, released_at)
			 VALUES (?, ?, ?, ?, ?, 'reserved', ?, NULL)`,
		).run(
			reservationId,
			input.provider,
			input.model ?? null,
			input.ownerId,
			input.runId ?? null,
			now,
		);
		return { reserved: true, reservation_id: reservationId };
	})();
}

/**
 * Gefenced Release: nur der Owner darf freigeben; ein DUPLIKAT-Release ist
 * ein NOOP (status bereits 'released' → 0 Zeilen → false). Ein Release nach
 * Reclaim/Neu-Reserve eines anderen Owners betrifft nur dessen eigene Zeile.
 */
export function releaseProviderSlot(
	db: Database.Database,
	ownerId: string,
	now = new Date().toISOString(),
): boolean {
	const res = db
		.prepare(
			`UPDATE cp_provider_reservations SET status = 'released', released_at = ?
			 WHERE owner_id = ? AND status = 'reserved'`,
		)
		.run(now, ownerId);
	return res.changes > 0;
}

/**
 * Stale-Slot-Recovery (Crash): Reservierungen, deren Owner nicht mehr in
 * RUNNING/ADMITTED ist (Scheduler-Crash / requeued), werden freigegeben —
 * Capacity steht neuen Runs sofort wieder zur Verfügung.
 */
export function recoverStaleProviderSlots(
	db: Database.Database,
	now = new Date().toISOString(),
): ProviderReservation[] {
	const rows = db
		.prepare(
			`SELECT * FROM cp_provider_reservations WHERE status = 'reserved'
			 AND owner_id NOT IN (
			   SELECT queue_item_id FROM cp_queue
			   WHERE queue_state IN ('RUNNING', 'ADMITTED')
			 )`,
		)
		.all() as Array<Record<string, unknown>>;
	const recovered: ProviderReservation[] = [];
	for (const row of rows) {
		db.prepare(
			"UPDATE cp_provider_reservations SET status = 'released', released_at = ? WHERE reservation_id = ?",
		).run(now, String(row.reservation_id));
		recovered.push(mapReservationRow({ ...row, status: 'released', released_at: now }));
	}
	return recovered;
}
