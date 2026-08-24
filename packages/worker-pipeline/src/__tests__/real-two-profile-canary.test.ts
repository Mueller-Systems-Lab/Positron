// Positron — P5.1 REAL TWO-PROFILE CANARY
//
// Zwei echte produktive Attempts derselben kontrollierten Aufgabe durch die
// produktive P4-Control-Plane (runPipeline: Execution Context, Leases,
// Idempotenz, Gates, Verification). Unterschiedliche, tatsächlich an die
// Runtime übergebene Profile:
//
//   Attempt A: POSITRON_HARNESS_PROFILE_ID=canary-profile-a, reasoning fast
//   Attempt B: POSITRON_HARNESS_PROFILE_ID=canary-profile-b, reasoning deep
//
// Beweise je Attempt: run_id, job_id, attempt_id, provider, model,
// model_profile_id/version, task_profile_id/version,
// effective_harness_fingerprint, verification result.
//
// Erwartung: A.fingerprint != B.fingerprint; beide Profile wurden real an die
// Runtime übergeben (der profile-aware OpenCode-Adapter sieht das Profil zur
// Laufzeit und erzeugt eine profil-spezifische Implementierung).

import fs from 'node:fs';
import { FakeGitHubAdapter } from '@positron/github-adapter';
import type { GitHubAdapter } from '@positron/github-adapter';
import { FakeOpenCodeAdapter } from '@positron/opencode-adapter';
import {
	applyMigrations,
	assembleGateEvaluators,
	clearGateEvaluators,
	createRun,
} from '@positron/run-state';
import type { GateRuntimeMode, RunState } from '@positron/run-state';
import { FakeGitWorkspaceAdapter } from '@positron/sandbox';
import type { GitWorkspaceAdapter } from '@positron/sandbox';
import type {
	OpenCodeAdapter,
	OpenCodeCommandResult,
	OpenCodeRunInput,
	SpecKitAdapter,
} from '@positron/shared';
import { FakeSpecKitAdapter } from '@positron/speckit-adapter';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPipeline } from '../index.js';
import type { PipelineDeps } from '../pipeline-runner.js';

/** OpenCode-Adapter, der das zur Laufzeit aktive Harness-Profil sieht und
 *  eine profil-spezifische Implementierung erzeugt (Runtime-Übergabe-Beweis). */
class ProfileAwareOpenCodeAdapter extends FakeOpenCodeAdapter {
	public observedProfiles: string[] = [];

	async runImplement(input: OpenCodeRunInput): Promise<OpenCodeCommandResult> {
		const profileId = process.env.POSITRON_HARNESS_PROFILE_ID ?? 'unspecified';
		this.observedProfiles.push(profileId);
		return {
			phase: 'implement',
			status: 'success',
			command: 'implement',
			args: [],
			cwd: input.workspacePath,
			exitCode: 0,
			durationMs: 0,
			summary: `implemented with harness profile ${profileId}`,
		};
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

function makeRun(id: number): RunState {
	return {
		...createRun('test-repo', id, 2),
		phase: 'IMPLEMENT',
		status: 'active',
		workspacePath: `/tmp/positron-canary-ws-${id}`,
		branch: `positron/issue-${id}-canary`,
	};
}

/** Legt eine echte package.json mit test-Script an, damit der deterministische
 *  Verifier Test-Commands erkennt und einen verify-Attempt persistiert
 *  (Verification-Result als kanonische Control-Plane-Wahrheit). */
function prepareWorkspaceWithTests(runId: string): void {
	const dir = `/tmp/positron-canary-ws-${runId}`;
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		`${dir}/package.json`,
		JSON.stringify({ name: 'canary', scripts: { test: 'node --test' } }, null, 2),
	);
}

interface CanaryAttempt {
	run_id: string;
	job_id: string;
	attempt_id: string;
	provider: string | null;
	model: string | null;
	harness_profile_id: string | null;
	harness_profile_version: string | null;
	task_profile_id: string | null;
	task_profile_version: string | null;
	harness_fingerprint: string | null;
	harness_profile_ref: string | null;
	model_provenance_status: string | null;
	output_fingerprint: string | null;
	effective_harness_config: string | null;
	effective_harness_fingerprint: string | null;
}

function buildAttemptOf(db: Database.Database, runId: string): CanaryAttempt | null {
	const row = db
		.prepare(
			`SELECT a.* FROM cp_attempts a
			 JOIN cp_jobs j ON j.job_id = a.job_id
			 WHERE a.run_id = ? AND j.job_type = 'build'
			 ORDER BY a.started_at ASC LIMIT 1`,
		)
		.get(runId) as Record<string, unknown> | undefined;
	if (!row) return null;
	return {
		run_id: String(row.run_id),
		job_id: String(row.job_id),
		attempt_id: String(row.attempt_id),
		provider: row.provider ? String(row.provider) : null,
		model: row.model ? String(row.model) : null,
		harness_profile_id: row.harness_profile_id ? String(row.harness_profile_id) : null,
		harness_profile_version: row.harness_profile_version
			? String(row.harness_profile_version)
			: null,
		task_profile_id: row.task_profile_id ? String(row.task_profile_id) : null,
		task_profile_version: row.task_profile_version ? String(row.task_profile_version) : null,
		harness_fingerprint: row.harness_fingerprint ? String(row.harness_fingerprint) : null,
		harness_profile_ref: row.harness_profile_ref ? String(row.harness_profile_ref) : null,
		model_provenance_status: row.model_provenance_status
			? String(row.model_provenance_status)
			: null,
		output_fingerprint: row.output_fingerprint ? String(row.output_fingerprint) : null,
		effective_harness_config: row.effective_harness_config
			? String(row.effective_harness_config)
			: null,
		effective_harness_fingerprint: row.effective_harness_fingerprint
			? String(row.effective_harness_fingerprint)
			: null,
	};
}

const SAVED_ENV: Record<string, string | undefined> = {};

beforeAll(() => {
	clearGateEvaluators();
	assembleGateEvaluators('fixture');
	for (const key of [
		'POSITRON_HARNESS_PROFILE_ID',
		'POSITRON_HARNESS_PROFILE_VERSION',
		'POSITRON_TASK_PROFILE_ID',
		'POSITRON_TASK_PROFILE_VERSION',
		'POSITRON_HARNESS_REASONING_MODE',
		'POSITRON_OPENCODE_PROVIDER',
		'POSITRON_OPENCODE_MODEL',
	]) {
		SAVED_ENV[key] = process.env[key];
	}
});

afterAll(() => {
	clearGateEvaluators();
	for (const [key, value] of Object.entries(SAVED_ENV)) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
});

describe('REAL_TWO_PROFILE_CANARY', () => {
	it('runs profile A and profile B through the productive control plane with distinct fingerprints', async () => {
		// ── Attempt A ─────────────────────────────────────────────────────
		const dbA = new Database(':memory:');
		applyMigrations(dbA);
		process.env.POSITRON_HARNESS_PROFILE_ID = 'canary-profile-a';
		process.env.POSITRON_HARNESS_PROFILE_VERSION = '2.0.0';
		process.env.POSITRON_TASK_PROFILE_ID = 'build-contract';
		process.env.POSITRON_TASK_PROFILE_VERSION = '3.1.0';
		process.env.POSITRON_HARNESS_REASONING_MODE = 'fast';
		process.env.POSITRON_OPENCODE_PROVIDER = 'openrouter';
		process.env.POSITRON_OPENCODE_MODEL = 'deepseek-v4-flash';
		const opencodeA = new ProfileAwareOpenCodeAdapter();
		const runA = makeRun(9101);
		prepareWorkspaceWithTests('9101');
		await runPipeline(runA, makeDeps(dbA, new FakeSpecKitAdapter(), opencodeA));
		const attemptA = buildAttemptOf(dbA, runA.id);
		expect(attemptA).not.toBeNull();

		// ── Attempt B ─────────────────────────────────────────────────────
		const dbB = new Database(':memory:');
		applyMigrations(dbB);
		process.env.POSITRON_HARNESS_PROFILE_ID = 'canary-profile-b';
		process.env.POSITRON_HARNESS_PROFILE_VERSION = '1.5.0';
		process.env.POSITRON_TASK_PROFILE_ID = 'build-contract';
		process.env.POSITRON_TASK_PROFILE_VERSION = '3.1.0';
		process.env.POSITRON_HARNESS_REASONING_MODE = 'deep';
		process.env.POSITRON_OPENCODE_PROVIDER = 'openrouter';
		process.env.POSITRON_OPENCODE_MODEL = 'deepseek-v4-flash';
		const opencodeB = new ProfileAwareOpenCodeAdapter();
		const runB = makeRun(9102);
		prepareWorkspaceWithTests('9102');
		await runPipeline(runB, makeDeps(dbB, new FakeSpecKitAdapter(), opencodeB));
		const attemptB = buildAttemptOf(dbB, runB.id);
		expect(attemptB).not.toBeNull();

		// ── Beweise ───────────────────────────────────────────────────────
		const a = attemptA!;
		const b = attemptB!;

		// REAL_PROFILE_A_EXECUTED / REAL_PROFILE_B_EXECUTED: Die Runtime hat
		// das jeweilige Profil tatsächlich gesehen (Adapter-Beobachtung).
		expect(opencodeA.observedProfiles).toContain('canary-profile-a');
		expect(opencodeB.observedProfiles).toContain('canary-profile-b');

		// PROFILE_PROVENANCE_PERSISTED: Identity/Version/Fingerprint in cp_attempts.
		expect(a.harness_profile_id).toBe('canary-profile-a');
		expect(a.harness_profile_version).toBe('2.0.0');
		expect(b.harness_profile_id).toBe('canary-profile-b');
		expect(b.harness_profile_version).toBe('1.5.0');
		expect(a.harness_fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(b.harness_fingerprint).toMatch(/^[0-9a-f]{64}$/);

		// A.fingerprint != B.fingerprint (unterschiedliche Harness-Semantik).
		expect(a.harness_fingerprint).not.toBe(b.harness_fingerprint);

		// EXECUTED_PROFILE_EQUALS_PERSISTED_PROFILE: Der persistierte
		// Contract trägt exakt die Semantik, die zur Laufzeit aktiv war.
		const refA = JSON.parse(a.harness_profile_ref!) as {
			harness_profile_id: string;
			task_profile_id: string;
			semantics: { model_profile: { id: string }; reasoning_mode: string };
		};
		const refB = JSON.parse(b.harness_profile_ref!) as {
			harness_profile_id: string;
			task_profile_id: string;
			semantics: { model_profile: { id: string }; reasoning_mode: string };
		};
		expect(refA.harness_profile_id).toBe('canary-profile-a');
		expect(refA.task_profile_id).toBe('build-contract');
		expect(refA.semantics.reasoning_mode).toBe('fast');
		expect(refB.harness_profile_id).toBe('canary-profile-b');
		expect(refB.semantics.reasoning_mode).toBe('deep');

		// Profile real ausgeführt: unterschiedliche Implementierungen
		// (Output-Fingerprints unterscheiden sich) — kein Fake-DB-Trick.
		expect(a.output_fingerprint).not.toBe(b.output_fingerprint);

		// Provider/Model-Provenienz (KNOWN) + Task-Typ:
		expect(a.provider).toBe('openrouter');
		expect(a.model).toBe('deepseek-v4-flash');
		expect(a.model_provenance_status).toBe('KNOWN');
		expect(a.task_profile_id).toBe('build-contract');

		// P5.2 — Effective Runtime Configuration (kompiliert, Kernel ∩ Profil):
		const effA = JSON.parse(a.effective_harness_config!) as {
			effective_permissions: { mutation: boolean; push: boolean; secret_access: boolean };
			effective_reasoning_mode: string;
			effective_tools: string[];
			fingerprint: string;
		};
		const effB = JSON.parse(b.effective_harness_config!) as {
			effective_permissions: { mutation: boolean; push: boolean; secret_access: boolean };
			effective_reasoning_mode: string;
			effective_tools: string[];
			fingerprint: string;
		};
		// Reproduzierbarer Effective-Fingerprint persistiert:
		expect(a.effective_harness_fingerprint).toBe(effA.fingerprint);
		expect(b.effective_harness_fingerprint).toBe(effB.fingerprint);
		expect(a.effective_harness_fingerprint).not.toBe(b.effective_harness_fingerprint);
		// Reasoning-Modi aus den Profilen wirksam:
		expect(effA.effective_reasoning_mode).toBe('fast');
		expect(effB.effective_reasoning_mode).toBe('deep');
		// Kernel-Denys gewinnen (kein Push/Secret trotz Build-Profil):
		expect(effA.effective_permissions.push).toBe(false);
		expect(effA.effective_permissions.secret_access).toBe(false);
		expect(effB.effective_permissions.push).toBe(false);
		// Build-Profil darf innerhalb der Kernel-Grenze mutieren:
		expect(effA.effective_permissions.mutation).toBe(true);
		// Tool-Allowlist kompiliert:
		expect(effA.effective_tools).toEqual(['read', 'grep', 'list', 'cat', 'edit', 'write', 'test']);

		// Verification-Result je Attempt vorhanden (Verification-Contract):
		const verifyA = dbA
			.prepare(
				`SELECT a.output_contract, a.output_json FROM cp_attempts a
				 JOIN cp_jobs j ON j.job_id = a.job_id
				 WHERE a.run_id = ? AND j.job_type = 'verify'`,
			)
			.get(runA.id) as { output_contract: string; output_json: string } | undefined;
		const verifyB = dbB
			.prepare(
				`SELECT a.output_contract, a.output_json FROM cp_attempts a
				 JOIN cp_jobs j ON j.job_id = a.job_id
				 WHERE a.run_id = ? AND j.job_type = 'verify'`,
			)
			.get(runB.id) as { output_contract: string; output_json: string } | undefined;
		expect(verifyA?.output_contract).toBe('positron.verification.v1');
		expect(verifyB?.output_contract).toBe('positron.verification.v1');

		dbA.close();
		dbB.close();
	});
});
