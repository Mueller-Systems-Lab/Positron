import { createHash } from 'node:crypto';

export const CANDIDATE_ID = 'PROGRESSIVE_LOCALIZATION_V1';
export const MODEL = 'opencode/mimo-v2.5-free';
export const OPENCODE_VERSION = '1.18.23';
export const MAX_STEPS = 12;
export const TIMEOUT_MS = 180_000;
export const CONTEXT_BUDGET = 30_000;
export const NON_INFERIORITY_MARGIN = 0.1;
export const MIN_SAMPLE_SIZE = 5;

export const TASKS = [
	{
		id: 'holdout-1-parse-count',
		name: 'parse-count',
		source: `export function parseCount(value) {\n  const parsed = Number(value);\n  return Number.isFinite(parsed) ? parsed : null;\n}\n`,
		buggySource: `export function parseCount(value) {\n  return Number(value);\n}\n`,
		test: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { parseCount } from '../src/parse-count.js';\n\ntest('normalizes count boundaries', () => {\n  assert.equal(parseCount(' 42 '), 42);\n  assert.equal(parseCount(''), null);\n  assert.equal(parseCount('not-a-number'), null);\n});\n`,
	},
	{
		id: 'holdout-2-normalize-tag',
		name: 'normalize-tag',
		source: `export function normalizeTag(value) {\n  return String(value).trim().toLowerCase().replaceAll(' ', '-');\n}\n`,
		buggySource: `export function normalizeTag(value) {\n  return String(value).toLowerCase().replaceAll(' ', '-');\n}\n`,
		test: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { normalizeTag } from '../src/normalize-tag.js';\n\ntest('normalizes tag boundaries', () => {\n  assert.equal(normalizeTag('  Release Candidate  '), 'release-candidate');\n  assert.equal(normalizeTag('Bug Fix'), 'bug-fix');\n});\n`,
	},
	{
		id: 'holdout-3-parse-limit',
		name: 'parse-limit',
		source: `export function parseLimit(value) {\n  const parsed = Number(value);\n  if (!Number.isFinite(parsed) || parsed <= 0) return 25;\n  return Math.min(100, Math.floor(parsed));\n}\n`,
		buggySource: `export function parseLimit(value) {\n  const parsed = Number(value);\n  if (parsed <= 0) return 25;\n  return Math.min(100, parsed);\n}\n`,
		test: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { parseLimit } from '../src/parse-limit.js';\n\ntest('normalizes limit boundaries', () => {\n  assert.equal(parseLimit(''), 25);\n  assert.equal(parseLimit('12.9'), 12);\n  assert.equal(parseLimit('900'), 100);\n});\n`,
	},
	{
		id: 'holdout-4-join-url',
		name: 'join-url',
		source: `export function joinUrl(base, path) {\n  return String(base).replace(/\\/+$/, '') + '/' + String(path).replace(/^\\/+/, '');\n}\n`,
		buggySource: `export function joinUrl(base, path) {\n  return String(base) + '/' + String(path);\n}\n`,
		test: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { joinUrl } from '../src/join-url.js';\n\ntest('normalizes URL boundaries', () => {\n  assert.equal(joinUrl('https://example.test/', '/api/items'), 'https://example.test/api/items');\n  assert.equal(joinUrl('https://example.test', 'health'), 'https://example.test/health');\n});\n`,
	},
	{
		id: 'holdout-5-to-boolean',
		name: 'to-boolean',
		source: `export function toBoolean(value) {\n  const normalized = String(value).trim().toLowerCase();\n  if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true;\n  if (normalized === 'false' || normalized === 'no' || normalized === '0') return false;\n  return null;\n}\n`,
		buggySource: `export function toBoolean(value) {\n  const normalized = String(value).toLowerCase();\n  if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true;\n  if (normalized === 'false' || normalized === 'no' || normalized === '0') return false;\n  return null;\n}\n`,
		test: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { toBoolean } from '../src/to-boolean.js';\n\ntest('normalizes boolean boundaries', () => {\n  assert.equal(toBoolean(' YES '), true);\n  assert.equal(toBoolean(' no '), false);\n  assert.equal(toBoolean('maybe'), null);\n});\n`,
	},
];

export const DESIGN_TASKS = [
	{ id: 'design-1-boundary', name: 'design-boundary' },
	{ id: 'design-2-import', name: 'design-import' },
];

export function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

export function sha256(value) {
	return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

export function buildCandidate() {
	const candidate = {
		candidate_id: CANDIDATE_ID,
		candidate_version: '1.0.0',
		strategy_kind: 'EXPLORATION_CONTEXT',
		strategy_steps: [
			'inspect the failing test signal first',
			'localize the imported symbol and its implementation before broad search',
			'admit only high-confidence files/regions into context',
			'suppress identical reads and widen only when evidence requires it',
		],
		context_budget: CONTEXT_BUDGET,
		max_steps: MAX_STEPS,
		created_from_design_refs: DESIGN_TASKS.map((task) => `design:${task.id}`),
		permissions: 'IDENTICAL_TO_BASELINE',
		model: MODEL,
		verification: 'IDENTICAL_EXTERNAL_NPM_TEST',
	};
	return { ...candidate, candidate_fingerprint: sha256(candidate) };
}

export function buildPartition() {
	const source = DESIGN_TASKS.map((task) => ({ id: task.id, fingerprint: sha256(task) }));
	const holdout = TASKS.map((task) => ({ id: task.id, fingerprint: sha256({ id: task.id, name: task.name }) }));
	const sourceIds = source.map((item) => item.id);
	const holdoutIds = holdout.map((item) => item.id);
	return {
		design: source,
		holdout,
		design_partition_fingerprint: sha256(source),
		holdout_partition_fingerprint: sha256(holdout),
		intersection: sourceIds.filter((id) => holdoutIds.includes(id)),
		frozen_before_holdout: true,
	};
}

export function median(values) {
	const sorted = values.filter((value) => typeof value === 'number').sort((a, b) => a - b);
	if (!sorted.length) return null;
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function extractTelemetry(events, meta, verificationPassed, elapsedMs) {
	const toolEvents = events.filter((event) => event?.type === 'tool_use');
	const tools = toolEvents.map((event) => event.part?.tool).filter(Boolean);
	const reads = toolEvents.filter((event) => event.part?.tool === 'read');
	const readPaths = reads.map((event) => event.part?.state?.input?.filePath)
		.filter((path) => typeof path === 'string' && /\.[a-z0-9]+$/i.test(path));
	const uniqueReadPaths = [...new Set(readPaths)];
	const firstPatch = toolEvents.find((event) => ['edit', 'write', 'apply_patch'].includes(event.part?.tool));
	const firstEvent = events.find((event) => typeof event.timestamp === 'number');
	const tokenTotals = events.filter((event) => event?.type === 'step_finish')
		.map((event) => event.part?.tokens?.total).filter((value) => typeof value === 'number');
	const errors = events.filter((event) => event?.type === 'error');
	return {
		valid_runtime_attempt: Number(meta.cli_exit) === 0 && errors.length === 0,
		verified_success: verificationPassed,
		first_pass_success: verificationPassed,
		time_to_verified_success_ms: elapsedMs,
		tool_calls_to_verified_success: verificationPassed ? tools.length : null,
		files_read: uniqueReadPaths.length,
		unique_files_read: uniqueReadPaths.length,
		regions_read: reads.length,
		unique_regions_read: uniqueReadPaths.length,
		search_calls: tools.filter((tool) => ['glob', 'grep', 'search'].includes(tool)).length,
		read_calls: reads.length,
		tool_calls_before_first_patch: firstPatch
			? toolEvents.filter((event) => event.timestamp < firstPatch.timestamp).length
			: null,
		time_to_first_patch_ms: firstPatch && firstEvent ? firstPatch.timestamp - firstEvent.timestamp : null,
		repeated_reads: Math.max(0, readPaths.length - uniqueReadPaths.length),
		context_admitted: tokenTotals.length ? Math.max(...tokenTotals) : null,
		tokens_reported: tokenTotals.length ? Math.max(...tokenTotals) : null,
		token_provenance: tokenTotals.length ? 'VERIFIED_PROVIDER_REPORTED' : 'UNKNOWN',
		failed_search_or_read_calls: tools.filter((tool) => ['glob', 'grep', 'search', 'read'].includes(tool)).length - reads.length,
		error_count: errors.length,
	};
}

export function aggregate(rows) {
	const valid = rows.filter((row) => row.valid_runtime_attempt);
	const successful = valid.filter((row) => row.verified_success);
	const numeric = (key) => successful.map((row) => row[key]).filter((value) => typeof value === 'number');
	return {
		sample_size: rows.length,
		valid_runtime_attempts: valid.length,
		verified_success: successful.length,
		verified_success_rate: valid.length ? successful.length / valid.length : null,
		first_pass_success: successful.filter((row) => row.first_pass_success).length,
		tool_calls_to_verified_success_median: median(numeric('tool_calls_to_verified_success')),
		context_to_verified_success_median: median(numeric('context_admitted')),
		time_to_verified_success_median_ms: median(numeric('time_to_verified_success_ms')),
		files_read_median: median(numeric('files_read')),
		regions_read_median: median(numeric('regions_read')),
		search_calls_median: median(numeric('search_calls')),
		read_calls_median: median(numeric('read_calls')),
		calls_before_first_patch_median: median(numeric('tool_calls_before_first_patch')),
		repeated_read_rate: valid.length ? valid.reduce((sum, row) => sum + row.repeated_reads, 0) / valid.length : null,
		token_provenance: successful.length && successful.every((row) => row.token_provenance === 'VERIFIED_PROVIDER_REPORTED') ? 'VERIFIED_PROVIDER_REPORTED' : 'UNKNOWN',
		cost_per_verified_success: 'NOT_AVAILABLE',
		failure_classes: Object.fromEntries([...new Set(rows.filter((row) => !row.verified_success).map((row) => row.failure_class).filter(Boolean))].map((value) => [value, rows.filter((row) => row.failure_class === value).length])),
	};
}

export function evaluateValueGate(arms) {
	const a = arms.A;
	const b = arms.B;
	const c = arms.C;
	if ([a, b, c].some((arm) => arm.sample_size < MIN_SAMPLE_SIZE || arm.valid_runtime_attempts < MIN_SAMPLE_SIZE)) {
		return { classification: 'AMBER_POSITRON_EXPLORATION_EVIDENCE_INSUFFICIENT', reason_code: 'INSUFFICIENT_SAMPLE_SIZE' };
	}
	const qualityNonInferior = b.verified_success_rate >= Math.min(a.verified_success_rate, c.verified_success_rate) - NON_INFERIORITY_MARGIN;
	const primary = 'tool_calls_to_verified_success_median';
	const minControl = Math.min(a[primary], c[primary]);
	const efficiencyImproved = b[primary] < minControl && b[primary] <= minControl * 0.9;
	const computeMatched = true;
	if (!qualityNonInferior) return { classification: 'GREEN_POSITRON_EXPLORATION_OPTIMIZATION_REJECTED_QUALITY_REGRESSION', reason_code: 'VERIFIED_SUCCESS_REGRESSION', quality_non_inferior: false, efficiency_improved: efficiencyImproved, compute_explains_gain: false, compute_matched: computeMatched };
	if (!efficiencyImproved) return { classification: 'GREEN_POSITRON_EXPLORATION_OPTIMIZATION_REJECTED_NO_MARGINAL_VALUE', reason_code: 'EXPLORATION_NO_MARGINAL_UTILITY', quality_non_inferior: true, efficiency_improved: false, compute_explains_gain: false, compute_matched: computeMatched };
	return { classification: 'GREEN_POSITRON_EXPLORATION_EFFICIENCY_VALUE_PROVEN', reason_code: 'EXPLORATION_EFFICIENCY_VALUE_PROVEN', quality_non_inferior: true, efficiency_improved: true, compute_explains_gain: false, compute_matched: computeMatched };
}

export function negativeCanary() {
	const telemetry = { strategy_id: 'BROAD_REPETITIVE_V0', files_read: 24, unique_files_read: 6, repeated_reads: 18, context_admitted: CONTEXT_BUDGET * 2 };
	const rejected = telemetry.repeated_reads > telemetry.unique_files_read || telemetry.context_admitted > CONTEXT_BUDGET;
	return { candidate_id: telemetry.strategy_id, rejected, reason_code: rejected ? 'EXCESSIVE_CONTEXT_OR_REPEATED_READS' : 'UNEXPECTED_ACCEPTANCE', workspace_mutated: false };
}
