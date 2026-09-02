#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${POSITRON_QUICKSTART_ROOT:-$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
COMPOSE_FILE="$ROOT_DIR/docker-compose.quickstart.yml"
WEB_URL="${POSITRON_DOCTOR_WEB_URL:-http://localhost:5173}"
API_URL="${POSITRON_DOCTOR_API_URL:-http://localhost:3000}"
MODE="demo"
JSON="false"

declare -a CHECKS=()
overall_status="PASS"

usage() {
	cat <<'HELP'
Positron install/setup doctor (read-only)

Usage: ./scripts/doctor.sh [--demo|--supervised] [--json]

Options:
  --demo        Check safe Docker demo prerequisites (default).
  --supervised  Also check explicitly configured integration prerequisites.
  --json        Emit positron.install-doctor.v1 JSON without secret values.
  --help        Show this help.

The doctor never installs packages, changes credentials, enables real mode,
push, or merge. A non-zero exit means the selected path is not ready.
HELP
}

json_escape() {
	local value="$1"
	value=${value//\\/\\\\}
	value=${value//\"/\\\"}
	value=${value//$'\n'/\\n}
	value=${value//$'\r'/\\r}
	value=${value//$'\t'/\\t}
	printf '%s' "$value"
}

record() {
	local name="$1" status="$2" reason="$3" impact="$4" action="$5"
	CHECKS+=("$name|$status|$reason|$impact|$action")
	case "$status" in
		BLOCKED|NEEDS_CONFIGURATION|UNKNOWN) overall_status="BLOCKED" ;;
	esac
}

command_exists() { command -v "$1" >/dev/null 2>&1; }

check_command() {
	local name="$1" command_name="$2" missing_status="$3" missing_reason="$4" missing_action="$5"
	if command_exists "$command_name"; then
		record "$name" PASS "${name}_AVAILABLE" "The $command_name command is available." "No action required."
	else
		record "$name" "$missing_status" "$missing_reason" "The selected path cannot use $command_name." "$missing_action"
	fi
}

check_optional_command() {
	local name="$1" command_name="$2"
	if command_exists "$command_name"; then
		record "$name" PASS "${name}_AVAILABLE" "The optional $command_name command is available." "No action required for demo mode."
	else
		record "$name" OPTIONAL "${name}_NOT_REQUIRED" "The demo does not require $command_name." "No action required; configure it only for supervised integrations."
	fi
}

check_demo() {
	if command_exists docker; then
		if docker info >/dev/null 2>&1; then
			record DOCKER PASS DOCKER_READY 'Docker is installed and the daemon is reachable.' 'No action required.'
		else
			record DOCKER BLOCKED DOCKER_DAEMON_UNAVAILABLE 'Docker is installed but the daemon is not reachable.' 'Start Docker, then rerun the doctor.'
		fi
	else
		record DOCKER BLOCKED DOCKER_NOT_FOUND 'Docker is required for the safe demo.' 'Install Docker using your operating system instructions, then rerun the doctor.'
	fi

	if command_exists docker && docker compose version >/dev/null 2>&1; then
		record COMPOSE PASS COMPOSE_V2_FOUND 'Docker Compose v2 is available.' 'No action required.'
	else
		record COMPOSE BLOCKED COMPOSE_V2_NOT_FOUND 'Docker Compose v2 is required for the safe demo.' 'Install or enable the Docker Compose v2 plugin, then rerun the doctor.'
	fi

	if [[ -f "$COMPOSE_FILE" ]]; then
		record QUICKSTART_FILE PASS QUICKSTART_FILE_FOUND 'The documented quickstart Compose file is present.' 'No action required.'
	else
		record QUICKSTART_FILE BLOCKED QUICKSTART_FILE_MISSING 'The safe demo cannot start without its Compose file.' 'Restore docker-compose.quickstart.yml or reclone Positron, then rerun the doctor.'
	fi

	check_command CURL curl BLOCKED CURL_NOT_FOUND 'Install curl using your operating system instructions, then rerun the doctor.'
	check_optional_command OPENCODE_OPTIONAL opencode
	check_optional_command SPECKIT_OPTIONAL specify

	local project_running=false
	if command_exists docker; then
		if docker ps --filter 'label=com.docker.compose.project=positron-quickstart' --filter status=running --format '{{.Names}}' 2>/dev/null | grep -q .; then
			project_running=true
		fi
	fi
	if [[ "$project_running" == true ]]; then
		record PORTS PASS DEMO_STACK_RUNNING 'The Positron demo stack already owns its documented ports.' 'Use --status to verify health or --stop to stop the demo.'
	elif command_exists curl && (curl --silent --show-error --fail --max-time 1 "$WEB_URL" >/dev/null 2>&1 || curl --silent --show-error --fail --max-time 1 "$API_URL/api/health" >/dev/null 2>&1); then
		record PORTS BLOCKED PORT_IN_USE 'A service already responds on a documented Positron demo port.' 'Stop the service using the demo port, then rerun the doctor.'
	else
		record PORTS PASS PORTS_AVAILABLE 'The documented demo ports are available.' 'No action required.'
	fi

	if [[ "$overall_status" == PASS ]]; then
		record DEMO_READINESS PASS DEMO_READY 'Safe fake/demo mode can be started from this checkout.' 'Run ./scripts/quickstart.sh.'
	else
		record DEMO_READINESS BLOCKED DEMO_PREREQUISITES_BLOCKED 'One or more safe demo prerequisites are not ready.' 'Resolve the listed checks, then rerun ./scripts/doctor.sh --demo.'
	fi
}

check_supervised() {
	check_command OPENCODE opencode NEEDS_CONFIGURATION OPENCODE_NOT_FOUND 'Install and verify OpenCode using its supported installation documentation, then rerun the doctor.'
	check_command SPECKIT specify NEEDS_CONFIGURATION SPECKIT_NOT_FOUND 'Install and verify SpecKit using its supported installation documentation, then rerun the doctor.'

	if [[ -n "${POSITRON_OPENCODE_PROVIDER:-}" ]]; then
		record PROVIDER PASS PROVIDER_CONFIGURED 'A provider is configured without exposing its value.' 'No action required.'
	else
		record PROVIDER NEEDS_CONFIGURATION PROVIDER_NOT_CONFIGURED 'No supervised provider is configured.' 'Set POSITRON_OPENCODE_PROVIDER in a protected local environment, then rerun the doctor.'
	fi
	if [[ -n "${POSITRON_OPENCODE_MODEL:-}" ]]; then
		record MODEL PASS MODEL_CONFIGURED 'A supervised model is configured without exposing its value.' 'No action required.'
	else
		record MODEL NEEDS_CONFIGURATION MODEL_NOT_RESOLVED 'No supervised model is configured.' 'Set POSITRON_OPENCODE_MODEL in a protected local environment, then rerun the doctor.'
	fi

	if [[ -n "${GITHUB_TOKEN:-}" ]]; then
		record GITHUB PASS GITHUB_CONFIGURED 'GitHub credentials are configured; secret values are not displayed.' 'Use a least-privilege token and validate access from the running readiness surface.'
	else
		record GITHUB NEEDS_CONFIGURATION GITHUB_CONFIG_MISSING 'No GitHub credential is configured for supervised integration.' 'Configure a least-privilege GitHub token in a protected local environment, then rerun the doctor.'
	fi
	if [[ -n "${POSITRON_REPO_OWNER:-}" && -n "${POSITRON_REPO_NAME:-}" ]]; then
		record REPOSITORY PASS REPOSITORY_CONFIGURED 'Repository identity is configured without exposing private values.' 'Use the running readiness surface for read-only repository validation.'
	else
		record REPOSITORY NEEDS_CONFIGURATION REPOSITORY_NOT_CONFIGURED 'No supervised repository identity is configured.' 'Set POSITRON_REPO_OWNER and POSITRON_REPO_NAME, then rerun the doctor.'
	fi

	if [[ "${POSITRON_ENABLE_REAL:-false}" == true || "${POSITRON_ENABLE_PUSH:-false}" == true || "${POSITRON_ENABLE_MERGE:-false}" == true ]]; then
		record SAFETY BLOCKED UNSAFE_MUTATION_FLAG 'A real, push, or merge enablement flag is active in this environment.' 'Disable real/push/merge flags and keep the merge kill switch active before supervised work.'
	else
		record SAFETY PASS REAL_MODE_NOT_ENABLED 'Real mode, push, and merge are not enabled by the doctor.' 'Any supervised execution still requires the backend readiness and approval gates.'
	fi
	if [[ "${POSITRON_MERGE_KILL_SWITCH:-true}" == false ]]; then
		record MERGE_SAFETY BLOCKED MERGE_KILL_SWITCH_INACTIVE 'The merge kill switch is explicitly inactive.' 'Set POSITRON_MERGE_KILL_SWITCH=true and rerun the doctor.'
	else
		record MERGE_SAFETY PASS MERGE_KILL_SWITCH_ACTIVE 'The merge kill switch remains active.' 'No action required.'
	fi

	if [[ "$overall_status" == PASS ]]; then
		record SUPERVISED_READINESS PASS SUPERVISED_PREREQUISITES_READY 'Configured supervised prerequisites are present; runtime readiness and approval remain authoritative.' 'Start Positron in a controlled environment and inspect operator readiness.'
	else
		record SUPERVISED_READINESS BLOCKED SUPERVISED_PREREQUISITES_BLOCKED 'Supervised integration is not ready from the current configuration.' 'Resolve each listed prerequisite; do not enable unsupervised real mode.'
	fi
}

render_human() {
	printf '%s\n' 'Positron install/setup doctor — positron.install-doctor.v1'
	printf 'Mode: %s\n\n' "$MODE"
	local item name status reason impact action
	for item in "${CHECKS[@]}"; do
		IFS='|' read -r name status reason impact action <<<"$item"
		printf '%-22s %-22s %s\n' "$name" "$status" "$reason"
		printf '  Impact: %s\n' "$impact"
		printf '  Next:   %s\n' "$action"
	done
	printf '\nOverall: %s\n' "$overall_status"
}

render_json() {
	printf '{"version":"positron.install-doctor.v1","mode":"%s","overall_status":"%s","checks":[' "$MODE" "$overall_status"
	local item name status reason impact action first=true
	for item in "${CHECKS[@]}"; do
		IFS='|' read -r name status reason impact action <<<"$item"
		if [[ "$first" == false ]]; then printf ','; fi
		first=false
		printf '{"name":"%s","status":"%s","reason_code":"%s","impact":"%s","next_action":"%s"}' \
			"$(json_escape "$name")" "$(json_escape "$status")" "$(json_escape "$reason")" "$(json_escape "$impact")" "$(json_escape "$action")"
	done
	printf ']}\n'
}

while (($# > 0)); do
	case "$1" in
		--demo) MODE="demo" ;;
		--supervised) MODE="supervised" ;;
		--json) JSON="true" ;;
		--help|-h) usage; exit 0 ;;
		*) printf 'doctor: unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
	esac
	shift
done

check_demo
if [[ "$MODE" == supervised ]]; then check_supervised; fi

if [[ "$JSON" == true ]]; then render_json; else render_human; fi
[[ "$overall_status" == PASS ]]
