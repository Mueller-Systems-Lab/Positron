// Red Test 8: Autonomy Violation
// Issue #219 — T-023
// Verifies that high-autonomy tools are blocked when run has low autonomy level.

import { beforeEach, describe, expect, it } from 'vitest';
import { GatewayService } from '../../gateway.js';
import { ToolRegistry } from '../../registry.js';
import type { ToolCall, ToolDefinition, ToolHandler, ToolResult } from '../../types.js';
import { BLOCK_REASONS } from '../../types.js';

describe('Red Test: Autonomy Violation', () => {
	let registry: ToolRegistry;
	let gateway: GatewayService;

	beforeEach(() => {
		registry = new ToolRegistry();
		gateway = new GatewayService(registry, { enabled: true });
	});

	it('BLOCKS: Level 4 tool at Level 0 (Observer) run', async () => {
		const def: ToolDefinition = {
			id: 'github.comment_evidence_draft',
			title: 'Draft Comment',
			description: 'Draft GitHub comment',
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
			requiredAutonomyLevel: 4,
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

		// Level 0 run trying a Level 4 tool
		const result = await gateway.execute({
			toolId: 'github.comment_evidence_draft',
			arguments: { issueNumber: 1, body: 'test' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 0,
			workspaceRoot: '/tmp/workspace',
		});

		// Should be blocked by autonomy check (Gate 4 comes before approval Gate 6)
		expect(result.success).toBe(false);
		expect(result.blockedReason).toContain(BLOCK_REASONS.AUTONOMY_TOO_LOW);
	});

	it('BLOCKS: Level 3 tool at Level 1 (Research) run', async () => {
		const def: ToolDefinition = {
			id: 'tests.run_selected',
			title: 'Run Tests',
			description: 'Run selected tests',
			inputSchema: {
				type: 'object',
				properties: { command: { type: 'string' } },
				required: ['command'],
			},
			outputSchema: {},
			riskLevel: 'write',
			requiredAutonomyLevel: 3,
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

		// Level 1 run trying a Level 3 tool
		const result = await gateway.execute({
			toolId: 'tests.run_selected',
			arguments: { command: 'npm test' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 1,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(false);
		expect(result.blockedReason).toContain(BLOCK_REASONS.AUTONOMY_TOO_LOW);
	});

	it('BLOCKS: Level 2 tool at Level 0 (Observer) run', async () => {
		const def: ToolDefinition = {
			id: 'evidence.append',
			title: 'Append Evidence',
			description: 'Append evidence',
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
			requiredAutonomyLevel: 2,
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
		gateway.onApprovalCheck = async () => true;

		const result = await gateway.execute({
			toolId: 'evidence.append',
			arguments: { kind: 'test', summary: 'test', status: 'pass' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 0,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(false);
		expect(result.blockedReason).toContain(BLOCK_REASONS.AUTONOMY_TOO_LOW);
	});

	it('ALLOWS: Level 0 tool at Level 0 run (same level)', async () => {
		const def: ToolDefinition = {
			id: 'repo.read_file',
			title: 'Read File',
			description: 'Read file',
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

	it('ALLOWS: Level 0 tool at Level 4 run (higher run level)', async () => {
		const def: ToolDefinition = {
			id: 'repo.read_file',
			title: 'Read File',
			description: 'Read file',
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
			autonomyLevel: 4,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(true);
	});

	it('ALLOWS: Level 2 tool at Level 2 run (exact match)', async () => {
		const def: ToolDefinition = {
			id: 'evidence.append',
			title: 'Append Evidence',
			description: 'Append evidence',
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
			requiredAutonomyLevel: 2,
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
			output: 'evidence appended',
		});

		registry.register(def, handler);
		gateway.onApprovalCheck = async () => true;

		const result = await gateway.execute({
			toolId: 'evidence.append',
			arguments: { kind: 'test', summary: 'test', status: 'pass' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(true);
	});
});
