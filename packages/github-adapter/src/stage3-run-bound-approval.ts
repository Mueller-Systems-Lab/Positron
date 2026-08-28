// Positron — Stage 3 run-bound approval
//
// Composes the existing effect binding with the durable execution identity.
// The durable control plane has no approval-request record, so this module
// binds only identifiers that actually exist in the current schema.

import crypto from 'node:crypto';
import type { Stage3ApprovalBinding } from './stage3-approval-binding.js';

/** Durable identifiers present in the current Run/Job/Attempt path. */
export interface Stage3ExecutionIdentity {
	runId: string;
	queueItemId: string;
	jobId: string;
	attemptId: string;
	workspaceKey: string;
	attemptLeaseOwnerId: string;
	attemptLeaseGeneration: number;
	workspaceLockOwnerId: string;
	workspaceLockGeneration: number;
	providerReservationId: string;
	idempotencyKey: string;
}

/** Approval envelope that cannot be replayed for another durable execution. */
export interface RunBoundStage3Approval {
	version: 'stage3-run-bound-approval-v1';
	effectBinding: Stage3ApprovalBinding;
	runBinding: Stage3ExecutionIdentity;
	approvalFingerprint: string;
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(value);
}

/** Stable full-value fingerprint; no credential material is accepted here. */
export function computeRunBoundApprovalFingerprint(
	effectBinding: Stage3ApprovalBinding,
	runBinding: Stage3ExecutionIdentity,
): string {
	return crypto
		.createHash('sha256')
		.update(canonicalJson({ effectBinding, runBinding }), 'utf8')
		.digest('hex');
}

export function createRunBoundStage3Approval(params: {
	effectBinding: Stage3ApprovalBinding;
	runBinding: Stage3ExecutionIdentity;
}): RunBoundStage3Approval {
	return {
		version: 'stage3-run-bound-approval-v1',
		effectBinding: params.effectBinding,
		runBinding: { ...params.runBinding },
		approvalFingerprint: computeRunBoundApprovalFingerprint(
			params.effectBinding,
			params.runBinding,
		),
	};
}

export interface RunBoundApprovalValidationResult {
	valid: boolean;
	failedChecks: string[];
	reason?: string;
}

function compareIdentity(
	approved: Stage3ExecutionIdentity,
	actual: Stage3ExecutionIdentity,
	failed: string[],
): void {
	const stringFields: Array<keyof Stage3ExecutionIdentity> = [
		'runId',
		'queueItemId',
		'jobId',
		'attemptId',
		'workspaceKey',
		'attemptLeaseOwnerId',
		'workspaceLockOwnerId',
		'providerReservationId',
		'idempotencyKey',
	];
	for (const field of stringFields) {
		if (!approved[field] || approved[field] !== actual[field]) {
			failed.push(`${field} mismatch`);
		}
	}
	for (const field of ['attemptLeaseGeneration', 'workspaceLockGeneration'] as const) {
		if (!Number.isInteger(approved[field]) || approved[field] !== actual[field]) {
			failed.push(`${field} mismatch`);
		}
	}
}

/** Validate the envelope against the current execution at every write boundary. */
export function validateRunBoundStage3Approval(
	approval: RunBoundStage3Approval | undefined,
	actual: Stage3ExecutionIdentity | undefined,
): RunBoundApprovalValidationResult {
	const failed: string[] = [];
	if (!approval) failed.push('run-bound approval missing');
	if (!actual) failed.push('current execution identity missing');
	if (approval && actual) {
		if (approval.version !== 'stage3-run-bound-approval-v1') {
			failed.push('unsupported run-bound approval version');
		}
		compareIdentity(approval.runBinding, actual, failed);
		const expectedFingerprint = computeRunBoundApprovalFingerprint(
			approval.effectBinding,
			approval.runBinding,
		);
		if (approval.approvalFingerprint !== expectedFingerprint) {
			failed.push('run-bound approval fingerprint mismatch');
		}
		if (approval.effectBinding.approvalTextSha256.length !== 64) {
			failed.push('approval text hash malformed');
		}
		const expiry = Date.parse(approval.effectBinding.expiresAt);
		if (!Number.isFinite(expiry) || Date.now() > expiry)
			failed.push('approval expired or malformed');
		if (approval.runBinding.idempotencyKey !== actual.idempotencyKey) {
			failed.push('idempotency key mismatch');
		}
	}
	return {
		valid: failed.length === 0,
		failedChecks: failed,
		reason: failed.length ? failed.join('; ') : undefined,
	};
}
