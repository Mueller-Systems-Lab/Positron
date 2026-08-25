// Positron — Run State Package: Zentrale Exporte

export {
	checkDatabase,
	closeDatabase,
	installShutdownHandlers,
	openDatabase,
	registerDatabase,
	resolveDatabasePath,
} from './db/connection.js';
export { DB_TIMEOUT_MS, POSITRON_DB_PATH } from './db/constants.js';
export { applyMigrations, SCHEMA_V1 } from './db/schema.js';
export type {
	AdapterModes,
	GatedTransitionResult,
	GateEvaluatorFn,
	GateRuntimeMode,
	ImplementationOutcome,
	TestOutcome,
} from './gate-evaluator.js';
// ─── Issue #246: GateType Layers Runtime Enforcement ───
export {
	assembleGateEvaluators,
	clearGateEvaluators,
	evaluateGates,
	gateEvaluatorCount,
	getRequiredGates,
	hasGateEvaluator,
	PHASE_GATE_REQUIREMENTS,
	phaseRequiresGates,
	registerFakeGateEvaluators,
	registerGateEvaluator,
	resolveGateRuntimeMode,
	resolveImplementationOutcome,
	resolveTestOutcome,
	tryTransitionWithGates,
} from './gate-evaluator.js';
export type {
	RunEventData,
	RunState,
	RunStore,
	TransitionResult,
	WorkspaceCleanupFn,
} from './state-machine.js';
export {
	canTransition,
	createRun,
	getWorkspaceCleanupFn,
	isFailurePhase,
	isTerminalPhase,
	markFailed,
	registerWorkspaceCleanup,
	resumeFromEvents,
	retry,
	runCleanup,
	transition,
	VALID_TRANSITIONS,
} from './state-machine.js';
