#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel)"
STATE_DIR="$ROOT/.gates/.state"
mkdir -p "$STATE_DIR"

matrix_path() {
	find "$ROOT/.run" -type f -name completion-matrix.json -print 2>/dev/null | LC_ALL=C sort | tail -n 1
}

excluded_candidate() {
	case "$1" in
		node_modules|node_modules/*|*/node_modules|*/node_modules/*|dist|dist/*|*/dist|*/dist/*|.gates/.state|.gates/.state/*|.run/*/runtime|.run/*/runtime/*|*.tsbuildinfo|coverage|coverage/*|test-results|test-results/*|playwright-report|playwright-report/*|reports|reports/*)
			return 0
			;;
		*) return 1 ;;
	esac
}

candidate_paths() {
	{
	git ls-files -z HEAD
	git ls-files --cached -z
	git ls-files --others --exclude-standard -z
} | LC_ALL=C sort -zu
}

untracked_candidate_paths() {
	local path
	while IFS= read -r path; do
		excluded_candidate "$path" && continue
		printf '%s\n' "$path"
	done < <(git ls-files --others --exclude-standard)
}

file_record() {
	local path="$1" kind mode digest target
	if [[ ! -e "$path" && ! -L "$path" ]]; then
		printf '%s\tDELETED\t-\t-\n' "$path"
		return
	fi
	mode="$(stat -c '%a' -- "$path")"
	if [[ -L "$path" ]]; then
		kind=symlink
		target="$(readlink -- "$path")"
		digest="$(printf '%s' "$target" | sha256sum | awk '{print $1}')"
	elif [[ -f "$path" ]]; then
		kind=file
		digest="$(sha256sum -- "$path" | awk '{print $1}')"
	else
		kind=other
		digest="$(stat -c '%F:%s' -- "$path" | sha256sum | awk '{print $1}')"
	fi
	printf '%s\t%s\t%s\t%s\n' "$path" "$kind" "$mode" "$digest"
}

candidate_manifest() {
	local path
	while IFS= read -r -d '' path; do
		excluded_candidate "$path" && continue
		file_record "$path"
	done < <(candidate_paths)
}

candidate_fingerprint() {
	local manifest
	manifest="$(mktemp)"
	trap 'rm -f -- "$manifest"' RETURN
	candidate_manifest | LC_ALL=C sort >"$manifest"
	sha256sum "$manifest" | awk '{print $1}'
}

head_sha() { git rev-parse HEAD; }
state_value() { [[ -f "$STATE_DIR/$1" ]] && cat "$STATE_DIR/$1"; }
state_field() { state_value "$1" | awk -F'|' -v n="$2" '{print $n; exit}'; }
record() { printf '%s\n' "$2" >"$STATE_DIR/$1"; }
pass() {
	local gate="$1" fp
	fp="$(candidate_fingerprint)"
	record "$gate" "PASS|$(head_sha)|$fp|$(date -Is)"
	printf '%s=PASS\n' "$gate"
}
fail() { printf '%s=FAIL: %s\n' "$1" "$2" >&2; exit 1; }
defer() { record "$1" "DEFERRED|$(head_sha)|$(candidate_fingerprint)|$(date -Is)|$2"; printf '%s=DEFERRED: %s\n' "$1" "$2"; }
require_pass() { [[ "$(state_field "$1" 1)" == PASS ]] || fail "$2" "missing prerequisite $1"; }
require_current_tree() { [[ "$(state_field "$1" 3)" == "$(candidate_fingerprint)" ]] || fail "$2" "validated candidate content changed"; }

baseline_manifest_path="$STATE_DIR/baseline-manifest"
baseline_user_paths="$STATE_DIR/baseline-user-work.paths"

record_baseline() {
	candidate_manifest >"$baseline_manifest_path"
	{
		git diff --name-only HEAD
		untracked_candidate_paths
	} | LC_ALL=C sort -u >"$baseline_user_paths"
}

baseline_record() {
	awk -F'\t' -v p="$1" '$1 == p { print; found=1; exit } END { if (!found) print p "\tDELETED\t-\t-" }' "$baseline_manifest_path"
}

path_allowed() {
	local path="$1" prefix
	IFS=',' read -ra prefixes <<<"${ALLOWED_MUTATION_PREFIXES:-}"
	for prefix in "${prefixes[@]}"; do
		[[ -n "$prefix" ]] || continue
		[[ "$path" == "$prefix" || "$path" == "$prefix"/* ]] && return 0
	done
	return 1
}

changed_paths() {
	{
		git diff --name-only HEAD
		untracked_candidate_paths
	} | LC_ALL=C sort -u
}

scope_check() {
	local path current baseline
	[[ -f "$baseline_manifest_path" && -f "$baseline_user_paths" ]] || fail G40 "G30 baseline is missing"
	while IFS= read -r path; do
		[[ -n "$path" ]] || continue
		current="$(file_record "$path")"
		baseline="$(baseline_record "$path")"
		[[ "$current" == "$baseline" ]] || fail G40 "pre-existing user work changed: $path"
	done <"$baseline_user_paths"
	while IFS= read -r path; do
		[[ -n "$path" ]] || continue
		path_allowed "$path" || fail G40 "out-of-scope mutation: $path"
		case "$path" in
			.env|.env.*|*/.env|*/.env.*|*secret*|*token*) fail G40 "secret-bearing path is protected: $path" ;;
			node_modules/*|*/node_modules/*|dist/*|*/dist/*|coverage/*|test-results/*|playwright-report/*|reports/*|*.tsbuildinfo) fail G40 "generated artifact is not admissible: $path" ;;
			package.json|package-lock.json|npm-shrinkwrap.json|*/package.json|*/package-lock.json|*/npm-shrinkwrap.json)
				[[ "${ALLOW_DEPENDENCY_MUTATION:-no}" == yes ]] || fail G40 "dependency mutation is not approved: $path" ;;
			esac
	done < <(changed_paths)
}

validate_matrix_shape() {
	local matrix
	matrix="$(matrix_path)"
	[[ -n "$matrix" && -f "$matrix" ]] || return 1
	node - "$matrix" <<'NODE'
const fs = require('node:fs');
const matrix = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const allowed = new Set(['OPEN', 'IN_PROGRESS', 'PASS', 'NOT_APPLICABLE_WITH_REASON']);
if (!matrix.run_id || !matrix.scope?.product || !Array.isArray(matrix.requirements) || matrix.requirements.length === 0) process.exit(1);
for (const row of matrix.requirements) {
  if (!row.id || !row.requirement || !allowed.has(row.status) || !Array.isArray(row.source) || !Array.isArray(row.evidence) || !Array.isArray(row.test) || typeof row.blocking !== 'boolean') process.exit(1);
}
if (!matrix.requirements.some((row) => row.id === '491-001')) process.exit(1);
NODE
}
