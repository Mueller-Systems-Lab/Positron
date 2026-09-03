#!/usr/bin/env bash
set -Eeuo pipefail

# Installed supervised profile helper. This is a launcher adapter, not a
# second runtime: it delegates to the repository's existing advanced compose.
ROOT_DIR="${POSITRON_SUPERVISED_ROOT:-$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
CONFIG_DIR="${POSITRON_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/positron}"
STATE_DIR="${POSITRON_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/positron}"
CONFIG_FILE="$CONFIG_DIR/supervised.env"
SECRET_DIR="$CONFIG_DIR/secrets"
TOKEN_FILE="$SECRET_DIR/github-token"
RUNTIME_DIR="$STATE_DIR/supervised"
RUNTIME_ENV="$RUNTIME_DIR/runtime.env"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
PROJECT_NAME="positron-supervised"
WEB_URL="${POSITRON_SUPERVISED_WEB_URL:-http://localhost:5173}"

die() { printf 'ERROR_CODE=%s\nWHAT_FAILED=%s\nIMPACT=%s\nNEXT_ACTION=%s\n' "$1" "$2" "$3" "$4" >&2; exit 1; }
usage() {
  cat <<'HELP'
Positron supervised configuration

Usage:
  positron configure supervised [--repo OWNER/REPO] [--default-branch BRANCH]
    [--github-token-file PATH] [--provider NAME] [--model NAME] [--allow-push]
  positron configure supervised --check
  positron doctor --supervised
  positron start --supervised
  positron stop --supervised
  positron status --supervised

Tokens are accepted from GITHUB_TOKEN/GH_TOKEN, a protected token file, or a
hidden prompt. Tokens are never accepted as normal command-line arguments.
HELP
}
command_exists() { command -v "$1" >/dev/null 2>&1; }
valid_atom() { [[ "$1" =~ ^[A-Za-z0-9._/@:+,-]+$ && "$1" != *..* && "$1" != /* ]]; }
valid_branch() { [[ "$1" =~ ^[A-Za-z0-9._/-]+$ && "$1" != /* && "$1" != *..* ]]; }
valid_repo() { [[ "$1" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; }
secure_dir() { [[ ! -L "$1" ]] || return 1; mkdir -p -- "$1" && [[ ! -L "$1" ]] && chmod 700 -- "$1"; [[ "$(stat -c '%a' "$1")" == 700 ]]; }
secure_file() { chmod 600 -- "$1"; [[ "$(stat -c '%a' "$1")" == 600 ]]; }
generate_secret() { if command_exists openssl; then openssl rand -hex 32; else node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"; fi; }

discover_opencode() {
  command -v opencode 2>/dev/null || true
}
discover_specify() {
  command -v specify 2>/dev/null || command -v specify-cli 2>/dev/null || true
}

write_config() {
  local owner="$1" repo="$2" branch="$3" provider="$4" model="$5" allow_push="$6" opencode_path="$7" specify_path="$8" opencode_config="$9" opencode_home="${10}"
  secure_dir "$CONFIG_DIR" || die CONFIG_PERMISSION_DENIED 'configuration directory must be mode 0700' 'supervised configuration was not written' 'repair the XDG config directory and retry'
  secure_dir "$SECRET_DIR" || die CONFIG_PERMISSION_DENIED 'secret directory must be mode 0700' 'supervised configuration was not written' 'repair the secret directory and retry'
  secure_dir "$RUNTIME_DIR" || die CONFIG_PERMISSION_DENIED 'runtime secret directory must be mode 0700' 'supervised configuration was not written' 'repair the state directory and retry'
  local tmp="$CONFIG_FILE.tmp.$$"
  umask 077
  {
    printf 'POSITRON_SUPERVISED_CONFIG_VERSION=positron.supervised-config.v1\n'
    printf 'POSITRON_REPO_OWNER=%s\nPOSITRON_REPO_NAME=%s\nPOSITRON_REPO_DEFAULT_BRANCH=%s\n' "$owner" "$repo" "$branch"
    printf 'POSITRON_OPENCODE_PROVIDER=%s\nPOSITRON_OPENCODE_MODEL=%s\n' "$provider" "$model"
    printf 'POSITRON_ENABLE_PUSH=%s\nPOSITRON_ENABLE_MERGE=false\nPOSITRON_MERGE_DRY_RUN=true\nPOSITRON_MERGE_KILL_SWITCH=true\n' "$allow_push"
    printf 'POSITRON_OPENCODE_HOST_PATH=%s\nPOSITRON_SPECKIT_HOST_PATH=%s\nPOSITRON_OPENCODE_CONFIG_PATH=%s\nPOSITRON_OPENCODE_HOME_PATH=%s\n' "$opencode_path" "$specify_path" "$opencode_config" "$opencode_home"
    printf 'POSITRON_SECRET_GITHUB_TOKEN_FILE=%s\n' "$TOKEN_FILE"
  } >"$tmp"
  secure_file "$tmp"; mv -f -- "$tmp" "$CONFIG_FILE"
  [[ -e "$TOKEN_FILE" && ! -L "$TOKEN_FILE" ]] && secure_file "$TOKEN_FILE"
}

read_token() {
  local source="${1:-}"
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then printf '%s' "$GITHUB_TOKEN"; return; fi
  if [[ -n "${GH_TOKEN:-}" ]]; then printf '%s' "$GH_TOKEN"; return; fi
  if [[ -n "$source" ]]; then
    [[ -f "$source" && ! -L "$source" ]] || die SECRET_SOURCE_INVALID 'token source must be a regular non-symlink file' 'no credential was read' 'provide a protected token file'
    local mode; mode="$(stat -c '%a' "$source")"; [[ "$mode" == 600 || "$mode" == 400 ]] || die SECRET_SOURCE_PERMISSIONS 'token source must be mode 0600 or 0400' 'no credential was read' 'chmod 600 the token file and retry'
    tr -d '\r\n' <"$source"; return
  fi
  if [[ -t 0 ]]; then
    local token
    read -r -s -p 'GitHub token (hidden): ' token
    printf '\n' >&2
    printf '%s' "$token"
    return
  fi
  die GITHUB_TOKEN_MISSING 'no GitHub token source is available' 'supervised configuration is incomplete' 'set GITHUB_TOKEN/GH_TOKEN, use --github-token-file, or run interactively'
}

load_config() {
  [[ -f "$CONFIG_FILE" && ! -L "$CONFIG_FILE" ]] || die SUPERVISED_CONFIG_MISSING 'supervised configuration was not found' 'the supervised profile cannot run' 'run positron configure supervised'
  [[ "$(stat -c '%a' "$CONFIG_FILE")" == 600 ]] || die CONFIG_PERMISSION_DENIED 'supervised config must be mode 0600' 'the supervised profile is blocked' 'chmod 600 the config and retry'
  # Values were validated before writing; read as data, never execute as shell.
  while IFS='=' read -r key value; do
    case "$key" in
      POSITRON_REPO_OWNER|POSITRON_REPO_NAME|POSITRON_REPO_DEFAULT_BRANCH|POSITRON_OPENCODE_PROVIDER|POSITRON_OPENCODE_MODEL|POSITRON_ENABLE_PUSH|POSITRON_ENABLE_MERGE|POSITRON_MERGE_DRY_RUN|POSITRON_MERGE_KILL_SWITCH|POSITRON_OPENCODE_HOST_PATH|POSITRON_SPECKIT_HOST_PATH|POSITRON_OPENCODE_CONFIG_PATH|POSITRON_OPENCODE_HOME_PATH|POSITRON_SECRET_GITHUB_TOKEN_FILE) printf -v "$key" '%s' "$value" ;;
      POSITRON_SUPERVISED_CONFIG_VERSION) [[ "$value" == positron.supervised-config.v1 ]] || die SUPERVISED_CONFIG_INVALID 'unknown supervised configuration contract' 'the profile is blocked' 'rerun supervised configuration' ;;
      '') ;;
      *) die SUPERVISED_CONFIG_INVALID 'unknown supervised configuration field' 'the profile is blocked' 'rerun supervised configuration' ;;
    esac
  done <"$CONFIG_FILE"
  [[ "$POSITRON_SECRET_GITHUB_TOKEN_FILE" == "$TOKEN_FILE" ]] || die SECRET_PATH_INVALID 'secret path is outside the protected Positron secret store' 'the profile is blocked' 'rerun supervised configuration'
  valid_atom "$POSITRON_REPO_OWNER" || die INVALID_REPOSITORY 'configured repository owner contains unsafe characters' 'the profile is blocked' 'rerun supervised configuration'
  valid_atom "$POSITRON_REPO_NAME" || die INVALID_REPOSITORY 'configured repository name contains unsafe characters' 'the profile is blocked' 'rerun supervised configuration'
  valid_branch "$POSITRON_REPO_DEFAULT_BRANCH" || die INVALID_BRANCH 'configured default branch contains unsafe characters' 'the profile is blocked' 'rerun supervised configuration'
  valid_atom "$POSITRON_OPENCODE_PROVIDER" || die INVALID_PROVIDER 'configured provider contains unsafe characters' 'the profile is blocked' 'rerun supervised configuration'
  valid_atom "$POSITRON_OPENCODE_MODEL" || die INVALID_MODEL 'configured model contains unsafe characters' 'the profile is blocked' 'rerun supervised configuration'
  [[ -f "$TOKEN_FILE" && ! -L "$TOKEN_FILE" ]] || die GITHUB_TOKEN_MISSING 'configured GitHub token file is missing' 'the supervised profile is blocked' 'run configure supervised again with a secure token source'
  [[ "$(stat -c '%a' "$TOKEN_FILE")" == 600 ]] || die SECRET_FILE_PERMISSIONS 'GitHub token file must be mode 0600' 'the supervised profile is blocked' 'chmod 600 the secret file and retry'
  export GITHUB_TOKEN="$(tr -d '\r\n' <"$TOKEN_FILE")"
  [[ -n "$GITHUB_TOKEN" ]] || die GITHUB_TOKEN_MISSING 'configured GitHub token is empty' 'the supervised profile is blocked' 'configure a non-empty token'
}

validate_tools() {
  [[ -x "$POSITRON_OPENCODE_HOST_PATH" ]] || die OPENCODE_NOT_FOUND 'configured OpenCode executable is unavailable' 'supervised readiness is blocked' 'install OpenCode and rerun configure supervised'
  [[ -d "$POSITRON_SPECKIT_HOST_PATH" || -x "$POSITRON_SPECKIT_HOST_PATH" ]] || die SPECKIT_NOT_FOUND 'configured SpecKit path is unavailable' 'supervised readiness is blocked' 'install SpecKit and rerun configure supervised'
  [[ -f "$COMPOSE_FILE" ]] || die ADVANCED_COMPOSE_MISSING 'installed advanced Compose file is unavailable' 'supervised mode cannot start' 'install a compatible Positron release'
}

configure_profile() {
  local repo='' branch='main' token_source='' provider="${POSITRON_OPENCODE_PROVIDER:-}" model="${POSITRON_OPENCODE_MODEL:-}" allow_push=false check=false
  while (($#)); do
    case "$1" in
      --repo) (($# >= 2)) || die INVALID_REPOSITORY 'missing value for --repo' 'configuration was not written' 'use --repo OWNER/REPO'; repo="$2"; shift 2 ;;
      --default-branch) (($# >= 2)) || die INVALID_BRANCH 'missing value for --default-branch' 'configuration was not written' 'provide a branch name'; branch="$2"; shift 2 ;;
      --github-token-file) (($# >= 2)) || die SECRET_SOURCE_INVALID 'missing token file path' 'configuration was not written' 'provide a secure file path'; token_source="$2"; shift 2 ;;
      --provider) (($# >= 2)) || die INVALID_PROVIDER 'missing provider value' 'configuration was not written' 'provide a provider name'; provider="$2"; shift 2 ;;
      --model) (($# >= 2)) || die INVALID_MODEL 'missing model value' 'configuration was not written' 'provide a model name'; model="$2"; shift 2 ;;
      --allow-push) allow_push=true; shift ;;
      --check) check=true; shift ;;
      --help|-h) usage; return 0 ;;
      *) die INVALID_ARGUMENT "unknown option: $1" 'configuration was not written' 'run positron configure supervised --help' ;;
    esac
  done
  if [[ "$check" == true ]]; then load_config; validate_tools; printf '%s\n' 'Supervised configuration: PASS'; return; fi
  [[ -n "$repo" ]] || { if [[ -t 0 ]]; then read -r -p 'Repository (OWNER/REPO): ' repo; else die REPOSITORY_MISSING 'no repository was supplied' 'configuration was not written' 'use --repo OWNER/REPO'; fi; }
  valid_repo "$repo" || die INVALID_REPOSITORY 'repository must be OWNER/REPO with safe characters' 'configuration was not written' 'use a GitHub repository coordinate such as owner/project'
  [[ -n "$branch" ]] && valid_branch "$branch" || die INVALID_BRANCH 'default branch contains unsafe characters' 'configuration was not written' 'use a simple branch name'
  [[ -n "$provider" ]] || { if [[ -t 0 ]]; then read -r -p 'OpenCode provider: ' provider; else die PROVIDER_MISSING 'no provider was supplied' 'configuration was not written' 'use --provider or configure interactively'; fi; }
  [[ -n "$model" ]] || { if [[ -t 0 ]]; then read -r -p 'OpenCode model: ' model; else die MODEL_MISSING 'no model was supplied' 'configuration was not written' 'use --model or configure interactively'; fi; }
  valid_atom "$provider" || die INVALID_PROVIDER 'provider contains unsafe characters' 'configuration was not written' 'use a provider identifier'
  valid_atom "$model" || die INVALID_MODEL 'model contains unsafe characters' 'configuration was not written' 'use a model identifier'
  local opencode_path specify_path opencode_config opencode_home opencode_version specify_version
  opencode_path="$(discover_opencode)"; [[ -n "$opencode_path" ]] || die OPENCODE_NOT_FOUND 'OpenCode was not found on PATH' 'configuration was not written' 'install OpenCode and retry'
  specify_path="$(discover_specify)"; [[ -n "$specify_path" ]] || die SPECKIT_NOT_FOUND 'SpecKit was not found on PATH' 'configuration was not written' 'install SpecKit and retry'
  [[ -f "$opencode_path" || -x "$opencode_path" ]] || die OPENCODE_NOT_FOUND 'discovered OpenCode path is not executable' 'configuration was not written' 'repair the OpenCode installation'
  [[ -e "$specify_path" ]] || die SPECKIT_NOT_FOUND 'discovered SpecKit path is unavailable' 'configuration was not written' 'repair the SpecKit installation'
  opencode_version="$(opencode --version 2>/dev/null || true)"
  specify_version="$(specify --version 2>/dev/null || specify-cli --version 2>/dev/null || true)"
  opencode_config="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"; opencode_home="${HOME}/.opencode"
  local token; token="$(read_token "$token_source")"; [[ -n "$token" ]] || die GITHUB_TOKEN_MISSING 'GitHub token is empty' 'configuration was not written' 'provide a non-empty token'
  secure_dir "$SECRET_DIR" || die CONFIG_PERMISSION_DENIED 'secret directory could not be protected' 'configuration was not written' 'repair the XDG config directory'
  umask 077; printf '%s\n' "$token" >"$TOKEN_FILE"; secure_file "$TOKEN_FILE"
  IFS=/ read -r owner repo <<<"$repo"
  write_config "$owner" "$repo" "$branch" "$provider" "$model" "$allow_push" "$opencode_path" "$specify_path" "$opencode_config" "$opencode_home"
  printf '%s\n' 'Positron supervised setup' '  GitHub token: configured (value hidden)' "  Repository: $owner/$repo" "  OpenCode: ${opencode_version:-available} ($opencode_path)" "  SpecKit: ${specify_version:-available} ($specify_path)" "  Provider: $provider" "  Model: $model" "  Push: $allow_push" '  Merge: disabled (kill switch active)' "Configuration saved securely: $CONFIG_FILE" 'Next: positron doctor --supervised'
}

build_runtime_env() {
  load_config; validate_tools
  [[ -f "$RUNTIME_DIR/redis-password" ]] || { umask 077; printf '%s\n' "$(generate_secret)" >"$RUNTIME_DIR/redis-password"; secure_file "$RUNTIME_DIR/redis-password"; }
  [[ -f "$RUNTIME_DIR/admin-token" ]] || { umask 077; printf '%s\n' "$(generate_secret)" >"$RUNTIME_DIR/admin-token"; secure_file "$RUNTIME_DIR/admin-token"; }
  local tmp="$RUNTIME_ENV.tmp.$$"; umask 077
  {
    printf 'HOME=%s\nREDIS_PASSWORD=%s\nPOSITRON_ADMIN_TOKEN=%s\n' "$HOME" "$(tr -d '\r\n' <"$RUNTIME_DIR/redis-password")" "$(tr -d '\r\n' <"$RUNTIME_DIR/admin-token")"
    printf 'GITHUB_TOKEN=%s\nPOSITRON_GITHUB_MODE=real\nPOSITRON_SPECKIT_MODE=real\nPOSITRON_OPENCODE_MODE=real\n' "$GITHUB_TOKEN"
    grep -E '^(POSITRON_REPO_|POSITRON_OPENCODE_PROVIDER=|POSITRON_OPENCODE_MODEL=|POSITRON_ENABLE_PUSH=|POSITRON_ENABLE_MERGE=|POSITRON_MERGE_DRY_RUN=|POSITRON_MERGE_KILL_SWITCH=|POSITRON_OPENCODE_HOST_PATH=|POSITRON_SPECKIT_HOST_PATH=|POSITRON_OPENCODE_CONFIG_PATH=|POSITRON_OPENCODE_HOME_PATH=)' "$CONFIG_FILE"
  } >"$tmp"
  secure_file "$tmp"; mv -f -- "$tmp" "$RUNTIME_ENV"
}
compose() { docker compose --project-name "$PROJECT_NAME" --env-file "$RUNTIME_ENV" --file "$COMPOSE_FILE" "$@"; }
check_port_conflict() { if docker ps --filter 'label=com.docker.compose.project=positron-quickstart' --filter status=running --format '{{.Names}}' 2>/dev/null | grep -q .; then die PROFILE_PORT_CONFLICT 'the safe demo currently owns Positron ports' 'supervised start did not stop or modify the demo' 'run positron stop, then positron start --supervised'; fi; }
doctor() {
  load_config; validate_tools
  command_exists docker || die DOCKER_NOT_FOUND 'Docker is unavailable' 'supervised readiness is blocked' 'install/start Docker and retry'
  docker info >/dev/null 2>&1 || die DOCKER_DAEMON_UNAVAILABLE 'Docker daemon is unavailable' 'supervised readiness is blocked' 'start Docker and retry'
  docker compose version >/dev/null 2>&1 || die COMPOSE_V2_NOT_FOUND 'Docker Compose v2 is unavailable' 'supervised readiness is blocked' 'install/enable Compose v2 and retry'
  if command_exists gh; then
    GH_TOKEN="$GITHUB_TOKEN" gh api user >/dev/null 2>&1 || die GITHUB_AUTH_INVALID 'GitHub authentication failed' 'supervised readiness is blocked' 'configure a valid least-privilege GitHub token'
    GH_TOKEN="$GITHUB_TOKEN" gh api "repos/${POSITRON_REPO_OWNER}/${POSITRON_REPO_NAME}" >/dev/null 2>&1 || die GITHUB_REPO_ACCESS 'configured repository is not accessible' 'supervised readiness is blocked' 'choose an accessible repository and retry'
  else
    die GITHUB_CLIENT_NOT_FOUND 'GitHub CLI is required to validate supervised access' 'supervised readiness is blocked' 'install gh and retry'
  fi
  printf '%s\n' 'Supervised configuration: PASS' 'Docker: PASS' 'GitHub auth: PASS (value hidden)' 'GitHub repository access: PASS' "Repository: ${POSITRON_REPO_OWNER}/${POSITRON_REPO_NAME}" 'Provider/model: configured (values hidden)' 'Push: explicitly configured' 'Merge: disabled; kill switch active'
}
start() { build_runtime_env; check_port_conflict; compose config --quiet; compose up --detach --remove-orphans; printf 'Positron supervised runtime started: %s\n' "$WEB_URL"; }
stop() { [[ -f "$RUNTIME_ENV" ]] || die SUPERVISED_NOT_RUNNING 'supervised runtime is not configured or running' 'nothing was stopped' 'run positron configure supervised'; compose down; printf '%s\n' 'Positron supervised runtime stopped.'; }
status() { build_runtime_env; compose ps; if command_exists curl && curl --silent --show-error --fail --max-time 3 "$WEB_URL/api/operator-readiness" >/dev/null 2>&1; then printf '%s\n' 'Operator readiness: PASS'; else printf '%s\n' 'Operator readiness: not ready'; return 1; fi; }

case "${1:-help}" in
  configure) shift; [[ "${1:-}" == supervised ]] || die INVALID_COMMAND 'expected configure supervised' 'no configuration was changed' 'run positron configure supervised --help'; shift; configure_profile "$@" ;;
  doctor) shift; doctor "$@" ;;
  start) shift; start "$@" ;;
  stop) shift; stop "$@" ;;
  status) shift; status "$@" ;;
  help|-h|--help) usage ;;
  *) die UNKNOWN_COMMAND "unknown supervised command: $1" 'no action was taken' 'run positron configure supervised --help' ;;
esac
