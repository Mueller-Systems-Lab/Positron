// Positron Web — Mission Control Formatting & Display Safety
//
// Reine Anzeige-Helfer. Es wird NICHTS erfunden oder rekonstruiert:
// alle Werte kommen aus der Backend-Truth-API. Diese Funktionen kürzen
// und bereinigen nur für die Darstellung.
//
// Display-Sicherheit (Privacy by Default):
// - output_json / raw payloads werden in der UI niemals gerendert
// - Freitext (failure_signature, new_evidence, strategy_delta) wird
//   auf verdächtige Secret-Muster gescannt und gekürzt

const SECRET_PATTERNS: RegExp[] = [
	/\b(bearer|authorization)\s+[a-z0-9._\-+/=]{8,}/i,
	/\b(api[_-]?key|apikey)\s*[:=]\s*[a-z0-9._\-]{8,}/i,
	/\b(token|secret)\s*[:=]\s*[a-z0-9._\-+/=]{8,}/i,
	/\.env\b/i,
	/(ghp|gho|github_pat)_[a-z0-9]{20,}/i,
	/sk-[a-z0-9]{20,}/i,
	/xox[baprs]-[a-z0-9-]{10,}/i,
	/(?<=password\s*[:=]\s*)[^\s,;]+/i,
];

const REDACTED = '[redacted]';

/** Ersetzt verdächtige Secret-Muster durch [redacted] und kürzt. */
export function sanitizeDisplayText(text: string | null | undefined, maxLength = 160): string {
	if (!text) return '';
	let cleaned = String(text);
	for (const pattern of SECRET_PATTERNS) {
		cleaned = cleaned.replace(pattern, REDACTED);
	}
	if (cleaned.length > maxLength) {
		cleaned = `${cleaned.slice(0, maxLength)}…`;
	}
	return cleaned;
}

/** Kurze Fingerprint-Darstellung: 8 Zeichen + … (voll in tooltip). */
export function shortHash(hash: string | null | undefined): string {
	if (!hash) return '—';
	if (hash.length <= 12) return hash;
	return `${hash.slice(0, 8)}…`;
}

export function formatDurationMs(ms: number | null | undefined): string {
	if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${seconds % 60}s`;
}

export function formatTimestamp(iso: string | null | undefined): string {
	if (!iso) return '—';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '—';
	return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Status → Farbe (Tailwind-Klassen), konsistent zur bestehenden UI. */
export function statusColorClass(status: string | null | undefined): string {
	switch (status) {
		case 'succeeded':
		case 'SUCCEEDED':
		case 'done':
		case 'DONE':
		case 'passed':
			return 'text-green-400';
		case 'failed':
		case 'FAILED':
		case 'blocked':
		case 'BLOCKED':
			return 'text-red-400';
		case 'running':
		case 'active':
			return 'text-blue-400';
		case 'denied':
			return 'text-amber-400';
		default:
			return 'text-slate-400';
	}
}

/** Status → Badge-Klassen für kleine Status-Pills. */
export function statusBadgeClass(status: string | null | undefined): string {
	const base = 'text-[10px] font-bold px-2 py-0.5 rounded-full';
	switch (status) {
		case 'succeeded':
		case 'SUCCEEDED':
		case 'done':
		case 'DONE':
		case 'passed':
			return `${base} bg-green-600/20 text-green-400`;
		case 'failed':
		case 'FAILED':
			return `${base} bg-red-600/20 text-red-400`;
		case 'blocked':
		case 'BLOCKED':
			return `${base} bg-red-900/40 text-red-300`;
		case 'running':
		case 'active':
			return `${base} bg-blue-600/20 text-blue-400`;
		case 'denied':
			return `${base} bg-amber-600/20 text-amber-400`;
		default:
			return `${base} bg-slate-600/20 text-slate-400`;
	}
}
