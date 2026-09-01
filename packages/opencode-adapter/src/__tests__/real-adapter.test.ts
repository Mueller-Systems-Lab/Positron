// Positron — RealOpenCodeAdapter: Tests

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from '@positron/sandbox';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { RealOpenCodeAdapter } from '../real-adapter.js';

// Mock runCommand to avoid depending on real opencode CLI
vi.mock('@positron/sandbox', () => {
	class MockCommandTerminationError extends Error {
		terminationReason = 'ATTEMPT_DEADLINE_EXCEEDED';
		terminationAuthority = 'attempt';
	}

	return {
		CommandTerminationError: MockCommandTerminationError,
		runCommand: vi.fn(async (cmd: string, args: string[], _opts: unknown) => {
			if (args[0] === '--version') {
				return {
					exitCode: 0,
					stdout: '1.15.5\n',
					stderr: '',
					durationMs: 10,
					command: 'opencode --version',
				};
			}
			if (args[0] === 'run') {
				return {
					exitCode: 0,
					stdout:
						'{"type":"error","error":{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details.","ref":"err_test_boundary"}}}\n',
					stderr: '',
					durationMs: 50,
					command: `opencode ${args.join(' ')}`,
				};
			}
			return { exitCode: 0, stdout: '', stderr: '', durationMs: 10, command: cmd };
		}),
	};
});

describe('RealOpenCodeAdapter', () => {
	const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-test-'));
	const tmpEvidence = path.join(tmpWorkspace, '.positron', 'evidence', 'opencode');

	beforeEach(() => {
		fs.mkdirSync(tmpEvidence, { recursive: true });
		vi.clearAllMocks();
	});

	afterEach(() => {
		fs.rmSync(tmpWorkspace, { recursive: true, force: true });
	});

	test('healthCheck returns available when CLI is installed', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		const health = await adapter.healthCheck(tmpWorkspace);
		expect(health.available).toBe(true);
		expect(health.version).toBeTruthy();
		expect(health.commandPath).toBe('opencode');
	});

	test('runSlashCommand uses spec-driven-development with phaseName', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		const result = await adapter.runSlashCommand('spec-driven-development', {
			runId: 'test-run',
			workspacePath: tmpWorkspace,
			issueTitle: 'Test Issue',
			issueNumber: 42,
			phaseName: 'specify',
			model: 'openai/gpt-5.6-luna',
			agent: 'build',
		});

		expect(['blocked', 'failed']).toContain(result.status);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.cwd).toBe(tmpWorkspace);

		// Verify args contain spec-driven-development (the mock always returns failed)
		expect(result.status).toBe('failed');
		expect(result.command).toContain('spec-driven-development');
		expect(result.command).toContain(`--dir ${tmpWorkspace}`);
		expect(result.command).toContain('--model openai/gpt-5.6-luna');
		expect(result.command).toContain('--agent build');
		expect(result.command).not.toContain('--auto');
		expect(result.error).toEqual({
			name: 'UnknownError',
			message: 'Unexpected server error. Check server logs for details.',
			ref: 'err_test_boundary',
		});
	});

	test('passes supported auto mode only when the authorized caller enables it', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		const result = await adapter.runSlashCommand('speckit.specify', {
			runId: 'test-run',
			workspacePath: tmpWorkspace,
			issueTitle: 'Test Issue',
			model: 'openai/gpt-5.6-luna',
			agent: 'build',
			auto: true,
		});
		expect(result.command).toContain('--auto');
	});

	test('blocks instead of silently using a global model fallback', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		const previousModel = process.env.POSITRON_OPENCODE_MODEL;
		Reflect.deleteProperty(process.env, 'POSITRON_OPENCODE_MODEL');
		try {
			const result = await adapter.runSlashCommand('speckit.specify', {
				runId: 'test-run',
				workspacePath: tmpWorkspace,
				issueTitle: 'Test Issue',
			});
			expect(result.status).toBe('blocked');
			expect(result.blockedReason).toBe('MODEL_RESOLUTION_REQUIRED');
			expect(vi.mocked(runCommand)).toHaveBeenCalledTimes(1);
		} finally {
			if (previousModel === undefined)
				Reflect.deleteProperty(process.env, 'POSITRON_OPENCODE_MODEL');
			else process.env.POSITRON_OPENCODE_MODEL = previousModel;
		}
	});

	test('runImplement uses native speckit.implement command', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);

		// Create mock command file to satisfy the capability check
		const commandsDir = path.join(tmpWorkspace, '.opencode', 'commands');
		fs.mkdirSync(commandsDir, { recursive: true });
		fs.writeFileSync(path.join(commandsDir, 'speckit.implement.md'), '# implement');

		const result = await adapter.runImplement({
			runId: 'test-run',
			workspacePath: tmpWorkspace,
			issueTitle: 'Implement test feature',
			issueNumber: 99,
			autonomyLevel: 2,
		});

		// With mock runCommand, native command returns error
		expect(['blocked', 'failed']).toContain(result.status);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.cwd).toBe(tmpWorkspace);
	});

	test('runImplement blocks when speckit.implement command is missing', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		// No .opencode/commands/speckit.implement.md created

		const result = await adapter.runImplement({
			runId: 'test-run',
			workspacePath: tmpWorkspace,
			issueTitle: 'Implement test feature',
			issueNumber: 99,
			autonomyLevel: 2,
		});

		expect(result.status).toBe('blocked');
		expect(result.blockedReason).toContain('IMPLEMENT_COMMAND_UNAVAILABLE');
		expect(result.command).toContain('speckit.implement');
	});

	test('extractTextFromOutput parses text events from JSON lines', () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		const output = [
			'{"type":"step_start","part":{"id":"1"}}',
			'{"type":"text","part":{"text":"## Specification\\n\\nThis is the spec."}}',
			'{"type":"step_finish","part":{"id":"2"}}',
			'{"type":"text","part":{"text":"## Plan\\n\\nStep 1, Step 2."}}',
			'',
		].join('\n');

		const result = (adapter as any).extractTextFromOutput(output);
		expect(result).toContain('## Specification');
		expect(result).toContain('## Plan');
		expect(result).toContain('This is the spec.');
	});

	test('extractTextFromOutput returns undefined for no text events', () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		const output = [
			'{"type":"step_start","part":{"id":"1"}}',
			'{"type":"step_finish","part":{"id":"2"}}',
		].join('\n');

		const result = (adapter as any).extractTextFromOutput(output);
		expect(result).toBeUndefined();
	});

	test('extractTextFromOutput handles empty output', () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		expect((adapter as any).extractTextFromOutput('')).toBeUndefined();
		expect((adapter as any).extractTextFromOutput('{}')).toBeUndefined();
	});

	test('saveEvidence creates output files', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);

		// Access private saveEvidence via any cast for testing
		const result = (adapter as any).saveEvidence(
			'test-command',
			'stdout content',
			'stderr content',
		);

		expect(result.stdoutPath).toBeTruthy();
		expect(result.stderrPath).toBeTruthy();

		// Verify files were created
		expect(fs.existsSync(result.stdoutPath)).toBe(true);
		expect(fs.existsSync(result.stderrPath)).toBe(true);

		// Verify content
		const stdoutContent = fs.readFileSync(result.stdoutPath, 'utf-8');
		const stderrContent = fs.readFileSync(result.stderrPath, 'utf-8');
		expect(stdoutContent).toBe('stdout content');
		expect(stderrContent).toBe('stderr content');
	});

	test('saveEvidence handles empty output gracefully', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		const result = (adapter as any).saveEvidence('empty-command', '', '');

		// No stdout or stderr means no files written
		expect(result.stdoutPath).toBeUndefined();
		expect(result.stderrPath).toBeUndefined();
	});

	test('saveEvidence uses command-specific subdirectories', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		const r1 = (adapter as any).saveEvidence('specify', 'out1', 'err1');
		const r2 = (adapter as any).saveEvidence('implement', 'out2', 'err2');

		// Different commands should use different directories
		expect(r1.stdoutPath).toBeTruthy();
		expect(r2.stdoutPath).toBeTruthy();
		expect(path.dirname(r1.stdoutPath)).not.toBe(path.dirname(r2.stdoutPath));
	});
});

// ---------------------------------------------------------------------------
// Constructor edge case
// ---------------------------------------------------------------------------
describe('RealOpenCodeAdapter constructor edge cases', () => {
	test('constructor without evidenceDir uses default path', () => {
		// Create adapter without evidenceDir — tests the ?? fallback on line 21
		const adapter = new RealOpenCodeAdapter();
		expect(adapter).toBeDefined();
	});
});
describe('RealOpenCodeAdapter healthCheck edge cases', () => {
	let tmpWorkspace: string;

	beforeEach(() => {
		tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-test-'));
		vi.clearAllMocks();
	});

	afterEach(() => {
		fs.rmSync(tmpWorkspace, { recursive: true, force: true });
	});

	test('healthCheck returns unavailable when exitCode is non-zero', async () => {
		const adapter = new RealOpenCodeAdapter(path.join(os.tmpdir(), 'evidence'));
		vi.mocked(runCommand).mockResolvedValueOnce({
			exitCode: 1,
			stdout: '',
			stderr: 'CLI not found',
			durationMs: 5,
			command: 'opencode --version',
		} as any);
		const health = await adapter.healthCheck(tmpWorkspace);
		expect(health.available).toBe(false);
		expect(health.reason).toContain('exited with code 1');
	});

	test('healthCheck returns version "unknown" when stdout is empty', async () => {
		const adapter = new RealOpenCodeAdapter(path.join(os.tmpdir(), 'evidence'));
		vi.mocked(runCommand).mockResolvedValueOnce({
			exitCode: 0,
			stdout: '',
			stderr: '',
			durationMs: 5,
			command: 'opencode --version',
		} as any);
		const health = await adapter.healthCheck(tmpWorkspace);
		expect(health.available).toBe(true);
		expect(health.version).toBe('unknown');
	});

	test('healthCheck returns version "unknown" when stdout is whitespace only', async () => {
		const adapter = new RealOpenCodeAdapter(path.join(os.tmpdir(), 'evidence'));
		vi.mocked(runCommand).mockResolvedValueOnce({
			exitCode: 0,
			stdout: '   \n  \t',
			stderr: '',
			durationMs: 5,
			command: 'opencode --version',
		} as any);
		const health = await adapter.healthCheck(tmpWorkspace);
		expect(health.available).toBe(true);
		expect(health.version).toBe('unknown');
	});
});

// ---------------------------------------------------------------------------
// mapPhase edge cases
// ---------------------------------------------------------------------------
describe('RealOpenCodeAdapter mapPhase', () => {
	test('maps known phases correctly', () => {
		const adapter = new RealOpenCodeAdapter(path.join(os.tmpdir(), 'evidence'));
		expect((adapter as any).mapPhase('specify')).toBe('specify');
		expect((adapter as any).mapPhase('implement')).toBe('implement');
		expect((adapter as any).mapPhase('plan')).toBe('plan');
	});

	test('falls back to implement for unknown phase', () => {
		const adapter = new RealOpenCodeAdapter(path.join(os.tmpdir(), 'evidence'));
		expect((adapter as any).mapPhase('unknown-phase')).toBe('implement');
	});

	test('falls back to implement for empty phase', () => {
		const adapter = new RealOpenCodeAdapter(path.join(os.tmpdir(), 'evidence'));
		expect((adapter as any).mapPhase('')).toBe('implement');
	});
});

// ---------------------------------------------------------------------------
// saveEvidence edge cases
// ---------------------------------------------------------------------------
describe('RealOpenCodeAdapter saveEvidence edge cases', () => {
	test('returns empty object when mkdir fails (catch path)', () => {
		const adapter = new RealOpenCodeAdapter(path.join(os.tmpdir(), 'evidence'));
		// Create a file where the directory should be to cause mkdirSync to fail
		const conflictPath = path.join(os.tmpdir(), 'opencode-evidence-conflict-test');
		try {
			fs.writeFileSync(conflictPath, 'block');
			const adapterWithBadDir = new RealOpenCodeAdapter(conflictPath);
			const result = (adapterWithBadDir as any).saveEvidence('test', 'out', 'err');
			expect(result).toEqual({});
		} finally {
			try {
				fs.unlinkSync(conflictPath);
			} catch {
				/* ok */
			}
		}
	});
});

// ---------------------------------------------------------------------------
// runSlashCommand success path
// ---------------------------------------------------------------------------
describe('RealOpenCodeAdapter runSlashCommand success path', () => {
	let tmpWorkspace: string;
	let tmpEvidence: string;
	let previousModel: string | undefined;

	beforeEach(() => {
		tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-test-'));
		tmpEvidence = path.join(tmpWorkspace, '.positron', 'evidence', 'opencode');
		fs.mkdirSync(tmpEvidence, { recursive: true });
		previousModel = process.env.POSITRON_OPENCODE_MODEL;
		process.env.POSITRON_OPENCODE_MODEL = 'openai/gpt-5.6-luna';
		vi.clearAllMocks();
	});

	afterEach(() => {
		if (previousModel === undefined) Reflect.deleteProperty(process.env, 'POSITRON_OPENCODE_MODEL');
		else process.env.POSITRON_OPENCODE_MODEL = previousModel;
		fs.rmSync(tmpWorkspace, { recursive: true, force: true });
	});

	test('returns success when output has no JSON errors', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		vi.mocked(runCommand)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: '1.15.5\n',
				stderr: '',
				durationMs: 5,
				command: 'opencode --version',
			} as any)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout:
					'{"type":"text","part":{"text":"specification complete"}}\n{"type":"step_finish","part":{"id":"done"}}\n',
				stderr: '',
				durationMs: 50,
				command: 'opencode run --command spec-driven-development --format json "specify"',
			} as any);

		const result = await adapter.runSlashCommand('spec-driven-development', {
			runId: 'test-run',
			workspacePath: tmpWorkspace,
			issueTitle: 'Test Issue',
			issueNumber: 42,
			phaseName: 'specify',
		});

		expect(result.status).toBe('success');
		expect(result.summary).toContain('completed');
	});

	test('returns blocked when CLI is not available', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		vi.mocked(runCommand).mockResolvedValueOnce({
			exitCode: 1,
			stdout: '',
			stderr: 'CLI not found',
			durationMs: 5,
			command: 'opencode --version',
		} as any);

		const result = await adapter.runSlashCommand('any-command', {
			runId: 'test-run',
			workspacePath: tmpWorkspace,
			issueTitle: 'Test',
			issueNumber: 1,
			phaseName: 'test',
		});

		expect(result.status).toBe('blocked');
		expect(result.summary).toContain('not available');
	});

	test('healthCheck returns unavailable when runCommand throws', async () => {
		const adapter = new RealOpenCodeAdapter(path.join(os.tmpdir(), 'evidence'));
		vi.mocked(runCommand).mockRejectedValueOnce(new Error('Command not found'));
		const health = await adapter.healthCheck(tmpWorkspace);
		expect(health.available).toBe(false);
		expect(health.reason).toContain('not found');
	});

	test('runSlashCommand catch path when runCommand throws', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		vi.mocked(runCommand)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: '1.15.5\n',
				stderr: '',
				durationMs: 5,
				command: 'opencode --version',
			} as any)
			.mockRejectedValueOnce(new Error('Process crashed'));

		const result = await adapter.runSlashCommand('spec-driven-development', {
			runId: 'test-run',
			workspacePath: tmpWorkspace,
			issueTitle: 'Test',
			issueNumber: 1,
			phaseName: 'specify',
		});

		expect(result.status).toBe('failed');
	});

	test('runSlashCommand with issueBody provided (covers contextMsg truthy path)', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		vi.mocked(runCommand)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: '1.15.5\n',
				stderr: '',
				durationMs: 5,
				command: 'opencode --version',
			} as any)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: '{"type":"text","part":{"text":"done"}}\n',
				stderr: '',
				durationMs: 50,
				command: 'opencode run ...',
			} as any);

		const result = await adapter.runSlashCommand('spec-driven-development', {
			runId: 'test-run',
			workspacePath: tmpWorkspace,
			issueTitle: 'Test',
			issueNumber: 42,
			issueBody: 'This is the issue body describing the work to be done',
			phaseName: 'specify',
		});

		expect(result.status).toBe('success');
	});

	test('runSlashCommand with issueNumber undefined (covers ?? fallback)', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		vi.mocked(runCommand)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: '1.15.5\n',
				stderr: '',
				durationMs: 5,
				command: 'opencode --version',
			} as any)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: '{"type":"text","part":{"text":"done"}}\n',
				stderr: '',
				durationMs: 50,
				command: 'opencode run ...',
			} as any);

		const result = await adapter.runSlashCommand('spec-driven-development', {
			runId: 'test-run',
			workspacePath: tmpWorkspace,
			issueTitle: 'Test no number',
			issueBody: 'body text',
			phaseName: 'specify',
		});

		expect(result.status).toBe('success');
	});

	test('blockedReason is undefined when runSlashCommand succeeds', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		vi.mocked(runCommand)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: '1.15.5\n',
				stderr: '',
				durationMs: 5,
				command: 'opencode --version',
			} as any)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: '{"type":"text","part":{"text":"result"}}\n',
				stderr: '',
				durationMs: 50,
				command: 'opencode run ...',
			} as any);

		const result = await adapter.runSlashCommand('spec-driven-development', {
			runId: 'test-run',
			workspacePath: tmpWorkspace,
			issueTitle: 'Test',
			issueNumber: 1,
			phaseName: 'specify',
		});

		expect(result.status).toBe('success');
		expect(result.blockedReason).toBeUndefined();
	});

	test('healthCheck reason ?? fallback when available is false without reason', async () => {
		// Test that runSlashCommand handles health.reason being undefined
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		vi.mocked(runCommand).mockResolvedValueOnce({
			exitCode: 0,
			stdout: '',
			stderr: '',
			durationMs: 5,
			command: 'opencode --version',
		} as any);

		// healthCheck will return available:true with version "unknown" (empty stdout)
		// Then runSlashCommand should proceed normally
		vi.mocked(runCommand).mockResolvedValueOnce({
			exitCode: 0,
			stdout: '{"type":"text","part":{"text":"done"}}\n',
			stderr: '',
			durationMs: 50,
			command: 'opencode run ...',
		} as any);

		const result = await adapter.runSlashCommand('spec-driven-development', {
			runId: 'test-run',
			workspacePath: tmpWorkspace,
			issueTitle: 'Test',
			issueNumber: 1,
			phaseName: 'test',
		});

		expect(result.status).toBe('success');
	});

	test('runSlashCommand with issueNumber missing (covers ?? fallback on line 82)', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		vi.mocked(runCommand)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: '1.15.5\n',
				stderr: '',
				durationMs: 5,
				command: 'opencode --version',
			} as any)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: '{"type":"text","part":{"text":"result"}}\n',
				stderr: '',
				durationMs: 50,
				command: 'opencode run ...',
			} as any);

		// Not providing issueNumber at all
		const input: any = {
			runId: 'test-run',
			workspacePath: tmpWorkspace,
			issueTitle: 'Test no number at all',
			phaseName: 'specify',
		};
		const result = await adapter.runSlashCommand('spec-driven-development', input);
		expect(result.status).toBe('success');
	});

	test('runSlashCommand with no text extracted (covers "no text output" branch)', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		vi.mocked(runCommand)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: '1.15.5\n',
				stderr: '',
				durationMs: 5,
				command: 'opencode --version',
			} as any)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: '{"type":"step_start","part":{"id":"1"}}\n',
				stderr: '',
				durationMs: 50,
				command: 'opencode run ...',
			} as any);

		const result = await adapter.runSlashCommand('spec-driven-development', {
			runId: 'test-run',
			workspacePath: tmpWorkspace,
			issueTitle: 'Test',
			phaseName: 'specify',
		});
		// extractTextFromOutput returns undefined when no text events
		// summary should say "no text output"
		expect(result.status).toBe('success');
		expect(result.summary).toContain('no text output');
	});

	test('runSlashCommand covers health.reason ?? unknown fallback', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		// Mock healthCheck to return unavailable without a reason
		vi.spyOn(adapter as any, 'healthCheck').mockResolvedValueOnce({ available: false });
		const result = await adapter.runSlashCommand('any-command', {
			runId: 'test-run',
			workspacePath: tmpWorkspace,
			issueTitle: 'Test',
			issueNumber: 1,
			phaseName: 'test',
		});
		expect(result.status).toBe('blocked');
		expect(result.summary).toContain('unknown');
	});

	test('runSlashCommand without phaseName uses commandName fallback (line 61)', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		vi.mocked(runCommand)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: '1.15.5\n',
				stderr: '',
				durationMs: 5,
				command: 'opencode --version',
			} as any)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: '{"type":"text","part":{"text":"done"}}\n',
				stderr: '',
				durationMs: 50,
				command: 'opencode run ...',
			} as any);

		// Not providing phaseName — should use commandName as fallback
		const result = await adapter.runSlashCommand('spec-driven-development', {
			runId: 'test-run',
			workspacePath: tmpWorkspace,
			issueTitle: 'Test',
		} as any);
		expect(result.status).toBe('success');
	});

	test('runSlashCommand with non-zero exitCode and no JSON error (covers errorMessage ?? fallback)', async () => {
		const adapter = new RealOpenCodeAdapter(tmpEvidence);
		vi.mocked(runCommand)
			.mockResolvedValueOnce({
				exitCode: 0,
				stdout: '1.15.5\n',
				stderr: '',
				durationMs: 5,
				command: 'opencode --version',
			} as any)
			.mockResolvedValueOnce({
				exitCode: 1,
				stdout: '',
				stderr: 'Segmentation fault\n',
				durationMs: 50,
				command: 'opencode run ...',
			} as any);

		const result = await adapter.runSlashCommand('spec-driven-development', {
			runId: 'test-run',
			workspacePath: tmpWorkspace,
			issueTitle: 'Test',
			issueNumber: 1,
			phaseName: 'specify',
		});
		// exitCode !== 0 means isSuccess = false, and no JSON error means errorMessage is undefined
		expect(result.status).toBe('failed');
		// The summary should use stderr as fallback
		expect(result.summary).toContain('Segmentation fault');
	});
});
