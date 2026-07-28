# Track D2a — `noSvgWithoutTitle` Evidence Report

## 1. Reality Refresh

| Check | Wert | Status |
|-------|------|--------|
| Repository | `xxammaxx/Positron` | ✅ |
| origin/main SHA | `ea8aa7f942ba555318e1fc8f7022ccd6f661d6eb` | ✅ |
| PR #376 | MERGED (Merge-Commit `ea8aa7f94`) | ✅ |
| Issue #340 | OPEN | ✅ |
| Workspace | `/media/xxammaxx/projekte/Positron-worktrees/issue-340-d2a-svg-accessibility` | isoliert ✅ |

## 2. Track D1 Post-Merge Clarification

- PR #376 wurde mit Merge-Commit `ea8aa7f942ba555318e1fc8f7022ccd6f661d6eb` gemergt.
- Track D1 behob 51 `useButtonType`-Fälle außerhalb von ArtifactPanel.tsx.
- Die Messung `useButtonType_TOTAL: 0` entstand, weil die Nursery-Regel in der aktuellen Biome-Konfiguration nicht aktiviert ist.
- Zwei manuell bekannte Buttons ohne `type` verbleiben in `ArtifactPanel.tsx`.
- Diese zwei Fälle gehören nicht zu Track D2a oder Track D2b.
- Track D2a bearbeitet ausschließlich `noSvgWithoutTitle`.
- Das Track-D1-Evidence-Dokument wurde nicht geändert.

## 3. Isolierter Worktree

```text
Branch: positron/issue-340-track-d2a-svg-accessibility
Worktree: /media/xxammaxx/projekte/Positron-worktrees/issue-340-d2a-svg-accessibility
Basis: origin/main @ ea8aa7f94
```

## 4. Expliziter Regelaufruf

```bash
npx biome lint . --only=lint/a11y/noSvgWithoutTitle
```

Biome Version: 1.9.4 (`--only` wird unterstützt)

## 5. Baseline

**Vorher: 14 `noSvgWithoutTitle`-Diagnosen**

| # | Datei | Zeile | SVG-Typ | Elternelement | Sichtbarer Text |
|---|-------|-------|---------|---------------|-----------------|
| 1 | ThemeToggle.tsx | 20 | Sonne | `button[aria-label][title]` | — |
| 2 | ThemeToggle.tsx | 42 | Mond | `button[aria-label][title]` | — |
| 3 | VoiceStatusIndicator.tsx | 40 | Lautsprecher+X | `span[aria-label]` + "No Voice" | "No Voice" |
| 4 | VoiceStatusIndicator.tsx | 74 | Lautsprecher+Wellen | `button[aria-label][title]` + "Voice ON/OFF" | "Voice ON/OFF" |
| 5 | DashboardPage.tsx | 90 | Monitor | `h3` "Managed External Projects" | ✅ |
| 6 | VoiceControls.tsx | 157 | Lautsprecher | `h3` "Voice Output" | ✅ |
| 7 | SystemHealth.tsx | 56 | Aktivität | `h3` "System Health" | ✅ |
| 8 | SettingsPage.tsx | 168 | Schild | `h3` "Safety Gates" | ✅ |
| 9 | SettingsPage.tsx | 232 | Server-Rack | `h3` "MCP Servers" | ✅ |
| 10 | SettingsPage.tsx | 350 | Checkmark | `h3` "Test Modes" | ✅ |
| 11 | RunDetail.tsx | 268 | Copy | `button[title="Copy Run ID"]` | — |
| 12 | RunDetail.tsx | 338 | Dokument | `h3` "Live Evidence" | ✅ |
| 13 | RunDetail.tsx | 381 | Dokument | `Link` "Open Evidence" | ✅ |
| 14 | RunDetail.tsx | 400 | Externer Link | `a` "Open Issue #N" | ✅ |

## 6. Semantische Klassifikation (Review-Closure korrigiert)

**Alle 14 SVGs sind rein dekorativ.** Die Information wird bereits durch das Elternelement oder sichtbaren Text vermittelt.

- **Klasse A (dekorativ, sichtbarer Text liefert Bedeutung):** 8 SVGs (#3, #5, #6, #7, #8, #9, #10, #12)
- **Klasse C (Icon-only Control mit benanntem Elternelement):** 3 SVGs (#1, #2, #11)
- **Klasse D (Link/Button enthält zusätzlichen sichtbaren Text):** 3 SVGs (#4, #13, #14)
- **Klasse B (informativ):** 0 SVGs
- **Klasse E (unklar):** 0 SVGs

### Klassen-Key

| Klasse | Count | SVGs |
|--------|------:|------|
| A — sichtbarer Text | 8 | VoiceStatusIndicator "No Voice", DashboardPage, VoiceControls, SystemHealth, SettingsPage Safety Gates, SettingsPage MCP Servers, SettingsPage Test Modes, RunDetail Live Evidence |
| C — Icon-only mit benanntem Elternelement | 3 | ThemeToggle Sonne, ThemeToggle Mond, RunDetail Copy Run ID |
| D — Elternelement mit zusätzlichem Text | 3 | VoiceStatusIndicator Voice ON/OFF, RunDetail Open Evidence, RunDetail Open Issue #N |

## 7. Implementierung

Einheitliche Lösung für alle 14 SVGs:

```tsx
<svg aria-hidden="true" focusable="false" ...>
```

Keine `<title>`-Elemente hinzugefügt. Keine `role="img"`. Keine `aria-labelledby`. Keine neuen IDs.

### Geänderte Dateien

| Datei | SVGs | Änderung |
|-------|------|----------|
| `apps/web/src/components/ThemeToggle.tsx` | 2 | `aria-hidden="true" focusable="false"` |
| `apps/web/src/components/VoiceStatusIndicator.tsx` | 2 | `aria-hidden="true" focusable="false"` |
| `apps/web/src/components/dashboard/DashboardPage.tsx` | 1 | `aria-hidden="true" focusable="false"` |
| `apps/web/src/components/VoiceControls.tsx` | 1 | `aria-hidden="true" focusable="false"` |
| `apps/web/src/components/dashboard/SystemHealth.tsx` | 1 | `aria-hidden="true" focusable="false"` |
| `apps/web/src/components/settings/SettingsPage.tsx` | 3 | `aria-hidden="true" focusable="false"` |
| `apps/web/src/components/RunDetail.tsx` | 4 | `aria-hidden="true" focusable="false"` |

**7 Dateien, 14 SVGs, 28 neue Attribute (`aria-hidden` + `focusable`), 0 neue `<title>`-Elemente.**

## 8. Regel-Delta

| Metrik | Vorher | Nachher | Delta |
|--------|-------:|--------:|------:|
| `noSvgWithoutTitle` gesamt | 14 | **0** | −14 |
| davon ArtifactPanel | 0 | 0 | 0 |
| in Scope | 14 | **0** | −14 |
| neue Diagnosen | — | **0** | 0 |

```text
noSvgWithoutTitle_IN_SCOPE: 0 ✅
NEW_DIAGNOSTICS: 0 ✅
```

## 9. Format Gap (Review-Closure erkannt und behoben)

Bei der Review-Closure-Prüfung wurde festgestellt, dass 6 der 7 Source-Dateien
Formatierungsabweichungen in SVG-Blöcken aufwiesen. ThemeToggle.tsx war bereits korrekt.

### Format-Delta

```text
FORMAT_FILES_CHANGED: 6
FORMAT_DELTA_ONLY: YES (INDENTATION, ATTRIBUTE_LAYOUT, JSX_LINE_BREAKS)
```

Keine SVG-Pfade, Texte, Handler, Navigation, CSS-Klassen oder Kontrollflüsse geändert.

### Formatierte Dateien

- `apps/web/src/components/RunDetail.tsx` (4 SVGs: Copy, Live Evidence, Open Evidence, Open Issue)
- `apps/web/src/components/VoiceStatusIndicator.tsx` (2 SVGs: No Voice, ON/OFF)
- `apps/web/src/components/dashboard/DashboardPage.tsx` (1 SVG: Managed External Projects)
- `apps/web/src/components/VoiceControls.tsx` (1 SVG: Voice Output)
- `apps/web/src/components/dashboard/SystemHealth.tsx` (1 SVG: System Health)
- `apps/web/src/components/settings/SettingsPage.tsx` (3 SVGs: Safety Gates, MCP Servers, Test Modes)

## 10. Gezielte Accessibility-Tests (Review-Closure)

Neue Testdatei: `apps/web/src/__tests__/track-d2a-svg-accessibility.test.tsx`

### Assertions (31 Tests, 31 passed)

**ThemeToggle (Class C, 2 SVGs)**
- `BUTTON_ACCESSIBLE_NAME_PRESENT`: YES (beide Theme-Zustände)
- `SVG_ARIA_HIDDEN`: true (beide SVGs)
- `SVG_FOCUSABLE`: false (beide SVGs)
- `SVG_ROLE_IMG_ABSENT`: YES

**VoiceStatusIndicator (Class A + D, 2 SVGs)**
- `VISIBLE_STATUS_TEXT_PRESENT`: YES ("Voice OFF", "Voice ON", "No Voice")
- `CONTROL_ACCESSIBLE_NAME_PRESENT`: YES
- `SVG_ARIA_HIDDEN`: true (alle Zustände)
- `SVG_FOCUSABLE`: false (alle Zustände)

**VoiceControls (Class A, 1 SVG)**
- `HEADING_VOICE_OUTPUT_PRESENT`: YES
- `DECORATIVE_SVG_HIDDEN`: YES

**SystemHealth (Class A, 1 SVG)**
- `EXPECTED_HEADING_PRESENT`: YES ("System Health")
- `DECORATIVE_SVG_HIDDEN`: YES

**DashboardPage (Class A, 1 SVG)**
- `EXPECTED_HEADING_PRESENT`: YES ("Managed External Projects")
- `DECORATIVE_SVG_HIDDEN`: YES

**SettingsPage (Class A, 3 SVGs)**
- `SAFETY_GATES_HEADING_PRESENT`: YES
- `MCP_SERVERS_HEADING_PRESENT`: YES
- `TEST_MODES_HEADING_PRESENT`: YES
- `DECORATIVE_SVGS_HIDDEN`: 3

**RunDetail (Class A + C + D, 4 SVGs)**
- `COPY_RUN_ID_BUTTON_ACCESSIBLE_NAME`: "Copy Run ID" (via title attribute — kein aria-label nötig)
- `OPEN_EVIDENCE_LINK_ACCESSIBLE_NAME`: PRESENT
- `OPEN_ISSUE_LINK_ACCESSIBLE_NAME`: PRESENT
- `LIVE_EVIDENCE_HEADING_PRESENT`: YES
- `ALL_FOUR_AFFECTED_SVGS_HIDDEN`: YES

```text
COPY_BUTTON_ARIA_LABEL_ADDED: NO
TITLE_ACCESSIBLE_NAME_TEST_GREEN: YES
```

### Accessible Names der interaktiven Kontexte

| Kontext | Element | Accessible Name |
|---------|---------|-----------------|
| ThemeToggle (dark) | Button | "Switch to light mode" (aria-label) |
| ThemeToggle (light) | Button | "Switch to dark mode" (aria-label) |
| VoiceStatusIndicator OFF | Button | "Voice output disabled. Click to toggle." (aria-label) |
| VoiceStatusIndicator ON | Button | "Voice output enabled. Click to toggle." (aria-label) |
| VoiceStatusIndicator unsupported | Span | "Voice output not supported" (aria-label) |
| Copy Run ID | Button | "Copy Run ID" (title) |
| Open Evidence | Link | "Open Evidence" (visible text) |
| Open Issue #N | Anchor | "Open Issue #N" (visible text) |

## 11. Vollständige Gates (Review-Closure)

| Test-Suite | Ergebnis |
|------------|----------|
| Vitest (root) | 82 Files, 2121 Tests | ✅ |
| Vitest (web) | 11 Files, 272 Tests | ✅ |
| E2E (Playwright) | 26/26 passed | ✅ |
| Mutation (fast) | 83.06% (>60% threshold) | ✅ |
| Mutation (safety) | 84.33% (>0% threshold) | ✅ |
| Observability | Configs valid | ✅ |

### Alle Gate-Ergebnisse

| Test-Suite | Ergebnis |
|------------|----------|
| Format (7 Source + 1 Test) | 0 errors ✅ |
| Web Typecheck | 0 errors ✅ |
| Web Build | 0 errors ✅ |
| Web Tests (Vitest) | 12 Files, 303 Tests ✅ |
| Contracts (Vitest) | 5 Files, 168 Tests ✅ |
| Integration (Vitest) | 1 File, 20 Tests ✅ |
| E2E (Playwright) | 26/26 passed ✅ |
| Mutation (fast) | 83.06% (>60% threshold) ✅ |
| Mutation (safety) | 84.33% (>0% threshold) ✅ |
| Observability | Configs valid ✅ |
| `noSvgWithoutTitle` Rule | 0 diagnostics ✅ |

### Akzeptanz

```text
FORMAT_GATE_GREEN: YES
PLAYWRIGHT: 26/26 ✅
SKIPS: 0 ✅
UNEXPLAINED_CONSOLE_ERRORS: 0 ✅
PAGE_ERRORS: 0 ✅
EXTERNAL_MUTATIONS: 0 ✅
NEW_BIOME_DIAGNOSTICS: 0 ✅
```

## 10. ArtifactPanel Hard-Stop

```text
ARTIFACT_PANEL_CHANGED: NO ✅
DANGEROUSLY_SET_INNER_HTML_CHANGED: NO ✅
ARTIFACT_PANEL_USE_BUTTON_TYPE_REMAINDER: 2 ✅
```

## 11. Scope

```text
CHANGED_RULES: noSvgWithoutTitle only ✅
NO_LABEL_WITHOUT_CONTROL_CHANGED: NO ✅
USE_BUTTON_TYPE_CHANGED: NO ✅
ARTIFACT_PANEL_CHANGED: NO ✅
WORKFLOW_FILES_CHANGED: NO ✅
DEPENDENCY_FILES_CHANGED: NO ✅
BIOME_CONFIG_CHANGED: NO ✅
```

## 12. Security

- Keine Änderung an `dangerouslySetInnerHTML`
- Keine Änderung an `ArtifactPanel.tsx`
- Keine Auth- oder Admin-Logikänderung
- Keine Real-Mode- oder Stage-3-Ausführung
- Keine Secrets offengelegt

## 13. Verbleibende Issue-#340-Regeln

- `noLabelWithoutControl` — nicht in diesem Lauf
- `useButtonType` in `ArtifactPanel.tsx` (2 Fälle) — nicht in diesem Lauf

## 14. Review-Closure Classification

```text
GREEN_SAFE_TRACK_D2A_MERGED

SVG_DECORATIVE_TOTAL: 14
SVG_CLASS_A: 8
SVG_CLASS_B: 0
SVG_CLASS_C: 3
SVG_CLASS_D: 3
SVG_CLASS_E: 0

ARIA_HIDDEN_TOTAL: 14
FOCUSABLE_FALSE_TOTAL: 14

ARTIFACT_PANEL_CHANGED: NO
ARTIFACT_PANEL_USE_BUTTON_TYPE_REMAINDER: 2
NO_LABEL_WITHOUT_CONTROL_CHANGED: NO
TRACK_D2B_EXECUTED: NO
TRACK_D3_EXECUTED: NO
TRACK_E_EXECUTED: NO
REAL_MODE_EXECUTED: NO
STAGE3_EXECUTED: NO
SECRETS_DISCLOSED: NO
```
