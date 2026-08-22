/**
 * Queue-Typen für Positron Run Queue (BullMQ-basiert).
 *
 * Trennt API (Producer) von Worker (Consumer):
 * - POST /api/runs → Queue.add('pipeline', { runId, ... })
 * - Worker → Queue.process('pipeline', executePipeline)
 */

/** Job-Daten, die in die Queue gelegt werden. */
export interface PipelineJobData {
	/** ID des Runs (aus createRun / DB). */
	runId: string;
	/** Repository-ID (owner/name). */
	repoId: string;
	/** Issue-Nummer. */
	issueNumber: number;
	/** Autonomie-Level (0 = safe, 2 = full). */
	autonomyLevel: number;
}

/** Ergebnis, das der Worker nach Pipeline-Ausführung zurückgibt. */
export interface PipelineJobResult {
	/** finaler Run-Status. */
	status: string;
	/** finaler Run-Phase. */
	phase: string;
	/** Letzter Fehler (falls vorhanden). */
	lastError: string | null;
}

/** Queue Name */
export const PIPELINE_QUEUE = 'positron-pipeline';

/**
 * Resolve the queue used for a run.
 *
 * Default operation keeps the historical shared queue. R6/live isolation can
 * opt into one queue per run so a worker scoped with POSITRON_RECOVERY_RUN_ID
 * cannot claim another run's job.
 */
export function resolvePipelineQueueName(
	runId?: string,
	scoped = process.env.POSITRON_QUEUE_SCOPED === 'true',
): string {
	if (!scoped) return PIPELINE_QUEUE;
	if (!runId?.trim()) throw new Error('run-scoped queue requires a run ID');
	return `${PIPELINE_QUEUE}-${runId.trim()}`;
}

/**
 * Redis-Verbindungs-URL.
 * Default: localhost:6379, konfigurierbar via POSITRON_REDIS_URL.
 */
export function resolveRedisUrl(): string {
	return process.env.POSITRON_REDIS_URL ?? 'redis://localhost:6379';
}
