#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
source .gates/policy.env
source .gates/lib/gate-lib.sh
require_pass G80 COMMIT
[[ "$(branch_name)" != "$DEFAULT_BRANCH" && -n "$(branch_name)" ]] || fail COMMIT "commit is forbidden on the default branch"
[[ "$(state_value VALIDATED_CONTENT_FINGERPRINT)" == "$(candidate_fingerprint)" ]] || fail COMMIT "candidate content differs from G75 seal"
git commit "$@"
