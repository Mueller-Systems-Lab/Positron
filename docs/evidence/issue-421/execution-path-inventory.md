# P3 — Execution Path Inventory + Stop-Gate (Issue #421)

Datum: 2026-08-18 · Branch: `positron/issue-421-durable-control-plane` · HEAD: `360d302`
Methode: Call-Graph-Analyse über `packages/control-plane`, `apps/worker/src/pipeline-runner.ts`,
`apps/worker/src/index.ts`, `apps/server/src/index.ts`, Adapter (opencode/speckit/sandbox),
run-state, tool-gateway. Read-only — keine Mutation.

## Produktive Ausführungspfade

| # | Pfad | Entrypoint | Worker | Mutating | Durable Job | Durable Attempt | Input Contract | Input FP | Result Contract | Output FP | Idem. | Recovery | Classification |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | `runDurableRun` (INTAKE→…→DECIDE) | nur Tests (Soak/Vertical-Slice) | build/verify/review/research-Adapter | ja | ja | ja | ja | ja | ja | ja | ja | ja | **CANONICAL** (noch nicht produktiv verbunden) |
| P2 | Worker WEB_RESEARCH | BullMQ-Queue | Brave-Search/Issue-Fetch (`generateResearchDocument`) | nein | nein | nein | nein | nein | nein | nein | nein | nein | **MIGRATION_REQUIRED** |
| P3 | Worker SPECIFY | BullMQ-Queue | opencode `speckit.specify` + speckit `runSpecify` | read-only (Artifakte) | nein | nein | nein | nein | nein | nein | nein | nein | **MIGRATION_REQUIRED** |
| P4 | Worker PLAN | BullMQ-Queue | opencode `speckit.plan` + speckit `runPlan` + `evaluatePlanGate` (ohne Job/Attempt) | read-only | nein | nein | nein | nein | nein | nein | nein | nein | **MIGRATION_REQUIRED** |
| P5 | Worker TASKS | BullMQ-Queue | opencode `speckit.tasks` + speckit `runTasks` | read-only | nein | nein | nein | nein | nein | nein | nein | nein | **MIGRATION_REQUIRED** |
| P6 | Worker ANALYZE | BullMQ-Queue | speckit `runAnalyze` | read-only | nein | nein | nein | nein | nein | nein | nein | nein | **MIGRATION_REQUIRED** |
| P7 | Worker IMPLEMENT | BullMQ-Queue | opencode `runImplement` | ja | ja (find-or-create `build`) | ja | ja (`positron.build-input.v1`) | ja | ja | ja | ja | teilw. | **MIGRATION_REQUIRED** (partiell kanonisch; Vorgänger-Jobs baseline/plan fehlen im Live-Pfad) |
| P8 | Worker TEST/VERIFY | BullMQ-Queue | TestRunner (deterministisch) | nein | ja (find-or-create `verify`) | ja | ja (`positron.verification.v1`) | ja | ja | ja | ja | teilw. | **MIGRATION_REQUIRED** (partiell kanonisch) |
| P9 | Worker Fix-Loop (`retryFromPhase`) | BullMQ-Queue | springt auf WEB_RESEARCH/SPECIFY/TEST zurück | ja | teilw. (build-attempt) | teilw. | nein | nein | nein | nein | nein | nein | **MIGRATION_REQUIRED** |
| P10 | Worker COMMIT/PR/MERGE | BullMQ-Queue | Git/GitHub deterministisch (kein LLM-Worker) | ja | nein | nein | n/a | n/a | n/a | n/a | n/a | n/a | **CANONICAL-Kompatibel** (deterministische Veröffentlichungskanäle, keine Worker-Ausführung; weiterhin Decision-Policy-gesteuert) |
| P11 | Server-Inline `runFullPipeline` | API-Fallback (kein Redis), Demo, Startup-Recovery | opencode/speckit/TestRunner | ja | **nein** | **nein** | nein | nein | nein | nein | nein | nein | **MIGRATION_REQUIRED** (kompletter Bypass, keine cp_*-Schreibvorgänge) |
| P12 | Demo-Endpoints (blueprint, demo-runs, live-run) | API (`requireAdmin`) | `runFullPipeline` | ja | nein | nein | nein | nein | nein | nein | nein | nein | **MIGRATION_REQUIRED** (folgt P11-Routing) |
| P13 | Startup-Recovery (Server) | Server-Start | `runFullPipeline` fire-and-forget | ja | nein | nein | nein | nein | nein | nein | nein | nein | **MIGRATION_REQUIRED** (folgt P11-Routing) |
| P14 | GatewayService-Tools (tests/repo) | — | execSync | — | — | — | — | — | — | — | — | — | **DEAD** (im Runtime-Pfad nie invoked; nur Tests) |
| P15 | Watcher `onRunCreated` | GitHub-Polling | nur DB-Run anlegen | nein | nein | nein | nein | nein | nein | nein | nein | nein | **DEAD** (nie enqueued, keine Execution) |
| P16 | Fake-Adapter (OpenCode/SpecKit/GitHub/Workspace) | Fake-Modi | deterministisch | nein | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | **TEST_ONLY** |

## Bypass-Definition

> Ein Bypass ist: Ein produktiver Control-Plane-Worker kann reale Arbeit durchführen,
> ohne dass ein persistierter Job und Attempt die Ausführung kontrollieren.

Bypasses (Stand heute): **P2, P3, P4, P5, P6, P9, P11, P12, P13** = 9 produktive Pfade ohne
durable Job/Attempt. P7/P8 sind partiell kanonisch (Job+Attempt+Idem.), aber nicht in die
kanonische Run-Hierarchie eingebunden (kein INTAKE/BASELINE/PLAN-Vorgänger, keine
cp_transitions im Live-Pfad, keine persistierte Decision).

## Stop-Gate

```
PRODUCTIVE_EXECUTION_PATHS_TOTAL = 13   (P1–P13)
CANONICAL_PATHS                  = 2    (P1 runDurableRun [Test-Caller], P10 deterministische Kanäle)
MIGRATION_REQUIRED               = 11   (P2–P9, P11–P13)
LEGACY_REQUIRED                  = 0
DEAD                             = 2    (P14, P15)
TEST_ONLY                        = 1    (P16 Fake-Adapter)
```

P3-Zielzustand: `MIGRATION_REQUIRED = 0`, `LEGACY_REQUIRED = 0`.

## Migrationsstrategie (kein Rewrite)

1. **`runDurableRun` wird der kanonische produktive Dispatcher.** Erweiterung um:
   - PLAN-Worker (fachlicher `plan`-Job/Attempt: SpecKit-/OpenCode-Plan-Erzeugung inkl.
     SPECIFY/TASKS/ANALYZE als atomarer fachlicher plan-Worker — §9/§19/§20: die fachliche
     Boundary zählt, nicht jeder CLI-Aufruf)
   - BASELINE als Job **mit** Attempt (aktuell nur Job)
   - Attempt-Level-Recovery für Research (A) und Review (E) — nur fehlende Worker
     wiederholen, completed nie
   - Build-Recovery (C): succeeded build-attempt ohne verify → verify nachziehen, Build
     nicht wiederholen
   - Verify-Recovery (D): Verification aus `output_json` rehydrieren (existiert), kein Rerun
   - Plan-Recovery (B): Plan-Contract wird im plan-Attempt persistiert; Resume liest aus
     Persistenz, Plan-Gate läuft mit persistiertem Result
   - Timeout (Build/Verify) deterministisch; Late-Result-Guard; Duplicate-Completion-Guard
2. **Worker-Pipeline** (`apps/worker`) ruft `runDurableRun` mit Worker-Adaptern
   (opencode-implement → BuildWorker, TestRunner → VerificationTool, Brave/Issue → ResearchWorker,
   speckit/opencode → PlanWorker). Post-Decision-Kanäle (COMMIT/PR/MERGE) bleiben hinter
   der Decision Policy (DONE). Fix-Loop wird durch den kanonischen FIX-Zyklus ersetzt.
3. **Server-Inline** (`runFullPipeline`) routet auf dieselbe kanonische Boundary (Adapter
   identisch); keine zweite Runtime.
4. **Execution Context Enforcement** (`ControlPlaneExecutionContext`): produktive
   Worker-Adapter verlangen run_id/job_id/attempt_id zwingend; Audit-Canary beweist
   `EXECUTION_CONTEXT_REQUIRED`.
5. **Attempt-Claiming**: atomarer SQLite-Claim (pending→running, genau ein Claimer);
   `previous_attempt_id` für Fix-Referenzierung (§15).
