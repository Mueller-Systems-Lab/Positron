// Positron — SpecKit Adapter Package: Zentrale Exporte

function isTestEnv(): boolean {
	return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

/**
 * Legacy-Stub: runSpecify erzeugt eine Fake-Spezifikation.
 *
 * @deprecated Use SpecKitAdapter (Real/Fake) instead.
 *             This function only works in test mode. In production, it throws.
 */
export async function runSpecify(workspacePath?: string, issueContext?: string): Promise<string> {
	if (!isTestEnv()) {
		throw new Error('DEPRECATED: runSpecify is deprecated. Use SpecKitAdapter instead.');
	}
	return [
		'# Specification (Stub)',
		`Generated at: ${new Date().toISOString()}`,
		`Workspace: ${workspacePath ?? 'N/A'}`,
		'## Context',
		issueContext ?? 'Issue #0 – Automatisierte Änderungen',
		'## Acceptance Criteria',
		'- [ ] Feature implementiert',
		'- [ ] Tests vorhanden und grün',
		'- [ ] Dokumentation aktualisiert',
		'- [ ] PR erstellt',
		'## Technical Notes',
		'- ⚠️ Diese Spezifikation wurde vom Legacy-Stub generiert',
		'- Für volle Funktionalität POSITRON_SPECKIT_MODE=real setzen',
	].join('\n');
}

/**
 * Legacy-Stub: runPlan erzeugt einen Fake-Implementierungsplan.
 *
 * @deprecated Use SpecKitAdapter (Real/Fake) instead.
 *             This function only works in test mode. In production, it throws.
 */
export async function runPlan(workspacePath?: string, spec?: string): Promise<string> {
	if (!isTestEnv()) {
		throw new Error('DEPRECATED: runPlan is deprecated. Use SpecKitAdapter instead.');
	}
	return [
		'# Implementation Plan (Stub)',
		`Generated at: ${new Date().toISOString()}`,
		`Workspace: ${workspacePath ?? 'N/A'}`,
		'## Steps',
		'1. Analyse der bestehenden Codebase und Identifikation der betroffenen Module',
		'2. Implementierung der geforderten Änderungen gemäß Spezifikation',
		'3. Erstellung von Unit-Tests und Integrationstests',
		'4. Durchführung eines manuellen oder automatisierten Reviews',
		'5. Erstellung des Pull Requests und Merge',
		'## Dependencies',
		'- Keine externen Abhängigkeiten für diesen Stub',
		'## Risiken',
		'- Gering – Standard-Änderungen mit Testabdeckung',
	].join('\n');
}

/**
 * Legacy-Stub: runTasks erzeugt Fake-Tasks.
 *
 * @deprecated Use SpecKitAdapter (Real/Fake) instead.
 *             This function only works in test mode. In production, it throws.
 */
export async function runTasks(workspacePath?: string, plan?: string): Promise<string[]> {
	if (!isTestEnv()) {
		throw new Error('DEPRECATED: runTasks is deprecated. Use SpecKitAdapter instead.');
	}
	return [
		'TASK-1: Codebase-Analyse für Issue #0',
		'TASK-2: Feature-Implementierung (Hauptlogik)',
		'TASK-3: Unit-Tests für die neue Funktionalität',
		'TASK-4: Integrationstests und End-to-End-Tests',
		'TASK-5: Code-Review und Bug-Fixes',
		'TASK-6: PR-Erstellung und Dokumentation',
	];
}

export { computeSha256, isPathSafe, scanWorkspace } from './artifact-scanner.js';
export {
	FAKE_HEALTH_AVAILABLE,
	FAKE_HEALTH_UNAVAILABLE,
	FakeSpecKitAdapter,
} from './fake-adapter.js';
export { RealSpecKitAdapter } from './real-adapter.js';
