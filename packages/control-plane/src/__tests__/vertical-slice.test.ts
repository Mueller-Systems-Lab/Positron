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
import { isJobCompleted, recoveryBoundary, runDurableRun } from '../durable-run.js';
import type { VerificationTool } from '../durable-run.js';
import {
	ScriptedBuildWorker,
	cleanupWorkspace,
	createTestDb,
	createTestWorkspace,
	makeNodeTestVerifyTool,
	readFile,
} from './vertical-slice-helpers.js';
import type { TestWorkspace } from './vertical-slice-helpers.js';

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
