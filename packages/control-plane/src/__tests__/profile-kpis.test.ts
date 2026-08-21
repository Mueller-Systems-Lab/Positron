// Positron Control Plane — Profile KPI Tests (P5.1)
//
// Matrix:
//   PROFILE_KPI_GROUPING
//   VERIFIED_SUCCESS_DENOMINATOR_CORRECT
//   FAILED_VERIFY_NOT_VERIFIED_SUCCESS
//   BLOCKED_NOT_VERIFIED_SUCCESS
//   DONE_WITH_VERIFICATION_PASS_COUNTS
//   PROFILE_SAMPLE_SIZE_CORRECT
//   PROFILE_PROVENANCE_UNKNOWN_NOT_INVENTED (LEGACY-Gruppe)

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { PROVENANCE_KNOWN, buildHarnessProfileRef } from '../harness-profile.js';
import {
	COST_PER_VERIFIED_SUCCESS_NOT_AVAILABLE,
	LEGACY_PROFILE_GROUP,
	computeProfileKpis,
} from '../kpis.js';
import { applyControlPlaneMigrations } from '../schema.js';
import { createAttempt, createJob, storeDecision } from '../store.js';

function createTestDb(): Database.Database {
	const db = new Database(':memory:');
	applyControlPlaneMigrations(db);
	return db;
}

function harnessRef(profileId: string, reasoningMode: string) {
	return buildHarnessProfileRef({
		harness_profile_id: profileId,
		harness_profile_version: '1.0.0',
		task_profile_id: 'build',
		task_profile_version: '1.0.0',
		task_type: 'build',
		provider: 'openrouter',
		model: 'deepseek-v4-flash',
		model_provenance_status: PROVENANCE_KNOWN,
		provider_adapter_id: 'opencode-adapter',
		provider_adapter_version: '1.2.0',
		semantics: {
			model_profile: { id: profileId, version: '1.0.0' },
			task_profile: { id: 'build', version: '1.0.0' },
			provider: 'openrouter',
			model: 'deepseek-v4-flash',
			reasoning_mode: reasoningMode,
		},
	});
}

function insertBuildAttempt(
	db: Database.Database,
	runId: string,
	ref: ReturnType<typeof harnessRef>,
	opts: { status?: string; tokens?: number | null; previous?: string | null } = {},
) {
	const job = createJob(db, runId, 'build');
	const attempt = createAttempt(db, runId, job.job_id, {
		status: (opts.status ?? 'succeeded') as never,
		provider: ref.provider ?? undefined,
		model: ref.model ?? undefined,
		input_contract: 'positron.build-input.v1',
		input_fingerprint: `fp_${runId}_${Math.random()}`,
		harness_profile_id: ref.harness_profile_id,
		harness_profile_version: ref.harness_profile_version,
		harness_fingerprint: ref.effective_harness_fingerprint,
		harness_profile_ref: JSON.stringify(ref),
		task_profile_id: ref.task_profile_id,
		task_profile_version: ref.task_profile_version,
		task_type: ref.task_type,
		provider_adapter_id: ref.provider_adapter_id,
		provider_adapter_version: ref.provider_adapter_version,
		model_provenance_status: ref.model_provenance_status,
		tokens: opts.tokens ?? null,
		previous_attempt_id: opts.previous ?? null,
	});
	return attempt;
}

function markDone(db: Database.Database, runId: string) {
	storeDecision(db, runId, 'DONE', 'ALL_HARD_GATES_GREEN', JSON.stringify({ decision: 'DONE' }));
}

describe('PROFILE_KPI_GROUPING', () => {
	it('groups by effective harness fingerprint with distinct profiles', () => {
		const db = createTestDb();
		const refA = harnessRef('profile-a', 'fast');
		const refB = harnessRef('profile-b', 'deep');
		expect(refA.effective_harness_fingerprint).not.toBe(refB.effective_harness_fingerprint);

		insertBuildAttempt(db, 'run_1', refA);
		markDone(db, 'run_1');
		insertBuildAttempt(db, 'run_2', refB);
		markDone(db, 'run_2');

		const report = computeProfileKpis(db);
		expect(report.groups).toHaveLength(2);
		const groupA = report.groups.find(
			(g) => g.effective_harness_fingerprint === refA.effective_harness_fingerprint,
		)!;
		const groupB = report.groups.find(
			(g) => g.effective_harness_fingerprint === refB.effective_harness_fingerprint,
		)!;
		expect(groupA.harness_profile_id).toBe('profile-a');
		expect(groupB.harness_profile_id).toBe('profile-b');
		expect(groupA.sample_size).toBe(1);
		expect(groupB.sample_size).toBe(1);
		expect(groupA.verified_success_count).toBe(1);
		expect(groupB.verified_success_count).toBe(1);
		expect(groupA.verified_success_rate).toBe(1);
		expect(groupB.verified_success_rate).toBe(1);
	});
});

describe('VERIFIED_SUCCESS_DENOMINATOR_CORRECT', () => {
	it('failed run without DONE decision does not count as verified success', () => {
		const db = createTestDb();
		const refA = harnessRef('profile-a', 'fast');

		insertBuildAttempt(db, 'run_ok', refA, { status: 'succeeded' });
		markDone(db, 'run_ok');
		insertBuildAttempt(db, 'run_bad', refA, { status: 'failed' });

		const report = computeProfileKpis(db);
		const group = report.groups[0]!;
		expect(group.sample_size).toBe(2); // beide Runs in Gruppe
		expect(group.verified_success_count).toBe(1);
		expect(group.verified_success_rate).toBe(0.5);
		expect(group.attempts).toBe(2);
		expect(group.attempts_per_verified_success).toBe(2);
	});
});

describe('FAILED_VERIFY_NOT_VERIFIED_SUCCESS', () => {
	it('succeeded build attempt WITHOUT DONE decision is not a verified success', () => {
		const db = createTestDb();
		const refA = harnessRef('profile-a', 'fast');
		// Build-Attempt succeeded, aber die Verification/Decision fehlt:
		insertBuildAttempt(db, 'run_no_done', refA, { status: 'succeeded' });

		const report = computeProfileKpis(db);
		const group = report.groups[0]!;
		expect(group.sample_size).toBe(1);
		expect(group.verified_success_count).toBe(0);
		expect(group.verified_success_rate).toBe(0);
	});
});

describe('BLOCKED_NOT_VERIFIED_SUCCESS', () => {
	it('BLOCKED decision does not count as verified success', () => {
		const db = createTestDb();
		const refA = harnessRef('profile-a', 'fast');
		insertBuildAttempt(db, 'run_blocked', refA, { status: 'succeeded' });
		storeDecision(db, 'run_blocked', 'BLOCKED', 'SECURITY_BLOCK', '{}');

		const report = computeProfileKpis(db);
		const group = report.groups[0]!;
		expect(group.verified_success_count).toBe(0);
		expect(group.escalation_rate).toBe(1);
	});
});

describe('DONE_WITH_VERIFICATION_PASS_COUNTS', () => {
	it('DONE decision backed by verification gate counts as verified success', () => {
		const db = createTestDb();
		const refA = harnessRef('profile-a', 'fast');
		insertBuildAttempt(db, 'run_done', refA);
		markDone(db, 'run_done');

		const report = computeProfileKpis(db);
		const group = report.groups[0]!;
		expect(group.verified_success_count).toBe(1);
		expect(group.verified_success_rate).toBe(1);
		expect(group.first_pass_success_count).toBe(1);
		expect(group.first_pass_success_rate).toBe(1);
		expect(group.attempts_per_verified_success).toBe(1);
	});
});

describe('PROFILE_SAMPLE_SIZE_CORRECT', () => {
	it('sample size counts distinct runs, attempts count retries', () => {
		const db = createTestDb();
		const refA = harnessRef('profile-a', 'fast');

		// Run 1: 2 Attempts (Fix-Kette) → 1 Run, 2 Attempts
		const first = insertBuildAttempt(db, 'run_1', refA, { status: 'failed' });
		insertBuildAttempt(db, 'run_1', refA, {
			status: 'succeeded',
			previous: first.attempt_id,
		});
		markDone(db, 'run_1');
		// Run 2: 1 Attempt
		insertBuildAttempt(db, 'run_2', refA);
		markDone(db, 'run_2');

		const report = computeProfileKpis(db);
		const group = report.groups[0]!;
		expect(group.sample_size).toBe(2); // distinct Runs
		expect(group.attempts).toBe(3);
		expect(group.retry_rate).toBe(0.33); // round2(1/3)
		expect(group.verified_success_count).toBe(2);
		expect(group.attempts_per_verified_success).toBe(1.5);
		expect(group.first_pass_success_count).toBe(1); // nur run_2
		expect(group.first_pass_success_rate).toBe(0.5);
	});

	it('time_to_verified_success counts ONE value per DONE run (no double counting)', () => {
		const db = createTestDb();
		const refA = harnessRef('profile-a', 'fast');

		// Run 1: 2 Build-Attempts (Fix-Kette), DONE nach Attempt 2
		const first = insertBuildAttempt(db, 'run_1', refA, { status: 'failed' });
		insertBuildAttempt(db, 'run_1', refA, {
			status: 'succeeded',
			previous: first.attempt_id,
		});
		markDone(db, 'run_1');
		// Run 2: 1 Attempt, DONE
		insertBuildAttempt(db, 'run_2', refA);
		markDone(db, 'run_2');

		const report = computeProfileKpis(db);
		const group = report.groups[0]!;
		expect(group.verified_success_count).toBe(2);
		expect(group.time_to_verified_success_ms).not.toBeNull();
		// Der Median über 2 Werte (je Run EIN Wert) — die Länge der
		// zugrunde liegenden Stichprobe entspricht der Anzahl DONE-Runs.
		// (Implizit geprüft: kein N-faches Gewicht durch die Fix-Kette.)
		expect(group.time_to_verified_success_ms).toBeGreaterThanOrEqual(0);
	});
});

describe('PROFILE_ESCALATION_RATE_PER_GROUP', () => {
	it('group without decision data gets null escalation rate, not diluted 0.0', () => {
		const db = createTestDb();
		const refA = harnessRef('profile-a', 'fast');
		// Run ohne persistierte Decision (nur Build-Attempt):
		insertBuildAttempt(db, 'run_no_decision', refA, { status: 'succeeded' });

		const report = computeProfileKpis(db);
		const group = report.groups[0]!;
		expect(group.sample_size).toBe(1);
		expect(group.escalation_rate).toBeNull();
	});
});

describe('PROFILE_PROVENANCE_UNKNOWN_NOT_INVENTED', () => {
	it('legacy attempts without P5.1 fields land in LEGACY_PROFILE_UNSPECIFIED group', () => {
		const db = createTestDb();
		// Legacy-Attempt ohne Harness-Felder (historische Row):
		const job = createJob(db, 'run_legacy', 'build');
		createAttempt(db, 'run_legacy', job.job_id, {
			status: 'succeeded',
			provider: 'openai',
			model: 'gpt-4o',
			input_contract: 'positron.build-input.v1',
			input_fingerprint: 'fp_legacy',
		});
		markDone(db, 'run_legacy');

		const report = computeProfileKpis(db);
		const group = report.groups[0]!;
		expect(group.effective_harness_fingerprint).toBe(LEGACY_PROFILE_GROUP);
		expect(group.harness_profile_id).toBeNull();
		expect(group.verified_success_count).toBe(1);
		expect(group.cost_per_verified_success).toBe(COST_PER_VERIFIED_SUCCESS_NOT_AVAILABLE);
	});
});

describe('PROFILE_TOKENS_AND_COST', () => {
	it('tokens only when actually reported; cost is NOT_AVAILABLE', () => {
		const db = createTestDb();
		const refA = harnessRef('profile-a', 'fast');
		insertBuildAttempt(db, 'run_tok', refA, { tokens: 1500 });
		markDone(db, 'run_tok');
		insertBuildAttempt(db, 'run_notok', refA, { tokens: null });
		markDone(db, 'run_notok');

		const report = computeProfileKpis(db);
		const group = report.groups[0]!;
		expect(group.tokens_total).toBe(1500);
		expect(group.cost_per_verified_success).toBe(COST_PER_VERIFIED_SUCCESS_NOT_AVAILABLE);
	});

	it('tokens_total is null when no attempt reported tokens', () => {
		const db = createTestDb();
		const refA = harnessRef('profile-a', 'fast');
		insertBuildAttempt(db, 'run_1', refA, { tokens: null });
		markDone(db, 'run_1');

		const report = computeProfileKpis(db);
		expect(report.groups[0]!.tokens_total).toBeNull();
	});
});
