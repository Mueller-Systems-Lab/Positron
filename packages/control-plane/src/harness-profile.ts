// Positron Control Plane — Harness Profile Identity & Provenance (P5.1)
//
// P5.1 misst und identifiziert die tatsächlich auf einem produktiven
// LLM-Attempt wirksame Harness-Konfiguration — es führt KEIN adaptives
// Routing ein (P5.3) und keinen Profile-Compiler (P5.2).
//
// Vier Ebenen werden unterschieden:
//   A. MODEL ADAPTER   — technische Runtime-/Provider-Kompatibilität
//   B. MODEL PROFILE   — modellbezogene Harness-Konfiguration
//   C. TASK PROFILE    — PLAN / BUILD / RESEARCH / REVIEW …
//   D. EFFECTIVE HARNESS — die auf diesem Attempt tatsächlich wirksame
//                          Kombination; wichtigster Nachweis:
//                          effective_harness_fingerprint (SHA-256)
//
// Grundsätze:
// - Nur Provenienz speichern, die tatsächlich aus Provider / Adapter /
//   OpenCode / Modellruntime / expliziter Konfiguration bekannt ist.
//   Kein Alias als "revision" erfinden → PROVENANCE_UNAVAILABLE ist
//   ehrlicher als erfundene Präzision.
// - Der Fingerprint hashed NUR semantische Konfiguration. Runtime-Werte
//   (run_id, job_id, attempt_id, Timestamps, Duration, Result-Refs, Logs)
//   dürfen ihn nicht verändern.
// - Profil-Metadaten dürfen keine Secrets enthalten (Negative Canary:
//   token-ähnliche Werte werden abgelehnt, nie persistiert).
// - Fail-closed für neue produktive Attempts: UNKNOWN_CONTRACT,
//   UNKNOWN_VERSION, INVALID_PROFILE_REF, INVALID_FINGERPRINT.

import { validateContract } from './contracts.js';
import type { HarnessProfileRefContract, ModelProvenanceStatus } from './contracts.js';
import { fingerprint } from './fingerprint.js';

// ---------------------------------------------------------------------------
// Kanonische Konstanten
// ---------------------------------------------------------------------------

export const HARNESS_PROFILE_REF_CONTRACT = 'positron.harness-profile-ref.v1' as const;

export const PROVENANCE_UNAVAILABLE: ModelProvenanceStatus = 'PROVENANCE_UNAVAILABLE';
export const LEGACY_PROFILE_UNSPECIFIED: ModelProvenanceStatus = 'LEGACY_PROFILE_UNSPECIFIED';
export const PROVENANCE_KNOWN: ModelProvenanceStatus = 'KNOWN';

/** Reason Codes (fail-closed) für ungültige Harness-Referenzen. */
export const UNKNOWN_CONTRACT = 'UNKNOWN_CONTRACT';
export const UNKNOWN_VERSION = 'UNKNOWN_VERSION';
export const INVALID_PROFILE_REF = 'INVALID_PROFILE_REF';
export const INVALID_FINGERPRINT = 'INVALID_FINGERPRINT';

export const MODEL_PROVENANCE_STATUSES: readonly ModelProvenanceStatus[] = [
	'KNOWN',
	'PROVENANCE_UNAVAILABLE',
	'LEGACY_PROFILE_UNSPECIFIED',
];

// ---------------------------------------------------------------------------
// Fingerprint-Semantik
// ---------------------------------------------------------------------------

/**
 * Runtime-Metadaten, die den effektiven Harness-Fingerprint NIE verändern
 * dürfen. Ergänzt die kanonischen RUNTIME_KEYS (timestamps, duration_ms,
 * result_ref, …) um Attempt-/Run-/Job-IDs und volatile Log-/Output-Daten.
 */
export const HARNESS_RUNTIME_EXCLUDE_KEYS: ReadonlySet<string> = new Set([
	'run_id',
	'job_id',
	'attempt_id',
	'runId',
	'jobId',
	'attemptId',
	'created_at',
	'updated_at',
	'started_at',
	'ended_at',
	'timestamp',
	'duration_ms',
	'result_ref',
	'log',
	'logs',
	'output',
	'output_json',
	'output_contract',
	'output_fingerprint',
	'input_contract',
	'input_fingerprint',
]);

/**
 * Berechnet den effektiven Harness-Fingerprint (SHA-256) über die
 * semantische Harness-Konfiguration.
 *
 * Stabilitäts-Garantie:
 *   gleiche Semantik → gleicher Hash (EFFECTIVE_HARNESS_FINGERPRINT_STABLE)
 *   semantische Änderung → anderer Hash (SEMANTIC_PROFILE_CHANGE_CHANGES_FINGERPRINT)
 *   Runtime-Metadaten-Änderung → gleicher Hash (RUNTIME_METADATA_IGNORED)
 */
export function computeEffectiveHarnessFingerprint(semantics: Record<string, unknown>): string {
	return fingerprint(semantics, { excludeKeys: HARNESS_RUNTIME_EXCLUDE_KEYS });
}

// ---------------------------------------------------------------------------
// Secret-Detection (Negative Canary — Telemetrie darf keine Secrets tragen)
// ---------------------------------------------------------------------------

/** Kanonische Positron-Secret-Muster (identisch zu apps/server sse/broadcaster.ts). */
export const HARNESS_SECRET_PATTERNS: readonly RegExp[] = [
	/ghp_[A-Za-z0-9]{36}/,
	/gho_[A-Za-z0-9]{36}/,
	/github_pat_[A-Za-z0-9_]{82}/,
	/sk-[A-Za-z0-9]{20,}/,
	/sk-ant-[A-Za-z0-9]{20,}/,
	/AIza[0-9A-Za-z_-]{35}/,
	/Bearer\s+[A-Za-z0-9._\-+/=]{20,}/i,
	/xox[abp]-[A-Za-z0-9]{10,}/,
	/AKIA[0-9A-Z]{16}/,
];

const SECRET_KEY_HINTS = ['token', 'secret', 'password', 'api_key', 'apikey', 'authorization'];

export class HarnessMetadataSecretError extends Error {
	readonly code = 'HARNESS_METADATA_SECRET';
	constructor(detail?: string) {
		super(
			detail
				? `HARNESS_METADATA_SECRET: ${detail}`
				: 'HARNESS_METADATA_SECRET: harness profile metadata must not contain secrets',
		);
		this.name = 'HarnessMetadataSecretError';
	}
}

/**
 * Erkennt token-ähnliche Werte in Harness-Metadaten. Wirft bei Treffer —
 * Profil-Metadaten mit Secret-Mustern dürfen NIE persistiert werden
 * (PROFILE_TELEMETRY_NO_SECRETS).
 */
export function assertNoSecretInHarnessMetadata(values: Record<string, unknown>): void {
	for (const [key, value] of Object.entries(values)) {
		const lowerKey = key.toLowerCase();
		if (SECRET_KEY_HINTS.some((hint) => lowerKey.includes(hint))) {
			throw new HarnessMetadataSecretError(`key '${key}' looks secret-like`);
		}
		if (typeof value === 'string') {
			for (const pattern of HARNESS_SECRET_PATTERNS) {
				if (pattern.test(value)) {
					throw new HarnessMetadataSecretError(`value of '${key}' matches secret pattern`);
				}
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Validator (fail-closed)
// ---------------------------------------------------------------------------

export interface HarnessProfileValidationResult {
	ok: boolean;
	reasonCode: string | null;
	errors: string[];
}

function toReasonCode(errors: string[]): string {
	for (const error of errors) {
		if (error.startsWith('UNKNOWN_CONTRACT')) return UNKNOWN_CONTRACT;
		if (error.startsWith('UNKNOWN_VERSION')) return UNKNOWN_VERSION;
		if (error.startsWith('INVALID_FINGERPRINT')) return INVALID_FINGERPRINT;
		if (error.startsWith('INVALID_PROFILE_REF')) return INVALID_PROFILE_REF;
	}
	return INVALID_PROFILE_REF;
}

/**
 * Deterministische, fail-closed Validierung einer Harness-Referenz:
 * - unbekannter Contract → UNKNOWN_CONTRACT
 * - unbekannte Version  → UNKNOWN_VERSION
 * - fehlende/leere Profil-IDs oder falsche Typen → INVALID_PROFILE_REF
 * - Fingerprint entspricht nicht dem Hash der Semantik → INVALID_FINGERPRINT
 */
export function validateHarnessProfileRef(doc: unknown): HarnessProfileValidationResult {
	// Fail-closed vor der Registry-Validierung: Das Dokument muss explizit
	// den kanonischen Contract tragen — sonst UNKNOWN_CONTRACT.
	if (
		typeof doc !== 'object' ||
		doc === null ||
		(doc as { contract?: unknown }).contract !== HARNESS_PROFILE_REF_CONTRACT
	) {
		return {
			ok: false,
			reasonCode: UNKNOWN_CONTRACT,
			errors: [`UNKNOWN_CONTRACT: expected ${HARNESS_PROFILE_REF_CONTRACT}`],
		};
	}

	const result = validateContract(HARNESS_PROFILE_REF_CONTRACT, doc, 1);
	if (!result.ok) {
		return { ok: false, reasonCode: toReasonCode(result.errors), errors: result.errors };
	}

	const ref = doc as HarnessProfileRefContract;

	// Fingerprint-Integrität: Der persistierte Fingerprint MUSS der Hash der
	// tatsächlich gehashten Semantik sein (kein erfundener Fingerprint).
	const expected = computeEffectiveHarnessFingerprint(ref.semantics);
	if (ref.effective_harness_fingerprint !== expected) {
		return {
			ok: false,
			reasonCode: INVALID_FINGERPRINT,
			errors: ['INVALID_FINGERPRINT: effective_harness_fingerprint does not match semantics hash'],
		};
	}

	// Provenance-Konsistenz: KNOWN erfordert provider + model.
	if (ref.model_provenance_status === 'KNOWN' && (!ref.provider || !ref.model)) {
		return {
			ok: false,
			reasonCode: INVALID_PROFILE_REF,
			errors: ['INVALID_PROFILE_REF: model_provenance_status=KNOWN requires provider and model'],
		};
	}

	// Provenance-Konsistenz: KNOWN erfordert provider + model.
	if (ref.model_provenance_status === 'KNOWN' && (!ref.provider || !ref.model)) {
		return {
			ok: false,
			reasonCode: INVALID_PROFILE_REF,
			errors: ['INVALID_PROFILE_REF: model_provenance_status=KNOWN requires provider and model'],
		};
	}

	return { ok: true, reasonCode: null, errors: [] };
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface HarnessProfileRefInput {
	harness_profile_id: string;
	harness_profile_version: string;
	task_profile_id: string;
	task_profile_version: string;
	task_type: string;
	provider: string | null;
	model: string | null;
	model_provenance_status: ModelProvenanceStatus;
	provider_adapter_id?: string | null;
	provider_adapter_version?: string | null;
	/** Semantische Harness-Konfiguration (wird gehasht). */
	semantics: Record<string, unknown>;
}

export class HarnessProfileValidationError extends Error {
	readonly code: string;
	constructor(reasonCode: string, detail?: string) {
		super(detail ? `${reasonCode}: ${detail}` : reasonCode);
		this.name = 'HarnessProfileValidationError';
		this.code = reasonCode;
	}
}

/**
 * Baut eine validierte Harness-Referenz (fail-closed):
 * 1. Secret-Detection über alle Metadaten (Negative Canary)
 * 2. Fingerprint-Berechnung über die Semantik
 * 3. Contract-Validierung (Typen, Pflichtfelder, Provenance-Konsistenz)
 * Wirft `HarnessProfileValidationError` mit Reason Code bei Verletzung.
 */
export function buildHarnessProfileRef(input: HarnessProfileRefInput): HarnessProfileRefContract {
	const metadata: Record<string, unknown> = {
		harness_profile_id: input.harness_profile_id,
		harness_profile_version: input.harness_profile_version,
		task_profile_id: input.task_profile_id,
		task_profile_version: input.task_profile_version,
		task_type: input.task_type,
		provider: input.provider,
		model: input.model,
		provider_adapter_id: input.provider_adapter_id,
		provider_adapter_version: input.provider_adapter_version,
	};
	assertNoSecretInHarnessMetadata(metadata);
	assertNoSecretInHarnessMetadata(input.semantics);

	const ref: HarnessProfileRefContract = {
		contract: HARNESS_PROFILE_REF_CONTRACT,
		harness_profile_id: input.harness_profile_id,
		harness_profile_version: input.harness_profile_version,
		task_profile_id: input.task_profile_id,
		task_profile_version: input.task_profile_version,
		task_type: input.task_type,
		provider: input.provider ?? null,
		model: input.model ?? null,
		model_provenance_status: input.model_provenance_status,
		provider_adapter_id: input.provider_adapter_id ?? null,
		provider_adapter_version: input.provider_adapter_version ?? null,
		effective_harness_fingerprint: computeEffectiveHarnessFingerprint(input.semantics),
		semantics: input.semantics,
	};

	const validation = validateHarnessProfileRef(ref);
	if (!validation.ok) {
		throw new HarnessProfileValidationError(
			validation.reasonCode ?? INVALID_PROFILE_REF,
			validation.errors.join('; '),
		);
	}
	return ref;
}

// ---------------------------------------------------------------------------
// Legacy-Erkennung (Historical Compatibility)
// ---------------------------------------------------------------------------

/**
 * True, wenn ein Attempt aus der Zeit VOR P5.1 stammt (alle P5.1-Felder
 * NULL/unset). Historische Attempts bleiben lesbar und werden als
 * LEGACY_PROFILE_UNSPECIFIED dargestellt — es wird NIE rückwirkend ein
 * Profil erfunden (NO_RETROACTIVE_PROFILE_INVENTION).
 */
export function isLegacyHarnessAttempt(fields: {
	harness_profile_id: string | null;
	harness_fingerprint: string | null;
}): boolean {
	return fields.harness_profile_id === null && fields.harness_fingerprint === null;
}

// ---------------------------------------------------------------------------
// Explizite Konfiguration → Harness-Ref (worker-pipeline, Canary)
// ---------------------------------------------------------------------------

export interface HarnessEnvConfig {
	POSITRON_HARNESS_PROFILE_ID?: string;
	POSITRON_HARNESS_PROFILE_VERSION?: string;
	POSITRON_TASK_PROFILE_ID?: string;
	POSITRON_TASK_PROFILE_VERSION?: string;
	POSITRON_MODEL_ADAPTER_ID?: string;
	POSITRON_MODEL_ADAPTER_VERSION?: string;
	POSITRON_HARNESS_REASONING_MODE?: string;
	POSITRON_HARNESS_TOOL_SURFACE?: string;
	POSITRON_HARNESS_CONTEXT_STRATEGY?: string;
	POSITRON_HARNESS_POLICY_REF?: string;
}

/**
 * Baut die Harness-Referenz aus EXPLIZITER Konfiguration (env) + bereits
 * bekannter Provider-/Modell-/Worker-Information. Es wird nichts erfunden:
 * fehlende IDs → 'unspecified'; fehlende Modell-Provenienz →
 * PROVENANCE_UNAVAILABLE (ehrlich statt erfundener Präzision).
 *
 * Der effektive Harness-Fingerprint wird über die tatsächlich wirksame
 * semantische Konfiguration berechnet (Adapter-Identität/-Version,
 * Modellprofil-Identität/-Version, Taskprofil-Identität/-Version,
 * Provider/Modell, Reasoning-Modus, Tool-Surface, Context-Strategie,
 * Policy-Ref) — ohne Runtime-Metadaten.
 */
export function resolveHarnessProfileFromEnv(
	env: NodeJS.ProcessEnv,
	input: {
		taskType: string;
		workerType: string;
		provider: string | null;
		model: string | null;
	},
): HarnessProfileRefContract {
	const config: HarnessEnvConfig = env as HarnessEnvConfig;

	const provider = input.provider ?? null;
	const model = input.model ?? null;
	const provenance: ModelProvenanceStatus =
		provider && model ? PROVENANCE_KNOWN : PROVENANCE_UNAVAILABLE;

	const taskProfileId = config.POSITRON_TASK_PROFILE_ID ?? input.taskType;
	const semantics: Record<string, unknown> = {
		model_adapter: {
			id: config.POSITRON_MODEL_ADAPTER_ID ?? null,
			version: config.POSITRON_MODEL_ADAPTER_VERSION ?? null,
		},
		model_profile: {
			id: config.POSITRON_HARNESS_PROFILE_ID ?? 'unspecified',
			version: config.POSITRON_HARNESS_PROFILE_VERSION ?? 'unspecified',
		},
		task_profile: {
			id: taskProfileId,
			version: config.POSITRON_TASK_PROFILE_VERSION ?? 'unspecified',
		},
		provider,
		model,
		worker_type: input.workerType,
		task_type: input.taskType,
		reasoning_mode: config.POSITRON_HARNESS_REASONING_MODE ?? null,
		tool_surface: config.POSITRON_HARNESS_TOOL_SURFACE ?? null,
		context_strategy: config.POSITRON_HARNESS_CONTEXT_STRATEGY ?? null,
		policy_ref: config.POSITRON_HARNESS_POLICY_REF ?? null,
	};

	return buildHarnessProfileRef({
		harness_profile_id: config.POSITRON_HARNESS_PROFILE_ID ?? 'unspecified',
		harness_profile_version: config.POSITRON_HARNESS_PROFILE_VERSION ?? 'unspecified',
		task_profile_id: taskProfileId,
		task_profile_version: config.POSITRON_TASK_PROFILE_VERSION ?? 'unspecified',
		task_type: input.taskType,
		provider,
		model,
		model_provenance_status: provenance,
		provider_adapter_id: config.POSITRON_MODEL_ADAPTER_ID ?? null,
		provider_adapter_version: config.POSITRON_MODEL_ADAPTER_VERSION ?? null,
		semantics,
	});
}
