#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${POSITRON_QUICKSTART_ROOT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
COMPOSE_FILE="$ROOT_DIR/docker-compose.quickstart.yml"
STATE_DIR="${POSITRON_QUICKSTART_STATE_DIR:-$ROOT_DIR/.positron/quickstart}"
ENV_FILE="$STATE_DIR/demo.env"
PROJECT_NAME="positron-quickstart"
WEB_URL="http://localhost:5173"
HEALTH_URL="$WEB_URL/api/health"

usage() {
  cat <<'HELP'
Positron safe demo quickstart

Usage: ./scripts/quickstart.sh [OPTION]

Options:
  --help       Show this help.
  --dry-run    Check prerequisites and Compose syntax without starting services.
  --status     Show service status and health without changing services.
  --stop       Stop the demo services; keep local volumes and credentials.

The default starts fake/demo mode only. It does not require a GitHub token,
OpenCode, SpecKit, or a host Redis installation.
HELP
}

die() {
  printf 'quickstart: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

compose() {
  docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" --file "$COMPOSE_FILE" "$@"
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi
  node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
}

ensure_env() {
  if [[ -s "$ENV_FILE" ]]; then
    chmod 600 "$ENV_FILE"
    return
  fi
  mkdir -p "$STATE_DIR"
  umask 077
  local redis_secret admin_secret
  redis_secret="$(generate_secret)"
  admin_secret="$(generate_secret)"
  {
    printf 'REDIS_PASSWORD=%s\n' "$redis_secret"
    printf 'POSITRON_ADMIN_TOKEN=%s\n' "$admin_secret"
  } >"$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

check_prerequisites() {
  require_command docker
  docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 is required'
  [[ -f "$COMPOSE_FILE" ]] || die "missing Compose file: $COMPOSE_FILE"
  [[ -f "$ROOT_DIR/nginx.conf" ]] || die "missing nginx config: $ROOT_DIR/nginx.conf"
}

check_ports() {
  if compose ps --services --status running 2>/dev/null | grep -qx 'nginx'; then
    return
  fi
  if command -v curl >/dev/null 2>&1; then
    for url in "$WEB_URL" "http://localhost:3000/api/health"; do
      if curl --silent --show-error --fail --max-time 1 "$url" >/dev/null 2>&1; then
        die "port already serves a response at $url; stop that service before quickstart"
      fi
    done
  fi
}

wait_for_health() {
  require_command curl
  local attempts=0
  until curl --silent --show-error --fail --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if (( attempts >= 90 )); then
      printf '%s\n' 'quickstart: services did not become healthy in 180 seconds.' >&2
      compose ps >&2 || true
      printf '%s\n' 'quickstart: inspect logs with: docker compose --project-name positron-quickstart --env-file .positron/quickstart/demo.env -f docker-compose.quickstart.yml logs' >&2
      exit 1
    fi
    sleep 2
  done
}

dry_run() {
  require_command docker
  REDIS_PASSWORD=dry-run-only POSITRON_ADMIN_TOKEN=dry-run-only \
    docker compose --project-name "$PROJECT_NAME" --file "$COMPOSE_FILE" config --quiet
  printf '%s\n' 'quickstart dry-run: prerequisites and Compose syntax passed; no services started.'
}

main() {
  local action="start"
  case "${1:-}" in
    '') ;;
    --help|-h) usage; return 0 ;;
    --dry-run) action="dry-run" ;;
    --status) action="status" ;;
    --stop) action="stop" ;;
    *) die "unknown option: ${1}. Use --help for usage." ;;
  esac

  check_prerequisites
  if [[ "$action" == "dry-run" ]]; then
    dry_run
    return 0
  fi

  ensure_env
  case "$action" in
    status)
      compose ps
      if command -v curl >/dev/null 2>&1 && curl --silent --show-error --fail --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
        printf 'Positron demo health: PASS (%s)\n' "$HEALTH_URL"
      else
        printf 'Positron demo health: not ready (%s)\n' "$HEALTH_URL"
        return 1
      fi
      ;;
    stop)
      compose down
      printf '%s\n' 'Positron demo stopped. Local volumes and ignored credentials were kept.'
      ;;
    start)
      if compose ps --services --status running 2>/dev/null | grep -qx 'nginx'; then
        wait_for_health
        printf 'Positron demo is ready: %s\n' "$WEB_URL"
        printf 'Health endpoint: %s\n' "$HEALTH_URL"
        return 0
      fi
      check_ports
      printf '%s\n' 'Building Positron images for the first time...'
      printf '%s\n' 'Docker will show the active build stage; dependency installation may take several minutes.'
      compose --progress plain build
      compose up --detach --remove-orphans
      wait_for_health
      printf 'Positron demo is ready: %s\n' "$WEB_URL"
      printf 'Health endpoint: %s\n' "$HEALTH_URL"
      ;;
  esac
}

main "$@"
