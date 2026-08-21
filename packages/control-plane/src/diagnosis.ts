// Positron Control Plane — Two-Axis Failure Diagnosis & Evidence-Based Routing (P5.3)
//
// Zweite Achse: failure_domain (WO liegt die Ursache?) ergänzt failure_class (WAS ist passiert?).
// Pure, deterministische Funktionen — kein LLM, kein Random, kein Date.now(), kein HTTP.
//
//   failure_class × evidence → failure_domain → routing_action
//
// Capability erfordert Evidence Gate (Sample Size >1, Strategy-Delta, kein Provider/Infra, etc.)

import { fingerprint } from './fingerprint.js';
import type { AttemptRecord } from './store.js';

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export type FailureDomain = 'HARNESS' | 'EXECUTION' | 'STRATEGY' | 'CAPABILITY' | 'UNKNOWN';

export type RoutingAction =
	| 'RETRY_WITH_PROVIDER_REMEDIATION'
	| 'RETRY_WITH_HARNESS_DELTA'
	| 'RETRY_WITH_STRATEGY_DELTA'
	| 'ESCALATE_MODEL_PROFILE'
	| 'INSPECT_BLOCK'
	| 'NO_RETRY';

export const FAILURE_DOMAINS: readonly FailureDomain[] = [
	'HARNESS',
	'EXECUTION',
	'STRATEGY',
	'CAPABILITY',
	'UNKNOWN',
] as const;

export const ROUTING_ACTIONS: readonly RoutingAction[] = [
	'RETRY_WITH_PROVIDER_REMEDIATION',
	'RETRY_WITH_HARNESS_DELTA',
	'RETRY_WITH_STRATEGY_DELTA',
	'ESCALATE_MODEL_PROFILE',
	'INSPECT_BLOCK',
	'NO_RETRY',
] as const;

export function isFailureDomain(value: string): value is FailureDomain {
	return (FAILURE_DOMAINS as readonly string[]).includes(value);
}

export function isRoutingAction(value: string): value is RoutingAction {
	return (ROUTING_ACTIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

export const DIAGNOSIS_POLICY_VERSION = '1.0.0';
export const ROUTING_POLICY_VERSION = '1.0.0';

export const DEFAULT_CAPABILITY_SAMPLE_THRESHOLD = 3;

// Reason Codes (diagnosis)
export const DIAGNOSIS_REASON_EXECUTION_PROVIDER = 'DIAGNOSIS_EXECUTION_PROVIDER';
export const DIAGNOSIS_REASON_EXECUTION_INFRA = 'DIAGNOSIS_EXECUTION_INFRA';
export const DIAGNOSIS_REASON_EXECUTION_TIMEOUT = 'DIAGNOSIS_EXECUTION_TIMEOUT';
export const DIAGNOSIS_REASON_HARNESS_CONTEXT = 'DIAGNOSIS_HARNESS_CONTEXT';
export const DIAGNOSIS_REASON_HARNESS_TOOL = 'DIAGNOSIS_HARNESS_TOOL';
export const DIAGNOSIS_REASON_STRATEGY = 'DIAGNOSIS_STRATEGY';
export const DIAGNOSIS_REASON_CAPABILITY = 'DIAGNOSIS_CAPABILITY_LIMIT_LIKELY';
export const DIAGNOSIS_REASON_UNKNOWN = 'DIAGNOSIS_UNKNOWN';
export const DIAGNOSIS_REASON_SECURITY_BLOCK = 'DIAGNOSIS_SECURITY_BLOCK';

// Reason Codes (routing)
export const ROUTING_REASON_EXECUTION = 'ROUTING_EXECUTION_REMEDIATION';
export const ROUTING_REASON_HARNESS = 'ROUTING_HARNESS_DELTA';
export const ROUTING_REASON_STRATEGY = 'ROUTING_STRATEGY_DELTA';
export const ROUTING_REASON_CAPABILITY = 'ROUTING_CAPABILITY_ESCALATION';
export const ROUTING_REASON_UNKNOWN = 'ROUTING_UNKNOWN_INSPECT';
export const ROUTING_REASON_INSUFFICIENT_EVIDENCE = 'ROUTING_INSUFFICIENT_EVIDENCE';
export const ROUTING_REASON_SECURITY_BLOCK = 'ROUTING_SECURITY_BLOCK_NO_RETRY';

// ---------------------------------------------------------------------------
// Diagnosis Policy — pure deterministic
// ---------------------------------------------------------------------------

export interface DiagnosisInput {
	failure_class: string;
	/** Optional: context sufficiency evidence */
	contextSufficient?: boolean;
	/** Optional: required tools available */
	toolsAvailable?: boolean;
	/** Optional: strategy delta was tried */
	strategyDeltaTried?: boolean;
	/** Optional: evidence for capability (sample size, repeated pattern) */
	capabilityEvidence?: {
		sampleSize: number;
		threshold: number;
		repeatedPattern: boolean;
		noProviderFailure: boolean;
		noInfraFailure: boolean;
		noTimeout: boolean;
		contextSufficient: boolean;
		toolsAvailable: boolean;
		contractValid: boolean;
		securityValid: boolean;
		strategyDeltaTried: boolean;
		noConflictingEvidence: boolean;
	};
}

export interface DiagnosisResult {
	failure_domain: FailureDomain;
	reason_code: string;
	evidence_sufficient: boolean;
}

/**
 * Pure deterministic diagnosis: failure_class × evidence → failure_domain.
 * Kein LLM, kein Random, kein Date.now().
 */
export function diagnoseFailureDomain(input: DiagnosisInput): DiagnosisResult {
	const fc = input.failure_class;

	// SECURITY_BLOCK is never capability, never retry signal — always UNKNOWN/INSPECT
	if (fc === 'SECURITY_BLOCK' || fc.startsWith('SECURITY_BLOCK')) {
		return {
			failure_domain: 'UNKNOWN',
			reason_code: DIAGNOSIS_REASON_SECURITY_BLOCK,
			evidence_sufficient: true,
		};
	}

	// PROVIDER/INFRA/TIMEOUT → EXECUTION (never capability)
	if (fc === 'PROVIDER_FAILURE' || fc.startsWith('PROVIDER_FAILURE')) {
		return {
			failure_domain: 'EXECUTION',
			reason_code: DIAGNOSIS_REASON_EXECUTION_PROVIDER,
			evidence_sufficient: true,
		};
	}
	if (fc === 'INFRA_FAILURE' || fc.startsWith('INFRA_FAILURE')) {
		return {
			failure_domain: 'EXECUTION',
			reason_code: DIAGNOSIS_REASON_EXECUTION_INFRA,
			evidence_sufficient: true,
		};
	}
	if (fc === 'TIMEOUT' || fc.startsWith('TIMEOUT')) {
		return {
			failure_domain: 'EXECUTION',
			reason_code: DIAGNOSIS_REASON_EXECUTION_TIMEOUT,
			evidence_sufficient: true,
		};
	}

	// CONTEXT_FAILURE / tool unavailability → HARNESS
	if (fc === 'CONTEXT_FAILURE' || fc.startsWith('CONTEXT_FAILURE')) {
		return {
			failure_domain: 'HARNESS',
			reason_code: DIAGNOSIS_REASON_HARNESS_CONTEXT,
			evidence_sufficient: true,
		};
	}
	if (fc === 'TOOL_NOT_ALLOWED' || fc === 'ADAPTER_CAPABILITY_MISMATCH' || fc === 'PROFILE_INCOMPATIBLE') {
		return {
			failure_domain: 'HARNESS',
			reason_code: DIAGNOSIS_REASON_HARNESS_TOOL,
			evidence_sufficient: true,
		};
	}

	// CONTRACT_FAILURE → HARNESS (context/tool/capability mismatch is harness-level)
	if (fc === 'CONTRACT_FAILURE' || fc.startsWith('CONTRACT_FAILURE')) {
		return {
			failure_domain: 'HARNESS',
			reason_code: DIAGNOSIS_REASON_HARNESS_TOOL,
			evidence_sufficient: true,
		};
	}

	// CAPABILITY evidence gate: only if all conditions met
	if (input.capabilityEvidence) {
		const gate = evaluateCapabilityEvidence(input.capabilityEvidence);
		if (gate.sufficient) {
			return {
				failure_domain: 'CAPABILITY',
				reason_code: DIAGNOSIS_REASON_CAPABILITY,
				evidence_sufficient: true,
			};
		}
		// Gate not sufficient → fall through to STRATEGY or UNKNOWN
	}

	// TEST/BUILD/LINT/TYPECHECK with valid context → STRATEGY (initially)
	if (
		fc === 'TEST_FAILURE' ||
		fc.startsWith('TEST_FAILURE') ||
		fc === 'BUILD_FAILURE' ||
		fc.startsWith('BUILD_FAILURE') ||
		fc === 'LINT_FAILURE' ||
		fc.startsWith('LINT_FAILURE') ||
		fc === 'TYPECHECK_FAILURE' ||
		fc.startsWith('TYPECHECK_FAILURE')
	) {
		return {
			failure_domain: 'STRATEGY',
			reason_code: DIAGNOSIS_REASON_STRATEGY,
			evidence_sufficient: true,
		};
	}

	// UNKNOWN and everything else → UNKNOWN (conservative)
	return {
		failure_domain: 'UNKNOWN',
		reason_code: DIAGNOSIS_REASON_UNKNOWN,
		evidence_sufficient: false,
	};
}

// ---------------------------------------------------------------------------
// Capability Evidence Gate
// ---------------------------------------------------------------------------

export interface CapabilityEvidenceInput {
	sampleSize: number;
	threshold: number;
	repeatedPattern: boolean;
	noProviderFailure: boolean;
	noInfraFailure: boolean;
	noTimeout: boolean;
	contextSufficient: boolean;
	toolsAvailable: boolean;
	contractValid: boolean;
	securityValid: boolean;
	strategyDeltaTried: boolean;
	noConflictingEvidence: boolean;
}

export interface CapabilityGateResult {
	sufficient: boolean;
	reason_code: string;
	failedChecks: string[];
}

/**
 * Capability darf nicht aus Sample Size 1 entstehen.
 * Alle Gates müssen erfüllt sein.
 */
export function evaluateCapabilityEvidence(input: CapabilityEvidenceInput): CapabilityGateResult {
	const failed: string[] = [];

	if (input.sampleSize <= 1) failed.push('SAMPLE_SIZE_TOO_SMALL');
	if (input.sampleSize < input.threshold) failed.push('THRESHOLD_NOT_MET');
	if (!input.repeatedPattern) failed.push('NO_REPEATED_PATTERN');
	if (!input.noProviderFailure) failed.push('PROVIDER_FAILURE_PRESENT');
	if (!input.noInfraFailure) failed.push('INFRA_FAILURE_PRESENT');
	if (!input.noTimeout) failed.push('TIMEOUT_PRESENT');
	if (!input.contextSufficient) failed.push('CONTEXT_INSUFFICIENT');
	if (!input.toolsAvailable) failed.push('TOOLS_NOT_AVAILABLE');
	if (!input.contractValid) failed.push('CONTRACT_INVALID');
	if (!input.securityValid) failed.push('SECURITY_INVALID');
	if (!input.strategyDeltaTried) failed.push('NO_STRATEGY_DELTA_TRIED');
	if (!input.noConflictingEvidence) failed.push('CONFLICTING_EVIDENCE');

	if (failed.length === 0) {
		return { sufficient: true, reason_code: 'CAPABILITY_EVIDENCE_SUFFICIENT', failedChecks: [] };
	}
	return { sufficient: false, reason_code: 'INSUFFICIENT_EVIDENCE', failedChecks: failed };
}

// ---------------------------------------------------------------------------
// Routing Policy — pure deterministic
// ---------------------------------------------------------------------------

export interface RoutingInput {
	failure_class: string;
	failure_domain: FailureDomain;
	evidence_refs: string[];
	sample_size: number;
	threshold: number;
	/** For CAPABILITY: whether evidence gate passed */
	capabilityGatePassed?: boolean;
	/** For SECURITY_BLOCK */
	isSecurityBlock?: boolean;
}

export interface RoutingResult {
	routing_action: RoutingAction;
	reason_code: string;
	selected_delta: string;
	threshold_result: string;
}

/**
 * Pure deterministic routing: failure_domain × evidence → routing_action.
 */
export function decideRouting(input: RoutingInput): RoutingResult {
	// SECURITY_BLOCK → never retry, never escalate
	if (input.isSecurityBlock || input.failure_class === 'SECURITY_BLOCK' || input.failure_class.startsWith('SECURITY_BLOCK')) {
		return {
			routing_action: 'NO_RETRY',
			reason_code: ROUTING_REASON_SECURITY_BLOCK,
			selected_delta: 'none',
			threshold_result: 'SECURITY_BLOCK',
		};
	}

	switch (input.failure_domain) {
		case 'EXECUTION':
			return {
				routing_action: 'RETRY_WITH_PROVIDER_REMEDIATION',
				reason_code: ROUTING_REASON_EXECUTION,
				selected_delta: 'provider_infra_remediation',
				threshold_result: 'EXECUTION_NO_CAPABILITY',
			};
		case 'HARNESS':
			return {
				routing_action: 'RETRY_WITH_HARNESS_DELTA',
				reason_code: ROUTING_REASON_HARNESS,
				selected_delta: 'context_tool_profile_delta',
				threshold_result: 'HARNESS_DELTA_REQUIRED',
			};
		case 'STRATEGY':
			return {
				routing_action: 'RETRY_WITH_STRATEGY_DELTA',
				reason_code: ROUTING_REASON_STRATEGY,
				selected_delta: 'strategy_delta',
				threshold_result: 'STRATEGY_DELTA_REQUIRED',
			};
		case 'CAPABILITY': {
			// CAPABILITY requires evidence gate
			if (input.capabilityGatePassed !== true) {
				return {
					routing_action: 'INSPECT_BLOCK',
					reason_code: ROUTING_REASON_INSUFFICIENT_EVIDENCE,
					selected_delta: 'none',
					threshold_result: 'INSUFFICIENT_EVIDENCE',
				};
			}
			if (input.sample_size < input.threshold) {
				return {
					routing_action: 'INSPECT_BLOCK',
					reason_code: ROUTING_REASON_INSUFFICIENT_EVIDENCE,
					selected_delta: 'none',
					threshold_result: 'THRESHOLD_NOT_MET',
				};
			}
			return {
				routing_action: 'ESCALATE_MODEL_PROFILE',
				reason_code: ROUTING_REASON_CAPABILITY,
				selected_delta: 'model_profile_escalation',
				threshold_result: 'CAPABILITY_ESCALATION_APPROVED',
			};
		}
		case 'UNKNOWN':
		default:
			return {
				routing_action: 'INSPECT_BLOCK',
				reason_code: ROUTING_REASON_UNKNOWN,
				selected_delta: 'none',
				threshold_result: 'UNKNOWN_CONSERVATIVE',
			};
	}
}

// ---------------------------------------------------------------------------
// Contract builders (deterministic, fingerprinted)
// ---------------------------------------------------------------------------

export interface FailureDiagnosisContract {
	contract: 'positron.failure-diagnosis.v1';
	run_id: string;
	job_id: string;
	attempt_id: string;
	failure_class: string;
	failure_domain: FailureDomain;
	evidence_refs: string[];
	sample_size: number;
	threshold: number;
	evidence_sufficient: boolean;
	diagnosis_reason_code: string;
	policy_version: string;
	fingerprint: string;
}

export function buildFailureDiagnosis(input: {
	run_id: string;
	job_id: string;
	attempt_id: string;
	failure_class: string;
	failure_domain: FailureDomain;
	evidence_refs: string[];
	sample_size: number;
	threshold: number;
	evidence_sufficient: boolean;
	diagnosis_reason_code: string;
}): FailureDiagnosisContract {
	const doc: FailureDiagnosisContract = {
		contract: 'positron.failure-diagnosis.v1',
		run_id: input.run_id,
		job_id: input.job_id,
		attempt_id: input.attempt_id,
		failure_class: input.failure_class,
		failure_domain: input.failure_domain,
		evidence_refs: input.evidence_refs,
		sample_size: input.sample_size,
		threshold: input.threshold,
		evidence_sufficient: input.evidence_sufficient,
		diagnosis_reason_code: input.diagnosis_reason_code,
		policy_version: DIAGNOSIS_POLICY_VERSION,
		fingerprint: '',
	};
	doc.fingerprint = fingerprint({
		run_id: doc.run_id,
		job_id: doc.job_id,
		attempt_id: doc.attempt_id,
		failure_class: doc.failure_class,
		failure_domain: doc.failure_domain,
		evidence_refs: doc.evidence_refs,
		sample_size: doc.sample_size,
		threshold: doc.threshold,
		evidence_sufficient: doc.evidence_sufficient,
		diagnosis_reason_code: doc.diagnosis_reason_code,
		policy_version: doc.policy_version,
	});
	return doc;
}

export interface RoutingDecisionContract {
	contract: 'positron.routing-decision.v1';
	source_attempt_id: string;
	failure_class: string;
	failure_domain: FailureDomain;
	routing_action: RoutingAction;
	reason_code: string;
	evidence_refs: string[];
	sample_size: number;
	threshold_result: string;
	selected_delta: string;
	policy_version: string;
	fingerprint: string;
}

export function buildRoutingDecision(input: {
	source_attempt_id: string;
	failure_class: string;
	failure_domain: FailureDomain;
	routing_action: RoutingAction;
	reason_code: string;
	evidence_refs: string[];
	sample_size: number;
	threshold_result: string;
	selected_delta: string;
}): RoutingDecisionContract {
	const doc: RoutingDecisionContract = {
		contract: 'positron.routing-decision.v1',
		source_attempt_id: input.source_attempt_id,
		failure_class: input.failure_class,
		failure_domain: input.failure_domain,
		routing_action: input.routing_action,
		reason_code: input.reason_code,
		evidence_refs: input.evidence_refs,
		sample_size: input.sample_size,
		threshold_result: input.threshold_result,
		selected_delta: input.selected_delta,
		policy_version: ROUTING_POLICY_VERSION,
		fingerprint: '',
	};
	doc.fingerprint = fingerprint({
		source_attempt_id: doc.source_attempt_id,
		failure_class: doc.failure_class,
		failure_domain: doc.failure_domain,
		routing_action: doc.routing_action,
		reason_code: doc.reason_code,
		evidence_refs: doc.evidence_refs,
		sample_size: doc.sample_size,
		threshold_result: doc.threshold_result,
		selected_delta: doc.selected_delta,
		policy_version: doc.policy_version,
	});
	return doc;
}

// ---------------------------------------------------------------------------
// Attempt chain helpers
// ---------------------------------------------------------------------------

/**
 * Sammelt die Attempt-Kette für einen Run/Job (immutable history).
 * Jeder neue Attempt hat previous_attempt_id → vorheriger Attempt.
 */
export function collectAttemptChain(
	attempts: AttemptRecord[],
	runId: string,
	jobType: string,
): AttemptRecord[] {
	// Filter by run and job type via job_id lookup would be needed in real DB
	// For pure function, just filter by run_id and sort by started_at
	return attempts
		.filter((a) => a.run_id === runId)
		.sort((a, b) => a.started_at.localeCompare(b.started_at));
}

/**
 * Prüft ob ein neuer Attempt ein echtes Delta hat (kein Blind Retry).
 * Vergleicht input_fingerprint, provider, model, effective_harness_fingerprint.
 */
export function hasRealDelta(
	previous: AttemptRecord,
	next: { input_fingerprint: string | null; provider: string | null; model: string | null; effective_harness_fingerprint: string | null; strategy_delta: string | null; new_evidence: string | null },
): boolean {
	if (previous.input_fingerprint !== next.input_fingerprint) return true;
	if (previous.provider !== next.provider) return true;
	if (previous.model !== next.model) return true;
	if (previous.effective_harness_fingerprint !== next.effective_harness_fingerprint) return true;
	if (next.strategy_delta && next.strategy_delta.trim().length > 0) return true;
	if (next.new_evidence && next.new_evidence.trim().length > 0) return true;
	return false;
}
