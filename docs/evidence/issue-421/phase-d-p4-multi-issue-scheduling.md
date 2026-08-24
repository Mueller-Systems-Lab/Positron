# Phase D — P4 Multi-Issue Scheduling (Control Plane) — Evidenz

Datum: 2026-08-20
Branch: `positron/issue-421-durable-control-plane`
Basis: Phase-C-Commit `5db622d`

## Ziel (§31/§91)

Die durable Control Plane governet **mehrere konkurrierende Issues/Runs**:

```text
GitHub Issues / Tasks → INTAKE QUEUE → DETERMINISTIC SCHEDULER → ADMISSION CONTROL
→ RUN A / RUN B / RUN C → RESOURCE/REPO/PROVIDER LIMITS
```

Oberste Invariante (§32): **LLMs besitzen keine Scheduling Authority** — alle
Entscheidungen (wer startet, wann, mit welchen Ressourcen) sind deterministisch
durch Positron (Priorität → Dependency-Readyness → Ressourcen → FIFO).

## Implementierung (minimal-invasiv, keine neue Infrastruktur)

### `packages/control-plane/src/queue-schema.ts` (neu)
- `cp_queue` (Schema V4): queue_item_id, source_type/ref, repository_ref, run_id,
  priority, queue_state, dependency_refs, enqueued_at/admitted_at/started_at/finished_at,
  reason_code, dedup_key
- **Partieller UNIQUE-Index auf dedup_key für aktive States** — Dedup (§48) ohne
  legitime Re-Runs zu blockieren (§49)
- Queue-States (§34): QUEUED / WAITING_DEPENDENCY / WAITING_RESOURCE / ADMITTED /
  RUNNING / COMPLETED / BLOCKED / CANCELLED
- Prioritäts-Schema (§37): CRITICAL > HIGH > NORMAL > LOW; unbekannt → NORMAL
- Reason-Codes (§57): READY, WAITING_DEPENDENCY, GLOBAL_RUN_LIMIT, PROVIDER_CAPACITY,
  REPOSITORY_LOCKED, WORKSPACE_LOCKED, DEPENDENCY_CYCLE, DUPLICATE_INTAKE,
  CANCELLED_BY_USER, HEAD_DRIFT
- `cp_scheduler_events` (§56): Event-Tabelle (event_id, queue_item_id, run_id,
  event, timestamp, reason_code)

### `packages/control-plane/src/scheduler.ts` (neu)
- `enqueueItem` — durable Intake mit Dedup (aktiv → bestehendes Item; final →
  neuer Eintrag = Re-Run mit neuer run_id und eigener Historie)
- `admitNext` — **atomare deterministische Admission** (SQLite-Transaktion):
  Priorität → Dependency → Repo-Lock → Global-Limit → Provider-Capacity → FIFO;
  Aging (§38) optional (LOW→NORMAL→HIGH nach Wartezeit)
- `dependencyStatus` — Readyness (alle deps COMPLETED) + **Cycle-Erkennung zuerst**
  (§47: A→B, B→A → DEPENDENCY_CYCLE → BLOCKED, kein ewiges Warten)
- `markRunStarted` / `markRunFinished` — Lifecycle-Hooks mit Events + Resource Release
- `cancelQueueItem` (§52) — QUEUED→CANCELLED; RUNNING → Events + Release über Lifecycle
- `recoverSchedulerState` (§54) — Crash-Recovery: ADMITTED ohne Run → requeued;
  RUNNING mit totem Run → finalisiert; Kapazität korrekt neu berechnet; keine
  doppelte Admission
- `schedulerCapacity` — Introspection (activeRuns, queueDepth, waiting*)
- `persistSchedulerEvent` / `listSchedulerEvents` — durable Events (§56)

### Server-API (§58) — `apps/server/src/index.ts`
- `GET /api/scheduler/queue` (Liste + Kapazität), `GET /api/scheduler/active`,
  `GET /api/scheduler/waiting?source_ref=`, `GET /api/scheduler/capacity`,
  `GET /api/scheduler/events` — read-only, kein Auth (Backend Truth)
- `POST /api/scheduler/enqueue`, `POST /api/scheduler/tick`, 
  `POST /api/scheduler/items/:id/cancel` — write, **requireAdmin** (401 ohne Token)
- `POSITRON_MAX_ACTIVE_RUNS` (default 2) als globale Admission-Schwelle

### Mission Control (§59) — `apps/web`
- `SchedulerQueuePanel.tsx` — Backend-Truth-Projektion (Queued / Waiting Dependency /
  Waiting Resource / Running / Priority / Repository / Reason Code + Kapazität
  `active/max active runs`), 5s-Poll, Fehlerzustand ohne Absturz; in RunDetail
  integriert. Kein UI-Rewrite, keine zweite State-Truth.

## Canaries (real, keine Mocks)

### `scheduler-canaries.test.ts` (14 Tests)
QUEUE_PERSISTENCE, QUEUE_ORDER (FIFO), PRIORITY (CRITICAL→HIGH→NORMAL→LOW,
FIFO innerhalb Priority), AGING (Starvation-Prevention), ADMISSION_CONTROL,
GLOBAL_RUN_LIMIT (max_active_runs=2, nie mehr als 2 aktiv — Negative Canary),
BACKPRESSURE (wartet statt spawn/drop), DUPLICATE_INTAKE (ein Item),
EXPLICIT_RERUN (nach COMPLETED neues Item), DEPENDENCY_WAIT/RELEASE (§67),
DEPENDENCY_CYCLE (BLOCKED), DEPENDENCY_FAILURE (B bleibt WAITING, Operator kann
canceln — kein Endlos-Loop), REPO_LOCK (zwei Runs gleiches Repo → einer wartet
REPOSITORY_LOCKED, anderes Repo läuft parallel), CANCELLATION (queued→CANCELLED,
nie admitiert), RESOURCE_RELEASE, SCHEDULER_RECOVERY (ADMITTED→requeued,
Kapazität korrekt)

### `scheduler-vertical-slice.test.ts` (6 Tests — ECHTE parallele Runs)
- **MULTI_ISSUE_VERTICAL_SLICE (§77)**: A+B real parallel über
  `runDurableRun` (disposable git-Workspaces, echte Worker mit Delay),
  C wartet am Limit, Slot frei → C admitiert; **zeitliche Überlappung aus
  persistierten cp_attempts-Zeitstempeln belegt** (overlap > 0)
- **CROSS-REPO CONCURRENCY (§63)**: run_A.started_at/ended_at überlappen
  run_B.started_at/ended_at → MULTI_RUN_CONCURRENCY_PROVEN
- **FAILURE_ISOLATION (§51)**: A (Worker-Rejection) → BLOCKED, B → DONE,
  C kann danach starten (Kapazität freigegeben)
- **DOUBLE_ADMISSION_PREVENTED (§55)**: zwei parallele admitNext-Aufrufe →
  ONE_ADMISSION (SQLite-Atomicity)
- **SCHEDULER_EVENTS (§56)**: ADMITTED/RUN_STARTED/RUN_FINISHED persistiert
- **QUEUE_RECOVERY (§69)**: A RUNNING, B WAITING_RESOURCE, C WAITING_DEPENDENCY —
  nach "Restart" derselbe fachliche Zustand; Kapazität korrekt

### `scheduler-api.test.ts` (7 Tests)
Read-only Endpunkte ohne Auth; write-Endpunkte mit Admin-Token (401 ohne);
voller Lifecycle enqueue→queue→tick(admitted)→cancel→events(ADMITTED);
400 bei fehlenden Pflichtfeldern

### `scheduler-queue-panel.test.tsx` (3 Tests, Web)
Queue-Items mit State/Priority/Reason gerendert; Kapazität; leere Queue;
Backend-down-Fehlerzustand ohne Absturz

## Gate-Status Phase D

```text
QUEUE_PERSISTENCE=PASS          DETERMINISTIC_SCHEDULER=PASS
ADMISSION_CONTROL=PASS          GLOBAL_RUN_LIMIT=PASS
BACKPRESSURE=PASS               MULTI_RUN_CONCURRENCY=PROVEN (echte Zeitüberlappung)
PRIORITY_POLICY=PASS            STARVATION_POLICY=PASS (Aging)
DEPENDENCIES=PASS               DEPENDENCY_CYCLE=PASS
FAILURE_ISOLATION=PASS          DUPLICATE_INTAKE=PASS
EXPLICIT_RERUN=PASS             REPOSITORY_CONCURRENCY_POLICY=PASS
HEAD_CONSISTENCY=PASS           (Plan-Gate HEAD-Mismatch → deterministisch)
RUN_CANCELLATION=PASS           RESOURCE_RELEASE=PASS
SCHEDULER_RECOVERY=PASS         DOUBLE_ADMISSION_PREVENTED=PASS
QUEUE_BACKEND_TRUTH=PASS        MULTI_ISSUE_VERTICAL_SLICE=PASS
PROVIDER_CONCURRENCY_LIMIT      (Interface vorhanden, aktive Provider-Zählung
                                 via activeByProvider — Werte aus bestehender
                                 Config, keine erfundenen Limits)
```

## Regression

- Backend: `npx vitest run packages apps/server apps/worker` → **2422/2422 grün** (+27 P4)
- Web: `cd apps/web && npx vitest run` → **421/421 grün** (+3 Panel)
- Build: 0 Fehler; Typecheck: 0 Fehler
- P0–P3-Invarianten unverändert (in 2422 enthalten: Bypass-Zero-Canary,
  Blind-Retry-Canary, Security-Hard-Block, Recovery-Matrix, Idempotenz)

## Keine neue Infrastruktur (§81)

Redis/Kafka/Temporal/K8s/Celery/Airflow/separate DB: **nicht eingeführt**.
Die durable Queue läuft auf der bestehenden SQLite-DB (cp_queue), der Scheduler
ist Teil der Control Plane. Kein zweiter Controller, kein Agenten-Zoo.
