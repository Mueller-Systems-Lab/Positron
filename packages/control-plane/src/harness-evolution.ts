// Positron P5.4 — Harness Evolution: Candidate Lifecycle
//
// MODELS MAY PROPOSE. MODELS MAY NOT PROMOTE. EVALUATION PROVES. POSITRON PROMOTES.
// Candidate ist versioniert, fingerprinted, immutable. Hypothesis ist METADATA, nie executable.

import type { CandidateStatus, HarnessCandidateContract } from './contracts.js';
import { validateContract } from './contracts.js';
import { fingerprint } from './fingerprint.js';

// ---------------------------------------------------------------------------
// Tunable Surface Allowlist (was darf evolvieren?)
// ---------------------------------------------------------------------------

export const TUNABLE_FIELDS: readonly string[] = [
	'reasoning_mode',
	'model_profile_id',
	'task_profile_id',
	'context_strategy',
	'tool_subset',
	'retrieval_strategy',
	'timeout_ms',
	'max_steps',
	'compaction_strategy',
] as const;

export const NON_TUNABLE_FIELDS: readonly string[] = [
	'security_permissions',
	'kernel_hard_limits',
	'secrets_policy',
	'scheduler_authority',
	'promotion_policy',
	'kernel_permissions',
	'provider_secrets',
] as const;

export function isTunableField(field: string): boolean {
	return (TUNABLE_FIELDS as readonly string[]).includes(field);
}

export function isNonTunableField(field: string): boolean {
	return (NON_TUNABLE_FIELDS as readonly string[]).includes(field);
}

// ---------------------------------------------------------------------------
// Candidate Fingerprint (deterministisch, semantisch, ohne Runtime)
// ---------------------------------------------------------------------------

const CANDIDATE_FINGERPRINT_EXCLUDE = new Set([
	'created_at',
	'hypothesis',
	'candidate_id',
	'proposer_ref',
]);

export function computeCandidateFingerprint(
	candidate: Omit<HarnessCandidateContract, 'candidate_fingerprint' | 'created_at'> & {
		created_at?: string;
	},
): string {
	const doc = {
		parent_profile_id: candidate.parent_profile_id,
		parent_profile_version: candidate.parent_profile_version,
		parent_profile_fingerprint: candidate.parent_profile_fingerprint,
		candidate_version: candidate.candidate_version,
		candidate_profile_ref: candidate.candidate_profile_ref,
		created_from_evidence_refs: [...candidate.created_from_evidence_refs].sort(),
		proposer_type: candidate.proposer_type,
		status: candidate.status,
	};
	return fingerprint(doc, { excludeKeys: CANDIDATE_FINGERPRINT_EXCLUDE });
}

// ---------------------------------------------------------------------------
// Candidate Validation
// ---------------------------------------------------------------------------

export const CANDIDATE_INVALID = 'CANDIDATE_INVALID';
export const CANDIDATE_VERSION_CONFLICT = 'CANDIDATE_VERSION_CONFLICT';
export const CANDIDATE_FINGERPRINT_MISMATCH = 'CANDIDATE_FINGERPRINT_MISMATCH';
export const CANDIDATE_NON_TUNABLE_VIOLATION = 'CANDIDATE_NON_TUNABLE_VIOLATION';

export interface CandidateValidationResult {
	ok: boolean;
	errors: string[];
}

export function validateCandidate(candidate: HarnessCandidateContract): CandidateValidationResult {
	const errors: string[] = [];

	// Contract validation
	const contractResult = validateContract(
		'positron.harness-candidate.v1',
		candidate as unknown as Record<string, unknown>,
		1,
	);
	if (!contractResult.ok) {
		errors.push(...contractResult.errors);
	}

	// Fingerprint check (hypothesis excluded, so recompute without it)
	const expected = computeCandidateFingerprint(candidate);
	if (candidate.candidate_fingerprint !== expected) {
		errors.push(
			`${CANDIDATE_FINGERPRINT_MISMATCH}: expected ${expected}, got ${candidate.candidate_fingerprint}`,
		);
	}

	// Non-tunable violation check
	const profileRef = candidate.candidate_profile_ref as Record<string, unknown>;
	for (const field of NON_TUNABLE_FIELDS) {
		if (field in profileRef) {
			errors.push(`${CANDIDATE_NON_TUNABLE_VIOLATION}: ${field} is not tunable`);
		}
	}

	// Hypothesis must not be executable policy
	if (typeof candidate.hypothesis === 'string' && candidate.hypothesis.includes('kernel_policy')) {
		errors.push('hypothesis must not contain executable policy');
	}

	return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Candidate Builder
// ---------------------------------------------------------------------------

export interface BuildCandidateInput {
	candidate_id: string;
	parent_profile_id: string;
	parent_profile_version: string;
	parent_profile_fingerprint: string;
	candidate_version: string;
	hypothesis: string;
	created_from_evidence_refs: string[];
	proposer_type: string;
	proposer_ref: string;
	candidate_profile_ref: Record<string, unknown>;
	status?: CandidateStatus;
	created_at?: string;
}

export function buildCandidate(input: BuildCandidateInput): HarnessCandidateContract {
	const status = input.status ?? 'PROPOSED';
	const created_at = input.created_at ?? new Date().toISOString();
	const fingerprintValue = computeCandidateFingerprint({
		parent_profile_id: input.parent_profile_id,
		parent_profile_version: input.parent_profile_version,
		parent_profile_fingerprint: input.parent_profile_fingerprint,
		candidate_version: input.candidate_version,
		hypothesis: input.hypothesis,
		created_from_evidence_refs: input.created_from_evidence_refs,
		proposer_type: input.proposer_type,
		proposer_ref: input.proposer_ref,
		candidate_profile_ref: input.candidate_profile_ref,
		status,
		candidate_id: input.candidate_id,
		candidate_fingerprint: '', // placeholder
		created_at,
		contract: 'positron.harness-candidate.v1',
	} as unknown as HarnessCandidateContract);

	const candidate: HarnessCandidateContract = {
		contract: 'positron.harness-candidate.v1',
		candidate_id: input.candidate_id,
		parent_profile_id: input.parent_profile_id,
		parent_profile_version: input.parent_profile_version,
		parent_profile_fingerprint: input.parent_profile_fingerprint,
		candidate_version: input.candidate_version,
		candidate_fingerprint: fingerprintValue,
		hypothesis: input.hypothesis,
		created_from_evidence_refs: [...input.created_from_evidence_refs].sort(),
		proposer_type: input.proposer_type,
		proposer_ref: input.proposer_ref,
		candidate_profile_ref: input.candidate_profile_ref,
		created_at,
		status,
	};

	return candidate;
}

// ---------------------------------------------------------------------------
// Status Transitions (auditable, immutable history)
// ---------------------------------------------------------------------------

export const CANDIDATE_TRANSITIONS: Record<CandidateStatus, readonly CandidateStatus[]> = {
	PROPOSED: ['VALIDATING', 'REJECTED'],
	VALIDATING: ['REJECTED', 'SHADOW', 'CANARY'],
	REJECTED: [],
	SHADOW: ['CANARY', 'REJECTED'],
	CANARY: ['PROMOTED', 'REJECTED', 'ROLLED_BACK'],
	PROMOTED: ['ROLLED_BACK'],
	ROLLED_BACK: [],
};

export function isValidTransition(from: CandidateStatus, to: CandidateStatus): boolean {
	const allowed = CANDIDATE_TRANSITIONS[from] ?? [];
	return (allowed as readonly string[]).includes(to);
}

export const CANDIDATE_CANNOT_SELF_PROMOTE = 'CANDIDATE_CANNOT_SELF_PROMOTE';
export const MODEL_CANNOT_SELF_PROMOTE = 'MODEL_CANNOT_SELF_PROMOTE';
