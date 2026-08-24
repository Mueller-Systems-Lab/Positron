// Positron P5.4 — Evaluation: A/B/C, Compute Matching, Holdout, Leakage Defense
//
// A = CURRENT, B = CANDIDATE, C = CURRENT + COMPUTE-MATCHED BUDGET
// B > A but B <= C → COMPUTE_ADVANTAGE_NOT_HARNESS, not PROMOTION_APPROVED

import type { HarnessEvaluationContract } from './contracts.js';
import { fingerprint } from './fingerprint.js';

// ---------------------------------------------------------------------------
// Compute Matching (deterministisch, versioniert)
// ---------------------------------------------------------------------------

export const COMPUTE_MATCH_POLICY_VERSION = '1.0.0';

export interface ComputeBudget {
	attempts: number;
	model_calls: number;
	token_budget: number | null;
	reasoning_budget: number | null;
	wall_clock_ms: number | null;
}

export function computeMatchedBudget(
	baseline: ComputeBudget,
	candidate: ComputeBudget,
): ComputeBudget {
	// C = baseline + delta to match candidate's compute
	// Deterministic: take max of each dimension
	return {
		attempts: Math.max(baseline.attempts, candidate.attempts),
		model_calls: Math.max(baseline.model_calls, candidate.model_calls),
		token_budget:
			baseline.token_budget !== null && candidate.token_budget !== null
				? Math.max(baseline.token_budget, candidate.token_budget)
				: (candidate.token_budget ?? baseline.token_budget),
		reasoning_budget:
			baseline.reasoning_budget !== null && candidate.reasoning_budget !== null
				? Math.max(baseline.reasoning_budget, candidate.reasoning_budget)
				: (candidate.reasoning_budget ?? baseline.reasoning_budget),
		wall_clock_ms:
			baseline.wall_clock_ms !== null && candidate.wall_clock_ms !== null
				? Math.max(baseline.wall_clock_ms, candidate.wall_clock_ms)
				: (candidate.wall_clock_ms ?? baseline.wall_clock_ms),
	};
}

export function isComputeMatched(
	baseline: ComputeBudget,
	candidate: ComputeBudget,
	matched: ComputeBudget,
): boolean {
	const expected = computeMatchedBudget(baseline, candidate);
	return (
		matched.attempts === expected.attempts &&
		matched.model_calls === expected.model_calls &&
		matched.token_budget === expected.token_budget &&
		matched.reasoning_budget === expected.reasoning_budget &&
		matched.wall_clock_ms === expected.wall_clock_ms
	);
}

// ---------------------------------------------------------------------------
// Holdout Partitioning
// ---------------------------------------------------------------------------

export type PartitionType = 'TRAIN' | 'VALIDATION' | 'HOLDOUT';

export const PARTITION_TYPES: readonly PartitionType[] = [
	'TRAIN',
	'VALIDATION',
	'HOLDOUT',
] as const;

export interface DatasetPartition {
	partition_id: string;
	partition_type: PartitionType;
	dataset_fingerprint: string;
	partition_fingerprint: string;
	task_count: number;
	created_at: string;
}

export function buildPartitionFingerprint(
	datasetFingerprint: string,
	partitionType: PartitionType,
	taskIds: string[],
): string {
	return fingerprint({
		dataset_fingerprint: datasetFingerprint,
		partition_type: partitionType,
		task_ids: [...taskIds].sort(),
	});
}

export function isHoldoutIsolated(creationRefs: string[], holdoutRefs: string[]): boolean {
	const creationSet = new Set(creationRefs);
	for (const ref of holdoutRefs) {
		if (creationSet.has(ref)) return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// Leakage Defense (4 Arten)
// ---------------------------------------------------------------------------

export type LeakageType = 'TRAIN_HOLDOUT' | 'REPOSITORY' | 'TASK_FAMILY' | 'CANDIDATE_EVALUATOR';

export interface LeakageCheck {
	type: LeakageType;
	detected: boolean;
	reason_code: string;
}

export function checkLeakage(input: {
	creationEvidenceRefs: string[];
	holdoutEvidenceRefs: string[];
	repositoryRefs: string[];
	taskFamilyRefs: string[];
	evaluatorRefs: string[];
	proposerRefs: string[];
}): LeakageCheck[] {
	const checks: LeakageCheck[] = [];

	// 1. TRAIN ↔ HOLDOUT
	const trainHoldoutLeak = !isHoldoutIsolated(
		input.creationEvidenceRefs,
		input.holdoutEvidenceRefs,
	);
	checks.push({
		type: 'TRAIN_HOLDOUT',
		detected: trainHoldoutLeak,
		reason_code: trainHoldoutLeak ? 'LEAKAGE_TRAIN_HOLDOUT' : 'NO_LEAKAGE_TRAIN_HOLDOUT',
	});

	// 2. REPOSITORY (candidate trained on same repo as holdout)
	const repoLeak = input.repositoryRefs.some((r) => input.holdoutEvidenceRefs.includes(r));
	checks.push({
		type: 'REPOSITORY',
		detected: repoLeak,
		reason_code: repoLeak ? 'LEAKAGE_REPOSITORY' : 'NO_LEAKAGE_REPOSITORY',
	});

	// 3. TASK_FAMILY (same task family in train and holdout)
	const taskFamilyLeak = input.taskFamilyRefs.some(
		(r) => input.creationEvidenceRefs.includes(r) && input.holdoutEvidenceRefs.includes(r),
	);
	checks.push({
		type: 'TASK_FAMILY',
		detected: taskFamilyLeak,
		reason_code: taskFamilyLeak ? 'LEAKAGE_TASK_FAMILY' : 'NO_LEAKAGE_TASK_FAMILY',
	});

	// 4. CANDIDATE-EVALUATOR (proposer is evaluator)
	const evaluatorLeak = input.proposerRefs.some((r) => input.evaluatorRefs.includes(r));
	checks.push({
		type: 'CANDIDATE_EVALUATOR',
		detected: evaluatorLeak,
		reason_code: evaluatorLeak ? 'LEAKAGE_CANDIDATE_EVALUATOR' : 'NO_LEAKAGE_CANDIDATE_EVALUATOR',
	});

	return checks;
}

export function hasLeakage(checks: LeakageCheck[]): boolean {
	return checks.some((c) => c.detected);
}

// ---------------------------------------------------------------------------
// Evaluation Result & Sample Size Gate
// ---------------------------------------------------------------------------

export const MIN_SAMPLE_SIZE = 5;
export const DEFAULT_SAMPLE_THRESHOLD = 5;

export type EvaluationResult =
	| 'CANDIDATE_BETTER'
	| 'NO_MEANINGFUL_DIFFERENCE'
	| 'BASELINE_BETTER'
	| 'COMPUTE_ADVANTAGE_NOT_HARNESS'
	| 'INSUFFICIENT_EVIDENCE'
	| 'EVALUATION_INVALID'
	| 'SECURITY_REGRESSION'
	| 'CRITICAL_REGRESSION';

export interface EvaluationInput {
	candidateVerifiedSuccess: number;
	baselineVerifiedSuccess: number;
	computeMatchedVerifiedSuccess: number;
	sampleSize: number;
	minSampleSize?: number;
	hasLeakage?: boolean;
	securityRegression?: boolean;
	criticalRegression?: boolean;
}

export function evaluateResult(input: EvaluationInput): {
	result: EvaluationResult;
	reason_code: string;
} {
	const minSample = input.minSampleSize ?? MIN_SAMPLE_SIZE;

	if (input.hasLeakage) {
		return { result: 'EVALUATION_INVALID', reason_code: 'EVALUATION_INVALID_LEAKAGE' };
	}
	if (input.securityRegression) {
		return { result: 'SECURITY_REGRESSION', reason_code: 'SECURITY_REGRESSION_DETECTED' };
	}
	if (input.criticalRegression) {
		return { result: 'CRITICAL_REGRESSION', reason_code: 'CRITICAL_REGRESSION_DETECTED' };
	}
	if (input.sampleSize < minSample) {
		return { result: 'INSUFFICIENT_EVIDENCE', reason_code: 'INSUFFICIENT_SAMPLE_SIZE' };
	}

	// A/B/C logic: B > C? not just B > A
	const candidateBetterThanBaseline =
		input.candidateVerifiedSuccess > input.baselineVerifiedSuccess;
	const candidateBetterThanComputeMatched =
		input.candidateVerifiedSuccess > input.computeMatchedVerifiedSuccess;

	if (candidateBetterThanBaseline && !candidateBetterThanComputeMatched) {
		return {
			result: 'COMPUTE_ADVANTAGE_NOT_HARNESS',
			reason_code: 'COMPUTE_ADVANTAGE_NOT_HARNESS',
		};
	}
	if (candidateBetterThanBaseline && candidateBetterThanComputeMatched) {
		return {
			result: 'CANDIDATE_BETTER',
			reason_code: 'CANDIDATE_BETTER_THAN_BASELINE_AND_COMPUTE_MATCHED',
		};
	}
	if (input.candidateVerifiedSuccess < input.baselineVerifiedSuccess) {
		return { result: 'BASELINE_BETTER', reason_code: 'BASELINE_BETTER_THAN_CANDIDATE' };
	}
	return { result: 'NO_MEANINGFUL_DIFFERENCE', reason_code: 'NO_MEANINGFUL_DIFFERENCE' };
}

// ---------------------------------------------------------------------------
// Evaluation Fingerprint & Builder
// ---------------------------------------------------------------------------

export function computeEvaluationFingerprint(
	evalData: Omit<HarnessEvaluationContract, 'evaluation_fingerprint' | 'created_at'> & {
		created_at?: string;
	},
): string {
	return fingerprint({
		candidate_id: evalData.candidate_id,
		baseline_profile_ref: evalData.baseline_profile_ref,
		candidate_profile_ref: evalData.candidate_profile_ref,
		compute_matched_profile_ref: evalData.compute_matched_profile_ref,
		dataset_partition: evalData.dataset_partition,
		sample_size: evalData.sample_size,
		verified_success: evalData.verified_success,
		reason_code: evalData.reason_code,
	});
}

export interface BuildEvaluationInput {
	evaluation_id: string;
	candidate_id: string;
	baseline_profile_ref: Record<string, unknown>;
	candidate_profile_ref: Record<string, unknown>;
	compute_matched_profile_ref: Record<string, unknown>;
	dataset_partition: string;
	task_family?: string | null;
	sample_size: number;
	verified_success: number;
	first_pass_success: number;
	attempts_per_success?: number | null;
	time_to_verified_success?: number | null;
	tool_calls?: number | null;
	tokens?: number | null;
	cost?: string | number;
	regressions?: string[];
	security_result: string;
	contract_result: string;
	recovery_result: string;
	permission_result: string;
	scheduler_result: string;
	reason_code: string;
	created_at?: string;
}

export function buildEvaluation(input: BuildEvaluationInput): HarnessEvaluationContract {
	const cost = input.cost ?? 'NOT_AVAILABLE';
	const evalData = {
		contract: 'positron.harness-evaluation.v1' as const,
		evaluation_id: input.evaluation_id,
		candidate_id: input.candidate_id,
		baseline_profile_ref: input.baseline_profile_ref,
		candidate_profile_ref: input.candidate_profile_ref,
		compute_matched_profile_ref: input.compute_matched_profile_ref,
		dataset_partition: input.dataset_partition,
		task_family: input.task_family ?? null,
		sample_size: input.sample_size,
		verified_success: input.verified_success,
		first_pass_success: input.first_pass_success,
		attempts_per_success: input.attempts_per_success ?? null,
		time_to_verified_success: input.time_to_verified_success ?? null,
		tool_calls: input.tool_calls ?? null,
		tokens: input.tokens ?? null,
		cost,
		regressions: input.regressions ?? [],
		security_result: input.security_result,
		contract_result: input.contract_result,
		recovery_result: input.recovery_result,
		permission_result: input.permission_result,
		scheduler_result: input.scheduler_result,
		evaluation_fingerprint: '',
		reason_code: input.reason_code,
	};

	const fp = computeEvaluationFingerprint(evalData as unknown as HarnessEvaluationContract);
	return {
		...evalData,
		evaluation_fingerprint: fp,
	};
}
