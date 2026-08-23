// Positron Control Plane — P4 Multi-Issue Vertical Slice (§77) + Real Canaries
//
// Echte zeitliche Überlappung zweier Runs (A+B), C wartet am Limit,
// Slot frei → C admitiert. Jeder Run durchläuft den kanonischen Lifecycle
// (Job → Attempt → Worker → Contract → Validation → Persistence → Transition)
// über runDurableRun. Kein Fake-GREEN: Concurrency wird über tatsächliche
// started_at/ended_at-Überlappung gemessen (§61/§63).

import fs from 'node:fs';
import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyControlPlaneMigrations } from '../schema.js';
import {
	admitNext,
	cancelQueueItem,
	enqueueItem,
	getQueueItem,
	listQueueItems,
	listSchedulerEvents,
	markRunFinished,
	markRunStarted,
	persistSchedulerEvent,
	recoverSchedulerState,
	schedulerCapacity,
} from '../scheduler.js';
import { runDurableRun } from '../durable-run.js';
import type { DurableRunDeps, DurableRunInput } from '../durable-run.js';

let db: Database.Database;
let workspaces: string[] = [];

beforeEach(() => {
	db = new Database(':memory:');
	applyControlPlaneMigrations(db);
	workspaces = [];
});

afterEach(() => {
	db.close();
	for (const w of workspaces) fs.rmSync(w, { recursive: true, force: true });
});

function makeWorkspace(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-p4-'));
	workspaces.push(dir);
	// Baseline liest den realen git-HEAD → Workspace muss ein git-Repo sein
	execSync('git init -q', { cwd: dir });
	fs.writeFileSync(path.join(dir, 'README.md'), 'p4-canary');
	execSync('git add -A && git -c user.email=canary@positron -c user.name=canary commit -qm init', {
		cwd: dir,
	});
	return dir;
}

interface RunSpec {
	repo: string;
	ref: string;
	priority?: string;
	deps?: string[];
	/** Verzögerung des Build-Workers (ms) — echte Parallelität messbar */
	delayMs?: number;
	/** Worker wirft (Failure-Isolation) */
	fail?: boolean;
}

function makeDeps(workspace: string, spec: RunSpec): DurableRunDeps {
	return {
		db,
		workspace: { path: workspace, repositoryRef: spec.repo },
		maxAttempts: 1,
		buildWorker: {
			workerType: 'canary.build',
			provider: 'deterministic',
			model: 'canary',
			async implement() {
				if (spec.fail) throw new Error('BUILD_WORKER_FAILURE: injected');
				if (spec.delayMs) await new Promise((r) => setTimeout(r, spec.delayMs));
				fs.writeFileSync(path.join(workspace, 'build-result.txt'), 'ok');
				return {
					contract: 'positron.build-result.v1',
					status: 'success',
					summary: 'canary build ok',
					run_id: 'unused',
					job_id: 'unused',
					attempt_id: 'unused',
					changed_files: ['build-result.txt'],
				};
			},
		},
		verifyTool: {
			async run() {
				if (spec.delayMs) await new Promise((r) => setTimeout(r, (spec.delayMs as number) / 2));
				return {
					checks: [
						{
							kind: 'unit',
							name: 'canary-check',
							passed: true,
							duration_ms: 1,
							detail: 'ok',
						},
					],
				};
			},
		},
		reviewFindings: async () => [],
	};
}

function makeInput(runId: string, repo: string, ref: string, workspace?: string): DurableRunInput {
	// HEAD-Consistency (§45): der Plan-HEAD muss dem realen Workspace-HEAD
	// entsprechen (deterministisches Plan-Gate; kein stiller HEAD-Drift).
	const head = workspace
		? (execSync('git rev-parse HEAD', { cwd: workspace, encoding: 'utf8' }) as string).trim()
		: 'a'.repeat(40);
	return {
		issue: {
			contract: 'positron.issue.v1',
			run_id: runId,
			source_type: 'issue',
			source_ref: ref,
			repository_ref: repo,
			title: `canary ${ref}`,
		},
		plan: {
			contract: 'positron.plan.v1',
			run_id: runId,
			repository_ref: repo,
			repository_head: head,
			targets: { files: ['build-result.txt'], symbols: [] },
			acceptance_criteria: ['tests pass'],
			required_tests: ['canary-check'],
			risks: [],
			build_scope: { allowed_files: ['build-result.txt'] },
			context: { fingerprint: 'canary-fp-0123456789abcdef' },
		},
	};
}

// ---------------------------------------------------------------------------
// MULTI-ISSUE VERTICAL SLICE (§77) + CROSS-REPO CONCURRENCY (§63)
// ---------------------------------------------------------------------------

describe('MULTI_ISSUE_VERTICAL_SLICE — echte parallele Runs, Limit, Release', () => {
	it('A+B überlappen real; C wartet; Slot frei → C admitiert (§61/§63/§77)', async () => {
		const cfg = { maxActiveRuns: 2, emitEvent: persistSchedulerEvent(db) };

		const a = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/A',
			repository_ref: 'repo/A',
			priority: 'HIGH',
		});
		const b = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/B',
			repository_ref: 'repo/B',
			priority: 'HIGH',
		});
		const c = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/C',
			repository_ref: 'repo/C',
		});

		// Admission: A + B (Kapazität 2)
		const dA = admitNext(db, cfg)!;
		expect(dA.queue_item_id).toBe(a.queue_item_id);
		const dB = admitNext(db, cfg)!;
		expect(dB.queue_item_id).toBe(b.queue_item_id);
		expect(admitNext(db, cfg)).toBeNull(); // C wartet (BACKPRESSURE)

		// Echte parallele Ausführung: A (300ms) + B (200ms) starten gleichzeitig
		const wsA = makeWorkspace();
		const wsB = makeWorkspace();
		const runA = runDurableRun(
			makeDeps(wsA, { repo: 'repo/A', ref: 'issue/A', delayMs: 300 }),
			makeInput('run-A-slice', 'repo/A', 'issue/A', wsA),
		);
		const runB = runDurableRun(
			makeDeps(wsB, { repo: 'repo/B', ref: 'issue/B', delayMs: 200 }),
			makeInput('run-B-slice', 'repo/B', 'issue/B', wsB),
		);

		markRunStarted(db, a.queue_item_id, 'run-A');
		markRunStarted(db, b.queue_item_id, 'run-B');

		const [resA, resB] = await Promise.all([runA, runB]);
		markRunFinished(db, a.queue_item_id, 'COMPLETED', 'run-A', 'READY');
		markRunFinished(db, b.queue_item_id, 'COMPLETED', 'run-B', 'READY');

		// Beide Runs real durchgelaufen (kanonischer Lifecycle)
		expect(resA.decision.decision).toBe('DONE');
		expect(resB.decision.decision).toBe('DONE');
		expect(resA.jobs.length).toBeGreaterThan(0);
		expect(resA.attempts.length).toBeGreaterThan(0);

		// Zeitliche Überlappung belegen (echte started/ended aus cp_attempts)
		const attemptsA = db
			.prepare(
				"SELECT started_at, ended_at FROM cp_attempts WHERE run_id = 'run-A-slice' AND worker_type = 'canary.build'",
			)
			.get() as { started_at: string; ended_at: string } | undefined;
		const attemptsB = db
			.prepare(
				"SELECT started_at, ended_at FROM cp_attempts WHERE run_id = 'run-B-slice' AND worker_type = 'canary.build'",
			)
			.get() as { started_at: string; ended_at: string } | undefined;
		expect(attemptsA).toBeTruthy();
		expect(attemptsB).toBeTruthy();
		const aStart = new Date(attemptsA!.started_at).getTime();
		const aEnd = new Date(attemptsA!.ended_at).getTime();
		const bStart = new Date(attemptsB!.started_at).getTime();
		const bEnd = new Date(attemptsB!.ended_at).getTime();
		// Überlappung: A läuft, während B startet/endet
		const overlap = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
		expect(overlap).toBeGreaterThan(0);

		// Slot frei → C admitiert
		const dC = admitNext(db, cfg);
		expect(dC?.queue_item_id).toBe(c.queue_item_id);
		expect(schedulerCapacity(db, cfg).activeRuns).toBeLessThanOrEqual(2);
	});
});

// ---------------------------------------------------------------------------
// FAILURE_ISOLATION (§51)
// ---------------------------------------------------------------------------

describe('FAILURE_ISOLATION — Run A scheitert, B/C laufen weiter', () => {
	it('A failed → B und C unbeeinflusst; Kapazität korrekt freigegeben', async () => {
		const cfg = { maxActiveRuns: 2, emitEvent: persistSchedulerEvent(db) };
		const a = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/A',
			repository_ref: 'repo/A',
		});
		const b = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/B',
			repository_ref: 'repo/B',
		});
		enqueueItem(db, { source_type: 'issue', source_ref: 'issue/C', repository_ref: 'repo/C' });

		admitNext(db, cfg);
		admitNext(db, cfg);

		const wsA = makeWorkspace();
		const wsB = makeWorkspace();
		const runA = runDurableRun(
			makeDeps(wsA, { repo: 'repo/A', ref: 'issue/A', fail: true }),
			makeInput('run-A-fail-1', 'repo/A', 'issue/A', wsA),
		);
		const runB = runDurableRun(
			makeDeps(wsB, { repo: 'repo/B', ref: 'issue/B', delayMs: 100 }),
			makeInput('run-B-ok-22', 'repo/B', 'issue/B', wsB),
		);
		markRunStarted(db, a.queue_item_id, 'run-A-fail');
		markRunStarted(db, b.queue_item_id, 'run-B-ok');

		const [resA, resB] = await Promise.all([runA, runB]);
		markRunFinished(db, a.queue_item_id, 'FAILED', 'run-A-fail', 'READY');
		markRunFinished(db, b.queue_item_id, 'COMPLETED', 'run-B-ok', 'READY');

		// A ist blockiert (Worker-Rejection → FAILED_BLOCKED), B ist DONE
		expect(['BLOCKED', 'FAILED_BLOCKED']).toContain(resA.decision.decision);
		expect(resB.decision.decision).toBe('DONE');

		// Ressourcen freigegeben → C darf starten
		const dC = admitNext(db, cfg);
		expect(dC).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// DOUBLE_ADMISSION_PREVENTED (§55) — zwei konkurrierende Admission-Versuche
// ---------------------------------------------------------------------------

describe('DOUBLE_ADMISSION_PREVENTED — atomare Admission', () => {
	it('zwei parallele admitNext-Aufrufe admitieren dasselbe Item nur einmal', async () => {
		const cfg = { maxActiveRuns: 1, emitEvent: persistSchedulerEvent(db) };
		enqueueItem(db, { source_type: 'issue', source_ref: 'issue/A', repository_ref: 'repo/A' });

		// Simulierte Konkurrenz: zwei Scheduler-Prozesse rufen gleichzeitig
		const [d1, d2] = await Promise.all([
			Promise.resolve().then(() => admitNext(db, cfg)),
			Promise.resolve().then(() => admitNext(db, cfg)),
		]);
		const admitted = [d1, d2].filter((d) => d?.admitted);
		expect(admitted.length).toBe(1); // ONE_ADMISSION

		// Nur EIN Item im ADMITTED-Zustand
		const admittedItems = listQueueItems(db).filter((q) => q.queue_state === 'ADMITTED');
		expect(admittedItems.length).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// SCHEDULER_EVENTS (§56) + CANCELLATION (§52) + QUEUE_RECOVERY (§69)
// ---------------------------------------------------------------------------

describe('SCHEDULER_EVENTS + CANCELLATION + QUEUE_RECOVERY', () => {
	it('Events werden persistiert (QUEUED→ADMITTED→RUN_STARTED→RUN_FINISHED)', () => {
		const cfg = { maxActiveRuns: 1, emitEvent: persistSchedulerEvent(db) };
		const a = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/A',
			repository_ref: 'repo/A',
		});
		admitNext(db, cfg);
		markRunStarted(db, a.queue_item_id, 'run-A', cfg);
		markRunFinished(db, a.queue_item_id, 'COMPLETED', 'run-A', 'READY', cfg);

		const events = listSchedulerEvents(db);
		const kinds = events.map((e) => e.event);
		expect(kinds).toContain('ADMITTED');
		expect(kinds).toContain('RUN_STARTED');
		expect(kinds).toContain('RUN_FINISHED');
		expect(events.every((e) => e.timestamp && e.reason_code)).toBe(true);
	});

	it('CANCELLATION: queued Item → CANCELLED, wird nie admitiert', () => {
		const cfg = { maxActiveRuns: 1 };
		const a = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/A',
			repository_ref: 'repo/A',
		});
		cancelQueueItem(db, a.queue_item_id);
		expect(getQueueItem(db, a.queue_item_id)?.queue_state).toBe('CANCELLED');
		expect(admitNext(db, cfg)).toBeNull();
	});

	it('QUEUE_RECOVERY (§69): A RUNNING, B WAITING_RESOURCE, C WAITING_DEPENDENCY — nach Recovery derselbe fachliche Zustand', () => {
		enqueueItem(db, { source_type: 'issue', source_ref: 'issue/A', repository_ref: 'repo/A' });
		const b = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/B',
			repository_ref: 'repo/B',
		});
		const c = enqueueItem(db, {
			source_type: 'issue',
			source_ref: 'issue/C',
			repository_ref: 'repo/C',
			dependency_refs: ['issue/A'],
		});

		const cfg = { maxActiveRuns: 1 };
		const d1 = admitNext(db, cfg)!;
		markRunStarted(db, d1.queue_item_id, 'run-A');
		// B: WAITING_RESOURCE (Limit), C: WAITING_DEPENDENCY (A nicht COMPLETED)
		admitNext(db, cfg);
		admitNext(db, cfg);
		expect(getQueueItem(db, b.queue_item_id)?.queue_state).toBe('WAITING_RESOURCE');
		expect(getQueueItem(db, c.queue_item_id)?.queue_state).toBe('WAITING_DEPENDENCY');

		// "Restart": Queue ist da, Run A lebt, Kapazität korrekt
		const rec = recoverSchedulerState(db, (runId) => runId === 'run-A');
		expect(getQueueItem(db, d1.queue_item_id)?.queue_state).toBe('RUNNING');
		expect(getQueueItem(db, b.queue_item_id)?.queue_state).toBe('WAITING_RESOURCE');
		expect(getQueueItem(db, c.queue_item_id)?.queue_state).toBe('WAITING_DEPENDENCY');
		expect(schedulerCapacity(db, cfg).activeRuns).toBe(1);

		// A fertig → B admitiert
		markRunFinished(db, d1.queue_item_id, 'COMPLETED', 'run-A', 'READY');
		const d2 = admitNext(db, cfg);
		expect(d2?.queue_item_id).toBe(b.queue_item_id);
	});
});
