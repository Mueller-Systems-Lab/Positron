#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
STATE_DIR="$ROOT/.gates/.state"
mkdir -p "$STATE_DIR"
tree_fingerprint() { git status --porcelain=v1 | sha256sum | awk '{print $1}'; }
head_sha() { git rev-parse HEAD; }
record() { printf '%s\n' "$2" >"$STATE_DIR/$1"; }
read_state() { test -f "$STATE_DIR/$1" && cat "$STATE_DIR/$1"; }
pass() { record "$1" "PASS|$(head_sha)|$(tree_fingerprint)|$(date -Is)"; echo "$1=PASS"; }
defer() { record "$1" "DEFERRED|$(head_sha)|$(tree_fingerprint)|$(date -Is)|$2"; echo "$1=DEFERRED: $2"; }
fail() { echo "$1=FAIL: $2" >&2; exit 1; }
require_pass() { [[ "$(read_state "$1")" == PASS\|* ]] || fail "$2" "missing prerequisite $1"; }
require_current_tree() { local state; state="$(read_state "$1")"; [[ "$state" == *"|$(tree_fingerprint)|"* ]] || fail "$2" "validated tree changed"; }
