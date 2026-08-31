// Issue #474 Phase 0: evidence-gated procedural-skill experiment.
// This is an offline projection: it never persists, activates, or promotes.

import { fingerprint } from './fingerprint.js';

export const SKILL_EXPERIMENT_VERSION = 'phase0.v1';
export const MIN_SKILL_EXPERIMENT_SAMPLE_SIZE = 5;
export const MAX_PROCEDURE_STEPS = 12;
export const MAX_CONTEXT_UNITS = 4096;

export type SkillQualityReasonCode =
	| 'SKILL_SCHEMA_INVALID'
	| 'SKILL_ROUTING_AMBIGUOUS'
	| 'SKILL_PORTABILITY_FAILED'
	| 'SKILL_RESOURCE_INVALID'
	| 'SKILL_INCOMPATIBLE'
	| 'SKILL_STALE_VERSION'
	| 'SKILL_SECRET_OR_SENSITIVE_CONTENT'
	| 'SKILL_PERMISSION_ESCALATION_DENIED'
	| 'SKILL_CONTEXT_BUDGET_EXCEEDED';

export interface SkillCandidateProjection {
	candidate_id: string;
	candidate_version: string;
	candidate_fingerprint: string;
	target_task_class: string;
	source_attempt_refs: string[];
	source_evidence_fingerprints: string[];
	routing_description: string;
	trigger_conditions: string[];
	procedure_steps: string[];
	resource_refs: string[];
	compatibility_constraints: {
		repository_ref?: string;
		tool_version?: string;
		runtime_family?: string;
		max_age_days?: number;
	};
	recovery_or_stop_conditions: string[];
	provenance: { kind: 'TRACE_DERIVED'; generator_ref: string; evidence_fingerprints: string[] };
}

export interface SkillQualityGateResult {
	ok: boolean;
	status: 'ELIGIBLE_FOR_EVALUATION' | 'REJECTED';
	reason_codes: SkillQualityReasonCode[];
}

export interface ExperimentBudget {
	context_units: number;
	model_calls: number;
	tool_calls: number;
	wall_clock_ms: number;
}

export interface ExplorationTelemetry {
	files_read: number | 'UNKNOWN';
	regions_read: number | 'UNKNOWN';
	search_calls: number | 'UNKNOWN';
	read_calls: number | 'UNKNOWN';
	tool_calls_before_first_patch: number | 'UNKNOWN';
	time_to_first_repair_relevant_region_ms: number | 'UNKNOWN';
	context_admitted: number | 'UNKNOWN';
	repeated_read_count: number | 'UNKNOWN';
	exploration_churn: number | 'UNKNOWN';
	ranked_region_refs: string[] | 'UNKNOWN';
	repair_region_recall_proxy: number | 'UNKNOWN';
	irrelevant_context_ratio: number | 'UNKNOWN';
}

export interface SkillExperimentArm {
	arm: 'A_NO_SKILL' | 'B_SKILL' | 'C_COMPUTE_MATCHED_NO_SKILL';
	sample_size: number;
	verified_success: number;
	first_pass_success: number;
	attempts: number;
	time_to_verified_success_ms: number | null;
	tool_calls: number | null;
	tokens: number | null;
	token_provenance: 'VERIFIED' | 'UNKNOWN';
	budget: ExperimentBudget;
	retry_rate: number | null;
	escalation_rate: number | null;
	regression_count: number;
	security_result: 'PASS' | 'FAIL' | 'UNKNOWN';
	exploration: ExplorationTelemetry;
}

export interface SkillExperimentInput {
	experiment_id: string;
	candidate: SkillCandidateProjection;
	training_evidence_refs: string[];
	holdout_evidence_refs: string[];
	partition_fingerprints: { training: string; holdout: string };
	arms: { a: SkillExperimentArm; b: SkillExperimentArm; c: SkillExperimentArm };
	independent_observations: number;
	compute_match_tolerance: number;
	quality_gate?: SkillQualityGateResult;
}

export type SkillValueClassification =
	| 'GREEN_SKILL_SPECIALIZATION_VALUE_PROVEN'
	| 'AMBER_SKILL_INSUFFICIENT_EVIDENCE'
	| 'AMBER_SKILL_ADVANTAGE_EXPLAINED_BY_COMPUTE'
	| 'AMBER_SKILL_NO_MARGINAL_UTILITY'
	| 'RED_SKILL_SECURITY_REGRESSION'
	| 'RED_SKILL_HOLDOUT_LEAKAGE';

export interface SkillValueGateResult {
	classification: SkillValueClassification;
	skill_specialization_value_proven: boolean;
	reason_code: string;
	verified_success_rate: { a: number; b: number; c: number };
	token_context_overhead: number | 'UNKNOWN';
	cost_per_verified_success: 'NOT_AVAILABLE' | number;
	holdout_leakage: boolean;
	compute_matched: boolean;
}

const SECRET_PATTERN =
	/(api[_ -]?key|token|password|secret|credential|authorization|bearer)\s*[:=]/i;
const AUTHORITY_PATTERN =
	/(ignore|bypass|disable|change|increase|allow|print|read|merge|push|deploy).{0,40}(kernel|policy|permission|holdout|evaluation|secret|token|\.env|ssh)/i;
const ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\/|~\/|\.\.?[\\])/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

function allStrings(candidate: SkillCandidateProjection): string[] {
	return [
		candidate.target_task_class,
		candidate.routing_description,
		...candidate.trigger_conditions,
		...candidate.procedure_steps,
		...candidate.resource_refs,
		...candidate.recovery_or_stop_conditions,
		candidate.compatibility_constraints.repository_ref ?? '',
		candidate.compatibility_constraints.tool_version ?? '',
		candidate.compatibility_constraints.runtime_family ?? '',
	];
}

export function computeSkillCandidateFingerprint(
	candidate: Omit<SkillCandidateProjection, 'candidate_fingerprint'>,
): string {
	return fingerprint({
		version: SKILL_EXPERIMENT_VERSION,
		candidate_id: candidate.candidate_id,
		candidate_version: candidate.candidate_version,
		target_task_class: candidate.target_task_class,
		source_attempt_refs: [...candidate.source_attempt_refs].sort(),
		source_evidence_fingerprints: [...candidate.source_evidence_fingerprints].sort(),
		routing_description: candidate.routing_description,
		trigger_conditions: candidate.trigger_conditions,
		procedure_steps: candidate.procedure_steps,
		resource_refs: [...candidate.resource_refs].sort(),
		compatibility_constraints: candidate.compatibility_constraints,
		recovery_or_stop_conditions: candidate.recovery_or_stop_conditions,
	});
}

export function validateSkillCandidate(
	candidate: SkillCandidateProjection,
	options: { currentToolVersion?: string; maxContextUnits?: number } = {},
): SkillQualityGateResult {
	const reasons = new Set<SkillQualityReasonCode>();
	if (
		!candidate.candidate_id ||
		!candidate.candidate_version ||
		!FINGERPRINT_PATTERN.test(candidate.candidate_fingerprint) ||
		candidate.candidate_fingerprint !== computeSkillCandidateFingerprint(candidate) ||
		!candidate.target_task_class ||
		candidate.source_attempt_refs.length < 2 ||
		candidate.source_evidence_fingerprints.length < 2 ||
		!candidate.source_evidence_fingerprints.every((ref) => FINGERPRINT_PATTERN.test(ref)) ||
		candidate.provenance.kind !== 'TRACE_DERIVED' ||
		!candidate.provenance.generator_ref
	)
		reasons.add('SKILL_SCHEMA_INVALID');
	if (!candidate.routing_description || candidate.trigger_conditions.length === 0)
		reasons.add('SKILL_ROUTING_AMBIGUOUS');
	if (
		candidate.procedure_steps.length === 0 ||
		candidate.procedure_steps.length > MAX_PROCEDURE_STEPS ||
		candidate.procedure_steps.some((step) => step.length > 500)
	)
		reasons.add('SKILL_SCHEMA_INVALID');
	if (
		candidate.resource_refs.some(
			(ref) => !ref || ABSOLUTE_PATH_PATTERN.test(ref) || ref.includes('..'),
		)
	) {
		reasons.add('SKILL_PORTABILITY_FAILED');
		reasons.add('SKILL_RESOURCE_INVALID');
	}
	if (
		candidate.resource_refs.some((ref) => !ref.startsWith('evidence:') && !ref.startsWith('repo:'))
	)
		reasons.add('SKILL_RESOURCE_INVALID');
	const strings = allStrings(candidate);
	if (strings.some((value) => SECRET_PATTERN.test(value)))
		reasons.add('SKILL_SECRET_OR_SENSITIVE_CONTENT');
	if (strings.some((value) => AUTHORITY_PATTERN.test(value)))
		reasons.add('SKILL_PERMISSION_ESCALATION_DENIED');
	if (
		strings.reduce((sum, value) => sum + value.length, 0) >
		(options.maxContextUnits ?? MAX_CONTEXT_UNITS)
	)
		reasons.add('SKILL_CONTEXT_BUDGET_EXCEEDED');
	if (
		options.currentToolVersion &&
		candidate.compatibility_constraints.tool_version &&
		candidate.compatibility_constraints.tool_version !== options.currentToolVersion
	)
		reasons.add('SKILL_STALE_VERSION');
	if (
		candidate.compatibility_constraints.max_age_days !== undefined &&
		candidate.compatibility_constraints.max_age_days <= 0
	)
		reasons.add('SKILL_INCOMPATIBLE');
	return {
		ok: reasons.size === 0,
		status: reasons.size === 0 ? 'ELIGIBLE_FOR_EVALUATION' : 'REJECTED',
		reason_codes: [...reasons],
	};
}

function successRate(arm: SkillExperimentArm): number {
	return arm.sample_size > 0 ? arm.verified_success / arm.sample_size : 0;
}

function budgetDistance(left: ExperimentBudget, right: ExperimentBudget): number {
	const values = ['context_units', 'model_calls', 'tool_calls', 'wall_clock_ms'] as const;
	return Math.max(
		...values.map((key) => Math.abs(left[key] - right[key]) / Math.max(1, left[key], right[key])),
	);
}

export function evaluateSkillValueGate(input: SkillExperimentInput): SkillValueGateResult {
	const { a, b, c } = input.arms;
	const holdoutLeakage = input.training_evidence_refs.some((ref) =>
		input.holdout_evidence_refs.includes(ref),
	);
	const computeMatched = budgetDistance(b.budget, c.budget) <= input.compute_match_tolerance;
	const rates = { a: successRate(a), b: successRate(b), c: successRate(c) };
	const overhead =
		a.tokens !== null &&
		b.tokens !== null &&
		a.tokens > 0 &&
		a.token_provenance === 'VERIFIED' &&
		b.token_provenance === 'VERIFIED'
			? (b.tokens - a.tokens) / a.tokens
			: 'UNKNOWN';
	const result = (
		classification: SkillValueClassification,
		reason_code: string,
	): SkillValueGateResult => ({
		classification,
		skill_specialization_value_proven: classification === 'GREEN_SKILL_SPECIALIZATION_VALUE_PROVEN',
		reason_code,
		verified_success_rate: rates,
		token_context_overhead: overhead,
		cost_per_verified_success: 'NOT_AVAILABLE',
		holdout_leakage: holdoutLeakage,
		compute_matched: computeMatched,
	});
	if (holdoutLeakage) return result('RED_SKILL_HOLDOUT_LEAKAGE', 'SKILL_HOLDOUT_LEAKAGE');
	if (
		!FINGERPRINT_PATTERN.test(input.partition_fingerprints.training) ||
		!FINGERPRINT_PATTERN.test(input.partition_fingerprints.holdout) ||
		input.partition_fingerprints.training === input.partition_fingerprints.holdout
	)
		return result('RED_SKILL_HOLDOUT_LEAKAGE', 'SKILL_HOLDOUT_LEAKAGE');
	const quality = input.quality_gate ?? validateSkillCandidate(input.candidate);
	if (!quality.ok)
		return result(
			'AMBER_SKILL_INSUFFICIENT_EVIDENCE',
			quality.reason_codes[0] ?? 'SKILL_SCHEMA_INVALID',
		);
	if (b.security_result === 'FAIL' || b.regression_count > 0)
		return result(
			b.security_result === 'FAIL'
				? 'RED_SKILL_SECURITY_REGRESSION'
				: 'AMBER_SKILL_NO_MARGINAL_UTILITY',
			b.security_result === 'FAIL'
				? 'SKILL_SECURITY_REGRESSION'
				: 'SKILL_VERIFIED_SUCCESS_REGRESSION',
		);
	if (!computeMatched)
		return result(
			'AMBER_SKILL_ADVANTAGE_EXPLAINED_BY_COMPUTE',
			'SKILL_COMPUTE_ADVANTAGE_NOT_SKILL',
		);
	if (
		[a, b, c].some((arm) => arm.sample_size < MIN_SKILL_EXPERIMENT_SAMPLE_SIZE) ||
		input.independent_observations < 2
	)
		return result('AMBER_SKILL_INSUFFICIENT_EVIDENCE', 'SKILL_INSUFFICIENT_EVIDENCE');
	if (b.security_result !== 'PASS' || rates.b <= rates.a || rates.b <= rates.c)
		return result('AMBER_SKILL_NO_MARGINAL_UTILITY', 'SKILL_NO_MARGINAL_UTILITY');
	return result('GREEN_SKILL_SPECIALIZATION_VALUE_PROVEN', 'SKILL_VALUE_PROVEN');
}
