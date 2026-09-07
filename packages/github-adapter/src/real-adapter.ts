// Positron — Real GitHub Adapter (Octokit-basiert)

import { RequestError } from '@octokit/request-error';
import type { Octokit } from '@octokit/rest';
import { redactSecrets } from '@positron/shared';
import type { GitHubAdapter } from './adapter.js';
import { createGitHubClient } from './client.js';
import { writeComment } from './comments.js';
import {
	GitHubAuthError,
	type GitHubError,
	GitHubIssuesDisabledError,
	GitHubNetworkError,
	GitHubNotFoundError,
	GitHubPermissionError,
	GitHubRateLimitError,
	GitHubSecondaryRateLimitError,
	GitHubUnknownError,
	GitHubValidationError,
} from './errors.js';
import { isPullRequest, pollIssues } from './issues.js';
import { syncManagedLabels } from './labels.js';
import { renderAccepted } from './templates.js';
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

// ---------------------------------------------------------------------------
// Error Mapping
// ---------------------------------------------------------------------------

export function mapRequestError(err: RequestError): GitHubError {
	const status = err.status;
	const headers = err.response?.headers ?? {};

	// Rate Limits
	const remaining = Number(headers['x-ratelimit-remaining'] ?? -1);
	if (status === 403 && remaining === 0) {
		return new GitHubRateLimitError(
			Number(headers['retry-after'] ?? 60),
			Number(headers['x-ratelimit-limit'] ?? 5000),
			remaining,
			Number(headers['x-ratelimit-reset'] ?? 0),
		);
	}

	// Secondary Rate Limit
	const retryAfter = headers['retry-after'];
	if (status === 403 && retryAfter && String(err.message).includes('secondary')) {
		return new GitHubSecondaryRateLimitError(Number(retryAfter));
	}

	switch (status) {
		case 401:
			return new GitHubAuthError();
		case 403:
			return new GitHubPermissionError();
		case 404:
			return new GitHubNotFoundError();
		case 410:
			return new GitHubIssuesDisabledError();
		case 422:
			return new GitHubValidationError(redactSecrets(err.message));
		default:
			return new GitHubUnknownError(status, redactSecrets(err.message));
	}
}

// ---------------------------------------------------------------------------
// Real GitHub Adapter
// ---------------------------------------------------------------------------

export class RealGitHubAdapter implements GitHubAdapter {
	private octokit: Octokit;

	constructor(octokit?: Octokit) {
		this.octokit = octokit ?? createGitHubClient();
	}

	async createRepository(options: CreateRepositoryOptions): Promise<GitHubRepositorySummary> {
		try {
			const { data } = await this.octokit.rest.repos.createForAuthenticatedUser({
				name: options.name,
				description: options.description,
				private: options.private ?? true,
				auto_init: true,
			});
			if (data.owner.login !== options.owner) {
				throw new GitHubPermissionError(
					`Authenticated owner is ${data.owner.login}, not ${options.owner}`,
				);
			}
			return {
				id: data.id,
				owner: data.owner.login,
				name: data.name,
				fullName: data.full_name,
				defaultBranch: data.default_branch ?? 'main',
			};
		} catch (err) {
			if (err instanceof RequestError) throw mapRequestError(err);
			if (err instanceof GitHubPermissionError) throw err;
			throw new GitHubNetworkError(String(err));
		}
	}

	async getRepository(owner: string, repo: string): Promise<GitHubRepositorySummary> {
		try {
			const { data } = await this.octokit.rest.repos.get({ owner, repo });
			return {
				id: data.id,
				owner: data.owner.login,
				name: data.name,
				fullName: data.full_name,
				defaultBranch: data.default_branch,
			};
		} catch (err) {
			if (err instanceof RequestError) throw mapRequestError(err);
			throw new GitHubNetworkError(String(err));
		}
	}

	async listOpenIssues(
		owner: string,
		repo: string,
		options?: { labels?: string[]; since?: string; limit?: number },
	): Promise<GitHubIssueSummary[]> {
		try {
			const state = { since: options?.since };
			const issues = await pollIssues(this.octokit, owner, repo, state);
			let result = issues.map(
				(i: {
					number: number;
					title: string;
					state: string;
					labels: string[];
					url: string;
					updatedAt: string;
				}) => ({
					id: i.number,
					number: i.number,
					title: i.title,
					body: null,
					state: i.state as 'open' | 'closed',
					labels: i.labels,
					assignees: [],
					htmlUrl: i.url,
					updatedAt: i.updatedAt,
					createdAt: '',
					isPullRequest: false,
				}),
			);

			if (options?.labels?.length) {
				result = result.filter((i: { labels: string[] }) =>
					options.labels!.some((l) => i.labels.includes(l)),
				);
			}

			return options?.limit ? result.slice(0, options.limit) : result;
		} catch (err) {
			if (err instanceof RequestError) throw mapRequestError(err);
			throw new GitHubNetworkError(String(err));
		}
	}

	async getIssue(ref: GitHubIssueRef): Promise<GitHubIssueSummary> {
		try {
			const { data } = await this.octokit.rest.issues.get({
				owner: ref.owner,
				repo: ref.repo,
				issue_number: ref.issueNumber,
			});
			return {
				id: data.id,
				number: data.number,
				title: data.title,
				body: data.body ?? null,
				state: data.state as 'open' | 'closed',
				labels: (data.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))),
				assignees: (data.assignees ?? []).map((a) => a?.login ?? ''),
				htmlUrl: data.html_url,
				updatedAt: data.updated_at,
				createdAt: data.created_at,
				isPullRequest:
					'pull_request' in data && data.pull_request !== undefined && data.pull_request !== null,
			};
		} catch (err) {
			if (err instanceof RequestError) throw mapRequestError(err);
			throw new GitHubNetworkError(String(err));
		}
	}

	async listIssueComments(ref: GitHubIssueRef): Promise<GitHubIssueComment[]> {
		try {
			const { data } = await this.octokit.rest.issues.listComments({
				owner: ref.owner,
				repo: ref.repo,
				issue_number: ref.issueNumber,
				per_page: 100,
			});
			return data.map((c) => ({
				id: c.id,
				body: c.body ?? '',
				htmlUrl: c.html_url,
				createdAt: c.created_at,
			}));
		} catch (err) {
			if (err instanceof RequestError) throw mapRequestError(err);
			throw new GitHubNetworkError(String(err));
		}
	}

	async createIssueComment(ref: GitHubIssueRef, body: string): Promise<GitHubCommentResult> {
		if (!body || body.trim().length === 0) throw new GitHubValidationError('Comment body is empty');
		try {
			const result = await writeComment(this.octokit, ref.owner, ref.repo, ref.issueNumber, body);
			return { id: result.id, htmlUrl: result.url, createdAt: new Date().toISOString() };
		} catch (err) {
			if (err instanceof RequestError) throw mapRequestError(err);
			throw new GitHubNetworkError(String(err));
		}
	}

	async addIssueLabels(ref: GitHubIssueRef, labels: string[]): Promise<void> {
		try {
			await syncManagedLabels(this.octokit, ref.owner, ref.repo, ref.issueNumber, labels);
		} catch (err) {
			if (err instanceof RequestError) throw mapRequestError(err);
			throw new GitHubNetworkError(String(err));
		}
	}

	async removeIssueLabel(ref: GitHubIssueRef, label: string): Promise<void> {
		try {
			await this.octokit.rest.issues.removeLabel({
				owner: ref.owner,
				repo: ref.repo,
				issue_number: ref.issueNumber,
				name: label,
			});
		} catch (err) {
			if (err instanceof RequestError) {
				if (err.status === 404) return; // Label already gone
				throw mapRequestError(err);
			}
			throw new GitHubNetworkError(String(err));
		}
	}

	async claimIssue(ref: GitHubIssueRef, options: ClaimOptions): Promise<GitHubIssueClaimResult> {
		// 1. Issue frisch lesen
		const issue = await this.getIssue(ref);

		// 2. Prüfen ob ready-Label vorhanden (falls konfiguriert)
		if (options.readyLabel && !issue.labels.includes(options.readyLabel)) {
			return { status: 'not_ready', issue };
		}

		// 3. Prüfen ob bereits running
		if (issue.labels.includes(options.runningLabel)) {
			// Check existing comments for Run ID
			const comments = await this.listIssueComments(ref);
			const existing = comments.find((c) => c.body.includes(`**Run ID:** \`${options.runId}\``));
			return {
				status: 'already_claimed',
				issue,
				existingRunId: existing ? options.runId : undefined,
			};
		}

		// 4. Labels setzen
		const desired = [options.runningLabel];
		await syncManagedLabels(this.octokit, ref.owner, ref.repo, ref.issueNumber, desired);

		// 5. Claim-Kommentar schreiben
		const comment = await writeComment(
			this.octokit,
			ref.owner,
			ref.repo,
			ref.issueNumber,
			options.commentBody,
		);

		return { status: 'claimed', issue, commentId: comment.id };
	}

	getClient(): Octokit {
		return this.octokit;
	}

	// --- Pull Request Methods (Issue #17) ---

	async createPullRequest(options: CreatePROptions): Promise<GitHubPullRequest> {
		try {
			// Idempotenz: Prüfe ob bereits ein offener PR für diesen Head-Branch existiert
			const existing = await this.octokit.rest.pulls.list({
				owner: options.owner,
				repo: options.repo,
				state: 'open',
				head: `${options.owner}:${options.head}`,
			});

			if (existing.data.length > 0) {
				const pr = existing.data[0]!;
				return {
					id: pr.id,
					number: pr.number,
					title: pr.title,
					body: pr.body ?? null,
					state: pr.state as 'open' | 'closed',
					head: { ref: pr.head.ref, sha: pr.head.sha },
					base: { ref: pr.base.ref, sha: pr.base.sha },
					htmlUrl: pr.html_url,
					createdAt: pr.created_at,
					updatedAt: pr.updated_at,
					draft: pr.draft ?? false,
					mergeable: null,
				};
			}
		} catch (err) {
			if (err instanceof RequestError) throw mapRequestError(err);
			throw err;
		}

		// Kein existierender PR → erstellen
		try {
			const created = await this.octokit.rest.pulls.create({
				owner: options.owner,
				repo: options.repo,
				title: options.title,
				head: options.head,
				base: options.base,
				body: options.body,
				draft: options.draft,
			});

			return {
				id: created.data.id,
				number: created.data.number,
				title: created.data.title,
				body: created.data.body ?? null,
				state: created.data.state as 'open' | 'closed',
				head: { ref: created.data.head.ref, sha: created.data.head.sha },
				base: { ref: created.data.base.ref, sha: created.data.base.sha },
				htmlUrl: created.data.html_url,
				createdAt: created.data.created_at,
				updatedAt: created.data.updated_at,
				draft: created.data.draft ?? false,
				mergeable: null,
			};
		} catch (err) {
			if (err instanceof RequestError) throw mapRequestError(err);
			throw err;
		}
	}

	async listPullRequests(options: PRListOptions): Promise<GitHubPullRequest[]> {
		try {
			const result = await this.octokit.rest.pulls.list({
				owner: options.owner,
				repo: options.repo,
				state: options.state ?? 'open',
				head: options.head,
			});

			return result.data.map((pr) => ({
				id: pr.id,
				number: pr.number,
				title: pr.title,
				body: pr.body ?? null,
				state: pr.state as 'open' | 'closed',
				head: { ref: pr.head.ref, sha: pr.head.sha },
				base: { ref: pr.base.ref, sha: pr.base.sha },
				htmlUrl: pr.html_url,
				createdAt: pr.created_at,
				updatedAt: pr.updated_at,
				draft: pr.draft ?? false,
				mergeable: null,
			}));
		} catch (err) {
			if (err instanceof RequestError) throw mapRequestError(err);
			throw err;
		}
	}

	async listPullRequestFiles(
		owner: string,
		repo: string,
		prNumber: number,
	): Promise<GitHubPRFile[]> {
		try {
			const result = await this.octokit.rest.pulls.listFiles({
				owner,
				repo,
				pull_number: prNumber,
			});

			return result.data.map((f) => ({
				sha: f.sha,
				filename: f.filename,
				status: f.status as GitHubPRFile['status'],
				additions: f.additions,
				deletions: f.deletions,
				changes: f.changes,
				patch: f.patch,
				previousFilename: f.previous_filename,
			}));
		} catch (err) {
			if (err instanceof RequestError) throw mapRequestError(err);
			throw err;
		}
	}

	// --- Merge Methods (Issue #20) ---

	async getPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubPullRequest> {
		try {
			const { data: pr } = await this.octokit.rest.pulls.get({
				owner,
				repo,
				pull_number: prNumber,
			});
			return {
				id: pr.id,
				number: pr.number,
				title: pr.title,
				body: pr.body ?? null,
				state: pr.state as 'open' | 'closed' | 'merged',
				head: { ref: pr.head.ref, sha: pr.head.sha },
				base: { ref: pr.base.ref, sha: pr.base.sha },
				htmlUrl: pr.html_url,
				createdAt: pr.created_at,
				updatedAt: pr.updated_at,
				draft: pr.draft ?? false,
				mergeable: pr.mergeable ?? null,
			};
		} catch (err) {
			if (err instanceof RequestError) throw mapRequestError(err);
			throw err;
		}
	}

	async mergePullRequest(options: MergePROptions): Promise<MergePRResult> {
		try {
			const { data } = await this.octokit.rest.pulls.merge({
				owner: options.owner,
				repo: options.repo,
				pull_number: options.prNumber,
				merge_method: options.strategy ?? 'squash',
				commit_title: options.commitTitle,
				commit_message: options.commitMessage,
			});
			return { merged: data.merged, sha: data.sha, message: data.message };
		} catch (err: unknown) {
			if (err instanceof RequestError) {
				// 405 = not mergeable (conflicts, checks not passed)
				if (err.status === 405) {
					return { merged: false, message: err.message };
				}
				throw mapRequestError(err);
			}
			return { merged: false, message: err instanceof Error ? err.message : String(err) };
		}
	}

	async requestReviewers(options: RequestReviewersOptions): Promise<RequestReviewersResult> {
		const reviewers = options.reviewers?.length ? options.reviewers : undefined;
		const teamReviewers = options.teamReviewers?.length ? options.teamReviewers : undefined;
		if (!reviewers && !teamReviewers) {
			return { requested: false };
		}
		try {
			await this.octokit.rest.pulls.requestReviewers({
				owner: options.owner,
				repo: options.repo,
				pull_number: options.prNumber,
				reviewers,
				team_reviewers: teamReviewers,
			});
			return { requested: true, reviewers, teamReviewers };
		} catch (err) {
			if (err instanceof RequestError) throw mapRequestError(err);
			throw err;
		}
	}

	async closeIssue(owner: string, repo: string, issueNumber: number): Promise<void> {
		try {
			await this.octokit.rest.issues.update({
				owner,
				repo,
				issue_number: issueNumber,
				state: 'closed',
			});
		} catch (err) {
			if (err instanceof RequestError) throw mapRequestError(err);
			throw new GitHubNetworkError(String(err));
		}
	}
}

/** Factory: Erstellt RealGitHubAdapter oder wirft Error wenn Token fehlt */
export function createRealGitHubAdapter(): RealGitHubAdapter {
	return new RealGitHubAdapter(createGitHubClient());
}
