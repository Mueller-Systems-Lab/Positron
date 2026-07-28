// Positron — Stage 3 Supervised Pilot Policy
//
// Pure validation gatekeeper for Stage 3 controlled writes.
// Validates every input parameter, enforces quantity limits, checks process-safety
// conditions, and produces structured results.
//
// NEVER executes writes. NEVER contains tokens.
// Follows the proven Stage 2 pattern but extended for multi-phase validation.

import crypto from 'node:crypto';
import { redactValue } from '@positron/shared';
import {
	CANONICAL_BASE_BRANCH,
	CANONICAL_COMMIT_BODY,
	CANONICAL_COMMIT_MESSAGE,
	CANONICAL_COMMIT_MESSAGE_SHA256,
	CANONICAL_FILE_LENGTH,
	CANONICAL_FILE_PATH,
	CANONICAL_FILE_SHA256,
	CANONICAL_PR_BODY,
	CANONICAL_PR_METADATA_SHA256,
	CANONICAL_PR_TITLE,
	CANONICAL_REPOSITORY,
	CANONICAL_TARGET_BRANCH,
	FORBIDDEN_REPOSITORIES,
	MAX_BRANCHES,
	MAX_COMMITS,
	MAX_FILE_WRITES,
	MAX_PULL_REQUESTS,
} from './stage3-canonical-manifest.js';

// ---------------------------------------------------------------------------
// Types — Write Operations
// ---------------------------------------------------------------------------

/** Write operations that the Stage 3 policy governs. */
export type Stage3WriteOperation = 'createBranch' | 'commitFile' | 'createPullRequest';

// ---------------------------------------------------------------------------
// Types — Configuration
// ---------------------------------------------------------------------------

/** Configuration for the Stage 3 Supervised Pilot Policy. */
export interface Stage3PilotConfig {
	/** Whether the policy is active. If false, ALL writes are blocked. */
	enabled: boolean;

	/** The exact repository that is allowed for writes (owner/repo). */
	allowedRepository: string;

	/** Repositories that are unconditionally forbidden. */
	forbiddenRepositories: string[];

	/** The exact base branch from which the target branch is created. */
	allowedBaseBranch: string;

	/** The exact target branch name to create. */
	allowedTargetBranch: string;

	/** The exact file path to create in the repository. */
	allowedFilePath: string;

	/** Expected UTF-8 byte length of the file content. */
	expectedFileLength: number;

	/** Expected SHA-256 hex digest of the file content. */
	expectedFileSha256: string;

	/** Expected commit message (exact match). */
	expectedCommitMessage: string;

	/** Expected commit body (exact match, used for SHA-256 binding). */
	expectedCommitBody: string;

	/** Expected PR title (exact match). */
	expectedPrTitle: string;

	/** Expected PR body (exact match, used for SHA-256 binding). */
	expectedPrBody: string;

	/** Whether the PR must be created as a draft. */
	requireDraftPr: boolean;

	// Quantity limits
	maxBranchCount: number;
	maxFileWriteCount: number;
	maxCommitCount: number;
	maxPullRequestCount: number;

	// Gates
	requireHumanApproval: boolean;
	requirePreWritePreview: boolean;
	requireDuplicateDetection: boolean;
	requireQueueDisabled: boolean;
	requireSingleProcess: boolean;
	requireWorkspaceLock: boolean;
	requireMergeKillSwitch: boolean;
	requirePushDisabled: boolean;
}

// ---------------------------------------------------------------------------
// Types — Results
// ---------------------------------------------------------------------------

/** Result of a single gate check in a policy validation. */
export interface Stage3FailedGate {
	gate: string;
	reason: string;
}

/** Result of a policy validation check. */
export interface Stage3PilotPolicyResult {
	/** Whether ALL gates passed. */
	allowed: boolean;

	/** If not allowed, the primary reason for denial. */
	reason?: string;

	/** List of all failed gates (for diagnosis). */
	failedGates: Stage3FailedGate[];

	/** The generated preview (if allowed and preview generation was requested). */
	preview?: Stage3PreWritePreview;

	/** Redacted audit event for this validation. */
	redactedAuditEvent?: Stage3PilotAuditEvent;
}

/** Pre-write preview — safely serialisable, token-free. */
export interface Stage3PreWritePreview {
	stage: 'stage3-supervised-pilot';
	repository: string;
	baseBranch: string;
	targetBranch: string;
	filePath: string;
	fileSha256: string;
	fileLength: number;
	commitMessage: string;
	prTitle: string;
	prDraft: boolean;
	idempotencyKey: string;
	humanApproved: boolean;
	tokenValue: 'REDACTED';
	timestamp: string;
	branchCount: number;
	fileWriteCount: number;
	commitCount: number;
	pullRequestCount: number;
}

/** Redacted audit event — JSONL-compatible, no tokens, no raw API output. */
export interface Stage3PilotAuditEvent {
	stage: 'stage3-supervised-pilot';
	mode: 'fake' | 'preview' | 'live';
	operation: Stage3WriteOperation;
	repository: string;
	result: 'allowed_preview' | 'allowed_executed' | 'blocked';
	reason?: string;
	fileSha256?: string;
	fileLength?: number;
	idempotencyKey: string;
	tokenValue: 'REDACTED';
	timestamp: string;
	branchCount: number;
	commitCount: number;
	pullRequestCount: number;
	phase?: string;
}

// ---------------------------------------------------------------------------
// Types — Process Safety Input
// ---------------------------------------------------------------------------

/** Process-safety state that the policy validates. */
export interface Stage3ProcessSafety {
	/** Whether the queue is disabled (POSITRON_DISABLE_QUEUE=true). */
	queueDisabled: boolean;

	/** Whether the process is single-threaded (maxConcurrency=1). */
	singleProcess: boolean;

	/** Whether the workspace lock is acquired. */
	workspaceLockAcquired: boolean;

	/** Whether no other active run is detected. */
	noOtherActiveRun: boolean;

	/** Whether the merge kill-switch is active. */
	mergeKillSwitchActive: boolean;

	/** Whether push is disabled. */
	pushDisabled: boolean;
}

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

// Canonical values imported from stage3-canonical-manifest.ts (single source of truth).
// Local aliases for backward compatibility with existing code.
const FILE_LENGTH = CANONICAL_FILE_LENGTH;
const FILE_SHA256 = CANONICAL_FILE_SHA256;
const COMMIT_MSG = CANONICAL_COMMIT_MESSAGE;
const PR_TITLE = CANONICAL_PR_TITLE;
// CANONICAL_REPOSITORY, CANONICAL_BASE_BRANCH, CANONICAL_TARGET_BRANCH,
// CANONICAL_FILE_PATH, CANONICAL_COMMIT_BODY, CANONICAL_PR_BODY,
// FORBIDDEN_REPOSITORIES imported directly — see imports above.

/** Safe defaults that block everything until explicitly configured. */
export const STAGE3_DEFAULT_CONFIG: Stage3PilotConfig = {
	enabled: false,
	allowedRepository: CANONICAL_REPOSITORY,
	forbiddenRepositories: [...FORBIDDEN_REPOSITORIES],
	allowedBaseBranch: CANONICAL_BASE_BRANCH,
	allowedTargetBranch: CANONICAL_TARGET_BRANCH,
	allowedFilePath: CANONICAL_FILE_PATH,
	expectedFileLength: CANONICAL_FILE_LENGTH,
	expectedFileSha256: CANONICAL_FILE_SHA256,
	expectedCommitMessage: CANONICAL_COMMIT_MESSAGE,
	expectedCommitBody: CANONICAL_COMMIT_BODY,
	expectedPrTitle: CANONICAL_PR_TITLE,
	expectedPrBody: CANONICAL_PR_BODY,
	requireDraftPr: true,
	maxBranchCount: MAX_BRANCHES,
	maxFileWriteCount: MAX_FILE_WRITES,
	maxCommitCount: MAX_COMMITS,
	maxPullRequestCount: MAX_PULL_REQUESTS,
	requireHumanApproval: true,
	requirePreWritePreview: true,
	requireDuplicateDetection: true,
	requireQueueDisabled: true,
	requireSingleProcess: true,
	requireWorkspaceLock: true,
	requireMergeKillSwitch: true,
	requirePushDisabled: true,
};

// ---------------------------------------------------------------------------
// Policy Class
// ---------------------------------------------------------------------------

export class Stage3SupervisedPilotPolicy {
	private config: Stage3PilotConfig;
	private branchCount = 0;
	private fileWriteCount = 0;
	private commitCount = 0;
	private pullRequestCount = 0;
	private readonly usedIdempotencyKeys = new Set<string>();
	private _reservedRunKey: string | null = null;
	private _writeExecuted = false;
	private _partialMutation = false;
	private _currentPhase: string | null = null;
	private _writeAttempted = false;
	private _confirmedMutationCount = 0;
	private _executionLocked = false;

	constructor(config?: Partial<Stage3PilotConfig>) {
		this.config = { ...STAGE3_DEFAULT_CONFIG, ...config };
	}

	// --- Public API ---

	/**
	 * Validate whether a write operation is permitted under the current policy.
	 * This performs ALL gate checks. Does NOT execute any write.
	 */
	validate(params: {
		operation: Stage3WriteOperation;
		repository: string;
		baseBranch?: string;
		targetBranch?: string;
		filePath?: string;
		fileContent?: string;
		commitMessage?: string;
		commitBody?: string;
		prTitle?: string;
		prBody?: string;
		prDraft?: boolean;
		idempotencyKey?: string;
		humanApproved?: boolean;
		previewGenerated?: boolean;
		processSafety?: Stage3ProcessSafety;
	}): Stage3PilotPolicyResult {
		const failedGates: Stage3FailedGate[] = [];
		const { operation, repository } = params;
		const humanApproved = params.humanApproved ?? false;
		const previewGenerated = params.previewGenerated ?? false;

		// ── Gate 0: Policy enabled ──
		if (!this.config.enabled) {
			return this._deny('Stage 3 policy is not enabled', [
				{ gate: 'policyEnabled', reason: 'Stage 3 policy is not enabled' },
			]);
		}

		// ── Gate 1: Operation allowlist ──
		if (!this._isAllowedOperation(operation)) {
			return this._deny(`Operation '${operation}' is not in the allowed Stage 3 operations`, [
				{
					gate: 'operationAllowlist',
					reason: `Operation '${operation}' is not allowed in Stage 3`,
				},
			]);
		}

		// ── Gate 2: Forbidden repository detection (MUST run before allowlist) ──
		for (const forbidden of this.config.forbiddenRepositories) {
			if (repository === forbidden) {
				return this._deny(`Repository '${repository}' is forbidden for Stage 3 writes`, [
					{
						gate: 'forbiddenRepository',
						reason: `Repository '${forbidden}' is unconditionally forbidden`,
					},
				]);
			}
		}

		// ── Gate 3: Repository allowlist ──
		if (repository !== this.config.allowedRepository) {
			return this._deny(
				`Repository '${repository}' is not the allowlisted sandbox repository '${this.config.allowedRepository}'`,
				[{ gate: 'repositoryAllowlist', reason: `Repository '${repository}' is not allowlisted` }],
			);
		}

		// ── Gate 4: Base branch allowlist (for createBranch) ──
		if (operation === 'createBranch') {
			if (!params.baseBranch) {
				return this._deny('Base branch is required for branch creation', [
					{ gate: 'baseBranchRequired', reason: 'Base branch not specified' },
				]);
			}
			if (params.baseBranch !== this.config.allowedBaseBranch) {
				return this._deny(
					`Base branch '${params.baseBranch}' is not the allowlisted base branch '${this.config.allowedBaseBranch}'`,
					[
						{
							gate: 'baseBranchAllowlist',
							reason: `Base branch '${params.baseBranch}' is not allowlisted`,
						},
					],
				);
			}
		}

		// ── Gate 5: Target branch allowlist (for createBranch) ──
		if (operation === 'createBranch') {
			if (!params.targetBranch) {
				return this._deny('Target branch is required for branch creation', [
					{ gate: 'targetBranchRequired', reason: 'Target branch not specified' },
				]);
			}
			if (params.targetBranch !== this.config.allowedTargetBranch) {
				return this._deny(
					`Target branch '${params.targetBranch}' is not the allowlisted branch '${this.config.allowedTargetBranch}'`,
					[
						{
							gate: 'targetBranchAllowlist',
							reason: `Target branch '${params.targetBranch}' is not allowlisted`,
						},
					],
				);
			}
		}

		// ── Gate 6: File path allowlist (for commitFile) ──
		if (operation === 'commitFile') {
			if (!params.filePath) {
				return this._deny('File path is required for file commit', [
					{ gate: 'filePathRequired', reason: 'File path not specified' },
				]);
			}
			if (params.filePath !== this.config.allowedFilePath) {
				return this._deny(
					`File path '${params.filePath}' is not the allowlisted path '${this.config.allowedFilePath}'`,
					[
						{
							gate: 'filePathAllowlist',
							reason: `File path '${params.filePath}' is not allowlisted`,
						},
					],
				);
			}

			// ── Gate 7: File content present ──
			if (!params.fileContent) {
				return this._deny('File content is required for file commit', [
					{ gate: 'fileContentRequired', reason: 'File content not provided' },
				]);
			}

			// ── Gate 7b: Token pattern check (MUST run before hash/length) ──
			if (_containsTokenPattern(params.fileContent)) {
				return this._deny('Raw token pattern detected in policy input — rejected', [
					{ gate: 'tokenInInput', reason: 'Raw token pattern detected in input' },
				]);
			}

			// ── Gate 8: SHA-256 check (MUST run before length for correct error priority) ──
			const actualSha256 = _sha256(params.fileContent);
			if (actualSha256 !== this.config.expectedFileSha256) {
				return this._deny(
					`File SHA-256 mismatch: expected ${this.config.expectedFileSha256}, got ${actualSha256}`,
					[{ gate: 'fileSha256', reason: 'SHA-256 mismatch' }],
				);
			}

			// ── Gate 9: File length check ──
			const actualLength = Buffer.byteLength(params.fileContent, 'utf8');
			if (actualLength !== this.config.expectedFileLength) {
				return this._deny(
					`File length mismatch: expected ${this.config.expectedFileLength}, got ${actualLength}`,
					[
						{
							gate: 'fileLength',
							reason: `File length ${actualLength} ≠ expected ${this.config.expectedFileLength}`,
						},
					],
				);
			}

			// ── Gate 10: Commit message check ──
			if (params.commitMessage !== this.config.expectedCommitMessage) {
				return this._deny(
					`Commit message does not match expected: '${this.config.expectedCommitMessage}'`,
					[{ gate: 'commitMessage', reason: 'Commit message mismatch' }],
				);
			}

			// ── Gate 11: Commit body check ──
			if (params.commitBody !== this.config.expectedCommitBody) {
				return this._deny('Commit body does not match expected', [
					{ gate: 'commitBody', reason: 'Commit body mismatch' },
				]);
			}
		}

		// ── Gate 12: PR title check (for createPullRequest) ──
		if (operation === 'createPullRequest') {
			if (!params.prTitle) {
				return this._deny('PR title is required for PR creation', [
					{ gate: 'prTitleRequired', reason: 'PR title not specified' },
				]);
			}
			if (params.prTitle !== this.config.expectedPrTitle) {
				return this._deny(`PR title does not match expected: '${this.config.expectedPrTitle}'`, [
					{ gate: 'prTitle', reason: 'PR title mismatch' },
				]);
			}

			// ── Gate 13: PR body check ──
			if (params.prBody !== this.config.expectedPrBody) {
				return this._deny('PR body does not match expected', [
					{ gate: 'prBody', reason: 'PR body mismatch' },
				]);
			}

			// ── Gate 14: Draft PR enforcement ──
			if (this.config.requireDraftPr && !params.prDraft) {
				return this._deny('PR must be created as Draft — non-draft PRs are forbidden in Stage 3', [
					{ gate: 'draftPr', reason: 'PR draft flag not set' },
				]);
			}
		}

		// ── Gate 15: Quantity limits (per operation) ──
		if (operation === 'createBranch' && this.branchCount >= this.config.maxBranchCount) {
			return this._deny(`Max branches per run (${this.config.maxBranchCount}) already reached`, [
				{
					gate: 'branchCount',
					reason: `Branch count ${this.branchCount} ≥ max ${this.config.maxBranchCount}`,
				},
			]);
		}
		if (operation === 'commitFile' && this.fileWriteCount >= this.config.maxFileWriteCount) {
			return this._deny(
				`Max file writes per run (${this.config.maxFileWriteCount}) already reached`,
				[
					{
						gate: 'fileWriteCount',
						reason: `File write count ${this.fileWriteCount} ≥ max ${this.config.maxFileWriteCount}`,
					},
				],
			);
		}
		if (operation === 'commitFile' && this.commitCount >= this.config.maxCommitCount) {
			return this._deny(`Max commits per run (${this.config.maxCommitCount}) already reached`, [
				{
					gate: 'commitCount',
					reason: `Commit count ${this.commitCount} ≥ max ${this.config.maxCommitCount}`,
				},
			]);
		}
		if (
			operation === 'createPullRequest' &&
			this.pullRequestCount >= this.config.maxPullRequestCount
		) {
			return this._deny(`Max PRs per run (${this.config.maxPullRequestCount}) already reached`, [
				{
					gate: 'pullRequestCount',
					reason: `PR count ${this.pullRequestCount} ≥ max ${this.config.maxPullRequestCount}`,
				},
			]);
		}

		// ── Gate 16: Process safety ──
		if (params.processSafety) {
			const ps = params.processSafety;
			if (this.config.requireQueueDisabled && !ps.queueDisabled) {
				return this._deny('Queue must be disabled (POSITRON_DISABLE_QUEUE=true) for Stage 3', [
					{ gate: 'queueDisabled', reason: 'Queue is active — must be disabled' },
				]);
			}
			if (this.config.requireSingleProcess && !ps.singleProcess) {
				return this._deny('Single process required — concurrency must be 1', [
					{ gate: 'singleProcess', reason: 'Concurrency > 1 detected' },
				]);
			}
			if (this.config.requireWorkspaceLock && !ps.workspaceLockAcquired) {
				return this._deny('Workspace lock must be acquired before Stage 3 writes', [
					{ gate: 'workspaceLock', reason: 'Workspace lock not acquired' },
				]);
			}
			if (!ps.noOtherActiveRun) {
				return this._deny('Another active run detected — only one Stage 3 run is allowed', [
					{ gate: 'noOtherActiveRun', reason: 'Another run is active' },
				]);
			}
			if (this.config.requireMergeKillSwitch && !ps.mergeKillSwitchActive) {
				return this._deny('Merge kill-switch must be active for Stage 3', [
					{ gate: 'mergeKillSwitch', reason: 'POSITRON_MERGE_KILL_SWITCH is not active' },
				]);
			}
			if (this.config.requirePushDisabled && !ps.pushDisabled) {
				return this._deny('Push must be disabled for Stage 3', [
					{ gate: 'pushDisabled', reason: 'POSITRON_ENABLE_PUSH is true' },
				]);
			}
		} else {
			// Process safety input is required
			return this._deny('Process safety state is required for Stage 3 validation', [
				{ gate: 'processSafety', reason: 'Process safety state not provided' },
			]);
		}

		// ── Gate 17: Human approval ──
		if (this.config.requireHumanApproval && !humanApproved) {
			return this._deny('Human approval is required before Stage 3 writes', [
				{ gate: 'humanApproval', reason: 'Human approval not granted' },
			]);
		}

		// ── Gate 18: Pre-write preview ──
		if (this.config.requirePreWritePreview && !previewGenerated) {
			return this._deny('Pre-write preview must be generated before Stage 3 writes', [
				{ gate: 'prewritePreview', reason: 'Preview not generated' },
			]);
		}

		// ── Gate 19: Duplicate detection (idempotency key) ──
		// For multi-phase runs, the same key is reused across operations.
		// The idempotency key is only checked for duplicates against DIFFERENT runs.
		// Once reserved, subsequent calls with the same key are allowed
		// (they belong to the same run).
		if (this.config.requireDuplicateDetection) {
			if (!params.idempotencyKey) {
				return this._deny('Idempotency key is required for duplicate detection', [
					{ gate: 'idempotencyKey', reason: 'Idempotency key not provided' },
				]);
			}
			// Only block if the key was used in a DIFFERENT run (i.e., already in the set
			// but not the currently reserved key for this multi-phase run).
			const isReservedForThisRun = params.idempotencyKey === this._reservedRunKey;
			if (!isReservedForThisRun && this.usedIdempotencyKeys.has(params.idempotencyKey)) {
				return this._deny(`Duplicate idempotency key detected: '${params.idempotencyKey}'`, [
					{ gate: 'duplicateKey', reason: 'Idempotency key already used by a different run' },
				]);
			}
		}

		// All gates passed
		return { allowed: true, failedGates: [] };
	}

	/**
	 * Generate a pre-write preview. Token-free, safe for logging.
	 */
	generatePreview(params: {
		repository: string;
		baseBranch: string;
		targetBranch: string;
		filePath: string;
		fileContent: string;
		commitMessage: string;
		prTitle: string;
		prDraft: boolean;
		idempotencyKey: string;
		humanApproved: boolean;
	}): Stage3PreWritePreview {
		const fileSha256 = _sha256(params.fileContent);
		const fileLength = Buffer.byteLength(params.fileContent, 'utf8');

		return {
			stage: 'stage3-supervised-pilot',
			repository: params.repository,
			baseBranch: params.baseBranch,
			targetBranch: params.targetBranch,
			filePath: params.filePath,
			fileSha256,
			fileLength,
			commitMessage: params.commitMessage,
			prTitle: params.prTitle,
			prDraft: params.prDraft,
			idempotencyKey: params.idempotencyKey,
			humanApproved: params.humanApproved,
			tokenValue: 'REDACTED',
			timestamp: new Date().toISOString(),
			branchCount: this.branchCount,
			fileWriteCount: this.fileWriteCount,
			commitCount: this.commitCount,
			pullRequestCount: this.pullRequestCount,
		};
	}

	/**
	 * Create a redacted audit event. Never includes tokens, headers, or full API output.
	 */
	createAuditEvent(params: {
		mode: 'fake' | 'preview' | 'live';
		operation: Stage3WriteOperation;
		repository: string;
		result: 'allowed_preview' | 'allowed_executed' | 'blocked';
		reason?: string;
		fileSha256?: string;
		fileLength?: number;
		idempotencyKey: string;
		phase?: string;
	}): Stage3PilotAuditEvent {
		let sanitizedReason: string | undefined;
		if (params.reason) {
			sanitizedReason = redactValue(params.reason);
		}

		return {
			stage: 'stage3-supervised-pilot',
			mode: params.mode,
			operation: params.operation,
			repository: params.repository,
			result: params.result,
			reason: sanitizedReason,
			fileSha256: params.fileSha256,
			fileLength: params.fileLength,
			idempotencyKey: params.idempotencyKey,
			tokenValue: 'REDACTED',
			timestamp: new Date().toISOString(),
			branchCount: this.branchCount,
			commitCount: this.commitCount,
			pullRequestCount: this.pullRequestCount,
			phase: params.phase,
		};
	}

	// --- State Tracking ---

	/**
	 * Record that a branch has been created (increment counter).
	 */
	recordBranchCreated(): void {
		this.branchCount++;
		this._confirmedMutationCount++;
	}

	/**
	 * Record that a file write (commit) has been executed.
	 */
	recordFileWrite(): void {
		this.fileWriteCount++;
		this.commitCount++;
		this._confirmedMutationCount++;
	}

	/**
	 * Record that a PR has been created.
	 */
	recordPrCreated(): void {
		this.pullRequestCount++;
		this._confirmedMutationCount++;
	}

	/**
	 * Record idempotency key without incrementing counters.
	 */
	recordIdempotencyKey(idempotencyKey: string): void {
		this.usedIdempotencyKeys.add(idempotencyKey);
	}

	/**
	 * Reserve the idempotency key for a multi-phase run.
	 * Checks for duplicates first, then reserves so subsequent operations
	 * within the same run can reuse the key without being blocked.
	 * Returns false if the key was already used by a different run.
	 */
	reserveRunKey(idempotencyKey: string): boolean {
		if (this.usedIdempotencyKeys.has(idempotencyKey)) {
			return false;
		}
		this.usedIdempotencyKeys.add(idempotencyKey);
		this._reservedRunKey = idempotencyKey;
		this._executionLocked = true; // --- lock config and state mutations once run key reserved ---
		return true;
	}

	/**
	 * Mark that a write has been attempted (before adapter call).
	 */
	markWriteAttempted(): void {
		this._writeAttempted = true;
	}

	/**
	 * Mark that a write has been executed AND confirmed.
	 * Also increments the confirmed mutation counter.
	 */
	markWriteExecuted(): void {
		this._writeExecuted = true;
		this._confirmedMutationCount++;
	}

	/**
	 * Mark that a partial mutation has occurred.
	 */
	markPartialMutation(): void {
		this._partialMutation = true;
	}

	/**
	 * Set the current execution phase.
	 */
	setCurrentPhase(phase: string | null): void {
		this._currentPhase = phase;
	}

	// --- Getters ---

	getBranchCount(): number {
		return this.branchCount;
	}
	getFileWriteCount(): number {
		return this.fileWriteCount;
	}
	getCommitCount(): number {
		return this.commitCount;
	}
	getPullRequestCount(): number {
		return this.pullRequestCount;
	}
	getWriteExecuted(): boolean {
		return this._writeExecuted;
	}
	getPartialMutation(): boolean {
		return this._partialMutation;
	}
	getWriteAttempted(): boolean {
		return this._writeAttempted;
	}
	getConfirmedMutationCount(): number {
		return this._confirmedMutationCount;
	}
	getCurrentPhase(): string | null {
		return this._currentPhase;
	}
	isExecutionLocked(): boolean {
		return this._executionLocked;
	}

	/** Unlock execution (called after execution completes/aborts). Only use in harness finally block. */
	unlockExecution(): void {
		this._executionLocked = false;
	}

	/** Get current configuration (read-only snapshot). */
	getConfig(): Readonly<Stage3PilotConfig> {
		return { ...this.config };
	}

	/** Update configuration at runtime. BLOCKED during active execution. */
	updateConfig(partial: Partial<Stage3PilotConfig>): void {
		if (this._executionLocked) {
			throw new Error('Cannot modify Stage 3 policy configuration during active execution');
		}
		this.config = { ...this.config, ...partial };
	}

	/** Reset all state. BLOCKED during active execution. */
	reset(): void {
		if (this._executionLocked) {
			throw new Error('Cannot reset Stage 3 policy state during active execution');
		}
		this.branchCount = 0;
		this.fileWriteCount = 0;
		this.commitCount = 0;
		this.pullRequestCount = 0;
		this.usedIdempotencyKeys.clear();
		this._reservedRunKey = null;
		this._writeExecuted = false;
		this._partialMutation = false;
		this._writeAttempted = false;
		this._confirmedMutationCount = 0;
		this._currentPhase = null;
		this._executionLocked = false;
	}

	// --- Helpers ---

	private _isAllowedOperation(op: Stage3WriteOperation): boolean {
		return op === 'createBranch' || op === 'commitFile' || op === 'createPullRequest';
	}

	private _deny(reason: string, gates: Stage3FailedGate[]): Stage3PilotPolicyResult {
		return { allowed: false, reason, failedGates: gates };
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Stage 3 policy instance with the canonical sandbox defaults.
 * All values from the approval package.
 */
export function createStage3PilotPolicy(
	overrides?: Partial<Stage3PilotConfig>,
): Stage3SupervisedPilotPolicy {
	return new Stage3SupervisedPilotPolicy({
		...STAGE3_DEFAULT_CONFIG,
		enabled: true,
		...overrides,
	});
}

// ---------------------------------------------------------------------------
// Canonical Values (exported for tests)
// ---------------------------------------------------------------------------

export const STAGE3_CANONICAL = {
	repository: CANONICAL_REPOSITORY,
	baseBranch: CANONICAL_BASE_BRANCH,
	targetBranch: CANONICAL_TARGET_BRANCH,
	filePath: CANONICAL_FILE_PATH,
	fileLength: CANONICAL_FILE_LENGTH,
	fileUtf8ByteLength: CANONICAL_FILE_LENGTH,
	fileSha256: CANONICAL_FILE_SHA256,
	commitMessage: CANONICAL_COMMIT_MESSAGE,
	commitBody: CANONICAL_COMMIT_BODY,
	commitMetadataSha256: CANONICAL_COMMIT_MESSAGE_SHA256,
	prTitle: CANONICAL_PR_TITLE,
	prBody: CANONICAL_PR_BODY,
	prMetadataSha256: CANONICAL_PR_METADATA_SHA256,
} as const;

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function _sha256(input: string): string {
	return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function _containsTokenPattern(input: string): boolean {
	// Match the same patterns as redactSecrets in @positron/shared
	const patterns = [/ghp_[a-zA-Z0-9]{36,}/, /github_pat_[a-zA-Z0-9_]{82}/, /gho_[a-zA-Z0-9]{36,}/];
	return patterns.some((p) => p.test(input));
}
