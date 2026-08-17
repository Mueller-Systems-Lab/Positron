// Positron Control Plane — Zentrale Exporte

// ─── Versionierte Data Contracts + Validator ───
export {
	CONTRACT_IDS,
	isKnownContractId,
	getContractSchema,
	validateContract,
	FAILURE_CLASSES,
	isFailureClass,
	PLAN_DECISIONS,
} from './contracts.js';
export type {
	ContractId,
	ContractSchema,
	FieldConstraint,
	ContractValidationResult,
	FailureClass,
	PlanDecision,
	FindingSeverity,
	FindingConfidence,
	FindingCategory,
	VerificationCheckKind,
	VerificationCheck,
	VerificationContract,
	FindingContract,
	ReviewBatchContract,
	DecisionContract,
	PlanContract,
	SplitContract,
	BuildInputContract,
	BuildResultContract,
	RunEventContract,
} from './contracts.js';

// ─── Fingerprints ───
export { fingerprint, canonicalJson, semanticallyEqual } from './fingerprint.js';

// ─── DB-Schema (Migrationen auf bestehender SQLite-DB) ───
export { CONTROL_PLANE_SCHEMA_V1, applyControlPlaneMigrations } from './schema.js';

// ─── Job/Attempt/Decision/Transition Store ───
export {
	createId,
	nowIso,
	createJob,
	getJob,
	listJobs,
	updateJobState,
	createAttempt,
	getAttempt,
	listAttempts,
	listJobAttempts,
	completeAttempt,
	storeDecision,
	listDecisions,
	storeTransition,
	listTransitions,
} from './store.js';
export type {
	JobType,
	JobState,
	JobRecord,
	AttemptStatus,
	AttemptRecord,
	DecisionRecord,
	TransitionRecord,
} from './store.js';

// ─── Idempotency ───
export { IdempotencyRegistry, idempotencyKey } from './idempotency.js';
export type { IdempotencyState, IdempotencyEntry } from './idempotency.js';

// ─── Plan Gate ───
export { evaluatePlanGate, planGateBlocked, isPlanApproved } from './plan-gate.js';
export type { PlanGateVerdict, PlanGateResult } from './plan-gate.js';

// ─── Verification ───
export {
	buildVerificationContract,
	validateVerificationContract,
	repositoryCheck,
} from './verification.js';
export type { VerificationInput } from './verification.js';

// ─── Failure Classification ───
export { classifyFailure, failureSignatureFromChecks } from './failure.js';
export type { FailureSignal } from './failure.js';

// ─── Retry Policy ───
export { evaluateRetry, isIdenticalAttempt } from './retry-policy.js';
export type { RetryVerdict, RetryDecision, RetryContextInput } from './retry-policy.js';

// ─── Decision Policy ───
export { buildDecision, validateDecision, isDone } from './decision-policy.js';
export type { DecisionInput } from './decision-policy.js';

// ─── Split Policy ───
export { evaluateSplit, DEFAULT_SPLIT_LIMITS } from './split.js';
export type { SplitLimits, SplitVerdict, SplitDecision } from './split.js';

// ─── Durable Run Orchestration ───
export {
	runDurableRun,
	isJobCompleted,
	recoveryBoundary,
	workspaceFingerprint,
} from './durable-run.js';
export type {
	BuildWorker,
	VerificationTool,
	DurableRunDeps,
	DurableRunResult,
	DurableRunInput,
	IssueContract,
} from './durable-run.js';
