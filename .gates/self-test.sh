#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel)"
TMP="$(mktemp -d /tmp/positron-gate-selftest.XXXXXX)"
trap 'rm -rf -- "$TMP"' EXIT
FIXTURE="$TMP/fixture"

expect_fail() {
	if "$@"; then
		printf 'EXPECTED_REJECT=FAIL %s\n' "$*" >&2
		exit 1
	fi
}

fresh() {
	rm -rf -- "$FIXTURE"
	mkdir -p "$FIXTURE/.gates/lib" "$FIXTURE/.run/fixture" "$FIXTURE/.specify/memory" "$FIXTURE/scripts" "$FIXTURE/bin" "$FIXTURE/docs/evidence/hard-gate-bootstrap"
	cp "$ROOT/.gates/run-gate.sh" "$ROOT/.gates/policy.env" "$ROOT/.gates/commit.sh" "$ROOT/.gates/admit-blocker.sh" "$ROOT/.gates/finalize.sh" "$ROOT/.gates/cleanup-product-e2e-runtime.sh" "$FIXTURE/.gates/"
	cp "$ROOT/.gates/github-control-plane.mjs" "$FIXTURE/.gates/"
	cp "$ROOT/.gates/lib/gate-lib.sh" "$FIXTURE/.gates/lib/"
	cp "$ROOT/docs/evidence/hard-gate-bootstrap/completion-matrix-ids.json" "$FIXTURE/docs/evidence/hard-gate-bootstrap/"
	printf '%s\n' '#!/usr/bin/env bash' 'printf "fixture installer: PASS\n"' >"$FIXTURE/scripts/installer-test.sh"
	chmod 755 "$FIXTURE/scripts/installer-test.sh"
	printf '%s\n' '#!/usr/bin/env bash' 'FAIL="$FAKE_NPM_FAIL"' '[[ -n "$FAIL" ]] && case "$*" in *"$FAIL"*) exit 1;; esac' 'exit 0' >"$FIXTURE/bin/npm"
	chmod 755 "$FIXTURE/bin/npm"
	printf '%s\n' '#!/usr/bin/env bash' 'FAIL="$FAKE_NPX_FAIL"' '[[ -n "$FAIL" ]] && case "$*" in *"$FAIL"*) exit 1;; esac' 'exit 0' >"$FIXTURE/bin/npx"
	chmod 755 "$FIXTURE/bin/npx"
	printf '%s\n' 'console.log("fixture Playwright probe: PASS")' >"$FIXTURE/.gates/playwright-probe.mjs"
	printf '%s\n' "import fs from 'node:fs'; import {execFileSync} from 'node:child_process'; const out=process.argv[2]; const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(); const branch=execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(); const origin=execFileSync('git',['remote','get-url','origin'],{encoding:'utf8'}).trim(); fs.writeFileSync(out,JSON.stringify({transport:'visible-playwright',mode:'headed',status:'PASS',repository:'Mueller-Systems-Lab/Positron',captured_at:new Date().toISOString(),local:{head,branch,origin},issue_491:{status:'CLOSED'},issue_493:{status:'OPEN'},pull_492:{status:'MERGED',reviews_visible:true,checks_visible:true},pages:{branch_commits:{readable:true},pull_requests:{readable:true},releases:{readable:true}}}));" >"$FIXTURE/.gates/github-control-plane.mjs"
	printf '%s\n' 'constitution' >"$FIXTURE/.specify/memory/constitution.md"
	printf '%s\n' 'navigator' >"$FIXTURE/AGENTS.md"
	printf '%s\n' 'fixture evidence' >"$FIXTURE/.run/fixture/evidence.md"
	printf '%s\n' 'fixture source' >"$FIXTURE/fixture"
	printf '%s\n' 'ignored.txt' >"$FIXTURE/.gitignore"
	printf '%s\n' 'ignored baseline' >"$FIXTURE/ignored.txt"
	node - "$FIXTURE/.run/fixture/completion-matrix.json" "$FIXTURE/docs/evidence/hard-gate-bootstrap/completion-matrix-ids.json" <<'NODE'
const fs = require('node:fs');
const [matrixPath, idsPath] = process.argv.slice(2);
const ids = JSON.parse(fs.readFileSync(idsPath, 'utf8')).required_ids;
const requirements = ids.map((id) => ({id, source:['fixture'], requirement:`fixture ${id}`, status:'PASS', evidence:['.run/fixture/evidence.md'], test:['fixture'], blocking:id !== 'GH-002'}));
const boundary = requirements.find((row) => row.id === 'GH-002');
boundary.status = 'NOT_APPLICABLE_WITH_REASON';
boundary.reason = 'fixture boundary';
fs.writeFileSync(matrixPath, JSON.stringify({run_id:'fixture', branch:'feature', source_head:'', scope:{product:'Issue 491 fixture'}, requirements}));
NODE
	git -C "$FIXTURE" init -q -b main
	git -C "$FIXTURE" config user.email codex-fixture@example.invalid
	git -C "$FIXTURE" config user.name Codex-Fixture
	git -C "$FIXTURE" remote add origin https://github.com/Mueller-Systems-Lab/Positron.git
	git -C "$FIXTURE" add .
	git -C "$FIXTURE" commit -qm baseline
	git -C "$FIXTURE" switch -qc feature
	node - "$FIXTURE/.run/fixture/completion-matrix.json" "$FIXTURE" <<'NODE'
const fs = require('node:fs');
const [path, fixture] = process.argv.slice(2);
const matrix = JSON.parse(fs.readFileSync(path, 'utf8'));
matrix.source_head = require('node:child_process').execFileSync('git', ['-C', fixture, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
fs.writeFileSync(path, JSON.stringify(matrix));
NODE
}

gate() { (cd "$FIXTURE" && PATH="$FIXTURE/bin:$PATH" "$@"); }
gate_env() { local name="$1" value="$2" target="$3"; (cd "$FIXTURE" && env "$name=$value" PATH="$FIXTURE/bin:$PATH" .gates/run-gate.sh "$target"); }
prepare() { gate .gates/run-gate.sh G10; gate .gates/run-gate.sh G20; gate .gates/run-gate.sh G25; gate .gates/run-gate.sh G30; gate .gates/run-gate.sh G40; }
to_g50() { prepare; gate .gates/run-gate.sh G50; }
to_g60() { to_g50; gate .gates/run-gate.sh G60; }
to_g65() { to_g60; gate .gates/run-gate.sh G65; }
to_g80() {
	prepare
	printf 'sealed fixture content\n' >"$FIXTURE/.run/fixture/commit-marker.txt"
	gate .gates/run-gate.sh G40
	gate .gates/run-gate.sh G50
	gate .gates/run-gate.sh G60
	gate .gates/run-gate.sh G65
	gate .gates/run-gate.sh G70
	gate .gates/run-gate.sh G75
	gate .gates/run-gate.sh G80
}

fresh
expect_fail gate .gates/run-gate.sh G40
printf 'T01=PASS\n'

fresh
gate .gates/run-gate.sh G10
gate .gates/run-gate.sh G20
git -C "$FIXTURE" switch -q main
expect_fail gate .gates/run-gate.sh G30
printf 'T02=PASS\n'

fresh
prepare
printf 'out of scope\n' >"$FIXTURE/out-of-scope.txt"
expect_fail gate .gates/run-gate.sh G40
printf 'T03=PASS\n'

fresh
printf 'pre-existing user work\n' >"$FIXTURE/.run/user-work.txt"
gate .gates/run-gate.sh G10
gate .gates/run-gate.sh G20
gate .gates/run-gate.sh G25
gate .gates/run-gate.sh G30
printf 'mutated user work\n' >"$FIXTURE/.run/user-work.txt"
expect_fail gate .gates/run-gate.sh G40
printf 'T04=PASS\n'

fresh
prepare
printf 'tracked mutation\n' >>"$FIXTURE/AGENTS.md"
expect_fail gate .gates/run-gate.sh G50
printf 'T08=PASS\n'

fresh
prepare
printf 'existing untracked\n' >"$FIXTURE/.run/existing.txt"
expect_fail gate .gates/run-gate.sh G50
printf 'T09=PASS\n'

fresh
prepare
printf 'new candidate\n' >"$FIXTURE/.run/new.txt"
expect_fail gate .gates/run-gate.sh G50
printf 'T10=PASS\n'

fresh
to_g65
printf 'evidence mutation\n' >>"$FIXTURE/.run/fixture/evidence.md"
expect_fail gate .gates/run-gate.sh G70
printf 'T11=PASS\n'

fresh
to_g65
printf 'ignored mutation\n' >"$FIXTURE/ignored.txt"
expect_fail gate .gates/run-gate.sh G70
printf 'T20=PASS\n'

fresh
prepare
expect_fail gate .gates/commit.sh -m 'should reject'
printf 'T12=PASS\n'

fresh
to_g80
printf 'post-seal mutation\n' >>"$FIXTURE/AGENTS.md"
expect_fail gate .gates/commit.sh -m 'should reject'
printf 'T13=PASS\n'

fresh
prepare
expect_fail gate .gates/run-gate.sh G90
printf 'T14=PASS\n'

fresh
prepare
expect_fail gate_env POSITRON_HEADED_BROWSER_VISIBLE yes G90
printf 'T15=PASS\n'

fresh
expect_fail gate .gates/admit-blocker.sh PAID_ACTION_APPROVAL_REQUIRED /dev/null
printf 'T16=PASS\n'

fresh
expect_fail gate .gates/admit-blocker.sh DIRECT_GITHUB_API_MUTATION /dev/null
printf 'T17=PASS\n'

fresh
expect_fail gate .gates/admit-blocker.sh GH_MUTATION /dev/null
printf 'T18=PASS\n'

fresh
	printf '%s\n' '{"transport":"visible-playwright","mode":"headed","status":"PASS","repository":"Mueller-Systems-Lab/Positron","captured_at":"2026-09-09T00:00:00Z","issue_491":{"status":"CLOSED"},"issue_493":{"status":"OPEN"},"pull_492":{"status":"MERGED","reviews_visible":true,"checks_visible":true}}' >"$FIXTURE/.run/fixture/github-readback.json"
to_g80
git -C "$FIXTURE" add .run/fixture/commit-marker.txt .run/fixture/github-readback.json
gate .gates/commit.sh -qm 'fixture happy path'
gate .gates/run-gate.sh G85
gate .gates/run-gate.sh G35
gate .gates/run-gate.sh G90
gate .gates/run-gate.sh G95
gate .gates/run-gate.sh G100
printf 'T19=PASS\n'

fresh
prepare
expect_fail gate_env FAKE_NPM_FAIL verify:canonical-boundary G50
printf 'T05=PASS\n'

fresh
to_g50
expect_fail gate_env FAKE_NPM_FAIL typecheck G60
printf 'T06=PASS\n'

fresh
to_g60
expect_fail gate_env FAKE_NPM_FAIL test:e2e G65
printf 'T07=PASS\n'

printf 'HARD_GATES_ADMITTED=YES\n'
