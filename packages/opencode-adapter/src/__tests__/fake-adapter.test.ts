// Positron — OpenCode Fake Adapter: Comprehensive branch coverage tests
// Covers: setHealth, setAvailable, setUnavailable, setCommandResult,
//         setShouldFailCommands, getCommandCallLog, clearCallLog,
//         healthCheck, runSlashCommand (success + fail paths), runImplement

import type { OpenCodeRunInput } from '@positron/shared';
import { beforeEach, describe, expect, test } from 'vitest';
import {
	FAKE_OPENCODE_HEALTH_AVAILABLE,
	FAKE_OPENCODE_HEALTH_UNAVAILABLE,
	FakeOpenCodeAdapter,
} from '../fake-adapter.js';

const makeInput = (overrides?: Partial<OpenCodeRunInput>): OpenCodeRunInput => ({
	workspacePath: '/tmp/test-ws',
	issueNumber: 42,
	issueTitle: 'Test Issue',
	issueBody: 'Test body',
	runId: 'run-test-123',
	...overrides,
});

// ---------------------------------------------------------------------------
// Constructor + Defaults
// ---------------------------------------------------------------------------
describe('FakeOpenCodeAdapter construction', () => {
	test('default constructor creates available adapter', async () => {
		const adapter = new FakeOpenCodeAdapter();
		const health = await adapter.healthCheck('/tmp/test');
		expect(health.available).toBe(true);
	});

	test('constructor accepts custom health', async () => {
		const adapter = new FakeOpenCodeAdapter(FAKE_OPENCODE_HEALTH_UNAVAILABLE);
		const health = await adapter.healthCheck('/tmp/test');
		expect(health.available).toBe(false);
		expect(health.reason).toBe('Fake: OpenCode CLI not available');
	});
});

// ---------------------------------------------------------------------------
// setHealth / setAvailable / setUnavailable
// ---------------------------------------------------------------------------
describe('setHealth', () => {
	test('setHealth updates health status', async () => {
		const adapter = new FakeOpenCodeAdapter();
		adapter.setHealth({ available: false, reason: 'custom reason' });
		const health = await adapter.healthCheck('/tmp/test');
		expect(health.available).toBe(false);
		expect(health.reason).toBe('custom reason');
	});
});

describe('setAvailable', () => {
	test('setAvailable sets adapter to available with default version', async () => {
		const adapter = new FakeOpenCodeAdapter(FAKE_OPENCODE_HEALTH_UNAVAILABLE);
		adapter.setAvailable();
		const health = await adapter.healthCheck('/tmp/test');
		expect(health.available).toBe(true);
		expect(health.version).toBe('0.1.0');
	});

	test('setAvailable accepts custom version', async () => {
		const adapter = new FakeOpenCodeAdapter();
		adapter.setAvailable('2.0.0-fake');
		const health = await adapter.healthCheck('/tmp/test');
		expect(health.available).toBe(true);
		expect(health.version).toBe('2.0.0-fake');
	});
});

describe('setUnavailable', () => {
	test('setUnavailable sets adapter to unavailable with default reason', async () => {
		const adapter = new FakeOpenCodeAdapter();
		adapter.setUnavailable();
		const health = await adapter.healthCheck('/tmp/test');
		expect(health.available).toBe(false);
		expect(health.reason).toBe('CLI not found');
	});

	test('setUnavailable accepts custom reason', async () => {
		const adapter = new FakeOpenCodeAdapter();
		adapter.setUnavailable('permission denied');
		const health = await adapter.healthCheck('/tmp/test');
		expect(health.reason).toBe('permission denied');
	});
});

// ---------------------------------------------------------------------------
// setShouldFailCommands
// ---------------------------------------------------------------------------
describe('setShouldFailCommands', () => {
	test('when true, runSlashCommand returns failed', async () => {
		const adapter = new FakeOpenCodeAdapter();
		adapter.setShouldFailCommands(true);
		const result = await adapter.runSlashCommand('any-command', makeInput());
		expect(result.status).toBe('failed');
		expect(result.summary).toContain('Fake: command failed');
	});

	test('when true, runImplement returns failed', async () => {
		const adapter = new FakeOpenCodeAdapter();
		adapter.setShouldFailCommands(true);
		const result = await adapter.runImplement(makeInput());
		expect(result.status).toBe('failed');
		expect(result.summary).toContain('Fake: implementation failed');
	});
});

// ---------------------------------------------------------------------------
// setCommandResult (custom results)
// ---------------------------------------------------------------------------
describe('setCommandResult', () => {
	test('returns custom result for specific command', async () => {
		const adapter = new FakeOpenCodeAdapter();
		adapter.setCommandResult('spec-driven-development', {
			phase: 'implement' as const,
			status: 'blocked' as const,
			command: 'spec-driven-development',
			args: [],
			cwd: '/tmp/ws',
			exitCode: 0,
			durationMs: 100,
			summary: 'Custom blocked result',
		});
		const result = await adapter.runSlashCommand('spec-driven-development', makeInput());
		expect(result.status).toBe('blocked');
		expect(result.summary).toBe('Custom blocked result');
	});

	test('falls through to default when no custom result set', async () => {
		const adapter = new FakeOpenCodeAdapter();
		const result = await adapter.runSlashCommand('unconfigured', makeInput());
		expect(result.status).toBe('success');
	});
});

// ---------------------------------------------------------------------------
// getCommandCallLog / clearCallLog
// ---------------------------------------------------------------------------
describe('command call log', () => {
	test('getCommandCallLog returns copy of log', async () => {
		const adapter = new FakeOpenCodeAdapter();
		await adapter.healthCheck('/tmp/test');
		await adapter.runSlashCommand('test', makeInput());
		const log = adapter.getCommandCallLog();
		expect(log).toContain('healthCheck');
		expect(log).toContain('runSlashCommand:test');
	});

	test('getCommandCallLog returns immutable copy', () => {
		const adapter = new FakeOpenCodeAdapter();
		const log = adapter.getCommandCallLog();
		log.push('mutated');
		const log2 = adapter.getCommandCallLog();
		expect(log2).not.toContain('mutated');
	});

	test('clearCallLog empties the log', async () => {
		const adapter = new FakeOpenCodeAdapter();
		await adapter.healthCheck('/tmp/test');
		adapter.clearCallLog();
		const log = adapter.getCommandCallLog();
		expect(log.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// runSlashCommand (default success path)
// ---------------------------------------------------------------------------
describe('runSlashCommand', () => {
	test('returns success for default state', async () => {
		const adapter = new FakeOpenCodeAdapter();
		const result = await adapter.runSlashCommand('some-command', makeInput());
		expect(result.status).toBe('success');
		expect(result.exitCode).toBe(0);
		expect(result.summary).toContain('Fake: executed some-command');
	});
});

// ---------------------------------------------------------------------------
// runImplement (covers custom result + default path)
// ---------------------------------------------------------------------------
describe('runImplement', () => {
	test('returns success when shouldFailCommands is false', async () => {
		const adapter = new FakeOpenCodeAdapter();
		const result = await adapter.runImplement(makeInput());
		expect(result.status).toBe('success');
		expect(result.summary).toContain('Fake: implementation completed');
	});

	test('returns custom result when setCommandResult is configured for implement', async () => {
		const adapter = new FakeOpenCodeAdapter();
		adapter.setCommandResult('implement', {
			phase: 'implement' as const,
			status: 'blocked' as const,
			command: 'implement',
			args: [],
			cwd: '/tmp/ws',
			exitCode: 0,
			durationMs: 100,
			summary: 'Custom implement blocked result',
		});
		const result = await adapter.runImplement(makeInput());
		expect(result.status).toBe('blocked');
		expect(result.summary).toBe('Custom implement blocked result');
	});

	test('blocks mutation denied by the effective harness', async () => {
		const adapter = new FakeOpenCodeAdapter();
		const result = await adapter.runImplement(
			makeInput({
				effectiveHarness: {
					fingerprint: 'harness',
					effective_permissions: {
						mutation: false,
						push: false,
						merge: false,
						deploy: false,
						secret_access: false,
					},
					effective_tools: ['filesystem.read'],
					effective_reasoning_mode: 'standard',
					effective_timeout_ms: 1000,
					effective_max_steps: 1,
					model_profile_ref: { id: 'model', version: '1', fingerprint: 'model' },
					task_profile_ref: { id: 'task', version: '1', fingerprint: 'task' },
				},
			}),
		);
		expect(result.status).toBe('blocked');
		expect(result.blockedReason).toContain('mutation=false');
	});

	test('blocks when the effective harness exposes no tools', async () => {
		const adapter = new FakeOpenCodeAdapter();
		const result = await adapter.runImplement(
			makeInput({
				effectiveHarness: {
					fingerprint: 'harness',
					effective_permissions: {
						mutation: true,
						push: false,
						merge: false,
						deploy: false,
						secret_access: false,
					},
					effective_tools: [],
					effective_reasoning_mode: 'standard',
					effective_timeout_ms: 1000,
					effective_max_steps: 1,
					model_profile_ref: { id: 'model', version: '1', fingerprint: 'model' },
					task_profile_ref: { id: 'task', version: '1', fingerprint: 'task' },
				},
			}),
		);
		expect(result.status).toBe('blocked');
		expect(result.blockedReason).toContain('no tools');
	});

	test('allows an effective harness with mutation and tools', async () => {
		const adapter = new FakeOpenCodeAdapter();
		const result = await adapter.runImplement(
			makeInput({
				effectiveHarness: {
					fingerprint: 'harness',
					effective_permissions: {
						mutation: true,
						push: false,
						merge: false,
						deploy: false,
						secret_access: false,
					},
					effective_tools: ['filesystem.write'],
					effective_reasoning_mode: 'standard',
					effective_timeout_ms: 1000,
					effective_max_steps: 1,
					model_profile_ref: { id: 'model', version: '1', fingerprint: 'model' },
					task_profile_ref: { id: 'task', version: '1', fingerprint: 'task' },
				},
			}),
		);
		expect(result.status).toBe('success');
	});
});
