import type { Octokit } from '@octokit/rest';
import { createGitHubClient } from './client.js';
import {
	createStage3CanonicalLiveExecutorFactory,
	type Stage3CanonicalLiveExecutor,
	type Stage3RunBoundApprovalProvider,
} from './stage3-canonical-executor.js';
import type { Stage3ExecutionAuthorityProvider } from './stage3-run-bound-approval.js';
import type { Stage3AuditSink } from './stage3-runtime-harness.js';
import type { Stage3RuntimeSafetyProbe } from './stage3-runtime-safety-probe.js';
import { STAGE3_CANONICAL } from './stage3-supervised-pilot-policy.js';

export const STAGE3_SANDBOX_CREDENTIAL_MISSING = 'STAGE3_SANDBOX_CREDENTIAL_MISSING';

export interface Stage3PilotBootstrapOptions {
	enabled: boolean;
	runtimeMode: 'fake' | 'real';
	targetRepository: string;
	/** Explicit sandbox-only credential. Never read GITHUB_TOKEN here. */
	sandboxCredential?: string;
	approvalProvider?: Stage3RunBoundApprovalProvider;
	executionAuthority?: Stage3ExecutionAuthorityProvider;
	runtimeSafetyProbe?: Stage3RuntimeSafetyProbe;
	auditSink?: Stage3AuditSink;
	/** Test injection; production uses the client created from sandboxCredential. */
	octokit?: Octokit;
	/** The bounded pilot must never be assembled with merge capability. */
	mergeCapabilityEnabled?: boolean;
}

function assertSandboxTarget(targetRepository: string): void {
	if (
		targetRepository === 'Mueller-Systems-Lab/Positron' ||
		targetRepository === 'xxammaxx/Positron'
	) {
		throw new Error('STAGE3_PRODUCTION_TARGET_DENIED');
	}
	if (targetRepository !== STAGE3_CANONICAL.repository) {
		throw new Error('STAGE3_CANONICAL_TARGET_MISMATCH');
	}
}

/**
 * Assemble Stage 3 only from the explicit real-mode pilot contract.
 * Disabled is the safe default and returns no pipeline dependency.
 */
export function assembleStage3Pilot(
	options: Stage3PilotBootstrapOptions,
): Stage3CanonicalLiveExecutor | undefined {
	if (!options.enabled) return undefined;
	if (options.runtimeMode !== 'real') throw new Error('STAGE3_REAL_MODE_REQUIRED');
	assertSandboxTarget(options.targetRepository);
	if (!options.sandboxCredential?.trim()) {
		throw new Error(STAGE3_SANDBOX_CREDENTIAL_MISSING);
	}
	if (options.mergeCapabilityEnabled === true) {
		throw new Error('STAGE3_MERGE_CAPABILITY_MUST_BE_DISABLED');
	}
	if (!options.approvalProvider) {
		throw new Error('STAGE3_RUN_BOUND_APPROVAL_PROVIDER_MISSING');
	}
	if (!options.executionAuthority) {
		throw new Error('STAGE3_EXECUTION_AUTHORITY_PROVIDER_MISSING');
	}
	if (!options.runtimeSafetyProbe || !options.auditSink) {
		throw new Error('STAGE3_RUNTIME_DEPENDENCIES_MISSING');
	}

	return createStage3CanonicalLiveExecutorFactory({
		octokit: options.octokit ?? createGitHubClient({ token: options.sandboxCredential }),
		approvalProvider: options.approvalProvider,
		executionAuthority: options.executionAuthority,
		runtimeSafetyProbe: options.runtimeSafetyProbe,
		auditSink: options.auditSink,
	});
}
