// Positron — versioned runtime budget contract

import crypto from 'node:crypto';

export const RUNTIME_BUDGET_CONTRACT = 'positron.runtime-budget.v1' as const;
export const RUNTIME_BUDGET_CONTRACT_VERSION = 1 as const;
export const DEFAULT_RUNTIME_BUDGET_MS = 300_000;
export const MAX_RUNTIME_BUDGET_MS = 3_600_000;
export const MAX_CANCELLATION_GRACE_MS = 10_000;
export const MAX_STEPS = 100_000;
export const MAX_TOOL_CALLS = 100_000;
export const MAX_RETRIES = 100;

export const RUNTIME_TERMINATION_REASONS = [
	'PROVIDER_TRANSPORT_TIMEOUT',
	'PROVIDER_QUEUE_TIMEOUT',
	'MODEL_INFERENCE_TIMEOUT',
	'TOOL_EXECUTION_TIMEOUT',
	'ATTEMPT_DEADLINE_EXCEEDED',
	'VERIFICATION_DEADLINE_EXCEEDED',
	'EXPERIMENT_CELL_DEADLINE_EXCEEDED',
	'RUN_BUDGET_EXHAUSTED',
	'CANCELLED_BY_KERNEL',
	'LATE_RESULT_FENCED',
	'PROVIDER_FAILURE',
	'EXPERIMENT_CONTRACT_CHANGED',
	'RETRY_BUDGET_EXHAUSTED',
	'RUNTIME_TERMINATION_UNKNOWN',
] as const;

export type RuntimeTerminationReason = (typeof RUNTIME_TERMINATION_REASONS)[number];
export type RuntimeTerminationAuthority =
	| 'provider'
	| 'model'
	| 'tool'
	| 'attempt'
	| 'verification'
	| 'experiment_cell'
	| 'run'
	| 'kernel'
	| 'fencing';

const RUNTIME_TERMINATION_AUTHORITIES = [
	'provider',
	'model',
	'tool',
	'attempt',
	'verification',
	'experiment_cell',
	'run',
	'kernel',
	'fencing',
] as const satisfies readonly RuntimeTerminationAuthority[];

export type RuntimeBudgetRole =
	| 'run'
	| 'job'
	| 'attempt'
	| 'provider'
	| 'tool'
	| 'verification'
	| 'experiment_cell';

export interface RuntimeBudgetContract {
	contract: typeof RUNTIME_BUDGET_CONTRACT;
	contract_version: typeof RUNTIME_BUDGET_CONTRACT_VERSION;
	budget_id: string;
	budget_fingerprint: string;
	issued_at: string;
	/** Absolute deadline in the monotonic clock domain used by the owner. */
	absolute_deadline_ms: number;
	attempt_wall_clock_budget_ms: number;
	provider_request_budget_ms: number;
	tool_execution_budget_ms: number;
	verification_budget_ms: number;
	max_steps: number;
	max_tool_calls: number;
	max_retries: number;
	cancellation_grace_ms: number;
	parent_budget_ref: string | null;
	source_policy_ref: string;
	provider: string | null;
	model: string | null;
	effective_harness_fingerprint: string | null;
	budget_provenance: Record<string, string>;
}

export interface RuntimeBudgetInput {
	budget_id?: string;
	now_ms?: number;
	issued_at?: string;
	absolute_deadline_ms?: number;
	attempt_wall_clock_budget_ms?: number;
	provider_request_budget_ms?: number;
	tool_execution_budget_ms?: number;
	verification_budget_ms?: number;
	max_steps?: number;
	max_tool_calls?: number;
	max_retries?: number;
	cancellation_grace_ms?: number;
	parent_budget_ref?: string | null;
	source_policy_ref?: string;
	provider?: string | null;
	model?: string | null;
	effective_harness_fingerprint?: string | null;
	budget_provenance?: Record<string, string>;
}

export interface ChildRuntimeBudgetInput extends RuntimeBudgetInput {
	role: RuntimeBudgetRole;
	wall_clock_budget_ms: number;
}

export interface RuntimeBudgetSlice {
	budget_id: string;
	parent_budget_ref: string | null;
	deadline_ms: number;
	timeout_reason: RuntimeTerminationReason;
	termination_authority: RuntimeTerminationAuthority;
	cancellation_grace_ms: number;
}

export interface RuntimeTerminationInput {
	providerFailure?: boolean;
	providerTransportTimeout?: boolean;
	providerQueueTimeout?: boolean;
	modelInferenceTimeout?: boolean;
	toolTimeout?: boolean;
	verificationTimeout?: boolean;
	cellDeadline?: boolean;
	attemptDeadline?: boolean;
	runBudgetExhausted?: boolean;
	cancelledByKernel?: boolean;
	lateResult?: boolean;
}

export interface RuntimeTermination {
	reason: RuntimeTerminationReason;
	authority: RuntimeTerminationAuthority;
}

export interface RuntimeRetryDecision {
	allowed: boolean;
	reason: 'RETRY_ALLOWED' | 'RETRY_BUDGET_EXHAUSTED';
	remaining_budget_ms: number;
}

export interface CalibrationHoldoutContract {
	contract: 'positron.experiment-runtime.v1';
	runtime_budget_fingerprint: string;
	calibration_partition_fingerprint: string;
	holdout_partition_fingerprint: string;
	calibration_holdout_intersection: 0;
	frozen: boolean;
	contract_fingerprint: string;
}

const FINGERPRINT_EXCLUDED_KEYS = new Set([
	'budget_id',
	'budget_fingerprint',
	'issued_at',
	'absolute_deadline_ms',
]);

/**
 * Monotonic epoch clock: performance.now() remains monotonic within a
 * process, while timeOrigin makes the persisted deadline comparable after a
 * worker restart. Date.now() is only the unavailable-runtime fallback.
 */
export function runtimeBudgetClockNowMs(): number {
	return typeof performance !== 'undefined'
		? performance.timeOrigin + performance.now()
		: Date.now();
}

function stableJson(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.filter((key) => record[key] !== undefined && !FINGERPRINT_EXCLUDED_KEYS.has(key))
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
		.join(',')}}`;
}

function fingerprintContract(contract: Omit<RuntimeBudgetContract, 'budget_fingerprint'>): string {
	return crypto.createHash('sha256').update(stableJson(contract), 'utf8').digest('hex');
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function validateBounded(value: unknown, name: string, max: number, errors: string[]): void {
	if (!isPositiveInteger(value)) errors.push(`${name} must be a positive integer`);
	else if (value > max) errors.push(`${name} exceeds maximum ${max}`);
}

function containsSecretLike(value: string): boolean {
	return /(gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9]+|bearer\s+\S+|api[_-]?key\s*[=:])/i.test(value);
}

export function isRuntimeTerminationReason(value: unknown): value is RuntimeTerminationReason {
	return (
		typeof value === 'string' && (RUNTIME_TERMINATION_REASONS as readonly string[]).includes(value)
	);
}

export function isRuntimeTerminationAuthority(
	value: unknown,
): value is RuntimeTerminationAuthority {
	return (
		typeof value === 'string' &&
		(RUNTIME_TERMINATION_AUTHORITIES as readonly string[]).includes(value)
	);
}

/** Deterministic, non-LLM classification. Kernel/fencing evidence wins first. */
export function classifyRuntimeTermination(input: RuntimeTerminationInput): RuntimeTermination {
	if (input.lateResult) return { reason: 'LATE_RESULT_FENCED', authority: 'fencing' };
	if (input.cancelledByKernel) return { reason: 'CANCELLED_BY_KERNEL', authority: 'kernel' };
	if (input.runBudgetExhausted) return { reason: 'RUN_BUDGET_EXHAUSTED', authority: 'run' };
	if (input.attemptDeadline) return { reason: 'ATTEMPT_DEADLINE_EXCEEDED', authority: 'attempt' };
	if (input.cellDeadline)
		return { reason: 'EXPERIMENT_CELL_DEADLINE_EXCEEDED', authority: 'experiment_cell' };
	if (input.verificationTimeout)
		return { reason: 'VERIFICATION_DEADLINE_EXCEEDED', authority: 'verification' };
	if (input.toolTimeout) return { reason: 'TOOL_EXECUTION_TIMEOUT', authority: 'tool' };
	if (input.providerQueueTimeout)
		return { reason: 'PROVIDER_QUEUE_TIMEOUT', authority: 'provider' };
	if (input.modelInferenceTimeout) return { reason: 'MODEL_INFERENCE_TIMEOUT', authority: 'model' };
	if (input.providerTransportTimeout)
		return { reason: 'PROVIDER_TRANSPORT_TIMEOUT', authority: 'provider' };
	if (input.providerFailure) return { reason: 'PROVIDER_FAILURE', authority: 'provider' };
	return { reason: 'RUNTIME_TERMINATION_UNKNOWN', authority: 'kernel' };
}

export function validateRuntimeBudgetContract(contract: RuntimeBudgetContract): string[] {
	const errors: string[] = [];
	if (contract.contract !== RUNTIME_BUDGET_CONTRACT)
		errors.push('contract must be positron.runtime-budget.v1');
	if (contract.contract_version !== RUNTIME_BUDGET_CONTRACT_VERSION)
		errors.push('unsupported contract_version');
	if (!contract.budget_id.trim()) errors.push('budget_id must not be empty');
	validateBounded(
		contract.attempt_wall_clock_budget_ms,
		'attempt_wall_clock_budget_ms',
		MAX_RUNTIME_BUDGET_MS,
		errors,
	);
	validateBounded(
		contract.provider_request_budget_ms,
		'provider_request_budget_ms',
		MAX_RUNTIME_BUDGET_MS,
		errors,
	);
	validateBounded(
		contract.tool_execution_budget_ms,
		'tool_execution_budget_ms',
		MAX_RUNTIME_BUDGET_MS,
		errors,
	);
	validateBounded(
		contract.verification_budget_ms,
		'verification_budget_ms',
		MAX_RUNTIME_BUDGET_MS,
		errors,
	);
	if (contract.provider_request_budget_ms > contract.attempt_wall_clock_budget_ms)
		errors.push('provider_request_budget_ms exceeds attempt_wall_clock_budget_ms');
	if (contract.tool_execution_budget_ms > contract.attempt_wall_clock_budget_ms)
		errors.push('tool_execution_budget_ms exceeds attempt_wall_clock_budget_ms');
	if (contract.verification_budget_ms > contract.attempt_wall_clock_budget_ms)
		errors.push('verification_budget_ms exceeds attempt_wall_clock_budget_ms');
	validateBounded(
		contract.cancellation_grace_ms,
		'cancellation_grace_ms',
		MAX_CANCELLATION_GRACE_MS,
		errors,
	);
	validateBounded(contract.max_steps, 'max_steps', MAX_STEPS, errors);
	validateBounded(contract.max_tool_calls, 'max_tool_calls', MAX_TOOL_CALLS, errors);
	if (
		!Number.isInteger(contract.max_retries) ||
		contract.max_retries < 0 ||
		contract.max_retries > MAX_RETRIES
	) {
		errors.push(`max_retries must be an integer between 0 and ${MAX_RETRIES}`);
	}
	if (!Number.isFinite(contract.absolute_deadline_ms) || contract.absolute_deadline_ms <= 0) {
		errors.push('absolute_deadline_ms must be a finite positive number');
	}
	if (!contract.source_policy_ref.trim()) errors.push('source_policy_ref must not be empty');
	if (!/^[0-9a-f]{64}$/.test(contract.budget_fingerprint))
		errors.push('budget_fingerprint must be a SHA-256 hex string');
	for (const [key, value] of Object.entries(contract.budget_provenance)) {
		if (!key.trim() || !value.trim())
			errors.push('budget_provenance keys and values must not be empty');
		if (containsSecretLike(value))
			errors.push(`budget_provenance.${key} contains secret-like material`);
	}
	if (contract.budget_fingerprint !== fingerprintContract(contract))
		errors.push('budget_fingerprint does not match contract');
	return errors;
}

export function buildRuntimeBudgetContract(input: RuntimeBudgetInput = {}): RuntimeBudgetContract {
	const now = input.now_ms ?? runtimeBudgetClockNowMs();
	const attemptBudget = input.attempt_wall_clock_budget_ms ?? DEFAULT_RUNTIME_BUDGET_MS;
	const contract: Omit<RuntimeBudgetContract, 'budget_fingerprint'> = {
		contract: RUNTIME_BUDGET_CONTRACT,
		contract_version: RUNTIME_BUDGET_CONTRACT_VERSION,
		budget_id: input.budget_id ?? `budget_${crypto.randomUUID()}`,
		issued_at: input.issued_at ?? new Date().toISOString(),
		absolute_deadline_ms: input.absolute_deadline_ms ?? now + attemptBudget,
		attempt_wall_clock_budget_ms: attemptBudget,
		provider_request_budget_ms:
			input.provider_request_budget_ms ?? Math.min(attemptBudget, 300_000),
		tool_execution_budget_ms: input.tool_execution_budget_ms ?? Math.min(attemptBudget, 120_000),
		verification_budget_ms: input.verification_budget_ms ?? Math.min(attemptBudget, 120_000),
		max_steps: input.max_steps ?? 12,
		max_tool_calls: input.max_tool_calls ?? 100,
		max_retries: input.max_retries ?? 0,
		cancellation_grace_ms: input.cancellation_grace_ms ?? 2_000,
		parent_budget_ref: input.parent_budget_ref ?? null,
		source_policy_ref: input.source_policy_ref ?? 'positron.runtime.default.v1',
		provider: input.provider ?? null,
		model: input.model ?? null,
		effective_harness_fingerprint: input.effective_harness_fingerprint ?? null,
		budget_provenance: {
			...(input.budget_provenance ?? {}),
			clock: 'monotonic-epoch-performance-now-v1',
		},
	};
	return { ...contract, budget_fingerprint: fingerprintContract(contract) };
}

export function freezeRuntimeBudgetContract(
	contract: RuntimeBudgetContract,
): Readonly<RuntimeBudgetContract> {
	const errors = validateRuntimeBudgetContract(contract);
	if (errors.length > 0) throw new Error(`Invalid runtime budget contract: ${errors.join('; ')}`);
	return Object.freeze({
		...contract,
		budget_provenance: Object.freeze({ ...contract.budget_provenance }),
	});
}

export function remainingRuntimeBudgetMs(
	contract: RuntimeBudgetContract,
	nowMs = runtimeBudgetClockNowMs(),
): number {
	return Math.max(0, Math.floor(contract.absolute_deadline_ms - nowMs));
}

export function evaluateRuntimeRetry(
	parent: RuntimeBudgetContract,
	retriesUsed: number,
	requestedBudgetMs: number,
	nowMs = runtimeBudgetClockNowMs(),
): RuntimeRetryDecision {
	const remaining = remainingRuntimeBudgetMs(parent, nowMs);
	const allowed =
		retriesUsed < parent.max_retries && requestedBudgetMs > 0 && remaining >= requestedBudgetMs;
	return {
		allowed,
		reason: allowed ? 'RETRY_ALLOWED' : 'RETRY_BUDGET_EXHAUSTED',
		remaining_budget_ms: remaining,
	};
}

export function deriveChildRuntimeBudgetContract(
	parent: RuntimeBudgetContract,
	input: ChildRuntimeBudgetInput,
	nowMs = runtimeBudgetClockNowMs(),
): RuntimeBudgetContract {
	const remaining = remainingRuntimeBudgetMs(parent, nowMs);
	const effectiveWallClock = Math.min(input.wall_clock_budget_ms, remaining);
	if (effectiveWallClock <= 0)
		throw new Error('RUN_BUDGET_EXHAUSTED: child cannot be created after parent deadline');
	return buildRuntimeBudgetContract({
		...input,
		now_ms: nowMs,
		absolute_deadline_ms: Math.min(nowMs + effectiveWallClock, parent.absolute_deadline_ms),
		attempt_wall_clock_budget_ms: effectiveWallClock,
		provider_request_budget_ms: Math.min(
			input.provider_request_budget_ms ?? parent.provider_request_budget_ms,
			effectiveWallClock,
		),
		tool_execution_budget_ms: Math.min(
			input.tool_execution_budget_ms ?? parent.tool_execution_budget_ms,
			effectiveWallClock,
		),
		verification_budget_ms: Math.min(
			input.verification_budget_ms ?? parent.verification_budget_ms,
			effectiveWallClock,
		),
		max_steps: Math.min(input.max_steps ?? parent.max_steps, parent.max_steps),
		max_tool_calls: Math.min(input.max_tool_calls ?? parent.max_tool_calls, parent.max_tool_calls),
		max_retries: Math.min(input.max_retries ?? parent.max_retries, parent.max_retries),
		cancellation_grace_ms: Math.min(
			input.cancellation_grace_ms ?? parent.cancellation_grace_ms,
			parent.cancellation_grace_ms,
		),
		parent_budget_ref: parent.budget_id,
		provider: input.provider ?? parent.provider,
		model: input.model ?? parent.model,
		effective_harness_fingerprint:
			input.effective_harness_fingerprint ?? parent.effective_harness_fingerprint,
		budget_provenance: { ...parent.budget_provenance, derived_role: input.role },
	});
}

export function runtimeBudgetSlice(
	contract: RuntimeBudgetContract,
	role: RuntimeBudgetRole,
	nowMs = runtimeBudgetClockNowMs(),
): RuntimeBudgetSlice {
	const parentExhausted =
		contract.parent_budget_ref !== null && remainingRuntimeBudgetMs(contract, nowMs) <= 0;
	const timeoutReason: RuntimeTerminationReason =
		role === 'run' || parentExhausted
			? 'RUN_BUDGET_EXHAUSTED'
			: role === 'provider'
				? 'PROVIDER_TRANSPORT_TIMEOUT'
				: role === 'tool'
					? 'TOOL_EXECUTION_TIMEOUT'
					: role === 'verification'
						? 'VERIFICATION_DEADLINE_EXCEEDED'
						: role === 'experiment_cell'
							? 'EXPERIMENT_CELL_DEADLINE_EXCEEDED'
							: 'ATTEMPT_DEADLINE_EXCEEDED';
	const terminationAuthority: RuntimeTerminationAuthority =
		timeoutReason === 'RUN_BUDGET_EXHAUSTED' ? 'run' : role === 'job' ? 'attempt' : role;
	const requestedDuration =
		role === 'provider'
			? contract.provider_request_budget_ms
			: role === 'tool'
				? contract.tool_execution_budget_ms
				: role === 'verification'
					? contract.verification_budget_ms
					: contract.attempt_wall_clock_budget_ms;
	return {
		budget_id: contract.budget_id,
		parent_budget_ref: contract.parent_budget_ref,
		deadline_ms: Math.min(contract.absolute_deadline_ms, nowMs + requestedDuration),
		timeout_reason: timeoutReason,
		termination_authority: terminationAuthority,
		cancellation_grace_ms: contract.cancellation_grace_ms,
	};
}

export function buildCalibrationHoldoutContract(input: {
	runtime_budget_fingerprint: string;
	calibration_partition_fingerprint: string;
	holdout_partition_fingerprint: string;
	calibration_holdout_intersection: number;
	frozen?: boolean;
}): CalibrationHoldoutContract {
	if (!/^[0-9a-f]{64}$/.test(input.runtime_budget_fingerprint))
		throw new Error('runtime budget fingerprint is invalid');
	if (!input.calibration_partition_fingerprint || !input.holdout_partition_fingerprint)
		throw new Error('calibration and holdout fingerprints are required');
	if (input.calibration_holdout_intersection !== 0)
		throw new Error('calibration and holdout partitions must be disjoint');
	const base = {
		contract: 'positron.experiment-runtime.v1' as const,
		runtime_budget_fingerprint: input.runtime_budget_fingerprint,
		calibration_partition_fingerprint: input.calibration_partition_fingerprint,
		holdout_partition_fingerprint: input.holdout_partition_fingerprint,
		calibration_holdout_intersection: 0 as const,
		frozen: input.frozen ?? true,
	};
	return {
		...base,
		contract_fingerprint: crypto
			.createHash('sha256')
			.update(stableJson(base), 'utf8')
			.digest('hex'),
	};
}

export function assertKernelOwnedBudgetMutation(actor: string): void {
	if (actor !== 'kernel')
		throw new Error(
			'RUNTIME_BUDGET_MUTATION_DENIED: only kernel authority may mutate runtime budget state',
		);
}
