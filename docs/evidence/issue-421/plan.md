# Issue #421 — P2 Plan: Research Concurrency + Active Run Mission Control + Runtime Soak

Status: PLAN (Slice 0) — Basis: `0b6fc32` (P1 abgeschlossen), Branch `positron/issue-421-durable-control-plane`

## Stop-Gate Entscheidung (§5 Auftrag)

> Kann Research dieselbe Parallelitätsprimitive wie Review verwenden?
> **JA → minimal gemeinsame Abstraktion.**

Begründung: `assertRealParallelism` (review.ts:63–80) prüft paarweise zeitliche
Überlappung über `started_at`/`ended_at` — rein generische Logik, nur der
Ergebnistyp `ParallelReviewResult` ist review-spezifisch. Es wird ein
gemeinsamer Kern extrahiert:

- NEU `packages/control-plane/src/parallelism.ts`: `ParallelExecutionSlice`
  (minimaler Zeit-Schnitt) + generisches `assertRealParallelism<T extends ParallelExecutionSlice>`.
- `review.ts`: nutzt die generische Primitive (strukturelle Kompatibilität),
  kein Rewrite, alle bestehenden Tests bleiben unverändert grün.
- Keine generische „Distributed Workflow Framework"-Abstraktion, kein neues
  Orchestrator-System, keine zweite State Machine.

## Architektur-Entscheidungen

1. **Research nutzt dasselbe Job/Attempt-Modell** wie Review: ein
   `research`-Job, je Worker (`code`/`docs`/`tests`) ein eigener `cp_attempts`-Eintrag
   mit `started_at`/`ended_at`/`provider`/`model`/`failure_class` — die
   Control-Plane-API zeigt Research automatisch an (job_type `research`), keine
   neue API-Struktur nötig.
2. **`positron.research.v1` wird erweitert** (bestehende, aktuell inerte
   Contract-ID; keine neue ID, keine Contract-Duplikation): + `repository_ref`,
   `repository_head`, `results` (code/docs/tests), `parallelism` (verdict,
   observed_overlap), `started_at`, `ended_at`, `context_fingerprint`.
3. **Research Barrier deterministisch**: `evaluateResearchBarrier` mit
   REQUIRED/OPTIONAL/FAILED/TIMEOUT/BLOCKED; Join nur bei (a) allen REQUIRED
   erfolgreich ODER (b) definiertem Abbruchzustand. `code` = REQUIRED,
   `docs`/`tests` = OPTIONAL (fachlich begründet: Code-Research ist Pflicht,
   Doku-/Test-Research unterstützend).
4. **Failure Classes**: neue Klassen `RESEARCH_CODE_FAILURE`,
   `RESEARCH_DOCS_FAILURE`, `RESEARCH_TESTS_FAILURE` ergänzen die bestehende
   `FailureClass`-Union. PROVIDER_FAILURE/INFRA_FAILURE/TIMEOUT/CONTRACT_FAILURE
   existieren bereits — kein Provider-Ausfall wird als „Agent incapable"
   klassifiziert.
5. **Recovery**: Research-Job im selben Muster wie Build find-or-create;
   completed research wird bei Resume NICHT erneut ausgeführt (Rehydrierung
   über `cp_attempts.output_json`), keine doppelte Mutation.
6. **Active Run UI auf Backend-Truth**: ausschließlich
   `GET /api/runs/:id` + `GET /api/runs/:id/control-plane` + `GET /api/kpis`.
   Keine clientseitige Zustandsrekonstruktion. Bestehende RunDetail-Seite wird
   um ein Mission-Control-Panel erweitert (kein UI-Rewrite, keine neue
   Design-Library).
7. **Keine Event-Streaming-Infrastruktur**: bestehendes Polling-Muster
   (useRun, 3s) wird wiederverwendet.
8. **Soak**: vitest-basierte Real-Runs in disposable Git-Workspaces
   (createTestWorkspace aus vertical-slice-helpers), deterministische
   Build-Worker + echte Verify-Tools, kontrollierte Research-Worker mit real
   messbarer Laufzeit. Keine teuren LLM-Runs, keine Mocks als E2E-Ersatz.

## Slices

### Slice 1 — P2-A Research Fan-out/Join (Backend)
- `packages/control-plane/src/parallelism.ts` (NEU): `ParallelExecutionSlice`,
  generisches `assertRealParallelism`
- `packages/control-plane/src/review.ts`: auf generische Primitive umstellen
  (Re-Export für Kompatibilität)
- `packages/control-plane/src/research.ts` (NEU): `ResearchKind` (code/docs/tests),
  `ResearchWorker`, `runParallelResearch` (Fan-out, Attempt-Persistenz,
  Barrier, Join, Contract, Fingerprint, Verdict), `evaluateResearchBarrier`,
  `listResearchAttempts`
- `packages/control-plane/src/contracts.ts`: `positron.research.v1` erweitern,
  `ResearchBatchContract`-Typ, FailureClasses erweitern
- `packages/control-plane/src/durable-run.ts`: RESEARCH-Phase zwischen BASELINE
  und PLAN (find-or-create, Recovery-Boundary, Transitions `RESEARCH_JOIN` /
  `RESEARCH_BLOCKED`), `DurableRunDeps.researchWorkers?`
- Tests: `research.test.ts` (RESEARCH_BATCH_CREATED, RESEARCH_CODE/DOCS/TESTS_REAL,
  RESEARCH_JOIN, RESEARCH_PARALLELISM_PROVEN/NOT_PROVEN, RESEARCH_CHILD_ATTEMPTS_PERSISTED,
  RESEARCH_CONTRACT_VALID, RESEARCH_FINGERPRINT_VALID, RESEARCH_FAILURE_CLASSIFICATION,
  Barrier-Semantik), vertical-slice.test.ts erweitern (Happy Path mit Research,
  Recovery mit Research, Negative Canary)

### Slice 2 — P2-B Active Run Mission Control (Frontend)
- `apps/web/src/api.ts`: `getControlPlane(runId)`, `getKpis()`
- Neue Komponenten (in `apps/web/src/components/run/`): `MissionControlPanel`
  (Run/Current Execution/Plan/Research/Build/Verify/Reviews/Decision), `RunTimeline`,
  `AttemptHistory` (inkl. Strategy Delta), `FingerprintBadge` (gekürzt + copy),
  `KpiPanel` (Invarianten-Warnung), Fehlerzustände (not found / backend down /
  alte Runs / unknown state) — abwärtskompatible Projection
- Einbindung in `RunDetail.tsx` (bestehende Seite, reuse)
- Sensitive-Content: Renderer zeigt ausschließlich Metadaten; niemals
  output_json/raw events/error payloads
- Tests (`apps/web/src/__tests__/`): `mission-control.test.tsx`,
  `kpi-view.test.tsx` — ACTIVE_RUN_* Suite, OLD_RUN_COMPATIBILITY,
  SENSITIVE_DATA_NOT_RENDERED, KPI_VIEW

### Slice 3 — P2-C Runtime Soak + Recovery Proof (Tests)
- `packages/control-plane/src/__tests__/runtime-soak.test.ts` (NEU):
  - Run A Happy Path (INTAKE→BASELINE→RESEARCH→PLAN→PLAN_GATE→BUILD→VERIFY→REVIEW→DONE)
  - Run B Fix Path (VERIFY FAIL → failure_signature → new_evidence → strategy_delta → FIX → DONE)
  - Run C Blind Retry Denial (RETRY_DENIED_NO_STRATEGY_DELTA, kein zweiter Worker-Call)
  - Run D Security Block (CRITICAL → BLOCKED, reason_code=SECURITY_BLOCK)
  - Run E Recovery (Crash-Injection, completed jobs retained, kein Rerun, keine duplicate mutation)
  - Run F Parallelism Negative Canary (sequentiell → PARALLELISM_NOT_PROVEN, kein künstlicher PASS)
- KPI-Baseline: `computeKpis` über die persistierten Soak-Daten; Invarianten
  (Blind Retry = 0, Duplicate Mutation = 0, Security = 100 %); Reporting
  First-Pass/Mean Attempts/Useful Retry/Trace Completeness/p50/p95 mit
  SOAK_SAMPLE_SIZE
- Trace Completeness: pro wesentlichem Job Pflichtfelder prüfen

### Slice 4 — Doku + Regression + Abschluss
- `docs/architecture/durable-control-plane.md`: P2-Sektion (Research fan-out/join,
  real concurrency proof, Research Contract, Active Run backend-truth model,
  Run timeline, Attempt history, KPI projection, runtime soak strategy,
  recovery evidence, known limitations)
- Regression: `npm run build`, `npm run typecheck`, Backend-Suiten
  (packages/control-plane, apps/server, apps/worker), Web-Suite (neue Tests
  grün, Baseline 52 unverändert), biome lint auf geänderten Dateien
- Issue #421 Abschlusskommentar + Final Classification

## Risiken & Kontrollen

- **Fremde Working-Tree-Dateien** (issue-308/340): nur eigene Dateien stagen,
  niemals `git add -A`; Commits auf `positron/issue-421-durable-control-plane`
- **Web-Baseline 52 Fehler** (vorbestehend, stale .js-Artefakte): neue Tests
  vermeiden betroffene Importpfade; DoD = neue Tests grün, Baseline nicht
  verschlechtert
- **Kein Fake-GREEN**: Parallelität nur über reale Zeitstempel, UI nur über
  reale API-Responses, Recovery nur über echte Crash-Boundary
- **Keine Secrets**: keine Token/Keys in Tests oder UI-Fixtures

## Akzeptanzkriterien

Siehe Auftrag §36 (Definition of Done P2) — alle Gates werden im
Abschlusskommentar einzeln belegt.
