// Positron — Real SpecKit Adapter

import { runCommand } from '@positron/sandbox';
import type {
	SpecKitAdapter,
	SpecKitArtifactRef,
	SpecKitCommandResult,
	SpecKitHealth,
	SpecKitRunInput,
} from '@positron/shared';
import {
	SpecKitCommandFailedError,
	SpecKitCommandNotAllowedError,
	SpecKitNotInstalledError,
	SpecKitTimeoutError,
	SpecKitUnsupportedCommandError,
	SpecKitWorkspaceInvalidError,
} from '@positron/shared';
import { isPathSafe, scanWorkspace } from './artifact-scanner.js';

/**
 * RealSpecKitAdapter — führt echte Spec Kit CLI-Kommandos aus.
 *
 * Modi:
 * - detect-only: nur CLI-Erkennung und Artefakt-Detection
 * - artifact-only: nur Artefakt-Detection, keine Kommandos
 * - safe-cli: erlaubte CLI-Kommandos (version, check, init)
 */
export class RealSpecKitAdapter implements SpecKitAdapter {
	/**
	 * Prüft ob das `specify` CLI verfügbar ist.
	 * Führt `specify version` aus und parst die Ausgabe.
	 */
	async healthCheck(workspacePath: string): Promise<SpecKitHealth> {
		try {
			const result = await runCommand('specify', ['version'], {
				cwd: workspacePath,
				timeout: 10_000,
			});

			if (result.exitCode === 0) {
				const version = result.stdout.trim();
				return {
					available: true,
					version: version || 'unknown',
					commandPath: 'specify',
					supportsOpencode: version.includes('opencode') || version.includes('github'),
				};
			}

			return {
				available: false,
				reason: `specify version exited with code ${String(result.exitCode)}`,
			};
		} catch {
			return { available: false, reason: 'specify CLI not found or not executable' };
		}
	}

	/**
	 * Führt `specify init` im Workspace aus.
	 * Nur erlaubt in safe-cli Mode.
	 */
	async initialize(input: SpecKitRunInput): Promise<SpecKitCommandResult> {
		if (input.mode !== 'safe-cli') {
			throw new SpecKitCommandNotAllowedError('initialize is only allowed in safe-cli mode');
		}

		const startTime = Date.now();
		try {
			const result = await runCommand(
				'specify',
				['init', '--here', '--force', '--integration', input.aiAgent ?? 'generic'],
				{
					cwd: input.workspacePath,
					timeout: 60_000,
				},
			);

			return {
				phase: 'init',
				status: 'success',
				command: 'specify init',
				args: ['init', '--integration', input.aiAgent ?? 'generic'],
				cwd: input.workspacePath,
				exitCode: result.exitCode,
				durationMs: Date.now() - startTime,
				summary: 'Spec Kit initialized successfully',
				artifacts: scanWorkspace(input.workspacePath),
			};
		} catch (err) {
			return {
				phase: 'init',
				status: 'failed',
				command: 'specify init',
				args: ['init', '--integration', input.aiAgent ?? 'generic'],
				cwd: input.workspacePath,
				exitCode: null,
				durationMs: Date.now() - startTime,
				summary: `Initialization failed: ${String(err).slice(0, 200)}`,
				artifacts: [],
				blockedReason: String(err),
			};
		}
	}

	/**
	 * Erkennt vorhandene Spec Kit Artefakte ohne Kommandos auszuführen.
	 */
	async detectArtifacts(input: SpecKitRunInput): Promise<SpecKitArtifactRef[]> {
		return scanWorkspace(input.workspacePath);
	}

	/**
	 * SPECIFY-Phase: Agent Slash Command.
	 * In artifact-only: erkennt specs/<feature>/spec.md
	 * In safe-cli: BLOCKED (braucht Agent)
	 */
	async runSpecify(input: SpecKitRunInput): Promise<SpecKitCommandResult> {
		return this.agentSlashCommandResult('specify', input);
	}

	/**
	 * PLAN-Phase: Agent Slash Command.
	 */
	async runPlan(input: SpecKitRunInput): Promise<SpecKitCommandResult> {
		return this.agentSlashCommandResult('plan', input);
	}

	/**
	 * TASKS-Phase: Agent Slash Command.
	 */
	async runTasks(input: SpecKitRunInput): Promise<SpecKitCommandResult> {
		return this.agentSlashCommandResult('tasks', input);
	}

	/**
	 * ANALYZE-Phase: Agent Slash Command.
	 */
	async runAnalyze(input: SpecKitRunInput): Promise<SpecKitCommandResult> {
		return this.agentSlashCommandResult('analyze', input);
	}

	/**
	 * Erzeugt ein BLOCKED/SKIPPED Ergebnis für Agent Slash Commands.
	 */
	private agentSlashCommandResult(phase: string, input: SpecKitRunInput): SpecKitCommandResult {
		const artifacts = this.filterArtifactsForPhase(phase, scanWorkspace(input.workspacePath));

		if (input.mode === 'safe-cli') {
			return {
				phase: phase as SpecKitCommandResult['phase'],
				status: 'blocked',
				command: `specify ${phase}`,
				args: [phase],
				cwd: input.workspacePath,
				exitCode: null,
				durationMs: 0,
				summary: `Agent Slash Command (/${phase}) — not executable via CLI directly. Use opencode run --command speckit.${phase}`,
				artifacts,
				blockedReason: 'Agent Slash Command — use opencode run --command speckit.' + phase,
			};
		}

		return {
			phase: phase as SpecKitCommandResult['phase'],
			status: 'skipped',
			command: `specify ${phase}`,
			args: [phase],
			cwd: input.workspacePath,
			exitCode: null,
			durationMs: 0,
			summary: `Detected ${artifacts.length} artifact(s) for phase "${phase}"`,
			artifacts,
		};
	}

	/**
	 * Filtert Artefakte basierend auf der Phase.
	 */
	private filterArtifactsForPhase(
		phase: string,
		artifacts: SpecKitArtifactRef[],
	): SpecKitArtifactRef[] {
		const phaseKindMap: Record<string, SpecKitArtifactRef['kind'][]> = {
			specify: ['spec', 'research'],
			plan: ['plan', 'checklist', 'contract', 'data-model'],
			tasks: ['tasks'],
			analyze: ['spec', 'plan', 'tasks'],
		};

		const allowedKinds = phaseKindMap[phase];
		if (!allowedKinds) return artifacts;

		return artifacts.filter((a) => allowedKinds.includes(a.kind));
	}
}

export default RealSpecKitAdapter;
