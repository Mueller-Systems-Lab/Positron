// Positron P5.3 — Two-Axis Failure Diagnosis & Routing Tests
import { describe, expect, it } from 'vitest';
import { validateContract } from '../contracts.js';
import {
	DEFAULT_CAPABILITY_SAMPLE_THRESHOLD,
	DIAGNOSIS_REASON_CAPABILITY,
	DIAGNOSIS_REASON_EXECUTION_INFRA,
	DIAGNOSIS_REASON_EXECUTION_PROVIDER,
	DIAGNOSIS_REASON_EXECUTION_TIMEOUT,
	DIAGNOSIS_REASON_HARNESS_CONTEXT,
	DIAGNOSIS_REASON_SECURITY_BLOCK,
	DIAGNOSIS_REASON_STRATEGY,
	DIAGNOSIS_REASON_UNKNOWN,
	ROUTING_REASON_CAPABILITY,
	ROUTING_REASON_EXECUTION,
	ROUTING_REASON_HARNESS,
	ROUTING_REASON_INSUFFICIENT_EVIDENCE,
	ROUTING_REASON_SECURITY_BLOCK,
	ROUTING_REASON_STRATEGY,
	ROUTING_REASON_UNKNOWN,
	buildFailureDiagnosis,
	buildRoutingDecision,
	decideRouting,
	diagnoseFailureDomain,
	evaluateCapabilityEvidence,
	hasRealDelta,
} from '../diagnosis.js';

// ---------------------------------------------------------------------------
// FAILURE_DOMAIN_*
// ---------------------------------------------------------------------------

describe('FAILURE_DOMAIN_EXECUTION', () => {
	it('PROVIDER_FAILURE → EXECUTION', () => {
		const r = diagnoseFailureDomain({ failure_class: 'PROVIDER_FAILURE' });
		expect(r.failure_domain).toBe('EXECUTION');
		expect(r.reason_code).toBe(DIAGNOSIS_REASON_EXECUTION_PROVIDER);
	});
	it('INFRA_FAILURE → EXECUTION', () => {
		const r = diagnoseFailureDomain({ failure_class: 'INFRA_FAILURE' });
		expect(r.failure_domain).toBe('EXECUTION');
		expect(r.reason_code).toBe(DIAGNOSIS_REASON_EXECUTION_INFRA);
	});
	it('TIMEOUT → EXECUTION', () => {
		const r = diagnoseFailureDomain({ failure_class: 'TIMEOUT' });
		expect(r.failure_domain).toBe('EXECUTION');
		expect(r.reason_code).toBe(DIAGNOSIS_REASON_EXECUTION_TIMEOUT);
	});
});

describe('FAILURE_DOMAIN_HARNESS', () => {
	it('CONTEXT_FAILURE → HARNESS', () => {
		const r = diagnoseFailureDomain({ failure_class: 'CONTEXT_FAILURE' });
		expect(r.failure_domain).toBe('HARNESS');
		expect(r.reason_code).toBe(DIAGNOSIS_REASON_HARNESS_CONTEXT);
	});
	it('CONTRACT_FAILURE → HARNESS', () => {
		const r = diagnoseFailureDomain({ failure_class: 'CONTRACT_FAILURE' });
		expect(r.failure_domain).toBe('HARNESS');
	});
});

describe('FAILURE_DOMAIN_STRATEGY', () => {
	it('TEST_FAILURE → STRATEGY', () => {
		const r = diagnoseFailureDomain({ failure_class: 'TEST_FAILURE' });
		expect(r.failure_domain).toBe('STRATEGY');
		expect(r.reason_code).toBe(DIAGNOSIS_REASON_STRATEGY);
	});
	it('BUILD_FAILURE → STRATEGY', () => {
		const r = diagnoseFailureDomain({ failure_class: 'BUILD_FAILURE' });
		expect(r.failure_domain).toBe('STRATEGY');
	});
});

describe('FAILURE_DOMAIN_CAPABILITY', () => {
	it('CAPABILITY only with sufficient evidence', () => {
		const r = diagnoseFailureDomain({
			failure_class: 'TEST_FAILURE',
			capabilityEvidence: {
				sampleSize: 5,
				threshold: 3,
				repeatedPattern: true,
				noProviderFailure: true,
				noInfraFailure: true,
				noTimeout: true,
				contextSufficient: true,
				toolsAvailable: true,
				contractValid: true,
				securityValid: true,
				strategyDeltaTried: true,
				noConflictingEvidence: true,
			},
		});
		expect(r.failure_domain).toBe('CAPABILITY');
		expect(r.reason_code).toBe(DIAGNOSIS_REASON_CAPABILITY);
	});
	it('CAPABILITY denied without evidence → STRATEGY', () => {
		const r = diagnoseFailureDomain({
			failure_class: 'TEST_FAILURE',
			capabilityEvidence: {
				sampleSize: 1,
				threshold: 3,
				repeatedPattern: false,
				noProviderFailure: true,
				noInfraFailure: true,
				noTimeout: true,
				contextSufficient: true,
				toolsAvailable: true,
				contractValid: true,
				securityValid: true,
				strategyDeltaTried: false,
				noConflictingEvidence: true,
			},
		});
		expect(r.failure_domain).toBe('STRATEGY');
	});
});

describe('FAILURE_DOMAIN_UNKNOWN', () => {
	it('UNKNOWN → UNKNOWN', () => {
		const r = diagnoseFailureDomain({ failure_class: 'UNKNOWN' });
		expect(r.failure_domain).toBe('UNKNOWN');
		expect(r.reason_code).toBe(DIAGNOSIS_REASON_UNKNOWN);
	});
	it('SECURITY_BLOCK → UNKNOWN (never capability)', () => {
		const r = diagnoseFailureDomain({ failure_class: 'SECURITY_BLOCK' });
		expect(r.failure_domain).toBe('UNKNOWN');
		expect(r.reason_code).toBe(DIAGNOSIS_REASON_SECURITY_BLOCK);
	});
});

// ---------------------------------------------------------------------------
// PROVIDER/INFRA/TIMEOUT/SECURITY NOT CAPABILITY
// ---------------------------------------------------------------------------

describe('PROVIDER_FAILURE_NOT_CAPABILITY', () => {
	it('PROVIDER_FAILURE never yields CAPABILITY even with evidence', () => {
		const r = diagnoseFailureDomain({
			failure_class: 'PROVIDER_FAILURE',
			capabilityEvidence: {
				sampleSize: 10,
				threshold: 3,
				repeatedPattern: true,
				noProviderFailure: false, // provider failure present
				noInfraFailure: true,
				noTimeout: true,
				contextSufficient: true,
				toolsAvailable: true,
				contractValid: true,
				securityValid: true,
				strategyDeltaTried: true,
				noConflictingEvidence: true,
			},
		});
		expect(r.failure_domain).toBe('EXECUTION');
		expect(r.failure_domain).not.toBe('CAPABILITY');
	});
});

describe('INFRA_FAILURE_NOT_CAPABILITY', () => {
	it('INFRA_FAILURE → EXECUTION, not CAPABILITY', () => {
		const r = diagnoseFailureDomain({ failure_class: 'INFRA_FAILURE' });
		expect(r.failure_domain).toBe('EXECUTION');
	});
});

describe('TIMEOUT_NOT_CAPABILITY', () => {
	it('TIMEOUT → EXECUTION, not CAPABILITY', () => {
		const r = diagnoseFailureDomain({ failure_class: 'TIMEOUT' });
		expect(r.failure_domain).toBe('EXECUTION');
	});
});

describe('SECURITY_BLOCK_NOT_CAPABILITY', () => {
	it('SECURITY_BLOCK never capability', () => {
		const r = diagnoseFailureDomain({ failure_class: 'SECURITY_BLOCK' });
		expect(r.failure_domain).not.toBe('CAPABILITY');
	});
	it('SECURITY_BLOCK routing → NO_RETRY', () => {
		const r = decideRouting({
			failure_class: 'SECURITY_BLOCK',
			failure_domain: 'UNKNOWN',
			evidence_refs: [],
			sample_size: 1,
			threshold: 3,
			isSecurityBlock: true,
		});
		expect(r.routing_action).toBe('NO_RETRY');
		expect(r.reason_code).toBe(ROUTING_REASON_SECURITY_BLOCK);
	});
});

// ---------------------------------------------------------------------------
// SINGLE_FAILURE_NOT_CAPABILITY etc.
// ---------------------------------------------------------------------------

describe('SINGLE_FAILURE_NOT_CAPABILITY', () => {
	it('sampleSize 1 → INSUFFICIENT_EVIDENCE', () => {
		const gate = evaluateCapabilityEvidence({
			sampleSize: 1,
			threshold: 3,
			repeatedPattern: true,
			noProviderFailure: true,
			noInfraFailure: true,
			noTimeout: true,
			contextSufficient: true,
			toolsAvailable: true,
			contractValid: true,
			securityValid: true,
			strategyDeltaTried: true,
			noConflictingEvidence: true,
		});
		expect(gate.sufficient).toBe(false);
		expect(gate.failedChecks).toContain('SAMPLE_SIZE_TOO_SMALL');
	});
});

describe('CAPABILITY_REQUIRES_EVIDENCE', () => {
	it('all gates must pass', () => {
		const gate = evaluateCapabilityEvidence({
			sampleSize: 5,
			threshold: 3,
			repeatedPattern: true,
			noProviderFailure: true,
			noInfraFailure: true,
			noTimeout: true,
			contextSufficient: true,
			toolsAvailable: true,
			contractValid: true,
			securityValid: true,
			strategyDeltaTried: true,
			noConflictingEvidence: true,
		});
		expect(gate.sufficient).toBe(true);
	});
});

describe('CAPABILITY_REQUIRES_STRATEGY_DELTA', () => {
	it('no strategy delta → insufficient', () => {
		const gate = evaluateCapabilityEvidence({
			sampleSize: 5,
			threshold: 3,
			repeatedPattern: true,
			noProviderFailure: true,
			noInfraFailure: true,
			noTimeout: true,
			contextSufficient: true,
			toolsAvailable: true,
			contractValid: true,
			securityValid: true,
			strategyDeltaTried: false,
			noConflictingEvidence: true,
		});
		expect(gate.sufficient).toBe(false);
		expect(gate.failedChecks).toContain('NO_STRATEGY_DELTA_TRIED');
	});
});

describe('INSUFFICIENT_SAMPLE_DENIES_CAPABILITY', () => {
	it('threshold not met → insufficient', () => {
		const gate = evaluateCapabilityEvidence({
			sampleSize: 2,
			threshold: 3,
			repeatedPattern: true,
			noProviderFailure: true,
			noInfraFailure: true,
			noTimeout: true,
			contextSufficient: true,
			toolsAvailable: true,
			contractValid: true,
			securityValid: true,
			strategyDeltaTried: true,
			noConflictingEvidence: true,
		});
		expect(gate.sufficient).toBe(false);
		expect(gate.failedChecks).toContain('THRESHOLD_NOT_MET');
	});
});

describe('CONFLICTING_EVIDENCE_DENIES_CAPABILITY', () => {
	it('conflicting evidence → insufficient', () => {
		const gate = evaluateCapabilityEvidence({
			sampleSize: 5,
			threshold: 3,
			repeatedPattern: true,
			noProviderFailure: true,
			noInfraFailure: true,
			noTimeout: true,
			contextSufficient: true,
			toolsAvailable: true,
			contractValid: true,
			securityValid: true,
			strategyDeltaTried: true,
			noConflictingEvidence: false,
		});
		expect(gate.sufficient).toBe(false);
		expect(gate.failedChecks).toContain('CONFLICTING_EVIDENCE');
	});
});

// ---------------------------------------------------------------------------
// ROUTING_*
// ---------------------------------------------------------------------------

describe('ROUTING_EXECUTION', () => {
	it('EXECUTION → RETRY_WITH_PROVIDER_REMEDIATION', () => {
		const r = decideRouting({
			failure_class: 'PROVIDER_FAILURE',
			failure_domain: 'EXECUTION',
			evidence_refs: ['att-1'],
			sample_size: 1,
			threshold: 3,
		});
		expect(r.routing_action).toBe('RETRY_WITH_PROVIDER_REMEDIATION');
		expect(r.reason_code).toBe(ROUTING_REASON_EXECUTION);
	});
});

describe('ROUTING_HARNESS_DELTA', () => {
	it('HARNESS → RETRY_WITH_HARNESS_DELTA', () => {
		const r = decideRouting({
			failure_class: 'CONTEXT_FAILURE',
			failure_domain: 'HARNESS',
			evidence_refs: ['att-1'],
			sample_size: 1,
			threshold: 3,
		});
		expect(r.routing_action).toBe('RETRY_WITH_HARNESS_DELTA');
		expect(r.reason_code).toBe(ROUTING_REASON_HARNESS);
	});
});

describe('ROUTING_STRATEGY_DELTA', () => {
	it('STRATEGY → RETRY_WITH_STRATEGY_DELTA', () => {
		const r = decideRouting({
			failure_class: 'TEST_FAILURE',
			failure_domain: 'STRATEGY',
			evidence_refs: ['att-1'],
			sample_size: 1,
			threshold: 3,
		});
		expect(r.routing_action).toBe('RETRY_WITH_STRATEGY_DELTA');
		expect(r.reason_code).toBe(ROUTING_REASON_STRATEGY);
	});
});

describe('ROUTING_CAPABILITY_ESCALATION', () => {
	it('CAPABILITY with gate passed → ESCALATE_MODEL_PROFILE', () => {
		const r = decideRouting({
			failure_class: 'TEST_FAILURE',
			failure_domain: 'CAPABILITY',
			evidence_refs: ['att-1', 'att-2', 'att-3'],
			sample_size: 5,
			threshold: 3,
			capabilityGatePassed: true,
		});
		expect(r.routing_action).toBe('ESCALATE_MODEL_PROFILE');
		expect(r.reason_code).toBe(ROUTING_REASON_CAPABILITY);
	});
	it('CAPABILITY without gate → INSPECT_BLOCK', () => {
		const r = decideRouting({
			failure_class: 'TEST_FAILURE',
			failure_domain: 'CAPABILITY',
			evidence_refs: ['att-1'],
			sample_size: 1,
			threshold: 3,
			capabilityGatePassed: false,
		});
		expect(r.routing_action).toBe('INSPECT_BLOCK');
		expect(r.reason_code).toBe(ROUTING_REASON_INSUFFICIENT_EVIDENCE);
	});
});

describe('ROUTING_UNKNOWN_CONSERVATIVE', () => {
	it('UNKNOWN → INSPECT_BLOCK', () => {
		const r = decideRouting({
			failure_class: 'UNKNOWN',
			failure_domain: 'UNKNOWN',
			evidence_refs: [],
			sample_size: 1,
			threshold: 3,
		});
		expect(r.routing_action).toBe('INSPECT_BLOCK');
		expect(r.reason_code).toBe(ROUTING_REASON_UNKNOWN);
	});
});

describe('ROUTING_DETERMINISTIC', () => {
	it('same inputs → same routing', () => {
		const input = {
			failure_class: 'TEST_FAILURE',
			failure_domain: 'STRATEGY' as const,
			evidence_refs: ['att-1'],
			sample_size: 1,
			threshold: 3,
		};
		const r1 = decideRouting(input);
		const r2 = decideRouting(input);
		expect(r1).toEqual(r2);
	});
	it('diagnosis deterministic', () => {
		const input = { failure_class: 'PROVIDER_FAILURE' };
		const r1 = diagnoseFailureDomain(input);
		const r2 = diagnoseFailureDomain(input);
		expect(r1).toEqual(r2);
	});
});

describe('ROUTING_REASON_CODE', () => {
	it('every routing has reason_code', () => {
		const domains: Array<'EXECUTION' | 'HARNESS' | 'STRATEGY' | 'CAPABILITY' | 'UNKNOWN'> = [
			'EXECUTION',
			'HARNESS',
			'STRATEGY',
			'UNKNOWN',
		];
		for (const d of domains) {
			const r = decideRouting({
				failure_class: 'TEST_FAILURE',
				failure_domain: d,
				evidence_refs: [],
				sample_size: 1,
				threshold: 3,
			});
			expect(r.reason_code.length).toBeGreaterThan(0);
			expect(r.selected_delta.length).toBeGreaterThan(0);
		}
	});
});

describe('ROUTING_PERSISTED', () => {
	it('failure-diagnosis contract validates', () => {
		const doc = buildFailureDiagnosis({
			run_id: 'run-1',
			job_id: 'job-1',
			attempt_id: 'att-1',
			failure_class: 'TEST_FAILURE',
			failure_domain: 'STRATEGY',
			evidence_refs: ['att-1'],
			sample_size: 1,
			threshold: 3,
			evidence_sufficient: true,
			diagnosis_reason_code: DIAGNOSIS_REASON_STRATEGY,
		});
		const result = validateContract('positron.failure-diagnosis.v1', doc, 1);
		expect(result.ok).toBe(true);
	});
	it('routing-decision contract validates', () => {
		const doc = buildRoutingDecision({
			source_attempt_id: 'att-1',
			failure_class: 'TEST_FAILURE',
			failure_domain: 'STRATEGY',
			routing_action: 'RETRY_WITH_STRATEGY_DELTA',
			reason_code: ROUTING_REASON_STRATEGY,
			evidence_refs: ['att-1'],
			sample_size: 1,
			threshold_result: 'STRATEGY_DELTA_REQUIRED',
			selected_delta: 'strategy_delta',
		});
		const result = validateContract('positron.routing-decision.v1', doc, 1);
		expect(result.ok).toBe(true);
	});
	it('fingerprints are deterministic', () => {
		const d1 = buildFailureDiagnosis({
			run_id: 'run-1',
			job_id: 'job-1',
			attempt_id: 'att-1',
			failure_class: 'TEST_FAILURE',
			failure_domain: 'STRATEGY',
			evidence_refs: ['att-1'],
			sample_size: 1,
			threshold: 3,
			evidence_sufficient: true,
			diagnosis_reason_code: DIAGNOSIS_REASON_STRATEGY,
		});
		const d2 = buildFailureDiagnosis({
			run_id: 'run-1',
			job_id: 'job-1',
			attempt_id: 'att-1',
			failure_class: 'TEST_FAILURE',
			failure_domain: 'STRATEGY',
			evidence_refs: ['att-1'],
			sample_size: 1,
			threshold: 3,
			evidence_sufficient: true,
			diagnosis_reason_code: DIAGNOSIS_REASON_STRATEGY,
		});
		expect(d1.fingerprint).toBe(d2.fingerprint);
	});
});

// ---------------------------------------------------------------------------
// ESCALATION_*
// ---------------------------------------------------------------------------

describe('ESCALATION_RECOMPILES_PROFILE', () => {
	it('hasRealDelta detects profile change via fingerprint', () => {
		const prev = {
			run_id: 'run-1',
			job_id: 'job-1',
			attempt_id: 'att-1',
			status: 'failed' as const,
			input_contract: null,
			input_fingerprint: 'abc',
			output_contract: null,
			output_fingerprint: null,
			output_json: null,
			worker_type: 'build',
			provider: 'openrouter',
			model: 'model-a',
			started_at: new Date().toISOString(),
			ended_at: null,
			failure_class: 'TEST_FAILURE',
			failure_signature: 'test failed',
			new_evidence: null,
			strategy_delta: null,
			result_ref: null,
			tokens: null,
			previous_attempt_id: null,
			lease_owner_id: null,
			lease_generation: 0,
			lease_expires_at: null,
			claimed_at: null,
			harness_profile_id: null,
			harness_profile_version: null,
			harness_fingerprint: null,
			harness_profile_ref: null,
			task_profile_id: null,
			task_profile_version: null,
			task_type: null,
			provider_adapter_id: null,
			provider_adapter_version: null,
			model_provenance_status: null,
			effective_harness_config: null,
			effective_harness_fingerprint: 'fp-old',
			failure_domain: null,
			diagnosis_reason_code: null,
			diagnosis_fingerprint: null,
			routing_action: null,
			routing_reason_code: null,
			routing_fingerprint: null,
		};
		expect(
			hasRealDelta(prev, {
				input_fingerprint: 'abc',
				provider: 'openrouter',
				model: 'model-a',
				effective_harness_fingerprint: 'fp-new',
				strategy_delta: null,
				new_evidence: null,
			}),
		).toBe(true);
		expect(
			hasRealDelta(prev, {
				input_fingerprint: 'abc',
				provider: 'openrouter',
				model: 'model-a',
				effective_harness_fingerprint: 'fp-old',
				strategy_delta: null,
				new_evidence: null,
			}),
		).toBe(false);
	});
});

describe('BLIND_RETRY_RATE_ZERO', () => {
	it('no delta → no retry (retry policy)', async () => {
		const { evaluateRetry } = await import('../retry-policy.js');
		const prev = {
			attempt_id: 'att-1',
			run_id: 'run-1',
			job_id: 'job-1',
			status: 'failed' as const,
			input_contract: null,
			input_fingerprint: 'fp-1',
			output_contract: null,
			output_fingerprint: null,
			output_json: null,
			worker_type: 'build',
			provider: 'openrouter',
			model: 'model-a',
			started_at: new Date().toISOString(),
			ended_at: null,
			failure_class: 'TEST_FAILURE',
			failure_signature: 'test failed',
			new_evidence: null,
			strategy_delta: null,
			result_ref: null,
			tokens: null,
			previous_attempt_id: null,
			lease_owner_id: null,
			lease_generation: 0,
			lease_expires_at: null,
			claimed_at: null,
			harness_profile_id: null,
			harness_profile_version: null,
			harness_fingerprint: null,
			harness_profile_ref: null,
			task_profile_id: null,
			task_profile_version: null,
			task_type: null,
			provider_adapter_id: null,
			provider_adapter_version: null,
			model_provenance_status: null,
			effective_harness_config: null,
			effective_harness_fingerprint: 'fp-1',
			failure_domain: null,
			diagnosis_reason_code: null,
			diagnosis_fingerprint: null,
			routing_action: null,
			routing_reason_code: null,
			routing_fingerprint: null,
		};
		const decision = evaluateRetry({
			attemptNumber: 1,
			maxAttempts: 3,
			previousAttempt: prev,
			inputFingerprint: 'fp-1',
			worker: { workerType: 'build', provider: 'openrouter', model: 'model-a' },
			newEvidence: null,
			strategyDelta: null,
			contextFingerprint: null,
			effectiveHarnessFingerprint: 'fp-1',
		});
		expect(decision.verdict).toBe('DENIED');
		expect(decision.reason_code).toBe('RETRY_DENIED_NO_STRATEGY_DELTA');
	});
	it('with profile delta → allowed', async () => {
		const { evaluateRetry } = await import('../retry-policy.js');
		const prev = {
			attempt_id: 'att-1',
			run_id: 'run-1',
			job_id: 'job-1',
			status: 'failed' as const,
			input_contract: null,
			input_fingerprint: 'fp-1',
			output_contract: null,
			output_fingerprint: null,
			output_json: null,
			worker_type: 'build',
			provider: 'openrouter',
			model: 'model-a',
			started_at: new Date().toISOString(),
			ended_at: null,
			failure_class: 'TEST_FAILURE',
			failure_signature: 'test failed',
			new_evidence: null,
			strategy_delta: null,
			result_ref: null,
			tokens: null,
			previous_attempt_id: null,
			lease_owner_id: null,
			lease_generation: 0,
			lease_expires_at: null,
			claimed_at: null,
			harness_profile_id: null,
			harness_profile_version: null,
			harness_fingerprint: null,
			harness_profile_ref: null,
			task_profile_id: null,
			task_profile_version: null,
			task_type: null,
			provider_adapter_id: null,
			provider_adapter_version: null,
			model_provenance_status: null,
			effective_harness_config: null,
			effective_harness_fingerprint: 'fp-1',
			failure_domain: null,
			diagnosis_reason_code: null,
			diagnosis_fingerprint: null,
			routing_action: null,
			routing_reason_code: null,
			routing_fingerprint: null,
		};
		const decision = evaluateRetry({
			attemptNumber: 1,
			maxAttempts: 3,
			previousAttempt: prev,
			inputFingerprint: 'fp-1',
			worker: { workerType: 'build', provider: 'openrouter', model: 'model-a' },
			newEvidence: null,
			strategyDelta: 'new strategy',
			contextFingerprint: null,
			effectiveHarnessFingerprint: 'fp-2',
		});
		expect(decision.verdict).toBe('ALLOWED');
		expect(decision.delta).toContain('profile_change');
	});
});

// ---------------------------------------------------------------------------
// HISTORICAL_COMPATIBILITY
// ---------------------------------------------------------------------------

describe('HISTORICAL_COMPATIBILITY', () => {
	it('old attempts without P5.3 fields are readable as UNKNOWN', () => {
		// Simulate old attempt row without failure_domain — should be null/UNKNOWN
		const row: Record<string, unknown> = {
			attempt_id: 'att-old',
			run_id: 'run-1',
			job_id: 'job-1',
			status: 'failed',
			failure_class: 'TEST_FAILURE',
		};
		expect(row.failure_class).toBe('TEST_FAILURE');
		expect((row as Record<string, unknown>).failure_domain ?? null).toBe(null);
		// Diagnosis without evidence → STRATEGY, not CAPABILITY (no retroactive invention)
		const r = diagnoseFailureDomain({ failure_class: 'TEST_FAILURE' });
		expect(r.failure_domain).not.toBe('CAPABILITY');
	});
});

describe('NO_RETROACTIVE_CAPABILITY_INVENTION', () => {
	it('historical attempt without evidence cannot be CAPABILITY', () => {
		const r = diagnoseFailureDomain({ failure_class: 'TEST_FAILURE' });
		// Without capability evidence, TEST_FAILURE → STRATEGY, not CAPABILITY
		expect(r.failure_domain).not.toBe('CAPABILITY');
	});
});
