#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const runner = readFileSync('scripts/run-reviewer-session.mjs', 'utf8');
const config = JSON.parse(readFileSync('.opencode/opencode.json', 'utf8'));
const required = [
	'audit-repository-reality',
	'audit-repository-hygiene',
	'review-architecture',
	'review-security',
	'review-devex-installer',
	'review-docker-infrastructure',
	'review-frontend-landing',
	'review-ux-accessibility',
	'review-visual-qa',
	'review-documentation-truth',
	'review-github-pages',
	'review-test-tooling',
	'review-integration',
	'review-release-packaging',
	'review-governance',
	'research-official-docs',
	'review-independent-final',
];
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

assert(runner.includes("readOption('--backend', 'AUTO')"), 'AUTO must be the default backend');
assert(runner.includes("'--agent'"), 'isolated invocation must select the exact reviewer agent');
assert(runner.includes("'--model'"), 'runtime model must be explicit');
assert(
	runner.includes("selectedBackend = 'ISOLATED'"),
	'AUTO must explicitly record isolated fallback',
);
assert(runner.includes('CHILD_ATTEMPT'), 'fallback reason must be recorded');
assert(!runner.includes('--continue'), 'reviewer sessions may not be resumed');
assert(!runner.includes('--session'), 'reviewer sessions may not reuse a session');

for (const id of required) {
	const agent = config.agent?.[id];
	assert(agent?.mode === 'all', `${id} must support isolated direct execution`);
	assert(!('model' in agent), `${id} must inherit the runtime model`);
	assert(agent.permission?.edit === 'deny', `${id} edit must remain denied`);
	assert(agent.permission?.write === 'deny', `${id} write must remain denied`);
	assert(agent.permission?.task?.['*'] === 'deny', `${id} nested task must remain denied`);
	assert(agent.permission?.['github_*'] === 'deny', `${id} GitHub mutation must remain denied`);
}

process.stdout.write(
	[
		'REVIEW_EXECUTION_REGRESSION=PASS',
		'BACKENDS=AUTO,CHILD,ISOLATED',
		'REVIEWER_MODE_ALL_MUTATION_EXPANSION=0',
		'NO_SESSION_REUSE=PASS',
		`REQUIRED_REVIEWERS=${required.length}`,
	].join('\n') + '\n',
);
