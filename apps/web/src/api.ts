// Positron Web — API Client

import { parsePhase } from '@positron/shared';
import type {
	ApiError,
	Artifact,
	HealthStatus,
	Issue,
	ManagedTargetProject,
	Metrics,
	Repository,
	Run,
	RunEvent,
} from './types.js';
import type { Phase, RunStatus } from './types.js';

const BASE = '/api';

// ── Control Plane Types (P2 — Backend Truth, read-only) ──────────
// Diese Typen spiegeln 1:1 die Antwortformen der Backend-Truth-Endpunkte
// GET /api/runs/:id/control-plane und GET /api/kpis. Die UI erfindet,
// rekonstruiert oder simuliert hier keinen Zustand.

export interface ControlPlaneJob {
	job_id: string;
	run_id: string;
	job_type: string;
	state: string;
	parent_job_id: string | null;
	created_at: string;
	updated_at: string;
}

export interface ControlPlaneAttempt {
	attempt_id: string;
	run_id: string;
	job_id: string;
	status: string;
	input_contract: string | null;
	input_fingerprint: string | null;
	output_contract: string | null;
	output_fingerprint: string | null;
	worker_type: string | null;
	provider: string | null;
	model: string | null;
	started_at: string;
	ended_at: string | null;
	failure_class: string | null;
	failure_signature: string | null;
	new_evidence: string | null;
	strategy_delta: string | null;
	result_ref: string | null;
	/** Strukturierte Verify-Gate-Checks (Backend-Truth, nur verification-Attempts) */
	checks?: Array<{ name: string; passed: boolean; kind: string }> | null;
	// P5.1 — Harness Profile Identity & Provenance (sichere Metadaten,
	// Backend-Truth; historische Attempts: null + LEGACY_PROFILE_UNSPECIFIED)
	harness_profile_id?: string | null;
	harness_profile_version?: string | null;
	harness_fingerprint?: string | null;
	task_profile_id?: string | null;
	task_profile_version?: string | null;
	task_type?: string | null;
	provider_adapter_id?: string | null;
	provider_adapter_version?: string | null;
	model_provenance_status?: string | null;
}

export interface ControlPlaneDecision {
	decision_id: string;
	run_id: string;
	decision: string;
	reason_code: string;
	contract: string | null;
	created_at: string;
}

export interface ControlPlaneTransition {
	transition_id: string;
	run_id: string;
	previous_state: string;
	new_state: string;
	reason_code: string;
	created_at: string;
}

export interface ControlPlaneResponse {
	run_id: string;
	jobs: ControlPlaneJob[];
	attempts: ControlPlaneAttempt[];
	decisions: ControlPlaneDecision[];
	transitions: ControlPlaneTransition[];
}

export interface KpiReport {
	runs_total: number;
	done_runs: number;
	first_pass_success_rate: number | null;
	mean_attempts_to_done: number | null;
	blind_retry_rate: number;
	retry_denials: number;
	duplicate_mutation_rate: number;
	contract_validation_failure_rate: number | null;
	plan_gate_rejection_rate: number | null;
	security_block_enforcement_rate: number | null;
	useful_retry_rate: number | null;
	trace_completeness: number | null;
	p50_stage_duration_ms: number | null;
	p95_stage_duration_ms: number | null;
}

export interface ProfileKpiGroup {
	effective_harness_fingerprint: string;
	harness_profile_id: string | null;
	harness_profile_version: string | null;
	task_profile_id: string | null;
	task_profile_version: string | null;
	task_type: string | null;
	provider: string | null;
	model: string | null;
	provider_adapter_id: string | null;
	provider_adapter_version: string | null;
	model_provenance_status: string | null;
	sample_size: number;
	verified_success_count: number;
	verified_success_rate: number | null;
	first_pass_success_count: number;
	first_pass_success_rate: number | null;
	attempts: number;
	attempts_per_verified_success: number | null;
	time_to_verified_success_ms: number | null;
	retry_rate: number | null;
	escalation_rate: number | null;
	tokens_total: number | null;
	cost_per_verified_success: string;
}

export interface KpisResponse {
	kpis: KpiReport;
	profile?: { groups: ProfileKpiGroup[]; generated_at: string; cost_per_verified_success: string };
	invariants: { violations: string[] };
}

// ── P4 Scheduler Types (Backend Truth) ────────────────────────────

export interface SchedulerQueueItem {
	queue_item_id: string;
	source_type: string;
	source_ref: string;
	repository_ref: string;
	run_id: string | null;
	priority: string;
	queue_state: string;
	dependency_refs: string[];
	enqueued_at: string;
	admitted_at: string | null;
	started_at: string | null;
	finished_at: string | null;
	reason_code: string | null;
}

export interface SchedulerCapacity {
	maxActiveRuns: number;
	activeRuns: number;
	queueDepth: number;
	waitingDependency: number;
	waitingResource: number;
}

export interface SchedulerEvent {
	queue_item_id: string;
	run_id: string | null;
	event: string;
	timestamp: string;
	reason_code: string;
}

export interface SchedulerQueueResponse {
	queue: SchedulerQueueItem[];
	capacity: SchedulerCapacity;
}

// ── Admin API Types & Token Management (Issue #11) ────────────

export interface AdminStats {
	runs: { total: number; active: number; failed: number; done: number };
	repositories: number;
	events: number;
	artifacts: number;
	dbSizeMb: number;
}

/** Read the stored admin token from localStorage */
export function getAdminToken(): string {
	try {
		return localStorage.getItem('positron_admin_token') ?? '';
	} catch {
		return '';
	}
}

/** Persist the admin token to localStorage */
export function setAdminToken(token: string): void {
	try {
		localStorage.setItem('positron_admin_token', token);
	} catch {
		/* ignore */
	}
}

async function adminRequest<T>(path: string, options?: RequestInit): Promise<T> {
	const token = getAdminToken();
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		'X-Admin-Token': token,
		...((options?.headers as Record<string, string> | undefined) ?? {}),
	};
	const res = await fetch(`${BASE}${path}`, {
		...options,
		headers,
	});
	if (!res.ok) {
		const err = (await res.json().catch(() => ({
			error: res.statusText,
		}))) as ApiError;
		// Include HTTP status code in the error for client-side handling
		throw Object.assign(new Error(err.error ?? res.statusText), {
			status: res.status,
		});
	}
	return res.json() as Promise<T>;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		headers: {
			'Content-Type': 'application/json',
			...options?.headers,
		},
		...options,
	});
	if (!res.ok) {
		const err = (await res.json().catch(() => ({
			error: res.statusText,
		}))) as ApiError;
		throw new Error(err.error ?? res.statusText);
	}
	return res.json() as Promise<T>;
}

export const api = {
	// Health
	getHealth(): Promise<HealthStatus> {
		return request<HealthStatus>('/health');
	},

	// Repositories
	getRepos(): Promise<{ repos: Repository[]; total: number }> {
		return request<{ repos: Repository[]; total: number }>('/repos');
	},

	createRepo(owner: string, name: string): Promise<Repository> {
		return adminRequest<Repository>('/repos', {
			method: 'POST',
			body: JSON.stringify({ owner, name }),
		});
	},

	// Managed Target Projects (generische Registry externer Zielprojekte)
	getManagedTargetProjects(): Promise<{ projects: ManagedTargetProject[]; total: number }> {
		return request<{ projects: ManagedTargetProject[]; total: number }>('/projects');
	},

	getRepoIssues(repoId: string): Promise<{ issues: Issue[] }> {
		return request<{ issues: Issue[] }>(`/repos/${repoId}/issues`);
	},

	// Runs
	getRuns(params?: {
		page?: number;
		limit?: number;
		repoId?: string;
	}): Promise<{ runs: Run[]; total: number }> {
		const searchParams = new URLSearchParams();
		if (params?.page) searchParams.set('page', String(params.page));
		if (params?.limit) searchParams.set('limit', String(params.limit));
		if (params?.repoId) searchParams.set('repoId', params.repoId);
		const qs = searchParams.toString();
		return request<{ runs: Run[]; total: number }>(`/runs${qs ? `?${qs}` : ''}`);
	},

	getRunById(id: string): Promise<{ run: Run; events: RunEvent[] }> {
		return request<{ run: Run; events: RunEvent[] }>(`/runs/${id}`);
	},

	createRun(issueUrl: string): Promise<{ run: Run; runId: string }> {
		return adminRequest<{ run: Run; runId: string }>('/runs', {
			method: 'POST',
			body: JSON.stringify({ issueUrl }),
		});
	},

	startRun(
		repoId: string,
		issueNumber: number,
		autonomyLevel?: number,
	): Promise<{ run: Run; events: RunEvent[]; eventCount: number }> {
		return adminRequest<{ run: Run; events: RunEvent[]; eventCount: number }>(
			`/repos/${repoId}/runs`,
			{
				method: 'POST',
				body: JSON.stringify({ issueNumber, autonomyLevel }),
			},
		);
	},

	controlRun(
		runId: string,
		action: 'pause' | 'resume' | 'abort' | 'retry',
	): Promise<{ success: boolean }> {
		return adminRequest<{ success: boolean }>(`/runs/${runId}/control`, {
			method: 'POST',
			body: JSON.stringify({ action }),
		});
	},

	// Gates
	approveGate(runId: string, reason?: string): Promise<{ success: boolean }> {
		return adminRequest<{ success: boolean }>(`/runs/${runId}/gate`, {
			method: 'POST',
			body: JSON.stringify({ action: 'approve', reason }),
		});
	},

	reviseGate(runId: string, reason: string): Promise<{ success: boolean }> {
		return adminRequest<{ success: boolean }>(`/runs/${runId}/gate`, {
			method: 'POST',
			body: JSON.stringify({ action: 'revise', reason }),
		});
	},

	// Artifacts
	getArtifact(runId: string, kind: 'spec' | 'plan' | 'tasks' | 'diff'): Promise<Artifact> {
		return request<Artifact>(`/runs/${runId}/artifacts/${kind}`);
	},

	// Metrics
	async getMetrics(): Promise<Metrics> {
		// The backend returns a nested structure: { metrics: { runs: { total, active, done, failed, blocked }, ... } }
		// The frontend expects a flat structure: { totalRuns, runsByPhase, runsByStatus, avgDurationMs, successRate }
		const data = await request<{
			metrics: {
				runs: { total: number; active: number; done: number; failed: number; blocked: number };
				repositories: { total: number };
				phaseDistribution: Array<{ phase: string; count: number }>;
				avgRunDurationMs: number | null;
				timestamp: string;
			};
		}>('/metrics');

		const m = data.metrics;
		const totalRuns = m.runs.total;
		const doneRuns = m.runs.done;
		const successRate = totalRuns > 0 ? Math.round((doneRuns / totalRuns) * 100) : 0;

		// Build runsByPhase from phaseDistribution
		const runsByPhase: Partial<Record<Phase, number>> = {};
		if (Array.isArray(m.phaseDistribution)) {
			for (const entry of m.phaseDistribution) {
				try {
					runsByPhase[parsePhase(entry.phase)] = entry.count;
				} catch {
					/* ungültige Phase ignorieren */
				}
			}
		}

		// Build runsByStatus from runs breakdown
		const runsByStatus: Partial<Record<RunStatus, number>> = {
			active: m.runs.active,
			done: m.runs.done,
			failed: m.runs.failed,
			blocked: m.runs.blocked,
		};

		return {
			totalRuns,
			runsByPhase,
			runsByStatus,
			avgDurationMs: m.avgRunDurationMs ?? 0,
			successRate,
		};
	},

	// Evidence (aggregated)
	getEvidence(runId?: string): Promise<{
		evidence?: Array<{
			id: string;
			type: string;
			kind: string;
			source: string;
			sourceId: string;
			status: 'pass' | 'fail' | 'partial';
			summary: string;
			timestamp: string;
			runPhase?: string;
		}>;
		total?: number;
		summary?: {
			totalArtifacts: number;
			artifactBreakdown: Record<string, number>;
			testEvents: number;
			errorEvents: number;
			warningEvents: number;
		};
		runId?: string;
	}> {
		const qs = runId ? `?runId=${encodeURIComponent(runId)}` : '';
		return request(`/evidence${qs}`);
	},

	// Evidence Write-Back (Issue #85)
	saveEvidence(
		runId: string,
		kind: string,
		content: string,
	): Promise<{ success: boolean; kind: string; createdAt: string }> {
		return adminRequest('/evidence', {
			method: 'POST',
			body: JSON.stringify({ runId, kind, content }),
		});
	},

	// Settings — MCP Configuration (masked)
	getMcpSettings(): Promise<{
		servers: Array<{
			name: string;
			command: string;
			description: string;
			disabled: boolean;
			envKeys: string[];
			hasToken: boolean;
		}>;
		policy: Record<string, unknown>;
		redactPatternCount: number;
		configured: number;
		totalServers: number;
	}> {
		return request('/settings/mcp');
	},

	// Settings — Test Modes
	getTestModes(): Promise<{
		modes: Array<{
			id: string;
			label: string;
			command: string;
			visible: boolean;
			description: string;
		}>;
		securityNotes: Record<string, string>;
		defaultMode: string;
		observationMode: string;
		totalModes: number;
	}> {
		return request('/settings/test-modes');
	},

	// Safety state
	getSafety(): Promise<{
		enableMerge: boolean;
		mergeDryRun: boolean;
		enablePush: boolean;
		killSwitch: boolean;
		enableFixLoop: boolean;
	}> {
		return request('/safety');
	},

	// Update a single safety flag (Issue #25)
	updateSafety(
		key: string,
		value: boolean,
	): Promise<{
		ok: boolean;
		key: string;
		value: boolean;
		all: Record<string, boolean>;
	}> {
		return adminRequest('/safety', {
			method: 'POST',
			body: JSON.stringify({ key, value }),
		});
	},

	// Cancel run (Issue #66)
	cancelRun(runId: string): Promise<{
		ok: boolean;
		runId: string;
		message: string;
		previousStatus?: string;
		status: string;
	}> {
		return adminRequest(`/runs/${runId}/cancel`, { method: 'POST' });
	},

	// Test Report (Issue #68)
	getTestReport(runId: string): Promise<{
		runId: string;
		summary: { total: number; passed: number; failed: number; errors: number; warnings: number };
		testEvents: Array<{
			id: string;
			runId: string;
			level: string;
			message: string;
			payload: Record<string, unknown> | null;
			createdAt: string;
		}>;
	}> {
		return request(`/runs/${runId}/test-report`);
	},

	// Demo Run (Issue #68)
	startDemoRun(
		blueprint?: string,
		issueNumber?: number,
	): Promise<{
		run: Run;
		message: string;
		blueprint: string;
	}> {
		return adminRequest('/demo-runs', {
			method: 'POST',
			body: JSON.stringify({ blueprint, issueNumber }),
		});
	},

	// Blueprint from GitHub issue (Issue #14 + #15)
	getBlueprint(
		owner: string,
		repo: string,
		issueNumber: number,
	): Promise<{
		blueprint: string;
		repoId: string;
		issueNumber: number;
		generatedAt: string;
	}> {
		return request(
			`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}/blueprint`,
		);
	},

	// ── Control Plane (P2 — read-only Backend Truth) ───────────────

	/** Durable control-plane state (jobs/attempts/decisions/transitions) */
	getControlPlane(runId: string): Promise<ControlPlaneResponse> {
		return request<ControlPlaneResponse>(`/runs/${encodeURIComponent(runId)}/control-plane`);
	},

	/** Runtime KPIs + Invarianten-Violations */
	getKpis(): Promise<KpisResponse> {
		return request<KpisResponse>('/kpis');
	},

	// ── P4 Scheduler (read-only Backend Truth) ─────────────────────

	/** Intake-Queue + Kapazität */
	getSchedulerQueue(): Promise<SchedulerQueueResponse> {
		return request<SchedulerQueueResponse>('/scheduler/queue');
	},

	/** Aktive Runs (Scheduler-Sicht) */
	getSchedulerActive(): Promise<{ activeRuns: SchedulerQueueItem[] }> {
		return request<{ activeRuns: SchedulerQueueItem[] }>('/scheduler/active');
	},

	/** Globale Kapazität */
	getSchedulerCapacity(): Promise<SchedulerCapacity> {
		return request<SchedulerCapacity>('/scheduler/capacity');
	},

	/** Scheduler-Events (optional gefiltert je Item) */
	getSchedulerEvents(queueItemId?: string): Promise<{ events: SchedulerEvent[] }> {
		const qs = queueItemId ? `?queue_item_id=${encodeURIComponent(queueItemId)}` : '';
		return request<{ events: SchedulerEvent[] }>(`/scheduler/events${qs}`);
	},

	// ── Admin API (Issue #11) ──────────────────────────────────────

	/** Admin dashboard statistics */
	getAdminStats(): Promise<AdminStats> {
		return adminRequest<AdminStats>('/admin/stats');
	},

	/** Bulk-cancel all active/blocked runs */
	bulkCancelRuns(): Promise<{ cancelled: number }> {
		return adminRequest<{ cancelled: number }>('/admin/runs/bulk-cancel', { method: 'POST' });
	},

	/** Bulk-retry all failed/blocked runs */
	bulkRetryRuns(): Promise<{ retried: number }> {
		return adminRequest<{ retried: number }>('/admin/runs/bulk-retry', { method: 'POST' });
	},

	/** Cleanup old events (7d) and VACUUM database */
	cleanupRuns(): Promise<{ eventsDeleted: number; dbSizeMb: number }> {
		return adminRequest<{ eventsDeleted: number; dbSizeMb: number }>('/admin/runs/cleanup', {
			method: 'POST',
		});
	},
};
