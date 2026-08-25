// Positron Control Plane — Vertical Slices (REAL, keine Mocks)
//
// Beweise mit echter fachlicher Wirkung:
// - FULL_HAPPY_PATH: kontrolliert roter Test → Run → Test wirklich grün
// - FULL_FIX_PATH: Attempt 1 failed → FIX → Attempt 2 erfolgreich, inhaltlich verschieden
// - RECOVERY: Crash nach completed job → kein Rerun, valide Boundary
// - BLIND_RETRY_CANARY: identischer Versuch → RETRY_DENIED_NO_STRATEGY_DELTA, kein 2. Worker-Call

import { TestCommandDetector, TestRunner } from '@positron/sandbox';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlanContract } from '../contracts.js';
import type { VerificationTool } from '../durable-run.js';
import { isJobCompleted, recoveryBoundary, runDurableRun } from '../durable-run.js';
import type { ReviewWorker } from '../review.js';
import type { TestWorkspace } from './vertical-slice-helpers.js';
import {
	cleanupWorkspace,
	createTestDb,
	createTestWorkspace,
	makeNodeTestVerifyTool,
	readFile,
	ScriptedBuildWorker,
} from './vertical-slice-helpers.js';

let ws: TestWorkspace | null = null;

afterEach(() => {
	if (ws) {
		cleanupWorkspace(ws);
		ws = null;
	}
});

function makePlan(runId: string, workspace: TestWorkspace): PlanContract {
	return {
		contract: 'positron.plan.v1',
		run_id: runId,
		repository_ref: 'xxammaxx/vslice-workspace',
		repository_head: workspace.head,
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

describe('FULL_HAPPY_PATH', () => {
	it('runs a real issue-to-DONE slice: failing test becomes green', async () => {
		ws = createTestWorkspace(); // src/sum.js ist BROKEN → Test ist real rot
		const db = createTestDb();
		const worker = new ScriptedBuildWorker(ws, ['correct']);
		const verifyTool = makeNodeTestVerifyTool(ws);

		// Ausgangslage beweisen: Test ist REAL rot
		const initial = await runTestsReal(ws.dir);
		expect(initial.status).not.toBe('passed');

		const issue = makeIssue('run_vslice_happy');
		const result = await runDurableRun(
			{
				db,
				workspace: {
					path: ws.dir,
					repositoryRef: 'xxammaxx/vslice-workspace',
					readHead: ws.readHead,
				},
				buildWorker: worker,
				verifyTool,
				reviewFindings: async () => [],
				maxAttempts: 3,
			},
			{ issue, plan: makePlan(issue.run_id, ws) },
		);

		expect(result.decision.decision).toBe('DONE');
		expect(result.decision.reason_code).toBe('ALL_HARD_GATES_GREEN');
		expect(result.workerInvocations).toBe(1);

		// Fachliche Wirkung: Test ist jetzt REAL grün im Workspace
		const final = await runTestsReal(ws.dir);
		expect(final.status).toBe('passed');
		expect(readFile(ws, 'src/sum.js')).toContain('a + b');

		// Transitions-Kette komplett
		const chain = result.transitions.map((t) => t.reason_code);
		expect(chain).toContain('PLAN_GATE_APPROVED');
		expect(chain).toContain('VERIFY_PASS');
		expect(chain).toContain('ALL_HARD_GATES_GREEN');

		// Jobs: intake → baseline → plan → plan_gate → build → verify → review
		const jobTypes = result.jobs.map((j) => j.job_type);
		expect(jobTypes).toContain('intake');
		expect(jobTypes).toContain('baseline');
		expect(jobTypes).toContain('plan_gate');
		expect(jobTypes).toContain('build');
		expect(jobTypes).toContain('verify');
		expect(jobTypes).toContain('review');
		db.close();
	});
});

describe('FULL_FIX_PATH', () => {
	it('attempt 1 fails verification, fix attempt 2 succeeds with visible delta', async () => {
		ws = createTestWorkspace();
		const db = createTestDb();
		// Script: Attempt 1 schreibt die FALSCHE Implementierung, Attempt 2 die korrekte
		const worker = new ScriptedBuildWorker(ws, ['multiply', 'correct']);
		const verifyTool = makeNodeTestVerifyTool(ws);

		const issue = makeIssue('run_vslice_fix');
		const result = await runDurableRun(
			{
				db,
				workspace: {
					path: ws.dir,
					repositoryRef: 'xxammaxx/vslice-workspace',
					readHead: ws.readHead,
				},
				buildWorker: worker,
				verifyTool,
				reviewFindings: async () => [],
				maxAttempts: 3,
			},
			{ issue, plan: makePlan(issue.run_id, ws) },
		);

		expect(result.decision.decision).toBe('DONE');
		expect(worker.invocations).toBe(2);

		// Attempt-Historie: 2 Build-Attempts, erster failed, zweiter succeeded
		const buildJob = result.jobs.find((j) => j.job_type === 'build')!;
		const buildAttempts = result.attempts.filter((a) => a.job_id === buildJob.job_id);
		expect(buildAttempts.length).toBe(2);
		expect(buildAttempts[0]?.status).toBe('failed');
		expect(buildAttempts[0]?.failure_class).toBe('TEST_FAILURE');
		expect(buildAttempts[0]?.failure_signature).toBeTruthy();
		expect(buildAttempts[0]?.output_fingerprint).not.toBe(buildAttempts[1]?.output_fingerprint);

		// Attempt 2 trägt das von der Control Plane abgeleitete Strategie-Delta
		const second = buildAttempts[1]!;
		expect(second.status).toBe('succeeded');
		expect(second.strategy_delta).toContain('Fix per verification evidence');

		// Attempt 1 vs 2 unterscheiden sich INHALTLICH (Datei-Inhalt)
		expect(worker.invocations).toBe(2);
		expect(readFile(ws, 'src/sum.js')).toContain('a + b');

		// Transitions: VERIFY_FAIL → FIX → VERIFY_PASS → DONE
		const chain = result.transitions.map((t) => t.reason_code);
		expect(chain).toContain('VERIFY_FAIL');
		expect(chain).toContain('ALL_HARD_GATES_GREEN');
		db.close();
	});
});

describe('RECOVERY', () => {
	it('crash after completed verify job: completed jobs are NOT rerun, run resumes at valid boundary', async () => {
		ws = createTestWorkspace();
		const db = createTestDb();
		const worker = new ScriptedBuildWorker(ws, ['correct']);
		const verifyTool = makeNodeTestVerifyTool(ws);

		const issue = makeIssue('run_vslice_recovery');

		// Lauf 1: Crash NACH erfolgreichem verify-Job (simulierter Prozessausfall)
		const crashRun = await runDurableRun(
			{
				db,
				workspace: {
					path: ws.dir,
					repositoryRef: 'xxammaxx/vslice-workspace',
					readHead: ws.readHead,
				},
				buildWorker: worker,
				verifyTool,
				reviewFindings: async () => [],
				maxAttempts: 3,
			},
			{ issue, plan: makePlan(issue.run_id, ws), crashAfterJob: 'verify' },
		);
		expect(crashRun.decision.reason_code).toBe('CRASH_INJECTED');
		expect(worker.invocations).toBe(1);

		// Completed Jobs nach Crash
		const completedBefore = crashRun.jobs.filter((j) => j.state === 'succeeded');
		expect(completedBefore.length).toBeGreaterThanOrEqual(5); // intake..verify
		const buildJob = crashRun.jobs.find((j) => j.job_type === 'build')!;
		expect(isJobCompleted(db, buildJob.job_id)).toBe(true);

		// Valide Boundary NACH dem Crash: letzter abgeschlossener Job ist verify
		const boundary = recoveryBoundary(db, issue.run_id);
		expect(boundary).not.toBeNull();
		expect(boundary!.state).toBe('verify');

		// Lauf 2: Resume mit derselben run_id → build+verify werden NICHT erneut ausgeführt
		const resumeRun = await runDurableRun(
			{
				db,
				workspace: {
					path: ws.dir,
					repositoryRef: 'xxammaxx/vslice-workspace',
					readHead: ws.readHead,
				},
				buildWorker: worker,
				verifyTool,
				reviewFindings: async () => [],
				maxAttempts: 3,
			},
			{ issue, plan: makePlan(issue.run_id, ws) },
		);

		expect(resumeRun.decision.decision).toBe('DONE');
		// KEIN zweiter Worker-Aufruf für den bereits abgeschlossenen Job
		expect(worker.invocations).toBe(1);
		expect(isJobCompleted(db, buildJob.job_id)).toBe(true);
		db.close();
	});
});

describe('BLIND_RETRY_CANARY', () => {
	it('identical attempt (same input, same failure, no delta) → RETRY_DENIED_NO_STRATEGY_DELTA and NO second worker call', async () => {
		ws = createTestWorkspace();
		const db = createTestDb();
		const worker = new ScriptedBuildWorker(ws, ['multiply']); // würde bei 2. Aufruf erneut schreiben

		// VerifyTool OHNE new_evidence: identischer Fehler, keine neue Information
		const detector = new TestCommandDetector();
		const runner = new TestRunner();
		const silentVerifyTool: VerificationTool = {
			async run(ctx) {
				const detection = await detector.detect(ws!.dir);
				const report = await runner.runDetectedCommands({
					runId: ctx.run_id,
					workspacePath: ws!.dir,
					commands: detection.commands,
					mode: 'standard',
				});
				return {
					checks: [
						{
							name: 'npm test',
							passed: report.status === 'passed',
							kind: 'unit',
							duration_ms: 10,
						},
					],
					// bewusst KEINE new_evidence
				};
			},
		};

		const issue = makeIssue('run_vslice_canary');
		const result = await runDurableRun(
			{
				db,
				workspace: {
					path: ws.dir,
					repositoryRef: 'xxammaxx/vslice-workspace',
					readHead: ws.readHead,
				},
				buildWorker: worker,
				verifyTool: silentVerifyTool,
				reviewFindings: async () => [],
				maxAttempts: 3,
			},
			{ issue, plan: makePlan(issue.run_id, ws) },
		);

		// Kein zweiter LLM-/Worker-Aufruf für identische Versuche
		expect(worker.invocations).toBe(1);
		expect(result.decision.decision).toBe('SPLIT');
		expect(result.decision.reason_code).toBe('RETRY_DENIED_NO_STRATEGY_DELTA');
		db.close();
	});
});

describe('SECURITY_HARD_BLOCK (E2E durch die Orchestrierung)', () => {
	it('blocking CRITICAL security finding blocks DONE even when tests are green', async () => {
		ws = createTestWorkspace();
		const db = createTestDb();
		const worker = new ScriptedBuildWorker(ws, ['correct']);
		const verifyTool = makeNodeTestVerifyTool(ws);

		const securityReviewer: ReviewWorker = {
			kind: 'security',
			workerType: 'review-security-deterministic',
			async run() {
				return [
					{
						contract: 'positron.finding.v1',
						category: 'security',
						severity: 'CRITICAL',
						confidence: 'HIGH',
						blocking: true,
						rule: 'SECRET_LEAK',
						evidence: { file: 'src/sum.js', symbol: 'add', line_range: [1, 3] },
						recommendation: 'Remove embedded secret',
					},
				];
			},
		};
		const qualityReviewer: ReviewWorker = {
			kind: 'quality',
			workerType: 'review-quality-deterministic',
			async run() {
				return [];
			},
		};

		const issue = makeIssue('run_vslice_security');
		const result = await runDurableRun(
			{
				db,
				workspace: {
					path: ws.dir,
					repositoryRef: 'xxammaxx/vslice-workspace',
					readHead: ws.readHead,
				},
				buildWorker: worker,
				verifyTool,
				reviewFindings: async () => [],
				reviewWorkers: [securityReviewer, qualityReviewer],
				maxAttempts: 3,
			},
			{ issue, plan: makePlan(issue.run_id, ws) },
		);

		// Tests waren grün — aber Security blockt hart (kein Mehrheitsvotum)
		expect(result.decision.decision).toBe('BLOCKED');
		expect(result.decision.reason_code).toBe('SECURITY_BLOCK');
		const basis = result.decision.basis as { blocking_findings?: Array<{ severity: string }> };
		expect(basis.blocking_findings?.[0]?.severity).toBe('CRITICAL');
		db.close();
	});
});

describe('REVIEW_PARALLELISM (E2E durch die Orchestrierung)', () => {
	it('parallel review workers prove real overlap and record the verdict in the decision basis', async () => {
		ws = createTestWorkspace();
		const db = createTestDb();
		const worker = new ScriptedBuildWorker(ws, ['correct']);
		const verifyTool = makeNodeTestVerifyTool(ws);

		const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
		const makeReviewer = (kind: 'correctness' | 'quality', label: string): ReviewWorker => ({
			kind,
			workerType: label,
			async run() {
				await sleep(60);
				return [];
			},
		});

		const issue = makeIssue('run_vslice_parallel');
		const result = await runDurableRun(
			{
				db,
				workspace: {
					path: ws.dir,
					repositoryRef: 'xxammaxx/vslice-workspace',
					readHead: ws.readHead,
				},
				buildWorker: worker,
				verifyTool,
				reviewFindings: async () => [],
				reviewWorkers: [
					makeReviewer('correctness', 'review-c'),
					makeReviewer('quality', 'review-q'),
				],
				maxAttempts: 3,
			},
			{ issue, plan: makePlan(issue.run_id, ws) },
		);

		expect(result.decision.decision).toBe('DONE');
		expect(result.decision.basis.parallelism).toBe('PARALLELISM_PROVEN');

		// Review-Attempts wurden telemetriert
		const reviewJob = result.jobs.find((j) => j.job_type === 'review')!;
		const reviewAttempts = result.attempts.filter((a) => a.job_id === reviewJob.job_id);
		expect(reviewAttempts.length).toBe(2);
		for (const a of reviewAttempts) {
			expect(a.ended_at).toBeTruthy();
		}
		db.close();
	});
});

// ---------------------------------------------------------------------------
// RESEARCH Integration (E2E durch die Orchestrierung)
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import type { ResearchWorker } from '../research.js';
import { listJobAttempts, listTransitions } from '../store.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeResearchWorker(
	workspace: TestWorkspace,
	kind: 'code' | 'docs' | 'tests',
	delayMs = 25,
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
				notes: `attempt ${ctx.attempt_id.slice(0, 8)}`,
			};
		},
	};
}

describe('RESEARCH_JOIN (E2E durch die Orchestrierung)', () => {
	it('happy path mit research: RESEARCH_JOIN-Transition, research-Job succeeded, Verdict in Decision-Basis', async () => {
		ws = createTestWorkspace(); // BROKEN → real rot
		const db = createTestDb();
		const worker = new ScriptedBuildWorker(ws, ['correct']);
		const verifyTool = makeNodeTestVerifyTool(ws);

		const issue = makeIssue('run_vslice_research_happy');
		const result = await runDurableRun(
			{
				db,
				workspace: {
					path: ws.dir,
					repositoryRef: 'xxammaxx/vslice-workspace',
					readHead: ws.readHead,
				},
				buildWorker: worker,
				verifyTool,
				reviewFindings: async () => [],
				researchWorkers: [
					makeResearchWorker(ws, 'code'),
					makeResearchWorker(ws, 'docs'),
					makeResearchWorker(ws, 'tests'),
				],
				maxAttempts: 3,
			},
			{ issue, plan: makePlan(issue.run_id, ws) },
		);

		// Fachliche Wirkung: DONE mit grünem Test
		expect(result.decision.decision).toBe('DONE');
		expect(readFile(ws!, 'src/sum.js')).toContain('a + b');

		// RESEARCH_JOIN-Transition existiert (reason_code trägt den Join-Status)
		const transitions = listTransitions(db, issue.run_id);
		const researchTransitions = transitions.filter((t) => t.reason_code === 'RESEARCH_JOIN');
		expect(researchTransitions.length).toBe(1);
		expect(researchTransitions[0]!.new_state).toBe('RESEARCH');

		// research-Job succeeded mit genau 3 Worker-Attempts (code/docs/tests)
		const researchJob = result.jobs.find((j) => j.job_type === 'research')!;
		expect(researchJob.state).toBe('succeeded');
		const researchAttempts = listJobAttempts(db, researchJob.job_id);
		expect(researchAttempts).toHaveLength(3);
		expect(researchAttempts.every((a) => a.status === 'succeeded')).toBe(true);
		for (const a of researchAttempts) {
			expect(a.output_contract).toBe('positron.research.v1');
			expect(a.provider).toBe('deterministic');
			expect(a.model).toBe('research-v1');
			expect(a.ended_at).toBeTruthy();
		}

		// Parallelismus-Verdict in der Decision-Basis (aus echten Zeitstempeln)
		expect(result.decision.basis.research_parallelism).toBe('PARALLELISM_PROVEN');
		expect(result.decision.basis.research_barrier).toBe('RESEARCH_JOIN');
		db.close();
	});
});

describe('RESEARCH_RECOVERY (E2E durch die Orchestrierung)', () => {
	it('crash nach completed research: research wird beim Resume NICHT erneut ausgeführt', async () => {
		ws = createTestWorkspace();
		const db = createTestDb();
		const worker = new ScriptedBuildWorker(ws, ['correct']);
		const verifyTool = makeNodeTestVerifyTool(ws);

		const issue = makeIssue('run_vslice_research_recovery');

		const researchWorkers = [
			makeResearchWorker(ws, 'code', 20),
			makeResearchWorker(ws, 'docs', 20),
			makeResearchWorker(ws, 'tests', 20),
		];

		// Lauf 1: Crash NACH abgeschlossenem research-Job
		const crashRun = await runDurableRun(
			{
				db,
				workspace: {
					path: ws.dir,
					repositoryRef: 'xxammaxx/vslice-workspace',
					readHead: ws.readHead,
				},
				buildWorker: worker,
				verifyTool,
				reviewFindings: async () => [],
				researchWorkers,
				maxAttempts: 3,
			},
			{ issue, plan: makePlan(issue.run_id, ws), crashAfterJob: 'research' },
		);
		expect(crashRun.decision.reason_code).toBe('CRASH_INJECTED');
		const researchJob = crashRun.jobs.find((j) => j.job_type === 'research')!;
		expect(isJobCompleted(db, researchJob.job_id)).toBe(true);
		const attemptsAfterCrash = listJobAttempts(db, researchJob.job_id);
		expect(attemptsAfterCrash).toHaveLength(3);

		// Lauf 2: Resume → research wird NICHT re-runt (keine neuen Attempts)
		const resumeRun = await runDurableRun(
			{
				db,
				workspace: {
					path: ws.dir,
					repositoryRef: 'xxammaxx/vslice-workspace',
					readHead: ws.readHead,
				},
				buildWorker: worker,
				verifyTool,
				reviewFindings: async () => [],
				researchWorkers,
				maxAttempts: 3,
			},
			{ issue, plan: makePlan(issue.run_id, ws) },
		);

		expect(resumeRun.decision.decision).toBe('DONE');
		const attemptsAfterResume = listJobAttempts(db, researchJob.job_id);
		expect(attemptsAfterResume).toHaveLength(3); // KEINE neuen Attempts
		// RESEARCH_RECOVERED-Transition vorhanden, keine erneute RESEARCH_JOIN
		const transitions = listTransitions(db, issue.run_id);
		expect(transitions.filter((t) => t.reason_code === 'RESEARCH_RECOVERED').length).toBe(1);
		// Verdict aus persistierten Zeitstempeln rekonstruiert
		expect(resumeRun.decision.basis.research_parallelism).toBe('PARALLELISM_PROVEN');
		expect(resumeRun.decision.basis.research_barrier).toBe('RESEARCH_JOIN');
		db.close();
	});
});

describe('RESEARCH_PARALLELISM_SEQUENTIAL_CANARY (E2E durch die Orchestrierung)', () => {
	it('explizit sequentielle Research-Ausführung (researchOptions.sequential) → NOT_PROVEN', async () => {
		ws = createTestWorkspace();
		const db = createTestDb();
		const worker = new ScriptedBuildWorker(ws, ['correct']);
		const verifyTool = makeNodeTestVerifyTool(ws);

		const issue = makeIssue('run_vslice_research_seqopt');
		const result = await runDurableRun(
			{
				db,
				workspace: {
					path: ws.dir,
					repositoryRef: 'xxammaxx/vslice-workspace',
					readHead: ws.readHead,
				},
				buildWorker: worker,
				verifyTool,
				reviewFindings: async () => [],
				researchWorkers: [
					makeResearchWorker(ws, 'code', 30),
					makeResearchWorker(ws, 'docs', 30),
					makeResearchWorker(ws, 'tests', 30),
				],
				researchOptions: { sequential: true },
				maxAttempts: 3,
			},
			{ issue, plan: makePlan(issue.run_id, ws) },
		);

		expect(result.decision.decision).toBe('DONE');
		expect(result.decision.basis.research_parallelism).toBe('PARALLELISM_NOT_PROVEN');
		expect(result.decision.basis.research_barrier).toBe('RESEARCH_JOIN');

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
		db.close();
	});
});

async function runTestsReal(dir: string) {
	const detector = new TestCommandDetector();
	const runner = new TestRunner();
	const detection = await detector.detect(dir);
	return runner.runDetectedCommands({
		runId: 'probe',
		workspacePath: dir,
		commands: detection.commands,
		mode: 'standard',
	});
}
