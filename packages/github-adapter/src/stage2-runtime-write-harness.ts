// Positron — Stage 2 Runtime Write Harness
//
// Connects Stage2WriteSandboxPolicy validation to the issue-comment writer boundary.
// This module MUST NOT be called with a real GitHub token in this implementation.
// All operations are gated through the policy before any adapter call.
//
// Supported in this implementation: createIssueComment ONLY.
// Everything else is permanently blocked in Stage 2.

import crypto from 'node:crypto';
import { redactValue } from '@positron/shared';
import type {
	Stage2PreWritePreview,
	Stage2WriteAuditEvent,
	Stage2WriteOperation,
	Stage2WriteSandboxConfig,
} from './stage2-write-sandbox-policy.js';
import {
	STAGE2_PERMANENTLY_FORBIDDEN,
	Stage2WriteSandboxPolicy,
} from './stage2-write-sandbox-policy.js';

// ---------------------------------------------------------------------------
// Adapter Interface for Dependency Injection
// ---------------------------------------------------------------------------

/**
 * Minimal adapter contract that the harness requires.
 * Kept deliberately narrow — only the methods Stage 2 needs.
 */
export interface Stage2IssueCommentWriter {
	createIssueComment(input: {
		owner: string;
		repo: string;
		issueNumber: number;
		body: string;
	}): Promise<{
		id?: string | number;
		url?: string;
		createdAt?: string;
	}>;
}

// ---------------------------------------------------------------------------
// Input / Output Types
// ---------------------------------------------------------------------------

/** Input for the harness execute function. */
export interface Stage2WriteHarnessInput {
	/** Repository in owner/repo format. */
	repository: string;
	/** Target issue number. */
	issueNumber: number;
	/** The write operation to perform. */
	operation: Stage2WriteOperation;
	/** Comment body (for createIssueComment). */
	bodyText?: string;
	/** Labels to add (for addIssueLabels). */
	labelNames?: string[];
	/** Idempotency key for duplicate detection. */
	idempotencyKey: string;
	/** Whether human approval has been granted for this exact operation. */
	humanApproved: boolean;
	/** Whether a pre-write preview has been generated. */
	previewGenerated: boolean;
	/** Body SHA-256 expected for approval binding. */
	expectedBodyHash?: string;
	/** Whether push is enabled (must be false for Stage 2). */
	pushEnabled?: boolean;
	/** Whether merge kill-switch is active (must be true for Stage 2). */
	mergeKillSwitchActive?: boolean;
}

/** Result of the harness execution. */
export interface Stage2WriteHarnessResult {
	/** Whether the write was successfully executed. */
	success: boolean;
	/** If not successful, the reason. */
	reason?: string;
	/** The policy result. */
	policyAllowed: boolean;
	/** If allowed, the pre-write preview. */
	preview?: Stage2PreWritePreview;
	/** The redacted audit event. */
	auditEvent: Stage2WriteAuditEvent;
	/** Current write count after this operation. */
	writeCount: number;
	/** If successful, the comment metadata. */
	commentResult?: {
		id?: string | number;
		url?: string;
		createdAt?: string;
	};
	/** Whether the harness is in fake mode. */
	mode: 'fake' | 'preview' | 'live';
	/** Whether a real write was executed. */
	writeExecuted: boolean;
}

// ---------------------------------------------------------------------------
// Audit Sink Interface
// ---------------------------------------------------------------------------

/** Simple audit sink that the harness uses to record events. */
export interface Stage2AuditSink {
	record(event: Stage2WriteAuditEvent): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Harness Configuration
// ---------------------------------------------------------------------------

export interface Stage2WriteHarnessConfig {
	/** Whether the harness is enabled. If false, all writes are blocked. */
	enabled: boolean;
	/** Maximum writes per run. */
	maxWritesPerRun: number;
	/** Whether the harness is in fake mode. In fake mode, writes are simulated. */
	fakeMode: boolean;
}

// ---------------------------------------------------------------------------
// Runtime Harness
// ---------------------------------------------------------------------------

export class Stage2RuntimeWriteHarness {
	private policy: Stage2WriteSandboxPolicy;
	private adapter: Stage2IssueCommentWriter;
	private auditSink?: Stage2AuditSink;
	private config: Stage2WriteHarnessConfig;
	private writeCount = 0;

	constructor(params: {
		policy: Stage2WriteSandboxPolicy;
		adapter: Stage2IssueCommentWriter;
		auditSink?: Stage2AuditSink;
		config?: Partial<Stage2WriteHarnessConfig>;
	}) {
		this.policy = params.policy;
		this.adapter = params.adapter;
		this.auditSink = params.auditSink;
		this.config = {
			enabled: true,
			maxWritesPerRun: 1,
			fakeMode: true,
			...params.config,
		};
		this.writeCount = 0;
	}

	/**
	 * Execute a sandbox write through the policy gate.
	 * The harness validates through Stage2WriteSandboxPolicy, then calls the adapter
	 * ONLY if the policy allows the operation.
	 *
	 * In fake mode, the adapter is NOT called even if the policy allows the operation.
	 */
	async execute(input: Stage2WriteHarnessInput): Promise<Stage2WriteHarnessResult> {
		const mode: 'fake' | 'preview' | 'live' = this.config.fakeMode ? 'fake' : 'live';
		const timestamp = new Date().toISOString();

		// --- 0. Harness-level gate ---
		if (!this.config.enabled) {
			const auditEvent = this._buildAuditEvent({
				mode,
				operation: input.operation,
				repository: input.repository,
				issueNumber: input.issueNumber,
				result: 'blocked',
				reason: 'Stage 2 runtime write harness is not enabled',
				idempotencyKey: input.idempotencyKey,
			});
			await this._emitAudit(auditEvent);
			return {
				success: false,
				reason: 'Stage 2 runtime write harness is not enabled',
				policyAllowed: false,
				auditEvent,
				writeCount: this.writeCount,
				mode,
				writeExecuted: false,
			};
		}

		// --- 1. Permanently forbidden operations ---
		if (STAGE2_PERMANENTLY_FORBIDDEN.has(input.operation)) {
			const auditEvent = this._buildAuditEvent({
				mode,
				operation: input.operation,
				repository: input.repository,
				issueNumber: input.issueNumber,
				result: 'blocked',
				reason: `Operation '${input.operation}' is permanently forbidden in Stage 2`,
				idempotencyKey: input.idempotencyKey,
			});
			await this._emitAudit(auditEvent);
			return {
				success: false,
				reason: `Operation '${input.operation}' is permanently forbidden in Stage 2`,
				policyAllowed: false,
				auditEvent,
				writeCount: this.writeCount,
				mode,
				writeExecuted: false,
			};
		}

		// --- 2. Approval binding: body hash match ---
		if (input.operation === 'createIssueComment' && input.bodyText && input.expectedBodyHash) {
			const actualHash = _sha256(input.bodyText);
			if (actualHash !== input.expectedBodyHash) {
				const auditEvent = this._buildAuditEvent({
					mode,
					operation: input.operation,
					repository: input.repository,
					issueNumber: input.issueNumber,
					result: 'blocked',
					reason: `Body SHA-256 mismatch: expected ${input.expectedBodyHash}, got ${actualHash}`,
					bodyHash: actualHash,
					idempotencyKey: input.idempotencyKey,
				});
				await this._emitAudit(auditEvent);
				return {
					success: false,
					reason: `Body SHA-256 mismatch: expected ${input.expectedBodyHash}, got ${actualHash}`,
					policyAllowed: false,
					auditEvent,
					writeCount: this.writeCount,
					mode,
					writeExecuted: false,
				};
			}
		}

		// --- 3. MaxWritesPerRun harness-level enforcement ---
		if (this.writeCount >= this.config.maxWritesPerRun) {
			const auditEvent = this._buildAuditEvent({
				mode,
				operation: input.operation,
				repository: input.repository,
				issueNumber: input.issueNumber,
				result: 'blocked',
				reason: `Max writes per run (${this.config.maxWritesPerRun}) exceeded (current: ${this.writeCount})`,
				idempotencyKey: input.idempotencyKey,
			});
			await this._emitAudit(auditEvent);
			return {
				success: false,
				reason: `Max writes per run (${this.config.maxWritesPerRun}) exceeded`,
				policyAllowed: false,
				auditEvent,
				writeCount: this.writeCount,
				mode,
				writeExecuted: false,
			};
		}

		// --- 4. Generate pre-write preview ---
		const preview = this.policy.generatePreview({
			operation: input.operation,
			repository: input.repository,
			issueNumber: input.issueNumber,
			labelNames: input.labelNames,
			bodyText: input.bodyText,
			idempotencyKey: input.idempotencyKey,
			humanApproved: input.humanApproved,
		});

		// --- 5. Validate through Stage2WriteSandboxPolicy ---
		const policyResult = this.policy.validate({
			operation: input.operation,
			repository: input.repository,
			issueNumber: input.issueNumber,
			labelNames: input.labelNames,
			bodyText: input.bodyText,
			idempotencyKey: input.idempotencyKey,
			humanApproved: input.humanApproved,
			previewGenerated: input.previewGenerated,
			pushEnabled: input.pushEnabled ?? false,
			mergeKillSwitchActive: input.mergeKillSwitchActive ?? true,
		});

		if (!policyResult.allowed) {
			const auditEvent = this._buildAuditEvent({
				mode,
				operation: input.operation,
				repository: input.repository,
				issueNumber: input.issueNumber,
				result: 'blocked',
				reason: policyResult.reason,
				bodyHash: preview.bodyHash,
				idempotencyKey: input.idempotencyKey,
			});
			await this._emitAudit(auditEvent);
			return {
				success: false,
				reason: policyResult.reason ?? 'Policy denied',
				policyAllowed: false,
				preview,
				auditEvent,
				writeCount: this.writeCount,
				mode,
				writeExecuted: false,
			};
		}

		// --- 6. Fake mode: simulate success without real write ---
		if (this.config.fakeMode) {
			// Register idempotency key (no write count increment in fake mode)
			this.policy.recordIdempotencyKey(input.idempotencyKey);

			const auditEvent = this._buildAuditEvent({
				mode,
				operation: input.operation,
				repository: input.repository,
				issueNumber: input.issueNumber,
				result: 'allowed_preview',
				bodyHash: preview.bodyHash,
				idempotencyKey: input.idempotencyKey,
			});
			await this._emitAudit(auditEvent);

			return {
				success: true,
				policyAllowed: true,
				preview,
				auditEvent,
				writeCount: this.writeCount, // NOT incremented in fake mode
				commentResult: {
					id: 'fake-comment-id',
					url: `https://github.com/${input.repository}/issues/${input.issueNumber}#fake`,
					createdAt: timestamp,
				},
				mode,
				writeExecuted: false,
			};
		}

		// --- 7. Non-fake mode: execute adapter write ---
		//
		// This path is only reachable when fakeMode is explicitly set to false.
		// The adapter is called ONLY through the Stage2IssueCommentWriter interface,
		// which decouples the harness from RealGitHubAdapter (dependency inversion).
		//
		// All 15+ policy gates have already passed before reaching this point.
		// No real GitHub token is read or required — the adapter is injected.
		const [owner, repo] = input.repository.split('/');
		if (!owner || !repo) {
			const auditEvent = this._buildAuditEvent({
				mode,
				operation: input.operation,
				repository: input.repository,
				issueNumber: input.issueNumber,
				result: 'blocked',
				reason: 'Invalid repository format — expected owner/repo',
				bodyHash: preview.bodyHash,
				idempotencyKey: input.idempotencyKey,
			});
			await this._emitAudit(auditEvent);
			return {
				success: false,
				reason: 'Invalid repository format — expected owner/repo',
				policyAllowed: true,
				preview,
				auditEvent,
				writeCount: this.writeCount,
				mode,
				writeExecuted: false,
			};
		}

		try {
			const commentResult = await this.adapter.createIssueComment({
				owner,
				repo,
				issueNumber: input.issueNumber,
				body: input.bodyText ?? '',
			});

			// Success: record write and increment counters
			this.policy.recordWrite(input.idempotencyKey);
			this.writeCount++;

			const auditEvent = this._buildAuditEvent({
				mode,
				operation: input.operation,
				repository: input.repository,
				issueNumber: input.issueNumber,
				result: 'allowed_executed',
				bodyHash: preview.bodyHash,
				idempotencyKey: input.idempotencyKey,
			});
			await this._emitAudit(auditEvent);

			return {
				success: true,
				policyAllowed: true,
				preview,
				auditEvent,
				writeCount: this.writeCount,
				commentResult: {
					id: commentResult.id,
					url: commentResult.url,
					createdAt: commentResult.createdAt,
				},
				mode,
				writeExecuted: true,
			};
		} catch (error: unknown) {
			// Adapter error: do NOT increment write count, do NOT leak raw error
			// Record idempotency key (no counter increment) to prevent infinite retries
			this.policy.recordIdempotencyKey(input.idempotencyKey);

			const rawMessage =
				error instanceof Error ? error.message : String(error ?? 'Unknown adapter error');
			const sanitizedReason = redactValue(rawMessage);

			const auditEvent = this._buildAuditEvent({
				mode,
				operation: input.operation,
				repository: input.repository,
				issueNumber: input.issueNumber,
				result: 'blocked',
				reason: `Adapter error: ${sanitizedReason}`,
				bodyHash: preview.bodyHash,
				idempotencyKey: input.idempotencyKey,
			});
			await this._emitAudit(auditEvent);

			return {
				success: false,
				reason: `Adapter error: ${sanitizedReason}`,
				policyAllowed: true,
				preview,
				auditEvent,
				writeCount: this.writeCount,
				mode,
				writeExecuted: false,
			};
		}
	}

	/** Get current write count. */
	getWriteCount(): number {
		return this.writeCount;
	}

	/** Get current harness config. */
	getConfig(): Readonly<Stage2WriteHarnessConfig> {
		return { ...this.config };
	}

	/** Reset harness state. */
	reset(): void {
		this.writeCount = 0;
		this.policy.reset();
	}

	// --- Private Helpers ---

	private _buildAuditEvent(params: {
		mode: 'fake' | 'preview' | 'live';
		operation: Stage2WriteOperation;
		repository: string;
		issueNumber?: number;
		result: 'allowed_preview' | 'allowed_executed' | 'blocked';
		reason?: string;
		bodyHash?: string;
		idempotencyKey?: string;
	}): Stage2WriteAuditEvent {
		return this.policy.createAuditEvent({
			mode: params.mode,
			operation: params.operation,
			repository: params.repository,
			issueNumber: params.issueNumber,
			result: params.result,
			reason: params.reason,
			bodyHash: params.bodyHash,
			idempotencyKey: params.idempotencyKey,
		});
	}

	private async _emitAudit(event: Stage2WriteAuditEvent): Promise<void> {
		if (this.auditSink) {
			try {
				await this.auditSink.record(event);
			} catch {
				// Audit sink failure must not block the write path
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Stage 2 runtime write harness for the sandbox target.
 * Uses fake mode by default — no real writes.
 */
export function createStage2WriteHarness(params: {
	allowedRepository: string;
	allowedIssueNumber: number;
	adapter: Stage2IssueCommentWriter;
	auditSink?: Stage2AuditSink;
	config?: Partial<Stage2WriteHarnessConfig>;
}): Stage2RuntimeWriteHarness {
	const policy = new Stage2WriteSandboxPolicy({
		enabled: true,
		allowedRepository: params.allowedRepository,
		allowedIssueNumber: params.allowedIssueNumber,
		allowedOperations: ['createIssueComment'],
		optionalAllowedOperations: [],
		allowedLabels: [],
		maxWritesPerRun: 1,
		requireHumanApproval: true,
		requirePreWritePreview: true,
		requireDuplicateDetection: true,
		requireKillSwitchActive: true,
		requirePushDisabled: true,
		requireMergeKillSwitchActive: true,
	});

	return new Stage2RuntimeWriteHarness({
		policy,
		adapter: params.adapter,
		auditSink: params.auditSink,
		config: {
			enabled: true,
			maxWritesPerRun: 1,
			fakeMode: params.config?.fakeMode ?? true,
			...params.config,
		},
	});
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function _sha256(input: string): string {
	return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}
