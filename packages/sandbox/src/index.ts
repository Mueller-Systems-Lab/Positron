// Positron — Sandbox Package: Zentrale Exporte

// TestReport und TestCommandExecutionResult wurden nach @positron/shared konsolidiert (Issue #31)
// Re-export für Abwärtskompatibilität
export type { TestCommandExecutionResult, TestReport } from '@positron/shared';
export type {
	GitDiffSummary,
	GitStatusSummary,
	GitWorkspaceAdapter,
	GitWorkspaceRef,
	PreparedWorkspace,
	PrepareWorkspaceInput,
} from './adapter.js';
export type { CommandResult, RunCommandOptions } from './command-runner.js';
export {
	CommandTerminationError,
	GitCommandError,
	GitCommandFailedError,
	GitCommandPolicyError,
	runCommand,
	runCommandWithTimeout,
} from './command-runner.js';
export type { BranchGuardResult, CommitContext, PushPolicyResult } from './commit-policy.js';
export {
	ALLOWED_BRANCH_PATTERN,
	BLOCKED_PUSH_FLAGS,
	evaluatePushPolicy,
	generateCommitMessage,
	guardBranch,
	isValidPositronBranch,
	PROTECTED_BRANCHES,
} from './commit-policy.js';
export type {
	DetectedTestCommand,
	TestCommandDetectionResult,
	TestCommandKind,
	TestCommandStatus,
} from './detector.js';
export { TestCommandDetector } from './detector.js';
export type { FixtureChangeInput, FixtureChangeResult } from './dogfood-fixture.js';
export { applyDogfoodFixtureChange, hasFixtureChanges } from './dogfood-fixture.js';
export { FakeGitWorkspaceAdapter } from './fake-adapter.js';
export type { GateApproveInput, GateApproveResult, GateEvent } from './gate-approve.js';
export { gateApproveAction } from './gate-approve.js';
export {
	ALLOWED_OPENCODE_COMMANDS,
	ALLOWED_SLASH_COMMANDS,
	BLOCKED_OPENCODE_COMMANDS,
	OpenCodeCommandPolicyError,
	validateOpenCodeCommand,
} from './opencode-policy.js';
export {
	createPositronBranchName,
	createWorkspacePath,
	GitRemoteInvalidError,
	GitWorkspacePathError,
	validatePath,
	validateRemoteUrl,
} from './paths.js';
export { RealGitWorkspaceAdapter } from './real-adapter.js';
export * from './persistent-mutation-lock.js';
export {
	ALLOWED_SPECKIT_COMMANDS,
	BLOCKED_SPECKIT_COMMANDS,
	isAllowedSpecKitCommand,
	isBlockedSpecKitCommand,
	SpecKitCommandPolicyError,
	validateSpecKitCommand,
} from './speckit-policy.js';
export type {
	RepoRisk,
	StopAskActionCategory,
	StopAskDecision,
	StopAskRequest,
	StopAskResult,
	StopAskRiskLevel,
} from './stop-ask-policy.js';
export {
	evaluateStopAsk,
	getAllDecisionOutcomes,
	requiresHumanApproval,
} from './stop-ask-policy.js';
export type { RunOptions } from './test-runner.js';
export { runSingleCommand, TestRunner } from './test-runner.js';
export { renderTestReportComment, renderTestReportMarkdown } from './test-templates.js';
