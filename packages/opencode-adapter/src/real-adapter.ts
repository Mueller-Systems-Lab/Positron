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
				reason: `opencode --version exited with code ${String(result.exitCode)}`,
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

		const args = ['run', '--command', commandName, '--format', 'json', contextMsg];

		try {
			const result = await runCommand('opencode', args, {
				cwd: input.workspacePath,
				timeout: 300_000, // 5 Minuten für Agent-Kommandos
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
			try {
				for (const line of result.stdout.split('\n')) {
					const parsed = JSON.parse(line);
					if (parsed.type === 'error' && parsed.error?.data?.message) {
						hasJsonError = true;
						errorMessage = parsed.error.data.message;
						break;
					}
				}
			} catch {
				/* ignore parse errors */
			}

			const isSuccess = result.exitCode === 0 && !hasJsonError;

			return {
				phase: this.mapPhase(phaseName),
				status: isSuccess ? 'success' : 'failed',
				command: `opencode ${args.join(' ')}`,
				args,
				cwd: input.workspacePath,
				exitCode: result.exitCode,
				durationMs: Date.now() - startTime,
				summary: isSuccess
					? `Command "${commandName}" phase "${phaseName}" completed (${extractedText ? extractedText.length + ' chars' : 'no text output'})`
					: `Command "${commandName}" phase "${phaseName}" failed: ${errorMessage ?? result.stderr.slice(0, 200)}`,
				stdoutPath: evidencePaths.stdoutPath,
				stderrPath: evidencePaths.stderrPath,
				blockedReason: !isSuccess ? (errorMessage ?? result.stderr.slice(0, 200)) : undefined,
			};
		} catch (err) {
			const errMsg = String(err);
			return {
				phase: this.mapPhase(phaseName),
				status: 'failed',
				command: `opencode ${args.join(' ')}`,
				args,
				cwd: input.workspacePath,
				exitCode: null,
				durationMs: Date.now() - startTime,
				summary: `Command "${commandName}" phase "${phaseName}" failed: ${errMsg.slice(0, 200)}`,
				blockedReason: errMsg,
			};
		}
	}

	/**
	 * Führt OpenCode für die IMPLEMENT-Phase aus (Code-Änderungen).
	 * Nutzt spec-driven-development mit Phase "implement".
	 */
	async runImplement(input: OpenCodeRunInput): Promise<OpenCodeCommandResult> {
		const startTime = Date.now();

		// Use spec-driven-development with "implement" phase
		return this.runSlashCommand('spec-driven-development', {
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
