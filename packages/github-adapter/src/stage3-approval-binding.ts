// Positron — Stage 3 Approval Binding
//
// Replaces the insecure `humanApproved: boolean` with a structured,
// cryptographically-bound approval that ties the owner's approval to
// exact repository, branch, file, commit, and PR metadata.
//
// In live mode, the harness MUST receive a valid, non-expired
// Stage3ApprovalBinding — a bare `humanApproved: true` is no longer
// sufficient. Fake mode may use synthetic bindings for testing.

import crypto from 'node:crypto';
import {
	CANONICAL_BASE_BRANCH,
	CANONICAL_FILE_LENGTH,
	CANONICAL_FILE_PATH,
	CANONICAL_FILE_SHA256,
	CANONICAL_REPOSITORY,
	CANONICAL_TARGET_BRANCH,
} from './stage3-canonical-manifest.js';

// ---------------------------------------------------------------------------
// Approval Binding Interface
// ---------------------------------------------------------------------------

/** Structured owner approval with cryptographic binding to exact parameters. */
export interface Stage3ApprovalBinding {
	/** Protocol version for forward compatibility. */
	version: 'stage3-approval-v1';

	/** SHA-256 of the human-readable approval text. */
	approvalTextSha256: string;

	/** Repository in owner/repo format. */
	repository: string;

	/** Base branch to create from (e.g. 'main'). */
	baseBranch: string;

	/** Expected SHA of the base branch at time of approval (TOCTOU protection). */
	expectedBaseSha: string;

	/** Target branch to create. */
	targetBranch: string;

	/** Exact file path to write. */
	filePath: string;

	/** UTF-8 byte length of the file content. */
	fileUtf8ByteLength: number;

	/** SHA-256 of the file content. */
	fileSha256: string;

	/** SHA-256 of the commit message + body. */
	commitMetadataSha256: string;

	/** SHA-256 of the PR title + body. */
	prMetadataSha256: string;

	/** Maximum branches allowed (must be 1). */
	maxBranches: 1;

	/** Maximum file writes allowed (must be 1). */
	maxFileWrites: 1;

	/** Maximum commits allowed (must be 1). */
	maxCommits: 1;

	/** Maximum pull requests allowed (must be 1). */
	maxPullRequests: 1;

	/** Merge must be forbidden. */
	mergeForbidden: true;

	/** ISO 8601 timestamp after which the approval is invalid. */
	expiresAt: string;
}

// ---------------------------------------------------------------------------
// Approval Text — what the owner actually signs
// ---------------------------------------------------------------------------

/**
 * Generate the human-readable approval text that the owner would review.
 * This text is hashed and stored in the binding — changing any parameter
 * changes the hash and invalidates the binding.
 */
export function generateApprovalText(params: {
	repository: string;
	baseBranch: string;
	expectedBaseSha: string;
	targetBranch: string;
	filePath: string;
	fileUtf8ByteLength: number;
	fileSha256: string;
	commitMetadataSha256: string;
	prMetadataSha256: string;
	expiresAt: string;
}): string {
	return [
		'# Positron Stage 3 — Supervised Pilot Approval',
		'',
		'By approving this document, the owner authorizes a SINGLE controlled write operation:',
		'',
		'## Operation Parameters',
		`- Repository: ${params.repository}`,
		`- Base branch: ${params.baseBranch} (SHA: ${params.expectedBaseSha})`,
		`- Target branch: ${params.targetBranch}`,
		`- File: ${params.filePath} (${params.fileUtf8ByteLength} bytes, SHA-256: ${params.fileSha256})`,
		`- Commit metadata SHA-256: ${params.commitMetadataSha256}`,
		`- PR metadata SHA-256: ${params.prMetadataSha256}`,
		'',
		'## Boundaries',
		'- Maximum 1 branch, 1 commit, 1 file, 1 draft PR',
		'- Merge is FORBIDDEN',
		'- No labels, no review requests, no issue close',
		'',
		'## Expiration',
		`This approval expires at: ${params.expiresAt}`,
		'',
		'## Acknowledgment',
		'I understand that once this approval is used, the Stage 3 runtime will',
		'create exactly one branch, one commit, and one draft PR on the sandbox',
		'repository. No merge will be performed.',
	].join('\n');
}

// ---------------------------------------------------------------------------
// Hash Computation
// ---------------------------------------------------------------------------

/** Compute SHA-256 of the approval text. */
export function computeApprovalTextSha256(text: string): string {
	return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Binding Creation
// ---------------------------------------------------------------------------

/**
 * Create a complete approval binding from canonical manifest values
 * and the owner's signed approval text.
 */
export function createApprovalBinding(params: {
	approvalText: string;
	repository: string;
	baseBranch: string;
	expectedBaseSha: string;
	targetBranch: string;
	filePath: string;
	fileUtf8ByteLength: number;
	fileSha256: string;
	commitMetadataSha256: string;
	prMetadataSha256: string;
	expiresAt: string;
}): Stage3ApprovalBinding {
	const approvalTextSha256 = computeApprovalTextSha256(params.approvalText);

	return {
		version: 'stage3-approval-v1',
		approvalTextSha256,
		repository: params.repository,
		baseBranch: params.baseBranch,
		expectedBaseSha: params.expectedBaseSha,
		targetBranch: params.targetBranch,
		filePath: params.filePath,
		fileUtf8ByteLength: params.fileUtf8ByteLength,
		fileSha256: params.fileSha256,
		commitMetadataSha256: params.commitMetadataSha256,
		prMetadataSha256: params.prMetadataSha256,
		maxBranches: 1,
		maxFileWrites: 1,
		maxCommits: 1,
		maxPullRequests: 1,
		mergeForbidden: true,
		expiresAt: params.expiresAt,
	};
}

// ---------------------------------------------------------------------------
// Preview (token-free, for display)
// ---------------------------------------------------------------------------

/** Token-free preview of the approval binding for safe display. */
export interface Stage3ApprovalBindingPreview {
	version: 'stage3-approval-v1';
	approvalTextSha256: string;
	repository: string;
	baseBranch: string;
	expectedBaseSha: string;
	targetBranch: string;
	filePath: string;
	fileUtf8ByteLength: number;
	fileSha256: string;
	expiresAt: string;
	bindingFingerprint: string;
}

/** Create a token-free, safe-to-display preview of the binding. */
export function createApprovalBindingPreview(
	binding: Stage3ApprovalBinding,
): Stage3ApprovalBindingPreview {
	return {
		version: binding.version,
		approvalTextSha256: binding.approvalTextSha256,
		repository: binding.repository,
		baseBranch: binding.baseBranch,
		expectedBaseSha: binding.expectedBaseSha,
		targetBranch: binding.targetBranch,
		filePath: binding.filePath,
		fileUtf8ByteLength: binding.fileUtf8ByteLength,
		fileSha256: binding.fileSha256,
		expiresAt: binding.expiresAt,
		bindingFingerprint: computeBindingFingerprint(binding),
	};
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Result of approval binding validation. */
export interface Stage3ApprovalValidationResult {
	valid: boolean;
	reason?: string;
	failedChecks: string[];
}

/**
 * Validate an approval binding against canonical values and runtime state.
 * In live mode, all checks must pass. Fake mode may skip validation.
 */
export function validateApprovalBinding(
	binding: Stage3ApprovalBinding,
	canonical: {
		repository: string;
		baseBranch: string;
		targetBranch: string;
		filePath: string;
		fileUtf8ByteLength: number;
		fileSha256: string;
		commitMetadataSha256: string;
		prMetadataSha256: string;
	},
): Stage3ApprovalValidationResult {
	const failed: string[] = [];

	// Version check
	if (binding.version !== 'stage3-approval-v1') {
		failed.push('Unsupported approval binding version');
	}

	// Repository must match
	if (binding.repository !== canonical.repository) {
		failed.push(
			`Repository mismatch: binding='${binding.repository}' canonical='${canonical.repository}'`,
		);
	}

	// Base branch must match
	if (binding.baseBranch !== canonical.baseBranch) {
		failed.push(
			`Base branch mismatch: binding='${binding.baseBranch}' canonical='${canonical.baseBranch}'`,
		);
	}

	// Target branch must match
	if (binding.targetBranch !== canonical.targetBranch) {
		failed.push(
			`Target branch mismatch: binding='${binding.targetBranch}' canonical='${canonical.targetBranch}'`,
		);
	}

	// File path must match
	if (binding.filePath !== canonical.filePath) {
		failed.push(
			`File path mismatch: binding='${binding.filePath}' canonical='${canonical.filePath}'`,
		);
	}

	// File byte length must match
	if (binding.fileUtf8ByteLength !== canonical.fileUtf8ByteLength) {
		failed.push(
			`File length mismatch: binding=${binding.fileUtf8ByteLength} canonical=${canonical.fileUtf8ByteLength}`,
		);
	}

	// File SHA-256 must match
	if (binding.fileSha256 !== canonical.fileSha256) {
		failed.push(
			`File SHA-256 mismatch: binding='${binding.fileSha256}' canonical='${canonical.fileSha256}'`,
		);
	}

	// Commit metadata SHA-256 must match
	if (binding.commitMetadataSha256 !== canonical.commitMetadataSha256) {
		failed.push('Commit metadata SHA-256 mismatch');
	}

	// PR metadata SHA-256 must match
	if (binding.prMetadataSha256 !== canonical.prMetadataSha256) {
		failed.push('PR metadata SHA-256 mismatch');
	}

	// Quantity limits must be exactly 1
	if (binding.maxBranches !== 1) failed.push('maxBranches must be 1');
	if (binding.maxFileWrites !== 1) failed.push('maxFileWrites must be 1');
	if (binding.maxCommits !== 1) failed.push('maxCommits must be 1');
	if (binding.maxPullRequests !== 1) failed.push('maxPullRequests must be 1');

	// Merge must be forbidden
	if (binding.mergeForbidden !== true) {
		failed.push('mergeForbidden must be true');
	}

	// Expiration check
	if (isApprovalExpired(binding)) {
		failed.push(`Approval expired at ${binding.expiresAt}`);
	}

	return {
		valid: failed.length === 0,
		reason: failed.length > 0 ? failed.join('; ') : undefined,
		failedChecks: failed,
	};
}

// ---------------------------------------------------------------------------
// Expiration
// ---------------------------------------------------------------------------

/** Check whether an approval binding has expired. */
export function isApprovalExpired(binding: Stage3ApprovalBinding): boolean {
	const expiresDate = new Date(binding.expiresAt);
	if (Number.isNaN(expiresDate.getTime())) {
		return true; // Invalid date → expired (fail-closed)
	}
	return Date.now() > expiresDate.getTime();
}

// ---------------------------------------------------------------------------
// Fingerprint (for display / preview)
// ---------------------------------------------------------------------------

/** Compute a short fingerprint of the binding for display purposes. */
export function computeBindingFingerprint(binding: Stage3ApprovalBinding): string {
	const canonical = JSON.stringify({
		v: binding.version,
		r: binding.repository,
		bb: binding.baseBranch,
		bs: binding.expectedBaseSha.slice(0, 12),
		tb: binding.targetBranch,
		fp: binding.filePath,
		fl: binding.fileUtf8ByteLength,
		fs: binding.fileSha256.slice(0, 12),
		e: binding.expiresAt,
	});
	return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Synthetic Binding (for fake mode / testing)
// ---------------------------------------------------------------------------

/**
 * Create a synthetic approval binding for fake mode testing.
 * NOT valid for live mode — the approval text hash is a known test value.
 */
export function createSyntheticApprovalBinding(
	overrides?: Partial<Stage3ApprovalBinding>,
): Stage3ApprovalBinding {
	const base: Stage3ApprovalBinding = {
		version: 'stage3-approval-v1',
		approvalTextSha256: 'synthetic-test-binding-not-for-live-use',
		repository: CANONICAL_REPOSITORY,
		baseBranch: CANONICAL_BASE_BRANCH,
		expectedBaseSha: '0000000000000000000000000000000000000000000000000000000000000000',
		targetBranch: CANONICAL_TARGET_BRANCH,
		filePath: CANONICAL_FILE_PATH,
		fileUtf8ByteLength: CANONICAL_FILE_LENGTH,
		fileSha256: CANONICAL_FILE_SHA256,
		commitMetadataSha256: 'synthetic-commit-hash',
		prMetadataSha256: 'synthetic-pr-hash',
		maxBranches: 1,
		maxFileWrites: 1,
		maxCommits: 1,
		maxPullRequests: 1,
		mergeForbidden: true,
		expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
	};

	return { ...base, ...overrides };
}
