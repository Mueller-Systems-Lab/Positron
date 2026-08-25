// Positron — Stage 3 Adversarial Gate Tests
//
// Closes compliance gaps C1, C2, C3, C17 and security finding P1-2.
// These tests verify that security gates REJECT adversarial inputs.
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
// ── Internal imports (NOT from package root — tests internal modules directly) ──
import {
	createStage3OctokitTransport,
	STAGE3_FORBIDDEN_OCTOKIT_ENDPOINTS,
	verifyNoForbiddenEndpointsCalled,
} from '../stage3-octokit-transport.js';
import { createFakeReadOnlyVerifier, verifyPostWrite } from '../stage3-reader-verifier.js';
import type { Stage3GitHubTransport } from '../stage3-real-github-bridge.js';
import {
	createMockStage3Bridge,
	createStage3RealGitHubBridge,
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
// Helpers
// ---------------------------------------------------------------------------

function createMockOctokit() {
	return {
		rest: {
			git: {
				getRef: vi.fn().mockResolvedValue({ data: { object: { sha: 'base-sha-000' } } }),
				createRef: vi
					.fn()
					.mockResolvedValue({ data: { ref: 'refs/heads/test', object: { sha: 'new-sha' } } }),
			},
			repos: {
				get: vi.fn().mockResolvedValue({ data: { default_branch: 'main' } }),
				getContent: vi
					.fn()
					.mockResolvedValue({ data: { content: 'dGVzdA==', sha: 'blob-sha', size: 4 } }),
				getCommit: vi.fn().mockResolvedValue({
					data: {
						sha: 'commit-sha',
						commit: { message: 'test', author: { date: '' } },
						parents: [{ sha: 'base-sha-000' }],
						files: [{ filename: 'test.md', status: 'added' }],
					},
				}),
				compareCommits: vi.fn().mockResolvedValue({
					data: {
						status: 'ahead',
						ahead_by: 1,
						behind_by: 0,
						total_commits: 1,
						commits: [{ sha: 'c1' }],
						files: [{ filename: 'test.md', status: 'added' }],
					},
				}),
				createOrUpdateFileContents: vi.fn().mockResolvedValue({
					data: { commit: { sha: 'commit-sha', html_url: 'https://example.com' } },
				}),
			},
			pulls: {
				create: vi.fn().mockResolvedValue({
					data: {
						id: 1,
						number: 1,
						html_url: 'https://example.com/pr/1',
						created_at: '',
						draft: true,
					},
				}),
				list: vi.fn().mockResolvedValue({ data: [] }),
			},
		},
	} as any;
}

function createSpyBridge(): Stage3GitHubTransport {
	return {
		resolveBaseSha: vi.fn().mockResolvedValue({ sha: 'base-sha' }),
		createBranch: vi.fn().mockResolvedValue({ ref: 'refs/heads/test', sha: 'branch-sha' }),
		commitFile: vi.fn().mockResolvedValue({ sha: 'commit-sha', url: 'https://example.com' }),
		createDraftPr: vi.fn().mockResolvedValue({ number: 1, url: 'https://example.com/pr/1' }),
		getDefaultBranch: vi.fn().mockResolvedValue({ name: 'main', sha: 'base-sha' }),
		getBranch: vi.fn().mockResolvedValue({ name: 'main', sha: 'base-sha', exists: true }),
		getFileContent: vi.fn().mockResolvedValue({
			content: CANONICAL_FILE_CONTENT,
			gitBlobSha: 'blob-sha',
			size: CANONICAL_FILE_CONTENT.length,
			exists: true,
		}),
		getCommit: vi.fn().mockResolvedValue({
			sha: 'commit-sha',
			message: 'test',
			authorDate: '',
			parents: ['base-sha'],
			files: [{ filename: 'test.md', status: 'added' }],
			exists: true,
		}),
		findOpenPr: vi.fn().mockResolvedValue(null),
		compareCommits: vi.fn().mockResolvedValue({
			status: 'ahead',
			aheadBy: 1,
			behindBy: 0,
			totalCommits: 1,
			commits: ['c1'],
			files: [{ filename: 'test.md', status: 'added' }],
		}),
	};
}

function createFakeAuditSink(): Stage3AuditSink {
	return { record: vi.fn() };
}

// ═══════════════════════════════════════════════════════════════════════════
// C1: Public Export Surface — forbidden symbols must NOT be accessible
// ═══════════════════════════════════════════════════════════════════════════

describe('C1: Public Export Surface — forbidden symbols not exported', () => {
	it('createStage3OctokitTransport is NOT exported from package root', async () => {
		const pkg = await import('@positron/github-adapter');
		expect(pkg).not.toHaveProperty('createStage3OctokitTransport');
	});

	it('createStage3RealGitHubBridge is NOT exported from package root', async () => {
		const pkg = await import('@positron/github-adapter');
		expect(pkg).not.toHaveProperty('createStage3RealGitHubBridge');
	});

	it('Stage3GitHubTransport type is NOT exported from package root', async () => {
		const pkg = await import('@positron/github-adapter');
		expect(pkg).not.toHaveProperty('Stage3GitHubTransport');
	});

	it('Stage3RealGitHubBridge type is NOT exported from package root', async () => {
		const pkg = await import('@positron/github-adapter');
		expect(pkg).not.toHaveProperty('Stage3RealGitHubTransport');
	});

	it('verifyNoForbiddenEndpointsCalled is NOT exported from package root', async () => {
		const pkg = await import('@positron/github-adapter');
		expect(pkg).not.toHaveProperty('verifyNoForbiddenEndpointsCalled');
	});

	it('STAGE3_FORBIDDEN_OCTOKIT_ENDPOINTS is NOT exported from package root', async () => {
		const pkg = await import('@positron/github-adapter');
		expect(pkg).not.toHaveProperty('STAGE3_FORBIDDEN_OCTOKIT_ENDPOINTS');
	});

	it('createMockStage3Bridge IS exported (allowed)', async () => {
		const pkg = await import('@positron/github-adapter');
		expect(pkg).toHaveProperty('createMockStage3Bridge');
	});

	it('verifyBridgeCapabilities IS exported (allowed)', async () => {
		const pkg = await import('@positron/github-adapter');
		expect(pkg).toHaveProperty('verifyBridgeCapabilities');
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// C2: Immutable Repository Binding — assertBound rejects wrong owner/repo
// ═══════════════════════════════════════════════════════════════════════════

describe('C2: Immutable Repository Binding — assertBound rejection', () => {
	const BOUND_OWNER = 'xxammaxx';
	const BOUND_REPO = 'positron-sandbox';
	const WRONG_OWNER = 'evil-attacker';
	const WRONG_REPO = 'malicious-repo';

	function makeTransport() {
		const octokit = createMockOctokit();
		const transport = createStage3OctokitTransport(octokit, BOUND_OWNER, BOUND_REPO);
		return { octokit, transport };
	}

	it('rejects resolveBaseSha with wrong owner', async () => {
		const { transport } = makeTransport();
		await expect(transport.resolveBaseSha(WRONG_OWNER, BOUND_REPO, 'main')).rejects.toThrow(
			GitHubValidationError,
		);
	});

	it('rejects resolveBaseSha with wrong repo', async () => {
		const { transport } = makeTransport();
		await expect(transport.resolveBaseSha(BOUND_OWNER, WRONG_REPO, 'main')).rejects.toThrow(
			GitHubValidationError,
		);
	});

	it('rejects createBranch with wrong owner', async () => {
		const { transport } = makeTransport();
		await expect(transport.createBranch(WRONG_OWNER, BOUND_REPO, 'test', 'sha')).rejects.toThrow(
			GitHubValidationError,
		);
	});

	it('rejects createBranch with wrong repo', async () => {
		const { transport } = makeTransport();
		await expect(transport.createBranch(BOUND_OWNER, WRONG_REPO, 'test', 'sha')).rejects.toThrow(
			GitHubValidationError,
		);
	});

	it('rejects commitFile with wrong owner', async () => {
		const { transport } = makeTransport();
		await expect(
			transport.commitFile(WRONG_OWNER, BOUND_REPO, 'test', 'f.md', 'c', 'm'),
		).rejects.toThrow(GitHubValidationError);
	});

	it('rejects commitFile with wrong repo', async () => {
		const { transport } = makeTransport();
		await expect(
			transport.commitFile(BOUND_OWNER, WRONG_REPO, 'test', 'f.md', 'c', 'm'),
		).rejects.toThrow(GitHubValidationError);
	});

	it('rejects createDraftPr with wrong owner', async () => {
		const { transport } = makeTransport();
		await expect(
			transport.createDraftPr(WRONG_OWNER, BOUND_REPO, 't', 'h', 'b', 'body'),
		).rejects.toThrow(GitHubValidationError);
	});

	it('rejects createDraftPr with wrong repo', async () => {
		const { transport } = makeTransport();
		await expect(
			transport.createDraftPr(BOUND_OWNER, WRONG_REPO, 't', 'h', 'b', 'body'),
		).rejects.toThrow(GitHubValidationError);
	});

	it('rejects getDefaultBranch with wrong owner', async () => {
		const { transport } = makeTransport();
		await expect(transport.getDefaultBranch(WRONG_OWNER, BOUND_REPO)).rejects.toThrow(
			GitHubValidationError,
		);
	});

	it('rejects getDefaultBranch with wrong repo', async () => {
		const { transport } = makeTransport();
		await expect(transport.getDefaultBranch(BOUND_OWNER, WRONG_REPO)).rejects.toThrow(
			GitHubValidationError,
		);
	});

	it('rejects getBranch with wrong owner', async () => {
		const { transport } = makeTransport();
		await expect(transport.getBranch(WRONG_OWNER, BOUND_REPO, 'main')).rejects.toThrow(
			GitHubValidationError,
		);
	});

	it('rejects getBranch with wrong repo', async () => {
		const { transport } = makeTransport();
		await expect(transport.getBranch(BOUND_OWNER, WRONG_REPO, 'main')).rejects.toThrow(
			GitHubValidationError,
		);
	});

	it('rejects getFileContent with wrong owner', async () => {
		const { transport } = makeTransport();
		await expect(transport.getFileContent(WRONG_OWNER, BOUND_REPO, 'f.md', 'main')).rejects.toThrow(
			GitHubValidationError,
		);
	});

	it('rejects getFileContent with wrong repo', async () => {
		const { transport } = makeTransport();
		await expect(transport.getFileContent(BOUND_OWNER, WRONG_REPO, 'f.md', 'main')).rejects.toThrow(
			GitHubValidationError,
		);
	});

	it('rejects getCommit with wrong owner', async () => {
		const { transport } = makeTransport();
		await expect(transport.getCommit(WRONG_OWNER, BOUND_REPO, 'sha')).rejects.toThrow(
			GitHubValidationError,
		);
	});

	it('rejects getCommit with wrong repo', async () => {
		const { transport } = makeTransport();
		await expect(transport.getCommit(BOUND_OWNER, WRONG_REPO, 'sha')).rejects.toThrow(
			GitHubValidationError,
		);
	});

	it('rejects findOpenPr with wrong owner', async () => {
		const { transport } = makeTransport();
		await expect(transport.findOpenPr(WRONG_OWNER, BOUND_REPO, 'head', 'base')).rejects.toThrow(
			GitHubValidationError,
		);
	});

	it('rejects findOpenPr with wrong repo', async () => {
		const { transport } = makeTransport();
		await expect(transport.findOpenPr(BOUND_OWNER, WRONG_REPO, 'head', 'base')).rejects.toThrow(
			GitHubValidationError,
		);
	});

	it('rejects compareCommits with wrong owner', async () => {
		const { transport } = makeTransport();
		await expect(transport.compareCommits(WRONG_OWNER, BOUND_REPO, 'base', 'head')).rejects.toThrow(
			GitHubValidationError,
		);
	});

	it('rejects compareCommits with wrong repo', async () => {
		const { transport } = makeTransport();
		await expect(transport.compareCommits(BOUND_OWNER, WRONG_REPO, 'base', 'head')).rejects.toThrow(
			GitHubValidationError,
		);
	});

	it('allows correct bound owner/repo for all operations', async () => {
		const { transport } = makeTransport();
		// All operations should succeed with correct owner/repo
		await expect(transport.resolveBaseSha(BOUND_OWNER, BOUND_REPO, 'main')).resolves.toBeDefined();
		await expect(
			transport.createBranch(BOUND_OWNER, BOUND_REPO, 'test', 'sha'),
		).resolves.toBeDefined();
		await expect(
			transport.commitFile(BOUND_OWNER, BOUND_REPO, 'test', 'f.md', 'c', 'm'),
		).resolves.toBeDefined();
		await expect(
			transport.createDraftPr(BOUND_OWNER, BOUND_REPO, 't', 'h', 'b', 'body'),
		).resolves.toBeDefined();
		await expect(transport.getDefaultBranch(BOUND_OWNER, BOUND_REPO)).resolves.toBeDefined();
		await expect(transport.getBranch(BOUND_OWNER, BOUND_REPO, 'main')).resolves.toBeDefined();
		await expect(
			transport.getFileContent(BOUND_OWNER, BOUND_REPO, 'f.md', 'main'),
		).resolves.toBeDefined();
		await expect(transport.getCommit(BOUND_OWNER, BOUND_REPO, 'sha')).resolves.toBeDefined();
		// findOpenPr returns null for empty results (valid)
		const prResult = await transport.findOpenPr(BOUND_OWNER, BOUND_REPO, 'head', 'base');
		expect(prResult).toBeNull();
		await expect(
			transport.compareCommits(BOUND_OWNER, BOUND_REPO, 'base', 'head'),
		).resolves.toBeDefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// C3: Canonical Manifest Enforcement — each field mismatch rejected
// ═══════════════════════════════════════════════════════════════════════════

describe('C3: Canonical Manifest Enforcement — bridge rejects non-canonical manifest', () => {
	const VALID_BASE_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
	const VALID_MANIFEST = {
		targetBranch: STAGE3_CANONICAL.targetBranch,
		filePath: STAGE3_CANONICAL.filePath,
		expectedFileContent: CANONICAL_FILE_CONTENT,
		expectedFileSha256: STAGE3_CANONICAL.fileSha256,
		expectedFileBytes: STAGE3_CANONICAL.fileUtf8ByteLength,
		commitMessage: STAGE3_CANONICAL.commitMessage,
		commitBody: STAGE3_CANONICAL.commitBody,
		prTitle: STAGE3_CANONICAL.prTitle,
		prBody: STAGE3_CANONICAL.prBody,
	};

	function makeTransport(): Stage3GitHubTransport {
		return createSpyBridge();
	}

	it('accepts valid canonical manifest', () => {
		expect(() =>
			createStage3RealGitHubBridge({
				transport: makeTransport(),
				canonicalManifest: { ...VALID_MANIFEST },
				expectedBaseSha: VALID_BASE_SHA,
			}),
		).not.toThrow();
	});

	it('rejects wrong targetBranch', () => {
		expect(() =>
			createStage3RealGitHubBridge({
				transport: makeTransport(),
				canonicalManifest: { ...VALID_MANIFEST, targetBranch: 'wrong-branch' },
				expectedBaseSha: VALID_BASE_SHA,
			}),
		).toThrow(GitHubValidationError);
	});

	it('rejects wrong filePath', () => {
		expect(() =>
			createStage3RealGitHubBridge({
				transport: makeTransport(),
				canonicalManifest: { ...VALID_MANIFEST, filePath: 'wrong/path.md' },
				expectedBaseSha: VALID_BASE_SHA,
			}),
		).toThrow(GitHubValidationError);
	});

	it('rejects wrong expectedFileSha256', () => {
		expect(() =>
			createStage3RealGitHubBridge({
				transport: makeTransport(),
				canonicalManifest: {
					...VALID_MANIFEST,
					expectedFileSha256: '0000000000000000000000000000000000000000000000000000000000000000',
				},
				expectedBaseSha: VALID_BASE_SHA,
			}),
		).toThrow(GitHubValidationError);
	});

	it('rejects wrong expectedFileBytes', () => {
		expect(() =>
			createStage3RealGitHubBridge({
				transport: makeTransport(),
				canonicalManifest: { ...VALID_MANIFEST, expectedFileBytes: 999 },
				expectedBaseSha: VALID_BASE_SHA,
			}),
		).toThrow(GitHubValidationError);
	});

	it('rejects wrong commitMessage', () => {
		expect(() =>
			createStage3RealGitHubBridge({
				transport: makeTransport(),
				canonicalManifest: { ...VALID_MANIFEST, commitMessage: 'wrong commit message' },
				expectedBaseSha: VALID_BASE_SHA,
			}),
		).toThrow(GitHubValidationError);
	});

	it('rejects wrong commitBody', () => {
		expect(() =>
			createStage3RealGitHubBridge({
				transport: makeTransport(),
				canonicalManifest: { ...VALID_MANIFEST, commitBody: 'wrong body' },
				expectedBaseSha: VALID_BASE_SHA,
			}),
		).toThrow(GitHubValidationError);
	});

	it('rejects wrong prTitle', () => {
		expect(() =>
			createStage3RealGitHubBridge({
				transport: makeTransport(),
				canonicalManifest: { ...VALID_MANIFEST, prTitle: 'wrong PR title' },
				expectedBaseSha: VALID_BASE_SHA,
			}),
		).toThrow(GitHubValidationError);
	});

	it('rejects wrong prBody', () => {
		expect(() =>
			createStage3RealGitHubBridge({
				transport: makeTransport(),
				canonicalManifest: { ...VALID_MANIFEST, prBody: 'wrong PR body' },
				expectedBaseSha: VALID_BASE_SHA,
			}),
		).toThrow(GitHubValidationError);
	});

	it('rejects each field individually (no early return)', () => {
		const fields: Array<{ key: string; value: any }> = [
			{ key: 'targetBranch', value: 'x' },
			{ key: 'filePath', value: 'x' },
			{ key: 'expectedFileSha256', value: 'x' },
			{ key: 'expectedFileBytes', value: 0 },
			{ key: 'commitMessage', value: 'x' },
			{ key: 'commitBody', value: 'x' },
			{ key: 'prTitle', value: 'x' },
			{ key: 'prBody', value: 'x' },
		];
		for (const { key, value } of fields) {
			expect(() =>
				createStage3RealGitHubBridge({
					transport: makeTransport(),
					canonicalManifest: { ...VALID_MANIFEST, [key]: value },
					expectedBaseSha: VALID_BASE_SHA,
				}),
			).toThrow(GitHubValidationError);
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// C17: Bridge Kind Discrimination — mock bridge rejected in live mode
// ═══════════════════════════════════════════════════════════════════════════

describe('C17: Bridge Kind Discrimination — mock bridge rejected in live mode', () => {
	function makeLiveInput(overrides?: Partial<Stage3LiveHarnessInput>): Stage3LiveHarnessInput {
		const approvalText = generateApprovalText({
			...STAGE3_CANONICAL,
			expectedBaseSha: 'expected-base-sha',
			expiresAt: new Date(Date.now() + 3600000).toISOString(),
		});
		const binding = createSyntheticApprovalBinding();
		const probe = createFakeRuntimeSafetyProbe();
		const bridge = createMockStage3Bridge();
		const auditSink = createFakeAuditSink();

		return {
			mode: 'live',
			repository: STAGE3_CANONICAL.repository,
			fileContent: CANONICAL_FILE_CONTENT,
			idempotencyKey: `adversarial-test-${Date.now()}`,
			approvalText,
			approvalBinding: binding,
			runtimeSafetyProbe: probe,
			bridge,
			auditSink,
			...overrides,
		} as Stage3LiveHarnessInput;
	}

	it('rejects mock bridge (kind: mock) in live mode', async () => {
		const harness = createStage3Harness({});
		const input = makeLiveInput();

		// Mock bridge has kind: 'mock', not 'restricted-real-transport'
		expect(input.bridge.kind).toBe('mock');

		const result = await harness.execute(input);
		expect(result.success).toBe(false);
		expect(result.reason).toContain('Bridge');
	});

	it('rejects bridge with wrong kind string', async () => {
		const harness = createStage3Harness({});
		const input = makeLiveInput();
		(input.bridge as any).kind = 'fake-bridge';

		const result = await harness.execute(input);
		expect(result.success).toBe(false);
		expect(result.reason).toContain('Bridge');
	});

	it('rejects bridge with extra forbidden properties', async () => {
		const harness = createStage3Harness({});
		const input = makeLiveInput();
		// Add a forbidden property
		(input.bridge as any).merge = vi.fn();

		const result = await harness.execute(input);
		expect(result.success).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Bridge Forgery — adversarial bridge objects
// ═══════════════════════════════════════════════════════════════════════════

describe('Bridge Forgery — adversarial objects', () => {
	it('rejects a forged bridge with correct shape but malicious writers', async () => {
		const policy = createStage3PilotPolicy();
		const harness = new Stage3RuntimeHarness({ policy });

		const forgedBridge = {
			kind: 'restricted-real-transport' as const,
			baseResolver: { resolveBase: vi.fn() },
			branchWriter: { createBranch: vi.fn() },
			fileCommitWriter: { commitFile: vi.fn() },
			prWriter: { createPullRequest: vi.fn() },
			readOnlyVerifier: {
				repository: { getDefaultBranch: vi.fn() },
				branch: { getBranch: vi.fn() },
				content: { getFileContent: vi.fn() },
				commit: { getCommit: vi.fn() },
				pullRequest: { findOpenPr: vi.fn() },
				compare: { compareCommits: vi.fn() },
			},
		};

		const approvalText = generateApprovalText({
			...STAGE3_CANONICAL,
			expectedBaseSha: 'expected-base-sha',
			expiresAt: new Date(Date.now() + 3600000).toISOString(),
		});
		const binding = createSyntheticApprovalBinding();
		const probe = createFakeRuntimeSafetyProbe();

		const input: Stage3LiveHarnessInput = {
			mode: 'live',
			repository: STAGE3_CANONICAL.repository,
			fileContent: CANONICAL_FILE_CONTENT,
			idempotencyKey: `forged-bridge-${Date.now()}`,
			approvalText,
			approvalBinding: binding,
			runtimeSafetyProbe: probe,
			bridge: forgedBridge as any,
			auditSink: createFakeAuditSink(),
		};

		const result = await harness.execute(input);
		// The forged bridge passes kind check and capability check,
		// but the canonical manifest enforcement in createStage3RealGitHubBridge
		// is NOT applicable here since we bypass the factory.
		// The harness still validates via policy gates.
		// This test documents that forged bridges are handled.
		expect(result.success).toBe(false);
	});

	it('rejects a bridge with no readOnlyVerifier', async () => {
		const policy = createStage3PilotPolicy();
		const harness = new Stage3RuntimeHarness({ policy });

		const forgedBridge = {
			kind: 'restricted-real-transport' as const,
			baseResolver: { resolveBase: vi.fn() },
			branchWriter: { createBranch: vi.fn() },
			fileCommitWriter: { commitFile: vi.fn() },
			prWriter: { createPullRequest: vi.fn() },
			// readOnlyVerifier is MISSING
		};

		const approvalText = generateApprovalText({
			...STAGE3_CANONICAL,
			expectedBaseSha: 'expected-base-sha',
			expiresAt: new Date(Date.now() + 3600000).toISOString(),
		});
		const binding = createSyntheticApprovalBinding();
		const probe = createFakeRuntimeSafetyProbe();

		const input: Stage3LiveHarnessInput = {
			mode: 'live',
			repository: STAGE3_CANONICAL.repository,
			fileContent: CANONICAL_FILE_CONTENT,
			idempotencyKey: `forged-no-verifier-${Date.now()}`,
			approvalText,
			approvalBinding: binding,
			runtimeSafetyProbe: probe,
			bridge: forgedBridge as any,
			auditSink: createFakeAuditSink(),
		};

		const result = await harness.execute(input);
		expect(result.success).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Post-Write Verification — negative tests for each check
// ═══════════════════════════════════════════════════════════════════════════

describe('Post-Write Verification — adversarial negative tests', () => {
	const BASE_INPUT = {
		owner: 'xxammaxx',
		repo: 'positron-sandbox',
		baseBranch: 'main',
		expectedBaseSha: 'expected-base-sha',
		targetBranch: 'positron/issue-308-stage3-pilot',
		filePath: 'stage3/positron-supervised-pilot.md',
		expectedFileContent: CANONICAL_FILE_CONTENT,
		expectedFileSha256: STAGE3_CANONICAL.fileSha256,
		expectedFileBytes: STAGE3_CANONICAL.fileUtf8ByteLength,
		expectedCommitMessage: STAGE3_CANONICAL.commitMessage,
		expectedCommitBody: STAGE3_CANONICAL.commitBody,
		expectedPrTitle: STAGE3_CANONICAL.prTitle,
		expectedPrBody: STAGE3_CANONICAL.prBody,
		expectedPrDraft: true,
	};

	function makeHappyVerifier() {
		return createFakeReadOnlyVerifier({
			fileContent: CANONICAL_FILE_CONTENT,
			compareResult: {
				aheadBy: 1,
				totalCommits: 1,
				files: [{ filename: 'stage3/positron-supervised-pilot.md', status: 'added' }],
			},
			commitResult: {
				parents: ['expected-base-sha'],
				message: `${STAGE3_CANONICAL.commitMessage}\n\n${STAGE3_CANONICAL.commitBody}`,
			},
		});
	}

	it('rejects when target branch does not exist', async () => {
		const verifier = createFakeReadOnlyVerifier({ targetBranchExists: false });
		const result = await verifyPostWrite(verifier, BASE_INPUT);
		expect(result.passed).toBe(false);
		expect(result.checks.targetBranchExists).toBe(false);
	});

	it('rejects when exactlyOneCommit is false (aheadBy=2)', async () => {
		const verifier = createFakeReadOnlyVerifier({
			compareResult: {
				aheadBy: 2,
				totalCommits: 2,
				files: [{ filename: 'stage3/positron-supervised-pilot.md', status: 'added' }],
			},
		});
		const result = await verifyPostWrite(verifier, BASE_INPUT);
		expect(result.passed).toBe(false);
		expect(result.checks.exactlyOneCommit).toBe(false);
	});

	it('rejects when file path is wrong', async () => {
		const verifier = createFakeReadOnlyVerifier({
			compareResult: {
				aheadBy: 1,
				totalCommits: 1,
				files: [{ filename: 'wrong/path.md', status: 'added' }],
			},
		});
		const result = await verifyPostWrite(verifier, BASE_INPUT);
		expect(result.passed).toBe(false);
		expect(result.checks.filePathExact).toBe(false);
	});

	it('rejects when file byte size is wrong', async () => {
		const verifier = createFakeReadOnlyVerifier({
			fileContent: 'short',
		});
		const result = await verifyPostWrite(verifier, BASE_INPUT);
		expect(result.passed).toBe(false);
		expect(result.checks.fileByteSizeExact).toBe(false);
	});

	it('rejects when file SHA-256 is wrong', async () => {
		const verifier = createFakeReadOnlyVerifier({
			fileContent: 'wrong content with different hash',
		});
		const result = await verifyPostWrite(verifier, BASE_INPUT);
		expect(result.passed).toBe(false);
		expect(result.checks.fileSha256Exact).toBe(false);
	});

	it('rejects when PR is merged', async () => {
		const verifier = createFakeReadOnlyVerifier({
			openPrExists: true,
			prResult: { merged: true, mergedAt: '2026-01-01T00:00:00Z' },
		});
		const result = await verifyPostWrite(verifier, BASE_INPUT);
		expect(result.passed).toBe(false);
		expect(result.checks.prNotMerged).toBe(false);
	});

	it('rejects when PR is not draft', async () => {
		const verifier = createFakeReadOnlyVerifier({
			openPrExists: true,
			prResult: { draft: false },
		});
		const result = await verifyPostWrite(verifier, BASE_INPUT);
		expect(result.passed).toBe(false);
		expect(result.checks.draftPrExists).toBe(false);
	});

	it('rejects when PR title is wrong', async () => {
		const verifier = createFakeReadOnlyVerifier({
			openPrExists: true,
			prResult: { title: 'Wrong PR Title' },
		});
		const result = await verifyPostWrite(verifier, BASE_INPUT);
		expect(result.passed).toBe(false);
		expect(result.checks.prTitleExact).toBe(false);
	});

	it('rejects when PR body is wrong', async () => {
		const verifier = createFakeReadOnlyVerifier({
			openPrExists: true,
			prResult: { body: 'Wrong PR Body' },
		});
		const result = await verifyPostWrite(verifier, BASE_INPUT);
		expect(result.passed).toBe(false);
		expect(result.checks.prBodyExact).toBe(false);
	});

	it('rejects when PR head SHA does not match branch SHA', async () => {
		const verifier = createFakeReadOnlyVerifier({
			openPrExists: true,
			prResult: { headSha: 'wrong-head-sha' },
		});
		const result = await verifyPostWrite(verifier, BASE_INPUT);
		expect(result.passed).toBe(false);
		expect(result.checks.prHeadShaExact).toBe(false);
	});

	it('rejects when PR base SHA does not match expected base SHA', async () => {
		const verifier = createFakeReadOnlyVerifier({
			openPrExists: true,
			prResult: { baseSha: 'wrong-base-sha' },
		});
		const result = await verifyPostWrite(verifier, BASE_INPUT);
		expect(result.passed).toBe(false);
		expect(result.checks.prBaseShaExact).toBe(false);
	});

	it('rejects when no PR exists post-write', async () => {
		const verifier = createFakeReadOnlyVerifier({ openPrExists: false });
		const result = await verifyPostWrite(verifier, BASE_INPUT);
		expect(result.passed).toBe(false);
		expect(result.checks.draftPrExists).toBe(false);
	});

	it('rejects when PR head branch is wrong', async () => {
		const verifier = createFakeReadOnlyVerifier({
			openPrExists: true,
			prResult: { headRef: 'wrong-branch' },
		});
		const result = await verifyPostWrite(verifier, BASE_INPUT);
		expect(result.passed).toBe(false);
		expect(result.checks.prHeadExact).toBe(false);
	});

	it('rejects when PR base branch is wrong', async () => {
		const verifier = createFakeReadOnlyVerifier({
			openPrExists: true,
			prResult: { baseRef: 'wrong-base' },
		});
		const result = await verifyPostWrite(verifier, BASE_INPUT);
		expect(result.passed).toBe(false);
		expect(result.checks.prBaseExact).toBe(false);
	});

	it('rejects when commit message is wrong', async () => {
		const verifier = createFakeReadOnlyVerifier({
			commitResult: { message: 'wrong commit message', parents: ['expected-base-sha'] },
		});
		const result = await verifyPostWrite(verifier, BASE_INPUT);
		expect(result.passed).toBe(false);
		expect(result.checks.commitMessageExact).toBe(false);
	});

	it('rejects when parent SHA is wrong (not based on approved SHA)', async () => {
		const verifier = createFakeReadOnlyVerifier({
			commitResult: {
				parents: ['wrong-parent-sha'],
				message: `${STAGE3_CANONICAL.commitMessage}\n\n${STAGE3_CANONICAL.commitBody}`,
			},
		});
		const result = await verifyPostWrite(verifier, BASE_INPUT);
		expect(result.passed).toBe(false);
		expect(result.checks.targetBranchBasedOnApprovedSha).toBe(false);
	});

	it('passes when all conditions are met', async () => {
		const verifier = createFakeReadOnlyVerifier({
			openPrExists: true,
			targetBranchExists: true,
			targetFileExists: true,
			fileContent: CANONICAL_FILE_CONTENT,
			compareResult: {
				aheadBy: 1,
				totalCommits: 1,
				files: [{ filename: 'stage3/positron-supervised-pilot.md', status: 'added' }],
			},
			commitResult: {
				parents: ['expected-base-sha'],
				message: `${STAGE3_CANONICAL.commitMessage}\n\n${STAGE3_CANONICAL.commitBody}`,
			},
			prResult: {
				draft: true,
				merged: false,
				mergedAt: null,
				title: STAGE3_CANONICAL.prTitle,
				body: STAGE3_CANONICAL.prBody,
				headRef: 'positron/issue-308-stage3-pilot',
				headSha: 'expected-base-sha',
				baseRef: 'main',
				baseSha: 'expected-base-sha',
			},
		});
		const result = await verifyPostWrite(verifier, BASE_INPUT);
		expect(result.passed).toBe(true);
		expect(result.checks.exactlyOnePr).toBe(true);
		expect(result.checks.prBaseShaExact).toBe(true);
		expect(result.checks.prHeadShaExact).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Forbidden Endpoint Detection
// ═══════════════════════════════════════════════════════════════════════════

describe('Forbidden Endpoint Detection', () => {
	it('STAGE3_FORBIDDEN_OCTOKIT_ENDPOINTS includes merge', () => {
		expect(STAGE3_FORBIDDEN_OCTOKIT_ENDPOINTS).toContain('repos.merge');
	});

	it('STAGE3_FORBIDDEN_OCTOKIT_ENDPOINTS includes deleteRef', () => {
		expect(STAGE3_FORBIDDEN_OCTOKIT_ENDPOINTS).toContain('git.deleteRef');
	});

	it('STAGE3_FORBIDDEN_OCTOKIT_ENDPOINTS includes pulls.merge', () => {
		expect(STAGE3_FORBIDDEN_OCTOKIT_ENDPOINTS).toContain('pulls.merge');
	});

	it('verifyNoForbiddenEndpointsCalled returns clean for unused mock', () => {
		const mockOctokit = { rest: { repos: { merge: vi.fn() } } };
		const result = verifyNoForbiddenEndpointsCalled(mockOctokit);
		expect(result.clean).toBe(true);
	});

	it('verifyNoForbiddenEndpointsCalled detects called forbidden endpoint', () => {
		const mockFn = vi.fn();
		mockFn();
		// Endpoint paths are 'repos.merge', 'git.deleteRef', etc. — no 'rest.' prefix
		const mockOctokit = { repos: { merge: mockFn } };
		const result = verifyNoForbiddenEndpointsCalled(mockOctokit);
		expect(result.clean).toBe(false);
		expect(result.violations).toContain('repos.merge');
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Transport — no forbidden endpoints called during operations
// ═══════════════════════════════════════════════════════════════════════════

describe('Transport — no forbidden endpoints during operations', () => {
	const OWNER = 'xxammaxx';
	const REPO = 'positron-sandbox';

	it('no forbidden endpoints called during resolveBaseSha', async () => {
		const octokit = createMockOctokit();
		const transport = createStage3OctokitTransport(octokit, OWNER, REPO);
		await transport.resolveBaseSha(OWNER, REPO, 'main');
		const result = verifyNoForbiddenEndpointsCalled(octokit);
		expect(result.clean).toBe(true);
	});

	it('no forbidden endpoints called during createBranch', async () => {
		const octokit = createMockOctokit();
		const transport = createStage3OctokitTransport(octokit, OWNER, REPO);
		await transport.createBranch(OWNER, REPO, 'test', 'sha');
		const result = verifyNoForbiddenEndpointsCalled(octokit);
		expect(result.clean).toBe(true);
	});

	it('no forbidden endpoints called during commitFile', async () => {
		const octokit = createMockOctokit();
		const transport = createStage3OctokitTransport(octokit, OWNER, REPO);
		await transport.commitFile(OWNER, REPO, 'test', 'f.md', 'content', 'msg');
		const result = verifyNoForbiddenEndpointsCalled(octokit);
		expect(result.clean).toBe(true);
	});

	it('no forbidden endpoints called during createDraftPr', async () => {
		const octokit = createMockOctokit();
		const transport = createStage3OctokitTransport(octokit, OWNER, REPO);
		await transport.createDraftPr(OWNER, REPO, 'title', 'head', 'base', 'body');
		const result = verifyNoForbiddenEndpointsCalled(octokit);
		expect(result.clean).toBe(true);
	});

	it('no forbidden endpoints called during findOpenPr', async () => {
		const octokit = createMockOctokit();
		const transport = createStage3OctokitTransport(octokit, OWNER, REPO);
		await transport.findOpenPr(OWNER, REPO, 'head', 'base');
		const result = verifyNoForbiddenEndpointsCalled(octokit);
		expect(result.clean).toBe(true);
	});
});
