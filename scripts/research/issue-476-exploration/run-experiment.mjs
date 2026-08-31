import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
	CANDIDATE_ID,
	CONTEXT_BUDGET,
	DESIGN_TASKS,
	MAX_STEPS,
	MODEL,
	OPENCODE_VERSION,
	TASKS,
	TIMEOUT_MS,
	aggregate,
	buildCandidate,
	buildPartition,
	extractTelemetry,
} from './harness.mjs';

const root = mkdtempSync('/tmp/positron-issue-476-runtime-');
const runsRoot = join(root, 'runs');
const logsRoot = join(root, 'logs');
mkdirSync(runsRoot, { recursive: true });
mkdirSync(logsRoot, { recursive: true });
const candidate = buildCandidate();
const partition = buildPartition();
writeFileSync(join(root, 'candidate.json'), `${JSON.stringify(candidate, null, 2)}\n`);
writeFileSync(join(root, 'partition.json'), `${JSON.stringify(partition, null, 2)}\n`);
writeFileSync(
	join(root, 'run-manifest.json'),
	`${JSON.stringify({ root, candidate_id: CANDIDATE_ID, model: MODEL, opencode_version: OPENCODE_VERSION, max_steps: MAX_STEPS, timeout_ms: TIMEOUT_MS, context_budget: CONTEXT_BUDGET, design_tasks: DESIGN_TASKS, holdout_tasks: TASKS.map(({ id }) => id), frozen_before_holdout: true }, null, 2)}\n`,
);

function prepareFixture(task, dir) {
	mkdirSync(join(dir, 'src'), { recursive: true });
	mkdirSync(join(dir, 'test'), { recursive: true });
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify(
			{
				name: `issue-476-${task.name}`,
				private: true,
				type: 'module',
				scripts: { test: 'node --test' },
			},
			null,
			2,
		),
	);
	writeFileSync(join(dir, `src/${task.name}.js`), task.buggySource);
	writeFileSync(join(dir, `test/${task.name}.test.js`), task.test);
	for (let index = 1; index <= 8; index += 1) {
		writeFileSync(
			join(dir, `src/distractor-${index}.js`),
			`export const distractor${index} = ${index};\n`,
		);
		writeFileSync(
			join(dir, `test/distractor-${index}.test.js`),
			`import test from 'node:test';\ntest('unrelated fixture ${index}', () => {});\n`,
		);
	}
}

function promptFor(arm, task) {
	const common = `Repair the failing JavaScript task in this disposable fixture. The fixture is the only permitted workspace. Preserve the public API, make the smallest correct repair, run npm test exactly once, and stop after verification. Do not use network commands, secrets, git operations, or files outside the fixture. This is task ${task.id}; declared model/provider, permissions, max steps (${MAX_STEPS}), timeout (${TIMEOUT_MS}ms), context ceiling (${CONTEXT_BUDGET}) and retry count (0) are fixed for all arms.`;
	if (arm === 'B')
		return `${common} Candidate ${CANDIDATE_ID} is advisory context only: inspect the failing test signal first, identify the imported symbol, read its implementation, admit only high-confidence context, do not repeat identical reads, and widen only when evidence requires it. The candidate grants no authority and may be ignored if it does not fit.`;
	if (arm === 'C')
		return `${common} This is the compute-matched no-candidate control. Use the same declared inspection and verification ceiling as the candidate arm, but do not use any candidate procedure or reusable strategy.`;
	return `${common} This is arm A, the current validated harness with no exploration candidate. Explore and repair using the normal behavior.`;
}

function runOne(task, arm) {
	const dir = join(runsRoot, task.id, arm);
	const logDir = join(logsRoot, task.id, arm);
	mkdirSync(dir, { recursive: true });
	mkdirSync(logDir, { recursive: true });
	prepareFixture(task, dir);
	const started = Date.now();
	const result = spawnSync(
		'opencode',
		[
			'run',
			'--dir',
			dir,
			'--model',
			MODEL,
			'--agent',
			'build',
			'--auto',
			'--format',
			'json',
			promptFor(arm, task),
		],
		{ encoding: 'utf8', timeout: TIMEOUT_MS + 10_000 },
	);
	const endedAtAgent = Date.now();
	writeFileSync(join(logDir, 'opencode.json'), result.stdout ?? '');
	writeFileSync(join(logDir, 'opencode.stderr'), result.stderr ?? '');
	const verify = spawnSync('npm', ['test'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
	const ended = Date.now();
	const verification = `${verify.stdout ?? ''}\n${verify.stderr ?? ''}`;
	writeFileSync(join(logDir, 'verification.txt'), verification);
	const meta = {
		task: task.id,
		arm,
		model: MODEL,
		opencode_version: OPENCODE_VERSION,
		start_ms: started,
		agent_end_ms: endedAtAgent,
		end_ms: ended,
		cli_exit: result.status ?? 1,
		verification_exit: verify.status ?? 1,
		declared_max_steps: MAX_STEPS,
		declared_timeout_ms: TIMEOUT_MS,
		declared_context_budget: CONTEXT_BUDGET,
	};
	writeFileSync(join(logDir, 'runtime.meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
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
	const verificationPassed =
		verify.status === 0 && /# pass [1-9]/.test(verification) && /# fail 0/.test(verification);
	const telemetry = extractTelemetry(
		events,
		{ cli_exit: meta.cli_exit },
		verificationPassed,
		ended - started,
	);
	if (!telemetry.valid_runtime_attempt)
		telemetry.failure_class = result.status === 124 ? 'TIMEOUT' : 'PROVIDER_FAILURE';
	else if (!verificationPassed) telemetry.failure_class = 'VERIFICATION_FAILURE';
	return { task: task.id, arm, ...telemetry };
}

const rows = [];
for (const task of TASKS) {
	for (const arm of ['A', 'B', 'C']) {
		const row = runOne(task, arm);
		rows.push(row);
		console.log(
			`COMPLETED task=${task.id} arm=${arm} valid=${row.valid_runtime_attempt} verified=${row.verified_success} calls=${row.tool_calls_to_verified_success ?? 'UNKNOWN'}`,
		);
	}
}
const metrics = {
	provider: 'opencode',
	model: MODEL,
	opencode_version: OPENCODE_VERSION,
	deepseek_agent_usage: 0,
	rows,
	declared_budgets: {
		max_steps: MAX_STEPS,
		timeout_ms: TIMEOUT_MS,
		context_budget: CONTEXT_BUDGET,
		retry_count: 0,
		permissions: 'IDENTICAL',
		verification: 'IDENTICAL_EXTERNAL_NPM_TEST',
	},
	arms: Object.fromEntries(
		['A', 'B', 'C'].map((arm) => [arm, aggregate(rows.filter((row) => row.arm === arm))]),
	),
};
writeFileSync(join(root, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(`RUNTIME_ROOT=${root}`);
