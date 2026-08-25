// Positron — GitHub Issue Watcher / Polling Service
//
// Überwacht regelmäßig konfigurierte Repositories auf neue relevante Issues
// und erstellt automatisch Runs (nur wenn aktiviert).
//
// Konfiguration über Umgebungsvariablen:
//   POSITRON_ENABLE_WATCHER=true           (default: false)
//   POSITRON_WATCHER_INTERVAL_MS=60000     (default: 60000 = 1 Minute)
//   POSITRON_WATCHER_LABELS=bug,feature    (default: leer = alle Issues)
//
// Idempotenz: Bereits existierende Runs für eine Issue werden nicht dupliziert.

import { createRun } from '@positron/run-state';
import { createRunId } from '@positron/shared';
import { createLogger } from './logger.js';

const log = createLogger('Watcher');

import type { GitHubAdapter } from '@positron/github-adapter';
import type { RepositoryConfig } from '@positron/shared';
import type { Database } from 'better-sqlite3';

export interface WatcherOptions {
	github: GitHubAdapter;
	repository: RepositoryConfig;
	db: Database;
	onRunCreated?: (runId: string, issueNumber: number) => void;
}

interface WatcherState {
	intervalId: ReturnType<typeof setInterval> | null;
	enabled: boolean;
	polling: boolean; // true während pollOnce läuft — verhindert Überlappung
}

/** Prüft, ob für eine Issue bereits ein Run existiert (Idempotenz). */
function hasExistingRun(db: Database, repoId: string, issueNumber: number): boolean {
	try {
		const row = db
			.prepare('SELECT COUNT(*) as cnt FROM runs WHERE repo_id = ? AND issue_number = ?')
			.get(repoId, issueNumber) as { cnt: number } | undefined;
		return (row?.cnt ?? 0) > 0;
	} catch {
		return false;
	}
}

/** Einmaliger Polling-Durchlauf: Prüft auf neue Issues und erstellt Runs. */
export async function pollOnce(options: WatcherOptions): Promise<number> {
	const { github, repository, db, onRunCreated } = options;
	const labelsFilter = process.env['POSITRON_WATCHER_LABELS'] ?? '';
	const labelList = labelsFilter
		.split(',')
		.map((l) => l.trim())
		.filter(Boolean);

	let createdCount = 0;

	try {
		const issues = await github.listOpenIssues(repository.owner, repository.repo, {
			labels: labelList.length > 0 ? labelList : undefined,
			limit: 50,
		});

		for (const issue of issues) {
			// Idempotenz-Check: Bereits existierende Runs überspringen
			if (hasExistingRun(db, repository.repo, issue.number)) {
				continue;
			}

			// Issue muss offen sein
			if (issue.state !== 'open') continue;

			// Neuen Run erstellen
			const run = createRun(repository.repo, issue.number, 2);
			const database = db;

			// Run persistieren (analog zu saveRunToDb, aber direkt mit DB-Instanz)
			try {
				database
					.prepare(`
          INSERT OR IGNORE INTO repositories (id, owner, name, url, local_path, enabled, created_at)
          VALUES (?, ?, ?, '', '', 1, datetime('now'))
        `)
					.run(repository.repo, repository.owner, repository.repo);

				database
					.prepare(`
          INSERT OR IGNORE INTO issues (id, repo_id, number, title, state, labels_json, last_seen_at)
          VALUES (?, ?, ?, ?, 'open', '[]', datetime('now'))
        `)
					.run(
						`issue-${repository.repo}-${issue.number}`,
						repository.repo,
						issue.number,
						issue.title,
					);

				database
					.prepare(`
          INSERT INTO runs (id, repo_id, issue_number, branch, phase, status, autonomy_level, attempt, started_at, finished_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            repo_id = excluded.repo_id, issue_number = excluded.issue_number,
            phase = excluded.phase, status = excluded.status,
            autonomy_level = excluded.autonomy_level, attempt = excluded.attempt,
            started_at = excluded.started_at, finished_at = excluded.finished_at
        `)
					.run(
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

				createdCount++;
				if (onRunCreated) {
					onRunCreated(run.id, issue.number);
				}
			} catch (err) {
				log.error(`Failed to create run for issue #${issue.number}`, err);
			}
		}
	} catch (err) {
		log.error('Polling error', err);
	}

	return createdCount;
}

/** Startet den Watcher (Polling-Intervall). Gibt eine Stop-Funktion zurück. */
export function startWatcher(options: WatcherOptions): () => void {
	const state: WatcherState = {
		intervalId: null,
		enabled: true,
		polling: false,
	};

	// Prüfen ob Watcher aktiviert ist
	const enabled = process.env['POSITRON_ENABLE_WATCHER'] === 'true';
	if (!enabled) {
		log.info('Deaktiviert (POSITRON_ENABLE_WATCHER != true)');
		return () => {
			state.enabled = false;
		};
	}

	// Intervall validieren
	const rawInterval = process.env['POSITRON_WATCHER_INTERVAL_MS'] ?? '60000';
	const intervalMs = Number.parseInt(rawInterval, 10);
	const safeInterval = Number.isNaN(intervalMs) || intervalMs < 1000 ? 60000 : intervalMs;
	if (safeInterval !== intervalMs) {
		log.warn(`Invalid POSITRON_WATCHER_INTERVAL_MS="${rawInterval}", using default 60000ms`);
	}

	log.info(
		`Started — interval=${safeInterval}ms, labels=${process.env['POSITRON_WATCHER_LABELS'] ?? '(all)'}`,
	);

	/** Führt pollOnce aus, mit Überlappungsschutz */
	async function safePoll(): Promise<void> {
		if (!state.enabled || state.polling) return;
		state.polling = true;
		try {
			await pollOnce(options);
		} catch (err) {
			log.error('Poll failed', err);
		} finally {
			state.polling = false;
		}
	}

	// Sofort einmal poll
	safePoll();

	// Regelmäßiges Polling
	state.intervalId = setInterval(safePoll, safeInterval);

	// Stop-Funktion zurückgeben
	return () => {
		state.enabled = false;
		if (state.intervalId) {
			clearInterval(state.intervalId);
			state.intervalId = null;
		}
		log.info('Stopped');
	};
}
