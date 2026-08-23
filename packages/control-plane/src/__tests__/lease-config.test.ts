// Positron Control Plane — P4 Lease-TTL-Konfiguration (Slice A)
//
// Testmatrix:
//   PRODUCTION_ATTEMPT_LEASE_TTL_CONFIGURED = PASS
//   - Default ist eine reale bounded TTL (kein undefined, kein Infinity)
//   - zentrale Konfiguration über POSITRON_ATTEMPT_LEASE_TTL_MS
//   - Validierung: ungültige Werte werfen (Fail-Closed)
//   - kontrolliert kleine TTL für Tests möglich

import { describe, expect, it } from 'vitest';
import { DEFAULT_ATTEMPT_LEASE_TTL_MS, resolveAttemptLeaseTtlMs } from '../store.js';

describe('P4 — LEASE TTL CONFIG (PRODUCTION_ATTEMPT_LEASE_TTL_CONFIGURED)', () => {
	it('DEFAULT: liefert eine reale bounded TTL — kein undefined, kein Infinity', () => {
		const ttl = resolveAttemptLeaseTtlMs({});
		expect(Number.isFinite(ttl)).toBe(true);
		expect(ttl).toBeGreaterThan(0);
		expect(ttl).toBe(DEFAULT_ATTEMPT_LEASE_TTL_MS);
		expect(ttl).toBe(300_000);
	});

	it('CONFIG: POSITRON_ATTEMPT_LEASE_TTL_MS überschreibt den Default', () => {
		expect(resolveAttemptLeaseTtlMs({ POSITRON_ATTEMPT_LEASE_TTL_MS: '5000' })).toBe(5000);
		// kleine TTL für Tests
		expect(resolveAttemptLeaseTtlMs({ POSITRON_ATTEMPT_LEASE_TTL_MS: '120' })).toBe(120);
	});

	it('VALIDATION: nicht-numerische Werte werfen (Fail-Closed, nie unbegrenzt)', () => {
		expect(() => resolveAttemptLeaseTtlMs({ POSITRON_ATTEMPT_LEASE_TTL_MS: 'abc' })).toThrow(
			/POSITRON_ATTEMPT_LEASE_TTL_MS invalid/,
		);
		expect(() => resolveAttemptLeaseTtlMs({ POSITRON_ATTEMPT_LEASE_TTL_MS: '-1' })).toThrow(
			/POSITRON_ATTEMPT_LEASE_TTL_MS invalid/,
		);
		expect(() => resolveAttemptLeaseTtlMs({ POSITRON_ATTEMPT_LEASE_TTL_MS: '0' })).toThrow(
			/POSITRON_ATTEMPT_LEASE_TTL_MS invalid/,
		);
		expect(() => resolveAttemptLeaseTtlMs({ POSITRON_ATTEMPT_LEASE_TTL_MS: 'Infinity' })).toThrow(
			/POSITRON_ATTEMPT_LEASE_TTL_MS invalid/,
		);
	});

	it('EMPTY: leerer/blanker Wert fällt auf den Default zurück', () => {
		expect(resolveAttemptLeaseTtlMs({ POSITRON_ATTEMPT_LEASE_TTL_MS: '' })).toBe(
			DEFAULT_ATTEMPT_LEASE_TTL_MS,
		);
		expect(resolveAttemptLeaseTtlMs({ POSITRON_ATTEMPT_LEASE_TTL_MS: '  ' })).toBe(
			DEFAULT_ATTEMPT_LEASE_TTL_MS,
		);
	});
});
