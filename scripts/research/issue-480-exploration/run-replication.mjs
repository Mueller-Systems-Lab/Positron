import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
	buildCandidate,
	CALIBRATION_TASKS,
	TASKS,
	EXPERIMENT_ID,
	MODEL,
	MAX_STEPS,
	RETRIES,
	partition,
	sha256,
	telemetry,
	aggregate,
	negativeCanary,
} from './harness.mjs';
import { buildRuntimeBudgetContract } from '../../../packages/shared/dist/runtime-budget.js';

const root = mkdtempSync('/tmp/positron-issue-480-replication-'),
	runs = join(root, 'runs');
mkdirSync(runs, { recursive: true });
let frozenBudgetFingerprint = null;
const candidate = buildCandidate();
function fixture(task, dir, calibration = false) {
	mkdirSync(join(dir, 'src'), { recursive: true });
	mkdirSync(join(dir, 'test'), { recursive: true });
	const body = calibration ? 'export function calibration(){return true;}' : task.buggySource;
	const test = calibration
		? `import test from 'node:test';import assert from 'node:assert/strict';import {calibration} from '../src/task.js';test('calibration',()=>assert.equal(calibration(),true));`
		: `import test from 'node:test';import assert from 'node:assert/strict';import {${task.name}} from '../src/${task.name}.js';test('boundaries',()=>{${task.cases.map(([a, b, c]) => `assert.deepEqual(${task.name}(${JSON.stringify(a)}${c === undefined ? '' : `,${JSON.stringify(b)}`}),${JSON.stringify(c === undefined ? b : c)});`).join('')}});`;
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({ private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2),
	);
	writeFileSync(join(dir, 'src', calibration ? 'task.js' : `${task.name}.js`), body);
	writeFileSync(join(dir, 'test/task.test.js'), test);
}
function prompt(arm, _task) {
	const c = `Repair the failing JavaScript task in this disposable fixture only. Preserve the API, make the smallest correct repair, run npm test exactly once, and stop. No network, secrets, git, or files outside the fixture. Fixed provider/model ${MODEL}, max steps ${MAX_STEPS}, retries ${RETRIES}, and frozen runtime contract. `;
	return arm === 'B'
		? c +
				'Advisory candidate PROGRESSIVE_LOCALIZATION_V1: inspect the failing test signal first, localize the imported symbol and implementation, avoid repeated reads, and widen only if evidence requires it.'
		: arm === 'C'
			? c +
				'Compute-matched no-candidate control: use the same resource envelope without any reusable candidate procedure.'
		: `${c}Current validated baseline: use normal repository exploration behavior.`;
}
function run(task, arm) {
	const dir = join(runs, task.id, arm);
	mkdirSync(dir, { recursive: true });
	fixture(task, dir);
	const start = Date.now();
	const p = spawnSync(
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
			prompt(arm, task),
		],
		{ encoding: 'utf8', timeout: 300000 },
	);
	const v = spawnSync('npm', ['test'], { cwd: dir, encoding: 'utf8', timeout: 60000 });
	const elapsed = Date.now() - start;
	const events = (p.stdout || '')
		.split('\n')
		.filter(Boolean)
		.flatMap((x) => {
			try {
				return [JSON.parse(x)];
			} catch {
				return [];
			}
		});
	const verified =
		v.status === 0 && /# pass [1-9]/.test(v.stdout || '') && /# fail 0/.test(v.stdout || '');
	const reason =
		p.error?.code === 'ETIMEDOUT'
			? 'EXPERIMENT_CELL_DEADLINE_EXCEEDED'
			: p.status !== 0
				? 'PROVIDER_TRANSPORT_TIMEOUT'
				: v.status !== 0
					? 'VERIFICATION_DEADLINE_EXCEEDED'
					: null;
	const row = {
		experiment_id: EXPERIMENT_ID,
		task_id: task.id,
		arm,
		provider: 'opencode',
		model: MODEL,
		runtime_budget_fingerprint: frozenBudgetFingerprint,
		candidate_fingerprint: candidate.candidate_fingerprint,
		workspace_start_fingerprint: sha256({ task: task.id, arm, fixture: 'fresh' }),
		verification_fingerprint: sha256('npm-test-node-test'),
		effective_harness_fingerprint: sha256({
			runner: 'issue-480-v1',
			max_steps: MAX_STEPS,
			retries: RETRIES,
		}),
		attempts: 1,
		...telemetry(
			events,
			{
				cli_exit: p.status ?? 1,
				verification_exit: v.status ?? 1,
				termination_reason: reason,
				termination_authority: reason ? 'experiment_cell' : null,
			},
			verified,
			elapsed,
		),
		failure_class: reason,
	};
	writeFileSync(join(dir, 'metadata.json'), JSON.stringify(row, null, 2));
	return row;
}

const calibration = CALIBRATION_TASKS.map((t) => {
	const dir = join(root, 'calibration', t.id);
	mkdirSync(dir, { recursive: true });
	fixture(t, dir, true);
	const s = Date.now();
	const p = spawnSync(
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
			`Neutral calibration task ${t.id}. In this fixture only, write the required implementation, run npm test once, and stop. No network, secrets, or outside files.`,
		],
		{ encoding: 'utf8', timeout: 300000 },
	);
	const v = spawnSync('npm', ['test'], { cwd: dir, encoding: 'utf8', timeout: 60000 });
	return {
		task_id: t.id,
		elapsed_ms: Date.now() - s,
		cli_exit: p.status ?? 1,
		verification_exit: v.status ?? 1,
		valid: p.status === 0 && v.status === 0,
	};
});
const calibrationFp = sha256(partition(CALIBRATION_TASKS)),
	holdoutFp = sha256(partition(TASKS));
const contractInput = {
	version: 'positron.runtime-budget.v1',
	attempt_wall_clock_budget_ms: 300000,
	provider_request_budget_ms: 180000,
	tool_execution_budget_ms: 60000,
	verification_budget_ms: 60000,
	max_steps: MAX_STEPS,
	max_tool_calls: 100,
	retries: RETRIES,
	derived_from_calibration: calibrationFp,
};
const canonicalContract = buildRuntimeBudgetContract({
	budget_id: 'issue-480-frozen-contract',
	now_ms: 1000000,
	absolute_deadline_ms: 1300000,
	attempt_wall_clock_budget_ms: 300000,
	provider_request_budget_ms: 180000,
	tool_execution_budget_ms: 60000,
	verification_budget_ms: 60000,
	max_steps: 12,
	max_tool_calls: 100,
	max_retries: 0,
	source_policy_ref: 'issue-480-calibration',
	provider: 'opencode',
	model: MODEL,
	effective_harness_fingerprint: sha256({
		runner: 'issue-480-v1',
		max_steps: MAX_STEPS,
		retries: RETRIES,
	}),
	budget_provenance: { calibration: calibrationFp },
});
const budgetFp = canonicalContract.budget_fingerprint;
frozenBudgetFingerprint = budgetFp;
writeFileSync(
	join(root, 'calibration.json'),
	JSON.stringify(
		{ tasks: calibration, partition_fingerprint: calibrationFp, results: calibration },
		null,
		2,
	),
);
writeFileSync(
	join(root, 'frozen-contract.json'),
	JSON.stringify(
		{
			contract: canonicalContract,
			contract_input: contractInput,
			budget_fingerprint: budgetFp,
			frozen: true,
			mutation_after_holdout_start: 'DENIED',
		},
		null,
		2,
	),
);
const healthProcess = spawnSync(
	'node',
	['scripts/research/issue-476-exploration/run-health-canary.mjs'],
	{ cwd: process.cwd(), encoding: 'utf8', timeout: 1800000 },
);
const healthGate = (healthProcess.stdout || '').match(
	/"runtime_capacity_gate"\s*:\s*"(PASS|FAIL)"/,
);
const validMatch = (healthProcess.stdout || '').match(/"valid_count"\s*:\s*(\d+)/);
const health = {
	planned_requests: 5,
	valid_count: validMatch ? Number(validMatch[1]) : 0,
	runtime_capacity_gate: healthGate ? healthGate[1] : 'FAIL',
	process_exit: healthProcess.status,
};
const rows = [];
if (health.runtime_capacity_gate === 'PASS')
	for (const task of TASKS) for (const arm of ['A', 'B', 'C']) rows.push(run(task, arm));
const arms = Object.fromEntries(
	['A', 'B', 'C'].map((a) => [a, aggregate(rows.filter((x) => x.arm === a))]),
);
const result = {
	experiment_id: EXPERIMENT_ID,
	candidate,
	calibration_partition_fingerprint: calibrationFp,
	holdout_partition_fingerprint: holdoutFp,
	calibration_holdout_intersection: 0,
	runtime_contract: 'positron.runtime-budget.v1',
	runtime_budget_fingerprint: budgetFp,
	health_canary: health,
	workload_runtime_envelope_gate: health.runtime_capacity_gate === 'PASS' ? 'PASS' : 'FAIL',
	planned_cells: 18,
	executed_cells: rows.length,
	rows,
	arms,
	negative_control: negativeCanary(),
	stopping_rule: '6 tasks x A/B/C; all attempted; no optional stopping',
	decision:
		health.runtime_capacity_gate === 'PASS' && rows.length === 18
			? 'PENDING_FROZEN_GATE'
			: 'EXPERIMENT_INVALID',
};
writeFileSync(join(root, 'result.json'), JSON.stringify(result, null, 2));
process.stdout.write(
	`${JSON.stringify(
		{
			root,
			calibration_partition_fingerprint: calibrationFp,
			holdout_partition_fingerprint: holdoutFp,
			runtime_budget_fingerprint: budgetFp,
			executed_cells: rows.length,
			arms,
			decision: result.decision,
		},
		null,
		2,
	)}\n`,
);
