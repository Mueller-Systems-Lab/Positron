# Positron v3.0 — Architektur

**Datum:** 2026-05-20
**Workflow-Zustand:** Analyse abgeschlossen

---

## Zielarchitektur (Blueprint §4)

```
┌─────────────────────────────────────────────┐
│                 Web UI                       │
│ React / Vite / Tailwind                      │
│ Dashboard, Run View, Logs, Diff, Gates       │
└──────────────────────┬──────────────────────┘
                       │ WebSocket / SSE
┌──────────────────────▼──────────────────────┐
│             Positron Orchestrator            │
│ Node.js / Express / TypeScript               │
│ Run State Machine, GitHub Sync, Scheduler    │
└───────┬──────────────┬──────────────┬────────┘
        │              │              │
┌───────▼──────┐ ┌─────▼─────┐ ┌──────▼───────┐
│ GitHub API   │ │ Spec Kit  │ │ OpenCode      │
│ Issues / PRs │ │ CLI       │ │ CLI / Agents  │
└───────┬──────┘ └─────┬─────┘ └──────┬───────┘
        │              │              │
┌───────▼──────────────▼──────────────▼───────┐
│              Sandbox Workspace              │
│ Git worktree / Docker / repo clone           │
└───────┬─────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────┐
│ Persistence                                  │
│ SQLite MVP → PostgreSQL optional             │
│ runs, events, artifacts, logs, metrics       │
└─────────────────────────────────────────────┘
```

### v0.2.0 Produktionspfad: Worker/Queue-Layer

Seit v0.2.0 ergänzt Positron die ursprüngliche Server/Web-Architektur um eine produktionsfähige, entkoppelte Ausführungsschicht auf Basis von BullMQ und Redis 7. Der HTTP-Server bleibt API- und Enqueue-Komponente; lang laufende Pipeline-Ausführung wird bevorzugt vom Worker-Prozess übernommen.

```
Browser
  │
  │ POST /api/runs oder /api/repos/:repoId/runs
  ▼
Nginx :5173
  ├─ /api/* ─────────────► Server :3000
  │                         │
  │                         │ Queue.add('pipeline', ..., jobId = run.id)
  │                         ▼
  │                       Redis 7 / BullMQ
  │                         │
  │                         ▼
  │                       Worker
  │                         │
  │                         ▼
  │                       SQLite DB auf shared positron-data volume
  │
  └─ /* ─────────────────► Web :5173

Fallback ohne Redis/Worker:
Browser → Nginx → Server → runFullPipeline(...) → SQLite DB
```

Wichtige Eigenschaften:

- **Queueing:** BullMQ nutzt Redis 7 (`redis:7-alpine`) als Broker. Der Queue-Name ist `positron-pipeline` (`PIPELINE_QUEUE`).
- **Deterministische Jobs:** Der Server verwendet `run.id` als BullMQ `jobId`, um doppelte Ausführung bei Retries oder erneuten Enqueue-Versuchen zu vermeiden.
- **Worker-Verfügbarkeit:** Vor dem Enqueue ruft der Server `queue.getWorkers()` auf. Ist kein Worker registriert oder Redis nicht erreichbar, wird nicht blind queued.
- **Inline-Fallback:** Wenn Queue oder Worker fehlen, führt der Server die Pipeline direkt via `runFullPipeline(...)` aus. Dadurch bleiben lokale Entwicklung und degradierter Betrieb funktionsfähig.
- **SSE vs. Polling:** Inline-Runs senden Live-Updates über SSE. Worker-Runs persistieren nach Phasenübergängen in SQLite; UI und API lesen diese Läufe über Polling (`GET /api/runs/:id`) statt über worker-seitige SSE-Broadcasts.
- **Gemeinsame Persistenz:** Server und Worker mounten das Docker-Volume `positron-data` nach `/app/.positron` und verwenden denselben DB-Pfad (`/app/.positron/runs/positron.db`). Dadurch sieht der Server Worker-Fortschritt und Run-Control-Signale.
- **Image split:** `apps/server/Dockerfile` und `apps/worker/Dockerfile` basieren auf `node:22-slim`/Debian-slim, damit native Module und CLI-Tools mit glibc kompatibel sind. `apps/web/Dockerfile` nutzt `node:22-alpine`, weil die Vite/React-Web-App keine nativen Abhängigkeiten benötigt.
- **Graceful Shutdown:** Server und Worker reagieren auf `SIGTERM`; der Server schließt den HTTP-Server und stoppt den Watcher, der Worker schließt den BullMQ-Worker vor Prozessende.

---

## Architekturprinzipien

1. **Deterministische State Machine** — Der Workflow ist strikt, Agenten dürfen kreativ sein, der Workflow nicht.
2. **Persistente Artefakte** — Jeder Run hinterlässt einen vollständigen, wiederherstellbaren Zustand.
3. **Kontrollierte Agentenaufrufe** — OpenCode bekommt nur das Nötigste: Issue-Kontext, Research, Spec, Plan, Tasks, Constitution.
4. **Harte Gates** — Kein Übergang ohne Erfüllung aller Checkpoints.
5. **GitHub-Kommentare** — Jeder Schritt ist extern sichtbar und nachvollziehbar.
6. **Tests als Beweis** — Nicht Behauptungen, sondern Testergebnisse zählen.

---

## Projektsstruktur (Blueprint §14)

```
positron/
├── apps/
│   ├── web/                  # React/Vite/Tailwind Frontend
│   ├── server/               # Node.js/Express/TypeScript Backend / Queue Producer
│   └── worker/               # BullMQ Worker / Pipeline Consumer
├── packages/
│   ├── github-adapter/       # GitHub API Wrapper
│   ├── speckit-adapter/      # Spec Kit CLI Adapter
│   ├── opencode-adapter/     # OpenCode CLI Adapter
│   ├── run-state/            # State Machine & Run-Management
│   ├── sandbox/              # Git Worktree / Docker-Isolation
│   └── shared/               # Gemeinsame Typen, Utilities, Queue-Typen
├── docs/
│   ├── architecture/         # Architektur-Dokumentation
│   ├── security/             # Sicherheitskonzepte
│   └── workflows/            # Workflow-Dokumentation
├── .positron/
│   └── runs/                 # Run-Artefakte (pro Issue)
├── .specify/
│   └── memory/
│       └── constitution.md   # Positron-Constitution
├── nginx.conf                # Reverse Proxy für API und Frontend
├── docker-compose.yml        # Services: nginx, redis, server, worker, web
├── AGENTS.md                 # Agenten-Regelwerk
└── README.md
```

---

## Technologie-Stack

### MVP (TypeScript-first)
| Schicht | Technologie | Begründung |
|---------|-------------|------------|
| Frontend | React / Vite / Tailwind | Schnelle Entwicklung, Tailwind für UI-Konsistenz |
| Backend | Node.js / Express / TypeScript | TypeScript-Ökosystem, einfache CLI-Integration |
| Worker | Node.js / TypeScript / BullMQ | Entkoppelte Ausführung lang laufender Pipelines |
| Queue | Redis 7 + BullMQ | Robustes Job-Queueing mit Worker-Erkennung und deterministischen Job-IDs |
| Reverse Proxy | Nginx Alpine | Einheitlicher Einstiegspunkt: API nach Server, UI nach Web |
| Datenbank | SQLite (better-sqlite3) | Kein Server-Setup, dateibasiert, ausreichend für MVP |
| Tests | Vitest + Playwright | Schnell (Vitest), visuelles Testing (Playwright) |
| Sandbox | Git Worktrees (MVP), Docker (später) | Isolierung ohne Docker-Daemon-Abhängigkeit |
| CLI-Integration | child_process / execa | Kontrollierte Prozessaufrufe für Spec Kit + OpenCode |

### Warum nicht FastAPI?
FastAPI (Python) bleibt eine spätere Option, ist aber für den vorhandenen TypeScript-nahen Positron-Stand kein Muss (Blueprint §4.1).

---

## Modulabhängigkeiten

```
Web UI ────► Orchestrator (WebSocket/SSE)
                 │
                 ├──────────► BullMQ / Redis ─────► Worker
                 │                                  │
     ┌───────────┼───────────┐
     ▼           ▼           ▼
GitHub      Spec Kit    OpenCode
Adapter     Adapter     Adapter
     │           │           │
     └───────────┼───────────┘
                 ▼
            Sandbox
                 │
                 ▼
            Persistenz (SQLite)
```

### Abhängigkeitsregeln
- `shared/` hat keine internen Abhängigkeiten (nur externe: TypeScript)
- Adapter (`github-adapter`, `speckit-adapter`, `opencode-adapter`) hängen nur von `shared/` ab
- `run-state/` hängt von `shared/` ab — NICHT von Adaptern (Dependency Inversion)
- `server/` orchestriert Adapter über `run-state/` und ist BullMQ-Producer für Produktionsläufe
- `worker/` ist BullMQ-Consumer und führt die Pipeline mit denselben Adapter-Abstraktionen aus
- `web/` hängt nur vom Server via WebSocket/SSE ab
- `nginx` routet `/api/*` zum Server und alle übrigen Pfade zum Web-Frontend

### Queue- und Fallback-Regeln

1. Der Server persistiert den Run zuerst in SQLite.
2. Danach versucht er, eine BullMQ-Queue-Verbindung über `POSITRON_REDIS_URL` aufzubauen.
3. Vor dem Enqueue wird per `queue.getWorkers()` geprüft, ob mindestens ein Worker verfügbar ist.
4. Ist ein Worker verfügbar, wird ein `pipeline`-Job mit `jobId = run.id` erzeugt.
5. Ist Redis nicht erreichbar oder kein Worker registriert, verarbeitet der Server den Run inline.

Diese Regeln reduzieren Kopplung zwischen HTTP-Lebenszyklus und Pipeline-Ausführung, vermeiden aber zugleich verlorene Runs bei fehlendem Worker.

### Docker- und Routing-Topologie

- `nginx` veröffentlicht Port `5173` und hängt vom gesunden `server` ab.
- `server` veröffentlicht intern/extern Port `3000`, spricht Redis über `redis://redis:6379` an und mountet `positron-data:/app/.positron`.
- `worker` hat keinen HTTP-Port, verbindet sich mit derselben Redis-Instanz und mountet ebenfalls `positron-data:/app/.positron`.
- `web` bedient die Frontend-Auslieferung hinter Nginx.
- `redis` nutzt `redis-data` für Redis-Persistenz.

Nginx-Routing:

| Pfad | Ziel | Hinweise |
|------|------|----------|
| `/api/*` | `http://server:3000` | Proxy-Buffering deaktiviert, lange Read-Timeouts für SSE |
| `/*` | `http://web:5173` | Frontend / statische UI |

### Graceful Shutdown

- **Server:** `SIGTERM` schließt den HTTP-Server; beim Server-Close wird der GitHub-Watcher gestoppt. Der direkte Prozesspfad behandelt zusätzlich `SIGINT` und erzwingt nach Timeout einen Exit.
- **Worker:** `SIGTERM` und `SIGINT` rufen `worker.close()` auf, damit BullMQ keine neuen Jobs annimmt und sauber beendet wird.
- **Queue-Producer:** Kurzlebige Queue-Verbindungen im Server werden nach Enqueue-Versuch mit `queue.close()` geschlossen.

---

## State Machine (Run Orchestrator)

```
QUEUED
  → CLAIMED
  → REPO_SYNC
  → ISSUE_CONTEXT
  → WEB_RESEARCH
  → SPECIFY
  → CLARIFY_OPTIONAL
  → PLAN
  → TASKS
  → ANALYZE
  → REVIEW
  → IMPLEMENT
  → TEST
  → VERIFY
  → PR_CREATE
  → DONE

Fehlerzustände:
  FAILED_TRANSIENT → Retry (max 3)
  FAILED_BLOCKED   → GitHub-Kommentar + Stop
  FAILED_UNSAFE    → Sofortiger Stop (kein Retry)
```

---

## Datenbank-Schema (SQLite)

```sql
-- Registrierte Repositories
CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  local_path TEXT NOT NULL,
  default_branch TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Überwachte Issues
CREATE TABLE issues (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repositories(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  labels_json TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

-- Runs (pro Issue)
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES repositories(id),
  issue_number INTEGER NOT NULL,
  branch TEXT,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  autonomy_level INTEGER NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT
);

-- Ereignisprotokoll
CREATE TABLE run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  phase TEXT NOT NULL,
  level TEXT NOT NULL,        -- INFO, WARN, ERROR, GATE, HUMAN
  message TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

-- Artefakt-Metadaten
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  kind TEXT NOT NULL,         -- spec, plan, tasks, review, test-report, ...
  path TEXT NOT NULL,
  sha256 TEXT,
  created_at TEXT NOT NULL
);

-- Kommando-Ergebnisse
CREATE TABLE command_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  command TEXT NOT NULL,
  exit_code INTEGER,
  stdout_path TEXT,
  stderr_path TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);
```

---

## Sicherheitsarchitektur

### Bedrohungsmodell
1. **Secret-Leakage**: Tokens und Keys an LLMs
2. **Unkontrollierte Code-Execution**: `sudo`, `rm -rf`, Systemmanipulation
3. **Main-Branch-Korruption**: Direktes Pushen auf geschützte Branches
4. **Unbemerkte Fehler**: Stille Fehler ohne Logging

### Schutzmaßnahmen
- **Secret Redaction**: Musterbasierte Maskierung von `ghp_*`, `sk-*`, `anthropic_*`, `gemini_*`
- **Bash-Allowlist**: Nur explizit erlaubte Befehle im Autonomous Mode
- **Branch-Schutz**: Nur `positron/issue-<n>-<slug>` Branches
- **GitHub Source of Truth**: Alle Entscheidungen sichtbar im Issue
- **Harte Gates**: Kein Fortschritt ohne bestandene Checks

## Runtime Budget Contract (Issue #478)

Positron's existing run → job → attempt hierarchy remains the only execution authority. Runtime limits are represented by the shared, immutable `positron.runtime-budget.v1` contract and are persisted additively on `cp_attempts` (V12). The contract fingerprint covers bounded policy semantics; audit timestamps and clock readings do not change comparability.

```mermaid
flowchart TD
    R[Run / Job budget] --> A[Attempt budget]
    A --> P[Provider request slice]
    A --> T[Tool execution slice]
    A --> V[Verification slice]
    R -->|remaining deadline| F[Kernel cancellation]
    F --> C[AbortSignal]
    C --> X[Owned process SIGTERM → SIGKILL]
    A --> L[Terminal attempt + lease fencing]
    L --> Z[Late result fenced]
```

Every child deadline is `min(requested child deadline, remaining parent deadline)`. Provider request/chunk timeouts from OpenCode are subordinate subsystem timeouts; they do not replace Positron's attempt or run deadline. The final termination record carries both a reason code and the authority (`provider`, `tool`, `verification`, `attempt`, `run`, `kernel`, or `fencing`).

The canonical distinction is:

| Runtime outcome | Authority | Product meaning |
| --- | --- | --- |
| `PROVIDER_FAILURE` / provider timeout | provider/model | provider evidence exists |
| `ATTEMPT_DEADLINE_EXCEEDED` | attempt | workload exceeded its controlled attempt envelope |
| `TOOL_EXECUTION_TIMEOUT` | tool | owned tool exceeded its child budget |
| `VERIFICATION_DEADLINE_EXCEEDED` | verification | verification exceeded its child budget |
| `RUN_BUDGET_EXHAUSTED` | run | parent budget prevented more work |
| `CANCELLED_BY_KERNEL` | kernel | controller cancellation won the race |
| `LATE_RESULT_FENCED` | fencing | terminal/superseded result was rejected |

Calibration must derive a bounded runtime envelope before a holdout contract is frozen. A holdout timeout cannot be repaired by changing the budget and rerunning the same sample; that is an `EXPERIMENT_CONTRACT_CHANGED` boundary.
