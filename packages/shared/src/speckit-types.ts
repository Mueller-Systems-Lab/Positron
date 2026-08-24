// Positron — SpecKit Typdefinitionen

/** Spec Kit Phasen, die der Adapter kennt */
export type SpecKitPhase =
	| 'init'
	| 'check'
	| 'version'
	| 'constitution'
	| 'specify'
	| 'clarify'
	| 'plan'
	| 'checklist'
	| 'tasks'
	| 'analyze'
	| 'implement';

/** Ergebnis-Status eines Spec Kit Kommandos */
export type SpecKitCommandStatus = 'success' | 'failed' | 'blocked' | 'skipped';

/** CLI-Health-Check Ergebnis */
export interface SpecKitHealth {
	/** true wenn CLI gefunden und ausführbar */
	available: boolean;
	/** Installierte Version (falls verfügbar) */
	version?: string;
	/** Pfad zum CLI-Binary */
	commandPath?: string;
	/** Ob opencode als Integration unterstützt wird */
	supportsOpencode?: boolean;
	/** Grund warum CLI nicht verfügbar ist */
	reason?: string;
}

/** Ergebnis eines einzelnen Spec Kit CLI-Kommandos */
export interface SpecKitCommandResult {
	/** Phase die ausgeführt wurde */
	phase: SpecKitPhase;
	/** Ergebnis-Status */
	status: SpecKitCommandStatus;
	/** Ausgeführtes Kommando */
	command: string;
	/** Kommando-Argumente (niemals shell:true) */
	args: string[];
	/** Working Directory */
	cwd: string;
	/** Exit Code (null wenn nicht ausgeführt) */
	exitCode: number | null;
	/** Ausführungsdauer in ms */
	durationMs: number;
	/** Pfad zur stdout-Logdatei */
	stdoutPath?: string;
	/** Pfad zur stderr-Logdatei */
	stderrPath?: string;
	/** Zusammenfassung des Ergebnisses */
	summary: string;
	/** Erkannte Artefakte nach Ausführung */
	artifacts: SpecKitArtifactRef[];
	/** Grund warum Blockiert (nur bei status=blocked) */
	blockedReason?: string;
}

/** Referenz auf ein Spec Kit Artefakt */
export interface SpecKitArtifactRef {
	/** Art des Artefakts */
	kind:
		| 'constitution'
		| 'spec'
		| 'plan'
		| 'tasks'
		| 'research'
		| 'checklist'
		| 'contract'
		| 'data-model'
		| 'quickstart'
		| 'unknown';
	/** Relativer Pfad zum Artefakt (innerhalb workspacePath) */
	path: string;
	/** Ob die Datei existiert */
	exists: boolean;
	/** SHA-256 Hash des Inhalts (falls berechenbar) */
	sha256?: string;
}

/** Eingabe für Spec Kit Adapter-Methoden */
export interface SpecKitRunInput {
	/** Eindeutige Run-ID */
	runId: string;
	/** Pfad zum Workspace */
	workspacePath: string;
	/** Issue-Titel */
	issueTitle: string;
	/** Issue-Body (optional) */
	issueBody?: string;
	/** Issue-Nummer (optional) */
	issueNumber?: number;
	/** Branch-Name (optional) */
	branchName?: string;
	/** Adapter-Modus */
	mode?: 'detect-only' | 'artifact-only' | 'safe-cli';
	/** Ziel-AI-Agent für init (default: generic) */
	aiAgent?: 'opencode' | 'generic' | 'none';
	/**
	 * P4 (Slice B): AbortSignal für aktive Cancellation — bei abort wird ein
	 * laufender CLI-Child-Prozess real terminiert (graceful → forced).
	 */
	signal?: AbortSignal;
}

/** Spec Kit Adapter Interface */
export interface SpecKitAdapter {
	/** Prüft ob Spec Kit CLI verfügbar ist und Version/Health zurückgibt */
	healthCheck(workspacePath: string): Promise<SpecKitHealth>;
	/** Initialisiert Spec Kit im Workspace (specify init) */
	initialize(input: SpecKitRunInput): Promise<SpecKitCommandResult>;
	/** Erkennt vorhandene Spec Kit Artefakte ohne Kommandos auszuführen */
	detectArtifacts(input: SpecKitRunInput): Promise<SpecKitArtifactRef[]>;
	/** Führt den Specify-Schritt aus (erkennt Artefakte oder blockiert) */
	runSpecify(input: SpecKitRunInput): Promise<SpecKitCommandResult>;
	/** Führt den Plan-Schritt aus (erkennt Artefakte oder blockiert) */
	runPlan(input: SpecKitRunInput): Promise<SpecKitCommandResult>;
	/** Führt den Tasks-Schritt aus (erkennt Artefakte oder blockiert) */
	runTasks(input: SpecKitRunInput): Promise<SpecKitCommandResult>;
	/** Führt den Analyze-Schritt aus (erkennt Artefakte oder blockiert) */
	runAnalyze(input: SpecKitRunInput): Promise<SpecKitCommandResult>;
}
