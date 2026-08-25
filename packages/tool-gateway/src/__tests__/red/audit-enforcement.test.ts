// Audit Enforcement Red/Negative Tests
// Issue #245 — requiresAuditLog runtime enforcement
// These tests verify that the audit gate blocks execution when
// requiresAuditLog is true but no audit sink is available or
// the audit sink fails.

import { beforeEach, describe, expect, it } from 'vitest';
import { GatewayService } from '../../gateway.js';
import { ToolRegistry } from '../../registry.js';
import type { ToolCall, ToolDefinition, ToolResult } from '../../types.js';
import { BLOCK_REASONS } from '../../types.js';

// ─── Test Helpers ────────────────────────────────────────────────────

function makeDefinition(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
	return {
		id: 'test.tool',
		title: 'Test Tool',
		description: 'A test tool for audit enforcement testing',
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
		toolId: 'test.tool',
		arguments: {},
		runId: 'run-001',
		phase: 'IMPLEMENT',
		autonomyLevel: 2,
		workspaceRoot: '/tmp/workspace',
		...overrides,
	};
}

function makeSuccessHandler(): (_c: ToolCall) => Promise<ToolResult> {
	return async (_c: ToolCall): Promise<ToolResult> => ({
		success: true,
		output: 'ok',
	});
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('Audit Enforcement (Issue #245)', () => {
	let registry: ToolRegistry;
	let gateway: GatewayService;

	beforeEach(() => {
		registry = new ToolRegistry();
		gateway = new GatewayService(registry, { enabled: true });
	});

	// ── Core Audit Enforcement ───────────────────────────────────────

	describe('Gate 9: Audit enforcement', () => {
		it('should block write tool with requiresAuditLog when no audit callback configured', async () => {
			const def = makeDefinition({
				id: 'test.write_tool',
				riskLevel: 'write',
				requiresAuditLog: true,
			});

			registry.register(def, makeSuccessHandler());

			const result = await gateway.execute(makeCall({ toolId: 'test.write_tool' }));

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.AUDIT_LOG_MISSING);
		});

		it('should block destructive tool with requiresAuditLog when no audit callback configured', async () => {
			const def = makeDefinition({
				id: 'test.destructive_tool',
				riskLevel: 'destructive',
				requiresAuditLog: true,
			});

			registry.register(def, makeSuccessHandler());

			const result = await gateway.execute(makeCall({ toolId: 'test.destructive_tool' }));

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.AUDIT_LOG_MISSING);
		});

		it('should allow write tool with requiresAuditLog when audit callback succeeds', async () => {
			const def = makeDefinition({
				id: 'test.audited_write',
				riskLevel: 'write',
				requiresAuditLog: true,
			});

			registry.register(def, makeSuccessHandler());

			gateway.onAudit = async (_call: ToolCall): Promise<string> => {
				return 'evt-audit-001';
			};

			const result = await gateway.execute(makeCall({ toolId: 'test.audited_write' }));

			expect(result.success).toBe(true);
			expect(result.evidenceEventId).toBe('evt-audit-001');
		});

		it('should block tool when audit callback throws', async () => {
			const def = makeDefinition({
				id: 'test.audit_fail',
				riskLevel: 'write',
				requiresAuditLog: true,
			});

			let handlerCalled = false;
			registry.register(def, async (_c: ToolCall): Promise<ToolResult> => {
				handlerCalled = true;
				return { success: true, output: 'ok' };
			});

			gateway.onAudit = async (_call: ToolCall): Promise<string> => {
				throw new Error('Audit sink unavailable');
			};

			const result = await gateway.execute(makeCall({ toolId: 'test.audit_fail' }));

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.AUDIT_LOG_MISSING);
			expect(result.blockedReason).toContain('Audit sink unavailable');
			// Tool handler must NOT have been called
			expect(handlerCalled).toBe(false);
		});

		it('should call audit callback BEFORE tool execution', async () => {
			const callOrder: string[] = [];

			const def = makeDefinition({
				id: 'test.order_check',
				riskLevel: 'write',
				requiresAuditLog: true,
			});

			registry.register(def, async (_c: ToolCall): Promise<ToolResult> => {
				callOrder.push('handler');
				return { success: true, output: 'ok' };
			});

			gateway.onAudit = async (_call: ToolCall): Promise<string> => {
				callOrder.push('audit');
				return 'evt-order-001';
			};

			await gateway.execute(makeCall({ toolId: 'test.order_check' }));

			expect(callOrder).toEqual(['audit', 'handler']);
		});

		it('should NOT call tool handler when audit gate blocks', async () => {
			let handlerCalled = false;

			const def = makeDefinition({
				id: 'test.blocked_handler',
				riskLevel: 'write',
				requiresAuditLog: true,
			});

			// No onAudit callback → should block at Gate 9
			registry.register(def, async (_c: ToolCall): Promise<ToolResult> => {
				handlerCalled = true;
				return { success: true, output: 'ok' };
			});

			const result = await gateway.execute(makeCall({ toolId: 'test.blocked_handler' }));

			expect(result.success).toBe(false);
			expect(handlerCalled).toBe(false);
		});
	});

	// ── Read-only Tools ──────────────────────────────────────────────

	describe('Read-only tools', () => {
		it('should NOT block read-only tool without requiresAuditLog', async () => {
			const def = makeDefinition({
				id: 'test.read_only',
				riskLevel: 'read',
				// requiresAuditLog not set
			});

			registry.register(def, makeSuccessHandler());

			const result = await gateway.execute(makeCall({ toolId: 'test.read_only' }));

			expect(result.success).toBe(true);
		});

		it('should block read-only tool WITH requiresAuditLog when no audit callback', async () => {
			const def = makeDefinition({
				id: 'test.audited_read',
				riskLevel: 'read',
				requiresAuditLog: true,
			});

			registry.register(def, makeSuccessHandler());

			const result = await gateway.execute(makeCall({ toolId: 'test.audited_read' }));

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.AUDIT_LOG_MISSING);
		});

		it('should allow read-only tool with requiresAuditLog when audit callback succeeds', async () => {
			const def = makeDefinition({
				id: 'test.audited_read_ok',
				riskLevel: 'read',
				requiresAuditLog: true,
			});

			registry.register(def, makeSuccessHandler());

			gateway.onAudit = async (_call: ToolCall): Promise<string> => {
				return 'evt-read-audit-001';
			};

			const result = await gateway.execute(makeCall({ toolId: 'test.audited_read_ok' }));

			expect(result.success).toBe(true);
			expect(result.evidenceEventId).toBe('evt-read-audit-001');
		});
	});

	// ── Sealed Gateway Priority ───────────────────────────────────────

	describe('Sealed gateway priority', () => {
		it('should block at Gate 1 (disabled) even when audit callback is configured', async () => {
			gateway.updateConfig({ enabled: false });

			const def = makeDefinition({
				id: 'test.disabled_gateway',
				riskLevel: 'write',
				requiresAuditLog: true,
			});

			registry.register(def, makeSuccessHandler());

			gateway.onAudit = async (_call: ToolCall): Promise<string> => {
				return 'evt-should-not-reach';
			};

			const result = await gateway.execute(makeCall({ toolId: 'test.disabled_gateway' }));

			expect(result.success).toBe(false);
			// Must be blocked by GATEWAY_DISABLED, not AUDIT_LOG_MISSING
			expect(result.blockedReason).toContain(BLOCK_REASONS.GATEWAY_DISABLED);
			expect(result.blockedReason).not.toContain(BLOCK_REASONS.AUDIT_LOG_MISSING);
		});

		it('should block sealed registry tool at Gate 3 when not found', async () => {
			// Sealed registry — tool not registered → Gate 3 blocks
			registry.seal();

			const result = await gateway.execute(makeCall({ toolId: 'unregistered.tool' }));

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.TOOL_NOT_FOUND);
		});
	});

	// ── Default Deny / Permission Matrix ─────────────────────────────

	describe('Default deny behavior preserved', () => {
		it('should still block unapproved human_required tool when audit passes', async () => {
			const def = makeDefinition({
				id: 'test.human_audited',
				riskLevel: 'write',
				approvalMode: 'human_required',
				requiresAuditLog: true,
			});

			registry.register(def, makeSuccessHandler());

			gateway.onAudit = async (_call: ToolCall): Promise<string> => {
				return 'evt-001';
			};

			// Note: onApprovalCheck NOT configured → Gate 6 blocks at human_required
			const result = await gateway.execute(makeCall({ toolId: 'test.human_audited' }));

			expect(result.success).toBe(false);
			// Must be blocked by APPROVAL_REQUIRED (Gate 6), not AUDIT_LOG_MISSING
			expect(result.blockedReason).toContain(BLOCK_REASONS.APPROVAL_REQUIRED);
			expect(result.blockedReason).not.toContain(BLOCK_REASONS.AUDIT_LOG_MISSING);
		});

		it('should still block schema validation failures when audit is configured', async () => {
			const def = makeDefinition({
				id: 'test.schema_fail',
				riskLevel: 'write',
				requiresAuditLog: true,
				inputSchema: {
					type: 'object',
					properties: { name: { type: 'string' } },
					required: ['name'],
				},
			});

			registry.register(def, makeSuccessHandler());

			gateway.onAudit = async (_call: ToolCall): Promise<string> => {
				return 'evt-should-not-reach';
			};

			// Call without required 'name' field
			const result = await gateway.execute(
				makeCall({
					toolId: 'test.schema_fail',
					arguments: {},
				}),
			);

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.SCHEMA_VALIDATION_FAILED);
			expect(result.blockedReason).not.toContain(BLOCK_REASONS.AUDIT_LOG_MISSING);
		});
	});

	// ── Audit Entry Safety ───────────────────────────────────────────

	describe('Audit entry safety', () => {
		it('should pass call context to audit callback for evidence creation', async () => {
			let capturedCall: ToolCall | null = null;

			const def = makeDefinition({
				id: 'test.capture_call',
				riskLevel: 'write',
				requiresAuditLog: true,
			});

			registry.register(def, makeSuccessHandler());

			gateway.onAudit = async (call: ToolCall): Promise<string> => {
				capturedCall = call;
				return 'evt-captured-001';
			};

			await gateway.execute(
				makeCall({
					toolId: 'test.capture_call',
					runId: 'run-capture-42',
					phase: 'IMPLEMENT',
					autonomyLevel: 2,
				}),
			);

			expect(capturedCall).not.toBeNull();
			expect(capturedCall!.toolId).toBe('test.capture_call');
			expect(capturedCall!.runId).toBe('run-capture-42');
			// Audit callback receives the call — implementer must NOT log secrets from arguments
		});

		it('should not expose tool arguments in block reason when audit fails', async () => {
			const def = makeDefinition({
				id: 'test.secret_args',
				riskLevel: 'write',
				requiresAuditLog: true,
			});

			registry.register(def, makeSuccessHandler());

			gateway.onAudit = async (_call: ToolCall): Promise<string> => {
				throw new Error('Disk full');
			};

			const result = await gateway.execute(
				makeCall({
					toolId: 'test.secret_args',
					arguments: { apiKey: 'sk-secret-12345', password: 'hunter2' },
				}),
			);

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain('Disk full');
			// Block reason must NOT expose the secret arguments
			expect(result.blockedReason).not.toContain('sk-secret');
			expect(result.blockedReason).not.toContain('hunter2');
			expect(result.blockedReason).not.toContain('apiKey');
			expect(result.blockedReason).not.toContain('password');
		});
	});

	// ── No #246 GateType Enforcement ─────────────────────────────────

	describe('No GateType layer enforcement (#246 excluded)', () => {
		it('should not reference GateType layers in block reasons', async () => {
			const def = makeDefinition({
				id: 'test.no_gatetype',
				riskLevel: 'write',
				requiresAuditLog: true,
			});

			registry.register(def, makeSuccessHandler());

			const result = await gateway.execute(makeCall({ toolId: 'test.no_gatetype' }));

			expect(result.blockedReason).not.toContain('GATE_TYPE');
			expect(result.blockedReason).not.toContain('ADAPTER_SOURCE');
		});
	});

	// ── Evidence Event ID Propagation ────────────────────────────────

	describe('Evidence event ID handling', () => {
		it('should set evidenceEventId from pre-execution audit when onEvidence not configured', async () => {
			const def = makeDefinition({
				id: 'test.audit_only',
				riskLevel: 'write',
				requiresAuditLog: true,
			});

			registry.register(def, makeSuccessHandler());

			gateway.onAudit = async (_call: ToolCall): Promise<string> => {
				return 'evt-pre-audit-001';
			};
			// onEvidence NOT set

			const result = await gateway.execute(makeCall({ toolId: 'test.audit_only' }));

			expect(result.success).toBe(true);
			expect(result.evidenceEventId).toBe('evt-pre-audit-001');
		});

		it('should allow post-execution evidence to override pre-execution audit ID', async () => {
			const def = makeDefinition({
				id: 'test.both_evidence',
				riskLevel: 'write',
				requiresAuditLog: true,
			});

			registry.register(
				def,
				async (_c: ToolCall): Promise<ToolResult> => ({
					success: true,
					output: 'result data',
				}),
			);

			gateway.onAudit = async (_call: ToolCall): Promise<string> => {
				return 'evt-pre-audit';
			};

			gateway.onEvidence = async (
				_call: ToolCall,
				_result: { success: boolean; output: unknown; durationMs: number },
			): Promise<string> => {
				return 'evt-post-evidence';
			};

			const result = await gateway.execute(makeCall({ toolId: 'test.both_evidence' }));

			expect(result.success).toBe(true);
			// Post-execution evidence may override the pre-execution ID
			expect(result.evidenceEventId).toBe('evt-post-evidence');
		});
	});

	// ── Multiple Tools ───────────────────────────────────────────────

	describe('Mixed tool scenarios', () => {
		it('should allow tool without requiresAuditLog even when onAudit is configured', async () => {
			const def = makeDefinition({
				id: 'test.no_audit_required',
				riskLevel: 'read',
				// requiresAuditLog not set
			});

			let auditCalled = false;
			registry.register(def, makeSuccessHandler());

			gateway.onAudit = async (_call: ToolCall): Promise<string> => {
				auditCalled = true;
				return 'evt-should-not-call';
			};

			const result = await gateway.execute(makeCall({ toolId: 'test.no_audit_required' }));

			expect(result.success).toBe(true);
			// Audit callback should NOT be called for tools without requiresAuditLog
			expect(auditCalled).toBe(false);
		});

		it('should handle undefined requiresAuditLog same as false', async () => {
			const def = makeDefinition({
				id: 'test.undefined_audit',
				riskLevel: 'write',
				// requiresAuditLog explicitly not set (undefined)
			});

			registry.register(def, makeSuccessHandler());

			const result = await gateway.execute(makeCall({ toolId: 'test.undefined_audit' }));

			expect(result.success).toBe(true);
		});
	});
});
