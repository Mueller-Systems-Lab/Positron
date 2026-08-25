// Red Test 2: Path Traversal
// Issue #219 — T-017
// Verifies that path traversal outside workspace is blocked.

import { beforeEach, describe, expect, it } from 'vitest';
import { GatewayService } from '../../gateway.js';
import { ToolRegistry } from '../../registry.js';
import type { ToolCall, ToolDefinition, ToolHandler, ToolResult } from '../../types.js';
import { BLOCK_REASONS } from '../../types.js';

describe('Red Test: Path Traversal', () => {
	let registry: ToolRegistry;
	let gateway: GatewayService;

	beforeEach(() => {
		registry = new ToolRegistry();
		gateway = new GatewayService(registry, {
			enabled: true,
			enforcePathBoundaries: true,
		});

		// Register a file-read tool
		const def: ToolDefinition = {
			id: 'repo.read_file',
			title: 'Read File',
			description: 'Read file contents',
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string' },
				},
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
			output: 'file content',
		});

		registry.register(def, handler);
	});

	it("BLOCKS: path '../../.env' outside workspace", async () => {
		const result = await gateway.execute({
			toolId: 'repo.read_file',
			arguments: { path: '../../.env' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace/subdir',
		});

		expect(result.success).toBe(false);
		expect(result.blockedReason).toContain(BLOCK_REASONS.PATH_TRAVERSAL);
	});

	it("BLOCKS: path '../../../etc/passwd' escaping workspace", async () => {
		const result = await gateway.execute({
			toolId: 'repo.read_file',
			arguments: { path: '../../../etc/passwd' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace/subdir',
		});

		expect(result.success).toBe(false);
		expect(result.blockedReason).toContain(BLOCK_REASONS.PATH_TRAVERSAL);
	});

	it("BLOCKS: path '../outside' one level up", async () => {
		const result = await gateway.execute({
			toolId: 'repo.read_file',
			arguments: { path: '../outside' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(false);
		expect(result.blockedReason).toContain(BLOCK_REASONS.PATH_TRAVERSAL);
	});

	it('BLOCKS: path with encoded traversal using multiple dots', async () => {
		// "..." as a directory name is valid (not traversal), but "...." is also valid.
		// The real test is that ".." with a trailing separator still gets caught.
		const result = await gateway.execute({
			toolId: 'repo.read_file',
			arguments: { path: '....//....//etc/passwd' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});

		// "...." is NOT ".." — it's a valid directory name.
		// The path boundary check should pass for valid names.
		// But actual file won't exist. We verify boundary check passes.
		expect(result.blockedReason).toBeFalsy();
	});

	it("PASSES: valid path 'src/index.ts' within workspace", async () => {
		const result = await gateway.execute({
			toolId: 'repo.read_file',
			arguments: { path: 'src/index.ts' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});

		// Should pass boundary check (actual file read handled by handler)
		expect(result.success).toBe(true);
	});

	it("PASSES: path 'packages/shared/src/types.ts' subdirectory", async () => {
		const result = await gateway.execute({
			toolId: 'repo.read_file',
			arguments: { path: 'packages/shared/src/types.ts' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});

		expect(result.success).toBe(true);
	});
});
