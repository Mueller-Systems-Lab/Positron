#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
	cat <<'HELP'
Usage:
  scripts/generate-release-provenance.sh --version vX.Y.Z --artifact PATH --sbom PATH [--output-dir DIR]

Generates SHA-256 checksums and positron.release-provenance.v1 metadata from the
current exact Git commit. This script does not sign or publish artifacts.
HELP
}

VERSION=""
ARTIFACT=""
SBOM=""
OUTPUT_DIR="release-evidence"

while (($#)); do
	case "$1" in
		--version) VERSION="${2:-}"; shift 2 ;;
		--artifact) ARTIFACT="${2:-}"; shift 2 ;;
		--sbom) SBOM="${2:-}"; shift 2 ;;
		--output-dir) OUTPUT_DIR="${2:-}"; shift 2 ;;
		--help|-h) usage; exit 0 ;;
		*) printf 'ERROR_CODE=INVALID_ARGUMENT\nARG=%s\n' "$1" >&2; exit 2 ;;
	esac
done

[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf 'ERROR_CODE=INVALID_VERSION\n' >&2; exit 2; }
[[ -f "$ARTIFACT" ]] || { printf 'ERROR_CODE=ARTIFACT_NOT_FOUND\n' >&2; exit 2; }
[[ -f "$SBOM" ]] || { printf 'ERROR_CODE=SBOM_NOT_FOUND\n' >&2; exit 2; }

for cmd in git sha256sum node realpath; do
	command -v "$cmd" >/dev/null 2>&1 || { printf 'ERROR_CODE=MISSING_COMMAND\nCOMMAND=%s\n' "$cmd" >&2; exit 1; }
done

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
	printf 'ERROR_CODE=DIRTY_WORKTREE\n' >&2
	printf 'NEXT_ACTION=Commit or remove local changes before generating release provenance.\n' >&2
	exit 1
fi

COMMIT="$(git rev-parse HEAD)"
BRANCH="$(git branch --show-current || true)"
ARTIFACT_ABS="$(realpath "$ARTIFACT")"
SBOM_ABS="$(realpath "$SBOM")"
ARTIFACT_NAME="$(basename "$ARTIFACT_ABS")"
SBOM_NAME="$(basename "$SBOM_ABS")"
ARTIFACT_SHA="$(sha256sum "$ARTIFACT_ABS" | awk '{print $1}')"
SBOM_SHA="$(sha256sum "$SBOM_ABS" | awk '{print $1}')"

if git show-ref --tags --verify --quiet "refs/tags/$VERSION"; then
	TAG_COMMIT="$(git rev-parse "refs/tags/$VERSION^{commit}")"
	if [[ "$TAG_COMMIT" != "$COMMIT" ]]; then
		printf 'ERROR_CODE=TAG_COMMIT_MISMATCH\nTAG_COMMIT=%s\nHEAD_COMMIT=%s\n' "$TAG_COMMIT" "$COMMIT" >&2
		exit 1
	fi
fi

mkdir -p "$OUTPUT_DIR"
CHECKSUMS="$OUTPUT_DIR/checksums.txt"
PROVENANCE="$OUTPUT_DIR/provenance.json"
printf '%s  %s\n%s  %s\n' "$ARTIFACT_SHA" "$ARTIFACT_NAME" "$SBOM_SHA" "$SBOM_NAME" >"$CHECKSUMS"

node - "$PROVENANCE" "$VERSION" "$COMMIT" "$BRANCH" "$ARTIFACT_NAME" "$ARTIFACT_SHA" "$SBOM_NAME" "$SBOM_SHA" <<'NODE'
const fs = require('fs');
const [out, version, commit, branch, artifactName, artifactSha, sbomName, sbomSha] = process.argv.slice(2);
const data = {
  schema: 'positron.release-provenance.v1',
  version,
  commit,
  branch,
  artifact: { name: artifactName, sha256: artifactSha },
  sbom: { name: sbomName, format: 'cyclonedx-json', sha256: sbomSha },
  generated_at: new Date().toISOString(),
  signature: null,
  claims: {
    reproducible_build: false,
    signed_artifact: false,
    slsa_level: null
  }
};
fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
NODE

node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$PROVENANCE"

printf 'PROVENANCE_STATUS=PASS\nVERSION=%s\nCOMMIT=%s\nCHECKSUMS=%s\nPROVENANCE=%s\n' "$VERSION" "$COMMIT" "$CHECKSUMS" "$PROVENANCE"
