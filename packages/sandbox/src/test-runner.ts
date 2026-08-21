// Positron — Test Runner

import type { TestCommandExecutionResult, TestReport } from '@positron/shared';
import { runCommand } from './command-runner.js';
import type { DetectedTestCommand, TestCommandDetectionResult } from './detector.js';

/** Optionen für den Test-Runner */
export interface RunOptions {
	runId: string;
	workspacePath: string;
	commands: DetectedTestCommand[];
	mode: 'standard' | 'verbose' | 'ci';
	/** P4 (Slice B): AbortSignal — bei abort wird der Testprozess real terminiert */
	signal?: AbortSignal;
}

/**
 * TestRunner Klasse — führt Tests aus.
 */
export class TestRunner {
	async runDetectedCommands(options: RunOptions): Promise<TestReport> {
		return runDetectedCommandsImpl(options);
	}
}

/**
 * Führt Tests für alle erkannten Test-Kommandos aus.
 */
async function runDetectedCommandsImpl(options: RunOptions): Promise<TestReport> {
	const { workspacePath, commands, mode, signal } = options;
	const results: TestCommandExecutionResult[] = [];
	let passed = 0;
	let failed = 0;
	let totalDuration = 0;

	for (const cmd of commands) {
		if (signal?.aborted) {
			failed++;
			results.push({
				command: `${cmd.command} ${cmd.args.join(' ')}`,
				exitCode: null,
				stdout: '',
				stderr: 'cancelled',
				durationMs: 0,
			});
			continue;
		}
		const startTime = Date.now();
		try {
			const result = await runCommand(cmd.command, cmd.args, {
				cwd: workspacePath,
				timeout: 300_000, // 5 Minuten
				// P4 (Slice B): Cancellation terminiert den Testprozess real
				signal,
			});

			const duration = Date.now() - startTime;
			totalDuration += duration;

			results.push({
				command: `${cmd.command} ${cmd.args.join(' ')}`,
				exitCode: result.exitCode,
				stdout: result.stdout,
				stderr: result.stderr,
				durationMs: duration,
			});

			if (result.exitCode === 0) {
				passed++;
			} else {
				failed++;
			}
		} catch (err) {
			failed++;
			results.push({
				command: `${cmd.command} ${cmd.args.join(' ')}`,
				exitCode: null,
				stdout: '',
				stderr: String(err),
				durationMs: Date.now() - startTime,
			});
		}
	}

	const total = passed + failed;
	const status = total === 0 ? 'skipped' : failed === 0 ? 'passed' : 'failed';

	return {
		status,
		summary: `${passed}/${total} tests passed`,
		passed,
		failed,
		total,
		durationMs: totalDuration,
		details: results,
	};
}

/**
 * Führt ein einzelnes Test-Kommando aus.
 */
export async function runSingleCommand(
	command: string,
	args: string[],
	cwd: string,
): Promise<TestCommandExecutionResult> {
	const startTime = Date.now();
	try {
		const result = await runCommand(command, args, {
			cwd,
			timeout: 300_000,
		});

		return {
			command: `${command} ${args.join(' ')}`,
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
			durationMs: Date.now() - startTime,
		};
	} catch (err) {
		return {
			command: `${command} ${args.join(' ')}`,
			exitCode: null,
			stdout: '',
			stderr: String(err),
			durationMs: Date.now() - startTime,
		};
	}
}
