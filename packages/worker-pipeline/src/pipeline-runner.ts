// Positron Worker — Pipeline Runner
// Self-contained pipeline logic for BullMQ worker processes.
// Accepts all dependencies via DI (PipelineDeps interface) for clean separation from the server.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	IdempotencyRegistry,
	applyControlPlaneMigrations,
	assertAttemptActive,
	assertExecutionContext,
	buildVerificationContract,
	claimAttempt,
	classifyFailure,
	completeAttempt,
	createAttempt,
	createJob,
	evaluatePlanGate,
	evaluateRetry,
	fingerprint,
	idempotencyKey,
	mapAttemptRow,
	storeDecision,
	updateJobState,
	validateContract,
} from '@positron/control-plane';
import type { AttemptRecord, JobRecord } from '@positron/control-plane';
import type { VerificationContract } from '@positron/control-plane';
import type { GitHubStatusSyncService } from '@positron/github-adapter';
import type {
	EvidenceItem,
	GitHubAdapter,
	GitHubStatusSyncInput,
	GitHubStatusSyncResult,
} from '@positron/github-adapter';
import {
	createRun,
	getRequiredGates,
	markFailed,
	phaseRequiresGates,
	resolveImplementationOutcome,
	resolveTestOutcome,
	runCleanup,
	transition,
	tryTransitionWithGates,
} from '@positron/run-state';
import type {
	GateRuntimeMode,
	RunEventData,
	RunState,
	TransitionResult,
} from '@positron/run-state';
import { TestCommandDetector, TestRunner } from '@positron/sandbox';
import type { GitWorkspaceAdapter } from '@positron/sandbox';
import {
	MAX_FIX_LOOPS,
	buildRemoteUrl,
	createRunId,
	generateBranchName,
	parsePhase,
	parseRunStatus,
} from '@positron/shared';
import type {
	EventLevel,
	GateEvaluationContext,
	OpenCodeAdapter,
	Phase,
	RepositoryConfig,
	SpecKitAdapter,
} from '@positron/shared';
import type { GatewayService } from '@positron/tool-gateway';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Dependency Injection Interface
// ---------------------------------------------------------------------------

export interface PipelineDeps {
	db: Database.Database;
	repository: RepositoryConfig;
	workspace: GitWorkspaceAdapter;
	speckit: SpecKitAdapter;
	opencode: OpenCodeAdapter;
	github: GitHubAdapter;
	syncService?: GitHubStatusSyncService;
	/** Issue #322: Optional gateway service for tool audit enforcement */
	gateway?: GatewayService;
	/** Issue #385: Gate runtime mode for pipeline outcome resolution */
	gateRuntimeMode: GateRuntimeMode;
	/**
	 * P3: Optionaler Event-Hook (z. B. für SSE-Broadcast beim Inline-Fallback
	 * des Servers). Wird nach jedem gespeicherten run_event aufgerufen.
	 */
	onEvent?: (event: RunEventData) => void;
}

export function isRunInWorkerScope(workerRunScope: string | undefined, runId: string): boolean {
	return !workerRunScope || workerRunScope === runId;
}

export function isFaultTargetedToRun(
	faultRunId: string | undefined,
	run: Pick<RunState, 'id' | 'issueNumber'>,
): boolean {
	if (!faultRunId?.trim()) return false;
	const target = faultRunId.trim();
	return target === run.id || target === String(run.issueNumber);
}

export function isTerminalRunRecord(run: Pick<RunState, 'phase' | 'finishedAt'>): boolean {
	return (
		Boolean(run.finishedAt) ||
		['DONE', 'FAILED', 'FAILED_BLOCKED', 'FAILED_UNSAFE', 'CLEANUP'].includes(run.phase)
	);
}

// ---------------------------------------------------------------------------
// DB Helpers (self-contained, uses deps.db)
// ---------------------------------------------------------------------------

function getDb(deps: PipelineDeps): Database.Database {
	return deps.db;
}

function saveRunToDb(run: RunState, deps: PipelineDeps): void {
	const database = getDb(deps);
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

function loadRunFromDb(runId: string, deps: PipelineDeps): RunState | null {
	try {
		const row = getDb(deps).prepare('SELECT * FROM runs WHERE id = ?').get(runId) as
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
		console.error(`[Worker] loadRunFromDb failed for ${runId}`, err);
		return null;
	}
}

function storeEvent(event: RunEventData, deps: PipelineDeps): void {
	try {
		const database = getDb(deps);
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
		// P3: Optionaler externer Hook (SSE-Broadcast beim Server-Inline-Fallback)
		deps.onEvent?.(event);
	} catch (err) {
		console.error(`[Worker] storeEvent failed for run ${event.runId}`, err);
	}
}

function getEvents(runId: string, deps: PipelineDeps): RunEventData[] {
	try {
		const rows = getDb(deps)
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
		console.error(`[Worker] getEvents failed for run ${runId}`, err);
		return [];
	}
}

// ---------------------------------------------------------------------------
// Control Plane Integration (Issue #421)
//
// Die Worker-Pipeline schreibt ihre Versuche in die persistente
// run → job → attempt Hierarchie (cp_jobs / cp_attempts). Jeder mutierende
// Versuch ist idempotent (run:job:attempt Key). Die deterministische
// Verification (TEST) erzeugt einen positron.verification.v1 Contract.
// ---------------------------------------------------------------------------

function ensureControlPlane(db: Database.Database): void {
	try {
		applyControlPlaneMigrations(db);
	} catch (err) {
		console.error(`[Worker] control-plane migrations failed: ${String(err).slice(0, 200)}`);
	}
}

interface JobAttemptTracking {
	job: JobRecord;
	attempt: AttemptRecord;
	/** true wenn dieser Dispatch bereits behandelt wurde (kein zweiter Worker-Call) */
	duplicate: boolean;
	/** true wenn ein abgeschlossener Attempt wiederverwendet wurde (Recovery) */
	recovered: boolean;
	registry: IdempotencyRegistry;
	idemKey: string;
}

/**
 * Erstellt (oder findet) den Job eines Typs für einen Run und öffnet einen
 * neuen Attempt. Idempotenz: Wurde der Dispatch bereits geclaimed, gilt der
 * Versuch als Duplikat und wird NICHT erneut ausgeführt.
 *
 * P3: Der Attempt wird als `pending` angelegt und atomar geclaimt
 * (pending → running, genau ein Claimer). Paralleler Doppel-Dispatch
 * desselben Attempts wird abgelehnt. Der Execution-Context
 * (run_id/job_id/attempt_id) ist für die produktive Ausführung zwingend.
 *
 * P3-Recovery-Boundary: Existiert bereits ein abgeschlossener (succeeded)
 * Attempt für den Job, wird KEIN neuer Attempt erstellt und KEIN Worker
 * erneut aufgerufen — der persistierte Attempt wird wiederverwendet
 * (`recovered: true`). Abgeschlossene Arbeit wird nach einem Crash nie
 * blind wiederholt (§30/§31).
 */
function trackJobAttempt(
	run: RunState,
	deps: PipelineDeps,
	jobType:
		| 'plan'
		| 'build'
		| 'verify'
		| 'decide'
		| 'research'
		| 'specify'
		| 'tasks'
		| 'analyze'
		| 'baseline',
	workerType: string,
	provider: string | null,
	model: string | null,
	inputContract: string | null,
	inputFingerprint: string | null,
	previousAttemptId: string | null = null,
): JobAttemptTracking {
	const db = getDb(deps);
	ensureControlPlane(db);

	let job = db
		.prepare(
			'SELECT * FROM cp_jobs WHERE run_id = ? AND job_type = ? ORDER BY created_at ASC LIMIT 1',
		)
		.get(run.id, jobType) as Record<string, unknown> | undefined;
	if (!job) {
		job = {
			job_id: `job_${crypto.randomUUID()}`,
			run_id: run.id,
			job_type: jobType,
			state: 'pending',
			parent_job_id: null,
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		};
		db.prepare(
			`INSERT INTO cp_jobs (job_id, run_id, job_type, state, parent_job_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		).run(
			job.job_id,
			job.run_id,
			job.job_type,
			job.state,
			job.parent_job_id,
			job.created_at,
			job.updated_at,
		);
	}

	const registry = new IdempotencyRegistry(db);

	// ── P3-Recovery-Boundary: abgeschlossener Attempt wird wiederverwendet ──
	// Ein succeeded Attempt (Result validiert + persistiert + finalisiert) ist
	// COMMITTED: Der Worker wird nach einem Crash/Re-Dispatch NICHT erneut
	// aufgerufen (§31 RECOVERY_BOUNDARY_COMMITTED). Der Input-Fingerprint muss
	// übereinstimmen: bei geändertem Input (anderer Workspace/Issue) wird ein
	// veraltetes Ergebnis nicht wiederverwendet.
	const succeededRows = db
		.prepare(
			"SELECT * FROM cp_attempts WHERE job_id = ? AND status = 'succeeded' ORDER BY started_at ASC",
		)
		.all(String(job.job_id)) as Array<Record<string, unknown>>;
	const matchingSucceeded = succeededRows.find(
		(r) => !inputFingerprint || r.input_fingerprint === inputFingerprint,
	);
	if (matchingSucceeded) {
		return {
			job: job as unknown as JobRecord,
			attempt: mapAttemptRow(matchingSucceeded),
			duplicate: true,
			recovered: true,
			registry,
			idemKey: '',
		};
	}

	const attempt = createAttempt(db, run.id, String(job.job_id), {
		status: 'pending',
		worker_type: workerType,
		provider,
		model,
		input_contract: inputContract,
		input_fingerprint: inputFingerprint,
		previous_attempt_id: previousAttemptId,
	});
	const idemKey = idempotencyKey(run.id, String(job.job_id), attempt.attempt_id);
	const duplicate = !registry.claim(idemKey);
	if (duplicate) {
		completeAttempt(db, attempt.attempt_id, { status: 'denied', result_ref: 'duplicate-dispatch' });
	} else if (!claimAttempt(db, attempt.attempt_id)) {
		// Paralleler Doppel-Claim desselben Attempts: abgelehnt.
		completeAttempt(db, attempt.attempt_id, { status: 'denied', result_ref: 'duplicate-claim' });
		return {
			job: job as unknown as JobRecord,
			attempt,
			duplicate: true,
			recovered: false,
			registry,
			idemKey,
		};
	}
	return {
		job: job as unknown as JobRecord,
		attempt,
		duplicate,
		recovered: false,
		registry,
		idemKey,
	};
}

function completeTrackedAttempt(
	tracking: JobAttemptTracking,
	deps: PipelineDeps,
	update: Partial<AttemptRecord>,
): void {
	completeAttempt(getDb(deps), tracking.attempt.attempt_id, update);
	if (!tracking.duplicate) {
		tracking.registry.complete(tracking.idemKey, update.result_ref ?? null);
	}
}

/**
 * P3: Produktive Worker-Ausführung nur innerhalb eines aktiven Attempts.
 * Wirft EXECUTION_CONTEXT_REQUIRED, wenn der Attempt nicht geclaimt/aktiv ist.
 */
function assertWorkerContext(
	run: RunState,
	tracking: JobAttemptTracking,
	deps: PipelineDeps,
): void {
	assertExecutionContext({
		run_id: run.id,
		job_id: tracking.job.job_id,
		attempt_id: tracking.attempt.attempt_id,
	});
	assertAttemptActive(getDb(deps), tracking.attempt.attempt_id);
}

/** Finalisiert einen getrackten Worker-Attempt und den zugehörigen Job. */
function finalizeTrackedAttempt(
	tracking: JobAttemptTracking,
	deps: PipelineDeps,
	status: 'succeeded' | 'failed' | 'blocked',
	update: Partial<AttemptRecord> = {},
): void {
	completeTrackedAttempt(tracking, deps, { status, ...update });
	if (status !== 'failed') {
		updateJobState(getDb(deps), tracking.job.job_id, status);
	}
}

/**
 * P3: Artefakt-Schritt mit Output-Boundary (§24) — der generische
 * positron.artifact.v1-Contract wird VOR der Persistenz validiert.
 * Ungültige Artefakt-Dokumente → Attempt blocked (CONTRACT_FAILURE),
 * keine erfolgreiche Transition. Liefert true bei Erfolg.
 */
function finalizeArtifactAttempt(
	tracking: JobAttemptTracking,
	deps: PipelineDeps,
	artifactDoc: {
		contract: string;
		run_id: string;
		kind: string;
		phase: string;
		size: number;
		content_ref: string;
	},
): boolean {
	const validation = validateContract('positron.artifact.v1', artifactDoc);
	if (!validation.ok) {
		finalizeTrackedAttempt(tracking, deps, 'blocked', {
			failure_class: 'CONTRACT_FAILURE',
			failure_signature: validation.errors.join('|'),
		});
		storeEvent(
			{
				id: createRunId(),
				runId: artifactDoc.run_id,
				phase: parsePhase(artifactDoc.phase.toUpperCase()),
				level: 'ERROR',
				message: `Artifact contract invalid: ${validation.errors.join('; ')}`,
				payload: { errors: validation.errors, kind: artifactDoc.kind },
				createdAt: new Date().toISOString(),
			},
			deps,
		);
		return false;
	}
	finalizeTrackedAttempt(tracking, deps, 'succeeded', {
		output_contract: artifactDoc.contract,
		output_json: JSON.stringify(artifactDoc),
		output_fingerprint: fingerprint(artifactDoc),
		result_ref: artifactDoc.content_ref,
	});
	return true;
}

/** Lädt den letzten Attempt eines Job-Typs (für Retry-/Delta-Bewertung). */
function loadLastAttempt(runId: string, jobType: string, deps: PipelineDeps): AttemptRecord | null {
	try {
		const rows = getDb(deps)
			.prepare(
				`SELECT a.* FROM cp_attempts a
				 JOIN cp_jobs j ON j.job_id = a.job_id
				 WHERE a.run_id = ? AND j.job_type = ?
				 ORDER BY a.started_at ASC`,
			)
			.all(runId, jobType) as Array<Record<string, unknown>>;
		if (rows.length === 0) return null;
		const last = rows[rows.length - 1]!;
		return {
			attempt_id: String(last.attempt_id),
			run_id: String(last.run_id),
			job_id: String(last.job_id),
			status: String(last.status) as AttemptRecord['status'],
			input_contract: last.input_contract ? String(last.input_contract) : null,
			input_fingerprint: last.input_fingerprint ? String(last.input_fingerprint) : null,
			output_contract: last.output_contract ? String(last.output_contract) : null,
			output_fingerprint: last.output_fingerprint ? String(last.output_fingerprint) : null,
			output_json: last.output_json ? String(last.output_json) : null,
			worker_type: last.worker_type ? String(last.worker_type) : null,
			provider: last.provider ? String(last.provider) : null,
			model: last.model ? String(last.model) : null,
			started_at: String(last.started_at),
			ended_at: last.ended_at ? String(last.ended_at) : null,
			failure_class: last.failure_class ? String(last.failure_class) : null,
			failure_signature: last.failure_signature ? String(last.failure_signature) : null,
			new_evidence: last.new_evidence ? String(last.new_evidence) : null,
			strategy_delta: last.strategy_delta ? String(last.strategy_delta) : null,
			result_ref: last.result_ref ? String(last.result_ref) : null,
			tokens: last.tokens !== null && last.tokens !== undefined ? Number(last.tokens) : null,
			previous_attempt_id: last.previous_attempt_id ? String(last.previous_attempt_id) : null,
		};
	} catch (err) {
		console.error(`[Worker] loadLastAttempt failed: ${String(err).slice(0, 200)}`);
		return null;
	}
}

/** Lädt das neueste Artifact eines Typs als Text. */
function loadArtifact(runId: string, kind: string, deps: PipelineDeps): string | null {
	try {
		const row = getDb(deps)
			.prepare(
				'SELECT content FROM artifacts WHERE run_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1',
			)
			.get(runId, kind) as { content: string } | undefined;
		return row?.content ?? null;
	} catch {
		return null;
	}
}

function saveArtifact(
	runId: string,
	kind: string,
	content: string | string[],
	deps: PipelineDeps,
): void {
	try {
		const contentStr = Array.isArray(content) ? content.join('\n') : content;
		const artifactId = crypto.randomUUID();
		const createdAt = new Date().toISOString();
		getDb(deps)
			.prepare(`
      INSERT INTO artifacts (id, run_id, kind, content, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content
    `)
			.run(artifactId, runId, kind, contentStr, createdAt);
	} catch (err) {
		console.error(`[Worker] saveArtifact failed for ${kind} / run ${runId}`, err);
	}
}

function buildEvidence(run: RunState): EvidenceItem[] {
	const items: EvidenceItem[] = [
		{ kind: 'run-phase', status: 'pass', summary: `Phase: ${run.phase}` },
	];
	if (run.branch) items.push({ kind: 'branch', status: 'pass', summary: `Branch: ${run.branch}` });
	return items;
}

// ---------------------------------------------------------------------------
// Safe GitHub Sync (never crashes the pipeline)
// ---------------------------------------------------------------------------

async function safeSync(
	syncService: GitHubStatusSyncService,
	operation: () => Promise<GitHubStatusSyncResult>,
	runId: string,
	context: Phase,
	deps: PipelineDeps,
): Promise<GitHubStatusSyncResult | null> {
	try {
		const result = await operation();
		if (result.status === 'failed') {
			storeEvent(
				{
					id: createRunId(),
					runId,
					phase: context,
					level: 'WARN' as EventLevel,
					message: `GitHub sync failed: ${result.reason ?? 'unknown'}`,
					payload: null,
					createdAt: new Date().toISOString(),
				},
				deps,
			);
		}
		return result;
	} catch (err) {
		storeEvent(
			{
				id: createRunId(),
				runId,
				phase: context,
				level: 'ERROR' as EventLevel,
				message: `GitHub sync error: ${String(err).slice(0, 200)}`,
				payload: null,
				createdAt: new Date().toISOString(),
			},
			deps,
		);
		return null;
	}
}

// ---------------------------------------------------------------------------
// Research Document Generator
// ---------------------------------------------------------------------------

const __workerDirname = path.dirname(fileURLToPath(import.meta.url));

async function generateResearchDocument(
	github: GitHubAdapter,
	repository: RepositoryConfig,
	issueNumber: number,
): Promise<string> {
	const repoSlug = `${repository.owner}/${repository.repo}`;
	const issueRef = `#${issueNumber}`;
	const now = new Date().toISOString().slice(0, 10);

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
		console.warn(
			`[Worker] generateResearchDocument: Failed to fetch issue #${issueNumber}: ${String(err).slice(0, 200)}`,
		);
	}

	let readmeContent = '';
	try {
		const readmePath = path.resolve(__workerDirname, '..', '..', '..', '..', 'README.md');
		if (fs.existsSync(readmePath)) {
			readmeContent = fs.readFileSync(readmePath, 'utf-8').slice(0, 5000);
		}
	} catch {
		/* optional */
	}

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
							web?: { results?: Array<{ title: string; url: string; description: string }> };
						}
					).web?.results?.slice(0, 5) ?? [];
				searchResults = results.map((r) => `- [${r.title}](${r.url}): ${r.description}`).join('\n');
			}
		} catch (err) {
			console.warn(
				`[Worker] generateResearchDocument: Brave Search failed: ${String(err).slice(0, 200)}`,
			);
		}
	}

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

// ---------------------------------------------------------------------------
// Phase Executor
// ---------------------------------------------------------------------------

async function executePhase(run: RunState, deps: PipelineDeps): Promise<RunState> {
	const current = run;
	let result: TransitionResult;

	switch (current.phase) {
		case 'QUEUED':
			result = transition(current, 'CLAIMED', 'Issue claimed', 'INFO');
			break;
		case 'CLAIMED':
			if (deps.syncService) {
				const syncInput: GitHubStatusSyncInput = {
					runId: current.id,
					owner: deps.repository.owner,
					repo: deps.repository.repo,
					issueNumber: current.issueNumber,
					phase: 'CLAIMED',
					status: 'active',
					branchName: current.branch ?? undefined,
				};
				await safeSync(
					deps.syncService,
					() => deps.syncService!.syncRunAccepted(syncInput),
					current.id,
					'CLAIMED',
					deps,
				);
			}
			result = transition(current, 'REPO_SYNC', 'Repo synced', 'INFO');
			break;
		case 'REPO_SYNC':
			try {
				const workspaceRepository = {
					owner: deps.repository.owner,
					repo: deps.repository.repo,
					remoteUrl:
						deps.repository.remoteUrl ??
						buildRemoteUrl(deps.repository.owner, deps.repository.repo),
				};
				const ws = await deps.workspace.prepareWorkspace({
					repository: workspaceRepository,
					issueNumber: current.issueNumber,
					issueTitle: `Issue #${current.issueNumber}`,
					runId: current.id,
					baseBranch: deps.repository.defaultBranch,
				});
				current.branch = ws.branchName;
				current.workspacePath = ws.workspacePath;

				// P3: BASELINE-Job (find-or-create) mit realem HEAD —
				// die durable Run-Hierarchie beginnt im Workspace.
				ensureControlPlane(getDb(deps));
				const baselineTracking = trackJobAttempt(
					current,
					deps,
					'baseline',
					'deterministic.baseline',
					null,
					null,
					'positron.baseline.v1',
					fingerprint({ runId: current.id, repo: deps.repository.repo }),
				);
				if (!baselineTracking.duplicate) {
					assertWorkerContext(current, baselineTracking, deps);
					let headSha = '';
					try {
						headSha = await deps.workspace.getHeadSha(ws.workspacePath);
					} catch {
						headSha = '';
					}
					completeTrackedAttempt(baselineTracking, deps, {
						status: 'succeeded',
						output_contract: 'positron.baseline.v1',
						output_fingerprint: fingerprint({ phase: 'baseline', head: headSha || 'unknown' }),
						output_json: JSON.stringify({
							contract: 'positron.baseline.v1',
							run_id: current.id,
							repository_ref: `${deps.repository.owner}/${deps.repository.repo}`,
							repository_head: headSha || 'unknown',
							workspace_path: ws.workspacePath,
						}),
						result_ref: headSha || null,
					});
					updateJobState(getDb(deps), baselineTracking.job.job_id, 'succeeded');
				}

				result = transition(current, 'ISSUE_CONTEXT', `Workspace: ${ws.workspacePath}`);
			} catch (err) {
				result = markFailed(current, 'FAILED_TRANSIENT', `Repo sync failed: ${String(err)}`);
			}
			break;
		case 'ISSUE_CONTEXT':
			result = transition(current, 'WEB_RESEARCH', 'Research phase', 'INFO');
			break;
		case 'WEB_RESEARCH': {
			// P3: Research-Ausführung ist an einen persistierten Job/Attempt
			// gebunden (kein direkter Fetch mehr außerhalb der Control Plane).
			const tracking = trackJobAttempt(
				current,
				deps,
				'research',
				'research.issue',
				null,
				null,
				'positron.research.v1',
				fingerprint({
					runId: current.id,
					issueNumber: current.issueNumber,
					repo: deps.repository.repo,
				}),
			);
			let researchDoc: string;
			if (tracking.duplicate) {
				// Recovery: completed research wird NICHT erneut ausgeführt;
				// das persistierte Ergebnis wird wiederverwendet.
				const prev = loadLastAttempt(current.id, 'research', deps);
				researchDoc = prev?.output_json ?? '';
				storeEvent(
					{
						id: createRunId(),
						runId: current.id,
						phase: 'WEB_RESEARCH',
						level: 'INFO',
						message: 'Research recovered from persisted attempt (no rerun)',
						payload: { attemptId: prev?.attempt_id ?? null, recovered: true },
						createdAt: new Date().toISOString(),
					},
					deps,
				);
			} else {
				assertWorkerContext(current, tracking, deps);
				researchDoc = await generateResearchDocument(
					deps.github,
					deps.repository,
					current.issueNumber,
				);
				finalizeTrackedAttempt(tracking, deps, 'succeeded', {
					output_contract: 'positron.research.v1',
					output_fingerprint: fingerprint({ phase: 'research', size: researchDoc.length }),
					output_json: researchDoc.slice(0, 20000),
					result_ref: `artifact:research:${researchDoc.length}`,
				});
			}
			saveArtifact(current.id, 'research', researchDoc, deps);
			storeEvent(
				{
					id: createRunId(),
					runId: current.id,
					phase: 'WEB_RESEARCH',
					level: 'INFO',
					message: `Research document generated (${researchDoc.length} chars)`,
					payload: { artifactKind: 'research', size: researchDoc.length },
					createdAt: new Date().toISOString(),
				},
				deps,
			);
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

			// P3: Specify ist ein persistenter Job/Attempt (produktiver
			// OpenCode-/SpecKit-Aufruf NUR innerhalb der Control Plane).
			const tracking = trackJobAttempt(
				current,
				deps,
				'specify',
				realSpeckit ? 'opencode.specify' : 'speckit.specify',
				null,
				null,
				'positron.issue.v1',
				fingerprint({
					runId: current.id,
					issueNumber: current.issueNumber,
				}),
			);
			if (tracking.duplicate) {
				const prev = loadLastAttempt(current.id, 'specify', deps);
				if (prev?.output_json) {
					saveArtifact(current.id, 'spec', prev.output_json, deps);
				}
				storeEvent(
					{
						id: createRunId(),
						runId: current.id,
						phase: 'SPECIFY',
						level: 'INFO',
						message: 'Specify recovered from persisted attempt (no rerun)',
						payload: { attemptId: prev?.attempt_id ?? null, recovered: true },
						createdAt: new Date().toISOString(),
					},
					deps,
				);
				result = transition(current, 'PLAN', 'Specify recovered (persisted attempt)', 'INFO');
				break;
			}
			assertWorkerContext(current, tracking, deps);

			if (realSpeckit) {
				try {
					const initResult = await deps.speckit.initialize({
						runId: current.id,
						workspacePath: wsPath,
						issueTitle: `Issue #${current.issueNumber}`,
						issueNumber: current.issueNumber,
						mode: 'safe-cli',
						aiAgent: 'opencode',
					});
					if (initResult.status === 'success') {
						storeEvent(
							{
								id: createRunId(),
								runId: current.id,
								phase: 'SPECIFY',
								level: 'INFO',
								message: `Spec Kit initialized: ${initResult.summary}`,
								payload: null,
								createdAt: new Date().toISOString(),
							},
							deps,
						);
						const specResult = await deps.opencode.runSlashCommand('speckit.specify', {
							runId: current.id,
							workspacePath: wsPath,
							issueTitle: `Issue #${current.issueNumber}`,
							issueNumber: current.issueNumber,
							mode: 'safe-cli',
						});
						if (specResult.status === 'success') {
							// P3: Artefakt-Output-Boundary (§24)
							const artifactDoc = {
								contract: 'positron.artifact.v1',
								run_id: current.id,
								kind: 'spec',
								phase: 'specify',
								size: specResult.summary.length,
								content_ref: `opencode:specify:${specResult.sessionId ?? 'none'}`,
							};
							if (!finalizeArtifactAttempt(tracking, deps, artifactDoc)) {
								result = markFailed(
									current,
									'FAILED_BLOCKED',
									`Specify artifact contract invalid (${artifactDoc.kind})`,
								);
								break;
							}
						} else {
							finalizeTrackedAttempt(tracking, deps, 'failed', {
								failure_class: 'UNKNOWN',
								failure_signature: `specify:${specResult.status}`,
							});
						}
						result = transition(
							current,
							'PLAN',
							`Real Spec Kit: ${specResult.summary}`,
							specResult.status === 'success' ? 'INFO' : 'WARN',
						);
						break;
					}
				} catch (err) {
					storeEvent(
						{
							id: createRunId(),
							runId: current.id,
							phase: 'SPECIFY',
							level: 'WARN',
							message: `Real Spec Kit error: ${String(err).slice(0, 200)}`,
							payload: null,
							createdAt: new Date().toISOString(),
						},
						deps,
					);
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
				const sr = await deps.speckit.runSpecify(input);
				if (sr.status === 'success' || sr.status === 'skipped') {
					saveArtifact(current.id, 'spec', sr.summary, deps);
					// P3: Output-Boundary — auch Artefakt-Schritte tragen einen
					// validierten output_contract + fingerprint (§24).
					const artifactDoc = {
						contract: 'positron.artifact.v1',
						run_id: current.id,
						kind: 'spec',
						phase: 'specify',
						size: sr.summary.length,
						content_ref: `artifact:spec:${sr.summary.length}`,
					};
					if (!finalizeArtifactAttempt(tracking, deps, artifactDoc)) {
						result = markFailed(
							current,
							'FAILED_BLOCKED',
							`Specify artifact contract invalid (${artifactDoc.kind})`,
						);
						break;
					}
				} else {
					finalizeTrackedAttempt(tracking, deps, 'failed', {
						failure_class: 'UNKNOWN',
						failure_signature: `specify:${sr.status}`,
					});
				}
				result = transition(current, 'PLAN', sr.summary, sr.status === 'success' ? 'INFO' : 'WARN');
			} catch (err) {
				const errMsg = `Specify error: ${String(err).slice(0, 200)}`;
				finalizeTrackedAttempt(tracking, deps, 'failed', {
					failure_class: 'INFRA_FAILURE',
					failure_signature: errMsg,
				});
				result = markFailed(current, 'FAILED_TRANSIENT', errMsg);
			}
			break;
		}
		case 'PLAN': {
			const wsPath = current.workspacePath ?? current.branch ?? '/tmp';
			const realSpeckit = process.env.POSITRON_ENABLE_REAL_SPECKIT === 'true';

			// P3: Plan-Erzeugung ist ein persistenter Job/Attempt. Kein
			// opencode plan → parse → build Abkürzung mehr: der Plan läuft
			// durch den durable plan-Attempt und das deterministische Gate.
			const tracking = trackJobAttempt(
				current,
				deps,
				'plan',
				realSpeckit ? 'opencode.plan' : 'speckit.plan',
				process.env.POSITRON_OPENCODE_PROVIDER ?? null,
				process.env.POSITRON_OPENCODE_MODEL ?? null,
				'positron.plan.v1',
				fingerprint({
					runId: current.id,
					issueNumber: current.issueNumber,
				}),
			);
			if (tracking.duplicate) {
				const prev = loadLastAttempt(current.id, 'plan', deps);
				if (prev?.output_json) {
					saveArtifact(current.id, 'plan', prev.output_json, deps);
				}
				storeEvent(
					{
						id: createRunId(),
						runId: current.id,
						phase: 'PLAN',
						level: 'INFO',
						message: 'Plan recovered from persisted attempt (no rerun)',
						payload: { attemptId: prev?.attempt_id ?? null, recovered: true },
						createdAt: new Date().toISOString(),
					},
					deps,
				);
				result = transition(current, 'TASKS', 'Plan recovered (persisted attempt)', 'INFO');
				break;
			}
			assertWorkerContext(current, tracking, deps);

			if (realSpeckit) {
				try {
					const planResult = await deps.opencode.runSlashCommand('speckit.plan', {
						runId: current.id,
						workspacePath: wsPath,
						issueTitle: `Issue #${current.issueNumber}`,
						issueNumber: current.issueNumber,
						mode: 'safe-cli',
					});
					if (planResult.status === 'success') {
						// P3: Artefakt-Output-Boundary (§24)
						const artifactDoc = {
							contract: 'positron.artifact.v1',
							run_id: current.id,
							kind: 'plan',
							phase: 'plan',
							size: planResult.summary.length,
							content_ref: `opencode:plan:${planResult.sessionId ?? 'none'}`,
						};
						if (!finalizeArtifactAttempt(tracking, deps, artifactDoc)) {
							result = markFailed(
								current,
								'FAILED_BLOCKED',
								`Plan artifact contract invalid (${artifactDoc.kind})`,
							);
							break;
						}
					} else {
						finalizeTrackedAttempt(tracking, deps, 'failed', {
							failure_class: 'UNKNOWN',
							failure_signature: `plan:${planResult.status}`,
						});
					}
					result = transition(
						current,
						'TASKS',
						`Real Spec Kit: ${planResult.summary}`,
						planResult.status === 'success' ? 'INFO' : 'WARN',
					);
					break;
				} catch (err) {
					storeEvent(
						{
							id: createRunId(),
							runId: current.id,
							phase: 'PLAN',
							level: 'WARN',
							message: `Real Spec Kit error: ${String(err).slice(0, 200)}`,
							payload: null,
							createdAt: new Date().toISOString(),
						},
						deps,
					);
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
				const pr = await deps.speckit.runPlan(input);
				if (pr.status === 'success' || pr.status === 'skipped') {
					saveArtifact(current.id, 'plan', pr.summary, deps);
				}

				// Issue #421: Deterministisches Plan Gate.
				// Wenn ein strukturierter positron.plan.v1-Contract vorliegt,
				// entscheidet ausschließlich das Gate: nur APPROVED gibt den
				// Build frei. Kein LLM-Urteil über den Plan.
				const planArtifact = loadArtifact(current.id, 'plan', deps);
				let planGateApproved = false;
				if (planArtifact) {
					try {
						const parsed = JSON.parse(planArtifact) as Record<string, unknown>;
						if (parsed && typeof parsed === 'object' && parsed['contract'] === 'positron.plan.v1') {
							const gateResult = evaluatePlanGate(
								parsed,
								`${deps.repository.owner}/${deps.repository.repo}`,
							);
							if (gateResult.status !== 'APPROVED') {
								finalizeTrackedAttempt(tracking, deps, 'blocked', {
									output_json: planArtifact.slice(0, 4000),
									output_fingerprint: fingerprint({ phase: 'plan', gate: gateResult.status }),
									failure_class: 'CONTEXT_FAILURE',
									failure_signature: `plan-gate:${gateResult.reason_code}`,
								});
								storeEvent(
									{
										id: createRunId(),
										runId: current.id,
										phase: 'PLAN',
										level: 'ERROR',
										message: `PLAN_GATE_${gateResult.status}: ${gateResult.reason_code}`,
										payload: { gate: gateResult, reasonCode: gateResult.reason_code },
										createdAt: new Date().toISOString(),
									},
									deps,
								);
								result = markFailed(
									current,
									'FAILED_BLOCKED',
									`PLAN_GATE_${gateResult.status}: ${gateResult.reason_code} — ${gateResult.errors.join('; ')}`,
								);
								break;
							}
							planGateApproved = true;
							// Plan-Contract als Attempt-Output persistieren —
							// gegen positron.plan.v1 validiert (Gate nutzt den
							// persistierten, validierten Plan).
							finalizeTrackedAttempt(tracking, deps, 'succeeded', {
								output_contract: 'positron.plan.v1',
								output_json: planArtifact.slice(0, 4000),
								output_fingerprint: fingerprint({ phase: 'plan', gate: 'APPROVED' }),
								result_ref: `artifact:plan:${planArtifact.length}`,
							});
						}
					} catch {
						// Nicht-strukturierter Plan (z. B. Markdown) → Artefakt-Contract
						const artifactDoc = {
							contract: 'positron.artifact.v1',
							run_id: current.id,
							kind: 'plan',
							phase: 'plan',
							size: pr.summary.length,
							content_ref: `artifact:plan:${pr.summary.length}`,
						};
						if (!finalizeArtifactAttempt(tracking, deps, artifactDoc)) {
							result = markFailed(
								current,
								'FAILED_BLOCKED',
								`Plan artifact contract invalid (${artifactDoc.kind})`,
							);
							break;
						}
					}
				} else {
					const artifactDoc = {
						contract: 'positron.artifact.v1',
						run_id: current.id,
						kind: 'plan',
						phase: 'plan',
						size: pr.summary.length,
						content_ref: `artifact:plan:${pr.summary.length}`,
					};
					if (!finalizeArtifactAttempt(tracking, deps, artifactDoc)) {
						result = markFailed(
							current,
							'FAILED_BLOCKED',
							`Plan artifact contract invalid (${artifactDoc.kind})`,
						);
						break;
					}
				}

				if (planGateApproved) {
					storeEvent(
						{
							id: createRunId(),
							runId: current.id,
							phase: 'PLAN',
							level: 'GATE' as EventLevel,
							message: 'PLAN_GATE_APPROVED — build released',
							payload: { reasonCode: 'PLAN_GATE_APPROVED' },
							createdAt: new Date().toISOString(),
						},
						deps,
					);
				}

				result = transition(
					current,
					'TASKS',
					pr.summary,
					pr.status === 'success' || pr.status === 'skipped' ? 'INFO' : 'WARN',
				);
			} catch (err) {
				const planErrMsg = `Plan error: ${String(err).slice(0, 200)}`;
				finalizeTrackedAttempt(tracking, deps, 'failed', {
					failure_class: 'INFRA_FAILURE',
					failure_signature: planErrMsg,
				});
				result = markFailed(current, 'FAILED_TRANSIENT', planErrMsg);
			}
			break;
		}
		case 'TASKS': {
			const wsPath = current.workspacePath ?? current.branch ?? '/tmp';
			const realSpeckit = process.env.POSITRON_ENABLE_REAL_SPECKIT === 'true';

			// P3: Tasks ist ein persistenter Job/Attempt.
			const tracking = trackJobAttempt(
				current,
				deps,
				'tasks',
				realSpeckit ? 'opencode.tasks' : 'speckit.tasks',
				null,
				null,
				'positron.plan.v1',
				fingerprint({
					runId: current.id,
					issueNumber: current.issueNumber,
				}),
			);
			if (tracking.duplicate) {
				const prev = loadLastAttempt(current.id, 'tasks', deps);
				if (prev?.output_json) {
					saveArtifact(current.id, 'tasks', prev.output_json, deps);
				}
				storeEvent(
					{
						id: createRunId(),
						runId: current.id,
						phase: 'TASKS',
						level: 'INFO',
						message: 'Tasks recovered from persisted attempt (no rerun)',
						payload: { attemptId: prev?.attempt_id ?? null, recovered: true },
						createdAt: new Date().toISOString(),
					},
					deps,
				);
				result = transition(current, 'ANALYZE', 'Tasks recovered (persisted attempt)', 'INFO');
				break;
			}
			assertWorkerContext(current, tracking, deps);

			if (realSpeckit) {
				try {
					const tasksResult = await deps.opencode.runSlashCommand('speckit.tasks', {
						runId: current.id,
						workspacePath: wsPath,
						issueTitle: `Issue #${current.issueNumber}`,
						issueNumber: current.issueNumber,
						mode: 'safe-cli',
					});
					if (tasksResult.status === 'success') {
						// P3: Artefakt-Output-Boundary (§24)
						const artifactDoc = {
							contract: 'positron.artifact.v1',
							run_id: current.id,
							kind: 'tasks',
							phase: 'tasks',
							size: tasksResult.summary.length,
							content_ref: `opencode:tasks:${tasksResult.sessionId ?? 'none'}`,
						};
						if (!finalizeArtifactAttempt(tracking, deps, artifactDoc)) {
							result = markFailed(
								current,
								'FAILED_BLOCKED',
								`Tasks artifact contract invalid (${artifactDoc.kind})`,
							);
							break;
						}
					} else {
						finalizeTrackedAttempt(tracking, deps, 'failed', {
							failure_class: 'UNKNOWN',
							failure_signature: `tasks:${tasksResult.status}`,
						});
					}
					result = transition(
						current,
						'ANALYZE',
						`Real Spec Kit: ${tasksResult.summary}`,
						tasksResult.status === 'success' ? 'INFO' : 'WARN',
					);
					break;
				} catch (err) {
					storeEvent(
						{
							id: createRunId(),
							runId: current.id,
							phase: 'TASKS',
							level: 'WARN',
							message: `Real Spec Kit error: ${String(err).slice(0, 200)}`,
							payload: null,
							createdAt: new Date().toISOString(),
						},
						deps,
					);
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
				const tr = await deps.speckit.runTasks(input);
				if (tr.status === 'success' || tr.status === 'skipped') {
					saveArtifact(current.id, 'tasks', tr.summary, deps);
					// P3: Output-Boundary (§24) — Artefakt-Contract
					const artifactDoc = {
						contract: 'positron.artifact.v1',
						run_id: current.id,
						kind: 'tasks',
						phase: 'tasks',
						size: tr.summary.length,
						content_ref: `artifact:tasks:${tr.summary.length}`,
					};
					if (!finalizeArtifactAttempt(tracking, deps, artifactDoc)) {
						result = markFailed(
							current,
							'FAILED_BLOCKED',
							`Tasks artifact contract invalid (${artifactDoc.kind})`,
						);
						break;
					}
				} else {
					finalizeTrackedAttempt(tracking, deps, 'failed', {
						failure_class: 'UNKNOWN',
						failure_signature: `tasks:${tr.status}`,
					});
				}
				result = transition(
					current,
					'ANALYZE',
					tr.summary,
					tr.status === 'success' || tr.status === 'skipped' ? 'INFO' : 'WARN',
				);
			} catch (err) {
				const tasksErrMsg = `Tasks error: ${String(err).slice(0, 200)}`;
				finalizeTrackedAttempt(tracking, deps, 'failed', {
					failure_class: 'INFRA_FAILURE',
					failure_signature: tasksErrMsg,
				});
				result = markFailed(current, 'FAILED_TRANSIENT', tasksErrMsg);
			}
			break;
		}
		case 'ANALYZE': {
			const wsPath = current.workspacePath ?? current.branch ?? '/tmp';

			// P3: Analyze ist ein persistenter Job/Attempt.
			const tracking = trackJobAttempt(
				current,
				deps,
				'analyze',
				'speckit.analyze',
				null,
				null,
				'positron.plan.v1',
				fingerprint({
					runId: current.id,
					issueNumber: current.issueNumber,
				}),
			);
			if (tracking.duplicate) {
				storeEvent(
					{
						id: createRunId(),
						runId: current.id,
						phase: 'ANALYZE',
						level: 'INFO',
						message: 'Analyze recovered from persisted attempt (no rerun)',
						payload: { recovered: true },
						createdAt: new Date().toISOString(),
					},
					deps,
				);
				result = transition(current, 'REVIEW', 'Analysis recovered (persisted attempt)', 'INFO');
				break;
			}
			assertWorkerContext(current, tracking, deps);

			const input = {
				runId: current.id,
				workspacePath: wsPath,
				issueTitle: `Issue #${current.issueNumber}`,
				issueNumber: current.issueNumber,
				mode: 'artifact-only' as const,
			};
			try {
				const ar = await deps.speckit.runAnalyze(input);
				// P3: Output-Boundary (§24) — Artefakt-Contract
				const artifactDoc = {
					contract: 'positron.artifact.v1',
					run_id: current.id,
					kind: 'analyze',
					phase: 'analyze',
					size: ar.summary.length,
					content_ref: `artifact:analyze:${ar.summary.length}`,
				};
				if (!finalizeArtifactAttempt(tracking, deps, artifactDoc)) {
					result = markFailed(
						current,
						'FAILED_BLOCKED',
						`Analyze artifact contract invalid (${artifactDoc.kind})`,
					);
					break;
				}
				result = transition(current, 'REVIEW', ar.summary, 'INFO');
			} catch (err) {
				storeEvent(
					{
						id: createRunId(),
						runId: current.id,
						phase: 'ANALYZE',
						level: 'WARN',
						message: `Analyze error: ${String(err).slice(0, 200)}`,
						payload: null,
						createdAt: new Date().toISOString(),
					},
					deps,
				);
				finalizeTrackedAttempt(tracking, deps, 'failed', {
					failure_class: 'INFRA_FAILURE',
					failure_signature: `analyze:${String(err).slice(0, 200)}`,
				});
				result = transition(current, 'REVIEW', 'Analysis complete', 'INFO');
			}
			break;
		}
		case 'REVIEW': {
			const requiredArtifacts = ['spec', 'plan', 'tasks'];
			const existingKinds = new Set(
				(
					getDb(deps)
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

			// Issue #421: Persistent Attempt-Tracking mit Idempotenz.
			// Jeder mutierende Versuch ist an run:job:attempt gebunden —
			// doppelter Dispatch führt zu KEINEM zweiten Worker-Aufruf.
			// P3: FIX-Kette — der neue Attempt referenziert den vorherigen.
			const previousBuildAttempt = loadLastAttempt(current.id, 'build', deps);
			const tracking = trackJobAttempt(
				current,
				deps,
				'build',
				'opencode',
				process.env.POSITRON_OPENCODE_PROVIDER ?? null,
				process.env.POSITRON_OPENCODE_MODEL ?? null,
				'positron.build-input.v1',
				fingerprint({ runId: current.id, workspacePath: wsPath, issueNumber: current.issueNumber }),
				previousBuildAttempt?.attempt_id ?? null,
			);

			if (tracking.recovered) {
				// P3-Recovery: Build ist bereits abgeschlossen + persistiert —
				// kein zweiter Worker-Call; weiter zu TEST (Verify folgt).
				storeEvent(
					{
						id: createRunId(),
						runId: current.id,
						phase: 'IMPLEMENT',
						level: 'INFO',
						message: 'Build recovered from persisted attempt (no rerun)',
						payload: { attemptId: tracking.attempt.attempt_id, recovered: true },
						createdAt: new Date().toISOString(),
					},
					deps,
				);
				result = transition(current, 'TEST', 'Build recovered (persisted attempt)', 'INFO');
				break;
			}
			if (tracking.duplicate) {
				storeEvent(
					{
						id: createRunId(),
						runId: current.id,
						phase: 'IMPLEMENT',
						level: 'WARN',
						message: 'Duplicate dispatch blocked (idempotency) — no second worker call',
						payload: { idemKey: tracking.idemKey },
						createdAt: new Date().toISOString(),
					},
					deps,
				);
				result = markFailed(
					current,
					'FAILED_BLOCKED',
					'Duplicate dispatch blocked (idempotency) — run:job:attempt already claimed',
				);
				break;
			}

			try {
				// P3: OpenCode-Build nur innerhalb eines aktiven Attempts.
				assertWorkerContext(current, tracking, deps);
				const ir = await deps.opencode.runImplement(input);

				// Issue #385: Explicit outcome resolution — blocked/failed must NOT reach TEST
				const outcome = resolveImplementationOutcome(ir.status);

				if (outcome === 'FAILED_BLOCKED') {
					// finalizeTrackedAttempt setzt auch den Job-State auf
					// blocked (Terminalsemantik, konsistent zu durable-run).
					finalizeTrackedAttempt(tracking, deps, 'blocked', {
						output_contract: 'positron.build-result.v1',
						output_fingerprint: fingerprint({ phase: 'implement', status: ir.status }),
						failure_class: 'CONTEXT_FAILURE',
						failure_signature: `blocked:${ir.blockedReason ?? 'policy'}`,
						result_ref: `opencode:${ir.sessionId ?? 'none'}`,
					});
					storeEvent(
						{
							id: createRunId(),
							runId: current.id,
							phase: 'IMPLEMENT',
							level: 'ERROR',
							message: `Implement blocked: ${ir.blockedReason ?? 'policy'}`,
							payload: { result: ir, gateRuntimeMode: deps.gateRuntimeMode },
							createdAt: new Date().toISOString(),
						},
						deps,
					);
					result = markFailed(
						current,
						'FAILED_BLOCKED',
						`Implement blocked: ${ir.blockedReason ?? 'policy'}`,
					);
				} else if (outcome === 'RETRY') {
					// Provider-/Infrastruktur-Fehler werden klassifiziert —
					// NIE als Modellunfähigkeit gewertet.
					const classified = classifyFailure({
						stderr: ir.summary,
						exitCode: ir.exitCode ?? 1,
					});
					completeTrackedAttempt(tracking, deps, {
						status: 'failed',
						output_contract: 'positron.build-result.v1',
						output_fingerprint: fingerprint({ phase: 'implement', status: ir.status }),
						failure_class: classified.signature as AttemptRecord['failure_class'],
						failure_signature: `implement:${classified.signature}`,
						new_evidence: ir.summary.slice(0, 500),
						result_ref: `opencode:${ir.sessionId ?? 'none'}`,
					});
					result = markFailed(current, 'FAILED_TRANSIENT', `Implement failed: ${ir.summary}`);
				} else {
					// P3: Output-Boundary — das Build-Result wird VOR der
					// Persistenz gegen positron.build-result.v1 validiert.
					// Ungültige Worker-Ausgabe → CONTRACT_INVALID, keine
					// erfolgreiche Transition (§24).
					const buildResultDoc = {
						contract: 'positron.build-result.v1',
						run_id: current.id,
						job_id: tracking.job.job_id,
						attempt_id: tracking.attempt.attempt_id,
						status: 'success' as const,
						summary: ir.summary,
						changed_files: [],
						result_ref: `opencode:${ir.sessionId ?? 'none'}`,
					};
					const buildResultValidation = validateContract(
						'positron.build-result.v1',
						buildResultDoc,
					);
					if (!buildResultValidation.ok) {
						// finalizeTrackedAttempt setzt auch den Job-State auf
						// blocked (Terminalsemantik, konsistent zu durable-run).
						finalizeTrackedAttempt(tracking, deps, 'blocked', {
							failure_class: 'CONTRACT_FAILURE',
							failure_signature: buildResultValidation.errors.join('|'),
						});
						storeEvent(
							{
								id: createRunId(),
								runId: current.id,
								phase: 'IMPLEMENT',
								level: 'ERROR',
								message: `Build result contract invalid: ${buildResultValidation.errors.join('; ')}`,
								payload: { errors: buildResultValidation.errors },
								createdAt: new Date().toISOString(),
							},
							deps,
						);
						result = markFailed(
							current,
							'FAILED_BLOCKED',
							`Build result contract invalid: ${buildResultValidation.errors.join('; ')}`,
						);
						break;
					}
					completeTrackedAttempt(tracking, deps, {
						status: 'succeeded',
						output_contract: buildResultDoc.contract,
						output_json: JSON.stringify(buildResultDoc),
						output_fingerprint: fingerprint(buildResultDoc),
						result_ref: buildResultDoc.result_ref,
					});
					updateJobState(getDb(deps), tracking.job.job_id, 'succeeded');
					result = transition(
						current,
						'TEST',
						ir.summary,
						ir.status === 'success' ? 'INFO' : 'WARN',
					);
				}
			} catch (err) {
				const implErrMsg = `Implement error: ${String(err).slice(0, 200)}`;
				completeTrackedAttempt(tracking, deps, {
					status: 'failed',
					failure_class: 'INFRA_FAILURE',
					failure_signature: `implement-error:${implErrMsg}`,
				});
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
					const emptyReport: import('@positron/shared').TestReport = {
						status: 'blocked',
						summary: 'No test commands detected',
						passed: 0,
						failed: 0,
						total: 0,
						durationMs: 0,
					};
					const outcome = resolveTestOutcome(emptyReport, deps.gateRuntimeMode, false);
					if (outcome === 'FAILED_BLOCKED') {
						result = markFailed(
							current,
							'FAILED_BLOCKED',
							`No test commands configured in ${deps.gateRuntimeMode} mode. Set up tests or switch to fixture/demo mode.`,
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
					// Issue #421: Deterministische Verification — der fachliche
					// Verify-Schritt (TestRunner) läuft NUR innerhalb eines
					// persistierten verify-Attempts (P3: Attempt vor Ausführung).
					const verifyTracking = trackJobAttempt(
						current,
						deps,
						'verify',
						'deterministic-tools',
						null,
						null,
						'positron.verification.v1',
						fingerprint({
							runId: current.id,
							workspacePath: wsPath,
							testCommands: detection.commands.map((c) => `${c.command} ${c.args.join(' ')}`),
						}),
					);

					// P3-Recovery: Verify ist bereits abgeschlossen + persistiert —
					// der TestRunner wird NICHT erneut aufgerufen; die
					// Verification wird aus dem persistierten Attempt rehydriert.
					if (verifyTracking.recovered) {
						const prevVerify = loadLastAttempt(current.id, 'verify', deps);
						let recoveredVerification: VerificationContract | null = null;
						if (prevVerify?.output_json) {
							try {
								recoveredVerification = JSON.parse(prevVerify.output_json) as VerificationContract;
							} catch {
								recoveredVerification = null;
							}
						}
						if (recoveredVerification) {
							storeEvent(
								{
									id: createRunId(),
									runId: current.id,
									phase: 'TEST',
									level: 'INFO',
									message: `Verification recovered from persisted attempt (${recoveredVerification.passed ? 'pass' : 'fail'}, no rerun)`,
									payload: { attemptId: prevVerify?.attempt_id ?? null, recovered: true },
									createdAt: new Date().toISOString(),
								},
								deps,
							);
							const outcome = recoveredVerification.passed ? 'PASS' : 'RETRY';
							if (outcome === 'PASS') {
								result = transition(current, 'VERIFY', 'Tests passed (recovered)', 'INFO');
							} else {
								result = markFailed(
									current,
									'FAILED_TRANSIENT',
									`Tests failed (recovered): ${recoveredVerification.failure_signature ?? 'unknown'}`,
								);
							}
							break;
						}
						// Recovered, aber kein rehydrierbarer Contract: konsistenter
						// Abbruch statt Crash (kein erneuter TestRunner-Lauf auf
						// einem finalen Attempt, kein EXECUTION_CONTEXT_REQUIRED).
						storeEvent(
							{
								id: createRunId(),
								runId: current.id,
								phase: 'TEST',
								level: 'ERROR',
								message:
									'Verify recovery failed: persisted attempt has no rehydratable verification contract',
								payload: { attemptId: prevVerify?.attempt_id ?? null },
								createdAt: new Date().toISOString(),
							},
							deps,
						);
						result = markFailed(
							current,
							'FAILED_BLOCKED',
							'Verify recovery failed: persisted verification contract missing/invalid',
						);
						break;
					}
					assertWorkerContext(current, verifyTracking, deps);
					const runner = new TestRunner();
					const report = await runner.runDetectedCommands({
						runId: current.id,
						workspacePath: wsPath,
						commands: detection.commands,
						mode: 'standard',
					});

					// Sync to GitHub (existing logic)
					if (deps.syncService && report) {
						const syncInput: GitHubStatusSyncInput = {
							runId: current.id,
							owner: deps.repository.owner,
							repo: deps.repository.repo,
							issueNumber: current.issueNumber,
							phase: 'TEST',
							status: report.status,
							branchName: current.branch ?? undefined,
							workspacePath: wsPath,
							testReport: report,
						};
						if (report.status === 'blocked') {
							await safeSync(
								deps.syncService,
								() =>
									deps.syncService!.syncBlocked({
										...syncInput,
										error: { type: 'blocked', message: report.summary },
									}),
								current.id,
								'TEST',
								deps,
							);
						} else if (report.status === 'failed') {
							await safeSync(
								deps.syncService,
								() => deps.syncService!.syncTestReport(syncInput),
								current.id,
								'TEST',
								deps,
							);
						} else {
							await safeSync(
								deps.syncService,
								() => deps.syncService!.syncTestReport(syncInput),
								current.id,
								'TEST',
								deps,
							);
						}
					}

					// Issue #421: Deterministische Verification.
					// Messbare Ergebnisse werden von Tools gemessen, nicht von
					// einem LLM beurteilt. Der Verification-Contract wird in den
					// persistenten Attempt der Control Plane geschrieben.
					const verification = buildVerificationContract({
						run_id: current.id,
						job_id: verifyTracking.job.job_id,
						attempt_id: verifyTracking.attempt.attempt_id,
						checks: detection.commands.map((c) => ({
							name: `${c.command} ${c.args.join(' ')}`,
							passed: report.status === 'passed',
							kind: 'unit' as const,
							duration_ms: report.durationMs,
							detail: report.summary,
						})),
						new_evidence:
							report.status === 'failed'
								? `test output: ${(report.details ?? [])
										.map((d) => `${d.stdout}\n${d.stderr}`)
										.join('\n')
										.slice(0, 500)}`
								: undefined,
					});
					if (!verification.passed) {
						const output = (report.details ?? []).map((d) => `${d.stdout}\n${d.stderr}`).join('\n');
						const classified = classifyFailure({
							stderr: output,
							exitCode: report.failed > 0 ? 1 : 0,
						});
						verification.failure_class =
							classified.signature === 'UNKNOWN'
								? 'TEST_FAILURE'
								: (classified.signature as VerificationContract['failure_class']);
						verification.failure_signature =
							classified.signature === 'TEST_FAILURE'
								? (verification.failure_signature ?? 'test:failed')
								: `test:${classified.signature}`;
					}
					// P3: Output-Boundary — die Verification wird VOR der
					// Persistenz gegen positron.verification.v1 validiert (§24).
					const verificationValidation = validateContract('positron.verification.v1', verification);
					if (!verificationValidation.ok) {
						// finalizeTrackedAttempt setzt auch den Job-State auf
						// blocked (Terminalsemantik, konsistent zu durable-run).
						finalizeTrackedAttempt(verifyTracking, deps, 'blocked', {
							failure_class: 'CONTRACT_FAILURE',
							failure_signature: verificationValidation.errors.join('|'),
						});
						storeEvent(
							{
								id: createRunId(),
								runId: current.id,
								phase: 'TEST',
								level: 'ERROR',
								message: `Verification contract invalid: ${verificationValidation.errors.join('; ')}`,
								payload: { errors: verificationValidation.errors },
								createdAt: new Date().toISOString(),
							},
							deps,
						);
						result = markFailed(
							current,
							'FAILED_BLOCKED',
							`Verification contract invalid: ${verificationValidation.errors.join('; ')}`,
						);
						break;
					}
					if (!verifyTracking.duplicate) {
						completeTrackedAttempt(verifyTracking, deps, {
							status: verification.passed ? 'succeeded' : 'failed',
							output_contract: 'positron.verification.v1',
							output_fingerprint: fingerprint(verification),
							output_json: JSON.stringify(verification),
							failure_class: verification.failure_class ?? null,
							failure_signature: verification.failure_signature ?? null,
							new_evidence: verification.new_evidence ?? null,
						});
						updateJobState(
							getDb(deps),
							verifyTracking.job.job_id,
							verification.passed ? 'succeeded' : 'failed',
						);
					}

					// Issue #385: Explicit outcome resolution — failed/blocked must NOT reach VERIFY
					const outcome = resolveTestOutcome(report, deps.gateRuntimeMode, true);

					if (outcome === 'FAILED_BLOCKED' || outcome === 'RETRY') {
						// P3: Der Build-Attempt wird bei fehlgeschlagener
						// Verification fachlich reklassifiziert (succeeded →
						// failed mit failure_class + failure_signature) —
						// konsistent zu runDurableRun (§24, Audit-Wahrheit:
						// kein "succeeded build + failed verify").
						const lastBuild = loadLastAttempt(current.id, 'build', deps);
						if (lastBuild && lastBuild.status === 'succeeded') {
							completeAttempt(getDb(deps), lastBuild.attempt_id, {
								status: 'failed',
								failure_class: verification.failure_class ?? 'TEST_FAILURE',
								failure_signature: verification.failure_signature ?? 'test:failed',
								new_evidence: verification.new_evidence ?? null,
							});
						}
					}

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
				const gateCtx: GateEvaluationContext = {
					runId: current.id,
					phase: current.phase,
					targetPhase: 'COMMIT',
					gateTypes: getRequiredGates('COMMIT'),
				};
				result = tryTransitionWithGates(
					current,
					'COMMIT',
					'Verified, commit ready',
					gateCtx,
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
			const commitMsg = `fix(issue-${current.issueNumber}): Positron automated changes [Run: ${current.id.slice(0, 8)}]`;
			const commitWsPath = current.workspacePath ?? `/tmp/positron-ws-${current.id.slice(0, 8)}`;

			try {
				let changeSummary = '';
				let hasChanges = false;
				try {
					const status = await deps.workspace.getStatus(commitWsPath);
					hasChanges = !status.isClean;
					const staged = status.staged.length;
					const unstaged = status.unstaged.length;
					const untracked = status.untracked.length;
					changeSummary = `${staged} staged, ${unstaged} unstaged, ${untracked} untracked`;
				} catch {
					/* status optional */
				}

				if (!hasChanges) {
					result = markFailed(
						current,
						'FAILED_BLOCKED',
						`No changes were made during implementation — no files changed in workspace ${commitWsPath} (${changeSummary})`,
					);
					break;
				}

				const commitResult = await deps.workspace.commit(commitWsPath, commitMsg);

				let pushResult = '';
				if (pushAllowed) {
					await deps.workspace.push({ workspacePath: commitWsPath, branch });
					pushResult = ', pushed';
				} else {
					pushResult = ', push skipped (POSITRON_ENABLE_PUSH not set)';
				}

				const summary = `Committed: ${commitResult.sha.slice(0, 7)}${pushResult} (${changeSummary})`;
				if (phaseRequiresGates('PR_CREATE')) {
					const gateCtx: GateEvaluationContext = {
						runId: current.id,
						phase: current.phase,
						targetPhase: 'PR_CREATE',
						gateTypes: getRequiredGates('PR_CREATE'),
					};
					result = tryTransitionWithGates(current, 'PR_CREATE', summary, gateCtx, 'INFO', null);
				} else {
					result = transition(current, 'PR_CREATE', summary, 'INFO');
				}
			} catch (err) {
				// Issue #385: COMMIT exception → FAILED_BLOCKED (never PR_CREATE)
				// A failed commit means no safe state to push or PR from.
				storeEvent(
					{
						id: createRunId(),
						runId: current.id,
						phase: 'COMMIT',
						level: 'ERROR',
						message: `Commit/Push failed: ${String(err).slice(0, 200)}`,
						payload: null,
						createdAt: new Date().toISOString(),
					},
					deps,
				);
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
			const body = `## Positron Automated Changes\n\n**Run ID:** \`${current.id}\`\n**Issue:** #${current.issueNumber}\n**Branch:** \`${branch}\`\n\n---\n\nCloses #${current.issueNumber}\n\n_Generated by [Positron](https://github.com/xxammaxx/Positron)_`;

			try {
				// --- R5: Check for existing PR before creating a new one (Idempotency) ---
				let pr: Awaited<ReturnType<typeof deps.github.createPullRequest>>;
				let prWasAdopted = false;

				try {
					const existingPRs = await deps.github.listPullRequests({
						owner: deps.repository.owner,
						repo: deps.repository.repo,
						head: `${deps.repository.owner}:${branch}`,
						state: 'open',
					});
					if (existingPRs.length > 0 && existingPRs[0]) {
						// Adopt existing PR — do not create a duplicate
						const existing = existingPRs[0];
						pr = {
							number: existing.number,
							htmlUrl: existing.htmlUrl,
							state: existing.state,
						} as typeof pr;
						prWasAdopted = true;
						storeEvent(
							{
								id: createRunId(),
								runId: current.id,
								phase: 'PR_CREATE',
								level: 'INFO',
								message: `Adopted existing PR #${pr.number} (recovery after restart)`,
								payload: { prNumber: pr.number, adopted: true, prUrl: pr.htmlUrl },
								createdAt: new Date().toISOString(),
							},
							deps,
						);
					} else {
						pr = await deps.github.createPullRequest({
							owner: deps.repository.owner,
							repo: deps.repository.repo,
							title: `Positron: ${current.issueNumber ? `Issue #${current.issueNumber} — ` : ''}Automated changes`,
							head: branch,
							base: deps.repository.defaultBranch ?? 'main',
							body,
						});
					}
				} catch (listErr) {
					// If listPullRequests fails, fall through to create (best effort)
					pr = await deps.github.createPullRequest({
						owner: deps.repository.owner,
						repo: deps.repository.repo,
						title: `Positron: ${current.issueNumber ? `Issue #${current.issueNumber} — ` : ''}Automated changes`,
						head: branch,
						base: deps.repository.defaultBranch ?? 'main',
						body,
					});
				}

				// --- R5: Fault Injection Hook ---
				// Only fires when PR was newly created (not adopted) and env var is set
				const faultPoint = process.env.POSITRON_FAULT_INJECTION_POINT;
				const faultRunId = process.env.POSITRON_FAULT_RUN_ID;
				if (
					!prWasAdopted &&
					isFaultTargetedToRun(faultRunId, current) &&
					faultPoint === 'AFTER_REMOTE_DRAFT_PR_CREATE_BEFORE_LOCAL_SUCCESS_CHECKPOINT'
				) {
					storeEvent(
						{
							id: createRunId(),
							runId: current.id,
							phase: 'PR_CREATE',
							level: 'WARN',
							message: `FAULT INJECTED: Terminating after PR #${pr.number} creation, before local checkpoint`,
							payload: { prNumber: pr.number, faultPoint, prWasAdopted: false },
							createdAt: new Date().toISOString(),
						},
						deps,
					);
					// Persist the run in PR_CREATE state before termination
					saveRunToDb({ ...current, phase: 'PR_CREATE', status: 'active' }, deps);
					process.exit(1);
				}

				if (deps.syncService) {
					const syncInput: GitHubStatusSyncInput = {
						runId: current.id,
						owner: deps.repository.owner,
						repo: deps.repository.repo,
						issueNumber: current.issueNumber,
						phase: 'PR_CREATE',
						status: 'success',
						branchName: branch,
						prNumber: pr.number,
						prUrl: pr.htmlUrl,
						evidence,
					};
					await safeSync(
						deps.syncService,
						() => deps.syncService!.syncPrCreated(syncInput),
						current.id,
						'PR_CREATE',
						deps,
					);
				}

				const prReviewers = process.env.POSITRON_PR_REVIEWERS?.split(',')
					.map((s) => s.trim())
					.filter(Boolean);
				const prTeamReviewers = process.env.POSITRON_PR_TEAM_REVIEWERS?.split(',')
					.map((s) => s.trim())
					.filter(Boolean);
				if (prReviewers?.length || prTeamReviewers?.length) {
					try {
						await deps.github.requestReviewers({
							owner: deps.repository.owner,
							repo: deps.repository.repo,
							prNumber: pr.number,
							reviewers: prReviewers,
							teamReviewers: prTeamReviewers,
						});
					} catch {
						/* best-effort */
					}
				}

				if (phaseRequiresGates('MERGE')) {
					const gateCtx: GateEvaluationContext = {
						runId: current.id,
						phase: current.phase,
						targetPhase: 'MERGE',
						gateTypes: getRequiredGates('MERGE'),
					};
					result = tryTransitionWithGates(
						current,
						'MERGE',
						`PR #${pr.number} created: ${pr.htmlUrl}`,
						gateCtx,
						'INFO',
						null,
					);
				} else {
					result = transition(current, 'MERGE', `PR #${pr.number} created: ${pr.htmlUrl}`, 'INFO');
				}
			} catch (err) {
				storeEvent(
					{
						id: createRunId(),
						runId: current.id,
						phase: 'PR_CREATE',
						level: 'ERROR',
						message: `PR creation failed: ${String(err).slice(0, 200)}`,
						payload: null,
						createdAt: new Date().toISOString(),
					},
					deps,
				);
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

			const mergeAllowed = process.env.POSITRON_ENABLE_MERGE === 'true';
			const mergeDryRun = process.env.POSITRON_MERGE_DRY_RUN === 'true';
			const mergeKillSwitch = process.env.POSITRON_MERGE_KILL_SWITCH !== 'false';
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

			let pr: Awaited<ReturnType<typeof deps.github.listPullRequests>>[0] | null = null;
			try {
				const prs = await deps.github.listPullRequests({
					owner: deps.repository.owner,
					repo: deps.repository.repo,
					head: `${deps.repository.owner}:${branch}`,
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

			if (mergeDryRun) {
				let mergeableState = 'checking';
				const maxMergeableRetries = 3;
				const mergeableRetryDelay = 5000;

				for (let retry = 0; retry <= maxMergeableRetries; retry++) {
					try {
						const prDetail = await deps.github.getPullRequest(
							deps.repository.owner,
							deps.repository.repo,
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
						if (retry < maxMergeableRetries) {
							await new Promise((r) => setTimeout(r, mergeableRetryDelay));
						}
					} catch {
						break;
					}
				}

				const testEvent = getEvents(current.id, deps).find(
					(e) => e.phase === 'TEST' && e.level === 'INFO',
				);
				const allGates: Array<{ gate: string; passed: boolean; detail: string }> = [
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
					{ gate: 'Branch', passed: !!current.branch, detail: `Branch: ${current.branch}` },
					{ gate: 'PR Open', passed: pr.state === 'open', detail: `PR state: ${pr.state}` },
					{
						gate: 'Mergeable',
						passed: mergeableState === 'clean',
						detail: `GitHub mergeable: ${mergeableState}`,
					},
				];

				const allPassed = allGates.every((g) => g.passed);
				const decision = allPassed ? 'WOULD_MERGE' : 'WOULD_BLOCK';
				const blockedGates = allGates.filter((g) => !g.passed);

				storeEvent(
					{
						id: createRunId(),
						runId: current.id,
						phase: 'MERGE',
						level: 'GATE' as EventLevel,
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
					},
					deps,
				);

				try {
					const gateList = allGates
						.map((g) => `- ${g.passed ? '✅' : '❌'} **${g.gate}:** ${g.detail}`)
						.join('\n');
					await deps.github.createIssueComment(
						{
							owner: deps.repository.owner,
							repo: deps.repository.repo,
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
				const mergeResult = await deps.github.mergePullRequest({
					owner: deps.repository.owner,
					repo: deps.repository.repo,
					prNumber: pr.number,
					strategy: 'squash',
					commitTitle: `Positron: Issue #${current.issueNumber} — Automated changes`,
					commitMessage: `Run: ${current.id.slice(0, 8)}`,
				});

				if (mergeResult.merged) {
					if (deps.syncService) {
						const syncInput: GitHubStatusSyncInput = {
							runId: current.id,
							owner: deps.repository.owner,
							repo: deps.repository.repo,
							issueNumber: current.issueNumber,
							phase: 'MERGE',
							status: 'success',
							branchName: mergeResult.sha,
							prNumber: pr.number,
							prUrl: pr.htmlUrl,
						};
						await safeSync(
							deps.syncService,
							() => deps.syncService!.syncMerged(syncInput),
							current.id,
							'MERGE',
							deps,
						);
					}
					try {
						await deps.github.closeIssue(
							deps.repository.owner,
							deps.repository.repo,
							current.issueNumber,
						);
					} catch {
						/* best-effort */
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
				storeEvent(
					{
						id: createRunId(),
						runId: current.id,
						phase: 'MERGE',
						level: 'WARN',
						message: `Merge failed: ${String(err).slice(0, 200)}`,
						payload: null,
						createdAt: new Date().toISOString(),
					},
					deps,
				);
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
		default:
			return current;
	}

	if (result.ok) {
		storeEvent(result.event, deps);
		return result.run;
	}
	storeEvent(result.event, deps);
	return current;
}

// ---------------------------------------------------------------------------
// Main Pipeline Loop (Worker Version)
//
// NOTE: SSE live-streaming is NOT available for worker-processed runs.
// The worker persists run state to the DB after each phase transition,
// so GET /api/runs/:id and polling-based UIs always see current state.
// Real-time SSE updates are only available for inline-executed runs
// (when Redis is unavailable and the fallback is used).
//
// Signal checking (PAUSE/ABORT/RESUME/RETRY) reads from the `run_signals`
// DB table, shared with the server process.
// ---------------------------------------------------------------------------

/**
 * Check for an active run-control signal from the shared `run_signals` table.
 * Returns the signal name or null. Inline to avoid importing from apps/server.
 */
function checkSignal(db: Database.Database, runId: string, phase?: string): string | null {
	try {
		let row: { signal: string } | undefined;
		if (phase) {
			row = db
				.prepare(`
        SELECT signal FROM run_signals
        WHERE run_id = ? AND (target_phase = ? OR target_phase IS NULL)
        ORDER BY created_at DESC LIMIT 1
      `)
				.get(runId, phase) as { signal: string } | undefined;
		} else {
			row = db
				.prepare(`
        SELECT signal FROM run_signals
        WHERE run_id = ? ORDER BY created_at DESC LIMIT 1
      `)
				.get(runId) as { signal: string } | undefined;
		}
		return row?.signal ?? null;
	} catch {
		return null; // table may not exist yet
	}
}

export async function runPipeline(run: RunState, deps: PipelineDeps): Promise<RunState> {
	let current = run;
	const maxSteps = 20;
	let attempt = 0;

	// Issue #421: Der Run wird VOR der ersten Phase persistiert, damit alle
	// nachfolgenden Artefakte/Jobs an einen existierenden Run gebunden sind
	// (FK-Integrität) und ein Crash in der ersten Phase einen sichtbaren
	// durable Run hinterlässt.
	saveRunToDb(run, deps);

	// P3: INTAKE-Job (find-or-create) — der Run ist ab sofort Teil der
	// kanonischen cp_jobs-Hierarchie (INTAKE → … → DECIDE).
	ensureControlPlane(getDb(deps));
	{
		const db = getDb(deps);
		const existingIntake = db
			.prepare("SELECT job_id FROM cp_jobs WHERE run_id = ? AND job_type = 'intake' LIMIT 1")
			.get(current.id) as Record<string, unknown> | undefined;
		if (!existingIntake) {
			const intakeJob = createJob(db, current.id, 'intake');
			updateJobState(db, intakeJob.job_id, 'succeeded');
		}
	}

	const envMaxRetries = process.env.POSITRON_MAX_FIX_LOOPS
		? Number.parseInt(process.env.POSITRON_MAX_FIX_LOOPS, 10)
		: undefined;
	const maxAttempts = envMaxRetries && !Number.isNaN(envMaxRetries) ? envMaxRetries : MAX_FIX_LOOPS;
	const fixLoopEnabled = process.env.POSITRON_ENABLE_FIX_LOOP === 'true';
	let lastRetryTime = 0;

	for (let i = 0; i < maxSteps; i++) {
		// Check control signals (shared with server via run_signals DB table)
		const sig = checkSignal(deps.db, current.id, current.phase);
		if (sig?.toLowerCase() === 'abort') {
			const cancelled = {
				...current,
				status: 'cancelled' as RunState['status'],
				finishedAt: new Date().toISOString(),
			};
			storeEvent(
				{
					id: createRunId(),
					runId: current.id,
					phase: current.phase,
					level: 'INFO',
					message: 'Run aborted by user (worker)',
					payload: { action: 'abort' },
					createdAt: new Date().toISOString(),
				},
				deps,
			);
			saveRunToDb(cancelled, deps);
			return cancelled;
		}
		if (sig?.toLowerCase() === 'pause') {
			// Worker pause: wait and re-check signal
			storeEvent(
				{
					id: createRunId(),
					runId: current.id,
					phase: current.phase,
					level: 'INFO',
					message: 'Run paused by user (worker — waiting)',
					payload: null,
					createdAt: new Date().toISOString(),
				},
				deps,
			);
			while (true) {
				await new Promise((r) => setTimeout(r, 3000));
				const s = checkSignal(deps.db, current.id, current.phase);
				if (s?.toLowerCase() === 'abort') {
					const cancelled = {
						...current,
						status: 'cancelled' as RunState['status'],
						finishedAt: new Date().toISOString(),
					};
					storeEvent(
						{
							id: createRunId(),
							runId: current.id,
							phase: current.phase,
							level: 'INFO',
							message: 'Run aborted while paused (worker)',
							payload: null,
							createdAt: new Date().toISOString(),
						},
						deps,
					);
					saveRunToDb(cancelled, deps);
					return cancelled;
				}
				if (s?.toLowerCase() === 'resume' || s === null) break;
			}
		}

		let next = await executePhase(current, deps);
		if (next.phase === current.phase || next.phase === 'DONE' || next.phase.startsWith('FAILED')) {
			// --- Fix-Loop (Issue #421: delta-based retry policy) ---
			if (fixLoopEnabled && next.phase === 'FAILED_TRANSIENT' && attempt < maxAttempts) {
				// Retry nur bei Information Gain. Wenn ein Build-Attempt
				// existiert, entscheidet die Retry Policy — identische
				// Versuche (gleiches Input-Fingerprint, gleiche Signatur,
				// gleiches Modell, kein Delta) werden abgelehnt:
				// kein zweiter LLM-Aufruf für identische Versuche.
				const lastBuildAttempt = loadLastAttempt(next.id, 'build', deps);
				const retryDecision = lastBuildAttempt
					? evaluateRetry({
							attemptNumber: attempt + 1,
							maxAttempts,
							previousAttempt: lastBuildAttempt,
							inputFingerprint: lastBuildAttempt.input_fingerprint ?? '',
							worker: {
								workerType: lastBuildAttempt.worker_type ?? 'opencode',
								provider: lastBuildAttempt.provider,
								model: lastBuildAttempt.model,
							},
							newEvidence: lastBuildAttempt.new_evidence ?? null,
							strategyDelta: lastBuildAttempt.strategy_delta ?? null,
							contextFingerprint: null,
						})
					: null;

				if (retryDecision && retryDecision.verdict === 'DENIED') {
					// Kein Information Gain → hart blockiert, kein weiterer
					// API-Verbrauch für identische Versuche.
					const denied = markFailed(next, 'FAILED_BLOCKED', retryDecision.reason_code);
					storeEvent(denied.event, deps);
					storeEvent(
						{
							id: createRunId(),
							runId: next.id,
							phase: 'FAILED_BLOCKED',
							level: 'ERROR',
							message: `Retry denied: ${retryDecision.reason_code}`,
							payload: { reasonCode: retryDecision.reason_code, delta: retryDecision.delta },
							createdAt: new Date().toISOString(),
						},
						deps,
					);
					next = denied.run;
					// fällt in den Terminal-Pfad unten (Sync/Save/Cleanup)
				} else {
					attempt++;

					const allTransient = getEvents(next.id, deps).filter(
						(e: RunEventData) => e.phase === 'FAILED_TRANSIENT',
					);
					const transientEvent = allTransient[allTransient.length - 1];
					const failedPhase = (transientEvent?.payload as Record<string, unknown> | null)
						?.failedPhase as string | undefined;
					// P3: Fix-Loop wiederholt NUR Build/Verify-Schritte
					// (IMPLEMENT/TEST/VERIFY). Research/Plan/Specify/Tasks/
					// Analyze werden beim Fix NIE erneut ausgeführt
					// (Recovery-Semantik, §15). Ein unerwarteter failedPhase
					// fällt auf IMPLEMENT (neuer Build-Attempt mit Delta).
					const retryFromPhase =
						failedPhase &&
						failedPhase !== 'FAILED_TRANSIENT' &&
						(failedPhase === 'IMPLEMENT' || failedPhase === 'TEST' || failedPhase === 'VERIFY')
							? failedPhase
							: 'IMPLEMENT';

					const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 30000);
					const now = Date.now();
					const timeSinceLastRetry = now - lastRetryTime;
					if (timeSinceLastRetry < backoffMs) {
						await new Promise((r) => setTimeout(r, backoffMs - timeSinceLastRetry));
					}
					lastRetryTime = Date.now();

					storeEvent(
						{
							id: createRunId(),
							runId: next.id,
							phase: retryFromPhase as Phase,
							level: 'WARN',
							message: `Fix-Loop retry ${attempt}/${maxAttempts} — phase: ${retryFromPhase}, backoff: ${backoffMs}ms`,
							payload: { attempt, maxAttempts, retryFromPhase, backoffMs },
							createdAt: new Date().toISOString(),
						},
						deps,
					);

					current = {
						...next,
						phase: retryFromPhase as Phase,
						status: 'active',
						attempt,
						lastError: null,
					};
					continue;
				}
			}

			// P3: DECIDE — persistierte, deterministische End-Entscheidung.
			// Der Live-Pfad hat damit dieselbe Decision-Boundary wie
			// runDurableRun (cp_decisions + decide-Job, traceable).
			{
				const db = getDb(deps);
				const existingDecision = db
					.prepare('SELECT decision_id FROM cp_decisions WHERE run_id = ? LIMIT 1')
					.get(next.id) as Record<string, unknown> | undefined;
				if (!existingDecision) {
					let decision: string;
					let reasonCode: string;
					if (next.phase === 'DONE') {
						decision = 'DONE';
						reasonCode = 'ALL_HARD_GATES_GREEN';
					} else if (next.phase === 'FAILED_BLOCKED') {
						decision = 'BLOCKED';
						reasonCode = 'POLICY_BLOCK';
					} else if (next.phase.startsWith('FAILED')) {
						decision = 'BLOCKED';
						reasonCode = 'PIPELINE_FAILED';
					} else if (next.status === 'cancelled') {
						decision = 'BLOCKED';
						reasonCode = 'RUN_CANCELLED';
					} else {
						decision = 'BLOCKED';
						reasonCode = 'NO_VERIFICATION';
					}
					storeDecision(
						db,
						next.id,
						decision,
						reasonCode,
						JSON.stringify({
							contract: 'positron.decision.v1',
							run_id: next.id,
							decision,
							reason_code: reasonCode,
							basis: { phase: next.phase, message: next.lastError ?? null },
						}),
					);
					const decideJob = createJob(db, next.id, 'decide');
					updateJobState(db, decideJob.job_id, 'succeeded');
				}
			}

			// Sync terminal state
			if (deps.syncService) {
				const syncInput: GitHubStatusSyncInput = {
					runId: next.id,
					owner: deps.repository.owner,
					repo: deps.repository.repo,
					issueNumber: next.issueNumber,
					phase: next.phase,
					status: next.phase === 'DONE' ? 'done' : 'failed',
					branchName: next.branch ?? undefined,
					evidence: buildEvidence(next),
				};
				if (next.phase === 'DONE') {
					await safeSync(
						deps.syncService,
						() => deps.syncService!.syncDone(syncInput),
						next.id,
						'DONE',
						deps,
					);
				} else if (next.phase === 'FAILED_BLOCKED') {
					await safeSync(
						deps.syncService,
						() =>
							deps.syncService!.syncBlocked({
								...syncInput,
								error: { type: 'blocked', message: 'Run blocked: max steps or policy violation' },
							}),
						next.id,
						'FAILED_BLOCKED',
						deps,
					);
				} else if (next.phase.startsWith('FAILED')) {
					await safeSync(
						deps.syncService,
						() =>
							deps.syncService!.syncFailed({
								...syncInput,
								error: { type: 'failed', message: `Run failed in phase ${next.phase}` },
							}),
						next.id,
						next.phase,
						deps,
					);
				}
			}
			saveRunToDb(next, deps);
			// Issue #244: Run workspace cleanup on terminal phase
			runCleanup(next)
				.then((cleanupResult) => {
					if (!cleanupResult.cleaned) {
						console.warn(`[Worker] Workspace cleanup: ${cleanupResult.reason ?? 'unknown'}`, {
							runId: next.id,
						});
					}
				})
				.catch((err) => {
					console.error(
						`[Worker] Workspace cleanup error: ${err instanceof Error ? err.message : String(err)}`,
						{ runId: next.id },
					);
				});
			return next;
		}
		current = next;
		saveRunToDb(current, deps); // Persist after each phase so polling UIs see progress
	}
	// Timeout
	const result = markFailed(current, 'FAILED_BLOCKED', 'Max steps exceeded');
	storeEvent(result.event, deps);
	if (deps.syncService) {
		const syncInput: GitHubStatusSyncInput = {
			runId: result.run.id,
			owner: deps.repository.owner,
			repo: deps.repository.repo,
			issueNumber: result.run.issueNumber,
			phase: 'FAILED_BLOCKED',
			status: 'blocked',
			branchName: result.run.branch ?? undefined,
			error: { type: 'blocked', message: 'Max steps exceeded (timeout)' },
		};
		await safeSync(
			deps.syncService,
			() => deps.syncService!.syncBlocked(syncInput),
			result.run.id,
			'FAILED_BLOCKED',
			deps,
		);
	}
	saveRunToDb(result.run, deps);
	// Issue #244: Run workspace cleanup on timeout/terminal
	runCleanup(result.run)
		.then((cleanupResult) => {
			if (!cleanupResult.cleaned) {
				console.warn(`[Worker] Workspace cleanup: ${cleanupResult.reason ?? 'unknown'}`, {
					runId: result.run.id,
				});
			}
		})
		.catch((err) => {
			console.error(
				`[Worker] Workspace cleanup error: ${err instanceof Error ? err.message : String(err)}`,
				{ runId: result.run.id },
			);
		});
	return result.run;
}
