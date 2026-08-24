// Positron Control Plane — Deterministische Decision Policy
//
// POSITRON entscheidet. Kein LLM.
//
// Kanonische Resultate: DONE | FIX | SPLIT | BLOCKED
//
// Security ist KEIN Mehrheitsvotum: Ein blockierendes Security-Finding
// (HIGH/CRITICAL) blockiert hart, auch wenn Correctness/Quality grün sind.

import { validateContract } from './contracts.js';
import type { DecisionContract, FindingContract, VerificationContract } from './contracts.js';
import type { RetryDecision } from './retry-policy.js';

export interface DecisionInput {
	run_id: string;
	/** Ergebnis der deterministischen Verification (null falls keine stattfand) */
	verification: VerificationContract | null;
	/** Strukturierte Review-Findings */
	findings: FindingContract[];
	/** Retry-Entscheidung der Retry Policy (falls geprüft) */
	retry?: RetryDecision | null;
	/** Plan Gate Status (falls relevant) */
	planGateStatus?: 'APPROVED' | 'REJECTED' | 'BLOCKED' | null;
	/** Contract-Validierungsfehler (falls aufgetreten) */
	contractErrors?: string[] | null;
	/** Split-Deep (für Rekursionsgrenzen) */
	splitDepth?: number;
	/** Research Barrier Reason (falls Research ausgeführt wurde) */
	researchBarrier?: string | null;
	/** Beobachteter Research-Parallelismus (falls Research ausgeführt wurde) */
	researchParallelism?: 'PARALLELISM_PROVEN' | 'PARALLELISM_NOT_PROVEN' | null;
	/**
	 * Deterministischer Timeout (Worker überschritt seine Zeitgrenze).
	 * Reason-Code wird direkt verwendet (z. B. BUILD_TIMEOUT, VERIFY_TIMEOUT) —
	 * ein Timeout ist nie ein Erfolgsübergang.
	 */
	timeoutReason?: string | null;
}

const SECURITY_BLOCKING_SEVERITIES = new Set(['HIGH', 'CRITICAL']);

export function buildDecision(input: DecisionInput): DecisionContract {
	const runId = input.run_id;

	// 1. Invalid Contract → BLOCKED (nie FIX/DONE)
	if (input.contractErrors && input.contractErrors.length > 0) {
		return {
			contract: 'positron.decision.v1',
			run_id: runId,
			decision: 'BLOCKED',
			reason_code: 'CONTRACT_INVALID',
			basis: { contract_errors: input.contractErrors },
		};
	}

	// 1b. Deterministischer Timeout → BLOCKED (nie Erfolgsübergang)
	if (input.timeoutReason) {
		return {
			contract: 'positron.decision.v1',
			run_id: runId,
			decision: 'BLOCKED',
			reason_code: input.timeoutReason,
			basis: { message: 'deterministic worker timeout' },
		};
	}

	// 2. Plan rejected → BLOCKED
	if (input.planGateStatus === 'REJECTED' || input.planGateStatus === 'BLOCKED') {
		return {
			contract: 'positron.decision.v1',
			run_id: runId,
			decision: 'BLOCKED',
			reason_code: input.planGateStatus === 'REJECTED' ? 'PLAN_GATE_REJECTED' : 'PLAN_GATE_BLOCKED',
			basis: {},
		};
	}

	// 3. Research Barrier nicht JOIN → BLOCKED (Research ist vorgelagert;
	//    ohne Research-Freigabe kein Plan/Build — deterministisch)
	if (input.researchBarrier && input.researchBarrier !== 'RESEARCH_JOIN') {
		return {
			contract: 'positron.decision.v1',
			run_id: runId,
			decision: 'BLOCKED',
			reason_code: input.researchBarrier,
			basis: {
				research_parallelism: input.researchParallelism ?? null,
			},
		};
	}

	// 4. Security Hard Block — kein Mehrheitsvotum
	const blockingSecurityFindings = input.findings.filter(
		(f) => f.category === 'security' && f.blocking && SECURITY_BLOCKING_SEVERITIES.has(f.severity),
	);
	if (blockingSecurityFindings.length > 0) {
		return {
			contract: 'positron.decision.v1',
			run_id: runId,
			decision: 'BLOCKED',
			reason_code: 'SECURITY_BLOCK',
			basis: {
				blocking_findings: blockingSecurityFindings.map((f) => ({
					severity: f.severity,
					rule: f.rule ?? null,
					evidence: f.evidence,
				})),
			},
		};
	}

	// 4. Keine Verification → BLOCKED (kein DONE ohne deterministische Gates)
	if (!input.verification) {
		return {
			contract: 'positron.decision.v1',
			run_id: runId,
			decision: 'BLOCKED',
			reason_code: 'NO_VERIFICATION',
			basis: {},
		};
	}

	// 5. Verification fehlgeschlagen
	if (!input.verification.passed) {
		// Retry geprüft und verboten → SPLIT (nicht endlos wiederholen)
		if (input.retry && input.retry.verdict === 'DENIED') {
			return {
				contract: 'positron.decision.v1',
				run_id: runId,
				decision: 'SPLIT',
				reason_code: input.retry.reason_code,
				basis: {
					failure_class: input.verification.failure_class ?? null,
					failure_signature: input.verification.failure_signature ?? null,
					split_depth: input.splitDepth ?? 0,
				},
			};
		}

		// Verification fehlgeschlagen + Retry möglich → FIX
		return {
			contract: 'positron.decision.v1',
			run_id: runId,
			decision: 'FIX',
			reason_code: 'VERIFY_FAILED_WITH_DELTA',
			basis: {
				failure_class: input.verification.failure_class ?? null,
				failure_signature: input.verification.failure_signature ?? null,
				new_evidence: input.verification.new_evidence ?? null,
			},
		};
	}

	// 6. Alle Gates grün → DONE
	return {
		contract: 'positron.decision.v1',
		run_id: runId,
		decision: 'DONE',
		reason_code: 'ALL_HARD_GATES_GREEN',
		basis: {
			checks_passed: input.verification.checks.length,
			findings: input.findings.map((f) => ({
				category: f.category,
				severity: f.severity,
				blocking: f.blocking,
			})),
		},
	};
}

export function validateDecision(doc: unknown) {
	return validateContract('positron.decision.v1', doc);
}

export function isDone(decision: DecisionContract): boolean {
	return decision.decision === 'DONE';
}
