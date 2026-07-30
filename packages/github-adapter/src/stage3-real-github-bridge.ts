// Positron — Stage 3 Real GitHub Bridge
//
// Restricted, capability-minimal bridge between the Stage 3 harness
// and the GitHub API. Only exposes the exact operations needed for
// the Stage 3 supervised pilot: read base SHA, create branch from
// exact SHA, commit one file, create one draft PR, and read-only
// verification.
//
// Forbidden capabilities (never exposed):
//   merge, delete branch, labels, issue close, review request,
//   workflow dispatch, release, repository settings, arbitrary
//   file update.

import { GitHubValidationError } from './errors.js';
import type { Stage3BaseResolver, Stage3ResolvedBase } from './stage3-base-resolver.js';
import { sha256Utf8, utf8ByteLength } from './stage3-canonical-manifest.js';
import type {
	Stage3BranchReader,
	Stage3CommitReader,
	Stage3CompareReader,
	Stage3ContentReader,
	Stage3PullRequestReader,
	Stage3ReadOnlyVerifier,
	Stage3RepositoryReader,
} from './stage3-reader-verifier.js';
import type {
	Stage3BranchWriter,
	Stage3FileCommitWriter,
	Stage3PullRequestWriter,
} from './stage3-runtime-harness.js';
import { STAGE3_CANONICAL } from './stage3-supervised-pilot-policy.js';

// ---------------------------------------------------------------------------
// Bridge Provenance Registry (WeakSet-based, non-forgeable)
// ---------------------------------------------------------------------------
//
// PROVENANCE MECHANISM:
// Only bridges registered through the internal createStage3RealGitHubBridge()
// factory are trusted. The WeakSet stores object identity references — a
// forged bridge constructed by a caller will NEVER be in this set, regardless
// of its shape, kind string, or property names.
//
// WeakSet provides:
//   - No iteration (attacker cannot enumerate registered bridges)
//   - No serialization (attacker cannot reconstruct the set)
//   - GC-safe (bridges can be collected when no longer referenced)
//   - Object identity check (structural copies fail)

const trustedRealBridges = new WeakSet<object>();

/**
 * Check if a bridge is a genuinely trusted, internally-constructed bridge.
 * Uses object identity via WeakSet — not structural comparison.
 */
export function isTrustedBridge(bridge: Stage3RealGitHubBridge): boolean {
	return trustedRealBridges.has(bridge);
}

// ---------------------------------------------------------------------------
// SHA Validation
// ---------------------------------------------------------------------------

/**
 * Assert that a value is a valid 40-character lowercase hex SHA-1 hash.
 * Throws GitHubValidationError if the value is missing, empty, too short,
 * too long, contains uppercase letters, or contains non-hex characters.
 */
function assertFullCommitSha(sha: string): void {
	if (!sha || typeof sha !== 'string') {
		throw new GitHubValidationError('expectedBaseSha is required');
	}
	if (sha.length !== 40) {
		throw new GitHubValidationError(`expectedBaseSha must be 40 characters, got ${sha.length}`);
	}
	if (!/^[0-9a-f]{40}$/.test(sha)) {
		throw new GitHubValidationError('expectedBaseSha must be a lowercase hex SHA-1 hash');
	}
}

// ---------------------------------------------------------------------------
// Integrity Helpers
// ---------------------------------------------------------------------------

/**
 * Create a structured integrity violation error with phase context.
 * The error message follows the standard preflight-security format.
 */
function integrityError(detail: string): GitHubValidationError {
	return new GitHubValidationError(
		'phase: preflight-security\n' +
			'reason: trusted bridge integrity violation\n' +
			'reader calls: 0\n' +
			'writer calls: 0\n' +
			detail,
	);
}

// ---------------------------------------------------------------------------
// Deep Freeze
// ---------------------------------------------------------------------------

/**
 * Recursively freeze an object and all nested objects.
 * Prevents any property modification on the bridge and its sub-objects.
 * Freezing a function does not prevent it from being called — only from
 * being replaced or having its properties modified.
 */
function deepFreeze(obj: object): void {
	Object.freeze(obj);
	for (const key of Object.getOwnPropertyNames(obj)) {
		const val = (obj as any)[key];
		if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
			deepFreeze(val);
		}
	}
	const proto = Object.getPrototypeOf(obj);
	if (proto !== null && proto !== Object.prototype && !Object.isFrozen(proto)) {
		deepFreeze(proto);
	}
}

// ---------------------------------------------------------------------------
// Trusted Bridge Snapshot (WeakMap-based integrity attestation)
// ---------------------------------------------------------------------------

/**
 * Immutable snapshot of all object and function references captured at
 * bridge construction time. Used by verifyTrustedBridgeIntegrity to detect
 * any post-construction tampering — property replacement, prototype
 * manipulation, or nested object swaps.
 */
export interface TrustedBridgeSnapshot {
	__root: object;
	baseResolver: object;
	resolveBase: Stage3BaseResolver['resolveBase'];
	branchWriter: object;
	createBranch: Stage3BranchWriter['createBranch'];
	fileCommitWriter: object;
	commitFile: Stage3FileCommitWriter['commitFile'];
	prWriter: object;
	createPullRequest: Stage3PullRequestWriter['createPullRequest'];
	readOnlyVerifier: object;
	repositoryReader: object;
	getDefaultBranch: Stage3RepositoryReader['getDefaultBranch'];
	branchReader: object;
	getBranch: Stage3BranchReader['getBranch'];
	contentReader: object;
	getFileContent: Stage3ContentReader['getFileContent'];
	commitReader: object;
	getCommit: Stage3CommitReader['getCommit'];
	pullRequestReader: object;
	findOpenPr: Stage3PullRequestReader['findOpenPr'];
	compareReader: object;
	compareCommits: Stage3CompareReader['compareCommits'];
	expectedBaseSha: string;
}

/**
 * WeakMap storing integrity snapshots for each trusted bridge.
 * Keyed by the bridge object itself — only internally-created bridges
 * have registered snapshots.
 */
const trustedBridgeSnapshots = new WeakMap<object, TrustedBridgeSnapshot>();

/**
 * Verify that a bridge has not been tampered with since construction.
 *
 * Checks:
 *   1. Bridge exists in the trusted snapshot registry (WeakMap)
 *   2. Root object identity matches the original bridge reference
 *   3. All nested object references match the original snapshots
 *   4. All function references match the original snapshots
 *   5. Reader sub-object references match the original snapshots
 *   6. Reader function references match the original snapshots
 *   7. expectedBaseSha binding is present
 *
 * Throws GitHubValidationError on any mismatch.
 */
export function verifyTrustedBridgeIntegrity(
	bridge: Stage3RealGitHubBridge,
	expectedBaseSha?: string,
): void {
	const snapshot = trustedBridgeSnapshots.get(bridge);
	if (!snapshot) {
		throw new GitHubValidationError(
			'phase: preflight-security\n' +
				'reason: trusted bridge integrity violation\n' +
				'reader calls: 0\n' +
				'writer calls: 0\n' +
				'bridge not found in trusted snapshot registry',
		);
	}

	// Check root object identity
	if (bridge !== (snapshot as any).__root) {
		throw new GitHubValidationError(
			'phase: preflight-security\nreason: trusted bridge integrity violation\nreader calls: 0\nwriter calls: 0\nroot object identity mismatch',
		);
	}

	// Check nested object identities
	if (bridge.baseResolver !== snapshot.baseResolver) throw integrityError('baseResolver identity');
	if (bridge.branchWriter !== snapshot.branchWriter) throw integrityError('branchWriter identity');
	if (bridge.fileCommitWriter !== snapshot.fileCommitWriter)
		throw integrityError('fileCommitWriter identity');
	if (bridge.prWriter !== snapshot.prWriter) throw integrityError('prWriter identity');
	if (bridge.readOnlyVerifier !== snapshot.readOnlyVerifier)
		throw integrityError('readOnlyVerifier identity');

	// Check writer function identities
	if (bridge.baseResolver.resolveBase !== snapshot.resolveBase)
		throw integrityError('resolveBase function');
	if (bridge.branchWriter.createBranch !== snapshot.createBranch)
		throw integrityError('createBranch function');
	if (bridge.fileCommitWriter.commitFile !== snapshot.commitFile)
		throw integrityError('commitFile function');
	if (bridge.prWriter.createPullRequest !== snapshot.createPullRequest)
		throw integrityError('createPullRequest function');

	// Check reader sub-object identities
	if (bridge.readOnlyVerifier.repository !== snapshot.repositoryReader)
		throw integrityError('repositoryReader identity');
	if (bridge.readOnlyVerifier.branch !== snapshot.branchReader)
		throw integrityError('branchReader identity');
	if (bridge.readOnlyVerifier.content !== snapshot.contentReader)
		throw integrityError('contentReader identity');
	if (bridge.readOnlyVerifier.commit !== snapshot.commitReader)
		throw integrityError('commitReader identity');
	if (bridge.readOnlyVerifier.pullRequest !== snapshot.pullRequestReader)
		throw integrityError('pullRequestReader identity');
	if (bridge.readOnlyVerifier.compare !== snapshot.compareReader)
		throw integrityError('compareReader identity');

	// Check reader function identities
	if (bridge.readOnlyVerifier.repository.getDefaultBranch !== snapshot.getDefaultBranch)
		throw integrityError('getDefaultBranch function');
	if (bridge.readOnlyVerifier.branch.getBranch !== snapshot.getBranch)
		throw integrityError('getBranch function');
	if (bridge.readOnlyVerifier.content.getFileContent !== snapshot.getFileContent)
		throw integrityError('getFileContent function');
	if (bridge.readOnlyVerifier.commit.getCommit !== snapshot.getCommit)
		throw integrityError('getCommit function');
	if (bridge.readOnlyVerifier.pullRequest.findOpenPr !== snapshot.findOpenPr)
		throw integrityError('findOpenPr function');
	if (bridge.readOnlyVerifier.compare.compareCommits !== snapshot.compareCommits)
		throw integrityError('compareCommits function');

	// Check expectedBaseSha is bound
	if (snapshot.expectedBaseSha === undefined || snapshot.expectedBaseSha === null) {
		throw integrityError('expectedBaseSha binding');
	}

	// Check expectedBaseSha matches the caller-supplied approval SHA
	if (expectedBaseSha !== undefined) {
		if (snapshot.expectedBaseSha !== expectedBaseSha) {
			throw new GitHubValidationError(
				'phase: preflight-security\n' +
					'reason: trusted bridge base-SHA binding mismatch\n' +
					'reader calls: 0\n' +
					'writer calls: 0\n' +
					'writeAttempted: false\n' +
					'mutationState: none',
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Bridge Capability Contract
// ---------------------------------------------------------------------------

/**
 * Allowed capabilities for the Stage 3 bridge.
 * Everything NOT listed here is forbidden.
 */
export const STAGE3_ALLOWED_CAPABILITIES = [
	'resolve-base-sha',
	'create-branch',
	'commit-file',
	'create-draft-pr',
	'read-repository',
	'read-ref',
	'read-file',
	'read-commit',
	'find-pr',
] as const;

export type Stage3AllowedCapability = (typeof STAGE3_ALLOWED_CAPABILITIES)[number];

/**
 * Forbidden capabilities — the bridge MUST NOT expose these.
 */
export const STAGE3_FORBIDDEN_CAPABILITIES = [
	'merge',
	'delete-branch',
	'add-labels',
	'remove-labels',
	'close-issue',
	'request-reviewers',
	'workflow-dispatch',
	'create-release',
	'update-repository-settings',
	'arbitrary-file-update',
] as const;

// ---------------------------------------------------------------------------
// Bridge Interface
// ---------------------------------------------------------------------------

/**
 * Restricted GitHub bridge for Stage 3.
 * Implements exactly the writer and reader interfaces needed.
 */
export interface Stage3RealGitHubBridge {
	/** Discriminator — 'mock' for test-only, 'restricted-real-transport' for live. */
	kind: 'mock' | 'restricted-real-transport';

	/** Resolve base branch SHA read-only (TOCTOU protection). */
	baseResolver: Stage3BaseResolver;

	/** Create exactly one branch from an exact SHA. */
	branchWriter: Stage3BranchWriter;

	/** Commit exactly one file. */
	fileCommitWriter: Stage3FileCommitWriter;

	/** Create exactly one draft PR. */
	prWriter: Stage3PullRequestWriter;

	/** Read-only verification before and after writes. */
	readOnlyVerifier: Stage3ReadOnlyVerifier;
}

// ---------------------------------------------------------------------------
// Bridge Implementation (Mock/Test)
// ---------------------------------------------------------------------------

/**
 * Create a mock Stage 3 bridge for testing.
 * All operations succeed with synthetic data. No network access.
 */
export function createMockStage3Bridge(params?: {
	baseSha?: string;
	targetBranch?: string;
	filePath?: string;
}): Stage3RealGitHubBridge {
	const baseSha = params?.baseSha ?? 'expected-base-sha-0000000000000000000000000000000000000000';
	const targetBranch = params?.targetBranch ?? 'positron/issue-308-stage3-pilot';
	const filePath = params?.filePath ?? 'stage3/positron-supervised-pilot.md';

	return {
		kind: 'mock' as const,

		baseResolver: {
			async resolveBase(_input: {
				owner: string;
				repo: string;
				branch: string;
			}): Promise<Stage3ResolvedBase> {
				return { branch: _input.branch, sha: baseSha };
			},
		},

		branchWriter: {
			async createBranch(input: {
				owner: string;
				repo: string;
				branch: string;
				sourceBranch: string;
				expectedSourceSha: string;
			}) {
				return { ref: `refs/heads/${input.branch}`, sha: 'branch-sha-from-bridge' };
			},
		},

		fileCommitWriter: {
			async commitFile(input: {
				owner: string;
				repo: string;
				branch: string;
				filePath: string;
				content: string;
				message: string;
				commitBody?: string;
			}) {
				return {
					sha: 'commit-sha-from-bridge',
					url: `https://github.com/${input.owner}/${input.repo}/commit/test`,
				};
			},
		},

		prWriter: {
			async createPullRequest(input: {
				owner: string;
				repo: string;
				title: string;
				head: string;
				base: string;
				body: string;
				draft: boolean;
			}) {
				return {
					id: 1,
					number: 1,
					url: `https://github.com/${input.owner}/${input.repo}/pull/1`,
					createdAt: new Date().toISOString(),
					draft: input.draft,
				};
			},
		},

		readOnlyVerifier: {
			repository: {
				async getDefaultBranch(_owner: string, _repo: string) {
					return { name: 'main', sha: baseSha };
				},
			},
			branch: {
				async getBranch(_owner: string, _repo: string, branch: string) {
					return { name: branch, sha: baseSha, exists: branch === targetBranch };
				},
			},
			content: {
				async getFileContent(_owner: string, _repo: string, path: string, _ref?: string) {
					return {
						content: 'test-content',
						gitBlobSha: 'fake-git-blob-sha-000000000000000000000000',
						size: 1724,
						exists: path === filePath,
					};
				},
			},
			commit: {
				async getCommit(_owner: string, _repo: string, sha: string) {
					return {
						sha,
						message: 'test commit',
						authorDate: new Date().toISOString(),
						parents: [baseSha],
						files: [{ filename: filePath, status: 'added' }],
						exists: true,
					};
				},
			},
			pullRequest: {
				async findOpenPr(_owner: string, _repo: string, _head: string, _base: string) {
					return null; // No open PR before execution
				},
			},
			compare: {
				async compareCommits(_owner: string, _repo: string, _base: string, _head: string) {
					return {
						status: 'ahead',
						aheadBy: 1,
						behindBy: 0,
						totalCommits: 1,
						commits: ['fake-commit-sha'],
						files: [{ filename: filePath, status: 'added' }],
					};
				},
			},
		},
	};
}

// ---------------------------------------------------------------------------
// Real Bridge Factory (Live Mode)
// ---------------------------------------------------------------------------

/**
 * Transport interface for the real bridge — minimal graph of write-capable
 * operations. In tests, this is replaced by a spy/mock. At runtime, it is
 * backed by `RealGitHubAdapter` (Octokit).
 */
export interface Stage3GitHubTransport {
	resolveBaseSha(owner: string, repo: string, branch: string): Promise<{ sha: string }>;
	createBranch(
		owner: string,
		repo: string,
		branch: string,
		fromSha: string,
	): Promise<{ ref: string; sha: string }>;
	commitFile(
		owner: string,
		repo: string,
		branch: string,
		path: string,
		content: string,
		message: string,
		body?: string,
	): Promise<{ sha: string; url: string }>;
	createDraftPr(
		owner: string,
		repo: string,
		title: string,
		head: string,
		base: string,
		body: string,
	): Promise<{ id?: number; number?: number; url?: string; createdAt?: string; draft?: boolean }>;
	getDefaultBranch(owner: string, repo: string): Promise<{ name: string; sha: string }>;
	getBranch(
		owner: string,
		repo: string,
		branch: string,
	): Promise<{ name: string; sha: string; exists: boolean }>;
	getFileContent(
		owner: string,
		repo: string,
		path: string,
		ref: string,
	): Promise<{ content: string; gitBlobSha: string; size: number; exists: boolean }>;
	getCommit(
		owner: string,
		repo: string,
		sha: string,
	): Promise<{
		sha: string;
		message: string;
		authorDate: string;
		parents: string[];
		files: Array<{ filename: string; status: string }>;
		exists: boolean;
	}>;
	findOpenPr(
		owner: string,
		repo: string,
		head: string,
		base: string,
	): Promise<{
		number: number;
		state: 'open' | 'closed';
		draft: boolean;
		merged: boolean;
		mergedAt: string | null;
		title: string;
		body: string;
		headRef: string;
		headSha: string;
		baseRef: string;
		baseSha: string;
		exists: boolean;
		totalMatches: number;
	} | null>;
	compareCommits(
		owner: string,
		repo: string,
		base: string,
		head: string,
	): Promise<{
		status: string;
		aheadBy: number;
		behindBy: number;
		totalCommits: number;
		commits: string[];
		files: Array<{ filename: string; status: string }>;
	}>;
}

/**
 * Create a real (non-mock) Stage 3 bridge backed by a transport.
 * The transport is dependency-injected — in tests this is a spy.
 *
 * The bridge exposes ONLY the 5 capability groups allowed by the
 * Stage 3 contract. No merge, delete, label, or workflow operations
 * are accessible through this bridge.
 *
 * PROVENANCE: The created bridge is registered in a WeakSet — only
 * bridges produced by this factory function are trusted. The caller
 * cannot forge a trusted bridge by constructing one manually.
 *
 * DEFENSE-IN-DEPTH: All writer arguments are validated against the
 * canonical manifest before transport calls. The actual file content
 * is SHA-256 hashed and UTF-8 byte length verified.
 */
export function createStage3RealGitHubBridge(params: {
	transport: Stage3GitHubTransport;
	canonicalManifest: {
		targetBranch: string;
		filePath: string;
		expectedFileContent: string;
		expectedFileSha256: string;
		expectedFileBytes: number;
		commitMessage: string;
		commitBody?: string;
		prTitle: string;
		prBody: string;
	};
	expectedBaseSha: string;
}): Stage3RealGitHubBridge {
	const { transport, canonicalManifest: m, expectedBaseSha } = params;

	// ── Phase E: Base-SHA Binding ──
	// Validate the base SHA format before any bridge construction.
	assertFullCommitSha(expectedBaseSha);

	// ── Canonical Manifest Enforcement ──
	// The manifest must match STAGE3_CANONICAL exactly — no caller override.
	// Every field is validated before the bridge is constructed.
	function enforce(actual: unknown, expected: unknown, field: string): void {
		if (actual !== expected) {
			throw new GitHubValidationError(
				`Bridge canonical manifest mismatch for '${field}': ` +
					`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
			);
		}
	}

	enforce(m.targetBranch, STAGE3_CANONICAL.targetBranch, 'targetBranch');
	enforce(m.filePath, STAGE3_CANONICAL.filePath, 'filePath');
	enforce(m.expectedFileSha256, STAGE3_CANONICAL.fileSha256, 'expectedFileSha256');
	enforce(m.expectedFileBytes, STAGE3_CANONICAL.fileUtf8ByteLength, 'expectedFileBytes');
	enforce(m.commitMessage, STAGE3_CANONICAL.commitMessage, 'commitMessage');
	enforce(m.commitBody ?? undefined, STAGE3_CANONICAL.commitBody || undefined, 'commitBody');
	enforce(m.prTitle, STAGE3_CANONICAL.prTitle, 'prTitle');
	enforce(m.prBody, STAGE3_CANONICAL.prBody, 'prBody');

	// ── Phase G: Actual content hash + UTF-8 byte validation ──
	// The caller-declared SHA-256 must match the actual content hash,
	// and the declared byte count must match the actual UTF-8 byte length.
	// This prevents an attacker from passing correct declared hashes while
	// providing different actual content.
	const actualContentSha256 = sha256Utf8(m.expectedFileContent);
	const actualContentBytes = utf8ByteLength(m.expectedFileContent);

	enforce(actualContentSha256, STAGE3_CANONICAL.fileSha256, 'actualContent.sha256');
	enforce(actualContentBytes, STAGE3_CANONICAL.fileUtf8ByteLength, 'actualContent.utf8Bytes');
	enforce(m.expectedFileSha256, actualContentSha256, 'declaredFileSha256');
	enforce(m.expectedFileBytes, actualContentBytes, 'declaredFileBytes');

	// ── Phase F: Defense-in-Depth Writer Argument Validators ──
	// Each writer validates its arguments against canonical values
	// BEFORE calling the transport. Transport is never reached on mismatch.

	// Canonical owner/repo extracted once for reuse
	const [canonicalOwner, canonicalRepo] = STAGE3_CANONICAL.repository.split('/');

	function assertBranchArgs(input: {
		owner: string;
		repo: string;
		branch: string;
		sourceBranch: string;
		expectedSourceSha: string;
	}): void {
		enforce(input.owner, canonicalOwner, 'branchWriter.owner');
		enforce(input.repo, canonicalRepo, 'branchWriter.repo');
		enforce(input.branch, STAGE3_CANONICAL.targetBranch, 'branchWriter.branch');
		enforce(input.sourceBranch, STAGE3_CANONICAL.baseBranch, 'branchWriter.sourceBranch');
		// Enforce expectedSourceSha matches the bound base SHA
		enforce(input.expectedSourceSha, expectedBaseSha, 'branchWriter.expectedSourceSha');
	}

	function assertFileCommitArgs(input: {
		owner: string;
		repo: string;
		branch: string;
		filePath: string;
		content: string;
		message: string;
		commitBody?: string;
	}): void {
		enforce(input.owner, canonicalOwner, 'fileCommitWriter.owner');
		enforce(input.repo, canonicalRepo, 'fileCommitWriter.repo');
		enforce(input.branch, STAGE3_CANONICAL.targetBranch, 'fileCommitWriter.branch');
		enforce(input.filePath, STAGE3_CANONICAL.filePath, 'fileCommitWriter.filePath');
		enforce(input.message, STAGE3_CANONICAL.commitMessage, 'fileCommitWriter.message');
		enforce(
			input.commitBody ?? undefined,
			STAGE3_CANONICAL.commitBody || undefined,
			'fileCommitWriter.commitBody',
		);
		// Validate actual content matches canonical
		const contentSha = sha256Utf8(input.content);
		enforce(contentSha, STAGE3_CANONICAL.fileSha256, 'fileCommitWriter.content.sha256');
		enforce(
			utf8ByteLength(input.content),
			STAGE3_CANONICAL.fileUtf8ByteLength,
			'fileCommitWriter.content.utf8Bytes',
		);
	}

	function assertPrArgs(input: {
		owner: string;
		repo: string;
		title: string;
		head: string;
		base: string;
		body: string;
		draft: boolean;
	}): void {
		enforce(input.owner, canonicalOwner, 'prWriter.owner');
		enforce(input.repo, canonicalRepo, 'prWriter.repo');
		enforce(input.title, STAGE3_CANONICAL.prTitle, 'prWriter.title');
		enforce(input.head, STAGE3_CANONICAL.targetBranch, 'prWriter.head');
		enforce(input.base, STAGE3_CANONICAL.baseBranch, 'prWriter.base');
		enforce(input.body, STAGE3_CANONICAL.prBody, 'prWriter.body');
		enforce(input.draft, true, 'prWriter.draft');
	}

	const bridge: Stage3RealGitHubBridge = {
		kind: 'restricted-real-transport' as const,

		baseResolver: {
			async resolveBase(input) {
				// Defense-in-depth: validate owner, repo, branch before transport
				enforce(input.owner, canonicalOwner, 'baseResolver.owner');
				enforce(input.repo, canonicalRepo, 'baseResolver.repo');
				enforce(input.branch, STAGE3_CANONICAL.baseBranch, 'baseResolver.branch');
				const result = await transport.resolveBaseSha(input.owner, input.repo, input.branch);
				return { branch: input.branch, sha: result.sha };
			},
		},

		branchWriter: {
			async createBranch(input) {
				assertBranchArgs(input);
				return transport.createBranch(
					input.owner,
					input.repo,
					input.branch,
					input.expectedSourceSha,
				);
			},
		},

		fileCommitWriter: {
			async commitFile(input) {
				assertFileCommitArgs(input);
				return transport.commitFile(
					input.owner,
					input.repo,
					input.branch,
					input.filePath,
					input.content,
					input.message,
					input.commitBody,
				);
			},
		},

		prWriter: {
			async createPullRequest(input) {
				assertPrArgs(input);
				return transport.createDraftPr(
					input.owner,
					input.repo,
					input.title,
					input.head,
					input.base,
					input.body,
				);
			},
		},

		readOnlyVerifier: {
			repository: {
				async getDefaultBranch(owner, repo) {
					return transport.getDefaultBranch(owner, repo);
				},
			},
			branch: {
				async getBranch(owner, repo, branch) {
					return transport.getBranch(owner, repo, branch);
				},
			},
			content: {
				async getFileContent(owner, repo, path, ref) {
					return transport.getFileContent(owner, repo, path, ref ?? 'main');
				},
			},
			commit: {
				async getCommit(owner, repo, sha) {
					return transport.getCommit(owner, repo, sha);
				},
			},
			pullRequest: {
				async findOpenPr(owner, repo, head, base) {
					return transport.findOpenPr(owner, repo, head, base);
				},
			},
			compare: {
				async compareCommits(owner, repo, base, head) {
					return transport.compareCommits(owner, repo, base, head);
				},
			},
		},
	};

	// ── Register in trusted WeakSet (non-forgeable provenance) ──
	trustedRealBridges.add(bridge);

	// ── Capture integrity snapshot BEFORE deep freeze ──
	const snapshot: TrustedBridgeSnapshot = {
		__root: bridge,
		baseResolver: bridge.baseResolver,
		resolveBase: bridge.baseResolver.resolveBase,
		branchWriter: bridge.branchWriter,
		createBranch: bridge.branchWriter.createBranch,
		fileCommitWriter: bridge.fileCommitWriter,
		commitFile: bridge.fileCommitWriter.commitFile,
		prWriter: bridge.prWriter,
		createPullRequest: bridge.prWriter.createPullRequest,
		readOnlyVerifier: bridge.readOnlyVerifier,
		repositoryReader: bridge.readOnlyVerifier.repository,
		getDefaultBranch: bridge.readOnlyVerifier.repository.getDefaultBranch,
		branchReader: bridge.readOnlyVerifier.branch,
		getBranch: bridge.readOnlyVerifier.branch.getBranch,
		contentReader: bridge.readOnlyVerifier.content,
		getFileContent: bridge.readOnlyVerifier.content.getFileContent,
		commitReader: bridge.readOnlyVerifier.commit,
		getCommit: bridge.readOnlyVerifier.commit.getCommit,
		pullRequestReader: bridge.readOnlyVerifier.pullRequest,
		findOpenPr: bridge.readOnlyVerifier.pullRequest.findOpenPr,
		compareReader: bridge.readOnlyVerifier.compare,
		compareCommits: bridge.readOnlyVerifier.compare.compareCommits,
		expectedBaseSha,
	};

	// ── Register snapshot in WeakMap (for integrity verification) ──
	trustedBridgeSnapshots.set(bridge, snapshot);

	// ── Deep freeze all objects (mutation resistance) ──
	deepFreeze(bridge);

	return bridge;
}

// ---------------------------------------------------------------------------
// Capability Check
// ---------------------------------------------------------------------------

/**
 * Verify that a bridge does not expose any forbidden capabilities.
 * This is a runtime check — the bridge must be constructed to only
 * implement allowed operations.
 *
 * Enhanced checks:
 *   - Exact expected top-level properties
 *   - All required nested properties exist
 *   - All required methods are functions
 *   - No merge/delete/label/workflow/close methods
 *   - Trusted runtime provenance (WeakSet check)
 */
export function verifyBridgeCapabilities(bridge: Stage3RealGitHubBridge): {
	valid: boolean;
	trusted: boolean;
	exposedForbidden: string[];
	missingCapabilities: string[];
	malformedCapabilities: string[];
} {
	const exposedForbidden: string[] = [];
	const missingCapabilities: string[] = [];
	const malformedCapabilities: string[] = [];

	// --- Provenance check (non-forgeable) ---
	const trusted = isTrustedBridge(bridge);

	// --- Check that the bridge has only the expected top-level properties ---
	const bridgeKeys = Object.keys(bridge);
	const allowedKeys = [
		'kind',
		'baseResolver',
		'branchWriter',
		'fileCommitWriter',
		'prWriter',
		'readOnlyVerifier',
	];

	for (const key of bridgeKeys) {
		if (!allowedKeys.includes(key)) {
			exposedForbidden.push(`Unexpected bridge property: ${key}`);
		}
	}

	// --- Check required top-level properties exist ---
	for (const key of allowedKeys) {
		if (!(key in bridge)) {
			missingCapabilities.push(`Missing top-level property: ${key}`);
		}
	}

	// --- Check nested properties are functions ---
	if (typeof bridge.baseResolver?.resolveBase !== 'function') {
		malformedCapabilities.push('baseResolver.resolveBase is not a function');
	}
	if (typeof bridge.branchWriter?.createBranch !== 'function') {
		malformedCapabilities.push('branchWriter.createBranch is not a function');
	}
	if (typeof bridge.fileCommitWriter?.commitFile !== 'function') {
		malformedCapabilities.push('fileCommitWriter.commitFile is not a function');
	}
	if (typeof bridge.prWriter?.createPullRequest !== 'function') {
		malformedCapabilities.push('prWriter.createPullRequest is not a function');
	}

	// --- Check readOnlyVerifier nested readers ---
	const verifier = bridge.readOnlyVerifier;
	if (!verifier) {
		missingCapabilities.push('Missing readOnlyVerifier');
	} else {
		if (typeof verifier.repository?.getDefaultBranch !== 'function') {
			malformedCapabilities.push('readOnlyVerifier.repository.getDefaultBranch is not a function');
		}
		if (typeof verifier.branch?.getBranch !== 'function') {
			malformedCapabilities.push('readOnlyVerifier.branch.getBranch is not a function');
		}
		if (typeof verifier.content?.getFileContent !== 'function') {
			malformedCapabilities.push('readOnlyVerifier.content.getFileContent is not a function');
		}
		if (typeof verifier.commit?.getCommit !== 'function') {
			malformedCapabilities.push('readOnlyVerifier.commit.getCommit is not a function');
		}
		if (typeof verifier.pullRequest?.findOpenPr !== 'function') {
			malformedCapabilities.push('readOnlyVerifier.pullRequest.findOpenPr is not a function');
		}
		if (typeof verifier.compare?.compareCommits !== 'function') {
			malformedCapabilities.push('readOnlyVerifier.compare.compareCommits is not a function');
		}
	}

	// --- Check forbidden methods are NOT present on bridge ---
	const forbiddenMethods = [
		'merge',
		'delete',
		'deleteBranch',
		'addLabels',
		'removeLabels',
		'closeIssue',
		'requestReviewers',
		'workflowDispatch',
		'createRelease',
	];
	for (const method of forbiddenMethods) {
		if (typeof (bridge as any)[method] === 'function') {
			exposedForbidden.push(`Forbidden method exposed: ${method}`);
		}
	}

	return {
		valid:
			exposedForbidden.length === 0 &&
			missingCapabilities.length === 0 &&
			malformedCapabilities.length === 0,
		trusted,
		exposedForbidden,
		missingCapabilities,
		malformedCapabilities,
	};
}
