// Positron Web — Frontend Typdefinitionen
// Hinweis: Phase und RunStatus sind kompatibel mit dem Backend (@positron/shared)

export type Phase =
	| 'QUEUED'
	| 'CLAIMED'
	| 'REPO_SYNC'
	| 'ISSUE_CONTEXT'
	| 'WEB_RESEARCH'
	| 'SPECIFY'
	| 'CLARIFY_OPTIONAL'
	| 'PLAN'
	| 'TASKS'
	| 'ANALYZE'
	| 'REVIEW'
	| 'IMPLEMENT'
	| 'TEST'
	| 'VERIFY'
	| 'COMMIT'
	| 'PR_CREATE'
	| 'MERGE'
	| 'DONE'
	| 'FAILED'
	| 'FAILED_TRANSIENT'
	| 'FAILED_BLOCKED'
	| 'FAILED_UNSAFE'
	| 'BLOCKED_PUSH'
	| 'BLOCKED_MERGE'
	| 'GATE_APPROVE'
	| 'GATE_REVISE'
	| 'RESUME_PENDING'
	| 'CLEANUP';

// Issue #23: Kanonische ALL_PHASES und PHASE_LABELS sind in @positron/shared.
// Re-export für Abwärtskompatibilität der Importe aus '../types.js'.
export { ALL_PHASES, PHASE_LABELS } from '@positron/shared';

export type RunStatus = 'active' | 'blocked' | 'done' | 'failed' | 'cancelled';

export const STATUS_LABEL: Record<RunStatus, string> = {
	active: 'Läuft',
	blocked: 'Blockiert',
	done: 'Abgeschlossen',
	failed: 'Fehlgeschlagen',
	cancelled: 'Abgebrochen',
};

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export interface Repository {
	id: string;
	owner: string;
	name: string;
	url: string;
	localPath: string | null;
	enabled: boolean;
	createdAt: string;
}

export interface Issue {
	id: string;
	repoId: string;
	number: number;
	title: string;
	state: 'open' | 'closed';
	labels: string[];
	lastSeenAt: string;
}

export interface Run {
	id: string;
	repoId: string;
	issueNumber: number;
	branch: string | null;
	phase: Phase;
	status: RunStatus;
	autonomyLevel: number;
	attempt: number;
	lastError: string | null;
	workspacePath: string | null;
	startedAt: string;
	finishedAt: string | null;
}

export interface RunEvent {
	id: string;
	runId: string;
	phase: Phase;
	level: LogLevel;
	message: string;
	payload: Record<string, unknown>;
	createdAt: string;
	/** Server-assigned sequence number for ordering/reconnection (Issue #66) */
	_sequence?: number;
}

export interface Artifact {
	content: string;
	kind: string;
	createdAt: string;
}

export interface Metrics {
	totalRuns: number;
	runsByPhase: Partial<Record<Phase, number>>;
	runsByStatus: Partial<Record<RunStatus, number>>;
	avgDurationMs: number;
	successRate: number;
}

export interface HealthStatus {
	status: 'ok' | 'degraded' | 'error';
	adapters: Record<string, boolean>;
	uptime: number;
	mode?: 'fake' | 'real';
	runs?: number;
}

export type OperatorReadinessStatus =
	| 'READY_DEMO'
	| 'READY_SUPERVISED'
	| 'BLOCKED'
	| 'NEEDS_CONFIGURATION'
	| 'UNAVAILABLE'
	| 'UNKNOWN';

export interface OperatorReadinessCheck {
	status: OperatorReadinessStatus;
	reason_code: string;
	human_message: string;
	remediation_hint: string;
	evidence_ref: string;
	last_checked_at: string;
}

export interface OperatorReadiness {
	contract: 'positron.operator-readiness.v1';
	overall_status: OperatorReadinessStatus;
	next_action: { label: string; href: string };
	server: OperatorReadinessCheck;
	database: OperatorReadinessCheck;
	workspace: OperatorReadinessCheck;
	git: OperatorReadinessCheck;
	github: OperatorReadinessCheck;
	opencode: OperatorReadinessCheck;
	provider: OperatorReadinessCheck;
	model: OperatorReadinessCheck;
	repository: OperatorReadinessCheck;
	security_policy: OperatorReadinessCheck;
	runtime_budget: OperatorReadinessCheck;
	approval_system: OperatorReadinessCheck;
}

export interface ApiError {
	error: string;
	code?: string;
	details?: unknown;
}

// ── Managed Target Projects (Issue: Target Project Registry) ──────

export interface SafetyCheck {
	id: string;
	label: string;
	status: 'pass' | 'warn' | 'fail' | 'unknown';
	description?: string;
}

export type TargetProjectRole = 'external_target_project' | 'proof_project' | 'candidate_project';

export type TargetProjectStatus =
	| 'LOCAL_GATES_REPRODUCIBLE'
	| 'LOCAL_GATES_BLOCKED'
	| 'NOT_YET_EVALUATED'
	| 'DEPLOYED'
	| 'ARCHIVED';

export interface ManagedTargetProject {
	id: string;
	name: string;
	role: TargetProjectRole;
	repoUrl: string;
	defaultBranch: string;
	status: TargetProjectStatus;
	description: string;
	techStack: string[];
	lastEvidence: string | null;
	lastRunRef: string | null;
	blockers: string[];
	nextRecommendedRuns: string[];
	safetyChecks: SafetyCheck[];
	securityStatus: 'ok' | 'review_needed' | 'vulnerable' | 'unknown';
	lastSecurityScan: string | null;
}
