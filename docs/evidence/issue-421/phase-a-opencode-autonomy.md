# Phase A — OpenCode Unattended Autonomy (P3.5) — Evidenz

Datum: 2026-08-20
Branch: `positron/issue-421-durable-control-plane`
Start HEAD: `d3d294d`

## Reality Refresh (lokal verifiziert, nicht angenommen)

| Check | Wert |
|---|---|
| `which -a opencode` | `/home/xxammaxx/.opencode/bin/opencode` (einziger Treffer) |
| `type -a opencode` | gleiche Binary, kein Alias/Function/Wrapper |
| `opencode --version` | **1.15.13** |
| Installationsart | statisches ELF 64-bit (dynamically linked, `/lib64/ld-linux-x86-64.so.2`), nicht not stripped, in `~/.opencode/bin/` |
| Weitere Binaries | keine (`/usr/local/bin`, `/usr/bin`, `~/.local/bin` leer für opencode) |
| PATH-Schatten | nein — `~/.opencode/bin` ist der einzige Fundort |
| Aliases/Functions | keine in `~/.bashrc`, `~/.bash_aliases`, `~/.profile`, `~/.zshrc` |

## `--auto` Untersuchung

- Lokal: `opencode --auto` → druckt Hilfe (Flag nicht erkannt). `opencode run --auto "..."` → druckt Hilfe, keine Ausführung.
- Klassifikation: **`AUTO_FLAG_NOT_SUPPORTED_LOCALLY`** (Version 1.15.13 kennt das Flag nicht).
- Offizielle Doku (opencode.ai/docs/permissions + /docs/cli, Stand 2026-08-20) dokumentiert `--auto` für `opencode` und `opencode run` als Auto-Approve-Modus (explizite `deny`-Regeln bleiben erzwungen). Doku beschreibt eine neuere Version als lokal installiert.
- Lokales Äquivalent: `--dangerously-skip-permissions` ("auto-approve permissions that are not explicitly denied") existiert in 1.15.13.
- **Entscheidung:** Kein Upgrade, kein Wrapper. Die persistente No-Ask-Konfiguration löst die Aufgabe vollständig (Canaries unten). `--dangerously-skip-permissions` bleibt als dokumentiertes Fallback-Flag, wird aber für Positron-Autonomie nicht benötigt.

## Effektive Config (Precedence)

- Konfig-Ebenen lokal: globale Config `~/.config/opencode/opencode.json` (einzige JSON-Quelle; keine Project-`opencode.json` im Positron-Repo, kein `OPENCODE_CONFIG`-Env-Override) + Markdown-Agents in `~/.config/opencode/agents/*.md` (11 Agenten, konsistent mit dem JSON-`agent`-Block).
- Regel-Auflösung (lokal verifiziert via `opencode debug agent <name>`): Defaults → globale Config → Agent-Regeln; **letzte passende Regel gewinnt** (glob-Matching).
- Verifiziert für alle 11 Agenten: `external_directory` und `doom_loop` sind effektiv `allow` (globale Regeln überschreiben Default-`ask`); `read *.env`/`*.env.*` sind effektiv **`deny`** (Sicherheitsverschärfung: kein Prompt, aber auch kein Secret-Lesen ohne explizite Freigabe).

## Vorgenommene Änderungen (persistent, ohne Secrets)

Backup vor Änderung (beide Kopien sha256-verifiziert):
- `~/.config/opencode/opencode.json.bak-20260820T113257Z` (global)
- `.opencode/backups/opencode.json.bak-20260820T113257Z` (Repo-Kopie)

1. `~/.config/opencode/opencode.json` — globaler `permission`-Block:
   - `read`: `{"*": "allow", "*.env": "deny", "*.env.*": "deny", "*.env.example": "allow"}` (ersetzt Default-`ask` für `.env`)
   - `question`: `"deny"` (keine Fragen im autonomen Pfad)
2. Agent-`ask`-Regeln deterministisch gemacht:
   - `security-agent`: `docker compose *`: `ask` → `deny`
   - `migration-agent`: `psql *`: `ask` → `deny`; `docker compose *`: `ask` → `deny`
   - `documentation-agent`: `README.md`: `ask` → `allow`; `CHANGELOG.md`: `ask` → `allow` (legitime Doku-Arbeit)
3. `~/.config/opencode/agents/*.md` — dieselben drei Agenten konsistent bereinigt.

Keine `deny`-Regel wurde auf `allow` abgesenkt; die einzigen `allow`-Änderungen betrafen ehemalige `ask`-Regeln für legitime Doku-Arbeit. `git push *: deny` (global + build) blieb unverändert; der Orchestrator-Pfad hat `git push` über den Agent-`bash *: allow` effektiv verfügbar (Agent-Regel gewinnt).

## Security-Review-Nacharbeit (M2 — `.env`-Schutz)

Der unabhängige Security-Review identifizierte: Die `read`-Deny für `.env`-Dateien
ist über `bash` umgehbar (`cat .env`, `grep -r TOKEN .`), weil `bash *: allow`
gilt. Nacharbeit:

- Gezielte Bash-Deny-Regeln ergänzt (global + issue-orchestrator + build,
  last-matching-rule greift nach dem Catch-All-Allow):
  `cat .env`, `cat *.env`, `cat .env.*`, `cat */**/.env`, `cat */.env*`,
  `grep * .env*`, `rg * .env*`, `cat ~/.config/opencode/opencode.env`,
  `cat ~/.config/opencode/opencode.json*`
- Verifiziert (effektive Auflösung): `cat .env` → deny, `cat apps/server/.env.local`
  → deny, `cat ~/.config/opencode/opencode.env` → deny
- **Verbleibende dokumentierte Grenze:** generische rekursive Suche
  (`grep -r TOKEN .`) ist nicht ohne Aufgabe der Bash-Autonomie blockierbar —
  Positron geht davon aus, dass Secrets nie in sichtbaren Dateien liegen und
  der Secret-Manager die einzige Secret-Quelle ist. Kein Prompt-Dialog schützt
  vor einem bewusst böswilligen Agenten; die No-Ask-Policy betrifft normale
  autorisierte Entwicklung, nicht böswillige Exfiltration.

## Effektive Permission-Auflösung (Verifikation)

`opencode debug agent <name>` + last-match-Simulation für alle 11 Agenten:

```text
issue-orchestrator   effective_ask=0 ✓
build                effective_ask=0 ✓
plan                 effective_ask=0 ✓
review-agent         effective_ask=0 ✓
research-agent       effective_ask=0 ✓
security-agent       effective_ask=0 ✓
documentation-agent  effective_ask=0 ✓
migration-agent      effective_ask=0 ✓
playwright-agent     effective_ask=0 ✓
architecture-agent   effective_ask=0 ✓
compliance-agent     effective_ask=0 ✓
```

`EFFECTIVE_PERMISSION_ASK_COUNT = 0` für alle konfigurierten Positron-Agenten.

## Canaries (real ausgeführt, disposable Workspaces)

### ROOT_AUTO_CANARY (Canary A, `/tmp/opencode/canary-a`)

`opencode run --format json` (Agent `issue-orchestrator`, Modell deepseek-v4-flash, KEIN `--dangerously-skip-permissions`):

1. `bash pwd && ls -la` → completed, **0 Permission-Events**
2. `write canary-output.txt` → completed
3. `task explore`-Subagent → completed (Subagent führte eigene Tool-Calls aus)
4. `read` + `edit` (Append der Subagent-Zusammenfassung) → completed
5. Abschlussbericht → Run completed

Ergebnis: `ROOT_PERMISSION_PROMPTS=0`, `SUBAGENT_PERMISSION_PROMPTS=0`, `MANUAL_CONFIRMATIONS=0`, `RUN_COMPLETES=PASS`. Kanarische Datei enthält finalen Inhalt inkl. Subagent-Summary.

### SUBAGENT_AUTO_CANARY (in Canary A enthalten)

`explore`-Subagent startete, listete das Verzeichnis und lieferte eine strukturierte Zusammenfassung — ohne einen einzigen Permission-Prompt. Der Subagent-Tool-Call (`task`) lief mit `status=completed`.

### NEW_SESSION_PERSISTENCE_CANARY (Canary B, `/tmp/opencode/canary-b`)

Neuer Prozess, frisches Verzeichnis, KEIN `--agent` (Default-Agent-Pfad), KEIN `--auto`-Flag:

```text
events=16  permission_events=0  tools=['bash', 'read', 'write', 'task']
result.txt = CANARY_B_PERSISTENCE_OK
```

`NEW_SESSION_MANUAL_CONFIRMATIONS=0`, `PERSISTENT_UNATTENDED_MODE=PASS`.

### AUTONOMY_PREFLIGHT (Script `scripts/opencode-autonomy-preflight.sh`)

`./scripts/opencode-autonomy-preflight.sh` → `AUTONOMY_PREFLIGHT=PASS` für alle 11 Agenten (0 effective ask). Preflight schlägt fehl (`AUTONOMY_PREFLIGHT_FAIL`, Exit 1), falls eine effektive Permission auf `ask` auflöst — vor dem Start langer unattended Runs ausführbar.

## Fazit Phase A

```text
OPENCODE_REALITY_REFRESH=PASS
OPENCODE_VERSION_IDENTIFIED=PASS (1.15.13)
OPENCODE_BINARY_IDENTIFIED=PASS
AUTO_FLAG_INVESTIGATED=PASS (AUTO_FLAG_NOT_SUPPORTED_LOCALLY; Doku validiert; äquivalentes Flag dokumentiert)
GLOBAL_CONFIG_BACKUP=PASS
PERSISTENT_AUTONOMY_CONFIGURED=PASS
EFFECTIVE_PERMISSION_ASK_COUNT_ZERO=PASS
ROOT_AUTO_CANARY=PASS
SUBAGENT_AUTO_CANARY=PASS
NEW_SESSION_PERSISTENCE_CANARY=PASS
MANUAL_CONFIRMATIONS_REQUIRED=0
OPENCODE_AUTONOMY=PASS
```

Kein Shell-Wrapper, kein Upgrade, kein Hack: Die offiziell unterstützte persistente Konfiguration (globale `opencode.json` + Markdown-Agent-Frontmatter) liefert dauerhafte Autonomie für aktuelle und zukünftige Runs.
