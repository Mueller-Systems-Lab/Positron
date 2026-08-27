// Positron — Stage 2 Write-Sandbox Policy Tests
//
// All tests are FAKE/LOCAL — no network, no token, no GitHub API call.
// The policy module itself never makes API calls; it only validates.

import type {
	Stage2PreWritePreview,
	Stage2WriteAuditEvent,
	Stage2WriteOperation,
	Stage2WriteSandboxConfig,
} from '@positron/github-adapter';
import {
	createStage2SandboxPolicy,
	STAGE2_DEFAULT_CONFIG,
	STAGE2_PERMANENTLY_FORBIDDEN,
	Stage2WriteSandboxPolicy,
} from '@positron/github-adapter';
import { beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Test Constants
// ---------------------------------------------------------------------------

const SANDBOX_REPO = 'xxammaxx/positron-sandbox';
const SANDBOX_ISSUE = 1;
const NON_SANDBOX_REPO = 'Mueller-Systems-Lab/Positron';
const NON_SANDBOX_ISSUE = 308;
const TEST_IDEMPOTENCY_KEY = 'test-run-2026-07-09-001';
const TEST_IDEMPOTENCY_KEY_2 = 'test-run-2026-07-09-002';

// ---------------------------------------------------------------------------
// Helper: Create configured policy for tests
// ---------------------------------------------------------------------------

function makePolicy(overrides?: Partial<Stage2WriteSandboxConfig>): Stage2WriteSandboxPolicy {
	return new Stage2WriteSandboxPolicy({
		enabled: true,
		allowedRepository: SANDBOX_REPO,
		allowedIssueNumber: SANDBOX_ISSUE,
		allowedOperations: ['createIssueComment'],
		optionalAllowedOperations: ['addIssueLabels'],
		allowedLabels: ['positron-stage2-sandbox'],
		maxWritesPerRun: 1,
		requireHumanApproval: true,
		requirePreWritePreview: true,
		requireDuplicateDetection: true,
		requireKillSwitchActive: true,
		requirePushDisabled: true,
		requireMergeKillSwitchActive: true,
		...overrides,
	});
}

function validValidateParams(overrides?: Record<string, unknown>) {
	return {
		operation: 'createIssueComment' as Stage2WriteOperation,
		repository: SANDBOX_REPO,
		issueNumber: SANDBOX_ISSUE,
		idempotencyKey: TEST_IDEMPOTENCY_KEY,
		humanApproved: true,
		previewGenerated: true,
		pushEnabled: false,
		mergeKillSwitchActive: true,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Stage2WriteSandboxPolicy', () => {
	let policy: Stage2WriteSandboxPolicy;

	beforeEach(() => {
		policy = makePolicy();
	});

	// =====================================================================
	// Positive Tests
	// =====================================================================

	describe('positive — allowed operations', () => {
		it('17. allows exactly one sandbox comment preview in fake/preview mode', () => {
			const params = validValidateParams();
			const result = policy.validate(params);
			expect(result.allowed).toBe(true);
			expect(result.reason).toBeUndefined();
		});

		it('allows addIssueLabels with exact allowlisted label', () => {
			const policyWithLabels = makePolicy({
				allowedOperations: ['createIssueComment', 'addIssueLabels'],
				allowedLabels: ['positron-stage2-sandbox'],
			});

			const result = policyWithLabels.validate(
				validValidateParams({
					operation: 'addIssueLabels',
					labelNames: ['positron-stage2-sandbox'],
					bodyText: undefined,
				}),
			);
			expect(result.allowed).toBe(true);
		});
	});

	// =====================================================================
	// Negative Tests — Repository & Issue
	// =====================================================================

	describe('negative — repository and issue', () => {
		it('1. blocks non-sandbox repository', () => {
			const result = policy.validate(validValidateParams({ repository: NON_SANDBOX_REPO }));
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('not the allowlisted sandbox repository');
		});

		it('2. blocks non-sandbox issue', () => {
			const result = policy.validate(validValidateParams({ issueNumber: NON_SANDBOX_ISSUE }));
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('not the allowlisted sandbox issue');
		});
	});

	// =====================================================================
	// Negative Tests — Missing Gates
	// =====================================================================

	describe('negative — missing gates', () => {
		it('3. blocks createIssueComment without preview', () => {
			const result = policy.validate(validValidateParams({ previewGenerated: false }));
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('Pre-write preview');
		});

		it('4. blocks createIssueComment without human approval', () => {
			const result = policy.validate(validValidateParams({ humanApproved: false }));
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('Human approval');
		});
	});

	// =====================================================================
	// Negative Tests — MaxWritesPerRun
	// =====================================================================

	describe('negative — max writes per run', () => {
		it('5. blocks second write in same run', () => {
			// First write: validate passes
			const r1 = policy.validate(validValidateParams());
			expect(r1.allowed).toBe(true);

			// Record the first write
			policy.recordWrite(TEST_IDEMPOTENCY_KEY);
			expect(policy.getWriteCount()).toBe(1);

			// Second write: blocked
			const r2 = policy.validate(validValidateParams({ idempotencyKey: TEST_IDEMPOTENCY_KEY_2 }));
			expect(r2.allowed).toBe(false);
			expect(r2.reason).toContain('Max writes per run');
		});
	});

	// =====================================================================
	// Negative Tests — Labels
	// =====================================================================

	describe('negative — labels', () => {
		it('6. blocks addIssueLabels with non-allowlisted label', () => {
			const policyWithLabels = makePolicy({
				allowedOperations: ['createIssueComment', 'addIssueLabels'],
				allowedLabels: ['positron-stage2-sandbox'],
			});

			const result = policyWithLabels.validate(
				validValidateParams({
					operation: 'addIssueLabels',
					labelNames: ['some-other-label'],
					bodyText: undefined,
				}),
			);
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('not allowlisted');
		});
	});

	// =====================================================================
	// Negative Tests — Forbidden Operations
	// =====================================================================

	describe('negative — forbidden operations', () => {
		const forbiddenOps: Stage2WriteOperation[] = [
			'removeIssueLabel',
			'claimIssue',
			'createPullRequest',
			'mergePullRequest',
			'requestReviewers',
			'closeIssue',
			'push',
			'merge',
		];

		for (const op of forbiddenOps) {
			it(`7-14. blocks ${op}`, () => {
				const result = policy.validate(validValidateParams({ operation: op, bodyText: undefined }));
				expect(result.allowed).toBe(false);
				expect(result.reason).toContain('permanently forbidden');
			});
		}
	});

	// =====================================================================
	// Token Redaction Tests
	// =====================================================================

	describe('token redaction', () => {
		it('15. keeps token redacted in preview', () => {
			const preview = policy.generatePreview({
				operation: 'createIssueComment',
				repository: SANDBOX_REPO,
				issueNumber: SANDBOX_ISSUE,
				bodyText: 'Test comment body with potential token ghp_abcdefghijklmnopqrstuvwxyz1234567890',
				idempotencyKey: TEST_IDEMPOTENCY_KEY,
				humanApproved: true,
			});

			// tokenValue must always be 'REDACTED'
			expect(preview.tokenValue).toBe('REDACTED');

			// bodyHash should NOT contain the raw body — it's a SHA-256
			expect(preview.bodyHash).toBeDefined();
			expect(preview.bodyHash).not.toContain('ghp_');
			expect(preview.bodyHash).not.toContain('github_pat_');

			// Raw body text is never included, only hash + length
			expect((preview as unknown as Record<string, unknown>).bodyText).toBeUndefined();
		});

		it('16. keeps token redacted in audit event', () => {
			const event = policy.createAuditEvent({
				mode: 'preview',
				operation: 'createIssueComment',
				repository: SANDBOX_REPO,
				issueNumber: SANDBOX_ISSUE,
				result: 'allowed_preview',
				reason: 'Some reason with token ghp_abcdefghijklmnopqrstuvwxyz1234567890',
				bodyHash: 'abc123',
				idempotencyKey: TEST_IDEMPOTENCY_KEY,
			});

			// tokenValue must always be 'REDACTED'
			expect(event.tokenValue).toBe('REDACTED');

			// Reason should have the token redacted
			expect(event.reason).toBeDefined();
			if (event.reason) {
				expect(event.reason).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234567890');
				expect(event.reason).toContain('ghp_***REDACTED***');
			}
		});
	});

	// =====================================================================
	// Duplicate Detection Tests
	// =====================================================================

	describe('duplicate detection', () => {
		it('18. duplicate detection blocks duplicate idempotency key', () => {
			// Register key
			policy.recordIdempotencyKey(TEST_IDEMPOTENCY_KEY);

			// Try same key again
			const result = policy.validate(validValidateParams({ idempotencyKey: TEST_IDEMPOTENCY_KEY }));
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('Duplicate idempotency key');
		});
	});

	// =====================================================================
	// Kill-Switch Tests
	// =====================================================================

	describe('kill-switch enforcement', () => {
		it('19. kill-switch inactive blocks write preview', () => {
			// Actually let me reconsider: requireKillSwitchActive is a conceptual check.
			// The actual kill-switch enforcement for PUSH and MERGE are separate.
			// Test POSITRON_ENABLE_PUSH and POSITRON_MERGE_KILL_SWITCH enforcement.

			const r1 = policy.validate(validValidateParams({ pushEnabled: true }));
			expect(r1.allowed).toBe(false);
			expect(r1.reason).toContain('POSITRON_ENABLE_PUSH');

			const r2 = policy.validate(validValidateParams({ mergeKillSwitchActive: false }));
			expect(r2.allowed).toBe(false);
			expect(r2.reason).toContain('POSITRON_MERGE_KILL_SWITCH');
		});

		it('20. POSITRON_ENABLE_PUSH=true is never required and must not be set', () => {
			// Permanently forbidden 'push' operation
			const result = policy.validate(
				validValidateParams({ operation: 'push', bodyText: undefined }),
			);
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('permanently forbidden');
		});

		it('21. POSITRON_MERGE_KILL_SWITCH=false is never required and must not be set', () => {
			// Permanently forbidden 'merge' operation
			const result = policy.validate(
				validValidateParams({ operation: 'merge', bodyText: undefined }),
			);
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('permanently forbidden');
		});
	});

	// =====================================================================
	// Disabled Policy
	// =====================================================================

	describe('disabled policy', () => {
		it('blocks all writes when policy is disabled', () => {
			const disabledPolicy = makePolicy({ enabled: false });
			const result = disabledPolicy.validate(validValidateParams());
			expect(result.allowed).toBe(false);
			expect(result.reason).toContain('not enabled');
		});
	});
});

// =====================================================================
// Factory Function Tests
// =====================================================================

describe('createStage2SandboxPolicy', () => {
	it('creates a policy with the Blueprint-recommended defaults', () => {
		const p = createStage2SandboxPolicy({
			allowedRepository: SANDBOX_REPO,
			allowedIssueNumber: SANDBOX_ISSUE,
		});

		const config = p.getConfig();
		expect(config.enabled).toBe(true);
		expect(config.allowedRepository).toBe(SANDBOX_REPO);
		expect(config.allowedIssueNumber).toBe(SANDBOX_ISSUE);
		expect(config.allowedOperations).toEqual(['createIssueComment']);
		expect(config.maxWritesPerRun).toBe(1);
		expect(config.requireHumanApproval).toBe(true);
		expect(config.requirePreWritePreview).toBe(true);
		expect(config.requireDuplicateDetection).toBe(true);
		expect(config.requireKillSwitchActive).toBe(true);
	});
});

// =====================================================================
// Constants Tests
// =====================================================================

describe('STAGE2_DEFAULT_CONFIG', () => {
	it('has safe defaults that block everything', () => {
		expect(STAGE2_DEFAULT_CONFIG.enabled).toBe(false);
		expect(STAGE2_DEFAULT_CONFIG.allowedOperations).toEqual([]);
		expect(STAGE2_DEFAULT_CONFIG.maxWritesPerRun).toBe(0);
	});

	it('with defaults, any write is blocked', () => {
		const defaultPolicy = new Stage2WriteSandboxPolicy();
		const result = defaultPolicy.validate(validValidateParams());
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('not enabled');
	});
});

describe('STAGE2_PERMANENTLY_FORBIDDEN', () => {
	it('contains all operations that must never be allowed in Stage 2', () => {
		expect(STAGE2_PERMANENTLY_FORBIDDEN.has('removeIssueLabel')).toBe(true);
		expect(STAGE2_PERMANENTLY_FORBIDDEN.has('claimIssue')).toBe(true);
		expect(STAGE2_PERMANENTLY_FORBIDDEN.has('createPullRequest')).toBe(true);
		expect(STAGE2_PERMANENTLY_FORBIDDEN.has('mergePullRequest')).toBe(true);
		expect(STAGE2_PERMANENTLY_FORBIDDEN.has('requestReviewers')).toBe(true);
		expect(STAGE2_PERMANENTLY_FORBIDDEN.has('closeIssue')).toBe(true);
		expect(STAGE2_PERMANENTLY_FORBIDDEN.has('push')).toBe(true);
		expect(STAGE2_PERMANENTLY_FORBIDDEN.has('merge')).toBe(true);
	});

	it('does not contain allowed operations', () => {
		expect(STAGE2_PERMANENTLY_FORBIDDEN.has('createIssueComment')).toBe(false);
		expect(STAGE2_PERMANENTLY_FORBIDDEN.has('addIssueLabels')).toBe(false);
	});
});

// =====================================================================
// Preview Generation Tests
// =====================================================================

describe('Stage2PreWritePreview', () => {
	let policy: Stage2WriteSandboxPolicy;

	beforeEach(() => {
		policy = makePolicy();
	});

	it('generates a valid preview with all required fields', () => {
		const preview = policy.generatePreview({
			operation: 'createIssueComment',
			repository: SANDBOX_REPO,
			issueNumber: SANDBOX_ISSUE,
			bodyText: 'Test comment',
			idempotencyKey: TEST_IDEMPOTENCY_KEY,
			humanApproved: true,
		});

		expect(preview.stage).toBe('stage2-write-sandbox');
		expect(preview.operation).toBe('createIssueComment');
		expect(preview.repository).toBe(SANDBOX_REPO);
		expect(preview.issueNumber).toBe(SANDBOX_ISSUE);
		expect(preview.bodyHash).toBeDefined();
		expect(preview.bodyHash).toHaveLength(64); // SHA-256 hex
		expect(preview.bodyLength).toBe(12); // 'Test comment'.length
		expect(preview.idempotencyKey).toBe(TEST_IDEMPOTENCY_KEY);
		expect(preview.tokenValue).toBe('REDACTED');
		expect(preview.timestamp).toBeDefined();
	});

	it('keeps writeCountBefore accurate', () => {
		expect(policy.getWriteCount()).toBe(0);

		const preview = policy.generatePreview({
			operation: 'createIssueComment',
			repository: SANDBOX_REPO,
			issueNumber: SANDBOX_ISSUE,
			idempotencyKey: TEST_IDEMPOTENCY_KEY,
			humanApproved: true,
		});

		expect(preview.writeCountBefore).toBe(0);

		// After recording a write
		policy.recordWrite(TEST_IDEMPOTENCY_KEY);
		expect(policy.getWriteCount()).toBe(1);

		const preview2 = policy.generatePreview({
			operation: 'createIssueComment',
			repository: SANDBOX_REPO,
			issueNumber: SANDBOX_ISSUE,
			idempotencyKey: TEST_IDEMPOTENCY_KEY_2,
			humanApproved: true,
		});

		expect(preview2.writeCountBefore).toBe(1);
	});

	it('never includes raw body text', () => {
		const bodyWithSecret = 'My token is ghp_abcdefghijklmnopqrstuvwxyz1234567890';
		const preview = policy.generatePreview({
			operation: 'createIssueComment',
			repository: SANDBOX_REPO,
			issueNumber: SANDBOX_ISSUE,
			bodyText: bodyWithSecret,
			idempotencyKey: TEST_IDEMPOTENCY_KEY,
			humanApproved: false,
		});

		// Check that no raw body text field exists
		const previewObj = preview as unknown as Record<string, unknown>;
		expect(previewObj.bodyText).toBeUndefined();

		// bodyHash is SHA-256, not the raw text
		expect(preview.bodyHash).toBeDefined();
		expect(preview.bodyHash).not.toContain('ghp_');

		// bodyLength is just a number
		expect(preview.bodyLength).toBe(bodyWithSecret.length);
	});

	it('handles undefined bodyText gracefully', () => {
		const preview = policy.generatePreview({
			operation: 'addIssueLabels',
			repository: SANDBOX_REPO,
			issueNumber: SANDBOX_ISSUE,
			labelNames: ['positron-stage2-sandbox'],
			idempotencyKey: TEST_IDEMPOTENCY_KEY,
			humanApproved: true,
		});

		expect(preview.bodyHash).toBeUndefined();
		expect(preview.bodyLength).toBeUndefined();
		expect(preview.labelNames).toEqual(['positron-stage2-sandbox']);
	});
});

// =====================================================================
// Audit Event Tests
// =====================================================================

describe('Stage2WriteAuditEvent', () => {
	let policy: Stage2WriteSandboxPolicy;

	beforeEach(() => {
		policy = makePolicy();
	});

	it('creates a redacted audit event for preview', () => {
		const event = policy.createAuditEvent({
			mode: 'preview',
			operation: 'createIssueComment',
			repository: SANDBOX_REPO,
			issueNumber: SANDBOX_ISSUE,
			result: 'allowed_preview',
			bodyHash: 'abc123',
			idempotencyKey: TEST_IDEMPOTENCY_KEY,
		});

		expect(event.stage).toBe('stage2-write-sandbox');
		expect(event.mode).toBe('preview');
		expect(event.operation).toBe('createIssueComment');
		expect(event.repository).toBe(SANDBOX_REPO);
		expect(event.issueNumber).toBe(SANDBOX_ISSUE);
		expect(event.result).toBe('allowed_preview');
		expect(event.tokenValue).toBe('REDACTED');
		expect(event.timestamp).toBeDefined();
	});

	it('creates a redacted audit event for blocked operations', () => {
		const event = policy.createAuditEvent({
			mode: 'fake',
			operation: 'closeIssue',
			repository: SANDBOX_REPO,
			issueNumber: SANDBOX_ISSUE,
			result: 'blocked',
			reason: 'Operation permanently forbidden',
		});

		expect(event.result).toBe('blocked');
		expect(event.reason).toContain('permanently forbidden');
		expect(event.tokenValue).toBe('REDACTED');
	});

	it('redacts token-like patterns in reason field', () => {
		const event = policy.createAuditEvent({
			mode: 'fake',
			operation: 'createIssueComment',
			repository: SANDBOX_REPO,
			issueNumber: SANDBOX_ISSUE,
			result: 'blocked',
			reason: 'Token ghp_abcdefghijklmnopqrstuvwxyz1234567890 was found in body',
		});

		expect(event.reason).toBeDefined();
		expect(event.reason).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234567890');
		expect(event.reason).toContain('ghp_***REDACTED***');
	});

	it('never includes raw API output', () => {
		const event = policy.createAuditEvent({
			mode: 'preview',
			operation: 'createIssueComment',
			repository: SANDBOX_REPO,
			issueNumber: SANDBOX_ISSUE,
			result: 'allowed_preview',
			bodyHash: 'sha256-hash-only',
		});

		const eventObj = event as unknown as Record<string, unknown>;
		expect(eventObj.rawResponse).toBeUndefined();
		expect(eventObj.headers).toBeUndefined();
		expect(eventObj.authorizationHeader).toBeUndefined();
		expect(eventObj.fullCommentText).toBeUndefined();
	});
});

// =====================================================================
// State Management Tests
// =====================================================================

describe('state management', () => {
	it('reset() clears write count and idempotency keys', () => {
		const policy = makePolicy();

		policy.recordWrite(TEST_IDEMPOTENCY_KEY);
		expect(policy.getWriteCount()).toBe(1);

		policy.reset();
		expect(policy.getWriteCount()).toBe(0);

		// Should now accept the same idempotency key again
		const result = policy.validate(validValidateParams());
		expect(result.allowed).toBe(true);
	});

	it('updateConfig() allows runtime reconfiguration', () => {
		const policy = makePolicy();

		// Initially enabled
		expect(policy.getConfig().enabled).toBe(true);

		// Disable
		policy.updateConfig({ enabled: false });
		expect(policy.getConfig().enabled).toBe(false);

		// Should now block
		const result = policy.validate(validValidateParams());
		expect(result.allowed).toBe(false);
	});

	it('recordIdempotencyKey() does not increment write count', () => {
		const policy = makePolicy();
		expect(policy.getWriteCount()).toBe(0);

		policy.recordIdempotencyKey(TEST_IDEMPOTENCY_KEY);
		expect(policy.getWriteCount()).toBe(0);

		// But the key is still tracked for dedup
		const result = policy.validate(validValidateParams());
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Duplicate idempotency key');
	});
});

// =====================================================================
// Integration: Full Preview-Validate-Audit Flow (Fake Mode)
// =====================================================================

describe('integration — full preview-validate-audit flow', () => {
	it('completes the full preview→validate→audit cycle without real writes', () => {
		const policy = makePolicy();

		// Step 1: Generate preview
		const preview = policy.generatePreview({
			operation: 'createIssueComment',
			repository: SANDBOX_REPO,
			issueNumber: SANDBOX_ISSUE,
			bodyText: 'Sandbox test comment from Stage 2 policy test',
			idempotencyKey: TEST_IDEMPOTENCY_KEY,
			humanApproved: true,
		});

		expect(preview.tokenValue).toBe('REDACTED');
		expect(preview.bodyHash).toBeDefined();

		// Step 2: Validate with preview
		const validation = policy.validate(
			validValidateParams({ bodyText: 'Sandbox test comment from Stage 2 policy test' }),
		);
		expect(validation.allowed).toBe(true);

		// Step 3: Create audit event (allowed_preview)
		const auditEvent = policy.createAuditEvent({
			mode: 'preview',
			operation: 'createIssueComment',
			repository: SANDBOX_REPO,
			issueNumber: SANDBOX_ISSUE,
			result: 'allowed_preview',
			bodyHash: preview.bodyHash,
			idempotencyKey: TEST_IDEMPOTENCY_KEY,
		});

		expect(auditEvent.tokenValue).toBe('REDACTED');
		expect(auditEvent.result).toBe('allowed_preview');

		// Step 4: Record the idempotency key (but don't increment write — fake mode)
		policy.recordIdempotencyKey(TEST_IDEMPOTENCY_KEY);

		// The policy should now reject duplicate key
		const dupResult = policy.validate(validValidateParams());
		expect(dupResult.allowed).toBe(false);
		expect(dupResult.reason).toContain('Duplicate');
	});

	it('blocks a write attempt that skips the preview step', () => {
		const policy = makePolicy();

		// Try to validate without generating preview first
		const result = policy.validate(validValidateParams({ previewGenerated: false }));

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Pre-write preview');
	});
});
