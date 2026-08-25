// Positron — OpenCode Typdefinitionen

/** OpenCode Adapter Phasen */
export type OpenCodePhase =
	| 'health'
	| 'constitution'
	| 'specify'
	| 'clarify'
	| 'plan'
	| 'tasks'
	| 'analyze'
	| 'checklist'
	| 'implement';

/**
 * Execution mode distinguishing how changes were produced.
 * - 'fixture': deterministic test agent, no external LLM — reproducible
 * - 'dry-run': real adapter invoked but all writes/pushes/merges blocked
 * - 'real': genuine agent execution with real effects
 */
export type ExecutionMode = 'fixture' | 'dry-run' | 'real';

/** OpenCode Kommando-Status */
export type OpenCodeCommandStatus = 'success' | 'failed' | 'blocked' | 'skipped';

/** OpenCode CLI Health-Check Ergebnis */
export interface OpenCodeHealth {
	/** true wenn CLI gefunden und ausführbar */
	available: boolean;
	/** Installierte Version */
	version?: string;
	/** Pfad zum CLI-Binary */
	commandPath?: string;
	/** Grund warum nicht verfügbar */
	reason?: string;
}

/** Ergebnis eines OpenCode Kommandos */
export interface OpenCodeCommandResult {
	/** Ausgeführte Phase */
	phase: OpenCodePhase;
	/** Ergebnis-Status */
	status: OpenCodeCommandStatus;
	/** Ausgeführtes Kommando */
	command: string;
	/** Kommando-Argumente (Array, kein shell-string) */
	args: string[];
	/** Working Directory */
	cwd: string;
	/** Exit Code */
	exitCode: number | null;
	/** Dauer in ms */
	durationMs: number;
	/** Pfad zur stdout-Logdatei */
	stdoutPath?: string;
	/** Pfad zur stderr-Logdatei */
	stderrPath?: string;
	/** Zusammenfassung */
	summary: string;
	/** Grund für Blockierung */
	blockedReason?: string;
	/** Session-ID (falls OpenCode eine Session gestartet hat) */
	sessionId?: string;
	/** How changes were produced. Undefined = legacy adapter without mode awareness. */
	executionMode?: ExecutionMode;
	/** Structured error evidence emitted by OpenCode, with sensitive values removed. */
	error?: {
		name?: string;
		message?: string;
		ref?: string;
		retryable?: boolean;
	};
}

/** Input für OpenCode Adapter-Methoden */
export interface OpenCodeRunInput {
	/** Run-ID */
	runId: string;
	/** Workspace-Pfad */
	workspacePath: string;
	/** Issue-Titel */
	issueTitle: string;
	/** Issue-Body */
	issueBody?: string;
	/** Issue-Nummer */
	issueNumber?: number;
	/** Target repository owner (e.g. "xxammaxx") */
	repoOwner?: string;
	/** Target repository name (e.g. "positron-sandbox") */
	repoName?: string;
	/** Adapter-Modus */
	mode?: 'detect-only' | 'safe-cli';
	/** OpenCode Modell (provider/model) */
	model?: string;
	/** Resolved OpenCode agent/profile. */
	agent?: string;
	/** Explicitly enable supported unattended approvals at this boundary. */
	auto?: boolean;
	/** Autonomie-Level (0-4) */
	autonomyLevel?: number;
	/** Phase-Name für spec-driven-development (z.B. "specify", "plan", "tasks") */
	phaseName?: string;
	/**
	 * P4 (Slice B): AbortSignal für aktive Cancellation.
	 * Bei abort terminiert der Adapter den Child-Prozess real
	 * (graceful SIGTERM → forced SIGKILL) statt nur den Promise zu beenden.
	 */
	signal?: AbortSignal;
	/**
	 * P5.2: Effective harness config (compiled, persisted, enforced at adapter).
	 * The adapter MUST enforce effective_permissions, effective_tools, etc.
	 * and MUST NOT widen capabilities beyond the compiled harness.
	 */
	effectiveHarness?: {
		fingerprint: string;
		effective_permissions: {
			mutation: boolean;
			push: boolean;
			merge: boolean;
			deploy: boolean;
			secret_access: boolean;
		};
		effective_tools: string[];
		effective_reasoning_mode: string;
		effective_timeout_ms: number;
		effective_max_steps: number;
		model_profile_ref: { id: string; version: string; fingerprint: string };
		task_profile_ref: { id: string; version: string; fingerprint: string };
	};
}

/** OpenCode Adapter Interface */
export interface OpenCodeAdapter {
	/** Prüft ob OpenCode CLI verfügbar ist */
	healthCheck(workspacePath: string): Promise<OpenCodeHealth>;
	/**
	 * Führt einen opencode Command über die CLI aus.
	 *
	 * Command: spec-driven-development mit Phase als message
	 * (z.B. opencode run --command spec-driven-development "specify")
	 */
	runSlashCommand(command: string, input: OpenCodeRunInput): Promise<OpenCodeCommandResult>;
	/**
	 * Führt OpenCode mit einem freien Prompt aus (IMPLEMENT-Phase).
	 * Dies ist die Phase, in der OpenCode tatsächlich Code ändern kann.
	 */
	runImplement(input: OpenCodeRunInput): Promise<OpenCodeCommandResult>;
}
