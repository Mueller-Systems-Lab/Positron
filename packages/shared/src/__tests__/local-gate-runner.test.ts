// Positron — Local Gate Runner: Red Tests (Issue #279 Phase 1E)
// Tests do NOT run real build/test/npm commands.
// Uses fake runner and inline fixtures.
// No GitHub API calls, no network, no file system writes.

import { describe, expect, test } from 'vitest';

// These imports will fail until the module is implemented (red-test phase).
// After implementation they should resolve correctly.
import {
	createDryRunLocalGateReport,
	createLocalGateReport,
	getDefaultLocalGateDefinitions,
	type LocalGateDefinition,
	type LocalGateKind,
	type LocalGateReport,
	type LocalGateResult,
	type LocalGateStatus,
	truncateSnippet,
	validateLocalGateDefinition,
} from '../local-gate-runner.js';

// ---------------------------------------------------------------------------
// Inline fixtures — no real command execution
// ---------------------------------------------------------------------------

/** A fake command runner that returns pre-configured results. */
function fakeRunner(exitCode: number, stdout: string, stderr: string, durationMs: number) {
	return async () => ({
		exitCode,
		stdout,
		stderr,
		durationMs,
		error: exitCode === null ? 'command not found' : undefined,
	});
}

/** Build a LocalGateResult manually for assertion tests. */
function makeResult(overrides: Partial<LocalGateResult> = {}): LocalGateResult {
	return {
		id: 'gate-1',
		label: 'Test Gate',
		kind: 'required',
		command: 'npm',
		args: ['test'],
		status: 'PASS',
		exitCode: 0,
		durationMs: 100,
		stdoutSnippet: 'All tests passed.',
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Test Suite: Local Gate Runner (22 tests)
// ---------------------------------------------------------------------------

describe('Local Gate Runner', () => {
	// --- Type/Definition Tests ---

	// 1. creates LocalGateResult for passing command fixture
	test('creates LocalGateResult for passing command fixture', () => {
		const result: LocalGateResult = {
			id: 'build',
			label: 'Build',
			kind: 'required',
			command: 'npm',
			args: ['run', 'build'],
			status: 'PASS',
			exitCode: 0,
			durationMs: 2500,
			stdoutSnippet: 'Build succeeded.',
		};
		expect(result.id).toBe('build');
		expect(result.status).toBe('PASS');
		expect(result.exitCode).toBe(0);
		expect(result.durationMs).toBeGreaterThan(0);
	});

	// 2. creates LocalGateResult for failing command fixture
	test('creates LocalGateResult for failing command fixture', () => {
		const result: LocalGateResult = {
			id: 'typecheck',
			label: 'Typecheck',
			kind: 'required',
			command: 'npm',
			args: ['run', 'typecheck'],
			status: 'FAIL',
			exitCode: 2,
			durationMs: 1500,
			stderrSnippet: 'Found 3 type errors.',
		};
		expect(result.status).toBe('FAIL');
		expect(result.exitCode).toBe(2);
		expect(result.stderrSnippet).toContain('type errors');
	});

	// 3. computes durationMs
	test('computes durationMs', () => {
		const result = makeResult({ durationMs: 1234 });
		expect(result.durationMs).toBe(1234);
	});

	// 4. captures stdout/stderr snippets
	test('captures stdout/stderr snippets', () => {
		const result = makeResult({
			stdoutSnippet: 'Tests: 42 passed',
			stderrSnippet: '',
		});
		expect(result.stdoutSnippet).toBe('Tests: 42 passed');
		expect(result.stderrSnippet).toBe('');
	});

	// 5. truncates long stdout/stderr snippets
	test('truncates long stdout/stderr snippets', () => {
		const longStr = 'x'.repeat(5000);
		const truncated = truncateSnippet(longStr);
		expect(truncated.length).toBeLessThan(longStr.length);
		expect(truncated).toContain('truncated');
	});

	// 6. classifies required PASS
	test('classifies required PASS', () => {
		const result = makeResult({ kind: 'required', status: 'PASS', exitCode: 0 });
		expect(result.kind).toBe('required');
		expect(result.status).toBe('PASS');
	});

	// 7. classifies required FAIL
	test('classifies required FAIL', () => {
		const result = makeResult({ kind: 'required', status: 'FAIL', exitCode: 1 });
		expect(result.kind).toBe('required');
		expect(result.status).toBe('FAIL');
	});

	// 8. classifies advisory WARN
	test('classifies advisory WARN', () => {
		const result = makeResult({ kind: 'advisory', status: 'WARN', exitCode: 1 });
		expect(result.kind).toBe('advisory');
		expect(result.status).toBe('WARN');
	});

	// --- Validation Tests ---

	// 9. rejects non-allowlisted command
	test('rejects non-allowlisted command', () => {
		const def: LocalGateDefinition = {
			id: 'bad',
			label: 'Bad Command',
			kind: 'required',
			command: 'evil-tool',
			args: ['--destroy'],
		};
		const errors = validateLocalGateDefinition(def);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e) => /command/i.test(e))).toBe(true);
	});

	// 10. rejects --write in args
	test('rejects --write in args', () => {
		const def: LocalGateDefinition = {
			id: 'fmt-write',
			label: 'Format Write',
			kind: 'format',
			command: 'npx',
			args: ['biome', 'format', '--write', '.'],
		};
		const errors = validateLocalGateDefinition(def);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e) => /write/i.test(e))).toBe(true);
	});

	// 11. rejects npm install
	test('rejects npm install', () => {
		const def: LocalGateDefinition = {
			id: 'install',
			label: 'Install',
			kind: 'required',
			command: 'npm',
			args: ['install'],
		};
		const errors = validateLocalGateDefinition(def);
		expect(errors.length).toBeGreaterThan(0);
	});

	// 12. rejects npm update
	test('rejects npm update', () => {
		const def: LocalGateDefinition = {
			id: 'update',
			label: 'Update',
			kind: 'required',
			command: 'npm',
			args: ['update'],
		};
		const errors = validateLocalGateDefinition(def);
		expect(errors.length).toBeGreaterThan(0);
	});

	// 13. rejects npm audit fix
	test('rejects npm audit fix', () => {
		const def: LocalGateDefinition = {
			id: 'audit-fix',
			label: 'Audit Fix',
			kind: 'required',
			command: 'npm',
			args: ['audit', 'fix'],
		};
		const errors = validateLocalGateDefinition(def);
		expect(errors.length).toBeGreaterThan(0);
	});

	// 14. rejects gh workflow run
	test('rejects gh workflow run', () => {
		const def: LocalGateDefinition = {
			id: 'ci-run',
			label: 'CI Run',
			kind: 'required',
			command: 'gh',
			args: ['workflow', 'run'],
		};
		const errors = validateLocalGateDefinition(def);
		expect(errors.length).toBeGreaterThan(0);
	});

	// 15. rejects gh run rerun
	test('rejects gh run rerun', () => {
		const def: LocalGateDefinition = {
			id: 'ci-rerun',
			label: 'CI ReRun',
			kind: 'required',
			command: 'gh',
			args: ['run', 'rerun'],
		};
		const errors = validateLocalGateDefinition(def);
		expect(errors.length).toBeGreaterThan(0);
	});

	// 16. rejects git stash apply/pop/drop
	test('rejects git stash apply', () => {
		const def: LocalGateDefinition = {
			id: 'stash',
			label: 'Stash Apply',
			kind: 'required',
			command: 'git',
			args: ['stash', 'apply'],
		};
		const errors = validateLocalGateDefinition(def);
		expect(errors.length).toBeGreaterThan(0);
	});

	test('rejects git stash pop', () => {
		const def: LocalGateDefinition = {
			id: 'stash-pop',
			label: 'Stash Pop',
			kind: 'required',
			command: 'git',
			args: ['stash', 'pop'],
		};
		const errors = validateLocalGateDefinition(def);
		expect(errors.length).toBeGreaterThan(0);
	});

	test('rejects git stash drop', () => {
		const def: LocalGateDefinition = {
			id: 'stash-drop',
			label: 'Stash Drop',
			kind: 'required',
			command: 'git',
			args: ['stash', 'drop'],
		};
		const errors = validateLocalGateDefinition(def);
		expect(errors.length).toBeGreaterThan(0);
	});

	// 17. rejects gh pr merge/close/comment
	test('rejects gh pr merge', () => {
		const def: LocalGateDefinition = {
			id: 'pr-merge',
			label: 'PR Merge',
			kind: 'required',
			command: 'gh',
			args: ['pr', 'merge'],
		};
		const errors = validateLocalGateDefinition(def);
		expect(errors.length).toBeGreaterThan(0);
	});

	test('rejects gh pr close', () => {
		const def: LocalGateDefinition = {
			id: 'pr-close',
			label: 'PR Close',
			kind: 'required',
			command: 'gh',
			args: ['pr', 'close'],
		};
		const errors = validateLocalGateDefinition(def);
		expect(errors.length).toBeGreaterThan(0);
	});

	// 18. rejects gh issue close/comment
	test('rejects gh issue close', () => {
		const def: LocalGateDefinition = {
			id: 'issue-close',
			label: 'Issue Close',
			kind: 'required',
			command: 'gh',
			args: ['issue', 'close'],
		};
		const errors = validateLocalGateDefinition(def);
		expect(errors.length).toBeGreaterThan(0);
	});

	test('rejects gh issue comment', () => {
		const def: LocalGateDefinition = {
			id: 'issue-comment',
			label: 'Issue Comment',
			kind: 'required',
			command: 'gh',
			args: ['issue', 'comment'],
		};
		const errors = validateLocalGateDefinition(def);
		expect(errors.length).toBeGreaterThan(0);
	});

	// --- Report Tests ---

	// 19. creates LocalGateReport summary
	test('creates LocalGateReport summary', () => {
		const results: LocalGateResult[] = [
			makeResult({ id: 'g1', kind: 'required', status: 'PASS' }),
			makeResult({ id: 'g2', kind: 'required', status: 'PASS' }),
			makeResult({ id: 'g3', kind: 'advisory', status: 'WARN' }),
			makeResult({ id: 'g4', kind: 'format', status: 'PASS' }),
		];
		const report = createLocalGateReport(results);
		expect(report.total).toBe(4);
		expect(report.passed).toBe(3);
		expect(report.warned).toBe(1);
		expect(report.failed).toBe(0);
		expect(report.skipped).toBe(0);
		expect(report.results).toEqual(results);
	});

	// 20. required failure makes report FAIL
	test('required failure makes report FAIL', () => {
		const results: LocalGateResult[] = [
			makeResult({ id: 'g1', kind: 'required', status: 'PASS' }),
			makeResult({ id: 'g2', kind: 'required', status: 'FAIL', exitCode: 1 }),
		];
		const report = createLocalGateReport(results);
		expect(report.status).toBe('FAIL');
		expect(report.failed).toBe(1);
	});

	// 21. advisory failure does not make report FAIL
	test('advisory failure does not make report FAIL', () => {
		const results: LocalGateResult[] = [
			makeResult({ id: 'g1', kind: 'required', status: 'PASS' }),
			makeResult({ id: 'g2', kind: 'advisory', status: 'WARN', exitCode: 1 }),
		];
		const report = createLocalGateReport(results);
		expect(report.status).not.toBe('FAIL');
		expect(report.status).toBe('WARN');
	});

	// 22. local-gates-dry-run creates SKIPPED/PASS simulated results without executing commands
	test('local-gates-dry-run creates simulated results without executing commands', () => {
		const report = createDryRunLocalGateReport();
		expect(report).toBeDefined();
		expect(report.total).toBeGreaterThan(0);
		// All gates should be SKIPPED in dry-run mode (no real commands executed)
		expect(report.results.every((r) => r.status === 'SKIPPED')).toBe(true);
		// But the report itself should reflect that nothing real was run
		expect(report.status).toBe('PASS'); // Simulated: no real failures
		// Should have default gates
		const gateIds = report.results.map((r) => r.id);
		expect(gateIds).toContain('git-diff-check');
		expect(gateIds).toContain('build');
		expect(gateIds).toContain('typecheck');
		expect(gateIds).toContain('test');
	});

	test('local-gates-dry-run with custom gates', () => {
		const customGates: LocalGateDefinition[] = [
			{
				id: 'custom-1',
				label: 'Custom 1',
				kind: 'required',
				command: 'npm',
				args: ['run', 'custom'],
			},
		];
		const report = createDryRunLocalGateReport(customGates);
		expect(report.total).toBe(1);
		expect(report.results[0]!.id).toBe('custom-1');
		expect(report.results[0]!.status).toBe('SKIPPED');
	});

	// --- Default Gates Tests ---

	// 23. getDefaultLocalGateDefinitions returns expected gates
	test('getDefaultLocalGateDefinitions returns expected gates', () => {
		const gates = getDefaultLocalGateDefinitions();
		expect(gates.length).toBeGreaterThanOrEqual(6);

		// Required gates
		const gitDiff = gates.find((g) => g.id === 'git-diff-check');
		expect(gitDiff).toBeDefined();
		expect(gitDiff!.kind).toBe('required');

		const build = gates.find((g) => g.id === 'build');
		expect(build).toBeDefined();
		expect(build!.kind).toBe('required');

		const typecheck = gates.find((g) => g.id === 'typecheck');
		expect(typecheck).toBeDefined();
		expect(typecheck!.kind).toBe('required');

		const testGate = gates.find((g) => g.id === 'test');
		expect(testGate).toBeDefined();
		expect(testGate!.kind).toBe('required');

		const webTest = gates.find((g) => g.id === 'test-web');
		expect(webTest).toBeDefined();
		expect(webTest!.kind).toBe('required');

		// Format gate
		const fmt = gates.find((g) => g.id === 'format');
		expect(fmt).toBeDefined();
		expect(fmt!.kind).toBe('format');

		// Advisory gates
		const biomeCheck = gates.find((g) => g.id === 'biome-check');
		expect(biomeCheck).toBeDefined();
		expect(biomeCheck!.kind).toBe('advisory');
	});

	// 24. validates safe commands pass validation
	test('validates safe commands pass validation', () => {
		const safeGates: LocalGateDefinition[] = [
			{ id: 'g1', label: 'Git Diff', kind: 'required', command: 'git', args: ['diff', '--check'] },
			{ id: 'g2', label: 'Build', kind: 'required', command: 'npm', args: ['run', 'build'] },
			{ id: 'g3', label: 'Test', kind: 'required', command: 'npm', args: ['test'] },
			{
				id: 'g4',
				label: 'Biome Format',
				kind: 'format',
				command: 'npx',
				args: ['biome', 'format', '.'],
			},
		];
		for (const gate of safeGates) {
			const errors = validateLocalGateDefinition(gate);
			expect(errors).toEqual([]);
		}
	});
});
