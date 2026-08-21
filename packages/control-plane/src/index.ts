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
	ResearchBatchContract,
	ResearchResultEntry,
	ResearchResultStatus,
	DecisionContract,
	PlanContract,
	SplitContract,
	BuildInputContract,
	BuildResultContract,
	RunEventContract,
	HarnessProfileRefContract,
	ModelProvenanceStatus,
} from './contracts.js';

// ─── Fingerprints ───
export { fingerprint, canonicalJson, semanticallyEqual } from './fingerprint.js';

// ─── P5.1 Harness Profile Identity & Provenance ───
export {
	HARNESS_PROFILE_REF_CONTRACT,
	PROVENANCE_UNAVAILABLE,
	LEGACY_PROFILE_UNSPECIFIED,
	PROVENANCE_KNOWN,
	MODEL_PROVENANCE_STATUSES,
	UNKNOWN_CONTRACT,
	UNKNOWN_VERSION,
	INVALID_PROFILE_REF,
	INVALID_FINGERPRINT,
	HARNESS_RUNTIME_EXCLUDE_KEYS,
	HARNESS_SECRET_PATTERNS,
	computeEffectiveHarnessFingerprint,
	validateHarnessProfileRef,
	buildHarnessProfileRef,
	resolveHarnessProfileFromEnv,
	isLegacyHarnessAttempt,
	HarnessProfileValidationError,
	HarnessMetadataSecretError,
} from './harness-profile.js';
export type { HarnessProfileRefInput, HarnessProfileValidationResult } from './harness-profile.js';

// ─── P5.2 Static Model Profiles, Task Profiles & Profile Compiler ───
export {
	PROFILE_COMPILER_VERSION,
	KERNEL_POLICY_REF,
	UNKNOWN_PROFILE_DENIED,
	UNKNOWN_PROFILE_VERSION,
	PROFILE_INVALID,
	TOOL_NOT_ALLOWED,
	PROFILE_INCOMPATIBLE,
	DENIED_BY_KERNEL_POLICY,
	ADAPTER_CAPABILITY_MISMATCH,
	computeProfileFingerprint,
	validateModelProfile,
	validateTaskProfile,
	modelProfileSemantics,
	taskProfileSemantics,
	intersectPermissions,
	compileEffectiveHarness,
	resolveEffectiveHarnessFromEnv,
	buildTaskProfile,
	PLAN_TASK_PROFILE,
	BUILD_TASK_PROFILE,
	RESEARCH_TASK_PROFILE,
	REVIEW_TASK_PROFILE,
	DEFAULT_TASK_PROFILES,
	resolveProfileFromRegistry,
	ProfileCompilationError,
} from './profile-compiler.js';
export type { ProfileCompileInput } from './profile-compiler.js';
export { KERNEL_DEFAULT_PERMISSIONS } from './contracts.js';
export type { KernelPermissions, ProfileTaskType } from './contracts.js';

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
	claimAttempt,
	claimAttemptWithGeneration,
	renewAttemptLease,
	isAttemptLeaseValid,
	recoverStaleLeases,
	canTransitionAttempt,
	mapAttemptRow,
	bindHarnessProfileToAttempt,
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
export {
	DEFAULT_ATTEMPT_LEASE_TTL_MS,
	resolveAttemptLeaseTtlMs,
} from './store.js';

// ─── Execution Context Enforcement (P3) ───
export {
	EXECUTION_CONTEXT_REQUIRED,
	ExecutionContextRequiredError,
	assertExecutionContext,
	assertAttemptActive,
	hasExecutionContext,
} from './execution-context.js';
export type { ControlPlaneExecutionContext } from './execution-context.js';

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

// ─── Real Fan-out/Join Reviews ───
export { runParallelReviews, listReviewAttempts } from './review.js';
export type {
	ReviewKind,
	ReviewWorker,
	ParallelReviewResult,
	ParallelReviewOutcome,
} from './review.js';

// ─── Gemeinsame Parallelitäts-Primitive ───
export { assertRealParallelism, observedOverlapMs } from './parallelism.js';
export type { ParallelExecutionSlice, ParallelismVerdict } from './parallelism.js';

// ─── Real Fan-out/Join Research ───
export { runParallelResearch, evaluateResearchBarrier, listResearchAttempts } from './research.js';
export type {
	ResearchKind,
	ResearchWorker,
	ResearchWorkerOutput,
	ParallelResearchResult,
	ResearchBarrierStatus,
	ResearchBarrierDecision,
	ParallelResearchOutcome,
	ResearchRunOptions,
} from './research.js';

// ─── KPIs ───
export { computeKpis, assertKpiInvariants } from './kpis.js';
export {
	computeProfileKpis,
	LEGACY_PROFILE_GROUP,
	COST_PER_VERIFIED_SUCCESS_NOT_AVAILABLE,
} from './kpis.js';
export type { ProfileKpiGroup, ProfileKpiReport } from './kpis.js';
export type { KpiReport } from './kpis.js';

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
	PlanWorker,
	DurableRunDeps,
	DurableRunResult,
	DurableRunInput,
	IssueContract,
} from './durable-run.js';

// ─── Cancellation & Lease-Heartbeat (P3.5/P4) ───
export {
	createCancellationSource,
	terminateChildProcess,
	waitForProcessExit,
	withCancellableTimeout,
	CancellationError,
	startLeaseHeartbeat,
} from './cancellation.js';
export type {
	CancellationSource,
	CancellableTimeoutResult,
} from './cancellation.js';

// ─── P4: Deterministic Scheduler (Multi-Issue Scheduling) ───
export {
	enqueueItem,
	getQueueItem,
	listQueueItems,
	updateQueueItem,
	admitNext,
	dependencyStatus,
	markRunStarted,
	markRunFinished,
	cancelQueueItem,
	recoverSchedulerState,
	isRunLeaseAlive,
	schedulerCapacity,
	persistSchedulerEvent,
	listSchedulerEvents,
} from './scheduler.js';
export type {
	QueueItemRecord,
	SchedulerConfig,
	SchedulerEvent,
	EnqueueInput,
	AdmissionDecision,
} from './scheduler.js';
export {
	normalizePriority,
	queueDedupKey,
	QUEUE_PRIORITY_ORDER,
} from './queue-schema.js';
export type {
	QueueState,
	QueuePriority,
	SchedulerReasonCode,
} from './queue-schema.js';

// ─── P4 (Slice D): Persistenter Workspace Lock ───
export {
	DEFAULT_WORKSPACE_LOCK_TTL_MS,
	resolveWorkspaceLockTtlMs,
	acquireWorkspaceLock,
	renewWorkspaceLock,
	isWorkspaceLockValid,
	releaseWorkspaceLock,
	recoverStaleWorkspaceLocks,
	getWorkspaceLock,
} from './workspace-lock.js';
export type { WorkspaceLock } from './workspace-lock.js';

// ─── P4 (Slice E): Provider Capacity & Reservations ───
export {
	resolveProviderCapacity,
	activeProviderReservations,
	reserveProviderSlot,
	releaseProviderSlot,
	recoverStaleProviderSlots,
} from './provider-capacity.js';
export type { ProviderReservation } from './provider-capacity.js';
