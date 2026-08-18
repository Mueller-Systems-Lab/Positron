# Positron Durable Control Plane

> **POSITRON IS THE CONTROLLER. LLMs ARE WORKERS. LLMs ARE NOT THE CONTROLLER.**

Status: **implementiert** (Issue #421) — der dokumentierte Ist-Zustand ist im
Code verifiziert (Unit- und Integrations-Tests in `packages/control-plane`).

Diese Datei beschreibt die durable Control-Plane-Schicht von Positron.
Sie ergänzt die bestehende Architektur (`docs/architecture.md`, Blueprint) —
kein Rewrite, keine Parallelarchitektur. Bestehende Komponenten
(run-state, Speckit-/OpenCode-Adapter, Sandbox, SQLite, Worker) werden
wiederverwendet.

## Rollenverteilung

| Komponente | Rolle |
|---|---|
| **Positron Control Plane** (`packages/control-plane`) | entscheidet, orchestriert, persistiert, blockt |
| **Spec Kit** | erzeugt fachliche Artefakte (Spec, Plan, Tasks) — orchestriert die Runtime NICHT |
| **OpenCode** | Execution Worker: plant read-only, implementiert im Workspace |
| **Deterministic Tools** | messen: Tests, Build, Lint, Typecheck, Schema/Contract-Validierung |
| **GitHub** | Source of Truth für Issues/PRs, Status-Sync |

## Run / Job / Attempt Modell

```
run (cp_runs-artig: bestehende runs-Tabelle)
 └── job (cp_jobs: job_type, state, parent_job_id)
      └── attempt (cp_attempts: input/output contract + fingerprint,
                   worker_type, provider, model, failure_class,
                   failure_signature, new_evidence, strategy_delta,
                   result_ref, output_json, tokens)
```

- Persistenz: **bestehende SQLite-DB** des run-state Packages
  (Migrationen `applyControlPlaneMigrations`, Tabellen `cp_*`).
- Jeder mutierende Versuch ist **idempotent**: Idempotency Key
  `run_id:job_id:attempt_id` (`cp_idempotency`). Doppelter Dispatch oder
  doppeltes Completion-Event führt zu keiner zweiten Mutation.
- Attempt-Historie ist unveränderlich: Fix-Atempts überschreiben nichts,
  jeder Versuch bleibt mit eigener `attempt_id` nachvollziehbar.

## State Machine

Die bestehende run-state Machine (28 Phasen) bleibt der kanonische
Run-Graph. Die Control Plane ergänzt maschinenlesbare Übergänge mit
`reason_code` (`cp_transitions`):

```
BASELINE_OK        → nächste valide Phase
PLAN_VALID         → BUILDING (PLAN_GATE_APPROVED)
PLAN_INVALID       → PLAN_BLOCKED (PLAN_GATE_REJECTED)
VERIFY_FAILED+delta→ FIX_REQUIRED
VERIFY_FAILED−delta→ SPLIT_REQUIRED (RETRY_DENIED_NO_STRATEGY_DELTA)
SECURITY_BLOCK     → BLOCKED (kein Mehrheitsvotum)
ALL_HARD_GATES_GREEN→ DONE
```

Jeder Übergang speichert: `timestamp, previous_state, new_state, reason_code`.

## Versionierte Data Contracts

Logische Contracts (JSON-Schema-artig, deterministischer Validator, kein
LLM-Urteil über Gültigkeit):

```
positron.issue.v1 · positron.baseline.v1 · positron.research.v1
positron.plan.v1 · positron.build-input.v1 · positron.build-result.v1
positron.verification.v1 · positron.finding.v1 · positron.review-batch.v1
positron.decision.v1 · positron.split.v1 · positron.run-event.v1
```

Jeder Contract: `CONTRACT_ID + VERSION + SCHEMA + VALIDATOR`.
Fail-closed: unbekannte Contract-ID oder Version → INVALID
(`UNKNOWN_CONTRACT` / `UNKNOWN_VERSION`).

## Fingerprints

Stabiler SHA-256 über kanonisches JSON (sortierte Keys, keine
Runtime-Felder: Timestamps, `duration_ms`, `result_ref` …):

- gleicher semantischer Inhalt → gleicher Fingerprint
- geänderter Inhalt → anderer Fingerprint
- Timestamps ändern den Fingerprint nicht

## Deterministische Gates

1. **Plan Gate** (`evaluatePlanGate`): Schema valid, run_id valid,
   Repository-Identität konsistent, HEAD konsistent (40-hex), Acceptance
   Criteria vorhanden, Build-Scope strukturell valid, Required Tests
   vorhanden, Context-Fingerprint vorhanden, keine verbotenen Mutationen.
   Ergebnis: `APPROVED | REJECTED | BLOCKED` mit `reason_code`.
   **Nur `PLAN_GATE_APPROVED` gibt den Build frei.**
2. **Verification** (`buildVerificationContract`): Messbare Ergebnisse
   werden von Tools gemessen (TestRunner, Build, Lint, Typecheck), nicht
   von LLMs beurteilt. Output: `positron.verification.v1` mit `passed`,
   `checks`, `failure_class`, `failure_signature`, `new_evidence`.
3. **Decision Policy** (`buildDecision`): Positron entscheidet —
   `DONE | FIX | SPLIT | BLOCKED`, immer mit `reason_code`.
   Security Hard Block: Ein blockierendes Security-Finding (HIGH/CRITICAL)
   blockiert hart — **Security ist kein Mehrheitsvotum** ("2 of 3 → DONE"
   existiert nicht).

## Failure Classification

`TEST_FAILURE · BUILD_FAILURE · LINT_FAILURE · TYPECHECK_FAILURE ·
CONTRACT_FAILURE · CONTEXT_FAILURE · PROVIDER_FAILURE · INFRA_FAILURE ·
TIMEOUT · SECURITY_BLOCK · UNKNOWN`

Provider-/Infrastrukturfehler werden **nie** als Modellunfähigkeit gewertet
(kein Test-Failure aus Provider-Timeouts).

## Retry Policy (Information Gain)

Blindes `while iterations < MAX_ITERATIONS` ist ersetzt durch:

```
attempt < max_attempts
UND failure_signature existiert
UND mindestens ein informationshaltiges Delta:
    new_evidence | strategy_delta | provider_change | model_change | input_change
```

Ohne Delta: `RETRY_DENIED_NO_STRATEGY_DELTA` — **kein zweiter LLM-Aufruf**
für identische Versuche (Blind-Retry-Canary beweist das).

## Split Policy

Wenn eine Aufgabe nicht sinnvoll weiterbearbeitet werden kann: SPLIT mit
`positron.split.v1` (parent_run_id, reason, subtasks mit eigenen Acceptance
Criteria, dependencies). Limits verhindern Task-Explosion:
`max_split_depth: 3`, `max_subtasks: 5`.

## Idempotenz & Recovery

- Jeder mutierende Jobversuch: Idempotency Key `run_id:job_id:attempt_id`.
- Recovery-Boundary: Abgeschlossene Jobs (`cp_jobs.state = succeeded`)
  werden **nie erneut ausgeführt**. Beim Resume wird der letzte
  verifizierte Build-Attempt wiederverwendet (`output_json` enthält den
  vollständigen Verification-Contract) — der Run läuft an der validen
  Boundary weiter (REVIEW/DECIDE), ohne den Worker erneut aufzurufen.
- Der Worker persistiert den Run vor der ersten Phase (FK-Integrität,
  sichtbarer durable Run auch bei Crash in der ersten Phase).

## Build Boundary

OpenCode Build startet nur über einen validierten Build-Input
(`positron.build-input.v1` mit plan_fingerprint, repository identity/head,
workspace). Build darf im Workspace Dateien lesen/ändern, Tests/Build/Lint
ausführen — aber nicht automatisch `git push`, `merge`, `release`,
`deploy` oder Secrets lesen (Kill-Switches: `POSITRON_ENABLE_PUSH`,
`POSITRON_MERGE_KILL_SWITCH`; Gate-Runtime-Modi fixture/demo/supervised/real).

## DFG / TSG Trennung

- **Data Flow Graph**: Issue → Baseline → Plan → ApprovedPlan → BuildResult
  → VerificationResult → ReviewBatch → Decision
- **Task Schedule Graph**: INTAKE → BASELINE → PLAN → PLAN_GATE → BUILD →
  VERIFY → REVIEW → DECIDE

Scheduling darf keine Datenabhängigkeiten überspringen (Plan Gate vor Build,
Verification vor Decision).

## Observability & Telemetry

Jeder Run/Job/Attempt hat IDs; jeder State Change hat
`timestamp, previous_state, new_state, reason_code`. Attempt-Telemetrie
erfasst: duration, job_type, status, input/output contract + fingerprint,
worker_type, provider, model, failure_class, failure_signature,
new_evidence, strategy_delta, decision, reason_code. Kosten werden nur
berechnet, wenn Preis + Tokenverbrauch belastbar bekannt sind (nie
geschätzt und als Fakt gespeichert).

## Privacy by Default

`METADATA_FIRST, CONTENT_OFF_BY_DEFAULT`: Keine API-Keys, Authorization
Header, `.env`, vollständige Prompts/Repository-Inhalte/Modell-Antworten im
Log. Bevorzugt: Hash, Größe, Typ, Referenz, sichere Metadaten.

## Implementierungsumfang (Issue #421)

| Bereich | Wo |
|---|---|
| Contracts, Validator, Fingerprints | `packages/control-plane/src/contracts.ts`, `fingerprint.ts` |
| Job/Attempt/Decision/Transition-Store, Schema | `store.ts`, `schema.ts` |
| Idempotency | `idempotency.ts` |
| Plan Gate | `plan-gate.ts` |
| Verification + Failure Classification | `verification.ts`, `failure.ts` |
| Retry Policy | `retry-policy.ts` |
| Decision Policy | `decision-policy.ts` |
| Split Policy | `split.ts` |
| Durable Run Orchestrierung (inkl. Recovery) | `durable-run.ts` |
| Worker-Pipeline-Integration | `apps/worker/src/pipeline-runner.ts` |
| Tests | `packages/control-plane/src/__tests__/` + `apps/server/src/__tests__/durable-worker-integration.test.ts` |

Zielzustand (nicht implementiert, dokumentiert): Kosten-Analytik (nur wenn
Preis + Tokenverbrauch belastbar; sonst `COST_ANALYTICS=DEFERRED_BY_DESIGN`).
Research-Parallelität, Active Run View und Runtime-Soak sind mit P2
implementiert (siehe unten).

## P1-Status (implementiert in Folgearbeit)

- **Real Fan-out/Join (Reviews)**: `runParallelReviews` führt
  correctness/security/quality-Reviews als echte parallele Worker aus.
  Parallelität wird über die tatsächliche zeitliche Überschneidung der
  Ausführungen bewiesen (`assertRealParallelism`: started_at/ended_at je
  Review, paarweiser Overlap) — Ergebnis `PARALLELISM_PROVEN` oder
  `PARALLELISM_NOT_PROVEN`, nie aus Code-Struktur behauptet. Jeder
  Review-Worker läuft in einem eigenen Attempt (Telemetrie). Das Verdict
  wird in die Decision-Basis geschrieben.
- **KPIs** (`computeKpis`): deterministische Metriken aus
  cp_attempts/cp_decisions/cp_transitions — first-pass success rate, mean
  attempts to DONE, blind retry rate, duplicate mutation rate, contract
  validation failure rate, plan gate rejection rate, security block
  enforcement rate, useful retry rate, trace completeness, p50/p95 stage
  durations. Kern-Invarianten (verifiziert per Test über reale Daten):
  Blind-Retry-Rate = 0, Duplicate-Mutation-Rate = 0,
  Security-Hard-Block-Enforcement = 100 %.
- **Backend-Truth zuerst**: `GET /api/runs/:id/control-plane` (jobs,
  attempts, decisions, transitions) und `GET /api/kpis` (Metriken +
  Invarianten-Violations) — read-only Grundlage für die spätere
  Active-Run-View. Keine simulierte UI.

## P2-Status (implementiert in Folgearbeit)

### Research Fan-out/Join (echte Parallelität)

```
             RESEARCH
                 │
          BATCH DISPATCH
       ┌─────────┼─────────┐
       ▼         ▼         ▼
     CODE       DOCS      TESTS
       │         │         │
       └─────────┼─────────┘
                 ▼
              BARRIER
                 │
                 ▼
       positron.research.v1
```

- `runParallelResearch` (research.ts): drei logisch unabhängige Worker
  (`research.code`, `research.docs`, `research.tests`) laufen als echte
  parallele Fan-out; jeder Worker persistiert einen eigenen Attempt
  (started_at/ended_at, provider/model, failure_class, output contract +
  fingerprint).
- **Parallelität wird beobachtet, nicht angenommen**: `assertRealParallelism`
  (gemeinsame Primitive in `parallelism.ts`, von Review UND Research genutzt)
  beweist Overlap ausschließlich aus real gemessenen Zeitstempeln.
  `researchOptions.sequential` erzwingt eine explizit sequentielle
  Ausführung für kontrollierte Negative-Canaries — die Zeitstempel bleiben
  real, das Ergebnis ist ehrlich `PARALLELISM_NOT_PROVEN`.
- **Research Barrier** (`evaluateResearchBarrier`): deterministische Semantik
  `JOIN | FAILED | TIMEOUT | BLOCKED` über die Worker-Anforderung
  `REQUIRED` (code) bzw. `OPTIONAL` (docs, tests). OPTIONAL-Fehler werden
  toleriert und bleiben im Contract sichtbar; ein REQUIRED-Fehler blockiert
  den Run deterministisch (reason_code `RESEARCH_FAILURE_*` /
  `RESEARCH_TIMEOUT_*` / `RESEARCH_BLOCKED_*` → Decision BLOCKED).
- **Research Contract**: `positron.research.v1` (bestehende ID, keine
  Duplikation) mit repository_ref/head, results (code/docs/tests inkl.
  Status, summary_ref, Zeiten), parallelism (verdict, observed_overlap_ms),
  started_at/ended_at, context_fingerprint. Validierung + Fingerprint über
  die bestehende Registry.
- **Failure Classification**: neue Klassen `RESEARCH_CODE_FAILURE`,
  `RESEARCH_DOCS_FAILURE`, `RESEARCH_TESTS_FAILURE`. Provider-/Infra-Fehler
  werden über `classifyFailure` korrekt zugeordnet — ein Provider-Ausfall
  wird NIE als "Research agent was incapable" klassifiziert.
- **Recovery**: Research-Job find-or-create; ein abgeschlossener
  research-Job wird beim Resume NIE erneut ausgeführt (Verdict wird aus den
  persistierten Zeitstempeln rekonstruiert, Transition `RESEARCH_RECOVERED`).

### Active Run Mission Control (Backend-Truth UI)

```
Persistent Runtime State (cp_jobs/cp_attempts/cp_decisions/cp_transitions)
        ↓
Backend API (GET /api/runs/:id/control-plane, GET /api/kpis)
        ↓
Frontend Projection (MissionControlPanel, KpiPanel)
```

- **Keine zweite clientseitige Wahrheit**: Die UI rendert ausschließlich die
  read-only Backend-Truth. `current execution`, Timeline, Attempts,
  Fingerprints, Verdicts, Decision — alles Projektion persistierter Daten.
  Keine clientseitig synthetisierten Übergänge, keine Zustandsberechnung.
- **Run Timeline** aus `cp_transitions` (Zeitstempel, previous/new_state,
  reason_code). **Attempt-Historie** bleibt vollständig (alte Attempts
  verschwinden nicht), inkl. failure_class, failure_signature, new_evidence,
  strategy_delta. **Fingerprints** UI-freundlich gekürzt (8 Zeichen +
  Vollwert per Tooltip/Copy).
- **KPI View**: kompakte Projektion von `GET /api/kpis`; Invarianten
  (Blind Retry = 0, Duplicate Mutation = 0, Security = 100 %) werden bei
  Verletzung explizit rot markiert — nie kosmetisch grün.
- **Fehlerzustände**: run not found, Backend temporär nicht erreichbar,
  alte Runs ohne P2-Felder (abwärtskompatible leere Projection), unbekannte
  Zustände — kein Absturz.
- **Privacy by Default**: `output_json` wird nie gerendert (Ausnahme: die
  strukturierten Verify-Gate-Checks eines positron.verification.v1);
  Freitext-Felder laufen durch `sanitizeDisplayText` (Secret-Muster →
  `[redacted]`). Keine API-Keys, Tokens, .env-Inhalte oder raw error
  payloads in der UI.
- **Live-Updates**: bestehendes Polling-Muster (3 s, wie useRun); keine neue
  Streaming-Infrastruktur.

### Runtime Soak & Recovery Proof

- `runtime-soak.test.ts` führt mehrere VOLLSTÄNDIGE reale Runs in
  disposable Git-Workspaces aus (SOAK_SAMPLE_SIZE = 6):
  - Run A Happy Path (INTAKE→BASELINE→RESEARCH→PLAN→PLAN_GATE→BUILD→VERIFY→REVIEW→DONE)
  - Run B Fix Path (VERIFY FAIL → failure_signature → new_evidence →
    strategy_delta → FIX → DONE; Attempt 1 ≠ Attempt 2)
  - Run C Blind Retry Denial (RETRY_DENIED_NO_STRATEGY_DELTA; exakt EIN
    Worker-Call — keine identische Wiederholung)
  - Run D Security Block (grüne Gates + CRITICAL-Finding → BLOCKED,
    reason_code SECURITY_BLOCK)
  - Run E Recovery (Crash nach verify → Resume: completed job wird nicht
    re-runt, keine duplicate mutation, keine doppelte Transition)
  - Run F Parallelism Negative Canary (sequentielles Research →
    PARALLELISM_NOT_PROVEN ohne künstlichen PASS)
- **KPI-Baseline über persistierte reale Daten**: `computeKpis` auf der
  Soak-DB; Invarianten halten (Blind Retry = 0, Duplicate Mutation = 0,
  Security Enforcement = 100 %); berichtet werden First-Pass Success Rate,
  Mean Attempts to DONE, Useful Retry Rate, Trace Completeness, p50/p95 —
  bei SOAK_SAMPLE_SIZE = 6 nicht als Produktbenchmark zu interpretieren.
- **Trace Completeness**: pro wesentlichem Job/Attempt werden run_id,
  job_id, attempt_id, input/output contract + fingerprint, worker,
  provider/model, failure_class/signature (anwendbar) geprüft.

### Known Limitations

- Web-Baseline: 52 vorbestehende apps/web-Testfehler + Vite-Build-Fehler
  durch stale in-place `.js`-Artefakte (JSX in `.js`-Dateien) — unabhängig
  von P2, nicht in diesem Umfang behoben.
- Kostenerfassung: `COST_ANALYTICS=DEFERRED_BY_DESIGN` — keine belastbaren
  Runtime-Kosten, solange Preis-Provenance + echter Tokenverbrauch fehlen.
- Research im Worker (`apps/worker`) läuft weiterhin als klassische
  WEB_RESEARCH-Phase (Artifact-Erzeugung); der durable Research-Job mit
  Fan-out/Join ist über `runDurableRun` (control-plane) nachweisbar und
  wird bei der Worker-Pipeline-Migration auf dieselbe Primitive gehoben.
