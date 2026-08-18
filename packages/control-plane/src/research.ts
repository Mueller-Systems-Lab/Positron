// Positron Control Plane — Real Fan-out/Join für strukturierte Research
//
// Research läuft als echte parallele Worker (code / docs / tests).
// Parallelität wird NICHT über Code-Struktur behauptet, sondern über die
// tatsächliche zeitliche Überschneidung der Ausführungen bewiesen
// (dieselbe Primitive wie bei den Reviews, siehe parallelism.ts).
//
// Join (Research Barrier): deterministische Semantik
//   REQUIRED  — Worker ist für den Run zwingend (code)
//   OPTIONAL  — Worker ist unterstützend (docs, tests)
//   FAILED    — REQUIRED-Worker fehlgeschlagen → Barrier FAILED
//   TIMEOUT   — REQUIRED-Worker überschritten → Barrier TIMEOUT
//   BLOCKED   — Worker blockiert (z. B. Security/Contract) → Barrier BLOCKED
//
// Ergebnis ist ein strukturierter positron.research.v1 Batch-Contract.
// Provider-Ausfälle werden über classifyFailure klassifiziert — niemals als
// "Agent incapable".

import type Database from 'better-sqlite3';
import { validateContract } from './contracts.js';
import type { FailureClass, ResearchBatchContract } from './contracts.js';
import { classifyFailure } from './failure.js';
import { fingerprint } from './fingerprint.js';
import { assertRealParallelism, observedOverlapMs } from './parallelism.js';
import type { ParallelExecutionSlice, ParallelismVerdict } from './parallelism.js';
import { completeAttempt, createAttempt } from './store.js';
import type { AttemptRecord } from './store.js';

export type ResearchKind = 'code' | 'docs' | 'tests';

/** Deterministische, strukturierte Ausgabe eines Research-Workers. */
export interface ResearchWorkerOutput {
	summary_ref: string;
	sources?: string[];
	notes?: string;
}

export interface ResearchWorker {
	kind: ResearchKind;
	workerType: string;
	/**
	 * Provider/Modell nur, wenn fachlich belastbar (z. B. aus dem
	 * Execution Adapter). Sonst explizit null — nicht erfinden.
	 */
	provider: string | null;
	model: string | null;
	/** true → Barrier-Freigabe erforderlich; false → unterstützend */
	required: boolean;
	/** Führt die Research-Arbeit aus und liefert strukturierte Ergebnisse. */
	run(ctx: {
		run_id: string;
		job_id: string;
		attempt_id: string;
		workspacePath: string;
	}): Promise<ResearchWorkerOutput>;
}

export interface ParallelResearchResult extends ParallelExecutionSlice {
	kind: ResearchKind;
	workerType: string;
	provider: string | null;
	model: string | null;
	/** true → Barrier-Freigabe erforderlich; false → unterstützend */
	required: boolean;
	status: 'SUCCEEDED' | 'FAILED' | 'TIMEOUT' | 'BLOCKED';
	failure_class: FailureClass | null;
	failure_signature: string | null;
	output: ResearchWorkerOutput | null;
}

export type ResearchBarrierStatus = 'JOIN' | 'FAILED' | 'TIMEOUT' | 'BLOCKED';

export interface ResearchBarrierDecision {
	status: ResearchBarrierStatus;
	reason_code: string;
	detail?: string;
}

export interface ParallelResearchOutcome {
	results: ParallelResearchResult[];
	verdict: ParallelismVerdict;
	barrier: ResearchBarrierDecision;
	/** Basis für den Research-Batch-Contract */
	researchBatch: ResearchBatchContract;
	batchFingerprint: string;
}

export interface ResearchRunOptions {
	/** Timeout je Worker (ms). 0/undefined → kein Timeout. */
	timeoutMs?: number;
	/**
	 * Explizit SEQUENTIELLE Ausführung (kontrollierter Negative-Canary).
	 * Worker laufen strikt nacheinander; die Zeitstempel werden real
	 * gemessen → assertRealParallelism ergibt NOT_PROVEN aus echten Zeiten.
	 * Kein künstliches PASS, keine Zeitmanipulation.
	 */
	sequential?: boolean;
}

function nowIso(): string {
	return new Date().toISOString();
}

const FAILURE_CLASS_BY_KIND: Record<ResearchKind, FailureClass> = {
	code: 'RESEARCH_CODE_FAILURE',
	docs: 'RESEARCH_DOCS_FAILURE',
	tests: 'RESEARCH_TESTS_FAILURE',
};

/**
 * Deterministische Research Barrier:
 * - BLOCKED gewinnt (Security/Contract-artige Blockade)
 * - dann TIMEOUT, dann FAILED — jeweils nur für REQUIRED-Worker
 * - OPTIONAL-Worker-Fehler werden toleriert (bleiben im Contract sichtbar)
 * - sonst JOIN (alle REQUIRED erfolgreich)
 */
export function evaluateResearchBarrier(
	results: ParallelResearchResult[],
): ResearchBarrierDecision {
	const blocked = results.find((r) => r.status === 'BLOCKED');
	if (blocked) {
		return {
			status: 'BLOCKED',
			reason_code: `RESEARCH_BLOCKED_${blocked.kind.toUpperCase()}`,
			detail: blocked.failure_signature ?? undefined,
		};
	}
	for (const r of results) {
		if (!r.required) continue;
		if (r.status === 'TIMEOUT') {
			return {
				status: 'TIMEOUT',
				reason_code: `RESEARCH_TIMEOUT_${r.kind.toUpperCase()}`,
				detail: r.failure_signature ?? undefined,
			};
		}
	}
	for (const r of results) {
		if (!r.required) continue;
		if (r.status === 'FAILED') {
			return {
				status: 'FAILED',
				reason_code: `RESEARCH_FAILURE_${r.kind.toUpperCase()}`,
				detail: r.failure_signature ?? undefined,
			};
		}
	}
	return { status: 'JOIN', reason_code: 'RESEARCH_JOIN' };
}

/**
 * Führt Research-Worker real parallel aus (Fan-out) und schließt mit der
 * Research Barrier ab (Join). Jeder Worker läuft in einem eigenen Attempt
 * des Research-Jobs (Telemetrie: started_at/ended_at/duration_ms,
 * provider/model, failure_class).
 */
export async function runParallelResearch(
	db: Database.Database,
	ctx: { run_id: string; job_id: string; workspacePath: string; repositoryRef: string; repositoryHead: string },
	workers: ResearchWorker[],
	options: ResearchRunOptions = {},
): Promise<ParallelResearchOutcome> {
	const startedAll = Date.now();

	const executeOne = async (worker: ResearchWorker): Promise<ParallelResearchResult> => {
		const startedAt = nowIso();
		const attempt = createAttempt(db, ctx.run_id, ctx.job_id, {
			worker_type: worker.workerType,
			provider: worker.provider,
			model: worker.model,
			input_contract: 'positron.research.v1',
			input_fingerprint: fingerprint({ kind: worker.kind, run: ctx.run_id }),
		});

		const runWithTimeout = async (): Promise<ResearchWorkerOutput> => {
			if (options.timeoutMs && options.timeoutMs > 0) {
				let timer: ReturnType<typeof setTimeout> | undefined;
				try {
					return await Promise.race([
						worker.run({
							run_id: ctx.run_id,
							job_id: ctx.job_id,
							attempt_id: attempt.attempt_id,
							workspacePath: ctx.workspacePath,
						}),
						new Promise<never>((_, reject) => {
							timer = setTimeout(
								() => reject(new Error(`RESEARCH_TIMEOUT: ${worker.kind}`)),
								options.timeoutMs,
							);
						}),
					]);
				} finally {
					if (timer) clearTimeout(timer);
				}
			}
			return worker.run({
				run_id: ctx.run_id,
				job_id: ctx.job_id,
				attempt_id: attempt.attempt_id,
				workspacePath: ctx.workspacePath,
			});
		};

		try {
			const output = await runWithTimeout();
			const endedAt = nowIso();
			const durationMs = Date.now() - new Date(startedAt).getTime();
			completeAttempt(db, attempt.attempt_id, {
				status: 'succeeded',
				output_contract: 'positron.research.v1',
				output_fingerprint: fingerprint(output),
				output_json: JSON.stringify(output),
				ended_at: endedAt,
			});
			return {
				kind: worker.kind,
				workerType: worker.workerType,
				provider: worker.provider,
				model: worker.model,
				required: worker.required,
				status: 'SUCCEEDED' as const,
				failure_class: null,
				failure_signature: null,
				output,
				started_at: startedAt,
				ended_at: endedAt,
				duration_ms: durationMs,
			};
		} catch (err) {
			const endedAt = nowIso();
			const durationMs = Date.now() - new Date(startedAt).getTime();
			const errMsg = String(err);
			const isTimeout = /RESEARCH_TIMEOUT/.test(errMsg) || /timed out|Timeout/i.test(errMsg);
			const status = isTimeout ? 'TIMEOUT' : 'FAILED';
			// Provider-/Infrastrukturfehler deterministisch klassifizieren —
			// niemals als "Agent incapable". Unbekannte Fehler fallen auf die
			// kind-spezifische Research-Failure-Klasse (RESEARCH_*_FAILURE).
			const classified = classifyFailure({ stderr: errMsg, timeout: isTimeout });
			const failureClass = isTimeout
				? ('TIMEOUT' as FailureClass)
				: classified.signature === 'PROVIDER_FAILURE' ||
						classified.signature === 'INFRA_FAILURE' ||
						classified.signature === 'CONTRACT_FAILURE'
					? (classified.signature as FailureClass)
					: FAILURE_CLASS_BY_KIND[worker.kind];
			completeAttempt(db, attempt.attempt_id, {
				status: 'failed',
				failure_class: failureClass,
				failure_signature: `research-${worker.kind}-error:${errMsg.slice(0, 200)}`,
				ended_at: endedAt,
			});
			return {
				kind: worker.kind,
				workerType: worker.workerType,
				provider: worker.provider,
				model: worker.model,
				required: worker.required,
				status,
				failure_class: failureClass,
				failure_signature: errMsg.slice(0, 300),
				output: null,
				started_at: startedAt,
				ended_at: endedAt,
				duration_ms: durationMs,
			};
		}
	};

	// Fan-out: real parallel (Promise.all) ODER explizit sequentiell
	// (kontrollierter Negative-Canary — Zeitstempel werden in beiden Fällen
	// real gemessen; der Verdict folgt ausschließlich daraus).
	const results = options.sequential
		? await (async () => {
				const collected: ParallelResearchResult[] = [];
				for (const worker of workers) {
					collected.push(await executeOne(worker));
				}
				return collected;
			})()
		: await Promise.all(workers.map((worker) => executeOne(worker)));

	const barrier = evaluateResearchBarrier(results);
	const verdict = assertRealParallelism(results);
	const overlapMs = observedOverlapMs(results);
	const startedAt = new Date(Math.min(...results.map((r) => new Date(r.started_at).getTime())))
		.toISOString();
	const endedAt = new Date(Math.max(...results.map((r) => new Date(r.ended_at).getTime())))
		.toISOString();

	const entryOf = (kind: ResearchKind): ResearchBatchContract['results']['code'] => {
		const r = results.find((res) => res.kind === kind);
		if (!r) {
			return { status: 'SKIPPED', summary_ref: '' };
		}
		return {
			status: r.status,
			summary_ref: r.output?.summary_ref ?? '',
			sources: r.output?.sources,
			started_at: r.started_at,
			ended_at: r.ended_at,
			duration_ms: r.duration_ms,
		};
	};

	const researchBatch: ResearchBatchContract = {
		contract: 'positron.research.v1',
		run_id: ctx.run_id,
		repository_ref: ctx.repositoryRef,
		repository_head: ctx.repositoryHead,
		summary_ref: results
			.filter((r): r is ParallelResearchResult & { output: ResearchWorkerOutput } => r.output !== null)
			.map((r) => r.output.summary_ref)
			.sort()
			.join('|'),
		sources: results.flatMap((r) => r.output?.sources ?? []),
		results: {
			code: entryOf('code'),
			docs: entryOf('docs'),
			tests: entryOf('tests'),
		},
		parallelism: {
			verdict,
			observed_overlap_ms: overlapMs,
		},
		started_at: startedAt,
		ended_at: endedAt,
		context_fingerprint: fingerprint({ kinds: workers.map((w) => w.kind).sort(), run: ctx.run_id }),
	};

	const batchValidation = validateContract('positron.research.v1', researchBatch);
	if (!batchValidation.ok) {
		throw new Error(
			`INTERNAL: research-batch contract invalid: ${batchValidation.errors.join('; ')}`,
		);
	}

	void startedAll;

	return {
		results,
		verdict,
		barrier,
		researchBatch,
		batchFingerprint: fingerprint(researchBatch),
	};
}

/**
 * Sammelt die Attempts eines Research-Jobs (Telemetrie je Worker).
 */
export function listResearchAttempts(db: Database.Database, jobId: string): AttemptRecord[] {
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
	}));
}
