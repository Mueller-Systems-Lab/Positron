// Positron Control Plane — Delta-basierte Retry Policy
//
// Entfernt blindes `while iterations < MAX_ITERATIONS` als primäre
// Retry-Entscheidung. Ein Retry findet NUR statt, wenn:
//
//   attempt < max_attempts
//   UND failure_signature existiert
//   UND mindestens ein informationshaltiges Delta vorliegt
//
// Kein erneuter API-Verbrauch für identische Versuche.

import type { AttemptRecord } from './store.js';

export type RetryVerdict = 'ALLOWED' | 'DENIED';

export interface RetryDecision {
	verdict: RetryVerdict;
	reason_code:
		| 'RETRY_ALLOWED_WITH_DELTA'
		| 'RETRY_DENIED_ATTEMPT_LIMIT'
		| 'RETRY_DENIED_NO_FAILURE_SIGNATURE'
		| 'RETRY_DENIED_NO_STRATEGY_DELTA'
		| 'RETRY_DENIED_NO_PREVIOUS_ATTEMPT'
		| 'WORKER_REJECTED';
	/** Welche Informationen den Retry rechtfertigen (leer bei DENIED) */
	delta: string[];
}

export interface RetryContextInput {
	/** Aktuelle Attempt-Nummer (1-basiert) */
	attemptNumber: number;
	maxAttempts: number;
	/** Letzter fehlgeschlagener Attempt (Vergleichsbasis) */
	previousAttempt: AttemptRecord | null;
	/** Derzeitiger Input-Fingerprint (des geplanten neuen Versuchs) */
	inputFingerprint: string;
	/** Geplante Worker-Konfiguration */
	worker: { workerType: string; provider: string | null; model: string | null };
	/** Neue Evidenz aus der letzten Ausführung */
	newEvidence: string | null;
	/** Geplante Strategie-Änderung */
	strategyDelta: string | null;
	/** Kontext-Fingerprint (z. B. Plan- oder Workspace-Fingerprint) */
	contextFingerprint: string | null;
	/** P5.3: Effective Harness Fingerprint (Profiländerung zählt nur bei echtem Wechsel) */
	effectiveHarnessFingerprint?: string | null;
}

/**
 * Deterministische Retry-Entscheidung.
 *
 * @param deltaSources Explizit benannte Delta-Quellen (z. B. ["strategy_delta"])
 */
export function evaluateRetry(input: RetryContextInput): RetryDecision {
	// 1. Attempt-Limit
	if (input.attemptNumber >= input.maxAttempts) {
		return {
			verdict: 'DENIED',
			reason_code: 'RETRY_DENIED_ATTEMPT_LIMIT',
			delta: [],
		};
	}

	// 2. Kein vorheriger Attempt → nichts zum Vergleichen
	if (!input.previousAttempt) {
		return {
			verdict: 'DENIED',
			reason_code: 'RETRY_DENIED_NO_PREVIOUS_ATTEMPT',
			delta: [],
		};
	}

	// 3. Failure-Signatur muss existieren
	if (!input.previousAttempt.failure_signature) {
		return {
			verdict: 'DENIED',
			reason_code: 'RETRY_DENIED_NO_FAILURE_SIGNATURE',
			delta: [],
		};
	}

	// 4. Informationshaltiges Delta suchen
	const delta: string[] = [];

	if (input.newEvidence && input.newEvidence.trim().length > 0) {
		delta.push('new_evidence');
	}
	if (input.strategyDelta && input.strategyDelta.trim().length > 0) {
		delta.push('strategy_delta');
	}
	if (
		input.previousAttempt.provider &&
		input.worker.provider &&
		input.previousAttempt.provider !== input.worker.provider
	) {
		delta.push('provider_change');
	}
	if (
		input.previousAttempt.model &&
		input.worker.model &&
		input.previousAttempt.model !== input.worker.model
	) {
		delta.push('model_change');
	}
	if (
		input.previousAttempt.input_fingerprint &&
		input.previousAttempt.input_fingerprint !== input.inputFingerprint
	) {
		delta.push('input_change');
	}
	// P5.3: Profiländerung zählt nur bei echtem Effective-Harness-Wechsel
	if (
		input.effectiveHarnessFingerprint &&
		input.previousAttempt.effective_harness_fingerprint &&
		input.effectiveHarnessFingerprint !== input.previousAttempt.effective_harness_fingerprint
	) {
		delta.push('profile_change');
	}

	if (delta.length === 0) {
		return {
			verdict: 'DENIED',
			reason_code: 'RETRY_DENIED_NO_STRATEGY_DELTA',
			delta: [],
		};
	}

	return {
		verdict: 'ALLOWED',
		reason_code: 'RETRY_ALLOWED_WITH_DELTA',
		delta,
	};
}

/**
 * Prüft ob zwei Versuche als "identisch" gelten (Basis für die Canary):
 * gleicher Input-Fingerprint, gleiche Failure-Signatur, gleiches Modell,
 * gleicher Provider, kein Strategie-Delta, keine neue Evidenz.
 */
export function isIdenticalAttempt(
	previous: AttemptRecord,
	input: Omit<RetryContextInput, 'previousAttempt'>,
): boolean {
	return (
		previous.input_fingerprint === input.inputFingerprint &&
		previous.failure_signature !== null &&
		previous.model === input.worker.model &&
		previous.provider === input.worker.provider &&
		!input.newEvidence &&
		!input.strategyDelta
	);
}
