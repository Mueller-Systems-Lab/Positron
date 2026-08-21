// Positron Control Plane — Profile Compiler (P5.2)
//
// Deterministischer, pure Profile Compiler: übersetzt versionierte,
// typed Model Profiles und Task Profiles in eine sichere, reproduzierbare
// Effective Runtime Configuration für genau EINEN Worker-Attempt.
//
//   Model Profile + Task Profile + Kernel Policy + Run Context
//     → validate all inputs
//     → intersect permissions (kernel ∩ profile, NIE union/override)
//     → reject unknown/incompatible data (fail-closed)
//     → canonicalize
//     → fingerprint
//     → effective runtime config
//
// Kern-Invarianten:
// - effective_permissions = kernel_permissions ∩ profile_permissions
//   → Profile können die Kernel-Policy NIE erweitern (KERNEL_DENY_WINS)
// - Kein verstecktes Date.now(), keine externen Nebenwirkungen (pur)
// - Worker-/OpenCode-Adapter erhalten NUR kompilierte, allowlisted Felder
// - Kein blindes Durchreichen beliebiger JSON an OpenCode
//
// Reason Codes (fail-closed):
//   UNKNOWN_PROFILE_DENIED        — unbekannte Profil-ID
//   UNKNOWN_PROFILE_VERSION       — unbekannte Profil-Version
//   PROFILE_INVALID               — typed Contract verletzt
//   TOOL_NOT_ALLOWED              — Tool außerhalb Kernel∩Profil
//   PROFILE_INCOMPATIBLE          — Context/Tool/Capability-Mismatch
//   DENIED_BY_KERNEL_POLICY       — angefragte Permission über Kernel
//   ADAPTER_CAPABILITY_MISMATCH   — Adapter kann Setting nicht honorieren
//
// P5.2 führt KEIN Routing (P5.3) und KEINE Evolution/Promotion (P5.4) ein.

import { KERNEL_DEFAULT_PERMISSIONS, validateContract } from './contracts.js';
import type {
	EffectiveHarnessContract,
	KernelPermissions,
	ModelProfileContract,
	TaskProfileContract,
} from './contracts.js';
import { fingerprint } from './fingerprint.js';
import { assertNoSecretInHarnessMetadata } from './harness-profile.js';

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

export const PROFILE_COMPILER_VERSION = '1.0.0';
export const KERNEL_POLICY_REF = 'positron.runtime-policy.v1';

export const UNKNOWN_PROFILE_DENIED = 'UNKNOWN_PROFILE_DENIED';
export const UNKNOWN_PROFILE_VERSION = 'UNKNOWN_PROFILE_VERSION';
export const PROFILE_INVALID = 'PROFILE_INVALID';
export const TOOL_NOT_ALLOWED = 'TOOL_NOT_ALLOWED';
export const PROFILE_INCOMPATIBLE = 'PROFILE_INCOMPATIBLE';
export const DENIED_BY_KERNEL_POLICY = 'DENIED_BY_KERNEL_POLICY';
export const ADAPTER_CAPABILITY_MISMATCH = 'ADAPTER_CAPABILITY_MISMATCH';

export class ProfileCompilationError extends Error {
	readonly code: string;
	constructor(reasonCode: string, detail?: string) {
		super(detail ? `${reasonCode}: ${detail}` : reasonCode);
		this.name = 'ProfileCompilationError';
		this.code = reasonCode;
	}
}

// ---------------------------------------------------------------------------
// Fingerprint-Semantik (Profile)
// ---------------------------------------------------------------------------

/** Runtime-Werte, die Profil-Fingerprints NIE verändern dürfen. */
const PROFILE_RUNTIME_EXCLUDE_KEYS: ReadonlySet<string> = new Set([
	'run_id',
	'job_id',
	'attempt_id',
	'created_at',
	'updated_at',
	'timestamp',
	'duration_ms',
	'result_ref',
]);

/**
 * Deterministischer Profil-Fingerprint über die semantische Profil-
 * Konfiguration (ohne Runtime-Werte). Gleiche Semantik → gleicher Hash.
 */
export function computeProfileFingerprint(profile: Record<string, unknown>): string {
	return fingerprint(profile, { excludeKeys: PROFILE_RUNTIME_EXCLUDE_KEYS });
}

// ---------------------------------------------------------------------------
// Validatoren (fail-closed)
// ---------------------------------------------------------------------------

export function validateModelProfile(doc: unknown): { ok: boolean; errors: string[] } {
	const result = validateContract('positron.model-profile.v1', doc, 1);
	if (!result.ok) return { ok: false, errors: result.errors };
	const profile = doc as ModelProfileContract;
	const expected = computeProfileFingerprint(modelProfileSemantics(profile));
	if (profile.fingerprint !== expected) {
		return { ok: false, errors: ['PROFILE_INVALID: fingerprint does not match profile semantics'] };
	}
	return { ok: true, errors: [] };
}

export function validateTaskProfile(doc: unknown): { ok: boolean; errors: string[] } {
	const result = validateContract('positron.task-profile.v1', doc, 1);
	if (!result.ok) return { ok: false, errors: result.errors };
	const profile = doc as TaskProfileContract;
	const expected = computeProfileFingerprint(taskProfileSemantics(profile));
	if (profile.fingerprint !== expected) {
		return { ok: false, errors: ['PROFILE_INVALID: fingerprint does not match profile semantics'] };
	}
	return { ok: true, errors: [] };
}

/** Semantische Konfiguration eines Model-Profils (wird gehasht). */
export function modelProfileSemantics(profile: ModelProfileContract): Record<string, unknown> {
	return {
		model_profile_id: profile.model_profile_id,
		model_profile_version: profile.model_profile_version,
		provider: profile.provider,
		model: profile.model,
		provenance_status: profile.provenance.status,
		provenance_revision: profile.provenance.revision,
		capabilities: profile.capabilities,
		context_limits: profile.context_limits,
		reasoning_modes: profile.reasoning_modes,
		supported_tools: profile.supported_tools,
		provider_specific: profile.provider_specific,
	};
}

/** Semantische Konfiguration eines Task-Profils (wird gehasht). */
export function taskProfileSemantics(profile: TaskProfileContract): Record<string, unknown> {
	return {
		task_profile_id: profile.task_profile_id,
		task_profile_version: profile.task_profile_version,
		task_type: profile.task_type,
		allowed_tools: profile.allowed_tools,
		context_strategy: profile.context_strategy,
		reasoning_policy: profile.reasoning_policy,
		max_steps: profile.max_steps,
		timeout_ms: profile.timeout_ms,
		retry_hints: profile.retry_hints,
		output_requirements: profile.output_requirements,
		permissions: profile.permissions,
	};
}

// ---------------------------------------------------------------------------
// Permissions-Intersection
// ---------------------------------------------------------------------------

/**
 * Schnittmenge zweier Permission-Sets. `true` nur, wenn BEIDE true sind.
 * Profile können damit niemals Kernel-Policy erweitern.
 */
export function intersectPermissions(
	kernel: KernelPermissions,
	profile: KernelPermissions,
): KernelPermissions {
	return {
		mutation: kernel.mutation && profile.mutation,
		push: kernel.push && profile.push,
		merge: kernel.merge && profile.merge,
		deploy: kernel.deploy && profile.deploy,
		secret_access: kernel.secret_access && profile.secret_access,
	};
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export interface ProfileCompileInput {
	modelProfile: ModelProfileContract;
	taskProfile: TaskProfileContract;
	kernelPermissions: KernelPermissions;
	kernelPolicyRef?: string;
	kernelPolicyFingerprint?: string;
	runContextFingerprint: string;
	/** Vom Adapter tatsächlich unterstützte Tools (Allowlist-Basis) */
	adapterSupportedTools?: string[];
	/** Vom Adapter tatsächlich unterstützte Reasoning-Modi */
	adapterSupportedReasoningModes?: string[];
}

/**
 * Deterministische Kompilierung der Effective Runtime Configuration.
 * Fail-closed: unbekannte Profile/Versionen, invalide Contracts, nicht
 * erlaubte Tools, inkompatible Settings und Permission-Überziehungen werden
 * mit Reason Code abgelehnt (kein silent downgrade).
 */
export function compileEffectiveHarness(input: ProfileCompileInput): EffectiveHarnessContract {
	const model = input.modelProfile;
	const task = input.taskProfile;

	// 1. Contract-Validierung (fail-closed)
	const modelValid = validateModelProfile(model);
	if (!modelValid.ok) {
		throw new ProfileCompilationError(PROFILE_INVALID, modelValid.errors.join('; '));
	}
	const taskValid = validateTaskProfile(task);
	if (!taskValid.ok) {
		throw new ProfileCompilationError(PROFILE_INVALID, taskValid.errors.join('; '));
	}

	// 1b. Secret-Detection (Defense-in-Depth, unabhängig von der P5.1-
	//     Aufruf-Reihenfolge): Profile-Metadaten dürfen keine Secrets
	//     tragen — auch nicht in provider_specific/context_strategy.
	assertNoSecretInHarnessMetadata(model.provider_specific);
	assertNoSecretInHarnessMetadata({
		context_strategy: task.context_strategy,
		reasoning_policy: task.reasoning_policy,
		model_profile_id: model.model_profile_id,
		task_profile_id: task.task_profile_id,
	});

	// 2. Permission-Intersection (Kernel ∩ Profil). Eine Profil-Permission,
	//    die über die Kernel-Policy hinausgeht (profil=true, kernel=false),
	//    wird sichtbar als DENIED_BY_KERNEL_POLICY vermerkt — kein stiller
	//    Override, keine Union.
	const effectivePermissions = intersectPermissions(input.kernelPermissions, task.permissions);
	const reasonCodes: string[] = [];
	for (const key of ['push', 'merge', 'deploy', 'secret_access', 'mutation'] as const) {
		if (task.permissions[key] === true && input.kernelPermissions[key] === false) {
			reasonCodes.push(`${DENIED_BY_KERNEL_POLICY}:${key}`);
		}
	}

	// 3. Tool-Intersection: wirksam = Profil-Allowlist ∩ Model-Profil-
	//    supported_tools ∩ Adapter-Support. Ein Tool, das das Model-Profil
	//    nicht unterstützt → TOOL_NOT_ALLOWED; ein Tool, das der Adapter
	//    nicht unterstützt → ADAPTER_CAPABILITY_MISMATCH. Kein stiller
	//    Downgrade.
	const adapterTools = new Set(input.adapterSupportedTools ?? []);
	const requestedTools = task.allowed_tools ?? [];
	const modelSupported = new Set(model.supported_tools ?? []);
	const effectiveTools = requestedTools.filter((t) => adapterTools.has(t) && modelSupported.has(t));
	if (effectiveTools.length !== requestedTools.length) {
		const missingAdapter = requestedTools.filter((t) => !adapterTools.has(t));
		if (missingAdapter.length > 0) {
			throw new ProfileCompilationError(
				ADAPTER_CAPABILITY_MISMATCH,
				`adapter does not support tools: ${missingAdapter.join(', ')}`,
			);
		}
		const missingModel = requestedTools.filter((t) => !modelSupported.has(t));
		if (missingModel.length > 0) {
			throw new ProfileCompilationError(
				TOOL_NOT_ALLOWED,
				`model profile does not support tools: ${missingModel.join(', ')}`,
			);
		}
	}

	// 4. Reasoning-Modus: Task-Policy muss vom Model-Profil unterstützt sein.
	const modelReasoningModes = model.reasoning_modes ?? [];
	if (modelReasoningModes.length > 0 && !modelReasoningModes.includes(task.reasoning_policy)) {
		throw new ProfileCompilationError(
			PROFILE_INCOMPATIBLE,
			`reasoning_policy '${task.reasoning_policy}' not supported by model profile`,
		);
	}
	if (
		input.adapterSupportedReasoningModes &&
		input.adapterSupportedReasoningModes.length > 0 &&
		!input.adapterSupportedReasoningModes.includes(task.reasoning_policy)
	) {
		throw new ProfileCompilationError(
			ADAPTER_CAPABILITY_MISMATCH,
			`adapter does not support reasoning mode '${task.reasoning_policy}'`,
		);
	}

	// 4. Reasoning-Modus: Task-Policy muss vom Model-Profil unterstützt sein.
	if (model.reasoning_modes.length > 0 && !model.reasoning_modes.includes(task.reasoning_policy)) {
		throw new ProfileCompilationError(
			PROFILE_INCOMPATIBLE,
			`reasoning_policy '${task.reasoning_policy}' not supported by model profile`,
		);
	}
	if (
		input.adapterSupportedReasoningModes &&
		input.adapterSupportedReasoningModes.length > 0 &&
		!input.adapterSupportedReasoningModes.includes(task.reasoning_policy)
	) {
		throw new ProfileCompilationError(
			ADAPTER_CAPABILITY_MISMATCH,
			`adapter does not support reasoning mode '${task.reasoning_policy}'`,
		);
	}

	// 5. Timeout/Steps: positive, finite Werte
	if (!Number.isFinite(task.timeout_ms) || task.timeout_ms <= 0) {
		throw new ProfileCompilationError(PROFILE_INVALID, 'timeout_ms must be positive');
	}
	if (!Number.isFinite(task.max_steps) || task.max_steps <= 0) {
		throw new ProfileCompilationError(PROFILE_INVALID, 'max_steps must be positive');
	}

	// 6. Effective Config bauen (kanonische Form; fingerprint wird in
	//    Schritt 7 über die kanonische Semantik berechnet)
	const doc: EffectiveHarnessContract = {
		contract: 'positron.effective-harness.v1',
		model_profile_ref: {
			id: model.model_profile_id,
			version: model.model_profile_version,
			fingerprint: model.fingerprint,
		},
		task_profile_ref: {
			id: task.task_profile_id,
			version: task.task_profile_version,
			fingerprint: task.fingerprint,
		},
		kernel_policy_ref: input.kernelPolicyRef ?? KERNEL_POLICY_REF,
		kernel_policy_fingerprint:
			input.kernelPolicyFingerprint ??
			computeProfileFingerprint({
				policy_ref: input.kernelPolicyRef ?? KERNEL_POLICY_REF,
				permissions: input.kernelPermissions,
			}),
		effective_permissions: effectivePermissions,
		effective_context_strategy: task.context_strategy,
		effective_reasoning_mode: task.reasoning_policy,
		effective_tools: effectiveTools,
		effective_timeout_ms: task.timeout_ms,
		effective_max_steps: task.max_steps,
		run_context_fingerprint: input.runContextFingerprint,
		compiler: { version: PROFILE_COMPILER_VERSION, reason_codes: reasonCodes },
		fingerprint: '',
	};

	// 7. Reproduzierbarer Fingerprint der Effective Config (ohne Runtime)
	const effectiveSemantics = {
		model_profile_ref: doc.model_profile_ref,
		task_profile_ref: doc.task_profile_ref,
		kernel_policy_ref: doc.kernel_policy_ref,
		kernel_policy_fingerprint: doc.kernel_policy_fingerprint,
		effective_permissions: doc.effective_permissions,
		effective_context_strategy: doc.effective_context_strategy,
		effective_reasoning_mode: doc.effective_reasoning_mode,
		effective_tools: doc.effective_tools,
		effective_timeout_ms: doc.effective_timeout_ms,
		effective_max_steps: doc.effective_max_steps,
		compiler_version: doc.compiler.version,
	};
	doc.fingerprint = computeProfileFingerprint(effectiveSemantics);

	// 8. Validierung des Ergebnisses (fail-closed, kein bypass)
	const result = validateContract('positron.effective-harness.v1', doc, 1);
	if (!result.ok) {
		throw new ProfileCompilationError(PROFILE_INVALID, result.errors.join('; '));
	}
	return doc;
}

// ---------------------------------------------------------------------------
// Basis-Profile (PLAN / BUILD / RESEARCH / REVIEW — Kernel-konform)
// ---------------------------------------------------------------------------

/** Basis-Task-Profile, konstruiert mit Kernel-konformen Defaults. */
export function buildTaskProfile(input: {
	task_profile_id: string;
	task_profile_version: string;
	task_type: TaskProfileContract['task_type'];
	allowed_tools: string[];
	context_strategy: string;
	reasoning_policy: string;
	max_steps: number;
	timeout_ms: number;
	retry_hints?: { max_attempts: number | null };
	output_requirements?: string[];
	permissions: KernelPermissions;
}): TaskProfileContract {
	const profile: TaskProfileContract = {
		contract: 'positron.task-profile.v1',
		task_profile_id: input.task_profile_id,
		task_profile_version: input.task_profile_version,
		task_type: input.task_type,
		allowed_tools: input.allowed_tools,
		context_strategy: input.context_strategy,
		reasoning_policy: input.reasoning_policy,
		max_steps: input.max_steps,
		timeout_ms: input.timeout_ms,
		retry_hints: input.retry_hints ?? { max_attempts: null },
		output_requirements: input.output_requirements ?? [],
		permissions: input.permissions,
		fingerprint: '',
	};
	profile.fingerprint = computeProfileFingerprint(taskProfileSemantics(profile));
	return profile;
}

/** PLan-Basisprofil: read-only (keine Mutation). */
export const PLAN_TASK_PROFILE: TaskProfileContract = buildTaskProfile({
	task_profile_id: 'plan',
	task_profile_version: '1.0.0',
	task_type: 'PLAN',
	allowed_tools: ['read', 'grep', 'list', 'cat'],
	context_strategy: 'full',
	reasoning_policy: 'deep',
	max_steps: 1,
	timeout_ms: 300_000,
	permissions: { mutation: false, push: false, merge: false, deploy: false, secret_access: false },
});

/** BUILD-Basisprofil: Mutation nur innerhalb der Kernel-Grenze. */
export const BUILD_TASK_PROFILE: TaskProfileContract = buildTaskProfile({
	task_profile_id: 'build',
	task_profile_version: '1.0.0',
	task_type: 'BUILD',
	allowed_tools: ['read', 'grep', 'list', 'cat', 'edit', 'write', 'test'],
	context_strategy: 'compact',
	reasoning_policy: 'fast',
	max_steps: 5,
	timeout_ms: 600_000,
	permissions: { mutation: true, push: false, merge: false, deploy: false, secret_access: false },
});

/** RESEARCH-Basisprofil: Tool-Subset, keine Workspace-Mutation. */
export const RESEARCH_TASK_PROFILE: TaskProfileContract = buildTaskProfile({
	task_profile_id: 'research',
	task_profile_version: '1.0.0',
	task_type: 'RESEARCH',
	allowed_tools: ['read', 'grep', 'list', 'cat', 'search'],
	context_strategy: 'full',
	reasoning_policy: 'deep',
	max_steps: 3,
	timeout_ms: 600_000,
	permissions: { mutation: false, push: false, merge: false, deploy: false, secret_access: false },
});

/** REVIEW-Basisprofil: read-only. */
export const REVIEW_TASK_PROFILE: TaskProfileContract = buildTaskProfile({
	task_profile_id: 'review',
	task_profile_version: '1.0.0',
	task_type: 'REVIEW',
	allowed_tools: ['read', 'grep', 'list', 'cat', 'diff'],
	context_strategy: 'full',
	reasoning_policy: 'deep',
	max_steps: 1,
	timeout_ms: 300_000,
	permissions: { mutation: false, push: false, merge: false, deploy: false, secret_access: false },
});

/** Registry der kanonischen Basis-Task-Profile (für Tests/Canaries). */
export const DEFAULT_TASK_PROFILES: Record<TaskProfileContract['task_type'], TaskProfileContract> =
	{
		PLAN: PLAN_TASK_PROFILE,
		BUILD: BUILD_TASK_PROFILE,
		RESEARCH: RESEARCH_TASK_PROFILE,
		REVIEW: REVIEW_TASK_PROFILE,
	};

// ---------------------------------------------------------------------------
// Env-Anbindung (produktiver Pfad, P5.1-kompatibel)
// ---------------------------------------------------------------------------

/**
 * Read-only-Default-Profil für nicht-kanonische Task-Typen (baseline,
 * verify, specify, tasks, analyze, decide). Fail-closed: UNBEKANNTE
 * Task-Typen erhalten NIEMALS Mutation — deny-by-default statt des
 * permissivsten Profils (kein stiller Fallback auf BUILD).
 */
export const READONLY_TASK_PROFILE: TaskProfileContract = buildTaskProfile({
	task_profile_id: 'readonly',
	task_profile_version: '1.0.0',
	task_type: 'REVIEW',
	allowed_tools: ['read', 'grep', 'list', 'cat'],
	context_strategy: 'full',
	reasoning_policy: 'deep',
	max_steps: 1,
	timeout_ms: 300_000,
	permissions: { mutation: false, push: false, merge: false, deploy: false, secret_access: false },
});

/**
 * Kompiliert die Effective Runtime Configuration aus EXPLIZITER
 * Konfiguration (env) + bekannter Provider-/Modell-/Worker-Information.
 *
 * - Task-Profil: `POSITRON_TASK_PROFILE_ID`-basierte Defaults nach
 *   taskType; NICHT-kanonische Task-Typen (verify/baseline/specify/
 *   tasks/analyze/decide) erhalten das read-only Default-Profil
 *   (mutation=false) — nie BUILD (KERNEL_DENY_WINS, fail-closed).
 * - Model-Profil: aus `POSITRON_HARNESS_PROFILE_ID` + provider/model;
 *   Provenienz nur bei tatsächlicher Kenntnis (KNOWN), sonst
 *   PROVENANCE_UNAVAILABLE — kein erfundener Revision.
 * - Kernel-Policy: KERNEL_DEFAULT_PERMISSIONS (mutation erlaubt,
 *   push/merge/deploy/secret verweigert) — Profile können nie eskalieren.
 * - Adapter-Tools: Schnittmenge aus Profil-Allowlist, Model-Profil-
 *   supported_tools und Adapter-Support.
 *
 * Fail-closed: ungültige Kombinationen werfen ProfileCompilationError mit
 * Reason Code (kein silent downgrade, kein Freiform-Passthrough).
 *
 * HINWEIS (P5.2-Scope): Die kompilierte Effective Config wird atomar am
 * Attempt persistiert (Telemetrie + reproduzierbare Referenz). Das
 * ENFORCEMENT der effektiven Permissions/Tools am Worker ist P5.3
 * (Routing) vorbehalten — P5.2 führt keine Runtime-Änderung ein.
 */
export function resolveEffectiveHarnessFromEnv(
	env: NodeJS.ProcessEnv,
	input: {
		taskType: string;
		workerType: string;
		provider: string | null;
		model: string | null;
	},
): EffectiveHarnessContract {
	const upper = input.taskType.toUpperCase();
	const taskProfile =
		(upper === 'PLAN' && DEFAULT_TASK_PROFILES.PLAN) ||
		(upper === 'BUILD' && DEFAULT_TASK_PROFILES.BUILD) ||
		(upper === 'RESEARCH' && DEFAULT_TASK_PROFILES.RESEARCH) ||
		(upper === 'REVIEW' && DEFAULT_TASK_PROFILES.REVIEW) ||
		// Fail-closed: nicht-kanonische Task-Typen → read-only Default.
		READONLY_TASK_PROFILE;

	const provider = input.provider ?? null;
	const model = input.model ?? null;
	const modelProfile: ModelProfileContract = {
		contract: 'positron.model-profile.v1',
		model_profile_id: env.POSITRON_HARNESS_PROFILE_ID ?? 'unspecified',
		model_profile_version: env.POSITRON_HARNESS_PROFILE_VERSION ?? 'unspecified',
		provider: provider ?? 'unspecified',
		model: model ?? 'unspecified',
		provenance: {
			status: provider && model ? 'KNOWN' : 'PROVENANCE_UNAVAILABLE',
			revision: null, // kein erfundener Revision
		},
		capabilities: ['code', 'reasoning'],
		context_limits: { max_input_tokens: null, max_output_tokens: null },
		reasoning_modes: ['fast', 'deep'],
		supported_tools: ['read', 'grep', 'list', 'cat', 'edit', 'write', 'test', 'diff', 'search'],
		provider_specific: {},
		fingerprint: '',
	};
	modelProfile.fingerprint = computeProfileFingerprint(modelProfileSemantics(modelProfile));

	// Task-Profil aus expliziter Konfiguration ableiten (versioniert):
	const configuredTaskProfile = buildTaskProfile({
		task_profile_id: env.POSITRON_TASK_PROFILE_ID ?? taskProfile.task_profile_id,
		task_profile_version: env.POSITRON_TASK_PROFILE_VERSION ?? taskProfile.task_profile_version,
		task_type: taskProfile.task_type,
		allowed_tools: taskProfile.allowed_tools,
		context_strategy: env.POSITRON_HARNESS_CONTEXT_STRATEGY ?? taskProfile.context_strategy,
		reasoning_policy: env.POSITRON_HARNESS_REASONING_MODE ?? taskProfile.reasoning_policy,
		max_steps: taskProfile.max_steps,
		timeout_ms: taskProfile.timeout_ms,
		permissions: taskProfile.permissions,
	});

	const runContextFingerprint = computeProfileFingerprint({
		worker_type: input.workerType,
		task_type: input.taskType,
	});

	return compileEffectiveHarness({
		modelProfile,
		taskProfile: configuredTaskProfile,
		kernelPermissions: KERNEL_DEFAULT_PERMISSIONS,
		runContextFingerprint,
		adapterSupportedTools: taskProfile.allowed_tools,
		adapterSupportedReasoningModes: modelProfile.reasoning_modes,
	});
}

// ---------------------------------------------------------------------------
// Registry-Lookup (fail-closed)
// ---------------------------------------------------------------------------

/**
 * Deterministisches Registry-Lookup für versionierte Profile. Unbekannte
 * IDs → UNKNOWN_PROFILE_DENIED; unbekannte Versionen → UNKNOWN_PROFILE_VERSION
 * (fail-closed, kein Fallback auf andere Profile).
 */
export function resolveProfileFromRegistry<
	T extends { model_profile_id: string } | { task_profile_id: string },
>(
	registry: ReadonlyMap<string, readonly T[]>,
	id: string,
	version: string,
	kind: 'model' | 'task',
): T {
	const versions = registry.get(id);
	if (!versions || versions.length === 0) {
		throw new ProfileCompilationError(UNKNOWN_PROFILE_DENIED, `${kind} profile '${id}' not found`);
	}
	const found = versions.find(
		(p) =>
			(kind === 'model'
				? (p as { model_profile_id: string }).model_profile_id
				: (p as { task_profile_id: string }).task_profile_id) === id &&
			(kind === 'model'
				? (p as unknown as { model_profile_version: string }).model_profile_version
				: (p as unknown as { task_profile_version: string }).task_profile_version) === version,
	);
	if (!found) {
		throw new ProfileCompilationError(
			UNKNOWN_PROFILE_VERSION,
			`${kind} profile '${id}' version '${version}' not found`,
		);
	}
	return found;
}
