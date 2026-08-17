// Positron Control Plane — Job/Attempt-Persistenz (Store)
//
// Hierarchie: run → job → attempt
// Jeder Attempt speichert Input/Output-Contract, Fingerprints, Worker-/
// Provider-/Modell-Informationen, Failure-Klassifikation, neue Evidenz und
// Strategie-Delta. Die Historie ist unveränderlich (kein Überschreiben).

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export type JobType =
	| 'intake'
	| 'baseline'
	| 'specify'
	| 'clarify'
	| 'research'
	| 'plan'
	| 'plan_gate'
	| 'build'
	| 'verify'
	| 'review'
	| 'decide'
	| 'fix'
	| 'split';

export type JobState = 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'skipped';

export interface JobRecord {
	job_id: string;
	run_id: string;
	job_type: JobType;
	state: JobState;
	parent_job_id: string | null;
	created_at: string;
	updated_at: string;
}

export type AttemptStatus = 'running' | 'succeeded' | 'failed' | 'blocked' | 'denied';

export interface AttemptRecord {
	attempt_id: string;
	run_id: string;
	job_id: string;
	status: AttemptStatus;
	input_contract: string | null;
	input_fingerprint: string | null;
	output_contract: string | null;
	output_fingerprint: string | null;
	output_json: string | null;
	worker_type: string | null;
	provider: string | null;
	model: string | null;
	started_at: string;
	ended_at: string | null;
	failure_class: string | null;
	failure_signature: string | null;
	new_evidence: string | null;
	strategy_delta: string | null;
	result_ref: string | null;
	tokens: number | null;
}

export function createId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso(): string {
	return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export function createJob(
	db: Database.Database,
	runId: string,
	jobType: JobType,
	parentJobId: string | null = null,
): JobRecord {
	const job: JobRecord = {
		job_id: createId('job'),
		run_id: runId,
		job_type: jobType,
		state: 'pending',
		parent_job_id: parentJobId,
		created_at: nowIso(),
		updated_at: nowIso(),
	};
	db.prepare(
		`INSERT INTO cp_jobs (job_id, run_id, job_type, state, parent_job_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	).run(job.job_id, job.run_id, job.job_type, job.state, job.parent_job_id, job.created_at, job.updated_at);
	return job;
}

export function getJob(db: Database.Database, jobId: string): JobRecord | null {
	const row = db.prepare('SELECT * FROM cp_jobs WHERE job_id = ?').get(jobId) as
		| Record<string, unknown>
		| undefined;
	return row ? mapJobRow(row) : null;
}

export function listJobs(db: Database.Database, runId: string): JobRecord[] {
	const rows = db
		.prepare('SELECT * FROM cp_jobs WHERE run_id = ? ORDER BY created_at ASC')
		.all(runId) as Array<Record<string, unknown>>;
	return rows.map(mapJobRow);
}

export function updateJobState(
	db: Database.Database,
	jobId: string,
	state: JobState,
): JobRecord | null {
	db.prepare(
		'UPDATE cp_jobs SET state = ?, updated_at = ? WHERE job_id = ?',
	).run(state, nowIso(), jobId);
	return getJob(db, jobId);
}

function mapJobRow(row: Record<string, unknown>): JobRecord {
	return {
		job_id: String(row.job_id),
		run_id: String(row.run_id),
		job_type: row.job_type as JobType,
		state: row.state as JobState,
		parent_job_id: row.parent_job_id ? String(row.parent_job_id) : null,
		created_at: String(row.created_at),
		updated_at: String(row.updated_at),
	};
}

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

export function createAttempt(
	db: Database.Database,
	runId: string,
	jobId: string,
	initial: Partial<AttemptRecord> = {},
): AttemptRecord {
	const attempt: AttemptRecord = {
		attempt_id: initial.attempt_id ?? createId('att'),
		run_id: runId,
		job_id: jobId,
		status: initial.status ?? 'running',
		input_contract: initial.input_contract ?? null,
		input_fingerprint: initial.input_fingerprint ?? null,
		output_contract: initial.output_contract ?? null,
		output_fingerprint: initial.output_fingerprint ?? null,
		output_json: initial.output_json ?? null,
		worker_type: initial.worker_type ?? null,
		provider: initial.provider ?? null,
		model: initial.model ?? null,
		started_at: initial.started_at ?? nowIso(),
		ended_at: initial.ended_at ?? null,
		failure_class: initial.failure_class ?? null,
		failure_signature: initial.failure_signature ?? null,
		new_evidence: initial.new_evidence ?? null,
		strategy_delta: initial.strategy_delta ?? null,
		result_ref: initial.result_ref ?? null,
		tokens: initial.tokens ?? null,
	};
	db.prepare(
		`INSERT INTO cp_attempts (attempt_id, run_id, job_id, status, input_contract, input_fingerprint,
		   output_contract, output_fingerprint, output_json, worker_type, provider, model, started_at,
		   ended_at, failure_class, failure_signature, new_evidence, strategy_delta, result_ref, tokens)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	).run(
		attempt.attempt_id,
		attempt.run_id,
		attempt.job_id,
		attempt.status,
		attempt.input_contract,
		attempt.input_fingerprint,
		attempt.output_contract,
		attempt.output_fingerprint,
		attempt.output_json,
		attempt.worker_type,
		attempt.provider,
		attempt.model,
		attempt.started_at,
		attempt.ended_at,
		attempt.failure_class,
		attempt.failure_signature,
		attempt.new_evidence,
		attempt.strategy_delta,
		attempt.result_ref,
		attempt.tokens,
	);
	return attempt;
}

export function getAttempt(db: Database.Database, attemptId: string): AttemptRecord | null {
	const row = db.prepare('SELECT * FROM cp_attempts WHERE attempt_id = ?').get(attemptId) as
		| Record<string, unknown>
		| undefined;
	return row ? mapAttemptRow(row) : null;
}

export function listAttempts(db: Database.Database, runId: string): AttemptRecord[] {
	const rows = db
		.prepare('SELECT * FROM cp_attempts WHERE run_id = ? ORDER BY started_at ASC')
		.all(runId) as Array<Record<string, unknown>>;
	return rows.map(mapAttemptRow);
}

export function listJobAttempts(db: Database.Database, jobId: string): AttemptRecord[] {
	const rows = db
		.prepare('SELECT * FROM cp_attempts WHERE job_id = ? ORDER BY started_at ASC')
		.all(jobId) as Array<Record<string, unknown>>;
	return rows.map(mapAttemptRow);
}

export function completeAttempt(
	db: Database.Database,
	attemptId: string,
	update: Partial<AttemptRecord>,
): AttemptRecord | null {
	const existing = getAttempt(db, attemptId);
	if (!existing) return null;
	db.prepare(
		`UPDATE cp_attempts SET status = ?, output_contract = ?, output_fingerprint = ?, output_json = ?,
		   ended_at = ?, failure_class = ?, failure_signature = ?, new_evidence = ?, strategy_delta = ?,
		   result_ref = ?, tokens = ? WHERE attempt_id = ?`,
	).run(
		update.status ?? existing.status,
		update.output_contract ?? existing.output_contract,
		update.output_fingerprint ?? existing.output_fingerprint,
		update.output_json ?? existing.output_json,
		update.ended_at ?? nowIso(),
		update.failure_class ?? existing.failure_class,
		update.failure_signature ?? existing.failure_signature,
		update.new_evidence ?? existing.new_evidence,
		update.strategy_delta ?? existing.strategy_delta,
		update.result_ref ?? existing.result_ref,
		update.tokens ?? existing.tokens,
		attemptId,
	);
	return getAttempt(db, attemptId);
}

function mapAttemptRow(row: Record<string, unknown>): AttemptRecord {
	return {
		attempt_id: String(row.attempt_id),
		run_id: String(row.run_id),
		job_id: String(row.job_id),
		status: row.status as AttemptStatus,
		input_contract: row.input_contract ? String(row.input_contract) : null,
		input_fingerprint: row.input_fingerprint ? String(row.input_fingerprint) : null,
		output_contract: row.output_contract ? String(row.output_contract) : null,
		output_fingerprint: row.output_fingerprint ? String(row.output_fingerprint) : null,
		output_json: row.output_json ? String(row.output_json) : null,
		worker_type: row.worker_type ? String(row.worker_type) : null,
		provider: row.provider ? String(row.provider) : null,
		model: row.model ? String(row.model) : null,
		started_at: String(row.started_at),
		ended_at: row.ended_at ? String(row.ended_at) : null,
		failure_class: row.failure_class ? String(row.failure_class) : null,
		failure_signature: row.failure_signature ? String(row.failure_signature) : null,
		new_evidence: row.new_evidence ? String(row.new_evidence) : null,
		strategy_delta: row.strategy_delta ? String(row.strategy_delta) : null,
		result_ref: row.result_ref ? String(row.result_ref) : null,
		tokens: row.tokens !== null && row.tokens !== undefined ? Number(row.tokens) : null,
	};
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export interface DecisionRecord {
	decision_id: string;
	run_id: string;
	decision: string;
	reason_code: string;
	contract_json: string;
	created_at: string;
}

export function storeDecision(
	db: Database.Database,
	runId: string,
	decision: string,
	reasonCode: string,
	contractJson: string,
): DecisionRecord {
	const record: DecisionRecord = {
		decision_id: createId('dec'),
		run_id: runId,
		decision,
		reason_code: reasonCode,
		contract_json: contractJson,
		created_at: nowIso(),
	};
	db.prepare(
		`INSERT INTO cp_decisions (decision_id, run_id, decision, reason_code, contract_json, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	).run(
		record.decision_id,
		record.run_id,
		record.decision,
		record.reason_code,
		record.contract_json,
		record.created_at,
	);
	return record;
}

export function listDecisions(db: Database.Database, runId: string): DecisionRecord[] {
	const rows = db
		.prepare('SELECT * FROM cp_decisions WHERE run_id = ? ORDER BY created_at ASC')
		.all(runId) as Array<Record<string, unknown>>;
	return rows.map((row) => ({
		decision_id: String(row.decision_id),
		run_id: String(row.run_id),
		decision: String(row.decision),
		reason_code: String(row.reason_code),
		contract_json: String(row.contract_json),
		created_at: String(row.created_at),
	}));
}

// ---------------------------------------------------------------------------
// Transitions (maschinenlesbare State Changes mit reason_code)
// ---------------------------------------------------------------------------

export interface TransitionRecord {
	transition_id: string;
	run_id: string;
	previous_state: string;
	new_state: string;
	reason_code: string;
	created_at: string;
}

export function storeTransition(
	db: Database.Database,
	runId: string,
	previousState: string,
	newState: string,
	reasonCode: string,
): TransitionRecord {
	const record: TransitionRecord = {
		transition_id: createId('tr'),
		run_id: runId,
		previous_state: previousState,
		new_state: newState,
		reason_code: reasonCode,
		created_at: nowIso(),
	};
	db.prepare(
		`INSERT INTO cp_transitions (transition_id, run_id, previous_state, new_state, reason_code, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	).run(
		record.transition_id,
		record.run_id,
		record.previous_state,
		record.new_state,
		record.reason_code,
		record.created_at,
	);
	return record;
}

export function listTransitions(db: Database.Database, runId: string): TransitionRecord[] {
	const rows = db
		.prepare('SELECT * FROM cp_transitions WHERE run_id = ? ORDER BY created_at ASC')
		.all(runId) as Array<Record<string, unknown>>;
	return rows.map((row) => ({
		transition_id: String(row.transition_id),
		run_id: String(row.run_id),
		previous_state: String(row.previous_state),
		new_state: String(row.new_state),
		reason_code: String(row.reason_code),
		created_at: String(row.created_at),
	}));
}
