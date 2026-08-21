// Positron Control Plane — Harness Profile Identity & Provenance Tests (P5.1)
//
// Testmatrix:
//   HARNESS_FINGERPRINT_STABLE
//   SEMANTIC_CHANGE_CHANGES_FINGERPRINT
//   RUNTIME_METADATA_IGNORED
//   PROFILE_PROVENANCE_UNKNOWN_NOT_INVENTED
//   PROFILE_TELEMETRY_NO_SECRETS
//   UNKNOWN_CONTRACT / UNKNOWN_VERSION / INVALID_PROFILE_REF / INVALID_FINGERPRINT

import { describe, expect, it } from 'vitest';
import { validateContract } from '../contracts.js';
import {
	buildHarnessProfileRef,
	computeEffectiveHarnessFingerprint,
	HARNESS_PROFILE_REF_CONTRACT,
	HarnessMetadataSecretError,
	HarnessProfileValidationError,
	INVALID_FINGERPRINT,
	INVALID_PROFILE_REF,
	isLegacyHarnessAttempt,
	LEGACY_PROFILE_UNSPECIFIED,
	PROVENANCE_KNOWN,
	PROVENANCE_UNAVAILABLE,
	resolveHarnessProfileFromEnv,
	UNKNOWN_CONTRACT,
	UNKNOWN_VERSION,
	validateHarnessProfileRef,
} from '../harness-profile.js';

const BASE_SEMANTICS: Record<string, unknown> = {
	model_adapter: { id: 'opencode-adapter', version: '1.2.0' },
	model_profile: { id: 'profile-fast', version: '1.0.0' },
	task_profile: { id: 'build', version: '1.0.0' },
	provider: 'openrouter',
	model: 'deepseek-v4-flash',
	worker_type: 'opencode',
	task_type: 'build',
	reasoning_mode: 'fast',
	tool_surface: 'default',
	context_strategy: 'compact',
	policy_ref: 'positron.runtime-policy.v1',
};

const BASE_INPUT = {
	harness_profile_id: 'profile-fast',
	harness_profile_version: '1.0.0',
	task_profile_id: 'build',
	task_profile_version: '1.0.0',
	task_type: 'build',
	provider: 'openrouter',
	model: 'deepseek-v4-flash',
	model_provenance_status: PROVENANCE_KNOWN,
	provider_adapter_id: 'opencode-adapter',
	provider_adapter_version: '1.2.0',
	semantics: BASE_SEMANTICS,
} as const;

describe('EFFECTIVE_HARNESS_FINGERPRINT_STABLE', () => {
	it('same semantics → same fingerprint', () => {
		const a = computeEffectiveHarnessFingerprint(BASE_SEMANTICS);
		const b = computeEffectiveHarnessFingerprint({ ...BASE_SEMANTICS });
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{64}$/);
	});

	it('buildHarnessProfileRef is deterministic across calls', () => {
		const refA = buildHarnessProfileRef({ ...BASE_INPUT });
		const refB = buildHarnessProfileRef({ ...BASE_INPUT });
		expect(refA.effective_harness_fingerprint).toBe(refB.effective_harness_fingerprint);
	});
});

describe('SEMANTIC_CHANGE_CHANGES_FINGERPRINT', () => {
	it('different model profile id → different fingerprint', () => {
		const a = computeEffectiveHarnessFingerprint(BASE_SEMANTICS);
		const b = computeEffectiveHarnessFingerprint({
			...BASE_SEMANTICS,
			model_profile: { id: 'profile-deep', version: '1.0.0' },
		});
		expect(a).not.toBe(b);
	});

	it('different reasoning mode → different fingerprint', () => {
		const a = computeEffectiveHarnessFingerprint(BASE_SEMANTICS);
		const b = computeEffectiveHarnessFingerprint({ ...BASE_SEMANTICS, reasoning_mode: 'deep' });
		expect(a).not.toBe(b);
	});

	it('different task profile → different fingerprint', () => {
		const a = computeEffectiveHarnessFingerprint(BASE_SEMANTICS);
		const b = computeEffectiveHarnessFingerprint({
			...BASE_SEMANTICS,
			task_profile: { id: 'plan', version: '1.0.0' },
		});
		expect(a).not.toBe(b);
	});

	it('different adapter version → different fingerprint', () => {
		const a = computeEffectiveHarnessFingerprint(BASE_SEMANTICS);
		const b = computeEffectiveHarnessFingerprint({
			...BASE_SEMANTICS,
			model_adapter: { id: 'opencode-adapter', version: '1.3.0' },
		});
		expect(a).not.toBe(b);
	});
});

describe('RUNTIME_METADATA_IGNORED', () => {
	it('run_id/job_id/attempt_id/timestamps/duration/result_refs/logs do not change fingerprint', () => {
		const base = computeEffectiveHarnessFingerprint(BASE_SEMANTICS);
		const withRuntime = computeEffectiveHarnessFingerprint({
			...BASE_SEMANTICS,
			run_id: 'run_abc',
			job_id: 'job_xyz',
			attempt_id: 'att_999',
			runId: 'run_1',
			jobId: 'job_1',
			attemptId: 'att_1',
			created_at: '2026-08-21T10:00:00Z',
			started_at: '2026-08-21T10:00:01Z',
			ended_at: '2026-08-21T10:05:00Z',
			timestamp: '2026-08-21T10:00:00Z',
			duration_ms: 300000,
			result_ref: 'art_123',
			log: 'some volatile log text',
			output_json: '{"raw":"response"}',
		});
		expect(withRuntime).toBe(base);
	});
});

describe('PROFILE_PROVENANCE_UNKNOWN_NOT_INVENTED', () => {
	it('no provider/model → PROVENANCE_UNAVAILABLE, no invented revision', () => {
		const ref = resolveHarnessProfileFromEnv(
			{},
			{ taskType: 'build', workerType: 'opencode', provider: null, model: null },
		);
		expect(ref.model_provenance_status).toBe(PROVENANCE_UNAVAILABLE);
		expect(ref.provider).toBeNull();
		expect(ref.model).toBeNull();
		// Kein erfundener Alias als revision:
		expect(ref.semantics['revision']).toBeUndefined();
	});

	it('explicit env config is honored without invention', () => {
		const ref = resolveHarnessProfileFromEnv(
			{
				POSITRON_HARNESS_PROFILE_ID: 'canary-profile-a',
				POSITRON_HARNESS_PROFILE_VERSION: '2.1.0',
				POSITRON_TASK_PROFILE_ID: 'build-contract',
				POSITRON_TASK_PROFILE_VERSION: '3.0.0',
				POSITRON_HARNESS_REASONING_MODE: 'fast',
			},
			{ taskType: 'build', workerType: 'opencode', provider: 'openrouter', model: 'm-1' },
		);
		expect(ref.model_provenance_status).toBe(PROVENANCE_KNOWN);
		expect(ref.harness_profile_id).toBe('canary-profile-a');
		expect(ref.harness_profile_version).toBe('2.1.0');
		expect(ref.task_profile_id).toBe('build-contract');
		expect(ref.task_profile_version).toBe('3.0.0');
		expect(ref.semantics['reasoning_mode']).toBe('fast');
		// Kein erfundener revision:
		expect(ref.semantics['revision']).toBeUndefined();
	});

	it('missing profile config falls back to unspecified without invention', () => {
		const ref = resolveHarnessProfileFromEnv(
			{},
			{ taskType: 'plan', workerType: 'opencode.plan', provider: 'openrouter', model: 'm-1' },
		);
		expect(ref.harness_profile_id).toBe('unspecified');
		expect(ref.model_provenance_status).toBe(PROVENANCE_KNOWN);
	});
});

describe('PROFILE_TELEMETRY_NO_SECRETS', () => {
	it('token-like value in metadata is rejected', () => {
		expect(() =>
			buildHarnessProfileRef({
				...BASE_INPUT,
				semantics: { ...BASE_SEMANTICS, api_key: 'sk-abcdefghijklmnopqrstuvwxyz123456' },
			}),
		).toThrow(HarnessMetadataSecretError);
	});

	it('token-like value in top-level profile fields is rejected', () => {
		expect(() =>
			buildHarnessProfileRef({
				...BASE_INPUT,
				harness_profile_id: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl',
			}),
		).toThrow(HarnessMetadataSecretError);
	});

	it('bearer-like value is rejected', () => {
		expect(() =>
			buildHarnessProfileRef({
				...BASE_INPUT,
				semantics: { ...BASE_SEMANTICS, authorization: 'Bearer abcdefghijklmnopqrstuvwxyz' },
			}),
		).toThrow(HarnessMetadataSecretError);
	});

	it('benign values pass', () => {
		const ref = buildHarnessProfileRef({ ...BASE_INPUT });
		expect(ref.effective_harness_fingerprint).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe('HARNESS_PROFILE_REF_CONTRACT_FAIL_CLOSED', () => {
	it('valid document passes', () => {
		const doc = buildHarnessProfileRef({ ...BASE_INPUT });
		const result = validateHarnessProfileRef(doc);
		expect(result.ok).toBe(true);
		expect(result.reasonCode).toBeNull();
	});

	it('unknown contract → UNKNOWN_CONTRACT', () => {
		const result = validateHarnessProfileRef({
			contract: 'positron.nope.v9',
			harness_profile_id: 'x',
		});
		expect(result.ok).toBe(false);
		expect(result.reasonCode).toBe(UNKNOWN_CONTRACT);
	});

	it('unknown version → UNKNOWN_VERSION', () => {
		const doc = buildHarnessProfileRef({ ...BASE_INPUT });
		const result = validateContract(HARNESS_PROFILE_REF_CONTRACT, doc, 2);
		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => e.startsWith('UNKNOWN_VERSION'))).toBe(true);
	});

	it('missing profile ref fields → INVALID_PROFILE_REF', () => {
		const doc = buildHarnessProfileRef({ ...BASE_INPUT });
		const invalid = { ...doc, harness_profile_id: '' };
		const result = validateHarnessProfileRef(invalid);
		expect(result.ok).toBe(false);
		expect(result.reasonCode).toBe(INVALID_PROFILE_REF);
	});

	it('fabricated fingerprint mismatch → INVALID_FINGERPRINT', () => {
		const doc = buildHarnessProfileRef({ ...BASE_INPUT });
		const forged = { ...doc, effective_harness_fingerprint: '0'.repeat(64) };
		const result = validateHarnessProfileRef(forged);
		expect(result.ok).toBe(false);
		expect(result.reasonCode).toBe(INVALID_FINGERPRINT);
	});

	it('builder throws with reason code for inconsistent provenance', () => {
		expect(() =>
			buildHarnessProfileRef({
				...BASE_INPUT,
				provider: null,
				model: null,
				model_provenance_status: PROVENANCE_KNOWN,
			}),
		).toThrow(HarnessProfileValidationError);
	});
});

describe('LEGACY_PROFILE_UNSPECIFIED', () => {
	it('legacy attempt (all P5.1 fields null) is detected', () => {
		expect(
			isLegacyHarnessAttempt({ harness_profile_id: null, harness_fingerprint: null }),
		).toBe(true);
		expect(
			isLegacyHarnessAttempt({ harness_profile_id: 'profile-a', harness_fingerprint: 'ab'.repeat(32) }),
		).toBe(false);
		expect(LEGACY_PROFILE_UNSPECIFIED).toBe('LEGACY_PROFILE_UNSPECIFIED');
	});
});
