// Positron — Datenbank-Interfaces und Basis-Typen
// ACHTUNG: Duplikate mit speckit-types.ts und opencode-types.ts vermeiden!
// Adapter-Interfaces und deren Input/Result-Typen sind in den dedizierten Type-Dateien.

import type { AutonomyLevel, EventLevel, GateType, Phase, RunStatus } from './types.js';

/** Ergebnis eines einzelnen Test-Kommandos */
export interface TestCommandExecutionResult {
	command: string;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	durationMs: number;
}

/** Kanonischer Test-Report (Issue #31 — konsolidiert aus @positron/sandbox) */
export interface TestReport {
	status: 'passed' | 'failed' | 'blocked' | 'skipped';
	summary: string;
	passed: number;
	failed: number;
	total: number;
	durationMs: number;
	artifactPath?: string;
	details?: TestCommandExecutionResult[];
}

export interface Repository {
	id: string;
	owner: string;
	name: string;
	url: string;
	localPath: string;
	defaultBranch: string | null;
	enabled: boolean;
	createdAt: string;
}

export interface IssueRecord {
	id: string;
	repoId: string;
	number: number;
	title: string;
	state: string;
	labels: string[];
	lastSeenAt: string;
}

export interface RunRecord {
	id: string;
	repoId: string;
	issueNumber: number;
	branch: string | null;
	phase: Phase;
	status: RunStatus;
	autonomyLevel: AutonomyLevel;
	attempt: number;
	startedAt: string | null;
	finishedAt: string | null;
}

export interface RunEventRecord {
	id: string;
	runId: string;
	phase: Phase;
	level: EventLevel;
	message: string;
	payload: Record<string, unknown> | null;
	createdAt: string;
}

export interface ArtifactRecord {
	id: string;
	runId: string;
	kind: string;
	path: string;
	sha256: string | null;
	createdAt: string;
}

export interface CommandResultRecord {
	id: string;
	runId: string;
	command: string;
	exitCode: number | null;
	stdoutPath: string | null;
	stderrPath: string | null;
	durationMs: number | null;
	createdAt: string;
}

// GitHub Adapter Interfaces

export interface GitHubIssueRef {
	owner: string;
	repo: string;
	issueNumber: number;
}

export interface GitHubIssueSummary {
	id: number;
	number: number;
	title: string;
	body: string | null;
	state: 'open' | 'closed';
	labels: string[];
	assignees: string[];
	htmlUrl: string;
	updatedAt: string;
	createdAt: string;
	isPullRequest: boolean;
}

export interface GitHubIssueComment {
	id: number;
	body: string;
	htmlUrl: string;
	createdAt: string;
}

export interface GitHubCommentResult {
	id: number;
	htmlUrl: string;
	createdAt: string;
}

export interface GitHubRepositorySummary {
	id: number;
	owner: string;
	name: string;
	fullName: string;
	defaultBranch: string;
}

export interface CreateRepositoryOptions {
	owner: string;
	name: string;
	description?: string;
	private?: boolean;
}

export interface ClaimOptions {
	runId: string;
	claimLabel: string;
	runningLabel: string;
	readyLabel?: string;
	commentBody: string;
}

export type GitHubIssueClaimResult =
	| { status: 'claimed'; issue: GitHubIssueSummary; commentId: number }
	| { status: 'already_claimed'; issue: GitHubIssueSummary; existingRunId?: string }
	| { status: 'not_ready'; issue: GitHubIssueSummary };

export interface GitHubPullRequest {
	id: number;
	number: number;
	title: string;
	body: string | null;
	state: 'open' | 'closed' | 'merged';
	head: { ref: string; sha: string };
	base: { ref: string; sha: string };
	htmlUrl: string;
	createdAt: string;
	updatedAt: string;
	draft: boolean;
	mergeable: boolean | null;
}

export interface GitHubPRFile {
	sha: string | null;
	filename: string;
	status: 'added' | 'modified' | 'removed' | 'renamed' | 'changed';
	additions: number;
	deletions: number;
	changes: number;
	patch?: string;
	previousFilename?: string;
}

export interface CreatePROptions {
	owner: string;
	repo: string;
	title: string;
	head: string;
	base: string;
	body?: string;
	draft?: boolean;
	reviewers?: string[];
	teamReviewers?: string[];
}

export interface PRListOptions {
	owner: string;
	repo: string;
	head?: string;
	state?: 'open' | 'closed' | 'all';
}

export interface MergePROptions {
	owner: string;
	repo: string;
	prNumber: number;
	strategy?: 'merge' | 'squash' | 'rebase';
	commitTitle?: string;
	commitMessage?: string;
}

export interface MergePRResult {
	merged: boolean;
	sha?: string;
	message?: string;
}

export interface RequestReviewersOptions {
	owner: string;
	repo: string;
	prNumber: number;
	reviewers?: string[];
	teamReviewers?: string[];
}

export interface RequestReviewersResult {
	requested: boolean;
	reviewers?: string[];
	teamReviewers?: string[];
}

export type ProjectEntryType = 'existing_repository' | 'blueprint';
export type ProjectEntryStatus = 'validated' | 'registered' | 'initialization_pending' | 'blocked';

export interface ProjectEntry {
	id: string;
	entryType: ProjectEntryType;
	name: string;
	owner: string | null;
	repository: string | null;
	repositoryUrl: string | null;
	defaultBranch: string | null;
	blueprint: string | null;
	provider: string | null;
	model: string | null;
	credentialRef: string | null;
	specKitStatus: 'not_started' | 'initialized' | 'blocked';
	status: ProjectEntryStatus;
	createdAt: string;
	updatedAt: string;
}

// Git Workspace Adapter Interfaces
// Hinweis: GitHubAdapter-Interface ist in @positron/github-adapter (src/adapter.ts) definiert
// und wird von dort importiert. Diese Datei enthält nur die Daten-Typen (GitHubIssueRef etc.).

export interface PrepareWorkspaceInput {
	repository: GitWorkspaceRef;
	issueNumber: number;
	issueTitle: string;
	runId: string;
	baseBranch?: string;
}

export interface PreparedWorkspace {
	runId: string;
	owner: string;
	repo: string;
	workspacePath: string;
	branchName: string;
	baseBranch: string;
	defaultBranch: string;
	headSha?: string;
	isNewClone: boolean;
	isNewBranch: boolean;
}

export interface GitWorkspaceRef {
	owner: string;
	repo: string;
	remoteUrl: string;
}

export interface GitStatusSummary {
	branch: string;
	isClean: boolean;
	ahead: number;
	behind: number;
	staged: string[];
	unstaged: string[];
	untracked: string[];
	conflicted: string[];
}

export interface GitDiffSummary {
	raw: string;
	filesChanged: number;
	insertions?: number;
	deletions?: number;
}

export interface PushOptions {
	workspacePath: string;
	branch: string;
	remote?: string;
	force?: boolean;
}

export interface GitWorkspaceAdapter {
	prepareWorkspace(input: PrepareWorkspaceInput): Promise<PreparedWorkspace>;
	getStatus(workspacePath: string): Promise<GitStatusSummary>;
	getDiff(
		workspacePath: string,
		options?: { staged?: boolean; baseRef?: string },
	): Promise<GitDiffSummary>;
	getCurrentBranch(workspacePath: string): Promise<string>;
	getHeadSha(workspacePath: string): Promise<string>;
	validateWorkspacePath(workspacePath: string): Promise<void>;
	commit(workspacePath: string, message: string): Promise<{ sha: string }>;
	push(options: PushOptions): Promise<{ pushed: boolean; ref: string }>;
	/** Issue #244: Destroy workspace directory after run completes or fails. */
	destroyWorkspace(workspacePath: string): Promise<{ destroyed: boolean; reason?: string }>;
	/** Issue #244: Acquire advisory lock on workspace to prevent parallel access. */
	lockWorkspace(
		workspacePath: string,
		ownerRunId: string,
	): Promise<{ locked: boolean; reason?: string }>;
	/** Issue #244: Release advisory lock on workspace. */
	unlockWorkspace(
		workspacePath: string,
		ownerRunId: string,
	): Promise<{ unlocked: boolean; reason?: string }>;
	/** Issue #244: Check if workspace is currently locked. */
	isLocked(workspacePath: string): Promise<{ locked: boolean; ownerRunId?: string }>;
}

// Sync / Evidence Interfaces

export interface EvidenceItem {
	kind: string;
	status: 'pass' | 'fail' | 'blocked' | 'skipped' | 'partial';
	summary: string;
	artifactPath?: string;
	timestamp?: string;
}

export interface SafeLlmRunMetadata {
	provider?: string;
	model?: string;
	promptHash?: string;
	userPromptHash?: string;
	promptTokens?: number;
	completionTokens?: number;
	temperature?: number;
	agentRole?: string;
	timestamp?: string;
}

export interface GitHubStatusSyncInput {
	runId: string;
	owner: string;
	repo: string;
	issueNumber: number;
	phase: string;
	status: string;
	message?: string;
	branchName?: string;
	workspacePath?: string;
	testReport?: TestReport;
	error?: { type: string; message: string; phase?: string };
	liveMarker?: string;
	evidence?: EvidenceItem[];
	llmMetadata?: SafeLlmRunMetadata[];
	prNumber?: number;
	prUrl?: string;
}

export interface GitHubStatusSyncResult {
	status: 'synced' | 'skipped' | 'failed';
	labelsAdded: string[];
	labelsRemoved: string[];
	commentId?: number;
	commentUrl?: string;
	reason?: string;
}

// Sandbox / Test Interfaces

export interface TestCommand {
	command: string;
	framework: string;
}

export interface FileChange {
	file: string;
	status: 'added' | 'modified' | 'deleted';
	additions: number;
	deletions: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Gate Evaluation Context — Issue #246
// ─────────────────────────────────────────────────────────────────────────────

/** Kontext, der an Gate-Evaluatoren übergeben wird */
export interface GateEvaluationContext {
	runId: string;
	/** Aktuelle Phase vor der Transition */
	phase: Phase;
	/** Ziel-Phase nach der Transition */
	targetPhase: Phase;
	/** Pfade zu Evidence-Artefakten */
	evidencePaths?: string[];
	/** Request-ID (optional, für Korrelation) */
	requestId?: string;
	/** Welche GateTypes werden ausgewertet */
	gateTypes: GateType[];
}
