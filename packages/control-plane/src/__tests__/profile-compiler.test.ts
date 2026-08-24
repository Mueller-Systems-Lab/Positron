// Positron Control Plane — Profile Compiler Tests (P5.2)
//
// Matrix:
//   MODEL_PROFILE_VALID / MODEL_PROFILE_INVALID
//   TASK_PROFILE_VALID
//   UNKNOWN_PROFILE_DENIED / PROFILE_VERSION_REJECT
//   KERNEL_PERMISSION_CANNOT_BE_ESCALATED
//   PLAN_PROFILE_READ_ONLY
//   BUILD_PROFILE_MUTATION_ALLOWED_WITHIN_KERNEL
//   RESEARCH_PROFILE_TOOL_LIMIT
//   REVIEW_PROFILE_READ_ONLY
//   EFFECTIVE_PROFILE_REPRODUCIBLE
//   PROFILE_FINGERPRINT_PERSISTED
//   PROFILE_COMPILER_UNKNOWN_CAPABILITY_DENIED
//   ADAPTER_SETTING_NOT_SILENTLY_DROPPED
//   DENIED_BY_KERNEL_POLICY (Canary)

import { describe, expect, it } from 'vitest';
import { KERNEL_DEFAULT_PERMISSIONS } from '../contracts.js';
import type { ModelProfileContract } from '../contracts.js';
import { HarnessMetadataSecretError } from '../harness-profile.js';
import {
	ADAPTER_CAPABILITY_MISMATCH,
	BUILD_TASK_PROFILE,
	DEFAULT_TASK_PROFILES,
	DENIED_BY_KERNEL_POLICY,
	KERNEL_POLICY_REF,
	PLAN_TASK_PROFILE,
	PROFILE_INCOMPATIBLE,
	PROFILE_INVALID,
	ProfileCompilationError,
	RESEARCH_TASK_PROFILE,
	REVIEW_TASK_PROFILE,
	TOOL_NOT_ALLOWED,
	UNKNOWN_PROFILE_DENIED,
	UNKNOWN_PROFILE_VERSION,
	compileEffectiveHarness,
	computeProfileFingerprint,
	modelProfileSemantics,
	resolveEffectiveHarnessFromEnv,
	resolveProfileFromRegistry,
	taskProfileSemantics,
	validateModelProfile,
	validateTaskProfile,
} from '../profile-compiler.js';
import { intersectPermissions } from '../profile-compiler.js';

const MODEL_PROFILE_A: ModelProfileContract = {
	contract: 'positron.model-profile.v1',
	model_profile_id: 'deepseek-fast',
	model_profile_version: '1.0.0',
	provider: 'openrouter',
	model: 'deepseek-v4-flash',
	provenance: { status: 'KNOWN', revision: null },
	capabilities: ['code', 'reasoning'],
	context_limits: { max_input_tokens: 64000, max_output_tokens: 8192 },
	reasoning_modes: ['fast', 'deep'],
	supported_tools: ['read', 'grep', 'list', 'cat', 'edit', 'write', 'test', 'diff', 'search'],
	provider_specific: {},
	fingerprint: '',
};

function withModelFingerprint(profile: ModelProfileContract): ModelProfileContract {
	return { ...profile, fingerprint: computeProfileFingerprint(modelProfileSemantics(profile)) };
}

function compileBase(
	task = BUILD_TASK_PROFILE,
	overrides: Partial<Parameters<typeof compileEffectiveHarness>[0]> = {},
) {
	return compileEffectiveHarness({
		modelProfile: withModelFingerprint(MODEL_PROFILE_A),
		taskProfile: task,
		kernelPermissions: KERNEL_DEFAULT_PERMISSIONS,
		runContextFingerprint: 'ab'.repeat(32),
		adapterSupportedTools: [
			'read',
			'grep',
			'list',
			'cat',
			'edit',
			'write',
			'test',
			'diff',
			'search',
		],
		adapterSupportedReasoningModes: ['fast', 'deep'],
		...overrides,
	});
}

describe('MODEL_PROFILE_VALID / INVALID', () => {
	it('valid model profile passes validation', () => {
		const profile = withModelFingerprint(MODEL_PROFILE_A);
		expect(validateModelProfile(profile).ok).toBe(true);
	});

	it('invalid fingerprint fails validation', () => {
		const profile = { ...MODEL_PROFILE_A, fingerprint: '0'.repeat(64) };
		expect(validateModelProfile(profile).ok).toBe(false);
	});

	it('fabricated revision is not invented (provenance null stays null)', () => {
		const profile = withModelFingerprint(MODEL_PROFILE_A);
		expect(profile.provenance.revision).toBeNull();
	});
});

describe('TASK_PROFILE_VALID', () => {
	it('all canonical task profiles are valid and fingerprinted', () => {
		for (const profile of Object.values(DEFAULT_TASK_PROFILES)) {
			expect(validateTaskProfile(profile).ok).toBe(true);
			expect(profile.fingerprint).toMatch(/^[0-9a-f]{64}$/);
			expect(profile.fingerprint).toBe(computeProfileFingerprint(taskProfileSemantics(profile)));
		}
	});

	it('invalid task_type fails validation', () => {
		const bad = { ...BUILD_TASK_PROFILE, task_type: 'EXECUTE' };
		expect(validateTaskProfile(bad).ok).toBe(false);
	});
});

describe('UNKNOWN_TASK_TYPE_FAIL_CLOSED', () => {
	it('non-canonical task types (verify/baseline/specify) get read-only profile, never BUILD', () => {
		const effectiveVerify = resolveEffectiveHarnessFromEnv(
			{},
			{ taskType: 'verify', workerType: 'deterministic-tools', provider: null, model: null },
		);
		expect(effectiveVerify.effective_permissions.mutation).toBe(false);
		expect(effectiveVerify.effective_permissions.push).toBe(false);
		expect(effectiveVerify.effective_tools).toEqual(['read', 'grep', 'list', 'cat']);
		const effectiveBaseline = resolveEffectiveHarnessFromEnv(
			{},
			{ taskType: 'baseline', workerType: 'deterministic.baseline', provider: null, model: null },
		);
		expect(effectiveBaseline.effective_permissions.mutation).toBe(false);
		const effectiveBuild = resolveEffectiveHarnessFromEnv(
			{},
			{ taskType: 'build', workerType: 'opencode', provider: 'p', model: 'm' },
		);
		expect(effectiveBuild.effective_permissions.mutation).toBe(true);
	});
});

describe('TOOL_NOT_ALLOWED_MODEL_PROFILE', () => {
	it('tool not supported by MODEL profile → TOOL_NOT_ALLOWED', () => {
		const limitedModel = withModelFingerprint({
			...MODEL_PROFILE_A,
			supported_tools: ['read', 'grep', 'list', 'cat', 'test'],
		});
		expect(() =>
			compileEffectiveHarness({
				modelProfile: limitedModel,
				taskProfile: BUILD_TASK_PROFILE, // will edit/write
				kernelPermissions: KERNEL_DEFAULT_PERMISSIONS,
				runContextFingerprint: 'ab'.repeat(32),
				adapterSupportedTools: ['read', 'grep', 'list', 'cat', 'edit', 'write', 'test'],
				adapterSupportedReasoningModes: ['fast', 'deep'],
			}),
		).toThrowError(expect.objectContaining({ code: TOOL_NOT_ALLOWED }));
	});
});

describe('DENIED_BY_KERNEL_POLICY_REASON_CODE', () => {
	it('profile permission above kernel is visible in reason_codes (not silent)', () => {
		const escalating = buildEscalatingProfile({ push: true, secret_access: true });
		const effective = compileBase(escalating);
		expect(effective.effective_permissions.push).toBe(false);
		expect(effective.effective_permissions.secret_access).toBe(false);
		expect(effective.compiler.reason_codes).toContain('DENIED_BY_KERNEL_POLICY:push');
		expect(effective.compiler.reason_codes).toContain('DENIED_BY_KERNEL_POLICY:secret_access');
	});

	it('profile within kernel bounds has empty reason_codes', () => {
		const effective = compileBase(BUILD_TASK_PROFILE);
		expect(effective.compiler.reason_codes).toEqual([]);
	});
});

describe('PROFILE_SECRET_DETECTION_DEFENSE_IN_DEPTH', () => {
	it('secret in provider_specific is rejected by the compiler', () => {
		const badModel = withModelFingerprint({
			...MODEL_PROFILE_A,
			provider_specific: { api_key: 'sk-abcdefghijklmnopqrstuvwxyz123456' },
		});
		expect(() => compileBase(BUILD_TASK_PROFILE, { modelProfile: badModel })).toThrow(
			HarnessMetadataSecretError,
		);
	});

	it('secret in context_strategy is rejected by the compiler', () => {
		const badTask = {
			...BUILD_TASK_PROFILE,
			context_strategy: 'Bearer abcdefghijklmnopqrstuvwxyz',
		};
		badTask.fingerprint = computeProfileFingerprint(taskProfileSemantics(badTask));
		expect(() => compileBase(badTask)).toThrow(HarnessMetadataSecretError);
	});
});

describe('UNKNOWN_PROFILE_DENIED / PROFILE_VERSION_REJECT', () => {
	it('unknown profile id → UNKNOWN_PROFILE_DENIED', () => {
		const registry = new Map<string, readonly (typeof BUILD_TASK_PROFILE)[]>([
			['build', [BUILD_TASK_PROFILE]],
		]);
		expect(() => resolveProfileFromRegistry(registry, 'nope', '1.0.0', 'task')).toThrowError(
			expect.objectContaining({ code: UNKNOWN_PROFILE_DENIED }),
		);
	});

	it('unknown version → UNKNOWN_PROFILE_VERSION', () => {
		const registry = new Map<string, readonly (typeof BUILD_TASK_PROFILE)[]>([
			['build', [BUILD_TASK_PROFILE]],
		]);
		expect(() => resolveProfileFromRegistry(registry, 'build', '9.9.9', 'task')).toThrowError(
			expect.objectContaining({ code: UNKNOWN_PROFILE_VERSION }),
		);
	});

	it('versioned registry resolves exact version', () => {
		const v1 = { ...BUILD_TASK_PROFILE };
		const v2 = { ...BUILD_TASK_PROFILE, task_profile_version: '2.0.0' };
		v2.fingerprint = computeProfileFingerprint(taskProfileSemantics(v2));
		const registry = new Map<string, readonly (typeof BUILD_TASK_PROFILE)[]>([['build', [v1, v2]]]);
		expect(
			resolveProfileFromRegistry(registry, 'build', '2.0.0', 'task').task_profile_version,
		).toBe('2.0.0');
	});
});

describe('KERNEL_PERMISSION_CANNOT_BE_ESCALATED', () => {
	it('profile requesting push is denied (kernel push=false)', () => {
		const profile = buildEscalatingProfile({ push: true });
		const effective = compileBase(profile);
		expect(effective.effective_permissions.push).toBe(false);
		expect(effective.effective_permissions.merge).toBe(false);
		expect(effective.effective_permissions.deploy).toBe(false);
		expect(effective.effective_permissions.secret_access).toBe(false);
	});

	it('intersection never yields true when kernel is false', () => {
		const result = intersectPermissions(
			{ mutation: true, push: false, merge: false, deploy: false, secret_access: false },
			{ mutation: true, push: true, merge: true, deploy: true, secret_access: true },
		);
		expect(result).toEqual({
			mutation: true,
			push: false,
			merge: false,
			deploy: false,
			secret_access: false,
		});
	});
});

function buildEscalatingProfile(
	perms: Partial<typeof BUILD_TASK_PROFILE.permissions>,
): typeof BUILD_TASK_PROFILE {
	const profile = {
		...BUILD_TASK_PROFILE,
		permissions: { ...BUILD_TASK_PROFILE.permissions, ...perms },
	};
	profile.fingerprint = computeProfileFingerprint(taskProfileSemantics(profile));
	return profile;
}

describe('PLAN_PROFILE_READ_ONLY', () => {
	it('PLAN profile compiles with mutation=false', () => {
		const effective = compileBase(PLAN_TASK_PROFILE);
		expect(effective.effective_permissions.mutation).toBe(false);
		expect(effective.effective_tools).toEqual(['read', 'grep', 'list', 'cat']);
	});
});

describe('BUILD_PROFILE_MUTATION_ALLOWED_WITHIN_KERNEL', () => {
	it('BUILD profile compiles with mutation=true within kernel', () => {
		const effective = compileBase(BUILD_TASK_PROFILE);
		expect(effective.effective_permissions.mutation).toBe(true);
		expect(effective.effective_permissions.push).toBe(false);
	});
});

describe('RESEARCH_PROFILE_TOOL_LIMIT', () => {
	it('RESEARCH tool subset excludes edit/write', () => {
		const effective = compileBase(RESEARCH_TASK_PROFILE);
		expect(effective.effective_tools).not.toContain('edit');
		expect(effective.effective_tools).not.toContain('write');
		expect(effective.effective_tools).toContain('search');
		expect(effective.effective_permissions.mutation).toBe(false);
	});
});

describe('REVIEW_PROFILE_READ_ONLY', () => {
	it('REVIEW profile compiles read-only with diff', () => {
		const effective = compileBase(REVIEW_TASK_PROFILE);
		expect(effective.effective_permissions.mutation).toBe(false);
		expect(effective.effective_tools).toContain('diff');
	});
});

describe('EFFECTIVE_PROFILE_REPRODUCIBLE', () => {
	it('same inputs → identical effective config and fingerprint', () => {
		const a = compileBase(BUILD_TASK_PROFILE);
		const b = compileBase(BUILD_TASK_PROFILE);
		expect(a.fingerprint).toBe(b.fingerprint);
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	});

	it('run context change does NOT change the effective fingerprint (runtime excluded)', () => {
		const a = compileBase(BUILD_TASK_PROFILE, { runContextFingerprint: 'aa'.repeat(32) });
		const b = compileBase(BUILD_TASK_PROFILE, { runContextFingerprint: 'bb'.repeat(32) });
		expect(a.run_context_fingerprint).not.toBe(b.run_context_fingerprint);
		expect(a.fingerprint).toBe(b.fingerprint);
	});
});

describe('PROFILE_FINGERPRINT_PERSISTED', () => {
	it('effective config carries both profile fingerprints + own fingerprint', () => {
		const effective = compileBase(BUILD_TASK_PROFILE);
		expect(effective.model_profile_ref.fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(effective.task_profile_ref.fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(effective.fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(effective.kernel_policy_ref).toBe(KERNEL_POLICY_REF);
	});
});

describe('PROFILE_COMPILER_UNKNOWN_CAPABILITY_DENIED', () => {
	it('unsupported reasoning mode → PROFILE_INCOMPATIBLE', () => {
		const task = {
			...BUILD_TASK_PROFILE,
			reasoning_policy: 'quantum',
		};
		task.fingerprint = computeProfileFingerprint(taskProfileSemantics(task));
		expect(() => compileBase(task)).toThrowError(
			expect.objectContaining({ code: PROFILE_INCOMPATIBLE }),
		);
	});

	it('invalid timeout → PROFILE_INVALID', () => {
		const task = { ...BUILD_TASK_PROFILE, timeout_ms: -5 };
		task.fingerprint = computeProfileFingerprint(taskProfileSemantics(task));
		expect(() => compileBase(task)).toThrowError(
			expect.objectContaining({ code: PROFILE_INVALID }),
		);
	});
});

describe('ADAPTER_SETTING_NOT_SILENTLY_DROPPED', () => {
	it('tool requested but not supported by adapter → ADAPTER_CAPABILITY_MISMATCH (no silent drop)', () => {
		const task = {
			...BUILD_TASK_PROFILE,
			allowed_tools: [...BUILD_TASK_PROFILE.allowed_tools, 'docker'],
		};
		task.fingerprint = computeProfileFingerprint(taskProfileSemantics(task));
		expect(() =>
			compileBase(task, {
				adapterSupportedTools: ['read', 'grep', 'list', 'cat', 'edit', 'write', 'test'],
			}),
		).toThrowError(expect.objectContaining({ code: ADAPTER_CAPABILITY_MISMATCH }));
	});
});

describe('SECURITY_CANARY_DENIED_BY_KERNEL_POLICY', () => {
	it('profile requesting push/merge/deploy/secret cannot escalate', () => {
		const escalating = buildEscalatingProfile({
			push: true,
			merge: true,
			deploy: true,
			secret_access: true,
		});
		const effective = compileBase(escalating);
		expect(effective.effective_permissions).toEqual({
			mutation: true, // kernel erlaubt Mutation; Profil erlaubt Mutation
			push: false,
			merge: false,
			deploy: false,
			secret_access: false,
		});
		// Kernel-Denys gewinnen:
		expect(effective.effective_permissions.secret_access).toBe(false);
	});

	it('kernel policy with push=false blocks profile push request deterministically', () => {
		const effective = compileBase(buildEscalatingProfile({ push: true }));
		expect(effective.effective_permissions.push).toBe(false);
		// Sichtbar statt still: Kernel-Denial ist im Reason Code vermerkt.
		expect(effective.compiler.reason_codes).toContain('DENIED_BY_KERNEL_POLICY:push');
	});

	it('DENIED_BY_KERNEL_POLICY constant is defined and used for kernel denials', () => {
		// Der Compiler wendet die Intersection an; ein Verstoß wird über die
		// effektiven Permissions sichtbar (kernel deny wins). Der Reason Code
		// ist für explizite Prüfpfade reserviert:
		expect(DENIED_BY_KERNEL_POLICY).toBe('DENIED_BY_KERNEL_POLICY');
		const effective = compileBase(buildEscalatingProfile({ secret_access: true }));
		expect(effective.effective_permissions.secret_access).toBe(false);
	});
});
