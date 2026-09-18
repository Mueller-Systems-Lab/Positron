// Voice Output Engine — Browser Text-to-Speech via window.speechSynthesis.
// Safety-first: standardmäßig OFF, Redaction vor jeder Ausgabe,
// Rate-Limit 1/3s, Deduplizierung, max 200 Zeichen.

import type { RunEvent } from '../types.js';
import { t } from '../i18n/index.js';
import { cleanForSpeech } from './redact-for-speech.js';
import type { VoiceEventType } from './voice-settings.js';
import { loadVoiceSettings } from './voice-settings.js';

// ── Rate Limiter (module-level state) ──
let lastSpeakTime = 0;
const MIN_SPEAK_INTERVAL_MS = 3000;

function rateLimitExceeded(): boolean {
	const now = Date.now();
	if (now - lastSpeakTime < MIN_SPEAK_INTERVAL_MS) return true;
	lastSpeakTime = now;
	return false;
}

// ── Deduplication (module-level state) ──
const DEDUPE_QUEUE_SIZE = 5;
const recentMessages: string[] = [];

function isDuplicate(text: string): boolean {
	if (recentMessages.includes(text)) return true;
	recentMessages.push(text);
	if (recentMessages.length > DEDUPE_QUEUE_SIZE) {
		recentMessages.shift();
	}
	return false;
}

// ── Last Spoken (module-level state) ──
let lastSpoken: { timestamp: number; text: string } | null = null;

// ── Public API ──

/** Prüft, ob Browser Text-to-Speech unterstützt wird. */
export function isSpeechSupported(): boolean {
	return (
		typeof window !== 'undefined' &&
		'speechSynthesis' in window &&
		typeof window.speechSynthesis !== 'undefined'
	);
}

/** Gibt verfügbare Stimmen zurück (leeres Array bei Unsupported). */
export function getAvailableVoices(): SpeechSynthesisVoice[] {
	if (!isSpeechSupported()) return [];
	return window.speechSynthesis.getVoices();
}

/**
 * Klassifiziert ein RunEvent in einen VoiceEventType oder null.
 * Nur Events mit klarer Operator-Relevanz werden klassifiziert.
 */
export function classifyEvent(event: RunEvent): VoiceEventType | null {
	const { phase, message } = event;

	switch (phase) {
		case 'QUEUED':
			return 'run_started';
		case 'DONE':
			return 'run_done';
		case 'FAILED':
		case 'FAILED_TRANSIENT':
			return 'phase_failed';
		case 'FAILED_BLOCKED':
			return 'run_blocked';
		case 'BLOCKED_MERGE':
		case 'BLOCKED_PUSH':
			return 'merge_blocked';
		case 'GATE_APPROVE':
		case 'GATE_REVISE':
			return 'human_action';
		default:
			// Fallback: message-basierte Klassifikation
			if (message && /\bkill[- ]?switch\b/i.test(message)) {
				return 'run_blocked';
			}
			if (message && /\bhuman\b.*\b(?:action|required|approval|decision)\b/i.test(message)) {
				return 'human_action';
			}
			return null;
	}
}

/**
 * Mapped einen VoiceEventType + RunEvent auf den gesprochenen Text.
 * Gibt null zurück wenn kein Mapping existiert.
 */
export function mapEventToSpeech(event: RunEvent, type: VoiceEventType): string {
	const runId = event.runId ? event.runId.slice(0, 8) : 'unknown';

	switch (type) {
		case 'run_started':
			return `${t('Run')} ${runId} ${t('started')}`;
		case 'run_done':
			return `${t('Run')} ${t('completed successfully')}`;
		case 'phase_failed':
			return `${t('Phase')} ${event.phase} ${t('failed')}`;
		case 'run_blocked': {
			const reason = event.message ? `: ${event.message}` : '';
			return `${t('Run blocked')}${reason}`;
		}
		case 'human_action':
			return t('Human action required');
		case 'merge_blocked':
			return `${t('Merge blocked')} durch Kill-Switch`;
	}
}

/**
 * Generiert sicheren Sprachtext aus einem RunEvent (Klassifikation + Mapping + Redaction).
 * Gibt null zurück wenn das Event nicht gesprochen werden soll.
 */
export function eventToSpeechText(event: RunEvent): string | null {
	const type = classifyEvent(event);
	if (!type) return null;

	const rawText = mapEventToSpeech(event, type);
	return cleanForSpeech(rawText);
}

/**
 * Führt Sprachausgabe für ein RunEvent aus.
 * Safety-Checks in Reihenfolge:
 * 1. Voice enabled?
 * 2. Browser supported?
 * 3. Event klassifizierbar?
 * 4. Event-Typ enabled?
 * 5. Rate-Limit?
 * 6. Dedupe?
 * → spricht via speechSynthesis
 */
export function speakEvent(event: RunEvent): void {
	// 1. Voice Output deaktiviert?
	const settings = loadVoiceSettings();
	if (!settings.enabled) return;

	// 2. Browser unterstützt TTS?
	if (!isSpeechSupported()) return;

	// 3. SpeechSynthesisUtterance constructor verfügbar? (jsdom/Node guard)
	if (typeof SpeechSynthesisUtterance === 'undefined') return;

	// 4. Event klassifizieren
	const type = classifyEvent(event);
	if (!type) return;

	// 5. Event-Typ in Settings enabled?
	if (!settings.enabledEventTypes.includes(type)) return;

	// 6. Rate-Limit
	if (rateLimitExceeded()) return;

	// 7. Text generieren + redacten
	const text = cleanForSpeech(mapEventToSpeech(event, type));

	// 8. Deduplizierung
	if (isDuplicate(text)) return;

	// 9. Sprachausgabe
	const utterance = new SpeechSynthesisUtterance(text);

	if (settings.selectedVoiceURI) {
		const voices = getAvailableVoices();
		const selected = voices.find((v) => v.voiceURI === settings.selectedVoiceURI);
		if (selected) utterance.voice = selected;
	}

	utterance.rate = clampRate(settings.rate);
	utterance.volume = clampVolume(settings.volume);

	window.speechSynthesis.speak(utterance);

	lastSpoken = { timestamp: Date.now(), text };
}

/** Spielt Test-Nachricht ab (unabhängig von enabled-Status). */
export function speakTest(): void {
	if (!isSpeechSupported()) return;
	if (typeof SpeechSynthesisUtterance === 'undefined') return;

	const settings = loadVoiceSettings();
	const utterance = new SpeechSynthesisUtterance('Positron voice output active');

	if (settings.selectedVoiceURI) {
		const voices = getAvailableVoices();
		const selected = voices.find((v) => v.voiceURI === settings.selectedVoiceURI);
		if (selected) utterance.voice = selected;
	}

	utterance.rate = clampRate(settings.rate);
	utterance.volume = clampVolume(settings.volume);

	window.speechSynthesis.speak(utterance);
}

/** Bricht alle aktiven/gequeueten Sprachausgaben ab. */
export function cancelSpeech(): void {
	if (!isSpeechSupported()) return;
	window.speechSynthesis.cancel();
}

/** Letzte gesprochene Nachricht (für UI-Statusanzeige). */
export function getLastSpoken(): { timestamp: number; text: string } | null {
	return lastSpoken;
}

/** Reset module-level state (nur für Tests). */
export function resetVoiceState(): void {
	lastSpeakTime = 0;
	recentMessages.length = 0;
	lastSpoken = null;
}

/** Reset nur Rate-Limiter (für Dedupe-Tests). */
export function resetRateLimitForTest(): void {
	lastSpeakTime = 0;
}

// ── Helpers ──

function clampRate(rate: number): number {
	return Math.max(0.5, Math.min(2.0, rate));
}

function clampVolume(volume: number): number {
	return Math.max(0, Math.min(1.0, volume));
}
