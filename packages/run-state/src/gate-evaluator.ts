// Positron — Gate Evaluator Registry & Runtime Enforcement
//
// Issue #246: Enforce GateType Layers in Pipeline Loop
//
// Provides:
// - GateEvaluator registry (register/clear/has)
// - evaluateGates(): evaluate all required gates for a phase transition
// - tryTransitionWithGates(): gated transition that blocks on gate failure
// - PHASE_GATE_REQUIREMENTS: mapping of target phases to required gate types
//
// Security invariants:
// - Missing evaluator → blocking failure (never a silent pass)
// - Evaluator exception → blocking failure
// - Security gate failure cannot be overridden by human approval
// - Evidence-required gate blocks completion without evidence

import type {
	EventLevel,
	GateEvaluationContext,
	GateLayerResult,
	GateResult,
	GateType,
	Phase,
	TestReport,
} from '@positron/shared';
import type { RunState, TransitionResult } from './state-machine.js';
import { transition } from './state-machine.js';

// ─── Gate Runtime Mode ──────────────────────────────────────────────────────

/**
 * Expliziter Gate-Runtime-Modus.
 *
 * - 'fixture':    Alle Gates sind Fake-PASS (Test-/Dev-Modus)
 * - 'demo':       Wie fixture, mit expliziter Demo-Kennzeichnung in Events
 * - 'supervised': Echte Gates, Human Approval erforderlich für kritische Phasen
 * - 'real':       Volle Produktions-Gates, keine Fake-Evaluatoren
 *
 * Invariante G-1: Kein stiller Default auf Fake-PASS.
 */
export type GateRuntimeMode = 'fixture' | 'demo' | 'supervised' | 'real';

/**
 * Adapter-Modi zur Bestimmung des GateRuntimeMode.
 */
export interface AdapterModes {
	githubMode: 'fake' | 'real';
	workspaceMode: 'fake' | 'real';
	opencodeMode: 'fake' | 'real';
}

/**
 * Bestimmt den Gate-Runtime-Modus aus Adapter-Modi und Umgebungsvariablen.
 *
 * Priorität:
 * 1. POSITRON_GATE_MODE (explizite Überschreibung)
 * 2. Automatisch: 'supervised' wenn mindestens ein Adapter 'real' ist
 * 3. Default: 'fixture'
 */
export function resolveGateRuntimeMode(adapters: AdapterModes): GateRuntimeMode {
	// Explizite Konfiguration hat Vorrang
	const explicit = process.env.POSITRON_GATE_MODE as GateRuntimeMode | undefined;
	if (explicit && ['fixture', 'demo', 'supervised', 'real'].includes(explicit)) {
		return explicit;
	}

	// Mindestens ein Adapter ist real → supervised
	const anyReal =
		adapters.githubMode === 'real' ||
		adapters.workspaceMode === 'real' ||
		adapters.opencodeMode === 'real';

	return anyReal ? 'supervised' : 'fixture';
}

/**
 * Baut Gate-Evaluatoren basierend auf dem Runtime-Modus zusammen.
 *
 * - fixture/demo: Registriert Fake-PASS-Evaluatoren (explizit)
 * - supervised/real: Löscht vorhandene Evaluatoren und erwartet,
 *   dass echte Evaluatoren vor dem ersten Job registriert werden.
 *   Fehlende Evaluatoren führen zu STARTUP_BLOCKED via evaluateGates().
 *
 * Invariante G-2: Fake-Gates NUR in fixture/demo.
 * Invariante G-3: Fehlender Evaluator in supervised/real → blocking failure.
 */
export function assembleGateEvaluators(mode: GateRuntimeMode): void {
	clearGateEvaluators();

	if (mode === 'fixture' || mode === 'demo') {
		registerFakeGateEvaluators();
	}
	// supervised/real: No fake evaluators registered.
	// Real evaluators must be registered by the caller before the first job.
	// evaluateGates() will block on missing evaluators.
}

// ─── Pipeline Outcome Resolution ────────────────────────────────────────────

/**
 * Ergebnis der Implementierungs-Outcome-Resolution.
 *
 * - 'TEST':           Implementierung erfolgreich → nächste Phase TEST
 * - 'FAILED_BLOCKED': Implementierung blockiert → Pipeline-Stop
 * - 'RETRY':          Implementierung fehlgeschlagen → Fix-Loop (caller managed)
 */
export type ImplementationOutcome = 'TEST' | 'FAILED_BLOCKED' | 'RETRY';

/**
 * Ergebnis der Test-Outcome-Resolution.
 *
 * - 'VERIFY':         Tests bestanden → nächste Phase VERIFY
 * - 'FAILED_BLOCKED': Tests blockiert/fehlgeschlagen → Pipeline-Stop
 * - 'RETRY':          Tests fehlgeschlagen → Fix-Loop (caller managed)
 */
export type TestOutcome = 'VERIFY' | 'FAILED_BLOCKED' | 'RETRY';

/**
 * Löst das Pipeline-Ergebnis nach der IMPLEMENT-Phase auf.
 *
 * Invariante P-1: blocked → FAILED_BLOCKED (kein TEST, kein VERIFY, kein COMMIT)
 * Invariante P-2: failed  → RETRY (Fix-Loop im Caller, max 3 Versuche)
 *
 * @param status — Der Status des OpenCodeCommandResult
 * @returns ImplementationOutcome
 */
export function resolveImplementationOutcome(
	status: 'success' | 'blocked' | 'failed' | 'skipped',
): ImplementationOutcome {
	if (status === 'success') return 'TEST';
	if (status === 'blocked') return 'FAILED_BLOCKED';
	if (status === 'failed') return 'RETRY';
	// 'skipped': explicit decision to skip implementation → proceed
	return 'TEST';
}

/**
 * Löst das Pipeline-Ergebnis nach der TEST-Phase auf.
 *
 * Invariante P-3: failed  → RETRY (Fix-Loop im Caller, max 3 Versuche)
 * Invariante P-4: blocked → FAILED_BLOCKED
 * Invariante P-5: Kein Testkommando in supervised/real → FAILED_BLOCKED
 *
 * @param report    — Der TestReport
 * @param gateMode  — Aktueller GateRuntimeMode
 * @param hasCommands — Wurden Testkommandos erkannt?
 * @returns TestOutcome
 */
export function resolveTestOutcome(
	report: TestReport,
	gateMode: GateRuntimeMode,
	hasCommands: boolean,
): TestOutcome {
	// Keine Testkommandos: nur in fixture/demo erlaubt
	if (!hasCommands) {
		if (gateMode === 'fixture' || gateMode === 'demo') {
			return 'VERIFY';
		}
		return 'FAILED_BLOCKED';
	}

	// Explizite Status-Auswertung
	if (report.status === 'passed') return 'VERIFY';
	if (report.status === 'blocked') return 'FAILED_BLOCKED';
	if (report.status === 'failed') return 'RETRY';

	// Unbekannter Status → fail-closed
	return 'FAILED_BLOCKED';
}

// ─── Gate Evaluator Type ─────────────────────────────────────────────────────

/**
 * Eine Gate-Evaluator-Funktion: erhält Kontext, liefert GateResult.
 * Registriert via registerGateEvaluator().
 */
export type GateEvaluatorFn = (context: GateEvaluationContext) => GateResult;

// ─── Registry ────────────────────────────────────────────────────────────────

/** Module-level registry: GateType → Evaluator-Funktion */
const gateEvaluators = new Map<GateType, GateEvaluatorFn>();

/**
 * Registriert einen Gate-Evaluator für einen bestimmten GateType.
 * Überschreibt vorhandenen Evaluator für diesen Typ.
 */
export function registerGateEvaluator(gateType: GateType, fn: GateEvaluatorFn): void {
	gateEvaluators.set(gateType, fn);
}

/**
 * Löscht alle registrierten Gate-Evaluatoren.
 * Primär für Test-Isolation (beforeEach).
 */
export function clearGateEvaluators(): void {
	gateEvaluators.clear();
}

/**
 * Prüft, ob ein Evaluator für einen GateType registriert ist.
 */
export function hasGateEvaluator(gateType: GateType): boolean {
	return gateEvaluators.has(gateType);
}

/**
 * Gibt die Anzahl registrierter Evaluatoren zurück (für Tests).
 */
export function gateEvaluatorCount(): number {
	return gateEvaluators.size;
}

// ─── Gate Evaluation ─────────────────────────────────────────────────────────

/**
 * Wertet alle angeforderten Gates für eine Transition aus.
 *
 * @param gateTypes — Welche GateTypes sollen ausgewertet werden
 * @param context — Kontext für die Evaluatoren (Phase, RunId, etc.)
 * @returns GateLayerResult mit allen Einzelergebnissen
 */
export function evaluateGates(
	gateTypes: GateType[],
	context: GateEvaluationContext,
): GateLayerResult {
	const results: GateResult[] = [];

	for (const gateType of gateTypes) {
		const evaluator = gateEvaluators.get(gateType);

		if (!evaluator) {
			// Fehlender Evaluator → blockierender Fehler (kein Fake-PASS)
			results.push({
				gateType,
				passed: false,
				message: `No evaluator registered for gate type "${gateType}"`,
				blocking: true,
			});
			continue;
		}

		try {
			const result = evaluator(context);
			results.push(result);
		} catch (err) {
			// Evaluator-Exception → blockierender Fehler
			const msg = err instanceof Error ? err.message : String(err);
			results.push({
				gateType,
				passed: false,
				message: `Gate evaluator for "${gateType}" threw: ${msg}`,
				blocking: true,
			});
		}
	}

	const blockingFailures = results.filter((r) => !r.passed && r.blocking);
	const warnings = results.filter((r) => !r.passed && !r.blocking);
	const allPassed = blockingFailures.length === 0;

	const summaryParts: string[] = [];
	if (allPassed) {
		summaryParts.push(`All ${results.length} gate(s) passed`);
	} else {
		const failList = blockingFailures.map((f) => f.gateType).join(', ');
		summaryParts.push(`${blockingFailures.length}/${results.length} gate(s) failed: ${failList}`);
	}

	return {
		allPassed,
		results,
		blockingFailures,
		warnings,
		summary: summaryParts.join('. '),
	};
}

// ─── Phase Gate Requirements ─────────────────────────────────────────────────

/**
 * Issue #246: Mapping von Ziel-Phasen zu erforderlichen GateTypes.
 *
 * Diese Tabelle bestimmt, welche Gates vor einer Transition
 * in die jeweilige Phase ausgewertet werden müssen.
 *
 * NICHT gegatete Phasen (interne Übergänge) sind nicht aufgeführt.
 */
export const PHASE_GATE_REQUIREMENTS: Readonly<Partial<Record<Phase, readonly GateType[]>>> = {
	/** File-Write / Commit → pre_write + evidence_required */
	COMMIT: ['pre_write', 'evidence_required'] as const,
	/** PR-Erstellung → pre_pr + evidence_required */
	PR_CREATE: ['pre_pr', 'evidence_required'] as const,
	/** Merge → pre_merge + security + human_approval */
	MERGE: ['pre_merge', 'security', 'human_approval'] as const,
	/** Abschluss → evidence_required */
	DONE: ['evidence_required'] as const,
};

/**
 * Gibt die erforderlichen GateTypes für eine Ziel-Phase zurück.
 * Leeres Array = keine Gates erforderlich (raw transition OK).
 */
export function getRequiredGates(targetPhase: Phase): GateType[] {
	const gates = PHASE_GATE_REQUIREMENTS[targetPhase];
	return gates ? [...gates] : [];
}

/**
 * Prüft, ob eine Ziel-Phase Gate-Enforcement benötigt.
 */
export function phaseRequiresGates(targetPhase: Phase): boolean {
	return targetPhase in PHASE_GATE_REQUIREMENTS;
}

/**
 * Registriert Fake-PASS-Evaluatoren für alle GateTypes.
 * EXPLIZIT registriert — kein implizites Fake-PASS.
 * Wird im Fake/Dry-Run-Mode aufgerufen, damit bestehende Tests
 * und die Fake-Pipeline weiter funktionieren.
 *
 * Issue #246: Fake evaluators must be explicitly registered.
 * No implicit fake-PASS for missing evaluators.
 */
export function registerFakeGateEvaluators(): void {
	const fakePass = (gateType: GateType): GateResult => ({
		gateType,
		passed: true,
		message: `Fake: ${gateType} gate passed (explicit fake evaluator)`,
		blocking: false,
	});

	registerGateEvaluator('pre_run', () => fakePass('pre_run'));
	registerGateEvaluator('pre_write', () => fakePass('pre_write'));
	registerGateEvaluator('pre_push', () => fakePass('pre_push'));
	registerGateEvaluator('pre_pr', () => fakePass('pre_pr'));
	registerGateEvaluator('pre_merge', () => fakePass('pre_merge'));
	registerGateEvaluator('evidence_required', () => fakePass('evidence_required'));
	registerGateEvaluator('security', () => fakePass('security'));
	registerGateEvaluator('human_approval', () => fakePass('human_approval'));
}

// ─── Gated Transition ────────────────────────────────────────────────────────

/**
 * Ergebnis eines gegateten Transitions-Versuchs.
 * Erweitert TransitionResult um Gate-Informationen.
 */
export interface GatedTransitionResult extends TransitionResult {
	gateResult: GateLayerResult;
}

/**
 * Führt eine Transition NUR durch, wenn alle erforderlichen Gates passen.
 *
 * Security-Invariante:
 * - Security-Gate-Fail kann NICHT durch Human-Approval-Pass überschrieben werden
 * - Human-Approval-Fail führt zu definiertem Block (nicht Auto-Approval)
 * - Fehlender Evaluator = Block (kein Fake-PASS)
 *
 * @param run — Aktueller RunState
 * @param to — Ziel-Phase
 * @param message — Event-Message
 * @param context — GateEvaluationContext
 * @param level — Event-Level (default: INFO)
 * @param payload — Optionales Payload
 * @returns GatedTransitionResult
 */
export function tryTransitionWithGates(
	run: RunState,
	to: Phase,
	message: string,
	context: GateEvaluationContext,
	level: EventLevel = 'INFO',
	payload: Record<string, unknown> | null = null,
): GatedTransitionResult {
	const requiredGates = getRequiredGates(to);

	// Keine Gates erforderlich → raw transition (interner Übergang)
	if (requiredGates.length === 0) {
		const rawResult = transition(run, to, message, level, payload);
		const emptyGateResult: GateLayerResult = {
			allPassed: true,
			results: [],
			blockingFailures: [],
			warnings: [],
			summary: 'No gates required for this transition',
		};
		return { ...rawResult, gateResult: emptyGateResult };
	}

	// Gates auswerten
	const gateResult = evaluateGates(requiredGates, context);

	if (!gateResult.allPassed) {
		// ── Security-Invariante: Security-Fail kann nicht durch Human-Approval überschrieben werden ──
		const securityFailed = gateResult.blockingFailures.some((f) => f.gateType === 'security');
		const humanApprovalPassed =
			hasGateEvaluator('human_approval') &&
			gateResult.results.some((r) => r.gateType === 'human_approval' && r.passed);

		if (securityFailed) {
			// Security-Fail → immer blockiert, egal was human_approval sagt
			const failRun: RunState = {
				...run,
				lastError: `Security gate failed: ${gateResult.summary}`,
			};
			return {
				ok: false,
				run: failRun,
				event: {
					id: run.id, // placeholder, caller should store separately
					runId: run.id,
					phase: to,
					level: 'ERROR',
					message: `Gate blocked: ${gateResult.summary} [security failure cannot be overridden]`,
					payload: { gateResult, securityFailed: true },
					createdAt: new Date().toISOString(),
				},
				gateResult,
			};
		}

		if (humanApprovalPassed) {
			// Human-Approval passiert, aber andere Gates fehlgeschlagen → dennoch blockiert
			const failRun: RunState = {
				...run,
				lastError: `Gate(s) failed despite human approval: ${gateResult.summary}`,
			};
			return {
				ok: false,
				run: failRun,
				event: {
					id: run.id,
					runId: run.id,
					phase: to,
					level: 'ERROR',
					message: `Gate blocked: ${gateResult.summary} [human approval passed but other gates failed]`,
					payload: { gateResult, humanApprovalPassed: true },
					createdAt: new Date().toISOString(),
				},
				gateResult,
			};
		}

		// Human approval required but not passed → GATE_APPROVE oder definierter Block
		const humanApprovalRequired = requiredGates.includes('human_approval');
		if (humanApprovalRequired) {
			const approvalRun: RunState = {
				...run,
				phase: 'GATE_APPROVE',
				status: 'blocked',
				lastError: `Human approval required: ${gateResult.summary}`,
			};
			return {
				ok: false,
				run: approvalRun,
				event: {
					id: run.id,
					runId: run.id,
					phase: 'GATE_APPROVE',
					level: 'HUMAN',
					message: `Human approval required before ${to}: ${gateResult.summary}`,
					payload: { gateResult, requiredPhase: to },
					createdAt: new Date().toISOString(),
				},
				gateResult,
			};
		}

		// Andere Gate-Fehler → blockiert
		const blockedRun: RunState = {
			...run,
			lastError: `Gate(s) failed: ${gateResult.summary}`,
		};
		return {
			ok: false,
			run: blockedRun,
			event: {
				id: run.id,
				runId: run.id,
				phase: to,
				level: 'ERROR',
				message: `Gate blocked: ${gateResult.summary}`,
				payload: { gateResult },
				createdAt: new Date().toISOString(),
			},
			gateResult,
		};
	}

	// Alle Gates bestanden → Transition ausführen
	const rawResult = transition(run, to, message, level, payload);
	return { ...rawResult, gateResult };
}
