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
- (Mit P3 überholt: Research im Worker läuft jetzt als persistenter
  research-Job/Attempt in der kanonischen Boundary — siehe P3-Status.)

## P3-Status (Canonical Durable Execution Adoption)

> **One control plane. One canonical execution lifecycle. Every productive
> worker is accountable to a persisted job and attempt.**

P3 schließt die Runtime-Authority: Es gibt keine zwei Positron-Runtimes
mehr (durable path + legacy direct path). Alle produktiven autonomen
Worker-Ausführungen laufen über die kanonische durable Boundary.

### Canonical Execution Boundary

```
dispatch(job)
   ↓
validate input contract
   ↓
compute input fingerprint
   ↓
persist job
   ↓
persist attempt (pending)
   ↓
claim execution (pending → running, atomar)
   ↓
execute worker  (NUR mit ControlPlaneExecutionContext + aktiver Attempt)
   ↓
capture raw result safely
   ↓
normalize to typed result
   ↓
validate output contract
   ↓
compute output fingerprint
   ↓
persist result
   ↓
close attempt (final, unveränderlich)
   ↓
deterministic transition
```

- **Lifecycle zentral, Worker-Logik lokal**: Kein Mega-Dispatcher mit
  `switch(job.type)` an einer Stelle. Die Lifecycle-Semantik (persist,
  claim, execute, validate, fingerprint, finalize) ist zentral in
  `packages/control-plane` (store.ts, durable-run.ts); die Worker-Adapter
  (Baseline, Research, Plan, Build, Verify, Fix, Review) kapseln ihre
  fachliche Logik lokal.
- **Live-Pfad = kanonische Boundary**: Der produktive BullMQ-Worker
  (`apps/worker`) und der Server-Inline-Fallback (`runFullPipeline` →
  `runPipeline` aus `@positron/worker-pipeline`) nutzen DIESELBE Runtime.
  Der alte Server-`executePhase` mit untrackten Worker-Aufrufen wurde
  entfernt (toter Code, kein Bypass-Pfad mehr).

### Run → Job → Attempt Ownership (§20)

```
TASK / ISSUE
   ↓
POSITRON RUN
   ↓
PERSISTED JOB
   ↓
PERSISTED ATTEMPT
   ↓
VALIDATED INPUT + FINGERPRINT
   ↓
WORKER EXECUTION (nur mit Execution Context)
   ↓
VALIDATED RESULT + FINGERPRINT
   ↓
PERSISTENCE
   ↓
DETERMINISTIC TRANSITION
```

- **worker invocation count == attempt execution count**: Jeder produktive
  Worker-Aufruf (research/specify/plan/tasks/analyze/build/verify/review)
  gehört genau einem persistierten Attempt. Beweis: Live-Pfad-Canary
  `apps/server/src/__tests__/p3-live-path-bypass-zero.test.ts` zählt
  Worker-Invocationen ZUR LAUFZEIT und vergleicht mit `cp_attempts`.
- **Kein Worker ohne Attempt**: `assertExecutionContext` +
  `assertAttemptActive` erzwingen `run_id/job_id/attempt_id` technisch
  (`EXECUTION_CONTEXT_REQUIRED`); Audit-Canary in
  `canonical-adoption.test.ts` beweist die Ablehnung.

### Execution Context (§35)

`ControlPlaneExecutionContext { run_id, job_id, attempt_id }` ist Pflicht
für jede produktive autonome Worker-Ausführung. `assertAttemptActive`
prüft zusätzlich, dass der Attempt geclaimt (`running`) ist — ein
Provider-/OpenCode-Aufruf außerhalb eines aktiven Attempts wird abgelehnt.

### Worker Adapter Lifecycle (§7, §9)

Produktive Worker-Typen (mit ihren fachlichen Schritten):

```
baseline              (deterministic.baseline)
research.code/docs/tests
plan / specify / tasks / analyze
build                 (opencode)
verify                (deterministic-tools)
fix                   (build attempt N+1, previous_attempt_id-Kette)
review.correctness / review.security / review.quality
```

Fachliche CLI-Schritte (specify/tasks/analyze, nicht-strukturierte Plans)
persistieren ihren Output als generischen `positron.artifact.v1`-Contract
(validiert + fingerprintet) — die Output-Boundary gilt auch für
Artefakt-Schritte (§24).

### Claim Semantics (§22)

`claimAttempt`: atomares `UPDATE ... WHERE status='pending'` (SQLite).
Genau EIN Claimer gewinnt; paralleler Doppel-Claim desselben Attempts wird
abgelehnt (`duplicate-claim`). Keine separate Lock-Infrastruktur nötig.

### Idempotency Semantics (§23)

- Idempotency Key `run_id:job_id:attempt_id` (`cp_idempotency`).
- Live-Pfad-Recovery: `trackJobAttempt` findet einen abgeschlossenen
  `succeeded`-Attempt mit passendem Input-Fingerprint und wiederverwendet
  ihn (`recovered`) — KEIN neuer Worker-Aufruf, kein neuer Attempt.
- `IDEMPOTENT_DISPATCH` (Test): gleicher Run 2× dispatched → eine Mutation,
  eine effektive Worker-Ausführung. `DUPLICATE_COMPLETION` (Test): zweites
  Completion-Event auf finalem Attempt ist eine No-Op.
- **Fachliche Semantik**: at-least-once delivery + idempotenter Effekt.
  Duplicate delivery → keine doppelte effektive Mutation. "Exactly once"
  wird nicht behauptet.

### Result Validation (§24)

Worker-Rohantworten verändern den Control-Plane-State nie direkt:

```
RAW WORKER OUTPUT → NORMALIZATION → CONTRACT VALIDATION →
FINGERPRINT → PERSISTENCE → STATE TRANSITION
```

Ungültige Ausgabe (`validateContract` fehlgeschlagen) → Attempt `blocked`
mit `failure_class: CONTRACT_FAILURE`, keine erfolgreiche Transition.
Dies gilt im Live-Pfad (build-result, verification, artifact) und in
`runDurableRun` (build-result, plan, baseline, verification).

### Attempt Lifecycle (§21)

Kanonische Status-Taxonomie (eine, keine zweite):

```
pending → running → succeeded | failed | blocked | timed_out | denied
pending/running → succeeded | failed | blocked | timed_out | denied
succeeded → failed  (NUR als fachliche Reklassifikation build+verify,
                     mit failure_class + failure_signature)
```

Finale Zustände sind unveränderlich: Late Results und doppelte
Completions überschreiben NIE einen finalen Attempt
(`canTransitionAttempt` + atomare `completeAttempt`-Transaktion).

### Timeout Handling (§27) & Late Results (§28)

- `withTimeout` beendet langlebige Build-/Verify-Worker deterministisch:
  Attempt → `timed_out` mit `failure_class: TIMEOUT`, Decision BLOCKED,
  keine unhandled rejection, kein Zombie-Job.
- Late Result nach Timeout wird vom Transition-Guard verworfen
  (`TIMED_OUT → SUCCEEDED` ist keine valide Transition) — Test
  `LATE_RESULT_IGNORED` + `TIMEOUT`.
- Bekannte Grenze: `Promise.race` cancelt den zugrunde liegenden
  Worker-Prozess nicht (Side-Effekte eines verspäteten Workers werden nicht
  aktiv abgebrochen; der Attempt-State bleibt korrekt final).

### Recovery Commit Boundary (§30, §31)

Arbeit gilt erst als sicher abgeschlossen, wenn:

```
worker completed
+ result normalized
+ contract valid
+ fingerprint computed
+ result persisted
+ attempt finalized
```

Danach: `RECOVERY_BOUNDARY_COMMITTED` — abgeschlossene Arbeit wird nach
Recovery nie blind wiederholt. Nachgewiesene Szenarien (Tests):

| Szenario | Verhalten |
|---|---|
| A Research | code/docs completed, tests offen → code/docs NICHT re-runt, tests resumed |
| B Plan | plan + Contract persistiert, Crash vor Gate → Plan nicht re-erzeugt, Gate mit persistiertem Result |
| C Build | build succeeded + persistiert, Crash vor verify → BUILD_WORKER_CALLS=1, verify nachgezogen |
| D Verify | verify completed + persistiert, Crash vor Decision → verify nicht erneut ausgeführt (Rehydratation) |
| E Partial Review | correctness completed, security/quality offen → correctness nie erneut aufgerufen |

Im Live-Pfad: `trackJobAttempt` (Recovery-Boundary mit
Input-Fingerprint-Match) + Verify-Rehydratation im TEST-Pfad.

### Legacy Path Migration (§33, §34)

```
BEFORE: server executePhase (untracked opencode/speckit/TestRunner-Aufrufe)
AFTER:  runPipeline (kanonische Boundary, tracked attempts)
STATUS: REMOVED (toter Code entfernt, kein Bypass-Pfad)

BEFORE: Worker WEB_RESEARCH/SPECIFY/PLAN/TASKS/ANALYZE (ohne Job/Attempt)
AFTER:  trackJobAttempt + assertWorkerContext (persistenter Job/Attempt)
STATUS: ROUTED

BEFORE: retryFromPhase-Fix-Loop (blinder Retry über Phasen)
AFTER:  delta-basierte Retry Policy (evaluateRetry) + Fix-Kette
        (previous_attempt_id)
STATUS: ROUTED

BEFORE: Server-Inline runFullPipeline (zweite Runtime)
AFTER:  runFullPipeline → runPipeline (eine Runtime)
STATUS: ROUTED
```

`PRODUCTIVE_WORKER_BYPASS_COUNT = 0` (Test: Live-Pfad-Canary, keine
produktive Worker-Invocation ohne persistierten Job + aktiven Attempt).

### P3-Evidenz (Testmatrix)

| Gate | Nachweis |
|---|---|
| EXECUTION_PATH_INVENTORY | `docs/evidence/issue-421/execution-path-inventory.md` |
| CANONICAL_DISPATCH | `durable-run.ts` + `worker-pipeline` |
| EXECUTION_CONTEXT_REQUIRED | `canonical-adoption.test.ts` |
| JOB/ATTEMPT_PERSISTED_BEFORE_EXECUTION | `canonical-adoption.test.ts` |
| BASELINE_CANONICAL / PLAN_READ_ONLY / PLAN_GATE | `canonical-adoption.test.ts` |
| RESEARCH_CANONICAL + PARALLELISM | `research.test.ts`, `vertical-slice.test.ts` |
| BUILD/VERIFY/FIX/REVIEW_CANONICAL | `vertical-slice.test.ts`, `p3-live-path-bypass-zero.test.ts` |
| WORKER_PROVENANCE | `canonical-adoption.test.ts` |
| INPUT/OUTPUT CONTRACT + FINGERPRINT | `p3-live-path-bypass-zero.test.ts` |
| INVALID_WORKER_RESULT_REJECTED | `canonical-adoption.test.ts` |
| IDEMPOTENT_DISPATCH / DUPLICATE_COMPLETION | `canonical-adoption.test.ts`, `attempt-lifecycle.test.ts` |
| ATTEMPT_CLAIM_EXCLUSIVE | `attempt-lifecycle.test.ts` |
| TIMEOUT / LATE_RESULT_IGNORED | `canonical-adoption.test.ts`, `attempt-lifecycle.test.ts` |
| RECOVERY_RESEARCH/PLAN/BUILD/VERIFY/PARTIAL_REVIEW | `canonical-adoption.test.ts` |
| RETRY_WITH_DELTA / WITHOUT_DELTA | `retry-policy.test.ts` |
| SECURITY_HARD_BLOCK | `vertical-slice.test.ts`, `runtime-soak.test.ts` |
| FULL_CANONICAL_HAPPY_PATH / FIX_PATH | `vertical-slice.test.ts` |
| PRODUCTIVE_WORKER_BYPASS_ZERO | `p3-live-path-bypass-zero.test.ts` (Live-Pfad) |

---

# P3.5 — Runtime Hardening (Cancellation, Lease, Fencing)

## Problem (P3-Lücken)

1. `Promise.race([worker(), timeout()])` beendete beim Timeout NICHT den
   Worker-Prozess (Worker lief weiter, Ergebnis wurde nur verworfen).
2. Crash mitten in einem RUNNING Attempt hinterließ eine stale Lease bzw.
   einen hängengebliebenen Claim ohne Besitzerwechsel.

## Lösung

### Cancellation (`packages/control-plane/src/cancellation.ts`)

```
TIMEOUT → CANCEL REQUEST (AbortController.abort + owned Terminator)
       → Worker-Signal (AbortSignal) + Child-Process-Termination
       → Attempt final TIMED_OUT (Transition-Guard)
       → late mutation unmöglich
```

- `CancellationSource { signal, cancelled, cancel, onTerminate }`
- `withCancellableTimeout(promise, timeoutMs, cancellation)` — Timeout ruft
  `cancel()`; Rückgabe `{ok:false, reason:'timeout'}` (kein Wurf, keine
  unhandled rejection)
- `terminateChildProcess(child, {graceMs, killProcessGroup, exitTimeoutMs})` —
  SIGTERM → Grace → SIGKILL; nur owned Prozesse (Liveness-Check gegen
  PID-Reuse, Security-Review m1); Prozessgruppe nur bei explizitem
  `killProcessGroup`
- `startLeaseHeartbeat(cancellation, renew, ttlMs)` — Intervall = ttl/3

### Durable Lease + Fencing (`store.ts`, `schema.ts` V3, `execution-context.ts`)

`cp_attempts` erweitert: `lease_owner_id`, `lease_generation`,
`lease_expires_at`, `claimed_at`.

- `claimAttemptWithGeneration` → `{claimed, generation}` (Fencing-Token)
- `renewAttemptLease` — Heartbeat, nur Owner
- `isAttemptLeaseValid` — Expiry-Check (stale → Authority weg)
- `recoverStaleLeases({ownerId|ownerIdPrefix, now})` — abgelaufene Leases →
  `failed/STALE_LEASE`; Owner-/Prefix-Grenzen respektiert
- `completeAttempt(..., {fencingOwnerId, fencingGeneration})` — Fencing
  VOR dem Transition-Guard UND im UPDATE-WHERE (kein Read-Write-Fenster)
- `assertAttemptActive(db, attemptId, ownerId?)` — aktiv + Lease gültig

**Owner-Semantik:** `ctl:<runId>:<instanceUuid>` — INSTANZ-scoped. Ein
zweiter Controller-Prozess (Recovery/Retry) hat eine andere Instanz-ID und
fencet den ersten real aus (Review-Fix R1). Beim Run-Start wird
`recoverStaleLeases` mit Prefix `ctl:<runId>:` aufgerufen (Zombie-Besitzer
verlieren Authority vor neuer Arbeit). Build-/Verify-/Plan-/Research-/
Review-Attempts claimen mit Lease-TTL (`timeoutMs + 15s`) und halten die
Lease während der Arbeit per Heartbeat am Leben.

### Child-Process-Termination (`packages/sandbox/src/command-runner.ts`)

`runCommand` unterstützt `AbortSignal` + `killGraceMs` + `killProcessGroup`:
Timeout/Abort beendet den Prozess REAL (SIGTERM → SIGKILL), Ergebnis wird
auf `close` finalisiert (vollständige stdout/stderr), kein Zombie, kein
late Result.

## Evidenz

- `runtime-hardening-canaries.test.ts` (11): ACTIVE_CANCELLATION,
  CHILD_PROCESS_TERMINATION (SIGTERM + SIGKILL-Eskalation, Zombie-Checks),
  LEASE_CLAIM/RENEW/STALE_LEASE/RECOVERY, FENCING CANARY (§24), 
  STALE_RESULT_REJECTED, CRASH_MID_BUILD_RECOVERY, DUPLICATE_EFFECT_ZERO
- `command-runner-cancellation.test.ts` (4): Timeout/Abort beenden `sleep 60`
  real, killProcessGroup beendet Prozessbaum, Normalpfad unverändert
- `review-regressions.test.ts` (4): Diamond ≠ Cycle, Provider-Capacity,
  deterministisches Aging, Instanz-scoped Fencing
- `docs/evidence/issue-421/phase-b-runtime-hardening.md`

---

# P4 — Multi-Issue Scheduling (Queue + Deterministic Scheduler)

## Invariante

> LLMs besitzen KEINE Scheduling Authority. Wer startet, wann, mit welchen
> Ressourcen — entscheidet deterministisch Positron.

## Architektur

```
GitHub Issues / Tasks
        │
        ▼
   INTAKE QUEUE (cp_queue, SQLite — keine neue Infrastruktur)
        │
        ▼
 DETERMINISTIC SCHEDULER (admitNext, atomare SQLite-Transaktion)
        │
   ADMISSION CONTROL (maxActiveRuns, Repo-Lock, Provider-Capacity)
        │
   ┌──────┼────────┐
   ▼      ▼        ▼
 RUN A  RUN B    RUN C   (jeder über runDurableRun, kanonischer Lifecycle)
```

## Queue-Modell (`cp_queue`, Schema V4)

- Felder: queue_item_id, source_type/ref, repository_ref, run_id, priority,
  queue_state, dependency_refs, enqueued_at/admitted_at/started_at/finished_at,
  reason_code, dedup_key, provider
- **Dedup** (§48): partieller UNIQUE-Index auf dedup_key für aktive States —
  Duplicate Intake liefert idempotent das bestehende Item
  (reason_code DUPLICATE_INTAKE); nach COMPLETED/CANCELLED/BLOCKED ist ein
  neuer Eintrag möglich (expliziter Re-Run §49, neue run_id, eigene Historie)
- States (§34): QUEUED / WAITING_DEPENDENCY / WAITING_RESOURCE / ADMITTED /
  RUNNING / COMPLETED / BLOCKED / CANCELLED
- Prioritäten (§37): CRITICAL > HIGH > NORMAL > LOW; unbekannt → NORMAL;
  Aging (§38): LOW→NORMAL→HIGH nach Wartezeit (deterministisch via `now`)
- Reason-Codes (§57): READY, WAITING_DEPENDENCY, GLOBAL_RUN_LIMIT,
  PROVIDER_CAPACITY, REPOSITORY_LOCKED, WORKSPACE_LOCKED, DEPENDENCY_CYCLE,
  DUPLICATE_INTAKE, CANCELLED_BY_USER, HEAD_DRIFT

## Scheduler (`admitNext`)

Deterministische Ordnung pro Kandidat:
1. **Dependency-Readyness** (alle dependency_refs COMPLETED) — Cycle-Erkennung
   zuerst (DFS-Pfad, Diamond-sicher: A→[B,C], B→D, C→D ist KEIN Cycle)
2. **Repository-Lock** (§42/§43): keine zwei mutierenden Runs im selben Repo
   (Reason REPOSITORY_LOCKED — vor dem Global-Limit geprüft)
3. **Global-Limit** (§39): `maxActiveRuns` (env `POSITRON_MAX_ACTIVE_RUNS`,
   Default 2) — Backpressure: warten, nie spawn-anyway, nie drop
4. **Provider-Capacity** (§40/§65): nur Items mit vollem eigenen Provider
   warten (PROVIDER_CAPACITY); andere Provider laufen unabhängig
5. **FIFO** innerhalb gleicher Priorität (enqueued_at)

Admission läuft in EINER `db.transaction` (BEGIN IMMEDIATE) — konkurrierende
Scheduler-Prozesse können maxActiveRuns/Repo-Lock/Provider nicht umgehen
(ONE_ADMISSION, §55; Security-Review M1 behoben).

## Lifecycle + Recovery

- `markRunStarted` / `markRunFinished` (Events RUN_STARTED/RUN_FINISHED)
- `cancelQueueItem` (QUEUED→CANCELLED; Events persistiert)
- `recoverSchedulerState` (Crash: ADMITTED ohne Run → requeued; RUNNING mit
  totem Run → requeued für kontrollierten Re-Run — kein falsches COMPLETED)
- Events in `cp_scheduler_events` (§56): QUEUED/ADMITTED/RUN_STARTED/
  RUN_FINISHED/RESOURCE_RELEASED/CANCELLED mit timestamp + reason_code

## API + UI

- Backend Truth (§58): GET /api/scheduler/queue|active|waiting|capacity|events
  (read-only); POST enqueue|tick|items/:id/cancel (requireAdmin, fail-closed)
- Mission Control (§59): `SchedulerQueuePanel` — Backend-Truth-Projektion
  (Queued/Waiting/Running/Priority/Repository/Reason + Kapazität), kein
  UI-Rewrite, keine zweite State-Truth
- Kosten-Scheduling bleibt DEFERRED_BY_DESIGN (§60) — Capacity ohne Cost

## Evidenz

- `scheduler-canaries.test.ts` (14): Queue-Persistenz/Ordnung, Priorität+FIFO,
  Aging, Admission/Limit/Backpressure (Negative Canary: nie > Limit), Dedup/
  Re-Run, Dependencies+Release+Cycle+Failure, Repo-Lock, Cancellation,
  Resource-Release, Recovery
- `scheduler-vertical-slice.test.ts` (6): Multi-Issue-Slice mit ECHTEN
  parallelen Runs (Zeitüberlappung aus cp_attempts belegt), Failure-Isolation,
  Double-Admission-Prevention, Events, Queue-Recovery
- `scheduler-api.test.ts` (7): read-only ohne Auth, write mit Admin-Token
  (401 ohne), voller API-Lifecycle
- `scheduler-queue-panel.test.tsx` (3): UI-Projektion, Fehlerzustand
- `review-regressions.test.ts` (4): Diamond≠Cycle, Provider-Capacity,
  Aging-Promotion, Instanz-Fencing
- `docs/evidence/issue-421/phase-d-p4-multi-issue-scheduling.md`

---

# OpenCode Unattended Autonomy (Phase A)

Siehe `docs/evidence/issue-421/phase-a-opencode-autonomy.md`:

- Lokale Version **1.15.13** (`/home/xxammaxx/.opencode/bin/opencode`),
  `--auto` lokal NICHT unterstützt (AUTO_FLAG_NOT_SUPPORTED_LOCALLY);
  persistente No-Ask-Konfiguration in `~/.config/opencode/opencode.json`
  + `~/.config/opencode/agents/*.md` (Backup vor Änderung, sha256-verifiziert)
- Effektive Permissions deterministisch (ALLOW/DENY, kein ASK) für alle 11
  Agenten; `.env`-Lesen: read-Deny + Bash-Deny-Regeln (`cat/grep/rg .env*`)
- Canaries: Root/Subagent/Neue-Session (0 Permission-Events), Preflight
  `scripts/opencode-autonomy-preflight.sh` (AUTONOMY_PREFLIGHT=PASS)

---

# P5.1 — Harness Profile Identity, Provenance & Metrics Foundation

> **P5.1 misst und identifiziert die tatsächlich auf einem produktiven
> LLM-Attempt wirksame Harness-Konfiguration — es führt KEIN adaptives
> Routing ein (P5.3) und keinen Profile-Compiler (P5.2).**

Status: **implementiert** (Issue #423). Die dokumentierte Semantik ist im
Code verifiziert (`harness-profile.ts`, `contracts.ts`, `schema.ts`,
`store.ts`, `kpis.ts`, `pipeline-runner.ts`, `durable-run.ts`,
`apps/server/src/index.ts`; Tests in `harness-profile.test.ts`,
`p5.1-migration.test.ts`, `real-two-profile-canary.test.ts`,
`p5.1-profile-api.test.ts`).

**Siehe auch:** [`docs/architecture/adaptive-model-harness.md`](adaptive-model-harness.md)
— P5-Vision (Issue #422), Architektur-Grenze und Abhängigkeitskette
P4 GREEN → #423 → #424 → #425 → #426.

## Identitätsmodell (vier Ebenen)

Vier Ebenen werden unterschieden; jede Ebene hat konkrete persistierte
Felder auf `cp_attempts` (V7):

| Ebene | Bedeutung | Persistierte Felder |
|---|---|---|
| **A. Model Adapter** | technische Runtime-/Provider-Kompatibilität | `provider_adapter_id`, `provider_adapter_version` (nur wenn tatsächlich bekannt) |
| **B. Model Profile** | modellbezogene Harness-Konfiguration | `harness_profile_id`, `harness_profile_version` |
| **C. Task Profile** | Aufgabenprofil (PLAN / BUILD / RESEARCH / REVIEW …) | `task_profile_id`, `task_profile_version`, `task_type` (Korrespondenz `cp_jobs.job_type`) |
| **D. Effective Harness** | die auf diesem Attempt tatsächlich wirksame Kombination; wichtigster Nachweis | `harness_fingerprint` (SHA-256), `harness_profile_ref` (validierter Contract, JSON) |

Zusätzlich: `model_provenance_status` (KNOWN | PROVENANCE_UNAVAILABLE |
LEGACY_PROFILE_UNSPECIFIED). Es wird nur Provenienz gespeichert, die
tatsächlich aus Provider / Adapter / OpenCode / Modellruntime / expliziter
Konfiguration bekannt ist.

## Contract `positron.harness-profile-ref.v1`

Registriert in `contracts.ts` (`CONTRACT_IDS` + `CONTRACT_REGISTRY`,
Version 1). Deterministischer Validator in `harness-profile.ts`
(`validateHarnessProfileRef`, `buildHarnessProfileRef`), kein
LLM-Urteil über Gültigkeit.

Felder: `harness_profile_id`, `harness_profile_version`,
`task_profile_id`, `task_profile_version`, `task_type` (Pflicht),
`provider`, `model` (nullable), `model_provenance_status` (Pflicht),
`provider_adapter_id`, `provider_adapter_version` (nullable),
`effective_harness_fingerprint` (Pflicht, Pattern `/^[0-9a-f]{64}$/`),
`semantics` (Pflicht, plain object — die tatsächlich gehashte
Konfiguration, reproduzierbar).

**Fail-closed** für neue produktive Attempts:

```
UNKNOWN_CONTRACT       — Dokument trägt nicht den kanonischen Contract
UNKNOWN_VERSION        — Version nicht unterstützt
INVALID_PROFILE_REF    — fehlende/leere Profil-IDs, falsche Typen,
                         Provenance-Inkonsistenz (KNOWN ohne provider+model)
INVALID_FINGERPRINT    — effective_harness_fingerprint ≠ Hash der semantics
```

**Fingerprint-Integritätsprüfung:** Der Validator berechnet den Hash der
`semantics` neu (`computeEffectiveHarnessFingerprint`) und vergleicht ihn
mit dem persistierten `effective_harness_fingerprint` — ein erfundener
Fingerprint wird abgelehnt (`INVALID_FINGERPRINT`). Provenance-Konsistenz:
`KNOWN` erfordert `provider` UND `model` (sonst `INVALID_PROFILE_REF`).

**Secret-Detection (Negative Canary):** `assertNoSecretInHarnessMetadata`
wirft bei token-ähnlichen Schlüsseln/Werten
(`HarnessMetadataSecretError`, Code `HARNESS_METADATA_SECRET`) — Profil-
Metadaten mit Secret-Mustern werden NIE persistiert
(`PROFILE_TELEMETRY_NO_SECRETS`). Muster identisch zu
`apps/server` sse/broadcaster.ts (ghp_, gho_, github_pat_, sk-,
AIza, Bearer, xox, AKIA …). Die Prüfung ist **rekursiv** (Objekte und
Arrays, Tiefenlimit 8, fail-closed bei Überschreitung) und deckt
secret-ähnliche Schlüsselnamen ab. **Dokumentierte Grenze:**
hoch-entropische, frei kodierte Blobs (base64/hex ohne bekanntes Präfix)
werden nicht erkannt — die Detection verteidigt gegen die bekannten
Positron-Token-Formate; Profilwerte sind operator-kontrollierte
Identitätsstrings, und die gefährdeten Felder werden in der API nicht
exponiert.

## Effektiver Harness-Fingerprint (Semantik)

`computeEffectiveHarnessFingerprint` — SHA-256 über die **semantische
Harness-Konfiguration nur** (kanonische Fingerprint-Primitive mit
`excludeKeys`). Gehasht wird: `model_adapter` (id/version),
`model_profile` (id/version), `task_profile` (id/version), `provider`,
`model`, `worker_type`, `task_type`, `reasoning_mode`, `tool_surface`,
`context_strategy`, `policy_ref`.

**Ausgeschlossene Runtime-Metadaten** (`HARNESS_RUNTIME_EXCLUDE_KEYS`):
`run_id`, `job_id`, `attempt_id` (+ camelCase `runId`/`jobId`/`attemptId`),
`created_at`, `updated_at`, `started_at`, `ended_at`, `timestamp`,
`duration_ms`, `result_ref`, `log(s)`, `output`, `output_json`,
`output_contract`, `output_fingerprint`, `input_contract`,
`input_fingerprint`.

**Stabilitäts-Garantien** (Tests in `harness-profile.test.ts`):

- gleiche Semantik → gleicher Hash (`EFFECTIVE_HARNESS_FINGERPRINT_STABLE`)
- semantische Änderung → anderer Hash
  (`SEMANTIC_PROFILE_CHANGE_CHANGES_FINGERPRINT`)
- Runtime-Metadaten-Änderung → gleicher Hash (`RUNTIME_METADATA_IGNORED`)

## Provenance-Ehrlichkeit

`ModelProvenanceStatus` (`contracts.ts`):

```
KNOWN                       — Provider + Modell aus tatsächlicher Konfiguration/Runtime
PROVENANCE_UNAVAILABLE      — neuer Attempt ohne belastbare Modell-Provenienz
LEGACY_PROFILE_UNSPECIFIED  — historischer Attempt (vor P5.1) ohne P5-Felder
```

`resolveHarnessProfileFromEnv` (harness-profile.ts) baut die Referenz
ausschließlich aus **expliziter Konfiguration** (env `POSITRON_HARNESS_*`,
`POSITRON_TASK_PROFILE_*`, `POSITRON_MODEL_ADAPTER_*`) + bereits bekannter
Provider-/Modell-/Worker-Information. Fehlende IDs → `unspecified`,
fehlende Provenienz → `PROVENANCE_UNAVAILABLE`. **Kein Alias als
"revision" erfinden** — `PROVENANCE_UNAVAILABLE` ist ehrlicher als
erfundene Präzision; historische Attempts werden nie rückwirkend mit
einem Profil versehen (`NO_RETROACTIVE_PROFILE_INVENTION`,
`isLegacyHarnessAttempt`).

## Migration V7 (`schema.ts` `applyV7`)

Additive, nullable, idempotent, forward-safe, backward-compatible
Migration auf `cp_attempts` (10 Spalten, alle NULLABLE ohne DEFAULT):

```
harness_profile_id · harness_profile_version · harness_fingerprint
harness_profile_ref · task_profile_id · task_profile_version · task_type
provider_adapter_id · provider_adapter_version · model_provenance_status
```

- **Idempotent:** `columnExists`-Prüfung vor jedem `ALTER TABLE` — safe
  für Soak-DB und Produktion.
- **Legacy-kompatibel:** historische Attempts (V1–V6) bleiben ohne
  P5-Felder lesbar und werden als `LEGACY_PROFILE_UNSPECIFIED` /
  `PROVENANCE_UNAVAILABLE` dargestellt — nichts wird erfunden.
- **Keine bestehende Control-Plane-Invariante ändert sich** (verifiziert
  per `p5.1-migration.test.ts`, Gate `NO_RETROACTIVE_PROFILE_INVENTION`).

## Bindung vor Ausführung

- **`PROFILE_REF_BOUND_BEFORE_EXECUTION`:** Jeder NEUE produktive Attempt
  erhält die validierte Harness-Referenz **atomar mit dem
  `createAttempt`-INSERT**, VOR der Modell-Ausführung. Umsetzung in
  `trackJobAttempt` (worker-pipeline) und im Build-Loop von
  `durable-run.ts` (jeweils `resolveHarnessProfileFromEnv` → Felder im
  INSERT).
- **`EXECUTED_PROFILE_EQUALS_PERSISTED_PROFILE`:** Der persistierte
  Contract trägt exakt die Semantik, die zur Laufzeit aktiv war (Canary
  `real-two-profile-canary.test.ts` beweist zwei Profile → zwei
  verschiedene Fingerprints, A ≠ B, jeweils korrekt persistiert).
- **`bindHarnessProfileToAttempt`** (store.ts): atomare Bindung an einen
  Attempt; idempotent (identische Refs → No-op); semantischer Mismatch
  (anderer Fingerprint auf demselben Attempt) wird abgelehnt — keine
  nachträgliche Umschreibung der Historie; finale Attempts sind
  unveränderlich.

## Profile KPIs (`kpis.ts` `computeProfileKpis`)

Deterministische Aggregation aus `cp_attempts` (JOIN `cp_jobs` mit
`job_type='build'`) + `cp_decisions` — Backend Truth, keine
Client-Berechnung.

**Gruppierungsdimensionen:** effektiver Harness-Fingerprint
(Gruppen-Key; historische Attempts → `LEGACY_PROFILE_GROUP` =
`LEGACY_PROFILE_UNSPECIFIED`), dazu `harness_profile_id/version`,
`task_profile_id/version`, `task_type`, `provider`, `model`,
`provider_adapter_id/version`, `model_provenance_status`.

**Verified Success (nicht-tautologisch):** Ein Run zählt als verified
success, wenn in `cp_decisions` eine persistierte **DONE-Entscheidung**
existiert. Die Decision Policy koppelt DONE deterministisch an die
kanonische Verification (`positron.verification.v1` `passed=true`,
`ALL_HARD_GATES_GREEN`) — die Metrik ist an die Control-Plane-Wahrheit
gebunden, NICHT an ein bloßes `attempt.status=succeeded`. Gruppen-
Zuordnung über Build-Attempts; ein Run mit Build-Attempts in mehreren
Gruppen zählt in jeder betroffenen Gruppe.

**Metriken je Gruppe:** `sample_size`, `verified_success_count`,
`verified_success_rate`, `first_pass_success_count/rate`,
`attempts`, `attempts_per_verified_success`,
`time_to_verified_success_ms` (Median erster Build-Start → DONE),
`retry_rate`, `escalation_rate` (SPLIT/BLOCKED), `tokens_total`
(nur bei realer Meldung, sonst null).

**Kosten:** `cost_per_verified_success` ist IMMER
`COST_PER_VERIFIED_SUCCESS_NOT_AVAILABLE = 'NOT_AVAILABLE'` — ohne
belastbare Preis-/Token-Provenienz wird NIE geschätzt (konsistent mit
`COST_ANALYTICS=DEFERRED_BY_DESIGN`).

## API + UI (reine Projektion)

- **`GET /api/runs/:id/control-plane`**: sichere Metadaten-Projektion der
  P5.1-Felder (`harness_profile_id/version`, `harness_fingerprint`,
  `task_profile_id/version`, `task_type`, `provider_adapter_id/version`,
  `model_provenance_status` mit Legacy-Default
  `LEGACY_PROFILE_UNSPECIFIED`). **Kein `output_json`, keine rohen
  Contracts/Semantik, keine Secrets** — Privacy by Default
  (`p5.1-profile-api.test.ts` beweist die Abwesenheit).
- **`GET /api/kpis`**: liefert `{ kpis, profile, invariants }` — die
  Profile-Gruppen aus `computeProfileKpis`, Backend Truth.
- **Mission Control**: `KpiPanel` (`data-testid="profile-kpi-panel"`)
  projiziert die Profile-Gruppen kompakt (Profil-ID, Version, Fingerprint,
  verified success rate, attempts, cost NOT_AVAILABLE); leere Projektion
  bei alten Runs ("No profile data yet") — kein Absturz, kein Erfinden.
  Fingerprints UI-freundlich gekürzt (8 Zeichen, Vollwert per Tooltip).

## Architektur-Einordnung (Scope-Grenze)

```
Control Kernel
   ↓
HARNESS IDENTITY (P5.1 — dieses Issue: Identität + Provenienz + Metriken)
   ↓
P5.2 Profile Compiler (#424 — implementiert, siehe unten)
   ↓
P5.3 Evidence-Based Routing (später, #425)
   ↓
P5.4 Controlled Evolution (später, #426)
```

**P5.1 liefert NUR Identität + Provenienz + Metrics Foundation.** Kein
zweiter Controller, kein adaptives Routing, keine Profil-Promotion, kein
Compiler. Die P5-Vision (Positron = Controller, LLMs = Workers) ist in
[`docs/architecture/adaptive-model-harness.md`](adaptive-model-harness.md)
dokumentiert.

## Security-Invarianten (unverändert)

P5.1 ändert keine bestehende Control-Plane-Invariante. Es bleiben
unverändert gültig (P4 und früher):

- **LLMs besitzen KEINE Scheduling Authority** — wer startet, wann, mit
  welchen Ressourcen, entscheidet deterministisch Positron.
- **Deterministische Gates**: Plan Gate (nur `PLAN_GATE_APPROVED` gibt den
  Build frei), Verification (Tools messen, LLMs beurteilen nicht),
  Decision Policy (Security Hard Block — Security ist kein
  Mehrheitsvotum).
- **Fail-closed Contracts**: unbekannte Contract-ID/Version → INVALID
  (`UNKNOWN_CONTRACT` / `UNKNOWN_VERSION`).
- **Idempotenz & Recovery**: Idempotency Key `run_id:job_id:attempt_id`;
  abgeschlossene Arbeit wird nach Recovery nie blind wiederholt.
- **Attempt-Invarianten**: exakt ein Claimer pro Attempt (Claim + Lease +
  Fencing), finale Attempts unveränderlich (Late Results / Duplicate
  Completions überschreiben nie), `PRODUCTIVE_WORKER_BYPASS_COUNT = 0`.
- **KPI-Invarianten**: Blind-Retry-Rate = 0, Duplicate-Mutation-Rate = 0,
  Security-Hard-Block-Enforcement = 100 %.
- **Privacy by Default**: keine Secrets, keine Prompts/Responses, kein
  `output_json` in der UI; Profil-Telemetrie trägt keine Secrets
  (`PROFILE_TELEMETRY_NO_SECRETS`).

---

# P5.2 — Static Model Profiles, Task Profiles & Safe Runtime Compilation

> **P5.2 kompiliert statische, versionierte Model-/Task-Profile
> deterministisch in eine sichere Effective Runtime Configuration für
> genau EINEN Worker-Attempt. Es führt KEIN adaptives Routing (P5.3) und
> KEINE Evolution/Promotion (P5.4) ein.**

Status: **implementiert** (Issue #424). Die dokumentierte Semantik ist im
Code verifiziert (`profile-compiler.ts`, `contracts.ts`, `schema.ts`,
`store.ts`, `pipeline-runner.ts`, `durable-run.ts`,
`apps/server/src/index.ts`; Tests in `profile-compiler.test.ts`,
`real-two-profile-canary.test.ts`, `p5.1-profile-api.test.ts`).

**Siehe auch:** [`docs/architecture/adaptive-model-harness.md`](adaptive-model-harness.md)
— P5-Vision (Issue #422), Architektur-Grenze und Abhängigkeitskette
P4 GREEN → #423 → #424 → #425 → #426.

## Vertragsmodell (drei neue Contracts)

### `positron.model-profile.v1` (Model Profile — Ebene B)

Versioniert, typed, fail-closed (registriert in `contracts.ts`
`CONTRACT_IDS` + `CONTRACT_REGISTRY`, Version 1):

- `model_profile_id`, `model_profile_version`
- `provider`, `model`
- `provenance { status: KNOWN | PROVENANCE_UNAVAILABLE, revision: string | null }`
  — Revision nur bei tatsächlich gemeldeter Revision, nie erfunden
- `capabilities` (lowercase kebab-case, 1–64 Zeichen), `context_limits {
  max_input_tokens, max_output_tokens }`, `reasoning_modes`, `supported_tools`
- `provider_specific` (plain object, **nur String-Werte** — allowlisted, kein
  Freiform-Passthrough)
- `fingerprint` (SHA-256 über `modelProfileSemantics`)

### `positron.task-profile.v1` (Task Profile — Ebene C)

- `task_profile_id`, `task_profile_version`
- `task_type` ∈ { `PLAN`, `BUILD`, `RESEARCH`, `REVIEW` } (kanonisch,
  Korrespondenz zu `cp_jobs.job_type`)
- `allowed_tools`, `context_strategy`, `reasoning_policy`, `max_steps`,
  `timeout_ms`
- `retry_hints { max_attempts: number | null }` — **NUR Hinweis**: die
  Retry Policy bleibt Kernel-Autorität; kein Profil entscheidet über Retry
- `output_requirements`, `permissions` (KernelPermissions — Profil-Wünsche),
  `fingerprint`

### `positron.effective-harness.v1` (Effective Runtime Configuration — Ebene D)

Ergebnis des Compilers für genau einen Attempt:

- Profil-Refs: `model_profile_ref { id, version, fingerprint }`,
  `task_profile_ref { id, version, fingerprint }`
- Kernel-Policy: `kernel_policy_ref` (Default `positron.runtime-policy.v1`),
  `kernel_policy_fingerprint` (SHA-256)
- `effective_permissions` (Kernel ∩ Profil), `effective_context_strategy`,
  `effective_reasoning_mode`, `effective_tools`, `effective_timeout_ms`,
  `effective_max_steps`
- `run_context_fingerprint` (SHA-256),
  `compiler { version: '1.0.0', reason_codes }`, `fingerprint` (SHA-256)

### KernelPermissions / KERNEL_DEFAULT_PERMISSIONS

`KernelPermissions { mutation, push, merge, deploy, secret_access }`
(`contracts.ts`) ist die Kernel-Policy-Schnittstelle. Die kanonische
Default-Policy `KERNEL_DEFAULT_PERMISSIONS`:

```
mutation: true · push: false · merge: false · deploy: false · secret_access: false
```

Mutation nur innerhalb der Build-Boundary; keine
Push/Merge/Deploy/Secret-Eskalation (Kill-Switches, Security-Modell).
Profile dürfen diese Policy NIE erweitern — der Compiler bildet die
Schnittmenge.

## Compiler-Pipeline (pure, deterministisch)

`compileEffectiveHarness` (`profile-compiler.ts`):

```
1. validate       — Contract-Validierung Model- + Task-Profil (inkl.
                    Fingerprint-Integrität: fingerprint == Hash der Semantik)
2. intersect      — effective_permissions = kernel ∩ profile (NIE union)
3. reject         — unbekannte Profile/Versionen (resolveProfileFromRegistry),
                    nicht unterstützte Tools/Reasoning-Modi (fail-closed)
4. canonicalize   — kanonische, typfeste Effective-Config bauen
5. fingerprint    — reproduzierbarer SHA-256 über die effektive Semantik
6. validate       — Ergebnis wird erneut contract-validiert (kein Bypass)
```

- **Pur/deterministisch:** kein verstecktes `Date.now()`, keine externen
  Nebenwirkungen. Gleiche Eingaben → byte-identische Effective Config und
  gleicher Fingerprint (`EFFECTIVE_PROFILE_REPRODUCIBLE`).
- `computeProfileFingerprint` schließt Runtime-Werte aus
  (`PROFILE_RUNTIME_EXCLUDE_KEYS`: run_id/job_id/attempt_id,
  created_at/updated_at/timestamp, duration_ms, result_ref). Der
  `run_context_fingerprint` ist im Contract enthalten, aber NICHT Teil des
  Effective-Fingerprints — ein Kontextwechsel ändert den Fingerprint nicht
  (Test `run context change does NOT change the effective fingerprint`).
- `resolveProfileFromRegistry` (Registry `Map<id, Versionen[]>`): unbekannte
  ID → `UNKNOWN_PROFILE_DENIED`, unbekannte Version →
  `UNKNOWN_PROFILE_VERSION`, exakter Versions-Match — kein Fallback auf
  andere Profile.
- `resolveEffectiveHarnessFromEnv` (produktiver Pfad, P5.1-kompatibel):
  Task-Profil per `POSITRON_TASK_PROFILE_ID` oder Default nach taskType
  (unbekannt → BUILD); Model-Profil aus `POSITRON_HARNESS_PROFILE_ID` /
  `POSITRON_HARNESS_PROFILE_VERSION` + provider/model (Provenienz `KNOWN`
  nur bei tatsächlicher Kenntnis, sonst `PROVENANCE_UNAVAILABLE`, revision
  null); Kernel = `KERNEL_DEFAULT_PERMISSIONS`; Run-Context-Fingerprint
  über `{ worker_type, task_type }`.
- `buildTaskProfile`: Konstruktor, der den Profil-Fingerprint automatisch
  berechnet (die kanonischen Task-Profile unten nutzen ihn).

## Permission-Modell: effective = kernel ∩ profile

`intersectPermissions(kernel, profile)` (`profile-compiler.ts`) — `true`
nur, wenn BEIDE `true` sind:

```
mutation:      kernel.mutation      && profile.mutation
push:          kernel.push          && profile.push
merge:         kernel.merge         && profile.merge
deploy:        kernel.deploy        && profile.deploy
secret_access: kernel.secret_access && profile.secret_access
```

- Profile können die Kernel-Policy NIE erweitern (**KERNEL_DENY_WINS**).
- Ein Profil, das `push/merge/deploy/secret_access: true` verlangt,
  kompiliert mit `false` — der Deny ist in `effective_permissions`
  sichtbar (Tests `KERNEL_PERMISSION_CANNOT_BE_ESCALATED`,
  `SECURITY_CANARY_DENIED_BY_KERNEL_POLICY`).
- `DENIED_BY_KERNEL_POLICY` ist Teil des Reason-Code-Vokabulars, reserviert
  für explizite Prüfpfade; der normale Compiler-Pfad bildet Kernel-Denys
  über die Intersection ab (sichtbar, nie ein stiller Override).

## Reason Codes (fail-closed, kein silent downgrade)

`ProfileCompilationError` (`profile-compiler.ts`) trägt immer einen
Reason Code:

| Code | Bedeutung |
|---|---|
| `UNKNOWN_PROFILE_DENIED` | unbekannte Profil-ID in der Registry |
| `UNKNOWN_PROFILE_VERSION` | bekannte ID, unbekannte Version |
| `PROFILE_INVALID` | typed Contract verletzt (Schema, Fingerprint-Integrität, timeout_ms/max_steps nicht positiv) |
| `TOOL_NOT_ALLOWED` | Tool außerhalb Kernel∩Profil (Vokabular) |
| `PROFILE_INCOMPATIBLE` | Context-/Tool-/Capability-Mismatch, z. B. `reasoning_policy` nicht im Model-Profil |
| `DENIED_BY_KERNEL_POLICY` | angefragte Permission über Kernel-Policy (Vokabular; Pfad: Intersection) |
| `ADAPTER_CAPABILITY_MISMATCH` | Adapter kann Setting nicht honorieren — kein stiller Drop |

**Kein silent downgrade:** Ein Tool in der Profil-Allowlist, das der
Adapter nicht unterstützt, wird NICHT stillschweigend entfernt — der
Compiler lehnt mit `ADAPTER_CAPABILITY_MISMATCH` ab
(Test `ADAPTER_SETTING_NOT_SILENTLY_DROPPED`); ein Reasoning-Modus außerhalb
des Model-Profils → `PROFILE_INCOMPATIBLE`
(Test `PROFILE_COMPILER_UNKNOWN_CAPABILITY_DENIED`).

## Kanonische Task-Profile (`DEFAULT_TASK_PROFILES`)

| Profil | task_type | Tools | context | reasoning | steps | timeout | mutation |
|---|---|---|---|---|---|---|---|
| `PLAN_TASK_PROFILE` | PLAN | read, grep, list, cat | full | deep | 1 | 300 s | **false** (read-only) |
| `BUILD_TASK_PROFILE` | BUILD | read, grep, list, cat, edit, write, test | compact | fast | 5 | 600 s | **true** (bounded, innerhalb Kernel) |
| `RESEARCH_TASK_PROFILE` | RESEARCH | read, grep, list, cat, search | full | deep | 3 | 600 s | **false** (Tool-Subset, keine Workspace-Mutation) |
| `REVIEW_TASK_PROFILE` | REVIEW | read, grep, list, cat, diff | full | deep | 1 | 300 s | **false** (read-only) |

- Alle vier sind Kernel-konform konstruiert (`buildTaskProfile` mit
  Kernel-konformen Defaults) und per `validateTaskProfile` verifiziert
  (Test `TASK_PROFILE_VALID` — alle kanonischen Profile valid +
  fingerprinted; ungültiger `task_type` → invalide).
- `push`/`merge`/`deploy`/`secret_access` sind in ALLEN Profilen `false`.
- Tests je Profil: `PLAN_PROFILE_READ_ONLY`,
  `BUILD_PROFILE_MUTATION_ALLOWED_WITHIN_KERNEL`,
  `RESEARCH_PROFILE_TOOL_LIMIT` (kein edit/write, enthält search),
  `REVIEW_PROFILE_READ_ONLY` (enthält diff).

## Persistenz V8 (`schema.ts` `applyV8`)

Additive, nullable, idempotente, forward-safe und backward-compatible
Migration auf `cp_attempts` (2 Spalten, NULLABLE ohne DEFAULT):

```
effective_harness_config      — validierter positron.effective-harness.v1
                                Contract (JSON; reproduzierbar rekonstruierbare
                                Effective Config inkl. effective permissions
                                Kernel ∩ Profil)
effective_harness_fingerprint — SHA-256 der Effective Config (ohne
                                Runtime-Werte)
```

- **Idempotent:** `columnExists`-Prüfung vor jedem `ALTER TABLE` — safe
  für Soak-DB und Produktion.
- **Legacy-kompatibel:** historische Attempts (V1–V7) bleiben unverändert
  lesbar; die P5.1-Referenzen (`harness_profile_id` etc.) bestehen fort.
- `store.ts`: `AttemptRow` trägt beide Felder (`string | null`),
  `createAttempt` persistiert sie, `mapAttemptRow` liest sie.

## Bindung: kompilierte Effective Config atomar mit dem Attempt

Die kompilierte Effective Runtime Configuration wird **atomar mit dem
`createAttempt`-INSERT** persistiert, VOR der Worker-Ausführung — der
persistierte Contract trägt exakt die Semantik, die zur Laufzeit wirksam war:

- **Live-Pfad (`trackJobAttempt`, `packages/worker-pipeline/src/pipeline-runner.ts`):**
  `resolveEffectiveHarnessFromEnv` → `createAttempt` mit
  `effective_harness_config` (JSON) + `effective_harness_fingerprint` —
  für plan/build/verify/decide/research/specify/tasks/analyze/baseline/review.
- **Durable Run (`packages/control-plane/src/durable-run.ts`):** verify,
  baseline, plan und build binden jeweils `resolveEffectiveHarnessFromEnv`
  (taskType `verify`/`baseline`/`plan`/`build`) atomar in den Attempt-INSERT.
- **Worker erhalten NUR kompilierte, allowlisted Felder** — keine
  Freiform-Passthrough-Konfiguration an OpenCode/Worker-Adapter.
- Nachweis Live-Pfad: `real-two-profile-canary.test.ts` (zwei Profile → zwei
  verschiedene, jeweils persistierte Effective-Configs und Fingerprints;
  Kernel-Denys gewinnen; Build-Mutation innerhalb der Kernel-Grenze;
  Tool-Allowlist kompiliert).

## API/UI (reine Projektion)

- **`GET /api/runs/:id/control-plane`** (`apps/server/src/index.ts`): pro
  Attempt werden NUR `effective_harness_fingerprint` und die effektiven
  Permission-**Booleans** exponiert. `parseEffectivePermissions` liest aus
  `effective_harness_config` ausschließlich `effective_permissions`
  (`mutation/push/merge/deploy/secret_access === true`); fehlende/kaputte
  Config → `null`, kein Absturz, kein Erfinden.
- **Kein Raw-Contract:** der vollständige Effective-Contract (Tools,
  Context, Reasoning, Refs) wird bewusst NICHT roh ausgegeben — Privacy by
  Default, keine Secrets/Prompt-Inhalte (Konsistenz mit P5.1:
  `p5.1-profile-api.test.ts` beweist die Abwesenheit).
- **Kein `output_json`, keine rohen Contracts/Semantik, keine Secrets.**

## Non-Goals (Scope-Grenze)

- ❌ **kein Routing (P5.3)** — der Compiler wählt keine Profile zur Laufzeit
  aus; `resolveEffectiveHarnessFromEnv` nutzt explizite Konfiguration +
  Defaults, kein adaptiver Einsatz.
- ❌ **keine Evolution/Promotion (P5.4)** — keine Profil-Promotion/Demotion,
  kein Deployment von Profil-Entscheidungen auf Basis der KPIs.
- ❌ **keine LLM-Permission-Entscheidungen** — Permissions sind
  deterministische Intersection, kein LLM-Urteil über Gültigkeit oder
  Berechtigungen.
- ❌ **kein Freiform-Passthrough an OpenCode** — Worker/Adapter erhalten
  nur kompilierte, allowlisted Felder.

## Security-Invarianten (unverändert)

P5.2 ändert keine bestehende Control-Plane-Invariante. Es bleiben
unverändert gültig (P4 und früher):

- **LLMs besitzen KEINE Scheduling Authority** — wer startet, wann, mit
  welchen Ressourcen, entscheidet deterministisch Positron.
- **Deterministische Gates**: Plan Gate (nur `PLAN_GATE_APPROVED` gibt den
  Build frei), Verification (Tools messen, LLMs beurteilen nicht),
  Decision Policy (Security Hard Block — Security ist kein
  Mehrheitsvotum).
- **Fail-closed Contracts**: unbekannte Contract-ID/Version → INVALID
  (`UNKNOWN_CONTRACT` / `UNKNOWN_VERSION`); der Compiler lehnt unbekannte
  Profile/Versionen, invalide Contracts und nicht unterstützte Settings mit
  Reason Code ab (kein stiller Fallback, kein silent downgrade).
- **Idempotenz & Recovery**: Idempotency Key `run_id:job_id:attempt_id`;
  abgeschlossene Arbeit wird nach Recovery nie blind wiederholt.
- **Attempt-Invarianten**: exakt ein Claimer pro Attempt (Claim + Lease +
  Fencing), finale Attempts unveränderlich (Late Results / Duplicate
  Completions überschreiben nie), `PRODUCTIVE_WORKER_BYPASS_COUNT = 0`.
- **KPI-Invarianten**: Blind-Retry-Rate = 0, Duplicate-Mutation-Rate = 0,
  Security-Hard-Block-Enforcement = 100 %.
- **Privacy by Default**: keine Secrets, keine Prompts/Responses, kein
  `output_json` in der UI; die API exponiert nur Permission-Booleans +
  Effective-Fingerprint, nie den rohen Effective-Contract.
- **Neu (P5.2):** effektive Permissions = Kernel ∩ Profil
  (**KERNEL_DENY_WINS**) — Profile können die Kernel-Policy NIE erweitern;
  Adapter-/Capability-Mismatch wird abgelehnt (`ADAPTER_CAPABILITY_MISMATCH`),
  nie still gedroppt.
