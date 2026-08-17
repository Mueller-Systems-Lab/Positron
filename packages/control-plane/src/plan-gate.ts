// Positron Control Plane — Deterministisches Plan Gate
//
// Vor BUILD muss der Plan das Gate passieren. Kein LLM-Urteil —
// ausschließlich maschinenlesbare Checks. Ergebnis:
//
//   APPROVED | REJECTED | BLOCKED
//
// Nur APPROVED gibt den Build frei.

import { validateContract } from './contracts.js';
import type { PlanContract } from './contracts.js';
import { fingerprint } from './fingerprint.js';

export type PlanGateVerdict = 'APPROVED' | 'REJECTED' | 'BLOCKED';

export interface PlanGateResult {
	status: PlanGateVerdict;
	reason_code: string;
	errors: string[];
	plan_fingerprint: string | null;
}

const FORBIDDEN_MUTATIONS = [
	'git push',
	'git merge',
	'git rebase',
	'git commit',
	'rm -rf',
	'--force',
	'force-push',
];

const HEX_SHA = /^[0-9a-f]{40}$/;

/**
 * Führt das deterministische Plan Gate aus.
 *
 * Checks:
 * 1. Schema valid (positron.plan.v1)
 * 2. run_id vorhanden
 * 3. repository identity valide
 * 4. repository HEAD konsistent (40-hex)
 * 5. acceptance criteria existieren
 * 6. build scope strukturell valide
 * 7. required tests strukturell valide
 * 8. context fingerprint vorhanden
 * 9. forbidden mutations absent
 *
 * @param doc Der zu prüfende Plan (als Objekt)
 * @param expectedRepositoryRef Erwartete Repository-Referenz (owner/repo) — optional
 * @param expectedHead Erwarteter Repository-HEAD — optional
 */
export function evaluatePlanGate(
	doc: unknown,
	expectedRepositoryRef?: string,
	expectedHead?: string,
): PlanGateResult {
	const schemaResult = validateContract('positron.plan.v1', doc);
	if (!schemaResult.ok) {
		return {
			status: 'REJECTED',
			reason_code: 'PLAN_SCHEMA_INVALID',
			errors: schemaResult.errors,
			plan_fingerprint: null,
		};
	}

	const plan = doc as PlanContract;
	const errors: string[] = [];

	// 2. run_id valide
	if (!plan.run_id || plan.run_id.length < 8) {
		errors.push('run_id is missing or too short');
	}

	// 3. Repository-Identität
	if (!plan.repository_ref || !/^[^/\s]+\/[^/\s]+$/.test(plan.repository_ref)) {
		errors.push(`repository_ref is invalid: "${plan.repository_ref}"`);
	} else if (expectedRepositoryRef && plan.repository_ref !== expectedRepositoryRef) {
		errors.push(
			`repository_ref mismatch: expected "${expectedRepositoryRef}", got "${plan.repository_ref}"`,
		);
	}

	// 4. HEAD konsistent
	if (!HEX_SHA.test(plan.repository_head)) {
		errors.push(`repository_head is not a valid 40-char hex SHA: "${plan.repository_head}"`);
	} else if (expectedHead && plan.repository_head !== expectedHead) {
		errors.push(`repository_head mismatch: expected "${expectedHead}", got "${plan.repository_head}"`);
	}

	// 5. Acceptance Criteria
	if (!plan.acceptance_criteria || plan.acceptance_criteria.length === 0) {
		errors.push('acceptance_criteria is empty — a plan without acceptance criteria cannot gate');
	}

	// 6. Build Scope strukturell
	if (!plan.build_scope?.allowed_files || plan.build_scope.allowed_files.length === 0) {
		errors.push('build_scope.allowed_files is empty');
	}

	// 7. Required Tests strukturell
	if (!plan.required_tests || plan.required_tests.length === 0) {
		errors.push('required_tests is empty — verification targets are missing');
	}

	// 8. Context-Fingerprint
	if (!plan.context?.fingerprint || plan.context.fingerprint.length < 16) {
		errors.push('context.fingerprint is missing or too short');
	}

	// 9. Forbidden Mutations
	const allText = JSON.stringify({
		targets: plan.targets,
		acceptance_criteria: plan.acceptance_criteria,
		build_scope: plan.build_scope,
		risks: plan.risks,
	});
	for (const forbidden of FORBIDDEN_MUTATIONS) {
		if (allText.toLowerCase().includes(forbidden)) {
			errors.push(`forbidden mutation pattern detected: "${forbidden}"`);
		}
	}

	if (errors.length > 0) {
		return {
			status: 'REJECTED',
			reason_code: 'PLAN_GATE_REJECTED',
			errors,
			plan_fingerprint: null,
		};
	}

	const planFingerprint = fingerprint(plan);
	return {
		status: 'APPROVED',
		reason_code: 'PLAN_GATE_APPROVED',
		errors: [],
		plan_fingerprint: planFingerprint,
	};
}

/**
 * Blockiert einen Plan, wenn die Gate-Voraussetzungen nicht einmal prüfbar sind
 * (z. B. Plan-Datei fehlt, kein Zugriff). Unterscheidet sich von REJECTED:
 * REJECTED = geprüft und ungültig, BLOCKED = Prüfung nicht möglich.
 */
export function planGateBlocked(reasonCode: string, errors: string[]): PlanGateResult {
	return { status: 'BLOCKED', reason_code: reasonCode, errors, plan_fingerprint: null };
}

/** Nur APPROVED gibt den Build frei. */
export function isPlanApproved(result: PlanGateResult): boolean {
	return result.status === 'APPROVED';
}
