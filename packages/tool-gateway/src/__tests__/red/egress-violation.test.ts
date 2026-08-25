// Red Test 5: Egress Violation
// Issue #219 — T-020
// Verifies that network access to unauthorized hosts is blocked.

import { beforeEach, describe, expect, it } from 'vitest';
import { GatewayService } from '../../gateway.js';
import { ToolRegistry } from '../../registry.js';
import type { ToolCall, ToolDefinition, ToolHandler, ToolResult } from '../../types.js';
import { BLOCK_REASONS } from '../../types.js';

describe('Red Test: Egress Violation', () => {
	let registry: ToolRegistry;
	let gateway: GatewayService;

	beforeEach(() => {
		registry = new ToolRegistry();
		gateway = new GatewayService(registry, {
			enabled: true,
			enforceEgress: true,
		});
	});

	function registerToolWithEgress(
		id: string,
		egressPolicy: { allowedHosts: string[]; allowedPorts: number[] },
	) {
		const def: ToolDefinition = {
			id,
			title: 'Egress Test',
			description: 'Test tool for egress validation',
			inputSchema: {
				type: 'object',
				properties: {
					url: { type: 'string' },
				},
				required: ['url'],
			},
			outputSchema: {},
			riskLevel: 'network',
			requiredAutonomyLevel: 0,
			approvalMode: 'none',
			allowedPhases: [],
			allowedWorkspaceRoots: [],
			egressPolicy,
			evidenceRequirements: {
				logArguments: false,
				logOutput: false,
				requireArtifact: false,
			},
		};

		const handler: ToolHandler = async (_c: ToolCall): Promise<ToolResult> => ({
			success: true,
			output: 'network call ok',
		});

		registry.register(def, handler);
	}

	it('BLOCKS: network call with no egress policy (empty hosts)', async () => {
		registerToolWithEgress('test.no_egress', {
			allowedHosts: [],
			allowedPorts: [],
		});

		const result = await gateway.execute({
			toolId: 'test.no_egress',
			arguments: { url: 'https://evil.com/data' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(false);
		expect(result.blockedReason).toContain(BLOCK_REASONS.EGRESS_BLOCKED);
	});

	it('BLOCKS: network call to host not in allowed list', async () => {
		registerToolWithEgress('test.restricted', {
			allowedHosts: ['api.github.com'],
			allowedPorts: [443],
		});

		const result = await gateway.execute({
			toolId: 'test.restricted',
			arguments: { url: 'https://evil.com/exfiltrate' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(false);
		expect(result.blockedReason).toContain(BLOCK_REASONS.EGRESS_BLOCKED);
	});

	it('ALLOWS: network call to allowed host', async () => {
		registerToolWithEgress('test.github', {
			allowedHosts: ['api.github.com'],
			allowedPorts: [443],
		});

		const result = await gateway.execute({
			toolId: 'test.github',
			arguments: { url: 'https://api.github.com/repos/xxammaxx/Positron' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(true);
	});

	it('ALLOWS: network call to subdomain of allowed host', async () => {
		registerToolWithEgress('test.github_wildcard', {
			allowedHosts: ['github.com'],
			allowedPorts: [443],
		});

		const result = await gateway.execute({
			toolId: 'test.github_wildcard',
			arguments: { url: 'https://api.github.com/graphql' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});

		// api.github.com is a subdomain of github.com
		expect(result.success).toBe(true);
	});

	it('BLOCKS: network call with raw IP address', async () => {
		registerToolWithEgress('test.restricted', {
			allowedHosts: ['api.github.com'],
			allowedPorts: [443],
		});

		const result = await gateway.execute({
			toolId: 'test.restricted',
			arguments: { url: 'https://192.168.1.1:8080/data' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(false);
		expect(result.blockedReason).toContain(BLOCK_REASONS.EGRESS_BLOCKED);
	});

	it('ALLOWS: tool without URL argument (egress not applicable)', async () => {
		registerToolWithEgress('test.no_url', {
			allowedHosts: [],
			allowedPorts: [],
		});

		// Override the input schema to not require 'url'
		// Re-register with different schema
		registry = new ToolRegistry();
		gateway = new GatewayService(registry, {
			enabled: true,
			enforceEgress: true,
		});

		const def: ToolDefinition = {
			id: 'test.no_url',
			title: 'No URL Tool',
			description: 'Tool without URL argument',
			inputSchema: {
				type: 'object',
				properties: {
					name: { type: 'string' },
				},
				required: ['name'],
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
			output: 'ok',
		});

		registry.register(def, handler);

		const result = await gateway.execute({
			toolId: 'test.no_url',
			arguments: { name: 'hello' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(true);
	});
});
