// Positron Control Plane — durable decision and approval evidence
//
// This module is deliberately additive. Historical decisions are immutable;
// reconciliations and approval-consumption records are append-only evidence.

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { DecisionRecord } from './store.js';
import { createId, nowIso } from './store.js';

const SHA256 = /^[a-f0-9]{64}$/;
const SECRET_LIKE = /(gh[pso]_|github_pat_|bearer\s+)/i;

export interface DecisionReconciliationRecord {
	reconciliation_id: string;
	run_id: string;
	source_decision_id: string;
	job_id: string;
	attempt_id: string;
	previous_decision: string;
	reconciled_decision: string;
	reason_code: string;
	evidence_refs_json: string;
	evidence_hashes_json: string;
	created_at: string;
	original_event_time: string | null;
	reconciliation_time: string;
	reconstructed: boolean;
	provenance_version: string;
	resolution_ordinal: number;
}

export interface DecisionReconciliationInput {
	runId: string;
	sourceDecisionId: string;
	jobId: string;
	attemptId: string;
	previousDecision: string;
	reconciledDecision: string;
	reasonCode: string;
	evidenceRefs: string[];
	evidenceHashes: string[];
	originalEventTime?: string | null;
	reconciliationTime?: string;
	reconstructed?: boolean;
	provenanceVersion?: string;
}

export interface EffectiveDecision {
	historicalDecision: DecisionRecord;
	reconciliation: DecisionReconciliationRecord | null;
	effectiveDecision: DecisionRecord;
}

export interface ApprovalConsumptionInput {
	approvalFingerprint: string;
	runId: string;
	queueItemId: string;
	jobId: string;
	attemptId: string;
	repository: string;
	repositoryId: string;
	baseSha: string;
	effectManifestHash: string;
	branchIdentity: string;
	filePath: string;
	fileSha256: string;
	commitMetadataSha256: string;
	prMetadataSha256: string;
	approvalExpiresAt: string;
	consumedAt?: string;
	idempotencyKey: string;
	approvalSchemaVersion: string;
	attemptLeaseGeneration: number;
	workspaceLockGeneration: number;
	reconstructed?: boolean;
	originalNativePersistence?: boolean;
	sourceEvidenceRefs?: string[];
	sourceEvidenceHashes?: string[];
	provenanceVersion?: string;
}

export interface ApprovalConsumptionRecord {
	consumption_id: string;
	approval_fingerprint: string;
	run_id: string;
	queue_item_id: string;
	job_id: string;
	attempt_id: string;
	repository: string;
	repository_id: string;
	base_sha: string;
	effect_manifest_hash: string;
	branch_identity: string;
	branch_identity_hash: string;
	file_path: string;
	file_sha256: string;
	commit_metadata_sha256: string;
	pr_metadata_sha256: string;
	approval_expires_at: string;
	consumed_at: string;
	idempotency_key: string;
	idempotency_key_hash: string;
	approval_schema_version: string;
	attempt_lease_generation: number;
	workspace_lock_generation: number;
	reconstructed: boolean;
	original_native_persistence: boolean;
	source_evidence_refs_json: string;
	source_evidence_hashes_json: string;
	provenance_version: string;
	created_at: string;
}

function hash(value: string): string {
	return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function json(value: unknown): string {
	return JSON.stringify(value);
}

function requireText(name: string, value: string): void {
	if (typeof value !== 'string' || value.length === 0) throw new Error(`${name}_MISSING`);
}

function requireHash(name: string, value: string): void {
	if (!SHA256.test(value)) throw new Error(`${name}_MALFORMED`);
}

function mapReconciliation(row: Record<string, unknown>): DecisionReconciliationRecord {
	return {
		reconciliation_id: String(row.reconciliation_id),
		run_id: String(row.run_id),
		source_decision_id: String(row.source_decision_id),
		job_id: String(row.job_id),
		attempt_id: String(row.attempt_id),
		previous_decision: String(row.previous_decision),
		reconciled_decision: String(row.reconciled_decision),
		reason_code: String(row.reason_code),
		evidence_refs_json: String(row.evidence_refs_json),
		evidence_hashes_json: String(row.evidence_hashes_json),
		created_at: String(row.created_at),
		original_event_time: row.original_event_time ? String(row.original_event_time) : null,
		reconciliation_time: String(row.reconciliation_time),
		reconstructed: Number(row.reconstructed) === 1,
		provenance_version: String(row.provenance_version),
		resolution_ordinal: Number(row.resolution_ordinal),
	};
}

function mapApproval(row: Record<string, unknown>): ApprovalConsumptionRecord {
	return {
		consumption_id: String(row.consumption_id),
		approval_fingerprint: String(row.approval_fingerprint),
		run_id: String(row.run_id),
		queue_item_id: String(row.queue_item_id),
		job_id: String(row.job_id),
		attempt_id: String(row.attempt_id),
		repository: String(row.repository),
		repository_id: String(row.repository_id),
		base_sha: String(row.base_sha),
		effect_manifest_hash: String(row.effect_manifest_hash),
		branch_identity: String(row.branch_identity),
		branch_identity_hash: String(row.branch_identity_hash),
		file_path: String(row.file_path),
		file_sha256: String(row.file_sha256),
		commit_metadata_sha256: String(row.commit_metadata_sha256),
		pr_metadata_sha256: String(row.pr_metadata_sha256),
		approval_expires_at: String(row.approval_expires_at),
		consumed_at: String(row.consumed_at),
		idempotency_key: String(row.idempotency_key),
		idempotency_key_hash: String(row.idempotency_key_hash),
		approval_schema_version: String(row.approval_schema_version),
		attempt_lease_generation: Number(row.attempt_lease_generation),
		workspace_lock_generation: Number(row.workspace_lock_generation),
		reconstructed: Number(row.reconstructed) === 1,
		original_native_persistence: Number(row.original_native_persistence) === 1,
		source_evidence_refs_json: String(row.source_evidence_refs_json),
		source_evidence_hashes_json: String(row.source_evidence_hashes_json),
		provenance_version: String(row.provenance_version),
		created_at: String(row.created_at),
	};
}

function reconciliationComparable(input: DecisionReconciliationInput, record: DecisionReconciliationRecord, sourceEventTime: string | null): boolean {
	return (
		record.run_id === input.runId &&
		record.source_decision_id === input.sourceDecisionId &&
		record.job_id === input.jobId &&
		record.attempt_id === input.attemptId &&
		record.previous_decision === input.previousDecision &&
		record.reconciled_decision === input.reconciledDecision &&
		record.reason_code === input.reasonCode &&
		record.evidence_refs_json === json(input.evidenceRefs) &&
		record.evidence_hashes_json === json(input.evidenceHashes) &&
		record.original_event_time === (input.originalEventTime ?? sourceEventTime) &&
		record.reconstructed === (input.reconstructed ?? false) &&
		record.provenance_version === (input.provenanceVersion ?? 'positron.durable-evidence.v1')
	);
}

/** Append a terminal reconciliation without altering the source decision. */
export function reconcileDecision(
	db: Database.Database,
	input: DecisionReconciliationInput,
): { record: DecisionReconciliationRecord; created: boolean } {
	for (const [name, value] of Object.entries(input)) {
		if (name !== 'originalEventTime' && name !== 'reconciliationTime' && name !== 'reconstructed' && name !== 'provenanceVersion' && !Array.isArray(value)) {
			requireText(name, value as string);
		}
	}
	if (input.evidenceRefs.length !== input.evidenceHashes.length) {
		throw new Error('DECISION_RECONCILIATION_EVIDENCE_LENGTH_MISMATCH');
	}
	for (const ref of input.evidenceRefs) {
		if (SECRET_LIKE.test(ref)) throw new Error('RECONCILIATION_SECRET_INPUT_REJECTED');
	}
	for (const evidenceHash of input.evidenceHashes) requireHash('evidenceHash', evidenceHash);
	const tx = db.transaction(() => {
		const source = db.prepare('SELECT * FROM cp_decisions WHERE decision_id = ? AND run_id = ?').get(input.sourceDecisionId, input.runId) as Record<string, unknown> | undefined;
		if (!source) throw new Error('DECISION_RECONCILIATION_SOURCE_NOT_FOUND');
		if (String(source.decision) !== input.previousDecision) throw new Error('DECISION_RECONCILIATION_SOURCE_MISMATCH');
		const existing = db.prepare('SELECT * FROM cp_decision_reconciliations WHERE run_id = ? AND source_decision_id = ?').get(input.runId, input.sourceDecisionId) as Record<string, unknown> | undefined;
		if (existing) {
			const record = mapReconciliation(existing);
			if (!reconciliationComparable(input, record, source.created_at ? String(source.created_at) : null)) throw new Error('DECISION_RECONCILIATION_CONFLICT');
			return { record, created: false };
		}
		const reconciliationTime = input.reconciliationTime ?? nowIso();
		const record: DecisionReconciliationRecord = {
			reconciliation_id: createId('recon'),
			run_id: input.runId,
			source_decision_id: input.sourceDecisionId,
			job_id: input.jobId,
			attempt_id: input.attemptId,
			previous_decision: input.previousDecision,
			reconciled_decision: input.reconciledDecision,
			reason_code: input.reasonCode,
			evidence_refs_json: json(input.evidenceRefs),
			evidence_hashes_json: json(input.evidenceHashes),
			created_at: reconciliationTime,
			original_event_time: input.originalEventTime ?? (source.created_at ? String(source.created_at) : null),
			reconciliation_time: reconciliationTime,
			reconstructed: input.reconstructed ?? false,
			provenance_version: input.provenanceVersion ?? 'positron.durable-evidence.v1',
			resolution_ordinal: Number((db.prepare('SELECT COALESCE(MAX(resolution_ordinal), 0) AS n FROM cp_decision_reconciliations WHERE run_id = ?').get(input.runId) as { n: number }).n) + 1,
		};
		db.prepare(`INSERT INTO cp_decision_reconciliations
			(reconciliation_id, run_id, source_decision_id, job_id, attempt_id, previous_decision,
			reconciled_decision, reason_code, evidence_refs_json, evidence_hashes_json, created_at,
			original_event_time, reconciliation_time, reconstructed, provenance_version, resolution_ordinal)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
			record.reconciliation_id, record.run_id, record.source_decision_id, record.job_id,
			record.attempt_id, record.previous_decision, record.reconciled_decision, record.reason_code,
			record.evidence_refs_json, record.evidence_hashes_json, record.created_at,
			record.original_event_time, record.reconciliation_time, record.reconstructed ? 1 : 0,
			record.provenance_version, record.resolution_ordinal,
		);
		const readback = db.prepare('SELECT * FROM cp_decision_reconciliations WHERE reconciliation_id = ?').get(record.reconciliation_id) as Record<string, unknown> | undefined;
		if (!readback || mapReconciliation(readback).reconciliation_id !== record.reconciliation_id) throw new Error('DECISION_RECONCILIATION_READBACK_FAILED');
		return { record: mapReconciliation(readback), created: true };
	});
	return tx();
}

export function listDecisionReconciliations(db: Database.Database, runId: string): DecisionReconciliationRecord[] {
	return (db.prepare('SELECT * FROM cp_decision_reconciliations WHERE run_id = ? ORDER BY resolution_ordinal ASC, reconciliation_id ASC').all(runId) as Array<Record<string, unknown>>).map(mapReconciliation);
}

/** Resolve the effective result while retaining the complete historical view. */
export function resolveEffectiveDecision(db: Database.Database, runId: string): EffectiveDecision | null {
	const historical = (db.prepare('SELECT * FROM cp_decisions WHERE run_id = ? ORDER BY created_at ASC, decision_id ASC').all(runId) as Array<Record<string, unknown>>).map((row) => ({
		decision_id: String(row.decision_id), run_id: String(row.run_id), decision: String(row.decision),
		reason_code: String(row.reason_code), contract_json: String(row.contract_json), created_at: String(row.created_at),
	}));
	const source = historical.at(-1);
	if (!source) return null;
	const reconciliation = (db.prepare('SELECT * FROM cp_decision_reconciliations WHERE run_id = ? AND source_decision_id = ?').get(runId, source.decision_id) as Record<string, unknown> | undefined);
	if (!reconciliation) return { historicalDecision: source, reconciliation: null, effectiveDecision: source };
	const resolved = mapReconciliation(reconciliation);
	return {
		historicalDecision: source,
		reconciliation: resolved,
		effectiveDecision: {
			...source,
			decision: resolved.reconciled_decision,
			reason_code: resolved.reason_code,
		},
	};
}

function approvalRowFromInput(input: ApprovalConsumptionInput, reconstructed: boolean): ApprovalConsumptionRecord {
	const consumedAt = input.consumedAt ?? nowIso();
	return {
		consumption_id: createId('approval'), approval_fingerprint: input.approvalFingerprint,
		run_id: input.runId, queue_item_id: input.queueItemId, job_id: input.jobId, attempt_id: input.attemptId,
		repository: input.repository, repository_id: input.repositoryId, base_sha: input.baseSha,
		effect_manifest_hash: input.effectManifestHash, branch_identity: input.branchIdentity,
		branch_identity_hash: hash(input.branchIdentity), file_path: input.filePath, file_sha256: input.fileSha256,
		commit_metadata_sha256: input.commitMetadataSha256, pr_metadata_sha256: input.prMetadataSha256,
		approval_expires_at: input.approvalExpiresAt, consumed_at: consumedAt, idempotency_key: input.idempotencyKey,
		idempotency_key_hash: hash(input.idempotencyKey), approval_schema_version: input.approvalSchemaVersion,
		attempt_lease_generation: input.attemptLeaseGeneration, workspace_lock_generation: input.workspaceLockGeneration,
		reconstructed, original_native_persistence: !reconstructed,
		source_evidence_refs_json: json(input.sourceEvidenceRefs ?? []), source_evidence_hashes_json: json(input.sourceEvidenceHashes ?? []),
		provenance_version: input.provenanceVersion ?? 'positron.durable-evidence.v1', created_at: consumedAt,
	};
}

function validateApprovalInput(input: ApprovalConsumptionInput, reconstructed: boolean): void {
	for (const value of Object.values(input)) {
		if (typeof value === 'string' && SECRET_LIKE.test(value)) throw new Error('APPROVAL_SECRET_INPUT_REJECTED');
	}
	for (const value of [...(input.sourceEvidenceRefs ?? []), ...(input.sourceEvidenceHashes ?? [])]) {
		if (SECRET_LIKE.test(value)) throw new Error('APPROVAL_SECRET_INPUT_REJECTED');
	}
	for (const [name, value] of Object.entries(input)) {
		if (name === 'consumedAt' || name === 'reconstructed' || name === 'originalNativePersistence' || name === 'sourceEvidenceRefs' || name === 'sourceEvidenceHashes' || name === 'provenanceVersion') continue;
		if (typeof value === 'string') requireText(name, value);
	}
	for (const [name, value] of [['approvalFingerprint', input.approvalFingerprint], ['baseSha', input.baseSha], ['effectManifestHash', input.effectManifestHash], ['fileSha256', input.fileSha256], ['commitMetadataSha256', input.commitMetadataSha256], ['prMetadataSha256', input.prMetadataSha256]] as const) requireHash(name, value);
	if (!Number.isInteger(input.attemptLeaseGeneration) || !Number.isInteger(input.workspaceLockGeneration)) throw new Error('APPROVAL_GENERATION_MALFORMED');
	if (reconstructed && (!input.sourceEvidenceRefs?.length || !input.sourceEvidenceHashes?.length)) throw new Error('RECONSTRUCTED_APPROVAL_SOURCE_MISSING');
	if ((input.sourceEvidenceRefs?.length ?? 0) !== (input.sourceEvidenceHashes?.length ?? 0)) throw new Error('APPROVAL_SOURCE_EVIDENCE_LENGTH_MISMATCH');
	for (const sourceHash of input.sourceEvidenceHashes ?? []) requireHash('sourceEvidenceHash', sourceHash);
}

function persistApproval(db: Database.Database, input: ApprovalConsumptionInput, reconstructed: boolean): ApprovalConsumptionRecord {
	validateApprovalInput(input, reconstructed);
	const tx = db.transaction(() => {
		const duplicate = db.prepare('SELECT consumption_id FROM cp_approval_consumptions WHERE approval_fingerprint = ? OR idempotency_key = ?').get(input.approvalFingerprint, input.idempotencyKey);
		if (duplicate) throw new Error('APPROVAL_CONSUMPTION_REPLAY');
		const record = approvalRowFromInput(input, reconstructed);
		db.prepare(`INSERT INTO cp_approval_consumptions
			(consumption_id, approval_fingerprint, run_id, queue_item_id, job_id, attempt_id, repository,
			repository_id, base_sha, effect_manifest_hash, branch_identity, branch_identity_hash, file_path,
			file_sha256, commit_metadata_sha256, pr_metadata_sha256, approval_expires_at, consumed_at,
			idempotency_key, idempotency_key_hash, approval_schema_version, attempt_lease_generation,
			workspace_lock_generation, reconstructed, original_native_persistence, source_evidence_refs_json,
			source_evidence_hashes_json, provenance_version, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
			record.consumption_id, record.approval_fingerprint, record.run_id, record.queue_item_id, record.job_id,
			record.attempt_id, record.repository, record.repository_id, record.base_sha, record.effect_manifest_hash,
		record.branch_identity, record.branch_identity_hash, record.file_path, record.file_sha256,
		record.commit_metadata_sha256, record.pr_metadata_sha256, record.approval_expires_at, record.consumed_at,
		record.idempotency_key, record.idempotency_key_hash, record.approval_schema_version,
		record.attempt_lease_generation, record.workspace_lock_generation, record.reconstructed ? 1 : 0,
		record.original_native_persistence ? 1 : 0, record.source_evidence_refs_json, record.source_evidence_hashes_json,
		record.provenance_version, record.created_at,
		);
		const readback = db.prepare('SELECT * FROM cp_approval_consumptions WHERE consumption_id = ?').get(record.consumption_id) as Record<string, unknown> | undefined;
		if (!readback || mapApproval(readback).approval_fingerprint !== record.approval_fingerprint) throw new Error('APPROVAL_CONSUMPTION_READBACK_FAILED');
		return mapApproval(readback);
	});
	return tx();
}

/** Native future-run authority. Must complete before the first writer call. */
export function persistApprovalConsumption(db: Database.Database, input: ApprovalConsumptionInput): ApprovalConsumptionRecord {
	return persistApproval(db, input, false);
}

/** Bounded retrospective import; explicitly marks evidence as reconstructed. */
export function reconstructApprovalConsumption(db: Database.Database, input: ApprovalConsumptionInput): ApprovalConsumptionRecord {
	return persistApproval(db, input, true);
}

export function getApprovalConsumption(db: Database.Database, fingerprint: string): ApprovalConsumptionRecord | null {
	const row = db.prepare('SELECT * FROM cp_approval_consumptions WHERE approval_fingerprint = ?').get(fingerprint) as Record<string, unknown> | undefined;
	return row ? mapApproval(row) : null;
}

export function listApprovalConsumptions(db: Database.Database, runId: string): ApprovalConsumptionRecord[] {
	return (db.prepare('SELECT * FROM cp_approval_consumptions WHERE run_id = ? ORDER BY consumed_at ASC, consumption_id ASC').all(runId) as Array<Record<string, unknown>>).map(mapApproval);
}
