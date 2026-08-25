// Positron — Stage 3 Remediation Tests
// Tests for: ApprovalBinding, BaseResolver, RuntimeSafetyProbe,
// ReaderVerifier, RealGitHubBridge, and harness integration.

import { describe, expect, it, vi } from 'vitest';
import type { Stage3ApprovalBinding } from '../stage3-approval-binding.js';
import {
	computeApprovalTextSha256,
	createApprovalBinding,
	createApprovalBindingPreview,
	createSyntheticApprovalBinding,
	generateApprovalText,
	isApprovalExpired,
	validateApprovalBinding,
} from '../stage3-approval-binding.js';
import type { Stage3BaseResolver } from '../stage3-base-resolver.js';
import {
	checkBaseDrift,
	createFakeBaseResolver,
	Stage3BaseShaDriftError,
} from '../stage3-base-resolver.js';
import {
	CANONICAL_BASE_BRANCH,
	CANONICAL_COMMIT_MESSAGE_SHA256,
	CANONICAL_FILE_LENGTH,
	CANONICAL_FILE_PATH,
	CANONICAL_FILE_SHA256,
	CANONICAL_PR_METADATA_SHA256,
	CANONICAL_REPOSITORY,
	CANONICAL_TARGET_BRANCH,
	sha256Utf8,
	utf8ByteLength,
} from '../stage3-canonical-manifest.js';
import type { Stage3ReadOnlyVerifier } from '../stage3-reader-verifier.js';
import {
	createFakeReadOnlyVerifier,
	verifyPostWrite,
	verifyPreWrite,
} from '../stage3-reader-verifier.js';
import type { Stage3RealGitHubBridge } from '../stage3-real-github-bridge.js';

import {
	createMockStage3Bridge,
	STAGE3_FORBIDDEN_CAPABILITIES,
	verifyBridgeCapabilities,
} from '../stage3-real-github-bridge.js';
import type { Stage3RuntimeSafetyProbe } from '../stage3-runtime-safety-probe.js';
import {
	createFakeRuntimeSafetyProbe,
	createSafeSnapshot,
	validateSafetySnapshot,
} from '../stage3-runtime-safety-probe.js';

// ---------------------------------------------------------------------------
// Canonical test values (imported from stage3-canonical-manifest.ts)
// ---------------------------------------------------------------------------

const CANONICAL_VALUES = {
	repository: CANONICAL_REPOSITORY,
	baseBranch: CANONICAL_BASE_BRANCH,
	targetBranch: CANONICAL_TARGET_BRANCH,
	filePath: CANONICAL_FILE_PATH,
	fileUtf8ByteLength: CANONICAL_FILE_LENGTH,
	fileSha256: CANONICAL_FILE_SHA256,
	commitMetadataSha256: CANONICAL_COMMIT_MESSAGE_SHA256,
	prMetadataSha256: CANONICAL_PR_METADATA_SHA256,
};

function makeCanonicalBinding(overrides?: Partial<Stage3ApprovalBinding>): Stage3ApprovalBinding {
	const approvalText = generateApprovalText({
		repository: CANONICAL_VALUES.repository,
		baseBranch: CANONICAL_VALUES.baseBranch,
		expectedBaseSha: '0000000000000000000000000000000000000000000000000000000000000000',
		targetBranch: CANONICAL_VALUES.targetBranch,
		filePath: CANONICAL_VALUES.filePath,
		fileUtf8ByteLength: CANONICAL_VALUES.fileUtf8ByteLength,
		fileSha256: CANONICAL_VALUES.fileSha256,
		commitMetadataSha256: CANONICAL_VALUES.commitMetadataSha256,
		prMetadataSha256: CANONICAL_VALUES.prMetadataSha256,
		expiresAt: new Date(Date.now() + 3600000).toISOString(),
	});

	return createApprovalBinding({
		approvalText,
		repository: CANONICAL_VALUES.repository,
		baseBranch: CANONICAL_VALUES.baseBranch,
		expectedBaseSha: '0000000000000000000000000000000000000000000000000000000000000000',
		targetBranch: CANONICAL_VALUES.targetBranch,
		filePath: CANONICAL_VALUES.filePath,
		fileUtf8ByteLength: CANONICAL_VALUES.fileUtf8ByteLength,
		fileSha256: CANONICAL_VALUES.fileSha256,
		commitMetadataSha256: CANONICAL_VALUES.commitMetadataSha256,
		prMetadataSha256: CANONICAL_VALUES.prMetadataSha256,
		expiresAt: new Date(Date.now() + 3600000).toISOString(),
		...overrides,
	});
}

// =========================================================================
// Phase D: Approval Binding Tests
// =========================================================================

describe('Stage3ApprovalBinding', () => {
	describe('createApprovalBinding', () => {
		it('creates a valid binding with all required fields', () => {
			const binding = makeCanonicalBinding();
			expect(binding.version).toBe('stage3-approval-v1');
			expect(binding.repository).toBe(CANONICAL_VALUES.repository);
			expect(binding.maxBranches).toBe(1);
			expect(binding.maxFileWrites).toBe(1);
			expect(binding.maxCommits).toBe(1);
			expect(binding.maxPullRequests).toBe(1);
			expect(binding.mergeForbidden).toBe(true);
			expect(binding.approvalTextSha256).toHaveLength(64);
		});

		it('computes approval text SHA-256', () => {
			const binding = makeCanonicalBinding();
			const expectedHash = computeApprovalTextSha256(
				generateApprovalText({
					repository: CANONICAL_VALUES.repository,
					baseBranch: CANONICAL_VALUES.baseBranch,
					expectedBaseSha: '0000000000000000000000000000000000000000000000000000000000000000',
					targetBranch: CANONICAL_VALUES.targetBranch,
					filePath: CANONICAL_VALUES.filePath,
					fileUtf8ByteLength: CANONICAL_VALUES.fileUtf8ByteLength,
					fileSha256: CANONICAL_VALUES.fileSha256,
					commitMetadataSha256: CANONICAL_VALUES.commitMetadataSha256,
					prMetadataSha256: CANONICAL_VALUES.prMetadataSha256,
					expiresAt: binding.expiresAt,
				}),
			);
			expect(binding.approvalTextSha256).toBe(expectedHash);
		});

		it('creates a safe preview', () => {
			const binding = makeCanonicalBinding();
			const preview = createApprovalBindingPreview(binding);
			expect(preview.approvalTextSha256).toBe(binding.approvalTextSha256);
			expect(preview.repository).toBe(binding.repository);
			expect(preview.bindingFingerprint).toHaveLength(16);
		});
	});

	describe('validateApprovalBinding', () => {
		it('validates a correct binding', () => {
			const binding = makeCanonicalBinding();
			const result = validateApprovalBinding(binding, CANONICAL_VALUES);
			expect(result.valid).toBe(true);
			expect(result.failedChecks).toHaveLength(0);
		});

		it('rejects wrong repository', () => {
			const binding = makeCanonicalBinding({ repository: 'wrong/repo' });
			const result = validateApprovalBinding(binding, CANONICAL_VALUES);
			expect(result.valid).toBe(false);
			expect(result.failedChecks.some((c) => c.includes('Repository'))).toBe(true);
		});

		it('rejects wrong base branch', () => {
			const binding = makeCanonicalBinding({ baseBranch: 'develop' });
			const result = validateApprovalBinding(binding, CANONICAL_VALUES);
			expect(result.valid).toBe(false);
			expect(result.failedChecks.some((c) => c.includes('Base branch'))).toBe(true);
		});

		it('rejects wrong file SHA-256', () => {
			const binding = makeCanonicalBinding({ fileSha256: '0'.repeat(64) });
			const result = validateApprovalBinding(binding, CANONICAL_VALUES);
			expect(result.valid).toBe(false);
			expect(result.failedChecks.some((c) => c.includes('File SHA-256'))).toBe(true);
		});

		it('rejects wrong file byte length', () => {
			const binding = makeCanonicalBinding({ fileUtf8ByteLength: 9999 });
			const result = validateApprovalBinding(binding, CANONICAL_VALUES);
			expect(result.valid).toBe(false);
			expect(result.failedChecks.some((c) => c.includes('File length'))).toBe(true);
		});

		it('rejects expired binding', () => {
			const binding = makeCanonicalBinding({
				expiresAt: new Date(Date.now() - 1000).toISOString(),
			});
			const result = validateApprovalBinding(binding, CANONICAL_VALUES);
			expect(result.valid).toBe(false);
			expect(result.failedChecks.some((c) => c.includes('expired'))).toBe(true);
		});

		it('rejects wrong commit metadata SHA', () => {
			const binding = makeCanonicalBinding({ commitMetadataSha256: 'wrong' });
			const result = validateApprovalBinding(binding, CANONICAL_VALUES);
			expect(result.valid).toBe(false);
			expect(result.failedChecks.some((c) => c.includes('Commit metadata'))).toBe(true);
		});

		it('rejects wrong PR metadata SHA', () => {
			const binding = makeCanonicalBinding({ prMetadataSha256: 'wrong' });
			const result = validateApprovalBinding(binding, CANONICAL_VALUES);
			expect(result.valid).toBe(false);
			expect(result.failedChecks.some((c) => c.includes('PR metadata'))).toBe(true);
		});

		it('rejects maxBranches !== 1', () => {
			// Create binding directly to bypass factory hardcoding
			const approvalText = generateApprovalText({
				repository: CANONICAL_VALUES.repository,
				baseBranch: CANONICAL_VALUES.baseBranch,
				expectedBaseSha: '0000000000000000000000000000000000000000000000000000000000000000',
				targetBranch: CANONICAL_VALUES.targetBranch,
				filePath: CANONICAL_VALUES.filePath,
				fileUtf8ByteLength: CANONICAL_VALUES.fileUtf8ByteLength,
				fileSha256: CANONICAL_VALUES.fileSha256,
				commitMetadataSha256: CANONICAL_VALUES.commitMetadataSha256,
				prMetadataSha256: CANONICAL_VALUES.prMetadataSha256,
				expiresAt: new Date(Date.now() + 3600000).toISOString(),
			});
			const binding: Stage3ApprovalBinding = {
				version: 'stage3-approval-v1',
				approvalTextSha256: computeApprovalTextSha256(approvalText),
				repository: CANONICAL_VALUES.repository,
				baseBranch: CANONICAL_VALUES.baseBranch,
				expectedBaseSha: '0000000000000000000000000000000000000000000000000000000000000000',
				targetBranch: CANONICAL_VALUES.targetBranch,
				filePath: CANONICAL_VALUES.filePath,
				fileUtf8ByteLength: CANONICAL_VALUES.fileUtf8ByteLength,
				fileSha256: CANONICAL_VALUES.fileSha256,
				commitMetadataSha256: CANONICAL_VALUES.commitMetadataSha256,
				prMetadataSha256: CANONICAL_VALUES.prMetadataSha256,
				maxBranches: 2 as 1,
				maxFileWrites: 1,
				maxCommits: 1,
				maxPullRequests: 1,
				mergeForbidden: true,
				expiresAt: new Date(Date.now() + 3600000).toISOString(),
			};
			const result = validateApprovalBinding(binding, CANONICAL_VALUES);
			expect(result.valid).toBe(false);
			expect(result.failedChecks.some((c) => c.includes('maxBranches'))).toBe(true);
		});

		it('rejects mergeForbidden !== true', () => {
			// Test that the validation catches wrong merge flag
			const approvalText = generateApprovalText({
				repository: CANONICAL_VALUES.repository,
				baseBranch: CANONICAL_VALUES.baseBranch,
				expectedBaseSha: '0000000000000000000000000000000000000000000000000000000000000000',
				targetBranch: CANONICAL_VALUES.targetBranch,
				filePath: CANONICAL_VALUES.filePath,
				fileUtf8ByteLength: CANONICAL_VALUES.fileUtf8ByteLength,
				fileSha256: CANONICAL_VALUES.fileSha256,
				commitMetadataSha256: CANONICAL_VALUES.commitMetadataSha256,
				prMetadataSha256: CANONICAL_VALUES.prMetadataSha256,
				expiresAt: new Date(Date.now() + 3600000).toISOString(),
			});
			const binding: Stage3ApprovalBinding = {
				version: 'stage3-approval-v1',
				approvalTextSha256: computeApprovalTextSha256(approvalText),
				repository: CANONICAL_VALUES.repository,
				baseBranch: CANONICAL_VALUES.baseBranch,
				expectedBaseSha: '0000000000000000000000000000000000000000000000000000000000000000',
				targetBranch: CANONICAL_VALUES.targetBranch,
				filePath: CANONICAL_VALUES.filePath,
				fileUtf8ByteLength: CANONICAL_VALUES.fileUtf8ByteLength,
				fileSha256: CANONICAL_VALUES.fileSha256,
				commitMetadataSha256: CANONICAL_VALUES.commitMetadataSha256,
				prMetadataSha256: CANONICAL_VALUES.prMetadataSha256,
				maxBranches: 1,
				maxFileWrites: 1,
				maxCommits: 1,
				maxPullRequests: 1,
				mergeForbidden: false as true,
				expiresAt: new Date(Date.now() + 3600000).toISOString(),
			};
			const result = validateApprovalBinding(binding, CANONICAL_VALUES);
			expect(result.valid).toBe(false);
			expect(result.failedChecks.some((c) => c.includes('mergeForbidden'))).toBe(true);
		});
	});

	describe('isApprovalExpired', () => {
		it('future expiry is not expired', () => {
			const binding = makeCanonicalBinding({
				expiresAt: new Date(Date.now() + 3600000).toISOString(),
			});
			expect(isApprovalExpired(binding)).toBe(false);
		});

		it('past expiry is expired', () => {
			const binding = makeCanonicalBinding({
				expiresAt: new Date(Date.now() - 1000).toISOString(),
			});
			expect(isApprovalExpired(binding)).toBe(true);
		});
	});

	describe('createSyntheticApprovalBinding', () => {
		it('creates a non-expired synthetic binding for tests', () => {
			const binding = createSyntheticApprovalBinding();
			expect(binding.approvalTextSha256).toContain('synthetic');
			expect(isApprovalExpired(binding)).toBe(false);
			expect(binding.mergeForbidden).toBe(true);
		});
	});
});

// =========================================================================
// Phase E: Base Resolver Tests
// =========================================================================

describe('Stage3BaseResolver', () => {
	it('fake resolver returns expected SHA', async () => {
		const expectedSha = 'test-sha-expected';
		const resolver = createFakeBaseResolver(expectedSha);
		const result = await resolver.resolveBase({ owner: 'x', repo: 'y', branch: 'main' });
		expect(result.branch).toBe('main');
		expect(result.sha).toBe(expectedSha);
	});

	describe('checkBaseDrift', () => {
		it('matches when SHAs are equal', () => {
			const result = checkBaseDrift({ branch: 'main', sha: 'abc123' }, 'abc123');
			expect(result.matches).toBe(true);
		});

		it('detects drift when SHAs differ', () => {
			const result = checkBaseDrift({ branch: 'main', sha: 'abc123' }, 'xyz789');
			expect(result.matches).toBe(false);
			expect(result.expectedSha).toBe('xyz789');
			expect(result.actualSha).toBe('abc123');
		});
	});

	describe('Stage3BaseShaDriftError', () => {
		it('creates error with expected and actual SHA', () => {
			const err = new Stage3BaseShaDriftError('expected-sha', 'actual-sha', 'main');
			expect(err.expectedSha).toBe('expected-sha');
			expect(err.actualSha).toBe('actual-sha');
			expect(err.branch).toBe('main');
			expect(err.message).toContain('Base SHA drift');
		});
	});
});

// =========================================================================
// Phase F: Runtime Safety Probe Tests
// =========================================================================

describe('Stage3RuntimeSafetyProbe', () => {
	describe('validateSafetySnapshot', () => {
		it('passes for a fully safe snapshot', () => {
			const snapshot = createSafeSnapshot();
			const result = validateSafetySnapshot(snapshot);
			expect(result.safe).toBe(true);
			expect(result.failedChecks).toHaveLength(0);
		});

		it('fails when queue is active', () => {
			const snapshot = createSafeSnapshot({ queueDisabled: false });
			const result = validateSafetySnapshot(snapshot);
			expect(result.safe).toBe(false);
			expect(result.failedChecks.some((c) => c.includes('Queue'))).toBe(true);
		});

		it('fails when concurrency > 1', () => {
			const snapshot = createSafeSnapshot({ configuredConcurrency: 2 });
			const result = validateSafetySnapshot(snapshot);
			expect(result.safe).toBe(false);
			expect(result.failedChecks.some((c) => c.includes('Concurrency'))).toBe(true);
		});

		it('fails when workspace lock is missing', () => {
			const snapshot = createSafeSnapshot({ workspaceLockHeld: false });
			const result = validateSafetySnapshot(snapshot);
			expect(result.safe).toBe(false);
			expect(result.failedChecks.some((c) => c.includes('Workspace lock'))).toBe(true);
		});

		it('fails when another run is active', () => {
			const snapshot = createSafeSnapshot({ otherActiveRunDetected: true });
			const result = validateSafetySnapshot(snapshot);
			expect(result.safe).toBe(false);
			expect(result.failedChecks.some((c) => c.includes('other active'))).toBe(true);
		});

		it('fails when merge kill-switch is inactive', () => {
			const snapshot = createSafeSnapshot({ mergeKillSwitchActive: false });
			const result = validateSafetySnapshot(snapshot);
			expect(result.safe).toBe(false);
			expect(result.failedChecks.some((c) => c.includes('Merge kill-switch'))).toBe(true);
		});

		it('fails when generic push is enabled', () => {
			const snapshot = createSafeSnapshot({ genericPushEnabled: true });
			const result = validateSafetySnapshot(snapshot);
			expect(result.safe).toBe(false);
			expect(result.failedChecks.some((c) => c.includes('Generic push'))).toBe(true);
		});

		it('fully safe snapshot passes all checks', () => {
			const snapshot = createSafeSnapshot();
			const result = validateSafetySnapshot(snapshot);
			expect(result.safe).toBe(true);
			expect(result.snapshot.queueDisabled).toBe(true);
			expect(result.snapshot.configuredConcurrency).toBe(1);
			expect(result.snapshot.workspaceLockHeld).toBe(true);
			expect(result.snapshot.otherActiveRunDetected).toBe(false);
			expect(result.snapshot.mergeKillSwitchActive).toBe(true);
			expect(result.snapshot.genericPushEnabled).toBe(false);
		});
	});

	describe('createFakeRuntimeSafetyProbe', () => {
		it('creates a probe that returns safe snapshot', async () => {
			const probe = createFakeRuntimeSafetyProbe();
			const snapshot = await probe.inspect();
			const result = validateSafetySnapshot(snapshot);
			expect(result.safe).toBe(true);
		});
	});
});

// =========================================================================
// Phase I: Reader/Verifier Tests
// =========================================================================

describe('Stage3ReadOnlyVerifier', () => {
	describe('verifyPreWrite', () => {
		it('passes when all conditions are met', async () => {
			const verifier = createFakeReadOnlyVerifier({
				repoExists: true,
				baseShaMatches: true,
				targetBranchExists: false,
				targetFileExists: false,
				openPrExists: false,
			});
			const result = await verifyPreWrite(verifier, {
				owner: 'x',
				repo: 'y',
				baseBranch: 'main',
				expectedBaseSha: 'expected-base-sha',
				targetBranch: 'positron/issue-308-stage3-pilot',
				filePath: 'stage3/positron-supervised-pilot.md',
			});
			expect(result.passed).toBe(true);
		});

		it('fails when target branch already exists', async () => {
			const verifier = createFakeReadOnlyVerifier({
				repoExists: true,
				baseShaMatches: true,
				targetBranchExists: true,
				targetFileExists: false,
				openPrExists: false,
			});
			const result = await verifyPreWrite(verifier, {
				owner: 'x',
				repo: 'y',
				baseBranch: 'main',
				expectedBaseSha: 'expected-base-sha',
				targetBranch: 'positron/issue-308-stage3-pilot',
				filePath: 'stage3/positron-supervised-pilot.md',
			});
			expect(result.passed).toBe(false);
			expect(result.checks.targetBranchMissing).toBe(false);
		});

		it('fails when target file already exists', async () => {
			const verifier = createFakeReadOnlyVerifier({
				repoExists: true,
				baseShaMatches: true,
				targetBranchExists: false,
				targetFileExists: true,
				openPrExists: false,
			});
			const result = await verifyPreWrite(verifier, {
				owner: 'x',
				repo: 'y',
				baseBranch: 'main',
				expectedBaseSha: 'expected-base-sha',
				targetBranch: 'positron/issue-308-stage3-pilot',
				filePath: 'stage3/positron-supervised-pilot.md',
			});
			expect(result.passed).toBe(false);
			expect(result.checks.targetFileMissing).toBe(false);
		});

		it('fails when open PR already exists', async () => {
			const verifier = createFakeReadOnlyVerifier({
				repoExists: true,
				baseShaMatches: true,
				targetBranchExists: false,
				targetFileExists: false,
				openPrExists: true,
			});
			const result = await verifyPreWrite(verifier, {
				owner: 'x',
				repo: 'y',
				baseBranch: 'main',
				expectedBaseSha: 'expected-base-sha',
				targetBranch: 'positron/issue-308-stage3-pilot',
				filePath: 'stage3/positron-supervised-pilot.md',
			});
			expect(result.passed).toBe(false);
			expect(result.checks.noOpenPr).toBe(false);
		});
	});

	describe('verifyPostWrite', () => {
		it('passes when all post-write conditions met (simulated)', async () => {
			const testContent = 'test-content-for-post-write';
			const testSha256 = sha256Utf8(testContent);
			const testBytes = utf8ByteLength(testContent);
			const verifier = createFakeReadOnlyVerifier({
				targetBranchExists: true,
				targetFileExists: true,
				openPrExists: true,
				fileContent: testContent,
				prResult: {
					state: 'open',
					draft: true,
					merged: false,
					mergedAt: null,
					title: 'test',
					body: 'test',
					headRef: 'positron/issue-308-stage3-pilot',
					headSha: 'expected-base-sha',
					baseRef: 'main',
					baseSha: 'expected-base-sha',
				},
			});
			const result = await verifyPostWrite(verifier, {
				owner: 'x',
				repo: 'y',
				baseBranch: 'main',
				expectedBaseSha: 'expected-base-sha',
				targetBranch: 'positron/issue-308-stage3-pilot',
				filePath: 'stage3/positron-supervised-pilot.md',
				expectedFileContent: testContent,
				expectedFileSha256: testSha256,
				expectedFileBytes: testBytes,
				expectedCommitMessage: 'test',
				expectedPrTitle: 'test',
				expectedPrBody: 'test',
				expectedPrDraft: true,
			});
			expect(result.passed).toBe(true);
			expect(result.checks.targetBranchExists).toBe(true);
			expect(result.checks.fileByteSizeExact).toBe(true);
			expect(result.checks.fileSha256Exact).toBe(true);
			expect(result.checks.draftPrExists).toBe(true);
		});

		it('fails when target branch does not exist', async () => {
			const verifier = createFakeReadOnlyVerifier({
				targetBranchExists: false,
				targetFileExists: false,
			});
			const result = await verifyPostWrite(verifier, {
				owner: 'x',
				repo: 'y',
				baseBranch: 'main',
				expectedBaseSha: 'expected-base-sha',
				targetBranch: 'positron/issue-308-stage3-pilot',
				filePath: 'stage3/positron-supervised-pilot.md',
				expectedFileContent: 'test',
				expectedFileSha256: 'expected-file-sha',
				expectedFileBytes: 1724,
				expectedCommitMessage: 'test',
				expectedPrTitle: 'test',
				expectedPrBody: 'test',
				expectedPrDraft: true,
			});
			expect(result.passed).toBe(false);
			expect(result.checks.targetBranchExists).toBe(false);
		});
	});
});

// =========================================================================
// Phase J: RealGitHubBridge Tests
// =========================================================================

describe('Stage3RealGitHubBridge', () => {
	describe('createMockStage3Bridge', () => {
		it('creates a bridge with all required components', () => {
			const bridge = createMockStage3Bridge();
			expect(bridge.baseResolver).toBeDefined();
			expect(bridge.branchWriter).toBeDefined();
			expect(bridge.fileCommitWriter).toBeDefined();
			expect(bridge.prWriter).toBeDefined();
			expect(bridge.readOnlyVerifier).toBeDefined();
		});

		it('baseResolver returns synthetic SHA', async () => {
			const bridge = createMockStage3Bridge({ baseSha: 'custom-sha' });
			const result = await bridge.baseResolver.resolveBase({
				owner: 'a',
				repo: 'b',
				branch: 'main',
			});
			expect(result.sha).toBe('custom-sha');
		});

		it('branchWriter creates branch', async () => {
			const bridge = createMockStage3Bridge();
			const result = await bridge.branchWriter.createBranch({
				owner: 'x',
				repo: 'y',
				branch: 'test-branch',
				sourceBranch: 'main',
				expectedSourceSha: 'expected-base-sha',
			});
			expect(result.ref).toContain('test-branch');
			expect(result.sha).toBeTruthy();
		});

		it('fileCommitWriter commits file', async () => {
			const bridge = createMockStage3Bridge();
			const result = await bridge.fileCommitWriter.commitFile({
				owner: 'x',
				repo: 'y',
				branch: 'test',
				filePath: 'test.md',
				content: 'content',
				message: 'msg',
			});
			expect(result.sha).toBeTruthy();
			expect(result.url).toContain('github.com');
		});

		it('prWriter creates draft PR', async () => {
			const bridge = createMockStage3Bridge();
			const result = await bridge.prWriter.createPullRequest({
				owner: 'x',
				repo: 'y',
				title: 'test',
				head: 'test',
				base: 'main',
				body: 'body',
				draft: true,
			});
			expect(result.draft).toBe(true);
			expect(result.number).toBe(1);
		});

		it('readOnlyVerifier finds no open PR before execution', async () => {
			const bridge = createMockStage3Bridge();
			const pr = await bridge.readOnlyVerifier.pullRequest.findOpenPr('x', 'y', 'head', 'base');
			expect(pr).toBeNull();
		});
	});

	describe('verifyBridgeCapabilities', () => {
		it('validates a correctly constructed bridge', () => {
			const bridge = createMockStage3Bridge();
			const result = verifyBridgeCapabilities(bridge);
			expect(result.valid).toBe(true);
			expect(result.exposedForbidden).toHaveLength(0);
		});

		it('detects unexpected properties', () => {
			const bridge = createMockStage3Bridge();
			(bridge as unknown as Record<string, unknown>).merge = vi.fn();
			const result = verifyBridgeCapabilities(bridge);
			expect(result.valid).toBe(false);
		});
	});

	describe('STAGE3_FORBIDDEN_CAPABILITIES', () => {
		it('includes merge as forbidden', () => {
			expect(STAGE3_FORBIDDEN_CAPABILITIES).toContain('merge');
		});

		it('includes delete-branch as forbidden', () => {
			expect(STAGE3_FORBIDDEN_CAPABILITIES).toContain('delete-branch');
		});

		it('includes close-issue as forbidden', () => {
			expect(STAGE3_FORBIDDEN_CAPABILITIES).toContain('close-issue');
		});

		it('does not include create-branch', () => {
			expect(STAGE3_FORBIDDEN_CAPABILITIES).not.toContain('create-branch');
		});
	});
});
