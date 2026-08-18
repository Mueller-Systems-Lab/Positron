// Positron Control Plane — Real Fan-out/Join Review Tests
// REVIEW_PARALLELISM: Nur echte zeitliche Überschneidung zählt als PASS.

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { validateContract } from '../contracts.js';
import type { FindingContract } from '../contracts.js';
import { assertRealParallelism, runParallelReviews } from '../review.js';
import type { ReviewWorker } from '../review.js';
import { applyControlPlaneMigrations } from '../schema.js';
import { createJob } from '../store.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeWorker(kind: 'correctness' | 'security' | 'quality', delayMs: number): ReviewWorker {
	return {
		kind,
		workerType: `review-${kind}`,
		async run() {
			await sleep(delayMs);
			const finding: FindingContract = {
				contract: 'positron.finding.v1',
				category: kind,
				severity: 'LOW',
				confidence: 'MEDIUM',
				blocking: false,
				evidence: { file: 'src/index.ts' },
				recommendation: `reviewed ${kind}`,
			};
			return [finding];
		},
	};
}

describe('REVIEW_PARALLELISM', () => {
	it('parallel workers with real time overlap → PARALLELISM_PROVEN', async () => {
		const db = new Database(':memory:');
		applyControlPlaneMigrations(db);
		const job = createJob(db, 'run_1', 'review');

		const outcome = await runParallelReviews(
			db,
			{ run_id: 'run_1', job_id: job.job_id, workspacePath: '/tmp/ws' },
			[makeWorker('correctness', 60), makeWorker('security', 60), makeWorker('quality', 60)],
		);

		expect(outcome.verdict).toBe('PARALLELISM_PROVEN');
		expect(outcome.results).toHaveLength(3);

		// Gesamtdauer muss deutlich unter der Summe der Einzeldauern liegen
		const totalMs =
			Math.max(...outcome.results.map((r) => new Date(r.ended_at).getTime())) -
			Math.min(...outcome.results.map((r) => new Date(r.started_at).getTime()));
		const sumMs = outcome.results.reduce((a, r) => a + r.duration_ms, 0);
		expect(totalMs).toBeLessThan(sumMs);
	});

	it('sequential execution (no overlap) → PARALLELISM_NOT_PROVEN', async () => {
		const results = [
			{
				kind: 'correctness' as const,
				workerType: 'w',
				findings: [],
				started_at: '2026-01-01T00:00:00.000Z',
				ended_at: '2026-01-01T00:00:10.000Z',
				duration_ms: 10000,
			},
			{
				kind: 'security' as const,
				workerType: 'w',
				findings: [],
				started_at: '2026-01-01T00:00:10.000Z',
				ended_at: '2026-01-01T00:00:20.000Z',
				duration_ms: 10000,
			},
			{
				kind: 'quality' as const,
				workerType: 'w',
				findings: [],
				started_at: '2026-01-01T00:00:20.000Z',
				ended_at: '2026-01-01T00:00:30.000Z',
				duration_ms: 10000,
			},
		];
		expect(assertRealParallelism(results)).toBe('PARALLELISM_NOT_PROVEN');
	});

	it('fewer than two reviews can never prove parallelism', () => {
		expect(assertRealParallelism([])).toBe('PARALLELISM_NOT_PROVEN');
		expect(
			assertRealParallelism([
				{
					kind: 'correctness',
					workerType: 'w',
					findings: [],
					started_at: 'a',
					ended_at: 'b',
					duration_ms: 1,
				},
			]),
		).toBe('PARALLELISM_NOT_PROVEN');
	});

	it('produces a valid positron.review-batch.v1 contract', async () => {
		const db = new Database(':memory:');
		applyControlPlaneMigrations(db);
		const job = createJob(db, 'run_1', 'review');
		const outcome = await runParallelReviews(
			db,
			{ run_id: 'run_1', job_id: job.job_id, workspacePath: '/tmp/ws' },
			[makeWorker('quality', 10), makeWorker('security', 10)],
		);
		const validation = validateContract('positron.review-batch.v1', outcome.reviewBatch);
		expect(validation.ok).toBe(true);
		expect(outcome.batchFingerprint).toMatch(/^[0-9a-f]{64}$/);
	});

	it('records one attempt per review worker (telemetry)', async () => {
		const db = new Database(':memory:');
		applyControlPlaneMigrations(db);
		const job = createJob(db, 'run_1', 'review');
		await runParallelReviews(
			db,
			{ run_id: 'run_1', job_id: job.job_id, workspacePath: '/tmp/ws' },
			[makeWorker('correctness', 5), makeWorker('security', 5), makeWorker('quality', 5)],
		);
		const attempts = db
			.prepare('SELECT worker_type, status, started_at, ended_at FROM cp_attempts WHERE job_id = ?')
			.all(job.job_id) as Array<{
			worker_type: string;
			status: string;
			started_at: string;
			ended_at: string;
		}>;
		expect(attempts).toHaveLength(3);
		for (const a of attempts) {
			expect(a.status).toBe('succeeded');
			expect(a.ended_at).toBeTruthy();
			expect(new Date(a.ended_at).getTime()).toBeGreaterThanOrEqual(
				new Date(a.started_at).getTime(),
			);
		}
	});
});
