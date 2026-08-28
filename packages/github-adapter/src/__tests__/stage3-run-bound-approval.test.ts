import { describe, expect, it } from 'vitest';
import { createApprovalBinding, generateApprovalText } from '../stage3-approval-binding.js';
import {
	CANONICAL_BASE_BRANCH,
	CANONICAL_COMMIT_MESSAGE_SHA256,
	CANONICAL_FILE_LENGTH,
	CANONICAL_FILE_PATH,
	CANONICAL_FILE_SHA256,
	CANONICAL_PR_METADATA_SHA256,
	CANONICAL_REPOSITORY,
	CANONICAL_TARGET_BRANCH,
} from '../stage3-canonical-manifest.js';
import {
	createRunBoundStage3Approval,
	validateRunBoundStage3Approval,
} from '../stage3-run-bound-approval.js';

const identity = {
	runId: 'run-308-a',
	queueItemId: 'queue-308-a',
	jobId: 'job-308-a',
	attemptId: 'attempt-308-a',
	workspaceKey: CANONICAL_REPOSITORY,
	attemptLeaseOwnerId: 'ctl:run-308-a:attempt',
	attemptLeaseGeneration: 3,
	workspaceLockOwnerId: 'queue-308-a',
	workspaceLockGeneration: 2,
	providerReservationId: 'res-308-a',
	idempotencyKey: 'stage3:run-308-a:pilot',
} as const;

function makeEffectBinding() {
	const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
	const approvalText = generateApprovalText({
		repository: CANONICAL_REPOSITORY,
		baseBranch: CANONICAL_BASE_BRANCH,
		expectedBaseSha: 'a'.repeat(40),
		targetBranch: CANONICAL_TARGET_BRANCH,
		filePath: CANONICAL_FILE_PATH,
		fileUtf8ByteLength: CANONICAL_FILE_LENGTH,
		fileSha256: CANONICAL_FILE_SHA256,
		commitMetadataSha256: CANONICAL_COMMIT_MESSAGE_SHA256,
		prMetadataSha256: CANONICAL_PR_METADATA_SHA256,
		expiresAt,
	});
	return createApprovalBinding({
		approvalText,
		repository: CANONICAL_REPOSITORY,
		baseBranch: CANONICAL_BASE_BRANCH,
		expectedBaseSha: 'a'.repeat(40),
		targetBranch: CANONICAL_TARGET_BRANCH,
		filePath: CANONICAL_FILE_PATH,
		fileUtf8ByteLength: CANONICAL_FILE_LENGTH,
		fileSha256: CANONICAL_FILE_SHA256,
		commitMetadataSha256: CANONICAL_COMMIT_MESSAGE_SHA256,
		prMetadataSha256: CANONICAL_PR_METADATA_SHA256,
		expiresAt,
	});
}

describe('Stage 3 run-bound approval', () => {
	it('accepts the exact durable execution identity', () => {
		const approval = createRunBoundStage3Approval({
			effectBinding: makeEffectBinding(),
			runBinding: identity,
		});
		expect(validateRunBoundStage3Approval(approval, identity).valid).toBe(true);
	});

	for (const field of Object.keys(identity) as Array<keyof typeof identity>) {
		it(`rejects a mismatched ${field} before any mutation`, () => {
			const approval = createRunBoundStage3Approval({
				effectBinding: makeEffectBinding(),
				runBinding: identity,
			});
			const changed = {
				...identity,
				[field]:
					typeof identity[field] === 'number'
						? Number(identity[field]) + 1
						: `${identity[field]}-other`,
			};
			const result = validateRunBoundStage3Approval(approval, changed);
			expect(result.valid).toBe(false);
			expect(result.failedChecks.join(' ')).toContain(field);
		});
	}

	it('rejects a tampered fingerprint and a missing envelope', () => {
		const approval = createRunBoundStage3Approval({
			effectBinding: makeEffectBinding(),
			runBinding: identity,
		});
		expect(
			validateRunBoundStage3Approval({ ...approval, approvalFingerprint: '0'.repeat(64) }, identity)
				.valid,
		).toBe(false);
		expect(validateRunBoundStage3Approval(undefined, identity).valid).toBe(false);
	});
});
