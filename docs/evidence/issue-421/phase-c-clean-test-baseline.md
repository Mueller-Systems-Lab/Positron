# Phase C — Clean Test Baseline (P3.5) — Evidenz

Datum: 2026-08-20
Branch: `positron/issue-421-durable-control-plane`
Basis: Phase-B-Commit `797e6d3`

## Ausgangszustand (Reality Refresh, reproduziert)

```text
WEB_TEST_TOTAL = 318
WEB_TEST_PASS  = 266
WEB_TEST_FAIL  =  52   (exakt die P3-dokumentierte Baseline)
```

## Root-Cause (belegt, nicht angenommen)

Die 52 Web-Testfehler wurden durch **stale kompilierte `.js`-Artefakte** verursacht:

1. Frühere `tsc`-Läufe (vor `noEmit`-Härtung) hatten in `apps/web/src/` und im Repo-Root
   **272 `.js` / `.d.ts` / `.js.map` / `.d.ts.map`-Artefakte** erzeugt — u. a.
   `apps/web/src/__tests__/*.test.js`, Komponenten-`.js` (47 Dateien in
   `apps/web/src` außerhalb `__tests__`), `vite.config.js`, Root-`vitest.config.js`,
   `vitest.contracts.config.js`, `vitest.safety.config.js`, `playwright.config.js`
   sowie `e2e/*.d.ts`-Stubs.
2. Die `.js`-Artefakte enthalten JSX (kompiliert aus `.tsx`). Beim Import löst der
   Modul-Resolver diese `.js`-Dateien statt der `.tsx`-Quellen auf
   (Extension-Precedence), Vitest scheitert dann mit
   `Failed to parse source for import analysis ... invalid JS syntax`.
3. Folge: Komponenten laden nicht → alle nachfolgenden Tests der betroffenen
   Suiten fallen kaskadenartig um (52 Fehler in 10 Testdateien), obwohl die
   `.tsx`-Quellen korrekt sind.
4. Source of Truth sind ausschließlich die `.tsx`/`.ts`-Quellen; die Artefakte
   waren weder getrackt noch eingecheckt (`.gitignore` erfasste die Muster),
   wurden aber von lokalen Build-Läufen physisch erzeugt.

## Nachhaltiger Fix (minimal, kein Test-Skip, kein Ignore-Fix)

1. **Alle stale Artefakte gelöscht**: 272 Dateien in `apps/web/src`, 7 `e2e/*.d.ts`,
   6 Root-/Config-Artefakte (`vitest.config.js`, `vitest.contracts.config.js`,
   `vitest.safety.config.js`, `playwright.config.js`, `apps/web/vite.config.js`,
   `packages/tool-gateway/vitest.config.js` + zugehörige `.d.ts`).
2. **Wiederentstehung verifiziert unmöglich**:
   - `apps/web/tsconfig.json` hat `"noEmit": true` (bestätigt) → `npm run build`
     (`tsc && vite build`) erzeugt **0 Artefakte** (nach Build gemessen: 0).
   - `.gitignore` deckt die Muster bereits ab (kein Einchecken möglich).
   - Test-Discovery zeigt nur auf `src/__tests__/**/*.test.{ts,tsx}`.
3. **Kein Test wurde skippt, keine Datei ausgeschlossen, kein Fehler toleriert.**

## Clean Baseline (nach Fix, real gemessen)

```text
BACKEND_TEST_BASELINE = GREEN  (npx vitest run packages apps/server apps/worker)
                         2395/2395 passed (109 Files)

WEB_TEST_BASELINE     = GREEN  (cd apps/web && npx vitest run --environment jsdom)
                         418/418 passed (20 Files)   ← vorher 52 failed

BUILD                 = GREEN  (npm run build — Root + apps/web)
TYPECHECK             = GREEN  (npm run typecheck)
LINT                  = advisory (bekannter Backlog #340, unverändert)
```

## Gate-Status Phase C

```text
WEB_STALE_ARTIFACT_ROOT_CAUSE=PASS
WEB_BASELINE_REPAIR=PASS
WEB_TESTS=GREEN (418/418)
NEW_WEB_REGRESSIONS=0
```

## Verifikation der P3-Invarianten nach Cleanup

- `PRODUCTIVE_WORKER_BYPASS_COUNT=0` — P3-Live-Pfad-Canary weiter grün (in 2395 enthalten)
- `IDEMPOTENCY=PASS`, `RECOVERY=PASS`, `RESEARCH_PARALLELISM=PASS`,
  `REVIEW_PARALLELISM=PASS`, `SECURITY_HARD_BLOCK=PASS`,
  `RETRY_WITHOUT_DELTA=DENIED` — alle P3-Gates unverändert grün
