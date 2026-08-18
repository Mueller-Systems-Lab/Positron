// Positron Control Plane — Runtime Soak & Recovery Proof (P2-C)
//
// Mehrere VOLLSTÄNDIGE reale Runs in disposable Git-Workspaces. Ziel:
// Die Runtime-Invarianten bleiben über mehrere unterschiedliche reale
// Ausführungen korrekt.
//
// Run A — Happy Path          (INTAKE→BASELINE→RESEARCH→PLAN→PLAN_GATE→BUILD→VERIFY→REVIEW→DONE)
// Run B — Fix Path            (VERIFY FAIL → failure_signature → new_evidence → strategy_delta → FIX → DONE)
// Run C — Blind Retry Denial  (RETRY_DENIED_NO_STRATEGY_DELTA, kein zweiter LLM-Call)
// Run D — Security Block      (grüne Gates + CRITICAL-Finding → BLOCKED, SECURITY_BLOCK)
// Run E — Recovery            (Crash nach verify → Resume: kein Rerun, keine duplicate mutation)
// Run F — Negative Canary     (sequentielles Research → PARALLELISM_NOT_PROVEN, kein künstlicher PASS)
//
// Danach: KPI-Baseline über die PERSISTIERTEN Soak-Daten (dieselbe DB) +
// Trace Completeness Messung.

import fs from 'node:fs';
import path from 'node:path';
import { TestCommandDetector, TestRunner } from '@positron/sandbox';
import { afterAll, describe, expect, it } from 'vitest';
import type { AttemptRecord } from '../store.js';
import type { FindingContract, PlanContract } from '../contracts.js';
import { runDurableRun } from '../durable-run.js';
import { assertKpiInvariants, computeKpis } from '../kpis.js';
import type { ResearchWorker } from '../research.js';
import { listJobAttempts, listJobs, listTransitions } from '../store.js';
import {
	ScriptedBuildWorker,
	cleanupWorkspace,
	createTestDb,
	createTestWorkspace,
	makeNodeTestVerifyTool,
	readFile,
} from './vertical-slice-helpers.js';
import type { TestWorkspace } from './vertical-slice-helpers.js';

const SOAK_TIMEOUT = 120_000;
const SOAK_SAMPLE_SIZE = 6;

function makePlan(runId: string, workspace: TestWorkspace): PlanContract {
	return {
		contract: 'positron.plan.v1',
		run_id: runId,
		repository_ref: 'xxammaxx/soak-workspace',
		repository_head: workspace.head,
		targets: { files: ['src/sum.js'], symbols: ['add'] },
		acceptance_criteria: ['add(2, 3) returns 5', 'add(0, 0) returns 0'],
		required_tests: ['test/sum.test.js'],
		risks: [],
		build_scope: { allowed_files: ['src/', 'test/'] },
		context: { fingerprint: 'fp_soak_context_1234' },
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
		source_type: 'soak-task',
		source_ref: 'soak:sum',
		repository_ref: 'xxammaxx/soak-workspace',
		title: 'Soak run',
	};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeResearchWorkers(workspace: TestWorkspace): ResearchWorker[] {
	return (['code', 'docs', 'tests'] as const).map((kind) => ({
		kind,
		workerType: `research-worker:${kind}`,
		provider: 'deterministic',
		model: 'soak-v1',
		required: kind === 'code',
		async run(ctx) {
			const files = fs.readdirSync(path.join(workspace.dir, 'src'));
			await sleep(15);
			return {
				summary_ref: `research:${kind}:${files.sort().join(',')}`,
				sources: [`workspace://src/${kind}.md`],
				notes: `attempt ${ctx.attempt_id.slice(0, 8)}`,
			};
		},
	}));
}

function makeSecurityFinding(): FindingContract {
	return {
		contract: 'positron.finding.v1',
		category: 'security',
		severity: 'CRITICAL',
		confidence: 'HIGH',
		blocking: true,
		rule: 'hardcoded-secret-in-src',
		evidence: { file: 'src/sum.js', symbol: 'add', line_range: [1, 3] },
		recommendation: 'move secret to env',
	};
}

/** Trace Completeness: prüft Pflichtfelder je Attempt-Typ (anwendbare). */
function assertTraceComplete(attempt: AttemptRecord, context: string): void {
	expect(attempt.run_id, `${context}: run_id`).toBeTruthy();
	expect(attempt.job_id, `${context}: job_id`).toBeTruthy();
	expect(attempt.attempt_id, `${context}: attempt_id`).toBeTruthy();
	expect(attempt.started_at, `${context}: started_at`).toBeTruthy();
	if (attempt.status === 'succeeded' || attempt.status === 'failed') {
		expect(attempt.ended_at, `${context}: ended_at`).toBeTruthy();
	}
	// Anwendbare Contract-Fingerprints
	if (attempt.input_contract) {
		expect(attempt.input_fingerprint, `${context}: input_fingerprint`).toMatch(/^[0-9a-f]{64}$/);
	}
	if (attempt.output_contract) {
		expect(attempt.output_fingerprint, `${context}: output_fingerprint`).toMatch(/^[0-9a-f]{64}$/);
	}
	// Anwendbare Worker-Telemetrie
	if (attempt.status === 'succeeded' || attempt.status === 'failed') {
		expect(attempt.worker_type, `${context}: worker_type`).toBeTruthy();
	}
}

// ---------------------------------------------------------------------------
// SOAK — 6 reale Runs auf EINER persistierten DB (dieselbe KPI-Basis)
// ---------------------------------------------------------------------------

describe(
	'RUNTIME_SOAK (disposable workspaces, real runs)',
	() => {
		const db = createTestDb();
		const wsA = createTestWorkspace();
		const wsB = createTestWorkspace();
		const wsC = createTestWorkspace();
		const wsD = createTestWorkspace();
		const wsE = createTestWorkspace();
		const wsF = createTestWorkspace();

		it('SOAK_RUN_A — Happy Path: roter Test → DONE mit grünem Test', async () => {
			const worker = new ScriptedBuildWorker(wsA, ['correct']);
			const verifyTool = makeNodeTestVerifyTool(wsA);
			const issue = makeIssue('soak_a_happy');

			const result = await runDurableRun(
				{
					db,
					workspace: {
						path: wsA.dir,
						repositoryRef: 'xxammaxx/soak-workspace',
						readHead: wsA.readHead,
					},
					buildWorker: worker,
					verifyTool,
					reviewFindings: async () => [],
					researchWorkers: makeResearchWorkers(wsA),
					maxAttempts: 3,
				},
				{ issue, plan: makePlan(issue.run_id, wsA) },
			);

			expect(result.decision.decision).toBe('DONE');
			expect(result.decision.reason_code).toBe('ALL_HARD_GATES_GREEN');
			expect(readFile(wsA, 'src/sum.js')).toContain('a + b');
			expect(worker.invocations).toBe(1);
			// Persistierte Transitions decken den Happy Path ab
			const reasons = listTransitions(db, issue.run_id).map((t) => t.reason_code);
			expect(reasons).toContain('RESEARCH_JOIN');
			expect(reasons).toContain('PLAN_GATE_APPROVED');
			expect(reasons).toContain('VERIFY_PASS');
			// Research-Parallelismus real bewiesen
			expect(result.decision.basis.research_parallelism).toBe('PARALLELISM_PROVEN');
			// Trace Completeness für wesentliche Jobs
			const buildAttempts = listJobAttempts(
				db,
				result.jobs.find((j) => j.job_type === 'build')!.job_id,
			);
			for (const a of buildAttempts) assertTraceComplete(a, 'SOAK_A build');
			const researchAttempts = listJobAttempts(
				db,
				result.jobs.find((j) => j.job_type === 'research')!.job_id,
			);
			expect(researchAttempts).toHaveLength(3);
			for (const a of researchAttempts) assertTraceComplete(a, 'SOAK_A research');
		});

		it('SOAK_RUN_B — Fix Path: VERIFY FAIL → new_evidence → strategy_delta → DONE', async () => {
			const worker = new ScriptedBuildWorker(wsB, ['broken', 'correct']);
			const verifyTool = makeNodeTestVerifyTool(wsB);
			const issue = makeIssue('soak_b_fix');

			const result = await runDurableRun(
				{
					db,
					workspace: {
						path: wsB.dir,
						repositoryRef: 'xxammaxx/soak-workspace',
						readHead: wsB.readHead,
					},
					buildWorker: worker,
					verifyTool,
					reviewFindings: async () => [],
					maxAttempts: 3,
				},
				{ issue, plan: makePlan(issue.run_id, wsB) },
			);

			expect(result.decision.decision).toBe('DONE');
			expect(worker.invocations).toBe(2);
			// Attempt 1 failed mit failure_signature, Attempt 2 succeeded
			const buildJob = result.jobs.find((j) => j.job_type === 'build')!;
			const attempts = listJobAttempts(db, buildJob.job_id);
			expect(attempts).toHaveLength(2);
			expect(attempts[0]!.status).toBe('failed');
			expect(attempts[0]!.failure_class).toBeTruthy();
			expect(attempts[0]!.failure_signature).toBeTruthy();
			expect(attempts[1]!.status).toBe('succeeded');
			// Strategy Delta im zweiten Attempt (Information Gain)
			expect(attempts[1]!.strategy_delta).toBeTruthy();
			// Attempt 1 ≠ Attempt 2 (inhaltlich verschieden)
			expect(attempts[0]!.input_fingerprint).not.toBe(attempts[1]!.input_fingerprint);
			// Alte Attempts bleiben erhalten (Historie vollständig)
			expect(listJobAttempts(db, buildJob.job_id)).toHaveLength(2);
			// new_evidence liegt auf dem fehlgeschlagenen VERIFY-Attempt
			const verifyJob = result.jobs.find((j) => j.job_type === 'verify')!;
			const verifyAttempts = listJobAttempts(db, verifyJob.job_id);
			const failedVerify = verifyAttempts.find((a) => a.status === 'failed');
			expect(failedVerify).toBeDefined();
			expect(failedVerify!.new_evidence).toBeTruthy();
			expect(failedVerify!.failure_class).toBeTruthy();
			expect(failedVerify!.failure_signature).toBeTruthy();
			// Verify-Fail-Transition persistiert
			const reasons = listTransitions(db, issue.run_id).map((t) => t.reason_code);
			expect(reasons).toContain('VERIFY_FAIL');
			expect(reasons).toContain('VERIFY_PASS');
			for (const a of attempts) assertTraceComplete(a, 'SOAK_B build');
		});

		it('SOAK_RUN_C — Blind Retry Denial: identischer Versuch → RETRY_DENIED_NO_STRATEGY_DELTA, kein 2. Worker-Call', async () => {
			// Deterministic failure injection: VerifyTool liefert die echten
			// Test-Ergebnisse, aber bewusst KEINE new_evidence — identischer
			// Fehler ohne Information Gain (Same input/failure/context/strategy).
			const worker = new ScriptedBuildWorker(wsC, ['multiply']);
			const detector = new TestCommandDetector();
			const runner = new TestRunner();
			const silentVerifyTool = {
				async run(ctx: {
					run_id: string;
					job_id: string;
					attempt_id: string;
					workspacePath: string;
				}) {
					const detection = await detector.detect(wsC.dir);
					const report = await runner.runDetectedCommands({
						runId: ctx.run_id,
						workspacePath: wsC.dir,
						commands: detection.commands,
						mode: 'standard',
					});
					return {
						checks: [
							{
								name: 'npm test',
								passed: report.status === 'passed',
								kind: 'unit' as const,
								duration_ms: 10,
							},
						],
						// bewusst KEINE new_evidence
					};
				},
			};
			const issue = makeIssue('soak_c_denial');

			const result = await runDurableRun(
				{
					db,
					workspace: {
						path: wsC.dir,
						repositoryRef: 'xxammaxx/soak-workspace',
						readHead: wsC.readHead,
					},
					buildWorker: worker,
					verifyTool: silentVerifyTool,
					reviewFindings: async () => [],
					maxAttempts: 3,
				},
				{ issue, plan: makePlan(issue.run_id, wsC) },
			);

			// Kein blinder Retry: exakt EIN Worker-Aufruf
			expect(worker.invocations).toBe(1);
			expect(result.decision.decision).toBe('SPLIT');
			expect(result.decision.reason_code).toBe('RETRY_DENIED_NO_STRATEGY_DELTA');
			// failure_signature aus echter Test-Evidenz (multiply statt add)
			expect(result.decision.basis.failure_class).toBeTruthy();
			expect(result.decision.basis.failure_signature).toBeTruthy();
		});

		it('SOAK_RUN_D — Security Block: grüne Gates + CRITICAL-Finding → BLOCKED (SECURITY_BLOCK)', async () => {
			const worker = new ScriptedBuildWorker(wsD, ['correct']);
			const verifyTool = makeNodeTestVerifyTool(wsD);
			const issue = makeIssue('soak_d_security');

			const result = await runDurableRun(
				{
					db,
					workspace: {
						path: wsD.dir,
						repositoryRef: 'xxammaxx/soak-workspace',
						readHead: wsD.readHead,
					},
					buildWorker: worker,
					verifyTool,
					reviewFindings: async () => [makeSecurityFinding()],
					maxAttempts: 3,
				},
				{ issue, plan: makePlan(issue.run_id, wsD) },
			);

			expect(result.decision.decision).toBe('BLOCKED');
			expect(result.decision.reason_code).toBe('SECURITY_BLOCK');
			// Kein Mehrheitsvotum: technische Gates waren grün (Build+Verify ok)
			expect(worker.invocations).toBe(1);
			expect(result.decision.basis.blocking_findings).toBeDefined();
			const findings = result.decision.basis.blocking_findings as Array<{ severity: string }>;
			expect(findings[0]?.severity).toBe('CRITICAL');
		});

		it('SOAK_RUN_E — Recovery: Crash nach verify → Resume ohne Rerun, keine duplicate mutation', async () => {
			const worker = new ScriptedBuildWorker(wsE, ['correct']);
			const verifyTool = makeNodeTestVerifyTool(wsE);
			const issue = makeIssue('soak_e_recovery');

			// Lauf 1: Crash nach completed verify
			const crashRun = await runDurableRun(
				{
					db,
					workspace: {
						path: wsE.dir,
						repositoryRef: 'xxammaxx/soak-workspace',
						readHead: wsE.readHead,
					},
					buildWorker: worker,
					verifyTool,
					reviewFindings: async () => [],
					researchWorkers: makeResearchWorkers(wsE),
					maxAttempts: 3,
				},
				{ issue, plan: makePlan(issue.run_id, wsE), crashAfterJob: 'verify' },
			);
			expect(crashRun.decision.reason_code).toBe('CRASH_INJECTED');
			expect(worker.invocations).toBe(1);
			const jobsAfterCrash = listJobs(db, issue.run_id);
			const buildJob = jobsAfterCrash.find((j) => j.job_type === 'build')!;
			const attemptsAfterCrash = listJobAttempts(db, buildJob.job_id);
			expect(attemptsAfterCrash).toHaveLength(1);

			// Lauf 2: Resume mit derselben run_id
			const resumeRun = await runDurableRun(
				{
					db,
					workspace: {
						path: wsE.dir,
						repositoryRef: 'xxammaxx/soak-workspace',
						readHead: wsE.readHead,
					},
					buildWorker: worker,
					verifyTool,
					reviewFindings: async () => [],
					researchWorkers: makeResearchWorkers(wsE),
					maxAttempts: 3,
				},
				{ issue, plan: makePlan(issue.run_id, wsE) },
			);

			expect(resumeRun.decision.decision).toBe('DONE');
			// completed job wird NICHT re-runt (kein zweiter Worker-Call)
			expect(worker.invocations).toBe(1);
			expect(listJobAttempts(db, buildJob.job_id)).toHaveLength(1);
			// keine duplicate mutation: keine denied/duplicate-dispatch Attempts
			const allAttempts = listJobAttempts(db, buildJob.job_id);
			expect(allAttempts.every((a) => a.status !== 'denied')).toBe(true);
			// kein doppelter State-Übergang auf derselben Boundary
			const verifyTransitions = listTransitions(db, issue.run_id).filter(
				(t) => t.reason_code === 'VERIFY_PASS',
			);
			expect(verifyTransitions.length).toBe(1);
		});

		it('SOAK_RUN_F — Parallelism Negative Canary: sequentielles Research → PARALLELISM_NOT_PROVEN', async () => {
			const worker = new ScriptedBuildWorker(wsF, ['correct']);
			const verifyTool = makeNodeTestVerifyTool(wsF);
			const issue = makeIssue('soak_f_negative');

			const result = await runDurableRun(
				{
					db,
					workspace: {
						path: wsF.dir,
						repositoryRef: 'xxammaxx/soak-workspace',
						readHead: wsF.readHead,
					},
					buildWorker: worker,
					verifyTool,
					reviewFindings: async () => [],
					researchWorkers: makeResearchWorkers(wsF),
					researchOptions: { sequential: true },
					maxAttempts: 3,
				},
				{ issue, plan: makePlan(issue.run_id, wsF) },
			);

			expect(result.decision.decision).toBe('DONE');
			// Ehrlicher Verdict: kein künstliches PASS
			expect(result.decision.basis.research_parallelism).toBe('PARALLELISM_NOT_PROVEN');
			// Persistierte Zeitstempel belegen strikte Sequentialität
			const researchJob = result.jobs.find((j) => j.job_type === 'research')!;
			const attempts = listJobAttempts(db, researchJob.job_id);
			expect(attempts).toHaveLength(3);
			const sorted = [...attempts].sort(
				(a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
			);
			for (let i = 0; i < sorted.length - 1; i++) {
				expect(new Date(sorted[i + 1]!.started_at).getTime()).toBeGreaterThanOrEqual(
					new Date(sorted[i]!.ended_at!).getTime(),
				);
			}
		});

		it('SOAK_KPI_BASELINE — KPIs über persistierte reale Soak-Daten; Invarianten halten', () => {
			const kpis = computeKpis(db);
			const violations = assertKpiInvariants(kpis);

			// Harte Invarianten (persistierte reale Daten)
			expect(violations).toEqual([]);
			expect(kpis.blind_retry_rate).toBe(0);
			expect(kpis.duplicate_mutation_rate).toBe(0);
			expect(kpis.security_block_enforcement_rate).toBe(1);

			// Berichtete Kennzahlen (SOAK_SAMPLE_SIZE = 6 Runs)
			expect(kpis.runs_total).toBe(SOAK_SAMPLE_SIZE);
			expect(kpis.done_runs).toBe(4); // A, B, E, F
			// First-Pass: DONE-Runs mit genau 1 Build-Attempt: A, E, F → 3/4
			expect(kpis.first_pass_success_rate).toBeCloseTo(0.75, 5);
			// Mean Attempts to DONE: (1 + 2 + 1 + 1) / 4 = 1.25
			expect(kpis.mean_attempts_to_done).toBeCloseTo(1.25, 5);
			// Retry Denials: genau Run C (identischer Versuch)
			expect(kpis.retry_denials).toBe(1);
			// Useful Retry: keine persistierte FIX-Enddecision (Run B erreichte
			// DONE) → 0 / (0 + 1)
			expect(kpis.useful_retry_rate).toBe(0);
			// Trace Completeness: alle 6 Runs haben Transitions + Decision
			expect(kpis.trace_completeness).toBe(1);
			// p50/p95 über alle Attempts (echte gemessene Dauern)
			expect(kpis.p50_stage_duration_ms).not.toBeNull();
			expect(kpis.p95_stage_duration_ms).not.toBeNull();
		});

		it('SOAK_TRACE_COMPLETENESS — wesentliche Jobs sind lückenlos nachvollziehbar', () => {
			const runs = [
				'soak_a_happy',
				'soak_b_fix',
				'soak_c_denial',
				'soak_d_security',
				'soak_e_recovery',
				'soak_f_negative',
			];
			for (const runId of runs) {
				const jobs = listJobs(db, runId);
				expect(jobs.length).toBeGreaterThan(0);
				for (const job of jobs) {
					const attempts = listJobAttempts(db, job.job_id);
					for (const a of attempts) {
						assertTraceComplete(a, `${runId}/${job.job_type}`);
					}
					// Entscheidungs-Trace: jeder Run hat eine persistierte Decision
					// und mindestens eine Transition
					expect(listTransitions(db, runId).length).toBeGreaterThan(0);
				}
			}
		});

		// Cleanup läuft auch dann, wenn einzelne Soak-Tests fehlschlagen
		// (afterAll statt it — kein Workspace-Leak bei fehlgeschlagenen Runs).
		afterAll(() => {
			for (const ws of [wsA, wsB, wsC, wsD, wsE, wsF]) {
				cleanupWorkspace(ws);
			}
		});
	},
	SOAK_TIMEOUT,
);
