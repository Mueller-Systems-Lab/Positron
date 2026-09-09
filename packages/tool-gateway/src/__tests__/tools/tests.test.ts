// Built-in Tool Tests: tests.*
// Issue #219 — T-011

import { describe, expect, it } from 'vitest';
import { testsDetectHandler, testsRunSelectedHandler } from '../../tools/tests.js';
import type { ToolCall } from '../../types.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function makeCall(overrides: Partial<ToolCall> = {}): ToolCall {
	return {
		toolId: 'tests.detect',
		arguments: {},
		runId: 'run-test',
		phase: 'TEST',
		autonomyLevel: 2,
		workspaceRoot: process.cwd(),
		...overrides,
	};
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('tests.detect', () => {
	it('should detect npm test scripts', async () => {
		const call = makeCall({ toolId: 'tests.detect' });

		const result = await testsDetectHandler(call);
		expect(result.success).toBe(true);

		const output = result.output as { commands: string[] };
		expect(Array.isArray(output.commands)).toBe(true);
		expect(output.commands.length).toBeGreaterThan(0);
	});

	it('should return at least a fallback command', async () => {
		// Use a temp directory without package.json
		const call = makeCall({
			toolId: 'tests.detect',
			workspaceRoot: '/tmp',
		});

		const result = await testsDetectHandler(call);
		expect(result.success).toBe(true);

		const output = result.output as { commands: string[] };
		expect(output.commands).toBeDefined();
	});
});

describe('tests.run_selected', () => {
	it('should reject command not in allowed prefixes', async () => {
		const call = makeCall({
			toolId: 'tests.run_selected',
			arguments: { command: 'rm -rf /' },
		});

		const result = await testsRunSelectedHandler(call);
		expect(result.success).toBe(false);
		expect(result.error).toContain('not in allowed');
	});

	it('should reject command with dangerous characters', async () => {
		const call = makeCall({
			toolId: 'tests.run_selected',
			arguments: { command: 'npm test && echo hacked' },
		});

		const result = await testsRunSelectedHandler(call);
		// Either blocked by prefix check (no "npm test &&" is not in list)
		// or by dangerous character check
		expect(result.success).toBe(false);
	});

	it('should reject command with pipe', async () => {
		const call = makeCall({
			toolId: 'tests.run_selected',
			arguments: { command: 'npm test | grep fail' },
		});

		const result = await testsRunSelectedHandler(call);
		expect(result.success).toBe(false);
	});

	it('should reject command with subshell', async () => {
		const call = makeCall({
			toolId: 'tests.run_selected',
			arguments: { command: 'npm test $(whoami)' },
		});

		const result = await testsRunSelectedHandler(call);
		// Either blocked by prefix check (doesn't start with "npm test ") or by char check
		expect(result.success).toBe(false);
	});

	it('should reject empty command', async () => {
		const call = makeCall({
			toolId: 'tests.run_selected',
			arguments: { command: '' },
		});

		const result = await testsRunSelectedHandler(call);
		expect(result.success).toBe(false);
	});

	it('should reject an absolute test path outside the workspace', async () => {
		const call = makeCall({
			toolId: 'tests.run_selected',
			arguments: { command: 'node --test /etc/hostname' },
		});

		const result = await testsRunSelectedHandler(call);
		expect(result.success).toBe(false);
		expect(result.blockedReason).toContain('not in allowed test prefixes');
	});
});
