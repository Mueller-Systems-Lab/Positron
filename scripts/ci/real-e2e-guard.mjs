#!/usr/bin/env node

const required = {
	POSITRON_GITHUB_MODE: 'real',
	POSITRON_OPENCODE_MODE: 'real',
	POSITRON_SPECKIT_MODE: 'real',
};

for (const [name, expected] of Object.entries(required)) {
	if (process.env[name] !== expected) {
		throw new Error(`REAL_E2E_FAIL_CLOSED: ${name} must be ${expected}`);
	}
}

if (process.env.POSITRON_DISABLE_QUEUE === 'true') {
	throw new Error('REAL_E2E_FAIL_CLOSED: POSITRON_DISABLE_QUEUE=true selects the inline bypass');
}

for (const name of [
	'POSITRON_WORKSPACE_ROOT',
	'POSITRON_REPO_OWNER',
	'POSITRON_REPO_NAME',
	'REAL_E2E_ISSUE_URL',
	'REAL_E2E_CANARY_VALUE',
]) {
	if (!process.env[name]?.trim()) throw new Error(`REAL_E2E_FAIL_CLOSED: ${name} is required`);
}

if (!process.env.POSITRON_OPENCODE_MODEL?.trim()) {
	throw new Error('REAL_E2E_FAIL_CLOSED: POSITRON_OPENCODE_MODEL is required');
}

console.log('REAL_E2E_FAIL_CLOSED=PASS');
console.log('BROWSER_E2E_MODE=REAL_PRODUCT');
console.log('GITHUB_EFFECT=REAL_SANDBOX');
console.log('OPENCODE_EFFECT=REAL');
console.log('SPECKIT_EFFECT=REAL');
console.log('QUEUE_PATH=REAL_BULLMQ');
