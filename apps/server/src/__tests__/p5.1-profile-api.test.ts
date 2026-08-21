// Issue #423 (P5.1) — Harness Profile API Projektion (Backend Truth)
//
// Beweist:
// - GET /api/runs/:id/control-plane exponiert P5.1-Metadaten (Profil-ID,
//   Version, Fingerprint, Task-Profil, Task-Typ, Adapter, Provenance-Status)
// - Historische Attempts (ohne P5.1-Felder) bleiben lesbar und werden als
//   LEGACY_PROFILE_UNSPECIFIED dargestellt (kein Erfinden)
// - Keine Secrets / kein output_json / kein vollständiger Profil-Contract in
//   der API-Projektion (Privacy by Default, serverseitige Redaction-Grenze)
// - GET /api/kpis liefert Profile-KPI-Gruppen (Backend Truth)

import fs from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { applyControlPlaneMigrations } from '@positron/control-plane';
import { createAttempt, createJob, storeDecision } from '@positron/control-plane';
import { PROVENANCE_KNOWN, buildHarnessProfileRef } from '@positron/control-plane';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../index.js';

let server: http.Server;
let baseUrl: string;
let dbPath: string;

const harnessRef = buildHarnessProfileRef({
	harness_profile_id: 'profile-api-a',
	harness_profile_version: '2.0.0',
	task_profile_id: 'build-contract',
	task_profile_version: '3.1.0',
	task_type: 'build',
	provider: 'openrouter',
	model: 'deepseek-v4-flash',
	model_provenance_status: PROVENANCE_KNOWN,
	provider_adapter_id: 'opencode-adapter',
	provider_adapter_version: '1.2.0',
	semantics: {
		model_profile: { id: 'profile-api-a', version: '2.0.0' },
		task_profile: { id: 'build-contract', version: '3.1.0' },
		provider: 'openrouter',
		model: 'deepseek-v4-flash',
		reasoning_mode: 'fast',
	},
});

beforeAll(async () => {
	// Eigene Datei-DB mit P5.1-Daten + einem Legacy-Attempt (V7-Spalten fehlen)
	dbPath = path.join(os.tmpdir(), `positron-p51-api-${Date.now()}.db`);
	const db = new Database(dbPath);
	applyControlPlaneMigrations(db);

	// Produktiver Attempt mit Harness-Profil:
	const jobA = createJob(db, 'run_profile_api', 'build');
	createAttempt(db, 'run_profile_api', jobA.job_id, {
		status: 'succeeded',
		provider: harnessRef.provider ?? undefined,
		model: harnessRef.model ?? undefined,
		input_contract: 'positron.build-input.v1',
		input_fingerprint: 'ab'.repeat(32),
		harness_profile_id: harnessRef.harness_profile_id,
		harness_profile_version: harnessRef.harness_profile_version,
		harness_fingerprint: harnessRef.effective_harness_fingerprint,
		harness_profile_ref: JSON.stringify(harnessRef),
		task_profile_id: harnessRef.task_profile_id,
		task_profile_version: harnessRef.task_profile_version,
		task_type: harnessRef.task_type,
		provider_adapter_id: harnessRef.provider_adapter_id,
		provider_adapter_version: harnessRef.provider_adapter_version,
		model_provenance_status: harnessRef.model_provenance_status,
	});
	storeDecision(db, 'run_profile_api', 'DONE', 'ALL_HARD_GATES_GREEN', '{}');

	// Legacy-Attempt ohne P5.1-Felder (historische Row):
	const jobLegacy = createJob(db, 'run_legacy_api', 'build');
	createAttempt(db, 'run_legacy_api', jobLegacy.job_id, {
		status: 'succeeded',
		provider: 'openai',
		model: 'gpt-4o',
		input_contract: 'positron.build-input.v1',
		input_fingerprint: 'cd'.repeat(32),
	});
	storeDecision(db, 'run_legacy_api', 'DONE', 'ALL_HARD_GATES_GREEN', '{}');

	db.close();

	server = createServer({ repository: { owner: 't', repo: 'r' }, dbPath });
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
	const addr = server.address() as { port: number };
	baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
	server.close();
	fs.rmSync(dbPath, { force: true });
});

describe('GET /api/runs/:id/control-plane — P5.1 Projektion', () => {
	it('exposes safe harness profile metadata for a productive attempt', async () => {
		const res = await fetch(`${baseUrl}/api/runs/run_profile_api/control-plane`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			attempts: Array<Record<string, unknown>>;
		};
		const attempt = body.attempts[0]!;
		expect(attempt.harness_profile_id).toBe('profile-api-a');
		expect(attempt.harness_profile_version).toBe('2.0.0');
		expect(attempt.harness_fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(attempt.task_profile_id).toBe('build-contract');
		expect(attempt.task_profile_version).toBe('3.1.0');
		expect(attempt.task_type).toBe('build');
		expect(attempt.provider_adapter_id).toBe('opencode-adapter');
		expect(attempt.provider_adapter_version).toBe('1.2.0');
		expect(attempt.model_provenance_status).toBe('KNOWN');
	});

	it('exposes effective permission summary and fingerprint (P5.2, no raw contract)', async () => {
		// Befülle den Attempt mit einer kompilierten Effective Config:
		const {
			compileEffectiveHarness,
			BUILD_TASK_PROFILE,
			computeProfileFingerprint,
			modelProfileSemantics,
		} = await import('@positron/control-plane');
		const modelProfileBase = {
			contract: 'positron.model-profile.v1',
			model_profile_id: 'profile-api-a',
			model_profile_version: '2.0.0',
			provider: 'openrouter',
			model: 'deepseek-v4-flash',
			provenance: { status: 'KNOWN', revision: null },
			capabilities: ['code'],
			context_limits: { max_input_tokens: null, max_output_tokens: null },
			reasoning_modes: ['fast', 'deep'],
			supported_tools: ['read', 'grep', 'list', 'cat', 'edit', 'write', 'test'],
			provider_specific: {},
		} as const;
		const modelProfile = {
			...modelProfileBase,
			fingerprint: computeProfileFingerprint(modelProfileSemantics(modelProfileBase)),
		};
		const effective = compileEffectiveHarness({
			modelProfile,
			taskProfile: BUILD_TASK_PROFILE,
			kernelPermissions: {
				mutation: true,
				push: false,
				merge: false,
				deploy: false,
				secret_access: false,
			},
			runContextFingerprint: 'ef'.repeat(32),
			adapterSupportedTools: ['read', 'grep', 'list', 'cat', 'edit', 'write', 'test'],
			adapterSupportedReasoningModes: ['fast', 'deep'],
		});
		const db = new Database(dbPath);
		db.prepare(
			'UPDATE cp_attempts SET effective_harness_config = ?, effective_harness_fingerprint = ? WHERE run_id = ?',
		).run(JSON.stringify(effective), effective.fingerprint, 'run_profile_api');
		db.close();

		const res = await fetch(`${baseUrl}/api/runs/run_profile_api/control-plane`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			attempts: Array<Record<string, unknown>>;
		};
		const attempt = body.attempts[0]!;
		expect(attempt.effective_harness_fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(attempt.effective_permissions).toEqual({
			mutation: true,
			push: false,
			merge: false,
			deploy: false,
			secret_access: false,
		});
		// Kein Raw-Contract in der Projektion:
		expect(attempt.effective_harness_config).toBeUndefined();
		expect(JSON.stringify(body)).not.toContain('effective_tools');
	});

	it('historical attempts stay readable as LEGACY_PROFILE_UNSPECIFIED (no invention)', async () => {
		const res = await fetch(`${baseUrl}/api/runs/run_legacy_api/control-plane`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			attempts: Array<Record<string, unknown>>;
		};
		const attempt = body.attempts[0]!;
		expect(attempt.harness_profile_id).toBeNull();
		expect(attempt.harness_fingerprint).toBeNull();
		expect(attempt.model_provenance_status).toBe('LEGACY_PROFILE_UNSPECIFIED');
	});

	it('does not expose secrets, raw contracts, output_json or semantics (Privacy by Default)', async () => {
		const res = await fetch(`${baseUrl}/api/runs/run_profile_api/control-plane`);
		const body = (await res.json()) as { attempts: Array<Record<string, unknown>> };
		const attempt = body.attempts[0]!;
		const serialized = JSON.stringify(body);
		expect(attempt.output_json).toBeUndefined();
		expect(attempt.harness_profile_ref).toBeUndefined();
		expect(attempt.semantics).toBeUndefined();
		// Keine Secret-Muster in der Projektion:
		expect(serialized).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
		expect(serialized).not.toMatch(/Bearer\s+[A-Za-z0-9._\-+/=]{20,}/i);
		expect(serialized).not.toContain('authorization');
		expect(serialized).not.toContain('api_key');
	});
});

describe('GET /api/kpis — Profile KPIs (Backend Truth)', () => {
	it('returns profile groups with sample size and verified success', async () => {
		const res = await fetch(`${baseUrl}/api/kpis`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			profile: {
				groups: Array<{
					harness_profile_id: string | null;
					sample_size: number;
					verified_success_count: number;
					cost_per_verified_success: string;
				}>;
				cost_per_verified_success: string;
			};
		};
		expect(Array.isArray(body.profile.groups)).toBe(true);
		const profileGroup = body.profile.groups.find((g) => g.harness_profile_id === 'profile-api-a');
		expect(profileGroup).toBeTruthy();
		expect(profileGroup!.sample_size).toBe(1);
		expect(profileGroup!.verified_success_count).toBe(1);
		expect(profileGroup!.cost_per_verified_success).toBe('NOT_AVAILABLE');
		expect(body.profile.cost_per_verified_success).toBe('NOT_AVAILABLE');
		// Legacy-Gruppe existiert (kein Erfinden, aber lesbar):
		const legacyGroup = body.profile.groups.find((g) => g.harness_profile_id === null);
		expect(legacyGroup).toBeTruthy();
		expect(legacyGroup!.sample_size).toBe(1);
	});
});
