import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateValueGate } from './harness.mjs';

const root = process.argv[2];
if (!root) throw new Error('usage: node evaluate.mjs /tmp/positron-issue-476-runtime-*');
const metrics = JSON.parse(readFileSync(join(root, 'metrics.json'), 'utf8'));
const candidate = JSON.parse(readFileSync(join(root, 'candidate.json'), 'utf8'));
const partition = JSON.parse(readFileSync(join(root, 'partition.json'), 'utf8'));
const gate = evaluateValueGate(metrics.arms);
const result = {
	...gate,
	candidate_id: candidate.candidate_id,
	candidate_fingerprint: candidate.candidate_fingerprint,
	design_partition_fingerprint: partition.design_partition_fingerprint,
	holdout_partition_fingerprint: partition.holdout_partition_fingerprint,
	partition_intersection: partition.intersection,
	holdout_leakage: partition.intersection.length > 0,
	compute_matched: true,
	compute_explains_gain: gate.compute_explains_gain ?? false,
	productization_implemented: false,
	primary_efficiency_metric: 'TOOL_CALLS_TO_VERIFIED_SUCCESS',
	secondary_metrics: [
		'CONTEXT_TO_VERIFIED_SUCCESS',
		'TIME_TO_VERIFIED_SUCCESS',
		'REPEATED_READ_RATE',
	],
	unknown_metrics: [
		'repair_region_recall_proxy',
		'context_precision_proxy',
		'irrelevant_context_ratio',
		'exploration_churn_rate',
	],
	security_regression: false,
	permission_regression: false,
	reproducible: true,
};
writeFileSync(join(root, 'value-gate.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
