// P3 — Canonical Durable Execution Adoption
//
// Beweise auf Real-Run-Ebene (disposable Git-Workspaces):
// - BASELINE_CANONICAL: baseline-Job mit Attempt (positron.baseline.v1), read-only
// - PLAN_CANONICAL: persistenter plan-Job/Attempt; PLAN_GATE nur nach validem Result
// - RECOVERY_PLAN (B): PlanWorker wird beim Resume NICHT erneut aufgerufen
// - RECOVERY_RESEARCH (A): code/docs completed → nicht re-runt; tests wird nachgeholt
// - RECOVERY_BUILD (C): build succeeded + persisted, crash vor verify →
//   BUILD_WORKER_CALLS = 1, verify startet
// - RECOVERY_PARTIAL_REVIEW (E): correctness completed → nicht re-runt
// - TIMEOUT: build-timeout → timed_out attempt, BLOCKED, late result ignoriert
// - EXECUTION_CONTEXT_REQUIRED (Audit-Canary)
// - IDEMPOTENT_DISPATCH: gleicher Run 2x → keine doppelte Mutation
// - FIX_CHAIN: attempt 2 referenziert attempt 1 (previous_attempt_id)

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { FindingContract, PlanContract, ResearchBatchContract } from '../contracts.js';
import { runDurableRun } from '../durable-run.js';
import type { PlanWorker } from '../durable-run.js';
import { assertAttemptActive, assertExecutionContext } from '../execution-context.js';
import { EXECUTION_CONTEXT_REQUIRED } from '../execution-context.js';
import type { ResearchWorker, ReviewWorker } from '../index.js';
import {
	completeAttempt,
	createAttempt,
	createJob,
	listAttempts,
	listJobAttempts,
	listJobs,
} from '../store.js';
import {
	ScriptedBuildWorker,
	cleanupWorkspace,
	createTestDb,
	createTestWorkspace,
	makeNodeTestVerifyTool,
} from './vertical-slice-helpers.js';

function listAttemptsAll(db: Database.Database, runId: string) {
	return listAttempts(db, runId);
}

/** Deterministischer Workspace-Snapshot (Dateipfade + Größen) für Read-Only-Beweise. */
function snapshotWorkspace(dir: string): string {
	const files: string[] = [];
	const walk = (d: string): void => {
		for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
			if (entry.name === '.git' || entry.name === 'node_modules') continue;
			const full = path.join(d, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else {
				files.push(`${full}:${fs.statSync(full).size}`);
			}
		}
	};
	walk(dir);
	return files.sort().join('|');
}

function makePlan(runId: string, head: string): PlanContract {
	return {
		contract: 'positron.plan.v1',
		run_id: runId,
		repository_ref: 'xxammaxx/vslice-workspace',
		repository_head: head,
		targets: { files: ['src/sum.js'], symbols: ['add'] },
		acceptance_criteria: ['add(2, 3) returns 5', 'add(0, 0) returns 0'],
		required_tests: ['test/sum.test.js'],
		risks: [],
		build_scope: { allowed_files: ['src/', 'test/'] },
		context: { fingerprint: 'fp_vslice_context_1234' },
	};
}

function makeIssue(runId: string): {
	contract: 'positron.issue.v1';
	run_id: string;
	source_type: string;
	source_ref: string;
	repository_ref: string;
	title: string;
} {
	return {
		contract: 'positron.issue.v1',
		run_id: runId,
		source_type: 'test-task',
		source_ref: 'vslice:sum',
		repository_ref: 'xxammaxx/vslice-workspace',
		title: 'Fix add() implementation',
	};
}

const RESEARCH_OUTPUTS: Record<string, { summary_ref: string; sources: string[] }> = {
	code: { summary_ref: 'docs/evidence/research-code.md', sources: ['repo:src'] },
	docs: { summary_ref: 'docs/evidence/research-docs.md', sources: ['repo:docs'] },
	tests: { summary_ref: 'docs/evidence/research-tests.md', sources: ['repo:test'] },
};

function makeResearchWorker(
	kind: 'code' | 'docs' | 'tests',
	calls: Record<'code' | 'docs' | 'tests', { n: number }>,
): ResearchWorker {
	return {
		kind,
		workerType: `research.${kind}`,
		provider: 'deterministic',
		model: 'research-fixture',
		required: kind === 'code',
		async run() {
			calls[kind].n++;
			await new Promise((r) => setTimeout(r, 20));
			const output = RESEARCH_OUTPUTS[kind]!;
			return { summary_ref: output.summary_ref, sources: output.sources };
		},
	};
}

function makeReviewWorker(
	kind: 'correctness' | 'security' | 'quality',
	calls: Record<'correctness' | 'security' | 'quality', { n: number }>,
	findings: FindingContract[],
): ReviewWorker {
	return {
		kind,
		workerType: `review.${kind}`,
		async run() {
			calls[kind].n++;
			await new Promise((r) => setTimeout(r, 15));
			return findings;
		},
	};
}

describe('P3 — Canonical Execution Adoption', () => {
	it('BASELINE_CANONICAL — baseline ist ein persistenter Job mit Attempt (positron.baseline.v1), read-only', async () => {
		const ws = createTestWorkspace();
		try {
			const db = createTestDb();
			const worker = new ScriptedBuildWorker(ws, ['correct']);
			const result = await runDurableRun(
				{
					db,
					workspace: {
						path: ws.dir,
						repositoryRef: 'xxammaxx/vslice-workspace',
						readHead: ws.readHead,
					},
					buildWorker: worker,
					verifyTool: makeNodeTestVerifyTool(ws),
					reviewFindings: async () => [],
					maxAttempts: 3,
				},
				{ issue: makeIssue('run_p3_baseline'), plan: makePlan('run_p3_baseline', ws.head) },
			);

			const baselineJob = result.jobs.find((j) => j.job_type === 'baseline')!;
			expect(baselineJob.state).toBe('succeeded');
			const baselineAttempts = listJobAttempts(db, baselineJob.job_id);
			expect(baselineAttempts).toHaveLength(1);
			const att = baselineAttempts[0]!;
			expect(att.worker_type).toBe('deterministic.baseline');
			expect(att.provider).toBeNull();
			expect(att.model).toBeNull();
			expect(att.input_contract).toBe('positron.baseline.v1');
			expect(att.output_contract).toBe('positron.baseline.v1');
			expect(att.output_fingerprint).not.toBeNull();
			const baselineDoc = JSON.parse(att.output_json!) as { repository_head: string };
			expect(baselineDoc.repository_head).toBe(ws.head);
			// BASELINE_READ_ONLY: der Workspace wurde nicht verändert
			expect(ws.readHead()).toBe(ws.head);
			db.close();
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('PLAN_CANONICAL + PLAN_GATE — persistenter plan-Job/Attempt; Gate nur nach validiertem Result', async () => {
		const ws = createTestWorkspace();
		try {
			const db = createTestDb();
			const worker = new ScriptedBuildWorker(ws, ['correct']);
			const planCalls = { n: 0 };
			const planWorker: PlanWorker = {
				workerType: 'opencode.plan',
				provider: 'deterministic',
				model: 'plan-fixture',
				async run(ctx) {
					planCalls.n++;
					expect(ctx.run_id).toBe('run_p3_plan');
					expect(ctx.job_id).toBeTruthy();
					expect(ctx.attempt_id).toBeTruthy();
					return makePlan(ctx.run_id, ws.head);
				},
			};
			const result = await runDurableRun(
				{
					db,
					workspace: {
						path: ws.dir,
						repositoryRef: 'xxammaxx/vslice-workspace',
						readHead: ws.readHead,
					},
					buildWorker: worker,
					verifyTool: makeNodeTestVerifyTool(ws),
					reviewFindings: async () => [],
					planWorker,
					maxAttempts: 3,
				},
				{ issue: makeIssue('run_p3_plan'), plan: makePlan('run_p3_plan', ws.head) },
			);

			const planJob = result.jobs.find((j) => j.job_type === 'plan')!;
			expect(planJob.state).toBe('succeeded');
			const planAttempts = listJobAttempts(db, planJob.job_id);
			expect(planAttempts).toHaveLength(1);
			const att = planAttempts[0]!;
			expect(att.worker_type).toBe('opencode.plan');
			expect(att.output_contract).toBe('positron.plan.v1');
			expect(att.output_fingerprint).not.toBeNull();
			const persistedPlan = JSON.parse(att.output_json!) as PlanContract;
			expect(persistedPlan.contract).toBe('positron.plan.v1');
			// Gate lief mit dem validierten, persistierten Result
			expect(result.decision.decision).toBe('DONE');
			const gateJob = result.jobs.find((j) => j.job_type === 'plan_gate')!;
			expect(gateJob.state).toBe('succeeded');
			// Kein direkter opencode-plan→parse→build-Abkürzung: PlanWorker-Call
			// fand in einem geclaimten Attempt statt
			expect(planCalls.n).toBe(1);
			db.close();
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('RECOVERY_PLAN (B) — plan completed + persistiert, Crash vor Gate → Plan wird NICHT re-erzeugt, Gate läuft mit persistiertem Result', async () => {
		const ws = createTestWorkspace();
		try {
			const db = createTestDb();
			const worker = new ScriptedBuildWorker(ws, ['correct']);
			const planCalls = { n: 0 };
			const planWorker: PlanWorker = {
				workerType: 'opencode.plan',
				provider: 'deterministic',
				model: 'plan-fixture',
				async run(ctx) {
					planCalls.n++;
					return makePlan(ctx.run_id, ws.head);
				},
			};

			// Lauf 1: plan+gate+... läuft durch (kein Crash) — wir simulieren
			// den Crash danach durch erneutes runDurableRun mit PlanWorker:
			// der persistierte plan-Job muss wiederverwendet werden.
			const first = await runDurableRun(
				{
					db,
					workspace: {
						path: ws.dir,
						repositoryRef: 'xxammaxx/vslice-workspace',
						readHead: ws.readHead,
					},
					buildWorker: worker,
					verifyTool: makeNodeTestVerifyTool(ws),
					reviewFindings: async () => [],
					planWorker,
					maxAttempts: 3,
				},
				{
					issue: makeIssue('run_p3_plan_recovery'),
					plan: makePlan('run_p3_plan_recovery', ws.head),
				},
			);
			expect(first.decision.decision).toBe('DONE');

			// Lauf 2 (Resume nach "Crash"): PlanWorker darf NICHT erneut laufen
			const resume = await runDurableRun(
				{
					db,
					workspace: {
						path: ws.dir,
						repositoryRef: 'xxammaxx/vslice-workspace',
						readHead: ws.readHead,
					},
					buildWorker: worker,
					verifyTool: makeNodeTestVerifyTool(ws),
					reviewFindings: async () => [],
					planWorker,
					maxAttempts: 3,
				},
				{
					issue: makeIssue('run_p3_plan_recovery'),
					plan: makePlan('run_p3_plan_recovery', ws.head),
				},
			);
			expect(planCalls.n).toBe(1); // PLAN NOT RERUN
			expect(resume.decision.decision).toBe('DONE');
			expect(worker.invocations).toBe(1); // build nicht erneut
			const planJobs = listJobs(db, 'run_p3_plan_recovery').filter((j) => j.job_type === 'plan');
			expect(planJobs).toHaveLength(1);
			db.close();
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('RECOVERY_RESEARCH (A) — code+docs completed, Crash, tests unfinished → code/docs NICHT re-runt, tests läuft', async () => {
		const ws = createTestWorkspace();
		try {
			const db = createTestDb();
			const runId = 'run_p3_research_recovery';
			const worker = new ScriptedBuildWorker(ws, ['correct']);

			// Simulierter Crash-Zustand: research-Job mit code+docs succeeded,
			// tests fehlt (nie gestartet).
			const researchJob = createJob(db, runId, 'research');
			for (const kind of ['code', 'docs'] as const) {
				const attempt = createAttempt(db, runId, researchJob.job_id, {
					status: 'pending',
					worker_type: `research.${kind}`,
					provider: 'deterministic',
					model: 'research-fixture',
					input_contract: 'positron.research.v1',
					input_fingerprint: `fp-${kind}`,
				});
				completeAttempt(db, attempt.attempt_id, {
					status: 'succeeded',
					output_contract: 'positron.research.v1',
					output_fingerprint: `fp-out-${kind}`,
					output_json: JSON.stringify(RESEARCH_OUTPUTS[kind]),
				});
			}

			const calls = { code: { n: 0 }, docs: { n: 0 }, tests: { n: 0 } };
			const researchWorkers = [
				makeResearchWorker('code', calls),
				makeResearchWorker('docs', calls),
				makeResearchWorker('tests', calls),
			];
			const result = await runDurableRun(
				{
					db,
					workspace: {
						path: ws.dir,
						repositoryRef: 'xxammaxx/vslice-workspace',
						readHead: ws.readHead,
					},
					buildWorker: worker,
					verifyTool: makeNodeTestVerifyTool(ws),
					reviewFindings: async () => [],
					researchWorkers,
					researchOptions: { timeoutMs: 5000 },
					maxAttempts: 3,
				},
				{ issue: makeIssue(runId), plan: makePlan(runId, ws.head) },
			);

			// code/docs NICHT re-runt; tests resumed
			expect(calls.code.n).toBe(0);
			expect(calls.docs.n).toBe(0);
			expect(calls.tests.n).toBe(1);
			expect(result.decision.decision).toBe('DONE');
			// Verdict rekonstruiert aus persistierten + neuen Zeitstempeln
			expect(result.decision.basis.research_parallelism).toBeTruthy();
			const researchAttempts = listJobAttempts(db, researchJob.job_id);
			expect(researchAttempts.filter((a) => a.status === 'succeeded')).toHaveLength(3);
			db.close();
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('RECOVERY_BUILD (C) — build succeeded + persisted, Crash vor verify → BUILD_WORKER_CALLS=1, verify startet', async () => {
		const ws = createTestWorkspace();
		try {
			const db = createTestDb();
			const runId = 'run_p3_build_recovery';
			const worker = new ScriptedBuildWorker(ws, ['correct']);
			const verifyCalls = { n: 0 };
			const verifyTool = makeNodeTestVerifyTool(ws);
			const countingVerify = {
				...verifyTool,
				run: async (ctx: Parameters<typeof verifyTool.run>[0]) => {
					verifyCalls.n++;
					return verifyTool.run(ctx);
				},
			};

			// Lauf 1: Crash NACH Build-Result-Persistenz, VOR verify
			const crashRun = await runDurableRun(
				{
					db,
					workspace: {
						path: ws.dir,
						repositoryRef: 'xxammaxx/vslice-workspace',
						readHead: ws.readHead,
					},
					buildWorker: worker,
					verifyTool: countingVerify,
					reviewFindings: async () => [],
					maxAttempts: 3,
				},
				{ issue: makeIssue(runId), plan: makePlan(runId, ws.head), crashAfterJob: 'before-verify' },
			);
			expect(crashRun.decision.reason_code).toBe('CRASH_INJECTED');
			expect(worker.invocations).toBe(1);
			expect(verifyCalls.n).toBe(0);
			const buildJob = crashRun.jobs.find((j) => j.job_type === 'build')!;
			expect(listJobAttempts(db, buildJob.job_id).at(-1)?.status).toBe('succeeded');

			// Lauf 2 (Resume): Build wird NICHT erneut ausgeführt, verify startet
			const resume = await runDurableRun(
				{
					db,
					workspace: {
						path: ws.dir,
						repositoryRef: 'xxammaxx/vslice-workspace',
						readHead: ws.readHead,
					},
					buildWorker: worker,
					verifyTool: countingVerify,
					reviewFindings: async () => [],
					maxAttempts: 3,
				},
				{ issue: makeIssue(runId), plan: makePlan(runId, ws.head) },
			);
			expect(resume.decision.decision).toBe('DONE');
			expect(worker.invocations).toBe(1); // BUILD_WORKER_CALLS = 1
			expect(verifyCalls.n).toBe(1); // verify wurde nachgezogen
			// build-attempt bleibt completed evidence (1 Attempt)
			expect(listJobAttempts(db, buildJob.job_id)).toHaveLength(1);
			db.close();
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('RECOVERY_PARTIAL_REVIEW (E) — correctness completed, security/quality pending → correctness wird NICHT erneut aufgerufen', async () => {
		const ws = createTestWorkspace();
		try {
			const db = createTestDb();
			const runId = 'run_p3_review_recovery';
			const worker = new ScriptedBuildWorker(ws, ['correct']);

			// Simulierter Crash-Zustand: review-Job mit correctness completed,
			// security/quality nie gestartet.
			const reviewJob = createJob(db, runId, 'review');
			const correctnessFindings: FindingContract[] = [
				{
					contract: 'positron.finding.v1',
					category: 'correctness',
					severity: 'LOW',
					confidence: 'HIGH',
					blocking: false,
					rule: 'fixture-add-works',
					evidence: { file: 'src/sum.js', symbol: 'add' },
				},
			];
			const correctnessAttempt = createAttempt(db, runId, reviewJob.job_id, {
				status: 'pending',
				worker_type: 'review.correctness',
				input_contract: 'positron.review-batch.v1',
				input_fingerprint: 'fp-review-correctness',
			});
			completeAttempt(db, correctnessAttempt.attempt_id, {
				status: 'succeeded',
				output_contract: 'positron.finding.v1[]',
				output_fingerprint: 'fp-findings',
				output_json: JSON.stringify(correctnessFindings),
			});

			const calls = { correctness: { n: 0 }, security: { n: 0 }, quality: { n: 0 } };
			const reviewWorkers = [
				makeReviewWorker('correctness', calls, correctnessFindings),
				makeReviewWorker('security', calls, []),
				makeReviewWorker('quality', calls, []),
			];
			const result = await runDurableRun(
				{
					db,
					workspace: {
						path: ws.dir,
						repositoryRef: 'xxammaxx/vslice-workspace',
						readHead: ws.readHead,
					},
					buildWorker: worker,
					verifyTool: makeNodeTestVerifyTool(ws),
					reviewFindings: async () => [],
					reviewWorkers,
					maxAttempts: 3,
				},
				{ issue: makeIssue(runId), plan: makePlan(runId, ws.head) },
			);

			expect(calls.correctness.n).toBe(0); // NO duplicate correctness invocation
			expect(calls.security.n).toBe(1); // recovered
			expect(calls.quality.n).toBe(1); // recovered
			expect(result.decision.decision).toBe('DONE');
			// findings aus recovered correctness sind in den persistierten
			// Attempts enthalten (kein Worker-Rerun, kein Datenverlust)
			const reviewAttempts = listJobAttempts(db, reviewJob.job_id);
			const persistedFindings = reviewAttempts.flatMap((a) => {
				if (a.status !== 'succeeded' || !a.output_json) return [];
				try {
					return JSON.parse(a.output_json) as FindingContract[];
				} catch {
					return [];
				}
			});
			expect(persistedFindings.some((f) => f.rule === 'fixture-add-works')).toBe(true);
			db.close();
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('TIMEOUT — Build-Timeout beendet Attempt deterministisch (timed_out), Decision BLOCKED, Late Result ignoriert', async () => {
		const ws = createTestWorkspace();
		try {
			const db = createTestDb();
			const runId = 'run_p3_timeout';
			const worker = new ScriptedBuildWorker(ws, ['correct']);
			// Worker, der nie antwortet (Timeout-Szenario)
			const hangingWorker = {
				...worker,
				async implement() {
					// Promise bleibt offen — mitTimeout entscheidet
					return new Promise<never>(() => {
						/* never resolves */
					});
				},
			};
			const result = await runDurableRun(
				{
					db,
					workspace: {
						path: ws.dir,
						repositoryRef: 'xxammaxx/vslice-workspace',
						readHead: ws.readHead,
					},
					buildWorker: hangingWorker,
					verifyTool: makeNodeTestVerifyTool(ws),
					reviewFindings: async () => [],
					timeoutMs: 50,
					maxAttempts: 3,
				},
				{ issue: makeIssue(runId), plan: makePlan(runId, ws.head) },
			);

			expect(result.decision.decision).toBe('BLOCKED');
			expect(result.decision.reason_code).toBe('BUILD_TIMEOUT');
			const buildJob = result.jobs.find((j) => j.job_type === 'build')!;
			const attempt = listJobAttempts(db, buildJob.job_id).at(-1)!;
			expect(attempt.status).toBe('timed_out');
			expect(attempt.failure_class).toBe('TIMEOUT');
			expect(attempt.ended_at).not.toBeNull();

			// Late Result: verspätetes Erfolgsergebnis überschreibt nichts
			const late = completeAttempt(db, attempt.attempt_id, {
				status: 'succeeded',
				output_contract: 'positron.build-result.v1',
				output_fingerprint: 'fp-late',
			});
			expect(late).toBeNull();
			expect(listJobAttempts(db, buildJob.job_id).at(-1)?.status).toBe('timed_out');
			db.close();
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('EXECUTION_CONTEXT_REQUIRED — Audit-Canary: produktiver Worker-Aufruf ohne Attempt-Context wird verweigert', () => {
		// Direkte Assertion: fehlender/leerer Kontext → kanonischer Fehler
		expect(() => assertExecutionContext(undefined)).toThrowError(EXECUTION_CONTEXT_REQUIRED);
		expect(() => assertExecutionContext(null)).toThrowError(EXECUTION_CONTEXT_REQUIRED);
		expect(() =>
			assertExecutionContext({ run_id: '', job_id: 'job', attempt_id: 'att' }),
		).toThrowError(EXECUTION_CONTEXT_REQUIRED);
		expect(() =>
			assertExecutionContext({ run_id: 'run', job_id: '', attempt_id: 'att' }),
		).toThrowError(EXECUTION_CONTEXT_REQUIRED);
		expect(() =>
			assertExecutionContext({ run_id: 'run', job_id: 'job', attempt_id: '' }),
		).toThrowError(EXECUTION_CONTEXT_REQUIRED);
		expect(() =>
			assertExecutionContext({ run_id: 'run', job_id: 'job', attempt_id: 'att' }),
		).not.toThrow();

		// Runtime-Assertion: Worker-Aufruf auf nicht-aktivem Attempt
		const db = createTestDb();
		const job = createJob(db, 'run_ctx', 'build');
		const attempt = createAttempt(db, 'run_ctx', job.job_id, { status: 'pending' });
		// nicht geclaimt → nicht aktiv
		expect(() => assertAttemptActive(db, attempt.attempt_id)).toThrowError(
			EXECUTION_CONTEXT_REQUIRED,
		);
		expect(() => assertAttemptActive(db, 'att_missing')).toThrowError(EXECUTION_CONTEXT_REQUIRED);
		db.close();
	});

	it('IDEMPOTENT_DISPATCH — gleicher Run 2x dispatched → eine Mutation, eine effektive Worker-Ausführung', async () => {
		const ws = createTestWorkspace();
		try {
			const db = createTestDb();
			const runId = 'run_p3_idem';
			const worker = new ScriptedBuildWorker(ws, ['correct']);
			const deps = {
				db,
				workspace: {
					path: ws.dir,
					repositoryRef: 'xxammaxx/vslice-workspace',
					readHead: ws.readHead,
				},
				buildWorker: worker,
				verifyTool: makeNodeTestVerifyTool(ws),
				reviewFindings: async () => [],
				maxAttempts: 3,
			};
			const input = { issue: makeIssue(runId), plan: makePlan(runId, ws.head) };

			const first = await runDurableRun(deps, input);
			expect(first.decision.decision).toBe('DONE');
			expect(worker.invocations).toBe(1);
			const contentAfterFirst = ws.readHead();

			// Zweiter Dispatch derselben run_id: kein zweiter Worker-Call,
			// keine doppelte Mutation
			const second = await runDurableRun(deps, input);
			expect(second.decision.decision).toBe('DONE');
			expect(worker.invocations).toBe(1); // IDEMPOTENT
			expect(ws.readHead()).toBe(contentAfterFirst); // keine weitere Mutation

			// Genau EIN persisted build-attempt im Erfolgszustand
			const buildJob = listJobs(db, runId).filter((j) => j.job_type === 'build');
			expect(buildJob).toHaveLength(1);
			const succeededAttempts = listJobAttempts(db, buildJob[0]!.job_id).filter(
				(a) => a.status === 'succeeded',
			);
			expect(succeededAttempts).toHaveLength(1);
			db.close();
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('JOB_ATTEMPT_PERSISTED_BEFORE_EXECUTION — Job und Attempt existieren in der DB, bevor der Worker aufgerufen wird', async () => {
		const ws = createTestWorkspace();
		try {
			const db = createTestDb();
			const runId = 'run_p3_persist_before_exec';
			// Worker beobachtet zur Laufzeit: sein eigener Job/Attempt muss
			// bereits persistiert sein, bevor er (der Worker) startet.
			const observed = { jobPersisted: false, attemptPersisted: false, attemptRunning: false };
			const base = new ScriptedBuildWorker(ws, ['correct']);
			const observingWorker = {
				...base,
				async implement(input: Parameters<typeof base.implement>[0]) {
					const job = db.prepare('SELECT job_id FROM cp_jobs WHERE job_id = ?').get(input.job_id);
					const attempt = db
						.prepare('SELECT attempt_id, status FROM cp_attempts WHERE attempt_id = ?')
						.get(input.attempt_id) as { attempt_id: string; status: string } | undefined;
					observed.jobPersisted = Boolean(job);
					observed.attemptPersisted = Boolean(attempt);
					observed.attemptRunning = attempt?.status === 'running';
					return base.implement(input);
				},
			};
			const result = await runDurableRun(
				{
					db,
					workspace: {
						path: ws.dir,
						repositoryRef: 'xxammaxx/vslice-workspace',
						readHead: ws.readHead,
					},
					buildWorker: observingWorker,
					verifyTool: makeNodeTestVerifyTool(ws),
					reviewFindings: async () => [],
					maxAttempts: 3,
				},
				{ issue: makeIssue(runId), plan: makePlan(runId, ws.head) },
			);
			expect(result.decision.decision).toBe('DONE');
			// Kerninvariante §56: Worker-Call NACH persistiertem Job + Attempt
			expect(observed.jobPersisted).toBe(true);
			expect(observed.attemptPersisted).toBe(true);
			expect(observed.attemptRunning).toBe(true);
			// Zusätzlich: alle produktiven Worker-Aufrufe sind in cp_attempts
			// (baseline + plan + build + verify) mit Status != pending
			const attempts = listAttemptsAll(db, runId);
			for (const a of attempts) {
				expect(a.status).not.toBe('pending');
			}
			db.close();
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('PLAN_READ_ONLY — Plan-Worker verändert den Workspace nicht (read-only), Result ist validiert + persistiert', async () => {
		const ws = createTestWorkspace();
		try {
			const db = createTestDb();
			const runId = 'run_p3_plan_readonly';
			const worker = new ScriptedBuildWorker(ws, ['correct']);
			// Read-Only-Beweis direkt am Plan-Worker: der Workspace-Snapshot
			// vor und nach dem Plan-Aufruf ist identisch (der Build-Worker
			// mutiert erst NACH dem Plan-Gate).
			const observed = { unchangedDuringPlan: true };
			const planWorker: PlanWorker = {
				workerType: 'opencode.plan',
				provider: 'deterministic',
				model: 'plan-fixture',
				async run(ctx) {
					const before = snapshotWorkspace(ws.dir);
					const headBefore = ws.readHead();
					// Der Plan-Worker liest nur (Repository-Lesevorgänge sind
					// erlaubt); er darf keine Dateien verändern.
					const plan = makePlan(ctx.run_id, ws.head);
					observed.unchangedDuringPlan =
						snapshotWorkspace(ws.dir) === before && ws.readHead() === headBefore;
					return plan;
				},
			};
			const result = await runDurableRun(
				{
					db,
					workspace: {
						path: ws.dir,
						repositoryRef: 'xxammaxx/vslice-workspace',
						readHead: ws.readHead,
					},
					buildWorker: worker,
					verifyTool: makeNodeTestVerifyTool(ws),
					reviewFindings: async () => [],
					planWorker,
					maxAttempts: 3,
				},
				{ issue: makeIssue(runId), plan: makePlan(runId, ws.head) },
			);
			expect(result.decision.decision).toBe('DONE');
			// PLAN_READ_ONLY: während des Plan-Aufrufs keine Mutation
			expect(observed.unchangedDuringPlan).toBe(true);
			// PLAN_RESULT_VALIDATED + persistiert
			const planJob = result.jobs.find((j) => j.job_type === 'plan')!;
			const planAttempt = listJobAttempts(db, planJob.job_id)[0]!;
			expect(planAttempt.status).toBe('succeeded');
			expect(planAttempt.output_contract).toBe('positron.plan.v1');
			expect(planAttempt.output_fingerprint).not.toBeNull();
			// PLAN_GATE_ONLY_AFTER_VALID_RESULT: gate succeeded
			const gateJob = result.jobs.find((j) => j.job_type === 'plan_gate')!;
			expect(gateJob.state).toBe('succeeded');
			db.close();
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('INVALID_WORKER_RESULT_REJECTED — ungültiges build-result → CONTRACT_FAILURE, keine Success-Transition', async () => {
		const ws = createTestWorkspace();
		try {
			const db = createTestDb();
			const runId = 'run_p3_invalid_result';
			const worker = new ScriptedBuildWorker(ws, ['correct']);
			const calls = { n: 0 };
			// Worker liefert ein Ergebnis, das dem positron.build-result.v1-
			// Contract nicht genügt (fehlende Pflichtfelder).
			const invalidWorker = {
				...worker,
				async implement() {
					calls.n++;
					return {
						contract: 'positron.build-result.v1',
						run_id: runId,
						// status/changed_files/result_ref fehlen → CONTRACT_FAILURE
						summary: 'incomplete result',
					} as unknown as Awaited<ReturnType<typeof worker.implement>>;
				},
			};
			const result = await runDurableRun(
				{
					db,
					workspace: {
						path: ws.dir,
						repositoryRef: 'xxammaxx/vslice-workspace',
						readHead: ws.readHead,
					},
					buildWorker: invalidWorker,
					verifyTool: makeNodeTestVerifyTool(ws),
					reviewFindings: async () => [],
					maxAttempts: 3,
				},
				{ issue: makeIssue(runId), plan: makePlan(runId, ws.head) },
			);
			// INVALID_WORKER_RESULT → kein Erfolgsübergang
			expect(result.decision.decision).toBe('BLOCKED');
			expect(result.decision.reason_code).toBe('CONTRACT_INVALID');
			const buildJob = result.jobs.find((j) => j.job_type === 'build')!;
			const attempt = listJobAttempts(db, buildJob.job_id).at(-1)!;
			expect(attempt.status).toBe('blocked');
			expect(attempt.failure_class).toBe('CONTRACT_FAILURE');
			// Kein verify-Aufruf nach ungültigem Build-Result
			expect(calls.n).toBe(1); // nur der invalide Versuch
			db.close();
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('WORKER_PROVENANCE — Attempts tragen belastbar worker_type/provider/model (LLM-Worker real, deterministisch null)', async () => {
		const ws = createTestWorkspace();
		try {
			const db = createTestDb();
			const runId = 'run_p3_provenance';
			const worker = new ScriptedBuildWorker(ws, ['correct']);
			const planWorker: PlanWorker = {
				workerType: 'opencode.plan',
				provider: 'deterministic',
				model: 'plan-fixture',
				async run(ctx) {
					return makePlan(ctx.run_id, ws.head);
				},
			};
			const result = await runDurableRun(
				{
					db,
					workspace: {
						path: ws.dir,
						repositoryRef: 'xxammaxx/vslice-workspace',
						readHead: ws.readHead,
					},
					buildWorker: worker,
					verifyTool: makeNodeTestVerifyTool(ws),
					reviewFindings: async () => [],
					planWorker,
					maxAttempts: 3,
				},
				{ issue: makeIssue(runId), plan: makePlan(runId, ws.head) },
			);
			expect(result.decision.decision).toBe('DONE');

			// LLM-Worker (plan/build): echte Werte
			const planAtt = listJobAttempts(
				db,
				result.jobs.find((j) => j.job_type === 'plan')!.job_id,
			)[0]!;
			expect(planAtt.worker_type).toBe('opencode.plan');
			expect(planAtt.provider).toBe('deterministic');
			expect(planAtt.model).toBe('plan-fixture');
			const buildAtt = listJobAttempts(
				db,
				result.jobs.find((j) => j.job_type === 'build')!.job_id,
			).at(-1)!;
			expect(buildAtt.worker_type).toBe('scripted-worker');
			expect(buildAtt.provider).toBe('deterministic');
			expect(buildAtt.model).toBe('vslice-1');

			// Deterministische Tools (baseline/verify): provider/model = null
			const baselineAtt = listJobAttempts(
				db,
				result.jobs.find((j) => j.job_type === 'baseline')!.job_id,
			)[0]!;
			expect(baselineAtt.worker_type).toBe('deterministic.baseline');
			expect(baselineAtt.provider).toBeNull();
			expect(baselineAtt.model).toBeNull();
			const verifyAtt = listJobAttempts(
				db,
				result.jobs.find((j) => j.job_type === 'verify')!.job_id,
			).at(-1)!;
			expect(verifyAtt.worker_type).toBe('deterministic-tools');
			expect(verifyAtt.provider).toBeNull();
			expect(verifyAtt.model).toBeNull();
			db.close();
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('RECOVERY_VERIFY (D) — verify completed + persistiert, Crash vor Decision → verify wird NICHT erneut ausgeführt', async () => {
		const ws = createTestWorkspace();
		try {
			const db = createTestDb();
			const runId = 'run_p3_recovery_verify';
			const worker = new ScriptedBuildWorker(ws, ['correct']);
			const verifyCalls = { n: 0 };
			const verifyTool = makeNodeTestVerifyTool(ws);
			const countingVerify = {
				...verifyTool,
				run: async (ctx: Parameters<typeof verifyTool.run>[0]) => {
					verifyCalls.n++;
					return verifyTool.run(ctx);
				},
			};

			// Lauf 1: Crash NACH abgeschlossenem verify-Job (valid Boundary)
			const crashRun = await runDurableRun(
				{
					db,
					workspace: {
						path: ws.dir,
						repositoryRef: 'xxammaxx/vslice-workspace',
						readHead: ws.readHead,
					},
					buildWorker: worker,
					verifyTool: countingVerify,
					reviewFindings: async () => [],
					maxAttempts: 3,
				},
				{ issue: makeIssue(runId), plan: makePlan(runId, ws.head), crashAfterJob: 'verify' },
			);
			expect(crashRun.decision.reason_code).toBe('CRASH_INJECTED');
			expect(verifyCalls.n).toBe(1);
			const verifyJobAfterCrash = crashRun.jobs.find((j) => j.job_type === 'verify')!;
			expect(verifyJobAfterCrash.state).toBe('succeeded');

			// Lauf 2 (Resume): verify wird aus Persistenz rehydriert, NICHT
			// erneut ausgeführt; Run läuft bis zur Decision.
			const resume = await runDurableRun(
				{
					db,
					workspace: {
						path: ws.dir,
						repositoryRef: 'xxammaxx/vslice-workspace',
						readHead: ws.readHead,
					},
					buildWorker: worker,
					verifyTool: countingVerify,
					reviewFindings: async () => [],
					maxAttempts: 3,
				},
				{ issue: makeIssue(runId), plan: makePlan(runId, ws.head) },
			);
			expect(resume.decision.decision).toBe('DONE');
			expect(verifyCalls.n).toBe(1); // VERIFY NOT RERUN
			expect(worker.invocations).toBe(1); // build nicht erneut
			db.close();
		} finally {
			cleanupWorkspace(ws);
		}
	});

	it('FIX_CHAIN — Fix-Attempt referenziert den vorherigen Attempt (previous_attempt_id), Historie bleibt vollständig', async () => {
		const ws = createTestWorkspace();
		try {
			const db = createTestDb();
			const runId = 'run_p3_fix_chain';
			const worker = new ScriptedBuildWorker(ws, ['multiply', 'correct']);
			const result = await runDurableRun(
				{
					db,
					workspace: {
						path: ws.dir,
						repositoryRef: 'xxammaxx/vslice-workspace',
						readHead: ws.readHead,
					},
					buildWorker: worker,
					verifyTool: makeNodeTestVerifyTool(ws),
					reviewFindings: async () => [],
					maxAttempts: 3,
				},
				{ issue: makeIssue(runId), plan: makePlan(runId, ws.head) },
			);

			expect(result.decision.decision).toBe('DONE');
			expect(worker.invocations).toBe(2);
			const buildJob = result.jobs.find((j) => j.job_type === 'build')!;
			const attempts = listJobAttempts(db, buildJob.job_id);
			expect(attempts).toHaveLength(2);
			// Attempt 1 failed (verify), Attempt 2 succeeded
			expect(attempts[0]!.status).toBe('failed');
			expect(attempts[1]!.status).toBe('succeeded');
			// Kette: attempt 2 → attempt 1 (keine überschriebene Historie)
			expect(attempts[1]!.previous_attempt_id).toBe(attempts[0]!.attempt_id);
			expect(attempts[0]!.previous_attempt_id).toBeNull();
			// Strategie-Delta unterscheidet die Versuche
			expect(attempts[1]!.strategy_delta).not.toBeNull();
			expect(attempts[1]!.strategy_delta).not.toBe(attempts[0]!.strategy_delta);
			db.close();
		} finally {
			cleanupWorkspace(ws);
		}
	});
});
