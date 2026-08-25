// Positron — GitHub Adapter Package: Zentrale Exporte

// --- Adapter Interfaces ---
export type { GitHubAdapter, ReadOnlyGitHubAdapter } from './adapter.js';
export type { GitHubClientOptions } from './client.js';
export { createGitHubClient, createSafeLogger } from './client.js';
export { commentMarker, writeComment } from './comments.js';
// --- Errors ---
export {
	GitHubAuthError,
	GitHubCapabilityError,
	GitHubError,
	GitHubIssuesDisabledError,
	GitHubNetworkError,
	GitHubNotFoundError,
	GitHubPermissionError,
	GitHubRateLimitError,
	GitHubSecondaryRateLimitError,
	GitHubUnknownError,
	GitHubValidationError,
} from './errors.js';
export { FakeGitHubAdapter } from './fake-adapter.js';
export type { PolledIssue, PollState } from './issues.js';
export { filterByLabel, isPullRequest, pollIssues } from './issues.js';
export { syncManagedLabels } from './labels.js';
// --- ReadOnly Capability Layer ---
export {
	createReadOnlyGitHubAdapter,
	ReadOnlyGitHubAdapterWrapper,
} from './readonly-adapter.js';
// --- Adapter Implementations ---
export { createRealGitHubAdapter, mapRequestError, RealGitHubAdapter } from './real-adapter.js';
export type {
	Stage2AuditSink,
	Stage2IssueCommentWriter,
	Stage2WriteHarnessConfig,
	Stage2WriteHarnessInput,
	Stage2WriteHarnessResult,
} from './stage2-runtime-write-harness.js';
// --- Stage 2 Runtime Write Harness ---
export {
	createStage2WriteHarness,
	Stage2RuntimeWriteHarness,
} from './stage2-runtime-write-harness.js';
export type {
	Stage2PreWritePreview,
	Stage2WriteAuditEvent,
	Stage2WriteOperation,
	Stage2WritePolicyResult,
	Stage2WriteSandboxConfig,
} from './stage2-write-sandbox-policy.js';
// --- Stage 2 Write-Sandbox Policy ---
export {
	createStage2SandboxPolicy,
	STAGE2_DEFAULT_CONFIG,
	STAGE2_PERMANENTLY_FORBIDDEN,
	Stage2WriteSandboxPolicy,
} from './stage2-write-sandbox-policy.js';
export type {
	Stage3ApprovalBinding,
	Stage3ApprovalBindingPreview,
	Stage3ApprovalValidationResult,
} from './stage3-approval-binding.js';
// --- Stage 3 Approval Binding ---
export {
	computeApprovalTextSha256,
	createApprovalBinding,
	createApprovalBindingPreview,
	createSyntheticApprovalBinding,
	generateApprovalText,
	isApprovalExpired,
	validateApprovalBinding,
} from './stage3-approval-binding.js';
export type {
	Stage3BaseDriftResult,
	Stage3BaseResolver,
	Stage3ResolvedBase,
} from './stage3-base-resolver.js';
// --- Stage 3 Base Resolver ---
export {
	checkBaseDrift,
	createFakeBaseResolver,
	Stage3BaseShaDriftError,
} from './stage3-base-resolver.js';
// --- Stage 3 Canonical Manifest ---
export {
	computeManifestSha256,
	sha256Bytes,
	sha256Utf8,
	utf8ByteLength,
} from './stage3-canonical-manifest.js';
export type {
	PostWriteVerificationInput,
	PostWriteVerificationResult,
	PreWriteVerificationInput,
	PreWriteVerificationResult,
	Stage3BranchReader,
	Stage3CommitReader,
	Stage3ContentReader,
	Stage3PullRequestReader,
	Stage3ReadOnlyVerifier,
	Stage3RepositoryReader,
} from './stage3-reader-verifier.js';
// --- Stage 3 Reader / Verifier ---
export {
	createFakeReadOnlyVerifier,
	verifyPostWrite,
	verifyPreWrite,
} from './stage3-reader-verifier.js';
export type { Stage3AllowedCapability } from './stage3-real-github-bridge.js';
// --- Stage 3 Real GitHub Bridge ---
// NOTE: createStage3RealGitHubBridge and Stage3GitHubTransport are INTERNAL.
// They are NOT exported from the package root to prevent direct write bypass.
// Only mock bridges and capability verification are publicly accessible.
export {
	createMockStage3Bridge,
	STAGE3_ALLOWED_CAPABILITIES,
	STAGE3_FORBIDDEN_CAPABILITIES,
	verifyBridgeCapabilities,
} from './stage3-real-github-bridge.js';
export type {
	Stage3AuditSink,
	Stage3BranchWriter,
	Stage3FileCommitWriter,
	Stage3HarnessConfig,
	Stage3HarnessInput,
	Stage3HarnessResult,
	Stage3PullRequestWriter,
} from './stage3-runtime-harness.js';
// --- Stage 3 Runtime Harness ---
export {
	createStage3Harness,
	Stage3RuntimeHarness,
} from './stage3-runtime-harness.js';
export type {
	Stage3RuntimeSafetyProbe,
	Stage3SafetySnapshot,
	Stage3SafetyValidation,
} from './stage3-runtime-safety-probe.js';
// --- Stage 3 Runtime Safety Probe ---
export {
	createEnvRuntimeSafetyProbe,
	createFakeRuntimeSafetyProbe,
	createSafeSnapshot,
	validateSafetySnapshot,
} from './stage3-runtime-safety-probe.js';
export type {
	Stage3FailedGate,
	Stage3PilotAuditEvent,
	Stage3PilotConfig,
	Stage3PilotPolicyResult,
	Stage3PreWritePreview,
	Stage3ProcessSafety,
	Stage3WriteOperation,
} from './stage3-supervised-pilot-policy.js';
// --- Stage 3 Supervised Pilot Policy ---
export {
	createStage3PilotPolicy,
	STAGE3_CANONICAL,
	STAGE3_DEFAULT_CONFIG,
	Stage3SupervisedPilotPolicy,
} from './stage3-supervised-pilot-policy.js';
export type {
	EvidenceItem,
	GitHubStatusSyncInput,
	GitHubStatusSyncResult,
	SafeLlmRunMetadata,
} from './sync-service.js';
// --- Sync Service ---
export { GitHubStatusSyncService } from './sync-service.js';
export {
	renderEvidenceSection,
	renderLlmMetadataSection,
	renderSyncAccepted,
	renderSyncBlocked,
	renderSyncDone,
	renderSyncFailed,
	renderSyncMerged,
	renderSyncPhaseUpdate,
	renderSyncPrCreated,
	renderSyncTestReport,
	syncMarker,
	truncateComment,
} from './sync-templates.js';
// --- Templates ---
export { renderAccepted, renderBlocked, renderDone, renderStatusUpdate } from './templates.js';
export type {
	ClaimOptions,
	CreatePROptions,
	GitHubCommentResult,
	GitHubIssueClaimResult,
	GitHubIssueComment,
	GitHubIssueRef,
	GitHubIssueSummary,
	GitHubPRFile,
	GitHubPullRequest,
	GitHubRepositorySummary,
	MergePROptions,
	MergePRResult,
	PRListOptions,
	RequestReviewersOptions,
	RequestReviewersResult,
} from './types.js';

// --- Stage 3 Octokit Transport ---
// NOTE: createStage3OctokitTransport and STAGE3_FORBIDDEN_OCTOKIT_ENDPOINTS are INTERNAL.
// They are NOT exported from the package root to prevent direct write bypass.
// verifyNoForbiddenEndpointsCalled is test-only and also not publicly exported.
// The transport is only constructable internally via the harness/bridge assembly chain.

export type { PhaseLabels } from './label-lifecycle.js';
// --- Label Lifecycle ---
export { getLabelsForPhase, LABEL_LIFECYCLE } from './label-lifecycle.js';
