# CI Policy v2 — Local-First, Remote-Required

**Gültig ab:** 2026-08-02
**Ersetzt:** CI Policy v1 vom 2026-06-21
**Entscheider:** Projektleitung (Human Gate) + R3-R1 CI Contract Evidence
**Scope:** Projektweit, bis auf Widerruf
**Referenz:** Issue [#268](https://github.com/xxammaxx/Positron/issues/268) (CLOSED), PR [#415](https://github.com/xxammaxx/Positron/pull/415), Issue [#416](https://github.com/xxammaxx/Positron/issues/416)

## Policy

### §1 Lokale Gates sind weiterhin maßgeblich

Vor jedem PR müssen folgende lokale Gates grün sein:

| Gate | Befehl | Erwartet |
|------|--------|----------|
| Format | `npx biome format .` | Exit 0 |
| Build | `npm run build` | Exit 0 |
| Typecheck | `npm run typecheck` | Exit 0 |
| Tests | `npm test` (self-contained: pretest → build → root + Web Vitest) | Exit 0 |

`npx biome check .` bleibt advisory-only (bekannter Lint-Backlog, Issue [#340](https://github.com/xxammaxx/Positron/issues/340)).

### §2 GitHub Actions sind erforderlich für Protected-Branch Merge

Seit R3-R1 (PR #415, gemerged 2026-08-02) sind folgende Checks als **required** in Branch Protection konfiguriert:

| Check | Typ | Blockierend |
|-------|-----|-------------|
| `format-check` | Format (Biome) | Ja |
| `differential-lint` | Differential Lint | Ja |
| `build` | TypeScript Build | Ja |
| `typecheck` | TypeScript Typecheck | Ja |
| `unit-tests` | `npm ci` → `npm test` | Ja |
| `observability-config-check` | Config Validation | Ja |

- Ein roter Required-Check **blockiert** den Merge.
- `strict: true` — der Branch muss vor dem Merge aktuell sein.
- `enforce_admins: true` — auch Admins müssen alle Checks bestehen.

### §3 Advisory Jobs

Folgende Jobs laufen in CI, sind aber **nicht** blockierend (`continue-on-error: true`):

| Job | Beschreibung |
|-----|-------------|
| `full-lint-report` | Vollständiger Repository-Lint-Report (Baseline) |
| `e2e-playwright` | E2E Playwright Tests |
| `mutation-fast` | Stryker Mutation Testing (fast) |
| `mutation-safety` | Stryker Mutation Testing (safety) |
| `tool-gateway-windows` | Windows Platform Check |

### §4 Keine GitHub-CI-Intervention ohne Autorisierung

Folgende Aktionen sind **verboten** ohne separate ausdrückliche Freigabe:

- Manuelles Triggern von Workflows (`gh workflow run`, `gh run rerun`)
- Ändern von Workflow-Dateien (`.github/workflows/*.yml`)
- Hinzufügen neuer Workflows
- Budget-/Billing-Aktivierung für GitHub Actions
- Nutzung kostenpflichtiger Runner (larger runners, macOS, etc.)

### §5 Dokumentation

- Alle lokalen Gate-Ergebnisse werden dokumentiert.
- Exit-Codes und Evidence werden vor jedem PR gesichert.
- CI-Logs und Job-IDs werden in der Evidence festgehalten.

### §6 Historische Referenz

Die ursprüngliche CI Policy v1 (2026-06-21) deklarierte GitHub Actions als „advisory-only" mit Issue #268 als OPEN. Diese Policy wurde durch den R3-R1 CI Contract (PR #415) und die aktuelle Branch-Protection-Konfiguration abgelöst. Issue #268 ist CLOSED.

## Begründung

- R3-R1 hat den self-contained clean-checkout Test Contract bewiesen.
- Branch Protection erfordert 6 Checks für den Merge auf `main`.
- `npm test` ist self-contained: `pretest` → `npm run build` → Root Vitest (84 files, 2173 tests) + Web Vitest (18 files, 399 tests).
- Lokale Gates bleiben der erste Qualitätsfilter; Remote CI ist der zweite.
- Kostenkontrolle: Keine unbeabsichtigten GitHub-Actions-Kosten.
