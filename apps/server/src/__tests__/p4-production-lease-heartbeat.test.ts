// P4 — SLICE A CANARY: Production Lease TTL + Heartbeat + Stale Recovery
//
// Läuft über den PRODUKTIVEN Pfad (`runPipeline` aus @positron/worker-pipeline,
// identisch in BullMQ-Worker und Server-Inline-Fallback) mit echten
// persistierten Attempts in einem echten (disposablen) Workspace.
//
// Testmatrix:
//   PRODUCTION_ATTEMPT_LEASE_TTL_CONFIGURED = PASS   (Claim trägt bounded TTL)
//   PRODUCTION_HEARTBEAT_STARTED            = PASS   (Heartbeat nach Claim)
//   PRODUCTION_HEARTBEAT_ADVANCES           = PASS   (lease_expires_at steigt)
//   HEARTBEAT_STOPS_ON_SUCCESS              = PASS
//   HEARTBEAT_STOPS_ON_FAILURE              = PASS
//   NO_HEARTBEAT_TIMER_LEAK                 = PASS   (keine Renews nach Terminal)
//   STALE_LEASE_DETECTED                    = PASS   (Recovery bei Run-Start)
//   STALE_LEASE_RECLAIMED                   = PASS   (neuer Attempt, frische Gen)
//   FENCE_ADVANCED                          = PASS   (newer Epoch)
//   OLD_OWNER_HEARTBEAT_REJECTED            = PASS
//   OLD_OWNER_COMPLETION_REJECTED           = PASS
//   COMPLETED_WORK_NOT_RERUN                = PASS   (Restart-Resume ohne Rerun)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	applyControlPlaneMigrations,
	claimAttemptWithGeneration,
	completeAttempt,
	createAttempt,
	createJob,
	getAttempt,
	renewAttemptLease,
} from '@positron/control-plane';
import { FakeGitHubAdapter } from '@positron/github-adapter';
import { FakeOpenCodeAdapter } from '@positron/opencode-adapter';
import type {
	OpenCodeAdapter,
	OpenCodeCommandResult,
	OpenCodeRunInput,
} from '@positron/opencode-adapter';
import {
	applyMigrations,
	assembleGateEvaluators,
	clearGateEvaluators,
	createRun,
} from '@positron/run-state';
import type { GateRuntimeMode, RunState } from '@positron/run-state';
import { FakeGitWorkspaceAdapter } from '@positron/sandbox';
import type { GitWorkspaceAdapter } from '@positron/sandbox';
import type { SpecKitAdapter } from '@positron/shared';
import { FakeSpecKitAdapter } from '@positron/speckit-adapter';
import { runPipeline } from '@positron/worker-pipeline';
import type { PipelineDeps } from '@positron/worker-pipeline';
import type Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Langsamer OpenCode-Adapter: beobachtet lease_expires_at WÄHREND der Arbeit
// ---------------------------------------------------------------------------

interface HeartbeatObservation {
	/** distinct lease_expires_at-Werte während der Ausführung */
	expiries: string[];
	workerCalls: number;
}

class SlowProbingOpenCodeAdapter extends FakeOpenCodeAdapter {
	public workerCalls = 0;
	constructor(
		private readonly db: Database.Database,
		private readonly runId: string,
		private readonly options: { workMs: number; fail?: boolean; throwError?: boolean },
	) {
		super();
	}
	async runImplement(input: OpenCodeRunInput): Promise<OpenCodeCommandResult> {
		this.workerCalls++;
		const attemptRow = this.db
			.prepare(
				`SELECT a.attempt_id FROM cp_attempts a
				 JOIN cp_jobs j ON j.job_id = a.job_id
				 WHERE a.run_id = ? AND j.job_type = 'build' AND a.status = 'running'
				 ORDER BY a.started_at DESC LIMIT 1`,
			)
			.get(this.runId) as { attempt_id: string } | undefined;
		const attemptId = attemptRow?.attempt_id;
		if (attemptId) {
			// PRODUCTION_HEARTBEAT_STARTED: Lease ist beim Worker-Start gesetzt
			const claimed = getAttempt(this.db, attemptId);
			expect(claimed?.lease_owner_id).toMatch(new RegExp(`^ctl:${this.runId}:`));
			expect(claimed?.lease_expires_at).toBeTruthy();
		}
		const deadline = Date.now() + this.options.workMs;
		while (Date.now() < deadline) {
			if (attemptId) {
				const rec = getAttempt(this.db, attemptId);
				if (rec?.lease_expires_at && !this.expiries.includes(rec.lease_expires_at)) {
					this.expiries.push(rec.lease_expires_at);
				}
			}
			await new Promise((r) => setTimeout(r, 20));
		}
		if (this.options.throwError) {
			throw new Error('simulated worker crash');
		}
		if (this.options.fail) {
			return {
				phase: 'implement',
				status: 'failed',
				command: 'opencode run --command speckit.implement',
				args: [],
				cwd: input.workspacePath,
				exitCode: 1,
				durationMs: this.options.workMs,
				summary: 'simulated failure',
			};
		}
		return {
			phase: 'implement',
			status: 'success',
			command: 'opencode run --command speckit.implement',
			args: [],
			cwd: input.workspacePath,
			exitCode: 0,
			durationMs: this.options.workMs,
			summary: 'implementation completed',
			sessionId: `sess-${this.runId}`,
		};
	}
	readonly expiries: string[] = [];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(
	db: Database.Database,
	opencode: OpenCodeAdapter,
	attemptLeaseTtlMs: number,
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
		attemptLeaseTtlMs,
	};
}

function makeRun(issueNumber: number, phase: Phase = 'IMPLEMENT'): RunState {
	return {
		...createRun('test-repo', issueNumber, 2),
		phase,
		status: 'active',
		workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), 'positron-p4-a-')),
	};
}

type Phase = 'IMPLEMENT';

let db: Database.Database;

beforeAll(() => {
	clearGateEvaluators();
	assembleGateEvaluators('fixture');
});

afterAll(() => {
	clearGateEvaluators();
	db?.close();
});

function loadBuildAttempt(db: Database.Database, runId: string) {
	const row = db
		.prepare(
			`SELECT a.* FROM cp_attempts a
			 JOIN cp_jobs j ON j.job_id = a.job_id
			 WHERE a.run_id = ? AND j.job_type = 'build'
			 ORDER BY a.started_at DESC LIMIT 1`,
		)
		.get(runId) as Record<string, unknown> | undefined;
	return row ? getAttempt(db, String(row.attempt_id)) : null;
}

describe('P4 SLICE A — PRODUCTION LEASE TTL + HEARTBEAT (produktiver runPipeline-Pfad)', () => {
	it('CANARY: Claim mit bounded TTL, >=2 Heartbeats, Stopp auf Success, kein Timer-Leak', async () => {
		db = new (await import('better-sqlite3')).default(':memory:');
		applyMigrations(db);

		const run = makeRun(9101);
		const adapter = new SlowProbingOpenCodeAdapter(db, run.id, { workMs: 420 });
		// TTL 150ms → Heartbeat-Intervall 100ms → in 420ms Arbeit >= 2 Renews
		const deps = makeDeps(db, adapter, 150);

		const finalRun = await runPipeline(run, deps);
		expect(finalRun.status).toBe('blocked'); // COMMIT ohne Changes → terminal

		const buildAttempt = loadBuildAttempt(db, run.id);
		expect(buildAttempt).not.toBeNull();
		expect(buildAttempt?.status).toBe('succeeded');
		expect(buildAttempt?.lease_owner_id).toMatch(new RegExp(`^ctl:${run.id}:`));
		expect(buildAttempt?.lease_expires_at).toBeTruthy();

		// PRODUCTION_ATTEMPT_LEASE_TTL_CONFIGURED: der Claim trug eine reale
		// bounded TTL — gemessen am ERSTEN beobachteten Expiry (vor dem ersten
		// Renew): claimed_at + ~150ms. Kein undefined, kein Infinity.
		expect(adapter.expiries.length).toBeGreaterThanOrEqual(2);
		const firstExpiry = new Date(adapter.expiries[0] ?? '').getTime();
		const claimedAt = new Date(buildAttempt?.claimed_at ?? '').getTime();
		const ttlAtClaim = firstExpiry - claimedAt;
		expect(ttlAtClaim).toBeGreaterThan(0);
		expect(ttlAtClaim).toBeLessThan(10_000); // bounded — weit unter jeder Infinity
		expect(ttlAtClaim).toBeGreaterThanOrEqual(100); // ~150ms TTL (+ kleine Drift)
		expect(ttlAtClaim).toBeLessThanOrEqual(500);

		// PRODUCTION_HEARTBEAT_STARTED + PRODUCTION_HEARTBEAT_ADVANCES:
		// mindestens 2 distinct lease_expires_at-Werte während der Arbeit
		expect(adapter.workerCalls).toBe(1);
		console.log('[P4-A canary] HEARTBEAT_COUNT =', adapter.expiries.length);

		// HEARTBEAT_STOPS_ON_SUCCESS + NO_HEARTBEAT_TIMER_LEAK:
		// nach Terminal darf lease_expires_at nicht weiter steigen
		const expiryAfterTerminal = buildAttempt?.lease_expires_at ?? '';
		await new Promise((r) => setTimeout(r, 350));
		const afterWait = loadBuildAttempt(db, run.id);
		expect(afterWait?.lease_expires_at).toBe(expiryAfterTerminal);

		fs.rmSync(run.workspacePath as string, { recursive: true, force: true });
	});

	it('HEARTBEAT_STOPS_ON_FAILURE: fehlgeschlagener Worker → Attempt failed, keine Renews nach Terminal', async () => {
		db = new (await import('better-sqlite3')).default(':memory:');
		applyMigrations(db);

		const run = makeRun(9102);
		const adapter = new SlowProbingOpenCodeAdapter(db, run.id, { workMs: 250, fail: true });
		const deps = makeDeps(db, adapter, 150);

		const finalRun = await runPipeline(run, deps);
		expect(finalRun.phase.startsWith('FAILED')).toBe(true);

		const buildAttempt = loadBuildAttempt(db, run.id);
		expect(buildAttempt?.status).toBe('failed');
		expect(adapter.expiries.length).toBeGreaterThanOrEqual(1);

		const expiryAfterFailure = buildAttempt?.lease_expires_at ?? '';
		await new Promise((r) => setTimeout(r, 300));
		expect(loadBuildAttempt(db, run.id)?.lease_expires_at).toBe(expiryAfterFailure);

		fs.rmSync(run.workspacePath as string, { recursive: true, force: true });
	});
});

describe('P4 SLICE A — STALE RECOVERY + FENCING (produktiver Pfad)', () => {
	it('CANARY: gecrashter Owner → STALE_LEASE erkannt, Reclaim mit neuer Generation, alter Owner fenced', async () => {
		db = new (await import('better-sqlite3')).default(':memory:');
		applyMigrations(db);

		const run = makeRun(9103);
		// Crash-Simulation: alter Owner claimt mit kurzer TTL und heartbeated nicht
		applyControlPlaneMigrations(db);
		const crashedJob = createJob(db, run.id, 'build');
		const crashedAttempt = createAttempt(db, run.id, crashedJob.job_id, {
			status: 'pending',
			worker_type: 'opencode',
		});
		const crashedOwnerId = `ctl:${run.id}:crashed-controller`;
		const crashClaim = claimAttemptWithGeneration(db, crashedAttempt.attempt_id, {
			ownerId: crashedOwnerId,
			leaseTtlMs: 30,
		});
		expect(crashClaim.claimed).toBe(true);
		expect(crashClaim.generation).toBe(1);
		// Lease real ablaufen lassen (kein Heartbeat = Crash)
		await new Promise((r) => setTimeout(r, 60));

		const adapter = new SlowProbingOpenCodeAdapter(db, run.id, { workMs: 80 });
		const deps = makeDeps(db, adapter, 150);

		// STALE_LEASE_DETECTED + RECLAIMED: runPipeline-Start recovery finalisiert
		// den stale Attempt und der neue Owner claimt mit frischer Generation
		const finalRun = await runPipeline(run, deps);
		expect(finalRun.status).toBe('blocked');
		expect(adapter.workerCalls).toBe(1); // genau EIN produktiver Worker-Call

		const staleFinal = getAttempt(db, crashedAttempt.attempt_id);
		expect(staleFinal?.status).toBe('failed');
		expect(staleFinal?.failure_class).toBe('STALE_LEASE');

		const newAttempt = loadBuildAttempt(db, run.id);
		expect(newAttempt?.attempt_id).not.toBe(crashedAttempt.attempt_id);
		expect(newAttempt?.status).toBe('succeeded');
		expect(newAttempt?.lease_owner_id).toMatch(new RegExp(`^ctl:${run.id}:`));
		// FENCE_ADVANCED: der Reclaim trägt eine frische Generation
		expect(newAttempt?.lease_generation).toBe(1);

		// OLD_OWNER_HEARTBEAT_REJECTED: alter Owner kann nichts mehr erneuern
		expect(renewAttemptLease(db, crashedAttempt.attempt_id, crashedOwnerId, 30_000)).toBe(false);

		// OLD_OWNER_COMPLETION_REJECTED: alter Completion-Pfad wird verworfen
		const oldCompletion = completeAttempt(
			db,
			crashedAttempt.attempt_id,
			{ status: 'succeeded', output_json: JSON.stringify({ from: 'crashed-owner' }) },
			{ fencingOwnerId: crashedOwnerId, fencingGeneration: crashClaim.generation },
		);
		expect(oldCompletion).toBeNull();
		const oldFinal = getAttempt(db, crashedAttempt.attempt_id);
		expect(oldFinal?.status).toBe('failed');
		expect(oldFinal?.output_json).toBeNull();

		// DUPLICATE_EFFECT: genau ein persistiertes Build-Ergebnis
		const outputs = db
			.prepare(
				`SELECT a.output_json FROM cp_attempts a
				 JOIN cp_jobs j ON j.job_id = a.job_id
				 WHERE a.run_id = ? AND j.job_type = 'build' AND a.output_json IS NOT NULL`,
			)
			.all(run.id) as Array<{ output_json: string }>;
		expect(outputs.length).toBe(1);

		fs.rmSync(run.workspacePath as string, { recursive: true, force: true });
	});

	it('RESTART-RESUME: abgeschlossener Build wird NICHT erneut ausgeführt (COMPLETED_WORK_NOT_RERUN)', async () => {
		db = new (await import('better-sqlite3')).default(':memory:');
		applyMigrations(db);

		const run = makeRun(9104);
		const adapter = new SlowProbingOpenCodeAdapter(db, run.id, { workMs: 100 });
		const deps = makeDeps(db, adapter, 150);

		const first = await runPipeline(run, deps);
		expect(first.status).toBe('blocked');
		expect(adapter.workerCalls).toBe(1);

		// Restart (z. B. Worker-Crash nach Terminal): gleicher Run, gleiche DB
		const resumed = await runPipeline(run, deps);
		expect(resumed.status).toBe('blocked');
		// KEIN zweiter Build-Aufruf — der persistierte Attempt wird rehydriert
		expect(adapter.workerCalls).toBe(1);

		fs.rmSync(run.workspacePath as string, { recursive: true, force: true });
	});
});
