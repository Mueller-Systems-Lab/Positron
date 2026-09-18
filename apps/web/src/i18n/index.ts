import { DEFAULT_LOCALE, UI_LANGUAGE, messages, type TranslationKey } from './de-DE.js';

export { DEFAULT_LOCALE, UI_LANGUAGE, messages };

/** Translate a product-owned UI message. External content must not pass here. */
export function t(key: TranslationKey | string): string {
	return messages[key as TranslationKey] ?? key;
}

const STATUS_LABELS: Record<string, string> = {
	active: 'Aktiv',
	done: 'Abgeschlossen',
	completed: 'Abgeschlossen',
	succeeded: 'Erfolgreich',
	failed: 'Fehlgeschlagen',
	blocked: 'Blockiert',
	cancelled: 'Abgebrochen',
	pending: 'Ausstehend',
	running: 'Wird ausgeführt',
	queued: 'In Warteschlange',
	waiting: 'Wartet',
	unknown: 'Unbekannt',
	current: 'Aktuell',
	human: 'Menschlich',
};

/** Presentation mapping; the machine value itself is never changed. */
export function statusLabel(value: string | null | undefined): string {
	if (!value) return t('Unknown error');
	return STATUS_LABELS[value.toLowerCase()] ?? value;
}

const PHASE_LABELS: Record<string, string> = {
	all: 'Alle Phasen',
	ingest: 'Aufnahme',
	specify: 'Spezifikation',
	plan: 'Planung',
	tasks: 'Aufgaben',
	implement: 'Implementierung',
	review: 'Prüfung',
	fix: 'Korrektur',
	done: 'Abgeschlossen',
	failed: 'Fehlgeschlagen',
	cancelled: 'Abgebrochen',
};

export function phaseLabel(value: string | null | undefined): string {
	if (!value) return '—';
	return PHASE_LABELS[value.toLowerCase()] ?? value;
}

export function formatDate(value: string | number | Date): string {
	return new Intl.DateTimeFormat(DEFAULT_LOCALE, { dateStyle: 'medium' }).format(new Date(value));
}

export function formatDateTime(value: string | number | Date): string {
	return new Intl.DateTimeFormat(DEFAULT_LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(
		new Date(value),
	);
}

export function formatNumber(value: number): string {
	return new Intl.NumberFormat(DEFAULT_LOCALE).format(value);
}

export function userError(error: unknown, fallback = 'Unexpected error'): string {
	if (error instanceof Error && error.message.trim()) return error.message;
	return t(fallback);
}
