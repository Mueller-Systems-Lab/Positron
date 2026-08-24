// Positron P5.4 — Promotion Gate: Deterministic, Kernel-Only, Hard Gates
//
// Nur Positron Kernel darf PROMOTE. Alle 17 Hard Gates müssen PASS, sonst NO PROMOTION.
// Security Regression overrides Performance — kein gewichteter Durchschnitt.

import type { HarnessPromotionDecisionContract, PromotionDecision } from './contracts.js';
import { fingerprint } from './fingerprint.js';

// ---------------------------------------------------------------------------
// Promotion Authority
// ---------------------------------------------------------------------------

export const KERNEL_AUTHORITY = 'KERNEL';
export const VALID_AUTHORITIES = ['KERNEL', 'SYSTEM', 'TEST'] as const;

export function isKernelAuthority(authority: string): boolean {
	return authority === KERNEL_AUTHORITY;
}

export const CANDIDATE_CANNOT_SELF_PROMOTE = 'CANDIDATE_CANNOT_SELF_PROMOTE';
export const MODEL_CANNOT_SELF_PROMOTE = 'MODEL_CANNOT_SELF_PROMOTE';
export const EVALUATOR_CANNOT_PROMOTE = 'EVALUATOR_CANNOT_PROMOTE';

// ---------------------------------------------------------------------------
// Hard Gates (17, alle müssen PASS)
// ---------------------------------------------------------------------------

export type HardGate =
	| 'VALID_CANDIDATE'
	| 'COMPUTE_MATCHED_EVALUATION_PASS'
	| 'HOLDOUT_PASS'
	| 'MIN_SAMPLE_PASS'
	| 'VERIFIED_SUCCESS_NON_REGRESSION'
	| 'CRITICAL_SUITE_PASS'
	| 'SECURITY_SENTINELS_PASS'
	| 'CONTRACT_GATES_PASS'
	| 'RECOVERY_GATES_PASS'
	| 'PERMISSION_GATES_PASS'
	| 'SCHEDULER_BUDGET_GATES_PASS'
	| 'BLIND_RETRY_RATE_ZERO'
	| 'NO_EVALUATION_LEAKAGE'
	| 'SHADOW_PASS'
	| 'CANARY_PASS'
	| 'ROLLBACK_AVAILABLE'
	| 'ATOMATICITY_PRECHECK_PASS';

export const HARD_GATES: readonly HardGate[] = [
	'VALID_CANDIDATE',
	'COMPUTE_MATCHED_EVALUATION_PASS',
	'HOLDOUT_PASS',
	'MIN_SAMPLE_PASS',
	'VERIFIED_SUCCESS_NON_REGRESSION',
	'CRITICAL_SUITE_PASS',
	'SECURITY_SENTINELS_PASS',
	'CONTRACT_GATES_PASS',
	'RECOVERY_GATES_PASS',
	'PERMISSION_GATES_PASS',
	'SCHEDULER_BUDGET_GATES_PASS',
	'BLIND_RETRY_RATE_ZERO',
	'NO_EVALUATION_LEAKAGE',
	'SHADOW_PASS',
	'CANARY_PASS',
	'ROLLBACK_AVAILABLE',
	'ATOMATICITY_PRECHECK_PASS',
] as const;

export interface GateResult {
	gate: HardGate;
	pass: boolean;
	reason_code: string;
}

export interface PromotionGateInput {
	actor_authority: string;
	gates: Record<HardGate, boolean>;
	// Additional context for reason codes
	securityRegression?: boolean;
	verifiedSuccessRegression?: boolean;
	criticalRegression?: boolean;
	sampleSize?: number;
	minSampleSize?: number;
	hasLeakage?: boolean;
	rollbackAvailable?: boolean;
}

export interface PromotionGateOutput {
	decision: PromotionDecision;
	reason_code: string;
	failedGates: HardGate[];
	allGatesPassed: boolean;
}

export const PROMOTION_POLICY_VERSION = '1.0.0';

export function evaluatePromotionGate(input: PromotionGateInput): PromotionGateOutput {
	// Authority check first — only KERNEL may PROMOTE
	if (!isKernelAuthority(input.actor_authority)) {
		return {
			decision: 'REJECT',
			reason_code: 'REJECT_NOT_KERNEL_AUTHORITY',
			failedGates: [],
			allGatesPassed: false,
		};
	}

	// Security regression hard gate overrides everything
	if (input.securityRegression) {
		return {
			decision: 'REJECT',
			reason_code: 'REJECT_SECURITY_REGRESSION',
			failedGates: ['SECURITY_SENTINELS_PASS'],
			allGatesPassed: false,
		};
	}

	// Check all hard gates
	const failedGates: HardGate[] = [];
	for (const gate of HARD_GATES) {
		if (!input.gates[gate]) {
			failedGates.push(gate);
		}
	}

	// Also check explicit flags
	if (input.hasLeakage && !failedGates.includes('NO_EVALUATION_LEAKAGE')) {
		failedGates.push('NO_EVALUATION_LEAKAGE');
	}
	if (input.verifiedSuccessRegression && !failedGates.includes('VERIFIED_SUCCESS_NON_REGRESSION')) {
		failedGates.push('VERIFIED_SUCCESS_NON_REGRESSION');
	}
	if (input.criticalRegression && !failedGates.includes('CRITICAL_SUITE_PASS')) {
		failedGates.push('CRITICAL_SUITE_PASS');
	}
	if (input.rollbackAvailable === false && !failedGates.includes('ROLLBACK_AVAILABLE')) {
		failedGates.push('ROLLBACK_AVAILABLE');
	}
	if (input.sampleSize !== undefined && input.minSampleSize !== undefined) {
		if (input.sampleSize < input.minSampleSize && !failedGates.includes('MIN_SAMPLE_PASS')) {
			failedGates.push('MIN_SAMPLE_PASS');
		}
	}

	if (failedGates.length > 0) {
		// Check if failure is due to insufficient sample
		if (failedGates.includes('MIN_SAMPLE_PASS')) {
			return {
				decision: 'INSUFFICIENT_EVIDENCE',
				reason_code: 'INSUFFICIENT_EVIDENCE_SAMPLE_SIZE',
				failedGates,
				allGatesPassed: false,
			};
		}
		if (failedGates.includes('ROLLBACK_AVAILABLE')) {
			return {
				decision: 'REJECT',
				reason_code: 'REJECT_ROLLBACK_NOT_PROVEN',
				failedGates,
				allGatesPassed: false,
			};
		}
		return {
			decision: 'REJECT',
			reason_code: `REJECT_GATES_FAILED_${failedGates[0]}`,
			failedGates,
			allGatesPassed: false,
		};
	}

	return {
		decision: 'PROMOTE',
		reason_code: 'PROMOTE_ALL_GATES_PASSED',
		failedGates: [],
		allGatesPassed: true,
	};
}

// ---------------------------------------------------------------------------
// Promotion Decision Builder & Fingerprint
// ---------------------------------------------------------------------------

export function computePromotionFingerprint(
	decision: Omit<HarnessPromotionDecisionContract, 'decision_fingerprint' | 'created_at'> & {
		created_at?: string;
	},
): string {
	return fingerprint({
		candidate_id: decision.candidate_id,
		current_profile_id: decision.current_profile_id,
		current_profile_fingerprint: decision.current_profile_fingerprint,
		candidate_profile_id: decision.candidate_profile_id,
		candidate_profile_fingerprint: decision.candidate_profile_fingerprint,
		evaluation_refs: [...decision.evaluation_refs].sort(),
		decision: decision.decision,
		reason_code: decision.reason_code,
		policy_version: decision.policy_version,
		actor_authority: decision.actor_authority,
		sample_size: decision.sample_size,
	});
}

export interface BuildPromotionDecisionInput {
	candidate_id: string;
	current_profile_id: string;
	current_profile_fingerprint: string;
	candidate_profile_id: string;
	candidate_profile_fingerprint: string;
	evaluation_refs: string[];
	holdout_result: string;
	compute_matched_result: string;
	security_result: string;
	contract_result: string;
	recovery_result: string;
	permission_result: string;
	scheduler_budget_result: string;
	sample_size: number;
	decision: PromotionDecision;
	reason_code: string;
	policy_version?: string;
	actor_authority: string;
	created_at?: string;
}

export function buildPromotionDecision(
	input: BuildPromotionDecisionInput,
): HarnessPromotionDecisionContract {
	const policy_version = input.policy_version ?? PROMOTION_POLICY_VERSION;
	const doc = {
		contract: 'positron.harness-promotion-decision.v1' as const,
		candidate_id: input.candidate_id,
		current_profile_id: input.current_profile_id,
		current_profile_fingerprint: input.current_profile_fingerprint,
		candidate_profile_id: input.candidate_profile_id,
		candidate_profile_fingerprint: input.candidate_profile_fingerprint,
		evaluation_refs: [...input.evaluation_refs].sort(),
		holdout_result: input.holdout_result,
		compute_matched_result: input.compute_matched_result,
		security_result: input.security_result,
		contract_result: input.contract_result,
		recovery_result: input.recovery_result,
		permission_result: input.permission_result,
		scheduler_budget_result: input.scheduler_budget_result,
		sample_size: input.sample_size,
		decision: input.decision,
		reason_code: input.reason_code,
		policy_version: policy_version,
		actor_authority: input.actor_authority,
		decision_fingerprint: '',
	};

	const fp = computePromotionFingerprint(doc as unknown as HarnessPromotionDecisionContract);
	return { ...doc, decision_fingerprint: fp };
}
