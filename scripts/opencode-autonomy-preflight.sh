#!/usr/bin/env bash
# Positron — OpenCode Autonomy Preflight (§14)
#
# Prüft, ob die effektiven OpenCode-Permissions für alle konfigurierten Agenten
# deterministisch sind (kein effektives 'ask'). Wenn ein Run mit einem
# unsichtbaren Permission-Dialog enden würde, schlägt der Preflight fehl,
# bevor der lang laufende unattended Run startet.
#
# Nutzung:
#   ./scripts/opencode-autonomy-preflight.sh          # alle Agenten prüfen
#   ./scripts/opencode-autonomy-preflight.sh build     # nur ein Agent
#
# Exit-Codes:
#   0 = alle effektiven Permissions deterministisch (kein ask)
#   1 = mindestens ein effektives ask → AUTONOMY_PREFLIGHT_FAIL
#   2 = opencode nicht auffindbar / debug nicht verfügbar

set -u

BIN="${OPENCODE_BIN:-opencode}"
if ! command -v "$BIN" >/dev/null 2>&1; then
  echo "AUTONOMY_PREFLIGHT_FAIL: opencode binary not found ($BIN)"
  exit 2
fi

if ! "$BIN" agent list >/dev/null 2>&1; then
  echo "AUTONOMY_PREFLIGHT_FAIL: 'opencode agent list' not available"
  exit 2
fi

if [ $# -eq 1 ]; then
  AGENTS=("$1")
else
  AGENTS=(issue-orchestrator build plan review-agent research-agent security-agent \
          documentation-agent migration-agent playwright-agent architecture-agent compliance-agent)
fi

FAIL=0
for agent in "${AGENTS[@]}"; do
  # Effektive Regeln via `opencode debug agent` (letzte passende Regel gewinnt).
  # Extrahiere Permission/Pattern/Action und löse effektiv auf (glob, last-match).
  ASKS=$("$BIN" debug agent "$agent" 2>/dev/null | python3 -c "
import json, sys, fnmatch

def resolve(perm, pattern=None):
    action = None
    for r in rules:
        if r.get('permission') != perm:
            continue
        pat = r.get('pattern') or '*'
        if pattern is None or pat == '*' or fnmatch.fnmatch(pattern, pat):
            action = r.get('action')
    return action

try:
    d = json.load(sys.stdin)
except Exception:
    print('NOJSON')
    sys.exit(0)

rules = d.get('permission', [])
checks = [
    ('bash', 'git status --porcelain'), ('bash', 'npm test'),
    ('bash', 'git push origin positron/issue-421-x'),
    ('bash', 'npx vitest run'), ('bash', 'ls -la'),
    ('edit', None), ('write', None), ('apply_patch', None),
    ('read', 'src/index.ts'), ('read', '.env'),
    ('glob', None), ('grep', None), ('list', None),
    ('task', 'explore'), ('task', 'review-agent'), ('task', 'general'),
    ('skill', 'audit-trail-enforcer'), ('webfetch', None),
    ('websearch', None), ('external_directory', '/tmp/opencode/x'),
    ('doom_loop', None), ('question', None), ('lsp', None), ('todowrite', None),
]
asks = [f'{p} {pat or \"*\"}' for p, pat in checks if resolve(p, pat) == 'ask']
print(';'.join(asks))
")
  if [ -n "$ASKS" ] && [ "$ASKS" != "NOJSON" ]; then
    echo "AUTONOMY_PREFLIGHT_FAIL: agent '$agent' effective ask -> $ASKS"
    FAIL=1
  elif [ "$ASKS" = "NOJSON" ]; then
    echo "AUTONOMY_PREFLIGHT_FAIL: agent '$agent' — cannot parse effective config"
    FAIL=1
  else
    echo "AUTONOMY_PREFLIGHT_OK: agent '$agent' deterministic (no effective ask)"
  fi
done

if [ "$FAIL" -eq 0 ]; then
  echo "AUTONOMY_PREFLIGHT=PASS"
  exit 0
fi
echo "AUTONOMY_PREFLIGHT=FAIL"
exit 1
