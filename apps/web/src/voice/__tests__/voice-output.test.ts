import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { LogLevel, Phase, RunEvent } from '../../types.js';
import {
	cancelSpeech,
	classifyEvent,
	eventToSpeechText,
	getAvailableVoices,
	getLastSpoken,
	isSpeechSupported,
	mapEventToSpeech,
	resetRateLimitForTest,
	resetVoiceState,
	speakEvent,
	speakTest,
} from '../voice-output.js';
import { DEFAULT_VOICE_SETTINGS, saveVoiceSettings } from '../voice-settings.js';

// ── SpeechSynthesis Mock ──
const mockSpeak = vi.fn();
const mockCancel = vi.fn();
const mockVoices: SpeechSynthesisVoice[] = [
	{
		voiceURI: 'voice-1',
		name: 'Test Voice 1',
		lang: 'en-US',
		default: true,
		localService: true,
	},
	{
		voiceURI: 'voice-2',
		name: 'Test Voice 2',
		lang: 'en-GB',
		default: false,
		localService: true,
	},
] as unknown as SpeechSynthesisVoice[];

function setupSpeechSynthesis(): void {
	// Mock SpeechSynthesisUtterance constructor (not available in jsdom)
	class MockUtterance {
		text = '';
		voice: SpeechSynthesisVoice | null = null;
		rate = 1;
		volume = 1;
		pitch = 1;
		lang = '';
		onstart: (() => void) | null = null;
		onend: (() => void) | null = null;
		onerror: (() => void) | null = null;
		constructor(text: string) {
			this.text = text;
		}
	}
	vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);

	vi.stubGlobal('speechSynthesis', {
		speak: mockSpeak,
		cancel: mockCancel,
		getVoices: vi.fn(() => mockVoices),
		paused: false,
		pending: false,
		speaking: false,
		onvoiceschanged: null,
		pause: vi.fn(),
		resume: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	});
}

function removeSpeechSynthesis(): void {
	vi.stubGlobal('speechSynthesis', undefined);
}

function makeEvent(overrides: Partial<RunEvent> = {}): RunEvent {
	return {
		id: 'evt-1',
		runId: 'cd6a5f1e2b3c4d5e',
		phase: 'QUEUED' as Phase,
		level: 'INFO' as LogLevel,
		message: '',
		payload: {},
		createdAt: new Date().toISOString(),
		...overrides,
	};
}

beforeEach(() => {
	mockSpeak.mockClear();
	mockCancel.mockClear();
	setupSpeechSynthesis();
	// Reset voice settings to default
	saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS });
	// Reset module-level state (rate limiter, dedupe queue, last spoken)
	resetVoiceState();
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ── isSpeechSupported ──
describe('isSpeechSupported', () => {
	test('returns true when speechSynthesis is available', () => {
		expect(isSpeechSupported()).toBe(true);
	});

	test('returns false when speechSynthesis is undefined', () => {
		removeSpeechSynthesis();
		expect(isSpeechSupported()).toBe(false);
	});
});

// ── getAvailableVoices ──
describe('getAvailableVoices', () => {
	test('returns voices when supported', () => {
		const voices = getAvailableVoices();
		expect(voices).toHaveLength(2);
	});

	test('returns empty array when unsupported', () => {
		removeSpeechSynthesis();
		expect(getAvailableVoices()).toEqual([]);
	});
});

// ── classifyEvent ──
describe('classifyEvent', () => {
	test('QUEUED → run_started', () => {
		expect(classifyEvent(makeEvent({ phase: 'QUEUED' }))).toBe('run_started');
	});

	test('DONE → run_done', () => {
		expect(classifyEvent(makeEvent({ phase: 'DONE' }))).toBe('run_done');
	});

	test('FAILED → phase_failed', () => {
		expect(classifyEvent(makeEvent({ phase: 'FAILED' }))).toBe('phase_failed');
	});

	test('FAILED_TRANSIENT → phase_failed', () => {
		expect(classifyEvent(makeEvent({ phase: 'FAILED_TRANSIENT' }))).toBe('phase_failed');
	});

	test('FAILED_BLOCKED → run_blocked', () => {
		expect(classifyEvent(makeEvent({ phase: 'FAILED_BLOCKED' }))).toBe('run_blocked');
	});

	test('BLOCKED_MERGE → merge_blocked', () => {
		expect(classifyEvent(makeEvent({ phase: 'BLOCKED_MERGE' }))).toBe('merge_blocked');
	});

	test('BLOCKED_PUSH → merge_blocked', () => {
		expect(classifyEvent(makeEvent({ phase: 'BLOCKED_PUSH' }))).toBe('merge_blocked');
	});

	test('GATE_APPROVE → human_action', () => {
		expect(classifyEvent(makeEvent({ phase: 'GATE_APPROVE' }))).toBe('human_action');
	});

	test('GATE_REVISE → human_action', () => {
		expect(classifyEvent(makeEvent({ phase: 'GATE_REVISE' }))).toBe('human_action');
	});

	test('IMPLEMENT → null (not spoken)', () => {
		expect(classifyEvent(makeEvent({ phase: 'IMPLEMENT' }))).toBeNull();
	});

	test('REVIEW → null (not spoken)', () => {
		expect(classifyEvent(makeEvent({ phase: 'REVIEW' }))).toBeNull();
	});

	test('TEST → null (not spoken)', () => {
		expect(classifyEvent(makeEvent({ phase: 'TEST' }))).toBeNull();
	});

	test('kill-switch message → run_blocked', () => {
		expect(
			classifyEvent(
				makeEvent({
					phase: 'IMPLEMENT',
					message: 'kill-switch activated',
				}),
			),
		).toBe('run_blocked');
	});

	test('human action required message → human_action', () => {
		expect(
			classifyEvent(
				makeEvent({
					phase: 'IMPLEMENT',
					message: 'Human approval required for merge',
				}),
			),
		).toBe('human_action');
	});
});

// ── mapEventToSpeech ──
describe('mapEventToSpeech', () => {
	test('run_started includes shortened run ID', () => {
		const text = mapEventToSpeech(makeEvent({ phase: 'QUEUED' }), 'run_started');
		expect(text).toContain('Lauf cd6a5f1e');
		expect(text).toContain('gestartet');
	});

	test('run_done', () => {
		const text = mapEventToSpeech(makeEvent({ phase: 'DONE' }), 'run_done');
		expect(text).toBe('Lauf erfolgreich abgeschlossen');
	});

	test('phase_failed includes phase name', () => {
		const text = mapEventToSpeech(makeEvent({ phase: 'FAILED' }), 'phase_failed');
		expect(text).toContain('Phase FAILED fehlgeschlagen');
	});

	test('merge_blocked mentions kill-switch', () => {
		const text = mapEventToSpeech(makeEvent({ phase: 'BLOCKED_MERGE' }), 'merge_blocked');
		expect(text).toBe('Merge blockiert durch Kill-Switch');
	});

	test('human_action', () => {
		const text = mapEventToSpeech(makeEvent({ phase: 'GATE_APPROVE' }), 'human_action');
		expect(text).toBe('Menschliche Aktion erforderlich');
	});

	test('run_blocked includes message when present', () => {
		const text = mapEventToSpeech(
			makeEvent({ phase: 'FAILED_BLOCKED', message: 'test failure' }),
			'run_blocked',
		);
		expect(text).toContain('Lauf blockiert');
		expect(text).toContain('test failure');
	});

	test('run_blocked without message still works', () => {
		const text = mapEventToSpeech(
			makeEvent({ phase: 'FAILED_BLOCKED', message: '' }),
			'run_blocked',
		);
		expect(text).toBe('Lauf blockiert');
	});

	test('never produces "undefined" or "null" in output', () => {
		const runStarted = mapEventToSpeech(makeEvent({ phase: 'QUEUED' }), 'run_started');
		expect(runStarted).not.toContain('undefined');
		expect(runStarted).not.toContain('null');
	});
});

// ── eventToSpeechText ──
describe('eventToSpeechText', () => {
	test('returns text for speakable event', () => {
		const text = eventToSpeechText(makeEvent({ phase: 'QUEUED' }));
		expect(text).toContain('Lauf cd6a5f1e gestartet');
	});

	test('returns null for non-speakable event', () => {
		const text = eventToSpeechText(makeEvent({ phase: 'IMPLEMENT' }));
		expect(text).toBeNull();
	});

	test('redacts secrets in event message', () => {
		const text = eventToSpeechText(
			makeEvent({
				phase: 'FAILED_BLOCKED',
				message: 'Error: token=ghp_abcdefghijklmnopqrstuvwxyz1234567890',
			}),
		);
		expect(text).not.toContain('ghp_');
		expect(text).toContain('[TOKEN]');
	});

	test('truncates very long messages', () => {
		const longMessage = 'x'.repeat(500);
		const text = eventToSpeechText(makeEvent({ phase: 'FAILED_BLOCKED', message: longMessage }));
		expect(text).not.toBeNull();
		expect(text!.length).toBeLessThanOrEqual(200);
	});
});

// ── speakEvent ──
describe('speakEvent', () => {
	test('does nothing when voice is disabled', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: false });
		speakEvent(makeEvent({ phase: 'QUEUED' }));
		expect(mockSpeak).not.toHaveBeenCalled();
	});

	test('does nothing when speechSynthesis is unsupported', () => {
		removeSpeechSynthesis();
		speakEvent(makeEvent({ phase: 'QUEUED' }));
		expect(mockSpeak).not.toHaveBeenCalled();
	});

	test('does nothing for non-speakable event', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		speakEvent(makeEvent({ phase: 'IMPLEMENT' }));
		expect(mockSpeak).not.toHaveBeenCalled();
	});

	test('speaks when enabled and event is relevant', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		speakEvent(makeEvent({ phase: 'DONE' }));
		expect(mockSpeak).toHaveBeenCalledTimes(1);
	});

	test('speaks with selected voice settings', () => {
		saveVoiceSettings({
			...DEFAULT_VOICE_SETTINGS,
			enabled: true,
			selectedVoiceURI: 'voice-1',
			rate: 1.5,
			volume: 0.7,
		});
		speakEvent(makeEvent({ phase: 'DONE' }));
		expect(mockSpeak).toHaveBeenCalledTimes(1);
		const utterance = mockSpeak.mock.calls[0][0] as SpeechSynthesisUtterance;
		expect(utterance.rate).toBe(1.5);
		expect(utterance.volume).toBe(0.7);
	});

	test('does not speak when event type is disabled in settings', () => {
		saveVoiceSettings({
			...DEFAULT_VOICE_SETTINGS,
			enabled: true,
			enabledEventTypes: ['run_blocked'],
		});
		speakEvent(makeEvent({ phase: 'DONE' }));
		expect(mockSpeak).not.toHaveBeenCalled();
	});
});

// ── Rate Limit ──
describe('rate limit', () => {
	test('only speaks first event within 3 seconds', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		speakEvent(makeEvent({ phase: 'DONE', id: '1' }));
		speakEvent(makeEvent({ phase: 'DONE', id: '2' }));
		speakEvent(makeEvent({ phase: 'DONE', id: '3' }));
		expect(mockSpeak).toHaveBeenCalledTimes(1);
	});
});

// ── Deduplication ──
describe('deduplication', () => {
	test('first speak succeeds', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		speakEvent(makeEvent({ phase: 'DONE' }));
		expect(mockSpeak).toHaveBeenCalledTimes(1);
	});

	test('same message blocked by dedupe after rate limit reset', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		// First speak: populates dedupe queue
		speakEvent(makeEvent({ phase: 'DONE' }));
		expect(mockSpeak).toHaveBeenCalledTimes(1);

		// Reset only rate limiter — dedupe queue stays intact
		resetRateLimitForTest();
		// Second speak with identical event — dedupe blocks
		speakEvent(makeEvent({ phase: 'DONE' }));
		expect(mockSpeak).toHaveBeenCalledTimes(1); // still 1 — deduped
	});
});

// ── speakTest ──
describe('speakTest', () => {
	test('speaks test message', () => {
		speakTest();
		expect(mockSpeak).toHaveBeenCalledTimes(1);
		const utterance = mockSpeak.mock.calls[0][0] as SpeechSynthesisUtterance;
		expect(utterance.text).toBe('Positron voice output active');
	});

	test('does nothing when unsupported', () => {
		removeSpeechSynthesis();
		speakTest();
		expect(mockSpeak).not.toHaveBeenCalled();
	});
});

// ── cancelSpeech ──
describe('cancelSpeech', () => {
	test('calls speechSynthesis.cancel()', () => {
		cancelSpeech();
		expect(mockCancel).toHaveBeenCalledTimes(1);
	});

	test('does nothing when unsupported', () => {
		removeSpeechSynthesis();
		cancelSpeech();
		expect(mockCancel).not.toHaveBeenCalled();
	});
});

// ── getLastSpoken ──
describe('getLastSpoken', () => {
	test('returns null before any speak', () => {
		expect(getLastSpoken()).toBeNull();
	});

	test('returns last spoken after speakEvent', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		speakEvent(makeEvent({ phase: 'DONE' }));
		const last = getLastSpoken();
		expect(last).not.toBeNull();
		expect(last!.text).toBe('Lauf erfolgreich abgeschlossen');
		expect(typeof last!.timestamp).toBe('number');
	});

	test('returns null when voice is disabled', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: false });
		speakEvent(makeEvent({ phase: 'DONE' }));
		expect(getLastSpoken()).toBeNull();
	});
});
