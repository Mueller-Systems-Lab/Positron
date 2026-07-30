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
		expect(screen.getByText('Voice Output')).toBeDefined();
		// Toggle should be OFF
		const toggle = screen.getByRole('switch', { name: 'Voice Output' });
		expect(toggle.getAttribute('aria-checked')).toBe('false');
	});

	test('toggle switches ON and OFF', () => {
		render(<VoiceControls />);
		const toggle = screen.getByRole('switch', { name: 'Voice Output' });

		// Click ON
		fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-checked')).toBe('true');

		// Click OFF
		fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-checked')).toBe('false');
	});

	test('shows browser supported status when TTS is available', () => {
		render(<VoiceControls />);
		expect(screen.getByText(/Browser TTS supported/)).toBeDefined();
	});

	test('shows unsupported state when speechSynthesis is missing', () => {
		setupSpeech(false);
		render(<VoiceControls />);
		expect(screen.getByText(/Browser TTS not supported/)).toBeDefined();
		expect(screen.getByText(/does not support the Web Speech API/)).toBeDefined();
	});

	test('test voice button calls speakTest', () => {
		render(<VoiceControls />);
		// Enable voice first
		fireEvent.click(screen.getByRole('switch', { name: 'Voice Output' }));
		// Click test button
		const testBtn = screen.getByRole('button', { name: 'Test voice output' });
		fireEvent.click(testBtn);
		expect(mockSpeak).toHaveBeenCalledTimes(1);
	});

	test('shows voice selection dropdown with available voices', () => {
		render(<VoiceControls />);
		const select = screen.getByLabelText('Voice') as HTMLSelectElement;
		expect(select).toBeDefined();
		expect(select.options.length).toBeGreaterThanOrEqual(1);
	});

	test('event checkboxes toggle event types', () => {
		render(<VoiceControls />);
		const runStarted = screen.getByLabelText('Run started') as HTMLInputElement;
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
		expect(screen.getByText(/Voice output is local browser TTS/)).toBeDefined();
		expect(screen.getByText(/No audio is sent to external services/)).toBeDefined();
	});

	test('controls are visible when voice is enabled', () => {
		render(<VoiceControls />);
		// Enable
		fireEvent.click(screen.getByRole('switch', { name: 'Voice Output' }));
		// Controls should be present
		expect(screen.getByLabelText('Voice')).toBeDefined();
		expect(screen.getByLabelText('Speech rate')).toBeDefined();
		expect(screen.getByLabelText('Speech volume')).toBeDefined();
	});
});

// ── VoiceStatusIndicator ──
describe('VoiceStatusIndicator', () => {
	test('renders OFF state by default', () => {
		render(<VoiceStatusIndicator />);
		expect(screen.getByText(/Voice OFF/)).toBeDefined();
	});

	test('has accessible label', () => {
		render(<VoiceStatusIndicator />);
		const btn = screen.getByRole('button');
		expect(btn.getAttribute('aria-label')).toContain('Voice output');
	});

	test('click toggles to ON', () => {
		render(<VoiceStatusIndicator />);
		fireEvent.click(screen.getByRole('button'));
		expect(screen.getByText(/Voice ON/)).toBeDefined();
	});

	test('shows unsupported state when no speechSynthesis', () => {
		setupSpeech(false);
		render(<VoiceStatusIndicator />);
		expect(screen.getByText(/No Voice/)).toBeDefined();
	});

	test('has title attribute with usage info', () => {
		render(<VoiceStatusIndicator />);
		const btn = screen.getByRole('button');
		expect(btn.getAttribute('title')).toContain('Voice alerts are local');
	});
});
