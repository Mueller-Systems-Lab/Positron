import { describe, expect, it } from 'vitest';
import type {
	Stage3AuditSink,
	Stage3ExecutionIdentity,
	Stage3RunBoundApprovalProvider,
} from '../index.js';
import {
	assembleStage3Pilot,
	createFakeRuntimeSafetyProbe,
	STAGE3_CANONICAL,
	STAGE3_SANDBOX_CREDENTIAL_MISSING,
} from '../index.js';

const identity: Stage3ExecutionIdentity = {
	runId: 'run-1',
	queueItemId: 'queue-1',
	jobId: 'job-1',
	attemptId: 'attempt-1',
	workspaceKey: STAGE3_CANONICAL.repository,
	attemptLeaseOwnerId: 'owner-1',
	attemptLeaseGeneration: 1,
	workspaceLockOwnerId: 'queue-1',
	workspaceLockGeneration: 1,
	providerReservationId: 'reservation-1',
	idempotencyKey: 'run-1:job-1:attempt-1',
};

const approvalProvider: Stage3RunBoundApprovalProvider = {
	async getApproval() {
		return null;
	},
};
const authority = {
	async revalidate() {
		return { valid: true, currentIdentity: identity };
	},
};
const auditSink: Stage3AuditSink = { record() {} };

function options(overrides: Record<string, unknown> = {}) {
	return {
		enabled: true,
		runtimeMode: 'real' as const,
		targetRepository: STAGE3_CANONICAL.repository,
		sandboxCredential: 'sandbox-token-not-printed',
		approvalProvider,
		executionAuthority: authority,
		runtimeSafetyProbe: createFakeRuntimeSafetyProbe(),
		auditSink,
		octokit: {} as never,
		...overrides,
	};
}

describe('Issue #308 Stage 3 productive bootstrap', () => {
	it('keeps the normal pipeline dependency absent when disabled', () => {
		expect(assembleStage3Pilot({ ...options(), enabled: false })).toBeUndefined();
	});

	it('fails closed without the explicit sandbox credential', () => {
		expect(() => assembleStage3Pilot(options({ sandboxCredential: undefined }))).toThrow(
			STAGE3_SANDBOX_CREDENTIAL_MISSING,
		);
	});

	it('rejects a wrong target before constructing the executor', () => {
		expect(() =>
			assembleStage3Pilot(
				options({ targetRepository: 'someone/else', sandboxCredential: undefined }),
			),
		).toThrow('STAGE3_CANONICAL_TARGET_MISMATCH');
	});

	it('rejects the production repository', () => {
		expect(() =>
			assembleStage3Pilot(options({ targetRepository: 'Mueller-Systems-Lab/Positron' })),
		).toThrow('STAGE3_PRODUCTION_TARGET_DENIED');
	});

	it('injects the canonical executor with valid explicit dependencies', () => {
		const executor = assembleStage3Pilot(options());
		expect(executor).toBeDefined();
		expect(typeof executor?.execute).toBe('function');
	});
});
