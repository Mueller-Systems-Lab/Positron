// Positron Control Plane — Deterministische Verification
//
// Messbare Ergebnisse werden von Tools gemessen, nicht von LLMs beurteilt.
// Diese Module bündeln reale Tool-Ergebnisse (TestRunner, Build, Lint,
// Typecheck, Schema/Contract-Validierung) in einen positron.verification.v1
// Contract.

import type { FailureClass, VerificationCheck, VerificationContract } from './contracts.js';
import { validateContract } from './contracts.js';
import { failureSignatureFromChecks } from './failure.js';

export interface VerificationInput {
	run_id: string;
	job_id?: string;
	attempt_id?: string;
	/** Reale Check-Ergebnisse von Tools */
	checks: VerificationCheck[];
	/** Zusätzliche Evidenz (neue Information gegenüber vorherigem Versuch) */
	new_evidence?: string;
	/** Explizite Failure-Class (falls das Tool sie liefert) */
	failure_class?: FailureClass;
	/** Timeout-Information des Ausführers */
	timedOut?: boolean;
}

/**
 * Baut einen positron.verification.v1 Contract aus realen Check-Ergebnissen.
 * Deterministisch: passed = alle Checks grün.
 */
export function buildVerificationContract(input: VerificationInput): VerificationContract {
	const failedChecks = input.checks.filter((c) => !c.passed);
	const passed = failedChecks.length === 0;

	const contract: VerificationContract = {
		contract: 'positron.verification.v1',
		run_id: input.run_id,
		job_id: input.job_id,
		attempt_id: input.attempt_id,
		passed,
		checks: input.checks,
	};

	if (!passed) {
		contract.failure_class = input.failure_class ?? 'TEST_FAILURE';
		contract.failure_signature = failureSignatureFromChecks(
			failedChecks.map((c) => ({ name: c.name, kind: c.kind })),
		);
		if (input.timedOut) {
			contract.failure_class = 'TIMEOUT';
		}
	}
	if (input.new_evidence) {
		contract.new_evidence = input.new_evidence;
	}

	return contract;
}

/**
 * Validiert einen Verification-Contract. Fail-closed bei unbekannter Version.
 */
export function validateVerificationContract(doc: unknown) {
	return validateContract('positron.verification.v1', doc);
}

/** Erzeugt einen Repository-Invariant-Check (z. B. kein Push-Kill-Switch). */
export function repositoryCheck(name: string, passed: boolean, detail?: string): VerificationCheck {
	return { name, passed, kind: 'repository', duration_ms: 0, detail };
}
