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
	git remote get-url origin >/dev/null
	test -n "$(git branch --show-current)" || fail G20 "detached HEAD is not admitted"
	pass G20
	;;
G25)
	require_pass G10 G25
	validate_matrix_shape || fail G25 "completion matrix missing or malformed"
	matrix="$(matrix_path)"
	node - "$matrix" <<'NODE'
const fs = require('node:fs');
const matrix = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!matrix.scope.product.includes('Issue 491')) process.exit(1);
if (!matrix.requirements.some((row) => row.id === 'GOV-001')) process.exit(1);
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
		record G35 "PASS|$(head_sha)|$(candidate_fingerprint)|$(date -Is)"
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
	run_local integration-tests npm run test:integration
	run_local transfer-reference-tests npm run test:transfer-references
	run_local review-execution-tests npm run test:review-execution
	run_local issue-verification npm run verify:issues all
	pass G60
	;;
G65)
	require_pass G60 G65
	require_current_tree G60 G65
	e2e_snapshot="$(mktemp -d)"
	if [[ -d docs/release/ui-workflow-proof ]]; then
		cp -a -- docs/release/ui-workflow-proof "$e2e_snapshot/artifact"
	fi
	if [[ -f docs/release/ui-workflow-proof-report.md ]]; then
		cp -p -- docs/release/ui-workflow-proof-report.md "$e2e_snapshot/report"
	fi
	set +e
	npm run test:e2e
	e2e_status=$?
	set -e
	.gates/cleanup-product-e2e-runtime.sh "$e2e_snapshot"
	rm -rf -- "$e2e_snapshot"
	if [[ "$e2e_status" -ne 0 ]]; then
		fail G65 "product E2E failed with exit code $e2e_status"
	fi
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
	record G75 "PASS|$(head_sha)|$validated|$(date -Is)"
	printf 'G75=PASS\nVALIDATED_CONTENT_FINGERPRINT=%s\n' "$validated"
	;;
G80)
	require_pass G75 G80
	[[ "$(state_value VALIDATED_CONTENT_FINGERPRINT)" == "$(candidate_fingerprint)" ]] || fail G80 "candidate differs from sealed content"
	record G80 "PASS|$(head_sha)|$(candidate_fingerprint)|$(date -Is)"
	printf 'G80=PASS\n'
	;;
G85)
	require_pass G80 G85
	validated="$(state_value VALIDATED_CONTENT_FINGERPRINT)"
	[[ -n "$validated" && "$validated" == "$(candidate_fingerprint)" ]] || fail G85 "committed content differs from validated content"
	while IFS= read -r path; do
		[[ -z "$path" ]] && continue
		grep -Fxq "$path" "$baseline_user_paths" 2>/dev/null || fail G85 "working tree has post-commit run mutation: $path"
	done < <(git diff --name-only HEAD)
	record G85 "PASS|$(head_sha)|$validated|$(date -Is)"
	printf 'G85=PASS\n'
	;;
G90)
	require_pass G35 G90
	test "${ALLOW_DIRECT_GITHUB_API_MUTATIONS}" = no || fail G90 "direct GitHub API mutations are enabled"
	test "${ALLOW_GH_MUTATIONS}" = no || fail G90 "gh mutations are enabled"
	test -f "$(matrix_path)" || fail G90 "completion matrix missing"
	pass G90
	;;
G95)
	require_pass G90 G95
	readback="$ROOT/.run/$(basename "$(dirname "$(matrix_path)")")/github-readback.json"
	test -f "$readback" || fail G95 "browser-generated GitHub readback is missing"
	node - "$readback" <<'NODE'
const fs = require('node:fs');
const readback = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (readback.transport !== 'visible-playwright' || readback.status !== 'PASS' || !readback.repository || !readback.issue_491) process.exit(1);
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
NODE
	pass G100
	;;
self-test)
	"$ROOT/.gates/self-test.sh"
	;;
*) fail "$gate" "unknown gate" ;;
esac
