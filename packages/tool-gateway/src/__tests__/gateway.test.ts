// GatewayService Unit Tests
// Issue #219 — T-006

import { beforeEach, describe, expect, it } from 'vitest';
import { GatewayService } from '../gateway.js';
import { ToolRegistry } from '../registry.js';
import type { ToolCall, ToolDefinition, ToolHandler, ToolResult } from '../types.js';
import { BLOCK_REASONS } from '../types.js';

// ─── Test Helpers ────────────────────────────────────────────────────

function makeDefinition(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
	return {
		id: 'test.read_tool',
		title: 'Test Read Tool',
		description: 'A test read-only tool for gateway testing',
		inputSchema: { type: 'object', properties: {}, required: [] },
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
		...overrides,
	};
}

function makeCall(overrides: Partial<ToolCall> = {}): ToolCall {
	return {
		toolId: 'test.read_tool',
		arguments: {},
		runId: 'run-001',
		phase: 'IMPLEMENT',
		autonomyLevel: 2,
		workspaceRoot: '/tmp/workspace',
		...overrides,
	};
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('GatewayService', () => {
	let registry: ToolRegistry;
	let gateway: GatewayService;

	beforeEach(() => {
		registry = new ToolRegistry();
		gateway = new GatewayService(registry, { enabled: true });
	});

	describe('Gate 1: Gateway enabled', () => {
		it('should block calls when gateway is disabled', async () => {
			gateway.updateConfig({ enabled: false });

			const result = await gateway.execute(makeCall());

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.GATEWAY_DISABLED);
		});
	});

	describe('Gate 2: Schema validation', () => {
		it('should block call missing required field', async () => {
			const def = makeDefinition({
				id: 'test.schema',
				inputSchema: {
					type: 'object',
					properties: {
						name: { type: 'string' },
					},
					required: ['name'],
				},
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({
					success: true,
					output: 'ok',
				}),
			);

			const call = makeCall({ toolId: 'test.schema', arguments: {} });

			const result = await gateway.execute(call);

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.SCHEMA_VALIDATION_FAILED);
		});

		it('should block call with wrong argument type', async () => {
			const def = makeDefinition({
				id: 'test.typed',
				inputSchema: {
					type: 'object',
					properties: {
						count: { type: 'number' },
					},
					required: [],
				},
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({
					success: true,
					output: 'ok',
				}),
			);

			const call = makeCall({
				toolId: 'test.typed',
				arguments: { count: 'not-a-number' },
			});

			const result = await gateway.execute(call);

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.SCHEMA_VALIDATION_FAILED);
		});

		it('should pass valid arguments', async () => {
			const def = makeDefinition({
				id: 'test.valid',
				inputSchema: {
					type: 'object',
					properties: {
						name: { type: 'string' },
						count: { type: 'number' },
					},
					required: ['name'],
				},
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({
					success: true,
					output: 'ok',
				}),
			);

			const call = makeCall({
				toolId: 'test.valid',
				arguments: { name: 'test', count: 42 },
			});

			const result = await gateway.execute(call);

			expect(result.success).toBe(true);
		});
	});

	describe('Gate 3: Tool lookup', () => {
		it('should block unknown tool', async () => {
			const result = await gateway.execute(makeCall({ toolId: 'nonexistent.tool' }));

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.TOOL_NOT_FOUND);
		});
	});

	describe('Gate 4: Phase check', () => {
		it('should block tool not allowed in current phase', async () => {
			const def = makeDefinition({
				id: 'test.review_only',
				allowedPhases: ['REVIEW'],
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({
					success: true,
					output: 'ok',
				}),
			);

			const call = makeCall({
				toolId: 'test.review_only',
				phase: 'IMPLEMENT',
			});

			const result = await gateway.execute(call);

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.PHASE_NOT_ALLOWED);
		});

		it('should allow tool in current phase', async () => {
			const def = makeDefinition({
				id: 'test.review_only',
				allowedPhases: ['REVIEW'],
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({
					success: true,
					output: 'ok',
				}),
			);

			const call = makeCall({
				toolId: 'test.review_only',
				phase: 'REVIEW',
			});

			const result = await gateway.execute(call);

			expect(result.success).toBe(true);
		});
	});

	describe('Gate 5: Autonomy check', () => {
		it('should block when autonomy too low', async () => {
			const def = makeDefinition({
				id: 'test.high_auto',
				requiredAutonomyLevel: 3,
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({
					success: true,
					output: 'ok',
				}),
			);

			const call = makeCall({
				toolId: 'test.high_auto',
				autonomyLevel: 1,
			});

			const result = await gateway.execute(call);

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.AUTONOMY_TOO_LOW);
		});
	});

	describe('Gate 6: Approval check', () => {
		it('should block human_required tool without approval handler', async () => {
			const def = makeDefinition({
				id: 'test.human_needed',
				riskLevel: 'write',
				approvalMode: 'human_required',
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({
					success: true,
					output: 'ok',
				}),
			);

			const result = await gateway.execute(makeCall({ toolId: 'test.human_needed' }));

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.APPROVAL_REQUIRED);
		});

		it('should allow tool when approval check passes', async () => {
			const def = makeDefinition({
				id: 'test.approved',
				riskLevel: 'write',
				approvalMode: 'ask',
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({
					success: true,
					output: 'ok',
				}),
			);

			gateway.onApprovalCheck = async () => true;

			const result = await gateway.execute(makeCall({ toolId: 'test.approved' }));

			expect(result.success).toBe(true);
		});

		it('should block tool when approval check fails', async () => {
			const def = makeDefinition({
				id: 'test.denied',
				riskLevel: 'write',
				approvalMode: 'ask',
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({
					success: true,
					output: 'ok',
				}),
			);

			gateway.onApprovalCheck = async () => false;

			const result = await gateway.execute(makeCall({ toolId: 'test.denied' }));

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.APPROVAL_REQUIRED);
		});
	});

	describe('Gate 7: Workspace boundary check', () => {
		it('should block path traversal with parent directory', async () => {
			const def = makeDefinition({
				id: 'test.read_file',
				inputSchema: {
					type: 'object',
					properties: {
						path: { type: 'string' },
					},
					required: ['path'],
				},
				riskLevel: 'read',
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({
					success: true,
					output: 'ok',
				}),
			);

			const call = makeCall({
				toolId: 'test.read_file',
				arguments: { path: '../../.env' },
				workspaceRoot: '/tmp/workspace',
			});

			const result = await gateway.execute(call);

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.PATH_TRAVERSAL);
		});

		it('should allow valid path within workspace', async () => {
			const def = makeDefinition({
				id: 'test.read_file',
				inputSchema: {
					type: 'object',
					properties: {
						path: { type: 'string' },
					},
					required: ['path'],
				},
				riskLevel: 'read',
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({
					success: true,
					output: 'ok',
				}),
			);

			const call = makeCall({
				toolId: 'test.read_file',
				arguments: { path: 'src/index.ts' },
				workspaceRoot: '/tmp/workspace',
			});

			const result = await gateway.execute(call);

			// Note: this should pass the boundary check, but may fail
			// at the actual file read (not tested here since handler is mock)
			expect(result.success).toBe(true);
		});

		it('should block multiple ../ traversal', async () => {
			const def = makeDefinition({
				id: 'test.read_file',
				inputSchema: {
					type: 'object',
					properties: {
						path: { type: 'string' },
					},
					required: ['path'],
				},
				riskLevel: 'read',
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({
					success: true,
					output: 'ok',
				}),
			);

			const call = makeCall({
				toolId: 'test.read_file',
				arguments: { path: '../../../etc/passwd' },
				workspaceRoot: '/tmp/workspace/subdir',
			});

			const result = await gateway.execute(call);

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.PATH_TRAVERSAL);
		});
	});

	describe('Secret redaction', () => {
		it('should redact GitHub tokens from output', async () => {
			const def = makeDefinition({ id: 'test.output' });

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({
					success: true,
					output: 'Token: ghp_abcdefghijklmnopqrstuvwxyz1234567890',
				}),
			);

			const result = await gateway.execute(makeCall({ toolId: 'test.output' }));

			expect(result.success).toBe(true);
			const output = result.output as string;
			// Redacted token contains "***REDACTED***" but preserves prefix
			expect(output).toContain('***REDACTED***');
			// Full 36-char token should not be present
			expect(output).not.toMatch(/ghp_[a-zA-Z0-9]{36}/);
		});
	});

	describe('Gate 9: Audit enforcement', () => {
		it('should block when requiresAuditLog is true and no onAudit callback', async () => {
			const def = makeDefinition({
				id: 'test.audit_blocked',
				riskLevel: 'write',
				requiresAuditLog: true,
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({ success: true, output: 'ok' }),
			);

			const result = await gateway.execute(makeCall({ toolId: 'test.audit_blocked' }));

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.AUDIT_LOG_MISSING);
		});

		it('should allow when requiresAuditLog is true and onAudit succeeds', async () => {
			const def = makeDefinition({
				id: 'test.audit_allowed',
				riskLevel: 'write',
				requiresAuditLog: true,
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({ success: true, output: 'ok' }),
			);

			gateway.onAudit = async (_call: ToolCall): Promise<string> => 'evt-001';

			const result = await gateway.execute(makeCall({ toolId: 'test.audit_allowed' }));

			expect(result.success).toBe(true);
			expect(result.evidenceEventId).toBe('evt-001');
		});

		it('should block when onAudit throws', async () => {
			const def = makeDefinition({
				id: 'test.audit_throw',
				riskLevel: 'write',
				requiresAuditLog: true,
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({ success: true, output: 'ok' }),
			);

			gateway.onAudit = async (_call: ToolCall): Promise<string> => {
				throw new Error('Audit storage failure');
			};

			const result = await gateway.execute(makeCall({ toolId: 'test.audit_throw' }));

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.AUDIT_LOG_MISSING);
			expect(result.blockedReason).toContain('Audit storage failure');
		});

		it('should NOT block when requiresAuditLog is not set', async () => {
			const def = makeDefinition({
				id: 'test.no_audit',
				riskLevel: 'write',
				// requiresAuditLog not set
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({ success: true, output: 'ok' }),
			);

			const result = await gateway.execute(makeCall({ toolId: 'test.no_audit' }));

			// Should pass through audit gate and succeed
			expect(result.success).toBe(true);
		});

		it('should NOT reach audit gate when earlier gate blocks (disabled gateway)', async () => {
			gateway.updateConfig({ enabled: false });

			const def = makeDefinition({
				id: 'test.disabled_audit',
				riskLevel: 'write',
				requiresAuditLog: true,
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({ success: true, output: 'ok' }),
			);

			gateway.onAudit = async (_call: ToolCall): Promise<string> => 'evt-never-called';

			const result = await gateway.execute(makeCall({ toolId: 'test.disabled_audit' }));

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.GATEWAY_DISABLED);
			expect(result.blockedReason).not.toContain(BLOCK_REASONS.AUDIT_LOG_MISSING);
		});
	});
});
