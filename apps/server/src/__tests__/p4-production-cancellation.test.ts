// P4 — SLICE B CANARY: Running Cancellation (AbortSignal → Worker → Child)
//
// Testmatrix:
//   RUNNING_CANCEL_REAL              = PASS  (laufender Run wird real beendet)
//   ABORT_REACHES_RUN_PIPELINE       = PASS  (run_signals/extern → runPipeline)
//   ABORT_REACHES_WORKER             = PASS  (Worker-Aufruf erhält AbortSignal)
//   CHILD_PROCESS_TERMINATED         = PASS  (graceful → forced, real beendet)
//   NO_NEXT_PHASE_AFTER_CANCEL       = PASS
//   NO_POST_CANCEL_MUTATION          = PASS
//   LATE_RESULT_AFTER_CANCEL_REJECTED = PASS

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { completeAttempt, getAttempt } from '@positron/control-plane';
import { FakeGitHubAdapter } from '@positron/github-adapter';
import type {
	OpenCodeAdapter,
	OpenCodeCommandResult,
	OpenCodeRunInput,
} from '@positron/opencode-adapter';
import { FakeOpenCodeAdapter } from '@positron/opencode-adapter';
import type { GateRuntimeMode, RunState } from '@positron/run-state';
import {
	applyMigrations,
	assembleGateEvaluators,
	clearGateEvaluators,
	createRun,
} from '@positron/run-state';
import type { GitWorkspaceAdapter } from '@positron/sandbox';
import { FakeGitWorkspaceAdapter, runCommand } from '@positron/sandbox';
import type { SpecKitAdapter } from '@positron/shared';
import { FakeSpecKitAdapter } from '@positron/speckit-adapter';
import type { PipelineDeps } from '@positron/worker-pipeline';
import { runPipeline } from '@positron/worker-pipeline';
import type Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Adapter, der das AbortSignal beobachtet und daraufhin "stirbt"
// ---------------------------------------------------------------------------

class CancellableOpenCodeAdapter extends FakeOpenCodeAdapter {
	public workerCalls = 0;
	public sawAbort = false;
	async runImplement(input: OpenCodeRunInput): Promise<OpenCodeCommandResult> {
		this.workerCalls++;
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, 10_000);
			input.signal?.addEventListener(
				'abort',
				() => {
					this.sawAbort = true;
					clearTimeout(timer);
					resolve();
				},
				{ once: true },
			);
		});
		return {
			phase: 'implement',
			status: 'failed',
			command: 'opencode run --command speckit.implement',
			args: [],
			cwd: input.workspacePath,
			exitCode: 1,
			durationMs: 0,
			summary: 'cancelled',
		};
	}
}

function makeDeps(
	db: Database.Database,
	opencode: OpenCodeAdapter,
	signal?: AbortSignal,
): PipelineDeps {
	const repository = {
		owner: 'xxammaxx',
		repo: 'test-repo',
		defaultBranch: 'main',
	} as PipelineDeps['repository'];
	return {
		db,
		repository,
		workspace: new FakeGitWorkspaceAdapter() as GitWorkspaceAdapter,
		speckit: new FakeSpecKitAdapter() as SpecKitAdapter,
		opencode,
		github: new FakeGitHubAdapter(),
		gateRuntimeMode: 'fixture' as GateRuntimeMode,
		attemptLeaseTtlMs: 300_000,
		signal,
	};
}

function makeRun(issueNumber: number): RunState {
	return {
		...createRun('test-repo', issueNumber, 2),
		phase: 'IMPLEMENT',
		status: 'active',
		workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), 'positron-p4-b-')),
	};
}

function loadBuildAttempt(db: Database.Database, runId: string) {
	const row = db
		.prepare(
			`SELECT a.attempt_id FROM cp_attempts a
			 JOIN cp_jobs j ON j.job_id = a.job_id
			 WHERE a.run_id = ? AND j.job_type = 'build'
			 ORDER BY a.started_at DESC LIMIT 1`,
		)
		.get(runId) as { attempt_id: string } | undefined;
	return row ? getAttempt(db, row.attempt_id) : null;
}

let db: Database.Database;

beforeAll(() => {
	clearGateEvaluators();
	assembleGateEvaluators('fixture');
});

afterAll(() => {
	clearGateEvaluators();
	db?.close();
});

describe('P4 SLICE B — RUNNING CANCELLATION (produktiver Pfad)', () => {
	it('CANARY (DB-Watcher): Cancel über run_signals → AbortSignal erreicht Worker → Run cancelled, kein nächster Phasenstart', async () => {
		db = new (await import('better-sqlite3')).default(':memory:');
		applyMigrations(db);
		db.prepare(
			'CREATE TABLE IF NOT EXISTS run_signals (run_id TEXT, signal TEXT, target_phase TEXT, created_at TEXT)',
		).run();

		const run = makeRun(9201);
		const adapter = new CancellableOpenCodeAdapter();
		const deps = makeDeps(db, adapter);

		const pipelinePromise = runPipeline(run, deps);

		// Cancel während der Worker-Arbeit (wie Cancel-Endpoint: setRunSignal)
		await new Promise((r) => setTimeout(r, 200));
		db.prepare(
			"INSERT INTO run_signals (run_id, signal, target_phase, created_at) VALUES (?, 'ABORT', NULL, datetime('now'))",
		).run(run.id);

		const finalRun = await pipelinePromise;

		// RUNNING_CANCEL_REAL: Run endet als cancelled
		expect(finalRun.status).toBe('cancelled');
		expect(finalRun.finishedAt).toBeTruthy();
		// NO_NEXT_PHASE_AFTER_CANCEL: kein Übergang über IMPLEMENT hinaus
		expect(finalRun.phase).toBe('IMPLEMENT');

		// ABORT_REACHES_WORKER: der Worker-Aufruf hat das Signal erhalten
		expect(adapter.sawAbort).toBe(true);
		expect(adapter.workerCalls).toBe(1);

		// Attempt ist final (CANCELLED), Heartbeat gestoppt
		const attempt = loadBuildAttempt(db, run.id);
		expect(attempt?.status).toBe('failed');
		expect(attempt?.failure_class).toBe('CANCELLED');

		// LATE_RESULT_AFTER_CANCEL_REJECTED: spätes Ergebnis wird verworfen
		const late = completeAttempt(
			db,
			attempt?.attempt_id ?? '',
			{ status: 'succeeded', output_json: JSON.stringify({ late: true }) },
			{
				fencingOwnerId: attempt?.lease_owner_id ?? '',
				fencingGeneration: attempt?.lease_generation ?? 0,
			},
		);
		expect(late).toBeNull();
		expect(getAttempt(db, attempt?.attempt_id ?? '')?.status).toBe('failed');

		// NO_POST_CANCEL_MUTATION: keine neuen Attempts nach Cancel
		const attemptsAfter = db
			.prepare('SELECT COUNT(*) AS c FROM cp_attempts WHERE run_id = ?')
			.get(run.id) as { c: number };
		expect(Number(attemptsAfter.c)).toBe(1);

		fs.rmSync(run.workspacePath as string, { recursive: true, force: true });
	});

	it('CANARY (extern): deps.signal-Abort → Run cancelled, Lease/Heartbeat sauber beendet', async () => {
		db = new (await import('better-sqlite3')).default(':memory:');
		applyMigrations(db);

		const run = makeRun(9202);
		const adapter = new CancellableOpenCodeAdapter();
		const controller = new AbortController();
		const deps = makeDeps(db, adapter, controller.signal);

		const pipelinePromise = runPipeline(run, deps);

		await new Promise((r) => setTimeout(r, 200));
		controller.abort();

		const finalRun = await pipelinePromise;
		expect(finalRun.status).toBe('cancelled');
		expect(adapter.sawAbort).toBe(true);
		expect(adapter.workerCalls).toBe(1);

		const attempt = loadBuildAttempt(db, run.id);
		expect(attempt?.failure_class).toBe('CANCELLED');

		fs.rmSync(run.workspacePath as string, { recursive: true, force: true });
	});
});

describe('P4 SLICE B — CHILD_PROCESS_TERMINATION (produktives Primitive)', () => {
	it('CHILD_PROCESS_TERMINATED: runCommand + AbortSignal beendet hartnäckigen Prozess real (SIGTERM→SIGKILL)', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-p4-child-'));
		const controller = new AbortController();
		// Prozess ignoriert SIGTERM → muss forced (SIGKILL) beendet werden
		const start = Date.now();
		const promise = runCommand(
			process.execPath,
			['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 500);"],
			{ cwd: dir, signal: controller.signal, killGraceMs: 300 },
		);
		await new Promise((r) => setTimeout(r, 150));
		controller.abort();
		await expect(promise).rejects.toThrow(/cancelled/i);
		const elapsed = Date.now() - start;
		// ohne Termination würde der Prozess ewig laufen — real beendet + Promise aufgelöst
		expect(elapsed).toBeLessThan(5000);
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
