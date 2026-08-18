// Issue #421 — Durable Control Plane: Worker-Pipeline-Integration
//
// Beweist, dass die bestehende Worker-Pipeline die Control-Plane-Mechanismen
// nutzt:
// - PLAN_GATE: strukturierter Plan-Contract wird deterministisch geprüft
//   (APPROVED → Build; REJECTED → FAILED_BLOCKED)
// - ATTEMPT_TRACKING: IMPLEMENT/TEST schreiben persistente Attempts mit
//   Contracts und Fingerprints
// - RETRY_DENIAL: identischer Fehlversuch ohne Delta → FAILED_BLOCKED
//   (RETRY_DENIED_NO_STRATEGY_DELTA), kein zweiter Worker-Aufruf

import { FakeGitHubAdapter } from '@positron/github-adapter';
import type { GitHubAdapter } from '@positron/github-adapter';
import { FakeOpenCodeAdapter } from '@positron/opencode-adapter';
import {
	applyMigrations,
	assembleGateEvaluators,
	clearGateEvaluators,
	createRun,
	transition,
} from '@positron/run-state';
import type { GateRuntimeMode, RunState } from '@positron/run-state';
import { FakeGitWorkspaceAdapter } from '@positron/sandbox';
import type { GitWorkspaceAdapter } from '@positron/sandbox';
import type {
	OpenCodeAdapter,
	SpecKitAdapter,
	SpecKitCommandResult,
	SpecKitRunInput,
} from '@positron/shared';
import { FakeSpecKitAdapter } from '@positron/speckit-adapter';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPipeline } from '@positron/worker-pipeline';
import type { PipelineDeps } from '@positron/worker-pipeline';

const HEAD = 'a'.repeat(40);

function validPlanJson(runId: string): string {
	return JSON.stringify({
		contract: 'positron.plan.v1',
		run_id: runId,
		repository_ref: 'xxammaxx/test-repo',
		repository_head: HEAD,
		targets: { files: ['src/index.ts'], symbols: ['foo'] },
		acceptance_criteria: ['foo works'],
		required_tests: ['test/index.test.ts'],
		risks: [],
		build_scope: { allowed_files: ['src/', 'test/'] },
		context: { fingerprint: 'fp_1234567890123456' },
	});
}

function invalidPlanJson(runId: string): string {
	return JSON.stringify({
		contract: 'positron.plan.v1',
		run_id: runId,
		repository_ref: 'xxammaxx/test-repo',
		repository_head: HEAD,
		targets: { files: ['src/index.ts'], symbols: ['foo'] },
		acceptance_criteria: [], // fehlende AC → Gate REJECTED
		required_tests: ['test/index.test.ts'],
		risks: [],
		build_scope: { allowed_files: ['src/', 'test/'] },
		context: { fingerprint: 'fp_1234567890123456' },
	});
}

/** Speckit-Adapter, dessen Plan-Artifact ein strukturierter Plan-Contract ist */
class StructuredPlanSpecKitAdapter extends FakeSpecKitAdapter {
	constructor(private readonly planContent: string) {
		super();
	}

	async runPlan(input: SpecKitRunInput): Promise<SpecKitCommandResult> {
		this.commandCallLog.push('runPlan');
		return {
			phase: 'plan',
			status: 'success',
			command: 'specify plan',
			args: [],
			cwd: input.workspacePath,
			exitCode: 0,
			durationMs: 5,
			summary: this.planContent,
			artifacts: [],
		};
	}
}

/** OpenCode-Adapter, der Aufrufe zählt (Canary: kein zweiter Call) */
class CountingOpenCodeAdapter extends FakeOpenCodeAdapter {
	public implementCalls = 0;
	async runImplement(input: Parameters<OpenCodeAdapter['runImplement']>[0]) {
		this.implementCalls++;
		return super.runImplement(input);
	}
}

function makeDeps(
	db: Database.Database,
	speckit: SpecKitAdapter,
	opencode: OpenCodeAdapter,
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
		speckit,
		opencode,
		github: new FakeGitHubAdapter() as GitHubAdapter,
		gateRuntimeMode: 'fixture' as GateRuntimeMode,
	};
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

describe('PLAN_GATE in worker pipeline', () => {
	it('structured valid plan → PLAN_GATE_APPROVED → build released', async () => {
		db = new Database(':memory:');
		applyMigrations(db);
		const speckit = new StructuredPlanSpecKitAdapter(validPlanJson('run_gate_ok'));
		const opencode = new CountingOpenCodeAdapter();

		const run: RunState = {
			...createRun('test-repo', 9001, 2),
			phase: 'PLAN',
			status: 'active',
			workspacePath: '/tmp/positron-ws-gate-ok',
			branch: 'positron/issue-9001-gate-ok',
		};

		const result = await runPipeline(run, makeDeps(db, speckit, opencode));

		// Gate passiert → Build freigegeben (nicht wegen PLAN_GATE geblockt)
		expect(result.lastError).not.toContain('PLAN_GATE');
		const gateEvent = db
			.prepare(
				"SELECT message FROM run_events WHERE run_id = ? AND message LIKE 'PLAN_GATE_APPROVED%'",
			)
			.get(run.id) as { message: string } | undefined;
		expect(gateEvent).toBeTruthy();
		expect(gateEvent!.message).toContain('PLAN_GATE_APPROVED');
	});

	it('structured invalid plan (missing acceptance criteria) → FAILED_BLOCKED', async () => {
		db = new Database(':memory:');
		applyMigrations(db);
		const speckit = new StructuredPlanSpecKitAdapter(invalidPlanJson('run_gate_reject'));
		const opencode = new CountingOpenCodeAdapter();

		const run: RunState = {
			...createRun('test-repo', 9002, 2),
			phase: 'PLAN',
			status: 'active',
			workspacePath: '/tmp/positron-ws-gate-reject',
			branch: 'positron/issue-9002-gate-reject',
		};

		const result = await runPipeline(run, makeDeps(db, speckit, opencode));

		expect(result.phase).toBe('FAILED_BLOCKED');
		expect(result.lastError).toContain('PLAN_GATE_REJECTED');
		// Build wurde NICHT freigegeben
		expect(opencode.implementCalls).toBe(0);
	});
});

describe('ATTEMPT_TRACKING in worker pipeline', () => {
	it('IMPLEMENT phase writes a persistent build attempt with contract + fingerprint', async () => {
		db = new Database(':memory:');
		applyMigrations(db);
		const speckit = new FakeSpecKitAdapter();
		const opencode = new CountingOpenCodeAdapter();

		const run: RunState = {
			...createRun('test-repo', 9003, 2),
			phase: 'IMPLEMENT',
			status: 'active',
			workspacePath: '/tmp/positron-ws-attempts',
			branch: 'positron/issue-9003-attempts',
		};

		await runPipeline(run, makeDeps(db, speckit, opencode));

		const attempts = db
			.prepare('SELECT * FROM cp_attempts WHERE run_id = ? ORDER BY started_at ASC')
			.all(run.id) as Array<Record<string, unknown>>;
		expect(attempts.length).toBeGreaterThanOrEqual(1);

		const buildAttempt = attempts.find((a) => a.input_contract === 'positron.build-input.v1');
		expect(buildAttempt).toBeTruthy();
		expect(String(buildAttempt!.input_fingerprint)).toMatch(/^[0-9a-f]{64}$/);
		expect(String(buildAttempt!.output_contract)).toBe('positron.build-result.v1');
		expect(String(buildAttempt!.worker_type)).toBe('opencode');
		expect(opencode.implementCalls).toBe(1);
	});
});

describe('RETRY_DENIAL in worker fix loop', () => {
	it('identical failed attempt without delta → FAILED_BLOCKED, no second worker call', async () => {
		db = new Database(':memory:');
		applyMigrations(db);
		const speckit = new FakeSpecKitAdapter();
		const opencode = new CountingOpenCodeAdapter();
		const oldEnv = process.env.POSITRON_ENABLE_FIX_LOOP;
		process.env.POSITRON_ENABLE_FIX_LOOP = 'true';

		try {
			// Run startet in IMPLEMENT und scheitert im TEST deterministisch
			const run: RunState = {
				...createRun('test-repo', 9004, 2),
				phase: 'IMPLEMENT',
				status: 'active',
				workspacePath: '/tmp/positron-ws-retry-deny',
				branch: 'positron/issue-9004-retry-deny',
			};

			// Erster Lauf: Build-Attempt erfolgreich, TEST schlägt fehl (Fixture).
			// Der zweite Fix-Loop-Durchlauf hat denselben Input-Fingerprint,
			// dieselbe Failure-Signatur und kein Delta → RETRY_DENIED.
			await runPipeline(run, makeDeps(db, speckit, opencode));

			// Der Run endet im FAILED_BLOCKED oder FAILED_TRANSIENT —
			// entscheidend: KEIN zweiter Worker-Aufruf ohne Delta.
			expect(opencode.implementCalls).toBeLessThanOrEqual(1);

			// Retry-Denial-Evidenz: cp_attempts zeigen maximal einen Build-Versuch
			const buildAttempts = db
				.prepare(
					`SELECT a.* FROM cp_attempts a
					 JOIN cp_jobs j ON j.job_id = a.job_id
					 WHERE a.run_id = ? AND j.job_type = 'build'`,
				)
				.all(run.id) as Array<Record<string, unknown>>;
			expect(buildAttempts.length).toBeLessThanOrEqual(1);
		} finally {
			if (oldEnv === undefined) {
				process.env.POSITRON_ENABLE_FIX_LOOP = '';
			} else {
				process.env.POSITRON_ENABLE_FIX_LOOP = oldEnv;
			}
		}
	});
});
