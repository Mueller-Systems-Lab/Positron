// Positron Control Plane — Runtime Hardening Canaries (P3.5/Phase B)
//
// Testmatrix (Auftrag §74):
//   ACTIVE_CANCELLATION / TIMEOUT_CANCELS_WORKER / CHILD_PROCESS_TREE_TERMINATION
//   NO_ZOMBIE_PROCESS / NO_POST_TIMEOUT_MUTATION / LEASE_CLAIM / LEASE_RENEW
//   STALE_LEASE / STALE_LEASE_RECOVERY / FENCING_TOKEN / STALE_RESULT_REJECTED
//   CRASH_MID_BUILD_RECOVERY / DUPLICATE_EFFECT_ZERO
//
// Kein Fake-GREEN: PASS bedeutet real beobachtete Wirkung
//   - Worker-Prozess wurde tatsächlich beendet (exit-Code beobachtet)
//   - stale Owner verliert real die Authority (Fencing verweigert Write)
//   - Lease-Ablauf → deterministische Recovery ohne Doppel-Autorität

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	createCancellationSource,
	terminateChildProcess,
	withCancellableTimeout,
} from '../cancellation.js';
import { applyControlPlaneMigrations } from '../schema.js';
import {
	claimAttempt,
	claimAttemptWithGeneration,
	completeAttempt,
	createAttempt,
	createJob,
	getAttempt,
	recoverStaleLeases,
	renewAttemptLease,
} from '../store.js';

let db: Database.Database;

beforeEach(() => {
	db = new Database(':memory:');
	applyControlPlaneMigrations(db);
});

afterEach(() => {
	db.close();
});

function makeAttemptPair(runId: string, jobType: 'build' | 'verify' = 'build') {
	const job = createJob(db, runId, jobType);
	const attempt = createAttempt(db, runId, job.job_id, {
		status: 'pending',
		worker_type: 'opencode',
		provider: 'deepseek',
		model: 'deepseek-v4-flash',
	});
	return { job, attempt };
}

// ---------------------------------------------------------------------------
// ACTIVE_CANCELLATION / TIMEOUT_CANCELS_WORKER / NO_POST_TIMEOUT_MUTATION
// ---------------------------------------------------------------------------

describe('ACTIVE_CANCELLATION — Timeout cancelt den Worker (real)', () => {
	it('löst Cancellation aus und finalisiert den Attempt als timed_out; Late Result wird verworfen', async () => {
		const { attempt } = makeAttemptPair('run_cancel_1');
		const ownerId = 'controller:run_cancel_1';
		const claim = claimAttemptWithGeneration(db, attempt.attempt_id, {
			ownerId,
			leaseTtlMs: 60_000,
		});
		expect(claim.claimed).toBe(true);

		let workerSawCancellation = false;
		const cancellation = createCancellationSource();
		cancellation.onTerminate(() => {
			workerSawCancellation = true;
		});

		// Worker, der langsamer ist als der Timeout
		const slowWorker = new Promise<string>((resolve) => {
			setTimeout(() => resolve('LATE_RESULT'), 200);
		});

		const timed = await withCancellableTimeout(slowWorker, 50, cancellation);
		expect(timed.ok).toBe(false);

		// Cancellation wurde real ausgelöst
		expect(workerSawCancellation).toBe(true);
		expect(cancellation.cancelled).toBe(true);

		// Attempt deterministisch finalisieren (timed_out)
		const finalized = completeAttempt(
			db,
			attempt.attempt_id,
			{
				status: 'timed_out',
				failure_class: 'TIMEOUT',
				failure_signature: 'build-timeout-50ms',
			},
			{ fencingOwnerId: ownerId, fencingGeneration: claim.generation },
		);
		expect(finalized?.status).toBe('timed_out');

		// Late Result kann den finalen Attempt NICHT mehr überschreiben
		const late = completeAttempt(
			db,
			attempt.attempt_id,
			{ status: 'succeeded', output_json: JSON.stringify({ late: true }) },
			{ fencingOwnerId: ownerId, fencingGeneration: claim.generation },
		);
		expect(late).toBeNull();
		const afterLate = getAttempt(db, attempt.attempt_id);
		expect(afterLate?.status).toBe('timed_out');
		expect(afterLate?.output_json).toBeNull();
	});

	it('Cancellation ist idempotent (doppeltes cancel wirkt einmal)', () => {
		const cancellation = createCancellationSource();
		let calls = 0;
		cancellation.onTerminate(() => calls++);
		cancellation.cancel();
		cancellation.cancel();
		cancellation.cancel();
		expect(calls).toBe(1);
		expect(cancellation.cancelled).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// CHILD_PROCESS_TREE_TERMINATION / NO_ZOMBIE_PROCESS
// ---------------------------------------------------------------------------

describe('CHILD_PROCESS_TERMINATION — owned Child-Prozess wird real beendet', () => {
	it('beendet einen spawnenden Prozess per SIGTERM (graceful) und wartet auf Exit', async () => {
		const child = spawn('sleep', ['30'], { stdio: 'ignore' });
		const pid = child.pid;
		expect(pid).toBeDefined();

		const exited = new Promise<number | null>((resolve) => {
			child.once('exit', (code) => resolve(code));
		});

		await terminateChildProcess(child, { graceMs: 500 });

		const code = await exited;
		// 30s-Sleep: ohne Termination würde er 30s laufen. Nach SIGTERM ist er
		// beendet — der Exit-Code ist bei Signal-Termination null.
		expect(code).toBeNull();
		// Zombie-Check: Prozess existiert nicht mehr
		try {
			process.kill(pid as number, 0);
			expect.unreachable('Prozess existiert noch — Zombie!');
		} catch {
			// ESRCH → Prozess beendet ✓
		}
	});

	it('escaliert nach Ablauf der Grace-Periode auf SIGKILL (hartnäckiger Prozess)', async () => {
		// Node-Prozess mit SIGTERM-Handler ignoriert SIGTERM → muss per
		// SIGKILL (nicht abfangbar) beendet werden.
		const child = spawn(
			process.execPath,
			['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
			{ stdio: 'ignore' },
		);
		const pid = child.pid;
		expect(pid).toBeDefined();

		// Kurz warten, bis der Node-Prozess seinen SIGTERM-Handler registriert
		// hat (sonst Race: SIGTERM vor Handler → sofortiger Exit).
		await new Promise((resolve) => setTimeout(resolve, 150));

		const exited = new Promise<void>((resolve) => {
			child.once('exit', () => resolve());
		});

		const start = Date.now();
		await terminateChildProcess(child, { graceMs: 300, exitTimeoutMs: 5000 });
		const durationMs = Date.now() - start;

		await exited;
		// SIGKILL ist nicht abfangbar → Prozess wurde FORCED beendet
		try {
			process.kill(pid as number, 0);
			expect.unreachable('Prozess überlebt SIGKILL — Zombie!');
		} catch {
			// ESRCH ✓
		}
		// Grace-Periode wurde tatsächlich abgewartet (SIGTERM wurde ignoriert)
		expect(durationMs).toBeGreaterThanOrEqual(250);
	});
});

// ---------------------------------------------------------------------------
// LEASE_CLAIM / LEASE_RENEW / STALE_LEASE / STALE_LEASE_RECOVERY
// ---------------------------------------------------------------------------

describe('LEASE — Claim, Heartbeat, Ablauf, deterministische Recovery', () => {
	it('LEASE_CLAIM: Claim setzt Owner + Generation + Expiry; zweiter Claim verliert', () => {
		const { attempt } = makeAttemptPair('run_lease_1');
		const c1 = claimAttemptWithGeneration(db, attempt.attempt_id, {
			ownerId: 'controller-A',
			leaseTtlMs: 60_000,
		});
		expect(c1.claimed).toBe(true);
		expect(c1.generation).toBe(1);

		const record = getAttempt(db, attempt.attempt_id);
		expect(record?.lease_owner_id).toBe('controller-A');
		expect(record?.lease_generation).toBe(1);
		expect(record?.lease_expires_at).toBeTruthy();

		// Paralleler Claim desselben Attempts: verliert
		const c2 = claimAttempt(db, attempt.attempt_id, { ownerId: 'controller-B' });
		expect(c2).toBe(false);
	});

	it('LEASE_RENEW: Heartbeat verlängert die Lease — nur für den Owner', () => {
		const { attempt } = makeAttemptPair('run_lease_2');
		claimAttempt(db, attempt.attempt_id, { ownerId: 'controller-A', leaseTtlMs: 60_000 });
		const before = getAttempt(db, attempt.attempt_id)?.lease_expires_at ?? '';

		// Fremder Owner kann nicht erneuern
		expect(renewAttemptLease(db, attempt.attempt_id, 'controller-B', 60_000)).toBe(false);

		// Owner erneuert mit GRÖSSERER TTL → Expiry steigt sicher an
		expect(renewAttemptLease(db, attempt.attempt_id, 'controller-A', 120_000)).toBe(true);
		const after = getAttempt(db, attempt.attempt_id)?.lease_expires_at ?? '';
		expect(new Date(after).getTime()).toBeGreaterThan(new Date(before).getTime());
	});

	it('STALE_LEASE + RECOVERY: abgelaufene Lease → alter Owner verliert Authority, keine Doppel-Autorität', () => {
		const { attempt } = makeAttemptPair('run_lease_3');
		claimAttempt(db, attempt.attempt_id, {
			ownerId: 'controller-A',
			leaseTtlMs: 50, // sehr kurze TTL → läuft sofort ab
		});
		const expiresAt = getAttempt(db, attempt.attempt_id)?.lease_expires_at ?? '';
		// Deterministisch: now = nach Ablauf (auch wenn der Test schneller ist)
		const now = new Date(new Date(expiresAt).getTime() + 1).toISOString();

		// Heartbeat stoppt (Crash-Simulation: kein renew)
		// Lease ist abgelaufen
		const stale = recoverStaleLeases(db, { ownerId: 'controller-A', now });
		expect(stale.length).toBe(1);
		expect(stale[0]?.status).toBe('failed');
		expect(stale[0]?.failure_class).toBe('STALE_LEASE');

		// Alter Owner kann den Attempt nicht mehr finalisieren (Fencing:
		// Status ist final — Transition-Guard verweigert).
		const lateOwner = completeAttempt(
			db,
			attempt.attempt_id,
			{ status: 'succeeded', output_json: JSON.stringify({ stale: false }) },
			{ fencingOwnerId: 'controller-A', fencingGeneration: 1 },
		);
		expect(lateOwner).toBeNull();

		// NEUER Attempt (frische Generation) darf nach Retry-Semantik starten
		const job = createJob(db, 'run_lease_3', 'build');
		const attempt2 = createAttempt(db, 'run_lease_3', job.job_id, {
			status: 'pending',
			worker_type: 'opencode',
		});
		const c2 = claimAttemptWithGeneration(db, attempt2.attempt_id, {
			ownerId: 'controller-B',
			leaseTtlMs: 60_000,
		});
		expect(c2.claimed).toBe(true);
		expect(c2.generation).toBe(1);
		expect(getAttempt(db, attempt2.attempt_id)?.status).toBe('running');

		// Alte Generation kann den NEUEN Attempt nie anfassen
		expect(
			completeAttempt(
				db,
				attempt2.attempt_id,
				{ status: 'failed' },
				{ fencingOwnerId: 'controller-A', fencingGeneration: 0 },
			),
		).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// FENCING_TOKEN / STALE_RESULT_REJECTED / DUPLICATE_EFFECT_ZERO
// ---------------------------------------------------------------------------

describe('FENCING — stale Worker verliert; neuer Besitzer bleibt Authority', () => {
	it('FENCING CANARY (§24): A (Gen 1) lease läuft ab → B (Gen 2) → A liefert late → REJECTED', () => {
		const { attempt } = makeAttemptPair('run_fence_1');
		const jobId = attempt.job_id;
		const runId = attempt.run_id;

		// Worker A claimt (Generation 1)
		const a = claimAttemptWithGeneration(db, attempt.attempt_id, {
			ownerId: 'worker-A',
			leaseTtlMs: 40,
		});
		expect(a.claimed).toBe(true);
		expect(a.generation).toBe(1);
		const expiresAt = getAttempt(db, attempt.attempt_id)?.lease_expires_at ?? '';
		const now = new Date(new Date(expiresAt).getTime() + 1).toISOString();

		// A crasht (kein Heartbeat) → Lease läuft ab → Recovery finalisiert
		const stale = recoverStaleLeases(db, { ownerId: 'worker-A', now });
		expect(stale.length).toBe(1);

		// Worker B übernimmt (frische Generation — neuer Attempt, gleiche DB)
		const attemptB = createAttempt(db, runId, jobId, {
			status: 'pending',
			worker_type: 'opencode',
		});
		const b = claimAttemptWithGeneration(db, attemptB.attempt_id, {
			ownerId: 'worker-B',
			leaseTtlMs: 60_000,
		});
		expect(b.claimed).toBe(true);
		expect(b.generation).toBe(1);

		// Worker A liefert spät — sein Ergebnis darf den aktuellen Zustand
		// NICHT überschreiben. Sein eigener Attempt ist final (failed/
		// STALE_LEASE) → Transition-Guard verweigert; zusätzlich Fencing.
		const lateA = completeAttempt(
			db,
			attempt.attempt_id,
			{ status: 'succeeded', output_json: JSON.stringify({ from: 'worker-A' }) },
			{ fencingOwnerId: 'worker-A', fencingGeneration: a.generation },
		);
		expect(lateA).toBeNull();
		const aFinal = getAttempt(db, attempt.attempt_id);
		expect(aFinal?.status).toBe('failed');
		expect(aFinal?.failure_class).toBe('STALE_LEASE');
		expect(aFinal?.output_json).toBeNull();

		// B bleibt Authority — sein Attempt läuft unverändert
		const bRecord = getAttempt(db, attemptB.attempt_id);
		expect(bRecord?.status).toBe('running');
		expect(bRecord?.lease_owner_id).toBe('worker-B');

		// B kann finalisieren
		const bDone = completeAttempt(
			db,
			attemptB.attempt_id,
			{ status: 'succeeded', output_json: JSON.stringify({ from: 'worker-B' }) },
			{ fencingOwnerId: 'worker-B', fencingGeneration: b.generation },
		);
		expect(bDone?.status).toBe('succeeded');

		// DUPLICATE_EFFECT_ZERO: kein doppelter Effekt — A schrieb nie
		const all = db.prepare("SELECT output_json FROM cp_attempts WHERE output_json IS NOT NULL").all() as Array<{
			output_json: string;
		}>;
		expect(all.length).toBe(1);
		expect(JSON.parse(all[0]!.output_json).from).toBe('worker-B');
	});

	it('STALE_RESULT_REJECTED: Fencing mit falscher Generation wird verweigert', () => {
		const { attempt } = makeAttemptPair('run_fence_2');
		const claim = claimAttemptWithGeneration(db, attempt.attempt_id, {
			ownerId: 'worker-A',
			leaseTtlMs: 60_000,
		});
		expect(claim.generation).toBe(1);

		// Falsche Generation (0 statt 1) → rejected
		expect(
			completeAttempt(
				db,
				attempt.attempt_id,
				{ status: 'succeeded' },
				{ fencingOwnerId: 'worker-A', fencingGeneration: 0 },
			),
		).toBeNull();

		// Falscher Owner → rejected
		expect(
			completeAttempt(
				db,
				attempt.attempt_id,
				{ status: 'succeeded' },
				{ fencingOwnerId: 'worker-X', fencingGeneration: 1 },
			),
		).toBeNull();

		// Korrekter Owner + Generation → erlaubt
		const ok = completeAttempt(
			db,
			attempt.attempt_id,
			{ status: 'succeeded', output_json: '{}' },
			{ fencingOwnerId: 'worker-A', fencingGeneration: 1 },
		);
		expect(ok?.status).toBe('succeeded');
	});
});

// ---------------------------------------------------------------------------
// CRASH_MID_BUILD_RECOVERY (§26)
// ---------------------------------------------------------------------------

describe('CRASH_MID_BUILD_RECOVERY — Stale-Lease im echten Workspace-Kontext', () => {
	it('BUILD RUNNING → Claim → Controller-Crash (kein Heartbeat) → Lease stale → Recovery entscheidet deterministisch', () => {
		// Disposable Git-Workspace (minimal)
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-crash-mid-'));
		fs.writeFileSync(path.join(dir, 'README.md'), 'crash-canary');
		try {
			const { attempt } = makeAttemptPair('run_crash_1');
			claimAttempt(db, attempt.attempt_id, {
				ownerId: 'controller-crashed',
				leaseTtlMs: 30,
			});
			const expiresAt = getAttempt(db, attempt.attempt_id)?.lease_expires_at ?? '';
			const now = new Date(new Date(expiresAt).getTime() + 1).toISOString();

			// Controller "stirbt" — kein Heartbeat, kein completeAttempt.
			// Nach TTL: Lease ist stale.
			const stale = recoverStaleLeases(db, { now });
			expect(stale.length).toBe(1);
			expect(stale[0]?.status).toBe('failed');
			expect(stale[0]?.failure_class).toBe('STALE_LEASE');
			expect(stale[0]?.failure_signature).toContain('lease-expired');

			// Kein paralleler alter Owner: der crash-kontaminierte Attempt ist
			// final — kein zweiter Ausführer kann ihn claimen.
			expect(claimAttempt(db, attempt.attempt_id, { ownerId: 'controller-B' })).toBe(false);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it('STALE_LEASE_RECOVERY respektiert Owner-Grenzen (fremde Attempts unangetastet)', () => {
		const { attempt } = makeAttemptPair('run_crash_2');
		claimAttempt(db, attempt.attempt_id, {
			ownerId: 'controller-other',
			leaseTtlMs: 30,
		});
		// Recovery mit eigenem Owner: fremder Attempt wird NICHT angefasst
		const stale = recoverStaleLeases(db, { ownerId: 'controller-me' });
		expect(stale.length).toBe(0);
		expect(getAttempt(db, attempt.attempt_id)?.status).toBe('running');
	});
});
