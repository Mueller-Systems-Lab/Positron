import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
	DEFAULT_VOICE_SETTINGS,
	type VoiceSettings,
	loadVoiceSettings,
	saveVoiceSettings,
	toggleVoiceEnabled,
} from '../voice-settings.js';

// Mock localStorage
const store: Record<string, string> = {};

beforeEach(() => {
	vi.stubGlobal('localStorage', {
		getItem: vi.fn((key: string) => store[key] ?? null),
		setItem: vi.fn((key: string, value: string) => {
			store[key] = value;
		}),
		removeItem: vi.fn((key: string) => {
			delete store[key];
		}),
		clear: vi.fn(() => {
			for (const k of Object.keys(store)) delete store[k];
		}),
		length: 0,
		key: vi.fn(() => null),
	});
	for (const k of Object.keys(store)) delete store[k];
});

describe('voice-settings', () => {
	test('DEFAULT_VOICE_SETTINGS has enabled=false', () => {
		expect(DEFAULT_VOICE_SETTINGS.enabled).toBe(false);
	});

	test('DEFAULT_VOICE_SETTINGS has all 6 event types', () => {
		expect(DEFAULT_VOICE_SETTINGS.enabledEventTypes).toHaveLength(6);
		expect(DEFAULT_VOICE_SETTINGS.enabledEventTypes).toContain('run_started');
		expect(DEFAULT_VOICE_SETTINGS.enabledEventTypes).toContain('run_done');
	});

	test('loadVoiceSettings returns defaults when localStorage is empty', () => {
		const settings = loadVoiceSettings();
		expect(settings.enabled).toBe(false);
		expect(settings.rate).toBe(1.0);
		expect(settings.volume).toBe(1.0);
		expect(settings.selectedVoiceURI).toBeNull();
	});

	test('loadVoiceSettings returns defaults when localStorage has invalid JSON', () => {
		store['positron-voice-settings'] = '{invalid-json---';
		const settings = loadVoiceSettings();
		expect(settings.enabled).toBe(false);
	});

	test('saveVoiceSettings + loadVoiceSettings roundtrip', () => {
		const custom: VoiceSettings = {
			enabled: true,
			selectedVoiceURI: 'test-voice',
			rate: 1.5,
			volume: 0.8,
			enabledEventTypes: ['run_started', 'run_done'],
		};
		saveVoiceSettings(custom);
		const loaded = loadVoiceSettings();
		expect(loaded.enabled).toBe(true);
		expect(loaded.selectedVoiceURI).toBe('test-voice');
		expect(loaded.rate).toBe(1.5);
		expect(loaded.volume).toBe(0.8);
		expect(loaded.enabledEventTypes).toEqual(['run_started', 'run_done']);
	});

	test('loadVoiceSettings clamps out-of-range rate', () => {
		store['positron-voice-settings'] = JSON.stringify({ rate: 5.0 });
		const settings = loadVoiceSettings();
		expect(settings.rate).toBe(DEFAULT_VOICE_SETTINGS.rate);
	});

	test('loadVoiceSettings clamps out-of-range volume', () => {
		store['positron-voice-settings'] = JSON.stringify({ volume: 2.5 });
		const settings = loadVoiceSettings();
		expect(settings.volume).toBe(DEFAULT_VOICE_SETTINGS.volume);
	});

	test('loadVoiceSettings filters invalid event types', () => {
		store['positron-voice-settings'] = JSON.stringify({
			enabledEventTypes: ['run_started', 'invalid_type', 'run_done'],
		});
		const settings = loadVoiceSettings();
		expect(settings.enabledEventTypes).toEqual(['run_started', 'run_done']);
	});

	test('loadVoiceSettings handles missing fields gracefully', () => {
		store['positron-voice-settings'] = JSON.stringify({ enabled: true });
		const settings = loadVoiceSettings();
		expect(settings.enabled).toBe(true);
		expect(settings.rate).toBe(DEFAULT_VOICE_SETTINGS.rate);
		expect(settings.volume).toBe(DEFAULT_VOICE_SETTINGS.volume);
	});

	test('toggleVoiceEnabled toggles enabled state', () => {
		// Start: OFF
		let result = toggleVoiceEnabled();
		expect(result).toBe(true);
		expect(loadVoiceSettings().enabled).toBe(true);

		// Toggle: ON → OFF
		result = toggleVoiceEnabled();
		expect(result).toBe(false);
		expect(loadVoiceSettings().enabled).toBe(false);
	});

	test('saveVoiceSettings does not throw on localStorage error', () => {
		// Simuliere localStorage-Fehler (z.B. voll)
		vi.stubGlobal('localStorage', {
			getItem: vi.fn(() => null),
			setItem: vi.fn(() => {
				throw new Error('QuotaExceeded');
			}),
		});
		expect(() => saveVoiceSettings(DEFAULT_VOICE_SETTINGS)).not.toThrow();
	});

	test('loadVoiceSettings returns deep-cloned defaults (no shared references)', () => {
		const s1 = loadVoiceSettings();
		const s2 = loadVoiceSettings();
		// Arrays should be different instances
		expect(s1.enabledEventTypes).not.toBe(s2.enabledEventTypes);
		// Mutation of one should not affect the other
		s1.enabledEventTypes.push('run_started' as never);
		expect(s2.enabledEventTypes).toHaveLength(6);
	});
});
