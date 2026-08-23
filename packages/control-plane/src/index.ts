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
export { computeKpis, assertKpiInvariants, computeEvolutionKpis } from './kpis.js';
export {
	computeProfileKpis,
	LEGACY_PROFILE_GROUP,
	COST_PER_VERIFIED_SUCCESS_NOT_AVAILABLE,
} from './kpis.js';
export type { ProfileKpiGroup, ProfileKpiReport, EvolutionKpiReport } from './kpis.js';
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
	acquireWorkspaceLock,
	renewWorkspaceLock,
	isWorkspaceLockValid,
	releaseWorkspaceLock,
	recoverStaleWorkspaceLocks,
	getWorkspaceLock,
	assertWorkspaceMutationAuthority,
	canMutateWorkspace,
	resolveWorkspaceLockTtlMs,
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

// ─── P5.3 Two-Axis Failure Diagnosis & Evidence-Based Routing ───
export {
	DIAGNOSIS_POLICY_VERSION,
	ROUTING_POLICY_VERSION,
	DEFAULT_CAPABILITY_SAMPLE_THRESHOLD,
	DIAGNOSIS_REASON_EXECUTION_PROVIDER,
	DIAGNOSIS_REASON_EXECUTION_INFRA,
	DIAGNOSIS_REASON_EXECUTION_TIMEOUT,
	DIAGNOSIS_REASON_HARNESS_CONTEXT,
	DIAGNOSIS_REASON_HARNESS_TOOL,
	DIAGNOSIS_REASON_STRATEGY,
	DIAGNOSIS_REASON_CAPABILITY,
	DIAGNOSIS_REASON_UNKNOWN,
	DIAGNOSIS_REASON_SECURITY_BLOCK,
	ROUTING_REASON_EXECUTION,
	ROUTING_REASON_HARNESS,
	ROUTING_REASON_STRATEGY,
	ROUTING_REASON_CAPABILITY,
	ROUTING_REASON_UNKNOWN,
	ROUTING_REASON_INSUFFICIENT_EVIDENCE,
	ROUTING_REASON_SECURITY_BLOCK,
	diagnoseFailureDomain,
	evaluateCapabilityEvidence,
	decideRouting,
	buildFailureDiagnosis,
	buildRoutingDecision,
	collectAttemptChain,
	hasRealDelta,
	isFailureDomain,
	isRoutingAction,
	FAILURE_DOMAINS,
	ROUTING_ACTIONS,
} from './diagnosis.js';
export type {
	FailureDomain,
	RoutingAction,
	DiagnosisInput,
	DiagnosisResult,
	CapabilityEvidenceInput,
	CapabilityGateResult,
	RoutingInput,
	RoutingResult,
	FailureDiagnosisContract,
	RoutingDecisionContract,
} from './diagnosis.js';

// ─── P5.4 Harness Evolution Sandbox ───
export {
	TUNABLE_FIELDS,
	NON_TUNABLE_FIELDS,
	isTunableField,
	isNonTunableField,
	computeCandidateFingerprint,
	validateCandidate,
	buildCandidate,
	isValidTransition,
	CANDIDATE_TRANSITIONS,
	CANDIDATE_CANNOT_SELF_PROMOTE,
	MODEL_CANNOT_SELF_PROMOTE,
	CANDIDATE_INVALID,
	CANDIDATE_NON_TUNABLE_VIOLATION,
} from './harness-evolution.js';
export type { CandidateValidationResult, BuildCandidateInput } from './harness-evolution.js';
export {
	COMPUTE_MATCH_POLICY_VERSION,
	computeMatchedBudget,
	isComputeMatched,
	buildPartitionFingerprint,
	isHoldoutIsolated,
	checkLeakage,
	hasLeakage,
	MIN_SAMPLE_SIZE,
	DEFAULT_SAMPLE_THRESHOLD,
	evaluateResult,
	computeEvaluationFingerprint,
	buildEvaluation,
} from './evaluation.js';
export type {
	ComputeBudget,
	PartitionType,
	DatasetPartition,
	LeakageType,
	LeakageCheck,
	EvaluationResult,
	EvaluationInput,
	BuildEvaluationInput,
} from './evaluation.js';
export {
	KERNEL_AUTHORITY,
	isKernelAuthority,
	EVALUATOR_CANNOT_PROMOTE,
	HARD_GATES,
	PROMOTION_POLICY_VERSION,
	evaluatePromotionGate,
	computePromotionFingerprint,
	buildPromotionDecision,
} from './promotion.js';
export type {
	HardGate,
	GateResult,
	PromotionGateInput,
	PromotionGateOutput,
	BuildPromotionDecisionInput,
} from './promotion.js';
export {
	getProductionPointer,
	initProductionPointer,
	atomicPromotion,
	rollbackToPrevious,
	getProfileTransitions,
	PROMOTION_CONFLICT,
	PROMOTION_DUPLICATE_NOOP,
	ROLLBACK_NOT_PROVEN,
	KERNEL_CAPABILITY,
	isKernelCapability,
} from './production-pointer.js';
export type {
	ProductionPointer,
	ProfileTransition,
	AtomicPromotionInput,
	AtomicPromotionResult,
	RollbackResult,
} from './production-pointer.js';
export {
	runShadow,
	getShadowRuns,
	startCanary,
	checkCanaryKillSwitch,
	stopCanary,
	completeCanary,
	getCanaryRuns,
	isCanaryBounded,
	CANARY_BOUNDED,
	CANARY_KILL_SWITCH,
	CANARY_STOPPED,
} from './shadow.js';
export type { ShadowRun, ShadowResult, CanaryBounds, CanaryRun } from './shadow.js';
export { CONTROL_PLANE_SCHEMA_V10 } from './schema.js';
export {
	validateMigrationShape,
	getMigrationVersion,
	setMigrationVersion,
} from './schema.js';
export type {
	CandidateStatus,
	HarnessCandidateContract,
	HarnessEvaluationContract,
	HarnessPromotionDecisionContract,
	PromotionDecision,
} from './contracts.js';
export { CANDIDATE_STATUSES, isCandidateStatus, PROMOTION_DECISIONS } from './contracts.js';
