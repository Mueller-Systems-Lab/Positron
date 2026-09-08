#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

snapshot_dir="${1:?usage: .gates/cleanup-product-e2e-runtime.sh <snapshot-dir>}"
artifact_dir="docs/release/ui-workflow-proof"
report_path="docs/release/ui-workflow-proof-report.md"

# E2E owns these exact runtime paths. Restore their pre-test state so G65
# seals the tested candidate rather than timestamped observation artifacts.
rm -rf -- "$artifact_dir"
if [[ -d "$snapshot_dir/artifact" ]]; then
	cp -a -- "$snapshot_dir/artifact" "$artifact_dir"
fi

if [[ -f "$snapshot_dir/report" ]]; then
	cp -p -- "$snapshot_dir/report" "$report_path"
else
	rm -f -- "$report_path"
fi
