#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.positron/quickstart/demo.env"

printf '%s\n' 'Positron doctor'
printf '%s\n' '==============='

if command -v docker >/dev/null 2>&1; then
  printf '%-22s %s\n' 'REQUIRED Docker' 'present'
  docker compose version >/dev/null 2>&1 && printf '%-22s %s\n' 'REQUIRED Compose v2' 'present' || printf '%-22s %s\n' 'REQUIRED Compose v2' 'missing'
else
  printf '%-22s %s\n' 'REQUIRED Docker' 'missing'
  exit 1
fi

if command -v node >/dev/null 2>&1; then printf '%-22s %s\n' 'OPTIONAL Node' "$(node --version)"; else printf '%-22s %s\n' 'OPTIONAL Node' 'missing'; fi
if command -v npm >/dev/null 2>&1; then printf '%-22s %s\n' 'OPTIONAL npm' "$(npm --version)"; else printf '%-22s %s\n' 'OPTIONAL npm' 'missing'; fi
if command -v opencode >/dev/null 2>&1; then printf '%-22s %s\n' 'REAL-MODE ONLY OpenCode' 'present'; else printf '%-22s %s\n' 'REAL-MODE ONLY OpenCode' 'not installed'; fi
if command -v specify >/dev/null 2>&1; then printf '%-22s %s\n' 'REAL-MODE ONLY SpecKit' 'present'; else printf '%-22s %s\n' 'REAL-MODE ONLY SpecKit' 'not installed'; fi
if [[ -s "$ENV_FILE" ]]; then printf '%-22s %s\n' 'DEMO config' 'generated (secret values hidden)'; else printf '%-22s %s\n' 'DEMO config' 'not generated'; fi

if curl --silent --show-error --fail --max-time 3 http://localhost:5173/api/health >/dev/null 2>&1; then
  printf '%-22s %s\n' 'DEMO service health' 'PASS'
else
  printf '%-22s %s\n' 'DEMO service health' 'not ready'
fi
