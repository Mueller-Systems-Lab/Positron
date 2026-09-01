import { createHash } from 'node:crypto';

export const EXPERIMENT_ID = 'positron-exploration-replication-480-v1';
export const CANDIDATE_ID = 'PROGRESSIVE_LOCALIZATION_V1';
export const CANDIDATE_VERSION = '1.0.0';
export const MODEL = 'opencode/mimo-v2.5-free';
export const OPENCODE_VERSION = '1.18.23';
export const MAX_STEPS = 12;
export const RETRIES = 0;
export const MIN_VALID = 5;
export const TASKS = [
	[
		'holdout-480-1-parse-duration',
		'export function parseDuration(v){const n=Number(v);return Number.isFinite(n)&&n>=0?Math.floor(n):0;}',
		'export function parseDuration(v){return Number(v);}',
		[
			['0', 0],
			['12.9', 12],
			['bad', 0],
		],
	],
	[
		'holdout-480-2-normalize-path',
		"export function normalizePath(v){return String(v).trim().replaceAll('\\\\','/').replaceAll(/\\/{2,}/g,'/');}",
		"export function normalizePath(v){return String(v).replaceAll('\\\\','/');}",
		[
			['  a\\\\b  ', 'a/b'],
			['a//b', 'a/b'],
		],
	],
	[
		'holdout-480-3-clamp-score',
		'export function clampScore(v){const n=Number(v);if(!Number.isFinite(n))return 0;return Math.max(0,Math.min(1,n));}',
		'export function clampScore(v){const n=Number(v);return Math.min(1,n);}',
		[
			['x', 0],
			[-1, 0],
			[2, 1],
		],
	],
	[
		'holdout-480-4-parse-header',
		"export function parseHeader(v){const s=String(v);const i=s.indexOf(':');return i<0?null:[s.slice(0,i).trim(),s.slice(i+1).trim()];}",
		"export function parseHeader(v){const s=String(v);const i=s.indexOf(':');return [s.slice(0,i),s.slice(i+1)];}",
		[
			['x:y', ['x', 'y']],
			['missing', null],
		],
	],
	[
		'holdout-480-5-safe-join',
		"export function safeJoin(a,b){return [String(a).replace(/\\/+$/,''),String(b).replace(/^\\/+/, '')].join('/');}",
		"export function safeJoin(a,b){return String(a)+'/'+String(b);}",
		[
			['a/', '/b', 'a/b'],
			['a', 'b', 'a/b'],
		],
	],
	[
		'holdout-480-6-parse-list',
		"export function parseList(v){return String(v).split(',').map(x=>x.trim()).filter(Boolean);}",
		"export function parseList(v){return String(v).split(',');}",
		[
			[' a, b ', ['a', 'b']],
			['', []],
		],
	],
].map(([id, good, bad, cases]) => ({
	id,
	name: id.replace(/^holdout-480-\d+-/, ''),
	source: good,
	buggySource: bad,
	cases,
}));

export const CALIBRATION_TASKS = [
	{ id: 'calibration-480-1-boundary', name: 'calibration-boundary' },
	{ id: 'calibration-480-2-import', name: 'calibration-import' },
	{ id: 'calibration-480-3-verification', name: 'calibration-verification' },
];

export function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object')
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
			.join(',')}}`;
	return JSON.stringify(value);
}
export function sha256(value) {
	return createHash('sha256')
		.update(typeof value === 'string' ? value : canonical(value))
		.digest('hex');
}
export function buildCandidate() {
	const body = {
		candidate_id: CANDIDATE_ID,
		candidate_version: CANDIDATE_VERSION,
		strategy_kind: 'EXPLORATION_CONTEXT',
		strategy_steps: [
			'inspect the failing test signal first',
			'localize the imported symbol and implementation before broad search',
			'admit only high-confidence files/regions',
			'suppress identical reads and widen only when evidence requires it',
		],
		max_steps: MAX_STEPS,
		permissions: 'IDENTICAL_TO_BASELINE',
		model: MODEL,
		verification: 'IDENTICAL_EXTERNAL_NPM_TEST',
	};
	return { ...body, candidate_fingerprint: sha256(body) };
}
export function partition(items) {
	return items.map(({ id, name }) => ({ id, fingerprint: sha256({ id, name }) }));
}
export function median(values) {
	const a = values.filter(Number.isFinite).sort((x, y) => x - y);
	if (!a.length) return null;
	const m = Math.floor(a.length / 2);
	return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
export function telemetry(events, meta, verified, elapsed) {
	const tools = events
			.filter((e) => e?.type === 'tool_use')
			.map((e) => e.part?.tool)
			.filter(Boolean),
		reads = tools.filter((x) => x === 'read');
	const paths = events
		.filter((e) => e?.type === 'tool_use' && e.part?.tool === 'read')
		.map((e) => e.part?.state?.input?.filePath)
		.filter((x) => typeof x === 'string');
	const unique = [...new Set(paths)],
		patch = events.find(
			(e) => e?.type === 'tool_use' && ['edit', 'write', 'apply_patch'].includes(e.part?.tool),
		);
	const first = events.find((e) => Number.isFinite(e?.timestamp));
	const toks = events
		.filter((e) => e?.type === 'step_finish')
		.map((e) => e.part?.tokens?.total)
		.filter(Number.isFinite);
	const errors = events.filter((e) => e?.type === 'error');
	return {
		valid: meta.cli_exit === 0 && meta.verification_exit === 0 && errors.length === 0,
		verified_success: verified,
		first_pass_success: verified,
		termination_reason: meta.termination_reason ?? null,
		termination_authority: meta.termination_authority ?? null,
		tool_calls_to_verified_success: verified ? tools.length : null,
		tool_calls: tools.length,
		search_calls: tools.filter((x) => ['glob', 'grep', 'search'].includes(x)).length,
		read_calls: reads.length,
		unique_files: unique.length,
		unique_regions: unique.length,
		repeated_reads: Math.max(0, paths.length - unique.length),
		context_tokens: toks.length ? Math.max(...toks) : null,
		elapsed_ms: elapsed,
		time_to_first_patch: patch && first ? patch.timestamp - first.timestamp : null,
		time_to_verified_success: verified ? elapsed : null,
	};
}
export function aggregate(rows) {
	const valid = rows.filter((x) => x.valid),
		success = valid.filter((x) => x.verified_success),
		nums = (k) => success.map((x) => x[k]).filter(Number.isFinite);
	return {
		submitted: rows.length,
		valid: valid.length,
		verified_success: success.length,
		verified_success_rate: valid.length ? success.length / valid.length : null,
		first_pass: success.filter((x) => x.first_pass_success).length,
		median_tool_calls: median(nums('tool_calls_to_verified_success')),
		median_context: median(nums('context_tokens')),
		median_time: median(nums('time_to_verified_success')),
		median_search_calls: median(nums('search_calls')),
		median_read_calls: median(nums('read_calls')),
		median_unique_files: median(nums('unique_files')),
		failure_reasons: Object.fromEntries(
			[
				...new Set(
					rows
						.filter((x) => !x.valid || !x.verified_success)
						.map((x) => x.termination_reason || x.failure_class)
						.filter(Boolean),
				),
			].map((k) => [k, rows.filter((x) => (x.termination_reason || x.failure_class) === k).length]),
		),
	};
}
export function negativeCanary() {
	return {
		candidate_id: 'BROAD_REPETITIVE_CONTEXT',
		rejected: true,
		reason_code: 'EXCESSIVE_CONTEXT_OR_REPEATED_READS',
		workspace_mutated: false,
	};
}
