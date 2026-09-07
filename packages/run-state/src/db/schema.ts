// Positron — Datenbank-Schema und Migrationen

import type Database from 'better-sqlite3';

/** SQL für das Tabellen-Schema V1 */
export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  local_path TEXT,
  default_branch TEXT DEFAULT 'main',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  labels_json TEXT NOT NULL DEFAULT '[]',
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (repo_id) REFERENCES repositories(id)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  branch TEXT,
  phase TEXT NOT NULL DEFAULT 'QUEUED',
  status TEXT NOT NULL DEFAULT 'active',
  autonomy_level INTEGER NOT NULL DEFAULT 2,
  attempt INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  workspace_path TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  FOREIGN KEY (repo_id) REFERENCES repositories(id)
);

CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT '',
  sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS command_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  command TEXT NOT NULL,
  exit_code INTEGER,
  stdout_path TEXT,
  stderr_path TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE INDEX IF NOT EXISTS idx_runs_repo_id ON runs(repo_id);
CREATE INDEX IF NOT EXISTS idx_runs_phase ON runs(phase);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);
CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id);
CREATE INDEX IF NOT EXISTS idx_run_events_created ON run_events(created_at);
CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_issues_repo_id ON issues(repo_id);
CREATE TABLE IF NOT EXISTS run_signals (
  run_id TEXT NOT NULL,
  signal TEXT NOT NULL,
  target_phase TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (run_id, signal)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_run_signals_run_id ON run_signals(run_id);
CREATE INDEX IF NOT EXISTS idx_repositories_owner_name ON repositories(owner, name);

CREATE TABLE IF NOT EXISTS project_entries (
  id TEXT PRIMARY KEY,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('existing_repository', 'blueprint')),
  name TEXT NOT NULL,
  owner TEXT,
  repository TEXT,
  repository_url TEXT,
  default_branch TEXT,
  blueprint TEXT,
  provider TEXT,
  model TEXT,
  credential_ref TEXT,
  blueprint_path TEXT,
  speckit_artifacts_json TEXT,
  speckit_status TEXT NOT NULL DEFAULT 'not_started',
  status TEXT NOT NULL DEFAULT 'validated',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_entries_status ON project_entries(status);
`;

/**
 * Führt alle Datenbank-Migrationen aus.
 */
export function applyMigrations(db: Database.Database): void {
	db.exec(SCHEMA_V1);
	const columns = new Set(
		(db.pragma('table_info(project_entries)') as Array<{ name: string }>).map(
			(column) => column.name,
		),
	);
	if (!columns.has('blueprint_path'))
		db.exec('ALTER TABLE project_entries ADD COLUMN blueprint_path TEXT');
	if (!columns.has('speckit_artifacts_json')) {
		db.exec('ALTER TABLE project_entries ADD COLUMN speckit_artifacts_json TEXT');
	}
}
