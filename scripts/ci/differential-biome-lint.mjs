#!/usr/bin/env node

// ─── Positron: Differential Biome Lint Gate ─────────────────────────
//
// Compares Biome diagnostics between a BASE and HEAD snapshot.
// Blocks only on NEW or WORSENED diagnostics.
//
// Usage:
//   node scripts/ci/differential-biome-lint.mjs \
//     --base <sha> --head <sha> --event <name> \
//     --repo-root <path> --summary <path> --biome-bin <path>
//
// Exit codes:
//   0  PASS
//   1  FAIL_NEW_DIAGNOSTICS
//   2  FAIL_WORSENED_DIAGNOSTICS
//   3  FAIL_INVALID_BASE
//   4  FAIL_BIOME_EXECUTION
//   5  FAIL_BIOME_OUTPUT
//   6  FAIL_GIT_DIFF
//   7  FAIL_CONFIG

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// ─── Constants ──────────────────────────────────────────────────────

export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf899c3e6a8de2e15';

export const EXIT = {
	PASS: 0,
	FAIL_NEW_DIAGNOSTICS: 1,
	FAIL_WORSENED_DIAGNOSTICS: 2,
	FAIL_INVALID_BASE: 3,
	FAIL_BIOME_EXECUTION: 4,
	FAIL_BIOME_OUTPUT: 5,
	FAIL_GIT_DIFF: 6,
	FAIL_CONFIG: 7,
};

const LINTABLE_EXTENSIONS = new Set([
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.ts',
	'.tsx',
	'.mts',
	'.cts',
	'.json',
	'.jsonc',
]);

const CONFIG_SENSITIVE_PATHS = new Set([
	'biome.json',
	'biome.jsonc',
	'package.json',
	'package-lock.json',
	'npm-shrinkwrap.json',
]);

// ─── Git Helpers ────────────────────────────────────────────────────

/**
 * Run git command, return { stdout, stderr, exitCode }.
 * Fails on spawn error.
 */
export function git(args, cwd = process.cwd()) {
	const r = spawnSync('git', args, { encoding: 'utf8', cwd, timeout: 30_000 });
	if (r.error) {
		throw new Error(`git spawn error: ${r.error.message}`);
	}
	return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', exitCode: r.status ?? 1 };
}

/**
 * Verify a SHA exists and is a commit-ish in the local repo.
 */
export function validateCommit(sha) {
	if (!sha || typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) {
		return false;
	}
	try {
		const r = spawnSync('git', ['cat-file', '-e', sha], { timeout: 10_000 });
		return r.status === 0;
	} catch {
		return false;
	}
}

/**
 * Determine BASE and HEAD SHAs from event context.
 */
export function determineShas(event, inputs = {}) {
	let base = '';
	let head = '';

	switch (event) {
		case 'pull_request':
			base = inputs.baseSha || '';
			head = inputs.headSha || '';
			break;

		case 'push': {
			const before = inputs.before || '';
			if (before === '0000000000000000000000000000000000000000') {
				base = EMPTY_TREE_SHA;
			} else {
				base = before;
			}
			head = inputs.headSha || 'HEAD';
			break;
		}

		case 'workflow_dispatch': {
			const inputSha = inputs.baseSha || '';
			if (!inputSha || !/^[0-9a-f]{40}$/.test(inputSha)) {
				return {
					baseSha: null,
					headSha: null,
					error: 'workflow_dispatch requires a valid base_sha input',
				};
			}
			if (!validateCommit(inputSha)) {
				return {
					baseSha: null,
					headSha: null,
					error: `base_sha ${inputSha} is not a valid commit in this repository`,
				};
			}
			base = inputSha;
			head = inputs.headSha || 'HEAD';
			break;
		}

		default:
			if (inputs.baseSha && validateCommit(inputs.baseSha)) {
				base = inputs.baseSha;
			} else {
				return {
					baseSha: null,
					headSha: null,
					error: `unknown event "${event}" and no valid base_sha provided`,
				};
			}
			head = inputs.headSha || 'HEAD';
	}

	if (!base) {
		return {
			baseSha: null,
			headSha: null,
			error: `could not determine BASE SHA for event "${event}"`,
		};
	}

	if (base !== EMPTY_TREE_SHA && !validateCommit(base)) {
		return {
			baseSha: null,
			headSha: null,
			error: `BASE SHA ${base} is not available in this repository`,
		};
	}

	return { baseSha: base, headSha: head, error: null };
}

// ─── Changed File Detection ─────────────────────────────────────────

/**
 * Parse NUL-separated git diff --name-status -M output.
 * Returns array of change records.
 */
export function parseChangedFiles(raw) {
	const files = [];
	if (!raw) return files;

	const tokens = raw.split('\0').filter(Boolean);
	let i = 0;
	while (i < tokens.length) {
		const statusEntry = tokens[i++];
		if (!statusEntry) continue;

		const status = statusEntry.charAt(0);

		if (status === 'R') {
			const sim = statusEntry.slice(1);
			const oldPath = tokens[i++] || '';
			const newPath = tokens[i++] || '';
			files.push({
				status: 'R',
				similarity: sim || undefined,
				basePath: oldPath,
				headPath: newPath,
				logicalPath: newPath,
			});
		} else if (status === 'C') {
			const sim = statusEntry.slice(1);
			const oldPath = tokens[i++] || '';
			const newPath = tokens[i++] || '';
			files.push({
				status: 'C',
				similarity: sim || undefined,
				basePath: oldPath,
				headPath: newPath,
				logicalPath: newPath,
			});
		} else {
			const path = tokens[i++] || '';
			const record = { status, basePath: path, headPath: path, logicalPath: path };
			if (status === 'A') {
				record.basePath = null;
			} else if (status === 'D') {
				record.headPath = null;
				record.logicalPath = path;
			}
			files.push(record);
		}
	}
	return files;
}

/**
 * Get changed files between two SHAs using exact diff.
 * Uses NUL-separated --name-status -M to detect renames.
 */
export function getChangedFiles(baseSha, headSha, cwd = process.cwd()) {
	const r = git(['diff', '--name-status', '-z', '-M', baseSha, headSha], cwd);
	if (r.exitCode !== 0) {
		throw Object.assign(new Error(`git diff failed: ${r.stderr}`), {
			exitCode: EXIT.FAIL_GIT_DIFF,
		});
	}
	return parseChangedFiles(r.stdout);
}

// ─── File Type Detection ────────────────────────────────────────────

/**
 * Check if a path is a lintable file type.
 * Also checks the repository's biome.json configuration if available.
 */
export function isLintableFile(filePath, configExtensions = null) {
	const ext = extname(filePath).toLowerCase();
	if (LINTABLE_EXTENSIONS.has(ext)) return true;
	// Also check custom extensions from config if provided
	if (configExtensions?.has(ext)) return true;
	return false;
}

// ─── Config Change Detection ────────────────────────────────────────

/**
 * Detect if changed files include Biome config or dependency changes
 * that require a full policy differential comparison.
 */
export function detectConfigChanges(changedFiles) {
	const configChanged = changedFiles.some((f) => CONFIG_SENSITIVE_PATHS.has(f.logicalPath));

	// Also check for biome-related config extensions
	const biomeConfigChanged = changedFiles.some((f) => {
		const name = basename(f.logicalPath);
		return (
			name.startsWith('biome.') ||
			name === 'biome.json' ||
			name === 'biome.jsonc' ||
			name === '.biome.json' ||
			name === '.biome.jsonc'
		);
	});

	return configChanged || biomeConfigChanged;
}

// ─── Snapshot Creation ──────────────────────────────────────────────

/**
 * Create a snapshot directory containing all lintable files from a given commit.
 * Uses git archive + selective extraction to preserve full directory structure.
 * Returns { dir, isFullSnapshot }.
 */
export function createSnapshot(sha, repoRoot, runId, label) {
	const dir = join('/tmp', `positron-diff-${runId}`, label);
	mkdirSync(dir, { recursive: true });

	if (sha === EMPTY_TREE_SHA) {
		return { dir, isFullSnapshot: false };
	}

	// Use git archive to get the full tree
	try {
		const r = spawnSync('git', ['archive', '--format=tar', sha], {
			cwd: repoRoot,
			timeout: 30_000,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		if (r.error || r.status !== 0) {
			// Fallback: empty directory
			return { dir, isFullSnapshot: false };
		}

		writeFileSync(join('/tmp', `positron-diff-${runId}`, `${label}.tar`), r.stdout);
		const extractResult = spawnSync(
			'tar',
			['-xf', join('/tmp', `positron-diff-${runId}`, `${label}.tar`), '-C', dir],
			{
				timeout: 30_000,
			},
		);

		if (extractResult.error || extractResult.status !== 0) {
			// Clean up tar
			rmSync(join('/tmp', `positron-diff-${runId}`, `${label}.tar`), { force: true });
			return { dir, isFullSnapshot: false };
		}

		// Clean up tar
		rmSync(join('/tmp', `positron-diff-${runId}`, `${label}.tar`), { force: true });
		return { dir, isFullSnapshot: true };
	} catch {
		return { dir, isFullSnapshot: false };
	}
}

/**
 * Copy individual file from git show into snapshot, preserving directory structure.
 */
function extractFileToSnapshot(sha, filePath, snapshotDir, repoRoot) {
	const destPath = join(snapshotDir, filePath);
	mkdirSync(dirname(destPath), { recursive: true });

	if (sha === EMPTY_TREE_SHA) {
		// File doesn't exist at empty tree — don't write anything
		return false;
	}

	try {
		const r = spawnSync('git', ['show', `${sha}:${filePath}`], {
			cwd: repoRoot,
			encoding: 'utf8',
			timeout: 10_000,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		if (r.error || r.status !== 0) return false;
		writeFileSync(destPath, r.stdout);
		return true;
	} catch {
		return false;
	}
}

/**
 * Create BASE and HEAD snapshots for selective file differential comparison.
 */
export function createSnapshots(baseSha, headSha, changedFiles, repoRoot, runId) {
	const baseDir = join('/tmp', `positron-diff-${runId}`, 'base');
	const headDir = join('/tmp', `positron-diff-${runId}`, 'head');
	mkdirSync(baseDir, { recursive: true });
	mkdirSync(headDir, { recursive: true });

	// Copy config files to both snapshots (needed for Biome to read config)
	const configFiles = ['biome.json', 'biome.jsonc', 'package.json'];
	for (const cf of configFiles) {
		extractFileToSnapshot(baseSha, cf, baseDir, repoRoot);
		extractFileToSnapshot(headSha, cf, headDir, repoRoot);
	}

	// Extract each changed file to the appropriate snapshot
	for (const file of changedFiles) {
		// For HEAD: extract the new version (headPath)
		if (file.headPath) {
			extractFileToSnapshot(headSha, file.headPath, headDir, repoRoot);
		}

		// For BASE: extract the old version (basePath for modified/renamed/deleted)
		if (file.basePath && file.basePath !== file.headPath) {
			extractFileToSnapshot(baseSha, file.basePath, baseDir, repoRoot);
		} else if (file.basePath && file.basePath === file.headPath) {
			extractFileToSnapshot(baseSha, file.basePath, baseDir, repoRoot);
		}
		// Added files: no BASE copy needed (they didn't exist)
	}

	return {
		baseDir,
		headDir,
		cleanup: () => {
			rmSync(join('/tmp', `positron-diff-${runId}`), { recursive: true, force: true });
		},
	};
}

/**
 * Create full snapshots for config-change differential.
 */
export function createFullSnapshots(baseSha, headSha, repoRoot, runId) {
	const baseResult = createSnapshot(baseSha, repoRoot, runId, 'base');
	const headResult = createSnapshot(headSha, repoRoot, runId, 'head');
	return {
		baseDir: baseResult.dir,
		headDir: headResult.dir,
		cleanup: () => {
			rmSync(join('/tmp', `positron-diff-${runId}`), { recursive: true, force: true });
		},
	};
}

// ─── Biome Execution & Parsing ──────────────────────────────────────

/**
 * Run biome lint on a directory.
 * Returns { diagnostics, summary, exitCode, stderr }.
 */
export function runBiome(lintDir, biomeBin, configPath = null) {
	const args = ['lint', '--reporter=json', '--max-diagnostics=none'];

	if (configPath) {
		args.push('--config-path', configPath);
	}

	args.push(lintDir);

	const r = spawnSync(biomeBin, args, {
		cwd: lintDir,
		encoding: 'utf8',
		timeout: 120_000,
		stdio: ['ignore', 'pipe', 'pipe'],
		maxBuffer: 50 * 1024 * 1024,
	});

	if (r.error) {
		throw Object.assign(new Error(`biome spawn error: ${r.error.message}`), {
			exitCode: EXIT.FAIL_BIOME_EXECUTION,
		});
	}

	if (r.status === null && r.signal) {
		throw Object.assign(new Error(`biome killed by signal ${r.signal}`), {
			exitCode: EXIT.FAIL_BIOME_EXECUTION,
		});
	}

	return {
		stdout: r.stdout ?? '',
		stderr: r.stderr ?? '',
		exitCode: r.status ?? 1,
	};
}

/**
 * Parse Biome JSON output into structured diagnostics.
 * Handles the complete JSON document format.
 * Returns { diagnostics, summary } or throws on parse failure.
 */
export function parseBiomeOutput(stdout) {
	if (!stdout || stdout.trim() === '') {
		throw Object.assign(new Error('Biome produced empty output'), {
			exitCode: EXIT.FAIL_BIOME_OUTPUT,
		});
	}

	let data;
	try {
		data = JSON.parse(stdout);
	} catch (e) {
		throw Object.assign(new Error(`Failed to parse Biome JSON: ${e.message}`), {
			exitCode: EXIT.FAIL_BIOME_OUTPUT,
		});
	}

	if (!data || typeof data !== 'object') {
		throw Object.assign(new Error('Biome JSON is not an object'), {
			exitCode: EXIT.FAIL_BIOME_OUTPUT,
		});
	}

	const summary = data.summary || {};
	const diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];

	return { summary, diagnostics };
}

/**
 * Normalize a single diagnostic into a comparison key.
 * Extracts the repository-relative path from the absolute path.
 */
export function normalizeDiagnostic(diag, snapshotRoot) {
	let filePath = '';
	const loc = diag.location;
	if (loc?.path) {
		if (typeof loc.path === 'string') {
			filePath = loc.path;
		} else if (loc.path.file) {
			filePath = loc.path.file;
		}
	}

	// Strip snapshot root prefix to get repository-relative path
	let relativePath = filePath;
	if (snapshotRoot && filePath.startsWith(snapshotRoot)) {
		relativePath = filePath.slice(snapshotRoot.length).replace(/^\//, '');
	}
	// Also strip /tmp/positron-diff-* prefix
	const tmpMatch = filePath.match(/\/tmp\/positron-diff-[^/]+\/(?:base|head)\/(.+)/);
	if (tmpMatch) {
		relativePath = tmpMatch[1];
	}

	return {
		file: relativePath || filePath,
		rule: diag.category || '',
		severity: diag.severity || '',
		message: diag.description || '',
	};
}

/**
 * Normalize all diagnostics, mapping renamed files' BASE paths to HEAD paths.
 */
export function normalizeDiagnostics(diagnostics, snapshotRoot, renameMap = null) {
	const normalized = [];
	for (const d of diagnostics) {
		const nd = normalizeDiagnostic(d, snapshotRoot);
		// For renames: map old BASE path to new HEAD logical path
		if (renameMap?.has(nd.file)) {
			nd.file = renameMap.get(nd.file);
		}
		normalized.push(nd);
	}
	return normalized;
}

// ─── Diagnostic Key & Multiset ──────────────────────────────────────

/**
 * Create a stable string key from a normalized diagnostic.
 */
export function diagnosticKey(diag) {
	return `${diag.file}\0${diag.rule}\0${diag.severity}\0${diag.message}`;
}

/**
 * Build a counted multiset (Map<string, number>) from diagnostics.
 */
export function buildDiagnosticCounts(diagnostics) {
	const map = new Map();
	for (const d of diagnostics) {
		const key = diagnosticKey(d);
		map.set(key, (map.get(key) || 0) + 1);
	}
	return map;
}

/**
 * Compare BASE and HEAD diagnostic multisets.
 * Returns structured comparison result.
 */
export function compareDiagnostics(baseCounts, headCounts) {
	const result = {
		new: [],
		worsened: [],
		unchanged: [],
		improved: [],
		removed: [],
	};

	// Collect all keys
	const allKeys = new Set([...baseCounts.keys(), ...headCounts.keys()]);

	for (const key of allKeys) {
		const baseCount = baseCounts.get(key) || 0;
		const headCount = headCounts.get(key) || 0;
		const delta = headCount - baseCount;

		const entry = {
			key,
			baseCount,
			headCount,
			delta,
		};

		if (baseCount === 0 && headCount > 0) {
			result.new.push(entry);
		} else if (headCount > baseCount && baseCount > 0) {
			result.worsened.push(entry);
		} else if (headCount === baseCount && baseCount > 0) {
			result.unchanged.push(entry);
		} else if (headCount < baseCount && headCount > 0) {
			result.improved.push(entry);
		} else if (headCount === 0 && baseCount > 0) {
			result.removed.push(entry);
		}
	}

	// Sort each category by file path
	const sortFn = (a, b) => a.key.localeCompare(b.key);
	result.new.sort(sortFn);
	result.worsened.sort(sortFn);
	result.unchanged.sort(sortFn);
	result.improved.sort(sortFn);
	result.removed.sort(sortFn);

	return result;
}

// ─── File Discovery ─────────────────────────────────────────────────

/**
 * Recursively find all lintable files in a directory.
 */
export function findLintableFiles(dir) {
	const results = [];
	if (!existsSync(dir)) return results;

	// Read config to get ignore patterns
	const ignore = new Set([
		'node_modules',
		'dist',
		'.positron',
		'coverage',
		'.stryker-tmp',
		'test-results',
		'playwright-report',
		'.git',
	]);

	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (ignore.has(entry.name) || entry.name.startsWith('.')) continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				results.push(...findLintableFiles(full));
			} else if (entry.isFile() && isLintableFile(full)) {
				results.push(full);
			}
		}
	} catch {
		// Permission errors — skip
	}

	return results;
}

// ─── Main Differential Lint ─────────────────────────────────────────

/**
 * Run the complete differential lint analysis.
 */
export function runDifferentialLint({
	baseSha,
	headSha,
	repoRoot,
	runId,
	biomeBin,
	event,
}) {
	const result = {
		baseSha,
		headSha,
		event,
		changedFiles: [],
		lintableFiles: [],
		isFullPolicyDiff: false,
		baseDiagnostics: [],
		headDiagnostics: [],
		comparison: null,
		result: 'PASS',
		errors: [],
		warnings: [],
	};

	// Step 1: Get changed files
	let changedFiles;
	try {
		changedFiles = getChangedFiles(baseSha, headSha, repoRoot);
	} catch (e) {
		result.result = 'FAIL_GIT_DIFF';
		result.errors.push(`git diff failed: ${e.message}`);
		return result;
	}

	result.changedFiles = changedFiles;
	const lintableChanged = changedFiles.filter((f) => {
		const p = f.logicalPath || f.basePath;
		return p && isLintableFile(p);
	});

	result.lintableFiles = lintableChanged;

	// Step 2: Check for config changes
	result.isFullPolicyDiff = detectConfigChanges(changedFiles);

	// Step 3: If no lintable changes, PASS
	if (lintableChanged.length === 0) {
		result.result = 'PASS';
		result.warnings.push('No lintable files changed');
		return result;
	}

	// Step 4: Build rename map (basePath → logicalPath for renamed files)
	const renameMap = new Map();
	for (const f of changedFiles) {
		if (f.status === 'R' && f.basePath && f.headPath && f.basePath !== f.headPath) {
			renameMap.set(f.basePath, f.headPath);
		}
	}

	// Step 5: Create snapshots
	let snapshots;
	try {
		if (result.isFullPolicyDiff) {
			snapshots = createFullSnapshots(baseSha, headSha, repoRoot, runId);
		} else {
			snapshots = createSnapshots(baseSha, headSha, lintableChanged, repoRoot, runId);
		}
	} catch (e) {
		result.result = 'FAIL_GIT_DIFF';
		result.errors.push(`Snapshot creation failed: ${e.message}`);
		return result;
	}

	// Step 6: Run Biome on both snapshots
	let baseResult;
	let headResult;
	try {
		baseResult = runBiome(snapshots.baseDir, biomeBin);
	} catch (e) {
		result.result = 'FAIL_BIOME_EXECUTION';
		result.errors.push(`BASE biome execution failed: ${e.message}`);
		snapshots.cleanup();
		return result;
	}

	try {
		headResult = runBiome(snapshots.headDir, biomeBin);
	} catch (e) {
		result.result = 'FAIL_BIOME_EXECUTION';
		result.errors.push(`HEAD biome execution failed: ${e.message}`);
		snapshots.cleanup();
		return result;
	}

	// Step 7: Parse Biome output
	let baseDiagnostics;
	let headDiagnostics;
	try {
		baseDiagnostics = parseBiomeOutput(baseResult.stdout).diagnostics;
	} catch (e) {
		result.result = 'FAIL_BIOME_OUTPUT';
		result.errors.push(`BASE biome output parse failed: ${e.message}`);
		snapshots.cleanup();
		return result;
	}

	try {
		headDiagnostics = parseBiomeOutput(headResult.stdout).diagnostics;
	} catch (e) {
		result.result = 'FAIL_BIOME_OUTPUT';
		result.errors.push(`HEAD biome output parse failed: ${e.message}`);
		snapshots.cleanup();
		return result;
	}

	// Step 8: Normalize diagnostics
	const normalizedBase = normalizeDiagnostics(baseDiagnostics, snapshots.baseDir, renameMap);
	const normalizedHead = normalizeDiagnostics(headDiagnostics, snapshots.headDir, null);

	result.baseDiagnostics = normalizedBase;
	result.headDiagnostics = normalizedHead;

	// Step 9: Build counted multisets and compare
	const baseCounts = buildDiagnosticCounts(normalizedBase);
	const headCounts = buildDiagnosticCounts(normalizedHead);
	result.comparison = compareDiagnostics(baseCounts, headCounts);

	// Step 10: Determine result
	if (result.comparison.new.length > 0 && result.comparison.worsened.length > 0) {
		result.result = 'FAIL_NEW_AND_WORSENED';
	} else if (result.comparison.new.length > 0) {
		result.result = 'FAIL_NEW_DIAGNOSTICS';
	} else if (result.comparison.worsened.length > 0) {
		result.result = 'FAIL_WORSENED_DIAGNOSTICS';
	} else {
		result.result = 'PASS';
	}

	// Cleanup
	snapshots.cleanup();

	return result;
}

// ─── Summary Rendering ──────────────────────────────────────────────

/**
 * Parse a diagnostic key back into components for display.
 */
export function parseKey(key) {
	const parts = key.split('\0');
	return {
		file: parts[0] || '',
		rule: parts[1] || '',
		severity: parts[2] || '',
		message: parts[3] || '',
	};
}

/**
 * Render a markdown summary of the comparison result.
 */
export function renderSummary(result) {
	const lines = [];
	lines.push('## Differential Biome Lint Report');
	lines.push('');
	lines.push('| Field | Value |');
	lines.push('|-------|-------|');
	lines.push(`| Base SHA | \`${result.baseSha}\` |`);
	lines.push(`| Head SHA | \`${result.headSha}\` |`);
	lines.push(`| Event | ${result.event} |`);
	lines.push(`| Changed files | ${result.changedFiles.length} |`);
	lines.push(`| Lintable changed files | ${result.lintableFiles.length} |`);
	lines.push(`| Full policy diff | ${result.isFullPolicyDiff ? 'YES' : 'no'} |`);

	if (result.comparison) {
		lines.push(`| NEW diagnostics | **${result.comparison.new.length}** |`);
		lines.push(`| WORSENED diagnostics | **${result.comparison.worsened.length}** |`);
		lines.push(`| UNCHANGED diagnostics | ${result.comparison.unchanged.length} |`);
		lines.push(`| IMPROVED diagnostics | ${result.comparison.improved.length} |`);
		lines.push(`| REMOVED diagnostics | ${result.comparison.removed.length} |`);
	} else {
		lines.push(`| Diagnostics | N/A (${result.result}) |`);
	}

	lines.push(`| Result | **${result.result}** |`);
	lines.push('');

	if (result.errors.length > 0) {
		lines.push('### Errors');
		for (const e of result.errors) {
			lines.push(`- \`${e}\``);
		}
		lines.push('');
	}

	if (result.warnings.length > 0) {
		lines.push('### Warnings');
		for (const w of result.warnings) {
			lines.push(`- ${w}`);
		}
		lines.push('');
	}

	if (result.comparison) {
		if (result.comparison.new.length > 0) {
			lines.push('### NEW Diagnostics');
			lines.push('');
			for (const entry of result.comparison.new) {
				const d = parseKey(entry.key);
				lines.push(`- **\`${d.file}\`** ${d.severity}: \`${d.rule}\` — ${d.message}`);
			}
			lines.push('');
		}

		if (result.comparison.worsened.length > 0) {
			lines.push('### WORSENED Diagnostics');
			lines.push('');
			for (const entry of result.comparison.worsened) {
				const d = parseKey(entry.key);
				lines.push(
					`- **\`${d.file}\`** ${d.severity}: \`${d.rule}\` — ${d.message} (${entry.baseCount}→${entry.headCount})`,
				);
			}
			lines.push('');
		}

		if (result.comparison.improved.length > 0) {
			lines.push(`### IMPROVED (${result.comparison.improved.length})`);
			lines.push('');
			for (const entry of result.comparison.improved.slice(0, 5)) {
				const d = parseKey(entry.key);
				lines.push(`- **\`${d.file}\`** ${d.rule} (${entry.baseCount}→${entry.headCount})`);
			}
			if (result.comparison.improved.length > 5) {
				lines.push(`- ... and ${result.comparison.improved.length - 5} more`);
			}
			lines.push('');
		}
	}

	return lines.join('\n');
}

// ─── CLI Entry Point ────────────────────────────────────────────────

function parseCliArgs(argv) {
	const options = {
		base: { type: 'string' },
		head: { type: 'string' },
		event: { type: 'string' },
		'repo-root': { type: 'string', default: process.cwd() },
		summary: { type: 'string' },
		'biome-bin': { type: 'string', default: 'node_modules/@biomejs/biome/bin/biome' },
		'run-id': { type: 'string' },
		before: { type: 'string' },
		'base-sha-input': { type: 'string' },
		'head-sha-input': { type: 'string' },
	};

	try {
		const { values } = parseArgs({ args: argv, options, strict: false, allowPositionals: true });
		return {
			base: values.base || '',
			head: values.head || '',
			event: values.event || 'push',
			repoRoot: resolve(values['repo-root'] || process.cwd()),
			summaryPath: values.summary || '',
			biomeBin: resolve(values['biome-bin'] || 'node_modules/@biomejs/biome/bin/biome'),
			runId: values['run-id'] || Date.now().toString(36),
			before: values.before || '',
			baseShaInput: values['base-sha-input'] || '',
			headShaInput: values['head-sha-input'] || '',
		};
	} catch (e) {
		throw Object.assign(new Error(`Failed to parse CLI args: ${e.message}`), {
			exitCode: EXIT.FAIL_CONFIG,
		});
	}
}

async function mainCLI() {
	const cli = parseCliArgs(process.argv.slice(2));

	// When --base/--head are explicitly passed from CLI, use them directly
	// (CLI mode). Otherwise, derive SHAs from event context (CI mode).
	let baseSha;
	let headSha;

	if (cli.base || cli.head) {
		// CLI mode: explicit SHAs --base and --head override event logic
		baseSha = cli.base || cli.before || '';
		headSha = cli.head || 'HEAD';

		if (!baseSha) {
			console.error('ERROR: --base is required when no event context is available');
			process.exit(EXIT.FAIL_INVALID_BASE);
		}

		if (baseSha !== EMPTY_TREE_SHA && !validateCommit(baseSha)) {
			console.error(`ERROR: BASE SHA ${baseSha} is not a valid commit in this repository`);
			process.exit(EXIT.FAIL_INVALID_BASE);
		}
	} else {
		// CI mode: derive from event context
		const shas = determineShas(cli.event, {
			baseSha: cli.baseShaInput,
			headSha: cli.headShaInput,
			before: cli.before,
		});

		if (shas.error) {
			console.error(`ERROR: ${shas.error}`);
			process.exit(EXIT.FAIL_INVALID_BASE);
		}

		baseSha = shas.baseSha;
		headSha = shas.headSha;
	}

	// Run differential lint
	const result = runDifferentialLint({
		baseSha: baseSha,
		headSha: headSha,
		repoRoot: cli.repoRoot,
		runId: cli.runId,
		biomeBin: cli.biomeBin,
		event: cli.event,
	});

	// Render summary
	const summary = renderSummary(result);
	process.stdout.write(`${summary}\n`);

	// Write summary file if requested
	if (cli.summaryPath) {
		try {
			writeFileSync(cli.summaryPath, summary, 'utf8');
		} catch (e) {
			console.error(`Warning: Could not write summary to ${cli.summaryPath}: ${e.message}`);
		}
	}

	// Exit with appropriate code
	switch (result.result) {
		case 'PASS':
			process.exit(EXIT.PASS);
			break;
		case 'FAIL_NEW_DIAGNOSTICS':
		case 'FAIL_NEW_AND_WORSENED':
			process.exit(EXIT.FAIL_NEW_DIAGNOSTICS);
			break;
		case 'FAIL_WORSENED_DIAGNOSTICS':
			process.exit(EXIT.FAIL_WORSENED_DIAGNOSTICS);
			break;
		case 'FAIL_GIT_DIFF':
			process.exit(EXIT.FAIL_GIT_DIFF);
			break;
		case 'FAIL_BIOME_EXECUTION':
			process.exit(EXIT.FAIL_BIOME_EXECUTION);
			break;
		case 'FAIL_BIOME_OUTPUT':
			process.exit(EXIT.FAIL_BIOME_OUTPUT);
			break;
		default:
			process.exit(EXIT.FAIL_CONFIG);
	}
}

// Run CLI only when executed directly
const isMain =
	process.argv[1] &&
	(process.argv[1].endsWith('differential-biome-lint.mjs') ||
		process.argv[1] === fileURLToPath(import.meta.url));

if (isMain) {
	mainCLI().catch((err) => {
		console.error(`FATAL: ${err.message}`);
		process.exit(err.exitCode || EXIT.FAIL_CONFIG);
	});
}
