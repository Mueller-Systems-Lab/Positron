// Positron — canonical Stage 3 live executor
//
// This is the only public assembly point for a real Stage 3 mutation.  The
// raw Octokit transport and real bridge remain module-private so callers must
// enter through the approval-bound runtime harness.

import type { Octokit } from '@octokit/rest';
import { CANONICAL_FILE_CONTENT } from './stage3-canonical-manifest.js';
import { createStage3OctokitTransport } from './stage3-octokit-transport.js';
import { createStage3RealGitHubBridge } from './stage3-real-github-bridge.js';
import type {
	RunBoundStage3Approval,
	Stage3ExecutionIdentity,
} from './stage3-run-bound-approval.js';
import type { Stage3AuditSink, Stage3HarnessResult } from './stage3-runtime-harness.js';
import { createStage3Harness } from './stage3-runtime-harness.js';
import type { Stage3RuntimeSafetyProbe } from './stage3-runtime-safety-probe.js';
import { STAGE3_CANONICAL } from './stage3-supervised-pilot-policy.js';

export interface Stage3CanonicalLiveExecutor {
	execute(input: { executionIdentity: Stage3ExecutionIdentity }): Promise<Stage3HarnessResult>;
}

/**
 * Assemble the bounded real executor.  The approval and base SHA are frozen
 * at construction time; each execute call additionally revalidates the
 * durable identity at every mutation boundary inside the harness.
 */
export function createStage3CanonicalLiveExecutor(params: {
	octokit: Octokit;
	approvalText: string;
	runBoundApproval: RunBoundStage3Approval;
	runtimeSafetyProbe: Stage3RuntimeSafetyProbe;
	auditSink: Stage3AuditSink;
}): Stage3CanonicalLiveExecutor {
	const [owner, repo] = STAGE3_CANONICAL.repository.split('/');
	if (!owner || !repo) throw new Error('Invalid canonical Stage 3 repository');

	const transport = createStage3OctokitTransport(params.octokit, owner, repo);
	const bridge = createStage3RealGitHubBridge({
		transport,
		expectedBaseSha: params.runBoundApproval.effectBinding.expectedBaseSha,
		canonicalManifest: {
			targetBranch: STAGE3_CANONICAL.targetBranch,
			filePath: STAGE3_CANONICAL.filePath,
			expectedFileContent: CANONICAL_FILE_CONTENT,
			expectedFileSha256: STAGE3_CANONICAL.fileSha256,
			expectedFileBytes: STAGE3_CANONICAL.fileUtf8ByteLength,
			commitMessage: STAGE3_CANONICAL.commitMessage,
			commitBody: STAGE3_CANONICAL.commitBody,
			prTitle: STAGE3_CANONICAL.prTitle,
			prBody: STAGE3_CANONICAL.prBody,
		},
	});
	const harness = createStage3Harness({
		config: { enabled: true, fakeMode: false, requireRunBoundApproval: true },
	});

	return {
		execute: (input) =>
			harness.execute({
				mode: 'live',
				repository: STAGE3_CANONICAL.repository,
				fileContent: CANONICAL_FILE_CONTENT,
				idempotencyKey: input.executionIdentity.idempotencyKey,
				approvalText: params.approvalText,
				approvalBinding: params.runBoundApproval.effectBinding,
				runBoundApproval: params.runBoundApproval,
				executionIdentity: input.executionIdentity,
				runtimeSafetyProbe: params.runtimeSafetyProbe,
				bridge,
				auditSink: params.auditSink,
			}),
	};
}
