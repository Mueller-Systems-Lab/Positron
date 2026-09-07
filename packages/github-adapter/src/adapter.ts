// Positron — GitHub Adapter: Interfaces (ReadOnly + Full)

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

/** Read-only GitHub operations. Safe to expose to untrusted or read-only consumers. */
export interface ReadOnlyGitHubAdapter {
	getRepository(owner: string, repo: string): Promise<GitHubRepositorySummary>;

	listOpenIssues(
		owner: string,
		repo: string,
		options?: {
			labels?: string[];
			since?: string;
			limit?: number;
		},
	): Promise<GitHubIssueSummary[]>;

	getIssue(ref: GitHubIssueRef): Promise<GitHubIssueSummary>;

	listIssueComments(ref: GitHubIssueRef): Promise<GitHubIssueComment[]>;

	// --- Pull Request Read Methods ---
	listPullRequests(options: PRListOptions): Promise<GitHubPullRequest[]>;

	listPullRequestFiles(owner: string, repo: string, prNumber: number): Promise<GitHubPRFile[]>;

	getPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubPullRequest>;
}

/** Full GitHub adapter with write capability. Extends the read-only interface. */
export interface GitHubAdapter extends ReadOnlyGitHubAdapter {
	createRepository(options: CreateRepositoryOptions): Promise<GitHubRepositorySummary>;
	createIssueComment(ref: GitHubIssueRef, body: string): Promise<GitHubCommentResult>;

	addIssueLabels(ref: GitHubIssueRef, labels: string[]): Promise<void>;

	removeIssueLabel(ref: GitHubIssueRef, label: string): Promise<void>;

	claimIssue(ref: GitHubIssueRef, options: ClaimOptions): Promise<GitHubIssueClaimResult>;

	// --- Pull Request Write Methods ---

	/** Erstellt einen Pull Request. Idempotent: prüft zuerst ob bereits ein offener PR existiert. */
	createPullRequest(options: CreatePROptions): Promise<GitHubPullRequest>;

	/** Merged einen Pull Request. Prüft mergeable state vorher. */
	mergePullRequest(options: MergePROptions): Promise<MergePRResult>;

	// --- Reviewer Methods (Issue #32) ---

	/** Fordert Review von Benutzern/Teams für einen PR an */
	requestReviewers(options: RequestReviewersOptions): Promise<RequestReviewersResult>;

	// --- Issue Lifecycle (Task 2) ---

	/** Schließt ein GitHub-Issue nach erfolgreichem Merge. Idempotent. */
	closeIssue(owner: string, repo: string, issueNumber: number): Promise<void>;
}
