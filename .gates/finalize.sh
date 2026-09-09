#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
source .gates/policy.env
source .gates/lib/gate-lib.sh

mode="${1:?usage: .gates/finalize.sh GREEN|OWNER_ACTION_REQUIRED}"
matrix="$(matrix_path)"

if [[ "$mode" == GREEN ]]; then
	refresh_log="$(mktemp)"
	trap 'rm -f -- "$refresh_log"' EXIT
	for fresh_gate in G85 G40 G50 G60 G65 G70 G35 G90 G95 G100; do
		if ! bash .gates/run-gate.sh "$fresh_gate" >>"$refresh_log" 2>&1; then
			printf 'FINALIZER=REJECTED\nREASON=fresh finalizer validation failed at %s\n' "$fresh_gate" >&2
			cat "$refresh_log" >&2
			exit 1
		fi
	done
	for gate in $([[ -n "${REQUIRED_GATES:-}" ]] && tr ',' ' ' <<<"$REQUIRED_GATES"); do
		[[ "$(state_field "$gate" 1)" == PASS && "$(state_field "$gate" 2)" == "$(current_run_id)" && "$(state_field "$gate" 3)" == "$(branch_name)" ]] || { printf 'FINALIZER=REJECTED\nREASON=%s not current-run PASS\n' "$gate" >&2; exit 1; }
	done
	[[ -n "$matrix" && -f "$matrix" ]] || { printf 'FINALIZER=REJECTED\nREASON=completion matrix missing\n' >&2; exit 1; }
	validate_matrix_shape || { printf 'FINALIZER=REJECTED\nREASON=completion matrix shape or required IDs invalid\n' >&2; exit 1; }
	git diff --check || { printf 'FINALIZER=REJECTED\nREASON=diff check failed\n' >&2; exit 1; }
	[[ "$(state_value VALIDATED_CONTENT_FINGERPRINT)" == "$(candidate_fingerprint)" ]] || { printf 'FINALIZER=REJECTED\nREASON=validated content differs from candidate content\n' >&2; exit 1; }
	audit="$STATE_DIR/post-green-audit.json"
	[[ -f "$audit" ]] || { printf 'FINALIZER=REJECTED\nREASON=post-green audit is missing\n' >&2; exit 1; }
	node - "$matrix" <<'NODE'
const fs = require('node:fs');
const matrix = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const terminal = new Set(['PASS', 'NOT_APPLICABLE_WITH_REASON']);
if (matrix.requirements.some((row) => row.blocking && !terminal.has(row.status))) process.exit(1);
if (matrix.requirements.some((row) => ['UNKNOWN', 'UNVERIFIED', 'ASSUMED'].includes(row.status))) process.exit(1);
if (matrix.requirements.some((row) => row.status === 'NOT_APPLICABLE_WITH_REASON' && !(row.reason || '').trim())) process.exit(1);
NODE
node - "$matrix" "$audit" <<'NODE'
const fs = require('node:fs');
const [matrixPath, auditPath] = process.argv.slice(2);
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
const required = ['COMPLETION_MATRIX_AUDIT', 'HARD_GATE_RED_TEAM', 'CODE_REVIEW', 'TEST_SUITE_REVIEW', 'CLEAN_STATE_VALIDATION', 'E2E_REVALIDATION', 'ARCHITECTURE_REVIEW', 'SECURITY_REVIEW', 'GITHUB_REALITY_REVIEW'];
if (audit.status !== 'PASS' || required.some((key) => audit[key] !== 'PASS')) process.exit(1);
if (audit.findings_remaining !== 0 || audit.critical_findings !== 0 || audit.major_findings !== 0) process.exit(1);
if (!audit.final_head || !audit.content_fingerprint || audit.start_head !== audit.audit_start_head || audit.audit_start_head !== matrix.audit_start_head || !audit.reviewers || audit.reviewers < 5) process.exit(1);
const currentHead = require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (audit.final_head !== currentHead) process.exit(1);
const currentFp = require('node:child_process').execFileSync('bash', ['-lc', 'source .gates/policy.env && source .gates/lib/gate-lib.sh && candidate_fingerprint'], { encoding: 'utf8' }).trim();
if (audit.content_fingerprint !== currentFp) process.exit(1);
NODE
	printf 'FINAL_CLASSIFICATION=GREEN_PROJECT_COMPLETE\nPROJECT_COMPLETE=YES\n'
	exit 0
fi

if [[ "$mode" == OWNER_ACTION_REQUIRED ]]; then
	marker="$STATE_DIR/OWNER_ACTION_REQUIRED"
	[[ -f "$marker" ]] || { printf 'FINALIZER=REJECTED\nREASON=owner-action admission missing\n' >&2; exit 1; }
	cat "$marker"
	exit 0
fi
printf 'FINALIZER=REJECTED\nREASON=unknown finalizer mode\n' >&2
exit 1
