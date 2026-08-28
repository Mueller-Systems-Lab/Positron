// Positron — GitHub Snapshot Collector: Red Tests (Issue #279 Phase 1C)
// Covers: normalizeGitHubIssuesFromGhJson, normalizeGitHubPullRequestsFromGhJson,
//         createGitHubContextSnapshot, isAllowedReadOnlyGhCommand, getAllowedReadOnlyGhCommands
// All fixtures are inline — no GitHub API calls, no gh CLI execution.

import { describe, expect, test } from 'vitest';
import { getApplyableGreenSafeActions, validateDecisionManifest } from '../decision-manifest.js';
import type {
	GitHubContextSnapshot,
	GitHubIssueSnapshot,
	GitHubPullRequestSnapshot,
} from '../github-context-reconciler.js';
import {
	reconcileGitHubContext,
	reconcileGitHubContextToDecisionManifestRows,
} from '../github-context-reconciler.js';
import {
	createGitHubContextSnapshot,
	getAllowedReadOnlyGhCommands,
	isAllowedReadOnlyGhCommand,
	normalizeGitHubIssuesFromGhJson,
	normalizeGitHubPullRequestsFromGhJson,
} from '../github-snapshot-collector.js';

// ---------------------------------------------------------------------------
// Realistic gh CLI JSON fixtures (simulated output from gh pr list --json, etc.)
// ---------------------------------------------------------------------------

/** Simulates `gh issue list --json number,title,state,labels,url,body --limit 10` */
const ghIssueListJson = [
	{
		number: 279,
		title: 'Replacement: rebuild Issue #229 architecture chain on current main',
		state: 'OPEN',
		labels: [
			{ name: 'enhancement' },
			{ name: 'infrastructure' },
			{ name: 'priority: high' },
			{ name: 'architecture' },
			{ name: 'epic' },
			{ name: 'tooling' },
		],
		url: 'https://github.com/Mueller-Systems-Lab/Positron/issues/279',
		body: 'This issue replaces the old #229 chain...',
	},
	{
		number: 268,
		title: 'CI Recovery: diagnose and repair systemic Quality Gates failures',
		state: 'OPEN',
		labels: [{ name: 'bug' }, { name: 'infrastructure' }, { name: 'priority: high' }],
		url: 'https://github.com/Mueller-Systems-Lab/Positron/issues/268',
		body: '',
	},
	{
		number: 229,
		title:
			'MCP/OpenCode Provider Bootstrap: Tool Gateway + Free Models + Spec Kit Sync + Oversight UI',
		state: 'OPEN',
		labels: [{ name: 'enhancement' }, { name: 'architecture' }, { name: 'P1' }, { name: 'epic' }],
		url: 'https://github.com/Mueller-Systems-Lab/Positron/issues/229',
		body: '',
	},
	{
		number: 100,
		title: 'Completed feature',
		state: 'CLOSED',
		labels: [{ name: 'enhancement' }],
		url: 'https://github.com/Mueller-Systems-Lab/Positron/issues/100',
		body: 'Done in PR #101',
	},
];

/** Simulates `gh pr list --json number,title,state,mergeable,isDraft,url --limit 10` */
const ghPrListJson = [
	{
		number: 218,
		title: 'feat(safety): integrate Stop/Ask policy with GATE_APPROVE',
		state: 'OPEN',
		mergeable: 'MERGEABLE',
		isDraft: false,
		url: 'https://github.com/Mueller-Systems-Lab/Positron/pull/218',
	},
	{
		number: 200,
		title: 'old feature PR',
		state: 'CLOSED',
		mergeable: null,
		isDraft: false,
		url: 'https://github.com/Mueller-Systems-Lab/Positron/pull/200',
	},
	{
		number: 300,
		title: 'WIP: draft feature',
		state: 'OPEN',
		mergeable: 'MERGEABLE',
		isDraft: true,
		url: 'https://github.com/Mueller-Systems-Lab/Positron/pull/300',
	},
];

/** Simulates `gh pr view 218 --json reviews,statusCheckRollup` enrichment data */
const ghPrReviewEnrichment = {
	reviews: [
		{
			id: 'r1',
			author: { login: 'ai-reviewer-bot' },
			state: 'COMMENTED',
			body: 'Actionable comments: 5',
		},
		{
			id: 'r2',
			author: { login: 'ai-reviewer-bot' },
			state: 'COMMENTED',
			body: 'Actionable comments: 4',
		},
	],
	statusCheckRollup: [
		{ name: 'build-and-test', conclusion: 'FAILURE' },
		{ name: 'e2e-playwright', conclusion: 'FAILURE' },
		{ name: 'AI Reviewer', conclusion: 'SUCCESS' },
	],
};

// ---------------------------------------------------------------------------
// Test Suite: normalizeGitHubIssuesFromGhJson
// ---------------------------------------------------------------------------

describe('normalizeGitHubIssuesFromGhJson', () => {
	test('normalizes gh issue list JSON into GitHubIssueSnapshot[]', () => {
		const issues = normalizeGitHubIssuesFromGhJson(ghIssueListJson);
		expect(issues).toHaveLength(4);
		// Sorted by number ascending — issue 100 comes first
		expect(issues[0]!.number).toBe(100);
		expect(issues[0]!.title).toBe('Completed feature');
		expect(issues[0]!.state).toBe('CLOSED');

		const issue279 = issues.find((i) => i.number === 279);
		expect(issue279).toBeDefined();
		expect(issue279!.title).toContain('Replacement');
		expect(issue279!.state).toBe('OPEN');
		expect(issue279!.labels).toEqual([
			'enhancement',
			'infrastructure',
			'priority: high',
			'architecture',
			'epic',
			'tooling',
		]);
		expect(issue279!.url).toBe('https://github.com/Mueller-Systems-Lab/Positron/issues/279');
	});

	test('returns empty array for empty input', () => {
		expect(normalizeGitHubIssuesFromGhJson([])).toHaveLength(0);
	});

	test('returns empty array for non-array input', () => {
		expect(normalizeGitHubIssuesFromGhJson(null)).toHaveLength(0);
		expect(normalizeGitHubIssuesFromGhJson(undefined)).toHaveLength(0);
		expect(normalizeGitHubIssuesFromGhJson('not an array')).toHaveLength(0);
		expect(normalizeGitHubIssuesFromGhJson({})).toHaveLength(0);
	});

	test('handles missing optional fields gracefully', () => {
		const input = [{ number: 1, title: 'test', state: 'OPEN' }];
		const issues = normalizeGitHubIssuesFromGhJson(input);
		expect(issues).toHaveLength(1);
		expect(issues[0]!.labels).toBeUndefined();
		expect(issues[0]!.url).toBeUndefined();
		expect(issues[0]!.body).toBeUndefined();
	});

	test('extracts labels as string[] from gh object format', () => {
		const input = [
			{ number: 1, title: 'x', state: 'OPEN', labels: [{ name: 'bug' }, { name: 'p0' }] },
		];
		const issues = normalizeGitHubIssuesFromGhJson(input);
		expect(issues[0]!.labels).toEqual(['bug', 'p0']);
	});
});

// ---------------------------------------------------------------------------
// Test Suite: normalizeGitHubPullRequestsFromGhJson
// ---------------------------------------------------------------------------

describe('normalizeGitHubPullRequestsFromGhJson', () => {
	test('normalizes gh pr list JSON into GitHubPullRequestSnapshot[]', () => {
		const prs = normalizeGitHubPullRequestsFromGhJson(ghPrListJson);
		expect(prs).toHaveLength(3);

		const pr218 = prs.find((p) => p.number === 218);
		expect(pr218).toBeDefined();
		expect(pr218!.state).toBe('OPEN');
		expect(pr218!.mergeable).toBe('MERGEABLE');
		expect(pr218!.isDraft).toBe(false);
		expect(pr218!.url).toBe('https://github.com/Mueller-Systems-Lab/Positron/pull/218');
	});

	test('preserves DRAFT state', () => {
		const prs = normalizeGitHubPullRequestsFromGhJson(ghPrListJson);
		const pr300 = prs.find((p) => p.number === 300);
		expect(pr300!.isDraft).toBe(true);
	});

	test('preserves CLOSED with null mergeable', () => {
		const prs = normalizeGitHubPullRequestsFromGhJson(ghPrListJson);
		const pr200 = prs.find((p) => p.number === 200);
		expect(pr200!.state).toBe('CLOSED');
		expect(pr200!.mergeable).toBeNull();
	});

	test('enriches with review findings when enrichment data provided', () => {
		const prs = normalizeGitHubPullRequestsFromGhJson(ghPrListJson, {
			218: ghPrReviewEnrichment,
		});
		const pr218 = prs.find((p) => p.number === 218);
		expect(pr218!.reviewFindingCount).toBe(2);
		// Both reviews from ai-reviewer-bot with "Actionable comments" → actionableFindingCount = 2
		expect(pr218!.actionableFindingCount).toBe(2);
		expect(pr218!.findingsAccessible).toBe(true);
	});

	test('returns empty array for non-array input', () => {
		expect(normalizeGitHubPullRequestsFromGhJson(null)).toHaveLength(0);
		expect(normalizeGitHubPullRequestsFromGhJson(undefined)).toHaveLength(0);
		expect(normalizeGitHubPullRequestsFromGhJson('not an array')).toHaveLength(0);
	});

	test('handles missing optional fields gracefully', () => {
		const input = [{ number: 1, title: 'test', state: 'OPEN' }];
		const prs = normalizeGitHubPullRequestsFromGhJson(input);
		expect(prs).toHaveLength(1);
		expect(prs[0]!.mergeable).toBeUndefined();
		expect(prs[0]!.isDraft).toBeUndefined();
		expect(prs[0]!.url).toBeUndefined();
	});

	test('marks findingsAccessible=false when no enrichment provided for PR', () => {
		const prs = normalizeGitHubPullRequestsFromGhJson(ghPrListJson);
		// No enrichment map → findingsAccessible should be undefined (tool gap)
		const pr218 = prs.find((p) => p.number === 218);
		expect(pr218!.findingsAccessible).toBeUndefined();
		expect(pr218!.reviewFindingCount).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Test Suite: createGitHubContextSnapshot
// ---------------------------------------------------------------------------

describe('createGitHubContextSnapshot', () => {
	test('creates GitHubContextSnapshot from normalized data', () => {
		const snapshot = createGitHubContextSnapshot({
			issues: ghIssueListJson,
			pullRequests: ghPrListJson,
		});
		expect(snapshot.pullRequests).toHaveLength(3);
		expect(snapshot.issues).toHaveLength(4);
	});

	test('handles empty inputs', () => {
		const snapshot = createGitHubContextSnapshot({ issues: [], pullRequests: [] });
		expect(snapshot.pullRequests).toHaveLength(0);
		expect(snapshot.issues).toHaveLength(0);
	});

	test('handles non-array inputs by returning empty arrays', () => {
		const snapshot = createGitHubContextSnapshot({ issues: null, pullRequests: undefined });
		expect(snapshot.pullRequests).toHaveLength(0);
		expect(snapshot.issues).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Test Suite: End-to-end: snapshot → reconciler → validator
// ---------------------------------------------------------------------------

describe('snapshot → reconciler → validator pipeline', () => {
	test('current repo-like fixture produces 0 applyable actions', () => {
		const snapshot = createGitHubContextSnapshot({
			issues: ghIssueListJson,
			pullRequests: ghPrListJson,
		});
		const result = reconcileGitHubContext(snapshot);
		expect(result.applyableCount).toBe(0);
		expect(result.validation.valid).toBe(true);
	});

	test('PR #218-like fixture with enrichment produces YELLOW_REVIEW', () => {
		const prs = normalizeGitHubPullRequestsFromGhJson(ghPrListJson, {
			218: ghPrReviewEnrichment,
		});
		const snapshot: GitHubContextSnapshot = { pullRequests: prs, issues: [] };
		const rows = reconcileGitHubContextToDecisionManifestRows(snapshot);
		const pr218 = rows.find((r) => r.action_id === 'PR-218');
		expect(pr218).toBeDefined();
		expect(pr218!.risk_class).toBe('YELLOW_REVIEW');
		expect(pr218!.agent_recommendation).toBe('REVIEW_REQUIRED');
	});

	test('enriched PR #218-like fixture applyable count is zero', () => {
		const prs = normalizeGitHubPullRequestsFromGhJson(ghPrListJson, {
			218: ghPrReviewEnrichment,
		});
		const snapshot: GitHubContextSnapshot = { pullRequests: prs, issues: [] };
		const result = reconcileGitHubContext(snapshot);
		expect(result.applyableCount).toBe(0);
	});

	test('full repo fixture rows pass validateDecisionManifest()', () => {
		const snapshot = createGitHubContextSnapshot({
			issues: ghIssueListJson,
			pullRequests: ghPrListJson,
		});
		const result = reconcileGitHubContext(snapshot);
		expect(result.validation.errors).toHaveLength(0);
		expect(result.rows.length).toBeGreaterThanOrEqual(7); // 4 issues + 3 PRs
	});

	test('Issue #279 is classified as DEFER_TO_279 + DEFER', () => {
		const snapshot = createGitHubContextSnapshot({
			issues: ghIssueListJson,
			pullRequests: [],
		});
		const rows = reconcileGitHubContextToDecisionManifestRows(snapshot);
		const issue279 = rows.find((r) => r.action_id === 'ISSUE-279');
		expect(issue279).toBeDefined();
		expect(issue279!.risk_class).toBe('DEFER_TO_279');
		expect(issue279!.agent_recommendation).toBe('DEFER');
	});

	test('Issue #268 becomes DEFER_TO_279 due to infrastructure label', () => {
		const snapshot = createGitHubContextSnapshot({
			issues: ghIssueListJson,
			pullRequests: [],
		});
		const rows = reconcileGitHubContextToDecisionManifestRows(snapshot);
		const issue268 = rows.find((r) => r.action_id === 'ISSUE-268');
		expect(issue268).toBeDefined();
		// Issue #268 has labels 'bug', 'infrastructure', 'priority: high'
		// 'infrastructure' is an ARCHITECTURE_LABELS entry → DEFER_TO_279
		expect(issue268!.risk_class).toBe('DEFER_TO_279');
		expect(issue268!.agent_recommendation).toBe('DEFER');
	});
});

// ---------------------------------------------------------------------------
// Test Suite: Read-only command allowlist
// ---------------------------------------------------------------------------

describe('isAllowedReadOnlyGhCommand', () => {
	test('allows gh repo view', () => {
		expect(isAllowedReadOnlyGhCommand(['gh', 'repo', 'view'])).toBe(true);
	});

	test('allows gh pr list', () => {
		expect(isAllowedReadOnlyGhCommand(['gh', 'pr', 'list'])).toBe(true);
	});

	test('allows gh pr view', () => {
		expect(isAllowedReadOnlyGhCommand(['gh', 'pr', 'view', '218'])).toBe(true);
	});

	test('allows gh issue list', () => {
		expect(isAllowedReadOnlyGhCommand(['gh', 'issue', 'list'])).toBe(true);
	});

	test('allows gh issue view', () => {
		expect(isAllowedReadOnlyGhCommand(['gh', 'issue', 'view', '279'])).toBe(true);
	});

	test('blocks gh pr merge', () => {
		expect(isAllowedReadOnlyGhCommand(['gh', 'pr', 'merge'])).toBe(false);
	});

	test('blocks gh pr close', () => {
		expect(isAllowedReadOnlyGhCommand(['gh', 'pr', 'close'])).toBe(false);
	});

	test('blocks gh pr comment', () => {
		expect(isAllowedReadOnlyGhCommand(['gh', 'pr', 'comment'])).toBe(false);
	});

	test('blocks gh issue close', () => {
		expect(isAllowedReadOnlyGhCommand(['gh', 'issue', 'close'])).toBe(false);
	});

	test('blocks gh issue comment', () => {
		expect(isAllowedReadOnlyGhCommand(['gh', 'issue', 'comment'])).toBe(false);
	});

	test('blocks gh workflow run', () => {
		expect(isAllowedReadOnlyGhCommand(['gh', 'workflow', 'run'])).toBe(false);
	});

	test('blocks gh run rerun', () => {
		expect(isAllowedReadOnlyGhCommand(['gh', 'run', 'rerun'])).toBe(false);
	});

	test('blocks empty command array', () => {
		expect(isAllowedReadOnlyGhCommand([])).toBe(false);
	});

	test('blocks non-gh command', () => {
		expect(isAllowedReadOnlyGhCommand(['node', 'script.js'])).toBe(false);
	});

	test('blocks gh api (even if read-only, not in allowlist)', () => {
		expect(isAllowedReadOnlyGhCommand(['gh', 'api', 'repos/xxammaxx/Positron'])).toBe(false);
	});
});

describe('getAllowedReadOnlyGhCommands', () => {
	test('returns known allowlist', () => {
		const allowed = getAllowedReadOnlyGhCommands();
		expect(allowed).toContain('gh repo view');
		expect(allowed).toContain('gh pr list');
		expect(allowed).toContain('gh pr view');
		expect(allowed).toContain('gh issue list');
		expect(allowed).toContain('gh issue view');
		expect(allowed.length).toBeGreaterThanOrEqual(5);
	});

	test('does not contain any mutate commands', () => {
		const allowed = getAllowedReadOnlyGhCommands();
		const mutateCommands = [
			'gh pr merge',
			'gh pr close',
			'gh pr comment',
			'gh issue close',
			'gh issue comment',
			'gh workflow run',
			'gh run rerun',
		];
		for (const cmd of mutateCommands) {
			expect(allowed).not.toContain(cmd);
		}
	});
});

// ---------------------------------------------------------------------------
// Test Suite: Deterministic ordering
// ---------------------------------------------------------------------------

describe('snapshot collector deterministic ordering', () => {
	test('same input produces same snapshot twice', () => {
		const s1 = createGitHubContextSnapshot({ issues: ghIssueListJson, pullRequests: ghPrListJson });
		const s2 = createGitHubContextSnapshot({ issues: ghIssueListJson, pullRequests: ghPrListJson });

		expect(s1.pullRequests.length).toBe(s2.pullRequests.length);
		expect(s1.issues.length).toBe(s2.issues.length);

		for (let i = 0; i < s1.pullRequests.length; i++) {
			expect(s1.pullRequests[i]!.number).toBe(s2.pullRequests[i]!.number);
		}
		for (let i = 0; i < s1.issues.length; i++) {
			expect(s1.issues[i]!.number).toBe(s2.issues[i]!.number);
		}
	});

	test('rows from same snapshot are deterministically ordered', () => {
		const s1 = createGitHubContextSnapshot({ issues: ghIssueListJson, pullRequests: ghPrListJson });
		const s2 = createGitHubContextSnapshot({ issues: ghIssueListJson, pullRequests: ghPrListJson });

		const rows1 = reconcileGitHubContextToDecisionManifestRows(s1);
		const rows2 = reconcileGitHubContextToDecisionManifestRows(s2);

		expect(rows1.length).toBe(rows2.length);
		for (let i = 0; i < rows1.length; i++) {
			expect(rows1[i]!.action_id).toBe(rows2[i]!.action_id);
		}
	});
});
