// Positron — Stage 3 Bridge Provenance Tests
//
// Closes F19 and BRIDGE_PROVENANCE gap.
// Verifies that only internally-created, runtime-trusted bridges can reach
// the live harness reader/writer path. Forged bridges are blocked in
// preflight with zero reader and zero writer calls.
//
// No real network access. No real tokens. No real writes.

import { describe, expect, it, vi } from 'vitest';
import { GitHubValidationError } from '../errors.js';
import {
	createApprovalBinding,
	createSyntheticApprovalBinding,
	generateApprovalText,
} from '../stage3-approval-binding.js';
import { createFakeBaseResolver } from '../stage3-base-resolver.js';
import { CANONICAL_FILE_CONTENT } from '../stage3-canonical-manifest.js';
import { createFakeReadOnlyVerifier } from '../stage3-reader-verifier.js';
import type {
	Stage3GitHubTransport,
	Stage3RealGitHubBridge,
} from '../stage3-real-github-bridge.js';
import {
	createStage3RealGitHubBridge,
	isTrustedBridge,
	verifyBridgeCapabilities,
} from '../stage3-real-github-bridge.js';
import type { Stage3AuditSink, Stage3LiveHarnessInput } from '../stage3-runtime-harness.js';
import { createStage3Harness, Stage3RuntimeHarness } from '../stage3-runtime-harness.js';
import {
	createFakeRuntimeSafetyProbe,
	createSafeSnapshot,
} from '../stage3-runtime-safety-probe.js';
import { createStage3PilotPolicy, STAGE3_CANONICAL } from '../stage3-supervised-pilot-policy.js';

// ---------------------------------------------------------------------------
// Test Constants
// ---------------------------------------------------------------------------

const TEST_BASE_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSpyTransport(): Stage3GitHubTransport {
	return {
		resolveBaseSha: vi.fn().mockResolvedValue({ sha: TEST_BASE_SHA }),
		createBranch: vi.fn().mockResolvedValue({ ref: 'refs/heads/test', sha: 'branch-sha' }),
		commitFile: vi.fn().mockResolvedValue({ sha: 'commit-sha', url: 'https://example.com' }),
		createDraftPr: vi.fn().mockResolvedValue({ number: 1, url: 'https://example.com/pr/1' }),
		getDefaultBranch: vi.fn().mockResolvedValue({ name: 'main', sha: TEST_BASE_SHA }),
		getBranch: vi.fn().mockResolvedValue({ name: 'main', sha: TEST_BASE_SHA, exists: true }),
		getFileContent: vi.fn().mockResolvedValue({
			content: CANONICAL_FILE_CONTENT,
			gitBlobSha: 'blob-sha',
			size: Buffer.byteLength(CANONICAL_FILE_CONTENT, 'utf8'),
			exists: true,
		}),
		getCommit: vi.fn().mockResolvedValue({
			sha: 'commit-sha',
			message: 'test',
			authorDate: '',
			parents: [TEST_BASE_SHA],
			files: [{ filename: 'stage3/positron-supervised-pilot.md', status: 'added' }],
			exists: true,
		}),
		findOpenPr: vi.fn().mockResolvedValue(null),
		compareCommits: vi.fn().mockResolvedValue({
			status: 'ahead',
			aheadBy: 1,
			behindBy: 0,
			totalCommits: 1,
			commits: ['c1'],
			files: [{ filename: 'stage3/positron-supervised-pilot.md', status: 'added' }],
		}),
	};
}

function createTrustedBridge(): Stage3RealGitHubBridge {
	return createStage3RealGitHubBridge({
		transport: createSpyTransport(),
		canonicalManifest: {
			targetBranch: STAGE3_CANONICAL.targetBranch,
			filePath: STAGE3_CANONICAL.filePath,
			expectedFileContent: CANONICAL_FILE_CONTENT,
			expectedFileSha256: STAGE3_CANONICAL.fileSha256,
			expectedFileBytes: STAGE3_CANONICAL.fileUtf8ByteLength,
			commitMessage: STAGE3_CANONICAL.commitMessage,
			commitBody: STAGE3_CANONICAL.commitBody,
			prTitle: STAGE3_CANONICAL.prTitle,
			prBody: STAGE3_CANONICAL.prBody,
		},
		expectedBaseSha: TEST_BASE_SHA,
	});
}

function createFakeAuditSink(): Stage3AuditSink {
	return { record: vi.fn() };
}

const LIVE_APPROVAL_TEXT = generateApprovalText({
	repository: STAGE3_CANONICAL.repository,
	baseBranch: STAGE3_CANONICAL.baseBranch,
	expectedBaseSha: TEST_BASE_SHA,
	targetBranch: STAGE3_CANONICAL.targetBranch,
	filePath: STAGE3_CANONICAL.filePath,
	fileUtf8ByteLength: STAGE3_CANONICAL.fileUtf8ByteLength,
	fileSha256: STAGE3_CANONICAL.fileSha256,
	commitMetadataSha256: STAGE3_CANONICAL.commitMetadataSha256,
	prMetadataSha256: STAGE3_CANONICAL.prMetadataSha256,
	expiresAt: new Date(Date.now() + 3600000).toISOString(),
});

const LIVE_APPROVAL_BINDING = createApprovalBinding({
	approvalText: LIVE_APPROVAL_TEXT,
	repository: STAGE3_CANONICAL.repository,
	baseBranch: STAGE3_CANONICAL.baseBranch,
	expectedBaseSha: TEST_BASE_SHA,
	targetBranch: STAGE3_CANONICAL.targetBranch,
	filePath: STAGE3_CANONICAL.filePath,
	fileUtf8ByteLength: STAGE3_CANONICAL.fileUtf8ByteLength,
	fileSha256: STAGE3_CANONICAL.fileSha256,
	commitMetadataSha256: STAGE3_CANONICAL.commitMetadataSha256,
	prMetadataSha256: STAGE3_CANONICAL.prMetadataSha256,
	expiresAt: new Date(Date.now() + 3600000).toISOString(),
});

/**
 * Create a fully functional forged bridge that passes the kind check
 * and Object.keys check, but is NOT registered in the trusted WeakSet.
 */
function createForgedBridge(): Stage3RealGitHubBridge {
	return {
		kind: 'restricted-real-transport' as const,

		baseResolver: {
			resolveBase: vi.fn().mockResolvedValue({ branch: 'main', sha: TEST_BASE_SHA }),
		},

		branchWriter: {
			createBranch: vi.fn().mockResolvedValue({
				ref: `refs/heads/${STAGE3_CANONICAL.targetBranch}`,
				sha: 'malicious-branch-sha',
			}),
		},

		fileCommitWriter: {
			commitFile: vi.fn().mockResolvedValue({
				sha: 'malicious-commit-sha',
				url: 'https://github.com/Mueller-Systems-Lab/Positron/commit/malicious',
			}),
		},

		prWriter: {
			createPullRequest: vi.fn().mockResolvedValue({
				id: 9999,
				number: 9999,
				url: 'https://github.com/Mueller-Systems-Lab/Positron/pull/9999',
				createdAt: new Date().toISOString(),
				draft: false,
			}),
		},

		readOnlyVerifier: {
			repository: {
				getDefaultBranch: vi.fn().mockResolvedValue({ name: 'main', sha: TEST_BASE_SHA }),
			},
			branch: {
				getBranch: vi.fn().mockResolvedValue({ name: 'main', sha: TEST_BASE_SHA, exists: true }),
			},
			content: {
				getFileContent: vi.fn().mockResolvedValue({
					content: CANONICAL_FILE_CONTENT,
					gitBlobSha: 'forged-blob-sha',
					size: Buffer.byteLength(CANONICAL_FILE_CONTENT, 'utf8'),
					exists: true,
				}),
			},
			commit: {
				getCommit: vi.fn().mockResolvedValue({
					sha: 'forged-commit-sha',
					message: `${STAGE3_CANONICAL.commitMessage}\n\n${STAGE3_CANONICAL.commitBody}`,
					authorDate: new Date().toISOString(),
					parents: [TEST_BASE_SHA],
					files: [{ filename: STAGE3_CANONICAL.filePath, status: 'added' }],
					exists: true,
				}),
			},
			pullRequest: {
				findOpenPr: vi.fn().mockResolvedValue(null),
			},
			compare: {
				compareCommits: vi.fn().mockResolvedValue({
					status: 'ahead',
					aheadBy: 1,
					behindBy: 0,
					totalCommits: 1,
					commits: ['forged-c1'],
					files: [{ filename: STAGE3_CANONICAL.filePath, status: 'added' }],
				}),
			},
		},
	};
}

function makeLiveInputWithBridge(
	bridge: Stage3RealGitHubBridge,
	overrides?: Partial<Stage3LiveHarnessInput>,
): Stage3LiveHarnessInput {
	return {
		mode: 'live',
		repository: STAGE3_CANONICAL.repository,
		fileContent: CANONICAL_FILE_CONTENT,
		idempotencyKey: `provenance-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		approvalText: LIVE_APPROVAL_TEXT,
		approvalBinding: LIVE_APPROVAL_BINDING,
		runtimeSafetyProbe: createFakeRuntimeSafetyProbe(),
		bridge,
		auditSink: createFakeAuditSink(),
		...overrides,
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// WeakSet Provenance — trusted vs forged
// ═══════════════════════════════════════════════════════════════════════════

describe('Bridge Provenance — WeakSet trust check', () => {
	it('trusts a bridge created by createStage3RealGitHubBridge', () => {
		const bridge = createTrustedBridge();
		expect(isTrustedBridge(bridge)).toBe(true);
	});

	it('rejects a manually constructed bridge', () => {
		const forged = createForgedBridge();
		expect(isTrustedBridge(forged)).toBe(false);
	});

	it('rejects a spread-cloned trusted bridge', () => {
		const trusted = createTrustedBridge();
		const cloned = { ...trusted };
		expect(isTrustedBridge(cloned)).toBe(false);
	});

	it('rejects a JSON-roundtripped trusted bridge', () => {
		const trusted = createTrustedBridge();
		const roundtripped = JSON.parse(JSON.stringify(trusted));
		expect(isTrustedBridge(roundtripped)).toBe(false);
	});

	it('rejects a prototype-manipulated bridge', () => {
		const forged = createForgedBridge();
		Object.setPrototypeOf(forged, createTrustedBridge());
		expect(isTrustedBridge(forged)).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// verifyBridgeCapabilities — enhanced checks
// ═══════════════════════════════════════════════════════════════════════════

describe('verifyBridgeCapabilities — enhanced validation', () => {
	it('returns trusted: true for internally-created bridge', () => {
		const bridge = createTrustedBridge();
		const result = verifyBridgeCapabilities(bridge);
		expect(result.trusted).toBe(true);
		expect(result.valid).toBe(true);
		expect(result.exposedForbidden).toHaveLength(0);
		expect(result.missingCapabilities).toHaveLength(0);
		expect(result.malformedCapabilities).toHaveLength(0);
	});

	it('returns trusted: false for forged bridge', () => {
		const forged = createForgedBridge();
		const result = verifyBridgeCapabilities(forged);
		expect(result.trusted).toBe(false);
	});

	it('detects missing top-level properties', () => {
		const partial = {
			kind: 'restricted-real-transport' as const,
			baseResolver: { resolveBase: vi.fn() },
			// Missing branchWriter, fileCommitWriter, prWriter, readOnlyVerifier
		};
		const result = verifyBridgeCapabilities(partial as any);
		expect(result.missingCapabilities.length).toBeGreaterThan(0);
		expect(result.missingCapabilities.some((m) => m.includes('branchWriter'))).toBe(true);
	});

	it('detects non-function methods', () => {
		const bridge = createForgedBridge();
		(bridge.branchWriter as any).createBranch = 'not-a-function';
		const result = verifyBridgeCapabilities(bridge);
		expect(result.malformedCapabilities.some((m) => m.includes('createBranch'))).toBe(true);
	});

	it('detects forbidden methods on bridge object', () => {
		const bridge = createForgedBridge();
		(bridge as any).merge = vi.fn();
		const result = verifyBridgeCapabilities(bridge);
		expect(result.exposedForbidden.some((f) => f.includes('merge'))).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// F19: Fully Functional Forged Bridge Rejection
// ═══════════════════════════════════════════════════════════════════════════

describe('F19: Fully functional forged bridge rejected in preflight', () => {
	it('blocks forged bridge before baseResolver is called', async () => {
		const policy = createStage3PilotPolicy();
		const harness = new Stage3RuntimeHarness({ policy });
		const forgedBridge = createForgedBridge();

		const input = makeLiveInputWithBridge(forgedBridge);
		const result = await harness.execute(input);

		// Core assertion: blocked in preflight
		expect(result.success).toBe(false);
		expect(result.currentPhase).toBe('preflight-security');
		expect(result.reason).toContain('provenance');
		expect(result.writeAttempted).toBe(false);
		expect(result.mutationState).toBe('none');

		// Zero call assertions — no reader/writer reached
		expect(forgedBridge.baseResolver.resolveBase).not.toHaveBeenCalled();
		expect(forgedBridge.branchWriter.createBranch).not.toHaveBeenCalled();
		expect(forgedBridge.fileCommitWriter.commitFile).not.toHaveBeenCalled();
		expect(forgedBridge.prWriter.createPullRequest).not.toHaveBeenCalled();
		expect(forgedBridge.readOnlyVerifier.repository.getDefaultBranch).not.toHaveBeenCalled();
		expect(forgedBridge.readOnlyVerifier.branch.getBranch).not.toHaveBeenCalled();
		expect(forgedBridge.readOnlyVerifier.content.getFileContent).not.toHaveBeenCalled();
		expect(forgedBridge.readOnlyVerifier.commit.getCommit).not.toHaveBeenCalled();
		expect(forgedBridge.readOnlyVerifier.pullRequest.findOpenPr).not.toHaveBeenCalled();
		expect(forgedBridge.readOnlyVerifier.compare.compareCommits).not.toHaveBeenCalled();
	});

	it('blocks copied trusted bridge object', async () => {
		const policy = createStage3PilotPolicy();
		const harness = new Stage3RuntimeHarness({ policy });
		const trusted = createTrustedBridge();
		const copied = { ...trusted } as Stage3RealGitHubBridge;

		const input = makeLiveInputWithBridge(copied);
		const result = await harness.execute(input);

		expect(result.success).toBe(false);
		expect(result.currentPhase).toBe('preflight-security');
		expect(result.reason).toContain('provenance');
		expect(result.writeAttempted).toBe(false);
	});

	it('blocks spread-cloned trusted bridge', async () => {
		const policy = createStage3PilotPolicy();
		const harness = new Stage3RuntimeHarness({ policy });
		const trusted = createTrustedBridge();
		const cloned = { ...trusted } as Stage3RealGitHubBridge;

		const input = makeLiveInputWithBridge(cloned);
		const result = await harness.execute(input);

		expect(result.success).toBe(false);
		expect(result.writeAttempted).toBe(false);
	});

	it('blocks JSON-shaped trusted bridge', async () => {
		const policy = createStage3PilotPolicy();
		const harness = new Stage3RuntimeHarness({ policy });
		const trusted = createTrustedBridge();
		const jsonBridge = JSON.parse(JSON.stringify(trusted));

		const input = makeLiveInputWithBridge(jsonBridge);
		const result = await harness.execute(input);

		expect(result.success).toBe(false);
		expect(result.writeAttempted).toBe(false);
	});

	it('blocks prototype-manipulated bridge', async () => {
		const policy = createStage3PilotPolicy();
		const harness = new Stage3RuntimeHarness({ policy });
		const forged = createForgedBridge();
		Object.setPrototypeOf(forged, createTrustedBridge());

		const input = makeLiveInputWithBridge(forged);
		const result = await harness.execute(input);

		expect(result.success).toBe(false);
		expect(result.writeAttempted).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Public API Surface — no raw live bridge injection
// ═══════════════════════════════════════════════════════════════════════════

describe('Public API — no raw live bridge injection', () => {
	it('createStage3RealGitHubBridge is NOT exported from package root', async () => {
		const pkg = await import('@positron/github-adapter');
		expect(pkg).not.toHaveProperty('createStage3RealGitHubBridge');
	});

	it('isTrustedBridge is NOT exported from package root', async () => {
		const pkg = await import('@positron/github-adapter');
		expect(pkg).not.toHaveProperty('isTrustedBridge');
	});

	it('Stage3RealGitHubBridge type is NOT exported from package root', async () => {
		const pkg = await import('@positron/github-adapter');
		expect(pkg).not.toHaveProperty('Stage3RealGitHubBridge');
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Manifest Content Hash — actual content must be validated
// ═══════════════════════════════════════════════════════════════════════════

describe('Manifest Content Hash — actual content validation', () => {
	it('rejects bridge with wrong file content (correct declared SHA)', () => {
		const transport = createSpyTransport();
		expect(() =>
			createStage3RealGitHubBridge({
				transport,
				canonicalManifest: {
					targetBranch: STAGE3_CANONICAL.targetBranch,
					filePath: STAGE3_CANONICAL.filePath,
					expectedFileContent: 'wrong content',
					expectedFileSha256: STAGE3_CANONICAL.fileSha256, // declared correct but content wrong
					expectedFileBytes: STAGE3_CANONICAL.fileUtf8ByteLength,
					commitMessage: STAGE3_CANONICAL.commitMessage,
					commitBody: STAGE3_CANONICAL.commitBody,
					prTitle: STAGE3_CANONICAL.prTitle,
					prBody: STAGE3_CANONICAL.prBody,
				},
				expectedBaseSha: TEST_BASE_SHA,
			}),
		).toThrow(GitHubValidationError);
	});

	it('rejects bridge with wrong UTF-8 byte length', () => {
		const transport = createSpyTransport();
		expect(() =>
			createStage3RealGitHubBridge({
				transport,
				canonicalManifest: {
					targetBranch: STAGE3_CANONICAL.targetBranch,
					filePath: STAGE3_CANONICAL.filePath,
					expectedFileContent: CANONICAL_FILE_CONTENT,
					expectedFileSha256: STAGE3_CANONICAL.fileSha256,
					expectedFileBytes: 999, // wrong byte count
					commitMessage: STAGE3_CANONICAL.commitMessage,
					commitBody: STAGE3_CANONICAL.commitBody,
					prTitle: STAGE3_CANONICAL.prTitle,
					prBody: STAGE3_CANONICAL.prBody,
				},
				expectedBaseSha: TEST_BASE_SHA,
			}),
		).toThrow(GitHubValidationError);
	});

	it('rejects bridge with wrong declared SHA (correct content)', () => {
		const transport = createSpyTransport();
		expect(() =>
			createStage3RealGitHubBridge({
				transport,
				canonicalManifest: {
					targetBranch: STAGE3_CANONICAL.targetBranch,
					filePath: STAGE3_CANONICAL.filePath,
					expectedFileContent: CANONICAL_FILE_CONTENT,
					expectedFileSha256: '0000000000000000000000000000000000000000000000000000000000000000', // wrong declared
					expectedFileBytes: STAGE3_CANONICAL.fileUtf8ByteLength,
					commitMessage: STAGE3_CANONICAL.commitMessage,
					commitBody: STAGE3_CANONICAL.commitBody,
					prTitle: STAGE3_CANONICAL.prTitle,
					prBody: STAGE3_CANONICAL.prBody,
				},
				expectedBaseSha: TEST_BASE_SHA,
			}),
		).toThrow(GitHubValidationError);
	});

	it('rejects bridge with wrong commit message', () => {
		const transport = createSpyTransport();
		expect(() =>
			createStage3RealGitHubBridge({
				transport,
				canonicalManifest: {
					targetBranch: STAGE3_CANONICAL.targetBranch,
					filePath: STAGE3_CANONICAL.filePath,
					expectedFileContent: CANONICAL_FILE_CONTENT,
					expectedFileSha256: STAGE3_CANONICAL.fileSha256,
					expectedFileBytes: STAGE3_CANONICAL.fileUtf8ByteLength,
					commitMessage: 'wrong commit message',
					commitBody: STAGE3_CANONICAL.commitBody,
					prTitle: STAGE3_CANONICAL.prTitle,
					prBody: STAGE3_CANONICAL.prBody,
				},
				expectedBaseSha: TEST_BASE_SHA,
			}),
		).toThrow(GitHubValidationError);
	});

	it('rejects bridge with wrong PR title', () => {
		const transport = createSpyTransport();
		expect(() =>
			createStage3RealGitHubBridge({
				transport,
				canonicalManifest: {
					targetBranch: STAGE3_CANONICAL.targetBranch,
					filePath: STAGE3_CANONICAL.filePath,
					expectedFileContent: CANONICAL_FILE_CONTENT,
					expectedFileSha256: STAGE3_CANONICAL.fileSha256,
					expectedFileBytes: STAGE3_CANONICAL.fileUtf8ByteLength,
					commitMessage: STAGE3_CANONICAL.commitMessage,
					commitBody: STAGE3_CANONICAL.commitBody,
					prTitle: 'wrong PR title',
					prBody: STAGE3_CANONICAL.prBody,
				},
				expectedBaseSha: TEST_BASE_SHA,
			}),
		).toThrow(GitHubValidationError);
	});

	it('rejects bridge with wrong PR body', () => {
		const transport = createSpyTransport();
		expect(() =>
			createStage3RealGitHubBridge({
				transport,
				canonicalManifest: {
					targetBranch: STAGE3_CANONICAL.targetBranch,
					filePath: STAGE3_CANONICAL.filePath,
					expectedFileContent: CANONICAL_FILE_CONTENT,
					expectedFileSha256: STAGE3_CANONICAL.fileSha256,
					expectedFileBytes: STAGE3_CANONICAL.fileUtf8ByteLength,
					commitMessage: STAGE3_CANONICAL.commitMessage,
					commitBody: STAGE3_CANONICAL.commitBody,
					prTitle: STAGE3_CANONICAL.prTitle,
					prBody: 'wrong PR body',
				},
				expectedBaseSha: TEST_BASE_SHA,
			}),
		).toThrow(GitHubValidationError);
	});

	it('accepts valid canonical manifest', () => {
		const transport = createSpyTransport();
		expect(() =>
			createStage3RealGitHubBridge({
				transport,
				canonicalManifest: {
					targetBranch: STAGE3_CANONICAL.targetBranch,
					filePath: STAGE3_CANONICAL.filePath,
					expectedFileContent: CANONICAL_FILE_CONTENT,
					expectedFileSha256: STAGE3_CANONICAL.fileSha256,
					expectedFileBytes: STAGE3_CANONICAL.fileUtf8ByteLength,
					commitMessage: STAGE3_CANONICAL.commitMessage,
					commitBody: STAGE3_CANONICAL.commitBody,
					prTitle: STAGE3_CANONICAL.prTitle,
					prBody: STAGE3_CANONICAL.prBody,
				},
				expectedBaseSha: TEST_BASE_SHA,
			}),
		).not.toThrow();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Defense-in-Depth — writer argument validation
// ═══════════════════════════════════════════════════════════════════════════

describe('Defense-in-Depth — writer argument validation in trusted bridge', () => {
	it('rejects branch creation with wrong owner', async () => {
		const bridge = createTrustedBridge();
		await expect(
			bridge.branchWriter.createBranch({
				owner: 'evil-owner',
				repo: 'positron-308-sandbox',
				branch: STAGE3_CANONICAL.targetBranch,
				sourceBranch: STAGE3_CANONICAL.baseBranch,
				expectedSourceSha: TEST_BASE_SHA,
			}),
		).rejects.toThrow(GitHubValidationError);
	});

	it('rejects branch creation with wrong target branch', async () => {
		const bridge = createTrustedBridge();
		await expect(
			bridge.branchWriter.createBranch({
				owner: 'Mueller-Systems-Lab',
				repo: 'positron-308-sandbox',
				branch: 'malicious-branch',
				sourceBranch: STAGE3_CANONICAL.baseBranch,
				expectedSourceSha: TEST_BASE_SHA,
			}),
		).rejects.toThrow(GitHubValidationError);
	});

	it('rejects file commit with wrong content', async () => {
		const bridge = createTrustedBridge();
		await expect(
			bridge.fileCommitWriter.commitFile({
				owner: 'Mueller-Systems-Lab',
				repo: 'positron-308-sandbox',
				branch: STAGE3_CANONICAL.targetBranch,
				filePath: STAGE3_CANONICAL.filePath,
				content: 'malicious content',
				message: STAGE3_CANONICAL.commitMessage,
				commitBody: STAGE3_CANONICAL.commitBody,
			}),
		).rejects.toThrow(GitHubValidationError);
	});

	it('rejects file commit with wrong file path', async () => {
		const bridge = createTrustedBridge();
		await expect(
			bridge.fileCommitWriter.commitFile({
				owner: 'Mueller-Systems-Lab',
				repo: 'positron-308-sandbox',
				branch: STAGE3_CANONICAL.targetBranch,
				filePath: 'packages/github-adapter/src/index.ts',
				content: CANONICAL_FILE_CONTENT,
				message: STAGE3_CANONICAL.commitMessage,
				commitBody: STAGE3_CANONICAL.commitBody,
			}),
		).rejects.toThrow(GitHubValidationError);
	});

	it('rejects PR creation with wrong title', async () => {
		const bridge = createTrustedBridge();
		await expect(
			bridge.prWriter.createPullRequest({
				owner: 'Mueller-Systems-Lab',
				repo: 'positron-308-sandbox',
				title: 'malicious PR title',
				head: STAGE3_CANONICAL.targetBranch,
				base: STAGE3_CANONICAL.baseBranch,
				body: STAGE3_CANONICAL.prBody,
				draft: true,
			}),
		).rejects.toThrow(GitHubValidationError);
	});

	it('rejects PR creation with non-draft', async () => {
		const bridge = createTrustedBridge();
		await expect(
			bridge.prWriter.createPullRequest({
				owner: 'Mueller-Systems-Lab',
				repo: 'positron-308-sandbox',
				title: STAGE3_CANONICAL.prTitle,
				head: STAGE3_CANONICAL.targetBranch,
				base: STAGE3_CANONICAL.baseBranch,
				body: STAGE3_CANONICAL.prBody,
				draft: false, // not draft
			}),
		).rejects.toThrow(GitHubValidationError);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Zero-Call Evidence — blocked bridge reaches no transport
// ═══════════════════════════════════════════════════════════════════════════

describe('Zero-Call Evidence — forged bridge blocked before any transport call', () => {
	it('records zero transport calls for blocked forged bridge', async () => {
		const transport = createSpyTransport();
		const policy = createStage3PilotPolicy();
		const harness = new Stage3RuntimeHarness({ policy });

		// Create a forged bridge using the transport (so we can verify transport is NOT called)
		const forgedBridge: Stage3RealGitHubBridge = {
			kind: 'restricted-real-transport' as const,
			baseResolver: {
				resolveBase: vi.fn().mockImplementation(async (input: any) => {
					return transport.resolveBaseSha(input.owner, input.repo, input.branch);
				}),
			},
			branchWriter: {
				createBranch: vi.fn().mockImplementation(async (input: any) => {
					return transport.createBranch(
						input.owner,
						input.repo,
						input.branch,
						input.expectedSourceSha,
					);
				}),
			},
			fileCommitWriter: {
				commitFile: vi.fn().mockImplementation(async (input: any) => {
					return transport.commitFile(
						input.owner,
						input.repo,
						input.branch,
						input.filePath,
						input.content,
						input.message,
						input.commitBody,
					);
				}),
			},
			prWriter: {
				createPullRequest: vi.fn().mockImplementation(async (input: any) => {
					return transport.createDraftPr(
						input.owner,
						input.repo,
						input.title,
						input.head,
						input.base,
						input.body,
					);
				}),
			},
			readOnlyVerifier: {
				repository: {
					getDefaultBranch: vi
						.fn()
						.mockImplementation(async (o: string, r: string) => transport.getDefaultBranch(o, r)),
				},
				branch: {
					getBranch: vi
						.fn()
						.mockImplementation(async (o: string, r: string, b: string) =>
							transport.getBranch(o, r, b),
						),
				},
				content: {
					getFileContent: vi
						.fn()
						.mockImplementation(async (o: string, r: string, p: string, ref?: string) =>
							transport.getFileContent(o, r, p, ref ?? 'main'),
						),
				},
				commit: {
					getCommit: vi
						.fn()
						.mockImplementation(async (o: string, r: string, s: string) =>
							transport.getCommit(o, r, s),
						),
				},
				pullRequest: {
					findOpenPr: vi
						.fn()
						.mockImplementation(async (o: string, r: string, h: string, b: string) =>
							transport.findOpenPr(o, r, h, b),
						),
				},
				compare: {
					compareCommits: vi
						.fn()
						.mockImplementation(async (o: string, r: string, base: string, head: string) =>
							transport.compareCommits(o, r, base, head),
						),
				},
			},
		};

		const input = makeLiveInputWithBridge(forgedBridge);
		const result = await harness.execute(input);

		// Result is blocked
		expect(result.success).toBe(false);
		expect(result.writeAttempted).toBe(false);

		// Transport was NEVER called
		expect(transport.resolveBaseSha).not.toHaveBeenCalled();
		expect(transport.createBranch).not.toHaveBeenCalled();
		expect(transport.commitFile).not.toHaveBeenCalled();
		expect(transport.createDraftPr).not.toHaveBeenCalled();
		expect(transport.getDefaultBranch).not.toHaveBeenCalled();
		expect(transport.getBranch).not.toHaveBeenCalled();
		expect(transport.getFileContent).not.toHaveBeenCalled();
		expect(transport.getCommit).not.toHaveBeenCalled();
		expect(transport.findOpenPr).not.toHaveBeenCalled();
		expect(transport.compareCommits).not.toHaveBeenCalled();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Trusted Bridge — passes preflight when legitimately constructed
// ═══════════════════════════════════════════════════════════════════════════

describe('Trusted Bridge — legitimately constructed passes provenance check', () => {
	it('trusted bridge passes capability check with trusted: true', () => {
		const bridge = createTrustedBridge();
		const result = verifyBridgeCapabilities(bridge);
		expect(result.trusted).toBe(true);
		expect(result.valid).toBe(true);
	});

	it('isTrustedBridge returns true for factory-created bridge', () => {
		const bridge = createTrustedBridge();
		expect(isTrustedBridge(bridge)).toBe(true);
	});
});
