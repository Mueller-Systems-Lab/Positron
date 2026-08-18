// Positron Control Plane — Execution Context Enforcement
//
// P3-Invariante: NO ATTEMPT → NO PRODUCTIVE WORKER EXECUTION.
//
// Jede produktive autonome Worker-Ausführung (build/verify/research/review/
// plan/baseline) benötigt zwingend einen aktiven Control-Plane-Kontext:
//
//   ControlPlaneExecutionContext { run_id, job_id, attempt_id }
//
// `assertExecutionContext` ist die technisch erzwingbare Runtime-Assertion
// (kein rein dokumentarischer Konvention). Worker-Adapter für produktive
// autonome Ausführung rufen sie vor dem eigentlichen Aufruf auf; ein
// fehlender/leerer Kontext ergibt EXECUTION_CONTEXT_REQUIRED.
//
// `assertAttemptActive` prüft zusätzlich, dass der Attempt tatsächlich
// geclaimt (running) ist — ein Provider-/OpenCode-Aufruf darf nicht
// außerhalb eines aktiven Attempts stattfinden (§17/§18).

import type Database from 'better-sqlite3';
import { getAttempt } from './store.js';

export interface ControlPlaneExecutionContext {
	run_id: string;
	job_id: string;
	attempt_id: string;
}

/** Kanonischer Fehlercode für fehlenden Execution Context (Audit-Canary). */
export const EXECUTION_CONTEXT_REQUIRED = 'EXECUTION_CONTEXT_REQUIRED';

export class ExecutionContextRequiredError extends Error {
	readonly code = EXECUTION_CONTEXT_REQUIRED;
	constructor(detail?: string) {
		super(
			detail
				? `${EXECUTION_CONTEXT_REQUIRED}: ${detail}`
				: `${EXECUTION_CONTEXT_REQUIRED}: worker execution outside a durable run/job/attempt`,
		);
		this.name = 'ExecutionContextRequiredError';
	}
}

/**
 * Erzwingt einen vollständigen Control-Plane-Execution-Context.
 * Wirft `ExecutionContextRequiredError` (EXECUTION_CONTEXT_REQUIRED), wenn
 * run_id/job_id/attempt_id fehlen oder leer sind.
 */
export function assertExecutionContext(
	ctx: ControlPlaneExecutionContext | undefined | null,
): asserts ctx is ControlPlaneExecutionContext {
	if (!ctx || !ctx.run_id || !ctx.job_id || !ctx.attempt_id) {
		throw new ExecutionContextRequiredError();
	}
	if (
		typeof ctx.run_id !== 'string' ||
		typeof ctx.job_id !== 'string' ||
		typeof ctx.attempt_id !== 'string'
	) {
		throw new ExecutionContextRequiredError('non-string context fields');
	}
}

/**
 * Prüft, ob ein Attempt aktiv (geclaimt, running) ist.
 * Wirft `ExecutionContextRequiredError` mit der Attempt-ID, wenn der Attempt
 * fehlt oder nicht in 'running' steht (z. B. bereits finalisiert — Late
 * Execution nach Timeout/Cancellation wird damit verhindert).
 */
export function assertAttemptActive(db: Database.Database, attemptId: string): void {
	const attempt = getAttempt(db, attemptId);
	if (!attempt) {
		throw new ExecutionContextRequiredError(`attempt ${attemptId} not found`);
	}
	if (attempt.status !== 'running') {
		throw new ExecutionContextRequiredError(
			`attempt ${attemptId} not active (status=${attempt.status})`,
		);
	}
}

/** Liefert true, wenn ein gültiger Kontext vorliegt (für Guard-Bedingungen). */
export function hasExecutionContext(
	ctx: ControlPlaneExecutionContext | undefined | null,
): ctx is ControlPlaneExecutionContext {
	return Boolean(ctx?.run_id && ctx.job_id && ctx.attempt_id);
}
