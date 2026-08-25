// Red Test 4: Approval Bypass
// Issue #219 — T-019
// Verifies that write-risk tools require approval and cannot be bypassed.

import { beforeEach, describe, expect, it } from 'vitest';
import { GatewayService } from '../../gateway.js';
import { ToolRegistry } from '../../registry.js';
import type { ToolCall, ToolDefinition, ToolHandler, ToolResult } from '../../types.js';
import { BLOCK_REASONS } from '../../types.js';

describe('Red Test: Approval Bypass', () => {
	let registry: ToolRegistry;
	let gateway: GatewayService;

	beforeEach(() => {
		registry = new ToolRegistry();
		gateway = new GatewayService(registry, { enabled: true });

		const handler: ToolHandler = async (_c: ToolCall): Promise<ToolResult> => ({
			success: true,
			output: 'executed',
		});
	});

	it('BLOCKS: write tool with human_required approval and no handler', async () => {
		const def: ToolDefinition = {
			id: 'github.comment_evidence_draft',
			title: 'Draft Comment',
			description: 'Draft a GitHub comment',
			inputSchema: {
				type: 'object',
				properties: {
					issueNumber: { type: 'number' },
					body: { type: 'string' },
				},
				required: ['issueNumber', 'body'],
			},
			outputSchema: {},
			riskLevel: 'write',
			requiredAutonomyLevel: 2,
			approvalMode: 'human_required',
			allowedPhases: [],
			allowedWorkspaceRoots: [],
			egressPolicy: { allowedHosts: ['api.github.com'], allowedPorts: [443] },
			evidenceRequirements: {
				logArguments: false,
				logOutput: true,
				requireArtifact: false,
			},
		};

		const handler: ToolHandler = async (_c: ToolCall): Promise<ToolResult> => ({
			success: true,
			output: 'drafted',
		});

		registry.register(def, handler);

		const result = await gateway.execute({
			toolId: 'github.comment_evidence_draft',
			arguments: { issueNumber: 1, body: 'test comment' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});

		// Without onApprovalCheck handler, human_required tools are blocked
		expect(result.success).toBe(false);
		expect(result.blockedReason).toContain(BLOCK_REASONS.APPROVAL_REQUIRED);
	});

	it('BLOCKS: write tool when approval callback returns false', async () => {
		const def: ToolDefinition = {
			id: 'evidence.append',
			title: 'Append Evidence',
			description: 'Append evidence item',
			inputSchema: {
				type: 'object',
				properties: {
					kind: { type: 'string' },
					summary: { type: 'string' },
					status: { type: 'string' },
				},
				required: ['kind', 'summary', 'status'],
			},
			outputSchema: {},
			riskLevel: 'write',
			requiredAutonomyLevel: 1,
			approvalMode: 'ask',
			allowedPhases: [],
			allowedWorkspaceRoots: [],
			egressPolicy: { allowedHosts: [], allowedPorts: [] },
			evidenceRequirements: {
				logArguments: true,
				logOutput: true,
				requireArtifact: false,
			},
		};

		const handler: ToolHandler = async (_c: ToolCall): Promise<ToolResult> => ({
			success: true,
			output: 'appended',
		});

		registry.register(def, handler);

		// Approval callback returns false
		gateway.onApprovalCheck = async () => false;

		const result = await gateway.execute({
			toolId: 'evidence.append',
			arguments: { kind: 'test', summary: 'test', status: 'pass' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(false);
		expect(result.blockedReason).toContain(BLOCK_REASONS.APPROVAL_REQUIRED);
	});

	it('ALLOWS: write tool when approval callback returns true', async () => {
		const def: ToolDefinition = {
			id: 'tests.run_selected',
			title: 'Run Tests',
			description: 'Run selected tests',
			inputSchema: {
				type: 'object',
				properties: {
					command: { type: 'string' },
				},
				required: ['command'],
			},
			outputSchema: {},
			riskLevel: 'write',
			requiredAutonomyLevel: 1,
			approvalMode: 'ask',
			allowedPhases: [],
			allowedWorkspaceRoots: [],
			egressPolicy: { allowedHosts: [], allowedPorts: [] },
			evidenceRequirements: {
				logArguments: true,
				logOutput: true,
				requireArtifact: true,
			},
		};

		const handler: ToolHandler = async (_c: ToolCall): Promise<ToolResult> => ({
			success: true,
			output: 'tests passed',
		});

		registry.register(def, handler);
		gateway.onApprovalCheck = async () => true;

		const result = await gateway.execute({
			toolId: 'tests.run_selected',
			arguments: { command: 'npm test' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(true);
	});

	it('ALLOWS: read tool without approval (approvalMode none)', async () => {
		const def: ToolDefinition = {
			id: 'repo.read_file',
			title: 'Read File',
			description: 'Read a file',
			inputSchema: {
				type: 'object',
				properties: { path: { type: 'string' } },
				required: ['path'],
			},
			outputSchema: {},
			riskLevel: 'read',
			requiredAutonomyLevel: 0,
			approvalMode: 'none',
			allowedPhases: [],
			allowedWorkspaceRoots: [],
			egressPolicy: { allowedHosts: [], allowedPorts: [] },
			evidenceRequirements: {
				logArguments: false,
				logOutput: false,
				requireArtifact: false,
			},
		};

		const handler: ToolHandler = async (_c: ToolCall): Promise<ToolResult> => ({
			success: true,
			output: 'content',
		});

		registry.register(def, handler);

		const result = await gateway.execute({
			toolId: 'repo.read_file',
			arguments: { path: 'src/index.ts' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 0,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(true);
	});
});
