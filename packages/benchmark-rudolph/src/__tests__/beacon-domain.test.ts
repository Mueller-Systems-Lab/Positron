// Positron — Rudolph Beacon Domain Tests (Red Tests)
//
// Tests for beacon-domain.ts: ReindeerBeacon types, BeaconStatus classification,
// boundary values, deterministic status rules.
//
// Red Tests: 1-5 from the specification

import { describe, expect, it } from 'vitest';
import {
	BATTERY_GREEN_THRESHOLD,
	BATTERY_YELLOW_LOWER,
	classifyBeacon,
	createBeacon,
	isStale,
	RSSI_GREEN_THRESHOLD,
	RSSI_YELLOW_LOWER,
	STALE_MINUTES,
} from '../beacon-domain.js';

const NOW = '2026-12-24T10:00:00Z';
const RECENT = '2026-12-24T09:55:00Z'; // 5 minutes ago
const STALE = '2026-12-24T09:25:00Z'; // 35 minutes ago
const INVALID_DATE = 'not-a-date';

function healthyBeacon(overrides: Partial<ReturnType<typeof createBeacon>> = {}) {
	return createBeacon({
		id: 'test-1',
		name: 'TestBeacon',
		beaconId: 'BLE-TEST-001',
		batteryPercent: 90,
		rssi: -40,
		lastSeenAt: RECENT,
		...overrides,
	});
}

// =============================================================================
// Red Test 1: Battery at 19% MUST be RED
// =============================================================================
describe('Red Test 1 — Battery < 20% → RED', () => {
	it('battery at 19% is RED', () => {
		const beacon = healthyBeacon({ batteryPercent: 19 });
		expect(classifyBeacon(beacon, NOW)).toBe('RED');
	});

	it('battery at 10% is RED', () => {
		const beacon = healthyBeacon({ batteryPercent: 10 });
		expect(classifyBeacon(beacon, NOW)).toBe('RED');
	});

	it('battery at 0% is RED', () => {
		const beacon = healthyBeacon({ batteryPercent: 0 });
		expect(classifyBeacon(beacon, NOW)).toBe('RED');
	});
});

// =============================================================================
// Red Test 2: Battery at 20% must NOT be RED due to battery
// =============================================================================
describe('Red Test 2 — Battery at 20% is NOT RED (due to battery)', () => {
	it('battery at exactly 20% is not RED (battery rule)', () => {
		const beacon = healthyBeacon({ batteryPercent: 20 });
		const status = classifyBeacon(beacon, NOW);
		// 20% battery alone should NOT trigger RED
		expect(status).not.toBe('RED');
	});

	it('battery at 20% with good RSSI and recent sighting is YELLOW', () => {
		const beacon = healthyBeacon({ batteryPercent: 20, rssi: -40, lastSeenAt: RECENT });
		expect(classifyBeacon(beacon, NOW)).toBe('YELLOW');
	});
});

// =============================================================================
// Red Test 3: RSSI -91 MUST be RED
// =============================================================================
describe('Red Test 3 — RSSI < -90 → RED', () => {
	it('RSSI -91 is RED', () => {
		const beacon = healthyBeacon({ rssi: -91 });
		expect(classifyBeacon(beacon, NOW)).toBe('RED');
	});

	it('RSSI -99 is RED', () => {
		const beacon = healthyBeacon({ rssi: -99 });
		expect(classifyBeacon(beacon, NOW)).toBe('RED');
	});

	it('RSSI -150 is RED', () => {
		const beacon = healthyBeacon({ rssi: -150 });
		expect(classifyBeacon(beacon, NOW)).toBe('RED');
	});
});

// =============================================================================
// Red Test 4: RSSI -90 must NOT be RED due to RSSI
// =============================================================================
describe('Red Test 4 — RSSI at -90 is NOT RED (due to RSSI)', () => {
	it('RSSI exactly -90 is not RED (RSSI rule)', () => {
		const beacon = healthyBeacon({ rssi: -90 });
		const status = classifyBeacon(beacon, NOW);
		expect(status).not.toBe('RED');
	});

	it('RSSI exactly -90 with good battery and recent sighting is YELLOW', () => {
		const beacon = healthyBeacon({ rssi: -90, batteryPercent: 90, lastSeenAt: RECENT });
		expect(classifyBeacon(beacon, NOW)).toBe('YELLOW');
	});
});

// =============================================================================
// Red Test 5: Last seen > 30 min MUST be RED
// =============================================================================
describe('Red Test 5 — Stale > 30 min → RED', () => {
	it('last seen 35 minutes ago is RED', () => {
		const beacon = healthyBeacon({ lastSeenAt: STALE });
		expect(classifyBeacon(beacon, NOW)).toBe('RED');
	});

	it('last seen 60 minutes ago is RED', () => {
		const beacon = healthyBeacon({ lastSeenAt: '2026-12-24T09:00:00Z' });
		expect(classifyBeacon(beacon, NOW)).toBe('RED');
	});

	it('last seen 31 minutes ago is RED', () => {
		const beacon = healthyBeacon({ lastSeenAt: '2026-12-24T09:29:00Z' });
		expect(classifyBeacon(beacon, NOW)).toBe('RED');
	});

	it('last seen exactly 30 minutes ago is NOT RED (stale rule)', () => {
		const beacon = healthyBeacon({ lastSeenAt: '2026-12-24T09:30:00Z' });
		const status = classifyBeacon(beacon, NOW);
		expect(status).not.toBe('RED');
	});
});

// =============================================================================
// RED precedence: RED over YELLOW over GREEN
// =============================================================================
describe('RED precedence', () => {
	it('battery 19% AND rssi -40 AND recent → RED (battery wins)', () => {
		const beacon = healthyBeacon({ batteryPercent: 19, rssi: -40, lastSeenAt: RECENT });
		expect(classifyBeacon(beacon, NOW)).toBe('RED');
	});

	it('rssi -91 AND battery 90% AND recent → RED (RSSI wins)', () => {
		const beacon = healthyBeacon({ rssi: -91, batteryPercent: 90, lastSeenAt: RECENT });
		expect(classifyBeacon(beacon, NOW)).toBe('RED');
	});

	it('stale AND battery 90% AND rssi -40 → RED (stale wins)', () => {
		const beacon = healthyBeacon({ lastSeenAt: STALE, batteryPercent: 90, rssi: -40 });
		expect(classifyBeacon(beacon, NOW)).toBe('RED');
	});

	it('all three red conditions → RED', () => {
		const beacon = healthyBeacon({ batteryPercent: 5, rssi: -99, lastSeenAt: STALE });
		expect(classifyBeacon(beacon, NOW)).toBe('RED');
	});
});

// =============================================================================
// GREEN and YELLOW classification
// =============================================================================
describe('GREEN and YELLOW classification', () => {
	it('healthy beacon is GREEN', () => {
		const beacon = healthyBeacon({ batteryPercent: 90, rssi: -40, lastSeenAt: RECENT });
		expect(classifyBeacon(beacon, NOW)).toBe('GREEN');
	});

	it('battery at exact GREEN threshold (40) is GREEN', () => {
		const beacon = healthyBeacon({ batteryPercent: 40, rssi: -40, lastSeenAt: RECENT });
		expect(classifyBeacon(beacon, NOW)).toBe('GREEN');
	});

	it('battery at 39% with good rssi → YELLOW', () => {
		const beacon = healthyBeacon({ batteryPercent: 39, rssi: -40, lastSeenAt: RECENT });
		expect(classifyBeacon(beacon, NOW)).toBe('YELLOW');
	});

	it('rssi at -76 with good battery → YELLOW', () => {
		const beacon = healthyBeacon({ rssi: -76, batteryPercent: 90, lastSeenAt: RECENT });
		expect(classifyBeacon(beacon, NOW)).toBe('YELLOW');
	});

	it('rssi at -75 with good battery → GREEN', () => {
		const beacon = healthyBeacon({ rssi: -75, batteryPercent: 90, lastSeenAt: RECENT });
		expect(classifyBeacon(beacon, NOW)).toBe('GREEN');
	});
});

// =============================================================================
// isStale function
// =============================================================================
describe('isStale', () => {
	it('returns true for times older than 30 minutes', () => {
		expect(isStale('2026-12-24T09:29:00Z', NOW)).toBe(true);
	});

	it('returns false for times within 30 minutes', () => {
		expect(isStale('2026-12-24T09:30:01Z', NOW)).toBe(false);
	});

	it('returns true for invalid dates (safety-first)', () => {
		expect(isStale(INVALID_DATE, NOW)).toBe(true);
	});

	it('returns true when nowIso is invalid (safety-first)', () => {
		expect(isStale(NOW, INVALID_DATE)).toBe(true);
	});
});

// =============================================================================
// Edge Cases
// =============================================================================
describe('Edge cases', () => {
	it('battery at 100% with all good → GREEN', () => {
		const beacon = healthyBeacon({ batteryPercent: 100 });
		expect(classifyBeacon(beacon, NOW)).toBe('GREEN');
	});

	it('rssi at 0 (strongest signal) → GREEN', () => {
		const beacon = healthyBeacon({ rssi: 0 });
		expect(classifyBeacon(beacon, NOW)).toBe('GREEN');
	});

	it('lastSeenAt exactly at now → GREEN (if other conditions met)', () => {
		const beacon = healthyBeacon({ lastSeenAt: NOW });
		expect(classifyBeacon(beacon, NOW)).toBe('GREEN');
	});

	it('unknown zone → still classifies correctly', () => {
		const beacon = healthyBeacon({ zone: 'unknown' });
		expect(classifyBeacon(beacon, NOW)).toBe('GREEN');
	});
});
