#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

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
const dangerous = [
	'gh api *',
	'gh pr merge *',
	'gh pr review *',
	'gh repo create *',
	'gh repo delete *',
	'gh repo edit *',
	'gh workflow *',
	'gh secret *',
	'gh variable *',
	'gh release *',
	'git push *',
	'git branch -d *',
	'git branch -D *',
];
const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

assert(
	config.agent?.['issue-orchestrator']?.mode === 'primary',
	'issue-orchestrator must be primary',
);
const controller = config.agent['issue-orchestrator'];
const taskRules = controller.permission?.task ?? {};
assert(taskRules['*'] === 'deny', 'controller task wildcard must deny');
assert(
	JSON.stringify(
		Object.keys(taskRules)
			.filter((key) => taskRules[key] === 'allow')
			.sort(),
	) === JSON.stringify([...required].sort()),
	'controller task allowlist must equal required reviewer IDs',
);
assert(controller.permission?.['github_*'] === 'deny', 'controller GitHub wildcard must deny');
for (const command of dangerous)
	assert(controller.permission?.bash?.[command] === 'deny', `controller deny missing: ${command}`);

for (const id of required) {
	const agent = config.agent[id];
	assert(agent, `required agent missing: ${id}`);
	assert(agent.mode === 'subagent', `${id} must be a subagent`);
	assert(agent.description, `${id} description missing`);
	assert(agent.prompt, `${id} system prompt missing`);
	assert(agent.model && !/deepseek/i.test(agent.model), `${id} has a forbidden model`);
	assert(agent.permission?.edit === 'deny', `${id} edit permission must deny`);
	assert(agent.permission?.write === 'deny', `${id} write permission must deny`);
	assert(agent.permission?.task?.['*'] === 'deny', `${id} task permission must deny`);
	assert(agent.permission?.['github_*'] === 'deny', `${id} GitHub permission must deny`);
	for (const command of dangerous) {
		const bash = agent.permission?.bash;
		const explicit = typeof bash === 'object' ? bash[command] : bash;
		const covered = typeof bash === 'object' ? bash['*'] : bash;
		assert(explicit === 'deny' || covered === 'deny', `${id} deny missing: ${command}`);
	}
}

const listed = spawnSync('opencode', ['agent', 'list'], { encoding: 'utf8' });
assert(listed.status === 0, 'opencode agent list failed');
for (const id of ['build', 'plan', 'general', 'explore'])
	assert(new RegExp(`^${id} \\(`, 'm').test(listed.stdout), `built-in agent not discovered: ${id}`);

for (const id of ['issue-orchestrator', ...required]) {
	const debug = spawnSync('opencode', ['debug', 'agent', id], { encoding: 'utf8' });
	assert(debug.status === 0, `opencode debug agent failed: ${id}`);
	const resolved = JSON.parse(debug.stdout);
	assert(
		resolved.mode === (id === 'issue-orchestrator' ? 'primary' : 'subagent'),
		`${id} mode is not resolved correctly`,
	);
	const rules = resolved.permission ?? [];
	const resolve = (permission, resource = '*') =>
		rules
			.filter(
				(rule) =>
					rule.permission === permission && (rule.pattern === '*' || rule.pattern === resource),
			)
			.at(-1)?.action;
	if (id !== 'issue-orchestrator') {
		assert(
			resolve('edit') === 'deny' && resolve('write') === 'deny',
			`${id} write boundary is not effective`,
		);
		assert(resolve('task', 'review-security') === 'deny', `${id} task boundary is not effective`);
		assert(resolve('github_*', 'github_any') === 'deny', `${id} GitHub boundary is not effective`);
		assert(
			resolve('bash', 'git push origin forbidden') === 'deny',
			`${id} shell boundary is not effective`,
		);
	}
}

process.stdout.write(
	`${[
		`AGENT_CONFIG_REGRESSION=PASS required=${required.length}`,
		'CONTROLLER_ALLOWLIST=PASS',
		'REVIEWER_READ_ONLY_PERMISSIONS=PASS',
		'REVIEWER_NESTED_TASK_DENY=PASS',
		'HARD_DENY_MATRIX=PASS',
		'DEEPSEEK_CONFIGURED_FOR_REQUIRED_AGENTS=0',
		'BUILT_IN_INVENTORY=build,plan,general,explore',
	].join('\n')}\n`,
);
