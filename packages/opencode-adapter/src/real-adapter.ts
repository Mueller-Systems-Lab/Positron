// Positron — Real OpenCode Adapter

import fs from 'node:fs';
import path from 'node:path';
import { runCommand } from '@positron/sandbox';
import type {
	OpenCodeAdapter,
	OpenCodeCommandResult,
	OpenCodeHealth,
	OpenCodeRunInput,
} from '@positron/shared';

/**
 * RealOpenCodeAdapter — führt echte OpenCode CLI-Kommandos aus.
 *
 * Quality-of-Life-Features:
 * - Speichert CLI-Output als Evidence-Dateien (stdout/stderr)
 * - Grapfulcher Fallback wenn CLI nicht installiert
 * - Timeout-Handling via runCommand
 */
export class RealOpenCodeAdapter implements OpenCodeAdapter {
	private evidenceDir: string;

	constructor(evidenceDir?: string) {
		// Default-Evidence-Pfad unter .positron/
		this.evidenceDir = evidenceDir ?? '.positron/evidence/opencode';
	}

	/**
	 * Prüft ob die OpenCode CLI verfügbar ist.
	 */
	async healthCheck(workspacePath: string): Promise<OpenCodeHealth> {
		try {
			const result = await runCommand('opencode', ['--version'], {
				cwd: workspacePath,
				timeout: 10_000,
			});

			if (result.exitCode === 0) {
				const version = result.stdout.trim();
				return {
					available: true,
					version: version || 'unknown',
					commandPath: 'opencode',
				};
			}

			return {
				available: false,
				reason: `opencode --version exited with code ${String(result.exitCode)}${result.stderr.trim() ? `: ${this.redact(result.stderr.trim())}` : ''}`,
			};
		} catch {
			return { available: false, reason: 'OpenCode CLI not found or not executable' };
		}
	}

	/**
	 * Führt einen opencode Command aus.
	 *
	 * Nutzt spec-driven-development als opencode Command.
	 * Der phaseName (z.B. "specify", "plan", "tasks") wird als message
	 * an den command übergeben.
	 *
	 * Beispiel: runSlashCommand('spec-driven-development', { phaseName: 'specify', ... })
	 * → opencode run --command spec-driven-development --format json "specify"
	 */
	async runSlashCommand(
		commandName: string,
		input: OpenCodeRunInput,
	): Promise<OpenCodeCommandResult> {
		const startTime = Date.now();
		const phaseName = input.phaseName ?? commandName;

		// Graceful fallback: CLI-Check vorab
		const health = await this.healthCheck(input.workspacePath);
		if (!health.available) {
			return {
				phase: this.mapPhase(phaseName),
				status: 'blocked',
				command: `opencode run --command ${commandName} "${phaseName}"`,
				args: [],
				cwd: input.workspacePath,
				exitCode: null,
				durationMs: 0,
				summary: `OpenCode CLI not available: ${health.reason ?? 'unknown'}`,
				blockedReason: health.reason,
			};
		}

		// Build message: phase name plus issue context
		let contextMsg = input.issueBody
			? `${phaseName}\n\nIssue #${input.issueNumber ?? '?'}: ${input.issueTitle}\n\n${input.issueBody.slice(0, 2000)}`
			: `${phaseName}\n\nIssue #${input.issueNumber ?? '?'}: ${input.issueTitle}`;

		// Include target repository context so the agent scopes to the correct repo
		if (input.repoOwner && input.repoName) {
			contextMsg = `Target repository: ${input.repoOwner}/${input.repoName}\n\n${contextMsg}`;
		}

		const resolvedModel = input.model ?? process.env.POSITRON_OPENCODE_MODEL;
		if (!resolvedModel) {
			return {
				phase: this.mapPhase(phaseName),
				status: 'blocked',
				command: 'opencode run',
				args: [],
				cwd: input.workspacePath,
				exitCode: null,
				durationMs: Date.now() - startTime,
				summary: 'OpenCode model resolution is required; no global fallback is permitted',
				blockedReason: 'MODEL_RESOLUTION_REQUIRED',
			};
		}

		const args = [
			'run',
			'--dir',
			input.workspacePath,
			'--model',
			resolvedModel,
			'--agent',
			input.agent ?? process.env.POSITRON_OPENCODE_AGENT ?? 'build',
			...(input.auto ? ['--auto'] : []),
			'--command',
			commandName,
			'--format',
			'json',
			contextMsg,
		];

		try {
			const result = await runCommand('opencode', args, {
				cwd: input.workspacePath,
				timeout: 300_000, // 5 Minuten für Agent-Kommandos
				// P4 (Slice B): AbortSignal → realer Child-Prozess wird bei
				// Cancel terminiert (graceful SIGTERM → forced SIGKILL).
				signal: input.signal,
			});

			// CLI-Output als Evidence-Dateien speichern
			const evidencePaths = this.saveEvidence(commandName, result.stdout, result.stderr);

			// Parse JSON-Lines für Text-Events (Artefakt-Extraktion)
			const extractedText = this.extractTextFromOutput(result.stdout);
			// Save extracted text as artifact if present
			let artifactFile: string | undefined;
			if (extractedText && input.workspacePath) {
				try {
					const artifactDir = path.join(input.workspacePath, '.positron', 'artifacts');
					fs.mkdirSync(artifactDir, { recursive: true });
					artifactFile = path.join(artifactDir, `${phaseName}.md`);
					fs.writeFileSync(artifactFile, extractedText, 'utf-8');
				} catch {
					/* artifact save is non-critical */
				}
			}

			// Prüfe auf JSON-Fehler im Output (opencode exit 0 auch bei Fehlern)
			let hasJsonError = false;
			let errorMessage: string | undefined;
			let errorEvidence: OpenCodeCommandResult['error'];
			for (const line of result.stdout.split('\n')) {
				try {
					const parsed = JSON.parse(line) as {
						type?: string;
						error?: {
							name?: unknown;
							data?: { message?: unknown; ref?: unknown; retryable?: unknown };
						};
					};
					if (parsed.type !== 'error' || !parsed.error) continue;
					hasJsonError = true;
					const data = parsed.error.data ?? {};
					errorMessage = typeof data.message === 'string' ? data.message : undefined;
					errorEvidence = {
						name: typeof parsed.error.name === 'string' ? parsed.error.name : undefined,
						message: this.redact(errorMessage),
						ref: typeof data.ref === 'string' ? data.ref : undefined,
						retryable: typeof data.retryable === 'boolean' ? data.retryable : undefined,
					};
					break;
				} catch {
					/* Ignore non-JSON output lines. */
				}
			}

			const isSuccess = result.exitCode === 0 && !hasJsonError;
			const safeFailure = this.redact(errorMessage ?? result.stderr.slice(0, 200));

			return {
				phase: this.mapPhase(phaseName),
				status: isSuccess ? 'success' : 'failed',
				command: `opencode ${args.join(' ')}`,
				args,
				cwd: input.workspacePath,
				exitCode: result.exitCode,
				durationMs: Date.now() - startTime,
				summary: isSuccess
					? `Command "${commandName}" phase "${phaseName}" completed (${extractedText ? `${extractedText.length} chars` : 'no text output'})`
					: `Command "${commandName}" phase "${phaseName}" failed: ${safeFailure ?? 'unknown error'}`,
				stdoutPath: evidencePaths.stdoutPath,
				stderrPath: evidencePaths.stderrPath,
				blockedReason: !isSuccess ? safeFailure : undefined,
				error: errorEvidence,
			};
		} catch (err) {
			const errMsg = String(err);
			const safeErrMsg = this.redact(errMsg)?.slice(0, 200) ?? 'unknown error';
			return {
				phase: this.mapPhase(phaseName),
				status: 'failed',
				command: `opencode ${args.join(' ')}`,
				args,
				cwd: input.workspacePath,
				exitCode: null,
				durationMs: Date.now() - startTime,
				summary: `Command "${commandName}" phase "${phaseName}" failed: ${safeErrMsg}`,
				blockedReason: safeErrMsg,
			};
		}
	}

	private redact(value: string | undefined): string | undefined {
		return value?.replace(
			/(bearer\s+|api[_-]?key\s*[=:]\s*|token\s*[=:]\s*)[^\s,;}]+/gi,
			'$1[REDACTED]',
		);
	}

	/**
	 * Führt OpenCode für die IMPLEMENT-Phase aus (Code-Änderungen).
	 * Nutzt den nativen Spec Kit implement command (speckit.implement)
	 * statt spec-driven-development, da letzteres nur Artifakte generiert
	 * aber keine Source-Code-Änderungen vornimmt.
	 */
	async runImplement(input: OpenCodeRunInput): Promise<OpenCodeCommandResult> {
		// P5.2: Enforce effective harness at adapter boundary (fail-closed, never widen)
		if (input.effectiveHarness) {
			const h = input.effectiveHarness;
			// Mutation check: if harness denies mutation, block implement
			if (h.effective_permissions.mutation === false) {
				return {
					phase: 'implement',
					status: 'blocked',
					command: 'opencode run --command speckit.implement',
					args: [],
					cwd: input.workspacePath,
					exitCode: null,
					durationMs: 0,
					summary: 'Blocked by effective harness: mutation not allowed',
					blockedReason: 'DENIED_BY_EFFECTIVE_HARNESS: mutation=false',
				};
			}
			// Tool check: if no tools allowed, block
			if (h.effective_tools.length === 0) {
				return {
					phase: 'implement',
					status: 'blocked',
					command: 'opencode run --command speckit.implement',
					args: [],
					cwd: input.workspacePath,
					exitCode: null,
					durationMs: 0,
					summary: 'Blocked by effective harness: no tools allowed',
					blockedReason: 'DENIED_BY_EFFECTIVE_HARNESS: no tools',
				};
			}
			// Timeout/max_steps are enforced via runCommand timeout (h.effective_timeout_ms)
			// Provider/model are already validated at compile time
		}
		// Verify native speckit.implement command is available
		if (input.workspacePath) {
			const cmdFile = path.join(
				input.workspacePath,
				'.opencode',
				'commands',
				'speckit.implement.md',
			);
			if (!fs.existsSync(cmdFile)) {
				return {
					phase: 'implement',
					status: 'blocked',
					command: 'opencode run --command speckit.implement',
					args: [],
					cwd: input.workspacePath,
					exitCode: null,
					durationMs: 0,
					summary:
						'Native speckit.implement command not available — run specify init --integration opencode first',
					blockedReason:
						'IMPLEMENT_COMMAND_UNAVAILABLE: .opencode/commands/speckit.implement.md missing',
				};
			}

			// Pre-run Spec Kit prerequisite scripts so native speckit commands
			// don't need bash permissions (which opencode auto-rejects).
			// This provides the FEATURE_DIR context that speckit.implement expects.
			let effectiveInput = input;
			try {
				const prereqScript = path.join(
					input.workspacePath,
					'.specify',
					'scripts',
					'bash',
					'check-prerequisites.sh',
				);
				if (fs.existsSync(prereqScript)) {
					const prereqResult = await runCommand(
						'bash',
						[prereqScript, '--json', '--require-tasks', '--include-tasks'],
						{ cwd: input.workspacePath, timeout: 15_000 },
					);

					if (prereqResult.exitCode === 0 && prereqResult.stdout) {
						try {
							const parsed = JSON.parse(prereqResult.stdout);
							if (parsed.FEATURE_DIR) {
								// Inject FEATURE_DIR into the context so speckit.implement
								// doesn't need to run the script itself
								effectiveInput = {
									...input,
									issueBody: input.issueBody
										? `${input.issueBody}\n\nFEATURE_DIR=${parsed.FEATURE_DIR}`
										: `FEATURE_DIR=${parsed.FEATURE_DIR}`,
								};
							}
						} catch {
							// Non-JSON output, skip injection
						}
					}
				}
			} catch {
				// Prerequisite check is best-effort; proceed with command anyway
			}

			return this.runSlashCommand('speckit.implement', {
				...effectiveInput,
				phaseName: 'implement',
			});
		}

		return this.runSlashCommand('speckit.implement', {
			...input,
			phaseName: 'implement',
		});
	}

	/**
	 * Extrahiert Text-Content aus opencode JSON-Lines Output.
	 * Durchsucht JSON-Lines nach type:"text" Events und extrahiert part.text.
	 */
	private extractTextFromOutput(stdout: string): string | undefined {
		const texts: string[] = [];
		try {
			for (const line of stdout.split('\n')) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					const parsed = JSON.parse(trimmed);
					if (parsed.type === 'text' && parsed.part?.text) {
						texts.push(parsed.part.text);
					}
				} catch {
					/* skip non-json lines */
				}
			}
		} catch {
			/* ignore */
		}
		return texts.length > 0 ? texts.join('\n\n') : undefined;
	}

	/**
	 * Speichert CLI-Output als Evidence-Dateien.
	 * Erzeugt .positron/evidence/opencode/<command>-stdout.txt und ...-stderr.txt
	 */
	private saveEvidence(
		command: string,
		stdout: string,
		stderr: string,
	): { stdoutPath?: string; stderrPath?: string } {
		try {
			const dir = path.join(this.evidenceDir, command.replace(/[^a-z0-9.-]/gi, '_'));
			fs.mkdirSync(dir, { recursive: true });
			const timestamp = Date.now();
			const stdoutPath = path.join(dir, `stdout-${timestamp}.txt`);
			const stderrPath = path.join(dir, `stderr-${timestamp}.txt`);
			if (stdout) fs.writeFileSync(stdoutPath, stdout, 'utf-8');
			if (stderr) fs.writeFileSync(stderrPath, stderr, 'utf-8');
			return {
				stdoutPath: stdout ? stdoutPath : undefined,
				stderrPath: stderr ? stderrPath : undefined,
			};
		} catch {
			// Evidence-Speicherung ist nicht kritisch — bei Fehler einfach überspringen
			return {};
		}
	}

	/**
	 * Mapped Phase-Namen auf OpenCodePhase.
	 */
	private mapPhase(phaseName: string): OpenCodeCommandResult['phase'] {
		const validPhases: OpenCodeCommandResult['phase'][] = [
			'health',
			'constitution',
			'specify',
			'clarify',
			'plan',
			'tasks',
			'analyze',
			'checklist',
			'implement',
		];
		if (validPhases.includes(phaseName as OpenCodeCommandResult['phase'])) {
			return phaseName as OpenCodeCommandResult['phase'];
		}
		return 'implement';
	}
}

export default RealOpenCodeAdapter;
