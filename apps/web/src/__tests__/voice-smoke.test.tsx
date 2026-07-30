import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import VoiceControls from '../components/VoiceControls';
import VoiceStatusIndicator from '../components/VoiceStatusIndicator';
import type { LogLevel, Phase, RunEvent } from '../types';
import {
	getLastSpoken,
	resetRateLimitForTest,
	resetVoiceState,
	speakEvent,
	speakTest,
} from '../voice/voice-output';
import { DEFAULT_VOICE_SETTINGS, saveVoiceSettings } from '../voice/voice-settings';

// ── Mocks ──
const mockSpeak = vi.fn();
const mockCancel = vi.fn();
const mockVoices: SpeechSynthesisVoice[] = [
	{ voiceURI: 'v1', name: 'Alex', lang: 'en-US', default: true, localService: true },
] as unknown as SpeechSynthesisVoice[];

function setupSpeech(enabled = true): void {
	if (enabled) {
		vi.stubGlobal(
			'SpeechSynthesisUtterance',
			class {
				text = '';
				voice: SpeechSynthesisVoice | null = null;
				rate = 1;
				volume = 1;
				constructor(t: string) {
					this.text = t;
				}
			},
		);
		vi.stubGlobal('speechSynthesis', {
			speak: mockSpeak,
			cancel: mockCancel,
			getVoices: vi.fn(() => mockVoices),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		});
	} else {
		vi.stubGlobal('speechSynthesis', undefined);
		vi.stubGlobal('SpeechSynthesisUtterance', undefined);
	}
}

const store: Record<string, string> = {};

function setupStorage(): void {
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
	});
}

function makeEvent(overrides: Partial<RunEvent> = {}): RunEvent {
	return {
		id: 'evt-1',
		runId: 'abc12345def67890',
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
	for (const k of Object.keys(store)) delete store[k];
	setupStorage();
	setupSpeech(true);
	saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: false });
	resetVoiceState();
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════
// 1. SETTINGS SMOKE — VoiceControls in context
// ══════════════════════════════════════════════════════════
describe('Settings Smoke — VoiceControls Integration', () => {
	test('VoiceControls renders with Voice Output heading', () => {
		render(<VoiceControls />);
		expect(screen.getByText('Voice Output')).toBeDefined();
	});

	test('Voice default OFF in settings context', () => {
		render(<VoiceControls />);
		const toggle = screen.getByRole('switch', { name: 'Voice Output' });
		expect(toggle.getAttribute('aria-checked')).toBe('false');
	});

	test('Toggle ON saves state and updates UI', () => {
		render(<VoiceControls />);
		const toggle = screen.getByRole('switch', { name: 'Voice Output' });
		fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-checked')).toBe('true');
	});

	test('Privacy notice visible', () => {
		render(<VoiceControls />);
		expect(screen.getByText(/Voice output is local browser TTS/)).toBeDefined();
		expect(screen.getByText(/No audio is sent to external services/)).toBeDefined();
	});

	test('Browser support status visible when TTS is available', () => {
		render(<VoiceControls />);
		expect(screen.getByText(/Browser TTS supported/)).toBeDefined();
	});

	test('Unsupported browser shows warning', () => {
		setupSpeech(false);
		render(<VoiceControls />);
		expect(screen.getByText(/Browser TTS not supported/)).toBeDefined();
		expect(screen.getByText(/does not support the Web Speech API/)).toBeDefined();
	});

	test('Voice selection dropdown populates with voices', () => {
		render(<VoiceControls />);
		const select = screen.getByLabelText('Voice') as HTMLSelectElement;
		expect(select).toBeDefined();
		expect(select.options.length).toBeGreaterThanOrEqual(1);
	});

	test('Test Voice button invokes speechSynthesis', () => {
		render(<VoiceControls />);
		fireEvent.click(screen.getByRole('switch', { name: 'Voice Output' }));
		fireEvent.click(screen.getByRole('button', { name: 'Test voice output' }));
		expect(mockSpeak).toHaveBeenCalledTimes(1);
	});

	test('Event checkboxes render all 6 types', () => {
		render(<VoiceControls />);
		expect(screen.getByLabelText('Run started')).toBeDefined();
		expect(screen.getByLabelText('Phase failed')).toBeDefined();
		expect(screen.getByLabelText('Run blocked')).toBeDefined();
		expect(screen.getByLabelText('Human action required')).toBeDefined();
		expect(screen.getByLabelText('Merge blocked')).toBeDefined();
		expect(screen.getByLabelText('Run done')).toBeDefined();
	});

	test('Invalid localStorage data does not crash VoiceControls', () => {
		store['positron-voice-settings'] = '{{{{broken json';
		expect(() => render(<VoiceControls />)).not.toThrow();
	});
});

// ══════════════════════════════════════════════════════════
// 2. DASHBOARD SMOKE — VoiceStatusIndicator
// ══════════════════════════════════════════════════════════
describe('Dashboard Smoke — VoiceStatusIndicator', () => {
	test('VoiceStatusIndicator renders OFF state', () => {
		render(<VoiceStatusIndicator />);
		expect(screen.getByText(/Voice OFF/)).toBeDefined();
	});

	test('VoiceStatusIndicator toggles to ON on click', () => {
		render(<VoiceStatusIndicator />);
		fireEvent.click(screen.getByRole('button'));
		expect(screen.getByText(/Voice ON/)).toBeDefined();
	});

	test('VoiceStatusIndicator toggles back to OFF', () => {
		render(<VoiceStatusIndicator />);
		const btn = screen.getByRole('button');
		fireEvent.click(btn); // ON
		fireEvent.click(btn); // OFF
		expect(screen.getByText(/Voice OFF/)).toBeDefined();
	});

	test('VoiceStatusIndicator shows unsupported when no TTS', () => {
		setupSpeech(false);
		render(<VoiceStatusIndicator />);
		expect(screen.getByText(/No Voice/)).toBeDefined();
	});

	test('VoiceStatusIndicator has accessible aria-label', () => {
		render(<VoiceStatusIndicator />);
		expect(screen.getByRole('button').getAttribute('aria-label')).toContain('Voice output');
	});

	test('VoiceStatusIndicator has title with privacy note', () => {
		render(<VoiceStatusIndicator />);
		expect(screen.getByRole('button').getAttribute('title')).toContain('Voice alerts are local');
	});
});

// ══════════════════════════════════════════════════════════
// 3. BROWSER TTS MOCK — Full Pipeline
// ══════════════════════════════════════════════════════════
describe('Browser TTS Mock — Full Pipeline', () => {
	test('speakTest calls speechSynthesis.speak() with correct text', () => {
		speakTest();
		expect(mockSpeak).toHaveBeenCalledTimes(1);
		expect(mockSpeak.mock.calls[0][0].text).toBe('Positron voice output active');
	});

	test('speakEvent does NOT call speak when voice is disabled', () => {
		speakEvent(makeEvent({ phase: 'DONE' }));
		expect(mockSpeak).not.toHaveBeenCalled();
	});

	test('speakEvent calls speak when voice is enabled and event is relevant', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		speakEvent(makeEvent({ phase: 'DONE' }));
		expect(mockSpeak).toHaveBeenCalledTimes(1);
	});

	test('no exception when SpeechSynthesisUtterance constructor is missing', () => {
		vi.stubGlobal('SpeechSynthesisUtterance', undefined);
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		expect(() => speakEvent(makeEvent({ phase: 'DONE' }))).not.toThrow();
		expect(mockSpeak).not.toHaveBeenCalled();
	});

	test('unsupported browser (no speechSynthesis) does not crash speakEvent', () => {
		setupSpeech(false);
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		expect(() => speakEvent(makeEvent({ phase: 'DONE' }))).not.toThrow();
	});

	test('unsupported browser does not crash speakTest', () => {
		setupSpeech(false);
		expect(() => speakTest()).not.toThrow();
	});
});

// ══════════════════════════════════════════════════════════
// 4. SSE / RUNEVENT REGRESSION
// ══════════════════════════════════════════════════════════
describe('SSE / RunEvent Regression', () => {
	test('relevant event (DONE) triggers correct speech text', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		speakEvent(makeEvent({ phase: 'DONE' }));
		expect(mockSpeak.mock.calls[0][0].text).toBe('Run completed successfully');
	});

	test('relevant event (QUEUED) triggers run_started speech', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		speakEvent(makeEvent({ phase: 'QUEUED' }));
		expect(mockSpeak).toHaveBeenCalledTimes(1);
		expect(mockSpeak.mock.calls[0][0].text).toContain('Run abc12345');
		expect(mockSpeak.mock.calls[0][0].text).toContain('started');
	});

	test('irrelevant event (IMPLEMENT) does not trigger voice', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		speakEvent(makeEvent({ phase: 'IMPLEMENT' }));
		expect(mockSpeak).not.toHaveBeenCalled();
	});

	test('event with GitHub token is redacted before speaking', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		speakEvent(
			makeEvent({
				phase: 'FAILED_BLOCKED',
				message: 'Error: GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890',
			}),
		);
		expect(mockSpeak).toHaveBeenCalledTimes(1);
		const text = mockSpeak.mock.calls[0][0].text;
		expect(text).not.toContain('ghp_');
		expect(text).toContain('[TOKEN]');
	});

	test('event with AWS key is redacted', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		speakEvent(
			makeEvent({
				phase: 'FAILED_BLOCKED',
				message: 'Key AKIA1234567890ABCDEF leaked in log',
			}),
		);
		expect(mockSpeak).toHaveBeenCalledTimes(1);
		const text = mockSpeak.mock.calls[0][0].text;
		expect(text).not.toContain('AKIA');
		expect(text).toContain('[TOKEN]');
	});

	test('long message is truncated to 200 chars', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		speakEvent(makeEvent({ phase: 'FAILED_BLOCKED', message: 'X'.repeat(500) }));
		expect(mockSpeak).toHaveBeenCalledTimes(1);
		expect(mockSpeak.mock.calls[0][0].text.length).toBeLessThanOrEqual(200);
	});

	test('duplicate message is blocked by dedupe', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		speakEvent(makeEvent({ phase: 'DONE' }));
		expect(mockSpeak).toHaveBeenCalledTimes(1);

		resetRateLimitForTest();
		speakEvent(makeEvent({ phase: 'DONE' }));
		expect(mockSpeak).toHaveBeenCalledTimes(1); // deduped
	});

	test('rate limit blocks rapid-fire events', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		speakEvent(makeEvent({ phase: 'DONE', id: '1' }));
		speakEvent(makeEvent({ phase: 'DONE', id: '2' }));
		speakEvent(makeEvent({ phase: 'DONE', id: '3' }));
		expect(mockSpeak).toHaveBeenCalledTimes(1);
	});

	test('getLastSpoken returns correct info after speak', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		speakEvent(makeEvent({ phase: 'DONE' }));
		const last = getLastSpoken();
		expect(last).not.toBeNull();
		expect(last!.text).toBe('Run completed successfully');
		expect(typeof last!.timestamp).toBe('number');
	});

	test('all speakable phases trigger speech, silent phases do not', () => {
		const speakable: Phase[] = [
			'QUEUED',
			'DONE',
			'FAILED',
			'FAILED_TRANSIENT',
			'FAILED_BLOCKED',
			'BLOCKED_MERGE',
			'BLOCKED_PUSH',
			'GATE_APPROVE',
			'GATE_REVISE',
		];
		let callCount = 0;
		for (const phase of speakable) {
			resetVoiceState();
			saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
			resetRateLimitForTest();
			speakEvent(makeEvent({ phase, id: `evt-${phase}` }));
			callCount++;
		}
		expect(mockSpeak).toHaveBeenCalledTimes(callCount);

		mockSpeak.mockClear();
		const silent: Phase[] = ['IMPLEMENT', 'REVIEW', 'TEST', 'VERIFY', 'COMMIT', 'CLEANUP'];
		for (const phase of silent) {
			resetVoiceState();
			saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
			speakEvent(makeEvent({ phase, id: `evt-${phase}` }));
		}
		expect(mockSpeak).not.toHaveBeenCalled();
	});

	test('kill-switch message triggers run_blocked from non-speakable phase', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		speakEvent(makeEvent({ phase: 'IMPLEMENT', message: 'kill-switch activated' }));
		expect(mockSpeak).toHaveBeenCalledTimes(1);
		expect(mockSpeak.mock.calls[0][0].text).toContain('Run blocked');
	});

	test('human action message triggers from non-speakable phase', () => {
		saveVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, enabled: true });
		speakEvent(makeEvent({ phase: 'IMPLEMENT', message: 'Human approval required for merge' }));
		expect(mockSpeak).toHaveBeenCalledTimes(1);
		expect(mockSpeak.mock.calls[0][0].text).toBe('Human action required');
	});
});
