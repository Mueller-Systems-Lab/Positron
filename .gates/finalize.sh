#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
source .gates/policy.env
source .gates/lib/gate-lib.sh

mode="${1:?usage: .gates/finalize.sh GREEN|OWNER_ACTION_REQUIRED}"
matrix="$(matrix_path)"

if [[ "$mode" == GREEN ]]; then
	for gate in $([[ -n "${REQUIRED_GATES:-}" ]] && tr ',' ' ' <<<"$REQUIRED_GATES"); do
		[[ "$(state_field "$gate" 1)" == PASS ]] || { printf 'FINALIZER=REJECTED\nREASON=%s not PASS\n' "$gate" >&2; exit 1; }
	done
	[[ -n "$matrix" && -f "$matrix" ]] || { printf 'FINALIZER=REJECTED\nREASON=completion matrix missing\n' >&2; exit 1; }
	[[ "$(state_value VALIDATED_CONTENT_FINGERPRINT)" == "$(candidate_fingerprint)" ]] || { printf 'FINALIZER=REJECTED\nREASON=validated content differs from candidate content\n' >&2; exit 1; }
	node - "$matrix" <<'NODE'
const fs = require('node:fs');
const matrix = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const terminal = new Set(['PASS', 'NOT_APPLICABLE_WITH_REASON']);
if (matrix.requirements.some((row) => row.blocking && !terminal.has(row.status))) process.exit(1);
if (matrix.requirements.some((row) => ['UNKNOWN', 'UNVERIFIED', 'ASSUMED'].includes(row.status))) process.exit(1);
NODE
	printf 'FINAL_CLASSIFICATION=GREEN_PROJECT_COMPLETE\nPROJECT_COMPLETE=YES\n'
	exit 0
fi

if [[ "$mode" == OWNER_ACTION_REQUIRED ]]; then
	marker="$ROOT/.gates/.state/OWNER_ACTION_REQUIRED"
	[[ -f "$marker" ]] || { printf 'FINALIZER=REJECTED\nREASON=owner-action admission missing\n' >&2; exit 1; }
	cat "$marker"
	exit 0
fi
printf 'FINALIZER=REJECTED\nREASON=unknown finalizer mode\n' >&2
exit 1
