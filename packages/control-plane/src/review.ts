// Positron Control Plane — Real Fan-out/Join für strukturierte Reviews
//
// Reviews laufen als echte parallele Worker (correctness / security /
// quality). Parallelität wird NICHT über Code-Struktur behauptet, sondern
// über die tatsächliche zeitliche Überschneidung der Ausführungen bewiesen:
//
//   started_at / ended_at je Review
//   → mindestens zwei Reviews müssen sich real zeitlich überschneiden
//   → sonst PARALLELISM_NOT_PROVEN
//
// Ergebnis ist ein strukturierter positron.review-batch.v1 Contract.
// Kein Freitext als alleinige Decision Boundary.

import type Database from 'better-sqlite3';
import { validateContract } from './contracts.js';
import type { FindingContract, ReviewBatchContract } from './contracts.js';
import { assertAttemptActive, assertExecutionContext } from './execution-context.js';
import { fingerprint } from './fingerprint.js';
import { assertRealParallelism } from './parallelism.js';
import type { ParallelExecutionSlice, ParallelismVerdict } from './parallelism.js';
import { claimAttempt, completeAttempt, createAttempt } from './store.js';
import type { AttemptRecord } from './store.js';

export type ReviewKind = 'correctness' | 'security' | 'quality';

export interface ReviewWorker {
	kind: ReviewKind;
	workerType: string;
	/** Führt das Review aus und liefert strukturierte Findings. */
	run(ctx: {
		run_id: string;
		job_id: string;
		attempt_id: string;
		workspacePath: string;
	}): Promise<FindingContract[]>;
}

export interface ParallelReviewResult extends ParallelExecutionSlice {
	kind: ReviewKind;
	workerType: string;
	findings: FindingContract[];
	started_at: string;
	ended_at: string;
	duration_ms: number;
}

export interface ParallelReviewOutcome {
	results: ParallelReviewResult[];
	verdict: ParallelismVerdict;
	/** Basis für den Review-Batch-Contract */
	reviewBatch: ReviewBatchContract;
	batchFingerprint: string;
}

function nowIso(): string {
	return new Date().toISOString();
}

// Re-Export der gemeinsamen Parallelitäts-Primitive (Kompatibilität:
// bestehende Importe aus './review.js' bleiben gültig).
export { assertRealParallelism } from './parallelism.js';
export type { ParallelismVerdict } from './parallelism.js';

/**
 * Führt Review-Worker real parallel aus (Fan-out) und sammelt die Findings
 * (Join). Jeder Worker läuft in einem eigenen Attempt des Review-Jobs
 * (Telemetrie: started_at/ended_at/duration_ms je Review).
 *
 * P3-Recovery (Partial Review Batch): bereits erfolgreich abgeschlossene
 * Review-Worker (aus cp_attempts rekonstruiert, `recovered`) werden NICHT
 * erneut ausgeführt; nur fehlende Worker starten. Der Verdict wird über
 * ALLE Ergebnisse (recovered + neu) aus den realen Zeitstempeln bewiesen.
 */
export async function runParallelReviews(
	db: Database.Database,
	ctx: { run_id: string; job_id: string; workspacePath: string },
	workers: ReviewWorker[],
	recovered: ParallelReviewResult[] = [],
): Promise<ParallelReviewOutcome> {
	const startedAll = Date.now();

	const results: ParallelReviewResult[] = await Promise.all(
		workers.map(async (worker) => {
			const startedAt = nowIso();
			const attempt = createAttempt(db, ctx.run_id, ctx.job_id, {
				status: 'pending',
				worker_type: worker.workerType,
				input_contract: 'positron.review-batch.v1',
				input_fingerprint: fingerprint({ kind: worker.kind, run: ctx.run_id }),
			});
			// P3: exakt ein Claimer; paralleler Doppel-Dispatch wird abgelehnt.
			if (!claimAttempt(db, attempt.attempt_id)) {
				return {
					kind: worker.kind,
					workerType: worker.workerType,
					findings: [],
					started_at: startedAt,
					ended_at: startedAt,
					duration_ms: 0,
				};
			}
			try {
				// P3: Review-Worker-Aufrufe nur innerhalb eines aktiven Attempts.
				assertExecutionContext({
					run_id: ctx.run_id,
					job_id: ctx.job_id,
					attempt_id: attempt.attempt_id,
				});
				assertAttemptActive(db, attempt.attempt_id);
				const findings = await worker.run({
					run_id: ctx.run_id,
					job_id: ctx.job_id,
					attempt_id: attempt.attempt_id,
					workspacePath: ctx.workspacePath,
				});
				const endedAt = nowIso();
				const durationMs = Date.now() - new Date(startedAt).getTime();
				completeAttempt(db, attempt.attempt_id, {
					status: 'succeeded',
					output_contract: 'positron.finding.v1[]',
					output_fingerprint: fingerprint(findings),
					output_json: JSON.stringify(findings),
					ended_at: endedAt,
				});
				return {
					kind: worker.kind,
					workerType: worker.workerType,
					findings,
					started_at: startedAt,
					ended_at: endedAt,
					duration_ms: durationMs,
				};
			} catch (err) {
				const endedAt = nowIso();
				completeAttempt(db, attempt.attempt_id, {
					status: 'failed',
					failure_class: 'UNKNOWN',
					failure_signature: `review-error:${String(err).slice(0, 200)}`,
					ended_at: endedAt,
				});
				return {
					kind: worker.kind,
					workerType: worker.workerType,
					findings: [],
					started_at: startedAt,
					ended_at: endedAt,
					duration_ms: Date.now() - new Date(startedAt).getTime(),
				};
			}
		}),
	);

	// P3-Recovery: recovered (completed) Reviews zuerst, dann neu ausgeführte.
	const allResults = [...recovered, ...results];
	const verdict = assertRealParallelism(allResults);

	const reviewBatch: ReviewBatchContract = {
		contract: 'positron.review-batch.v1',
		run_id: ctx.run_id,
		job_id: ctx.job_id,
		attempt_id: 'batch',
		findings: allResults.flatMap((r) => r.findings),
	};

	const batchValidation = validateContract('positron.review-batch.v1', reviewBatch);
	if (!batchValidation.ok) {
		throw new Error(
			`INTERNAL: review-batch contract invalid: ${batchValidation.errors.join('; ')}`,
		);
	}

	// Gesamtdauer für die Bewertung der Parallelität
	void startedAll;

	return {
		results: allResults,
		verdict,
		reviewBatch,
		batchFingerprint: fingerprint(reviewBatch),
	};
}

/**
 * Sammelt die Attempts eines Review-Jobs (Telemetrie je Review).
 */
export function listReviewAttempts(db: Database.Database, jobId: string): AttemptRecord[] {
	return (
		db
			.prepare('SELECT * FROM cp_attempts WHERE job_id = ? ORDER BY started_at ASC')
			.all(jobId) as Array<Record<string, unknown>>
	).map((row) => ({
		attempt_id: String(row.attempt_id),
		run_id: String(row.run_id),
		job_id: String(row.job_id),
		status: String(row.status) as AttemptRecord['status'],
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
		previous_attempt_id: row.previous_attempt_id ? String(row.previous_attempt_id) : null,
	}));
}
