import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import VoiceControls from '../components/VoiceControls';
import VoiceStatusIndicator from '../components/VoiceStatusIndicator';

// ── Mocks ──
const mockSpeak = vi.fn();
const mockCancel = vi.fn();
const mockVoices: SpeechSynthesisVoice[] = [
	{ voiceURI: 'v1', name: 'Alex', lang: 'en-US', default: true, localService: true },
	{ voiceURI: 'v2', name: 'Samantha', lang: 'en-GB', default: false, localService: true },
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

beforeEach(() => {
	mockSpeak.mockClear();
	mockCancel.mockClear();
	for (const k of Object.keys(store)) delete store[k];
	setupStorage();
	setupSpeech(true);
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ── VoiceControls ──
describe('VoiceControls', () => {
	test('renders with default OFF state', () => {
		render(<VoiceControls />);
		expect(screen.getByText('Sprachausgabe')).toBeDefined();
		// Toggle should be OFF
		const toggle = screen.getByRole('switch', { name: 'Sprachausgabe' });
		expect(toggle.getAttribute('aria-checked')).toBe('false');
	});

	test('toggle switches ON and OFF', () => {
		render(<VoiceControls />);
		const toggle = screen.getByRole('switch', { name: 'Sprachausgabe' });

		// Click ON
		fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-checked')).toBe('true');

		// Click OFF
		fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-checked')).toBe('false');
	});

	test('shows browser supported status when TTS is available', () => {
		render(<VoiceControls />);
		expect(screen.getByText(/Browser-TTS unterstützt/)).toBeDefined();
	});

	test('shows unsupported state when speechSynthesis is missing', () => {
		setupSpeech(false);
		render(<VoiceControls />);
		expect(screen.getByText(/Browser-TTS nicht unterstützt/)).toBeDefined();
		expect(screen.getByText(/unterstützt die Web-Speech-API nicht/)).toBeDefined();
	});

	test('test voice button calls speakTest', () => {
		render(<VoiceControls />);
		// Enable voice first
		fireEvent.click(screen.getByRole('switch', { name: 'Sprachausgabe' }));
		// Click test button
		const testBtn = screen.getByRole('button', { name: 'Sprachausgabe testen' });
		fireEvent.click(testBtn);
		expect(mockSpeak).toHaveBeenCalledTimes(1);
	});

	test('shows voice selection dropdown with available voices', () => {
		render(<VoiceControls />);
		const select = screen.getByLabelText('Stimme') as HTMLSelectElement;
		expect(select).toBeDefined();
		expect(select.options.length).toBeGreaterThanOrEqual(1);
	});

	test('event checkboxes toggle event types', () => {
		render(<VoiceControls />);
		const runStarted = screen.getByLabelText('Lauf gestartet') as HTMLInputElement;
		expect(runStarted.checked).toBe(true);

		fireEvent.click(runStarted);
		expect(runStarted.checked).toBe(false);
	});

	test('does not crash with invalid localStorage data', () => {
		store['positron-voice-settings'] = '{broken json!!!';
		expect(() => render(<VoiceControls />)).not.toThrow();
	});

	test('shows privacy notice about local browser TTS', () => {
		render(<VoiceControls />);
		expect(screen.getByText(/Sprachausgabe verwendet lokale Browser-TTS/)).toBeDefined();
		expect(screen.getByText(/kein Audio an externe Dienste/)).toBeDefined();
	});

	test('controls are visible when voice is enabled', () => {
		render(<VoiceControls />);
		// Enable
		fireEvent.click(screen.getByRole('switch', { name: 'Sprachausgabe' }));
		// Controls should be present
		expect(screen.getByLabelText('Stimme')).toBeDefined();
		expect(screen.getByLabelText('Sprechgeschwindigkeit')).toBeDefined();
		expect(screen.getByLabelText('Sprachlautstärke')).toBeDefined();
	});
});

// ── VoiceStatusIndicator ──
describe('VoiceStatusIndicator', () => {
	test('renders OFF state by default', () => {
		render(<VoiceStatusIndicator />);
		expect(screen.getByText(/Stimme AUS/)).toBeDefined();
	});

	test('has accessible label', () => {
		render(<VoiceStatusIndicator />);
		const btn = screen.getByRole('button');
		expect(btn.getAttribute('aria-label')).toContain('Sprachausgabe');
	});

	test('click toggles to ON', () => {
		render(<VoiceStatusIndicator />);
		fireEvent.click(screen.getByRole('button'));
		expect(screen.getByText(/Stimme EIN/)).toBeDefined();
	});

	test('shows unsupported state when no speechSynthesis', () => {
		setupSpeech(false);
		render(<VoiceStatusIndicator />);
		expect(screen.getByText(/Keine Sprachausgabe/)).toBeDefined();
	});

	test('has title attribute with usage info', () => {
		render(<VoiceStatusIndicator />);
		const btn = screen.getByRole('button');
		expect(btn.getAttribute('title')).toContain('Sprachhinweise sind lokal');
	});
});
