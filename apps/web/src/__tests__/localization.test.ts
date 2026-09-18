import { describe, expect, test } from 'vitest';
import { DEFAULT_LOCALE, UI_LANGUAGE, formatDate, formatNumber, statusLabel, t } from '../i18n/index.js';

describe('German product localization contract', () => {
	test('German is the default UI locale', () => {
		expect(DEFAULT_LOCALE).toBe('de-DE');
		expect(UI_LANGUAGE).toBe('German');
		expect(t('Dashboard')).toBe('Dashboard');
		expect(t('Settings')).toBe('Einstellungen');
		expect(t('New Run')).toBe('Neuer Lauf');
	});

	test('machine status values stay unchanged at the presentation boundary', () => {
		expect(statusLabel('COMPLETED')).toBe('Abgeschlossen');
		expect(statusLabel('FAILED')).toBe('Fehlgeschlagen');
		expect(statusLabel('RUNNING')).toBe('Wird ausgeführt');
		expect(t('COMPLETED')).toBe('COMPLETED');
		expect(t('RUNNING')).toBe('RUNNING');
	});

	test('user-visible formatting uses German conventions', () => {
		expect(formatDate('2026-09-18T12:34:00.000Z')).toMatch(/18\.09\.2026/);
		expect(formatNumber(1234567.89)).toBe('1.234.567,89');
	});

	test('required empty, loading, error and action messages are localized', () => {
		expect(t('Loading')).toContain('geladen');
		expect(t('No results')).toBe('Keine Ergebnisse');
		expect(t('Error')).toBe('Fehler');
		expect(t('Retry')).toBe('Erneut versuchen');
		expect(t('Cancel')).toBe('Abbrechen');
	});
});
