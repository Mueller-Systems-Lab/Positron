#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
source .gates/policy.env
source .gates/lib/gate-lib.sh

gate="${1:?usage: .gates/run-gate.sh G10|G20|G25|G30|G35|G40|G50|G60|G65|G70|G75|G80|G85|G90|G95|G100|self-test}"

run_local() {
	local label="$1"
	shift
	printf 'RUNNING=%s\n' "$label"
	"$@"
}

case "$gate" in
G10)
	test -f AGENTS.md || fail G10 "navigator missing"
	test -f .specify/memory/constitution.md || fail G10 "constitution missing"
	pass G10
	;;
G20)
	git rev-parse --is-inside-work-tree >/dev/null
	origin="$(git remote get-url origin)"
	normalized_origin="${origin%.git}"
	[[ "$normalized_origin" == "https://github.com/${CANONICAL_REPOSITORY}" ]] || fail G20 "origin is not the canonical Positron repository"
	test -n "$(git branch --show-current)" || fail G20 "detached HEAD is not admitted"
	pass G20
	;;
G25)
	require_pass G10 G25
	validate_matrix_shape || fail G25 "completion matrix missing or malformed"
	matrix="$(matrix_path)"
	node - "$matrix" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const matrix = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!matrix.scope.product.includes('Issue 491')) process.exit(1);
if (!matrix.requirements.some((row) => row.id === 'GOV-001')) process.exit(1);
if (matrix.run_id !== require('node:path').basename(require('node:path').dirname(process.argv[2]))) process.exit(1);
if (matrix.branch !== require('node:child_process').execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim()) process.exit(1);
if (matrix.source_head !== require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()) process.exit(1);
const manifestPath = path.resolve('docs/evidence/hard-gate-bootstrap/completion-matrix-ids.json');
if (!fs.existsSync(manifestPath)) process.exit(1);
const required = new Set(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).required_ids || []);
const actual = new Set(matrix.requirements.map((row) => row.id));
if (required.size !== actual.size || [...required].some((id) => !actual.has(id))) process.exit(1);
NODE
	pass G25
	;;
G30)
	require_pass G10 G30
	require_pass G20 G30
	branch="$(git branch --show-current)"
	[[ "$branch" != "$DEFAULT_BRANCH" ]] || fail G30 "default branch is mutation-protected"
	record_baseline
	pass G30
	;;
G35)
	require_pass G30 G35
	probe="$ROOT/.gates/playwright-probe.mjs"
	test -f "$probe" || fail G35 "executable Playwright probe is missing"
	if node "$probe"; then
		record G35 "PASS|$(current_run_id)|$(branch_name)|$(head_sha)|$(candidate_fingerprint)|$(date -Is)"
		printf 'G35=PASS\n'
	else
		fail G35 "headed Playwright probe failed; recover the browser surface"
	fi
	;;
G40)
	require_pass G30 G40
	git diff --check
	scope_check
	pass G40
	;;
G50)
	require_pass G40 G50
	require_current_tree G40 G50
	run_local canonical-boundary npm run verify:canonical-boundary
	run_local issue-491-installer bash scripts/installer-test.sh
	pass G50
	;;
G60)
	require_pass G50 G60
	require_current_tree G50 G60
	run_local format npm run format:check
	run_local lint npm run lint
	run_local typecheck npm run typecheck
	run_local build npm run build
	run_local unit-and-package-tests npm test
	run_local contract-tests npm run test:contracts
	run_local safety-coverage npm run coverage:safety
	run_local integration-tests npx vitest run apps/server/src/__tests__/integration.test.ts apps/server/src/__tests__/durable-worker-integration.test.ts
	run_local transfer-reference-tests npm run test:transfer-references
	run_local review-execution-tests npm run test:review-execution
	run_local issue-verification npm run verify:issues all
	pass G60
	;;
G65)
	require_pass G60 G65
	require_current_tree G60 G65
	e2e_snapshot="$(mktemp -d)"
	e2e_before="$(candidate_fingerprint)"
	e2e_cleanup() {
		.gates/cleanup-product-e2e-runtime.sh "$e2e_snapshot"
		rmdir "$e2e_snapshot" 2>/dev/null || true
		trap - INT TERM
	}
	trap 'e2e_cleanup; exit 130' INT TERM
	if [[ -d docs/release/ui-workflow-proof ]]; then
		cp -a -- docs/release/ui-workflow-proof "$e2e_snapshot/artifact"
	fi
	if [[ -f docs/release/ui-workflow-proof-report.md ]]; then
		cp -p -- docs/release/ui-workflow-proof-report.md "$e2e_snapshot/report"
	fi
	set +e
	npm run test:route-smoke
	route_smoke_status=$?
	npm run test:e2e
	e2e_status=$?
	set -e
	e2e_cleanup
	if [[ "$route_smoke_status" -ne 0 ]]; then
		fail G65 "route smoke failed with exit code $route_smoke_status"
	fi
	if [[ "$e2e_status" -ne 0 ]]; then
		fail G65 "product E2E failed with exit code $e2e_status"
	fi
	[[ "$e2e_before" == "$(candidate_fingerprint)" ]] || fail G65 "product E2E mutated candidate content"
	pass G65
	;;
G70)
	require_pass G65 G70
	require_current_tree G65 G70
	validate_matrix_shape || fail G70 "completion matrix validation failed"
	matrix="$(matrix_path)"
node - "$matrix" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const matrixPath = process.argv[2];
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
for (const row of matrix.requirements) {
  if (row.status === 'UNKNOWN' || row.status === 'UNVERIFIED' || row.status === 'ASSUMED') process.exit(1);
  if (row.evidence.length === 0) process.exit(2);
  for (const item of row.evidence) {
    if (/^https?:\/\//.test(item)) continue;
    if (item.startsWith('user-run-contract')) continue;
    const candidate = path.resolve(path.dirname(path.resolve(matrixPath)), '..', '..', item);
    if (!fs.existsSync(candidate) && !fs.existsSync(path.resolve(item))) process.exit(3);
  }
  for (const item of row.source) {
    if (item.startsWith('user-run-contract') || /^https?:\/\//.test(item)) continue;
    if (item.startsWith('/') || item.split('/').includes('..')) process.exit(4);
    if (!fs.existsSync(path.resolve(item))) process.exit(5);
  }
}
NODE
	git diff --check
	pass G70
	;;
G75)
	for prerequisite in G40 G50 G60 G65 G70; do
		require_pass "$prerequisite" G75
		require_current_tree "$prerequisite" G75
	done
	validated="$(candidate_fingerprint)"
	record VALIDATED_CONTENT_FINGERPRINT "$validated"
	record G75 "PASS|$(current_run_id)|$(branch_name)|$(head_sha)|$validated|$(date -Is)"
	printf 'G75=PASS\nVALIDATED_CONTENT_FINGERPRINT=%s\n' "$validated"
	;;
G80)
	require_pass G75 G80
	[[ "$(state_value VALIDATED_CONTENT_FINGERPRINT)" == "$(candidate_fingerprint)" ]] || fail G80 "candidate differs from sealed content"
	record G80 "PASS|$(current_run_id)|$(branch_name)|$(head_sha)|$(candidate_fingerprint)|$(date -Is)"
	printf 'G80=PASS\n'
	;;
G85)
	[[ "$(state_field G80 1)" == PASS && "$(state_field G80 2)" == "$(current_run_id)" && "$(state_field G80 3)" == "$(branch_name)" ]] || fail G85 "missing current-run prerequisite G80"
	validated="$(state_value VALIDATED_CONTENT_FINGERPRINT)"
	[[ -n "$validated" && "$validated" == "$(candidate_fingerprint)" ]] || fail G85 "committed content differs from validated content"
	[[ "$(state_field G80 4)" != "$(head_sha)" ]] || fail G85 "HEAD did not advance after commit admission"
	while IFS= read -r path; do
		[[ -z "$path" ]] && continue
		grep -Fxq "$path" "$baseline_user_paths" 2>/dev/null || fail G85 "working tree has post-commit run mutation: $path"
	done < <(git diff --name-only HEAD)
	while IFS= read -r path; do
		[[ -z "$path" ]] || fail G85 "post-commit candidate mutation: $path"
	done < <(changed_paths)
	record G85 "PASS|$(current_run_id)|$(branch_name)|$(head_sha)|$validated|$(date -Is)"
	printf 'G85=PASS\n'
	;;
G90)
	require_pass G35 G90
	test "${ALLOW_DIRECT_GITHUB_API_MUTATIONS}" = no || fail G90 "direct GitHub API mutations are enabled"
	test "${ALLOW_GH_MUTATIONS}" = no || fail G90 "gh mutations are enabled"
	if rg -n --glob '*.sh' --glob '*.mjs' '(^|[[:space:];])gh[[:space:]]+(api|pr[[:space:]]+(close|comment|create|edit|merge|review)|issue[[:space:]]+(close|comment|create|edit)|release[[:space:]]+(create|edit|delete)|repo[[:space:]]+(create|delete|edit))|fetch\([^)]*api\.github' .gates >/dev/null 2>&1; then
		fail G90 "GitHub mutation syntax is present in the gate control plane"
	fi
	test -f "$(matrix_path)" || fail G90 "completion matrix missing"
	pass G90
	;;
G95)
	require_pass G90 G95
	fresh_readback="$STATE_DIR/github-readback.json"
	node "$ROOT/.gates/github-control-plane.mjs" "$fresh_readback" || fail G95 "fresh visible Playwright GitHub readback failed"
node - "$fresh_readback" <<'NODE'
const fs = require('node:fs');
const [fresh] = process.argv.slice(2).map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
const cp = require('node:child_process');
const head = cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const branch = cp.execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
const origin = cp.execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
if (fresh.transport !== 'visible-playwright' || fresh.mode !== 'headed' || fresh.status !== 'PASS') process.exit(1);
if (fresh.repository !== 'Mueller-Systems-Lab/Positron' || !fresh.captured_at) process.exit(1);
if (!fresh.issue_491 || !fresh.issue_493 || !fresh.pull_492) process.exit(1);
if (fresh.issue_491.status !== 'CLOSED' || fresh.issue_493.status !== 'OPEN') process.exit(1);
if (fresh.pull_492.status !== 'MERGED' || fresh.pull_492.reviews_visible !== true || fresh.pull_492.checks_visible !== true) process.exit(1);
if (!fresh.local || fresh.local.head !== head || fresh.local.branch !== branch || fresh.local.origin !== origin) process.exit(1);
if (!fresh.pages?.branch_commits?.readable || !fresh.pages?.pull_requests?.readable || !fresh.pages?.releases?.readable) process.exit(1);
NODE
	pass G95
	;;
G100)
	for prerequisite in G10 G20 G25 G30 G40 G50 G60 G65 G70 G75 G80 G85 G35 G90 G95; do require_pass "$prerequisite" G100; done
	require_current_tree G85 G100
	matrix="$(matrix_path)"
	node - "$matrix" <<'NODE'
const fs = require('node:fs');
const matrix = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const terminal = new Set(['PASS', 'NOT_APPLICABLE_WITH_REASON']);
if (matrix.requirements.some((row) => row.blocking && !terminal.has(row.status))) process.exit(1);
if (matrix.requirements.some((row) => row.evidence.length === 0)) process.exit(2);
if (matrix.requirements.some((row) => row.status === 'NOT_APPLICABLE_WITH_REASON' && !(row.reason || '').trim())) process.exit(3);
NODE
	pass G100
	;;
self-test)
	"$ROOT/.gates/self-test.sh"
	;;
*) fail "$gate" "unknown gate" ;;
esac
