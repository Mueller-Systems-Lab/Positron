// Audit Sink Unit Tests
// Issue #322 — Wire ToolGateway onAudit into runtime
//
// Tests:
// - Audit sink creation (success)
// - Audit entry format (safe metadata, no secrets)
// - Audit file write (JSONL append)
// - Fail-closed behavior (write failure blocks)
// - Integration with GatewayService (Gate 9)
// - Blocked audit entries
// - Evidence ID generation
// - Workspace path resolution

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry, AuditSinkOptions } from '../audit-sink.js';
import { createAuditSink, createBlockedAuditEntry, hashAuditEntry } from '../audit-sink.js';
import { GatewayService } from '../gateway.js';
import { ToolRegistry } from '../registry.js';
import type { ToolCall, ToolDefinition, ToolResult } from '../types.js';
import { BLOCK_REASONS } from '../types.js';

// ─── Test Helpers ────────────────────────────────────────────────────

function makeTempDir(): string {
	const dir = path.join(
		os.tmpdir(),
		`positron-audit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function makeToolDef(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
	return {
		id: 'test.audit_tool',
		title: 'Test Audit Tool',
		description: 'A test tool for audit sink testing',
		inputSchema: { type: 'object', properties: {}, required: [] },
		outputSchema: {},
		riskLevel: 'write',
		requiredAutonomyLevel: 1,
		approvalMode: 'none',
		allowedPhases: [],
		allowedWorkspaceRoots: [],
		egressPolicy: { allowedHosts: [], allowedPorts: [] },
		evidenceRequirements: {
			logArguments: false,
			logOutput: false,
			requireArtifact: false,
		},
		requiresAuditLog: true,
		...overrides,
	};
}

function makeCall(overrides: Partial<ToolCall> = {}): ToolCall {
	return {
		toolId: 'test.audit_tool',
		arguments: { file: '/tmp/workspace/test.txt' },
		runId: 'run-test-001',
		phase: 'IMPLEMENT',
		autonomyLevel: 2,
		workspaceRoot: '/tmp/workspace',
		...overrides,
	};
}

function makeSinkOptions(overrides: Partial<AuditSinkOptions> = {}): AuditSinkOptions {
	return {
		runId: 'run-test-001',
		source: 'server',
		...overrides,
	};
}

async function makeSuccessHandler(): Promise<ToolResult> {
	return { success: true, output: 'ok' };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('createAuditSink', () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = makeTempDir();
	});

	afterEach(() => {
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {
			/* cleanup best-effort */
		}
	});

	// ── Positive Tests ────────────────────────────────────────────────

	it('P1: should create an audit sink that returns an evidence ID', async () => {
		const options = makeSinkOptions({ workspacePath: tempDir });
		const onAudit = createAuditSink(options);
		const call = makeCall();

		const evidenceId = await onAudit(call);

		expect(evidenceId).toBeDefined();
		expect(evidenceId).toMatch(/^evt-/);
		expect(evidenceId.length).toBeGreaterThan(10);
	});

	it('P2: should write audit entry to JSONL file', async () => {
		const options = makeSinkOptions({ workspacePath: tempDir, runId: 'run-p2' });
		const onAudit = createAuditSink(options);
		const call = makeCall({ toolId: 'test.p2_tool' });

		await onAudit(call);

		// Find the audit file
		const files = fs.readdirSync(tempDir);
		const auditFile = files.find((f) => f.startsWith('audit-run-p2'));
		expect(auditFile).toBeDefined();

		const content = fs.readFileSync(path.join(tempDir, auditFile!), 'utf-8');
		const lines = content.trim().split('\n');
		expect(lines.length).toBe(1);

		const entry: AuditEntry = JSON.parse(lines[0]!);
		expect(entry.toolId).toBe('test.p2_tool');
		expect(entry.decision).toBe('ALLOW');
		expect(entry.requiresAuditLog).toBe(true);
		expect(entry.meta.source).toBe('server');
		expect(entry.meta.tool).toBe('test.p2_tool');
	});

	it('P3: audit entry should contain timestamp, runId, phase, toolId', async () => {
		const options = makeSinkOptions({ workspacePath: tempDir, runId: 'run-p3' });
		const onAudit = createAuditSink(options);
		const call = makeCall({ toolId: 'test.p3_tool', runId: 'run-p3-call', phase: 'TEST' });

		const evidenceId = await onAudit(call);

		const files = fs.readdirSync(tempDir);
		const auditFile = files.find((f) => f.startsWith('audit-run-p3'));
		const content = fs.readFileSync(path.join(tempDir, auditFile!), 'utf-8');
		const entry: AuditEntry = JSON.parse(content.trim());

		expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
		expect(entry.runId).toBe('run-p3-call');
		expect(entry.phase).toBe('TEST');
		expect(entry.toolId).toBe('test.p3_tool');
		expect(entry.evidenceId).toBe(evidenceId);
	});

	it('P4: should NOT include tool arguments in audit entry (no secrets)', async () => {
		const options = makeSinkOptions({ workspacePath: tempDir });
		const onAudit = createAuditSink(options);
		const call = makeCall({
			arguments: {
				token: 'secret-token-12345',
				password: 'super-secret',
				file: '/etc/passwd',
			},
		});

		await onAudit(call);

		const files = fs.readdirSync(tempDir);
		const auditFile = files.find((f) => f.startsWith('audit-run-test'));
		const content = fs.readFileSync(path.join(tempDir, auditFile!), 'utf-8');
		const entry = JSON.parse(content.trim());

		// The entry should NOT contain any argument data
		const entryStr = JSON.stringify(entry);
		expect(entryStr).not.toContain('secret-token-12345');
		expect(entryStr).not.toContain('super-secret');
		expect(entryStr).not.toContain('/etc/passwd');
	});

	it('P5: should append multiple audit entries to the same file', async () => {
		const options = makeSinkOptions({ workspacePath: tempDir, runId: 'run-p5' });
		const onAudit = createAuditSink(options);

		await onAudit(makeCall({ toolId: 'test.first' }));
		await onAudit(makeCall({ toolId: 'test.second' }));
		await onAudit(makeCall({ toolId: 'test.third' }));

		const files = fs.readdirSync(tempDir);
		const auditFile = files.find((f) => f.startsWith('audit-run-p5'));
		const content = fs.readFileSync(path.join(tempDir, auditFile!), 'utf-8');
		const lines = content.trim().split('\n');
		expect(lines.length).toBe(3);

		const entries = lines.map((l) => JSON.parse(l) as AuditEntry);
		expect(entries[0]!.toolId).toBe('test.first');
		expect(entries[1]!.toolId).toBe('test.second');
		expect(entries[2]!.toolId).toBe('test.third');
	});

	it('P6: should create audit directory if it does not exist', async () => {
		const nestedDir = path.join(tempDir, 'nested', 'audit', 'path');
		const options = makeSinkOptions({ workspacePath: nestedDir });
		const onAudit = createAuditSink(options);

		await onAudit(makeCall());

		// Directory should have been created
		expect(fs.existsSync(nestedDir)).toBe(true);
	});

	// ── Negative / Fail-Closed Tests ──────────────────────────────────

	it('N1: should throw when audit file cannot be written (read-only dir)', async () => {
		// Use an invalid/non-writable path to test fail-closed behavior
		// On all platforms: create a read-only directory where possible
		const readOnlyDir = path.join(tempDir, 'readonly');
		fs.mkdirSync(readOnlyDir, { recursive: true });

		if (process.platform === 'win32') {
			// On Windows: use a deeply invalid path to trigger failure
			// Write a file where the directory should be, then try to
			// write to a path under it (which would be inside a file)
			const fileBlock = path.join(tempDir, 'file-block');
			fs.writeFileSync(fileBlock, 'block');
			const options = makeSinkOptions({
				workspacePath: path.join(fileBlock, 'subdir'),
				runId: 'run-n1-win',
			});

			// createAuditSink should throw because mkdirSync cannot create
			// a directory where a file exists.
			expect(() => createAuditSink(options)).toThrow();
		} else {
			// On Unix: chmod the directory to read-only
			fs.chmodSync(readOnlyDir, 0o444);
			const options = makeSinkOptions({ workspacePath: readOnlyDir, runId: 'run-n1' });

			// Should throw when trying to create audit file in read-only dir
			const onAudit = createAuditSink(options);
			await expect(onAudit(makeCall())).rejects.toThrow(/Audit sink write failed/);
		}
	});

	// ── Integration with GatewayService ───────────────────────────────

	describe('GatewayService Integration', () => {
		let registry: ToolRegistry;
		let gateway: GatewayService;
		let tempDir2: string;

		beforeEach(() => {
			tempDir2 = makeTempDir();
			registry = new ToolRegistry();
			gateway = new GatewayService(registry, {
				enabled: true,
				enforcePathBoundaries: false,
			});
		});

		afterEach(() => {
			try {
				fs.rmSync(tempDir2, { recursive: true, force: true });
			} catch {
				/* cleanup */
			}
		});

		it('I1: gateway with audit sink should allow audited tool execution', async () => {
			const toolDef = makeToolDef({ id: 'test.audited_ok', requiresAuditLog: true });
			registry.register(toolDef, makeSuccessHandler);

			const options = makeSinkOptions({ workspacePath: tempDir2, source: 'server' });
			gateway.onAudit = createAuditSink(options);

			const result = await gateway.execute(makeCall({ toolId: 'test.audited_ok' }));

			expect(result.success).toBe(true);
			expect(result.blockedReason).toBeUndefined();
			expect(result.evidenceEventId).toMatch(/^evt-/);

			// Verify audit file was written
			const files = fs.readdirSync(tempDir2);
			expect(files.length).toBeGreaterThan(0);
		});

		it('I2: gateway should block audited tool when onAudit is not configured', async () => {
			const toolDef = makeToolDef({ id: 'test.no_audit_cb', requiresAuditLog: true });
			registry.register(toolDef, makeSuccessHandler);

			// onAudit is NOT set → Gate 9 should block
			const result = await gateway.execute(makeCall({ toolId: 'test.no_audit_cb' }));

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.AUDIT_LOG_MISSING);
		});

		it('I3: gateway should block when onAudit throws', async () => {
			const toolDef = makeToolDef({ id: 'test.audit_throws', requiresAuditLog: true });
			registry.register(toolDef, makeSuccessHandler);

			gateway.onAudit = async (_call: ToolCall): Promise<string> => {
				throw new Error('Simulated audit sink failure');
			};

			const result = await gateway.execute(makeCall({ toolId: 'test.audit_throws' }));

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.AUDIT_LOG_MISSING);
			expect(result.blockedReason).toContain('Simulated audit sink failure');
		});

		it('I4: handler should NOT be called when audit gate blocks', async () => {
			const toolDef = makeToolDef({ id: 'test.audit_block_handler', requiresAuditLog: true });
			let handlerCalled = false;
			registry.register(toolDef, async (_c: ToolCall): Promise<ToolResult> => {
				handlerCalled = true;
				return { success: true, output: 'should-not-reach' };
			});

			// No onAudit → Gate 9 blocks before handler
			const result = await gateway.execute(makeCall({ toolId: 'test.audit_block_handler' }));

			expect(result.success).toBe(false);
			expect(handlerCalled).toBe(false);
		});

		it('I5: non-audited tool should execute without audit when onAudit is set', async () => {
			const toolDef = makeToolDef({ id: 'test.no_audit', requiresAuditLog: false });
			let auditCalled = false;
			registry.register(toolDef, makeSuccessHandler);

			const options = makeSinkOptions({ workspacePath: tempDir2 });
			gateway.onAudit = createAuditSink(options);

			// Override onAudit to track calls (but the sink still needs to work)
			const originalOnAudit = gateway.onAudit;
			gateway.onAudit = async (call: ToolCall): Promise<string> => {
				auditCalled = true;
				return originalOnAudit!(call);
			};

			const result = await gateway.execute(makeCall({ toolId: 'test.no_audit' }));

			expect(result.success).toBe(true);
			// Audit should NOT be called for tools without requiresAuditLog
			expect(auditCalled).toBe(false);
		});

		it('I6: audit callback is called BEFORE tool execution (ordering)', async () => {
			const toolDef = makeToolDef({ id: 'test.ordering', requiresAuditLog: true });
			const callOrder: string[] = [];

			registry.register(toolDef, async (_c: ToolCall): Promise<ToolResult> => {
				callOrder.push('handler');
				return { success: true, output: 'ok' };
			});

			gateway.onAudit = async (_call: ToolCall): Promise<string> => {
				callOrder.push('audit');
				return 'evt-ordering-001';
			};

			await gateway.execute(makeCall({ toolId: 'test.ordering' }));

			expect(callOrder).toEqual(['audit', 'handler']);
		});

		it('I7: sealed/default-deny remains stronger — missing onAudit blocks even for read tools', async () => {
			const toolDef = makeToolDef({
				id: 'test.sealed_audited_read',
				riskLevel: 'read',
				requiresAuditLog: true,
			});
			registry.register(toolDef, makeSuccessHandler);

			// No onAudit → blocks even though it's a read tool
			const result = await gateway.execute(makeCall({ toolId: 'test.sealed_audited_read' }));

			expect(result.success).toBe(false);
			expect(result.blockedReason).toContain(BLOCK_REASONS.AUDIT_LOG_MISSING);
		});
	});
});

// ─── createBlockedAuditEntry ─────────────────────────────────────────

describe('createBlockedAuditEntry', () => {
	it('should create a BLOCK decision entry with reason', () => {
		const call = makeCall({ toolId: 'test.blocked_tool' });
		const options = makeSinkOptions();

		const entry = createBlockedAuditEntry(call, 'AUDIT_LOG_MISSING: no callback', options);

		expect(entry.decision).toBe('BLOCK');
		expect(entry.reason).toBe('AUDIT_LOG_MISSING: no callback');
		expect(entry.toolId).toBe('test.blocked_tool');
		expect(entry.meta.source).toBe('server');
	});

	it('should NOT contain tool arguments', () => {
		const call = makeCall({ arguments: { token: 'secret' } });
		const options = makeSinkOptions();

		const entry = createBlockedAuditEntry(call, 'Blocked', options);
		const entryStr = JSON.stringify(entry);

		expect(entryStr).not.toContain('secret');
		expect(entryStr).not.toContain('token');
	});
});

// ─── hashAuditEntry ──────────────────────────────────────────────────

describe('hashAuditEntry', () => {
	it('should produce a deterministic SHA-256 hash', () => {
		const entry: AuditEntry = {
			ts: '2026-01-01T00:00:00.000Z',
			runId: 'run-hash',
			phase: 'TEST',
			toolId: 'test.hash_tool',
			requiresAuditLog: true,
			decision: 'ALLOW',
			evidenceId: 'evt-hash-001',
			meta: { tool: 'test.hash_tool', source: 'server' },
		};

		const hash1 = hashAuditEntry(entry);
		const hash2 = hashAuditEntry({ ...entry }); // clone

		expect(hash1).toBe(hash2);
		expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
	});

	it('should produce different hashes for different entries', () => {
		const entry1: AuditEntry = {
			ts: '2026-01-01T00:00:00.000Z',
			runId: 'run-1',
			phase: 'TEST',
			toolId: 'test.tool_a',
			requiresAuditLog: true,
			decision: 'ALLOW',
			meta: { tool: 'test.tool_a', source: 'server' },
		};
		const entry2: AuditEntry = {
			...entry1,
			toolId: 'test.tool_b',
			meta: { tool: 'test.tool_b', source: 'server' },
		};

		expect(hashAuditEntry(entry1)).not.toBe(hashAuditEntry(entry2));
	});
});

// ─── Regression: Existing #245 tests compatibility ───────────────────

describe('Regression: #245 Audit Enforcement', () => {
	let registry: ToolRegistry;
	let gateway: GatewayService;

	beforeEach(() => {
		registry = new ToolRegistry();
		gateway = new GatewayService(registry, {
			enabled: true,
			enforcePathBoundaries: false,
		});
	});

	it('R1: requiresAuditLog blocks when onAudit is null (Gate 9)', async () => {
		const def = makeToolDef({ id: 'reg.audit_block', requiresAuditLog: true });
		registry.register(def, makeSuccessHandler);

		const result = await gateway.execute(makeCall({ toolId: 'reg.audit_block' }));

		expect(result.success).toBe(false);
		expect(result.blockedReason).toContain(BLOCK_REASONS.AUDIT_LOG_MISSING);
	});

	it('R2: requiresAuditLog allows when onAudit succeeds', async () => {
		const def = makeToolDef({ id: 'reg.audit_pass', requiresAuditLog: true });
		registry.register(def, makeSuccessHandler);

		gateway.onAudit = async (_call: ToolCall): Promise<string> => 'evt-reg-001';

		const result = await gateway.execute(makeCall({ toolId: 'reg.audit_pass' }));

		expect(result.success).toBe(true);
	});

	it('R3: no requiresAuditLog skips audit gate (not called)', async () => {
		const def = makeToolDef({ id: 'reg.no_audit', requiresAuditLog: false });
		let auditCalled = false;
		registry.register(def, makeSuccessHandler);

		gateway.onAudit = async (_call: ToolCall): Promise<string> => {
			auditCalled = true;
			return 'should-not-be-called';
		};

		const result = await gateway.execute(makeCall({ toolId: 'reg.no_audit' }));

		expect(result.success).toBe(true);
		expect(auditCalled).toBe(false);
	});

	it('R4: default gateway (enabled: false) blocks at Gate 1 before audit', async () => {
		const disabledGateway = new GatewayService(registry, {
			enabled: false,
			enforcePathBoundaries: false,
		});
		const def = makeToolDef({ id: 'reg.disabled_audit', requiresAuditLog: true });
		registry.register(def, makeSuccessHandler);

		disabledGateway.onAudit = async (_call: ToolCall): Promise<string> => 'should-not-be-called';

		const result = await disabledGateway.execute(makeCall({ toolId: 'reg.disabled_audit' }));

		expect(result.success).toBe(false);
		expect(result.blockedReason).toContain(BLOCK_REASONS.GATEWAY_DISABLED);
		expect(result.blockedReason).not.toContain(BLOCK_REASONS.AUDIT_LOG_MISSING);
	});
});
