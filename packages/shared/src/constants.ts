// Positron — Konstanten

import type { Phase, PositronLabel } from './types.js';

/** Alle vordefinierten Positron-Label */
export const POSITRON_LABELS: readonly PositronLabel[] = [
	'positron:ready',
	'positron:running',
	'positron:research',
	'positron:repo-sync',
	'positron:planning',
	'positron:implementing',
	'positron:testing',
	'positron:blocked',
	'positron:failed',
	'positron:pr-created',
	'positron:merged',
	'positron:done',
] as const;

/** Prefix für alle Positron-Label */
export const POSITRON_LABEL_PREFIX = 'positron:' as const;

/** Maximale Anzahl von Fix-Loop-Versuchen */
export const MAX_FIX_LOOPS = 3;

/** Maximale Diff-Größe in Zeilen */
export const MAX_DIFF_SIZE = 400;

/** Standard-Polling-Intervall in ms */
export const POLLING_INTERVAL_MS = 60_000;

/** Maximales Polling-Intervall in ms */
export const MAX_POLLING_INTERVAL_MS = 180_000;

/** Timeout für CLI-Kommandos in ms */
export const CLI_TIMEOUT_MS = 120_000;

/** Maximale Retry-Versuche für CLI-Kommandos */
export const CLI_MAX_RETRIES = 2;

/** Aktuelle Positron-Version */
export const POSITRON_VERSION = '0.2.0';

/** Prefix für Positron-Branches */
export const BRANCH_PREFIX = 'positron/issue' as const;

/** Maximale Länge des Branch-Slugs */
export const MAX_BRANCH_SLUG_LENGTH = 50;

/** Reihenfolge der Phasen (für Fortschrittsberechnung) */
export const PHASE_ORDER: readonly Phase[] = [
	'QUEUED',
	'CLAIMED',
	'REPO_SYNC',
	'ISSUE_CONTEXT',
	'WEB_RESEARCH',
	'SPECIFY',
	'CLARIFY_OPTIONAL',
	'PLAN',
	'TASKS',
	'ANALYZE',
	'REVIEW',
	'IMPLEMENT',
	'TEST',
	'VERIFY',
	'COMMIT',
	'PR_CREATE',
	'MERGE',
	'DONE',
	'FAILED',
	'FAILED_TRANSIENT',
	'FAILED_BLOCKED',
	'FAILED_UNSAFE',
	'BLOCKED_PUSH',
	'BLOCKED_MERGE',
	'GATE_APPROVE',
	'GATE_REVISE',
	'RESUME_PENDING',
	'CLEANUP',
] as const;

/** Terminale Phasen (abgeschlossen, keine weiteren Übergänge) */
export const TERMINAL_PHASES: readonly Phase[] = [
	'DONE',
	'FAILED',
	'FAILED_BLOCKED',
	'FAILED_UNSAFE',
	'CLEANUP',
] as const;

/** Blockierte/wartende Phasen */
export const BLOCKED_PHASES: readonly Phase[] = [
	'BLOCKED_PUSH',
	'BLOCKED_MERGE',
	'GATE_APPROVE',
	'GATE_REVISE',
	'RESUME_PENDING',
] as const;

/** Autonomie-Level-Konstanten */
export const AUTONOMY_LEVELS = {
	FULL: 0 as const,
	SEMI: 1 as const,
	MANUAL: 2 as const,
} as const;
