#!/usr/bin/env bash
set -Eeuo pipefail

OUTPUT="${1:-sbom.cdx.json}"

if ! command -v npm >/dev/null 2>&1; then
	printf 'ERROR_CODE=NPM_NOT_FOUND\n' >&2
	exit 1
fi

if [[ ! -f package-lock.json ]]; then
	printf 'ERROR_CODE=PACKAGE_LOCK_NOT_FOUND\n' >&2
	exit 1
fi

TMP="${OUTPUT}.tmp"
rm -f -- "$TMP"

if ! npm sbom --sbom-format cyclonedx >"$TMP"; then
	rm -f -- "$TMP"
	printf 'ERROR_CODE=SBOM_GENERATION_FAILED\n' >&2
	printf 'NEXT_ACTION=Use a supported npm version or an explicitly reviewed SBOM generator.\n' >&2
	exit 1
fi

node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$TMP"
mv -- "$TMP" "$OUTPUT"
printf 'SBOM_STATUS=PASS\nSBOM_PATH=%s\n' "$OUTPUT"
