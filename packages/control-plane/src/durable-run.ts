// Positron Control Plane — Durable Run Orchestration
//
// Die zentrale Runtime-Schleife der Control Plane:
//
//   ISSUE → INTAKE → BASELINE → PLAN → PLAN_GATE → BUILD → VERIFY → REVIEW → DECIDE
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
import { buildDecision } from './decision-policy.js';
import { fingerprint } from './fingerprint.js';
import { IdempotencyRegistry, idempotencyKey } from './idempotency.js';
import { evaluatePlanGate } from './plan-gate.js';
import { evaluateRetry } from './retry-policy.js';
import { runParallelReviews } from './review.js';
import type { ParallelismVerdict, ReviewWorker } from './review.js';
import { applyControlPlaneMigrations } from './schema.js';
import {
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
	applyControlPlaneMigrations(db);
	const idem = new IdempotencyRegistry(db);

	const runId = input.issue.run_id;
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

	// ── INTAKE ──────────────────────────────────────────────────────────────
	const intakeJob = createJob(db, runId, 'intake');
	updateJobState(db, intakeJob.job_id, 'succeeded');
	trackTransition('INTAKE', 'RUN_CREATED');

	// ── BASELINE ────────────────────────────────────────────────────────────
	const baselineJob = createJob(db, runId, 'baseline');
	const baselineHead = deps.workspace.readHead
		? deps.workspace.readHead(deps.workspace.path)
		: readRepositoryHead(deps.workspace.path);
	updateJobState(db, baselineJob.job_id, 'succeeded');
	trackTransition('BASELINE', 'BASELINE_OK');

	// ── PLAN (Contract validieren) ──────────────────────────────────────────
	const planJob = createJob(db, runId, 'plan');
	const planValidation = validateContract('positron.plan.v1', input.plan);
	if (!planValidation.ok) {
		updateJobState(db, planJob.job_id, 'blocked');
		const decision = buildDecision({
			run_id: runId,
			verification: null,
			findings: [],
			contractErrors: planValidation.errors,
		});
		return finishRun(db, runId, decision, transitions, 0);
	}
	updateJobState(db, planJob.job_id, 'succeeded');

	// ── PLAN_GATE ───────────────────────────────────────────────────────────
	const gateJob = createJob(db, runId, 'plan_gate');
	const gateResult = evaluatePlanGate(input.plan, deps.workspace.repositoryRef, baselineHead);
	if (gateResult.status !== 'APPROVED') {
		updateJobState(db, gateJob.job_id, 'blocked');
		trackTransition('PLAN_GATE', gateResult.reason_code);
		const decision = buildDecision({
			run_id: runId,
			verification: null,
			findings: [],
			planGateStatus: gateResult.status,
		});
		return finishRun(db, runId, decision, transitions, 0);
	}
	updateJobState(db, gateJob.job_id, 'succeeded');
	trackTransition('PLAN_GATE', 'PLAN_GATE_APPROVED');

	// ── BUILD + VERIFY + REVIEW + DECIDE (mit FIX-Zyklen) ──────────────────
	// Recovery: existierende Jobs werden wiederverwendet, abgeschlossene
	// Jobs werden NIE erneut ausgeführt.
	const existingBuildJob = listJobs(db, runId).find((j) => j.job_type === 'build');
	const buildJob = existingBuildJob ?? createJob(db, runId, 'build');
	const planFingerprint = fingerprint(input.plan);

	const existingBuildAttempts = listJobAttempts(db, buildJob.job_id);
	const existingVerifyJobs = listJobs(db, runId).filter((j) => j.job_type === 'verify');

	let attemptNumber = existingBuildAttempts.length;
	let decision: DecisionContract | null = null;
	let workerInvocations = 0;
	let verification: VerificationContract | null = null;
	// Von der Control Plane deterministisch abgeleitetes Strategie-Delta:
	// die neue Evidenz des letzten fehlgeschlagenen Verify (kein LLM-Urteil).
	let lastFailureEvidence: string | null = null;

	// Recovery-Boundary: Wenn der letzte Build-Attempt bereits erfolgreich
	// verifiziert wurde, wird build+verify NICHT erneut ausgeführt.
	const lastBuildAttempt = existingBuildAttempts.at(-1) ?? null;
	if (lastBuildAttempt?.status === 'succeeded') {
		const matchingVerifyJob = existingVerifyJobs.find(
			(v) => v.parent_job_id === buildJob.job_id && v.state === 'succeeded',
		);
		if (matchingVerifyJob) {
			const verifiedAttempt = listJobAttempts(db, matchingVerifyJob.job_id).at(-1);
			if (verifiedAttempt?.output_json) {
				try {
					verification = JSON.parse(verifiedAttempt.output_json) as VerificationContract;
				} catch {
					verification = null;
				}
			}
		}
	}

	while (attemptNumber < deps.maxAttempts && !verification) {
		attemptNumber++;

		// ── BUILD: neuer Attempt (immer neue attempt_id) ────────────────────
		updateJobState(db, buildJob.job_id, 'running');
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
		const attempt = createAttempt(db, runId, buildJob.job_id, {
			attempt_id: buildInput.attempt_id,
			input_contract: buildInput.contract,
			input_fingerprint: fingerprint(buildInput),
			worker_type: deps.buildWorker.workerType,
			provider: deps.buildWorker.provider,
			model: deps.buildWorker.model,
			strategy_delta: strategyDelta,
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

		// Crash-Injection: nach abgeschlossenem Job vor Build simulieren
		if (input.crashAfterJob && input.crashAfterJob === buildJob.job_id && attemptNumber === 1) {
			// Der Job gilt als abgeschlossen — Recovery wird den Run an einer
			// validen Boundary fortsetzen, ohne den Job erneut auszuführen.
			updateJobState(db, buildJob.job_id, 'succeeded');
			completeAttempt(db, attempt.attempt_id, { status: 'succeeded' });
			break;
		}

		const buildResult = await deps.buildWorker.implement({ ...buildInput, strategyDelta });
		workerInvocations++;

		const buildResultValidation = validateContract('positron.build-result.v1', buildResult);
		if (!buildResultValidation.ok) {
			completeAttempt(db, attempt.attempt_id, {
				status: 'blocked',
				failure_class: 'CONTRACT_FAILURE',
				failure_signature: buildResultValidation.errors.join('|'),
			});
			decision = buildDecision({
				run_id: runId,
				verification: null,
				findings: [],
				contractErrors: buildResultValidation.errors,
			});
			break;
		}

		completeAttempt(db, attempt.attempt_id, {
			status: buildResult.status === 'success' ? 'succeeded' : 'failed',
			output_contract: buildResult.contract,
			output_fingerprint: fingerprint(buildResult),
			result_ref: buildResult.result_ref ?? null,
		});
		idem.complete(idemKey, buildResult.result_ref ?? buildResult.summary);
		trackTransition(
			'BUILD',
			buildResult.status === 'success' ? 'BUILD_RESULT_OK' : 'BUILD_RESULT_FAILED',
		);

		// ── VERIFY: deterministische Tools ───────────────────────────────────
		const verifyJob = createJob(db, runId, 'verify', buildJob.job_id);
		const verifyAttempt = createAttempt(db, runId, verifyJob.job_id, {
			worker_type: 'deterministic-tools',
			input_contract: 'positron.verification.v1',
			input_fingerprint: fingerprint({
				attempt: attempt.attempt_id,
				workspace: deps.workspace.path,
			}),
		});
		const verifyOut = await deps.verifyTool.run({
			run_id: runId,
			job_id: verifyJob.job_id,
			attempt_id: verifyAttempt.attempt_id,
			workspacePath: deps.workspace.path,
		});
		const builtVerification = buildVerificationContract({
			run_id: runId,
			job_id: verifyJob.job_id,
			attempt_id: verifyAttempt.attempt_id,
			checks: verifyOut.checks,
			new_evidence: verifyOut.new_evidence,
		});
		verification = builtVerification;
		const verifyValidation = validateContract('positron.verification.v1', verification);
		if (!verifyValidation.ok) {
			completeAttempt(db, verifyAttempt.attempt_id, {
				status: 'blocked',
				failure_class: 'CONTRACT_FAILURE',
				failure_signature: verifyValidation.errors.join('|'),
			});
			decision = buildDecision({
				run_id: runId,
				verification: null,
				findings: [],
				contractErrors: verifyValidation.errors,
			});
			break;
		}
		completeAttempt(db, verifyAttempt.attempt_id, {
			status: verification.passed ? 'succeeded' : 'failed',
			output_contract: verification.contract,
			output_fingerprint: fingerprint(verification),
			output_json: JSON.stringify(verification),
			failure_class: verification.failure_class ?? null,
			failure_signature: verification.failure_signature ?? null,
			new_evidence: verification.new_evidence ?? null,
		});
		updateJobState(db, verifyJob.job_id, verification.passed ? 'succeeded' : 'failed');
		trackTransition('VERIFY', verification.passed ? 'VERIFY_PASS' : 'VERIFY_FAIL');
		if (!verification.passed) {
			lastFailureEvidence = verification.new_evidence ?? null;
			// Der Build-Attempt gilt fachlich als failed (Build+Verify), trägt
			// die Failure-Klassifikation und bleibt historisch vollständig.
			completeAttempt(db, attempt.attempt_id, {
				status: 'failed',
				failure_class: verification.failure_class ?? 'TEST_FAILURE',
				failure_signature: verification.failure_signature ?? 'UNKNOWN',
			});
		}

		// Crash-Injection (Recovery-Test): Abbruch NACH einem erfolgreich
		// abgeschlossenen Job (verify) — der Run ist an einer validen
		// Boundary abgeschlossen; beim Resume wird nichts wiederholt.
		if (
			input.crashAfterJob &&
			(input.crashAfterJob === verifyJob.job_id || input.crashAfterJob === 'verify')
		) {
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
		if (!verification.passed) {
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
			// Die Attempt-Historie bleibt vollständig erhalten (neue attempt_id).
			verification = null;
		}
	}

	// ── REVIEW (strukturierte Findings) — immer nach Build/Verify ───────────
	// P1: echte parallele Review-Worker (Fan-out/Join). Parallelität wird
	// über reale Zeitüberschneidung bewiesen (PARALLELISM_PROVEN), nie über
	// Code-Struktur behauptet. Ohne Worker: einfacher Review-Pfad.
	const reviewJob = createJob(db, runId, 'review', buildJob.job_id);
	let findings: FindingContract[] = [];
	let parallelismVerdict: ParallelismVerdict | null = null;
	if (deps.reviewWorkers && deps.reviewWorkers.length > 0) {
		const reviewOutcome = await runParallelReviews(
			db,
			{ run_id: runId, job_id: reviewJob.job_id, workspacePath: deps.workspace.path },
			deps.reviewWorkers,
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
	} else {
		findings = await deps.reviewFindings();
	}
	updateJobState(db, reviewJob.job_id, 'succeeded');

	// ── DECIDE: Positron entscheidet (deterministisch) ──────────────────────
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
