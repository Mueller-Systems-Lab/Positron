import {
	applyControlPlaneMigrations,
	completeAttempt,
	createAttempt,
	createJob,
	getAttempt,
} from '@positron/control-plane';
import {
	DEFAULT_CAPABILITY_SAMPLE_THRESHOLD,
	buildFailureDiagnosis,
	buildRoutingDecision,
	decideRouting,
	diagnoseFailureDomain,
	evaluateCapabilityEvidence,
	hasRealDelta,
} from '@positron/control-plane';
import { validateContract } from '@positron/control-plane';
// Positron P5.3 — Real Canaries (STRATEGY, EXECUTION, CAPABILITY)
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function makeDb(): Database.Database {
	const db = new Database(':memory:');
	applyControlPlaneMigrations(db);
	return db;
}

describe('REAL_STRATEGY_CANARY', () => {
	it('valid context + test failure → STRATEGY → strategy delta', () => {
		const db = makeDb();
		const job = createJob(db, 'run-strategy', 'build');
		const att1 = createAttempt(db, 'run-strategy', job.job_id, {
			status: 'pending',
			worker_type: 'build',
			provider: 'openrouter',
			model: 'model-a',
			input_fingerprint: 'fp-1',
			effective_harness_fingerprint: 'harness-fp-1',
		});

		// Diagnose: valid context, no infra/provider → STRATEGY
		const diagnosis = diagnoseFailureDomain({ failure_class: 'TEST_FAILURE' });
		expect(diagnosis.failure_domain).toBe('STRATEGY');

		// Routing: STRATEGY → strategy delta
		const routing = decideRouting({
			failure_class: 'TEST_FAILURE',
			failure_domain: 'STRATEGY',
			evidence_refs: [att1.attempt_id],
			sample_size: 1,
			threshold: DEFAULT_CAPABILITY_SAMPLE_THRESHOLD,
		});
		expect(routing.routing_action).toBe('RETRY_WITH_STRATEGY_DELTA');
		expect(routing.selected_delta).toBe('strategy_delta');

		// Persist diagnosis + routing on attempt (complete with failure + diagnosis)
		const diagDoc = buildFailureDiagnosis({
			run_id: att1.run_id,
			job_id: att1.job_id,
			attempt_id: att1.attempt_id,
			failure_class: 'TEST_FAILURE',
			failure_domain: 'STRATEGY',
			evidence_refs: [att1.attempt_id],
			sample_size: 1,
			threshold: DEFAULT_CAPABILITY_SAMPLE_THRESHOLD,
			evidence_sufficient: true,
			diagnosis_reason_code: diagnosis.reason_code,
		});
		const routeDoc = buildRoutingDecision({
			source_attempt_id: att1.attempt_id,
			failure_class: 'TEST_FAILURE',
			failure_domain: 'STRATEGY',
			routing_action: routing.routing_action,
			reason_code: routing.reason_code,
			evidence_refs: [att1.attempt_id],
			sample_size: 1,
			threshold_result: routing.threshold_result,
			selected_delta: routing.selected_delta,
		});

		completeAttempt(db, att1.attempt_id, {
			status: 'failed',
			failure_class: 'TEST_FAILURE',
			failure_signature: 'test:sum.test.ts failed',
			failure_domain: 'STRATEGY',
			diagnosis_reason_code: diagnosis.reason_code,
			diagnosis_fingerprint: diagDoc.fingerprint,
			routing_action: routing.routing_action,
			routing_reason_code: routing.reason_code,
			routing_fingerprint: routeDoc.fingerprint,
		});

		const persisted = getAttempt(db, att1.attempt_id);
		expect(persisted?.failure_domain).toBe('STRATEGY');
		expect(persisted?.routing_action).toBe('RETRY_WITH_STRATEGY_DELTA');

		// Attempt 2: same model, but strategy delta → real delta
		const att2 = createAttempt(db, 'run-strategy', job.job_id, {
			status: 'pending',
			worker_type: 'build',
			provider: 'openrouter',
			model: 'model-a',
			input_fingerprint: 'fp-1',
			effective_harness_fingerprint: 'harness-fp-1',
			previous_attempt_id: att1.attempt_id,
			strategy_delta: 'improved test strategy',
		});
		expect(
			hasRealDelta(att1, {
				input_fingerprint: att2.input_fingerprint,
				provider: att2.provider,
				model: att2.model,
				effective_harness_fingerprint: att2.effective_harness_fingerprint,
				strategy_delta: att2.strategy_delta,
				new_evidence: null,
			}),
		).toBe(true);
		expect(att2.attempt_id).not.toBe(att1.attempt_id);
		expect(att2.previous_attempt_id).toBe(att1.attempt_id);
	});
});

describe('REAL_EXECUTION_FAILURE_CANARY', () => {
	it('provider failure → EXECUTION, never capability', () => {
		const db = makeDb();
		const job = createJob(db, 'run-exec', 'build');
		const att = createAttempt(db, 'run-exec', job.job_id, {
			status: 'failed',
			failure_class: 'PROVIDER_FAILURE',
			failure_signature: '429 rate limit',
			worker_type: 'build',
			provider: 'openrouter',
			model: 'model-a',
		});

		const diagnosis = diagnoseFailureDomain({ failure_class: 'PROVIDER_FAILURE' });
		expect(diagnosis.failure_domain).toBe('EXECUTION');
		expect(diagnosis.failure_domain).not.toBe('CAPABILITY');

		const routing = decideRouting({
			failure_class: 'PROVIDER_FAILURE',
			failure_domain: 'EXECUTION',
			evidence_refs: [att.attempt_id],
			sample_size: 1,
			threshold: DEFAULT_CAPABILITY_SAMPLE_THRESHOLD,
		});
		expect(routing.routing_action).toBe('RETRY_WITH_PROVIDER_REMEDIATION');
		expect(routing.routing_action).not.toBe('ESCALATE_MODEL_PROFILE');

		// Capability gate must fail for provider failure
		const gate = evaluateCapabilityEvidence({
			sampleSize: 5,
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
		});
		expect(gate.sufficient).toBe(false);
	});
});

describe('REAL_CAPABILITY_ESCALATION_CANARY', () => {
	it('multiple failures + evidence gate → CAPABILITY → escalation with new model/profile', () => {
		const db = makeDb();
		const job = createJob(db, 'run-cap', 'build');

		// Simulate 3 failed attempts with strategy deltas, no infra/provider, valid context
		const attempts = [];
		for (let i = 0; i < 3; i++) {
			const att = createAttempt(db, 'run-cap', job.job_id, {
				status: 'failed',
				failure_class: 'TEST_FAILURE',
				failure_signature: 'test failed: capability pattern',
				worker_type: 'build',
				provider: 'openrouter',
				model: 'model-a',
				input_fingerprint: `fp-${i}`,
				effective_harness_fingerprint: 'harness-fp-a',
				strategy_delta: i > 0 ? `strategy-delta-${i}` : null,
				previous_attempt_id: i > 0 ? attempts[i - 1]!.attempt_id : null,
			});
			attempts.push(att);
		}

		// Evidence gate: sample 3, threshold 3, all checks pass
		const gate = evaluateCapabilityEvidence({
			sampleSize: 3,
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

		// Diagnosis with capability evidence → CAPABILITY
		const diagnosis = diagnoseFailureDomain({
			failure_class: 'TEST_FAILURE',
			capabilityEvidence: {
				sampleSize: 3,
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
		expect(diagnosis.failure_domain).toBe('CAPABILITY');

		// Routing: CAPABILITY with gate passed → ESCALATE
		const routing = decideRouting({
			failure_class: 'TEST_FAILURE',
			failure_domain: 'CAPABILITY',
			evidence_refs: attempts.map((a) => a.attempt_id),
			sample_size: 3,
			threshold: 3,
			capabilityGatePassed: true,
		});
		expect(routing.routing_action).toBe('ESCALATE_MODEL_PROFILE');
		expect(routing.selected_delta).toBe('model_profile_escalation');

		// New attempt with different model/profile and new harness fingerprint
		const lastAtt = attempts[attempts.length - 1];
		const escalated = createAttempt(db, 'run-cap', job.job_id, {
			status: 'pending',
			worker_type: 'build',
			provider: 'openrouter',
			model: 'model-b', // different model
			input_fingerprint: 'fp-escalated',
			effective_harness_fingerprint: 'harness-fp-b', // different harness
			previous_attempt_id: lastAtt!.attempt_id,
		});

		expect(escalated.model).toBe('model-b');
		expect(escalated.model).not.toBe(lastAtt!.model);
		expect(escalated.effective_harness_fingerprint).not.toBe(
			lastAtt!.effective_harness_fingerprint,
		);
		expect(escalated.previous_attempt_id).toBe(lastAtt!.attempt_id);
		expect(
			hasRealDelta(lastAtt!, {
				input_fingerprint: escalated.input_fingerprint,
				provider: escalated.provider,
				model: escalated.model,
				effective_harness_fingerprint: escalated.effective_harness_fingerprint,
				strategy_delta: null,
				new_evidence: null,
			}),
		).toBe(true);

		// Persist diagnosis + routing
		const diagDoc = buildFailureDiagnosis({
			run_id: lastAtt!.run_id,
			job_id: lastAtt!.job_id,
			attempt_id: lastAtt!.attempt_id,
			failure_class: 'TEST_FAILURE',
			failure_domain: 'CAPABILITY',
			evidence_refs: attempts.map((a) => a.attempt_id),
			sample_size: 3,
			threshold: 3,
			evidence_sufficient: true,
			diagnosis_reason_code: diagnosis.reason_code,
		});
		const routeDoc = buildRoutingDecision({
			source_attempt_id: lastAtt!.attempt_id,
			failure_class: 'TEST_FAILURE',
			failure_domain: 'CAPABILITY',
			routing_action: routing.routing_action,
			reason_code: routing.reason_code,
			evidence_refs: attempts.map((a) => a.attempt_id),
			sample_size: 3,
			threshold_result: routing.threshold_result,
			selected_delta: routing.selected_delta,
		});

		expect(validateContract('positron.failure-diagnosis.v1', diagDoc, 1).ok).toBe(true);
		expect(validateContract('positron.routing-decision.v1', routeDoc, 1).ok).toBe(true);

		// Verify immutable chain
		expect(attempts[0]!.previous_attempt_id).toBe(null);
		expect(attempts[1]!.previous_attempt_id).toBe(attempts[0]!.attempt_id);
		expect(attempts[2]!.previous_attempt_id).toBe(attempts[1]!.attempt_id);
		expect(escalated.previous_attempt_id).toBe(attempts[2]!.attempt_id);
	});
});

describe('ADVERSARIAL_TESTS', () => {
	it('FORGED_CAPABILITY_EVIDENCE_REJECTED — single attempt cannot be capability', () => {
		const gate = evaluateCapabilityEvidence({
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
		});
		expect(gate.sufficient).toBe(false);
		const diagnosis = diagnoseFailureDomain({
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
		expect(diagnosis.failure_domain).not.toBe('CAPABILITY');
	});

	it('PROVIDER_FAILURE_CAPABILITY_REJECTED', () => {
		const r = diagnoseFailureDomain({ failure_class: 'PROVIDER_FAILURE' });
		expect(r.failure_domain).toBe('EXECUTION');
	});

	it('SECURITY_BLOCK_ROUTING_OVERRIDE_REJECTED', () => {
		const r = decideRouting({
			failure_class: 'SECURITY_BLOCK',
			failure_domain: 'UNKNOWN',
			evidence_refs: [],
			sample_size: 10,
			threshold: 3,
			isSecurityBlock: true,
		});
		expect(r.routing_action).toBe('NO_RETRY');
	});

	it('ESCALATION_PERMISSION_EXPANSION_REJECTED — kernel ∩ profile', async () => {
		const { intersectPermissions } = await import('@positron/control-plane');
		const kernel = {
			mutation: true,
			push: false,
			merge: false,
			deploy: false,
			secret_access: false,
		};
		const profile = { mutation: true, push: true, merge: true, deploy: true, secret_access: true };
		const eff = intersectPermissions(kernel, profile);
		expect(eff.push).toBe(false);
		expect(eff.merge).toBe(false);
		expect(eff.deploy).toBe(false);
		expect(eff.secret_access).toBe(false);
	});

	it('DUPLICATE_ROUTING_DECISION_NO_DUPLICATE_EFFECT', () => {
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
		expect(r1.routing_action).toBe('RETRY_WITH_STRATEGY_DELTA');
	});
});
