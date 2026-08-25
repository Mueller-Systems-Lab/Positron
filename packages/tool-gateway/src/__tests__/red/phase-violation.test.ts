// Red Test 7: Phase Violation
// Issue #219 — T-022
// Verifies that tools are blocked when called in disallowed phases.

import { beforeEach, describe, expect, it } from 'vitest';
import { GatewayService } from '../../gateway.js';
import { ToolRegistry } from '../../registry.js';
import type { ToolCall, ToolDefinition, ToolHandler, ToolResult } from '../../types.js';
import { BLOCK_REASONS } from '../../types.js';

describe('Red Test: Phase Violation', () => {
	let registry: ToolRegistry;
	let gateway: GatewayService;

	beforeEach(() => {
		registry = new ToolRegistry();
		gateway = new GatewayService(registry, { enabled: true });
	});

	it('BLOCKS: REVIEW-only tool called in CODE phase', async () => {
		const def: ToolDefinition = {
			id: 'test.review_tool',
			title: 'Review Tool',
			description: 'Only allowed in REVIEW phase',
			inputSchema: { type: 'object', properties: {}, required: [] },
			outputSchema: {},
			riskLevel: 'read',
			requiredAutonomyLevel: 0,
			approvalMode: 'none',
			allowedPhases: ['REVIEW'],
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
			output: 'review done',
		});

		registry.register(def, handler);

		const result = await gateway.execute({
			toolId: 'test.review_tool',
			arguments: {},
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(false);
		expect(result.blockedReason).toContain(BLOCK_REASONS.PHASE_NOT_ALLOWED);
	});

	it('BLOCKS: IMPLEMENT-only tool called in SPECIFY phase', async () => {
		const def: ToolDefinition = {
			id: 'test.impl_tool',
			title: 'Implement Tool',
			description: 'Only for implementation',
			inputSchema: { type: 'object', properties: {}, required: [] },
			outputSchema: {},
			riskLevel: 'read',
			requiredAutonomyLevel: 0,
			approvalMode: 'none',
			allowedPhases: ['IMPLEMENT'],
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
			output: 'code written',
		});

		registry.register(def, handler);

		const result = await gateway.execute({
			toolId: 'test.impl_tool',
			arguments: {},
			runId: 'run-001',
			phase: 'SPECIFY',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(false);
		expect(result.blockedReason).toContain(BLOCK_REASONS.PHASE_NOT_ALLOWED);
	});

	it('BLOCKS: write tool in QUEUED phase (early pipeline)', async () => {
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
			requiredAutonomyLevel: 1,
			approvalMode: 'ask',
			allowedPhases: ['TEST', 'REVIEW', 'IMPLEMENT'],
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

		// Try to call in QUEUED phase (very early)
		const result = await gateway.execute({
			toolId: 'evidence.append',
			arguments: { kind: 'test', summary: 'test', status: 'pass' },
			runId: 'run-001',
			phase: 'QUEUED',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(false);
		expect(result.blockedReason).toContain(BLOCK_REASONS.PHASE_NOT_ALLOWED);
	});

	it('ALLOWS: tool without phase restrictions (all phases)', async () => {
		const def: ToolDefinition = {
			id: 'repo.read_file',
			title: 'Read File',
			description: 'Read file contents',
			inputSchema: {
				type: 'object',
				properties: { path: { type: 'string' } },
				required: ['path'],
			},
			outputSchema: {},
			riskLevel: 'read',
			requiredAutonomyLevel: 0,
			approvalMode: 'none',
			allowedPhases: [], // Empty = all phases allowed
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

		const phases = ['QUEUED', 'SPECIFY', 'PLAN', 'IMPLEMENT', 'TEST', 'REVIEW', 'COMMIT'];

		for (const phase of phases) {
			const result = await gateway.execute({
				toolId: 'repo.read_file',
				arguments: { path: 'src/index.ts' },
				runId: 'run-001',
				phase: phase as never,
				autonomyLevel: 0,
				workspaceRoot: '/tmp/workspace',
			});

			expect(result.success).toBe(true);
		}
	});

	it('ALLOWS: tool in its allowed phase', async () => {
		const def: ToolDefinition = {
			id: 'test.review_tool',
			title: 'Review Tool',
			description: 'Only in REVIEW',
			inputSchema: { type: 'object', properties: {}, required: [] },
			outputSchema: {},
			riskLevel: 'read',
			requiredAutonomyLevel: 0,
			approvalMode: 'none',
			allowedPhases: ['REVIEW'],
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
			output: 'review done',
		});

		registry.register(def, handler);

		const result = await gateway.execute({
			toolId: 'test.review_tool',
			arguments: {},
			runId: 'run-001',
			phase: 'REVIEW',
			autonomyLevel: 0,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(true);
	});
});
