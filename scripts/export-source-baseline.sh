#!/usr/bin/env bash
set -Eeuo pipefail

OUTPUT_DIR="${1:-source-baseline}"

for cmd in git sha256sum gzip; do
	command -v "$cmd" >/dev/null 2>&1 || { printf 'ERROR_CODE=MISSING_COMMAND\nCOMMAND=%s\n' "$cmd" >&2; exit 1; }
done

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
	printf 'ERROR_CODE=DIRTY_WORKTREE\n' >&2
	exit 1
fi

COMMIT="$(git rev-parse HEAD)"
SHORT="$(git rev-parse --short=12 HEAD)"
mkdir -p "$OUTPUT_DIR"
ARCHIVE="$OUTPUT_DIR/positron-source-$SHORT.tar.gz"
META="$OUTPUT_DIR/baseline-$SHORT.txt"

git archive --format=tar HEAD | gzip -n >"$ARCHIVE"
SHA="$(sha256sum "$ARCHIVE" | awk '{print $1}')"

cat >"$META" <<META
SCHEMA=positron.source-baseline.v1
COMMIT=$COMMIT
ARCHIVE=$(basename "$ARCHIVE")
SHA256=$SHA
LICENSE_IN_ARCHIVE=UNCHANGED_FROM_SOURCE
HISTORY_INCLUDED=NO
META

printf 'BASELINE_STATUS=PASS\nCOMMIT=%s\nARCHIVE=%s\nSHA256=%s\nMETADATA=%s\n' "$COMMIT" "$ARCHIVE" "$SHA" "$META"
