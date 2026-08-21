// Positron Control Plane — Durable Run Orchestration
//
// Die zentrale Runtime-Schleife der Control Plane:
//
//   ISSUE → INTAKE → BASELINE → RESEARCH → PLAN → PLAN_GATE → BUILD → VERIFY → REVIEW → DECIDE
//
// Prinzip: POSITRON entscheidet. Der Build-Worker (LLM) liefert Code-Änderungen,
// Tools (TestRunner etc.) messen, die Policy-Module entscheiden.
//
// Eigenschaften:
// - Jeder Run/Job/Attempt wird persistent in der SQLite-DB gespeichert
// - Mutierende Schritte sind idempotent (IdempotencyRegistry)
// - Retry nur bei Information Gain (Retry Policy)
// - Recovery: abgeschlossene Jobs werden nicht erneut ausgeführt
// - Entscheidung kommt ausschließlich aus der Decision Policy

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { validateContract } from './contracts.js';
import type {
	BuildInputContract,
	BuildResultContract,
	DecisionContract,
	FindingContract,
	PlanContract,
	RunEventContract,
	VerificationContract,
} from './contracts.js';
import type { VerificationCheck } from './contracts.js';
import {
	CancellationError,
	createCancellationSource,
	startLeaseHeartbeat,
	withCancellableTimeout,
} from './cancellation.js';
import { buildDecision } from './decision-policy.js';
import { assertAttemptActive, assertExecutionContext } from './execution-context.js';
import { classifyFailure } from './failure.js';
import { fingerprint } from './fingerprint.js';
import { resolveHarnessProfileFromEnv } from './harness-profile.js';
import { IdempotencyRegistry, idempotencyKey } from './idempotency.js';
import { assertRealParallelism } from './parallelism.js';
import { evaluatePlanGate } from './plan-gate.js';
import { runParallelResearch } from './research.js';
import type {
	ParallelResearchOutcome,
	ParallelResearchResult,
	ResearchRunOptions,
	ResearchWorker,
	ResearchWorkerOutput,
} from './research.js';
import { evaluateRetry } from './retry-policy.js';
import { runParallelReviews } from './review.js';
import type { ParallelReviewResult, ParallelismVerdict, ReviewWorker } from './review.js';
import { applyControlPlaneMigrations } from './schema.js';
import {
	claimAttempt,
	claimAttemptWithGeneration,
	completeAttempt,
	createAttempt,
	createId,
	createJob,
	getAttempt,
	getJob,
	listAttempts,
	listDecisions,
	listJobAttempts,
	listJobs,
	recoverStaleLeases,
	renewAttemptLease,
	storeDecision,
	storeTransition,
	updateJobState,
} from './store.js';
import type { AttemptRecord, JobRecord } from './store.js';
import { buildVerificationContract } from './verification.js';

// ---------------------------------------------------------------------------
// Issue Contract (Typ) — Struktur gemäß positron.issue.v1
// ---------------------------------------------------------------------------

export interface IssueContract {
	contract: 'positron.issue.v1';
	run_id: string;
	source_type: string;
	source_ref: string;
	repository_ref: string;
	title?: string;
	body_hash?: string;
}

// ---------------------------------------------------------------------------
// Worker-Abstraktion (Execution Adapter)
// ---------------------------------------------------------------------------

export interface BuildWorker {
	/** Stable worker identity for telemetry */
	workerType: string;
	provider: string | null;
	model: string | null;
	/**
	 * Implementiert einen Build-Auftrag. Der Worker MUSS echte Dateiänderungen
	 * im Workspace vornehmen (oder scheitern). Positron bewertet das Ergebnis
	 * ausschließlich über die anschließende deterministische Verification.
	 */
	implement(
		input: BuildInputContract & { strategyDelta?: string | null },
	): Promise<BuildResultContract>;
}

export interface VerificationTool {
	/** Führt die echten Checks aus (Tests, Build, Lint, Typecheck...) */
	run(input: {
		run_id: string;
		job_id: string;
		attempt_id: string;
		workspacePath: string;
	}): Promise<{ checks: VerificationCheck[]; new_evidence?: string }>;
}

/**
 * Plan-Worker (fachlich read-only): erzeugt den Plan (positron.plan.v1)
 * über die produktiven Kanäle (OpenCode `speckit.plan` / SpecKit).
 * SPECIFY/TASKS/ANALYZE sind interne CLI-Schritte des atomaren fachlichen
 * plan-Workers (§9/§19/§20: die fachliche Boundary zählt, nicht jeder
 * CLI-Aufruf).
 */
export interface PlanWorker {
	/** Stable worker identity for telemetry */
	workerType: string;
	provider: string | null;
	model: string | null;
	/** Führt die Plan-Erstellung aus und liefert einen validen Plan-Contract. */
	run(ctx: {
		run_id: string;
		job_id: string;
		attempt_id: string;
		workspacePath: string;
		issue: IssueContract;
	}): Promise<PlanContract>;
}

export interface DurableRunDeps {
	db: Database.Database;
	/** Workspace (echtes Repository) */
	workspace: {
		path: string;
		repositoryRef: string;
		/** HEAD wird beim BASELINE-Job real gelesen */
		readHead?: (workspacePath: string) => string;
	};
	buildWorker: BuildWorker;
	verifyTool: VerificationTool;
	/** Findings werden von einem deterministischen/strukturierten Review geliefert */
	reviewFindings: () => Promise<FindingContract[]>;
	/** Optional: echte parallele Review-Worker (Fan-out/Join mit Parallelitäts-Beweis) */
	reviewWorkers?: ReviewWorker[];
	/** Optional: echte parallele Research-Worker (code/docs/tests, Fan-out/Join mit Parallelitäts-Beweis) */
	researchWorkers?: ResearchWorker[];
	/** Optionen für den Research-Fan-out (z. B. kontrollierter sequentieller Canary) */
	researchOptions?: ResearchRunOptions;
	/**
	 * Optional: Plan-Worker (produktive Plan-Erzeugung). Ohne PlanWorker
	 * wird der Plan aus dem Input übernommen (Kompatibilität mit Tests) —
	 * der plan-Job/Attempt wird in beiden Fällen vollständig persistiert.
	 */
	planWorker?: PlanWorker;
	/** Deterministischer Timeout für Build-/Verify-Worker (ms). 0/undefined → kein Timeout. */
	timeoutMs?: number;
	maxAttempts: number;
}

// ---------------------------------------------------------------------------
// Run-Kontext
// ---------------------------------------------------------------------------

export interface DurableRunResult {
	runId: string;
	decision: DecisionContract;
	jobs: JobRecord[];
	attempts: AttemptRecord[];
	transitions: Array<{ previous: string; next: string; reason_code: string }>;
	/** Anzahl der tatsächlichen Worker-Aufrufe (Canary-Evidenz) */
	workerInvocations: number;
}

export interface DurableRunInput {
	issue: IssueContract;
	plan: PlanContract;
	/** Simulierter Crash-Punkt: nach diesem Job abbrechen (Recovery-Test) */
	crashAfterJob?: string;
}

function readRepositoryHead(workspacePath: string): string {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: workspacePath,
			encoding: 'utf-8',
		}).trim();
	} catch {
		throw new Error(`INFRA_FAILURE: cannot read git HEAD in ${workspacePath}`);
	}
}

function emitEvent(event: RunEventContract): void {
	// run-events werden über den bestehenden run_events-Mechanismus der Pipeline
	// gespeichert; hier nur strukturiert erfasst (contract validated).
	const result = validateContract('positron.run-event.v1', event);
	if (!result.ok) {
		throw new Error(`INTERNAL: run-event contract invalid: ${result.errors.join('; ')}`);
	}
}

// ---------------------------------------------------------------------------
// Timeout-Semantik (P3.5/Phase B): Timeouts lösen echte Cancellation aus.
// `withCancellableTimeout` (cancellation.ts) ersetzt das P3-`Promise.race`:
// beim Timeout wird der AbortSignal-basierte Cancellation-Contract ausgelöst
// und der owned Child-Prozess (falls registriert) graceful → forced beendet.
// Ein verspätetes Worker-Ergebnis kann den finalisierten Attempt nicht mehr
// überschreiben (Transition-Guard + Lease-Fencing in store.ts).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Recovery-Rekonstruktion (P3): completed worker aus persistierten Attempts
// rekonstruieren — NIE erneut ausführen (Recovery A/E).
// ---------------------------------------------------------------------------

function reconstructResearchResult(attempt: AttemptRecord): ParallelResearchResult | null {
	if (attempt.status !== 'succeeded' || !attempt.output_json) return null;
	try {
		const output = JSON.parse(attempt.output_json) as ResearchWorkerOutput;
		const kind =
			(attempt.worker_type?.split('.').at(-1) as ParallelResearchResult['kind']) ?? 'code';
		const startedAt = attempt.started_at ?? '';
		const endedAt = attempt.ended_at ?? startedAt;
		return {
			kind,
			workerType: attempt.worker_type ?? `research.${kind}`,
			provider: attempt.provider,
			model: attempt.model,
			// Rekonstruierte Attempts sind immer SUCCEEDED — `required` ist für
			// die Barrier-Bewertung rekonstruierter Worker irrelevant, da ein
			// erfolgreicher REQUIRED-Worker die Barrier ohnehin besteht.
			required: true,
			status: 'SUCCEEDED',
			failure_class: null,
			failure_signature: null,
			output,
			started_at: startedAt,
			ended_at: endedAt,
			duration_ms: endedAt
				? Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime())
				: 0,
		};
	} catch {
		return null;
	}
}

function reviewKindFromWorkerType(
	workerType: string | null,
): 'correctness' | 'security' | 'quality' {
	const tail = workerType?.split('.').at(-1);
	if (tail === 'security' || tail === 'quality') return tail;
	return 'correctness';
}

function reconstructReviewResult(attempt: AttemptRecord): ParallelReviewResult | null {
	if (attempt.status !== 'succeeded' || !attempt.output_json) return null;
	try {
		const findings = JSON.parse(attempt.output_json) as FindingContract[];
		const kind = reviewKindFromWorkerType(attempt.worker_type);
		const startedAt = attempt.started_at ?? '';
		const endedAt = attempt.ended_at ?? startedAt;
		return {
			kind,
			workerType: attempt.worker_type ?? `review.${kind}`,
			findings,
			started_at: startedAt,
			ended_at: endedAt,
			duration_ms: endedAt
				? Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime())
				: 0,
		};
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Verify-Schritt (P3): persistenter verify-Job + Attempt je Build-Attempt.
// Recovery D: ein bereits verifizierter Build-Attempt wird NICHT erneut
// verifiziert (Rehydratation aus output_json); Recovery C: ein succeeded
// Build-Attempt ohne verify bekommt NUR den Verify-Schritt nachgezogen.
// ---------------------------------------------------------------------------

interface VerifyStepOutcome {
	verification: VerificationContract | null;
	outcome: 'pass' | 'fail' | 'contract' | 'timeout';
	reason: string;
}

async function runVerifyStep(
	db: Database.Database,
	runId: string,
	buildJobId: string,
	buildAttempt: AttemptRecord,
	deps: DurableRunDeps,
	trackTransition: (next: string, reasonCode: string) => void,
	ownerId: string,
): Promise<VerifyStepOutcome> {
	// Verify-Job find-or-create für DIESEN build-attempt (via input fingerprint)
	const verifyInputFingerprint = fingerprint({
		attempt: buildAttempt.attempt_id,
		workspace: deps.workspace.path,
	});
	const existingVerifyJobs = listJobs(db, runId).filter(
		(j) => j.job_type === 'verify' && j.parent_job_id === buildJobId,
	);
	for (const vj of existingVerifyJobs) {
		const last = listJobAttempts(db, vj.job_id).at(-1);
		if (last?.input_fingerprint === verifyInputFingerprint && last.output_json) {
			try {
				const verification = JSON.parse(last.output_json) as VerificationContract;
				if (last.status === 'succeeded' || last.status === 'failed') {
					return {
						verification,
						outcome: verification.passed ? 'pass' : 'fail',
						reason: 'recovered',
					};
				}
			} catch {
				// verworfen → neuer Versuch
			}
		}
	}

	const verifyJob = createJob(db, runId, 'verify', buildJobId);
	const verifyAttempt = createAttempt(db, runId, verifyJob.job_id, {
		status: 'pending',
		worker_type: 'deterministic-tools',
		provider: null,
		model: null,
		input_contract: 'positron.verification.v1',
		input_fingerprint: verifyInputFingerprint,
	});
	const leaseTtlMs = deps.timeoutMs ? deps.timeoutMs + 15_000 : 0;
	const claim = claimAttemptWithGeneration(db, verifyAttempt.attempt_id, {
		ownerId,
		leaseTtlMs: leaseTtlMs || undefined,
	});
	if (!claim.claimed) {
		return { verification: null, outcome: 'contract', reason: 'verify claim denied' };
	}
	const verifyGeneration = claim.generation;
	// Review-Fix (R1-MAJOR Heartbeat): Lease während langer Verify-Arbeit
	// erneuern (TTL/3-Intervall), damit die Lease nicht während der Arbeit
	// abläuft und ein anderer Controller den Attempt reklaimt.
	const heartbeatCancellation = createCancellationSource();
	const heartbeat = leaseTtlMs
		? startLeaseHeartbeat(
				heartbeatCancellation,
				() => {
					renewAttemptLease(db, verifyAttempt.attempt_id, ownerId, leaseTtlMs);
				},
				leaseTtlMs,
			)
		: null;
	// P3: Tool-/Worker-Aufruf nur innerhalb eines aktiven Attempts.
	assertExecutionContext({
		run_id: runId,
		job_id: verifyJob.job_id,
		attempt_id: verifyAttempt.attempt_id,
	});
	assertAttemptActive(db, verifyAttempt.attempt_id, ownerId);

	const cancellation = createCancellationSource();
	const timed = await withCancellableTimeout(
		(async () => {
			try {
				return await deps.verifyTool.run({
					run_id: runId,
					job_id: verifyJob.job_id,
					attempt_id: verifyAttempt.attempt_id,
					workspacePath: deps.workspace.path,
				});
			} catch (err) {
				if (err instanceof CancellationError) {
					throw err;
				}
				// P3 (Security-Review F2): Worker-Rejection → Attempt finalisieren,
				// kein Zombie-Attempt, keine unhandled rejection.
				const errMsg = err instanceof Error ? err.message : String(err);
				completeAttempt(
					db,
					verifyAttempt.attempt_id,
					{
						status: 'failed',
						failure_class: 'INFRA_FAILURE',
						failure_signature: `verify-rejected:${errMsg.slice(0, 200)}`,
					},
					{ fencingOwnerId: ownerId, fencingGeneration: verifyGeneration },
				);
				updateJobState(db, verifyJob.job_id, 'failed');
				return { rejected: true, message: errMsg.slice(0, 200) };
			}
		})(),
		deps.timeoutMs,
		cancellation,
	);
	if (!timed.ok) {
		// Deterministischer Timeout: Attempt endet final (timed_out); ein
		// verspätetes Ergebnis wird vom Transition-Guard verworfen.
		heartbeat?.stop();
		completeAttempt(
			db,
			verifyAttempt.attempt_id,
			{
				status: 'timed_out',
				failure_class: 'TIMEOUT',
				failure_signature: `verify-timeout-${deps.timeoutMs ?? 0}ms`,
			},
			{ fencingOwnerId: ownerId, fencingGeneration: verifyGeneration },
		);
		updateJobState(db, verifyJob.job_id, 'failed');
		return {
			verification: null,
			outcome: 'timeout',
			reason: `verify-timeout-${deps.timeoutMs ?? 0}ms`,
		};
	}
	if ('rejected' in timed.value) {
		// Verify-Worker hat geworfen → Attempt bereits finalisiert (failed).
		heartbeat?.stop();
		return { verification: null, outcome: 'contract', reason: timed.value.message };
	}

	const builtVerification = buildVerificationContract({
		run_id: runId,
		job_id: verifyJob.job_id,
		attempt_id: verifyAttempt.attempt_id,
		checks: timed.value.checks,
		new_evidence: timed.value.new_evidence,
	});
	const verifyValidation = validateContract('positron.verification.v1', builtVerification);
	if (!verifyValidation.ok) {
		heartbeat?.stop();
		completeAttempt(
			db,
			verifyAttempt.attempt_id,
			{
				status: 'blocked',
				failure_class: 'CONTRACT_FAILURE',
				failure_signature: verifyValidation.errors.join('|'),
			},
			{ fencingOwnerId: ownerId, fencingGeneration: verifyGeneration },
		);
		updateJobState(db, verifyJob.job_id, 'blocked');
		return {
			verification: null,
			outcome: 'contract',
			reason: verifyValidation.errors.join('|'),
		};
	}
	completeAttempt(
		db,
		verifyAttempt.attempt_id,
		{
			status: builtVerification.passed ? 'succeeded' : 'failed',
			output_contract: builtVerification.contract,
			output_fingerprint: fingerprint(builtVerification),
			output_json: JSON.stringify(builtVerification),
			failure_class: builtVerification.failure_class ?? null,
			failure_signature: builtVerification.failure_signature ?? null,
			new_evidence: builtVerification.new_evidence ?? null,
		},
		{ fencingOwnerId: ownerId, fencingGeneration: verifyGeneration },
	);
	heartbeat?.stop();
	updateJobState(db, verifyJob.job_id, builtVerification.passed ? 'succeeded' : 'failed');
	trackTransition('VERIFY', builtVerification.passed ? 'VERIFY_PASS' : 'VERIFY_FAIL');
	return {
		verification: builtVerification,
		outcome: builtVerification.passed ? 'pass' : 'fail',
		reason: 'verified',
	};
}

// ---------------------------------------------------------------------------
// Orchestrierung
// ---------------------------------------------------------------------------

/**
 * Führt einen durable Run aus (vollständig, inkl. FIX-Zyklen).
 *
 * Ablauf:
 * 1. INTAKE — Run wird angelegt (run_id)
 * 2. BASELINE — repository_head wird REAL gelesen (git rev-parse)
 * 3. PLAN — Plan wird als positron.plan.v1 validiert
 * 4. PLAN_GATE — deterministisches Gate (APPROVED required)
 * 5. BUILD — Build-Job mit Attempts; jeder Attempt idempotent
 * 6. VERIFY — deterministische Verification (echte Tools)
 * 7. REVIEW — strukturierte Findings
 * 8. DECIDE — Decision Policy (DONE/FIX/SPLIT/BLOCKED)
 *
 * FIX-Zyklus: Bei VERIFY-Fehler entscheidet die Retry Policy anhand des
 * Information Gain, ob ein neuer Attempt startet (immer neuer attempt_id,
 * Historie bleibt vollständig).
 */
export async function runDurableRun(
	deps: DurableRunDeps,
	input: DurableRunInput,
): Promise<DurableRunResult> {
	const db = deps.db;
	const runId = input.issue.run_id;
	// Review-Fix (R1-MAJOR Fencing): Owner-ID ist INSTANZ-scoped — ein
	// zweiter Controller-Prozess (Recovery/Retry) hat eine andere Instanz-ID
	// und kann den ersten real ausfencen (run-scoped `controller:<runId>`
	// wäre zwischen zwei Prozessen identisch und Fencing wirkungslos).
	const controllerInstanceId = `ctl:${runId}:${createId('inst').split('_').at(-1)}`;
	// Stale-Lease-Recovery beim Run-Start (Review-Fix R1-MAJOR Heartbeat):
	// abgelaufene Leases DIESES Runs (jede Instanz, Prefix-Match) werden
	// finalisiert — kein Zombie-Besitzer kann später noch mutieren.
	recoverStaleLeases(db, { ownerIdPrefix: `ctl:${runId}:` });
	applyControlPlaneMigrations(db);
	const idem = new IdempotencyRegistry(db);

	const transitions: DurableRunResult['transitions'] = [];
	let lastState = 'INTAKE';

	const trackTransition = (next: string, reasonCode: string): void => {
		storeTransition(db, runId, lastState, next, reasonCode);
		transitions.push({ previous: lastState, next, reason_code: reasonCode });
		emitEvent({
			contract: 'positron.run-event.v1',
			run_id: runId,
			timestamp: new Date().toISOString(),
			previous_state: lastState,
			new_state: next,
			reason_code: reasonCode,
			level: 'INFO',
		});
		lastState = next;
	};

	// ── INTAKE (find-or-create: Recovery erzeugt keinen zweiten intake-Job) ─
	const existingIntakeJob = listJobs(db, runId).find((j) => j.job_type === 'intake');
	const intakeJob = existingIntakeJob ?? createJob(db, runId, 'intake');
	if (!existingIntakeJob) {
		updateJobState(db, intakeJob.job_id, 'succeeded');
		trackTransition('INTAKE', 'RUN_CREATED');
	}

	// Worker-Aufruf-Zähler (Build-Canary-Evidenz; je Worker-Typ zusätzlich
	// Attempt-Zählung über cp_attempts — §20 ATTEMPT_OWNERSHIP).
	let workerInvocations = 0;

	// ── BASELINE (durable, read-only, mit Attempt) ──────────────────────────
	// Recovery: abgeschlossener baseline-Job wird NIE erneut ausgeführt; der
	// persistierte repository_head wird beim Resume wiederverwendet
	// (Konsistenz mit den persistierten Attempts).
	const existingBaselineJob = listJobs(db, runId).find((j) => j.job_type === 'baseline');
	const baselineJob = existingBaselineJob ?? createJob(db, runId, 'baseline');
	let baselineHead: string;
	if (baselineJob.state === 'succeeded') {
		const baselineAttempt = listJobAttempts(db, baselineJob.job_id).at(-1) ?? null;
		if (baselineAttempt?.output_json) {
			try {
				const baselineDoc = JSON.parse(baselineAttempt.output_json) as {
					repository_head?: string;
				};
				baselineHead = baselineDoc.repository_head ?? '';
			} catch {
				baselineHead = '';
			}
		} else {
			baselineHead = '';
		}
		if (!baselineHead) {
			throw new Error('INTERNAL: baseline job succeeded but repository_head not persisted');
		}
	} else {
		updateJobState(db, baselineJob.job_id, 'running');
		const baselineAttempt = createAttempt(db, runId, baselineJob.job_id, {
			status: 'pending',
			worker_type: 'deterministic.baseline',
			provider: null,
			model: null,
			input_contract: 'positron.baseline.v1',
			input_fingerprint: fingerprint({
				run_id: runId,
				repository_ref: deps.workspace.repositoryRef,
				workspace: deps.workspace.path,
			}),
		});
		// P3: deterministischer Worker läuft nur in geclaimtem Attempt.
		assertExecutionContext({
			run_id: runId,
			job_id: baselineJob.job_id,
			attempt_id: baselineAttempt.attempt_id,
		});
		if (!claimAttempt(db, baselineAttempt.attempt_id)) {
			throw new Error('INTERNAL: baseline attempt claim failed');
		}
		baselineHead = deps.workspace.readHead
			? deps.workspace.readHead(deps.workspace.path)
			: readRepositoryHead(deps.workspace.path);
		const baselineDoc = {
			contract: 'positron.baseline.v1',
			run_id: runId,
			repository_ref: deps.workspace.repositoryRef,
			repository_head: baselineHead,
			workspace_path: deps.workspace.path,
			clean: false,
			changed_files: [],
		};
		const baselineValidation = validateContract('positron.baseline.v1', baselineDoc);
		if (!baselineValidation.ok) {
			completeAttempt(db, baselineAttempt.attempt_id, {
				status: 'blocked',
				failure_class: 'CONTRACT_FAILURE',
				failure_signature: baselineValidation.errors.join('|'),
			});
			updateJobState(db, baselineJob.job_id, 'blocked');
			throw new Error('INFRA_FAILURE: baseline contract invalid');
		}
		completeAttempt(db, baselineAttempt.attempt_id, {
			status: 'succeeded',
			output_contract: 'positron.baseline.v1',
			output_fingerprint: fingerprint(baselineDoc),
			output_json: JSON.stringify(baselineDoc),
			result_ref: baselineHead,
		});
		updateJobState(db, baselineJob.job_id, 'succeeded');
		trackTransition('BASELINE', 'BASELINE_OK');
	}

	// ── RESEARCH (Fan-out/Join, Recovery-aware) ─────────────────────────────
	// Drei logisch unabhängige Worker (code/docs/tests) laufen real parallel.
	// Parallelität wird über tatsächliche Zeit-Überlappung bewiesen
	// (assertRealParallelism auf persistierte started_at/ended_at).
	const researchJob =
		listJobs(db, runId).find((j) => j.job_type === 'research') ?? createJob(db, runId, 'research');
	const researchAttempts = listJobAttempts(db, researchJob.job_id);
	// Recovery-Boundary konsistent zum Build/Verify-Muster: research ist nur
	// dann abgeschlossen, wenn der JOB succeeded ist — ein einzelner
	// erfolgreicher OPTIONAL-Worker (bei fehlgeschlagenem REQUIRED-Worker)
	// genügt NICHT (der Run wäre sonst fälschlich freigegeben worden).
	const researchDone = researchJob.state === 'succeeded';
	let researchOutcome: ParallelResearchOutcome | null = null;
	/** Bei Recovery aus persistierten Zeitstempeln rekonstruierter Verdict */
	let researchVerdictFromRecovery: ParallelismVerdict | null = null;

	if (deps.researchWorkers && deps.researchWorkers.length > 0) {
		if (researchDone) {
			// Recovery: completed research wird NICHT erneut ausgeführt;
			// der Verdict wird aus den persistierten Zeitstempeln rekonstruiert.
			const succeeded = researchAttempts.filter(
				(a): a is AttemptRecord & { started_at: string; ended_at: string } =>
					a.status === 'succeeded' && a.started_at !== null && a.ended_at !== null,
			);
			researchOutcome = null;
			const verdict = assertRealParallelism(
				succeeded.map((a) => ({
					kind: a.worker_type ?? 'research',
					workerType: a.worker_type ?? 'research',
					started_at: a.started_at,
					ended_at: a.ended_at,
					duration_ms: 0,
				})),
			);
			trackTransition('RESEARCH', 'RESEARCH_RECOVERED');
			// Verdict fließt später in die Decision-Basis ein
			researchVerdictFromRecovery = verdict;
		} else {
			// P3-Recovery A (Attempt-Ebene): completed Worker werden aus den
			// persistierten Attempts rekonstruiert und NICHT erneut ausgeführt;
			// nur fehlende Worker starten.
			const recoveredResults = researchAttempts
				.map(reconstructResearchResult)
				.filter((r): r is ParallelResearchResult => r !== null);
			const recoveredKinds = new Set(recoveredResults.map((r) => r.kind));
			const pendingWorkers = deps.researchWorkers.filter((w) => !recoveredKinds.has(w.kind));

			if (pendingWorkers.length === 0) {
				// Alles recovered (Crash zwischen Attempt-Completion und
				// Job-State-Update): Job aus Persistenz schließen.
				updateJobState(db, researchJob.job_id, 'succeeded');
				researchVerdictFromRecovery = assertRealParallelism(recoveredResults);
				trackTransition('RESEARCH', 'RESEARCH_RECOVERED');
			} else {
				updateJobState(db, researchJob.job_id, 'running');
				researchOutcome = await runParallelResearch(
					db,
					{
						run_id: runId,
						job_id: researchJob.job_id,
						workspacePath: deps.workspace.path,
						repositoryRef: deps.workspace.repositoryRef,
						repositoryHead: baselineHead,
					},
					pendingWorkers,
					{ ...deps.researchOptions, recoveredResults },
				);
				if (researchOutcome.barrier.status === 'JOIN') {
					updateJobState(db, researchJob.job_id, 'succeeded');
					trackTransition('RESEARCH', 'RESEARCH_JOIN');
				} else {
					updateJobState(db, researchJob.job_id, 'failed');
					trackTransition('RESEARCH', researchOutcome.barrier.reason_code);
					const decision = buildDecision({
						run_id: runId,
						verification: null,
						findings: [],
						researchBarrier: researchOutcome.barrier.reason_code,
						researchParallelism: researchOutcome.verdict,
					});
					// Barrier-Reason auch in der Basis persistieren (Observability)
					decision.basis.research_barrier = researchOutcome.barrier.reason_code;
					return finishRun(db, runId, decision, transitions, 0);
				}
			}
		}
	}

	// Crash-Injection (Recovery-Test): Abbruch NACH abgeschlossenem
	// research-Job — valid Boundary; beim Resume wird research nicht
	// erneut ausgeführt.
	if (input.crashAfterJob && input.crashAfterJob === 'research') {
		return finishRun(
			db,
			runId,
			{
				contract: 'positron.decision.v1',
				run_id: runId,
				decision: 'BLOCKED',
				reason_code: 'CRASH_INJECTED',
				basis: { boundary: 'research', message: 'controlled crash after completed research job' },
			},
			transitions,
			0,
		);
	}

	// ── PLAN (durable, read-only, mit Attempt + Gate) ───────────────────────
	// Recovery B: ein abgeschlossener plan-Job wird NIE erneut ausgeführt;
	// der Plan-Contract wird aus dem persistierten plan-Attempt geladen.
	const existingPlanJob = listJobs(db, runId).find((j) => j.job_type === 'plan');
	const planJob = existingPlanJob ?? createJob(db, runId, 'plan');
	let plan: PlanContract;
	if (planJob.state === 'succeeded') {
		const planAttempt = listJobAttempts(db, planJob.job_id).at(-1) ?? null;
		if (planAttempt?.output_json) {
			try {
				plan = JSON.parse(planAttempt.output_json) as PlanContract;
			} catch {
				plan = input.plan;
			}
		} else {
			plan = input.plan;
		}
	} else {
		updateJobState(db, planJob.job_id, 'running');
		const planAttempt = createAttempt(db, runId, planJob.job_id, {
			status: 'pending',
			worker_type: deps.planWorker?.workerType ?? 'deterministic.plan',
			provider: deps.planWorker?.provider ?? null,
			model: deps.planWorker?.model ?? null,
			input_contract: 'positron.plan.v1',
			input_fingerprint: fingerprint({ run_id: runId, issue: input.issue }),
		});
		// P3: Plan-Worker läuft nur in geclaimtem Attempt.
		assertExecutionContext({
			run_id: runId,
			job_id: planJob.job_id,
			attempt_id: planAttempt.attempt_id,
		});
		// Review-Fix (R1-MINOR): Plan-Step fencen wie build/verify/research/
		// review — Claim mit Instanz-Owner + Generation, fenced Completions.
		const planClaim = claimAttemptWithGeneration(db, planAttempt.attempt_id, {
			ownerId: controllerInstanceId,
			leaseTtlMs: deps.timeoutMs ? deps.timeoutMs + 15_000 : undefined,
		});
		if (!planClaim.claimed) {
			throw new Error('INTERNAL: plan attempt claim failed');
		}
		const planGeneration = planClaim.generation;
		if (deps.planWorker) {
			assertAttemptActive(db, planAttempt.attempt_id, controllerInstanceId);
			try {
				plan = await deps.planWorker.run({
					run_id: runId,
					job_id: planJob.job_id,
					attempt_id: planAttempt.attempt_id,
					workspacePath: deps.workspace.path,
					issue: input.issue,
				});
			} catch (err) {
				// P3 (Security-Review F2): Worker-Rejection → Attempt finalisieren,
				// kein Zombie-Attempt, keine unhandled rejection.
				const errMsg = err instanceof Error ? err.message : String(err);
				completeAttempt(
					db,
					planAttempt.attempt_id,
					{
						status: 'failed',
						failure_class: 'INFRA_FAILURE',
						failure_signature: `plan-rejected:${errMsg.slice(0, 200)}`,
					},
					{ fencingOwnerId: controllerInstanceId, fencingGeneration: planGeneration },
				);
				updateJobState(db, planJob.job_id, 'failed');
				const decision = buildDecision({
					run_id: runId,
					verification: null,
					findings: [],
					contractErrors: [`PLAN_WORKER_REJECTED: ${errMsg.slice(0, 200)}`],
				});
				return finishRun(db, runId, decision, transitions, workerInvocations);
			}
		} else {
			// Kompatibilität: Plan aus Input (Tests) — wird trotzdem als
			// Input/Output des plan-Attempts vollständig persistiert.
			plan = input.plan;
		}
		const planValidation = validateContract('positron.plan.v1', plan);
		if (!planValidation.ok) {
			completeAttempt(
				db,
				planAttempt.attempt_id,
				{
					status: 'blocked',
					failure_class: 'CONTRACT_FAILURE',
					failure_signature: planValidation.errors.join('|'),
				},
				{ fencingOwnerId: controllerInstanceId, fencingGeneration: planGeneration },
			);
			updateJobState(db, planJob.job_id, 'blocked');
			const decision = buildDecision({
				run_id: runId,
				verification: null,
				findings: [],
				contractErrors: planValidation.errors,
			});
			return finishRun(db, runId, decision, transitions, workerInvocations);
		}
		completeAttempt(
			db,
			planAttempt.attempt_id,
			{
				status: 'succeeded',
				output_contract: 'positron.plan.v1',
				output_fingerprint: fingerprint(plan),
				output_json: JSON.stringify(plan),
			},
			{ fencingOwnerId: controllerInstanceId, fencingGeneration: planGeneration },
		);
		updateJobState(db, planJob.job_id, 'succeeded');
		trackTransition('PLAN', 'PLAN_VALID');
	}

	// ── PLAN_GATE (deterministisch; NUR nach validiertem persistiertem Result) ──
	const gateJob =
		listJobs(db, runId).find((j) => j.job_type === 'plan_gate') ??
		createJob(db, runId, 'plan_gate');
	const gateResult = evaluatePlanGate(plan, deps.workspace.repositoryRef, baselineHead);
	if (gateResult.status !== 'APPROVED') {
		updateJobState(db, gateJob.job_id, 'blocked');
		trackTransition('PLAN_GATE', gateResult.reason_code);
		const decision = buildDecision({
			run_id: runId,
			verification: null,
			findings: [],
			planGateStatus: gateResult.status,
		});
		return finishRun(db, runId, decision, transitions, workerInvocations);
	}
	if (gateJob.state !== 'succeeded') {
		updateJobState(db, gateJob.job_id, 'succeeded');
		trackTransition('PLAN_GATE', 'PLAN_GATE_APPROVED');
	}

	// ── BUILD + VERIFY + REVIEW + DECIDE (mit FIX-Zyklen) ──────────────────
	// Recovery: existierende Jobs werden wiederverwendet, abgeschlossene
	// Jobs werden NIE erneut ausgeführt.
	const existingBuildJob = listJobs(db, runId).find((j) => j.job_type === 'build');
	const buildJob = existingBuildJob ?? createJob(db, runId, 'build');
	const planFingerprint = fingerprint(plan);

	const existingBuildAttempts = listJobAttempts(db, buildJob.job_id);

	let attemptNumber = existingBuildAttempts.length;
	let decision: DecisionContract | null = null;
	let verification: VerificationContract | null = null;
	// Von der Control Plane deterministisch abgeleitetes Strategie-Delta:
	// die neue Evidenz des letzten fehlgeschlagenen Verify (kein LLM-Urteil).
	let lastFailureEvidence: string | null = null;

	const lastBuildAttempt = existingBuildAttempts.at(-1) ?? null;

	// ── Recovery C (Pflicht-Canary): build succeeded + result persisted,
	// aber crash vor verify → Build wird NICHT erneut ausgeführt, der
	// Verify-Schritt wird für den persistierten Build-Attempt nachgezogen.
	// Recovery D: verify completed + persisted → wird rehydriert, kein Rerun.
	if (lastBuildAttempt?.status === 'succeeded' && !verification) {
		const verifyOutcome = await runVerifyStep(
			db,
			runId,
			buildJob.job_id,
			lastBuildAttempt,
			deps,
			trackTransition,
			controllerInstanceId,
		);
		if (verifyOutcome.outcome === 'contract') {
			decision = buildDecision({
				run_id: runId,
				verification: null,
				findings: [],
				contractErrors: [verifyOutcome.reason],
			});
		} else if (verifyOutcome.outcome === 'timeout') {
			decision = buildDecision({
				run_id: runId,
				verification: null,
				findings: [],
				timeoutReason: 'VERIFY_TIMEOUT',
			});
		} else {
			verification = verifyOutcome.verification;
			if (verification && !verification.passed) {
				lastFailureEvidence = verification.new_evidence ?? null;
			}
		}
	}

	while (attemptNumber < deps.maxAttempts && !verification && !decision) {
		attemptNumber++;

		// ── BUILD: neuer Attempt (immer neue attempt_id) ────────────────────
		updateJobState(db, buildJob.job_id, 'running');
		const previousAttempt = listJobAttempts(db, buildJob.job_id).at(-1) ?? null;
		const buildInput: BuildInputContract = {
			contract: 'positron.build-input.v1',
			run_id: runId,
			job_id: buildJob.job_id,
			attempt_id: createId('att'),
			plan_fingerprint: planFingerprint,
			repository_ref: deps.workspace.repositoryRef,
			repository_head: baselineHead,
			workspace_path: deps.workspace.path,
		};

		const strategyDelta = lastFailureEvidence
			? `Fix per verification evidence: ${lastFailureEvidence.slice(0, 200)}`
			: null;
		// P5.1 — Harness Profile Identity: atomar mit dem Attempt gebunden,
		// VOR der Modell-Ausführung (PROFILE_REF_BOUND_BEFORE_EXECUTION).
		const harnessRef = resolveHarnessProfileFromEnv(process.env, {
			taskType: 'build',
			workerType: deps.buildWorker.workerType,
			provider: deps.buildWorker.provider,
			model: deps.buildWorker.model,
		});
		const attempt = createAttempt(db, runId, buildJob.job_id, {
			attempt_id: buildInput.attempt_id,
			status: 'pending',
			input_contract: buildInput.contract,
			input_fingerprint: fingerprint(buildInput),
			worker_type: deps.buildWorker.workerType,
			provider: deps.buildWorker.provider,
			model: deps.buildWorker.model,
			strategy_delta: strategyDelta,
			// P3-FIX-Kette: der neue Attempt referenziert den vorherigen
			// (§15 — keine überschriebene Historie).
			previous_attempt_id: previousAttempt?.attempt_id ?? null,
			harness_profile_id: harnessRef.harness_profile_id,
			harness_profile_version: harnessRef.harness_profile_version,
			harness_fingerprint: harnessRef.effective_harness_fingerprint,
			harness_profile_ref: JSON.stringify(harnessRef),
			task_profile_id: harnessRef.task_profile_id,
			task_profile_version: harnessRef.task_profile_version,
			task_type: harnessRef.task_type,
			provider_adapter_id: harnessRef.provider_adapter_id,
			provider_adapter_version: harnessRef.provider_adapter_version,
			model_provenance_status: harnessRef.model_provenance_status,
		});

		// Idempotenz: Dispatch ist an run:job:attempt gebunden
		const idemKey = idempotencyKey(runId, buildJob.job_id, attempt.attempt_id);
		if (!idem.claim(idemKey)) {
			// Duplikat (Recovery-Szenario): kein zweiter Worker-Aufruf
			completeAttempt(db, attempt.attempt_id, {
				status: 'denied',
				result_ref: 'duplicate-dispatch',
			});
			continue;
		}
		// P3-Claim: exakt ein Ausführer pro Attempt (paralleler
		// Doppel-Dispatch desselben Attempts wird abgelehnt).
		const leaseTtlMs = deps.timeoutMs ? deps.timeoutMs + 15_000 : 0;
		const ownerId = controllerInstanceId;
		const claim = claimAttemptWithGeneration(db, attempt.attempt_id, {
			ownerId,
			leaseTtlMs: leaseTtlMs || undefined,
		});
		if (!claim.claimed) {
			completeAttempt(
				db,
				attempt.attempt_id,
				{
					status: 'denied',
					result_ref: 'duplicate-claim',
				},
				{ fencingOwnerId: ownerId, fencingGeneration: claim.generation },
			);
			continue;
		}
		const attemptGeneration = claim.generation;
		// Review-Fix (R1-MAJOR Heartbeat): Lease während langer Build-Arbeit
		// erneuern (TTL/3), damit die Lease nicht mitten im Build abläuft.
		const buildHeartbeatCancellation = createCancellationSource();
		const buildHeartbeat = leaseTtlMs
			? startLeaseHeartbeat(
					buildHeartbeatCancellation,
					() => {
						renewAttemptLease(db, attempt.attempt_id, ownerId, leaseTtlMs);
					},
					leaseTtlMs,
				)
			: null;

		// Crash-Injection (Recovery-Test): Abbruch VOR Build-Ausführung
		if (input.crashAfterJob && input.crashAfterJob === buildJob.job_id && attemptNumber === 1) {
			buildHeartbeat?.stop();
			completeAttempt(
				db,
				attempt.attempt_id,
				{
					status: 'blocked',
					failure_class: 'INFRA_FAILURE',
					failure_signature: 'crash-injected-before-build',
				},
				{ fencingOwnerId: ownerId, fencingGeneration: attemptGeneration },
			);
			break;
		}

		// P3: Provider-/OpenCode-Aufruf nur innerhalb eines aktiven Attempts.
		assertExecutionContext({
			run_id: runId,
			job_id: buildJob.job_id,
			attempt_id: attempt.attempt_id,
		});
		assertAttemptActive(db, attempt.attempt_id, ownerId);

		const buildCancellation = createCancellationSource();
		const timedBuild = await withCancellableTimeout(
			(async () => {
				try {
					return await deps.buildWorker.implement({ ...buildInput, strategyDelta });
				} catch (err) {
					if (err instanceof CancellationError) {
						throw err;
					}
					// P3 (Security-Review F2): Eine Worker-Rejection darf keinen
					// Zombie-Attempt hinterlassen. Der Attempt wird finalisiert
					// (failed/INFRA_FAILURE), keine unhandled rejection.
					const errMsg = err instanceof Error ? err.message : String(err);
					const classified = classifyFailure({ stderr: errMsg, exitCode: 1 });
					completeAttempt(
						db,
						attempt.attempt_id,
						{
							status: 'failed',
							failure_class:
								classified.signature === 'UNKNOWN'
									? 'INFRA_FAILURE'
									: (classified.signature as AttemptRecord['failure_class']),
							failure_signature: `implement-rejected:${errMsg.slice(0, 200)}`,
							new_evidence: errMsg.slice(0, 500),
						},
						{ fencingOwnerId: ownerId, fencingGeneration: attemptGeneration },
					);
					decision = buildDecision({
						run_id: runId,
						verification: null,
						findings: [],
						retry: {
							verdict: 'DENIED',
							reason_code: 'WORKER_REJECTED',
							delta: [errMsg.slice(0, 200)],
						},
					});
					return { rejected: true, message: errMsg.slice(0, 200) };
				}
			})(),
			deps.timeoutMs,
			buildCancellation,
		);
		if (!timedBuild.ok) {
			// Deterministischer Timeout: Attempt endet final (timed_out),
			// kein Zombie-Job, keine unhandled rejection, kein Erfolgsübergang.
			buildHeartbeat?.stop();
			completeAttempt(
				db,
				attempt.attempt_id,
				{
					status: 'timed_out',
					failure_class: 'TIMEOUT',
					failure_signature: `build-timeout-${deps.timeoutMs ?? 0}ms`,
				},
				{ fencingOwnerId: ownerId, fencingGeneration: attemptGeneration },
			);
			decision = buildDecision({
				run_id: runId,
				verification: null,
				findings: [],
				timeoutReason: 'BUILD_TIMEOUT',
			});
			break;
		}
		if ('rejected' in timedBuild.value) {
			// Worker hat geworfen → Attempt bereits finalisiert, Decision gesetzt
			buildHeartbeat?.stop();
			break;
		}
		workerInvocations++;
		const buildResult = timedBuild.value;

		const buildResultValidation = validateContract('positron.build-result.v1', buildResult);
		if (!buildResultValidation.ok) {
			buildHeartbeat?.stop();
			completeAttempt(
				db,
				attempt.attempt_id,
				{
					status: 'blocked',
					failure_class: 'CONTRACT_FAILURE',
					failure_signature: buildResultValidation.errors.join('|'),
				},
				{ fencingOwnerId: ownerId, fencingGeneration: attemptGeneration },
			);
			decision = buildDecision({
				run_id: runId,
				verification: null,
				findings: [],
				contractErrors: buildResultValidation.errors,
			});
			break;
		}

		completeAttempt(
			db,
			attempt.attempt_id,
			{
				status: buildResult.status === 'success' ? 'succeeded' : 'failed',
				output_contract: buildResult.contract,
				output_fingerprint: fingerprint(buildResult),
				result_ref: buildResult.result_ref ?? null,
			},
			{ fencingOwnerId: ownerId, fencingGeneration: attemptGeneration },
		);
		// Build-Ausführung beendet → Heartbeat stoppen (Verify läuft als
		// eigener Attempt mit eigenem Heartbeat in runVerifyStep).
		buildHeartbeat?.stop();
		idem.complete(idemKey, buildResult.result_ref ?? buildResult.summary);
		trackTransition(
			'BUILD',
			buildResult.status === 'success' ? 'BUILD_RESULT_OK' : 'BUILD_RESULT_FAILED',
		);

		// Crash-Injection (Recovery-Test C): Abbruch NACH Build-Result-
		// Persistenz, VOR Verify — beim Resume wird der Build-Attempt als
		// completed evidence wiederverwendet und NUR der Verify-Schritt
		// nachgezogen (BUILD_WORKER_CALLS bleibt 1).
		if (input.crashAfterJob && input.crashAfterJob === 'before-verify') {
			return finishRun(
				db,
				runId,
				{
					contract: 'positron.decision.v1',
					run_id: runId,
					decision: 'BLOCKED',
					reason_code: 'CRASH_INJECTED',
					basis: {
						boundary: 'build',
						message: 'controlled crash after build result, before verify',
					},
				},
				transitions,
				workerInvocations,
			);
		}

		// ── VERIFY: deterministische Tools (persistenter Job/Attempt) ────────
		const verifyOutcome = await runVerifyStep(
			db,
			runId,
			buildJob.job_id,
			attempt,
			deps,
			trackTransition,
			controllerInstanceId,
		);
		if (verifyOutcome.outcome === 'contract') {
			decision = buildDecision({
				run_id: runId,
				verification: null,
				findings: [],
				contractErrors: [verifyOutcome.reason],
			});
			break;
		}
		if (verifyOutcome.outcome === 'timeout') {
			decision = buildDecision({
				run_id: runId,
				verification: null,
				findings: [],
				timeoutReason: 'VERIFY_TIMEOUT',
			});
			break;
		}
		verification = verifyOutcome.verification;
		if (verification && !verification.passed) {
			lastFailureEvidence = verification.new_evidence ?? null;
			// Der Build-Attempt gilt fachlich als failed (Build+Verify), trägt
			// die Failure-Klassifikation und bleibt historisch vollständig.
			completeAttempt(
				db,
				attempt.attempt_id,
				{
					status: 'failed',
					failure_class: verification.failure_class ?? 'TEST_FAILURE',
					failure_signature: verification.failure_signature ?? 'UNKNOWN',
				},
				{ fencingOwnerId: ownerId, fencingGeneration: attemptGeneration },
			);
		}

		// Crash-Injection (Recovery-Test): Abbruch NACH einem erfolgreich
		// abgeschlossenen Job (verify) — der Run ist an einer validen
		// Boundary abgeschlossen; beim Resume wird nichts wiederholt.
		if (input.crashAfterJob && input.crashAfterJob === 'verify') {
			updateJobState(db, buildJob.job_id, 'succeeded');
			return finishRun(
				db,
				runId,
				{
					contract: 'positron.decision.v1',
					run_id: runId,
					decision: 'BLOCKED',
					reason_code: 'CRASH_INJECTED',
					basis: { boundary: 'verify', message: 'controlled crash after completed verify job' },
				},
				transitions,
				workerInvocations,
			);
		}

		// ── FIX-Zyklus: Retry nur bei Information Gain ──────────────────────
		if (verification && !verification.passed) {
			// DB-Stand des Build-Attempts (enthält failure_class/signature)
			const attemptFromDb = getAttempt(db, attempt.attempt_id) ?? attempt;
			const retryCheck = evaluateRetry({
				attemptNumber,
				maxAttempts: deps.maxAttempts,
				previousAttempt: attemptFromDb,
				inputFingerprint: attemptFromDb.input_fingerprint ?? '',
				worker: deps.buildWorker,
				newEvidence: verification.new_evidence ?? null,
				strategyDelta: lastFailureEvidence ? 'fix-per-evidence' : null,
				contextFingerprint: planFingerprint,
			});
			if (retryCheck.verdict === 'DENIED') {
				// Kein Information Gain → kein weiterer Versuch (SPLIT-Pfad)
				break;
			}
			// FIX erlaubt: Verification zurücksetzen → neuer Attempt im Loop.
			// Die Attempt-Historie bleibt vollständig erhalten (neue attempt_id,
			// previous_attempt_id referenziert den vorherigen Versuch).
			verification = null;
		}
	}

	// ── REVIEW (strukturierte Findings) — immer nach Build/Verify ───────────
	// P1: echte parallele Review-Worker (Fan-out/Join). Parallelität wird
	// über reale Zeitüberschneidung bewiesen (PARALLELISM_PROVEN), nie über
	// Code-Struktur behauptet. Ohne Worker: einfacher Review-Pfad.
	// P3-Recovery E: abgeschlossene Reviews werden aus cp_attempts
	// rekonstruiert und NIE erneut ausgeführt.
	const existingReviewJob = listJobs(db, runId).find((j) => j.job_type === 'review');
	const reviewJob = existingReviewJob ?? createJob(db, runId, 'review', buildJob.job_id);
	let findings: FindingContract[] = [];
	let parallelismVerdict: ParallelismVerdict | null = null;
	if (deps.reviewWorkers && deps.reviewWorkers.length > 0) {
		if (reviewJob.state === 'succeeded') {
			// Recovery: Findings aus persistierten Attempts rekonstruieren.
			findings = listJobAttempts(db, reviewJob.job_id).flatMap((a) => {
				if (a.status !== 'succeeded' || !a.output_json) return [];
				try {
					return JSON.parse(a.output_json) as FindingContract[];
				} catch {
					return [];
				}
			});
			storeTransition(db, runId, 'VERIFY', 'REVIEW', 'REVIEW_RECOVERED');
		} else {
			const recoveredResults = listJobAttempts(db, reviewJob.job_id)
				.map(reconstructReviewResult)
				.filter((r): r is ParallelReviewResult => r !== null);
			const recoveredKinds = new Set(recoveredResults.map((r) => r.kind));
			const pendingWorkers = deps.reviewWorkers.filter((w) => !recoveredKinds.has(w.kind));
			if (pendingWorkers.length === 0) {
				// Alles recovered (Crash zwischen Attempt-Completion und
				// Job-State-Update).
				findings = recoveredResults.flatMap((r) => r.findings);
				storeTransition(db, runId, 'VERIFY', 'REVIEW', 'REVIEW_RECOVERED');
			} else {
				const reviewOutcome = await runParallelReviews(
					db,
					{ run_id: runId, job_id: reviewJob.job_id, workspacePath: deps.workspace.path },
					pendingWorkers,
					recoveredResults,
				);
				findings = reviewOutcome.reviewBatch.findings;
				parallelismVerdict = reviewOutcome.verdict;
				storeTransition(db, runId, 'VERIFY', 'REVIEW', 'REVIEW_PARALLEL');
				emitEvent({
					contract: 'positron.run-event.v1',
					run_id: runId,
					job_id: reviewJob.job_id,
					timestamp: new Date().toISOString(),
					previous_state: 'VERIFY',
					new_state: 'REVIEW',
					reason_code: parallelismVerdict,
					level: 'INFO',
				});
			}
		}
	} else {
		findings = await deps.reviewFindings();
	}
	updateJobState(db, reviewJob.job_id, 'succeeded');

	// ── DECIDE: Positron entscheidet (deterministisch) ──────────────────────
	// Bereits gesetzte Entscheidungen (Timeout/Contract-Fehler aus dem
	// Build-/Verify-Loop) haben Vorrang und werden nicht überschrieben.
	if (!decision) {
		const latestBuildAttempt = listJobAttempts(db, buildJob.job_id).at(-1) ?? null;
		const retry = !verification
			? {
					verdict: 'DENIED' as const,
					reason_code: 'RETRY_DENIED_ATTEMPT_LIMIT' as const,
					delta: [] as string[],
				}
			: verification.passed
				? null
				: evaluateRetry({
						attemptNumber,
						maxAttempts: deps.maxAttempts,
						previousAttempt: latestBuildAttempt,
						inputFingerprint: latestBuildAttempt?.input_fingerprint ?? '',
						worker: deps.buildWorker,
						newEvidence: verification.new_evidence ?? null,
						strategyDelta: lastFailureEvidence ? 'fix-per-evidence' : null,
						contextFingerprint: planFingerprint,
					});

		decision = buildDecision({
			run_id: runId,
			verification,
			findings,
			retry,
			planGateStatus: 'APPROVED',
			splitDepth: 0,
		});
		if (parallelismVerdict) {
			decision.basis.parallelism = parallelismVerdict;
		}
		if (researchOutcome) {
			decision.basis.research_parallelism = researchOutcome.verdict;
			decision.basis.research_barrier = researchOutcome.barrier.reason_code;
		} else if (researchVerdictFromRecovery) {
			decision.basis.research_parallelism = researchVerdictFromRecovery;
			decision.basis.research_barrier = 'RESEARCH_JOIN';
		}
	}

	storeDecision(db, runId, decision.decision, decision.reason_code, JSON.stringify(decision));
	trackTransition('DECIDE', decision.reason_code);

	return finishRun(db, runId, decision, transitions, workerInvocations);
}

function finishRun(
	db: Database.Database,
	runId: string,
	decision: DecisionContract,
	transitions: DurableRunResult['transitions'],
	workerInvocations: number,
): DurableRunResult {
	// Idempotente Entscheidungs-Persistenz
	const existing = listDecisions(db, runId);
	if (existing.length === 0) {
		storeDecision(db, runId, decision.decision, decision.reason_code, JSON.stringify(decision));
	}
	return {
		runId,
		decision,
		jobs: listJobs(db, runId),
		attempts: listAttempts(db, runId),
		transitions,
		workerInvocations,
	};
}

// ---------------------------------------------------------------------------
// Recovery-Helfer
// ---------------------------------------------------------------------------

/**
 * Prüft ob ein Job bereits erfolgreich abgeschlossen wurde.
 * Recovery-Boundary: Abgeschlossene Jobs werden NIE erneut ausgeführt.
 */
export function isJobCompleted(db: Database.Database, jobId: string): boolean {
	const job = getJob(db, jobId);
	if (!job) return false;
	return job.state === 'succeeded';
}

/**
 * Ermittelt die nächste valide Boundary nach einem Crash.
 * Returns: { jobId, state } für den letzten abgeschlossenen Job.
 */
export function recoveryBoundary(
	db: Database.Database,
	runId: string,
): { jobId: string; state: string } | null {
	const jobs = listJobs(db, runId);
	if (jobs.length === 0) return null;
	const lastCompleted = [...jobs].reverse().find((j) => j.state === 'succeeded');
	if (!lastCompleted) return null;
	return { jobId: lastCompleted.job_id, state: lastCompleted.job_type };
}

/** Schreibt einen Workspace-Snapshot-Fingerprint (evidenz-basiert). */
export function workspaceFingerprint(workspacePath: string): string {
	const files: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === '.git' || entry.name === 'node_modules') continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else {
				files.push(`${full}:${fs.statSync(full).size}`);
			}
		}
	};
	if (!fs.existsSync(workspacePath)) return '';
	walk(workspacePath);
	return fingerprint({ files: files.sort() });
}
