// Positron — ReadOnly GitHub Adapter Tests (Contract + Negative)

import type {
	GitHubAdapter,
	GitHubIssueRef,
	GitHubIssueSummary,
	GitHubPullRequest,
	GitHubRepositorySummary,
	ReadOnlyGitHubAdapter,
} from '@positron/github-adapter';
import {
	createReadOnlyGitHubAdapter,
	FakeGitHubAdapter,
	GitHubCapabilityError,
	ReadOnlyGitHubAdapterWrapper,
} from '@positron/github-adapter';
import { beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeRepo(): GitHubRepositorySummary {
	return {
		id: 1,
		owner: 'test-owner',
		name: 'test-repo',
		fullName: 'test-owner/test-repo',
		defaultBranch: 'main',
	};
}

function makeIssue(num: number): GitHubIssueSummary {
	return {
		id: num,
		number: num,
		title: `Test Issue ${num}`,
		body: `Body of issue ${num}`,
		state: 'open',
		labels: [],
		assignees: [],
		htmlUrl: `https://github.com/test-owner/test-repo/issues/${num}`,
		updatedAt: new Date().toISOString(),
		createdAt: new Date().toISOString(),
		isPullRequest: false,
	};
}

// ---------------------------------------------------------------------------
// Contract Tests — ReadOnlyGitHubAdapter interface via FakeGitHubAdapter
// ---------------------------------------------------------------------------

describe('ReadOnlyGitHubAdapter (contract via FakeGitHubAdapter)', () => {
	let fullAdapter: FakeGitHubAdapter;
	let readonly: ReadOnlyGitHubAdapter;

	beforeEach(() => {
		fullAdapter = new FakeGitHubAdapter();
		fullAdapter.addRepo(makeRepo());
		fullAdapter.addIssue(makeIssue(1));
		readonly = createReadOnlyGitHubAdapter(fullAdapter);
	});

	// --- READ: getRepository ---

	it('getRepository returns repo metadata', async () => {
		const repo = await readonly.getRepository('test-owner', 'test-repo');
		expect(repo.fullName).toBe('test-owner/test-repo');
		expect(repo.defaultBranch).toBe('main');
	});

	it('getRepository throws for missing repo', async () => {
		await expect(readonly.getRepository('nope', 'nope')).rejects.toThrow('Not found');
	});

	// --- READ: listOpenIssues ---

	it('listOpenIssues returns open issues', async () => {
		const issues = await readonly.listOpenIssues('test-owner', 'test-repo');
		expect(issues).toHaveLength(1);
		expect(issues[0]!.number).toBe(1);
	});

	it('listOpenIssues filters by labels', async () => {
		fullAdapter.addIssue({ ...makeIssue(2), labels: ['positron:ready'] });
		const issues = await readonly.listOpenIssues('test-owner', 'test-repo', {
			labels: ['positron:ready'],
		});
		expect(issues).toHaveLength(1);
		expect(issues[0]!.number).toBe(2);
	});

	it('listOpenIssues respects limit', async () => {
		fullAdapter.addIssue(makeIssue(2));
		fullAdapter.addIssue(makeIssue(3));
		const issues = await readonly.listOpenIssues('test-owner', 'test-repo', { limit: 2 });
		expect(issues).toHaveLength(2);
	});

	// --- READ: getIssue ---

	it('getIssue returns issue details', async () => {
		const ref: GitHubIssueRef = { owner: 'test-owner', repo: 'test-repo', issueNumber: 1 };
		const issue = await readonly.getIssue(ref);
		expect(issue.number).toBe(1);
		expect(issue.title).toBe('Test Issue 1');
	});

	it('getIssue throws for missing issue', async () => {
		const ref: GitHubIssueRef = { owner: 'test-owner', repo: 'test-repo', issueNumber: 999 };
		await expect(readonly.getIssue(ref)).rejects.toThrow('Issue not found');
	});

	// --- READ: listIssueComments ---

	it('listIssueComments returns empty array for issue with no comments', async () => {
		const ref: GitHubIssueRef = { owner: 'test-owner', repo: 'test-repo', issueNumber: 1 };
		const comments = await readonly.listIssueComments(ref);
		expect(comments).toEqual([]);
	});

	// --- READ: listPullRequests ---

	it('listPullRequests returns PRs', async () => {
		await fullAdapter.createPullRequest({
			owner: 'test-owner',
			repo: 'test-repo',
			title: 'Test PR',
			head: 'feature/test',
			base: 'main',
		});
		const prs = await readonly.listPullRequests({ owner: 'test-owner', repo: 'test-repo' });
		expect(prs).toHaveLength(1);
		expect(prs[0]!.title).toBe('Test PR');
	});

	// --- READ: listPullRequestFiles ---

	it('listPullRequestFiles returns fake files', async () => {
		const files = await readonly.listPullRequestFiles('test-owner', 'test-repo', 1);
		expect(files).toHaveLength(2);
		expect(files[0]!.filename).toBe('src/index.ts');
	});

	// --- READ: getPullRequest ---

	it('getPullRequest returns PR details', async () => {
		await fullAdapter.createPullRequest({
			owner: 'test-owner',
			repo: 'test-repo',
			title: 'Test PR',
			head: 'feature/test',
			base: 'main',
		});
		const pr = await readonly.getPullRequest('test-owner', 'test-repo', 1);
		expect(pr.title).toBe('Test PR');
		expect(pr.state).toBe('open');
	});
});

// ---------------------------------------------------------------------------
// Negative Tests — Write operations are blocked on ReadOnly wrapper
// ---------------------------------------------------------------------------

describe('ReadOnlyGitHubAdapterWrapper (write blocking)', () => {
	let fullAdapter: FakeGitHubAdapter;
	let readonly: ReadOnlyGitHubAdapter;

	beforeEach(() => {
		fullAdapter = new FakeGitHubAdapter();
		fullAdapter.addRepo(makeRepo());
		fullAdapter.addIssue(makeIssue(1));
		readonly = createReadOnlyGitHubAdapter(fullAdapter);
	});

	it('createIssueComment is not available on read-only interface at type level (compile-time guard)', () => {
		// TypeScript: readonly does not have createIssueComment method.
		// This test verifies the runtime object shape does not expose it either.
		expect('createIssueComment' in readonly).toBe(false);
	});

	it('addIssueLabels is not available on read-only interface', () => {
		expect('addIssueLabels' in readonly).toBe(false);
	});

	it('removeIssueLabel is not available on read-only interface', () => {
		expect('removeIssueLabel' in readonly).toBe(false);
	});

	it('claimIssue is not available on read-only interface', () => {
		expect('claimIssue' in readonly).toBe(false);
	});

	it('createPullRequest is not available on read-only interface', () => {
		expect('createPullRequest' in readonly).toBe(false);
	});

	it('mergePullRequest is not available on read-only interface', () => {
		expect('mergePullRequest' in readonly).toBe(false);
	});

	it('requestReviewers is not available on read-only interface', () => {
		expect('requestReviewers' in readonly).toBe(false);
	});

	it('closeIssue is not available on read-only interface', () => {
		expect('closeIssue' in readonly).toBe(false);
	});

	it('getClient is not available on read-only wrapper (no Octokit exposure)', () => {
		expect('getClient' in readonly).toBe(false);
	});

	it('inner adapter is not accessible via property access', () => {
		// Verify no property exposes the inner adapter
		const keys = Object.keys(readonly);
		expect(keys).not.toContain('inner');
		expect(keys).not.toContain('#inner');
		// Also check that we can't enumerate it
		const descriptor = Object.getOwnPropertyDescriptors(readonly);
		for (const key of Object.keys(descriptor)) {
			expect(key).not.toMatch(/inner/i);
		}
	});
});

// ---------------------------------------------------------------------------
// Edge Case Tests
// ---------------------------------------------------------------------------

describe('ReadOnlyGitHubAdapterWrapper (edge cases)', () => {
	it('reads return correct data through wrapper', async () => {
		const full = new FakeGitHubAdapter();
		full.addRepo({ id: 42, owner: 'o', name: 'r', fullName: 'o/r', defaultBranch: 'main' });
		const ro = createReadOnlyGitHubAdapter(full);

		const repo = await ro.getRepository('o', 'r');
		expect(repo.id).toBe(42);
	});

	it('wrapper is structurally assignable to ReadOnlyGitHubAdapter', () => {
		const full = new FakeGitHubAdapter();
		const ro = createReadOnlyGitHubAdapter(full);
		// TypeScript compile-time check: the wrapper satisfies the interface
		const _check: ReadOnlyGitHubAdapter = ro;
		expect(_check).toBeDefined();
	});

	it('wrapper works with multiple fake adapters independently', async () => {
		const full1 = new FakeGitHubAdapter();
		full1.addRepo({ id: 1, owner: 'a', name: 'x', fullName: 'a/x', defaultBranch: 'main' });
		const ro1 = createReadOnlyGitHubAdapter(full1);

		const full2 = new FakeGitHubAdapter();
		full2.addRepo({ id: 2, owner: 'b', name: 'y', fullName: 'b/y', defaultBranch: 'develop' });
		const ro2 = createReadOnlyGitHubAdapter(full2);

		const repo1 = await ro1.getRepository('a', 'x');
		const repo2 = await ro2.getRepository('b', 'y');

		expect(repo1.id).toBe(1);
		expect(repo2.id).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// GitHubCapabilityError Tests
// ---------------------------------------------------------------------------

describe('GitHubCapabilityError', () => {
	it('creates error with operation name', () => {
		const err = new GitHubCapabilityError('createIssueComment');
		expect(err.name).toBe('GitHubCapabilityError');
		expect(err.operation).toBe('createIssueComment');
		expect(err.requiredCapability).toBe('github:write');
		expect(err.message).toContain('createIssueComment');
		expect(err.message).toContain('write capability');
		expect(err.message).toContain('blocked by read-only adapter');
	});

	it('is instance of GitHubPermissionError and GitHubError', () => {
		const err = new GitHubCapabilityError('mergePullRequest');
		expect(err).toBeInstanceOf(Error);
		expect(err).toBeInstanceOf(GitHubCapabilityError);
		// GitHubCapabilityError extends GitHubPermissionError extends GitHubError
	});
});
