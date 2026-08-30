import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyControlPlaneMigrations } from '../schema.js';
import {
	getApprovalConsumption,
	listApprovalConsumptions,
	listDecisionReconciliations,
	persistApprovalConsumption,
	reconcileDecision,
	reconstructApprovalConsumption,
	resolveEffectiveDecision,
} from '../durable-evidence.js';
import { listDecisions, storeDecision } from '../store.js';

let db: Database.Database;
const HASH = 'a'.repeat(64);

beforeEach(() => {
	db = new Database(':memory:');
	applyControlPlaneMigrations(db);
	db.prepare(
		`INSERT INTO cp_jobs (job_id, run_id, job_type, state, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	).run(
		'job-1',
		'run-1',
		'stage3-pilot',
		'running',
		'2026-08-30T00:00:00.000Z',
		'2026-08-30T00:00:00.000Z',
	);
	db.prepare(
		`INSERT INTO cp_attempts (attempt_id, run_id, job_id, status)
		 VALUES (?, ?, ?, ?)`,
	).run('attempt-1', 'run-1', 'job-1', 'running');
	db.prepare(
		`INSERT INTO cp_queue
		 (queue_item_id, source_type, source_ref, repository_ref, run_id, queue_state, enqueued_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	).run(
		'queue-1',
		'issue',
		'308',
		'Mueller-Systems-Lab/positron-308-sandbox',
		'run-1',
		'RUNNING',
		'2026-08-30T00:00:00.000Z',
	);
});

describe('DURABLE_DECISION_RECONCILIATION', () => {
	it('preserves the historical decision and resolves the additive reconciliation', () => {
		const original = storeDecision(
			db,
			'run-1',
			'BLOCKED',
			'NO_VERIFICATION',
			'{}',
			'2026-08-29T00:00:00.000Z',
		);
		const result = reconcileDecision(db, {
			runId: 'run-1',
			sourceDecisionId: original.decision_id,
			jobId: 'job-1',
			attemptId: 'attempt-1',
			previousDecision: 'BLOCKED',
			reconciledDecision: 'DONE',
			reasonCode: 'AUTHORITATIVE_TERMINAL_RECONCILIATION',
			evidenceRefs: ['run:run-1', 'github:pr:1'],
			evidenceHashes: [HASH, HASH],
			originalEventTime: original.created_at,
			reconciliationTime: '2026-08-30T00:00:00.000Z',
		});

		expect(result.created).toBe(true);
		expect(listDecisions(db, 'run-1')[0]?.decision).toBe('BLOCKED');
		expect(listDecisionReconciliations(db, 'run-1')).toHaveLength(1);
		const effective = resolveEffectiveDecision(db, 'run-1');
		expect(effective?.historicalDecision.decision).toBe('BLOCKED');
		expect(effective?.effectiveDecision.decision).toBe('DONE');
		expect(effective?.reconciliation?.original_event_time).toBe(original.created_at);
		expect(effective?.reconciliation?.reconciliation_time).toBe('2026-08-30T00:00:00.000Z');
	});

	it('makes an identical reconciliation idempotent and rejects conflicts', () => {
		const original = storeDecision(db, 'run-1', 'BLOCKED', 'NO_VERIFICATION', '{}');
		const input = {
			runId: 'run-1',
			sourceDecisionId: original.decision_id,
			jobId: 'job-1',
			attemptId: 'attempt-1',
			previousDecision: 'BLOCKED',
			reconciledDecision: 'DONE',
			reasonCode: 'RECONCILED',
			evidenceRefs: ['evidence:1'],
			evidenceHashes: [HASH],
			reconciliationTime: '2026-08-30T00:00:00.000Z',
		};
		const first = reconcileDecision(db, input);
		const second = reconcileDecision(db, input);
		expect(first.created).toBe(true);
		expect(second.created).toBe(false);
		expect(second.record.reconciliation_id).toBe(first.record.reconciliation_id);
		expect(() => reconcileDecision(db, { ...input, reconciledDecision: 'FAILED' })).toThrow(
			'DECISION_RECONCILIATION_CONFLICT',
		);
	});

	it('does not resolve or expose reconciliations from another run', () => {
		const one = storeDecision(db, 'run-1', 'BLOCKED', 'NO_VERIFICATION', '{}');
		const two = storeDecision(db, 'run-2', 'DONE', 'ALL_HARD_GATES_GREEN', '{}');
		reconcileDecision(db, {
			runId: 'run-1',
			sourceDecisionId: one.decision_id,
			jobId: 'job-1',
			attemptId: 'attempt-1',
			previousDecision: 'BLOCKED',
			reconciledDecision: 'DONE',
			reasonCode: 'RECONCILED',
			evidenceRefs: ['evidence:1'],
			evidenceHashes: [HASH],
		});
		expect(resolveEffectiveDecision(db, 'run-2')?.effectiveDecision.decision).toBe('DONE');
		expect(resolveEffectiveDecision(db, 'run-2')?.reconciliation).toBeNull();
		expect(two.run_id).toBe('run-2');
	});

	it('remains readable when migration is applied repeatedly', () => {
		const original = storeDecision(db, 'run-1', 'BLOCKED', 'NO_VERIFICATION', '{}');
		reconcileDecision(db, {
			runId: 'run-1',
			sourceDecisionId: original.decision_id,
			jobId: 'job-1',
			attemptId: 'attempt-1',
			previousDecision: 'BLOCKED',
			reconciledDecision: 'DONE',
			reasonCode: 'RECONCILED',
			evidenceRefs: ['evidence:1'],
			evidenceHashes: [HASH],
		});
		applyControlPlaneMigrations(db);
		expect(resolveEffectiveDecision(db, 'run-1')?.effectiveDecision.decision).toBe('DONE');
	});

	it('rejects reconciliation foreign identities', () => {
		const original = storeDecision(db, 'run-1', 'BLOCKED', 'NO_VERIFICATION', '{}');
		expect(() =>
			reconcileDecision(db, {
				runId: 'run-1',
				sourceDecisionId: original.decision_id,
				jobId: 'job-not-in-run',
				attemptId: 'attempt-1',
				previousDecision: 'BLOCKED',
				reconciledDecision: 'DONE',
				reasonCode: 'RECONCILED',
				evidenceRefs: ['evidence:1'],
				evidenceHashes: [HASH],
			}),
		).toThrow('DECISION_RECONCILIATION_JOB_NOT_FOUND');
	});
});

function approvalInput(overrides: Record<string, unknown> = {}) {
	return {
		approvalFingerprint: HASH,
		runId: 'run-1',
		queueItemId: 'queue-1',
		jobId: 'job-1',
		attemptId: 'attempt-1',
		repository: 'Mueller-Systems-Lab/positron-308-sandbox',
		repositoryId: '1349145121',
		baseSha: HASH,
		effectManifestHash: HASH,
		branchIdentity: 'positron/issue-308-stage3-pilot',
		filePath: 'stage3/positron-supervised-pilot.md',
		fileSha256: HASH,
		commitMetadataSha256: HASH,
		prMetadataSha256: HASH,
		approvalExpiresAt: '2026-08-30T02:00:00.000Z',
		consumedAt: '2026-08-30T00:00:00.000Z',
		idempotencyKey: 'run-1:job-1:attempt-1',
		approvalSchemaVersion: 'stage3-run-bound-approval-v1',
		attemptLeaseGeneration: 1,
		workspaceLockGeneration: 2,
		...overrides,
	};
}

describe('DURABLE_APPROVAL_CONSUMPTION', () => {
	it('stores the exact non-secret authority binding before a writer can use it', () => {
		const record = persistApprovalConsumption(db, approvalInput());
		expect(record.approval_fingerprint).toBe(HASH);
		expect(record.repository_id).toBe('1349145121');
		expect(record.idempotency_key_hash).toHaveLength(64);
		expect(getApprovalConsumption(db, HASH)?.attempt_id).toBe('attempt-1');
		expect(listApprovalConsumptions(db, 'run-1')).toHaveLength(1);
		const columns = (
			db.prepare('PRAGMA table_info(cp_approval_consumptions)').all() as Array<{ name: string }>
		).map((row) => row.name);
		expect(
			columns.some((column) => /^(token|pat|authorization|authorization_header)$/i.test(column)),
		).toBe(false);
	});

	it('rejects approval replay and preserves idempotency binding', () => {
		persistApprovalConsumption(db, approvalInput());
		expect(() => persistApprovalConsumption(db, approvalInput())).toThrow(
			'APPROVAL_CONSUMPTION_REPLAY',
		);
		expect(() =>
			persistApprovalConsumption(db, approvalInput({ approvalFingerprint: 'b'.repeat(64) })),
		).toThrow('APPROVAL_CONSUMPTION_REPLAY');
	});

	it('rejects approval consumption with a foreign attempt binding', () => {
		expect(() =>
			persistApprovalConsumption(
				db,
				approvalInput({ attemptId: 'attempt-not-in-job', idempotencyKey: 'foreign-attempt' }),
			),
		).toThrow('APPROVAL_CONSUMPTION_ATTEMPT_NOT_FOUND');
	});

	it('marks retrospective evidence honestly and requires source evidence', () => {
		expect(() => reconstructApprovalConsumption(db, approvalInput())).toThrow(
			'RECONSTRUCTED_APPROVAL_SOURCE_MISSING',
		);
		const record = reconstructApprovalConsumption(
			db,
			approvalInput({
				sourceEvidenceRefs: ['execution:stage3-audit.jsonl'],
				sourceEvidenceHashes: [HASH],
			}),
		);
		expect(record.reconstructed).toBe(true);
		expect(record.original_native_persistence).toBe(false);
		expect(record.consumed_at).not.toBe('2026-08-30T00:00:00.000Z');
	});

	it('fails closed when the durability table is unavailable', () => {
		db.exec('DROP TABLE cp_approval_consumptions');
		expect(() => persistApprovalConsumption(db, approvalInput())).toThrow();
	});

	it('rejects secret-like material instead of persisting it', () => {
		expect(() =>
			persistApprovalConsumption(
				db,
				approvalInput({ repository: 'Bearer should-never-be-stored' }),
			),
		).toThrow('APPROVAL_SECRET_INPUT_REJECTED');
	});
});
