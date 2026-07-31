// Positron — Stage 3 Read-Only Verifier
//
// Pre-write and post-write read-only verification contracts.
// In live mode, readers verify the actual GitHub API state before and
// after mutations. In fake mode, verification is simulated.
//
// Without successful reader calls, the harness sets:
//   success: false
//   mutationState: complete-unverified

import { sha256Utf8, utf8ByteLength } from './stage3-canonical-manifest.js';

// ---------------------------------------------------------------------------
// Reader Interfaces
// ---------------------------------------------------------------------------

/** Read-only repository reader. */
export interface Stage3RepositoryReader {
	getDefaultBranch(owner: string, repo: string): Promise<{ name: string; sha: string }>;
}

/** Read-only branch reader. */
export interface Stage3BranchReader {
	getBranch(
		owner: string,
		repo: string,
		branch: string,
	): Promise<{
		name: string;
		sha: string;
		exists: boolean;
	}>;
}

/** Read-only content reader. */
export interface Stage3ContentReader {
	getFileContent(
		owner: string,
		repo: string,
		path: string,
		ref?: string,
	): Promise<{
		content: string;
		/** GitHub git blob SHA (SHA-1 or repo-dependent). NOT a SHA-256 hash. */
		gitBlobSha: string;
		size: number;
		exists: boolean;
	}>;
}

/** Read-only commit reader. */
export interface Stage3CommitReader {
	getCommit(
		owner: string,
		repo: string,
		sha: string,
	): Promise<{
		sha: string;
		message: string;
		authorDate: string;
		/** Parent commit SHAs. For the first commit on a branch created from base,
		 *  there should be exactly 1 parent (the approved base SHA). */
		parents: string[];
		/** Files changed in this commit. */
		files: Array<{ filename: string; status: string }>;
		exists: boolean;
	}>;
}

/** Read-only pull request reader. */
export interface Stage3PullRequestReader {
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
		/** Total number of open PRs matching the head/base pair. MUST be exactly 1 for post-write success. */
		totalMatches: number;
	} | null>;
}

/** Read-only branch comparison reader. */
export interface Stage3CompareReader {
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

// ---------------------------------------------------------------------------
// Unified Verifier Interface
// ---------------------------------------------------------------------------

/** Bundled read-only verifier for pre-write and post-write checks. */
export interface Stage3ReadOnlyVerifier {
	repository: Stage3RepositoryReader;
	branch: Stage3BranchReader;
	content: Stage3ContentReader;
	commit: Stage3CommitReader;
	pullRequest: Stage3PullRequestReader;
	compare: Stage3CompareReader;
}

// ---------------------------------------------------------------------------
// Pre-Write Verification
// ---------------------------------------------------------------------------

/** Parameters for pre-write verification. */
export interface PreWriteVerificationInput {
	owner: string;
	repo: string;
	baseBranch: string;
	expectedBaseSha: string;
	targetBranch: string;
	filePath: string;
}

/** Result of pre-write verification. */
export interface PreWriteVerificationResult {
	passed: boolean;
	reason?: string;
	checks: {
		repositoryExists: boolean;
		baseShaMatches: boolean;
		targetBranchMissing: boolean;
		targetFileMissing: boolean;
		noOpenPr: boolean;
	};
}

/**
 * Verify repository state BEFORE any writes.
 * In live mode, reads from the GitHub API to confirm:
 * - Repository exists
 * - Base branch SHA matches the approval binding
 * - Target branch does NOT exist
 * - Target file does NOT exist
 * - No open PR already exists for this branch pair
 */
export async function verifyPreWrite(
	verifier: Stage3ReadOnlyVerifier,
	input: PreWriteVerificationInput,
): Promise<PreWriteVerificationResult> {
	const checks = {
		repositoryExists: false,
		baseShaMatches: false,
		targetBranchMissing: false,
		targetFileMissing: false,
		noOpenPr: false,
	};

	try {
		// Check repository exists
		const defaultBranch = await verifier.repository.getDefaultBranch(input.owner, input.repo);
		checks.repositoryExists = true;

		// Check base SHA matches
		checks.baseShaMatches = defaultBranch.sha === input.expectedBaseSha;

		// Check target branch does NOT exist
		const targetBranch = await verifier.branch.getBranch(
			input.owner,
			input.repo,
			input.targetBranch,
		);
		checks.targetBranchMissing = !targetBranch.exists;

		// Check target file does NOT exist
		const targetFile = await verifier.content.getFileContent(
			input.owner,
			input.repo,
			input.filePath,
			input.baseBranch,
		);
		checks.targetFileMissing = !targetFile.exists;

		// Check no open PR exists for this branch pair
		const existingPr = await verifier.pullRequest.findOpenPr(
			input.owner,
			input.repo,
			input.targetBranch,
			input.baseBranch,
		);
		checks.noOpenPr = existingPr === null || !existingPr.exists;

		const allPassed =
			checks.repositoryExists &&
			checks.baseShaMatches &&
			checks.targetBranchMissing &&
			checks.targetFileMissing &&
			checks.noOpenPr;

		let reason: string | undefined;
		if (!allPassed) {
			const failures: string[] = [];
			if (!checks.repositoryExists) failures.push('repository not found');
			if (!checks.baseShaMatches) failures.push('base SHA mismatch');
			if (!checks.targetBranchMissing) failures.push('target branch already exists');
			if (!checks.targetFileMissing) failures.push('target file already exists');
			if (!checks.noOpenPr) failures.push('open PR already exists');
			reason = `Pre-write verification failed: ${failures.join(', ')}`;
		}

		return { passed: allPassed, reason, checks };
	} catch (error: unknown) {
		const msg = error instanceof Error ? error.message : String(error);
		return {
			passed: false,
			reason: `Pre-write verification error: ${msg}`,
			checks,
		};
	}
}

// ---------------------------------------------------------------------------
// Post-Write Verification
// ---------------------------------------------------------------------------

/** Parameters for post-write verification. */
export interface PostWriteVerificationInput {
	owner: string;
	repo: string;
	baseBranch: string;
	expectedBaseSha: string;
	targetBranch: string;
	filePath: string;
	expectedFileContent: string;
	expectedFileSha256: string;
	expectedFileBytes: number;
	expectedCommitMessage: string;
	expectedCommitBody?: string;
	expectedPrTitle: string;
	expectedPrBody: string;
	expectedPrDraft: boolean;
}

/** Result of post-write verification. */
export interface PostWriteVerificationResult {
	passed: boolean;
	reason?: string;
	checks: {
		targetBranchExists: boolean;
		targetBranchBasedOnApprovedSha: boolean;
		exactlyOneCommit: boolean;
		exactlyOneFile: boolean;
		filePathExact: boolean;
		fileByteSizeExact: boolean;
		fileSha256Exact: boolean;
		commitMessageExact: boolean;
		draftPrExists: boolean;
		prBaseExact: boolean;
		prHeadExact: boolean;
		prBaseShaExact: boolean;
		prHeadShaExact: boolean;
		prTitleExact: boolean;
		prBodyExact: boolean;
		prNotMerged: boolean;
		prStateOpen: boolean;
		exactlyOnePr: boolean;
		noMerge: boolean;
	};
}

/**
 * Verify repository state AFTER writes.
 * In live mode, reads from the GitHub API to confirm:
 * - Target branch exists and is based on the approved base SHA
 * - Exactly one new commit exists on the branch (aheadBy === 1)
 * - Head commit has exactly one parent (the approved base SHA)
 * - Exactly one file was changed, with correct path and status 'added'
 * - File bytes match exactly (local computation from actual content)
 * - File SHA-256 matches (local computation — NOT git blob SHA)
 * - Commit message matches byte-exact
 * - Exactly one draft PR exists with correct metadata
 * - PR is open, not merged, with correct base/head/title/body
 */
export async function verifyPostWrite(
	verifier: Stage3ReadOnlyVerifier,
	input: PostWriteVerificationInput,
): Promise<PostWriteVerificationResult> {
	const checks = {
		targetBranchExists: false,
		targetBranchBasedOnApprovedSha: false,
		exactlyOneCommit: false,
		exactlyOneFile: false,
		filePathExact: false,
		fileByteSizeExact: false,
		fileSha256Exact: false,
		commitMessageExact: false,
		draftPrExists: false,
		prBaseExact: false,
		prHeadExact: false,
		prBaseShaExact: false,
		prHeadShaExact: false,
		prTitleExact: false,
		prBodyExact: false,
		prNotMerged: false,
		prStateOpen: false,
		exactlyOnePr: false,
		noMerge: false,
	};

	try {
		// ── H1: Branch and Commit Checks ──

		// Check target branch exists
		const branch = await verifier.branch.getBranch(input.owner, input.repo, input.targetBranch);
		checks.targetBranchExists = branch.exists;

		if (!branch.exists) {
			return {
				passed: false,
				reason: 'Post-write verification failed: target branch missing',
				checks,
			};
		}

		// Compare base and target branches to verify exactly 1 commit ahead
		const compare = await verifier.compare.compareCommits(
			input.owner,
			input.repo,
			input.expectedBaseSha,
			branch.sha,
		);
		checks.exactlyOneCommit = compare.aheadBy === 1 && compare.totalCommits === 1;
		checks.exactlyOneFile = compare.files.length === 1 && compare.files[0]?.status === 'added';
		checks.filePathExact = checks.exactlyOneFile && compare.files[0]?.filename === input.filePath;

		// Check head commit has exactly one parent (the approved base SHA)
		const headCommit = await verifier.commit.getCommit(input.owner, input.repo, branch.sha);
		checks.targetBranchBasedOnApprovedSha =
			headCommit.exists &&
			headCommit.parents.length === 1 &&
			headCommit.parents[0] === input.expectedBaseSha;

		// ── H2: File Content Checks (local SHA-256, NOT git blob SHA) ──

		const file = await verifier.content.getFileContent(
			input.owner,
			input.repo,
			input.filePath,
			input.targetBranch,
		);
		if (file.exists) {
			const actualBytes = utf8ByteLength(file.content);
			const actualSha256 = sha256Utf8(file.content);
			checks.fileByteSizeExact = actualBytes === input.expectedFileBytes;
			checks.fileSha256Exact = actualSha256 === input.expectedFileSha256;
		}

		// ── H3: Commit Metadata Checks ──

		const expectedFullMessage = input.expectedCommitBody
			? `${input.expectedCommitMessage}\n\n${input.expectedCommitBody}`
			: input.expectedCommitMessage;
		checks.commitMessageExact = headCommit.exists && headCommit.message === expectedFullMessage;

		// ── H4: Pull Request Checks ──

		const pr = await verifier.pullRequest.findOpenPr(
			input.owner,
			input.repo,
			input.targetBranch,
			input.baseBranch,
		);
		if (pr?.exists) {
			checks.draftPrExists = pr.draft === true;
			checks.prStateOpen = pr.state === 'open';
			checks.prNotMerged = pr.merged === false && pr.mergedAt === null;
			// Branch REF checks (name matching)
			checks.prBaseExact = pr.baseRef === input.baseBranch;
			checks.prHeadExact = pr.headRef === input.targetBranch;
			// SHA checks (exact commit verification — NOT just ref names)
			checks.prBaseShaExact = pr.baseSha === input.expectedBaseSha;
			checks.prHeadShaExact = pr.headSha === branch.sha;
			checks.prTitleExact = pr.title === input.expectedPrTitle;
			checks.prBodyExact = pr.body === input.expectedPrBody;
			// Cardinality check: exactly 1 matching PR, not just any PR
			checks.exactlyOnePr = pr.totalMatches === 1;
		}

		// ── H5: No merge capability check ──
		checks.noMerge = checks.prNotMerged && checks.prStateOpen && !pr?.merged;

		// ── Final aggregation ──

		const allPassed =
			checks.targetBranchExists &&
			checks.targetBranchBasedOnApprovedSha &&
			checks.exactlyOneCommit &&
			checks.exactlyOneFile &&
			checks.filePathExact &&
			checks.fileByteSizeExact &&
			checks.fileSha256Exact &&
			checks.commitMessageExact &&
			checks.draftPrExists &&
			checks.prBaseExact &&
			checks.prHeadExact &&
			checks.prBaseShaExact &&
			checks.prHeadShaExact &&
			checks.prTitleExact &&
			checks.prBodyExact &&
			checks.prNotMerged &&
			checks.prStateOpen &&
			checks.exactlyOnePr &&
			checks.noMerge;

		let reason: string | undefined;
		if (!allPassed) {
			const failures: string[] = [];
			if (!checks.targetBranchExists) failures.push('target branch missing');
			if (!checks.targetBranchBasedOnApprovedSha) failures.push('branch not based on approved SHA');
			if (!checks.exactlyOneCommit)
				failures.push(
					`commit count wrong (aheadBy=${compare.aheadBy}, total=${compare.totalCommits})`,
				);
			if (!checks.exactlyOneFile)
				failures.push(`file count or status wrong (files=${compare.files.length})`);
			if (!checks.filePathExact) failures.push('file path wrong');
			if (!checks.fileByteSizeExact) failures.push('file byte size mismatch');
			if (!checks.fileSha256Exact)
				failures.push('file SHA-256 mismatch (canonical SHA-256 vs git blob SHA)');
			if (!checks.commitMessageExact) failures.push('commit message mismatch');
			if (!checks.draftPrExists) failures.push('draft PR missing or not draft');
			if (!checks.prBaseExact) failures.push('PR base branch wrong');
			if (!checks.prHeadExact) failures.push('PR head branch wrong');
			if (!checks.prBaseShaExact) failures.push('PR base SHA mismatch');
			if (!checks.prHeadShaExact) failures.push('PR head SHA mismatch');
			if (!checks.prTitleExact) failures.push('PR title wrong');
			if (!checks.prBodyExact) failures.push('PR body wrong');
			if (!checks.prNotMerged) failures.push('PR merged');
			if (!checks.prStateOpen) failures.push('PR not open');
			if (!checks.exactlyOnePr) failures.push('PR count is not exactly 1 (totalMatches mismatch)');
			if (!checks.noMerge) failures.push('merge detected');
			reason = `Post-write verification failed: ${failures.join(', ')}`;
		}

		return { passed: allPassed, reason, checks };
	} catch (error: unknown) {
		const msg = error instanceof Error ? error.message : String(error);
		return {
			passed: false,
			reason: `Post-write verification error: ${msg}`,
			checks,
		};
	}
}

// ---------------------------------------------------------------------------
// Fake Verifier (for testing)
// ---------------------------------------------------------------------------

/** Create a fake read-only verifier that simulates verification passes. */
export function createFakeReadOnlyVerifier(params?: {
	repoExists?: boolean;
	baseShaMatches?: boolean;
	targetBranchExists?: boolean;
	targetFileExists?: boolean;
	openPrExists?: boolean;
	/** Content string to return for getFileContent when file exists. */
	fileContent?: string;
	/** Override comparison result for post-write testing. */
	compareResult?: {
		aheadBy?: number;
		totalCommits?: number;
		files?: Array<{ filename: string; status: string }>;
	};
	/** Override commit result for post-write testing. */
	commitResult?: {
		parents?: string[];
		message?: string;
	};
	/** Override PR result for post-write testing. */
	prResult?: {
		state?: 'open' | 'closed';
		draft?: boolean;
		merged?: boolean;
		mergedAt?: string | null;
		title?: string;
		body?: string;
		headRef?: string;
		headSha?: string;
		baseRef?: string;
		baseSha?: string;
	};
}): Stage3ReadOnlyVerifier {
	const p = {
		repoExists: true,
		baseShaMatches: true,
		targetBranchExists: false,
		targetFileExists: false,
		openPrExists: false,
		...params,
	};

	return {
		repository: {
			async getDefaultBranch(_owner: string, _repo: string) {
				return {
					name: 'main',
					sha: p.baseShaMatches ? 'expected-base-sha' : 'wrong-sha',
				};
			},
		},
		branch: {
			async getBranch(_owner: string, _repo: string, branch: string) {
				return {
					name: branch,
					sha: 'expected-base-sha',
					exists: p.targetBranchExists,
				};
			},
		},
		content: {
			async getFileContent(_owner: string, _repo: string, _path: string, _ref?: string) {
				const content = params?.fileContent ?? '';
				return {
					content,
					gitBlobSha: 'fake-git-blob-sha',
					size: Buffer.byteLength(content, 'utf8'),
					exists: p.targetFileExists,
				};
			},
		},
		commit: {
			async getCommit(_owner: string, _repo: string, sha: string) {
				return {
					sha,
					message: params?.commitResult?.message ?? 'test',
					authorDate: new Date().toISOString(),
					parents: params?.commitResult?.parents ?? ['expected-base-sha'],
					files: params?.compareResult?.files ?? [
						{ filename: 'stage3/positron-supervised-pilot.md', status: 'added' },
					],
					exists: true,
				};
			},
		},
		pullRequest: {
			async findOpenPr(_owner: string, _repo: string, _head: string, _base: string) {
				if (p.openPrExists) {
					return {
						number: 1,
						state: params?.prResult?.state ?? 'open',
						draft: params?.prResult?.draft ?? true,
						merged: params?.prResult?.merged ?? false,
						mergedAt: params?.prResult?.mergedAt ?? null,
						title: params?.prResult?.title ?? 'Test PR',
						body: params?.prResult?.body ?? 'Test body',
						headRef: params?.prResult?.headRef ?? _head,
						headSha: params?.prResult?.headSha ?? 'head-sha',
						baseRef: params?.prResult?.baseRef ?? _base,
						baseSha: params?.prResult?.baseSha ?? 'base-sha',
						exists: true,
						totalMatches: 1,
					};
				}
				return null;
			},
		},
		compare: {
			async compareCommits(_owner: string, _repo: string, _base: string, _head: string) {
				return {
					status: 'ahead',
					aheadBy: params?.compareResult?.aheadBy ?? 1,
					behindBy: 0,
					totalCommits: params?.compareResult?.totalCommits ?? 1,
					commits: ['fake-commit-sha'],
					files: params?.compareResult?.files ?? [
						{ filename: 'stage3/positron-supervised-pilot.md', status: 'added' },
					],
				};
			},
		},
	};
}
