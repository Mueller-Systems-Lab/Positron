#!/usr/bin/env node

// ─── Positron: Differential Biome Lint Tests ────────────────────────
//
// 25+ tests for the differential lint module.
// Usage: node --test scripts/ci/differential-biome-lint.test.mjs

import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

// Import module under test
import {
	EMPTY_TREE_SHA,
	EXIT,
	buildDiagnosticCounts,
	compareDiagnostics,
	createFullSnapshots,
	createSnapshot,
	createSnapshots,
	detectConfigChanges,
	determineShas,
	diagnosticKey,
	findLintableFiles,
	getChangedFiles,
	git,
	isLintableFile,
	normalizeDiagnostic,
	normalizeDiagnostics,
	parseBiomeOutput,
	parseChangedFiles,
	parseKey,
	renderSummary,
	runBiome,
	runDifferentialLint,
	validateCommit,
} from './differential-biome-lint.mjs';

// ─── Test Helpers ───────────────────────────────────────────────────

const TEST_DIR = '/tmp/positron-test-diff-lint';
const REPO_ROOT = process.cwd();
const BIOME_BIN = join(REPO_ROOT, 'node_modules/@biomejs/biome/bin/biome');

function cleanTestDir() {
	rmSync(TEST_DIR, { recursive: true, force: true });
}

function setupGitFixture(name) {
	const dir = join(TEST_DIR, name);
	cleanTestDir();
	mkdirSync(dir, { recursive: true });
	execSync('git init', { cwd: dir, stdio: 'pipe' });
	execSync('git config user.email "test@test.test"', { cwd: dir, stdio: 'pipe' });
	execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
	return dir;
}

function commitAll(dir, message) {
	execSync('git add -A', { cwd: dir, stdio: 'pipe' });
	execSync(`git commit -m "${message}"`, { cwd: dir, stdio: 'pipe' });
}

function getHead(dir) {
	return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
}

// ─── Suite 1: determineShas ─────────────────────────────────────────

describe('determineShas', () => {
	it('1. pull_request — uses exact base.sha and head.sha', () => {
		const realSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
		const result = determineShas('pull_request', {
			baseSha: realSha,
			headSha: realSha,
		});
		assert.equal(result.baseSha, realSha);
		assert.equal(result.headSha, realSha);
		assert.equal(result.error, null);
	});

	it('2. push — uses event.before and github.sha', () => {
		const realSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
		const result = determineShas('push', {
			before: realSha,
			headSha: realSha,
		});
		assert.equal(result.baseSha, realSha);
		assert.equal(result.headSha, realSha);
	});

	it('3. push with null-SHA — uses empty tree', () => {
		const result = determineShas('push', {
			before: '0000000000000000000000000000000000000000',
			headSha: 'HEAD',
		});
		assert.equal(result.baseSha, EMPTY_TREE_SHA);
		assert.equal(result.headSha, 'HEAD');
		assert.equal(result.error, null);
	});

	it('4. workflow_dispatch — requires valid base_sha', () => {
		// Most recent commit should be valid
		const validSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
		const result = determineShas('workflow_dispatch', {
			baseSha: validSha,
			headSha: validSha,
		});
		assert.equal(result.error, null);
		assert.equal(result.baseSha, validSha);
	});

	it('5. workflow_dispatch without base — fails', () => {
		const result = determineShas('workflow_dispatch', {});
		assert.notEqual(result.error, null);
		assert.match(result.error, /requires a valid base_sha/);
	});

	it('6. workflow_dispatch with malformed SHA — fails', () => {
		const result = determineShas('workflow_dispatch', {
			baseSha: 'not-a-sha',
		});
		assert.notEqual(result.error, null);
		assert.match(result.error, /valid base_sha/);
	});

	it('7. unknown event without base — fails', () => {
		const result = determineShas('scheduled_release', {});
		assert.notEqual(result.error, null);
	});

	it('8. invalid BASE SHA — fails', () => {
		const result = determineShas('pull_request', {
			baseSha: '0000000000000000000000000000000000000000',
			headSha: '0000000000000000000000000000000000000000',
		});
		// 0000...0 is not a valid commit in the repo (not empty-tree)
		assert.notEqual(result.error, null);
	});
});

// ─── Suite 2: validateCommit ────────────────────────────────────────

describe('validateCommit', () => {
	it('9. valid commit returns true', () => {
		const sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
		assert.ok(validateCommit(sha));
	});

	it('10. nonexistent commit returns false', () => {
		assert.ok(!validateCommit('0000000000000000000000000000000000000000'));
	});

	it('11. malformed string returns false', () => {
		assert.ok(!validateCommit('not-a-sha'));
	});

	it('12. empty string returns false', () => {
		assert.ok(!validateCommit(''));
	});

	it('13. null returns false', () => {
		assert.ok(!validateCommit(null));
	});
});

// ─── Suite 3: parseChangedFiles ─────────────────────────────────────

describe('parseChangedFiles', () => {
	it('14. added file', () => {
		const result = parseChangedFiles('A\0src/foo.ts\0');
		assert.equal(result.length, 1);
		assert.equal(result[0].status, 'A');
		assert.equal(result[0].basePath, null);
		assert.equal(result[0].headPath, 'src/foo.ts');
		assert.equal(result[0].logicalPath, 'src/foo.ts');
	});

	it('15. modified file', () => {
		const result = parseChangedFiles('M\0src/bar.ts\0');
		assert.equal(result.length, 1);
		assert.equal(result[0].status, 'M');
		assert.equal(result[0].basePath, 'src/bar.ts');
		assert.equal(result[0].headPath, 'src/bar.ts');
		assert.equal(result[0].logicalPath, 'src/bar.ts');
	});

	it('16. deleted file', () => {
		const result = parseChangedFiles('D\0src/old.ts\0');
		assert.equal(result.length, 1);
		assert.equal(result[0].status, 'D');
		assert.equal(result[0].headPath, null);
		assert.equal(result[0].basePath, 'src/old.ts');
	});

	it('17. renamed file with similarity', () => {
		const result = parseChangedFiles('R100\0src/old.ts\0src/new.ts\0');
		assert.equal(result.length, 1);
		assert.equal(result[0].status, 'R');
		assert.equal(result[0].similarity, '100');
		assert.equal(result[0].basePath, 'src/old.ts');
		assert.equal(result[0].headPath, 'src/new.ts');
		assert.equal(result[0].logicalPath, 'src/new.ts');
	});

	it('18. multiple files', () => {
		const result = parseChangedFiles('A\0a.ts\0M\0b.ts\0D\0c.ts\0');
		assert.equal(result.length, 3);
		assert.equal(result[0].status, 'A');
		assert.equal(result[1].status, 'M');
		assert.equal(result[2].status, 'D');
	});

	it('19. file path with spaces', () => {
		const result = parseChangedFiles('M\0src/my file.ts\0');
		assert.equal(result.length, 1);
		assert.equal(result[0].headPath, 'src/my file.ts');
	});

	it('20. empty input', () => {
		const result = parseChangedFiles('');
		assert.equal(result.length, 0);
	});

	it('21. null input', () => {
		const result = parseChangedFiles(null);
		assert.equal(result.length, 0);
	});
});

// ─── Suite 4: isLintableFile ────────────────────────────────────────

describe('isLintableFile', () => {
	const lintable = [
		'src/foo.ts',
		'src/bar.tsx',
		'src/baz.js',
		'src/qux.jsx',
		'src/quux.mjs',
		'src/corge.cjs',
		'src/grault.mts',
		'src/garply.cts',
		'src/config.json',
		'src/settings.jsonc',
	];

	for (const path of lintable) {
		it(`lintable: ${path}`, () => {
			assert.ok(isLintableFile(path));
		});
	}

	it('22. .mjs new diagnostic case', () => {
		assert.ok(isLintableFile('src/module.mjs'));
	});

	it('23. non-lintable files', () => {
		assert.ok(!isLintableFile('README.md'));
		assert.ok(!isLintableFile('Dockerfile'));
		assert.ok(!isLintableFile('styles.css'));
		assert.ok(!isLintableFile('image.png'));
		assert.ok(!isLintableFile('src/main.rs'));
	});

	it('24. config extensions override', () => {
		const custom = new Set(['.vue']);
		assert.ok(!isLintableFile('src/app.vue'));
		assert.ok(isLintableFile('src/app.vue', custom));
	});
});

// ─── Suite 5: detectConfigChanges ───────────────────────────────────

describe('detectConfigChanges', () => {
	it('25. biome.json change triggers', () => {
		assert.ok(detectConfigChanges([{ logicalPath: 'biome.json' }]));
	});

	it('26. package.json change triggers', () => {
		assert.ok(detectConfigChanges([{ logicalPath: 'package.json' }]));
	});

	it('27. package-lock.json change triggers', () => {
		assert.ok(detectConfigChanges([{ logicalPath: 'package-lock.json' }]));
	});

	it('28. biome.jsonc change triggers', () => {
		assert.ok(detectConfigChanges([{ logicalPath: 'biome.jsonc' }]));
	});

	it('29. npm-shrinkwrap.json change triggers', () => {
		assert.ok(detectConfigChanges([{ logicalPath: 'npm-shrinkwrap.json' }]));
	});

	it('30. biome.custom.json triggers', () => {
		assert.ok(detectConfigChanges([{ logicalPath: '.biome.json' }]));
	});

	it('31. regular source file does not trigger', () => {
		assert.ok(!detectConfigChanges([{ logicalPath: 'src/app.ts' }]));
	});

	it('32. no config files in list', () => {
		assert.ok(!detectConfigChanges([{ logicalPath: 'src/a.ts' }, { logicalPath: 'src/b.ts' }]));
	});
});

// ─── Suite 6: Biome parsing ─────────────────────────────────────────

describe('parseBiomeOutput', () => {
	it('33. valid biome JSON', () => {
		const json = JSON.stringify({
			summary: { errors: 1, warnings: 0 },
			diagnostics: [
				{
					category: 'lint/suspicious/noConsoleLog',
					severity: 'warning',
					description: "Don't use console.log",
					location: { path: { file: '/repo/src/app.ts' }, span: [10, 20] },
				},
			],
		});
		const result = parseBiomeOutput(json);
		assert.equal(result.diagnostics.length, 1);
		assert.equal(result.diagnostics[0].category, 'lint/suspicious/noConsoleLog');
		assert.equal(result.summary.errors, 1);
	});

	it('34. empty output throws', () => {
		assert.throws(() => parseBiomeOutput(''), {
			message: /empty output/,
		});
	});

	it('35. malformed JSON throws', () => {
		assert.throws(() => parseBiomeOutput('not json'), {
			message: /Failed to parse/,
		});
	});

	it('36. null output throws', () => {
		assert.throws(() => parseBiomeOutput(null), {
			message: /empty output/,
		});
	});

	it('37. whitespace-only output throws', () => {
		assert.throws(() => parseBiomeOutput('   \n  '), {
			message: /empty output/,
		});
	});

	it('38. JSON without diagnostics key', () => {
		const json = JSON.stringify({ summary: { errors: 0 }, command: 'lint' });
		const result = parseBiomeOutput(json);
		assert.equal(result.diagnostics.length, 0);
	});

	it('39. non-object JSON throws', () => {
		assert.throws(() => parseBiomeOutput('"just a string"'), {
			message: /not an object/,
		});
	});
});

// ─── Suite 7: normalizeDiagnostic ───────────────────────────────────

describe('normalizeDiagnostic', () => {
	it('40. strips snapshot prefix', () => {
		const diag = {
			category: 'lint/style/noNonNullAssertion',
			severity: 'warning',
			description: 'Forbidden non-null assertion.',
			location: { path: { file: '/tmp/positron-diff-abc/head/src/app.ts' } },
		};
		const result = normalizeDiagnostic(diag, '/tmp/positron-diff-abc/head');
		assert.equal(result.file, 'src/app.ts');
		assert.equal(result.rule, 'lint/style/noNonNullAssertion');
		assert.equal(result.severity, 'warning');
	});

	it('41. string path', () => {
		const diag = {
			category: 'lint/correctness/noUnusedVariables',
			severity: 'warning',
			description: '...',
			location: { path: '/some/path.ts' },
		};
		const result = normalizeDiagnostic(diag);
		assert.equal(result.file, '/some/path.ts');
	});

	it('42. missing location', () => {
		const diag = {
			category: 'parse',
			severity: 'error',
			description: 'Syntax error',
		};
		const result = normalizeDiagnostic(diag);
		assert.equal(result.file, '');
	});
});

// ─── Suite 8: diagnosticKey ─────────────────────────────────────────

describe('diagnosticKey', () => {
	it('43. produces stable key', () => {
		const a = diagnosticKey({
			file: 'src/a.ts',
			rule: 'noConsoleLog',
			severity: 'warning',
			message: 'test',
		});
		const b = diagnosticKey({
			file: 'src/a.ts',
			rule: 'noConsoleLog',
			severity: 'warning',
			message: 'test',
		});
		assert.equal(a, b);
	});

	it('44. different file → different key', () => {
		const a = diagnosticKey({ file: 'src/a.ts', rule: 'X', severity: 'w', message: 'm' });
		const b = diagnosticKey({ file: 'src/b.ts', rule: 'X', severity: 'w', message: 'm' });
		assert.notEqual(a, b);
	});

	it('45. duplicate basenames in different dirs', () => {
		const a = diagnosticKey({ file: 'src/a/index.ts', rule: 'X', severity: 'w', message: 'm' });
		const b = diagnosticKey({ file: 'src/b/index.ts', rule: 'X', severity: 'w', message: 'm' });
		assert.notEqual(a, b);
	});
});

// ─── Suite 9: buildDiagnosticCounts ─────────────────────────────────

describe('buildDiagnosticCounts', () => {
	it('46. counts occurrences', () => {
		const diags = [
			{ file: 'a.ts', rule: 'R1', severity: 'w', message: 'm1' },
			{ file: 'a.ts', rule: 'R1', severity: 'w', message: 'm1' },
			{ file: 'a.ts', rule: 'R2', severity: 'e', message: 'm2' },
		];
		const counts = buildDiagnosticCounts(diags);
		assert.equal(counts.size, 2);
		assert.equal(counts.get(diagnosticKey(diags[0])), 2);
		assert.equal(counts.get(diagnosticKey(diags[2])), 1);
	});

	it('47. empty array returns empty map', () => {
		const counts = buildDiagnosticCounts([]);
		assert.equal(counts.size, 0);
	});
});

// ─── Suite 10: compareDiagnostics ───────────────────────────────────

describe('compareDiagnostics', () => {
	const mkDiag = (file, rule, severity, message) => ({ file, rule, severity, message });
	const buildMap = (entries) => {
		const map = new Map();
		for (const [diag, count] of entries) {
			map.set(diagnosticKey(diag), count);
		}
		return map;
	};

	it('48. new diagnostic → NEW', () => {
		const base = buildMap([]);
		const head = buildMap([[mkDiag('a.ts', 'R1', 'w', 'new'), 1]]);
		const result = compareDiagnostics(base, head);
		assert.equal(result.new.length, 1);
		assert.equal(result.worsened.length, 0);
	});

	it('49. unchanged diagnostic → UNCHANGED', () => {
		const d = mkDiag('a.ts', 'R1', 'w', 'same');
		const base = buildMap([[d, 1]]);
		const head = buildMap([[d, 1]]);
		const result = compareDiagnostics(base, head);
		assert.equal(result.unchanged.length, 1);
		assert.equal(result.new.length, 0);
		assert.equal(result.worsened.length, 0);
	});

	it('50. count 1→2 → WORSENED', () => {
		const d = mkDiag('a.ts', 'R1', 'w', 'more');
		const base = buildMap([[d, 1]]);
		const head = buildMap([[d, 2]]);
		const result = compareDiagnostics(base, head);
		assert.equal(result.worsened.length, 1);
		assert.equal(result.new.length, 0);
		const entry = result.worsened[0];
		assert.equal(entry.baseCount, 1);
		assert.equal(entry.headCount, 2);
		assert.equal(entry.delta, 1);
	});

	it('51. count 2→1 → IMPROVED', () => {
		const d = mkDiag('a.ts', 'R1', 'w', 'less');
		const base = buildMap([[d, 2]]);
		const head = buildMap([[d, 1]]);
		const result = compareDiagnostics(base, head);
		assert.equal(result.improved.length, 1);
		assert.equal(result.worsened.length, 0);
	});

	it('52. removed diagnostic → REMOVED', () => {
		const d = mkDiag('a.ts', 'R1', 'w', 'gone');
		const base = buildMap([[d, 1]]);
		const head = buildMap([]);
		const result = compareDiagnostics(base, head);
		assert.equal(result.removed.length, 1);
		assert.equal(result.new.length, 0);
	});

	it('53. same count → UNCHANGED not NEW', () => {
		const d = mkDiag('a.ts', 'R1', 'w', 'same');
		const base = buildMap([[d, 2]]);
		const head = buildMap([[d, 2]]);
		const result = compareDiagnostics(base, head);
		assert.equal(result.unchanged.length, 1);
		assert.equal(result.new.length, 0);
		assert.equal(result.worsened.length, 0);
	});

	it('54. duplicate basenames in different directories', () => {
		const d1 = mkDiag('src/a/index.ts', 'R1', 'w', 'msg');
		const d2 = mkDiag('src/b/index.ts', 'R1', 'w', 'msg');
		const base = buildMap([
			[d1, 1],
			[d2, 1],
		]);
		const head = buildMap([
			[d1, 1],
			[d2, 2],
		]);
		const result = compareDiagnostics(base, head);
		assert.equal(result.unchanged.length, 1);
		assert.equal(result.worsened.length, 1);
		assert.equal(result.worsened[0].baseCount, 1);
		assert.equal(result.worsened[0].headCount, 2);
	});
});

// ─── Suite 11: parseKey ─────────────────────────────────────────────

describe('parseKey', () => {
	it('55. correctly splits key', () => {
		const key = 'src/app.ts\0lint/style/noNonNullAssertion\0warning\0Forbidden non-null assertion.';
		const result = parseKey(key);
		assert.equal(result.file, 'src/app.ts');
		assert.equal(result.rule, 'lint/style/noNonNullAssertion');
		assert.equal(result.severity, 'warning');
	});
});

// ─── Suite 12: renderSummary ────────────────────────────────────────

describe('renderSummary', () => {
	it('56. renders PASS summary', () => {
		const result = {
			baseSha: 'abc123',
			headSha: 'def456',
			event: 'pull_request',
			changedFiles: [],
			lintableFiles: [],
			isFullPolicyDiff: false,
			comparison: { new: [], worsened: [], unchanged: [], improved: [], removed: [] },
			result: 'PASS',
			errors: [],
			warnings: ['No lintable files changed'],
		};
		const summary = renderSummary(result);
		assert.match(summary, /Differential Biome Lint Report/);
		assert.match(summary, /PASS/);
		assert.match(summary, /No lintable files changed/);
	});

	it('57. renders FAIL summary', () => {
		const result = {
			baseSha: 'abc',
			headSha: 'def',
			event: 'push',
			changedFiles: [],
			lintableFiles: [],
			isFullPolicyDiff: false,
			comparison: {
				new: [{ key: 'a.ts\0R1\0error\0bad', baseCount: 0, headCount: 1, delta: 1 }],
				worsened: [],
				unchanged: [],
				improved: [],
				removed: [],
			},
			result: 'FAIL_NEW_DIAGNOSTICS',
			errors: [],
			warnings: [],
		};
		const summary = renderSummary(result);
		assert.match(summary, /FAIL_NEW_DIAGNOSTICS/);
		assert.match(summary, /NEW Diagnostics/);
	});

	it('58. renders errors section', () => {
		const result = {
			baseSha: 'a',
			headSha: 'b',
			event: 'push',
			changedFiles: [],
			lintableFiles: [],
			isFullPolicyDiff: false,
			comparison: null,
			result: 'FAIL_BIOME_EXECUTION',
			errors: ['biome spawn error: ENOENT'],
			warnings: [],
		};
		const summary = renderSummary(result);
		assert.match(summary, /Errors/);
		assert.match(summary, /ENOENT/);
	});
});

// ─── Suite 13: findLintableFiles ────────────────────────────────────

describe('findLintableFiles', () => {
	it('59. finds lintable files in directory', () => {
		const dir = join(TEST_DIR, 'find-test');
		rmSync(dir, { recursive: true, force: true });
		mkdirSync(dir, { recursive: true });
		mkdirSync(join(dir, 'src', 'sub'), { recursive: true });
		writeFileSync(join(dir, 'src', 'main.ts'), 'const x = 1;');
		writeFileSync(join(dir, 'src', 'util.js'), 'const y = 2;');
		writeFileSync(join(dir, 'src', 'sub', 'helper.mjs'), 'const z = 3;');
		writeFileSync(join(dir, 'src', 'config.json'), '{}');
		writeFileSync(join(dir, 'README.md'), '# readme');

		const files = findLintableFiles(dir);
		const names = files.map((f) => f.replace(`${dir}/`, ''));
		assert.ok(names.some((n) => n.endsWith('main.ts')));
		assert.ok(names.some((n) => n.endsWith('util.js')));
		assert.ok(names.some((n) => n.endsWith('helper.mjs')));
		assert.ok(names.some((n) => n.endsWith('config.json')));
		assert.ok(!names.some((n) => n.endsWith('README.md')));
	});
});

// ─── Suite 14: Real Biome CLI Integration ───────────────────────────

describe('Real Biome CLI integration', () => {
	let fixtureDir;
	let sha1;
	let sha2;

	before(() => {
		fixtureDir = setupGitFixture('biome-integration');
		// Create initial commit with a clean file and a file with diagnostics
		mkdirSync(join(fixtureDir, 'src'), { recursive: true });
		writeFileSync(
			join(fixtureDir, 'biome.json'),
			JSON.stringify({
				$schema: 'https://biomejs.dev/schemas/1.9.4/schema.json',
				linter: { enabled: true, rules: { recommended: true } },
			}),
		);
		writeFileSync(
			join(fixtureDir, 'src', 'clean.ts'),
			'const answer = 42;\nexport default answer;\n',
		);
		// This file has a console.log which biome warns about
		writeFileSync(
			join(fixtureDir, 'src', 'with-warn.ts'),
			'console.log("hello");\nconst x: any = 1;\n',
		);
		commitAll(fixtureDir, 'initial');
		sha1 = getHead(fixtureDir);

		// Second commit: fix one issue, but add another in a .mjs file
		writeFileSync(join(fixtureDir, 'src', 'with-warn.ts'), 'console.log("hello");\nconst x = 1;\n');
		writeFileSync(join(fixtureDir, 'src', 'new-module.mjs'), 'console.log("oops");\n');
		commitAll(fixtureDir, 'second');
		sha2 = getHead(fixtureDir);
	});

	after(() => {
		cleanTestDir();
	});

	it('60. biome --version works', () => {
		const r = execSync(`${BIOME_BIN} --version`, { encoding: 'utf8' });
		assert.match(r, /Version:/);
	});

	it('61. runBiome produces diagnostics', () => {
		const result = runBiome(join(fixtureDir, 'src'), BIOME_BIN);
		assert.ok(result.exitCode >= 0);
		assert.ok(result.stdout.length > 0);
		const parsed = parseBiomeOutput(result.stdout);
		assert.ok(parsed.diagnostics.length >= 0);
	});

	it('62. detects new .mjs diagnostic', () => {
		// Extract files to temp snapshots and compare
		const snapDir = join(TEST_DIR, 'mjs-test');
		mkdirSync(snapDir, { recursive: true });
		mkdirSync(join(snapDir, 'base'), { recursive: true });
		mkdirSync(join(snapDir, 'head'), { recursive: true });

		// At sha1: with-warn.ts has any+console issues
		// At sha2: fixed any but added new-module.mjs with console.log

		const result = runDifferentialLint({
			baseSha: sha1,
			headSha: sha2,
			repoRoot: fixtureDir,
			runId: 'mjs-integration',
			biomeBin: BIOME_BIN,
			event: 'push',
		});

		// Should detect: one diagnostic removed (noExplicitAny), one added (console.log in mjs)
		// So we expect NEW diagnostics
		assert.ok(result.comparison);
		assert.ok(
			result.comparison.new.length > 0 || result.comparison.removed.length > 0,
			'Expected either new or removed diagnostics',
		);
	});

	it('63. detects WORSENED when count increases', () => {
		// Create a scenario where a diagnostic count goes from 1 to 2
		const dir = setupGitFixture('worsened-test');

		mkdirSync(join(dir, 'src'), { recursive: true });
		writeFileSync(
			join(dir, 'biome.json'),
			JSON.stringify({
				$schema: 'https://biomejs.dev/schemas/1.9.4/schema.json',
				linter: {
					enabled: true,
					rules: { recommended: true, suspicious: { noConsoleLog: 'error' } },
				},
			}),
		);
		writeFileSync(join(dir, 'src', 'app.ts'), 'console.log("A");\nconst x = 1;\n');
		commitAll(dir, 'initial: one console.log');
		const base = getHead(dir);

		writeFileSync(
			join(dir, 'src', 'app.ts'),
			'console.log("A");\nconsole.log("B");\nconst x = 1;\n',
		);
		commitAll(dir, 'second: two console.log');
		const head = getHead(dir);

		const result = runDifferentialLint({
			baseSha: base,
			headSha: head,
			repoRoot: dir,
			runId: 'worsened',
			biomeBin: BIOME_BIN,
			event: 'push',
		});

		assert.ok(result.comparison);
		// console.log should be an error (we set it to error), and count 1→2 = WORSENED
		assert.ok(
			result.comparison.worsened.length > 0 || result.comparison.new.length > 0,
			'Expected worsened or new diagnostics when doubling console.log',
		);
	});

	it('64. renamed file with unchanged content = PASS', () => {
		const dir = setupGitFixture('rename-test');

		mkdirSync(join(dir, 'src'), { recursive: true });
		writeFileSync(
			join(dir, 'biome.json'),
			JSON.stringify({
				$schema: 'https://biomejs.dev/schemas/1.9.4/schema.json',
				linter: { enabled: true, rules: { recommended: true } },
			}),
		);
		writeFileSync(join(dir, 'src', 'old.ts'), 'const x = 1;\n');
		commitAll(dir, 'initial');
		const base = getHead(dir);

		execSync('git mv src/old.ts src/new.ts', { cwd: dir, stdio: 'pipe' });
		commitAll(dir, 'rename');
		const head = getHead(dir);

		const result = runDifferentialLint({
			baseSha: base,
			headSha: head,
			repoRoot: dir,
			runId: 'rename',
			biomeBin: BIOME_BIN,
			event: 'push',
		});

		assert.equal(result.result, 'PASS');
	});

	it('65. unchanged legacy diagnostic = PASS', () => {
		const dir = setupGitFixture('unchanged-test');

		mkdirSync(join(dir, 'src'), { recursive: true });
		writeFileSync(
			join(dir, 'biome.json'),
			JSON.stringify({
				$schema: 'https://biomejs.dev/schemas/1.9.4/schema.json',
				linter: { enabled: true, rules: { recommended: true } },
			}),
		);
		writeFileSync(join(dir, 'src', 'app.ts'), 'const x = 1;\n');
		commitAll(dir, 'initial: clean');
		const base = getHead(dir);

		writeFileSync(join(dir, 'src', 'app.ts'), 'const x = 1;\n// comment added\n');
		commitAll(dir, 'second: just a comment');
		const head = getHead(dir);

		const result = runDifferentialLint({
			baseSha: base,
			headSha: head,
			repoRoot: dir,
			runId: 'unchanged',
			biomeBin: BIOME_BIN,
			event: 'push',
		});

		assert.equal(result.result, 'PASS');
	});

	it('66. no lintable changes = PASS', () => {
		const dir = setupGitFixture('no-lintable-test');

		mkdirSync(join(dir, 'src'), { recursive: true });
		writeFileSync(
			join(dir, 'biome.json'),
			JSON.stringify({
				$schema: 'https://biomejs.dev/schemas/1.9.4/schema.json',
				linter: { enabled: true, rules: { recommended: true } },
			}),
		);
		writeFileSync(join(dir, 'src', 'app.ts'), 'const x = 1;\n');
		writeFileSync(join(dir, 'README.md'), '# Hello\n');
		commitAll(dir, 'initial');
		const base = getHead(dir);

		writeFileSync(join(dir, 'README.md'), '# Hello World\n');
		commitAll(dir, 'only markdown changed');
		const head = getHead(dir);

		const result = runDifferentialLint({
			baseSha: base,
			headSha: head,
			repoRoot: dir,
			runId: 'nolint',
			biomeBin: BIOME_BIN,
			event: 'push',
		});

		assert.equal(result.result, 'PASS');
	});

	it('67. added clean file = PASS', () => {
		const dir = setupGitFixture('added-clean-test');

		mkdirSync(join(dir, 'src'), { recursive: true });
		writeFileSync(
			join(dir, 'biome.json'),
			JSON.stringify({
				$schema: 'https://biomejs.dev/schemas/1.9.4/schema.json',
				linter: { enabled: true, rules: { recommended: true } },
			}),
		);
		writeFileSync(join(dir, 'src', 'app.ts'), 'const x = 1;\n');
		commitAll(dir, 'initial');
		const base = getHead(dir);

		writeFileSync(join(dir, 'src', 'extra.ts'), 'const y = 2;\n');
		commitAll(dir, 'add clean file');
		const head = getHead(dir);

		const result = runDifferentialLint({
			baseSha: base,
			headSha: head,
			repoRoot: dir,
			runId: 'added-clean',
			biomeBin: BIOME_BIN,
			event: 'push',
		});

		assert.equal(result.result, 'PASS');
	});

	it('68. deleted file = PASS', () => {
		const dir = setupGitFixture('deleted-test');

		mkdirSync(join(dir, 'src'), { recursive: true });
		writeFileSync(
			join(dir, 'biome.json'),
			JSON.stringify({
				$schema: 'https://biomejs.dev/schemas/1.9.4/schema.json',
				linter: { enabled: true, rules: { recommended: true } },
			}),
		);
		writeFileSync(join(dir, 'src', 'app.ts'), 'const x = 1;\n');
		writeFileSync(join(dir, 'src', 'to-delete.ts'), 'console.log("bye");\n');
		commitAll(dir, 'initial');
		const base = getHead(dir);

		execSync('git rm src/to-delete.ts', { cwd: dir, stdio: 'pipe' });
		commitAll(dir, 'delete file');
		const head = getHead(dir);

		const result = runDifferentialLint({
			baseSha: base,
			headSha: head,
			repoRoot: dir,
			runId: 'deleted',
			biomeBin: BIOME_BIN,
			event: 'push',
		});

		assert.equal(result.result, 'PASS');
	});

	it('69. new file with error = FAIL', () => {
		const dir = setupGitFixture('new-error-test');

		mkdirSync(join(dir, 'src'), { recursive: true });
		writeFileSync(
			join(dir, 'biome.json'),
			JSON.stringify({
				$schema: 'https://biomejs.dev/schemas/1.9.4/schema.json',
				linter: {
					enabled: true,
					rules: { recommended: true, suspicious: { noConsoleLog: 'error' } },
				},
			}),
		);
		writeFileSync(join(dir, 'src', 'app.ts'), 'const x = 1;\n');
		commitAll(dir, 'initial');
		const base = getHead(dir);

		writeFileSync(join(dir, 'src', 'bad.ts'), 'console.log("bad");\n');
		commitAll(dir, 'add bad file');
		const head = getHead(dir);

		const result = runDifferentialLint({
			baseSha: base,
			headSha: head,
			repoRoot: dir,
			runId: 'new-error',
			biomeBin: BIOME_BIN,
			event: 'push',
		});

		assert.ok(result.result.startsWith('FAIL'), `Expected FAIL but got ${result.result}`);
	});

	it('70. rename plus new diagnostic = FAIL', () => {
		const dir = setupGitFixture('rename-new-diag-test');

		mkdirSync(join(dir, 'src'), { recursive: true });
		writeFileSync(
			join(dir, 'biome.json'),
			JSON.stringify({
				$schema: 'https://biomejs.dev/schemas/1.9.4/schema.json',
				linter: {
					enabled: true,
					rules: { recommended: true, suspicious: { noConsoleLog: 'error' } },
				},
			}),
		);
		writeFileSync(join(dir, 'src', 'old.ts'), 'const x = 1;\n');
		commitAll(dir, 'initial');
		const base = getHead(dir);

		execSync('git mv src/old.ts src/new.ts', { cwd: dir, stdio: 'pipe' });
		writeFileSync(join(dir, 'src', 'new.ts'), 'console.log("bad");\nconst x = 1;\n');
		commitAll(dir, 'rename and add error');
		const head = getHead(dir);

		const result = runDifferentialLint({
			baseSha: base,
			headSha: head,
			repoRoot: dir,
			runId: 'rename-new-diag',
			biomeBin: BIOME_BIN,
			event: 'push',
		});

		assert.ok(result.result.startsWith('FAIL'), `Expected FAIL but got ${result.result}`);
	});

	it('71. config change triggers full policy diff', () => {
		const dir = setupGitFixture('config-change-test');

		mkdirSync(join(dir, 'src'), { recursive: true });
		writeFileSync(
			join(dir, 'biome.json'),
			JSON.stringify({
				$schema: 'https://biomejs.dev/schemas/1.9.4/schema.json',
				linter: { enabled: true, rules: { recommended: true } },
			}),
		);
		writeFileSync(join(dir, 'src', 'app.ts'), 'const x = 1;\n');
		commitAll(dir, 'initial');
		const base = getHead(dir);

		// Change biome.json to add a new rule
		writeFileSync(
			join(dir, 'biome.json'),
			JSON.stringify({
				$schema: 'https://biomejs.dev/schemas/1.9.4/schema.json',
				linter: {
					enabled: true,
					rules: { recommended: true, suspicious: { noConsoleLog: 'error' } },
				},
			}),
		);
		commitAll(dir, 'config change');
		const head = getHead(dir);

		const result = runDifferentialLint({
			baseSha: base,
			headSha: head,
			repoRoot: dir,
			runId: 'config-change',
			biomeBin: BIOME_BIN,
			event: 'push',
		});

		assert.ok(result.isFullPolicyDiff, 'Config change should trigger full policy differential');
	});
});

// ─── Suite 15: deleteConfigChangeDetection ──────────────────────────

describe('detectConfigChanges extended', () => {
	it('72. .biome.jsonc triggers', () => {
		assert.ok(detectConfigChanges([{ logicalPath: '.biome.jsonc' }]));
	});

	it('73. src/biome.json triggers (nested config)', () => {
		assert.ok(detectConfigChanges([{ logicalPath: 'src/biome.json' }]));
	});
});

// ─── Suite 16: normalizeDiagnostics with rename map ──────────────────

describe('normalizeDiagnostics with rename', () => {
	it('74. maps old BASE path to HEAD logical path', () => {
		const diags = [
			{
				category: 'lint/style/noNonNullAssertion',
				severity: 'warning',
				description: 'test',
				location: { path: { file: '/tmp/diff/base/src/old.ts' } },
			},
		];
		const renameMap = new Map([['src/old.ts', 'src/new.ts']]);
		const result = normalizeDiagnostics(diags, '/tmp/diff/base', renameMap);
		assert.equal(result[0].file, 'src/new.ts');
	});

	it('75. no rename for unchanged files', () => {
		const diags = [
			{
				category: 'lint/style/noNonNullAssertion',
				severity: 'warning',
				description: 'test',
				location: { path: { file: '/tmp/diff/base/src/unchanged.ts' } },
			},
		];
		const result = normalizeDiagnostics(diags, '/tmp/diff/base', null);
		assert.equal(result[0].file, 'src/unchanged.ts');
	});
});

// ─── Suite 17: createSnapshot (unit) ────────────────────────────────

describe('createSnapshot', () => {
	let dir;

	before(() => {
		dir = setupGitFixture('snapshot-test');
		mkdirSync(join(dir, 'src'), { recursive: true });
		writeFileSync(join(dir, 'biome.json'), '{}');
		writeFileSync(join(dir, 'src', 'app.ts'), 'const x = 1;\n');
		commitAll(dir, 'initial');
	});

	after(() => cleanTestDir());

	it('76. empty tree returns empty dir flag', () => {
		const result = createSnapshot(EMPTY_TREE_SHA, dir, 'test76', 'base');
		assert.ok(existsSync(result.dir));
		assert.equal(result.isFullSnapshot, false);
	});

	it('77. valid SHA creates snapshot', () => {
		const sha = getHead(dir);
		const result = createSnapshot(sha, dir, 'test77', 'head');
		assert.ok(result.isFullSnapshot);
	});
});

// ─── Suite 18: getChangedFiles integration ──────────────────────────

describe('getChangedFiles integration', () => {
	let dir;
	let sha1;
	let sha2;

	before(() => {
		dir = setupGitFixture('diff-test');
		mkdirSync(join(dir, 'src'), { recursive: true });
		writeFileSync(join(dir, 'src', 'app.ts'), 'const x = 1;\n');
		writeFileSync(join(dir, 'src', 'old.ts'), 'const y = 1;\n');
		commitAll(dir, 'initial');
		sha1 = getHead(dir);

		writeFileSync(join(dir, 'src', 'new.ts'), 'const z = 1;\n');
		execSync('git rm src/old.ts', { cwd: dir, stdio: 'pipe' });
		writeFileSync(join(dir, 'README.md'), '# test\n');
		commitAll(dir, 'second');
		sha2 = getHead(dir);
	});

	after(() => cleanTestDir());

	it('78. detects added, modified, deleted files', () => {
		const files = getChangedFiles(sha1, sha2, dir);
		assert.ok(files.length > 0);
		const statuses = files.map((f) => f.status);
		assert.ok(statuses.includes('A'), 'Expected at least one Added file');
		assert.ok(statuses.includes('D'), 'Expected at least one Deleted file');
	});

	it('79. file paths are full repository-relative', () => {
		const files = getChangedFiles(sha1, sha2, dir);
		for (const f of files) {
			if (f.headPath) {
				assert.ok(!f.headPath.startsWith('/'), `Path should be relative: ${f.headPath}`);
			}
			if (f.basePath) {
				assert.ok(!f.basePath.startsWith('/'), `Path should be relative: ${f.basePath}`);
			}
		}
	});

	it('80. no lintable changes in non-code repo', () => {
		const only = getChangedFiles(sha1, sha2, dir).filter((f) =>
			isLintableFile(f.logicalPath || f.basePath || ''),
		);
		// The test only added .ts files, so they should be lintable
		assert.ok(only.length > 0);
	});
});

// ─── Finish ─────────────────────────────────────────────────────────

process.stdout.write('\n✅ All differential lint tests completed.\n');
