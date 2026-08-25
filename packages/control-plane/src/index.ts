// Positron Control Plane — Zentrale Exporte

export type {
	CancellableTimeoutResult,
	CancellationSource,
} from './cancellation.js';
// ─── Cancellation & Lease-Heartbeat (P3.5/P4) ───
export {
	CancellationError,
	createCancellationSource,
	startLeaseHeartbeat,
	terminateChildProcess,
	waitForProcessExit,
	withCancellableTimeout,
} from './cancellation.js';
export type {
	BuildInputContract,
	BuildResultContract,
	CandidateStatus,
	ContractId,
	ContractSchema,
	ContractValidationResult,
	DecisionContract,
	FailureClass,
	FieldConstraint,
	FindingCategory,
	FindingConfidence,
	FindingContract,
	FindingSeverity,
	HarnessCandidateContract,
	HarnessEvaluationContract,
	HarnessProfileRefContract,
	HarnessPromotionDecisionContract,
	KernelPermissions,
	ModelProvenanceStatus,
	PlanContract,
	PlanDecision,
	ProfileTaskType,
	PromotionDecision,
	ResearchBatchContract,
	ResearchResultEntry,
	ResearchResultStatus,
	ReviewBatchContract,
	RunEventContract,
	SplitContract,
	VerificationCheck,
	VerificationCheckKind,
	VerificationContract,
} from './contracts.js';
// ─── Versionierte Data Contracts + Validator ───
export {
	CANDIDATE_STATUSES,
	CONTRACT_IDS,
	FAILURE_CLASSES,
	getContractSchema,
	isCandidateStatus,
	isFailureClass,
	isKnownContractId,
	KERNEL_DEFAULT_PERMISSIONS,
	PLAN_DECISIONS,
	PROMOTION_DECISIONS,
	validateContract,
} from './contracts.js';
export type { DecisionInput } from './decision-policy.js';
// ─── Decision Policy ───
export { buildDecision, isDone, validateDecision } from './decision-policy.js';
export type {
	CapabilityEvidenceInput,
	CapabilityGateResult,
	DiagnosisInput,
	DiagnosisResult,
	FailureDiagnosisContract,
	FailureDomain,
	RoutingAction,
	RoutingDecisionContract,
	RoutingInput,
	RoutingResult,
} from './diagnosis.js';
// ─── P5.3 Two-Axis Failure Diagnosis & Evidence-Based Routing ───
export {
	buildFailureDiagnosis,
	buildRoutingDecision,
	collectAttemptChain,
	DEFAULT_CAPABILITY_SAMPLE_THRESHOLD,
	DIAGNOSIS_POLICY_VERSION,
	DIAGNOSIS_REASON_CAPABILITY,
	DIAGNOSIS_REASON_EXECUTION_INFRA,
	DIAGNOSIS_REASON_EXECUTION_PROVIDER,
	DIAGNOSIS_REASON_EXECUTION_TIMEOUT,
	DIAGNOSIS_REASON_HARNESS_CONTEXT,
	DIAGNOSIS_REASON_HARNESS_TOOL,
	DIAGNOSIS_REASON_SECURITY_BLOCK,
	DIAGNOSIS_REASON_STRATEGY,
	DIAGNOSIS_REASON_UNKNOWN,
	decideRouting,
	diagnoseFailureDomain,
	evaluateCapabilityEvidence,
	FAILURE_DOMAINS,
	hasRealDelta,
	isFailureDomain,
	isRoutingAction,
	ROUTING_ACTIONS,
	ROUTING_POLICY_VERSION,
	ROUTING_REASON_CAPABILITY,
	ROUTING_REASON_EXECUTION,
	ROUTING_REASON_HARNESS,
	ROUTING_REASON_INSUFFICIENT_EVIDENCE,
	ROUTING_REASON_SECURITY_BLOCK,
	ROUTING_REASON_STRATEGY,
	ROUTING_REASON_UNKNOWN,
} from './diagnosis.js';
export type {
	BuildWorker,
	DurableRunDeps,
	DurableRunInput,
	DurableRunResult,
	IssueContract,
	PlanWorker,
	VerificationTool,
} from './durable-run.js';
// ─── Durable Run Orchestration ───
export {
	isJobCompleted,
	recoveryBoundary,
	runDurableRun,
	workspaceFingerprint,
} from './durable-run.js';
export type {
	BuildEvaluationInput,
	ComputeBudget,
	DatasetPartition,
	EvaluationInput,
	EvaluationResult,
	LeakageCheck,
	LeakageType,
	PartitionType,
} from './evaluation.js';
export {
	buildEvaluation,
	buildPartitionFingerprint,
	COMPUTE_MATCH_POLICY_VERSION,
	checkLeakage,
	computeEvaluationFingerprint,
	computeMatchedBudget,
	DEFAULT_SAMPLE_THRESHOLD,
	evaluateResult,
	hasLeakage,
	isComputeMatched,
	isHoldoutIsolated,
	MIN_SAMPLE_SIZE,
} from './evaluation.js';
export type { ControlPlaneExecutionContext } from './execution-context.js';
// ─── Execution Context Enforcement (P3) ───
export {
	assertAttemptActive,
	assertExecutionContext,
	EXECUTION_CONTEXT_REQUIRED,
	ExecutionContextRequiredError,
	hasExecutionContext,
} from './execution-context.js';
export type { FailureSignal } from './failure.js';
// ─── Failure Classification ───
export { classifyFailure, failureSignatureFromChecks } from './failure.js';
// ─── Fingerprints ───
export { canonicalJson, fingerprint, semanticallyEqual } from './fingerprint.js';
export type { BuildCandidateInput, CandidateValidationResult } from './harness-evolution.js';
// ─── P5.4 Harness Evolution Sandbox ───
export {
	buildCandidate,
	CANDIDATE_CANNOT_SELF_PROMOTE,
	CANDIDATE_INVALID,
	CANDIDATE_NON_TUNABLE_VIOLATION,
	CANDIDATE_TRANSITIONS,
	computeCandidateFingerprint,
	isNonTunableField,
	isTunableField,
	isValidTransition,
	MODEL_CANNOT_SELF_PROMOTE,
	NON_TUNABLE_FIELDS,
	TUNABLE_FIELDS,
	validateCandidate,
} from './harness-evolution.js';
export type { HarnessProfileRefInput, HarnessProfileValidationResult } from './harness-profile.js';
// ─── P5.1 Harness Profile Identity & Provenance ───
export {
	buildHarnessProfileRef,
	computeEffectiveHarnessFingerprint,
	HARNESS_PROFILE_REF_CONTRACT,
	HARNESS_RUNTIME_EXCLUDE_KEYS,
	HARNESS_SECRET_PATTERNS,
	HarnessMetadataSecretError,
	HarnessProfileValidationError,
	INVALID_FINGERPRINT,
	INVALID_PROFILE_REF,
	isLegacyHarnessAttempt,
	LEGACY_PROFILE_UNSPECIFIED,
	MODEL_PROVENANCE_STATUSES,
	PROVENANCE_KNOWN,
	PROVENANCE_UNAVAILABLE,
	resolveHarnessProfileFromEnv,
	UNKNOWN_CONTRACT,
	UNKNOWN_VERSION,
	validateHarnessProfileRef,
} from './harness-profile.js';
export type { IdempotencyEntry, IdempotencyState } from './idempotency.js';
// ─── Idempotency ───
export { IdempotencyRegistry, idempotencyKey } from './idempotency.js';
export type { EvolutionKpiReport, KpiReport, ProfileKpiGroup, ProfileKpiReport } from './kpis.js';
// ─── KPIs ───
export {
	assertKpiInvariants,
	COST_PER_VERIFIED_SUCCESS_NOT_AVAILABLE,
	computeEvolutionKpis,
	computeKpis,
	computeProfileKpis,
	LEGACY_PROFILE_GROUP,
} from './kpis.js';
export type { ParallelExecutionSlice, ParallelismVerdict } from './parallelism.js';
// ─── Gemeinsame Parallelitäts-Primitive ───
export { assertRealParallelism, observedOverlapMs } from './parallelism.js';
export type { PlanGateResult, PlanGateVerdict } from './plan-gate.js';
// ─── Plan Gate ───
export { evaluatePlanGate, isPlanApproved, planGateBlocked } from './plan-gate.js';
export type {
	AtomicPromotionInput,
	AtomicPromotionResult,
	ProductionPointer,
	ProfileTransition,
	RollbackResult,
} from './production-pointer.js';
export {
	atomicPromotion,
	getProductionPointer,
	getProfileTransitions,
	initProductionPointer,
	isKernelCapability,
	KERNEL_CAPABILITY,
	PROMOTION_CONFLICT,
	PROMOTION_DUPLICATE_NOOP,
	ROLLBACK_NOT_PROVEN,
	rollbackToPrevious,
} from './production-pointer.js';
export type { ProfileCompileInput } from './profile-compiler.js';
// ─── P5.2 Static Model Profiles, Task Profiles & Profile Compiler ───
export {
	ADAPTER_CAPABILITY_MISMATCH,
	BUILD_TASK_PROFILE,
	buildTaskProfile,
	compileEffectiveHarness,
	computeProfileFingerprint,
	DEFAULT_TASK_PROFILES,
	DENIED_BY_KERNEL_POLICY,
	intersectPermissions,
	KERNEL_POLICY_REF,
	modelProfileSemantics,
	PLAN_TASK_PROFILE,
	PROFILE_COMPILER_VERSION,
	PROFILE_INCOMPATIBLE,
	PROFILE_INVALID,
	ProfileCompilationError,
	RESEARCH_TASK_PROFILE,
	REVIEW_TASK_PROFILE,
	resolveEffectiveHarnessFromEnv,
	resolveProfileFromRegistry,
	TOOL_NOT_ALLOWED,
	taskProfileSemantics,
	UNKNOWN_PROFILE_DENIED,
	UNKNOWN_PROFILE_VERSION,
	validateModelProfile,
	validateTaskProfile,
} from './profile-compiler.js';
export type {
	BuildPromotionDecisionInput,
	GateResult,
	HardGate,
	PromotionGateInput,
	PromotionGateOutput,
} from './promotion.js';
export {
	buildPromotionDecision,
	computePromotionFingerprint,
	EVALUATOR_CANNOT_PROMOTE,
	evaluatePromotionGate,
	HARD_GATES,
	isKernelAuthority,
	KERNEL_AUTHORITY,
	PROMOTION_POLICY_VERSION,
} from './promotion.js';
export type { ProviderReservation } from './provider-capacity.js';
// ─── P4 (Slice E): Provider Capacity & Reservations ───
export {
	activeProviderReservations,
	recoverStaleProviderSlots,
	releaseProviderSlot,
	reserveProviderSlot,
	resolveProviderCapacity,
} from './provider-capacity.js';
export type {
	QueuePriority,
	QueueState,
	SchedulerReasonCode,
} from './queue-schema.js';
export {
	normalizePriority,
	QUEUE_PRIORITY_ORDER,
	queueDedupKey,
} from './queue-schema.js';
export type {
	ParallelResearchOutcome,
	ParallelResearchResult,
	ResearchBarrierDecision,
	ResearchBarrierStatus,
	ResearchKind,
	ResearchRunOptions,
	ResearchWorker,
	ResearchWorkerOutput,
} from './research.js';
// ─── Real Fan-out/Join Research ───
export { evaluateResearchBarrier, listResearchAttempts, runParallelResearch } from './research.js';
export type { RetryContextInput, RetryDecision, RetryVerdict } from './retry-policy.js';
// ─── Retry Policy ───
export { evaluateRetry, isIdenticalAttempt } from './retry-policy.js';
export type {
	ParallelReviewOutcome,
	ParallelReviewResult,
	ReviewKind,
	ReviewWorker,
} from './review.js';
// ─── Real Fan-out/Join Reviews ───
export { listReviewAttempts, runParallelReviews } from './review.js';
export type {
	AdmissionDecision,
	EnqueueInput,
	QueueItemRecord,
	SchedulerConfig,
	SchedulerEvent,
} from './scheduler.js';
// ─── P4: Deterministic Scheduler (Multi-Issue Scheduling) ───
export {
	admitNext,
	cancelQueueItem,
	dependencyStatus,
	enqueueItem,
	getQueueItem,
	isRunLeaseAlive,
	listQueueItems,
	listSchedulerEvents,
	markRunFinished,
	markRunStarted,
	persistSchedulerEvent,
	recoverSchedulerState,
	schedulerCapacity,
	updateQueueItem,
} from './scheduler.js';
// ─── DB-Schema (Migrationen auf bestehender SQLite-DB) ───
export {
	applyControlPlaneMigrations,
	CONTROL_PLANE_SCHEMA_V1,
	CONTROL_PLANE_SCHEMA_V10,
	getMigrationVersion,
	setMigrationVersion,
	validateMigrationShape,
} from './schema.js';
export type { CanaryBounds, CanaryRun, ShadowResult, ShadowRun } from './shadow.js';
export {
	CANARY_BOUNDED,
	CANARY_KILL_SWITCH,
	CANARY_STOPPED,
	checkCanaryKillSwitch,
	completeCanary,
	getCanaryRuns,
	getShadowRuns,
	isCanaryBounded,
	runShadow,
	startCanary,
	stopCanary,
} from './shadow.js';
export type { SplitDecision, SplitLimits, SplitVerdict } from './split.js';
// ─── Split Policy ───
export { DEFAULT_SPLIT_LIMITS, evaluateSplit } from './split.js';
export type {
	AttemptRecord,
	AttemptStatus,
	DecisionRecord,
	JobRecord,
	JobState,
	JobType,
	TransitionRecord,
} from './store.js';
// ─── Job/Attempt/Decision/Transition Store ───
export {
	bindHarnessProfileToAttempt,
	canTransitionAttempt,
	claimAttempt,
	claimAttemptWithGeneration,
	completeAttempt,
	createAttempt,
	createId,
	createJob,
	DEFAULT_ATTEMPT_LEASE_TTL_MS,
	getAttempt,
	getJob,
	isAttemptLeaseValid,
	listAttempts,
	listDecisions,
	listJobAttempts,
	listJobs,
	listTransitions,
	mapAttemptRow,
	nowIso,
	recoverStaleLeases,
	renewAttemptLease,
	resolveAttemptLeaseTtlMs,
	storeDecision,
	storeTransition,
	updateJobState,
} from './store.js';
export type { VerificationInput } from './verification.js';
// ─── Verification ───
export {
	buildVerificationContract,
	repositoryCheck,
	validateVerificationContract,
} from './verification.js';
export type { WorkspaceLock } from './workspace-lock.js';
// ─── P4 (Slice D): Persistenter Workspace Lock ───
export {
	acquireWorkspaceLock,
	assertWorkspaceMutationAuthority,
	canMutateWorkspace,
	getWorkspaceLock,
	isWorkspaceLockValid,
	recoverStaleWorkspaceLocks,
	releaseWorkspaceLock,
	renewWorkspaceLock,
	resolveWorkspaceLockTtlMs,
} from './workspace-lock.js';
