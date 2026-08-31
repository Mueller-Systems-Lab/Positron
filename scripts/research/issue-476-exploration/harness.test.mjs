import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidate, buildPartition, evaluateValueGate, negativeCanary, sha256 } from './harness.mjs';

test('candidate fingerprint is deterministic and excludes runtime state', () => {
	const first = buildCandidate();
	const second = buildCandidate();
	assert.equal(first.candidate_fingerprint, second.candidate_fingerprint);
	assert.match(first.candidate_fingerprint, /^[0-9a-f]{64}$/);
	assert.notEqual(first.candidate_fingerprint, sha256({ ...first, context_budget: first.context_budget + 1 }));
});

test('design and holdout partitions are frozen and disjoint', () => {
	const partition = buildPartition();
	assert.deepEqual(partition.intersection, []);
	assert.equal(partition.frozen_before_holdout, true);
	assert.match(partition.design_partition_fingerprint, /^[0-9a-f]{64}$/);
	assert.match(partition.holdout_partition_fingerprint, /^[0-9a-f]{64}$/);
});

test('value gate is quality-first and requires both control comparisons', () => {
	const arm = (calls, success = 5) => ({ sample_size: 5, valid_runtime_attempts: 5, verified_success: success, verified_success_rate: success / 5, tool_calls_to_verified_success_median: calls });
	assert.equal(evaluateValueGate({ A: arm(10), B: arm(8), C: arm(10) }).classification, 'GREEN_POSITRON_EXPLORATION_EFFICIENCY_VALUE_PROVEN');
	assert.equal(evaluateValueGate({ A: arm(10), B: arm(8, 3), C: arm(10) }).classification, 'GREEN_POSITRON_EXPLORATION_OPTIMIZATION_REJECTED_QUALITY_REGRESSION');
	assert.equal(evaluateValueGate({ A: arm(8), B: arm(8), C: arm(7) }).classification, 'GREEN_POSITRON_EXPLORATION_OPTIMIZATION_REJECTED_NO_MARGINAL_VALUE');
});

test('negative broad/repetitive strategy is rejected without mutation', () => {
	const result = negativeCanary();
	assert.equal(result.rejected, true);
	assert.equal(result.workspace_mutated, false);
});
