#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
	console.error('usage: select-review-model <provider-inventory.json>');
	process.exit(2);
}

const document = JSON.parse(readFileSync(path, 'utf8'));
const models = Array.isArray(document) ? document : document.models;
if (!Array.isArray(models)) throw new Error('inventory must contain a models array');

const eligible = models.filter(
	(model) =>
		model.AVAILABLE === true &&
		model.CONNECTED === true &&
		model.DEEPSEEK === false &&
		(model.LOCAL === true || (model.INPUT_COST === 0 && model.OUTPUT_COST === 0)) &&
		model.PROBE_STATUS === 'WORKING',
);

const priority = (model) => {
	const name = model.MODEL;
	if (name === 'opencode/mimo-v2.5-free') return 0;
	if (/nemotron-3-super.*:free$/i.test(name)) return 1;
	if (name === 'opencode/big-pickle') return 2;
	if (model.LOCAL === true) return 4;
	return 3;
};

eligible.sort(
	(left, right) => priority(left) - priority(right) || left.MODEL.localeCompare(right.MODEL),
);
if (eligible.length === 0) {
	console.error('NO_ELIGIBLE_WORKING_ZERO_COST_OR_LOCAL_MODEL');
	process.exit(1);
}

process.stdout.write(
	`${JSON.stringify(
		{
			selected: eligible[0].MODEL,
			selection_reason: 'first working candidate in deterministic zero-cost/local priority order',
			eligible_models: eligible.map((model) => model.MODEL),
		},
		null,
		2,
	)}\n`,
);
