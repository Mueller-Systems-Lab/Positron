// Positron — Stage 3 Bridge Integrity Tests
//
// Phase B: In-Place Mutation Resistance
// Phase C: Integrity Attestation (WeakMap Snapshot)
// Phase D: Deep Freeze Verification
// Phase E: Base-SHA Binding
// Phase F: Branch-Writer expectedSourceSha Enforcement
// Phase G: Base Resolver Defense-in-Depth
// Phase H: Direct Writer Call Tests
// Phase I: Public Runtime Boundary
//
// No real network access. No real tokens. No real writes.

import { describe, expect, it, vi } from 'vitest';
import { GitHubValidationError } from '../errors.js';
import { CANONICAL_FILE_CONTENT } from '../stage3-canonical-manifest.js';
import type {
	Stage3GitHubTransport,
	Stage3RealGitHubBridge,
} from '../stage3-real-github-bridge.js';
import {
	createStage3RealGitHubBridge,
	isTrustedBridge,
	verifyTrustedBridgeIntegrity,
} from '../stage3-real-github-bridge.js';
import { STAGE3_CANONICAL } from '../stage3-supervised-pilot-policy.js';

// ---------------------------------------------------------------------------
// Test Constants
// ---------------------------------------------------------------------------

/** Valid 40-character lowercase hex SHA for testing. */
const TEST_BASE_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/** A different valid SHA for testing mismatch scenarios. */
const WRONG_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

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

function createTrustedBridge(transport?: Stage3GitHubTransport): {
	bridge: Stage3RealGitHubBridge;
	transport: Stage3GitHubTransport;
} {
	const t = transport ?? createSpyTransport();
	const bridge = createStage3RealGitHubBridge({
		transport: t,
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
	return { bridge, transport: t };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase B: In-Place Mutation Resistance
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase B: In-Place Mutation Resistance', () => {
	it('direct property replacement on branchWriter.createBranch is blocked', async () => {
		const { bridge, transport } = createTrustedBridge();
		const maliciousFn = vi.fn().mockResolvedValue({ ref: 'refs/heads/malicious', sha: 'evil' });

		// Attempt mutation — should throw in strict mode because object is frozen
		expect(() => {
			(bridge.branchWriter as any).createBranch = maliciousFn;
		}).toThrow();

		// No calls made during mutation attempt
		expect(maliciousFn).not.toHaveBeenCalled();
		expect(transport.createBranch).not.toHaveBeenCalled();

		// Bridge still has original function
		expect(typeof bridge.branchWriter.createBranch).toBe('function');
	});

	it('Object.defineProperty replacement on branchWriter.createBranch is blocked', () => {
		const { bridge } = createTrustedBridge();
		const maliciousFn = vi.fn();

		expect(() => {
			Object.defineProperty(bridge.branchWriter, 'createBranch', {
				value: maliciousFn,
				writable: false,
				configurable: false,
			});
		}).toThrow();

		expect(maliciousFn).not.toHaveBeenCalled();
	});

	it('prototype mutation via Object.setPrototypeOf is blocked', () => {
		const { bridge } = createTrustedBridge();
		const maliciousProto = { createBranch: vi.fn() };

		expect(() => {
			Object.setPrototypeOf(bridge.branchWriter, maliciousProto);
		}).toThrow();

		expect((bridge.branchWriter as any).createBranch).not.toBe(maliciousProto.createBranch);
	});

	it('nested object replacement (bridge.branchWriter = maliciousWriter) is blocked', async () => {
		const { bridge, transport } = createTrustedBridge();
		const maliciousWriter = {
			createBranch: vi.fn().mockResolvedValue({ ref: 'refs/heads/malicious', sha: 'evil' }),
		};

		expect(() => {
			(bridge as any).branchWriter = maliciousWriter;
		}).toThrow();

		expect(maliciousWriter.createBranch).not.toHaveBeenCalled();
		expect(transport.createBranch).not.toHaveBeenCalled();
	});

	it('method reference replacement on readOnlyVerifier.repository.getDefaultBranch is blocked', () => {
		const { bridge } = createTrustedBridge();
		const maliciousFn = vi.fn();

		expect(() => {
			(bridge.readOnlyVerifier.repository as any).getDefaultBranch = maliciousFn;
		}).toThrow();

		expect(maliciousFn).not.toHaveBeenCalled();
		expect(typeof bridge.readOnlyVerifier.repository.getDefaultBranch).toBe('function');
	});

	it('method reference replacement on readOnlyVerifier.branch.getBranch is blocked', () => {
		const { bridge } = createTrustedBridge();
		const maliciousFn = vi.fn();

		expect(() => {
			(bridge.readOnlyVerifier.branch as any).getBranch = maliciousFn;
		}).toThrow();

		expect(maliciousFn).not.toHaveBeenCalled();
	});

	it('method reference replacement on readOnlyVerifier.content.getFileContent is blocked', () => {
		const { bridge } = createTrustedBridge();
		const maliciousFn = vi.fn();

		expect(() => {
			(bridge.readOnlyVerifier.content as any).getFileContent = maliciousFn;
		}).toThrow();

		expect(maliciousFn).not.toHaveBeenCalled();
	});

	it('method reference replacement on readOnlyVerifier.commit.getCommit is blocked', () => {
		const { bridge } = createTrustedBridge();
		const maliciousFn = vi.fn();

		expect(() => {
			(bridge.readOnlyVerifier.commit as any).getCommit = maliciousFn;
		}).toThrow();

		expect(maliciousFn).not.toHaveBeenCalled();
	});

	it('method reference replacement on readOnlyVerifier.pullRequest.findOpenPr is blocked', () => {
		const { bridge } = createTrustedBridge();
		const maliciousFn = vi.fn();

		expect(() => {
			(bridge.readOnlyVerifier.pullRequest as any).findOpenPr = maliciousFn;
		}).toThrow();

		expect(maliciousFn).not.toHaveBeenCalled();
	});

	it('method reference replacement on readOnlyVerifier.compare.compareCommits is blocked', () => {
		const { bridge } = createTrustedBridge();
		const maliciousFn = vi.fn();

		expect(() => {
			(bridge.readOnlyVerifier.compare as any).compareCommits = maliciousFn;
		}).toThrow();

		expect(maliciousFn).not.toHaveBeenCalled();
	});

	it('all mutation attempts result in zero transport calls and writeAttempted: false', async () => {
		const { bridge, transport } = createTrustedBridge();

		// Attempt multiple mutations
		const fns = [vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()];

		try {
			(bridge.branchWriter as any).createBranch = fns[0];
		} catch {
			/* expected */
		}
		try {
			(bridge.fileCommitWriter as any).commitFile = fns[1];
		} catch {
			/* expected */
		}
		try {
			(bridge.prWriter as any).createPullRequest = fns[2];
		} catch {
			/* expected */
		}
		try {
			(bridge as any).baseResolver = { resolveBase: fns[3] };
		} catch {
			/* expected */
		}
		try {
			(bridge as any).readOnlyVerifier = { repository: { getDefaultBranch: fns[4] } };
		} catch {
			/* expected */
		}

		// Verify no malicious or transport calls
		for (const fn of fns) {
			expect(fn).not.toHaveBeenCalled();
		}
		expect(transport.resolveBaseSha).not.toHaveBeenCalled();
		expect(transport.createBranch).not.toHaveBeenCalled();
		expect(transport.commitFile).not.toHaveBeenCalled();
		expect(transport.createDraftPr).not.toHaveBeenCalled();

		// Bridge integrity still valid
		expect(isTrustedBridge(bridge)).toBe(true);
		expect(() => verifyTrustedBridgeIntegrity(bridge)).not.toThrow();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase C: Integrity Attestation (WeakMap Snapshot)
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase C: Integrity Attestation (WeakMap Snapshot)', () => {
	it('verifyTrustedBridgeIntegrity passes for factory-created bridge', () => {
		const { bridge } = createTrustedBridge();
		expect(() => verifyTrustedBridgeIntegrity(bridge)).not.toThrow();
	});

	it('verifyTrustedBridgeIntegrity rejects a forged bridge (not in WeakMap)', () => {
		const forged: Stage3RealGitHubBridge = {
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

		expect(() => verifyTrustedBridgeIntegrity(forged)).toThrow(GitHubValidationError);
		expect(() => verifyTrustedBridgeIntegrity(forged)).toThrow('integrity violation');
	});

	it('verifyTrustedBridgeIntegrity rejects a spread-cloned bridge', () => {
		const { bridge } = createTrustedBridge();
		const cloned = { ...bridge } as Stage3RealGitHubBridge;
		expect(() => verifyTrustedBridgeIntegrity(cloned)).toThrow(GitHubValidationError);
	});

	it('verifyTrustedBridgeIntegrity rejects a JSON-roundtripped bridge', () => {
		const { bridge } = createTrustedBridge();
		const roundtripped = JSON.parse(JSON.stringify(bridge)) as Stage3RealGitHubBridge;
		expect(() => verifyTrustedBridgeIntegrity(roundtripped)).toThrow(GitHubValidationError);
	});

	it('verifyTrustedBridgeIntegrity error includes phase and reason', () => {
		const forged: Stage3RealGitHubBridge = {
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

		try {
			verifyTrustedBridgeIntegrity(forged);
			expect.fail('Should have thrown');
		} catch (e: any) {
			expect(e.message).toContain('phase: preflight-security');
			expect(e.message).toContain('reason: trusted bridge integrity violation');
			expect(e.message).toContain('reader calls: 0');
			expect(e.message).toContain('writer calls: 0');
		}
	});

	it('multiple bridges each have independent snapshots', () => {
		const t1 = createSpyTransport();
		const t2 = createSpyTransport();
		const b1 = createStage3RealGitHubBridge({
			transport: t1,
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
		const b2 = createStage3RealGitHubBridge({
			transport: t2,
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

		expect(() => verifyTrustedBridgeIntegrity(b1)).not.toThrow();
		expect(() => verifyTrustedBridgeIntegrity(b2)).not.toThrow();
		// Different bridge objects
		expect(b1).not.toBe(b2);
	});

	it('verifyTrustedBridgeIntegrity passes with matching approval Base-SHA', () => {
		const { bridge } = createTrustedBridge();
		// Bridge was created with TEST_BASE_SHA — passing the same SHA should pass
		expect(() => verifyTrustedBridgeIntegrity(bridge, TEST_BASE_SHA)).not.toThrow();
	});

	it('verifyTrustedBridgeIntegrity passes when no approval SHA is provided (backward compat)', () => {
		const { bridge } = createTrustedBridge();
		// Calling without expectedBaseSha should still work (backward compatibility)
		expect(() => verifyTrustedBridgeIntegrity(bridge)).not.toThrow();
	});

	it('verifyTrustedBridgeIntegrity rejects mismatched approval Base-SHA', () => {
		const { bridge } = createTrustedBridge();
		// Bridge was created with TEST_BASE_SHA, but approval has WRONG_SHA
		expect(() => verifyTrustedBridgeIntegrity(bridge, WRONG_SHA)).toThrow(GitHubValidationError);
		expect(() => verifyTrustedBridgeIntegrity(bridge, WRONG_SHA)).toThrow(
			'base-SHA binding mismatch',
		);
	});

	it('SHA mismatch error includes zero-call evidence', () => {
		const { bridge } = createTrustedBridge();
		try {
			verifyTrustedBridgeIntegrity(bridge, WRONG_SHA);
			expect.fail('Should have thrown');
		} catch (e: any) {
			expect(e.message).toContain('phase: preflight-security');
			expect(e.message).toContain('reason: trusted bridge base-SHA binding mismatch');
			expect(e.message).toContain('reader calls: 0');
			expect(e.message).toContain('writer calls: 0');
			expect(e.message).toContain('writeAttempted: false');
			expect(e.message).toContain('mutationState: none');
		}
	});

	it('SHA mismatch on forged bridge still throws integrity error first', () => {
		const forged: Stage3RealGitHubBridge = {
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

		// Forged bridge: should fail on "not found in trusted snapshot registry" BEFORE SHA comparison
		expect(() => verifyTrustedBridgeIntegrity(forged, TEST_BASE_SHA)).toThrow(
			'integrity violation',
		);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase D: Deep Freeze Verification
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase D: Deep Freeze', () => {
	it('bridge root object is frozen', () => {
		const { bridge } = createTrustedBridge();
		expect(Object.isFrozen(bridge)).toBe(true);
	});

	it('bridge.baseResolver is frozen', () => {
		const { bridge } = createTrustedBridge();
		expect(Object.isFrozen(bridge.baseResolver)).toBe(true);
	});

	it('bridge.branchWriter is frozen', () => {
		const { bridge } = createTrustedBridge();
		expect(Object.isFrozen(bridge.branchWriter)).toBe(true);
	});

	it('bridge.fileCommitWriter is frozen', () => {
		const { bridge } = createTrustedBridge();
		expect(Object.isFrozen(bridge.fileCommitWriter)).toBe(true);
	});

	it('bridge.prWriter is frozen', () => {
		const { bridge } = createTrustedBridge();
		expect(Object.isFrozen(bridge.prWriter)).toBe(true);
	});

	it('bridge.readOnlyVerifier is frozen', () => {
		const { bridge } = createTrustedBridge();
		expect(Object.isFrozen(bridge.readOnlyVerifier)).toBe(true);
	});

	it('bridge.readOnlyVerifier.repository is frozen', () => {
		const { bridge } = createTrustedBridge();
		expect(Object.isFrozen(bridge.readOnlyVerifier.repository)).toBe(true);
	});

	it('bridge.readOnlyVerifier.branch is frozen', () => {
		const { bridge } = createTrustedBridge();
		expect(Object.isFrozen(bridge.readOnlyVerifier.branch)).toBe(true);
	});

	it('bridge.readOnlyVerifier.content is frozen', () => {
		const { bridge } = createTrustedBridge();
		expect(Object.isFrozen(bridge.readOnlyVerifier.content)).toBe(true);
	});

	it('bridge.readOnlyVerifier.commit is frozen', () => {
		const { bridge } = createTrustedBridge();
		expect(Object.isFrozen(bridge.readOnlyVerifier.commit)).toBe(true);
	});

	it('bridge.readOnlyVerifier.pullRequest is frozen', () => {
		const { bridge } = createTrustedBridge();
		expect(Object.isFrozen(bridge.readOnlyVerifier.pullRequest)).toBe(true);
	});

	it('bridge.readOnlyVerifier.compare is frozen', () => {
		const { bridge } = createTrustedBridge();
		expect(Object.isFrozen(bridge.readOnlyVerifier.compare)).toBe(true);
	});

	it('frozen bridge still has callable methods', async () => {
		const { bridge, transport } = createTrustedBridge();
		// All methods should still be callable despite being frozen
		expect(typeof bridge.baseResolver.resolveBase).toBe('function');
		expect(typeof bridge.branchWriter.createBranch).toBe('function');
		expect(typeof bridge.fileCommitWriter.commitFile).toBe('function');
		expect(typeof bridge.prWriter.createPullRequest).toBe('function');
		expect(typeof bridge.readOnlyVerifier.repository.getDefaultBranch).toBe('function');
		expect(typeof bridge.readOnlyVerifier.branch.getBranch).toBe('function');
		expect(typeof bridge.readOnlyVerifier.content.getFileContent).toBe('function');
		expect(typeof bridge.readOnlyVerifier.commit.getCommit).toBe('function');
		expect(typeof bridge.readOnlyVerifier.pullRequest.findOpenPr).toBe('function');
		expect(typeof bridge.readOnlyVerifier.compare.compareCommits).toBe('function');

		// Methods still work
		const result = await bridge.branchWriter.createBranch({
			owner: 'xxammaxx',
			repo: 'positron-sandbox',
			branch: STAGE3_CANONICAL.targetBranch,
			sourceBranch: STAGE3_CANONICAL.baseBranch,
			expectedSourceSha: TEST_BASE_SHA,
		});
		expect(result).toBeDefined();
		expect(transport.createBranch).toHaveBeenCalledTimes(1);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase E: Base-SHA Binding
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase E: Base-SHA Binding', () => {
	it('factory rejects missing expectedBaseSha', () => {
		expect(() =>
			createStage3RealGitHubBridge({
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
				expectedBaseSha: undefined as any,
			}),
		).toThrow(GitHubValidationError);
	});

	it('factory rejects empty expectedBaseSha', () => {
		expect(() =>
			createStage3RealGitHubBridge({
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
				expectedBaseSha: '',
			}),
		).toThrow(GitHubValidationError);
	});

	it('factory rejects short SHA', () => {
		expect(() =>
			createStage3RealGitHubBridge({
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
				expectedBaseSha: 'abc123',
			}),
		).toThrow(GitHubValidationError);
	});

	it('factory rejects uppercase SHA', () => {
		expect(() =>
			createStage3RealGitHubBridge({
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
				expectedBaseSha: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
			}),
		).toThrow(GitHubValidationError);
	});

	it('factory rejects non-hex SHA', () => {
		expect(() =>
			createStage3RealGitHubBridge({
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
				expectedBaseSha: 'expected-base-sha-0000000000000000000000000000000000000000',
			}),
		).toThrow(GitHubValidationError);
	});

	it('factory accepts valid 40-character lowercase hex SHA', () => {
		expect(() =>
			createStage3RealGitHubBridge({
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
			}),
		).not.toThrow();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase F: Branch-Writer expectedSourceSha Enforcement
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase F: Branch-Writer expectedSourceSha Enforcement', () => {
	it('wrong SHA is rejected', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.branchWriter.createBranch({
				owner: 'xxammaxx',
				repo: 'positron-sandbox',
				branch: STAGE3_CANONICAL.targetBranch,
				sourceBranch: STAGE3_CANONICAL.baseBranch,
				expectedSourceSha: WRONG_SHA,
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.createBranch).not.toHaveBeenCalled();
	});

	it('empty SHA is rejected', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.branchWriter.createBranch({
				owner: 'xxammaxx',
				repo: 'positron-sandbox',
				branch: STAGE3_CANONICAL.targetBranch,
				sourceBranch: STAGE3_CANONICAL.baseBranch,
				expectedSourceSha: '',
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.createBranch).not.toHaveBeenCalled();
	});

	it('short SHA is rejected', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.branchWriter.createBranch({
				owner: 'xxammaxx',
				repo: 'positron-sandbox',
				branch: STAGE3_CANONICAL.targetBranch,
				sourceBranch: STAGE3_CANONICAL.baseBranch,
				expectedSourceSha: 'abc123',
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.createBranch).not.toHaveBeenCalled();
	});

	it('uppercase/noncanonical SHA is rejected', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.branchWriter.createBranch({
				owner: 'xxammaxx',
				repo: 'positron-sandbox',
				branch: STAGE3_CANONICAL.targetBranch,
				sourceBranch: STAGE3_CANONICAL.baseBranch,
				expectedSourceSha: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.createBranch).not.toHaveBeenCalled();
	});

	it('correctly formed but different SHA is rejected', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.branchWriter.createBranch({
				owner: 'xxammaxx',
				repo: 'positron-sandbox',
				branch: STAGE3_CANONICAL.targetBranch,
				sourceBranch: STAGE3_CANONICAL.baseBranch,
				expectedSourceSha: '1111111111111111111111111111111111111111',
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.createBranch).not.toHaveBeenCalled();
	});

	it('correct SHA is accepted and transport is called', async () => {
		const { bridge, transport } = createTrustedBridge();
		const result = await bridge.branchWriter.createBranch({
			owner: 'xxammaxx',
			repo: 'positron-sandbox',
			branch: STAGE3_CANONICAL.targetBranch,
			sourceBranch: STAGE3_CANONICAL.baseBranch,
			expectedSourceSha: TEST_BASE_SHA,
		});
		expect(result).toBeDefined();
		expect(transport.createBranch).toHaveBeenCalledTimes(1);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase G: Base Resolver Defense-in-Depth
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase G: Base Resolver Defense-in-Depth', () => {
	it('wrong owner is rejected', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.baseResolver.resolveBase({
				owner: 'evil-attacker',
				repo: 'positron-sandbox',
				branch: STAGE3_CANONICAL.baseBranch,
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.resolveBaseSha).not.toHaveBeenCalled();
	});

	it('wrong repo is rejected', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.baseResolver.resolveBase({
				owner: 'xxammaxx',
				repo: 'malicious-repo',
				branch: STAGE3_CANONICAL.baseBranch,
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.resolveBaseSha).not.toHaveBeenCalled();
	});

	it('wrong branch is rejected', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.baseResolver.resolveBase({
				owner: 'xxammaxx',
				repo: 'positron-sandbox',
				branch: 'malicious-branch',
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.resolveBaseSha).not.toHaveBeenCalled();
	});

	it('correct args are accepted and transport is called', async () => {
		const { bridge, transport } = createTrustedBridge();
		const result = await bridge.baseResolver.resolveBase({
			owner: 'xxammaxx',
			repo: 'positron-sandbox',
			branch: STAGE3_CANONICAL.baseBranch,
		});
		expect(result).toBeDefined();
		expect(result.sha).toBe(TEST_BASE_SHA);
		expect(transport.resolveBaseSha).toHaveBeenCalledTimes(1);
	});

	it('transport not reached after validation failure', async () => {
		const { bridge, transport } = createTrustedBridge();

		// Wrong owner
		await expect(
			bridge.baseResolver.resolveBase({
				owner: 'evil',
				repo: 'positron-sandbox',
				branch: STAGE3_CANONICAL.baseBranch,
			}),
		).rejects.toThrow();

		// Wrong repo
		await expect(
			bridge.baseResolver.resolveBase({
				owner: 'xxammaxx',
				repo: 'evil',
				branch: STAGE3_CANONICAL.baseBranch,
			}),
		).rejects.toThrow();

		// Wrong branch
		await expect(
			bridge.baseResolver.resolveBase({
				owner: 'xxammaxx',
				repo: 'positron-sandbox',
				branch: 'evil',
			}),
		).rejects.toThrow();

		// Transport was never reached
		expect(transport.resolveBaseSha).not.toHaveBeenCalled();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase H: Direct Writer Call Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase H: Direct Writer Call Tests', () => {
	it('branchWriter.createBranch with wrong expectedSourceSha fails', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.branchWriter.createBranch({
				owner: 'xxammaxx',
				repo: 'positron-sandbox',
				branch: STAGE3_CANONICAL.targetBranch,
				sourceBranch: STAGE3_CANONICAL.baseBranch,
				expectedSourceSha: WRONG_SHA,
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.createBranch).not.toHaveBeenCalled();
	});

	it('branchWriter.createBranch with wrong owner fails', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.branchWriter.createBranch({
				owner: 'evil-owner',
				repo: 'positron-sandbox',
				branch: STAGE3_CANONICAL.targetBranch,
				sourceBranch: STAGE3_CANONICAL.baseBranch,
				expectedSourceSha: TEST_BASE_SHA,
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.createBranch).not.toHaveBeenCalled();
	});

	it('branchWriter.createBranch with wrong repo fails', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.branchWriter.createBranch({
				owner: 'xxammaxx',
				repo: 'wrong-repo',
				branch: STAGE3_CANONICAL.targetBranch,
				sourceBranch: STAGE3_CANONICAL.baseBranch,
				expectedSourceSha: TEST_BASE_SHA,
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.createBranch).not.toHaveBeenCalled();
	});

	it('branchWriter.createBranch with wrong source branch fails', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.branchWriter.createBranch({
				owner: 'xxammaxx',
				repo: 'positron-sandbox',
				branch: STAGE3_CANONICAL.targetBranch,
				sourceBranch: 'wrong-source',
				expectedSourceSha: TEST_BASE_SHA,
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.createBranch).not.toHaveBeenCalled();
	});

	it('branchWriter.createBranch with wrong target branch fails', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.branchWriter.createBranch({
				owner: 'xxammaxx',
				repo: 'positron-sandbox',
				branch: 'wrong-target',
				sourceBranch: STAGE3_CANONICAL.baseBranch,
				expectedSourceSha: TEST_BASE_SHA,
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.createBranch).not.toHaveBeenCalled();
	});

	it('fileCommitWriter.commitFile with wrong content fails', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.fileCommitWriter.commitFile({
				owner: 'xxammaxx',
				repo: 'positron-sandbox',
				branch: STAGE3_CANONICAL.targetBranch,
				filePath: STAGE3_CANONICAL.filePath,
				content: 'malicious content',
				message: STAGE3_CANONICAL.commitMessage,
				commitBody: STAGE3_CANONICAL.commitBody,
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.commitFile).not.toHaveBeenCalled();
	});

	it('fileCommitWriter.commitFile with wrong file path fails', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.fileCommitWriter.commitFile({
				owner: 'xxammaxx',
				repo: 'positron-sandbox',
				branch: STAGE3_CANONICAL.targetBranch,
				filePath: 'wrong/path.md',
				content: CANONICAL_FILE_CONTENT,
				message: STAGE3_CANONICAL.commitMessage,
				commitBody: STAGE3_CANONICAL.commitBody,
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.commitFile).not.toHaveBeenCalled();
	});

	it('fileCommitWriter.commitFile with wrong commit metadata fails', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.fileCommitWriter.commitFile({
				owner: 'xxammaxx',
				repo: 'positron-sandbox',
				branch: STAGE3_CANONICAL.targetBranch,
				filePath: STAGE3_CANONICAL.filePath,
				content: CANONICAL_FILE_CONTENT,
				message: 'wrong commit message',
				commitBody: STAGE3_CANONICAL.commitBody,
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.commitFile).not.toHaveBeenCalled();
	});

	it('prWriter.createPullRequest with wrong title fails', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.prWriter.createPullRequest({
				owner: 'xxammaxx',
				repo: 'positron-sandbox',
				title: 'wrong PR title',
				head: STAGE3_CANONICAL.targetBranch,
				base: STAGE3_CANONICAL.baseBranch,
				body: STAGE3_CANONICAL.prBody,
				draft: true,
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.createDraftPr).not.toHaveBeenCalled();
	});

	it('prWriter.createPullRequest with wrong PR metadata fails', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.prWriter.createPullRequest({
				owner: 'xxammaxx',
				repo: 'positron-sandbox',
				title: STAGE3_CANONICAL.prTitle,
				head: STAGE3_CANONICAL.targetBranch,
				base: STAGE3_CANONICAL.baseBranch,
				body: 'wrong PR body',
				draft: true,
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.createDraftPr).not.toHaveBeenCalled();
	});

	it('prWriter.createPullRequest with non-draft PR fails', async () => {
		const { bridge, transport } = createTrustedBridge();
		await expect(
			bridge.prWriter.createPullRequest({
				owner: 'xxammaxx',
				repo: 'positron-sandbox',
				title: STAGE3_CANONICAL.prTitle,
				head: STAGE3_CANONICAL.targetBranch,
				base: STAGE3_CANONICAL.baseBranch,
				body: STAGE3_CANONICAL.prBody,
				draft: false,
			}),
		).rejects.toThrow(GitHubValidationError);
		expect(transport.createDraftPr).not.toHaveBeenCalled();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase I: Public Runtime Boundary
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase I: Public Runtime Boundary', () => {
	it('createStage3RealGitHubBridge is NOT exported from package root', async () => {
		const pkg = await import('@positron/github-adapter');
		expect(pkg).not.toHaveProperty('createStage3RealGitHubBridge');
	});

	it('isTrustedBridge is NOT exported from package root', async () => {
		const pkg = await import('@positron/github-adapter');
		expect(pkg).not.toHaveProperty('isTrustedBridge');
	});

	it('TrustedBridgeSnapshot type is NOT exported from package root', async () => {
		const pkg = await import('@positron/github-adapter');
		expect(pkg).not.toHaveProperty('TrustedBridgeSnapshot');
	});

	it('verifyTrustedBridgeIntegrity is NOT exported from package root', async () => {
		const pkg = await import('@positron/github-adapter');
		expect(pkg).not.toHaveProperty('verifyTrustedBridgeIntegrity');
	});

	it('trustedBridgeSnapshots WeakMap is NOT exported from package root', async () => {
		const pkg = await import('@positron/github-adapter');
		expect(pkg).not.toHaveProperty('trustedBridgeSnapshots');
	});

	it('Stage3GitHubTransport type is NOT exported from package root', async () => {
		const pkg = await import('@positron/github-adapter');
		expect(pkg).not.toHaveProperty('Stage3GitHubTransport');
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
