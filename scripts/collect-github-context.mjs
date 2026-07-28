#!/usr/bin/env node
// Positron — GitHub Snapshot Collector CLI (Issue #279 Phase 1C)
// Read-only: gathers gh issue/PR state, normalizes via shared snapshot collector,
// feeds the Phase 1B reconciler, and prints a decision summary.
//
// Usage:
//   node scripts/collect-github-context.mjs --repo xxammaxx/Positron --dry-run
//   node scripts/collect-github-context.mjs --repo xxammaxx/Positron --output ".local-release/snapshot.json"

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Read-only command allowlist (duplicated from shared for zero-dependency CLI)
// ---------------------------------------------------------------------------

const ALLOWED_GH_COMMANDS = new Set([
	'gh repo view',
	'gh pr list',
	'gh pr view',
	'gh issue list',
	'gh issue view',
]);

function isAllowedGhCommand(cmd) {
	const parts = cmd.slice(0, 3);
	if (parts.length < 3) return false;
	if (parts[0] !== 'gh') return false;
	const prefix = `${parts[0]} ${parts[1]} ${parts[2]}`;
	return ALLOWED_GH_COMMANDS.has(prefix);
}

/**
 * Run a gh command and return parsed JSON.
 * @param {string[]} args
 * @param {boolean} dryRun
 * @returns {unknown}
 */
function runGh(args, dryRun) {
	if (!isAllowedGhCommand(args)) {
		throw new Error(
			`BLOCKED: gh command not in read-only allowlist: ${args.slice(0, 3).join(' ')}`,
		);
	}

	if (dryRun) {
		console.log(`[DRY-RUN] gh ${args.slice(1).join(' ')}`);
		return [];
	}

	const result = spawnSync('gh', args.slice(1), {
		encoding: 'utf-8',
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 30000,
	});

	if (result.error) {
		throw new Error(`gh command failed: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(`gh exited ${result.status}: ${result.stderr?.trim() ?? 'unknown error'}`);
	}

	try {
		return JSON.parse(result.stdout);
	} catch {
		throw new Error(`gh output is not valid JSON: ${result.stdout.slice(0, 200)}`);
	}
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
	const args = process.argv.slice(2);
	const options = {
		dryRun: false,
		repo: 'xxammaxx/Positron',
		output: null,
		help: false,
		targetPr: null,
		targetIssue: null,
	};

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case '--dry-run':
				options.dryRun = true;
				break;
			case '--repo':
				options.repo = args[++i] ?? options.repo;
				break;
			case '--output':
				options.output = args[++i] ?? null;
				break;
			case '--target-pr':
				options.targetPr = Number.parseInt(args[++i] ?? '0', 10) || null;
				break;
			case '--target-issue':
				options.targetIssue = Number.parseInt(args[++i] ?? '0', 10) || null;
				break;
			case '--help':
			case '-h':
				options.help = true;
				break;
			default:
				break;
		}
	}

	return options;
}

function printHelp() {
	console.log(`
Positron GitHub Snapshot Collector (Issue #279 Phase 1C)

Read-only collector that gathers GitHub issue/PR state and produces
a decision manifest via the Phase 1B reconciler.

Usage:
  node scripts/collect-github-context.mjs [options]

Options:
  --repo <owner/name>     Target repository (default: xxammaxx/Positron)
  --dry-run               Simulate without calling GitHub
  --output <path>         Write JSON snapshot to file
  --target-pr <number>    Enrich a specific PR with review findings
  --target-issue <number> Fetch details for a specific issue
  --help, -h              Show this help

Examples:
  # Dry-run with default repo
  node scripts/collect-github-context.mjs --dry-run

  # Collect live data and save snapshot
  node scripts/collect-github-context.mjs --output .local-release/snapshot.json

  # Enrich PR #218 with review findings
  node scripts/collect-github-context.mjs --target-pr 218 --dry-run

Safe: Only read-only gh commands are used. No mutations.
`);
}

// ---------------------------------------------------------------------------
// Collector logic
// ---------------------------------------------------------------------------

async function collectSnapshot(options) {
	const { dryRun, repo, targetPr, targetIssue } = options;

	console.log('Positron GitHub Snapshot Collector — Phase 1C');
	console.log(`  Repo: ${repo}`);
	console.log(`  Dry-run: ${dryRun}`);
	console.log('');

	// 1. Collect open issues
	console.log('[1/4] Collecting open issues...');
	const issues = runGh(
		[
			'gh',
			'issue',
			'list',
			'--repo',
			repo,
			'--state',
			'open',
			'--limit',
			'100',
			'--json',
			'number,title,state,labels,url,body',
		],
		dryRun,
	);

	// 2. Collect open PRs
	console.log('[2/4] Collecting open PRs...');
	const pullRequests = runGh(
		[
			'gh',
			'pr',
			'list',
			'--repo',
			repo,
			'--state',
			'open',
			'--limit',
			'100',
			'--json',
			'number,title,state,mergeable,isDraft,url',
		],
		dryRun,
	);

	// 3. Optional: enrich target PR with review findings
	let prEnrichment = {};
	if (targetPr && !dryRun) {
		console.log(`[2a/4] Enriching PR #${targetPr} with review findings...`);
		try {
			const enrichment = runGh(
				[
					'gh',
					'pr',
					'view',
					String(targetPr),
					'--repo',
					repo,
					'--json',
					'reviews,statusCheckRollup',
				],
				false,
			);
			prEnrichment = { [targetPr]: enrichment };
		} catch (err) {
			console.warn(`  Warning: could not enrich PR #${targetPr}: ${err.message}`);
		}
	}

	// 4. Optional: fetch targeted issue details (appended to open issues list)
	let targetedIssues = [];
	if (targetIssue && !dryRun) {
		console.log(`[3a/4] Fetching targeted issue #${targetIssue} details...`);
		try {
			const issueDetail = runGh(
				[
					'gh',
					'issue',
					'view',
					String(targetIssue),
					'--repo',
					repo,
					'--json',
					'number,title,state,labels,url,body',
				],
				false,
			);
			// gh issue view returns a single object; wrap in array
			if (issueDetail && typeof issueDetail.number === 'number') {
				targetedIssues = [issueDetail];
			}
		} catch (err) {
			console.warn(`  Warning: could not fetch issue #${targetIssue}: ${err.message}`);
		}
	}

	console.log('');

	// Build snapshot (merge targeted issues into open issues list)
	const snapshot = {
		collectedAt: new Date().toISOString(),
		repo,
		dryRun,
		issues: [...(Array.isArray(issues) ? issues : []), ...targetedIssues],
		pullRequests,
		prEnrichment,
	};

	return snapshot;
}

// ---------------------------------------------------------------------------
// Decision summary (inline Reconciler/Validator if importable)
// ---------------------------------------------------------------------------

async function printDecisionSummary(snapshot, options) {
	// Try to import the shared modules for in-process validation
	let reconcilerMod = null;
	let validatorMod = null;
	let collectorMod = null;

	try {
		// Dynamic import — works if build artifacts exist
		collectorMod = await import('../packages/shared/dist/github-snapshot-collector.js');
		reconcilerMod = await import('../packages/shared/dist/github-context-reconciler.js');
		validatorMod = await import('../packages/shared/dist/decision-manifest.js');
	} catch {
		// Fallback: print raw snapshot summary
		console.log('--- Decision Summary (raw) ---');
		console.log(`  Issues: ${Array.isArray(snapshot.issues) ? snapshot.issues.length : 0}`);
		console.log(
			`  PRs: ${Array.isArray(snapshot.pullRequests) ? snapshot.pullRequests.length : 0}`,
		);
		console.log('  (No reconciler available — build shared/dist first)');
		return;
	}

	// Build normalized context snapshot
	const ctxSnapshot = collectorMod.createGitHubContextSnapshot({
		issues: snapshot.issues ?? [],
		pullRequests: snapshot.pullRequests ?? [],
		prEnrichment: snapshot.prEnrichment ?? {},
	});

	// Run reconciler
	const result = reconcilerMod.reconcileGitHubContext(ctxSnapshot);

	// Print summary
	console.log('--- Decision Summary ---');
	console.log(`  Rows: ${result.rows.length}`);
	console.log(`  Valid: ${result.validation.valid ? 'YES' : 'NO'}`);
	console.log(`  Applyable: ${result.applyableCount}`);
	console.log(`  Errors: ${result.validation.errors.length}`);
	console.log(`  Warnings: ${result.validation.warnings.length}`);
	console.log('');
	console.log('  Risk class counts:');
	for (const [rc, count] of Object.entries(result.validation.counts)) {
		if (count > 0) {
			console.log(`    ${rc}: ${count}`);
		}
	}

	if (result.validation.warnings.length > 0) {
		console.log('');
		console.log('  Warnings:');
		for (const w of result.validation.warnings) {
			console.log(`    - ${w}`);
		}
	}

	if (result.applyableCount > 0) {
		console.log('');
		console.log('  ⚠ APPLYABLE ACTIONS DETECTED:');
		for (const a of result.validation.applyableActions) {
			console.log(`    - ${a.action_id}`);
		}
	}

	// Write output if requested
	if (options.output) {
		const outputPath = options.output;
		const dir = dirname(outputPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(
			outputPath,
			JSON.stringify(
				{
					collectedAt: snapshot.collectedAt,
					repo: snapshot.repo,
					dryRun: snapshot.dryRun,
					snapshot: ctxSnapshot,
					result: {
						rows: result.rows,
						valid: result.validation.valid,
						errors: result.validation.errors,
						warnings: result.validation.warnings,
						counts: result.validation.counts,
						applyableCount: result.applyableCount,
					},
				},
				null,
				2,
			),
			'utf-8',
		);
		console.log(`\nOutput written to: ${outputPath}`);
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const options = parseArgs();

	if (options.help) {
		printHelp();
		process.exit(0);
	}

	try {
		const snapshot = await collectSnapshot(options);
		await printDecisionSummary(snapshot, options);
		process.exit(0);
	} catch (err) {
		console.error(`Error: ${err.message}`);
		process.exit(1);
	}
}

main();
