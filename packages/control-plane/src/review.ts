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

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { validateContract } from './contracts.js';
import type { FindingContract, ReviewBatchContract } from './contracts.js';
import { assertAttemptActive, assertExecutionContext } from './execution-context.js';
import { fingerprint } from './fingerprint.js';
import { assertRealParallelism } from './parallelism.js';
import type { ParallelExecutionSlice, ParallelismVerdict } from './parallelism.js';
import {
	claimAttemptWithGeneration,
	completeAttempt,
	createAttempt,
	mapAttemptRow,
} from './store.js';
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
			// Review-Fix: Owner INSTANZ-scoped (pro Review-Worker).
			const ownerId = `ctl:${ctx.run_id}:${crypto.randomUUID()}`;
			const claim = claimAttemptWithGeneration(db, attempt.attempt_id, { ownerId });
			if (!claim.claimed) {
				return {
					kind: worker.kind,
					workerType: worker.workerType,
					findings: [],
					started_at: startedAt,
					ended_at: startedAt,
					duration_ms: 0,
				};
			}
			const attemptGeneration = claim.generation;
			try {
				// P3: Review-Worker-Aufrufe nur innerhalb eines aktiven Attempts.
				assertExecutionContext({
					run_id: ctx.run_id,
					job_id: ctx.job_id,
					attempt_id: attempt.attempt_id,
				});
				assertAttemptActive(db, attempt.attempt_id, ownerId);
				const findings = await worker.run({
					run_id: ctx.run_id,
					job_id: ctx.job_id,
					attempt_id: attempt.attempt_id,
					workspacePath: ctx.workspacePath,
				});
				const endedAt = nowIso();
				const durationMs = Date.now() - new Date(startedAt).getTime();
				completeAttempt(
					db,
					attempt.attempt_id,
					{
						status: 'succeeded',
						output_contract: 'positron.finding.v1[]',
						output_fingerprint: fingerprint(findings),
						output_json: JSON.stringify(findings),
						ended_at: endedAt,
					},
					{ fencingOwnerId: ownerId, fencingGeneration: attemptGeneration },
				);
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
				completeAttempt(
					db,
					attempt.attempt_id,
					{
						status: 'failed',
						failure_class: 'UNKNOWN',
						failure_signature: `review-error:${String(err).slice(0, 200)}`,
						ended_at: endedAt,
					},
					{ fencingOwnerId: ownerId, fencingGeneration: attemptGeneration },
				);
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
	const rows = db
		.prepare('SELECT * FROM cp_attempts WHERE job_id = ? ORDER BY started_at ASC')
		.all(jobId) as Array<Record<string, unknown>>;
	return rows.map(mapAttemptRow);
}
