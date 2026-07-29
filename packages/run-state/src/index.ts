// Positron — Run State Package: Zentrale Exporte

export {
	openDatabase,
	resolveDatabasePath,
	closeDatabase,
	registerDatabase,
	installShutdownHandlers,
	checkDatabase,
} from './db/connection.js';
export { POSITRON_DB_PATH, DB_TIMEOUT_MS } from './db/constants.js';
export { SCHEMA_V1, applyMigrations } from './db/schema.js';
export {
	VALID_TRANSITIONS,
	createRun,
	canTransition,
	transition,
	markFailed,
	retry,
	resumeFromEvents,
	isTerminalPhase,
	isFailurePhase,
	registerWorkspaceCleanup,
	runCleanup,
	getWorkspaceCleanupFn,
} from './state-machine.js';
export type {
	RunState,
	RunEventData,
	RunStore,
	TransitionResult,
	WorkspaceCleanupFn,
} from './state-machine.js';

// ─── Issue #246: GateType Layers Runtime Enforcement ───
export {
	registerGateEvaluator,
	clearGateEvaluators,
	hasGateEvaluator,
	gateEvaluatorCount,
	evaluateGates,
	tryTransitionWithGates,
	getRequiredGates,
	phaseRequiresGates,
	PHASE_GATE_REQUIREMENTS,
	registerFakeGateEvaluators,
	resolveGateRuntimeMode,
	assembleGateEvaluators,
	resolveImplementationOutcome,
	resolveTestOutcome,
} from './gate-evaluator.js';
export type {
	GateEvaluatorFn,
	GatedTransitionResult,
	GateRuntimeMode,
	AdapterModes,
	ImplementationOutcome,
	TestOutcome,
} from './gate-evaluator.js';
