// Positron Control Plane — Versionierte Data Contracts
//
// Deterministische, maschinenlesbare Contracts an den wichtigen Runtime-Grenzen.
// Kein LLM entscheidet, ob ein Contract gültig ist — ausschließlich der
// Validator hier. Unbekannte Versionen werden abgelehnt (fail-closed).

// ---------------------------------------------------------------------------
// Contract Registry
// ---------------------------------------------------------------------------

export type ContractId =
	| 'positron.issue.v1'
	| 'positron.baseline.v1'
	| 'positron.research.v1'
	| 'positron.plan.v1'
	| 'positron.build-input.v1'
	| 'positron.build-result.v1'
	| 'positron.verification.v1'
	| 'positron.finding.v1'
	| 'positron.review-batch.v1'
	| 'positron.decision.v1'
	| 'positron.split.v1'
	| 'positron.run-event.v1'
	| 'positron.artifact.v1'
	| 'positron.harness-profile-ref.v1';

export const CONTRACT_IDS: readonly ContractId[] = [
	'positron.issue.v1',
	'positron.baseline.v1',
	'positron.research.v1',
	'positron.plan.v1',
	'positron.build-input.v1',
	'positron.build-result.v1',
	'positron.verification.v1',
	'positron.finding.v1',
	'positron.review-batch.v1',
	'positron.decision.v1',
	'positron.split.v1',
	'positron.run-event.v1',
	'positron.artifact.v1',
	'positron.harness-profile-ref.v1',
];

// ---------------------------------------------------------------------------
// Feld-Constraint-Beschreibung (handgeschriebener JSON-Schema-Subset)
// ---------------------------------------------------------------------------

type FieldType = 'string' | 'number' | 'boolean' | 'string[]' | 'object' | 'any';

export interface FieldConstraint {
	type: FieldType;
	required?: boolean;
	/** Minimale Länge für strings / Minimale Elementzahl für string[] */
	minLength?: number;
	pattern?: RegExp;
	/** Für object: Pflicht-Unterfelder */
	requiredKeys?: string[];
	/** Objekt mit String-Werten */
	stringMap?: boolean;
	/** true → explizites null ist erlaubt (z. B. optionale Provenienz) */
	nullable?: boolean;
	/** Validator-Funktion für komplexe Constraints (deterministisch) */
	validate?: (value: unknown, path: string) => string[];
}

export interface ContractSchema {
	contractId: ContractId;
	version: number;
	/** Feldname → Constraint. 'contract' ist implizit immer Pflicht. */
	fields: Record<string, FieldConstraint>;
	/** Deterministische Zusatzvalidierung über das gesamte Dokument */
	additional?: (doc: Record<string, unknown>) => string[];
}

const CONTRACT_REGISTRY: Record<ContractId, ContractSchema> = {
	'positron.issue.v1': {
		contractId: 'positron.issue.v1',
		version: 1,
		fields: {
			run_id: { type: 'string', required: true, minLength: 1 },
			source_type: { type: 'string', required: true },
			source_ref: { type: 'string', required: true },
			repository_ref: { type: 'string', required: true },
			title: { type: 'string' },
			body_hash: { type: 'string' },
		},
	},
	'positron.baseline.v1': {
		contractId: 'positron.baseline.v1',
		version: 1,
		fields: {
			run_id: { type: 'string', required: true, minLength: 1 },
			repository_ref: { type: 'string', required: true },
			repository_head: { type: 'string', required: true, pattern: /^[0-9a-f]{40}$/ },
			workspace_path: { type: 'string', required: true },
			clean: { type: 'boolean', required: true },
			changed_files: { type: 'string[]' },
		},
	},
	'positron.research.v1': {
		contractId: 'positron.research.v1',
		version: 1,
		fields: {
			run_id: { type: 'string', required: true, minLength: 1 },
			repository_ref: { type: 'string', required: true, minLength: 1 },
			repository_head: { type: 'string', required: true, pattern: /^[0-9a-f]{40}$/ },
			summary_ref: { type: 'string', required: true },
			sources: { type: 'string[]' },
			results: {
				type: 'object',
				required: true,
				requiredKeys: ['code', 'docs', 'tests'],
			},
			parallelism: {
				type: 'object',
				required: true,
				requiredKeys: ['verdict'],
			},
			started_at: { type: 'string', required: true },
			ended_at: { type: 'string', required: true },
			context_fingerprint: { type: 'string', required: true, minLength: 32 },
		},
		additional: (doc) => {
			const errors: string[] = [];
			const results = doc.results as Record<string, unknown> | undefined;
			if (results) {
				for (const key of ['code', 'docs', 'tests'] as const) {
					const entry = results[key];
					if (!entry || typeof entry !== 'object') {
						errors.push(`results.${key} must be an object`);
						continue;
					}
					const e = entry as { status?: unknown; summary_ref?: unknown };
					if (
						e.status !== undefined &&
						![
							'REQUIRED',
							'OPTIONAL',
							'SUCCEEDED',
							'FAILED',
							'TIMEOUT',
							'BLOCKED',
							'SKIPPED',
						].includes(String(e.status))
					) {
						errors.push(`results.${key}.status must be a valid research status`);
					}
					if (e.status !== 'SKIPPED' && typeof e.summary_ref !== 'string') {
						errors.push(`results.${key}.summary_ref must be a string`);
					}
				}
			}
			const parallelism = doc.parallelism as
				| { verdict?: unknown; observed_overlap_ms?: unknown }
				| undefined;
			if (parallelism) {
				if (
					parallelism.verdict !== 'PARALLELISM_PROVEN' &&
					parallelism.verdict !== 'PARALLELISM_NOT_PROVEN'
				) {
					errors.push('parallelism.verdict must be PARALLELISM_PROVEN or PARALLELISM_NOT_PROVEN');
				}
				if (
					parallelism.observed_overlap_ms !== undefined &&
					typeof parallelism.observed_overlap_ms !== 'number'
				) {
					errors.push('parallelism.observed_overlap_ms must be a number (ms)');
				}
			}
			return errors;
		},
	},
	'positron.plan.v1': {
		contractId: 'positron.plan.v1',
		version: 1,
		fields: {
			run_id: { type: 'string', required: true, minLength: 1 },
			repository_ref: { type: 'string', required: true, minLength: 1 },
			repository_head: { type: 'string', required: true, pattern: /^[0-9a-f]{40}$/ },
			targets: { type: 'object', required: true, requiredKeys: ['files', 'symbols'] },
			acceptance_criteria: { type: 'string[]', required: true, minLength: 1 },
			required_tests: { type: 'string[]', required: true, minLength: 1 },
			risks: { type: 'string[]' },
			build_scope: { type: 'object', required: true, requiredKeys: ['allowed_files'] },
			context: { type: 'object', required: true, requiredKeys: ['fingerprint'] },
		},
		additional: (doc) => {
			const errors: string[] = [];
			const buildScope = doc.build_scope as { allowed_files?: unknown } | undefined;
			if (buildScope && !Array.isArray(buildScope.allowed_files)) {
				errors.push('build_scope.allowed_files must be an array');
			} else if (buildScope && Array.isArray(buildScope.allowed_files)) {
				for (const f of buildScope.allowed_files) {
					if (typeof f !== 'string') {
						errors.push('build_scope.allowed_files must contain only strings');
					} else if (f.includes('..')) {
						errors.push(`build_scope.allowed_files must not contain path traversal: ${f}`);
					}
				}
			}
			const targets = doc.targets as { files?: unknown; symbols?: unknown } | undefined;
			if (targets) {
				if (!Array.isArray(targets.files) || !targets.files.every((f) => typeof f === 'string')) {
					errors.push('targets.files must be an array of strings');
				}
				if (
					!Array.isArray(targets.symbols) ||
					!targets.symbols.every((s) => typeof s === 'string')
				) {
					errors.push('targets.symbols must be an array of strings');
				}
				for (const f of Array.isArray(targets.files) ? targets.files : []) {
					if (typeof f === 'string' && f.includes('..')) {
						errors.push(`targets.files must not contain path traversal: ${f}`);
					}
				}
			}
			const ctx = doc.context as { fingerprint?: unknown } | undefined;
			if (ctx && typeof ctx.fingerprint !== 'string') {
				errors.push('context.fingerprint must be a string');
			}
			return errors;
		},
	},
	'positron.build-input.v1': {
		contractId: 'positron.build-input.v1',
		version: 1,
		fields: {
			run_id: { type: 'string', required: true, minLength: 1 },
			job_id: { type: 'string', required: true, minLength: 1 },
			attempt_id: { type: 'string', required: true, minLength: 1 },
			plan_fingerprint: { type: 'string', required: true, minLength: 32 },
			repository_ref: { type: 'string', required: true, minLength: 1 },
			repository_head: { type: 'string', required: true, pattern: /^[0-9a-f]{40}$/ },
			workspace_path: { type: 'string', required: true },
		},
	},
	'positron.build-result.v1': {
		contractId: 'positron.build-result.v1',
		version: 1,
		fields: {
			run_id: { type: 'string', required: true, minLength: 1 },
			job_id: { type: 'string', required: true, minLength: 1 },
			attempt_id: { type: 'string', required: true, minLength: 1 },
			status: {
				type: 'string',
				required: true,
				validate: (value) =>
					['success', 'failed', 'blocked'].includes(String(value))
						? []
						: ['status must be one of: success, failed, blocked'],
			},
			summary: { type: 'string', required: true },
			changed_files: { type: 'string[]' },
			result_ref: { type: 'string' },
		},
	},
	'positron.verification.v1': {
		contractId: 'positron.verification.v1',
		version: 1,
		fields: {
			run_id: { type: 'string', required: true, minLength: 1 },
			job_id: { type: 'string' },
			attempt_id: { type: 'string' },
			passed: { type: 'boolean', required: true },
			checks: {
				type: 'any',
				required: true,
				validate: (value) => {
					if (!Array.isArray(value) || value.length === 0) {
						return ['checks must be a non-empty array'];
					}
					const errors: string[] = [];
					for (const [i, check] of value.entries()) {
						if (typeof check !== 'object' || check === null) {
							errors.push(`checks[${i}] must be an object`);
							continue;
						}
						const c = check as Record<string, unknown>;
						if (typeof c.name !== 'string' || c.name.length === 0) {
							errors.push(`checks[${i}].name is required`);
						}
						if (typeof c.passed !== 'boolean') {
							errors.push(`checks[${i}].passed must be a boolean`);
						}
					}
					return errors;
				},
			},
			failure_class: {
				type: 'string',
				validate: (value) =>
					(FAILURE_CLASSES as readonly string[]).includes(String(value))
						? []
						: [`invalid failure_class: ${String(value)}`],
			},
			failure_signature: { type: 'string' },
			new_evidence: { type: 'string' },
		},
	},
	'positron.finding.v1': {
		contractId: 'positron.finding.v1',
		version: 1,
		fields: {
			category: {
				type: 'string',
				required: true,
				validate: (value) =>
					['correctness', 'security', 'quality'].includes(String(value))
						? []
						: ['category must be one of: correctness, security, quality'],
			},
			severity: {
				type: 'string',
				required: true,
				validate: (value) =>
					['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(value))
						? []
						: ['severity must be one of: INFO, LOW, MEDIUM, HIGH, CRITICAL'],
			},
			confidence: {
				type: 'string',
				required: true,
				validate: (value) =>
					['LOW', 'MEDIUM', 'HIGH'].includes(String(value))
						? []
						: ['confidence must be one of: LOW, MEDIUM, HIGH'],
			},
			blocking: { type: 'boolean', required: true },
			rule: { type: 'string' },
			evidence: {
				type: 'object',
				requiredKeys: ['file', 'symbol', 'line_range'],
				validate: (value) => {
					if (typeof value !== 'object' || value === null) return ['evidence must be an object'];
					const ev = value as Record<string, unknown>;
					const errors: string[] = [];
					if (ev.file !== undefined && typeof ev.file !== 'string') {
						errors.push('evidence.file must be a string');
					}
					if (ev.symbol !== undefined && typeof ev.symbol !== 'string') {
						errors.push('evidence.symbol must be a string');
					}
					if (ev.line_range !== undefined) {
						if (
							!Array.isArray(ev.line_range) ||
							ev.line_range.length !== 2 ||
							!ev.line_range.every((n) => typeof n === 'number')
						) {
							errors.push('evidence.line_range must be a [number, number] tuple');
						}
					}
					return errors;
				},
			},
			recommendation: { type: 'string' },
		},
	},
	'positron.review-batch.v1': {
		contractId: 'positron.review-batch.v1',
		version: 1,
		fields: {
			run_id: { type: 'string', required: true, minLength: 1 },
			job_id: { type: 'string', required: true, minLength: 1 },
			attempt_id: { type: 'string', required: true, minLength: 1 },
			findings: {
				type: 'any',
				required: true,
				validate: (value) => (Array.isArray(value) ? [] : ['findings must be an array']),
			},
		},
	},
	'positron.decision.v1': {
		contractId: 'positron.decision.v1',
		version: 1,
		fields: {
			run_id: { type: 'string', required: true, minLength: 1 },
			decision: {
				type: 'string',
				required: true,
				validate: (value) =>
					['DONE', 'FIX', 'SPLIT', 'BLOCKED'].includes(String(value))
						? []
						: ['decision must be one of: DONE, FIX, SPLIT, BLOCKED'],
			},
			reason_code: { type: 'string', required: true, minLength: 1 },
			basis: { type: 'object' },
		},
	},
	'positron.split.v1': {
		contractId: 'positron.split.v1',
		version: 1,
		fields: {
			parent_run_id: { type: 'string', required: true, minLength: 1 },
			reason: { type: 'string', required: true, minLength: 1 },
			subtasks: {
				type: 'any',
				required: true,
				validate: (value) => {
					if (!Array.isArray(value) || value.length === 0) {
						return ['subtasks must be a non-empty array'];
					}
					const errors: string[] = [];
					for (const [i, sub] of value.entries()) {
						if (typeof sub !== 'object' || sub === null) {
							errors.push(`subtasks[${i}] must be an object`);
							continue;
						}
						const s = sub as Record<string, unknown>;
						if (typeof s.title !== 'string' || s.title.length === 0) {
							errors.push(`subtasks[${i}].title is required`);
						}
						if (!Array.isArray(s.acceptance_criteria) || s.acceptance_criteria.length === 0) {
							errors.push(`subtasks[${i}].acceptance_criteria must be a non-empty array`);
						}
					}
					return errors;
				},
			},
			dependencies: {
				type: 'any',
				validate: (value) => {
					if (value === undefined) return [];
					if (!Array.isArray(value)) return ['dependencies must be an array'];
					for (const [i, dep] of value.entries()) {
						if (!Array.isArray(dep) || !dep.every((d) => typeof d === 'string')) {
							return [`dependencies[${i}] must be an array of strings`];
						}
					}
					return [];
				},
			},
			acceptance_criteria: { type: 'string[]' },
		},
	},
	'positron.run-event.v1': {
		contractId: 'positron.run-event.v1',
		version: 1,
		fields: {
			run_id: { type: 'string', required: true, minLength: 1 },
			job_id: { type: 'string' },
			attempt_id: { type: 'string' },
			timestamp: { type: 'string', required: true, minLength: 1 },
			previous_state: { type: 'string' },
			new_state: { type: 'string', required: true, minLength: 1 },
			reason_code: { type: 'string', required: true, minLength: 1 },
			level: { type: 'string' },
		},
	},
	// Generischer Artefakt-Contract für produktive CLI-/Artefakt-Schritte der
	// Live-Pipeline (specify/tasks/analyze und nicht-strukturierte plan-/
	// research-Artefakte): garantiert, dass auch diese Attempts eine
	// Output-Boundary (output_contract + fingerprint) tragen (§24).
	'positron.artifact.v1': {
		contractId: 'positron.artifact.v1',
		version: 1,
		fields: {
			run_id: { type: 'string', required: true, minLength: 1 },
			kind: { type: 'string', required: true, minLength: 1 },
			phase: { type: 'string', required: true, minLength: 1 },
			size: { type: 'number' },
			content_ref: { type: 'string' },
		},
	},
	// P5.1 — Harness Profile Identity & Provenance. Versionierter, typed
	// Contract für die tatsächlich auf einem Attempt wirksame Harness-
	// Konfiguration. Fail-closed: unbekannte Version / ungültige Profil-Ref /
	// ungültiger Fingerprint werden abgelehnt (UNKNOWN_CONTRACT,
	// UNKNOWN_VERSION, INVALID_PROFILE_REF, INVALID_FINGERPRINT). Die
	// Fingerprint-Integrität (Hash über semantics) prüft der kanonische
	// Validator in harness-profile.ts.
	'positron.harness-profile-ref.v1': {
		contractId: 'positron.harness-profile-ref.v1',
		version: 1,
		fields: {
			harness_profile_id: { type: 'string', required: true, minLength: 1 },
			harness_profile_version: { type: 'string', required: true, minLength: 1 },
			task_profile_id: { type: 'string', required: true, minLength: 1 },
			task_profile_version: { type: 'string', required: true, minLength: 1 },
			task_type: { type: 'string', required: true, minLength: 1 },
			provider: { type: 'string', nullable: true },
			model: { type: 'string', nullable: true },
			model_provenance_status: {
				type: 'string',
				required: true,
				validate: (value) =>
					['KNOWN', 'PROVENANCE_UNAVAILABLE', 'LEGACY_PROFILE_UNSPECIFIED'].includes(String(value))
						? []
						: [
								'model_provenance_status must be one of: KNOWN, PROVENANCE_UNAVAILABLE, LEGACY_PROFILE_UNSPECIFIED',
							],
			},
			provider_adapter_id: { type: 'string', nullable: true },
			provider_adapter_version: { type: 'string', nullable: true },
			effective_harness_fingerprint: {
				type: 'string',
				required: true,
				pattern: /^[0-9a-f]{64}$/,
			},
			semantics: {
				type: 'object',
				required: true,
				validate: (value) => {
					if (typeof value !== 'object' || value === null || Array.isArray(value)) {
						return ['semantics must be a plain object'];
					}
					return [];
				},
			},
		},
	},
};

/** Gibt das Schema für eine Contract-ID zurück oder null bei unbekannter ID. */
export function getContractSchema(contractId: string): ContractSchema | null {
	const schema = CONTRACT_REGISTRY[contractId as ContractId];
	return schema ?? null;
}

export function isKnownContractId(value: string): value is ContractId {
	return (CONTRACT_IDS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Deterministischer Validator
// ---------------------------------------------------------------------------

export interface ContractValidationResult {
	ok: boolean;
	contract: string;
	version: number | null;
	errors: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeMismatch(constraint: FieldConstraint, value: unknown): boolean {
	switch (constraint.type) {
		case 'string':
			return typeof value !== 'string';
		case 'number':
			return typeof value !== 'number';
		case 'boolean':
			return typeof value !== 'boolean';
		case 'string[]':
			return !Array.isArray(value) || !value.every((v) => typeof v === 'string');
		case 'object':
			return !isPlainObject(value);
		default:
			return false;
	}
}

function validateField(
	field: string,
	constraint: FieldConstraint,
	doc: Record<string, unknown>,
): string[] {
	const errors: string[] = [];
	const value = doc[field];

	if (value === undefined) {
		if (constraint.required) {
			errors.push(`${field} is required`);
		}
		return errors;
	}

	if (constraint.nullable && value === null) {
		return errors;
	}

	if (typeMismatch(constraint, value)) {
		errors.push(`${field} must be of type ${constraint.type}`);
		return errors;
	}

	if (
		typeof value === 'string' &&
		constraint.minLength !== undefined &&
		value.length < constraint.minLength
	) {
		errors.push(`${field} must have at least ${constraint.minLength} characters`);
	}
	if (typeof value === 'string' && constraint.pattern && !constraint.pattern.test(value)) {
		errors.push(`${field} does not match pattern ${constraint.pattern}`);
	}
	if (
		Array.isArray(value) &&
		constraint.minLength !== undefined &&
		value.length < constraint.minLength
	) {
		errors.push(`${field} must have at least ${constraint.minLength} entries`);
	}
	if (isPlainObject(value)) {
		for (const key of constraint.requiredKeys ?? []) {
			if (value[key] === undefined) {
				errors.push(`${field}.${key} is required`);
			}
		}
		if (constraint.stringMap) {
			for (const [k, v] of Object.entries(value)) {
				if (typeof v !== 'string') {
					errors.push(`${field}.${k} must be a string`);
				}
			}
		}
	}
	if (constraint.validate) {
		errors.push(...constraint.validate(value, field));
	}
	return errors;
}

/**
 * Deterministische Contract-Validierung. Fail-closed:
 * - Unbekannte Contract-ID → INVALID (UNKNOWN_VERSION)
 * - Unbekannte Version → INVALID
 * - Fehlende Pflichtfelder / Typfehler → INVALID mit Fehlerliste
 */
export function validateContract(
	contractId: string,
	document: unknown,
	version?: number,
): ContractValidationResult {
	const schema = getContractSchema(contractId);
	if (!schema) {
		return {
			ok: false,
			contract: contractId,
			version: null,
			errors: [`UNKNOWN_CONTRACT: ${contractId}`],
		};
	}

	if (version !== undefined && version !== schema.version) {
		return {
			ok: false,
			contract: contractId,
			version: version,
			errors: [
				`UNKNOWN_VERSION: ${contractId} version ${version} is not supported (latest: ${schema.version})`,
			],
		};
	}

	if (!isPlainObject(document)) {
		return {
			ok: false,
			contract: contractId,
			version: schema.version,
			errors: ['document must be a JSON object'],
		};
	}

	const errors: string[] = [];

	if (document.contract !== contractId) {
		errors.push(`contract field must be "${contractId}"`);
	}

	for (const [field, constraint] of Object.entries(schema.fields)) {
		errors.push(...validateField(field, constraint, document));
	}

	if (schema.additional) {
		errors.push(...schema.additional(document));
	}

	return { ok: errors.length === 0, contract: contractId, version: schema.version, errors };
}

// ---------------------------------------------------------------------------
// Typisierte Contract-Dokumente
// ---------------------------------------------------------------------------

export type FailureClass =
	| 'TEST_FAILURE'
	| 'BUILD_FAILURE'
	| 'LINT_FAILURE'
	| 'TYPECHECK_FAILURE'
	| 'CONTRACT_FAILURE'
	| 'CONTEXT_FAILURE'
	| 'PROVIDER_FAILURE'
	| 'INFRA_FAILURE'
	| 'TIMEOUT'
	| 'SECURITY_BLOCK'
	| 'RESEARCH_CODE_FAILURE'
	| 'RESEARCH_DOCS_FAILURE'
	| 'RESEARCH_TESTS_FAILURE'
	| 'UNKNOWN';

export const FAILURE_CLASSES: readonly FailureClass[] = [
	'TEST_FAILURE',
	'BUILD_FAILURE',
	'LINT_FAILURE',
	'TYPECHECK_FAILURE',
	'CONTRACT_FAILURE',
	'CONTEXT_FAILURE',
	'PROVIDER_FAILURE',
	'INFRA_FAILURE',
	'TIMEOUT',
	'SECURITY_BLOCK',
	'RESEARCH_CODE_FAILURE',
	'RESEARCH_DOCS_FAILURE',
	'RESEARCH_TESTS_FAILURE',
	'UNKNOWN',
];

export function isFailureClass(value: string): value is FailureClass {
	return (FAILURE_CLASSES as readonly string[]).includes(value);
}

export type PlanDecision = 'DONE' | 'FIX' | 'SPLIT' | 'BLOCKED';

export const PLAN_DECISIONS: readonly PlanDecision[] = ['DONE', 'FIX', 'SPLIT', 'BLOCKED'];

export type FindingSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type FindingConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type FindingCategory = 'correctness' | 'security' | 'quality';

export type VerificationCheckKind =
	| 'unit'
	| 'integration'
	| 'build'
	| 'lint'
	| 'typecheck'
	| 'schema'
	| 'contract'
	| 'repository'
	| 'other';

export interface VerificationCheck {
	name: string;
	passed: boolean;
	kind: VerificationCheckKind;
	duration_ms: number;
	detail?: string;
}

export interface VerificationContract {
	contract: 'positron.verification.v1';
	run_id: string;
	job_id?: string;
	attempt_id?: string;
	passed: boolean;
	checks: VerificationCheck[];
	failure_class?: FailureClass;
	failure_signature?: string;
	new_evidence?: string;
}

export interface FindingContract {
	contract: 'positron.finding.v1';
	category: FindingCategory;
	severity: FindingSeverity;
	confidence: FindingConfidence;
	blocking: boolean;
	rule?: string;
	evidence: {
		file?: string;
		symbol?: string;
		line_range?: [number, number];
	};
	recommendation?: string;
}

export interface ReviewBatchContract {
	contract: 'positron.review-batch.v1';
	run_id: string;
	job_id: string;
	attempt_id: string;
	findings: FindingContract[];
}

/** Fachlicher Status eines Research-Workers (Barrier-Semantik). */
export type ResearchResultStatus =
	| 'REQUIRED'
	| 'OPTIONAL'
	| 'SUCCEEDED'
	| 'FAILED'
	| 'TIMEOUT'
	| 'BLOCKED'
	| 'SKIPPED';

export interface ResearchResultEntry {
	status: ResearchResultStatus;
	summary_ref: string;
	sources?: string[];
	started_at?: string;
	ended_at?: string;
	duration_ms?: number;
}

export interface ResearchBatchContract {
	contract: 'positron.research.v1';
	run_id: string;
	repository_ref: string;
	repository_head: string;
	summary_ref: string;
	sources?: string[];
	results: {
		code: ResearchResultEntry;
		docs: ResearchResultEntry;
		tests: ResearchResultEntry;
	};
	parallelism: {
		verdict: 'PARALLELISM_PROVEN' | 'PARALLELISM_NOT_PROVEN';
		observed_overlap_ms: number;
	};
	started_at: string;
	ended_at: string;
	context_fingerprint: string;
}

export interface DecisionContract {
	contract: 'positron.decision.v1';
	run_id: string;
	decision: PlanDecision;
	reason_code: string;
	basis: Record<string, unknown>;
}

export interface PlanContract {
	contract: 'positron.plan.v1';
	run_id: string;
	repository_ref: string;
	repository_head: string;
	targets: { files: string[]; symbols: string[] };
	acceptance_criteria: string[];
	required_tests: string[];
	risks: string[];
	build_scope: { allowed_files: string[] };
	context: { fingerprint: string };
}

export interface SplitContract {
	contract: 'positron.split.v1';
	parent_run_id: string;
	reason: string;
	subtasks: Array<{ title: string; acceptance_criteria: string[] }>;
	dependencies?: string[][];
	acceptance_criteria?: string[];
}

export interface BuildInputContract {
	contract: 'positron.build-input.v1';
	run_id: string;
	job_id: string;
	attempt_id: string;
	plan_fingerprint: string;
	repository_ref: string;
	repository_head: string;
	workspace_path: string;
}

export interface BuildResultContract {
	contract: 'positron.build-result.v1';
	run_id: string;
	job_id: string;
	attempt_id: string;
	status: 'success' | 'failed' | 'blocked';
	summary: string;
	changed_files: string[];
	result_ref?: string;
}

export interface RunEventContract {
	contract: 'positron.run-event.v1';
	run_id: string;
	job_id?: string;
	attempt_id?: string;
	timestamp: string;
	previous_state?: string;
	new_state: string;
	reason_code: string;
	level: 'INFO' | 'WARN' | 'ERROR' | 'GATE';
}

// ---------------------------------------------------------------------------
// P5.1 — Harness Profile Ref (positron.harness-profile-ref.v1)
// ---------------------------------------------------------------------------

/**
 * Modell-Provenienz-Status eines Attempts. P5.1 erfindet keine Provenienz:
 * - `KNOWN`                    — Provider + Modell aus tatsächlicher Konfiguration/Runtime
 * - `PROVENANCE_UNAVAILABLE`   — neuer Attempt ohne belastbare Modell-Provenienz
 * - `LEGACY_PROFILE_UNSPECIFIED` — historischer Attempt (vor P5.1) ohne P5-Felder
 */
export type ModelProvenanceStatus =
	| 'KNOWN'
	| 'PROVENANCE_UNAVAILABLE'
	| 'LEGACY_PROFILE_UNSPECIFIED';

/** Harness-Ref-Dokument (validiert über `positron.harness-profile-ref.v1`). */
export interface HarnessProfileRefContract {
	contract: 'positron.harness-profile-ref.v1';
	/** Profil der tatsächlich wirksamen Harness-Konfiguration (Modell-Harness) */
	harness_profile_id: string;
	harness_profile_version: string;
	/** Aufgabenprofil (z. B. PLAN / BUILD / RESEARCH / REVIEW) */
	task_profile_id: string;
	task_profile_version: string;
	/** Kanonischer Task-Typ (Korrespondenz zu cp_jobs.job_type) */
	task_type: string;
	provider: string | null;
	model: string | null;
	model_provenance_status: ModelProvenanceStatus;
	/** Technischer Model-Adapter (nur wenn tatsächlich bekannt) */
	provider_adapter_id: string | null;
	provider_adapter_version: string | null;
	/** SHA-256 über die kanonische semantische Harness-Konfiguration */
	effective_harness_fingerprint: string;
	/** Die tatsächlich gehashte semantische Konfiguration (reproduzierbar).
	 *  Keine run_id/job_id/attempt_id/Timestamps/Duration/Result-Refs/Logs. */
	semantics: Record<string, unknown>;
}
