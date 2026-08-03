// Positron Server — Orchestrator und REST API

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Simple .env loader (no external dependency needed)
(function loadEnv(): void {
	// Skip .env loading during tests — vitest setup already configures env
	if (process.env.VITEST === 'true' || process.env.TEST === 'true') return;
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const envPath = path.resolve(__dirname, '..', '.env');
	if (fs.existsSync(envPath)) {
		const content = fs.readFileSync(envPath, 'utf-8');
		for (const line of content.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const eqIdx = trimmed.indexOf('=');
			if (eqIdx === -1) continue;
			const key = trimmed.slice(0, eqIdx).trim();
			const value = trimmed.slice(eqIdx + 1).trim();
			if (key && !process.env[key]) {
				process.env[key] = value;
			}
		}
		console.log(`[Positron] Loaded env from ${envPath}`); // NOLINT: runs before logger init
	}
})();

import http from 'node:http';
import {
	FakeGitHubAdapter,
	GitHubStatusSyncService,
	createRealGitHubAdapter,
} from '@positron/github-adapter';
import type { GitHubAdapter } from '@positron/github-adapter';
import type {
	EvidenceItem,
	GitHubStatusSyncInput,
	GitHubStatusSyncResult,
} from '@positron/github-adapter';
import { renderAccepted } from '@positron/github-adapter';
import { FakeOpenCodeAdapter, RealOpenCodeAdapter } from '@positron/opencode-adapter';
import {
	assembleGateEvaluators,
	createRun,
	getRequiredGates,
	markFailed,
	openDatabase,
	phaseRequiresGates,
	registerFakeGateEvaluators,
	registerWorkspaceCleanup,
	resolveDatabasePath,
	resolveGateRuntimeMode,
	resolveImplementationOutcome,
	resolveTestOutcome,
	resumeFromEvents,
	retry,
	runCleanup,
	transition,
	tryTransitionWithGates,
} from '@positron/run-state';
import type { RunEventData, RunState, TransitionResult } from '@positron/run-state';
import { FakeGitWorkspaceAdapter, RealGitWorkspaceAdapter } from '@positron/sandbox';
import type { GitWorkspaceAdapter } from '@positron/sandbox';
import { TestCommandDetector, TestRunner } from '@positron/sandbox';
import type { TestReport } from '@positron/sandbox';
import {
	MAX_FIX_LOOPS,
	buildRemoteUrl,
	createRunId,
	generateBranchName,
	loadRepositoryConfig,
	normalizeRepositoryConfig,
	parsePhase,
	parseRunStatus,
	safeJsonParse,
} from '@positron/shared';
import { SecretManager } from '@positron/shared';
import type {
	EventLevel,
	GateEvaluationContext,
	GateType,
	Phase,
	RunStatus,
} from '@positron/shared';
import type {
	OpenCodeAdapter,
	OpenCodeRunInput,
	RepositoryConfig,
	SpecKitAdapter,
} from '@positron/shared';
import { FakeSpecKitAdapter, RealSpecKitAdapter } from '@positron/speckit-adapter';
import { GatewayService, ToolRegistry, createAuditSink } from '@positron/tool-gateway';
import type Database from 'better-sqlite3';
import express from 'express';
import { getManagedTargetProjects } from './data/managed-target-projects.js';
import { createDemoLiveRunHandler } from './demo/live-run-handler.js';
import { startWatcher } from './github-watcher.js';
import { createCancelHandler } from './handlers/cancel-run.js';
import { createLogger } from './logger.js';
import {
	activeRuns,
	blockedMergesTotal,
	blockedPushesTotal,
	cancellationsTotal,
	classifyRuntimeError,
	gateRevisionsTotal,
	opencodeCommandDurationSeconds,
	opencodeCommandFailuresTotal,
	opencodeCommandTotal,
	renderMetrics,
	retriesTotal,
	runDurationSeconds,
	runFailuresTotal,
	runsTotal,
	serverUptimeSeconds,
} from './observability/metrics.js';
import {
	queueJobRetriesTotal,
	queueJobsActive,
	queueJobsCompletedTotal,
	queueJobsFailedTotal,
	queueJobsTotal,
	queueJobsWaiting,
	queueRedisUp,
	queueWorkerUp,
	renderQueueMetrics,
} from './observability/queue-metrics.js';
import {
	checkRunSignal,
	clearRunSignal,
	getResumePhaseTarget,
	initSignalsDb,
	setRunSignal,
} from './signals.js';
import {
	addSSEClient,
	broadcastSSE,
	primeEventSequence,
	removeSSEClient,
	resetEventSequence,
} from './sse/broadcaster.js';

const __serverDirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('Server');

/** GitHub Adapter Modus: "fake" (Standard/Test) oder "real" (mit GITHUB_TOKEN) */
type GitHubMode = 'fake' | 'real';

interface ServerOptions {
	adapter?: GitHubAdapter;
	repository?: RepositoryConfig;
	workspaceAdapter?: GitWorkspaceAdapter;
	speckitAdapter?: SpecKitAdapter;
	opencodeAdapter?: OpenCodeAdapter;
	/** Pfad zur SQLite-Datenbank. Default: ~/.positron/positron.db. Für Tests: ':memory:'. */
	dbPath?: string;
}

function resolveAdapter(adapter?: GitHubAdapter): {
	adapter: GitHubAdapter;
	mode: GitHubMode;
} {
	if (adapter) {
		return {
			adapter,
			mode: adapter instanceof FakeGitHubAdapter ? 'fake' : 'real',
		};
	}

	// Priorisiere POSITRON_GITHUB_MODE, Fallback auf GITHUB_MODE (Legacy)
	const mode = (process.env.POSITRON_GITHUB_MODE ??
		process.env.GITHUB_MODE ??
		'fake') as GitHubMode;
	if (mode === 'real') {
		return { adapter: createRealGitHubAdapter(), mode: 'real' };
	}
	if (process.env.NODE_ENV === 'production') {
		log.warn('PRODUCTION-MODE but POSITRON_GITHUB_MODE is not set to "real" — using fake adapter!');
		log.warn('Set POSITRON_GITHUB_MODE=real and configure GITHUB_TOKEN for production use.');
	}
	return { adapter: new FakeGitHubAdapter(), mode: 'fake' };
}

function resolveRepositoryConfig(repository?: RepositoryConfig): RepositoryConfig {
	if (repository) {
		return normalizeRepositoryConfig(repository);
	}

	const loaded = loadRepositoryConfig(process.env);
	if (!loaded) {
		throw new Error('POSITRON_REPO_OWNER and POSITRON_REPO_NAME must be configured');
	}
	return loaded;
}

// SQLite-Datenbankverbindung (initialisiert in createApp)
let db: Database.Database | null = null;

// Adapter-Standards (werden in createApp basierend auf Env-Vars konfiguriert)
// Env-Vars: POSITRON_WORKSPACE_ROOT, POSITRON_SPECKIT_MODE, POSITRON_OPENCODE_MODE
// Default: Fake-Adapter für Development, Real-Adapter für Production mit Warnung
function resolveWorkspaceAdapter(): GitWorkspaceAdapter {
	let adapter: GitWorkspaceAdapter;
	if (process.env['POSITRON_WORKSPACE_ROOT']) {
		log.info('RealGitWorkspaceAdapter aktiviert (POSITRON_WORKSPACE_ROOT gesetzt)');
		adapter = new RealGitWorkspaceAdapter();
	} else {
		if (process.env.NODE_ENV === 'production') {
			log.warn(
				'PRODUCTION: POSITRON_WORKSPACE_ROOT nicht gesetzt — FakeGitWorkspaceAdapter verwendet!',
			);
		}
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
		log.info('RealSpecKitAdapter aktiviert');
		return new RealSpecKitAdapter();
	}
	if (process.env.NODE_ENV === 'production') {
		log.warn(
			'PRODUCTION: POSITRON_SPECKIT_MODE nicht auf "real" gesetzt — FakeSpecKitAdapter verwendet!',
		);
	}
	return new FakeSpecKitAdapter();
}

function resolveOpencodeAdapter(): OpenCodeAdapter {
	const mode = process.env['POSITRON_OPENCODE_MODE'] ?? 'fake';
	if (mode === 'real') {
		log.info('RealOpenCodeAdapter aktiviert');
		return new RealOpenCodeAdapter();
	}
	if (process.env.NODE_ENV === 'production') {
		log.warn(
			'PRODUCTION: POSITRON_OPENCODE_MODE nicht auf "real" gesetzt — FakeOpenCodeAdapter verwendet!',
		);
	}
	return new FakeOpenCodeAdapter();
}

let workspaceAdapter: GitWorkspaceAdapter = resolveWorkspaceAdapter();
let speckitAdapter: SpecKitAdapter = resolveSpeckitAdapter();
let opencodeAdapter: OpenCodeAdapter = resolveOpencodeAdapter();

// Issue #385: Gate runtime mode — resolved in createApp, used by pipeline
let gateRuntimeMode: import('@positron/run-state').GateRuntimeMode = 'fixture';

// Watcher Stop-Funktion (wird von createApp gesetzt, von Shutdown verwendet)
let stopWatcher: (() => void) | null = null;

// Server-Startzeit für Uptime-Berechnung
const serverStartTime = Date.now();

// ---------------------------------------------------------------------------
// Datenbank-Helper (Persistenz via better-sqlite3)
// ---------------------------------------------------------------------------

/** Stellt sicher, dass die DB initialisiert ist */
function getDb(): Database.Database {
	if (!db) throw new Error('Database not initialized. Call createApp() first.');
	return db;
}

/**
 * Speichert einen Run in der Datenbank (INSERT oder UPDATE).
 * Stellt automatisch benötigte Parent-Records (repositories, issues) sicher.
 */
function saveRunToDb(run: RunState): void {
	const database = getDb();
	const ensureRepo = database.prepare(`
    INSERT OR IGNORE INTO repositories (id, owner, name, url, local_path, enabled, created_at)
    VALUES (?, 'positron', ?, '', '', 1, datetime('now'))
  `);
	const ensureIssue = database.prepare(`
    INSERT OR IGNORE INTO issues (id, repo_id, number, title, state, labels_json, last_seen_at)
    VALUES (?, ?, ?, ? || ' #' || ?, 'open', '[]', datetime('now'))
  `);
	const upsertRun = database.prepare(`
    INSERT INTO runs (id, repo_id, issue_number, branch, phase, status, autonomy_level, attempt, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      repo_id         = excluded.repo_id,
      issue_number    = excluded.issue_number,
      branch          = excluded.branch,
      phase           = excluded.phase,
      status          = excluded.status,
      autonomy_level  = excluded.autonomy_level,
      attempt         = excluded.attempt,
      started_at      = excluded.started_at,
      finished_at     = excluded.finished_at
  `);

	const transaction = database.transaction(() => {
		ensureRepo.run(run.repoId, run.repoId);
		ensureIssue.run(
			`issue-${run.repoId}-${run.issueNumber}`,
			run.repoId,
			run.issueNumber,
			'Issue',
			String(run.issueNumber),
		);
		upsertRun.run(
			run.id,
			run.repoId,
			run.issueNumber,
			run.branch,
			run.phase,
			run.status,
			run.autonomyLevel,
			run.attempt,
			run.startedAt,
			run.finishedAt,
		);
	});
	transaction();
}

/**
 * Lädt einen Run aus der Datenbank.
 * lastError und workspacePath werden aus den DB-Spalten last_error / workspace_path gelesen.
 */
function loadRunFromDb(runId: string): RunState | null {
	try {
		const row = getDb().prepare('SELECT * FROM runs WHERE id = ?').get(runId) as
			| Record<string, unknown>
			| undefined;
		if (!row) return null;
		return {
			id: String(row.id ?? ''),
			repoId: String(row.repo_id ?? ''),
			issueNumber: Number(row.issue_number ?? 0),
			branch: row.branch ? String(row.branch) : null,
			phase: parsePhase(String(row.phase ?? 'QUEUED')),
			status: parseRunStatus(String(row.status ?? 'blocked')),
			autonomyLevel: Number(row.autonomy_level ?? 1),
			attempt: Number(row.attempt ?? 0),
			startedAt: String(row.started_at ?? new Date().toISOString()),
			finishedAt: row.finished_at ? String(row.finished_at) : null,
			lastError: row.last_error ? String(row.last_error) : null,
			workspacePath: row.workspace_path ? String(row.workspace_path) : null,
		};
	} catch (err) {
		log.error(`loadRunFromDb failed for ${runId}`, err);
		return null;
	}
}

/** Listet alle Runs aus der Datenbank (neueste zuerst). */
function listRunsFromDb(): RunState[] {
	const rows = getDb().prepare('SELECT * FROM runs ORDER BY started_at DESC').all() as Array<
		Record<string, unknown>
	>;
	return rows
		.filter((row) => {
			// Filtere ungültige Einträge — logge Warnung statt Absturz
			try {
				parsePhase(String(row.phase ?? ''));
				return true;
			} catch {
				log.warn(
					`listRunsFromDb: Ungültige Phase "${String(row.phase)}" für Run ${String(row.id)} — wird übersprungen`,
				);
				return false;
			}
		})
		.map((row) => ({
			id: String(row.id ?? ''),
			repoId: String(row.repo_id ?? ''),
			issueNumber: Number(row.issue_number ?? 0),
			branch: row.branch ? String(row.branch) : null,
			phase: parsePhase(String(row.phase ?? 'QUEUED')),
			status: parseRunStatus(String(row.status ?? 'blocked')),
			autonomyLevel: Number(row.autonomy_level ?? 1),
			attempt: Number(row.attempt ?? 0),
			startedAt: String(row.started_at ?? new Date().toISOString()),
			finishedAt: row.finished_at ? String(row.finished_at) : null,
			lastError: null,
			workspacePath: null,
		}));
}

/** Zählt alle Runs in der Datenbank. */
function countRunsInDb(): number {
	try {
		const row = getDb().prepare('SELECT COUNT(*) as cnt FROM runs').get() as
			| { cnt: number }
			| undefined;
		return row?.cnt ?? 0;
	} catch (err) {
		log.error('countRunsInDb failed', err);
		return 0;
	}
}

/** Einfache Dashboard-Metriken (Issue #84) */
function getDashboardMetrics() {
	const db = getDb();
	const total = (db.prepare('SELECT COUNT(*) as c FROM runs').get() as { c: number }).c;
	const active = (
		db.prepare("SELECT COUNT(*) as c FROM runs WHERE status = 'active'").get() as { c: number }
	).c;
	const done = (
		db.prepare("SELECT COUNT(*) as c FROM runs WHERE status = 'done'").get() as { c: number }
	).c;
	const failed = (
		db.prepare("SELECT COUNT(*) as c FROM runs WHERE status = 'failed'").get() as { c: number }
	).c;
	const blocked = (
		db.prepare("SELECT COUNT(*) as c FROM runs WHERE status = 'blocked'").get() as { c: number }
	).c;
	return {
		totalRuns: total,
		runsByStatus: { active, done, failed, blocked },
		runsByPhase: {},
	};
}

/** Einfache Evidence-Summary (Issue #84) */
function getDashboardEvidence() {
	const db = getDb();
	const totalArtifacts = (db.prepare('SELECT COUNT(*) as c FROM artifacts').get() as { c: number })
		.c;
	const testEvents = (
		db
			.prepare("SELECT COUNT(*) as c FROM run_events WHERE level = 'INFO' AND phase = 'TEST'")
			.get() as { c: number }
	).c;
	const errorEvents = (
		db.prepare("SELECT COUNT(*) as c FROM run_events WHERE level = 'ERROR'").get() as { c: number }
	).c;
	const warningEvents = (
		db.prepare("SELECT COUNT(*) as c FROM run_events WHERE level = 'WARN'").get() as { c: number }
	).c;
	return { totalArtifacts, testEvents, errorEvents, warningEvents };
}

/**
 * Speichert ein Run-Event in der Datenbank und benachrichtigt SSE-Clients.
 * better-sqlite3 ist synchron — kein async nötig.
 */
function storeEvent(event: RunEventData): void {
	try {
		const database = getDb();
		database
			.prepare(`
      INSERT INTO run_events (id, run_id, phase, level, message, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
			.run(
				event.id,
				event.runId,
				event.phase,
				event.level,
				event.message,
				event.payload ? JSON.stringify(event.payload) : '{}',
				event.createdAt,
			);
	} catch (err) {
		log.error(`storeEvent failed for run ${event.runId}`, err);
	}
	// Notify SSE clients about new event
	broadcastSSE(event.runId, 'run-event', event);
}

/** Lädt alle Events eines Runs aus der Datenbank (chronologisch). */
function getEvents(runId: string): RunEventData[] {
	try {
		const rows = getDb()
			.prepare('SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC')
			.all(runId) as Array<Record<string, unknown>>;
		return rows.map((row) => ({
			id: row.id as string,
			runId: row.run_id as string,
			phase: row.phase as Phase,
			level: row.level as EventLevel,
			message: row.message as string,
			payload: row.payload_json
				? (JSON.parse(row.payload_json as string) as Record<string, unknown>)
				: null,
			createdAt: row.created_at as string,
		}));
	} catch (err) {
		log.error(`getEvents failed for run ${runId}`, err);
		return [];
	}
}

export function setWorkspaceAdapter(adapter: GitWorkspaceAdapter): void {
	workspaceAdapter = adapter;
}

export function setSpecKitAdapter(adapter: SpecKitAdapter): void {
	speckitAdapter = adapter;
}

export function setOpenCodeAdapter(adapter: OpenCodeAdapter): void {
	opencodeAdapter = adapter;
}

function resolveSpecKitAdapter(injected?: SpecKitAdapter): SpecKitAdapter {
	if (injected) return injected;
	if (process.env.POSITRON_SPECKIT_MODE === 'real') {
		return new RealSpecKitAdapter();
	}
	return speckitAdapter;
}

function resolveOpenCodeAdapter(injected?: OpenCodeAdapter): OpenCodeAdapter {
	if (injected) return injected;
	if (process.env.POSITRON_OPENCODE_MODE === 'real') {
		return new RealOpenCodeAdapter();
	}
	return opencodeAdapter;
}

/**
 * QA-011: Creates a metrics-instrumented wrapper around the OpenCode adapter.
 * Records command total, duration, and failures without modifying adapter code.
 */
function createInstrumentedOpenCodeAdapter(base: OpenCodeAdapter): OpenCodeAdapter {
	return {
		healthCheck: (wp: string) => base.healthCheck(wp),
		runSlashCommand: async (commandName: string, input: OpenCodeRunInput) => {
			const startTime = Date.now();
			const phaseName = input.phaseName ?? commandName ?? 'unknown';
			try {
				const result = await base.runSlashCommand(commandName, input);
				const durationSec = (Date.now() - startTime) / 1000;
				const outcome = result.status === 'success' ? 'success' : 'error';
				opencodeCommandTotal.inc({ command_type: phaseName, outcome });
				opencodeCommandDurationSeconds.observe({ command_type: phaseName }, durationSec);
				if (outcome === 'error') {
					const err = new Error(result.blockedReason ?? result.summary ?? 'command failed');
					opencodeCommandFailuresTotal.inc({
						command_type: phaseName,
						error_kind: classifyRuntimeError(err),
					});
				}
				return result;
			} catch (err) {
				const durationSec = (Date.now() - startTime) / 1000;
				const errorObj = err instanceof Error ? err : new Error(String(err));
				opencodeCommandTotal.inc({ command_type: phaseName, outcome: 'error' });
				opencodeCommandFailuresTotal.inc({
					command_type: phaseName,
					error_kind: classifyRuntimeError(errorObj),
				});
				opencodeCommandDurationSeconds.observe({ command_type: phaseName }, durationSec);
				throw err;
			}
		},
		runImplement: async (input: OpenCodeRunInput) => {
			const startTime = Date.now();
			const phaseName = input.phaseName ?? 'implement';
			try {
				const result = await base.runImplement(input);
				const durationSec = (Date.now() - startTime) / 1000;
				const outcome = result.status === 'success' ? 'success' : 'error';
				opencodeCommandTotal.inc({ command_type: phaseName, outcome });
				opencodeCommandDurationSeconds.observe({ command_type: phaseName }, durationSec);
				if (outcome === 'error') {
					const err = new Error(result.blockedReason ?? result.summary ?? 'implementation failed');
					opencodeCommandFailuresTotal.inc({
						command_type: phaseName,
						error_kind: classifyRuntimeError(err),
					});
				}
				return result;
			} catch (err) {
				const durationSec = (Date.now() - startTime) / 1000;
				const errorObj = err instanceof Error ? err : new Error(String(err));
				opencodeCommandTotal.inc({ command_type: phaseName, outcome: 'error' });
				opencodeCommandFailuresTotal.inc({
					command_type: phaseName,
					error_kind: classifyRuntimeError(errorObj),
				});
				opencodeCommandDurationSeconds.observe({ command_type: phaseName }, durationSec);
				throw err;
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Safe GitHub Sync (never crashes the orchestrator)
// ---------------------------------------------------------------------------

/** Wraps a sync operation so failures are logged but never block the run */
async function safeSync(
	syncService: GitHubStatusSyncService,
	operation: () => Promise<GitHubStatusSyncResult>,
	runId: string,
	context: Phase,
): Promise<GitHubStatusSyncResult | null> {
	try {
		const result = await operation();
		if (result.status === 'failed') {
			storeEvent({
				id: createRunId(),
				runId,
				phase: context,
				level: 'WARN',
				message: `GitHub sync failed: ${result.reason ?? 'unknown'}`,
				payload: null,
				createdAt: new Date().toISOString(),
			});
		}
		return result;
	} catch (err) {
		storeEvent({
			id: createRunId(),
			runId,
			phase: context,
			level: 'ERROR',
			message: `GitHub sync error: ${String(err).slice(0, 200)}`,
			payload: null,
			createdAt: new Date().toISOString(),
		});
		return null;
	}
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

async function executePhase(
	run: RunState,
	repository: RepositoryConfig,
	workspace: GitWorkspaceAdapter,
	speckit: SpecKitAdapter,
	opencode: OpenCodeAdapter,
	github: GitHubAdapter,
	syncService?: GitHubStatusSyncService,
): Promise<RunState> {
	const current = run;
	let result: TransitionResult;

	switch (current.phase) {
		case 'QUEUED':
			result = transition(current, 'CLAIMED', 'Issue claimed', 'INFO');
			break;
		case 'CLAIMED':
			// Sync: Run Accepted → GitHub comment + labels
			if (syncService) {
				const syncInput: GitHubStatusSyncInput = {
					runId: current.id,
					owner: repository.owner,
					repo: repository.repo,
					issueNumber: current.issueNumber,
					phase: 'CLAIMED',
					status: 'active',
					branchName: current.branch ?? undefined,
				};
				await safeSync(
					syncService,
					() => syncService.syncRunAccepted(syncInput),
					current.id,
					'CLAIMED',
				);
			}
			result = transition(current, 'REPO_SYNC', 'Repo synced', 'INFO');
			break;
		case 'REPO_SYNC':
			try {
				const workspaceRepository = {
					owner: repository.owner,
					repo: repository.repo,
					remoteUrl: repository.remoteUrl ?? buildRemoteUrl(repository.owner, repository.repo),
				};
				const ws = await workspace.prepareWorkspace({
					repository: workspaceRepository,
					issueNumber: current.issueNumber,
					issueTitle: `Issue #${current.issueNumber}`,
					runId: current.id,
					baseBranch: repository.defaultBranch,
				});
				current.branch = ws.branchName;
				current.workspacePath = ws.workspacePath;
				result = transition(current, 'ISSUE_CONTEXT', `Workspace: ${ws.workspacePath}`);
			} catch (err) {
				result = markFailed(current, 'FAILED_TRANSIENT', `Repo sync failed: ${String(err)}`);
			}
			break;
		case 'ISSUE_CONTEXT':
			result = transition(current, 'WEB_RESEARCH', 'Research phase', 'INFO');
			break;
		case 'WEB_RESEARCH': {
			const researchDoc = await generateResearchDocument(github, repository, current.issueNumber);
			saveArtifact(current.id, 'research', researchDoc);
			storeEvent({
				id: createRunId(),
				runId: current.id,
				phase: 'WEB_RESEARCH',
				level: 'INFO',
				message: `Research document generated (${researchDoc.length} chars)`,
				payload: { artifactKind: 'research', size: researchDoc.length },
				createdAt: new Date().toISOString(),
			});
			result = transition(
				current,
				'SPECIFY',
				`Research: ${researchDoc.length} chars research.md generated`,
			);
			break;
		}
		case 'SPECIFY': {
			const wsPath = current.workspacePath ?? current.branch ?? '/tmp';
			const realSpeckit = process.env.POSITRON_ENABLE_REAL_SPECKIT === 'true';

			if (realSpeckit) {
				try {
					// Step 1: specify init (safe-cli mode, only once)
					const initResult = await speckit.initialize({
						runId: current.id,
						workspacePath: wsPath,
						issueTitle: `Issue #${current.issueNumber}`,
						issueNumber: current.issueNumber,
						mode: 'safe-cli',
						aiAgent: 'opencode',
					});
					if (initResult.status === 'success') {
						storeEvent({
							id: createRunId(),
							runId: current.id,
							phase: 'SPECIFY',
							level: 'INFO',
							message: `Spec Kit initialized: ${initResult.summary}`,
							payload: null,
							createdAt: new Date().toISOString(),
						});

						// Step 2: opencode run --command spec-driven-development "specify"
						const specResult = await opencode.runSlashCommand('spec-driven-development', {
							runId: current.id,
							workspacePath: wsPath,
							issueTitle: `Issue #${current.issueNumber}`,
							issueNumber: current.issueNumber,
							phaseName: 'specify',
						});
						result = transition(
							current,
							'PLAN',
							`OpenCode: ${specResult.summary}`,
							specResult.status === 'success' ? 'INFO' : 'WARN',
						);
						break;
					}
				} catch (err) {
					storeEvent({
						id: createRunId(),
						runId: current.id,
						phase: 'SPECIFY',
						level: 'WARN',
						message: `OpenCode error: ${String(err).slice(0, 200)}`,
						payload: null,
						createdAt: new Date().toISOString(),
					});
				}
			}

			// Fallback: artifact-only detection
			const input = {
				runId: current.id,
				workspacePath: wsPath,
				issueTitle: `Issue #${current.issueNumber}`,
				issueNumber: current.issueNumber,
				mode: 'artifact-only' as const,
			};
			try {
				const sr = await speckit.runSpecify(input);
				if (sr.status === 'success' || sr.status === 'skipped') {
					saveArtifact(current.id, 'spec', sr.summary);
				}
				result = transition(current, 'PLAN', sr.summary, sr.status === 'success' ? 'INFO' : 'WARN');
			} catch (err) {
				const errMsg = `Specify error: ${String(err).slice(0, 200)}`;
				result = markFailed(current, 'FAILED_TRANSIENT', errMsg);
			}
			break;
		}
		case 'PLAN': {
			const wsPath = current.workspacePath ?? current.branch ?? '/tmp';
			const realSpeckit = process.env.POSITRON_ENABLE_REAL_SPECKIT === 'true';

			if (realSpeckit) {
				try {
					const planResult = await opencode.runSlashCommand('spec-driven-development', {
						runId: current.id,
						workspacePath: wsPath,
						issueTitle: `Issue #${current.issueNumber}`,
						issueNumber: current.issueNumber,
						phaseName: 'plan',
					});
					result = transition(
						current,
						'TASKS',
						`OpenCode: ${planResult.summary}`,
						planResult.status === 'success' ? 'INFO' : 'WARN',
					);
					break;
				} catch (err) {
					storeEvent({
						id: createRunId(),
						runId: current.id,
						phase: 'PLAN',
						level: 'WARN',
						message: `OpenCode error: ${String(err).slice(0, 200)}`,
						payload: null,
						createdAt: new Date().toISOString(),
					});
				}
			}

			const input = {
				runId: current.id,
				workspacePath: wsPath,
				issueTitle: `Issue #${current.issueNumber}`,
				issueNumber: current.issueNumber,
				mode: 'artifact-only' as const,
			};
			try {
				const pr = await speckit.runPlan(input);
				if (pr.status === 'success' || pr.status === 'skipped') {
					saveArtifact(current.id, 'plan', pr.summary);
				}
				result = transition(
					current,
					'TASKS',
					pr.summary,
					pr.status === 'success' || pr.status === 'skipped' ? 'INFO' : 'WARN',
				);
			} catch (err) {
				const planErrMsg = `Plan error: ${String(err).slice(0, 200)}`;
				result = markFailed(current, 'FAILED_TRANSIENT', planErrMsg);
			}
			break;
		}
		case 'TASKS': {
			const wsPath = current.workspacePath ?? current.branch ?? '/tmp';
			const realSpeckit = process.env.POSITRON_ENABLE_REAL_SPECKIT === 'true';

			if (realSpeckit) {
				try {
					const tasksResult = await opencode.runSlashCommand('spec-driven-development', {
						runId: current.id,
						workspacePath: wsPath,
						issueTitle: `Issue #${current.issueNumber}`,
						issueNumber: current.issueNumber,
						phaseName: 'tasks',
					});
					result = transition(
						current,
						'ANALYZE',
						`OpenCode: ${tasksResult.summary}`,
						tasksResult.status === 'success' ? 'INFO' : 'WARN',
					);
					break;
				} catch (err) {
					storeEvent({
						id: createRunId(),
						runId: current.id,
						phase: 'TASKS',
						level: 'WARN',
						message: `OpenCode error: ${String(err).slice(0, 200)}`,
						payload: null,
						createdAt: new Date().toISOString(),
					});
				}
			}

			const input = {
				runId: current.id,
				workspacePath: wsPath,
				issueTitle: `Issue #${current.issueNumber}`,
				issueNumber: current.issueNumber,
				mode: 'artifact-only' as const,
			};
			try {
				const tr = await speckit.runTasks(input);
				if (tr.status === 'success' || tr.status === 'skipped') {
					saveArtifact(current.id, 'tasks', tr.summary);
				}
				result = transition(
					current,
					'ANALYZE',
					tr.summary,
					tr.status === 'success' || tr.status === 'skipped' ? 'INFO' : 'WARN',
				);
			} catch (err) {
				const tasksErrMsg = `Tasks error: ${String(err).slice(0, 200)}`;
				result = markFailed(current, 'FAILED_TRANSIENT', tasksErrMsg);
			}
			break;
		}
		case 'ANALYZE': {
			const wsPath = current.workspacePath ?? current.branch ?? '/tmp';
			const input = {
				runId: current.id,
				workspacePath: wsPath,
				issueTitle: `Issue #${current.issueNumber}`,
				issueNumber: current.issueNumber,
				mode: 'artifact-only' as const,
			};
			try {
				const ar = await speckit.runAnalyze(input);
				result = transition(current, 'REVIEW', ar.summary, 'INFO');
			} catch (err) {
				storeEvent({
					id: createRunId(),
					runId: current.id,
					phase: 'ANALYZE',
					level: 'WARN',
					message: `Analyze error: ${String(err).slice(0, 200)}`,
					payload: null,
					createdAt: new Date().toISOString(),
				});
				result = transition(current, 'REVIEW', 'Analysis complete', 'INFO');
			}
			break;
		}
		case 'REVIEW': {
			// Minimale Artefakt-Validierung: Prüfe ob spec, plan und tasks existieren
			const requiredArtifacts = ['spec', 'plan', 'tasks'];
			const existingKinds = new Set(
				(
					getDb()
						.prepare('SELECT DISTINCT kind FROM artifacts WHERE run_id = ?')
						.all(current.id) as Array<{ kind: string }>
				).map((r) => r.kind),
			);
			const missing = requiredArtifacts.filter((k) => !existingKinds.has(k));
			if (missing.length > 0) {
				const msg = `Review failed: missing artifacts: ${missing.join(', ')}`;
				result = markFailed(current, 'FAILED_BLOCKED', msg);
			} else {
				result = transition(
					current,
					'IMPLEMENT',
					`Review passed: ${requiredArtifacts.length}/${requiredArtifacts.length} artifacts present`,
				);
			}
			break;
		}
		case 'IMPLEMENT': {
			const wsPath = current.workspacePath ?? current.branch ?? '/tmp';
			const input = {
				runId: current.id,
				workspacePath: wsPath,
				issueTitle: `Issue #${current.issueNumber}`,
				issueNumber: current.issueNumber,
				mode: 'safe-cli' as const,
				autonomyLevel: current.autonomyLevel,
			};

			try {
				const ir = await opencode.runImplement(input);

				// Issue #385: Explicit outcome resolution — blocked/failed must NOT reach TEST
				const outcome = resolveImplementationOutcome(ir.status);

				if (outcome === 'FAILED_BLOCKED') {
					storeEvent({
						id: createRunId(),
						runId: current.id,
						phase: 'IMPLEMENT',
						level: 'ERROR',
						message: `Implement blocked: ${ir.blockedReason ?? 'policy'}`,
						payload: { result: ir, gateRuntimeMode },
						createdAt: new Date().toISOString(),
					});
					result = markFailed(
						current,
						'FAILED_BLOCKED',
						`Implement blocked: ${ir.blockedReason ?? 'policy'}`,
					);
				} else if (outcome === 'RETRY') {
					result = markFailed(current, 'FAILED_TRANSIENT', `Implement failed: ${ir.summary}`);
				} else {
					result = transition(
						current,
						'TEST',
						ir.summary,
						ir.status === 'success' ? 'INFO' : 'WARN',
					);
				}
			} catch (err) {
				const implErrMsg = `Implement error: ${String(err).slice(0, 200)}`;
				result = markFailed(current, 'FAILED_TRANSIENT', implErrMsg);
			}
			break;
		}
		case 'TEST':
			try {
				const wsPath = current.workspacePath ?? current.branch ?? '/tmp';
				const detector = new TestCommandDetector();
				const detection = await detector.detect(wsPath);

				// Issue #385: No detected test commands — resolve based on gate runtime mode
				if (detection.commands.length === 0) {
					const emptyReport: TestReport = {
						status: 'blocked',
						summary: 'No test commands detected',
						passed: 0,
						failed: 0,
						total: 0,
						durationMs: 0,
					};
					const outcome = resolveTestOutcome(emptyReport, gateRuntimeMode, false);
					if (outcome === 'FAILED_BLOCKED') {
						result = markFailed(
							current,
							'FAILED_BLOCKED',
							`No test commands configured in ${gateRuntimeMode} mode. Set up tests or switch to fixture/demo mode.`,
						);
					} else {
						result = transition(
							current,
							'VERIFY',
							'No test commands configured — tests skipped (fixture/demo mode)',
							'WARN',
						);
					}
				} else {
					const runner = new TestRunner();
					const report = await runner.runDetectedCommands({
						runId: current.id,
						workspacePath: wsPath,
						commands: detection.commands,
						mode: 'standard',
					});
					// Sync: Test Report → GitHub comment + labels
					if (syncService && report) {
						const syncInput: GitHubStatusSyncInput = {
							runId: current.id,
							owner: repository.owner,
							repo: repository.repo,
							issueNumber: current.issueNumber,
							phase: 'TEST',
							status: report.status,
							branchName: current.branch ?? undefined,
							workspacePath: wsPath,
							testReport: report,
						};
						if (report.status === 'blocked') {
							await safeSync(
								syncService,
								() =>
									syncService.syncBlocked({
										...syncInput,
										error: { type: 'blocked', message: report.summary },
									}),
								current.id,
								'TEST',
							);
						} else if (report.status === 'failed') {
							await safeSync(
								syncService,
								() => syncService.syncTestReport(syncInput),
								current.id,
								'TEST',
							);
						} else {
							await safeSync(
								syncService,
								() => syncService.syncTestReport(syncInput),
								current.id,
								'TEST',
							);
						}
					}

					// Issue #385: Explicit outcome resolution — failed/blocked must NOT reach VERIFY
					const outcome = resolveTestOutcome(report, gateRuntimeMode, true);

					if (outcome === 'FAILED_BLOCKED') {
						result = markFailed(
							current,
							'FAILED_BLOCKED',
							`Tests ${report.status}: ${report.summary}`,
						);
					} else if (outcome === 'RETRY') {
						result = markFailed(current, 'FAILED_TRANSIENT', `Tests failed: ${report.summary}`);
					} else {
						result = transition(current, 'VERIFY', 'Tests passed', 'INFO');
					}
				}
			} catch (err) {
				const errMsg = err instanceof Error ? err.message : String(err);
				// Issue #385: Test execution crash must NOT proceed to VERIFY
				result = markFailed(
					current,
					'FAILED_BLOCKED',
					`Test execution crashed: ${errMsg.slice(0, 200)}`,
				);
			}
			break;
		case 'VERIFY':
			current.branch =
				current.branch ?? generateBranchName(current.issueNumber, `run-${current.id.slice(0, 8)}`);
			if (phaseRequiresGates('COMMIT')) {
				const gateContext: GateEvaluationContext = {
					runId: current.id,
					phase: current.phase,
					targetPhase: 'COMMIT',
					gateTypes: getRequiredGates('COMMIT'),
				};
				result = tryTransitionWithGates(
					current,
					'COMMIT',
					'Verified, commit ready',
					gateContext,
					'INFO',
					null,
				);
			} else {
				result = transition(current, 'COMMIT', 'Verified, commit ready');
			}
			break;
		case 'COMMIT': {
			const branch =
				current.branch ?? generateBranchName(current.issueNumber, `run-${current.id.slice(0, 8)}`);
			const pushAllowed = process.env.POSITRON_ENABLE_PUSH === 'true';

			// Commit Message generieren
			const commitMsg = `feat(issue-${current.issueNumber}): Positron automated changes [Run: ${current.id.slice(0, 8)}]`;

			// Workspace path from run state (Issue #36)
			const commitWsPath = current.workspacePath ?? `/tmp/positron-ws-${current.id.slice(0, 8)}`;

			try {
				// Änderungen erfassen — nutzt git status (erkennt neue + geänderte Dateien)
				let changeSummary = '';
				let hasChanges = false;
				try {
					const status = await workspace.getStatus(commitWsPath);
					hasChanges = !status.isClean;
					const staged = status.staged.length;
					const unstaged = status.unstaged.length;
					const untracked = status.untracked.length;
					changeSummary = `${staged} staged, ${unstaged} unstaged, ${untracked} untracked`;
				} catch {
					/* status optional */
				}

				if (!hasChanges) {
					// Keine Änderungen — sauber blocken (Issue #38)
					result = markFailed(
						current,
						'FAILED_BLOCKED',
						`No changes were made during implementation — no files changed in workspace ${commitWsPath} (${changeSummary})`,
					);
					break;
				}

				// Commit nur bei vorhandenem Diff
				const commitResult = await workspace.commit(commitWsPath, commitMsg);

				// Push nur mit Allow-Flag
				let pushResult = '';
				if (pushAllowed) {
					await workspace.push({ workspacePath: commitWsPath, branch });
					pushResult = ', pushed';
				} else {
					pushResult = ', push skipped (POSITRON_ENABLE_PUSH not set)';
				}

				const summary = `Committed: ${commitResult.sha.slice(0, 7)}${pushResult} (${changeSummary})`;
				if (phaseRequiresGates('PR_CREATE')) {
					const gateContext: GateEvaluationContext = {
						runId: current.id,
						phase: current.phase,
						targetPhase: 'PR_CREATE',
						gateTypes: getRequiredGates('PR_CREATE'),
					};
					result = tryTransitionWithGates(current, 'PR_CREATE', summary, gateContext, 'INFO', null);
				} else {
					result = transition(current, 'PR_CREATE', summary, 'INFO');
				}
			} catch (err) {
				// Issue #385: COMMIT exception → FAILED_BLOCKED (never PR_CREATE)
				// A failed commit means no safe state to push or PR from.
				storeEvent({
					id: createRunId(),
					runId: current.id,
					phase: 'COMMIT',
					level: 'ERROR',
					message: `Commit/Push failed: ${String(err).slice(0, 200)}`,
					payload: null,
					createdAt: new Date().toISOString(),
				});
				result = markFailed(
					current,
					'FAILED_BLOCKED',
					`Commit/Push failed: ${String(err).slice(0, 200)}`,
				);
			}
			break;
		}
		case 'PR_CREATE': {
			const branch =
				current.branch ?? generateBranchName(current.issueNumber, `run-${current.id.slice(0, 8)}`);
			const evidence = buildEvidence(current);
			const body = renderPRBody(current, repository, evidence, branch);

			try {
				// --- R5: Check for existing PR before creating a new one (Idempotency) ---
				let pr: Awaited<ReturnType<typeof github.createPullRequest>>;
				let prWasAdopted = false;

				try {
					const existingPRs = await github.listPullRequests({
						owner: repository.owner,
						repo: repository.repo,
						head: `${repository.owner}:${branch}`,
						state: 'open',
					});
					if (existingPRs.length > 0 && existingPRs[0]) {
						const existing = existingPRs[0];
						pr = {
							number: existing.number,
							htmlUrl: existing.htmlUrl,
							state: existing.state,
						} as typeof pr;
						prWasAdopted = true;
						storeEvent({
							id: createRunId(),
							runId: current.id,
							phase: 'PR_CREATE',
							level: 'INFO',
							message: `Adopted existing PR #${pr.number} (recovery after restart)`,
							payload: { prNumber: pr.number, adopted: true, prUrl: pr.htmlUrl },
							createdAt: new Date().toISOString(),
						});
					} else {
						pr = await github.createPullRequest({
							owner: repository.owner,
							repo: repository.repo,
							title: `Positron: ${current.issueNumber ? `Issue #${current.issueNumber} — ` : ''}Automated changes`,
							head: branch,
							base: repository.defaultBranch ?? 'main',
							body,
						});
					}
				} catch (listErr) {
					pr = await github.createPullRequest({
						owner: repository.owner,
						repo: repository.repo,
						title: `Positron: ${current.issueNumber ? `Issue #${current.issueNumber} — ` : ''}Automated changes`,
						head: branch,
						base: repository.defaultBranch ?? 'main',
						body,
					});
				}

				// --- R5/R6: Fault Injection Hook (run-scoped via POSITRON_FAULT_RUN_ID) ---
				const faultPoint = process.env.POSITRON_FAULT_INJECTION_POINT;
				const faultRunId = process.env.POSITRON_FAULT_RUN_ID;
				if (
					!prWasAdopted &&
					faultPoint === 'AFTER_REMOTE_DRAFT_PR_CREATE_BEFORE_LOCAL_SUCCESS_CHECKPOINT' &&
					(!faultRunId || String(current.issueNumber) === faultRunId)
				) {
					storeEvent({
						id: createRunId(),
						runId: current.id,
						phase: 'PR_CREATE',
						level: 'WARN',
						message: `FAULT INJECTED: Terminating after PR #${pr.number} creation, before local checkpoint`,
						payload: { prNumber: pr.number, faultPoint, prWasAdopted: false },
						createdAt: new Date().toISOString(),
					});
					saveRunToDb({ ...current, phase: 'PR_CREATE', status: 'active' });
					process.exit(1);
				}

				if (syncService) {
					const syncInput: GitHubStatusSyncInput = {
						runId: current.id,
						owner: repository.owner,
						repo: repository.repo,
						issueNumber: current.issueNumber,
						phase: 'PR_CREATE',
						status: 'success',
						branchName: branch,
						prNumber: pr.number,
						prUrl: pr.htmlUrl,
						evidence,
					};
					await safeSync(
						syncService,
						() => syncService.syncPrCreated(syncInput),
						current.id,
						'PR_CREATE',
					);
				}

				// --- Reviewer-Automation (Issue #32) ---
				const prReviewers = process.env.POSITRON_PR_REVIEWERS?.split(',')
					.map((s) => s.trim())
					.filter(Boolean);
				const prTeamReviewers = process.env.POSITRON_PR_TEAM_REVIEWERS?.split(',')
					.map((s) => s.trim())
					.filter(Boolean);
				if (prReviewers?.length || prTeamReviewers?.length) {
					try {
						const reviewResult = await github.requestReviewers({
							owner: repository.owner,
							repo: repository.repo,
							prNumber: pr.number,
							reviewers: prReviewers,
							teamReviewers: prTeamReviewers,
						});
						if (reviewResult.requested) {
							const reviewerList = [
								...(reviewResult.reviewers ?? []),
								...(reviewResult.teamReviewers ?? []),
							].join(', ');
							storeEvent({
								id: createRunId(),
								runId: current.id,
								phase: 'PR_CREATE',
								level: 'INFO',
								message: `Review requested from: ${reviewerList}`,
								payload: {
									reviewers: reviewResult.reviewers,
									teamReviewers: reviewResult.teamReviewers,
								},
								createdAt: new Date().toISOString(),
							});
						}
					} catch {
						storeEvent({
							id: createRunId(),
							runId: current.id,
							phase: 'PR_CREATE',
							level: 'WARN',
							message: 'Review request failed (non-blocking)',
							payload: null,
							createdAt: new Date().toISOString(),
						});
					}
				}

				if (phaseRequiresGates('MERGE')) {
					const gateContext: GateEvaluationContext = {
						runId: current.id,
						phase: current.phase,
						targetPhase: 'MERGE',
						gateTypes: getRequiredGates('MERGE'),
					};
					result = tryTransitionWithGates(
						current,
						'MERGE',
						`PR #${pr.number} created: ${pr.htmlUrl}`,
						gateContext,
						'INFO',
						null,
					);
				} else {
					result = transition(current, 'MERGE', `PR #${pr.number} created: ${pr.htmlUrl}`, 'INFO');
				}
			} catch (err) {
				storeEvent({
					id: createRunId(),
					runId: current.id,
					phase: 'PR_CREATE',
					level: 'ERROR',
					message: `PR creation failed: ${String(err).slice(0, 200)}`,
					payload: null,
					createdAt: new Date().toISOString(),
				});
				result = markFailed(
					current,
					'FAILED_BLOCKED',
					`PR creation failed: ${String(err).slice(0, 100)}`,
				);
			}
			break;
		}
		case 'MERGE': {
			// --- Issue #321: Gate DONE transitions on evidence_required ---
			const doneGateCtx: GateEvaluationContext = {
				runId: current.id,
				phase: current.phase,
				targetPhase: 'DONE',
				gateTypes: getRequiredGates('DONE'),
			};

			// --- Safety Gates (Issue #21 + #41) ---
			const mergeAllowed = process.env.POSITRON_ENABLE_MERGE === 'true';
			const mergeDryRun = process.env.POSITRON_MERGE_DRY_RUN === 'true';
			const mergeKillSwitch = process.env.POSITRON_MERGE_KILL_SWITCH !== 'false';

			// Branch
			const branch = current.branch;
			if (!branch) {
				result = tryTransitionWithGates(
					current,
					'DONE',
					'Merge skipped (no branch)',
					doneGateCtx,
					'INFO',
					null,
				);
				break;
			}

			// Fetch PR
			let pr: Awaited<ReturnType<typeof github.listPullRequests>>[0] | null = null;
			try {
				const prs = await github.listPullRequests({
					owner: repository.owner,
					repo: repository.repo,
					head: `${repository.owner}:${branch}`,
					state: 'open',
				});
				pr = prs[0] ?? null;
			} catch {
				/* PR lookup optional */
			}

			if (!pr) {
				result = tryTransitionWithGates(
					current,
					'DONE',
					'Merge skipped (no open PR found)',
					doneGateCtx,
					'INFO',
					null,
				);
				break;
			}

			if (pr.state !== 'open') {
				storeEvent({
					id: createRunId(),
					runId: current.id,
					phase: 'MERGE',
					level: 'WARN',
					message: `PR #${pr.number} ist nicht offen (state: ${pr.state}), überspringe Merge`,
					payload: { prNumber: pr.number, prState: pr.state },
					createdAt: new Date().toISOString(),
				});
				result = tryTransitionWithGates(
					current,
					'DONE',
					`PR #${pr.number} ist ${pr.state} — Merge übersprungen`,
					doneGateCtx,
					'WARN',
					null,
				);
				break;
			}

			// --- Dry-Run: Evaluate all gates, never merge (Issue #41) ---
			if (mergeDryRun) {
				// Fetch PR details with polling for conclusive mergeability (Issue #42)
				let mergeableState = 'checking';
				const maxMergeableRetries = 3;
				const mergeableRetryDelay = 5000; // 5s between polls

				for (let retry = 0; retry <= maxMergeableRetries; retry++) {
					try {
						const prDetail = await github.getPullRequest(
							repository.owner,
							repository.repo,
							pr.number,
						);
						const raw = prDetail.mergeable;
						if (raw === true) {
							mergeableState = 'clean';
							break;
						}
						if (raw === false) {
							mergeableState = 'conflict';
							break;
						}
						// null/undefined: still computing — retry after delay
						if (retry < maxMergeableRetries) {
							await new Promise((r) => setTimeout(r, mergeableRetryDelay));
						}
					} catch {
						/* PR details optional */ break;
					}
				}

				const testEvent = getEvents(current.id).find(
					(e) => e.phase === 'TEST' && e.level === 'INFO',
				);

				// Evaluate ALL gates (no short-circuit in dry-run)
				const allGates: Array<{
					gate: string;
					passed: boolean;
					detail: string;
				}> = [
					{
						gate: 'Auto-Merge Enabled',
						passed: mergeAllowed,
						detail: mergeAllowed ? 'POSITRON_ENABLE_MERGE=true' : 'POSITRON_ENABLE_MERGE not set',
					},
					{
						gate: 'Kill-Switch',
						passed: !mergeKillSwitch,
						detail: mergeKillSwitch
							? 'POSITRON_MERGE_KILL_SWITCH=true — blocked'
							: 'Kill-Switch not active',
					},
					{
						gate: 'Run Status Active',
						passed: current.status === 'active',
						detail: `Run status is "${current.status}"`,
					},
					{
						gate: 'Test Evidence',
						passed: !!testEvent,
						detail: testEvent ? 'Test phase completed with INFO' : 'No passing test evidence',
					},
					{
						gate: 'Branch',
						passed: !!current.branch,
						detail: `Branch: ${current.branch}`,
					},
					{
						gate: 'PR Open',
						passed: pr.state === 'open',
						detail: `PR state: ${pr.state}`,
					},
					{
						gate: 'Mergeable',
						passed: mergeableState === 'clean',
						detail: `GitHub mergeable: ${mergeableState}`,
					},
				];

				const allPassed = allGates.every((g) => g.passed);
				const decision = allPassed ? 'WOULD_MERGE' : 'WOULD_BLOCK';
				const blockedGates = allGates.filter((g) => !g.passed);

				// Structured event for Dashboard
				storeEvent({
					id: createRunId(),
					runId: current.id,
					phase: 'MERGE',
					level: 'GATE',
					message: `[DRY-RUN] ${decision}: ${allGates.filter((g) => g.passed).length}/${allGates.length} gates pass`,
					payload: {
						decision,
						allPassed,
						mergeable: mergeableState,
						gates: allGates,
						prNumber: pr.number,
						prUrl: pr.htmlUrl,
					},
					createdAt: new Date().toISOString(),
				});

				// GitHub comment with gate-by-gate results
				try {
					const gateList = allGates
						.map((g) => `- ${g.passed ? '✅' : '❌'} **${g.gate}:** ${g.detail}`)
						.join('\n');
					await github.createIssueComment(
						{
							owner: repository.owner,
							repo: repository.repo,
							issueNumber: current.issueNumber,
						},
						`## 🔍 Auto-Merge Dry-Run Result\n\n**Decision:** ${decision}\n**PR:** #${pr.number}\n**Mergeable:** ${mergeableState}\n\n### Gates (${allGates.filter((g) => g.passed).length}/${allGates.length})\n\n${gateList}\n\n> 🛡️ **No merge executed** — Dry-Run only.`,
					);
				} catch {
					/* comment is best-effort */
				}

				result = tryTransitionWithGates(
					current,
					'DONE',
					`[DRY-RUN] ${decision}: ${allPassed ? 'All gates pass' : `${blockedGates.length} gates fail — ${blockedGates.map((g) => g.gate).join(', ')}`}`,
					doneGateCtx,
					allPassed ? 'INFO' : 'WARN',
					null,
				);
				break;
			}

			// --- Real Merge (nicht Dry-Run) ---

			// Kill-Switch
			if (mergeKillSwitch) {
				result = tryTransitionWithGates(
					current,
					'DONE',
					'Merge BLOCKED: Kill-Switch (POSITRON_MERGE_KILL_SWITCH=true)',
					doneGateCtx,
					'WARN',
					null,
				);
				break;
			}
			if (!mergeAllowed) {
				result = tryTransitionWithGates(
					current,
					'DONE',
					'Merge skipped (POSITRON_ENABLE_MERGE not set)',
					doneGateCtx,
					'INFO',
					null,
				);
				break;
			}
			if (current.status !== 'active') {
				result = tryTransitionWithGates(
					current,
					'DONE',
					`Merge blocked: Run status is ${current.status}`,
					doneGateCtx,
					'WARN',
					null,
				);
				break;
			}

			try {
				const mergeResult = await github.mergePullRequest({
					owner: repository.owner,
					repo: repository.repo,
					prNumber: pr.number,
					strategy: 'squash',
					commitTitle: `Positron: Issue #${current.issueNumber} — Automated changes`,
					commitMessage: `Run: ${current.id.slice(0, 8)}`,
				});

				if (mergeResult.merged) {
					if (syncService) {
						const syncInput: GitHubStatusSyncInput = {
							runId: current.id,
							owner: repository.owner,
							repo: repository.repo,
							issueNumber: current.issueNumber,
							phase: 'MERGE',
							status: 'success',
							branchName: mergeResult.sha,
							prNumber: pr.number,
							prUrl: pr.htmlUrl,
						};
						await safeSync(
							syncService,
							() => syncService.syncMerged(syncInput),
							current.id,
							'MERGE',
						);
					}
					// Issue nach erfolgreichem Merge schließen (Task 2)
					try {
						await github.closeIssue(repository.owner, repository.repo, current.issueNumber);
						storeEvent({
							id: createRunId(),
							runId: current.id,
							phase: 'MERGE',
							level: 'INFO',
							message: `Issue #${current.issueNumber} closed after merge`,
							payload: null,
							createdAt: new Date().toISOString(),
						});
					} catch (err) {
						storeEvent({
							id: createRunId(),
							runId: current.id,
							phase: 'MERGE',
							level: 'WARN',
							message: `Issue close skipped: ${String(err).slice(0, 200)}`,
							payload: null,
							createdAt: new Date().toISOString(),
						});
					}
					result = tryTransitionWithGates(
						current,
						'DONE',
						`PR #${pr.number} merged: ${mergeResult.sha?.slice(0, 7)}`,
						doneGateCtx,
						'INFO',
						null,
					);
				} else {
					result = tryTransitionWithGates(
						current,
						'DONE',
						`PR #${pr.number} not mergeable: ${mergeResult.message ?? 'unknown'}`,
						doneGateCtx,
						'WARN',
						null,
					);
				}
			} catch (err) {
				storeEvent({
					id: createRunId(),
					runId: current.id,
					phase: 'MERGE',
					level: 'WARN',
					message: `Merge failed: ${String(err).slice(0, 200)}`,
					payload: null,
					createdAt: new Date().toISOString(),
				});
				result = tryTransitionWithGates(
					current,
					'DONE',
					`Merge failed: ${String(err).slice(0, 100)}`,
					doneGateCtx,
					'WARN',
					null,
				);
			}
			break;
		}
		case 'GATE_APPROVE': {
			// ── Issue #332: Wire gateApproveAction() into server runtime ──
			// Uses extracted handleGateApprove adapter for testability.
			// Evaluates the Stop/Ask policy and routes the 6 decision outcomes.
			//
			// Safety invariants:
			// - Non-ALLOW never proceeds to COMMIT/MERGE
			// - Exception / missing input → fail closed
			// - Existing Gate 9 / onAudit behavior is not weakened

			try {
				const { handleGateApprove } = await import('./gate-approve-handler.js');
				const { outcome, events } = handleGateApprove(current);

				// Store all events produced by gate evaluation
				for (const ev of events) {
					storeEvent({
						id: createRunId(),
						runId: current.id,
						phase: ev.phase,
						level: ev.level,
						message: ev.message,
						payload: ev.payload,
						createdAt: new Date().toISOString(),
					});
				}

				switch (outcome.kind) {
					case 'TRANSITION':
						result = transition(current, outcome.to, outcome.message, 'GATE', outcome.payload);
						break;

					case 'FAILED_BLOCKED':
						result = markFailed(current, 'FAILED_BLOCKED', outcome.message);
						break;

					case 'STAY':
						storeEvent({
							id: createRunId(),
							runId: current.id,
							phase: 'GATE_APPROVE',
							level: 'HUMAN',
							message: outcome.message,
							payload: { requiredEvidence: outcome.message },
							createdAt: new Date().toISOString(),
						});
						return current;
				}
			} catch (err) {
				// Exception in gate evaluation → fail closed
				const errMsg = err instanceof Error ? err.message : String(err);
				storeEvent({
					id: createRunId(),
					runId: current.id,
					phase: 'GATE_APPROVE',
					level: 'ERROR',
					message: `GATE_APPROVE evaluation failed: ${errMsg}`,
					payload: null,
					createdAt: new Date().toISOString(),
				});
				result = markFailed(
					current,
					'FAILED_BLOCKED',
					`GATE_APPROVE exception: ${errMsg.slice(0, 200)}`,
				);
			}
			break;
		}
		default:
			return current; // terminal
	}

	if (result.ok) {
		storeEvent(result.event);
		return result.run;
	}
	storeEvent(result.event);
	return current;
}

/** Gespeicherte Ziel-Phase für Resume (imported from signals.ts) */
// resumePhaseTarget is defined in ./signals.ts and imported above

async function runFullPipeline(
	run: RunState,
	repository: RepositoryConfig,
	workspace: GitWorkspaceAdapter,
	speckit: SpecKitAdapter,
	opencode: OpenCodeAdapter,
	github: GitHubAdapter,
	syncService?: GitHubStatusSyncService,
	options?: { startFromPhase?: Phase },
): Promise<RunState> {
	let current = run;
	const maxSteps = 20;
	let attempt = 0;

	// Resume-by-State: Phase überspringen bis zur Ziel-Phase (Aufgabe 5)
	if (options?.startFromPhase && options.startFromPhase !== run.phase) {
		const skipEvent = {
			id: createRunId(),
			runId: run.id,
			phase: run.phase,
			level: 'GATE' as EventLevel,
			message: `Resume: skipping to phase ${options.startFromPhase}`,
			payload: { resumeFrom: run.phase, resumeTo: options.startFromPhase },
			createdAt: new Date().toISOString(),
		};
		storeEvent(skipEvent);
		current = {
			...run,
			phase: options.startFromPhase,
			status: 'active',
			lastError: null,
		};
		saveRunToDb(current);
	}
	// Configurable max retries: env var overrides constant (Issue #31)
	const envMaxRetries = process.env.POSITRON_MAX_FIX_LOOPS
		? Number.parseInt(process.env.POSITRON_MAX_FIX_LOOPS, 10)
		: undefined;
	const maxAttempts = envMaxRetries && !Number.isNaN(envMaxRetries) ? envMaxRetries : MAX_FIX_LOOPS;
	const fixLoopEnabled = process.env.POSITRON_ENABLE_FIX_LOOP === 'true';
	let lastRetryTime = 0;

	for (let i = 0; i < maxSteps; i++) {
		// Check control signals before each phase (Issue #30)
		const signalCheck = checkRunSignal(current.id, current.phase);
		if (signalCheck?.toLowerCase() === 'abort') {
			// Unify abort → cancelled (Issue #66) — both cancel endpoint and control/abort now
			// result in 'cancelled' status. Previously this was FAILED_BLOCKED.
			const cancelledRun = {
				...current,
				status: 'cancelled' as RunStatus,
				finishedAt: new Date().toISOString(),
			};
			storeEvent({
				id: createRunId(),
				runId: current.id,
				phase: current.phase,
				level: 'HUMAN' as EventLevel,
				message: 'Run aborted by user',
				payload: { action: 'abort', previousPhase: current.phase },
				createdAt: new Date().toISOString(),
			});
			saveRunToDb(cancelledRun as RunState);
			broadcastSSE(current.id, 'run-cancelled', {
				runId: current.id,
				phase: current.phase,
				status: 'cancelled',
				message: 'Run aborted by user',
			});
			return cancelledRun as RunState;
		}
		if (signalCheck?.toLowerCase() === 'paused') {
			// Wait for resume or abort
			storeEvent({
				id: createRunId(),
				runId: current.id,
				phase: current.phase,
				level: 'GATE' as EventLevel,
				message: 'Run paused by user — waiting for resume or abort',
				payload: null,
				createdAt: new Date().toISOString(),
			});
			broadcastSSE(current.id, 'run-control', { action: 'paused' });
			while (true) {
				await new Promise((r) => setTimeout(r, 500));
				const s = checkRunSignal(current.id, current.phase);
				if (s?.toLowerCase() === 'abort') {
					// Unify abort → cancelled (Issue #66)
					const cancelledRun = {
						...current,
						status: 'cancelled' as RunStatus,
						finishedAt: new Date().toISOString(),
					};
					storeEvent({
						id: createRunId(),
						runId: current.id,
						phase: current.phase,
						level: 'HUMAN' as EventLevel,
						message: 'Run aborted while paused',
						payload: { action: 'abort', previousPhase: current.phase },
						createdAt: new Date().toISOString(),
					});
					saveRunToDb(cancelledRun as RunState);
					// ── Metrics: run cancelled ──
					cancellationsTotal.inc({ cancel_source: 'user' });
					activeRuns.dec();
					broadcastSSE(current.id, 'run-cancelled', {
						runId: current.id,
						phase: current.phase,
						status: 'cancelled',
						message: 'Run aborted while paused',
					});
					return cancelledRun as RunState;
				}
				if (s?.toLowerCase() === 'proceed') {
					storeEvent({
						id: createRunId(),
						runId: current.id,
						phase: current.phase,
						level: 'GATE' as EventLevel,
						message: 'Run resumed by user',
						payload: null,
						createdAt: new Date().toISOString(),
					});
					broadcastSSE(current.id, 'run-control', { action: 'resumed' });
					break;
				}
			}
		}
		if (signalCheck?.toLowerCase() === 'resume') {
			// Resume-by-State (Aufgabe 5): Phase überspringen zur Ziel-Phase
			const targetPhase = getResumePhaseTarget(current.id);
			if (targetPhase) {
				clearRunSignal(current.id, 'RESUME');
				current = {
					...current,
					phase: targetPhase as import('@positron/shared').Phase,
					status: 'active',
					lastError: null,
				};
				saveRunToDb(current);
				storeEvent({
					id: createRunId(),
					runId: current.id,
					phase: current.phase,
					level: 'GATE',
					message: `Resumed to phase: ${targetPhase}`,
					payload: { targetPhase },
					createdAt: new Date().toISOString(),
				});
				broadcastSSE(current.id, 'run-update', {
					phase: current.phase,
					status: current.status,
					branch: current.branch,
				});
				continue;
			}
		}
		if (signalCheck?.toLowerCase() === 'retry') {
			// Manual retry from FAILED_TRANSIENT
			const retryResult = retry(current);
			if (retryResult.ok) {
				storeEvent(retryResult.event);
				saveRunToDb(retryResult.run);
				current = retryResult.run;
				attempt = current.attempt;
				broadcastSSE(current.id, 'run-update', {
					phase: current.phase,
					status: current.status,
					branch: current.branch,
				});
				continue;
			}
		}

		const next = await executePhase(
			current,
			repository,
			workspace,
			speckit,
			opencode,
			github,
			syncService,
		);
		if (next.phase === current.phase || next.phase === 'DONE' || next.phase.startsWith('FAILED')) {
			// --- Fix-Loop (Issue #31 — enhanced) ---
			if (fixLoopEnabled && next.phase === 'FAILED_TRANSIENT' && attempt < maxAttempts) {
				attempt++;

				// Find the original failed phase from event payload (stored by markFailed)
				const allTransient = getEvents(next.id).filter(
					(e: RunEventData) => e.phase === 'FAILED_TRANSIENT',
				);
				const transientEvent = allTransient[allTransient.length - 1];
				const failedPhase = (transientEvent?.payload as Record<string, unknown> | null)
					?.failedPhase as string | undefined;
				const retryFromPhase =
					failedPhase && failedPhase !== 'FAILED_TRANSIENT' ? failedPhase : 'TEST';

				// Exponential backoff: 1s, 2s, 4s, 8s... max 30s
				const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 30000);
				const now = Date.now();
				const timeSinceLastRetry = now - lastRetryTime;
				if (timeSinceLastRetry < backoffMs) {
					await new Promise((r) => setTimeout(r, backoffMs - timeSinceLastRetry));
				}
				lastRetryTime = Date.now();

				storeEvent({
					id: createRunId(),
					runId: next.id,
					phase: retryFromPhase as Phase,
					level: 'WARN',
					message: `Fix-Loop retry ${attempt}/${maxAttempts} — phase: ${retryFromPhase}, backoff: ${backoffMs}ms`,
					payload: { attempt, maxAttempts, retryFromPhase, backoffMs },
					createdAt: new Date().toISOString(),
				});

				// ── Metrics: retry attempt ──
				retriesTotal.inc({ attempt: String(attempt) });

				// Manually set run state (transition validation rejects FAILED_TRANSIENT → *)
				current = {
					...next,
					phase: retryFromPhase as Phase,
					status: 'active',
					attempt,
					lastError: null,
				};
				broadcastSSE(current.id, 'run-update', {
					phase: current.phase,
					status: current.status,
					branch: current.branch,
				});
				continue;
			}

			// Sync terminal state
			if (syncService) {
				const syncInput: GitHubStatusSyncInput = {
					runId: next.id,
					owner: repository.owner,
					repo: repository.repo,
					issueNumber: next.issueNumber,
					phase: next.phase,
					status: next.phase === 'DONE' ? 'done' : 'failed',
					branchName: next.branch ?? undefined,
					evidence: buildEvidence(next),
				};
				if (next.phase === 'DONE') {
					await safeSync(syncService, () => syncService.syncDone(syncInput), next.id, 'DONE');
					// ── Metrics: run completed successfully ──
					const startedMs = next.startedAt ? new Date(next.startedAt).getTime() : Date.now();
					const durationSec = (Date.now() - startedMs) / 1000;
					runsTotal.inc({ status: 'done' });
					runDurationSeconds.observe({ status: 'done' }, durationSec);
					activeRuns.dec();
				} else if (next.phase === 'FAILED_BLOCKED') {
					await safeSync(
						syncService,
						() =>
							syncService.syncBlocked({
								...syncInput,
								error: {
									type: 'blocked',
									message: 'Run blocked: max steps or policy violation',
								},
							}),
						next.id,
						'FAILED_BLOCKED',
					);
					// ── Metrics: run failed (blocked) ──
					runFailuresTotal.inc({ failure_type: 'FAILED_BLOCKED' });
					activeRuns.dec();
				} else if (next.phase.startsWith('FAILED')) {
					await safeSync(
						syncService,
						() =>
							syncService.syncFailed({
								...syncInput,
								error: {
									type: 'failed',
									message: `Run failed in phase ${next.phase}`,
								},
							}),
						next.id,
						next.phase,
					);
					// ── Metrics: run failed ──
					runFailuresTotal.inc({ failure_type: next.phase });
					activeRuns.dec();
				}
			}
			saveRunToDb(next);
			broadcastSSE(next.id, 'run-update', {
				phase: next.phase,
				status: next.status,
				branch: next.branch,
			});
			// Issue #244: Run workspace cleanup on terminal phase
			runCleanup(next)
				.then((cleanupResult) => {
					if (!cleanupResult.cleaned) {
						log.warn(`Workspace cleanup: ${cleanupResult.reason ?? 'unknown'}`, { runId: next.id });
					}
				})
				.catch((err) => {
					log.error(
						`Workspace cleanup error: ${err instanceof Error ? err.message : String(err)}`,
						{ runId: next.id },
					);
				});
			return next;
		}
		current = next;
	}
	// Timeout
	const result = markFailed(current, 'FAILED_BLOCKED', 'Max steps exceeded');
	storeEvent(result.event);
	// Sync timeout
	if (syncService) {
		const syncInput: GitHubStatusSyncInput = {
			runId: result.run.id,
			owner: repository.owner,
			repo: repository.repo,
			issueNumber: result.run.issueNumber,
			phase: 'FAILED_BLOCKED',
			status: 'blocked',
			branchName: result.run.branch ?? undefined,
			error: { type: 'blocked', message: 'Max steps exceeded (timeout)' },
		};
		await safeSync(
			syncService,
			() => syncService.syncBlocked(syncInput),
			result.run.id,
			'FAILED_BLOCKED',
		);
	}
	saveRunToDb(result.run);
	broadcastSSE(result.run.id, 'run-complete', {
		phase: result.run.phase,
		status: result.run.status,
	});
	// Issue #244: Run workspace cleanup on timeout/terminal
	runCleanup(result.run)
		.then((cleanupResult) => {
			if (!cleanupResult.cleaned) {
				log.warn(`Workspace cleanup: ${cleanupResult.reason ?? 'unknown'}`, {
					runId: result.run.id,
				});
			}
		})
		.catch((err) => {
			log.error(`Workspace cleanup error: ${err instanceof Error ? err.message : String(err)}`, {
				runId: result.run.id,
			});
		});
	return result.run;
}

/**
 * Wandelt DB-Zeilen in RunState-Objekte um.
 */
function mapDbRows(rows: Array<Record<string, unknown>>): RunState[] {
	return rows.flatMap((row) => {
		try {
			return [
				{
					id: String(row.id ?? ''),
					repoId: String(row.repo_id ?? ''),
					issueNumber: Number(row.issue_number ?? 0),
					branch: row.branch ? String(row.branch) : null,
					phase: parsePhase(String(row.phase ?? 'QUEUED')),
					status: parseRunStatus(String(row.status ?? 'blocked')),
					autonomyLevel: Number(row.autonomy_level ?? 1),
					attempt: Number(row.attempt ?? 0),
					startedAt: String(row.started_at ?? new Date().toISOString()),
					finishedAt: row.finished_at ? String(row.finished_at) : null,
					lastError: row.last_error ? String(row.last_error) : null,
					workspacePath: row.workspace_path ? String(row.workspace_path) : null,
				} satisfies RunState,
			];
		} catch (err) {
			log.warn(
				`mapDbRows: Ungültiger DB-Eintrag übersprungen (ID: ${String(row.id ?? 'unknown')}): ${err instanceof Error ? err.message : String(err)}`,
			);
			return [];
		}
	});
}

/**
 * Speichert ein Artefakt (Spec, Plan, Tasks, etc.) in der Datenbank.
 */
function saveArtifact(runId: string, kind: string, content: string | string[]): void {
	try {
		const contentStr = Array.isArray(content) ? content.join('\n') : content;
		const artifactId = crypto.randomUUID();
		const createdAt = new Date().toISOString();
		getDb()
			.prepare(`
      INSERT INTO artifacts (id, run_id, kind, content, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content
    `)
			.run(artifactId, runId, kind, contentStr, createdAt);
		// Broadcast evidence creation to SSE clients (Issue #66)
		broadcastSSE(runId, 'run-evidence-created', {
			artifactId,
			kind,
			summary: `${kind} artifact created (${contentStr.length} chars)`,
			createdAt,
		});
	} catch (err) {
		log.error(`saveArtifact failed for ${kind} / run ${runId}`, err);
	}
}

/** Build evidence items from run state for sync comments */
function buildEvidence(run: RunState): EvidenceItem[] {
	const items: EvidenceItem[] = [
		{ kind: 'run-phase', status: 'pass', summary: `Phase: ${run.phase}` },
	];
	if (run.branch)
		items.push({
			kind: 'branch',
			status: 'pass',
			summary: `Branch: ${run.branch}`,
		});
	return items;
}

/**
 * Generiert ein strukturiertes Research-Dokument (research.md) gemäss Blueprint §10/C.
 *
 * Im Fake-Mode: Fetcht das tatsächliche GitHub Issue und liest README.md + docs.
 * Im Real-Mode (POSITRON_RESEARCH_API_KEY gesetzt): Zusätzlich Brave Search API.
 * Fabriziert niemals Funde — alle Inhalte stammen aus echten Quellen.
 */
async function generateResearchDocument(
	github: GitHubAdapter,
	repository: RepositoryConfig,
	issueNumber: number,
): Promise<string> {
	const repoSlug = `${repository.owner}/${repository.repo}`;
	const issueRef = `#${issueNumber}`;
	const now = new Date().toISOString().slice(0, 10);

	// 1. GitHub Issue abrufen
	let issueBody = '';
	let issueTitle = '';
	try {
		const issue = await github.getIssue({
			owner: repository.owner,
			repo: repository.repo,
			issueNumber,
		});
		issueTitle = issue.title ?? '';
		issueBody = issue.body ?? '';
	} catch (err) {
		log.warn(
			`generateResearchDocument: Failed to fetch issue #${issueNumber}: ${String(err).slice(0, 200)}`,
		);
	}

	// 2. README.md und lokale docs lesen
	let readmeContent = '';
	try {
		const readmePath = path.resolve(__serverDirname, '..', '..', '..', '..', 'README.md');
		if (fs.existsSync(readmePath)) {
			readmeContent = fs.readFileSync(readmePath, 'utf-8').slice(0, 5000);
		}
	} catch {
		/* optional */
	}

	// 3. Brave Search API (nur wenn API-Key gesetzt)
	let searchResults = '';
	const researchApiKey = process.env['POSITRON_RESEARCH_API_KEY'];
	if (researchApiKey) {
		try {
			const query = encodeURIComponent(`site:github.com/${repoSlug} issue #${issueNumber}`);
			const response = await fetch(
				`https://api.search.brave.com/res/v1/web/search?q=${query}&count=5`,
				{
					headers: {
						Accept: 'application/json',
						'Accept-Encoding': 'gzip',
						'X-Subscription-Token': researchApiKey,
					},
				},
			);
			if (response.ok) {
				const data = (await response.json()) as Record<string, unknown>;
				const results =
					(
						data as {
							web?: {
								results?: Array<{
									title: string;
									url: string;
									description: string;
								}>;
							};
						}
					).web?.results?.slice(0, 5) ?? [];
				searchResults = results.map((r) => `- [${r.title}](${r.url}): ${r.description}`).join('\n');
			}
		} catch (err) {
			log.warn(`generateResearchDocument: Brave Search failed: ${String(err).slice(0, 200)}`);
		}
	}

	// 4. Dokument zusammensetzen — nur echte Daten, keine Fabrikation
	const lines = [
		`# Research Summary — Issue ${issueRef}${issueTitle ? ': ' + issueTitle : ''}`,
		'',
		`**Repository:** ${repoSlug}`,
		`**Datum:** ${now}`,
		'',
		'---',
		'',
		'## GitHub Issue',
		'',
		issueBody ? issueBody.slice(0, 3000) : '_Issue body could not be fetched._',
		'',
		'## Local Context',
		'',
		readmeContent
			? `### README.md (excerpt)\n\n\`\`\`\n${readmeContent.slice(0, 2000)}\n\`\`\``
			: '_README.md not available._',
		'',
	];

	if (searchResults) {
		lines.push('## Web Search Results (Brave)', '', searchResults, '');
	}

	if (!issueBody && !readmeContent && !searchResults) {
		lines.push(
			'## Note',
			'',
			'_No external data could be fetched. Research is limited to the local workspace._',
			'',
		);
	}

	lines.push(
		'---',
		'',
		'_Research generated by Positron am ' + now + ' für Issue ' + issueRef + '_',
	);

	return lines.join('\n');
}

/** Generate PR body from run evidence (Issue #17) */
function renderPRBody(
	run: RunState,
	repo: RepositoryConfig,
	evidence: EvidenceItem[],
	branch: string,
): string {
	const lines: string[] = [
		'## Positron Automated Changes',
		'',
		`**Run ID:** \`${run.id}\``,
		`**Issue:** #${run.issueNumber}`,
		`**Branch:** \`${branch}\``,
		'',
		'---',
		'',
		'## Evidence',
		'',
	];

	if (evidence.length > 0) {
		lines.push('| Kind | Status | Summary |');
		lines.push('|------|--------|---------|');
		for (const e of evidence) {
			const emoji =
				e.status === 'pass'
					? '✅'
					: e.status === 'fail'
						? '❌'
						: e.status === 'blocked'
							? '🚫'
							: '⏭️';
			lines.push(`| ${e.kind} | ${emoji} ${e.status} | ${e.summary} |`);
		}
	}

	lines.push('');
	lines.push('---');
	lines.push('');
	lines.push(`Closes #${run.issueNumber}`);
	lines.push('');
	lines.push('_Generated by [Positron](https://github.com/xxammaxx/Positron)_');

	return lines.join('\n');
}

/**
 * Generates a dynamic blueprint from a GitHub issue.
 * Fetches the issue body via the GitHub adapter and wraps it in
 * a structured blueprint document never fabricating content.
 */
async function generateBlueprintFromIssue(
	github: GitHubAdapter,
	repository: RepositoryConfig,
	issueNumber: number,
): Promise<string> {
	let issueBody = '';
	let issueTitle = '';
	try {
		const issue = await github.getIssue({
			owner: repository.owner,
			repo: repository.repo,
			issueNumber,
		});
		issueTitle = issue.title ?? `Issue #${issueNumber}`;
		issueBody = (issue.body ?? '').slice(0, 10000);
	} catch (err) {
		log.warn(
			`generateBlueprintFromIssue: Failed to fetch issue #${issueNumber}: ${String(err).slice(0, 200)}`,
		);
	}

	return [
		`# Blueprint: ${issueTitle}`,
		'',
		`**Repository:** ${repository.owner}/${repository.repo}`,
		`**Issue:** #${issueNumber}`,
		`**Generated:** ${new Date().toISOString().slice(0, 10)}`,
		'',
		'---',
		'',
		'## Issue Description',
		'',
		issueBody || '_Issue body could not be fetched. Using default blueprint._',
		'',
		'---',
		'',
		'## Scope',
		'',
		'- Validate end-to-end pipeline execution',
		'- Generate spec, plan, tasks artifacts',
		'- Run tests and produce test report',
		'',
		'_Generated by Positron — all content from GitHub Issue #' + issueNumber + '_',
	].join('\n');
}

// ---------------------------------------------------------------------------
// Input-Validierung
// ---------------------------------------------------------------------------

/**
 * Validiert einen Run-Start-Request-Body.
 * @throws {Error} Wenn der Body ungültig ist.
 * @returns {issueNumber: number, autonomyLevel?: number} Validiertes Objekt.
 */
function validateRunRequest(body: unknown): {
	issueNumber: number;
	autonomyLevel?: number;
} {
	if (!body || typeof body !== 'object') {
		throw new Error('Request body required');
	}
	const raw = body as Record<string, unknown>;

	// issueNumber: positive Ganzzahl 1-999999
	if (raw.issueNumber === undefined || raw.issueNumber === null) {
		throw new Error('issueNumber is required and must be a positive integer (1-999999)');
	}
	const issueNumber = Number(raw.issueNumber);
	if (!Number.isInteger(issueNumber) || issueNumber < 1 || issueNumber > 999999) {
		throw new Error('issueNumber must be a positive integer (1-999999)');
	}

	// autonomyLevel: optional, 0-4
	let autonomyLevel: number | undefined;
	if (raw.autonomyLevel !== undefined && raw.autonomyLevel !== null) {
		autonomyLevel = Number(raw.autonomyLevel);
		if (!Number.isInteger(autonomyLevel) || autonomyLevel < 0 || autonomyLevel > 4) {
			throw new Error('autonomyLevel must be an integer between 0 and 4');
		}
	}

	return { issueNumber, autonomyLevel };
}

/**
 * Validiert einen POST /api/repos Request-Body.
 * @throws {Error} Wenn der Body ungültig ist.
 */
function validateRepoRegistration(body: unknown): {
	owner: string;
	name: string;
} {
	if (!body || typeof body !== 'object') {
		throw new Error('Request body required');
	}
	const raw = body as Record<string, unknown>;

	const owner = String(raw.owner ?? '').trim();
	const name = String(raw.name ?? '').trim();

	if (!owner || owner.length > 39 || !/^[a-zA-Z0-9-]+$/.test(owner)) {
		throw new Error(
			'owner must be a non-empty GitHub username (max 39 chars, alphanumeric + hyphens)',
		);
	}
	if (!name || name.length > 100 || !/^[a-zA-Z0-9._-]+$/.test(name)) {
		throw new Error('name must be a non-empty repo name (max 100 chars, alphanumeric + . _ -)');
	}

	return { owner, name };
}

// ---------------------------------------------------------------------------
// Secret Manager (centralized secret resolution)
// ---------------------------------------------------------------------------

/** Globaler SecretManager: env → docker secrets → .env file */
const secretManager = new SecretManager({
	envFilePath: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'),
});

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

export function createApp(options: ServerOptions = {}) {
	// SQLite-Datenbank initialisieren
	db = openDatabase(options.dbPath);
	initSignalsDb(getDb());
	const repository = resolveRepositoryConfig(options.repository);
	const { adapter: github, mode: githubMode } = resolveAdapter(options.adapter);
	const activeWorkspaceAdapter = options.workspaceAdapter ?? workspaceAdapter;
	const activeSpecKitAdapter = resolveSpecKitAdapter(options.speckitAdapter);
	const activeOpenCodeAdapter = resolveOpenCodeAdapter(options.opencodeAdapter);
	const syncService = new GitHubStatusSyncService(github);

	// ── Issue #385: Gate runtime mode — explicit, mode-aware assembly ──
	// Replaces unconditional registerFakeGateEvaluators().
	// fixture/demo: fake evaluators registered.
	// supervised/real: no fake evaluators — real evaluators must be registered
	// or gate evaluation will block (fail-closed).
	gateRuntimeMode = resolveGateRuntimeMode({
		githubMode: githubMode,
		workspaceMode: activeWorkspaceAdapter instanceof FakeGitWorkspaceAdapter ? 'fake' : 'real',
		opencodeMode: activeOpenCodeAdapter instanceof FakeOpenCodeAdapter ? 'fake' : 'real',
	});
	assembleGateEvaluators(gateRuntimeMode);
	log.info(`Gate runtime mode: ${gateRuntimeMode}`);

	// ── Issue #322: Wire ToolGateway onAudit into server runtime ──
	// Creates a GatewayService with audit sink for audit-required tool calls.
	// The onAudit callback writes pre-execution audit entries to a local
	// JSONL file. Audit failures are fail-closed via Gate 9.
	const toolRegistry = new ToolRegistry();
	const gateway = new GatewayService(toolRegistry, { enabled: true });
	gateway.onAudit = createAuditSink({
		runId: 'server-runtime',
		source: 'server',
	});

	// ── QA-011: Metrics-decorated OpenCode adapter ──
	// Wraps the adapter to record telemetry without modifying adapter code.
	const instrumentedOpenCodeAdapter = createInstrumentedOpenCodeAdapter(activeOpenCodeAdapter);
	const app = express();

	// ── QA-012: Queue Stats Collector (non-blocking, periodic) ─────────────────
	//
	// Periodically collects BullMQ queue statistics and updates Prometheus gauges.
	// Runs on an interval so /metrics doesn't hang when Redis is unavailable.
	//
	// The metrics exist REGARDLESS of Redis availability — they report 0
	// when the queue is unreachable, so dashboards always show a valid value.

	async function collectQueueStats(): Promise<void> {
		// QA-016: When POSITRON_ALERT_WORKER_DOWN_ENABLED is explicitly "false",
		// suppress the WorkerDown alert by reporting worker as UP regardless
		// of actual worker presence. Useful for dev/test environments without
		// a running worker process. In production, this should remain "true".
		const workerDownAlertEnabled = process.env.POSITRON_ALERT_WORKER_DOWN_ENABLED !== 'false';
		try {
			const { Queue } = await import('bullmq');
			const { PIPELINE_QUEUE, resolveRedisUrl } = await import('@positron/shared');
			const pipelineQueue = new Queue(PIPELINE_QUEUE, {
				connection: {
					url: resolveRedisUrl(),
					connectTimeout: 500,
					maxRetriesPerRequest: null as unknown as number,
					retryStrategy: () => null,
				},
			});

			try {
				const counts = await pipelineQueue.getJobCounts(
					'waiting',
					'active',
					'completed',
					'failed',
					'delayed',
				);
				queueJobsWaiting.set({ queue: 'positron-pipeline' }, counts.waiting ?? 0);
				queueJobsActive.set({ queue: 'positron-pipeline' }, counts.active ?? 0);
				queueJobsCompletedTotal.inc({ queue: 'positron-pipeline' }, 0);
				queueJobsFailedTotal.inc({ queue: 'positron-pipeline' }, 0);

				const workers = await pipelineQueue.getWorkers();
				queueWorkerUp.set(
					{ queue: 'positron-pipeline' },
					// QA-016: Suppress WorkerDown in dev mode
					workerDownAlertEnabled ? (workers.length > 0 ? 1 : 0) : 1,
				);
				queueRedisUp.set(1);
			} catch {
				queueRedisUp.set(0);
				queueWorkerUp.set({ queue: 'positron-pipeline' }, 0);
				queueJobsActive.set({ queue: 'positron-pipeline' }, 0);
				queueJobsWaiting.set({ queue: 'positron-pipeline' }, 0);
			} finally {
				await pipelineQueue.close().catch(() => {});
			}
		} catch {
			queueRedisUp.set(0);
			queueWorkerUp.set({ queue: 'positron-pipeline' }, 0);
		}
	}

	// Start periodic queue stats collection (every 30 seconds)
	const queueStatsInterval = setInterval(collectQueueStats, 30_000);
	queueStatsInterval.unref();
	app.use(express.json());

	// GitHub Watcher starten (nur wenn POSITRON_ENABLE_WATCHER=true)
	stopWatcher = startWatcher({
		github,
		repository,
		db: getDb(),
		onRunCreated: (runId, issueNumber) => {
			log.info(`Watcher created run ${runId} for issue #${issueNumber}`);
		},
	});

	// CORS — production-sicher, dev-kompatibel
	// In Fake-Mode: Allow-Origin: * (lokale Dev-Server)
	// In Real-Mode: Allow-Origin aus POSITRON_CORS_ORIGIN (Default: http://localhost:5173)
	const corsOrigin =
		process.env['POSITRON_CORS_ORIGIN'] ?? (githubMode === 'fake' ? '*' : 'http://localhost:5173');
	app.use((_req, res, next) => {
		res.header('Access-Control-Allow-Origin', corsOrigin);
		res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
		res.header('Access-Control-Allow-Headers', 'Content-Type');
		if (_req.method === 'OPTIONS') {
			res.sendStatus(204);
			return;
		}
		next();
	});

	// Security headers (Issue #93) — nur in production
	if (process.env.NODE_ENV !== 'development') {
		app.use((_req, res, next) => {
			res.header('X-Content-Type-Options', 'nosniff');
			res.header('X-Frame-Options', 'DENY');
			res.header('X-XSS-Protection', '1; mode=block');
			res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
			res.header(
				'Content-Security-Policy',
				"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://api.github.com; img-src 'self' data:",
			);
			next();
		});
	}

	// Rate limiting (Issue #93) — simple sliding window per IP
	const rateLimitMap = new Map<string, number[]>();
	const RATE_LIMIT_MAX = 100;
	const RATE_LIMIT_WINDOW = 60_000;
	// Periodic cleanup of stale IP entries every 5 minutes
	const rateLimitCleanup = setInterval(() => {
		const cutoff = Date.now() - RATE_LIMIT_WINDOW;
		for (const [ip, timestamps] of rateLimitMap) {
			const filtered = timestamps.filter((t) => t > cutoff);
			if (filtered.length === 0) rateLimitMap.delete(ip);
			else rateLimitMap.set(ip, filtered);
		}
	}, 300_000);
	rateLimitCleanup.unref();
	app.use((req, res, next) => {
		// QA-031: Bypass rate limiting in test environment (E2E tests trigger 100+ requests)
		if (process.env.VITEST === 'true') {
			next();
			return;
		}
		// Exempt SSE streams (per-run and dashboard) from rate limiting
		if (req.path === '/api/stream' || req.path.endsWith('/events/stream')) {
			next();
			return;
		}
		const ip = req.ip ?? 'unknown';
		const now = Date.now();
		const window = rateLimitMap.get(ip) ?? [];
		while (window.length > 0 && (window[0] ?? 0) < now - RATE_LIMIT_WINDOW) window.shift();
		if (window.length >= RATE_LIMIT_MAX) {
			res.status(429).json({ error: 'Too many requests', retryAfter: 60 });
			return;
		}
		window.push(now);
		rateLimitMap.set(ip, window);
		next();
	});

	// -----------------------------------------------------------------------
	// Admin Auth Middleware (RED_HOLD remediation: centralized, fail-closed)
	// -----------------------------------------------------------------------
	const ADMIN_TOKEN = secretManager.getSecret('POSITRON_ADMIN_TOKEN') ?? undefined;
	// RED_HOLD remediation: No default token. Admin endpoints are fail-closed
	// if POSITRON_ADMIN_TOKEN is not explicitly set by the operator.
	const requireAdmin = (
		req: import('express').Request,
		res: import('express').Response,
		next: import('express').NextFunction,
	) => {
		// Support both Authorization: Bearer <token> and X-Admin-Token header
		const authHeader = req.headers['authorization'] as string | undefined;
		const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
		const legacyToken = req.headers['x-admin-token'] as string | undefined;
		const token = bearerToken ?? legacyToken;

		if (!ADMIN_TOKEN) {
			res.status(503).json({
				error: 'Admin API disabled: set POSITRON_ADMIN_TOKEN in production',
			});
			return;
		}
		if (!token || token !== ADMIN_TOKEN) {
			res.status(401).json({
				error:
					'Invalid admin token. Provide Authorization: Bearer <token> or X-Admin-Token header.',
			});
			return;
		}
		next();
	};

	// Repository registrieren (write endpoint — requires admin auth)
	app.post('/api/repos', requireAdmin, (req, res) => {
		try {
			validateRepoRegistration(req.body ?? {});
			const repoId = `${repository.owner}/${repository.repo}`;
			// In DB speichern falls noch nicht vorhanden
			const existing = getDb().prepare('SELECT id FROM repositories WHERE id = ?').get(repoId) as
				| { id: string }
				| undefined;
			if (!existing) {
				getDb()
					.prepare(`
          INSERT OR IGNORE INTO repositories (id, owner, name, url, default_branch, enabled)
          VALUES (?, ?, ?, ?, ?, 1)
        `)
					.run(
						repoId,
						repository.owner,
						repository.repo,
						`https://github.com/${repository.owner}/${repository.repo}`,
						repository.defaultBranch,
					);
			}
			res.json({ id: repoId, status: 'registered', mode: githubMode });
		} catch (err) {
			res.status(400).json({
				error: 'VALIDATION_ERROR',
				message: err instanceof Error ? err.message : 'Invalid request',
			});
		}
	});

	// Repository-Liste abrufen
	app.get('/api/repos', (_req, res) => {
		try {
			const repos = getDb()
				.prepare(`
        SELECT id, owner, name, url, local_path as localPath, default_branch as defaultBranch, enabled, created_at as createdAt
        FROM repositories
        ORDER BY created_at DESC
      `)
				.all();
			res.json({ repos, total: (repos as Array<unknown>).length });
		} catch (err) {
			res.status(500).json({ error: 'Datenbankfehler', details: String(err) });
		}
	});

	// Managed Target Projects Registry (generisch, nicht projekt-spezifisch)
	app.get('/api/projects', (_req, res) => {
		try {
			const projects = getManagedTargetProjects();
			res.json({ projects, total: projects.length });
		} catch (err) {
			res.status(500).json({ error: 'Registry-Fehler', details: String(err) });
		}
	});

	// Issues abrufen (echt via Adapter)
	app.get('/api/repos/:id/issues', async (req, _res, next) => {
		try {
			const issues = await github.listOpenIssues(repository.owner, repository.repo);
			_res.json({ issues });
		} catch (err) {
			next(err);
		}
	});

	// GET /api/repos/:owner/:repo/issues/:issueNumber/blueprint — Dynamic Blueprint
	app.get('/api/repos/:owner/:repo/issues/:issueNumber/blueprint', async (req, res) => {
		try {
			const issueNumber = Number.parseInt(req.params.issueNumber, 10);
			if (Number.isNaN(issueNumber) || issueNumber < 1) {
				res.status(400).json({ error: 'issueNumber must be a positive integer' });
				return;
			}
			const repo = {
				owner: req.params.owner,
				repo: req.params.repo,
				defaultBranch: 'main',
			};
			const blueprint = await generateBlueprintFromIssue(github, repo, issueNumber);
			res.json({
				blueprint,
				issueNumber,
				repo: `${repo.owner}/${repo.repo}`,
			});
		} catch (err) {
			res.status(500).json({
				error: 'Failed to generate blueprint',
				details: String(err),
			});
		}
	});

	// POST /api/runs — Start a run from a GitHub issue URL (write endpoint — requires admin auth)
	app.post('/api/runs', requireAdmin, async (req, res) => {
		try {
			const { issueUrl } = (req.body as { issueUrl?: string }) ?? {};
			if (!issueUrl || typeof issueUrl !== 'string') {
				res.status(400).json({ error: 'issueUrl (string) is required' });
				return;
			}

			// Parse GitHub URL: https://github.com/owner/repo/issues/123
			const match = issueUrl.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
			if (!match) {
				res.status(400).json({
					error:
						'Invalid GitHub issue URL. Expected format: https://github.com/owner/repo/issues/123',
				});
				return;
			}
			const [, owner, repo, issueNumberStr] = match;
			const issueNumber = Number.parseInt(issueNumberStr!, 10);

			// Find or create repository
			const repoId = `${owner}/${repo}`;
			const existing = getDb().prepare('SELECT id FROM repositories WHERE id = ?').get(repoId) as
				| { id: string }
				| undefined;
			if (!existing) {
				getDb()
					.prepare(`
          INSERT OR IGNORE INTO repositories (id, owner, name, url, default_branch, enabled)
          VALUES (?, ?, ?, ?, ?, 1)
        `)
					.run(repoId, owner, repo, `https://github.com/${owner}/${repo}`, 'main');
			}

			// Create run and attempt to enqueue to BullMQ (inline fallback if Redis unavailable)
			const { autonomyLevel } = req.body as { autonomyLevel?: number };
			const run = createRun(repo!, issueNumber, autonomyLevel ?? 2);
			saveRunToDb(run);

			let queued = false;
			let pipelineQueue: import('bullmq').Queue | null = null;
			try {
				const { Queue } = await import('bullmq');
				const { PIPELINE_QUEUE, resolveRedisUrl } = await import('@positron/shared');

				const redisUrl = resolveRedisUrl();
				pipelineQueue = new Queue(PIPELINE_QUEUE, {
					connection: {
						url: redisUrl,
						connectTimeout: 500,
						retryStrategy: () => null,
					},
				});

				// Check if at least one worker is listening before enqueuing.
				// If no workers are available, the run would never execute — fall back to inline.
				const workers = await pipelineQueue.getWorkers();
				if (workers.length === 0) {
					throw new Error('NO_WORKERS');
				}

				// Use run.id as deterministic jobId to prevent double-execution on retry
				const job = await pipelineQueue.add(
					'pipeline',
					{
						runId: run.id,
						repoId: repository.repo,
						issueNumber: issueNumber ?? run.issueNumber,
						autonomyLevel: autonomyLevel ?? run.autonomyLevel ?? 2,
					},
					{ jobId: run.id },
				);
				queued = true;

				res.json({ run, runId: run.id, jobId: job.id, message: 'Run queued' });
			} catch (_queueErr: unknown) {
				if (!queued) {
					// Queue completely unavailable — fall back to inline execution
					res.json({
						run,
						runId: run.id,
						message: 'Run started (inline)',
						repoId,
					});
					runFullPipeline(
						run,
						repository,
						activeWorkspaceAdapter,
						activeSpecKitAdapter,
						instrumentedOpenCodeAdapter,
						github,
						syncService,
					)
						.then((finalRun) => {
							saveRunToDb(finalRun);
							broadcastSSE(finalRun.id, 'run-update', {
								phase: finalRun.phase,
								status: finalRun.status,
								branch: finalRun.branch,
							});
						})
						.catch((err) => {
							storeEvent({
								id: createRunId(),
								runId: run.id,
								phase: 'FAILED_BLOCKED',
								level: 'ERROR',
								message: `Run failed: ${String(err).slice(0, 200)}`,
								payload: null,
								createdAt: new Date().toISOString(),
							});
						});
				}
				// If close() threw but job was queued, the job is still in Redis — no fallback needed
			} finally {
				await pipelineQueue?.close().catch(() => {});
			}
		} catch (err) {
			res.status(400).json({
				error: 'VALIDATION_ERROR',
				message: err instanceof Error ? err.message : 'Invalid request',
			});
		}
	});

	// Run starten (write endpoint — requires admin auth)
	app.post('/api/repos/:repoId/runs', requireAdmin, async (req, res) => {
		try {
			const { issueNumber, autonomyLevel } = validateRunRequest(req.body);
			const run = createRun(repository.repo, issueNumber, autonomyLevel ?? 2);
			saveRunToDb(run); // Sofort persistieren — sichtbar noch während Pipeline läuft
			runsTotal.inc({ status: 'active' });
			activeRuns.inc();

			// QA-029: POSITRON_DISABLE_QUEUE=true forces inline execution for tests
			// even when Redis and workers are available.
			const disableQueue = process.env.POSITRON_DISABLE_QUEUE === 'true';

			let queued = false;
			let pipelineQueue: import('bullmq').Queue | null = null;
			if (!disableQueue) {
				try {
					const { Queue } = await import('bullmq');
					const { PIPELINE_QUEUE, resolveRedisUrl } = await import('@positron/shared');

					const redisUrl = resolveRedisUrl();
					pipelineQueue = new Queue(PIPELINE_QUEUE, {
						connection: {
							url: redisUrl,
							connectTimeout: 500,
							retryStrategy: () => null,
						},
					});

					// Check if at least one worker is listening before enqueuing.
					// If no workers are available, the run would never execute — fall back to inline.
					const workers = await pipelineQueue.getWorkers();
					if (workers.length === 0) {
						throw new Error('NO_WORKERS');
					}

					// Use run.id as deterministic jobId to prevent double-execution on retry
					const job = await pipelineQueue.add(
						'pipeline',
						{
							runId: run.id,
							repoId: repository.repo,
							issueNumber,
							autonomyLevel: autonomyLevel ?? 2,
						},
						{ jobId: run.id },
					);
					queued = true;

					res.json({
						run,
						runId: run.id,
						jobId: job.id,
						message: 'Run queued',
					});
				} catch (_queueErr: unknown) {
					if (!queued) {
						// Queue completely unavailable — fall back to inline execution
						const completed = await runFullPipeline(
							run,
							repository,
							activeWorkspaceAdapter,
							activeSpecKitAdapter,
							instrumentedOpenCodeAdapter,
							github,
							syncService,
						);
						const evts = getEvents(completed.id);
						res.json({
							run: completed,
							runId: completed.id,
							events: evts,
							eventCount: evts.length,
						});
					}
					// If close() threw but job was queued, the job is still in Redis — no fallback needed
				} finally {
					await pipelineQueue?.close().catch(() => {});
				}
			}

			// If queue is disabled, run inline directly
			if (disableQueue) {
				const completed = await runFullPipeline(
					run,
					repository,
					activeWorkspaceAdapter,
					activeSpecKitAdapter,
					instrumentedOpenCodeAdapter,
					github,
					syncService,
				);
				const evts = getEvents(completed.id);
				res.json({
					run: completed,
					runId: completed.id,
					events: evts,
					eventCount: evts.length,
				});
			}
		} catch (err) {
			res.status(400).json({
				error: 'VALIDATION_ERROR',
				message: err instanceof Error ? err.message : 'Invalid request',
			});
		}
	});

	// Runs auflisten (mit Pagination)
	app.get('/api/runs', (req, res) => {
		try {
			const page = Math.max(1, Number.parseInt(req.query.page as string) || 1);
			const limit = Math.min(100, Number.parseInt(req.query.limit as string) || 20);
			const repoId = req.query.repoId as string | undefined;
			const offset = (page - 1) * limit;

			const database = getDb();

			if (repoId) {
				const runs = database
					.prepare(`
          SELECT * FROM runs WHERE repo_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?
        `)
					.all(repoId, limit, offset);
				const total = (
					database.prepare('SELECT COUNT(*) as c FROM runs WHERE repo_id = ?').get(repoId) as {
						c: number;
					}
				).c;
				res.json({
					runs: mapDbRows(runs as Array<Record<string, unknown>>),
					pagination: { page, limit, total, pages: Math.ceil(total / limit) },
					total,
				});
			} else {
				const runs = database
					.prepare(`
          SELECT * FROM runs ORDER BY started_at DESC LIMIT ? OFFSET ?
        `)
					.all(limit, offset);
				const total = (
					database.prepare('SELECT COUNT(*) as c FROM runs').get() as {
						c: number;
					}
				).c;
				res.json({
					runs: mapDbRows(runs as Array<Record<string, unknown>>),
					pagination: { page, limit, total, pages: Math.ceil(total / limit) },
					total,
				});
			}
		} catch (err) {
			res.status(500).json({ error: 'Datenbankfehler', details: String(err) });
		}
	});

	// Run-Details
	app.get('/api/runs/:id', (req, res) => {
		const run = loadRunFromDb(req.params.id);
		if (!run) {
			res.status(404).json({ error: 'Not found' });
			return;
		}
		res.json({ run, events: getEvents(run.id) });
	});

	// Test Report — aggregated test data from run_events (phase='TEST')
	// Required by Operator Cockpit (Issue #68)
	app.get('/api/runs/:id/test-report', (req, res) => {
		const run = loadRunFromDb(req.params.id);
		if (!run) {
			res.status(404).json({ error: 'Not found' });
			return;
		}
		try {
			const database = getDb();
			const rows = database
				.prepare(
					"SELECT id, run_id, phase, level, message, payload_json, created_at FROM run_events WHERE run_id = ? AND phase = 'TEST' ORDER BY created_at ASC",
				)
				.all(req.params.id) as Array<{
				id: string;
				run_id: string;
				phase: string;
				level: string;
				message: string;
				payload_json: string;
				created_at: string;
			}>;
			const testEvents = rows.map((row) => ({
				id: row.id,
				runId: row.run_id,
				level: row.level as EventLevel,
				message: row.message,
				payload: safeJsonParse(row.payload_json),
				createdAt: row.created_at,
			}));
			const passed = testEvents.filter((e) => e.level === 'INFO').length;
			const warnings = testEvents.filter((e) => e.level === 'WARN').length;
			const errors = testEvents.filter((e) => e.level === 'ERROR').length;
			res.json({
				runId: req.params.id,
				summary: {
					total: testEvents.length,
					passed,
					failed: errors,
					errors,
					warnings,
				},
				testEvents,
			});
		} catch (err) {
			res.status(500).json({ error: 'Database error', details: String(err) });
		}
	});

	// SSE Event Stream (Issue #29)
	app.get('/api/runs/:id/events/stream', (req, res) => {
		const runId = req.params.id;
		const run = loadRunFromDb(runId);
		if (!run) {
			res.status(404).json({ error: 'Not found' });
			return;
		}

		// SSE headers
		res.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no',
		});

		// Check for W3C Last-Event-ID reconnection support (Issue #66)
		const lastEventId = req.headers['last-event-id'];
		const lastSeq = lastEventId ? Number.parseInt(String(lastEventId), 10) : 0;

		// Get all events and filter by Last-Event-ID if reconnecting
		const allEvents = getEvents(runId);
		const resendFromIdx = lastSeq > 0 ? allEvents.findIndex((_, i) => i + 1 > lastSeq) : 0;
		const resendEvents = resendFromIdx > 0 ? allEvents.slice(resendFromIdx) : allEvents;

		// Send initial state with sequence numbers (Issue #66)
		const eventsWithSequence = allEvents.map((e, idx) => ({
			...e,
			_sequence: idx + 1,
		}));
		const initialState = {
			run,
			events: resendFromIdx > 0 ? eventsWithSequence.slice(resendFromIdx) : eventsWithSequence,
			reconnected: lastSeq > 0,
		};
		res.write(`id: ${allEvents.length}\nevent: initial\ndata: ${JSON.stringify(initialState)}\n\n`);

		// Prime sequence counter to continue from existing events
		primeEventSequence(runId, allEvents.length);

		// Register for live updates
		addSSEClient(runId, res);

		// Keep alive — emit as comment for browsers that support it
		const keepAlive = setInterval(() => {
			try {
				// Send heartbeat as an SSE event so it also gets header-based keepalive
				broadcastSSE(runId, 'heartbeat', {
					timestamp: new Date().toISOString(),
					type: 'keepalive',
				});
				// Also emit raw comment for compatibility
				res.write(':keepalive\n\n');
			} catch {
				clearInterval(keepAlive);
			}
		}, 15000);

		// Cleanup on disconnect
		req.on('close', () => {
			clearInterval(keepAlive);
			removeSSEClient(runId, res);
		});
	});

	// Dashboard SSE — global stream for dashboard real-time updates (Issue #84)
	const dashboardClients = new Set<import('express').Response>();
	app.get('/api/stream', (req, res) => {
		res.writeHead(200, {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no',
		});

		dashboardClients.add(res);

		// Send initial metrics
		const initial = {
			metrics: getDashboardMetrics(),
			runs: listRunsFromDb().slice(0, 50),
			evidence: getDashboardEvidence(),
		};
		res.write(`event: initial\ndata: ${JSON.stringify(initial)}\n\n`);

		// Periodic metrics push (every 10s)
		const pushInterval = setInterval(() => {
			try {
				const metrics = getDashboardMetrics();
				const runs = listRunsFromDb().slice(0, 20);
				res.write(
					`event: dashboard-update\ndata: ${JSON.stringify({ metrics, runs, evidence: getDashboardEvidence() })}\n\n`,
				);
			} catch {
				clearInterval(pushInterval);
			}
		}, 10_000);

		// Keep alive
		const kaInterval = setInterval(() => {
			try {
				res.write(':keepalive\n\n');
			} catch {
				clearInterval(kaInterval);
			}
		}, 15_000);

		req.on('close', () => {
			clearInterval(pushInterval);
			clearInterval(kaInterval);
			dashboardClients.delete(res);
		});
	});

	// Health (Issue #22 + HealthIndicator)
	app.get('/api/health', async (_req, res) => {
		try {
			const healthWsPath = process.env['POSITRON_WORKSPACE_ROOT'] ?? '/tmp';
			const speckitHealth = await activeSpecKitAdapter.healthCheck(healthWsPath);
			const opencodeHealth = await instrumentedOpenCodeAdapter.healthCheck(healthWsPath);
			const isFakeMode = githubMode === 'fake';
			// In Fake-Mode gelten nicht-verfügbare Adapter nicht als "degraded"
			const adapters = {
				github: !isFakeMode,
				specKit: speckitHealth.available,
				openCode: opencodeHealth.available,
			};
			const allOk = isFakeMode || Object.values(adapters).every(Boolean);
			res.json({
				status: allOk ? 'ok' : 'degraded',
				adapters,
				uptime: Math.floor((Date.now() - serverStartTime) / 1000),
				runs: countRunsInDb(),
				mode: isFakeMode ? 'fake' : 'real',
			});
		} catch (err) {
			res.json({
				status: 'error',
				adapters: { github: false, specKit: false, openCode: false },
				uptime: Math.floor((Date.now() - serverStartTime) / 1000),
				runs: countRunsInDb(),
				error: String(err),
			});
		}
	});

	// Prometheus Metrics Endpoint (QA-010, QA-011, QA-012)
	app.get('/metrics', async (_req, res) => {
		try {
			// Update gauges before rendering
			serverUptimeSeconds.set((Date.now() - serverStartTime) / 1000);
			const activeCount = (
				getDb().prepare("SELECT COUNT(*) as c FROM runs WHERE status = 'active'").get() as {
					c: number;
				}
			).c;
			activeRuns.set(activeCount);

			const { contentType, body } = await renderMetrics();
			const { body: queueBody } = await renderQueueMetrics();
			res.set('Content-Type', contentType);
			res.status(200).send(body + '\n' + queueBody);
		} catch (err) {
			res.status(500).json({ error: 'Failed to render metrics', details: String(err) });
		}
	});

	// Adapter Health Status (Issue #22) — separate legacy endpoint
	app.get('/api/adapters/health', async (_req, res) => {
		try {
			const healthWsPath = process.env['POSITRON_WORKSPACE_ROOT'] ?? '/tmp';
			const speckitHealth = await activeSpecKitAdapter.healthCheck(healthWsPath);
			const opencodeHealth = await instrumentedOpenCodeAdapter.healthCheck(healthWsPath);
			res.json({
				github: { available: githubMode !== 'fake', mode: githubMode },
				specKit: speckitHealth,
				openCode: opencodeHealth,
			});
		} catch (err) {
			res.json({ error: String(err) });
		}
	});

	// --- Blueprint Demo Endpoint (Issue #56) — write endpoint, requires admin auth
	app.post('/api/demo/blueprint', requireAdmin, async (req, res) => {
		const { blueprint, issueNumber } = req.body;
		if (!blueprint || typeof blueprint !== 'string') {
			res.status(400).json({ error: 'blueprint (string) is required' });
			return;
		}
		// issueNumber optional — auf positive Ganzzahl prüfen
		let issueNum = Number.parseInt(process.env.POSITRON_DEFAULT_ISSUE_NUMBER ?? '56', 10);
		if (issueNumber !== undefined && issueNumber !== null) {
			const parsed = Number(issueNumber);
			if (!Number.isInteger(parsed) || parsed < 1 || parsed > 999999) {
				res.status(400).json({ error: 'issueNumber must be a positive integer (1-999999)' });
				return;
			}
			issueNum = parsed;
		}
		const run = createRun(repository.repo, issueNum, 2);
		saveRunToDb(run);

		// Store blueprint as initial event
		storeEvent({
			id: createRunId(),
			runId: run.id,
			phase: 'QUEUED',
			level: 'HUMAN',
			message: `Blueprint submitted for Issue #${issueNum}`,
			payload: { blueprint, issueNumber: issueNum, source: 'demo-blueprint' },
			createdAt: new Date().toISOString(),
		});

		// Run pipeline asynchronously — response immediately with run ID
		res.json({ run, message: 'Blueprint run started', blueprint });
		runFullPipeline(
			run,
			repository,
			activeWorkspaceAdapter,
			activeSpecKitAdapter,
			instrumentedOpenCodeAdapter,
			github,
			syncService,
		)
			.then((finalRun) => {
				saveRunToDb(finalRun);
				broadcastSSE(finalRun.id, 'run-update', {
					phase: finalRun.phase,
					status: finalRun.status,
					branch: finalRun.branch,
				});
			})
			.catch((err) => {
				storeEvent({
					id: createRunId(),
					runId: run.id,
					phase: 'FAILED_BLOCKED',
					level: 'ERROR',
					message: `Blueprint run failed: ${String(err).slice(0, 200)}`,
					payload: null,
					createdAt: new Date().toISOString(),
				});
			});
	});

	// Demo Runs — create a demo run (write endpoint, requires admin auth)
	app.post('/api/demo-runs', requireAdmin, async (req, res) => {
		const { blueprint, issueNumber } =
			(req.body as { blueprint?: string; issueNumber?: number }) ?? {};
		let issueNum = Number.parseInt(process.env.POSITRON_DEFAULT_ISSUE_NUMBER ?? '56', 10);
		if (issueNumber !== undefined && issueNumber !== null) {
			const parsed = Number(issueNumber);
			if (!Number.isInteger(parsed) || parsed < 1 || parsed > 999999) {
				res.status(400).json({ error: 'issueNumber must be a positive integer (1-999999)' });
				return;
			}
			issueNum = parsed;
		}
		const run = createRun(repository.repo, issueNum, 2);
		saveRunToDb(run);
		const usedBlueprint =
			typeof blueprint === 'string'
				? blueprint
				: await generateBlueprintFromIssue(github, repository, issueNum);
		storeEvent({
			id: createRunId(),
			runId: run.id,
			phase: 'QUEUED',
			level: 'HUMAN',
			message: `Demo run created for Issue #${issueNum}`,
			payload: {
				blueprint: usedBlueprint,
				issueNumber: issueNum,
				source: 'demo-runs',
			},
			createdAt: new Date().toISOString(),
		});
		res.json({ run, message: 'Demo run started', blueprint: usedBlueprint });
		// Pipeline asynchron — Response sofort gesendet
		runFullPipeline(
			run,
			repository,
			activeWorkspaceAdapter,
			activeSpecKitAdapter,
			instrumentedOpenCodeAdapter,
			github,
			syncService,
		)
			.then((finalRun) => {
				saveRunToDb(finalRun);
				broadcastSSE(finalRun.id, 'run-update', {
					phase: finalRun.phase,
					status: finalRun.status,
					branch: finalRun.branch,
				});
			})
			.catch((err) => {
				storeEvent({
					id: createRunId(),
					runId: run.id,
					phase: 'FAILED_BLOCKED',
					level: 'ERROR',
					message: `Demo run failed: ${String(err).slice(0, 200)}`,
					payload: null,
					createdAt: new Date().toISOString(),
				});
			});
	});

	// GET blueprint for a run
	app.get('/api/demo/blueprint/:runId', (req, res) => {
		const evts = getEvents(req.params.runId);
		const blueprintEvent = evts.find(
			(e) =>
				e.payload &&
				typeof e.payload === 'object' &&
				'blueprint' in (e.payload as Record<string, unknown>),
		);
		if (!blueprintEvent) {
			res.status(404).json({ error: 'No blueprint found for this run' });
			return;
		}
		res.json({
			blueprint: (blueprintEvent.payload as Record<string, unknown>).blueprint,
			runId: req.params.runId,
		});
	});

	// Demo Live Run — Visual validation seed (Issue #66) — write endpoint, requires admin auth
	app.post(
		'/api/demo/live-run',
		requireAdmin,
		createDemoLiveRunHandler({
			createRun,
			saveRunToDb,
			storeEvent,
			saveArtifact,
			broadcastSSE,
			createRunId,
			repository: {
				...repository,
				id: `${repository.owner}/${repository.repo}`,
			},
			runPipeline: (run: RunState) =>
				runFullPipeline(
					run,
					repository,
					activeWorkspaceAdapter,
					activeSpecKitAdapter,
					instrumentedOpenCodeAdapter,
					github,
					syncService,
				),
			addSSEClient,
			removeSSEClient,
			getEvents,
		}),
	);

	// Safety State (Issue #28)
	// Whitelist of allowed safety keys
	const SAFETY_KEYS = [
		'enableMerge',
		'mergeDryRun',
		'enablePush',
		'killSwitch',
		'enableFixLoop',
	] as const;
	const ENV_KEY_MAP: Record<string, string> = {
		enableMerge: 'POSITRON_ENABLE_MERGE',
		mergeDryRun: 'POSITRON_MERGE_DRY_RUN',
		enablePush: 'POSITRON_ENABLE_PUSH',
		killSwitch: 'POSITRON_MERGE_KILL_SWITCH',
		enableFixLoop: 'POSITRON_ENABLE_FIX_LOOP',
	};

	function getSafetyState(): Record<string, boolean> {
		const result: Record<string, boolean> = {
			enableMerge: process.env.POSITRON_ENABLE_MERGE === 'true',
			mergeDryRun: process.env.POSITRON_MERGE_DRY_RUN === 'true',
			enablePush: process.env.POSITRON_ENABLE_PUSH === 'true',
			killSwitch: process.env.POSITRON_MERGE_KILL_SWITCH !== 'false',
			enableFixLoop: process.env.POSITRON_ENABLE_FIX_LOOP === 'true',
		};
		// Merge DB overrides
		try {
			const rows = getDb()
				.prepare('SELECT key, value FROM settings WHERE key LIKE ?')
				.all('safety.%') as Array<{ key: string; value: string }>;
			for (const row of rows) {
				const safetyKey = row.key.replace('safety.', '');
				if (safetyKey in result) {
					(result as Record<string, unknown>)[safetyKey] = row.value === 'true';
				}
			}
		} catch {
			/* table may not exist yet */
		}
		return result;
	}

	app.get('/api/safety', (_req, res) => {
		res.json(getSafetyState());
	});

	app.post('/api/safety', requireAdmin, (req, res) => {
		try {
			// Admin token already validated by requireAdmin middleware

			const { key, value } = (req.body as { key?: string; value?: boolean }) ?? {};
			if (!key || typeof key !== 'string') {
				res.status(400).json({ error: 'key (string) is required' });
				return;
			}
			if (typeof value !== 'boolean') {
				res.status(400).json({ error: 'value (boolean) is required' });
				return;
			}
			if (!(SAFETY_KEYS as readonly string[]).includes(key)) {
				res.status(400).json({ error: `Invalid key. Allowed: ${SAFETY_KEYS.join(', ')}` });
				return;
			}

			// Store in settings table
			const dbKey = `safety.${key}`;
			getDb()
				.prepare(`
        INSERT OR REPLACE INTO settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
      `)
				.run(dbKey, String(value));

			res.json({ ok: true, key, value, all: getSafetyState() });
		} catch (err) {
			res.status(500).json({
				error: 'Failed to update safety setting',
				details: String(err),
			});
		}
	});

	// Merge Status (Issue #22)
	app.get('/api/runs/:id/merge-status', (_req, res) => {
		const run = loadRunFromDb(_req.params.id);
		if (!run) {
			res.status(404).json({ error: 'Not found' });
			return;
		}

		const mergeAllowed = process.env.POSITRON_ENABLE_MERGE === 'true';
		const mergeKillSwitch = process.env.POSITRON_MERGE_KILL_SWITCH !== 'false';
		const mergeDryRun = process.env.POSITRON_MERGE_DRY_RUN === 'true';
		const testEvent = getEvents(run.id).find((e) => e.phase === 'TEST' && e.level === 'INFO');

		res.json({
			enabled: mergeAllowed,
			killSwitch: mergeKillSwitch,
			dryRun: mergeDryRun,
			runStatus: run.status,
			hasTestEvidence: !!testEvent,
			branch: run.branch,
			canMerge:
				mergeAllowed && !mergeKillSwitch && run.status === 'active' && !!testEvent && !!run.branch,
			blockedReasons: [
				!mergeAllowed && 'POSITRON_ENABLE_MERGE not set',
				mergeKillSwitch && 'Kill-Switch active',
				run.status !== 'active' && `Run status is ${run.status}`,
				!testEvent && 'No passing test evidence',
				!run.branch && 'No branch',
			].filter(Boolean),
		});
	});

	// Gate-Entscheidung (approve / revise) — write endpoint, requires admin auth
	app.post('/api/runs/:id/gate', requireAdmin, express.json(), async (req, res) => {
		const { id } = req.params as { id: string };
		// Unterstützt beide Namenskonventionen: decision (Backend) und action (Frontend)
		const bodyDecision = req.body.decision ?? req.body.action;
		const { reason } = req.body as {
			reason?: string;
		};
		const decision: 'approve' | 'revise' = bodyDecision;

		if (!['approve', 'revise'].includes(decision)) {
			return res.status(400).json({ error: 'decision muss approve oder revise sein' });
		}

		const run = loadRunFromDb(id);
		if (!run) return res.status(404).json({ error: 'Run nicht gefunden' });

		const action = decision === 'approve' ? 'resume' : 'retry';

		try {
			storeEvent({
				id: createRunId(),
				runId: id,
				phase: run.phase,
				level: 'GATE',
				message: `Gate-Entscheidung: ${decision}${reason ? ` — ${reason}` : ''}`,
				payload: { decision, reason: reason ?? '' },
				createdAt: new Date().toISOString(),
			});

			if (decision === 'approve') {
				// Run zum nächsten Schritt fortsetzen
				const targetPhase: Phase = run.phase === 'GATE_APPROVE' ? 'COMMIT' : 'MERGE';
				const updatedRun = {
					...run,
					phase: targetPhase,
					status: 'active' as RunStatus,
					lastError: null,
				};
				saveRunToDb(updatedRun);
				setRunSignal(id, 'RESUME', targetPhase);
			} else {
				// Zurück zur vorherigen Phase (revise)
				// ── Metrics: gate revision ──
				gateRevisionsTotal.inc({ phase: run.phase });
				const targetPhase: Phase = 'REVIEW';
				const updatedRun = {
					...run,
					phase: targetPhase,
					status: 'active' as RunStatus,
					lastError: null,
				};
				saveRunToDb(updatedRun);
				setRunSignal(id, 'RETRY');
			}

			res.json({ ok: true, action });
		} catch (err) {
			res.status(500).json({ error: String(err) });
		}
	});

	// Artefakt laden (Spec, Plan, Tasks, Review, Test-Results)
	app.get('/api/runs/:id/artifacts/:kind', (req, res) => {
		const { id, kind } = req.params;

		const VALID_KINDS = [
			'spec',
			'plan',
			'tasks',
			'review',
			'test-results',
			'diff',
			'implementation',
		];
		if (!VALID_KINDS.includes(kind)) {
			return res.status(400).json({
				error: `Ungültiger Artefakt-Typ. Erlaubt: ${VALID_KINDS.join(', ')}`,
			});
		}

		try {
			const artifact = getDb()
				.prepare(`
        SELECT id, run_id, kind, content, created_at
        FROM artifacts
        WHERE run_id = ? AND kind = ?
        ORDER BY created_at DESC
        LIMIT 1
      `)
				.get(id, kind) as Record<string, unknown> | undefined;

			if (!artifact) {
				return res.status(404).json({
					error: `Kein Artefakt vom Typ '${kind}' für Run '${id}' gefunden`,
				});
			}

			res.json({
				artifact: {
					content: artifact.content,
					kind: artifact.kind,
					createdAt: artifact.created_at,
				},
			});
		} catch (err) {
			res.status(500).json({ error: 'Datenbankfehler', details: String(err) });
		}
	});

	// System-Metriken
	app.get('/api/metrics', (_req, res) => {
		try {
			const database = getDb();
			const total = (
				database.prepare('SELECT COUNT(*) as c FROM runs').get() as {
					c: number;
				}
			).c;
			const active = (
				database.prepare("SELECT COUNT(*) as c FROM runs WHERE status = 'active'").get() as {
					c: number;
				}
			).c;
			const done = (
				database.prepare("SELECT COUNT(*) as c FROM runs WHERE status = 'done'").get() as {
					c: number;
				}
			).c;
			const failed = (
				database.prepare("SELECT COUNT(*) as c FROM runs WHERE status = 'failed'").get() as {
					c: number;
				}
			).c;
			const blocked = (
				database.prepare("SELECT COUNT(*) as c FROM runs WHERE status = 'blocked'").get() as {
					c: number;
				}
			).c;
			const repositories = (
				database.prepare('SELECT COUNT(*) as c FROM repositories').get() as {
					c: number;
				}
			).c;

			const phaseDistribution = database
				.prepare(`
        SELECT phase, COUNT(*) as count
        FROM runs WHERE status = 'active'
        GROUP BY phase ORDER BY count DESC
      `)
				.all();

			const recentFailures = database
				.prepare(`
        SELECT id, phase, started_at as startedAt, finished_at as finishedAt
        FROM runs WHERE status = 'failed' OR status = 'blocked'
        ORDER BY finished_at DESC LIMIT 5
      `)
				.all();

			const avgRow = database
				.prepare(`
        SELECT AVG(
          CAST(strftime('%s', finished_at) AS INTEGER) -
          CAST(strftime('%s', started_at) AS INTEGER)
        ) * 1000 as avg_ms
        FROM runs WHERE status = 'done'
      `)
				.get() as { avg_ms: number | null } | undefined;

			res.json({
				metrics: {
					runs: { total, active, done, failed, blocked },
					repositories: { total: repositories },
					phaseDistribution,
					recentFailures,
					avgRunDurationMs: avgRow?.avg_ms ?? null,
					timestamp: new Date().toISOString(),
				},
			});
		} catch (err) {
			res.status(500).json({
				error: 'Metriken konnten nicht geladen werden',
				details: String(err),
			});
		}
	});

	// -----------------------------------------------------------------------
	// Evidence API — Aggregated evidence across runs (Issue #65, #85)
	// -----------------------------------------------------------------------

	// POST evidence — Agent writes artifacts (write endpoint, requires admin auth)
	app.post('/api/evidence', requireAdmin, (req, res) => {
		try {
			const { runId, kind, content } = req.body as {
				runId?: string;
				kind?: string;
				content?: string;
			};
			if (!runId || !kind || !content) {
				res.status(400).json({ error: 'runId, kind, and content are required' });
				return;
			}
			const run = loadRunFromDb(runId);
			if (!run) {
				res.status(404).json({ error: 'Run not found' });
				return;
			}

			const db = getDb();
			const createdAt = new Date().toISOString();
			db.prepare(
				'INSERT INTO artifacts (run_id, kind, content, created_at) VALUES (?, ?, ?, ?)',
			).run(runId, kind, content, createdAt);

			// Broadcast SSE to dashboard + per-run clients
			broadcastSSE(runId, 'run-evidence-created', {
				runId,
				kind,
				summary: `${kind} (${content.length} chars)`,
				createdAt,
			});

			res.status(201).json({ success: true, kind, createdAt });
		} catch (err) {
			res.status(500).json({ error: 'Failed to save evidence', details: String(err) });
		}
	});

	app.get('/api/evidence', (req, res) => {
		try {
			const database = getDb();
			const runId = req.query.runId as string | undefined;

			if (runId) {
				// Evidence for a single run
				const run = loadRunFromDb(runId);
				if (!run) {
					res.status(404).json({ error: 'Run not found' });
					return;
				}

				const artifacts = database
					.prepare(
						'SELECT kind, content, created_at as createdAt FROM artifacts WHERE run_id = ? ORDER BY created_at DESC',
					)
					.all(runId) as Array<{
					kind: string;
					content: string;
					createdAt: string;
				}>;

				const events = getEvents(runId).filter(
					(e) =>
						e.level === 'ERROR' || e.level === 'WARN' || e.phase === 'TEST' || e.phase === 'MERGE',
				);

				const evidenceItems: Array<{
					id: string;
					type: string;
					kind: string;
					source: string;
					sourceId: string;
					status: string;
					summary: string;
					timestamp: string;
					runPhase: string;
				}> = artifacts.map((a) => ({
					id: `artifact-${a.kind}-${runId.slice(0, 8)}`,
					type: 'artifact' as const,
					kind: a.kind,
					source: 'run',
					sourceId: runId,
					status: 'pass' as const,
					summary: `${a.kind} (${a.content.length} chars)`,
					timestamp: a.createdAt,
					runPhase: run.phase,
				}));

				// Add test results as evidence
				const testEvents = events.filter((e) => e.phase === 'TEST');
				for (const e of testEvents) {
					evidenceItems.push({
						id: `test-${e.id.slice(0, 8)}`,
						type: 'test-result' as const,
						kind: 'test',
						source: 'test-run',
						sourceId: runId,
						status: e.level === 'INFO' ? ('pass' as const) : ('fail' as const),
						summary: e.message,
						timestamp: e.createdAt,
						runPhase: e.phase,
					});
				}

				res.json({
					evidence: evidenceItems,
					total: evidenceItems.length,
					runId,
				});
			} else {
				// Aggregated evidence across all runs
				const artifactCounts = database
					.prepare(`
          SELECT kind, COUNT(*) as count FROM artifacts GROUP BY kind
        `)
					.all() as Array<{ kind: string; count: number }>;

				const testEvents = database
					.prepare(`
          SELECT COUNT(*) as testCount FROM run_events WHERE phase = 'TEST'
        `)
					.get() as { testCount: number };

				const errorEvents = database
					.prepare(`
          SELECT COUNT(*) as errorCount FROM run_events WHERE level = 'ERROR'
        `)
					.get() as { errorCount: number };

				const warnEvents = database
					.prepare(`
          SELECT COUNT(*) as warnCount FROM run_events WHERE level = 'WARN'
        `)
					.get() as { warnCount: number };

				res.json({
					summary: {
						totalArtifacts: artifactCounts.reduce((sum, a) => sum + a.count, 0),
						artifactBreakdown: Object.fromEntries(artifactCounts.map((a) => [a.kind, a.count])),
						testEvents: testEvents?.testCount ?? 0,
						errorEvents: errorEvents?.errorCount ?? 0,
						warningEvents: warnEvents?.warnCount ?? 0,
					},
				});
			}
		} catch (err) {
			res.status(500).json({
				error: 'Evidence konnte nicht geladen werden',
				details: String(err),
			});
		}
	});

	// -----------------------------------------------------------------------
	// Settings API — MCP Configuration + Test Modes (Issue #65)
	// -----------------------------------------------------------------------

	// MCP Configuration (masked — no secrets exposed)
	app.get('/api/settings/mcp', (_req, res) => {
		try {
			const configPath = path.resolve('.opencode', 'config.json');
			let mcpConfig = null;
			let securityPolicy = null;
			let artifactPolicy = null;

			if (fs.existsSync(configPath)) {
				const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
				mcpConfig = raw.mcpServers ?? {};
				securityPolicy = raw.mcpSecurityPolicy ?? {};
				artifactPolicy = raw.mcpArtifactPolicy ?? {};
			}

			// Build masked MCP server list (no env vars, no tokens)
			const servers = Object.entries(mcpConfig ?? {}).map(([name, cfg]: [string, unknown]) => {
				const serverCfg = cfg as Record<string, unknown>;
				return {
					name,
					command: serverCfg.command ?? 'unknown',
					description: serverCfg.description ?? '',
					disabled: serverCfg.disabled === true,
					// NEVER expose env values — only show keys
					envKeys: serverCfg.env ? Object.keys(serverCfg.env as Record<string, unknown>) : [],
					hasToken: serverCfg.env
						? Object.values(serverCfg.env as Record<string, unknown>).some(
								(v: unknown) => typeof v === 'string' && (v as string).includes('${'),
							)
						: false,
				};
			});

			// Security policy (read-only display)
			const policy = {
				leastPrivilege: securityPolicy?.leastPrivilege ?? false,
				readOnlyFirst: securityPolicy?.readOnlyFirst ?? false,
				humanInTheLoop: securityPolicy?.humanInTheLoop ?? false,
				secretProtection: securityPolicy?.secretProtection ?? false,
				environmentSeparation: securityPolicy?.environmentSeparation ?? false,
				allowedWriteActions: securityPolicy?.allowedWriteActions ?? [],
				deniedActions: securityPolicy?.deniedActions ?? [],
				pathRestrictions: securityPolicy?.pathRestrictions ?? {},
			};

			// Redaction patterns (never show raw patterns — just count)
			const redactPatternCount = artifactPolicy?.redactPatterns?.length ?? 0;

			res.json({
				servers,
				policy,
				redactPatternCount,
				configured: servers.filter((s) => !s.disabled).length,
				totalServers: servers.length,
			});
		} catch (err) {
			res.status(500).json({ error: 'Settings could not be loaded', details: String(err) });
		}
	});

	// Available Test Modes (Source of Truth: package.json scripts — live gelesen)
	app.get('/api/settings/test-modes', (_req, res) => {
		try {
			// Beschreibungen für bekannte Test-Modi (wird mit package.json-Scripts gemerged)
			const modeDescriptions: Record<
				string,
				{ label: string; visible: boolean; description: string }
			> = {
				test: {
					label: 'Unit Tests',
					visible: true,
					description: 'Vitest unit + integration tests',
				},
				'test:e2e': {
					label: 'E2E (headless)',
					visible: false,
					description: 'Playwright E2E tests, headless',
				},
				'test:e2e:headed': {
					label: 'E2E (headed)',
					visible: true,
					description: 'Playwright with visible browser',
				},
				'test:e2e:slow': {
					label: 'E2E (slow)',
					visible: true,
					description: 'Headed + 1000ms slow motion',
				},
				'test:e2e:observe': {
					label: 'E2E (observe)',
					visible: true,
					description: 'Browser stays open for human review',
				},
				'test:e2e:ui': {
					label: 'Playwright UI Mode',
					visible: true,
					description: 'Interactive Playwright UI',
				},
				'test:e2e:debug': {
					label: 'E2E (debug)',
					visible: true,
					description: 'Debug mode with PWDEBUG',
				},
				'test:e2e:diag': {
					label: 'Diagnostic',
					visible: true,
					description: 'Visible diagnostic test',
				},
				'test:orchestrator': {
					label: 'Orchestrator',
					visible: false,
					description: 'Full orchestrated test suite',
				},
				'test:orchestrator:smoke': {
					label: 'Orchestrator (smoke)',
					visible: false,
					description: 'Orchestrated smoke tests',
				},
				'test:orchestrator:headed': {
					label: 'Orchestrator (headed)',
					visible: true,
					description: 'Orchestrated headed tests',
				},
				'test:orchestrator:slow': {
					label: 'Orchestrator (slow)',
					visible: true,
					description: 'Orchestrated slow tests',
				},
				'test:orchestrator:contract': {
					label: 'Contract Tests',
					visible: true,
					description: 'API contract validation',
				},
				'test:orchestrator:regression': {
					label: 'Regression',
					visible: true,
					description: 'Visual regression tests',
				},
				'demo:live': {
					label: 'Live Demo',
					visible: true,
					description: 'Live demo with visible browser',
				},
				'demo:open': {
					label: 'Open Demo',
					visible: true,
					description: 'Open demo in browser',
				},
				'verify:issues': {
					label: 'Verify Issues',
					visible: false,
					description: 'Verify all GitHub issues against code',
				},
			};

			// Lese Scripts aus package.json als Source of Truth für commands
			const pkgJsonPath = path.resolve(__serverDirname, '..', '..', '..', '..', 'package.json');
			let scripts: Record<string, string> = {};
			try {
				scripts = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8')).scripts ?? {};
			} catch {
				log.warn('Konnte package.json nicht lesen — verwende Default-Scripts');
			}

			// Bekannte Test-Script-Präfixe
			const testPrefixes = ['test:', 'demo:', 'verify:'];
			const modes = Object.entries(modeDescriptions)
				.filter(([id]) => testPrefixes.some((p) => id.startsWith(p)))
				.map(([id, desc]) => ({
					id,
					label: desc.label,
					command: scripts[id] ? `npm run ${id}` : `npm run ${id}`,
					visible: desc.visible,
					description: desc.description,
				}));

			// Security status for each mode
			const securityNotes = {
				headed: 'Browser ist sichtbar — kein Produktionsmodus. Sicher für lokale Entwicklung.',
				slow: 'Verlangsamte Ausführung für menschliche Beobachtung.',
				observe: 'Browser bleibt nach Test offen. Nur lokal verwenden.',
				debug: 'Debug-Modus mit PWDEBUG. Nur lokal verwenden.',
				headless: 'Headless-Modus — geeignet für CI/CD.',
			};

			res.json({
				modes,
				securityNotes,
				defaultMode: 'test:e2e',
				observationMode: 'test:e2e:observe',
				totalModes: modes.length,
			});
		} catch (err) {
			res.status(500).json({
				error: 'Test modes could not be loaded',
				details: String(err),
			});
		}
	});

	// Run Control (Issue #30) — write endpoint, requires admin auth
	app.post('/api/runs/:id/control', requireAdmin, (req, res) => {
		const runId = req.params.id as string;
		const run = loadRunFromDb(runId);
		if (!run) {
			res.status(404).json({ error: 'Run not found' });
			return;
		}

		const { action } = req.body as { action: string };
		const validActions = ['pause', 'abort', 'resume', 'retry'];
		if (!validActions.includes(action)) {
			res.status(400).json({
				error: `Invalid action. Must be one of: ${validActions.join(', ')}`,
			});
			return;
		}

		// Validate action based on run state
		const isTerminalPhase = run.phase === 'DONE' || run.phase.startsWith('FAILED');
		if (action === 'pause' && (isTerminalPhase || run.status === 'cancelled')) {
			res.status(409).json({ error: 'Cannot pause a completed/failed/cancelled run' });
			return;
		}
		if (action === 'resume') {
			// Resume-by-State (Aufgabe 5): Von der letzten abgeschlossenen Phase fortsetzen
			const isPaused = checkRunSignal(runId) === 'PAUSE';
			const isFailed = run.phase === 'FAILED_BLOCKED' || run.phase === 'FAILED_TRANSIENT';

			if (!isPaused && !isFailed) {
				res.status(409).json({ error: 'Run is not paused or failed — cannot resume' });
				return;
			}

			// Events aus DB laden und nächste Phase berechnen
			const events = getEvents(runId);
			const resumeState = resumeFromEvents(run.id, run.repoId, run.issueNumber, events);

			// Nächste Phase bestimmen (nach der letzten abgeschlossenen)
			const ALL_PHASES_LIST: readonly Phase[] = [
				'QUEUED',
				'CLAIMED',
				'REPO_SYNC',
				'ISSUE_CONTEXT',
				'WEB_RESEARCH',
				'SPECIFY',
				'CLARIFY_OPTIONAL',
				'PLAN',
				'TASKS',
				'ANALYZE',
				'REVIEW',
				'IMPLEMENT',
				'TEST',
				'VERIFY',
				'COMMIT',
				'PR_CREATE',
				'MERGE',
				'DONE',
				'FAILED',
				'FAILED_TRANSIENT',
				'FAILED_BLOCKED',
				'FAILED_UNSAFE',
				'BLOCKED_PUSH',
				'BLOCKED_MERGE',
				'GATE_APPROVE',
				'GATE_REVISE',
				'RESUME_PENDING',
				'CLEANUP',
			];
			const lastIdx = ALL_PHASES_LIST.indexOf(resumeState.phase);
			const nextPhase: Phase =
				lastIdx >= 0 && lastIdx < ALL_PHASES_LIST.length - 1
					? (ALL_PHASES_LIST[lastIdx + 1] as Phase)
					: 'TEST';

			// Ziel-Phase speichern und Signal setzen
			setRunSignal(runId, 'RESUME', nextPhase);

			storeEvent({
				id: createRunId(),
				runId,
				phase: run.phase,
				level: 'HUMAN',
				message: `Run resume: continuing from phase ${nextPhase}`,
				payload: { action, resumeFromPhase: nextPhase },
				createdAt: new Date().toISOString(),
			});

			broadcastSSE(runId, 'run-control', {
				action: 'resume',
				resumeFromPhase: nextPhase,
			});

			res.json({ ok: true, action, runId, resumeFromPhase: nextPhase });
			return;
		}
		if (action === 'retry' && run.phase !== 'FAILED_TRANSIENT') {
			res.status(409).json({ error: 'Can only retry a FAILED_TRANSIENT run' });
			return;
		}
		if (action === 'retry' && run.attempt >= MAX_FIX_LOOPS) {
			res.status(409).json({ error: `Max retries (${MAX_FIX_LOOPS}) reached` });
			return;
		}

		// For abort: unify with cancel endpoint — update DB + store event + broadcast (Issue #66)
		if (action === 'abort') {
			if (run.status === 'cancelled') {
				res.json({
					ok: true,
					runId,
					message: 'Run already cancelled',
					status: 'cancelled',
				});
				return;
			}
			if (run.status !== 'active' && run.status !== 'blocked') {
				res.status(409).json({
					error: `Cannot abort run with status "${run.status}". Only active or blocked runs can be aborted.`,
				});
				return;
			}

			// Atomic DB update
			const database = getDb();
			const updateResult = database
				.prepare(`
          UPDATE runs SET status = 'cancelled', finished_at = datetime('now')
          WHERE id = ? AND status IN ('active', 'blocked')
        `)
				.run(runId);

			if (updateResult.changes === 0) {
				res.status(409).json({
					error: 'Run state changed before abort could complete',
					runId,
				});
				return;
			}

			// Set ABORT signal for pipeline loop
			setRunSignal(runId, 'ABORT');

			// Store cancel event
			storeEvent({
				id: createRunId(),
				runId,
				phase: run.phase,
				level: 'HUMAN',
				message: `Run control: abort requested by user from phase: ${run.phase}`,
				payload: { action, previousStatus: run.status },
				createdAt: new Date().toISOString(),
			});

			broadcastSSE(runId, 'run-cancelled', {
				runId,
				phase: run.phase,
				status: 'cancelled',
				message: 'Run aborted by user',
			});

			res.json({ ok: true, action, runId, status: 'cancelled' });
			return;
		}

		// Set signal for non-abort actions
		const signal = action.toUpperCase() as 'PAUSE' | 'RETRY';
		setRunSignal(runId, signal);

		// Log event (abort already logged its own event above)
		storeEvent({
			id: createRunId(),
			runId,
			phase: run.phase,
			level: 'HUMAN',
			message: `Run control: ${action} requested by user`,
			payload: { action },
			createdAt: new Date().toISOString(),
		});

		broadcastSSE(runId, 'run-control', { action });

		res.json({ ok: true, action, runId });
	});

	// -----------------------------------------------------------------------
	// Cancel Endpoint — Safe run cancellation (Issue #66) — write endpoint, requires admin auth
	app.post(
		'/api/runs/:id/cancel',
		requireAdmin,
		createCancelHandler({
			loadRunFromDb,
			getDb,
			setRunSignal,
			storeEvent,
			broadcastSSE,
			createRunId,
		}),
	);

	// -----------------------------------------------------------------------
	// Admin API (Issue #87)
	// Admin auth is handled by the global requireAdmin middleware defined above.
	// Routes under /api/admin use the same requireAdmin middleware.
	// -----------------------------------------------------------------------

	app.use('/api/admin', requireAdmin);

	app.get('/api/admin/stats', (_req, res) => {
		try {
			const db = getDb();
			const totalRuns = (db.prepare('SELECT COUNT(*) as c FROM runs').get() as { c: number }).c;
			const activeRuns = (
				db.prepare("SELECT COUNT(*) as c FROM runs WHERE status = 'active'").get() as { c: number }
			).c;
			const failedRuns = (
				db
					.prepare("SELECT COUNT(*) as c FROM runs WHERE status = 'failed' OR status = 'blocked'")
					.get() as { c: number }
			).c;
			const doneRuns = (
				db.prepare("SELECT COUNT(*) as c FROM runs WHERE status = 'done'").get() as { c: number }
			).c;
			const totalRepos = (
				db.prepare('SELECT COUNT(*) as c FROM repositories').get() as {
					c: number;
				}
			).c;
			const totalEvents = (
				db.prepare('SELECT COUNT(*) as c FROM run_events').get() as {
					c: number;
				}
			).c;
			const totalArtifacts = (
				db.prepare('SELECT COUNT(*) as c FROM artifacts').get() as { c: number }
			).c;
			const dbSizeBytes = fs.existsSync(options.dbPath ?? resolveDatabasePath())
				? fs.statSync(options.dbPath ?? resolveDatabasePath()).size
				: 0;

			res.json({
				runs: {
					total: totalRuns,
					active: activeRuns,
					failed: failedRuns,
					done: doneRuns,
				},
				repositories: totalRepos,
				events: totalEvents,
				artifacts: totalArtifacts,
				dbSizeMb: Math.round((dbSizeBytes / 1024 / 1024) * 100) / 100,
			});
		} catch (err) {
			res.status(500).json({ error: String(err) });
		}
	});

	app.post('/api/admin/runs/bulk-cancel', (_req, res) => {
		try {
			const db = getDb();
			const result = db
				.prepare(
					"UPDATE runs SET status = 'cancelled', finished_at = datetime('now') WHERE status IN ('active', 'blocked')",
				)
				.run();
			res.json({ cancelled: (result as { changes: number }).changes });
		} catch (err) {
			res.status(500).json({ error: String(err) });
		}
	});

	app.post('/api/admin/runs/bulk-retry', (_req, res) => {
		try {
			const db = getDb();
			const result = db
				.prepare(
					"UPDATE runs SET status = 'active', phase = 'QUEUED' WHERE status IN ('failed', 'blocked')",
				)
				.run();
			res.json({ retried: (result as { changes: number }).changes });
		} catch (err) {
			res.status(500).json({ error: String(err) });
		}
	});

	app.post('/api/admin/runs/cleanup', (_req, res) => {
		try {
			const db = getDb();
			db.prepare("DELETE FROM run_events WHERE created_at < datetime('now', '-7 days')").run();
			const eventsDeleted = (db.prepare('SELECT changes() as c').get() as { c: number }).c;
			db.exec('VACUUM');
			const dbSizeBytes = fs.existsSync(options.dbPath ?? resolveDatabasePath())
				? fs.statSync(options.dbPath ?? resolveDatabasePath()).size
				: 0;
			res.json({
				eventsDeleted,
				dbSizeMb: Math.round((dbSizeBytes / 1024 / 1024) * 100) / 100,
			});
		} catch (err) {
			res.status(500).json({ error: String(err) });
		}
	});

	// Webhook notifications (Issue #92) — write endpoint, requires admin auth
	app.post('/api/webhook/test', requireAdmin, async (req, res) => {
		const webhookUrl = process.env.POSITRON_WEBHOOK_URL;
		if (!webhookUrl) {
			res.status(400).json({ error: 'POSITRON_WEBHOOK_URL not configured' });
			return;
		}
		try {
			const response = await fetch(webhookUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					text: `Positron notification: ${req.body?.message ?? 'Test notification'}`,
					timestamp: new Date().toISOString(),
					runId: req.body?.runId ?? null,
				}),
			});
			res.json({ sent: response.ok, status: response.status });
		} catch (err) {
			res.status(500).json({ error: String(err) });
		}
	});

	// ── R5: Startup Recovery — discover and resume incomplete runs after controller restart ──
	// After a controlled crash (fault injection), the server restarts and must
	// automatically discover incomplete runs, reconcile with GitHub, adopt existing
	// PRs, and resume the original run — without manual intervention.
	async function recoverIncompleteRunsOnStartup(): Promise<void> {
		const database = getDb();
		const rows = database
			.prepare(
				`SELECT id FROM runs
				 WHERE status = 'active'
				   AND phase NOT IN ('DONE', 'FAILED_BLOCKED', 'FAILED')
				   AND finished_at IS NULL
				 ORDER BY started_at ASC`,
			)
			.all() as Array<{ id: string }>;

		if (rows.length === 0) return;

		log.info(
			`R5 Recovery: Discovered ${rows.length} incomplete run(s) on startup — resuming automatically`,
		);

		for (const { id } of rows) {
			const run = loadRunFromDb(id);
			if (!run) {
				log.warn(`R5 Recovery: Run ${id} not found in DB — skipping`);
				continue;
			}

			log.info(
				`R5 Recovery: Resuming run ${run.id} (repo=${run.repoId}, issue=${run.issueNumber}, phase=${run.phase})`,
			);

			// Fire-and-forget: resume each incomplete run asynchronously
			runFullPipeline(
				run,
				repository,
				activeWorkspaceAdapter,
				activeSpecKitAdapter,
				instrumentedOpenCodeAdapter,
				github,
				syncService,
				{ startFromPhase: run.phase },
			)
				.then((finalRun) => {
					saveRunToDb(finalRun);
					log.info(
						`R5 Recovery: Run ${finalRun.id} resumed and completed — phase=${finalRun.phase}, status=${finalRun.status}`,
					);
					broadcastSSE(finalRun.id, 'run-update', {
						phase: finalRun.phase,
						status: finalRun.status,
						branch: finalRun.branch,
					});
				})
				.catch((err) => {
					log.error(`R5 Recovery: Run ${run.id} failed during resume`, err);
					storeEvent({
						id: createRunId(),
						runId: run.id,
						phase: run.phase,
						level: 'ERROR',
						message: `Startup recovery failed: ${String(err).slice(0, 200)}`,
						payload: null,
						createdAt: new Date().toISOString(),
					});
				});
		}
	}

	// Schedule recovery shortly after server start (non-blocking)
	setTimeout(() => {
		recoverIncompleteRunsOnStartup().catch((err) => {
			log.error('R5 Recovery: Startup recovery failed', err);
		});
	}, 3000);

	return app;
}

export { runFullPipeline };

export function createServer(options: ServerOptions = {}) {
	const app = createApp(options);
	const server = http.createServer(app);

	// Watcher beim Server-Close automatisch stoppen
	const originalClose = server.close.bind(server);
	server.close = (callback?: (err?: Error) => void) => {
		if (stopWatcher) {
			stopWatcher();
			stopWatcher = null;
		}
		return originalClose(callback);
	};

	// Graceful shutdown on SIGTERM
	const gracefulShutdown = () => {
		log.info('SIGTERM received, shutting down...');
		server.close(() => {
			log.info('HTTP server closed');
			process.exit(0);
		});
		// Force exit after 10s
		setTimeout(() => {
			log.error('Forced shutdown after timeout');
			process.exit(1);
		}, 10000);
	};
	process.on('SIGTERM', gracefulShutdown);

	return server;
}

// Auto-start when run directly (platform-independent path check)
const isDirectRun =
	process.argv[1] &&
	(process.argv[1].endsWith(`${path.sep}dist${path.sep}index.js`) ||
		process.argv[1].includes(`${path.sep}dist${path.sep}index.js`) ||
		process.argv[1].endsWith(`${path.sep}src${path.sep}index.ts`) ||
		process.argv[1].includes(`${path.sep}src${path.sep}index.ts`));
if (isDirectRun) {
	const port = Number.parseInt(process.env['PORT'] ?? '3000', 10);
	const server = createServer();
	server.listen(port, () => {
		const ghMode = process.env['POSITRON_GITHUB_MODE'] ?? process.env['GITHUB_MODE'] ?? 'fake';
		log.info(`Server listening on http://localhost:${port}, mode=${ghMode}`);
	});

	// Graceful Shutdown
	function shutdown(): void {
		log.info('Shutting down...');
		if (stopWatcher) {
			stopWatcher();
			stopWatcher = null;
		}
		server.close(() => {
			log.info('Server stopped');
			process.exit(0);
		});
		// Force exit after 5s
		setTimeout(() => process.exit(1), 5000);
	}
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}
