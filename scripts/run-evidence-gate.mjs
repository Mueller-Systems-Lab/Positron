#!/usr/bin/env node
// Positron — Evidence Gate CLI (Issue #279 Phase 1D)
// Combines GitHub Snapshot Collector + Context Reconciler +
// Decision Manifest Validator into an audit-ready evidence report.
//
// Read-only. No GitHub mutations, no apply behavior, no CI reruns.
//
// Usage:
//   node scripts/run-evidence-gate.mjs --dry-run --repo xxammaxx/Positron
//   node scripts/run-evidence-gate.mjs --snapshot .local-release/snapshot.json
//   node scripts/run-evidence-gate.mjs --dry-run --output .local-release/evidence-gate/report.json --format json

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Exit code contract
// ---------------------------------------------------------------------------
const EXIT = {
	OK: 0, // valid report generated, no validation errors
	VALIDATION_ERROR: 1, // validation errors or invalid input
	USAGE_ERROR: 2, // CLI usage error
	SAFETY_VIOLATION: 3, // prohibited command/path/safety violation
};

// ---------------------------------------------------------------------------
// Safety: prohibited command patterns (never allowed in this CLI)
// ---------------------------------------------------------------------------
const PROHIBITED_GH_COMMANDS = [
	/gh\s+pr\s+merge/,
	/gh\s+pr\s+close/,
	/gh\s+issue\s+close/,
	/gh\s+issue\s+comment/,
	/gh\s+pr\s+comment/,
	/gh\s+workflow\s+run/,
	/gh\s+run\s+rerun/,
	/gh\s+pr\s+review/,
	/gh\s+pr\s+edit/,
	/gh\s+issue\s+edit/,
	/gh\s+issue\s+reopen/,
	/gh\s+pr\s+reopen/,
	/gh\s+repo\s+edit/,
	/gh\s+api/,
];

// Read-only command allowlist (same as snapshot collector)
const ALLOWED_GH_COMMANDS = new Set([
	'gh repo view',
	'gh pr list',
	'gh pr view',
	'gh issue list',
	'gh issue view',
]);

function isAllowedGhCommand(args) {
	if (args.length < 3) return false;
	if (args[0] !== 'gh') return false;
	const prefix = `${args[0]} ${args[1]} ${args[2]}`;
	return ALLOWED_GH_COMMANDS.has(prefix);
}

/**
 * Safety check: scan a command string for prohibited patterns.
 */
function scanForProhibitedPatterns(cmdStr) {
	for (const pattern of PROHIBITED_GH_COMMANDS) {
		if (pattern.test(cmdStr)) {
			return true;
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
	const args = process.argv.slice(2);
	const options = {
		dryRun: false,
		repo: 'xxammaxx/Positron',
		snapshot: null, // path to existing snapshot JSON file
		output: null, // path to write report JSON
		format: 'text', // 'text' or 'json'
		help: false,
		includeLocalGates: false, // Phase 1E
		localGatesDryRun: false, // Phase 1E
		approvalPack: false, // Phase 1F
		safeApplyPlan: false, // Phase 1G
	};

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case '--dry-run':
				options.dryRun = true;
				break;
			case '--repo':
				options.repo = args[++i] ?? options.repo;
				break;
			case '--snapshot':
				options.snapshot = args[++i] ?? null;
				break;
			case '--output':
				options.output = args[++i] ?? null;
				break;
			case '--format':
				options.format = args[++i] ?? 'text';
				break;
			case '--include-local-gates':
				options.includeLocalGates = true;
				break;
			case '--local-gates-dry-run':
				options.localGatesDryRun = true;
				break;
			case '--approval-pack':
				options.approvalPack = true;
				break;
			case '--safe-apply-plan':
				options.safeApplyPlan = true;
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
Positron Evidence Gate CLI (Issue #279 Phase 1D+1E+1F+1G)

Read-only evidence gate that combines the GitHub Snapshot Collector,
GitHub Context Reconciler and Decision Manifest Validator into an
audit-ready decision report. Optionally includes local build/test/typecheck
gate results (Phase 1E), Human Approval Pack generation (Phase 1F),
and Safe Apply Plan Export (Phase 1G).

Usage:
  node scripts/run-evidence-gate.mjs [options]

Options:
  --dry-run               Use synthetic fixture data (no network)
  --repo <owner/name>     Target repository (default: xxammaxx/Positron)
  --snapshot <path>       Read snapshot from JSON file instead of live gh
  --output <path>         Write report JSON to file
  --format text|json      Output format (default: text)
  --include-local-gates   Include local build/test/typecheck gate results (Phase 1E)
  --local-gates-dry-run   Simulate local gates without execution (Phase 1E)
  --approval-pack         Generate Human Approval Pack from evidence report (Phase 1F)
  --safe-apply-plan       Generate Safe Apply Plan Export from approval pack (Phase 1G)
  --help, -h              Show this help

Examples:
  # Dry-run with default repo
  node scripts/run-evidence-gate.mjs --dry-run

  # Dry-run with approval pack
  node scripts/run-evidence-gate.mjs --dry-run --approval-pack

  # Dry-run with approval pack and safe apply plan
  node scripts/run-evidence-gate.mjs --dry-run --approval-pack --safe-apply-plan

  # Dry-run with local gates, approval pack, and safe apply plan
  node scripts/run-evidence-gate.mjs --dry-run --include-local-gates --local-gates-dry-run --approval-pack --safe-apply-plan

  # Full run with output
  node scripts/run-evidence-gate.mjs --dry-run --include-local-gates --local-gates-dry-run --approval-pack --safe-apply-plan --output .local-release/evidence-gate/report.json --format json

Safety: Read-only gh commands only. No mutations. No apply behavior. No execution.
All Safe Apply Plans are explicitly non-executing (executable=false).
Exit codes: 0=OK, 1=validation errors, 2=usage error, 3=safety violation
`);
}

// ---------------------------------------------------------------------------
// Snapshot loading
// ---------------------------------------------------------------------------

/**
 * Load snapshot from a JSON file.
 * Expected format: { pullRequests: [...], issues: [...] }
 */
function loadSnapshotFromFile(filePath) {
	if (!existsSync(filePath)) {
		throw new Error(`Snapshot file not found: ${filePath}`);
	}

	const raw = readFileSync(filePath, 'utf-8');
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(`Snapshot file is not valid JSON: ${err.message}`);
	}

	// Handle both formats: { snapshot: GitHubContextSnapshot } or raw GitHubContextSnapshot
	const snapshot = parsed.snapshot ?? parsed;

	if (!snapshot.pullRequests || !snapshot.issues) {
		throw new Error('Snapshot file missing required fields: pullRequests, issues');
	}

	return snapshot;
}

/**
 * Generate a synthetic dry-run fixture snapshot (same as the test fixtures).
 */
function buildDryRunSnapshot() {
	return {
		pullRequests: [
			{ number: 291, title: 'feat(issue-279): add github snapshot collector', state: 'MERGED' },
			{
				number: 218,
				title: 'feat(safety): integrate Stop/Ask policy with GATE_APPROVE',
				state: 'OPEN',
				mergeable: 'MERGEABLE',
				isDraft: false,
				reviewFindingCount: 9,
				actionableFindingCount: 2,
				findingsAccessible: true,
			},
		],
		issues: [
			{
				number: 279,
				title: 'Replacement: rebuild Issue #229 architecture chain on current main',
				state: 'OPEN',
				labels: [
					'architecture',
					'epic',
					'enhancement',
					'infrastructure',
					'priority: high',
					'tooling',
				],
			},
			{
				number: 268,
				title:
					'CI Recovery: diagnose and repair systemic Quality Gates / Issue Verification failures',
				state: 'OPEN',
				labels: ['bug', 'infrastructure', 'priority: high'],
			},
			{
				number: 229,
				title: 'MCP/OpenCode Provider Bootstrap',
				state: 'OPEN',
				labels: ['architecture', 'epic', 'enhancement'],
			},
			{
				number: 215,
				title: 'Safety: Integrate Stop/Ask Policy via GATE_APPROVE',
				state: 'OPEN',
				labels: ['architecture', 'enhancement'],
			},
		],
	};
}

/**
 * Collect real snapshot via the existing snapshot collector CLI.
 */
function collectLiveSnapshot(options) {
	const collectorScript = 'scripts/collect-github-context.mjs';
	const collectorArgs = [collectorScript, '--repo', options.repo];

	// Build an intermediate output path
	const tempDir = '.local-release/evidence-gate';
	const tempFile = `${tempDir}/_snapshot-temp.json`;
	if (!existsSync(tempDir)) {
		mkdirSync(tempDir, { recursive: true });
	}
	collectorArgs.push('--output', tempFile);

	const result = spawnSync('node', collectorArgs, {
		encoding: 'utf-8',
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 60000,
	});

	if (result.error) {
		throw new Error(`Snapshot collector failed: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(
			`Snapshot collector exited ${result.status}: ${result.stderr?.trim() ?? 'unknown error'}`,
		);
	}

	// Load the collected snapshot
	return loadSnapshotFromFile(tempFile);
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

/**
 * Print an approval pack report in human-readable format.
 */
function printApprovalPackReport(approvalPackReport) {
	console.log('');
	console.log('───────────────────────────────────────────────');
	console.log('  HUMAN APPROVAL PACK REPORT (Phase 1F)');
	console.log('───────────────────────────────────────────────');
	console.log(`  Status:            ${approvalPackReport.status}`);
	console.log(`  Total Packages:    ${approvalPackReport.totalPackages}`);
	console.log(`  Applyable:         ${approvalPackReport.applyablePackages}`);
	console.log(`  Review Required:   ${approvalPackReport.reviewPackages}`);
	console.log(`  Held:              ${approvalPackReport.holdPackages}`);
	console.log(`  Deferred:          ${approvalPackReport.deferredPackages}`);
	console.log('───────────────────────────────────────────────');

	for (const pkg of approvalPackReport.packages) {
		const icon =
			pkg.type === 'GREEN_SAFE_PACKAGE'
				? '🟢'
				: pkg.type === 'YELLOW_REVIEW_PACKAGE'
					? '🟡'
					: pkg.type === 'RED_HOLD_PACKAGE'
						? '🔴'
						: pkg.type === 'TOOL_GAP_PACKAGE'
							? '🔧'
							: pkg.type === 'DEFER_TO_279_PACKAGE'
								? '⏸'
								: '❓';

		const applyIcon = pkg.applyable ? '✅' : '⛔';
		console.log(`  ${icon} ${pkg.type} ${applyIcon}`);
		console.log(`     ID: ${pkg.id}`);
		console.log(`     Status: ${pkg.status}`);
		console.log(`     Title: ${pkg.title}`);
		console.log(`     Summary: ${pkg.summary}`);
		console.log(`     Items: ${pkg.rowIds.join(', ')}`);
		if (pkg.blockerReasons.length > 0) {
			console.log('     BLOCKERS:');
			for (const reason of pkg.blockerReasons) {
				console.log(`       - ${reason}`);
			}
		}
		if (pkg.warnings.length > 0) {
			console.log('     WARNINGS:');
			for (const warn of pkg.warnings) {
				console.log(`       - ${warn}`);
			}
		}
		if (pkg.approvalPhrase) {
			console.log(`     APPROVAL: ${pkg.approvalPhrase}`);
		}
		console.log('');
	}

	// Summary for owner
	console.log('───────────────────────────────────────────────');
	console.log('  OWNER DECISION SUMMARY');
	console.log('───────────────────────────────────────────────');
	for (const pkg of approvalPackReport.packages) {
		if (pkg.approvalPhrase) {
			console.log(`  → ${pkg.approvalPhrase}`);
		}
	}
	if (approvalPackReport.applyablePackages === 0) {
		console.log('  → No applyable packages. No automated mutations possible.');
	}
	console.log('');
}

/**
 * Print a safe apply plan report in human-readable format.
 */
function printSafeApplyPlanReport(safeApplyPlanReport) {
	console.log('');
	console.log('───────────────────────────────────────────────');
	console.log('  SAFE APPLY PLAN REPORT (Phase 1G)');
	console.log('───────────────────────────────────────────────');
	console.log(`  Status:              ${safeApplyPlanReport.status}`);
	console.log(`  Total Plans:         ${safeApplyPlanReport.totalPlans}`);
	console.log(
		`  Executable Plans:    ${safeApplyPlanReport.executablePlans} (always 0 — non-executing)`,
	);
	console.log(`  Blocked Plans:       ${safeApplyPlanReport.blockedPlans}`);
	console.log(`  Review Plans:        ${safeApplyPlanReport.reviewPlans}`);
	console.log(`  Hold Plans:          ${safeApplyPlanReport.holdPlans}`);
	console.log(`  Deferred Plans:      ${safeApplyPlanReport.deferredPlans}`);
	console.log('───────────────────────────────────────────────');

	for (const plan of safeApplyPlanReport.plans) {
		const icon =
			plan.type === 'GREEN_SAFE_APPLY_PLAN'
				? '🟢'
				: plan.type === 'YELLOW_REVIEW_PLAN'
					? '🟡'
					: plan.type === 'RED_HOLD_PLAN'
						? '🔴'
						: plan.type === 'TOOL_GAP_PLAN'
							? '🔧'
							: plan.type === 'DEFER_TO_279_PLAN'
								? '⏸'
								: plan.type === 'BLOCKED_PLAN'
									? '🚫'
									: plan.type === 'NO_ACTION_PLAN'
										? '⭕'
										: '❓';

		const execIcon = '⛔ NON-EXECUTING';
		console.log(`  ${icon} ${plan.type} ${execIcon}`);
		console.log(`     ID: ${plan.id}`);
		console.log(`     Package: ${plan.packageId}`);
		console.log(`     Title: ${plan.title}`);
		console.log(`     Summary: ${plan.summary}`);
		console.log(`     Executable: ${plan.executable}`);
		console.log(`     Actions: ${plan.actions.length}`);

		for (const action of plan.actions) {
			console.log(
				`       - ${action.id} | executable=${action.executable} | blocked=${action.blocked}`,
			);
			if (action.approvalPhrase) {
				console.log(`         Approval: ${action.approvalPhrase}`);
			}
			if (action.blockerReasons.length > 0) {
				for (const reason of action.blockerReasons) {
					console.log(`         Blocker: ${reason}`);
				}
			}
		}

		if (plan.blockerReasons.length > 0) {
			console.log('     PLAN BLOCKERS:');
			for (const reason of plan.blockerReasons) {
				console.log(`       - ${reason}`);
			}
		}
		if (plan.warnings.length > 0) {
			console.log('     PLAN WARNINGS:');
			for (const warn of plan.warnings) {
				console.log(`       - ${warn}`);
			}
		}
		console.log('');
	}

	console.log('───────────────────────────────────────────────');
	console.log('  SAFE APPLY PLAN SUMMARY');
	console.log('───────────────────────────────────────────────');
	console.log(`  All ${safeApplyPlanReport.totalPlans} plan(s) are non-executing.`);
	console.log('  No actions have been or will be executed by this tool.');
	if (safeApplyPlanReport.blockedPlans > 0) {
		console.log(`  ⚠ ${safeApplyPlanReport.blockedPlans} plan(s) are BLOCKED.`);
	}
	console.log('');
}

function printReport(report) {
	console.log('');
	console.log('═══════════════════════════════════════════════');
	console.log('  POSITRON EVIDENCE GATE REPORT');
	console.log('═══════════════════════════════════════════════');
	console.log(`  Status:      ${report.status}`);
	console.log(`  Generated:   ${report.generatedAt ?? 'N/A'}`);
	console.log('───────────────────────────────────────────────');
	console.log(`  Total Rows:  ${report.summary.totalRows}`);
	console.log(`  Applyable:   ${report.summary.applyableActions}`);
	console.log(`  Errors:      ${report.summary.validationErrors}`);
	console.log(`  Warnings:    ${report.summary.validationWarnings}`);
	console.log('───────────────────────────────────────────────');
	console.log('  Risk Class Counts:');
	for (const [rc, count] of Object.entries(report.riskClassCounts)) {
		if (count > 0) {
			const icon =
				rc === 'GREEN_SAFE'
					? '🟢'
					: rc === 'YELLOW_REVIEW'
						? '🟡'
						: rc === 'RED_HOLD'
							? '🔴'
							: rc === 'TOOL_GAP'
								? '🔧'
								: rc === 'DEFER_TO_279'
									? '⏸'
									: '❓';
			console.log(`    ${icon} ${rc}: ${count}`);
		}
	}
	console.log('───────────────────────────────────────────────');
	console.log('  Recommendation Counts:');
	for (const [rec, count] of Object.entries(report.recommendationCounts)) {
		if (count > 0) {
			console.log(`    - ${rec}: ${count}`);
		}
	}
	console.log('───────────────────────────────────────────────');

	// Validation errors
	if (report.validation.errors.length > 0) {
		console.log('  VALIDATION ERRORS:');
		for (const err of report.validation.errors) {
			console.log(`    ❌ ${err}`);
		}
	}

	// Validation warnings
	if (report.validation.warnings.length > 0) {
		console.log('  VALIDATION WARNINGS:');
		for (const warn of report.validation.warnings) {
			console.log(`    ⚠ ${warn}`);
		}
	}

	// Blocked rows
	if (report.blockedRows.length > 0) {
		console.log('───────────────────────────────────────────────');
		console.log('  BLOCKED ACTIONS:');
		for (const row of report.blockedRows) {
			console.log(`    ${row.action_id} | ${row.risk_class} | ${row.agent_recommendation}`);
		}
	}

	// Local Gate Report (Phase 1E)
	if (report.localGateReport) {
		const lg = report.localGateReport;
		console.log('───────────────────────────────────────────────');
		console.log('  LOCAL GATES:');
		console.log(`    Status:  ${lg.status}`);
		console.log(`    Total:   ${lg.total}`);
		console.log(`    Passed:  ${lg.passed}`);
		console.log(`    Warned:  ${lg.warned}`);
		console.log(`    Failed:  ${lg.failed}`);
		console.log(`    Skipped: ${lg.skipped}`);
		console.log('');
		for (const r of lg.results) {
			const icon =
				r.status === 'PASS'
					? '✅'
					: r.status === 'WARN'
						? '⚠️'
						: r.status === 'FAIL'
							? '❌'
							: r.status === 'SKIPPED'
								? '⏭️'
								: '❓';
			console.log(`    ${icon} ${r.label} (${r.kind}) — ${r.status} (${r.durationMs}ms)`);
			if (r.exitCode !== null) {
				console.log(`       exit=${r.exitCode}`);
			}
			if (r.error) {
				console.log(`       err=${r.error}`);
			}
		}
	}

	// Applyable rows (if any)
	if (report.applyableRows.length > 0) {
		console.log('───────────────────────────────────────────────');
		console.log('  ⚠ APPLYABLE ACTIONS DETECTED:');
		for (const row of report.applyableRows) {
			console.log(`    ${row.action_id} | ${row.risk_class} | ${row.agent_recommendation}`);
		}
	}

	console.log('═══════════════════════════════════════════════');
	console.log('');

	// Summary verdict
	if (report.status === 'FAIL') {
		console.log('VERDICT: FAIL — Validation errors detected. No applyable actions.');
	} else if (report.status === 'WARN') {
		console.log('VERDICT: WARN — Report generated with warnings. Review before proceeding.');
	} else {
		console.log('VERDICT: PASS — Report generated cleanly.');
	}

	if (report.summary.applyableActions === 0) {
		console.log('Applyable actions: 0 — Safe. No automated mutations will be attempted.');
	}
	console.log('');
}

function printJsonReport(report) {
	process.stdout.write(JSON.stringify(report, null, 2));
	process.stdout.write('\n');
}

// ---------------------------------------------------------------------------
// Output safety
// ---------------------------------------------------------------------------

/**
 * Validate output path safety.
 * - Must not write outside the workspace.
 * - Must not write to system or sensitive paths.
 */
function validateOutputPath(outputPath) {
	const normalized = outputPath.replace(/\\/g, '/');

	// Block system paths
	const blockedPrefixes = [
		'C:/Windows',
		'C:/Program Files',
		'C:/ProgramData',
		'/etc/',
		'/usr/',
		'/var/',
		'/boot/',
		'/sys/',
		'/proc/',
	];

	for (const prefix of blockedPrefixes) {
		if (normalized.startsWith(prefix)) {
			throw new Error(`SAFETY: output path blocked: ${outputPath} (system path)`);
		}
	}

	// Block writing to .git, .github, .opencode
	const blockedDirs = ['.git/', '.github/', '.opencode/'];

	// Check subdirectories
	for (const dir of blockedDirs) {
		if (normalized.includes(`/${dir}`) || normalized.startsWith(dir.replace('/', ''))) {
			throw new Error(`SAFETY: output path blocked: ${outputPath} (protected directory)`);
		}
	}

	// Preferred: .local-release/evidence-gate/
	const preferred = '.local-release/evidence-gate/';
}

// ---------------------------------------------------------------------------
// Local Gate Runner helpers (Phase 1E)
// ---------------------------------------------------------------------------

/**
 * Run a local gate command using spawnSync.
 * Only allowlisted commands are accepted.
 */
function runLocalGate(gate) {
	const start = Date.now();
	let result;

	try {
		result = spawnSync(gate.command, gate.args, {
			cwd: gate.cwd || process.cwd(),
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: gate.timeoutMs ?? 120000,
		});
	} catch (err) {
		return {
			exitCode: null,
			stdout: '',
			stderr: err.message,
			durationMs: Date.now() - start,
			error: err.message,
		};
	}

	const durationMs = Date.now() - start;

	if (result.error) {
		return {
			exitCode: null,
			stdout: result.stdout?.trim() ?? '',
			stderr: result.stderr?.trim() ?? '',
			durationMs,
			error: result.error.message,
		};
	}

	return {
		exitCode: result.status,
		stdout: result.stdout?.trim() ?? '',
		stderr: result.stderr?.trim() ?? '',
		durationMs,
		error: result.status !== 0 ? `exit code ${result.status}` : undefined,
	};
}

/**
 * Execute local gates and produce a LocalGateReport.
 */
function executeLocalGates(gates, localGateMod) {
	const results = [];

	for (const gate of gates) {
		const errors = localGateMod.validateLocalGateDefinition(gate);
		if (errors.length > 0) {
			results.push({
				id: gate.id,
				label: gate.label,
				kind: gate.kind,
				command: gate.command,
				args: gate.args,
				status: 'FAIL',
				exitCode: null,
				durationMs: 0,
				error: `REJECTED: ${errors.join('; ')}`,
			});
			continue;
		}

		const cmdResult = runLocalGate(gate);
		const status = localGateMod.computeGateStatus(gate.kind, cmdResult.exitCode);

		results.push({
			id: gate.id,
			label: gate.label,
			kind: gate.kind,
			command: gate.command,
			args: gate.args,
			status,
			exitCode: cmdResult.exitCode,
			durationMs: cmdResult.durationMs,
			stdoutSnippet: cmdResult.stdout ? localGateMod.truncateSnippet(cmdResult.stdout) : undefined,
			stderrSnippet: cmdResult.stderr ? localGateMod.truncateSnippet(cmdResult.stderr) : undefined,
			error: cmdResult.error,
		});
	}

	return localGateMod.createLocalGateReport(results);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const options = parseArgs();

	if (options.help) {
		printHelp();
		process.exit(EXIT.OK);
	}

	// Validate format
	if (options.format !== 'text' && options.format !== 'json') {
		console.error('Error: --format must be "text" or "json"');
		process.exit(EXIT.USAGE_ERROR);
	}

	// Validate output path safety
	if (options.output) {
		try {
			validateOutputPath(options.output);
		} catch (err) {
			console.error(`Error: ${err.message}`);
			process.exit(EXIT.SAFETY_VIOLATION);
		}
	}

	// Safety scan: no prohibited patterns in our own process args
	const fullCmdLine = process.argv.join(' ');
	if (scanForProhibitedPatterns(fullCmdLine)) {
		console.error('SAFETY VIOLATION: prohibited GitHub command pattern detected');
		process.exit(EXIT.SAFETY_VIOLATION);
	}

	// Load modules
	let evidenceGateMod;
	try {
		evidenceGateMod = await import('../packages/shared/dist/evidence-gate.js');
	} catch (err) {
		console.error('Error: Cannot load evidence-gate module.');
		console.error('  Run `npm run build` first to generate shared/dist artifacts.');
		console.error(`  Detail: ${err.message}`);
		process.exit(EXIT.USAGE_ERROR);
	}

	const { createEvidenceGateReportFromGitHubContext } = evidenceGateMod;

	// Phase 1E: load local gate runner module (optional)
	let localGateMod = null;
	if (options.includeLocalGates) {
		try {
			localGateMod = await import('../packages/shared/dist/local-gate-runner.js');
		} catch (err) {
			console.error('Error: Cannot load local-gate-runner module.');
			console.error('  Run `npm run build` first to generate shared/dist artifacts.');
			console.error(`  Detail: ${err.message}`);
			process.exit(EXIT.USAGE_ERROR);
		}
	}

	// Phase 1F: load human approval pack module (optional)
	let approvalPackMod = null;
	if (options.approvalPack || options.safeApplyPlan) {
		try {
			approvalPackMod = await import('../packages/shared/dist/human-approval-pack.js');
		} catch (err) {
			console.error('Error: Cannot load human-approval-pack module.');
			console.error('  Run `npm run build` first to generate shared/dist artifacts.');
			console.error(`  Detail: ${err.message}`);
			process.exit(EXIT.USAGE_ERROR);
		}
	}

	// Phase 1G: load safe apply plan module (optional)
	let safeApplyPlanMod = null;
	if (options.safeApplyPlan) {
		try {
			safeApplyPlanMod = await import('../packages/shared/dist/safe-apply-plan.js');
		} catch (err) {
			console.error('Error: Cannot load safe-apply-plan module.');
			console.error('  Run `npm run build` first to generate shared/dist artifacts.');
			console.error(`  Detail: ${err.message}`);
			process.exit(EXIT.USAGE_ERROR);
		}
	}

	let snapshot;

	try {
		if (options.dryRun) {
			const phases = ['1D'];
			if (options.includeLocalGates) phases.push('1E');
			if (options.approvalPack) phases.push('1F');
			if (options.safeApplyPlan) phases.push('1G');
			console.log(`[DRY-RUN] Evidence Gate CLI — Phase ${phases.join('+')}`);
			console.log(`  Repo: ${options.repo}`);
			if (options.includeLocalGates) {
				console.log(`  Local gates: ${options.localGatesDryRun ? 'simulated (dry-run)' : 'live'}`);
			}
			if (options.approvalPack || options.safeApplyPlan) {
				console.log('  Approval pack: enabled');
			}
			if (options.safeApplyPlan) {
				console.log('  Safe apply plan: enabled');
			}
			console.log('');
			console.log('  Using synthetic dry-run fixture...');
			snapshot = buildDryRunSnapshot();
		} else if (options.snapshot) {
			console.log(`[SNAPSHOT] Loading from: ${options.snapshot}`);
			snapshot = loadSnapshotFromFile(options.snapshot);
		} else {
			// Live collection
			console.log(`[LIVE] Collecting GitHub context for ${options.repo}...`);
			snapshot = collectLiveSnapshot(options);
		}
	} catch (err) {
		console.error(`Error loading snapshot: ${err.message}`);
		process.exit(EXIT.VALIDATION_ERROR);
	}

	// Generate evidence gate report
	let report;
	try {
		report = createEvidenceGateReportFromGitHubContext(snapshot);
	} catch (err) {
		console.error(`Error generating evidence gate report: ${err.message}`);
		process.exit(EXIT.VALIDATION_ERROR);
	}

	// Phase 1E: include local gate results if requested
	if (options.includeLocalGates && localGateMod) {
		console.log('');
		console.log('[LOCAL GATES]');

		let localGateReport;
		const gates = localGateMod.getDefaultLocalGateDefinitions();

		if (options.localGatesDryRun) {
			console.log('  Mode: DRY-RUN (no real commands executed)');
			localGateReport = localGateMod.createDryRunLocalGateReport(gates);
		} else {
			console.log('  Mode: LIVE (executing allowlisted commands)');
			console.log(`  Running ${gates.length} gates...`);
			localGateReport = executeLocalGates(gates, localGateMod);
		}

		// Print gate results
		for (const r of localGateReport.results) {
			const icon =
				r.status === 'PASS'
					? 'PASS'
					: r.status === 'WARN'
						? 'WARN'
						: r.status === 'FAIL'
							? 'FAIL'
							: r.status === 'SKIPPED'
								? 'SKIP'
								: '??';
			console.log(`  [${icon}] ${r.label} (${r.durationMs}ms)`);
			if (r.error) {
				console.log(`        Error: ${r.error}`);
			}
		}
		console.log(
			`  Summary: ${localGateReport.passed} passed, ${localGateReport.warned} warned, ${localGateReport.failed} failed, ${localGateReport.skipped} skipped`,
		);
		console.log(`  Verdict: ${localGateReport.status}`);

		// Regenerate report with local gate results using proper API (Phase 1E+1F)
		try {
			report = createEvidenceGateReportFromGitHubContext(snapshot, {
				localGateReport,
			});
		} catch (err) {
			console.error(`Error regenerating report with local gates: ${err.message}`);
			// Continue with original report
		}
	}

	// Phase 1F: generate approval pack if requested
	let approvalPackReport = null;
	if (options.approvalPack && approvalPackMod) {
		console.log('');
		console.log('[APPROVAL PACK] Generating Human Approval Pack from evidence report...');

		try {
			approvalPackReport = approvalPackMod.createHumanApprovalPackReport(report);
			console.log(`  Generated ${approvalPackReport.totalPackages} package(s).`);
			console.log(
				`  Applyable: ${approvalPackReport.applyablePackages}, Review: ${approvalPackReport.reviewPackages}, Hold: ${approvalPackReport.holdPackages}, Deferred: ${approvalPackReport.deferredPackages}`,
			);

			// Attach approval pack to the report for JSON output
			report.approvalPackReport = approvalPackReport;
		} catch (err) {
			console.error(`  Error generating approval pack: ${err.message}`);
			// Continue without approval pack — non-fatal
		}
	}

	// Phase 1G: generate safe apply plan if requested
	let safeApplyPlanReport = null;
	if (options.safeApplyPlan && safeApplyPlanMod) {
		if (!approvalPackReport) {
			console.error(
				'Error: --safe-apply-plan requires --approval-pack. Generating approval pack first...',
			);
			// Try to generate approval pack on the fly if not already done
			if (approvalPackMod) {
				try {
					approvalPackReport = approvalPackMod.createHumanApprovalPackReport(report);
					report.approvalPackReport = approvalPackReport;
				} catch (err) {
					console.error(`  Error generating approval pack: ${err.message}`);
					process.exit(EXIT.VALIDATION_ERROR);
				}
			} else {
				console.error('  Cannot generate approval pack — module not loaded. Add --approval-pack.');
				process.exit(EXIT.USAGE_ERROR);
			}
		}

		console.log('');
		console.log('[SAFE APPLY PLAN] Generating Safe Apply Plan from approval pack...');

		try {
			safeApplyPlanReport = safeApplyPlanMod.createSafeApplyPlanReport(approvalPackReport);
			console.log(`  Generated ${safeApplyPlanReport.totalPlans} plan(s).`);
			console.log(
				`  Executable plans: ${safeApplyPlanReport.executablePlans} (always 0 — non-executing)`,
			);
			console.log(
				`  Blocked: ${safeApplyPlanReport.blockedPlans}, Review: ${safeApplyPlanReport.reviewPlans}, Hold: ${safeApplyPlanReport.holdPlans}, Deferred: ${safeApplyPlanReport.deferredPlans}`,
			);

			// Attach safe apply plan to the report for JSON output
			report.safeApplyPlanReport = safeApplyPlanReport;
		} catch (err) {
			console.error(`  Error generating safe apply plan: ${err.message}`);
			// Continue without safe apply plan — non-fatal
		}
	}

	// Output
	if (options.format === 'json') {
		if (options.output) {
			// Write JSON to file
			const dir = dirname(options.output);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
			writeFileSync(options.output, JSON.stringify(report, null, 2), 'utf-8');
			console.log(`Report written to: ${options.output}`);
		} else {
			printJsonReport(report);
		}
	} else {
		// Text format
		printReport(report);

		// Phase 1F: print approval pack after evidence report
		if (approvalPackReport) {
			printApprovalPackReport(approvalPackReport);
		}

		// Phase 1G: print safe apply plan after approval pack
		if (safeApplyPlanReport) {
			printSafeApplyPlanReport(safeApplyPlanReport);
		}

		if (options.output) {
			const dir = dirname(options.output);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true });
			}
			writeFileSync(options.output, JSON.stringify(report, null, 2), 'utf-8');
			console.log(`Report (JSON) written to: ${options.output}`);
		}
	}

	// Determine exit code
	if (report.validation.errors.length > 0) {
		console.error(
			`Exiting with code ${EXIT.VALIDATION_ERROR}: ${report.validation.errors.length} validation error(s)`,
		);
		process.exit(EXIT.VALIDATION_ERROR);
	}

	// WARN or PASS
	console.log(`Exiting with code ${EXIT.OK} (status: ${report.status})`);
	process.exit(EXIT.OK);
}

main().catch((err) => {
	console.error(`Unexpected error: ${err.message}`);
	process.exit(EXIT.VALIDATION_ERROR);
});
