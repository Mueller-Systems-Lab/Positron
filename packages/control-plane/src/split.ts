// Positron Control Plane — Split Policy
//
// Wenn eine Aufgabe nicht sinnvoll weiterbearbeitet werden kann: SPLIT statt
// blind weiterzuprobieren. Grenzen verhindern rekursive Task-Explosion.

import { validateContract } from './contracts.js';
import type { SplitContract } from './contracts.js';

export interface SplitLimits {
	max_split_depth: number;
	max_subtasks: number;
}

export const DEFAULT_SPLIT_LIMITS: SplitLimits = {
	max_split_depth: 3,
	max_subtasks: 5,
};

export type SplitVerdict = 'SPLIT_ALLOWED' | 'SPLIT_DENIED';

export interface SplitDecision {
	verdict: SplitVerdict;
	reason_code:
		| 'SPLIT_ALLOWED'
		| 'SPLIT_DENIED_MAX_DEPTH'
		| 'SPLIT_DENIED_MAX_SUBTASKS'
		| 'SPLIT_DENIED_NO_SUBTASKS'
		| 'SPLIT_DENIED_SCHEMA_INVALID';
	errors: string[];
}

/**
 * Deterministische Split-Entscheidung mit Limits:
 * - max_split_depth: maximale Rekursionstiefe
 * - max_subtasks: maximale Anzahl Subtasks pro Split
 * - Subtasks müssen eigene Acceptance Criteria haben
 */
export function evaluateSplit(
	doc: unknown,
	limits: SplitLimits = DEFAULT_SPLIT_LIMITS,
	parentDepth: number = 0,
): SplitDecision {
	if (parentDepth >= limits.max_split_depth) {
		return {
			verdict: 'SPLIT_DENIED',
			reason_code: 'SPLIT_DENIED_MAX_DEPTH',
			errors: [`split depth ${parentDepth} exceeds max_split_depth ${limits.max_split_depth}`],
		};
	}

	// Leere Subtasks sind eine strukturelle Verletzung — vor der Schema-Prüfung
	// erkennen, damit die Policy einen eindeutigen Reason Code liefert.
	if (
		typeof doc === 'object' &&
		doc !== null &&
		!Array.isArray(doc) &&
		'contract' in doc &&
		(doc as Record<string, unknown>)['contract'] === 'positron.split.v1' &&
		Array.isArray((doc as Record<string, unknown>)['subtasks']) &&
		((doc as Record<string, unknown>)['subtasks'] as unknown[]).length === 0
	) {
		return {
			verdict: 'SPLIT_DENIED',
			reason_code: 'SPLIT_DENIED_NO_SUBTASKS',
			errors: ['split must contain at least one subtask'],
		};
	}

	const schemaResult = validateContract('positron.split.v1', doc);
	if (!schemaResult.ok) {
		return {
			verdict: 'SPLIT_DENIED',
			reason_code: 'SPLIT_DENIED_SCHEMA_INVALID',
			errors: schemaResult.errors,
		};
	}

	const split = doc as SplitContract;
	if (split.subtasks.length > limits.max_subtasks) {
		return {
			verdict: 'SPLIT_DENIED',
			reason_code: 'SPLIT_DENIED_MAX_SUBTASKS',
			errors: [
				`split has ${split.subtasks.length} subtasks, exceeding max_subtasks ${limits.max_subtasks}`,
			],
		};
	}

	return { verdict: 'SPLIT_ALLOWED', reason_code: 'SPLIT_ALLOWED', errors: [] };
}
