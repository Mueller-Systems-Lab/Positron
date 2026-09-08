#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
source .gates/policy.env; source .gates/lib/gate-lib.sh
gate="${1:?usage: .gates/run-gate.sh G10|G20|G30|G35|G40|G50|G60|G70|G80|G90|G100|self-test}"
case "$gate" in
G10) test -f AGENTS.md && test -f .specify/memory/constitution.md || fail G10 "navigator or constitution missing"; pass G10 ;;
G20) git rev-parse --is-inside-work-tree >/dev/null; git remote get-url origin >/dev/null; pass G20 ;;
G30) require_pass G10 G30; require_pass G20 G30; b="$(git branch --show-current)"; [[ -n "$b" && "$b" != "$DEFAULT_BRANCH" ]] || fail G30 "default branch is mutation-protected"; pass G30 ;;
G35) if getent hosts github.com >/dev/null 2>&1 && [[ "${POSITRON_HEADED_BROWSER_VISIBLE:-no}" == yes ]]; then pass G35; else defer G35 "GitHub DNS or a verified visible Playwright browser is unavailable"; fi ;;
G40) require_pass G30 G40; git diff --check; pass G40 ;;
G50) require_pass G40 G50; npm run verify:canonical-boundary; pass G50 ;;
G60) require_pass G50 G60; npm run format:check && npm run typecheck && npm run build && npm test; pass G60 ;;
G70) require_pass G60 G70; mkdir -p docs/evidence/issue-0; { echo "# Gate evidence"; echo "head=$(head_sha)"; echo "tree=$(tree_fingerprint)"; date -Is; } >docs/evidence/issue-0/gate-run.md; pass G70 ;;
G80) require_pass G40 G80; require_pass G50 G80; require_pass G60 G80; require_pass G70 G80; require_current_tree G70 G80; pass G80 ;;
G90) require_pass G35 G90; pass G90 ;;
G100) require_pass G80 G100; require_pass G90 G100; require_current_tree G80 G100; pass G100 ;;
self-test) mkdir -p .gates/.state; find .gates/.state -type f -delete; if .gates/run-gate.sh G40 >/dev/null 2>&1; then fail SELFTEST "G40 accepted mutation before G30"; fi; .gates/run-gate.sh G10; .gates/run-gate.sh G20; .gates/run-gate.sh G30; .gates/run-gate.sh G40; echo "SELFTEST=PASS" ;;
*) fail "$gate" "unknown gate" ;;
esac
