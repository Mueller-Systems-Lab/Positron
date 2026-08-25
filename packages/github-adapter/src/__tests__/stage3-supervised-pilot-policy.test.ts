// Positron — Stage 3 Supervised Pilot Policy Tests
// Uses canonical values from the single-source-of-truth manifest.

import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	CANONICAL_COMMIT_BODY,
	CANONICAL_COMMIT_MESSAGE,
	CANONICAL_FILE_CONTENT,
	CANONICAL_FILE_LENGTH,
	CANONICAL_FILE_SHA256,
	CANONICAL_PR_BODY,
	CANONICAL_PR_TITLE,
	CANONICAL_REPOSITORY,
} from '../stage3-canonical-manifest.js';
import type { Stage3ProcessSafety } from '../stage3-supervised-pilot-policy.js';
import {
	createStage3PilotPolicy,
	STAGE3_CANONICAL,
	Stage3SupervisedPilotPolicy,
} from '../stage3-supervised-pilot-policy.js';

// Canonical file content imported from stage3-canonical-manifest.ts (single source of truth).
// No local copy — see imports above.

// 82-char suffix (93 total with prefix) matching shared redactSecrets regex

// 82-char suffix (93 total with prefix) matching shared redactSecrets regex
const MOCK_TOKEN =
	'github_pat_AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12XY';

const SAFE_PROCESS_SAFETY: Stage3ProcessSafety = {
	queueDisabled: true,
	singleProcess: true,
	workspaceLockAcquired: true,
	noOtherActiveRun: true,
	mergeKillSwitchActive: true,
	pushDisabled: true,
};

function makePolicy(enabled = true) {
	return createStage3PilotPolicy({ enabled });
}

const PK = 'test-run-001';

// ---------------------------------------------------------------------------
// Positive Tests
// ---------------------------------------------------------------------------

describe('Stage3SupervisedPilotPolicy — Positive', () => {
	it('allows createBranch with all gates passed', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createBranch',
			repository: STAGE3_CANONICAL.repository,
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: STAGE3_CANONICAL.targetBranch,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(true);
		expect(result.failedGates).toHaveLength(0);
	});

	it('allows commitFile with all gates passed and canonical file content', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'commitFile',
			repository: STAGE3_CANONICAL.repository,
			filePath: STAGE3_CANONICAL.filePath,
			fileContent: CANONICAL_FILE_CONTENT,
			commitMessage: STAGE3_CANONICAL.commitMessage,
			commitBody: STAGE3_CANONICAL.commitBody,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(true);
		expect(result.failedGates).toHaveLength(0);
	});

	it('allows createPullRequest with all gates passed', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createPullRequest',
			repository: STAGE3_CANONICAL.repository,
			prTitle: STAGE3_CANONICAL.prTitle,
			prBody: STAGE3_CANONICAL.prBody,
			prDraft: true,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(true);
		expect(result.failedGates).toHaveLength(0);
	});

	it('generates a token-free preview', () => {
		const policy = makePolicy();
		const preview = policy.generatePreview({
			repository: STAGE3_CANONICAL.repository,
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: STAGE3_CANONICAL.targetBranch,
			filePath: STAGE3_CANONICAL.filePath,
			fileContent: CANONICAL_FILE_CONTENT,
			commitMessage: STAGE3_CANONICAL.commitMessage,
			prTitle: STAGE3_CANONICAL.prTitle,
			prDraft: true,
			idempotencyKey: PK,
			humanApproved: true,
		});
		expect(preview.tokenValue).toBe('REDACTED');
		expect(preview.fileSha256).toBe(STAGE3_CANONICAL.fileSha256);
		expect(preview.fileLength).toBe(CANONICAL_FILE_LENGTH);
		expect(preview.stage).toBe('stage3-supervised-pilot');
	});

	it('creates a redacted audit event', () => {
		const policy = makePolicy();
		const event = policy.createAuditEvent({
			mode: 'fake',
			operation: 'createBranch',
			repository: STAGE3_CANONICAL.repository,
			result: 'allowed_preview',
			idempotencyKey: PK,
			phase: 'test',
		});
		expect(event.tokenValue).toBe('REDACTED');
		expect(event.stage).toBe('stage3-supervised-pilot');
		expect(event.timestamp).toBeTruthy();
	});

	it('enforces counter increments correctly', () => {
		const policy = makePolicy();
		expect(policy.getBranchCount()).toBe(0);
		policy.recordBranchCreated();
		expect(policy.getBranchCount()).toBe(1);

		expect(policy.getFileWriteCount()).toBe(0);
		policy.recordFileWrite();
		expect(policy.getFileWriteCount()).toBe(1);
		expect(policy.getCommitCount()).toBe(1);

		expect(policy.getPullRequestCount()).toBe(0);
		policy.recordPrCreated();
		expect(policy.getPullRequestCount()).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Negative — Policy Gate
// ---------------------------------------------------------------------------

describe('Stage3SupervisedPilotPolicy — Negative: Policy Gate', () => {
	it('blocks all writes when policy is disabled', () => {
		const policy = makePolicy(false);
		const result = policy.validate({
			operation: 'createBranch',
			repository: STAGE3_CANONICAL.repository,
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: STAGE3_CANONICAL.targetBranch,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('not enabled');
	});
});

// ---------------------------------------------------------------------------
// Negative — Repository (forbidden before allowlist)
// ---------------------------------------------------------------------------

describe('Stage3SupervisedPilotPolicy — Negative: Repository', () => {
	it('blocks production repository (xxammaxx/Positron) — forbidden gate', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createBranch',
			repository: 'xxammaxx/Positron',
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: STAGE3_CANONICAL.targetBranch,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('forbidden');
	});

	it('blocks non-sandbox repository', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createBranch',
			repository: 'other-org/other-repo',
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: STAGE3_CANONICAL.targetBranch,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('not the allowlisted sandbox repository');
	});
});

// ---------------------------------------------------------------------------
// Negative — Branch
// ---------------------------------------------------------------------------

describe('Stage3SupervisedPilotPolicy — Negative: Branch', () => {
	it('blocks wrong base branch', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createBranch',
			repository: STAGE3_CANONICAL.repository,
			baseBranch: 'develop',
			targetBranch: STAGE3_CANONICAL.targetBranch,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('not the allowlisted base branch');
	});

	it('blocks wrong target branch', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createBranch',
			repository: STAGE3_CANONICAL.repository,
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: 'some-other-branch',
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('not the allowlisted branch');
	});
});

// ---------------------------------------------------------------------------
// Negative — File (SHA-256 before length check)
// ---------------------------------------------------------------------------

describe('Stage3SupervisedPilotPolicy — Negative: File', () => {
	it('blocks wrong file path', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'commitFile',
			repository: STAGE3_CANONICAL.repository,
			filePath: 'some/other/file.md',
			fileContent: CANONICAL_FILE_CONTENT,
			commitMessage: STAGE3_CANONICAL.commitMessage,
			commitBody: STAGE3_CANONICAL.commitBody,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('not the allowlisted path');
	});

	it('blocks wrong SHA-256 (tampered file) — SHA-256 gate fires first', () => {
		const policy = makePolicy();
		const tampered = CANONICAL_FILE_CONTENT.replace('Pilot', 'HACKED');
		const result = policy.validate({
			operation: 'commitFile',
			repository: STAGE3_CANONICAL.repository,
			filePath: STAGE3_CANONICAL.filePath,
			fileContent: tampered,
			commitMessage: STAGE3_CANONICAL.commitMessage,
			commitBody: STAGE3_CANONICAL.commitBody,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('SHA-256 mismatch');
	});

	it('blocks wrong commit message — SHA-256 gate fires first', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'commitFile',
			repository: STAGE3_CANONICAL.repository,
			filePath: STAGE3_CANONICAL.filePath,
			fileContent: CANONICAL_FILE_CONTENT,
			commitMessage: 'wrong commit message',
			commitBody: STAGE3_CANONICAL.commitBody,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		// The commit message is NOT part of the SHA-256; it fails on commit message gate
		expect(result.reason).toContain('Commit message does not match');
	});

	it('blocks wrong commit body', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'commitFile',
			repository: STAGE3_CANONICAL.repository,
			filePath: STAGE3_CANONICAL.filePath,
			fileContent: CANONICAL_FILE_CONTENT,
			commitMessage: STAGE3_CANONICAL.commitMessage,
			commitBody: 'wrong commit body',
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Commit body does not match');
	});

	it('blocks wrong file length', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'commitFile',
			repository: STAGE3_CANONICAL.repository,
			filePath: STAGE3_CANONICAL.filePath,
			fileContent: 'too short',
			commitMessage: STAGE3_CANONICAL.commitMessage,
			commitBody: STAGE3_CANONICAL.commitBody,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		// SHA-256 gate fires first since content doesn't match
		expect(result.reason).toContain('SHA-256 mismatch');
	});

	it('blocks missing file content', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'commitFile',
			repository: STAGE3_CANONICAL.repository,
			filePath: STAGE3_CANONICAL.filePath,
			commitMessage: STAGE3_CANONICAL.commitMessage,
			commitBody: STAGE3_CANONICAL.commitBody,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('File content is required');
	});
});

// ---------------------------------------------------------------------------
// Negative — PR
// ---------------------------------------------------------------------------

describe('Stage3SupervisedPilotPolicy — Negative: PR', () => {
	it('blocks wrong PR title', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createPullRequest',
			repository: STAGE3_CANONICAL.repository,
			prTitle: 'Wrong title',
			prBody: STAGE3_CANONICAL.prBody,
			prDraft: true,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('PR title does not match');
	});

	it('blocks wrong PR body', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createPullRequest',
			repository: STAGE3_CANONICAL.repository,
			prTitle: STAGE3_CANONICAL.prTitle,
			prBody: 'Wrong body',
			prDraft: true,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('PR body does not match');
	});

	it('blocks non-draft PR', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createPullRequest',
			repository: STAGE3_CANONICAL.repository,
			prTitle: STAGE3_CANONICAL.prTitle,
			prBody: STAGE3_CANONICAL.prBody,
			prDraft: false,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Draft');
	});
});

// ---------------------------------------------------------------------------
// Negative — Process Safety
// ---------------------------------------------------------------------------

describe('Stage3SupervisedPilotPolicy — Negative: Process Safety', () => {
	it('blocks when queue is active', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createBranch',
			repository: STAGE3_CANONICAL.repository,
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: STAGE3_CANONICAL.targetBranch,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: { ...SAFE_PROCESS_SAFETY, queueDisabled: false },
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Queue must be disabled');
	});

	it('blocks when concurrency > 1', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createBranch',
			repository: STAGE3_CANONICAL.repository,
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: STAGE3_CANONICAL.targetBranch,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: { ...SAFE_PROCESS_SAFETY, singleProcess: false },
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Single process required');
	});

	it('blocks when workspace lock is missing', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createBranch',
			repository: STAGE3_CANONICAL.repository,
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: STAGE3_CANONICAL.targetBranch,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: { ...SAFE_PROCESS_SAFETY, workspaceLockAcquired: false },
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Workspace lock');
	});

	it('blocks when another active run exists', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createBranch',
			repository: STAGE3_CANONICAL.repository,
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: STAGE3_CANONICAL.targetBranch,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: { ...SAFE_PROCESS_SAFETY, noOtherActiveRun: false },
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Another active run');
	});

	it('blocks when merge kill-switch is inactive', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createBranch',
			repository: STAGE3_CANONICAL.repository,
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: STAGE3_CANONICAL.targetBranch,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: { ...SAFE_PROCESS_SAFETY, mergeKillSwitchActive: false },
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Merge kill-switch');
	});

	it('blocks when push is enabled', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createBranch',
			repository: STAGE3_CANONICAL.repository,
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: STAGE3_CANONICAL.targetBranch,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: { ...SAFE_PROCESS_SAFETY, pushDisabled: false },
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Push must be disabled');
	});
});

// ---------------------------------------------------------------------------
// Negative — Human Gates
// ---------------------------------------------------------------------------

describe('Stage3SupervisedPilotPolicy — Negative: Human Gates', () => {
	it('blocks when human approval is missing', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createBranch',
			repository: STAGE3_CANONICAL.repository,
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: STAGE3_CANONICAL.targetBranch,
			idempotencyKey: PK,
			humanApproved: false,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Human approval is required');
	});

	it('blocks when preview is not generated', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createBranch',
			repository: STAGE3_CANONICAL.repository,
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: STAGE3_CANONICAL.targetBranch,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: false,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Pre-write preview');
	});
});

// ---------------------------------------------------------------------------
// Negative — Idempotency
// ---------------------------------------------------------------------------

describe('Stage3SupervisedPilotPolicy — Negative: Idempotency', () => {
	it('blocks duplicate idempotency key from a different run', () => {
		const policy = makePolicy();
		// First run records the key
		policy.recordIdempotencyKey('already-used-key');
		// New run tries to use the same key
		const result = policy.validate({
			operation: 'createBranch',
			repository: STAGE3_CANONICAL.repository,
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: STAGE3_CANONICAL.targetBranch,
			idempotencyKey: 'already-used-key',
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Duplicate idempotency key');
	});

	it('blocks missing idempotency key', () => {
		const policy = makePolicy();
		const result = policy.validate({
			operation: 'createBranch',
			repository: STAGE3_CANONICAL.repository,
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: STAGE3_CANONICAL.targetBranch,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Idempotency key is required');
	});
});

// ---------------------------------------------------------------------------
// Negative — Quantity Limits
// ---------------------------------------------------------------------------

describe('Stage3SupervisedPilotPolicy — Negative: Quantity Limits', () => {
	it('blocks second branch', () => {
		const policy = makePolicy();
		policy.recordBranchCreated();
		const result = policy.validate({
			operation: 'createBranch',
			repository: STAGE3_CANONICAL.repository,
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: STAGE3_CANONICAL.targetBranch,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Max branches per run');
	});

	it('blocks second PR', () => {
		const policy = makePolicy();
		policy.recordPrCreated();
		const result = policy.validate({
			operation: 'createPullRequest',
			repository: STAGE3_CANONICAL.repository,
			prTitle: STAGE3_CANONICAL.prTitle,
			prBody: STAGE3_CANONICAL.prBody,
			prDraft: true,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Max PRs per run');
	});
});

// ---------------------------------------------------------------------------
// Token Redaction
// ---------------------------------------------------------------------------

describe('Stage3SupervisedPilotPolicy — Token Redaction', () => {
	it('audit event has tokenValue REDACTED and redacts reason', () => {
		const policy = makePolicy();
		const event = policy.createAuditEvent({
			mode: 'live',
			operation: 'commitFile',
			repository: STAGE3_CANONICAL.repository,
			result: 'allowed_executed',
			reason: `Adapter error: ${MOCK_TOKEN}`,
			idempotencyKey: PK,
		});
		expect(event.tokenValue).toBe('REDACTED');
		// redactValue should replace the token suffix with REDACTED marker
		expect(event.reason).toContain('***REDACTED***');
		// The full 93-char token value must not appear
		expect(event.reason).not.toContain(MOCK_TOKEN);
	});

	it('preview has tokenValue REDACTED', () => {
		const policy = makePolicy();
		const preview = policy.generatePreview({
			repository: STAGE3_CANONICAL.repository,
			baseBranch: STAGE3_CANONICAL.baseBranch,
			targetBranch: STAGE3_CANONICAL.targetBranch,
			filePath: STAGE3_CANONICAL.filePath,
			fileContent: CANONICAL_FILE_CONTENT,
			commitMessage: STAGE3_CANONICAL.commitMessage,
			prTitle: STAGE3_CANONICAL.prTitle,
			prDraft: true,
			idempotencyKey: PK,
			humanApproved: true,
		});
		expect(preview.tokenValue).toBe('REDACTED');
	});

	it('blocks input containing github_pat_ token pattern via fileContent', () => {
		const policy = makePolicy();
		const r2 = policy.validate({
			operation: 'commitFile',
			repository: STAGE3_CANONICAL.repository,
			filePath: STAGE3_CANONICAL.filePath,
			fileContent: MOCK_TOKEN,
			commitMessage: STAGE3_CANONICAL.commitMessage,
			commitBody: STAGE3_CANONICAL.commitBody,
			idempotencyKey: PK,
			humanApproved: true,
			previewGenerated: true,
			processSafety: SAFE_PROCESS_SAFETY,
		});
		expect(r2.allowed).toBe(false);
		expect(r2.reason).toContain('Raw token pattern');
	});
});

// ---------------------------------------------------------------------------
// Canonical Values Validation
// ---------------------------------------------------------------------------

describe('Stage3SupervisedPilotPolicy — Canonical Values', () => {
	it('validates canonical file content has correct SHA-256', () => {
		const hash = crypto.createHash('sha256').update(CANONICAL_FILE_CONTENT, 'utf8').digest('hex');
		expect(hash).toBe(STAGE3_CANONICAL.fileSha256);
	});

	it(`validates canonical file content has correct byte length (${CANONICAL_FILE_LENGTH})`, () => {
		const len = Buffer.byteLength(CANONICAL_FILE_CONTENT, 'utf8');
		expect(len).toBe(CANONICAL_FILE_LENGTH);
	});
});
