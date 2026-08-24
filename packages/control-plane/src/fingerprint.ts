// Positron Control Plane — Contract Fingerprints
//
// Stabiler SHA-256-Fingerprint über kanonisch serialisiertes semantisches JSON.
//
// Canonicalisierung:
// - Objekt-Keys rekursiv alphabetisch sortiert
// - Array-Reihenfolge bleibt (semantisch relevant)
// - undefined-Werte und leere Objekte werden entfernt
// - Zahlen werden normalisiert (kein -0)
//
// Nicht-semantische Runtime-Felder (Timestamps etc.) können über
// excludeKeys ausgeschlossen werden — sie dürfen den Fingerprint nicht ändern.

import crypto from 'node:crypto';

const RUNTIME_KEYS = new Set([
	'created_at',
	'updated_at',
	'started_at',
	'ended_at',
	'timestamp',
	'duration_ms',
	'result_ref',
]);

function canonicalize(value: unknown, excludeKeys: ReadonlySet<string>): string {
	if (value === null || value === undefined) return 'null';
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'number') {
		// Normalisiere -0 und entferne nicht-finite Werte deterministisch
		if (!Number.isFinite(value)) return 'null';
		return Object.is(value, -0) ? '0' : String(value);
	}
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (Array.isArray(value)) {
		return `[${value.map((v) => canonicalize(v, excludeKeys)).join(',')}]`;
	}
	if (typeof value === 'object') {
		const obj = value as Record<string, unknown>;
		const keys = Object.keys(obj)
			.filter((k) => !excludeKeys.has(k))
			.sort();
		const parts: string[] = [];
		for (const key of keys) {
			const v = obj[key];
			if (v === undefined) continue;
			const canonical = canonicalize(v, excludeKeys);
			// Leere Objekte (nach Key-Filterung) sind semantisch neutral
			if (canonical === '{}') continue;
			parts.push(`${JSON.stringify(key)}:${canonical}`);
		}
		return `{${parts.join(',')}}`;
	}
	return 'null';
}

/**
 * Erzeugt einen stabilen SHA-256-Fingerprint.
 *
 * @param document Das semantische JSON-Dokument
 * @param options.excludeKeys Runtime-Keys, die den Fingerprint nicht verändern dürfen
 */
export function fingerprint(
	document: unknown,
	options: { excludeKeys?: ReadonlySet<string> } = {},
): string {
	const exclude = new Set([...RUNTIME_KEYS, ...(options.excludeKeys ?? [])]);
	const canonical = canonicalize(document, exclude);
	return crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex');
}

/** Kanonische JSON-Repräsentation (für Debugging/Evidenz). */
export function canonicalJson(
	document: unknown,
	options: { excludeKeys?: ReadonlySet<string> } = {},
): string {
	const exclude = new Set([...RUNTIME_KEYS, ...(options.excludeKeys ?? [])]);
	return canonicalize(document, exclude);
}

/**
 * Deterministischer Vergleich zweier Dokumente auf semantische Gleichheit.
 */
export function semanticallyEqual(a: unknown, b: unknown): boolean {
	return canonicalJson(a) === canonicalJson(b);
}
