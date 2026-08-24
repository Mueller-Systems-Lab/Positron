// Positron Control Plane — Fingerprint Tests
// FINGERPRINT_STABILITY: semantisch gleich → gleicher Fingerprint;
// Timestamps ändern → gleicher Fingerprint; Inhalt ändert → anderer Fingerprint.

import { describe, expect, it } from 'vitest';
import { canonicalJson, fingerprint, semanticallyEqual } from '../fingerprint.js';

const basePlan = {
	contract: 'positron.plan.v1',
	run_id: 'run_1',
	repository_ref: 'xxammaxx/Positron',
	repository_head: 'a'.repeat(40),
	targets: { files: ['src/a.ts'], symbols: ['foo'] },
	acceptance_criteria: ['foo works'],
	required_tests: ['test/a.test.ts'],
	risks: [],
	build_scope: { allowed_files: ['src/', 'test/'] },
	context: { fingerprint: 'fp_1' },
};

describe('FINGERPRINT_STABILITY', () => {
	it('same semantic content → same fingerprint', () => {
		const a = fingerprint(basePlan);
		const b = fingerprint({ ...basePlan });
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{64}$/);
	});

	it('runtime timestamps do not change the fingerprint', () => {
		const withTimestamps = {
			...basePlan,
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-01-02T00:00:00.000Z',
		};
		expect(fingerprint(withTimestamps)).toBe(fingerprint(basePlan));
	});

	it('custom excludeKeys are respected', () => {
		const withRuntime = { ...basePlan, duration_ms: 12345, started_at: 'x' };
		expect(fingerprint(withRuntime)).toBe(fingerprint(basePlan));
	});

	it('key order does not matter', () => {
		const shuffled: Record<string, unknown> = {};
		for (const key of Object.keys(basePlan).reverse()) {
			shuffled[key] = (basePlan as Record<string, unknown>)[key];
		}
		expect(fingerprint(shuffled)).toBe(fingerprint(basePlan));
	});

	it('changed semantic content → changed fingerprint', () => {
		const changed = { ...basePlan, acceptance_criteria: ['foo works differently'] };
		expect(fingerprint(changed)).not.toBe(fingerprint(basePlan));
	});

	it('changed array order → changed fingerprint (order is semantic)', () => {
		const reordered = { ...basePlan, required_tests: ['test/a.test.ts', 'test/b.test.ts'] };
		const reordered2 = { ...basePlan, required_tests: ['test/b.test.ts', 'test/a.test.ts'] };
		expect(fingerprint(reordered)).not.toBe(fingerprint(reordered2));
	});

	it('semanticallyEqual detects drift', () => {
		expect(semanticallyEqual(basePlan, { ...basePlan })).toBe(true);
		expect(semanticallyEqual(basePlan, { ...basePlan, repository_head: 'b'.repeat(40) })).toBe(
			false,
		);
	});

	it('undefined values are neutral', () => {
		const withUndefined = { ...basePlan, risks: undefined };
		const withMissing: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(basePlan)) {
			if (key === 'risks') continue;
			withMissing[key] = value;
		}
		expect(fingerprint(withUndefined)).toBe(fingerprint(withMissing));
	});

	it('canonical JSON is deterministic', () => {
		expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
	});
});
