// Positron — Rudolph Beacon Benchmark Runner
//
// Integrates existing DeterministicFixtureAgent and OpenCodeDryRunAgent
// into a unified benchmark execution flow. Runs fixture scenarios, evaluates
// dry-run safety, and produces structured evidence.
//
// Issues: BENCH-003, BENCH-004, BENCH-005

import type {
	ActionPlan,
	DryRunAgentConfig,
	Fixture,
	FixtureAgentConfig,
	EvidenceReport as FixtureEvidenceReport,
} from '@positron/opencode-adapter';
import { DeterministicFixtureAgent, OpenCodeDryRunAgent } from '@positron/opencode-adapter';
import type { ExecutionMode, OpenCodeRunInput } from '@positron/shared';

import type {
	BenchmarkCommandResult,
	BenchmarkConclusion,
	BenchmarkIssueResult,
	CapabilityDelta,
	RudolphBenchmarkRunSummary,
} from './evidence-contract.js';
import {
	createCommandResult,
	createIssueResult,
	determineConclusionStatus,
	validateRunSummary,
} from './evidence-contract.js';
import {
	buildTraceabilityMap,
	type IssueTraceEntry,
	type TraceabilityMap,
	validateTraceabilityMap,
} from './traceability.js';

// Re-export for convenience
export type {
	BenchmarkCommandResult,
	BenchmarkConclusion,
	BenchmarkIssueResult,
	BlockedAction,
	CapabilityDelta,
	RudolphBenchmarkRunSummary,
} from './evidence-contract.js';

// =============================================================================
// Benchmark Run Configuration
// =============================================================================

export interface RudolphBenchmarkConfig {
	/** Run mode for this benchmark execution */
	executionMode: ExecutionMode;
	/** Run ID (deterministic or UUID) */
	runId: string;
	/** Timestamp factory for deterministic evidence */
	getTimestamp?: () => string;
	/** Fixture scenarios to test (fixture mode) */
	fixtureScenarios?: Map<string, Fixture>;
	/** Dry-run actions to analyze (dry-run mode) */
	plannedActions?: ActionPlan[];
	/** Repository state for evidence */
	repo: {
		branch: string;
		commitSha: string;
		status: 'clean' | 'dirty' | 'unknown';
	};
	/** Issue definitions for the benchmark */
	benchmarkIssues: Array<{ id: string; title: string }>;
	/** Evidence output directory */
	evidenceDir?: string;
}

// =============================================================================
// BenchmarkRunner
// =============================================================================

/**
 * BenchmarkRunner — executes the Rudolph Beacon benchmark using existing agents.
 *
 * In fixture mode: Uses DeterministicFixtureAgent to replay scenarios.
 * In dry-run mode: Uses OpenCodeDryRunAgent to analyze planned actions.
 * Real mode is NOT implemented here — requires explicit human approval.
 */
export class BenchmarkRunner {
	private readonly config: RudolphBenchmarkConfig;
	private readonly getTimestamp: () => string;

	constructor(config: RudolphBenchmarkConfig) {
		this.config = config;
		this.getTimestamp = config.getTimestamp ?? (() => new Date().toISOString());
	}

	/**
	 * Execute the benchmark and produce a full summary.
	 */
	async execute(): Promise<RudolphBenchmarkRunSummary> {
		const startTime = Date.now();
		const commands: BenchmarkCommandResult[] = [];
		const issues: BenchmarkIssueResult[] = [];
		const blockedActions: NonNullable<RudolphBenchmarkRunSummary['safety']>['blockedActions'] = [];
		const warnings: string[] = [];

		// Gate: real mode is not supported without human approval
		if (this.config.executionMode === 'real') {
			warnings.push(
				'REAL execution mode requested — requires HUMAN APPROVAL. Benchmark running as dry-run instead.',
			);
		}

		// Execute in appropriate mode
		if (this.config.executionMode === 'fixture') {
			const fixtureResult = await this.runFixtureMode(commands, issues, warnings);
			if (fixtureResult) {
				blockedActions.push(...fixtureResult.blockedActions);
			}
		} else {
			// dry-run (or real downgraded to dry-run)
			const dryRunResult = await this.runDryRunMode(commands, issues, warnings);
			if (dryRunResult) {
				blockedActions.push(...dryRunResult.blockedActions);
			}
		}

		// Build traceability map
		const traceability = buildTraceabilityMap(this.config.benchmarkIssues, issues);

		// Validate traceability
		const traceErrors = validateTraceabilityMap(traceability);
		if (traceErrors.length > 0) {
			warnings.push(...traceErrors.map((e) => `TRACEABILITY: ${e}`));
		}

		// Determine overall conclusion (traceability-aware)
		const conclusion = this.buildConclusion(issues, blockedActions, warnings, traceErrors);

		// Build capability delta
		const capabilityDelta = this.buildCapabilityDelta(issues);

		const durationMs = Date.now() - startTime;

		const summary: RudolphBenchmarkRunSummary = {
			runId: this.config.runId,
			timestampUtc: this.getTimestamp(),
			executionMode: this.config.executionMode,
			benchmarkName: 'rudolph-beacon',
			repo: this.config.repo,
			issues,
			commands,
			tests: {
				passed: issues.filter((i) => i.status === 'DONE').length,
				failed: issues.filter((i) => i.status === 'BLOCKED').length,
				skipped: issues.filter((i) => i.status === 'UNKNOWN_EVIDENCE').length,
				redTestsCovered: [],
			},
			safety: {
				secretsRedacted: true,
				blockedActions,
				warnings,
			},
			conclusion,
			capabilityDelta,
		};

		// ── Runtime Schema Validation ────────────────────────────────────
		// Every run summary MUST pass schema validation before being returned.
		// Invalid summaries are never returned as GREEN.
		const validationErrors = validateRunSummary(summary);
		if (validationErrors.length > 0) {
			for (const err of validationErrors) {
				summary.safety.warnings.push(`SCHEMA: ${err}`);
			}

			// Any schema validation error prevents a GREEN conclusion.
			// GREEN requires a fully valid schema — structural, evidence, and security integrity.
			// The schema validator (validateRunSummary) is the authoritative gate.
			if (summary.conclusion.status === 'GREEN') {
				summary.conclusion.status = 'YELLOW';
				summary.conclusion.whatDoesNotWork.push(
					`Schema validation found ${validationErrors.length} error(s) — conclusion downgraded from GREEN to YELLOW`,
				);
				summary.conclusion.confidence = Math.min(summary.conclusion.confidence, 0.5);
			}
		}

		return summary;
	}

	// ── Fixture Mode ───────────────────────────────────────────────────────

	private async runFixtureMode(
		commands: BenchmarkCommandResult[],
		issues: BenchmarkIssueResult[],
		warnings: string[],
	): Promise<FixtureEvidenceReport | null> {
		if (!this.config.fixtureScenarios || this.config.fixtureScenarios.size === 0) {
			// No fixture scenarios defined — still evaluate issues based on deterministic logic
			for (const issueDef of this.config.benchmarkIssues) {
				issues.push(createIssueResult(issueDef.id, issueDef.title));
			}
			return null;
		}

		const fixtureConfig: FixtureAgentConfig = {
			fixtures: this.config.fixtureScenarios,
			evidenceDir: this.config.evidenceDir ?? '.positron/evidence/',
			getTimestamp: this.getTimestamp,
		};

		const fixtureAgent = new DeterministicFixtureAgent(fixtureConfig);

		// Process each benchmark issue through fixture execution
		for (const issueDef of this.config.benchmarkIssues) {
			const input: OpenCodeRunInput = {
				runId: `${this.config.runId}-fixture-${issueDef.id}`,
				workspacePath: process.cwd(),
				issueTitle: issueDef.title,
			};

			const scenarioName = `benchmark/${issueDef.id}`;
			if (!this.config.fixtureScenarios.has(scenarioName)) {
				// No fixture for this issue → UNKNOWN_EVIDENCE
				const issueResult = createIssueResult(issueDef.id, issueDef.title);
				issues.push(issueResult);
				warnings.push(`No fixture defined for ${issueDef.id} — evidence is UNKNOWN`);
				continue;
			}

			const evidence = await fixtureAgent.execute(scenarioName, input);

			const issueResult: BenchmarkIssueResult = {
				id: issueDef.id,
				title: issueDef.title,
				status: evidence.status === 'success' ? 'DONE' : 'PARTIAL',
				evidencePaths: [`.positron/evidence/${evidence.runId}.json`],
				testNames: [],
				changedFiles: [],
				confidence: evidence.status === 'success' ? 0.85 : 0.3,
			};

			issues.push(issueResult);

			commands.push(
				createCommandResult(
					`fixture-scenario-${issueDef.id}`,
					`DeterministicFixtureAgent.execute("${scenarioName}")`,
					0,
					evidence.durationMs,
				),
			);
		}

		// Return the first evidence report (representative)
		return null;
	}

	// ── Dry-Run Mode ───────────────────────────────────────────────────────

	private async runDryRunMode(
		commands: BenchmarkCommandResult[],
		issues: BenchmarkIssueResult[],
		warnings: string[],
	): Promise<{ blockedActions: Array<{ operation: string; reason: string }> }> {
		const blockedActions: Array<{ operation: string; reason: string }> = [];

		// Set environment for dry-run (only during this method)
		const prevDryRun = process.env['POSITRON_ENABLE_DRY_RUN'];
		process.env['POSITRON_ENABLE_DRY_RUN'] = 'true';

		try {
			const dryRunConfig: DryRunAgentConfig = {
				evidenceDir: this.config.evidenceDir ?? '.positron/evidence/',
				getTimestamp: this.getTimestamp,
			};

			const dryRunAgent = new OpenCodeDryRunAgent(dryRunConfig);

			const input: OpenCodeRunInput = {
				runId: `${this.config.runId}-dryrun`,
				workspacePath: process.cwd(),
				issueTitle: 'Rudolph Benchmark Dry-Run Safety Check',
			};

			// Analyze planned actions through the dry-run agent
			const actions = this.config.plannedActions ?? getDefaultPlannedActions();
			const evidence = await dryRunAgent.analyzeActions(actions, input);

			// Record blocked actions
			for (const blocked of evidence.blockedActions) {
				blockedActions.push({ operation: blocked.operation, reason: blocked.reason });
			}

			// Evaluate BENCH-005 (Dry-Run Safety) based on blocked actions
			for (const issueDef of this.config.benchmarkIssues) {
				if (issueDef.id === 'BENCH-005') {
					const riskyOps = ['git push', 'gh pr create', 'git merge', 'git worktree add'];
					const blockedRisks = blockedActions.filter((ba) =>
						riskyOps.some((rop) => ba.operation.toLowerCase().includes(rop.toLowerCase())),
					);

					const issueResult: BenchmarkIssueResult = {
						id: issueDef.id,
						title: issueDef.title,
						status: blockedRisks.length >= riskyOps.length ? 'DONE' : 'PARTIAL',
						evidencePaths: [`.positron/evidence/${evidence.runId}.json`],
						testNames: [],
						changedFiles: [],
						confidence: blockedRisks.length >= riskyOps.length ? 0.9 : 0.4,
					};

					issues.push(issueResult);
				} else {
					// Other issues get UNKNOWN_EVIDENCE in dry-run mode
					const issueResult = createIssueResult(issueDef.id, issueDef.title);
					issues.push(issueResult);
				}
			}

			commands.push(
				createCommandResult(
					'dry-run-analysis',
					`OpenCodeDryRunAgent.analyzeActions(${actions.length} actions)`,
					0,
					evidence.durationMs,
				),
			);
		} finally {
			// Restore previous dry-run setting
			if (prevDryRun === undefined) {
				Reflect.deleteProperty(process.env, 'POSITRON_ENABLE_DRY_RUN');
			} else {
				process.env['POSITRON_ENABLE_DRY_RUN'] = prevDryRun;
			}
		}

		return { blockedActions };
	}

	// ── Conclusion Builder ─────────────────────────────────────────────────

	private buildConclusion(
		issues: BenchmarkIssueResult[],
		blockedActions: Array<{ operation: string; reason: string }>,
		warnings: string[],
		traceabilityErrors: string[] = [],
	): BenchmarkConclusion {
		let status = determineConclusionStatus(issues);

		// If traceability has errors and status is GREEN, downgrade to YELLOW
		if (traceabilityErrors.length > 0 && status === 'GREEN') {
			status = 'YELLOW';
		}

		const whatWorks: string[] = [];
		const whatDoesNotWork: string[] = [];
		const whatIsUnproven: string[] = [];

		for (const issue of issues) {
			if (issue.status === 'DONE' && issue.confidence >= 0.7) {
				whatWorks.push(`${issue.id}: ${issue.title}`);
			} else if (issue.status === 'BLOCKED') {
				whatDoesNotWork.push(`${issue.id}: ${issue.title} (BLOCKED)`);
			} else if (issue.status === 'PARTIAL') {
				whatDoesNotWork.push(
					`${issue.id}: ${issue.title} (PARTIAL, confidence=${issue.confidence})`,
				);
			} else {
				whatIsUnproven.push(`${issue.id}: ${issue.title} (UNKNOWN_EVIDENCE)`);
			}
		}

		// Calculate overall confidence
		const totalConfidence =
			issues.length > 0 ? issues.reduce((sum, i) => sum + i.confidence, 0) / issues.length : 0;

		return {
			status,
			whatWorks,
			whatDoesNotWork,
			whatIsUnproven,
			confidence: Math.round(totalConfidence * 100) / 100,
		};
	}

	private buildCapabilityDelta(issues: BenchmarkIssueResult[]): CapabilityDelta {
		const newCapabilities: string[] = [];
		const removedBlockers: string[] = [];
		const unchangedLimitations: string[] = [];
		const remainingRisks: string[] = [];

		for (const issue of issues) {
			if (issue.status === 'DONE') {
				newCapabilities.push(`${issue.id}: Verified (confidence=${issue.confidence})`);
			} else if (issue.status === 'BLOCKED') {
				remainingRisks.push(`${issue.id}: Blocked — needs investigation`);
			} else {
				unchangedLimitations.push(`${issue.id}: Not yet verified`);
			}
		}

		return {
			newCapabilities,
			removedBlockers,
			unchangedLimitations,
			remainingRisks,
			nextBestStep:
				remainingRisks.length > 0
					? `Address blocked/unknown issues first: ${remainingRisks.map((r) => r.split(':')[0]).join(', ')}`
					: 'All benchmark issues verified — extend to real mode or next benchmark',
		};
	}
}

// =============================================================================
// Default Planned Actions (Dry-Run Safety Check)
// =============================================================================

function getDefaultPlannedActions(): ActionPlan[] {
	return [
		{ operation: 'git status', target: '.' },
		{ operation: 'npm test', target: '.' },
		{ operation: 'write file', target: '.positron/test-artifacts/output.txt' },
		{ operation: 'write file', target: 'src/config.ts' },
		{ operation: 'git push', target: 'origin main' },
		{ operation: 'gh pr create', target: 'main' },
		{ operation: 'git merge', target: 'feature-branch' },
		{ operation: 'git worktree add', target: '/tmp/worktree' },
		{ operation: 'npm install', target: 'malicious-package' },
		{ operation: 'git commit', target: '-m "test"' },
		{ operation: 'gh issue view', target: '#1' },
		{ operation: 'git log', target: '.' },
	];
}
