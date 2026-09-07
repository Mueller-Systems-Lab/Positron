// Positron — Fake GitHub Adapter (für Tests)

import type { GitHubAdapter } from './adapter.js';
import type {
	ClaimOptions,
	CreatePROptions,
	CreateRepositoryOptions,
	GitHubCommentResult,
	GitHubIssueClaimResult,
	GitHubIssueComment,
	GitHubIssueRef,
	GitHubIssueSummary,
	GitHubPRFile,
	GitHubPullRequest,
	GitHubRepositorySummary,
	MergePROptions,
	MergePRResult,
	PRListOptions,
	RequestReviewersOptions,
	RequestReviewersResult,
} from './types.js';

export class FakeGitHubAdapter implements GitHubAdapter {
	private repos = new Map<string, GitHubRepositorySummary>();
	private issues = new Map<string, GitHubIssueSummary>();
	private comments = new Map<string, GitHubIssueComment[]>();
	private labels = new Map<string, string[]>();
	private pullRequests = new Map<string, GitHubPullRequest[]>();
	private nextCommentId = 1;
	private nextPRId = 1;

	addRepo(repo: GitHubRepositorySummary): void {
		this.repos.set(`${repo.owner}/${repo.name}`, repo);
	}

	async createRepository(options: CreateRepositoryOptions): Promise<GitHubRepositorySummary> {
		const repo: GitHubRepositorySummary = {
			id: this.repos.size + 1,
			owner: options.owner,
			name: options.name,
			fullName: `${options.owner}/${options.name}`,
			defaultBranch: 'main',
		};
		this.addRepo(repo);
		return repo;
	}

	addIssue(issue: GitHubIssueSummary): void {
		this.issues.set(`${issue.number}`, issue);
		this.labels.set(`${issue.number}`, [...issue.labels]);
	}

	async getRepository(owner: string, repo: string): Promise<GitHubRepositorySummary> {
		const r = this.repos.get(`${owner}/${repo}`);
		if (!r) throw new Error('Not found');
		return r;
	}

	async listOpenIssues(
		_owner: string,
		_repo: string,
		options?: { labels?: string[]; since?: string; limit?: number },
	): Promise<GitHubIssueSummary[]> {
		let result = Array.from(this.issues.values()).filter((i) => i.state === 'open');
		if (options?.labels?.length) {
			result = result.filter((i) => options.labels!.some((l) => i.labels.includes(l)));
		}
		return options?.limit ? result.slice(0, options.limit) : result;
	}

	async getIssue(ref: GitHubIssueRef): Promise<GitHubIssueSummary> {
		const issue = this.issues.get(`${ref.issueNumber}`);
		if (!issue) throw new Error('Issue not found');
		return issue;
	}

	async listIssueComments(ref: GitHubIssueRef): Promise<GitHubIssueComment[]> {
		return this.comments.get(`${ref.issueNumber}`) ?? [];
	}

	async createIssueComment(ref: GitHubIssueRef, body: string): Promise<GitHubCommentResult> {
		const id = this.nextCommentId++;
		const comment: GitHubIssueComment = {
			id,
			body,
			htmlUrl: `https://github.com/${ref.owner}/${ref.repo}/issues/${ref.issueNumber}#issuecomment-${id}`,
			createdAt: new Date().toISOString(),
		};
		const list = this.comments.get(`${ref.issueNumber}`) ?? [];
		list.push(comment);
		this.comments.set(`${ref.issueNumber}`, list);
		return { id, htmlUrl: comment.htmlUrl, createdAt: comment.createdAt };
	}

	async addIssueLabels(ref: GitHubIssueRef, labels: string[]): Promise<void> {
		const current = this.labels.get(`${ref.issueNumber}`) ?? [];
		for (const l of labels) {
			if (!current.includes(l)) current.push(l);
		}
		this.labels.set(`${ref.issueNumber}`, current);
		const issue = this.issues.get(`${ref.issueNumber}`);
		if (issue) issue.labels = current;
	}

	async removeIssueLabel(ref: GitHubIssueRef, label: string): Promise<void> {
		const current = this.labels.get(`${ref.issueNumber}`) ?? [];
		const idx = current.indexOf(label);
		if (idx >= 0) current.splice(idx, 1);
		this.labels.set(`${ref.issueNumber}`, current);
		const issue = this.issues.get(`${ref.issueNumber}`);
		if (issue) issue.labels = current;
	}

	async claimIssue(ref: GitHubIssueRef, options: ClaimOptions): Promise<GitHubIssueClaimResult> {
		const issue = this.issues.get(`${ref.issueNumber}`);
		if (!issue) throw new Error('Issue not found');

		// Prüfe ready
		if (options.readyLabel && !issue.labels.includes(options.readyLabel)) {
			return { status: 'not_ready', issue };
		}

		// Prüfe bereits running
		if (issue.labels.includes(options.runningLabel)) {
			const comments = this.comments.get(`${ref.issueNumber}`) ?? [];
			const existing = comments.find((c) => c.body.includes(`**Run ID:** \`${options.runId}\``));
			return {
				status: 'already_claimed',
				issue,
				existingRunId: existing ? options.runId : undefined,
			};
		}

		// Label setzen
		await this.addIssueLabels(ref, [options.runningLabel]);

		// Kommentar
		const { id } = await this.createIssueComment(ref, options.commentBody);

		return { status: 'claimed', issue, commentId: id };
	}

	// --- Pull Request Methods (Issue #17) ---

	async createPullRequest(options: CreatePROptions): Promise<GitHubPullRequest> {
		// Idempotenz: existierenden PR zurückgeben
		const key = `${options.owner}/${options.repo}`;
		const existing = (this.pullRequests.get(key) ?? []).filter(
			(pr) => pr.head.ref === options.head && pr.state === 'open',
		);

		if (existing.length > 0) return existing[0]!;

		const pr: GitHubPullRequest = {
			id: this.nextPRId,
			number: this.nextPRId,
			title: options.title,
			body: options.body ?? null,
			state: 'open',
			draft: options.draft ?? false,
			mergeable: null,
			head: { ref: options.head, sha: 'fake-sha-head' },
			base: { ref: options.base, sha: 'fake-sha-base' },
			htmlUrl: `https://github.com/${options.owner}/${options.repo}/pull/${this.nextPRId}`,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		this.nextPRId++;

		const prs = this.pullRequests.get(key) ?? [];
		prs.push(pr);
		this.pullRequests.set(key, prs);

		return pr;
	}

	async listPullRequests(options: PRListOptions): Promise<GitHubPullRequest[]> {
		const key = `${options.owner}/${options.repo}`;
		let prs = this.pullRequests.get(key) ?? [];

		if (options.state && options.state !== 'all') {
			prs = prs.filter((pr) => pr.state === options.state);
		}
		if (options.head) {
			prs = prs.filter((pr) => pr.head.ref === options.head);
		}
		return prs;
	}

	async listPullRequestFiles(
		_owner: string,
		_repo: string,
		_prNumber: number,
	): Promise<GitHubPRFile[]> {
		return [
			{
				sha: 'fake-sha',
				filename: 'src/index.ts',
				status: 'modified',
				additions: 10,
				deletions: 3,
				changes: 13,
			},
			{
				sha: 'fake-sha2',
				filename: 'test/index.test.ts',
				status: 'added',
				additions: 42,
				deletions: 0,
				changes: 42,
			},
		];
	}

	// --- Merge Methods (Issue #20) ---

	async getPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubPullRequest> {
		const key = `${owner}/${repo}`;
		const prs = this.pullRequests.get(key) ?? [];
		const pr = prs.find((p) => p.number === prNumber);
		if (!pr) throw new Error(`PR #${prNumber} not found`);
		return pr;
	}

	async mergePullRequest(options: MergePROptions): Promise<MergePRResult> {
		const key = `${options.owner}/${options.repo}`;
		const prs = this.pullRequests.get(key) ?? [];
		const pr = prs.find((p) => p.number === options.prNumber);
		if (!pr) return { merged: false, message: 'PR not found' };
		if (pr.state !== 'open') return { merged: false, message: `PR is ${pr.state}` };
		pr.state = 'merged' as any;
		return { merged: true, sha: 'fake-merge-sha' };
	}

	async requestReviewers(options: RequestReviewersOptions): Promise<RequestReviewersResult> {
		const reviewers = options.reviewers?.length ? options.reviewers : undefined;
		const teamReviewers = options.teamReviewers?.length ? options.teamReviewers : undefined;
		if (!reviewers && !teamReviewers) {
			return { requested: false };
		}
		return { requested: true, reviewers, teamReviewers };
	}

	async closeIssue(owner: string, repo: string, issueNumber: number): Promise<void> {
		const key = `${issueNumber}`;
		const issue = this.issues.get(key);
		if (!issue) throw new Error(`Issue #${issueNumber} not found`);
		Object.assign(issue, { state: 'closed' as const });
		this.issues.set(key, issue);
	}
}
