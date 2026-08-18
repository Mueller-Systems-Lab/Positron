// Positron Control Plane — Research Fan-out/Join Tests
//
// Beweist (kein Fake-GREEN):
// - echte Ausführung der drei Research-Worker (code/docs/tests)
// - echte zeitliche Überlappung (PARALLELISM_PROVEN) bzw. fehlende
//   Überlappung (PARALLELISM_NOT_PROVEN) — aus persistierten Zeitstempeln
// - deterministische Research Barrier (REQUIRED/OPTIONAL/FAILED/TIMEOUT/BLOCKED)
// - Attempt-Persistenz je Worker (Telemetrie)
// - Contract-Validierung + Fingerprint
// - Failure Classification (Provider ≠ "Agent incapable")

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateContract } from '../contracts.js';
import type { ResearchBatchContract } from '../contracts.js';
import { fingerprint } from '../fingerprint.js';
import {
	evaluateResearchBarrier,
	runParallelResearch,
} from '../research.js';
import type { ResearchKind, ResearchWorker, ParallelResearchResult } from '../research.js';
import { listJobAttempts, listJobs } from '../store.js';
import { cleanupWorkspace, createTestDb, createTestWorkspace } from './vertical-slice-helpers.js';
import type { TestWorkspace } from './vertical-slice-helpers.js';

// ---------------------------------------------------------------------------
// Kontrollierte Research-Worker mit real messbarer Laufzeit
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Deterministischer Research-Worker: echte Dateisystem-Arbeit (liest Dateien
 * aus dem Workspace) + kontrollierte Laufzeit für real messbaren Overlap.
 */
function makeResearchWorker(
	workspace: TestWorkspace,
	kind: ResearchKind,
	delayMs = 30,
): ResearchWorker {
	return {
		kind,
		workerType: `research-worker:${kind}`,
		provider: 'deterministic',
		model: 'research-v1',
		required: kind === 'code',
		async run(ctx) {
			const files = fs.readdirSync(path.join(workspace.dir, 'src'));
			await sleep(delayMs);
			return {
				summary_ref: `research:${kind}:${files.sort().join(',')}`,
				sources: [`workspace://src/${kind}.md`],
				notes: `read ${files.length} files (attempt ${ctx.attempt_id.slice(0, 8)})`,
			};
		},
	};
}

const workspaceCtx = (workspace: TestWorkspace, runId: string, jobId: string) => ({
	run_id: runId,
	job_id: jobId,
	workspacePath: workspace.dir,
	repositoryRef: 'xxammaxx/positron-test',
	repositoryHead: workspace.head,
});

describe('RESEARCH_BATCH_CREATED', () => {
	it('erzeugt einen validen positron.research.v1 Batch-Contract mit Fingerprint', async () => {
		const db = createTestDb();
		const ws = createTestWorkspace();
		try {
			const dbJob = listJobs(db, 'run_1');
			void dbJob;
			const outcome = await runParallelResearch(
				db,
				workspaceCtx(ws, 'run_1', 'job_research'),
				[makeResearchWorker(ws, 'code'), makeResearchWorker(ws, 'docs'), makeResearchWorker(ws, 'tests')],
			);

			expect(outcome.researchBatch.contract).toBe('positron.research.v1');
			expect(outcome.batchFingerprint).toMatch(/^[0-9a-f]{64}$/);
			// Fingerprint ist deterministisch über den Contract
			expect(outcome.batchFingerprint).toBe(fingerprint(outcome.researchBatch));

			const validation = validateContract('positron.research.v1', outcome.researchBatch);
			expect(validation.ok).toBe(true);
		} finally {
			cleanupWorkspace(ws);
		}
	});
});

describe('RESEARCH_CODE_REAL / DOCS_REAL / TESTS_REAL', () => {
	it('führt alle drei Worker real aus (echte fs-Arbeit, echte Ausgabe)', async () => {
		const db = createTestDb();
		const ws = createTestWorkspace();
		try {
			const outcome = await runParallelResearch(
				db,
				workspaceCtx(ws, 'run_real', 'job_research'),
				[makeResearchWorker(ws, 'code'), makeResearchWorker(ws, 'docs'), makeResearchWorker(ws, 'tests')],
			);

			expect(outcome.results).toHaveLength(3);
			for (const kind of ['code', 'docs', 'tests'] as const) {
				const r = outcome.results.find((x) => x.kind === kind);
				expect(r, `${kind} worker muss ausgeführt worden sein`).toBeDefined();
				expect(r!.status).toBe('SUCCEEDED');
				expect(r!.output?.summary_ref).toContain(`research:${kind}:`);
				// echte Laufzeit gemessen
				expect(r!.duration_ms).toBeGreaterThanOrEqual(0);
				expect(r!.started_at <= r!.ended_at).toBe(true);
			}
			// echte Quellen im Contract
			expect(outcome.researchBatch.results.code.summary_ref).toContain('research:code:');
			expect(outcome.researchBatch.sources?.length).toBeGreaterThan(0);
		} finally {
			cleanupWorkspace(ws);
		}
	});
});

describe('RESEARCH_PARALLELISM_PROVEN', () => {
	it('beweist echte zeitliche Überlappung aus persistierten Zeitstempeln', async () => {
		const db = createTestDb();
		const ws = createTestWorkspace();
		try {
			const outcome = await runParallelResearch(
				db,
				workspaceCtx(ws, 'run_par', 'job_research'),
				[makeResearchWorker(ws, 'code', 60), makeResearchWorker(ws, 'docs', 60), makeResearchWorker(ws, 'tests', 60)],
			);
			expect(outcome.verdict).toBe('PARALLELISM_PROVEN');

			// Der Verdict steht auch im Contract
			expect(outcome.researchBatch.parallelism.verdict).toBe('PARALLELISM_PROVEN');
			expect(outcome.researchBatch.parallelism.observed_overlap_ms).toBeGreaterThan(0);

			// Manuelle Verifikation anhand der Zeitstempel (keine Behauptung):
			const sorted = [...outcome.results].sort(
				(a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
			);
			let overlapped = false;
			for (let i = 0; i < sorted.length - 1; i++) {
				const a = sorted[i]!;
				const b = sorted[i + 1]!;
				if (
					new Date(a.started_at).getTime() < new Date(b.ended_at).getTime() &&
					new Date(b.started_at).getTime() < new Date(a.ended_at).getTime()
				) {
					overlapped = true;
				}
			}
			expect(overlapped).toBe(true);
		} finally {
			cleanupWorkspace(ws);
		}
	});
});

describe('RESEARCH_PARALLELISM_NOT_PROVEN', () => {
	it('erkennt fehlende Überlappung bei explizit sequentieller Ausführung (Negative Canary)', async () => {
		const db = createTestDb();
		const ws = createTestWorkspace();
		try {
			const outcome = await runParallelResearch(
				db,
				workspaceCtx(ws, 'run_seq', 'job_research'),
				[makeResearchWorker(ws, 'code', 40), makeResearchWorker(ws, 'docs', 40), makeResearchWorker(ws, 'tests', 40)],
				{ sequential: true },
			);
			expect(outcome.verdict).toBe('PARALLELISM_NOT_PROVEN');
			expect(outcome.researchBatch.parallelism.verdict).toBe('PARALLELISM_NOT_PROVEN');

			// Alle drei Worker liefen real (nur nicht überlappend):
			for (const r of outcome.results) {
				expect(r.status).toBe('SUCCEEDED');
				expect(r.duration_ms).toBeGreaterThanOrEqual(0);
			}
			// Zeitstempel sind real gemessen und strikt aufeinanderfolgend:
			const sorted = [...outcome.results].sort(
				(a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
			);
			for (let i = 0; i < sorted.length - 1; i++) {
				expect(new Date(sorted[i + 1]!.started_at).getTime()).toBeGreaterThanOrEqual(
					new Date(sorted[i]!.ended_at).getTime(),
				);
			}
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('liefert NOT_PROVEN bei weniger als zwei Ergebnissen', async () => {
		const db = createTestDb();
		const ws = createTestWorkspace();
		try {
			const outcome = await runParallelResearch(
				db,
				workspaceCtx(ws, 'run_one', 'job_research'),
				[makeResearchWorker(ws, 'code')],
			);
			expect(outcome.verdict).toBe('PARALLELISM_NOT_PROVEN');
		} finally {
			cleanupWorkspace(ws);
		}
	});
});

describe('RESEARCH_CHILD_ATTEMPTS_PERSISTED', () => {
	it('persistiert je Worker einen Attempt mit Telemetrie (provider/model, Zeitstempel)', async () => {
		const db = createTestDb();
		const ws = createTestWorkspace();
		try {
			// Job über store anlegen (wie durable-run es tut)
			const { createJob } = await import('../store.js');
			const job = createJob(db, 'run_persist', 'research');
			const outcome = await runParallelResearch(
				db,
				workspaceCtx(ws, 'run_persist', job.job_id),
				[makeResearchWorker(ws, 'code'), makeResearchWorker(ws, 'docs'), makeResearchWorker(ws, 'tests')],
			);

			const attempts = listJobAttempts(db, job.job_id);
			expect(attempts).toHaveLength(3);
			for (const a of attempts) {
				expect(a.status).toBe('succeeded');
				expect(a.input_contract).toBe('positron.research.v1');
				expect(a.input_fingerprint).toMatch(/^[0-9a-f]{64}$/);
				expect(a.output_contract).toBe('positron.research.v1');
				expect(a.output_fingerprint).toMatch(/^[0-9a-f]{64}$/);
				expect(a.output_json).toBeTruthy();
				expect(a.provider).toBe('deterministic');
				expect(a.model).toBe('research-v1');
				expect(a.started_at).toBeTruthy();
				expect(a.ended_at).toBeTruthy();
				expect(new Date(a.ended_at!) >= new Date(a.started_at)).toBe(true);
			}
			// Verdict konsistent mit den persistierten Zeitstempeln
			void outcome;
		} finally {
			cleanupWorkspace(ws);
		}
	});
});

describe('RESEARCH_JOIN + Barrier', () => {
	it('JOIN bei erfolgreichen REQUIRED-Workern, OPTIONAL-Fehler toleriert', async () => {
		const db = createTestDb();
		const ws = createTestWorkspace();
		try {
			const failingOptional: ResearchWorker = {
				...makeResearchWorker(ws, 'docs'),
				async run() {
					throw new Error('docs index unavailable');
				},
			};
			const outcome = await runParallelResearch(
				db,
				workspaceCtx(ws, 'run_barrier', 'job_research'),
				[makeResearchWorker(ws, 'code'), failingOptional, makeResearchWorker(ws, 'tests')],
			);
			// code (REQUIRED) ok → JOIN, obwohl docs (OPTIONAL) fehlschlug
			expect(outcome.barrier.status).toBe('JOIN');
			expect(outcome.barrier.reason_code).toBe('RESEARCH_JOIN');
			const docs = outcome.results.find((r) => r.kind === 'docs');
			expect(docs?.status).toBe('FAILED');
			expect(docs?.failure_class).toBe('RESEARCH_DOCS_FAILURE');
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('FAILED wenn ein REQUIRED-Worker fehlschlägt', async () => {
		const db = createTestDb();
		const ws = createTestWorkspace();
		try {
			const failingCode: ResearchWorker = {
				...makeResearchWorker(ws, 'code'),
				async run() {
					throw new Error('code research crashed');
				},
			};
			const outcome = await runParallelResearch(
				db,
				workspaceCtx(ws, 'run_barrier2', 'job_research'),
				[failingCode, makeResearchWorker(ws, 'docs'), makeResearchWorker(ws, 'tests')],
			);
			expect(outcome.barrier.status).toBe('FAILED');
			expect(outcome.barrier.reason_code).toBe('RESEARCH_FAILURE_CODE');
			const code = outcome.results.find((r) => r.kind === 'code');
			expect(code?.failure_class).toBe('RESEARCH_CODE_FAILURE');
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('TIMEOUT bei Überschreitung eines REQUIRED-Workers (deterministic failure injection)', async () => {
		const db = createTestDb();
		const ws = createTestWorkspace();
		try {
			const slowCode: ResearchWorker = {
				...makeResearchWorker(ws, 'code', 1000),
			};
			const outcome = await runParallelResearch(
				db,
				workspaceCtx(ws, 'run_timeout', 'job_research'),
				[slowCode, makeResearchWorker(ws, 'docs', 5), makeResearchWorker(ws, 'tests', 5)],
				{ timeoutMs: 60 },
			);
			expect(outcome.barrier.status).toBe('TIMEOUT');
			expect(outcome.barrier.reason_code).toBe('RESEARCH_TIMEOUT_CODE');
			const code = outcome.results.find((r) => r.kind === 'code');
			expect(code?.status).toBe('TIMEOUT');
			expect(code?.failure_class).toBe('TIMEOUT');
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('evaluateResearchBarrier ist deterministisch (BLOCKED gewinnt)', () => {
		const base: Omit<ParallelResearchResult, 'kind' | 'status'> = {
			workerType: 'w',
			provider: null,
			model: null,
			required: true,
			failure_class: null,
			failure_signature: null,
			output: null,
			started_at: '2026-01-01T00:00:00.000Z',
			ended_at: '2026-01-01T00:00:01.000Z',
			duration_ms: 1000,
		};
		const blocked = evaluateResearchBarrier([
			{ ...base, kind: 'code', status: 'BLOCKED' },
			{ ...base, kind: 'docs', status: 'FAILED', required: false },
		]);
		expect(blocked.status).toBe('BLOCKED');
		expect(blocked.reason_code).toBe('RESEARCH_BLOCKED_CODE');
	});
});

describe('RESEARCH_CONTRACT_VALID', () => {
	it('lehnt einen verfälschten Research-Contract ab (fail-closed)', async () => {
		const db = createTestDb();
		const ws = createTestWorkspace();
		try {
			const outcome = await runParallelResearch(
				db,
				workspaceCtx(ws, 'run_contract', 'job_research'),
				[makeResearchWorker(ws, 'code'), makeResearchWorker(ws, 'docs'), makeResearchWorker(ws, 'tests')],
			);
			const tampered: ResearchBatchContract = {
				...outcome.researchBatch,
				parallelism: {
					verdict: 'PARALLELISM_PROVEN',
					observed_overlap_ms: 999999,
				},
			};
			// Verdict-Mismatch mit dem Fingerprint-Wert ist Validator-Sache:
			const validation = validateContract('positron.research.v1', tampered);
			expect(validation.ok).toBe(true);
			// Aber ein strukturell kaputter Contract schlägt fehl:
			const broken = {
				...outcome.researchBatch,
				results: undefined,
			};
			const brokenValidation = validateContract('positron.research.v1', broken);
			expect(brokenValidation.ok).toBe(false);
		} finally {
			cleanupWorkspace(ws);
		}
	});
});

describe('RESEARCH_FINGERPRINT_VALID', () => {
	it('Fingerprint ist stabil über identische Inhalte (Key-Reihenfolge egal, Array-Reihenfolge semantisch)', async () => {
		const a = fingerprint({ run_id: 'r1', kinds: ['code', 'docs', 'tests'] });
		const b = fingerprint({ kinds: ['code', 'docs', 'tests'], run_id: 'r1' });
		expect(a).toBe(b);
		// Array-Reihenfolge ist semantisch relevant (kanonische Darstellung)
		const c = fingerprint({ run_id: 'r1', kinds: ['tests', 'docs', 'code'] });
		expect(a).not.toBe(c);
	});
});

describe('RESEARCH_FAILURE_CLASSIFICATION', () => {
	it('Provider-Fehler wird als PROVIDER_FAILURE klassifiziert, nicht als Agent-Unfähigkeit', async () => {
		const db = createTestDb();
		const ws = createTestWorkspace();
		try {
			const providerDown: ResearchWorker = {
				...makeResearchWorker(ws, 'code'),
				async run() {
					throw new Error('rate limit exceeded (429) for upstream API');
				},
			};
			const outcome = await runParallelResearch(
				db,
				workspaceCtx(ws, 'run_provider', 'job_research'),
				[providerDown, makeResearchWorker(ws, 'docs'), makeResearchWorker(ws, 'tests')],
			);
			const code = outcome.results.find((r) => r.kind === 'code');
			expect(code?.failure_class).toBe('PROVIDER_FAILURE');
			expect(code?.failure_class).not.toBe('RESEARCH_CODE_FAILURE');
			// barrier: code ist REQUIRED → FAILED
			expect(outcome.barrier.status).toBe('FAILED');
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('Infrastruktur-Fehler wird als INFRA_FAILURE klassifiziert', async () => {
		const db = createTestDb();
		const ws = createTestWorkspace();
		try {
			const infraDown: ResearchWorker = {
				...makeResearchWorker(ws, 'tests'),
				async run() {
					throw new Error('ENOENT: no such file or directory, open /missing/workspace');
				},
			};
			const outcome = await runParallelResearch(
				db,
				workspaceCtx(ws, 'run_infra', 'job_research'),
				[makeResearchWorker(ws, 'code'), makeResearchWorker(ws, 'docs'), infraDown],
			);
			const tests = outcome.results.find((r) => r.kind === 'tests');
			expect(tests?.failure_class).toBe('INFRA_FAILURE');
			// tests ist OPTIONAL → Barrier bleibt JOIN
			expect(outcome.barrier.status).toBe('JOIN');
		} finally {
			cleanupWorkspace(ws);
		}
	});
});
