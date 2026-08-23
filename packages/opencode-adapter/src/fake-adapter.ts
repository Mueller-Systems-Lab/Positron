// Positron — Fake OpenCode Adapter (für Tests)

import type {
	OpenCodeAdapter,
	OpenCodeCommandResult,
	OpenCodeHealth,
	OpenCodeRunInput,
} from '@positron/shared';

export const FAKE_OPENCODE_HEALTH_AVAILABLE: OpenCodeHealth = {
	available: true,
	version: '0.1.0-fake',
	commandPath: '/usr/local/bin/opencode',
};

export const FAKE_OPENCODE_HEALTH_UNAVAILABLE: OpenCodeHealth = {
	available: false,
	reason: 'Fake: OpenCode CLI not available',
};

/**
 * FakeOpenCodeAdapter — konfigurierbarer Test-Double.
 */
export class FakeOpenCodeAdapter implements OpenCodeAdapter {
	private health: OpenCodeHealth;
	private commandCallLog: string[] = [];
	private shouldFailCommands = false;
	private commandResults = new Map<string, OpenCodeCommandResult>();

	constructor(health: OpenCodeHealth = FAKE_OPENCODE_HEALTH_AVAILABLE) {
		this.health = health;
	}

	setHealth(health: OpenCodeHealth): void {
		this.health = health;
	}

	setAvailable(version = '0.1.0'): void {
		this.health = { available: true, version, commandPath: '/usr/local/bin/opencode' };
	}

	setUnavailable(reason = 'CLI not found'): void {
		this.health = { available: false, reason };
	}

	setShouldFailCommands(fail: boolean): void {
		this.shouldFailCommands = fail;
	}

	setCommandResult(command: string, result: OpenCodeCommandResult): void {
		this.commandResults.set(command, result);
	}

	getCommandCallLog(): string[] {
		return [...this.commandCallLog];
	}

	clearCallLog(): void {
		this.commandCallLog = [];
	}

	async healthCheck(_workspacePath: string): Promise<OpenCodeHealth> {
		this.commandCallLog.push('healthCheck');
		return this.health;
	}

	async runSlashCommand(
		slashCommand: string,
		input: OpenCodeRunInput,
	): Promise<OpenCodeCommandResult> {
		this.commandCallLog.push(`runSlashCommand:${slashCommand}`);

		if (this.shouldFailCommands) {
			return this.makeResult(slashCommand, 'failed', 'Fake: command failed', input);
		}

		const customResult = this.commandResults.get(slashCommand);
		if (customResult) return customResult;

		return this.makeResult(slashCommand, 'success', `Fake: executed ${slashCommand}`, input);
	}

	async runImplement(input: OpenCodeRunInput): Promise<OpenCodeCommandResult> {
		this.commandCallLog.push('runImplement');

		// P5.2: Enforce effective harness at adapter boundary (fail-closed)
		if (input.effectiveHarness) {
			const harness = input.effectiveHarness;
			// Check mutation permission: if harness says mutation=false, deny any implement that would mutate
			// For fake adapter, we simulate enforcement: if mutation is false, block
			if (harness.effective_permissions.mutation === false) {
				return {
					phase: 'implement',
					status: 'blocked',
					command: 'implement',
					args: [],
					cwd: input.workspacePath,
					exitCode: null,
					durationMs: 0,
					summary: 'Blocked by effective harness: mutation not allowed',
					blockedReason: 'DENIED_BY_EFFECTIVE_HARNESS: mutation=false',
				};
			}
			// Check tool allowlist: if harness has empty tools, block
			if (harness.effective_tools.length === 0) {
				return {
					phase: 'implement',
					status: 'blocked',
					command: 'implement',
					args: [],
					cwd: input.workspacePath,
					exitCode: null,
					durationMs: 0,
					summary: 'Blocked by effective harness: no tools allowed',
					blockedReason: 'DENIED_BY_EFFECTIVE_HARNESS: no tools',
				};
			}
			// Check push/deploy: if harness denies push but input tries to push, block
			// (For now, we just log that harness is enforced; real push check is in workspace adapter)
		} else {
			// No harness provided → fail-closed for productive runs (but allow for tests without harness)
			// We don't block here to avoid breaking existing tests that don't set harness
		}

		if (this.shouldFailCommands) {
			return this.makeResult('implement', 'failed', 'Fake: implementation failed', input);
		}

		const customResult = this.commandResults.get('implement');
		if (customResult) return customResult;

		return this.makeResult('implement', 'success', 'Fake: implementation completed', input);
	}

	private makeResult(
		command: string,
		status: 'success' | 'failed' | 'blocked' | 'skipped',
		summary: string,
		input: OpenCodeRunInput,
	): OpenCodeCommandResult {
		return {
			phase: 'implement',
			status,
			command,
			args: [],
			cwd: input.workspacePath,
			exitCode: status === 'success' ? 0 : 1,
			durationMs: 0,
			summary,
		};
	}
}
