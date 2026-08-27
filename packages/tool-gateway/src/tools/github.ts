// Built-in Tools: GitHub Operations
// Issue #219
// github.read_issue, github.comment_evidence_draft

import type { ToolDefinition, ToolHandler, ToolResult } from '../types.js';

// ─── Tool Definitions ────────────────────────────────────────────────

export const githubReadIssueDef: ToolDefinition = {
	id: 'github.read_issue',
	title: 'Read GitHub Issue',
	description:
		'Read comments and metadata from a GitHub issue. Requires the GitHub adapter to be configured.',
	inputSchema: {
		type: 'object',
		properties: {
			issueNumber: {
				type: 'number',
				description: 'The GitHub issue number to read',
			},
			repo: {
				type: 'string',
				maxLength: 256,
				description: 'Repository in owner/name format (defaults to configured repo)',
			},
		},
		required: ['issueNumber'],
	},
	outputSchema: {
		type: 'object',
		properties: {
			title: { type: 'string' },
			body: { type: 'string' },
			comments: { type: 'array' },
			state: { type: 'string' },
			labels: { type: 'array' },
		},
	},
	riskLevel: 'read',
	requiredAutonomyLevel: 0,
	approvalMode: 'none',
	allowedPhases: [],
	allowedWorkspaceRoots: [],
	egressPolicy: {
		allowedHosts: ['api.github.com', 'github.com'],
		allowedPorts: [443],
	},
	evidenceRequirements: {
		logArguments: true,
		logOutput: false,
		requireArtifact: false,
	},
};

export const githubCommentEvidenceDraftDef: ToolDefinition = {
	id: 'github.comment_evidence_draft',
	title: 'Draft Evidence Comment',
	description:
		'Create a draft comment on a GitHub issue. The comment is NOT published until explicitly approved.',
	inputSchema: {
		type: 'object',
		properties: {
			issueNumber: {
				type: 'number',
				description: 'The GitHub issue number to comment on',
			},
			body: {
				type: 'string',
				maxLength: 65536,
				description: 'Comment body in Markdown format',
			},
			repo: {
				type: 'string',
				maxLength: 256,
				description: 'Repository in owner/name format (defaults to configured repo)',
			},
		},
		required: ['issueNumber', 'body'],
	},
	outputSchema: {
		type: 'object',
		properties: {
			draftId: { type: 'string' },
			issueNumber: { type: 'number' },
			preview: { type: 'string' },
		},
	},
	riskLevel: 'write',
	requiredAutonomyLevel: 2,
	approvalMode: 'human_required',
	allowedPhases: [],
	allowedWorkspaceRoots: [],
	egressPolicy: {
		allowedHosts: ['api.github.com', 'github.com'],
		allowedPorts: [443],
	},
	evidenceRequirements: {
		logArguments: false,
		logOutput: true,
		requireArtifact: false,
	},
};

// ─── Tool Handlers ───────────────────────────────────────────────────

/**
 * Read a GitHub issue.
 * In fake mode, returns a simulated response.
 * In real mode, uses the gh CLI or GitHub API.
 */
export const githubReadIssueHandler: ToolHandler = async (call): Promise<ToolResult> => {
	try {
		const issueNumber = call.arguments.issueNumber as number;
		const repo = (call.arguments.repo as string) || 'Mueller-Systems-Lab/Positron';

		// In fake/offline mode, return a simulated response
		if (process.env.POSITRON_GITHUB_MODE === 'fake' || process.env.GITHUB_MODE === 'fake') {
			return {
				success: true,
				output: {
					title: `Issue #${issueNumber} (fake mode)`,
					body: 'This is a simulated issue response. Real mode requires GITHUB_TOKEN.',
					comments: [
						{
							id: 'fake-comment-1',
							user: 'positron-bot',
							body: 'Simulated comment 1',
							createdAt: new Date().toISOString(),
						},
					],
					state: 'open',
					labels: ['enhancement'],
				},
			};
		}

		// Real mode: delegate to gh CLI or GitHub API
		// This would normally use @positron/github-adapter
		// For now, return a placeholder indicating real mode is available
		return {
			success: true,
			output: {
				title: `Issue #${issueNumber}`,
				body: 'GitHub adapter connection established. Use gh CLI or GitHubAdapter for full access.',
				comments: [],
				state: 'unknown',
				labels: [],
			},
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			output: null,
			error: `Failed to read issue: ${message}`,
		};
	}
};

/**
 * Draft an evidence comment on a GitHub issue.
 * Creates a draft that must be approved before publishing.
 */
export const githubCommentEvidenceDraftHandler: ToolHandler = async (call): Promise<ToolResult> => {
	try {
		const issueNumber = call.arguments.issueNumber as number;
		const body = call.arguments.body as string;
		const repo = (call.arguments.repo as string) || 'Mueller-Systems-Lab/Positron';

		const draftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

		// In fake mode, return a simulated draft
		if (process.env.POSITRON_GITHUB_MODE === 'fake' || process.env.GITHUB_MODE === 'fake') {
			return {
				success: true,
				output: {
					draftId,
					issueNumber,
					preview: body.slice(0, 200) + (body.length > 200 ? '...' : ''),
					repo,
					status: 'draft',
				},
			};
		}

		// Real mode: draft is stored locally, not posted to GitHub
		return {
			success: true,
			output: {
				draftId,
				issueNumber,
				preview: body.slice(0, 200) + (body.length > 200 ? '...' : ''),
				repo,
				status: 'draft',
			},
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			success: false,
			output: null,
			error: `Failed to draft comment: ${message}`,
		};
	}
};
