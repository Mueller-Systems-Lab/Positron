// Positron — OpenCode Adapter Package: Zentrale Exporte

function isTestEnv(): boolean {
	return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

/**
 * Legacy-Stub: executeTasks simuliert die Task-Ausführung.
 *
 * @deprecated Use OpenCodeAdapter (Real/Fake) instead.
 *             This function only works in test mode. In production, it throws.
 */
export async function executeTasks(
	workspacePath?: string,
	tasks?: string[],
): Promise<{ success: boolean; completedTasks: string[]; errors: string[] }> {
	if (!isTestEnv()) {
		throw new Error('DEPRECATED: executeTasks is deprecated. Use OpenCodeAdapter instead.');
	}
	return {
		success: true,
		completedTasks: tasks ?? [],
		errors: [],
	};
}

export type {
	EvidenceReport,
	Fixture,
	FixtureAgentConfig,
} from './deterministic-fixture-agent.js';
export { DeterministicFixtureAgent } from './deterministic-fixture-agent.js';
export type {
	ActionPlan,
	DryRunAgentConfig,
} from './dry-run-agent.js';
export { OpenCodeDryRunAgent } from './dry-run-agent.js';
export {
	FAKE_OPENCODE_HEALTH_AVAILABLE,
	FAKE_OPENCODE_HEALTH_UNAVAILABLE,
	FakeOpenCodeAdapter,
} from './fake-adapter.js';
export { RealOpenCodeAdapter } from './real-adapter.js';
