import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const HEALTH_CANARY_REQUESTS = 5;
export const HEALTH_CANARY_TIMEOUT_MS = 180_000;
export const HEALTH_CANARY_MODEL = 'opencode/mimo-v2.5-free';
export const HEALTH_CANARY_OPENCODE_VERSION = '1.18.23';

const root = mkdtempSync('/tmp/positron-issue-476-health-');
const requestsRoot = join(root, 'requests');
mkdirSync(requestsRoot, { recursive: true });

function prepareFixture(requestId, dir) {
	mkdirSync(join(dir, 'test'), { recursive: true });
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify(
			{
				name: `issue-476-health-${requestId}`,
				private: true,
				type: 'module',
				scripts: { test: 'node --test' },
			},
			null,
			2,
		),
	);
	writeFileSync(
		join(dir, 'test/canary.test.js'),
		`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\n\ntest('health marker is present', () => {\n\tassert.equal(readFileSync(new URL('../canary.txt', import.meta.url), 'utf8'), 'health-${requestId}\\n');\n});\n`,
	);
}

function runRequest(requestId) {
	const dir = join(requestsRoot, requestId);
	const logPath = join(root, `${requestId}.jsonl`);
	mkdirSync(dir, { recursive: true });
	prepareFixture(requestId, dir);
	const prompt = `This is a neutral runtime health canary ${requestId}, not a repository task and not an evaluation arm. In this disposable fixture only, use the write tool to create canary.txt with exactly health-${requestId} followed by a newline. Do not inspect or modify files outside this fixture, do not use network, git, secrets, candidate strategies, or holdout tasks, and stop after the write succeeds. The declared provider/model is ${HEALTH_CANARY_MODEL}, OpenCode ${HEALTH_CANARY_OPENCODE_VERSION}, and the frozen request timeout is ${HEALTH_CANARY_TIMEOUT_MS}ms.`;
	const started = Date.now();
	const result = spawnSync(
		'opencode',
		[
			'run',
			'--dir',
			dir,
			'--model',
			HEALTH_CANARY_MODEL,
			'--agent',
			'build',
			'--auto',
			'--format',
			'json',
			prompt,
		],
		{ encoding: 'utf8', timeout: HEALTH_CANARY_TIMEOUT_MS },
	);
	const elapsedMs = Date.now() - started;
	writeFileSync(logPath, result.stdout ?? '');
	const events = (result.stdout ?? '')
		.split('\n')
		.filter(Boolean)
		.flatMap((line) => {
			try {
				return [JSON.parse(line)];
			} catch {
				return [];
			}
		});
	const tools = events
		.filter((event) => event?.type === 'tool_use')
		.map((event) => event.part?.tool);
	const errors = events.filter((event) => event?.type === 'error');
	const verification = spawnSync('npm', ['test'], {
		cwd: dir,
		encoding: 'utf8',
		timeout: 60_000,
	});
	const valid =
		result.status === 0 &&
		result.signal === null &&
		elapsedMs <= HEALTH_CANARY_TIMEOUT_MS &&
		errors.length === 0 &&
		tools.includes('write') &&
		verification.status === 0;
	return {
		request_id: requestId,
		provider: 'opencode-zen',
		model: HEALTH_CANARY_MODEL,
		opencode_version: HEALTH_CANARY_OPENCODE_VERSION,
		elapsed_ms: elapsedMs,
		cli_exit: result.status,
		termination_signal: result.signal,
		verification_exit: verification.status,
		tool_path_operational: tools.includes('write'),
		error_events: errors.length,
		valid,
		failure_class: valid
			? null
			: result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM'
				? 'TIMEOUT'
				: verification.status !== 0
					? 'VERIFICATION_FAILURE'
					: errors.length
						? 'OPENCODE_PROVIDER_OR_RUNTIME_ERROR'
						: 'UNKNOWN_RUNTIME_FAILURE',
	};
}

const rows = [];
for (let index = 1; index <= HEALTH_CANARY_REQUESTS; index += 1) {
	const row = runRequest(`canary-${index}`);
	rows.push(row);
	process.stdout.write(`${JSON.stringify(row)}\n`);
}

const validCount = rows.filter((row) => row.valid).length;
const timeoutCount = rows.filter((row) => row.failure_class === 'TIMEOUT').length;
const authOrHarnessFailure = rows.some((row) =>
	['AUTH_FAILURE', 'POSITRON_HARNESS_FAILURE'].includes(row.failure_class),
);
const result = {
	root,
	planned_requests: HEALTH_CANARY_REQUESTS,
	completed_requests: rows.length,
	rows,
	valid_count: validCount,
	no_systematic_timeout_pattern: timeoutCount < 3,
	no_auth_failure: !authOrHarnessFailure,
	no_harness_failure: !authOrHarnessFailure,
	runtime_capacity_gate:
		validCount >= 4 && timeoutCount < 3 && !authOrHarnessFailure ? 'PASS' : 'FAIL',
};
writeFileSync(join(root, 'health-canary.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ root, ...result }, null, 2)}\n`);
