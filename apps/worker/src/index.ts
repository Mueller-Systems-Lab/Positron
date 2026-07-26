// Positron Worker — BullMQ Pipeline Processor
// Decouples pipeline execution from the HTTP API.
// Connects to Redis (BullMQ), opens SQLite DB, creates adapters,
// and processes pipeline jobs from the queue.

import {
	FakeGitHubAdapter,
	GitHubStatusSyncService,
	createRealGitHubAdapter,
} from '@positron/github-adapter';
import type { GitHubAdapter } from '@positron/github-adapter';
import { FakeOpenCodeAdapter, RealOpenCodeAdapter } from '@positron/opencode-adapter';
import {
	openDatabase,
	registerFakeGateEvaluators,
	registerWorkspaceCleanup,
	resolveGateRuntimeMode,
	assembleGateEvaluators,
} from '@positron/run-state';
import type { RunState } from '@positron/run-state';
import { FakeGitWorkspaceAdapter, RealGitWorkspaceAdapter } from '@positron/sandbox';
import type { GitWorkspaceAdapter } from '@positron/sandbox';
import {
	PIPELINE_QUEUE,
	type PipelineJobData,
	type PipelineJobResult,
	buildRemoteUrl,
	loadRepositoryConfig,
	normalizeRepositoryConfig,
	resolveRedisUrl,
} from '@positron/shared';
import type { RepositoryConfig } from '@positron/shared';
import type { OpenCodeAdapter, SpecKitAdapter } from '@positron/shared';
import { FakeSpecKitAdapter, RealSpecKitAdapter } from '@positron/speckit-adapter';
import { GatewayService, ToolRegistry, createAuditSink } from '@positron/tool-gateway';
import { type Job, Queue, Worker } from 'bullmq';
import { type PipelineDeps, runPipeline } from './pipeline-runner.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const redisUrl = resolveRedisUrl();
const dbPath = process.env.POSITRON_DB_PATH ?? '.positron/runs/positron.db';

console.log(`[Worker] Starting with Redis: ${redisUrl}`);
console.log(`[Worker] DB path: ${dbPath}`);

// Open SQLite database
const db = openDatabase(dbPath);

// ---------------------------------------------------------------------------
// Adapter Resolution (same logic as server's createApp)
// ---------------------------------------------------------------------------

function resolveGitHubAdapter(): GitHubAdapter {
	const mode = (process.env.POSITRON_GITHUB_MODE ?? process.env.GITHUB_MODE ?? 'fake') as
		| 'fake'
		| 'real';
	if (mode === 'real') {
		console.log('[Worker] RealGitHubAdapter aktiviert');
		return createRealGitHubAdapter();
	}
	return new FakeGitHubAdapter();
}

function resolveWorkspaceAdapter(): GitWorkspaceAdapter {
	let adapter: GitWorkspaceAdapter;
	if (process.env['POSITRON_WORKSPACE_ROOT']) {
		console.log('[Worker] RealGitWorkspaceAdapter aktiviert');
		adapter = new RealGitWorkspaceAdapter();
	} else {
		adapter = new FakeGitWorkspaceAdapter();
	}
	// Issue #244: Register workspace cleanup function
	registerWorkspaceCleanup(async (workspacePath: string, _runId: string) => {
		const result = await adapter.destroyWorkspace(workspacePath);
		return { cleaned: result.destroyed, reason: result.reason };
	});
	return adapter;
}

function resolveSpeckitAdapter(): SpecKitAdapter {
	const mode = process.env['POSITRON_SPECKIT_MODE'] ?? 'fake';
	if (mode === 'real') {
		console.log('[Worker] RealSpecKitAdapter aktiviert');
		return new RealSpecKitAdapter();
	}
	return new FakeSpecKitAdapter();
}

function resolveOpencodeAdapter(): OpenCodeAdapter {
	const mode = process.env['POSITRON_OPENCODE_MODE'] ?? 'fake';
	if (mode === 'real') {
		console.log('[Worker] RealOpenCodeAdapter aktiviert');
		return new RealOpenCodeAdapter();
	}
	return new FakeOpenCodeAdapter();
}

function resolveRepositoryConfig(): RepositoryConfig {
	const loaded = loadRepositoryConfig(process.env);
	if (!loaded) {
		throw new Error('POSITRON_REPO_OWNER and POSITRON_REPO_NAME must be configured');
	}
	return normalizeRepositoryConfig(loaded);
}

const github = resolveGitHubAdapter();
const workspace = resolveWorkspaceAdapter();
const speckit = resolveSpeckitAdapter();
const opencode = resolveOpencodeAdapter();
const repository = resolveRepositoryConfig();
const syncService = new GitHubStatusSyncService(github);

// ── Issue #385: Gate runtime mode — explicit, mode-aware assembly ──
// Replaces unconditional registerFakeGateEvaluators().
// fixture/demo: fake evaluators registered.
// supervised/real: no fake evaluators — real evaluators must be registered
// or gate evaluation will block (fail-closed).
const gateRuntimeMode = resolveGateRuntimeMode({
	githubMode: github instanceof FakeGitHubAdapter ? 'fake' : 'real',
	workspaceMode: workspace instanceof FakeGitWorkspaceAdapter ? 'fake' : 'real',
	opencodeMode: opencode instanceof FakeOpenCodeAdapter ? 'fake' : 'real',
});
assembleGateEvaluators(gateRuntimeMode);
console.log(`[Worker] Gate runtime mode: ${gateRuntimeMode}`);

// ── Issue #322: Wire ToolGateway onAudit into worker runtime ──
const workerToolRegistry = new ToolRegistry();
const workerGateway = new GatewayService(workerToolRegistry, { enabled: true });
workerGateway.onAudit = createAuditSink({
	runId: 'worker-runtime',
	source: 'worker',
});

// ---------------------------------------------------------------------------
// BullMQ Worker
// ---------------------------------------------------------------------------

const worker = new Worker<PipelineJobData, PipelineJobResult>(
	PIPELINE_QUEUE,
	async (job: Job<PipelineJobData, PipelineJobResult>) => {
		const { runId, repoId, issueNumber, autonomyLevel } = job.data;
		console.log(
			`[Worker] Processing job ${job.id}: runId=${runId}, issueNumber=${issueNumber}, autonomyLevel=${autonomyLevel}`,
		);

		// Load run from DB
		const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as
			| Record<string, unknown>
			| undefined;
		if (!row) throw new Error(`Run ${runId} not found in database`);

		const { parsePhase, parseRunStatus } = await import('@positron/shared');
		const run: RunState = {
			id: String(row.id ?? ''),
			repoId: String(row.repo_id ?? ''),
			issueNumber: Number(row.issue_number ?? issueNumber),
			branch: row.branch ? String(row.branch) : null,
			phase: parsePhase(String(row.phase ?? 'QUEUED')),
			status: parseRunStatus(String(row.status ?? 'blocked')),
			autonomyLevel: Number(row.autonomy_level ?? autonomyLevel),
			attempt: Number(row.attempt ?? 0),
			startedAt: String(row.started_at ?? new Date().toISOString()),
			finishedAt: row.finished_at ? String(row.finished_at) : null,
			lastError: row.last_error ? String(row.last_error) : null,
			workspacePath: row.workspace_path ? String(row.workspace_path) : null,
		};

		// Build pipeline dependencies
		const deps: PipelineDeps = {
			db,
			repository,
			workspace,
			speckit,
			opencode,
			github,
			syncService,
			gateway: workerGateway,
			gateRuntimeMode,
		};

		// Run the pipeline
		try {
			const completed = await runPipeline(run, deps);

			console.log(
				`[Worker] Job ${job.id} complete: runId=${runId}, phase=${completed.phase}, status=${completed.status}`,
			);

			return {
				status: completed.status,
				phase: completed.phase,
				lastError: completed.lastError ?? null,
			};
		} catch (err) {
			// Pipeline threw — persist failure state to DB so the run isn't stale
			const errMsg = err instanceof Error ? err.message : String(err);
			console.error(`[Worker] Pipeline failed for run ${runId}: ${errMsg}`);
			try {
				db.prepare(`
          UPDATE runs SET phase = ?, status = ?, last_error = ?, finished_at = ?
          WHERE id = ?
        `).run('FAILED_BLOCKED', 'blocked', errMsg, new Date().toISOString(), runId);
			} catch (dbErr) {
				console.error(`[Worker] Failed to save error state for run ${runId}:`, dbErr);
			}
			throw err; // Re-throw so BullMQ marks the job as failed
		}
	},
	{
		connection: { url: redisUrl },
		concurrency: 2,
		lockDuration: 600_000, // 10 min lock — long enough for full pipeline
	},
);

worker.on('completed', (job: Job<PipelineJobData, PipelineJobResult>) => {
	console.log(`[Worker] Job ${job.id} completed successfully`);
});

worker.on('failed', (job: Job<PipelineJobData, PipelineJobResult> | undefined, err: Error) => {
	console.error(`[Worker] Job ${job?.id ?? 'unknown'} failed:`, err?.message ?? err);
});

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

async function shutdown(): Promise<void> {
	console.log('[Worker] SIGTERM received, closing...');
	try {
		await worker.close();
		console.log('[Worker] Worker closed');
	} catch (err) {
		console.error('[Worker] Error during worker close:', err);
	}
	process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log(`[Worker] Listening on queue "${PIPELINE_QUEUE}" (Redis: ${redisUrl})`);
