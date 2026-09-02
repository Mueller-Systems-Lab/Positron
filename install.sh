#!/usr/bin/env bash
set -Eeuo pipefail

# positron.installer.v1 — stable release installer; no root, sudo, Git, Node or npm.
INSTALLER_VERSION=1
REPO="Mueller-Systems-Lab/Positron"
API_BASE="https://api.github.com/repos/$REPO/releases"
TAG=""
TMP_DIR=""

die() {
	local code="$1"; shift
	printf 'ERROR_CODE=%s\nWHAT_FAILED=%s\nIMPACT=%s\nNEXT_ACTION=%s\n' "$code" "$1" "$2" "$3" >&2
	exit 1
}

cleanup() { [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]] && rm -rf -- "$TMP_DIR"; }
trap cleanup EXIT

usage() {
	cat <<'HELP'
Positron installer v1

Usage: bash install.sh [--version vX.Y.Z]

Downloads the latest stable Positron GitHub release and installs it in
user-owned XDG directories. Review this file before running it.
Integrity: HTTPS_GITHUB_ONLY (the current release has no published digest).
HELP
}

require_command() { command -v "$1" >/dev/null 2>&1 || die "${2:-MISSING_$1}" "required command is unavailable: $1" "installation cannot continue" "install $1 using your distribution's documented method, then retry"; }

download_url() {
	local url="$1" destination="$2"
	if command -v curl >/dev/null 2>&1; then
		HTTPS_PROXY='' HTTP_PROXY='' ALL_PROXY='' curl --fail --silent --show-error --location --max-time 300 --proto '=https' --proto-redir '=https' "$url" -o "$destination"
	else
		HTTPS_PROXY='' HTTP_PROXY='' ALL_PROXY='' wget --https-only --max-redirect=5 --timeout=30 --tries=1 -O "$destination" "$url"
	fi
}

check_runtime() {
	require_command docker DOCKER_NOT_FOUND
	docker info >/dev/null 2>&1 || die DOCKER_DAEMON_UNAVAILABLE "Docker daemon is not reachable" "no files were installed" "start Docker and retry; no sudo action was attempted"
	docker compose version >/dev/null 2>&1 || die COMPOSE_V2_NOT_FOUND "Docker Compose v2 is unavailable" "no files were installed" "enable/install Compose v2 using Docker's documented method"
}

validate_tag() {
	[[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die INVALID_VERSION "release version is not a stable semantic tag: $1" "arbitrary release selection is refused" "use --version vX.Y.Z or omit it for latest stable"
}

json_field() {
	local field="$1" file="$2"
	case "$field" in
		draft|prerelease) sed -n "s/.*\"$field\"[[:space:]]*:[[:space:]]*\([^,}]*\).*/\1/p" "$file" | tr -d '[:space:]' | head -1 ;;
		*) sed -n "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$file" | head -1 ;;
	esac
}

https_url() {
	case "$1" in
		https://api.github.com/*|https://github.com/*|https://codeload.github.com/*) return 0 ;;
		*) return 1 ;;
	esac
}

resolve_release() {
	local metadata
	metadata="$TMP_DIR/release.json"
	local endpoint="$API_BASE/latest"
	if [[ -n "$TAG" ]]; then endpoint="$API_BASE/tags/$TAG"; fi
	download_url "$endpoint" "$metadata" || die RELEASE_NOT_FOUND "GitHub stable release metadata could not be downloaded" "no release was installed or changed" "check network access and retry"
	local draft prerelease tag archive
	tag="$(json_field tag_name "$metadata")"
	draft="$(json_field draft "$metadata")"
	prerelease="$(json_field prerelease "$metadata")"
	archive="$(json_field tarball_url "$metadata")"
	[[ -n "$tag" ]] || die RELEASE_NOT_FOUND "release metadata has no tag" "installation stopped before activation" "retry against the official GitHub repository"
	validate_tag "$tag"
	[[ "$draft" == false && "$prerelease" == false ]] || die RELEASE_NOT_STABLE "resolved release is draft or prerelease: $tag" "stable-only installation refused" "omit --version or select a published stable tag"
	if [[ -z "$archive" ]] || ! https_url "$archive"; then
		die DOWNLOAD_FAILED "release archive URL is not an allowlisted HTTPS GitHub URL" "arbitrary download hosts are refused" "retry later or inspect the release metadata"
	fi
	case "$archive" in https://api.github.com/*|https://github.com/*) ;; *) die DOWNLOAD_FAILED "release archive URL has an unexpected host" "arbitrary download hosts are refused" "retry later" ;; esac
	TAG="$tag"
	ARCHIVE_URL="$archive"
}

validate_archive() {
	local archive="$1" listing entry type root=""
	listing="$TMP_DIR/listing"
	tar -tzf "$archive" >"$listing" 2>/dev/null || die ARCHIVE_INVALID "downloaded release is not a valid tar archive" "existing installation was left unchanged" "retry the download"
	while IFS= read -r entry; do
		[[ -n "$entry" ]] || continue
		[[ "$entry" != /* && "$entry" != *$'\n'* && "$entry" != ../* && "$entry" != */../* && "$entry" != *'/..' ]] || die ARCHIVE_PATH_TRAVERSAL "archive contains a path outside its root: $entry" "existing installation was left unchanged" "use a trusted stable release"
		if [[ -z "$root" ]]; then root="${entry%%/*}"; fi
		[[ "$entry" == "$root" || "$entry" == "$root"/* ]] || die ARCHIVE_INVALID "archive has multiple top-level roots" "existing installation was left unchanged" "use a trusted stable release"
	done <"$listing"
	[[ -n "$root" ]] || die ARCHIVE_INVALID "release archive is empty" "existing installation was left unchanged" "retry the download"
	while IFS= read -r entry; do
		type="${entry:0:1}"
		[[ "$type" != l && "$type" != h ]] || die SYMLINK_ESCAPE "archive contains a symlink or hardlink" "existing installation was left unchanged" "use a trusted stable release"
	done < <(tar -tvzf "$archive" 2>/dev/null || true)
}

download_release() {
	local archive="$TMP_DIR/release.tar.gz"
	download_url "$ARCHIVE_URL" "$archive" || die DOWNLOAD_FAILED "release archive download failed" "existing installation was left unchanged" "check network access and retry"
	validate_archive "$archive"
}

install_files() {
	local data_root="${XDG_DATA_HOME:-$HOME/.local/share}/positron"
	local config_root="${XDG_CONFIG_HOME:-$HOME/.config}/positron"
	local state_root="${XDG_STATE_HOME:-$HOME/.local/state}/positron"
	local cache_root="${XDG_CACHE_HOME:-$HOME/.cache}/positron"
	local releases="$data_root/releases" final="$data_root/releases/$TAG" staging="$TMP_DIR/staging"
	local cli="$HOME/.local/bin/positron"
	mkdir -p "$releases" "$config_root" "$state_root" "$cache_root" "$HOME/.local/bin" || die INSTALL_DIR_NOT_WRITABLE "required user-owned installation directories are not writable" "existing installation was left unchanged" "choose writable XDG paths and retry"
	mkdir -p "$staging"
	tar -xzf "$TMP_DIR/release.tar.gz" --strip-components=1 -C "$staging" || die ARCHIVE_INVALID "release extraction failed" "existing installation was left unchanged" "retry the download"
	for required in scripts/doctor.sh scripts/quickstart.sh docker-compose.quickstart.yml Dockerfile.quickstart nginx.conf; do
		[[ -f "$staging/$required" ]] || die REQUIRED_CONTENT_MISSING "release is missing required file: $required" "existing installation was left unchanged" "select a complete stable release"
	done
	[[ -x "$staging/scripts/quickstart.sh" || -f "$staging/scripts/quickstart.sh" ]] || die REQUIRED_CONTENT_MISSING "quickstart script is unavailable" "existing installation was left unchanged" "select a complete stable release"
	chmod 755 "$staging/scripts/doctor.sh" "$staging/scripts/quickstart.sh"
	if [[ -d "$final" ]]; then
		# A published tag is immutable for this installer: retain an existing
		# complete release instead of deleting the current target on reinstall.
		rm -rf -- "$staging"
	else
		mv -- "$staging" "$final" || die INSTALL_ACTIVATION_FAILED "release could not be activated" "existing current target was not changed" "check the user-owned data directory and retry"
	fi
	ln -sfn "$final" "$data_root/current.tmp"
	mv -Tf -- "$data_root/current.tmp" "$data_root/current"
	cat >"$cli" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
INSTALLER_VERSION=$INSTALLER_VERSION
POSITRON_VERSION='$TAG'
	POSITRON_RELEASE_COMMIT='unavailable from GitHub source-archive metadata'
POSITRON_ROOT='$final'
POSITRON_APP_ROOT='$data_root'
POSITRON_STATE='$state_root'
POSITRON_CONFIG='$config_root'
POSITRON_CACHE='$cache_root'
quickstart() { POSITRON_QUICKSTART_ROOT="\$POSITRON_ROOT" POSITRON_QUICKSTART_STATE_DIR="\$POSITRON_STATE/quickstart" "\$POSITRON_ROOT/scripts/quickstart.sh" "\$@"; }
doctor() { POSITRON_QUICKSTART_ROOT="\$POSITRON_ROOT" "\$POSITRON_ROOT/scripts/doctor.sh" "\$@"; }
http_get() { if command -v curl >/dev/null 2>&1; then curl --fail --silent --show-error --max-time 5 "\$1"; else wget --timeout=5 --tries=1 -qO- "\$1"; fi; }
readiness() { http_get http://localhost:5173/api/operator-readiness; }
die_cli() { printf 'ERROR_CODE=%s\nWHAT_FAILED=%s\nIMPACT=%s\nNEXT_ACTION=%s\n' "\$1" "\$2" "\$3" "\$4" >&2; exit 1; }
case "\${1:-help}" in
  help|-h|--help) printf '%s\n' 'Usage: positron {start|stop|status|doctor|open|version|uninstall|help}' ;;
  version) printf 'Installed Positron: %s\nRelease commit: %s\nInstaller schema: positron.installer.v1\n' "\$POSITRON_VERSION" "\$POSITRON_RELEASE_COMMIT" ;;
  start) quickstart; readiness >/dev/null || die_cli READINESS_BLOCKED 'operator readiness is unavailable' 'the UI may be unhealthy or blocked' 'run positron doctor and positron status' ;;
  stop) quickstart --stop ;;
  status) quickstart --status; if http_get http://localhost:5173/api/operator-readiness >/dev/null 2>&1; then printf '%s\n' 'Operator readiness: PASS'; else printf '%s\n' 'Operator readiness: not ready'; fi ;;
  doctor) shift; doctor "\${@:---demo}" ;;
  open) http_get http://localhost:5173/api/health >/dev/null || die_cli HEALTH_FAILED 'Positron is not healthy' 'browser was not opened' 'run positron start'; if command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:5173 >/dev/null 2>&1 & else printf '%s\n' 'Open Positron at http://localhost:5173'; fi ;;
  uninstall) [[ "\${2:-}" != --purge ]] || die_cli PURGE_NOT_IMPLEMENTED 'purge is not implemented' 'persistent data is protected' 'remove application files with plain positron uninstall'; rm -rf -- "\$POSITRON_APP_ROOT/releases"; rm -f -- "\$POSITRON_APP_ROOT/current" "\$HOME/.local/bin/positron"; if [[ -f '${XDG_DATA_HOME:-$HOME/.local/share}/applications/positron.desktop' ]]; then rm -f -- '${XDG_DATA_HOME:-$HOME/.local/share}/applications/positron.desktop'; fi; printf '%s\n' 'Positron application removed; configuration, state, cache, and Docker volumes were preserved.' ;;
  *) die_cli UNKNOWN_COMMAND "unknown command: \$1" 'no action was taken' 'run positron help' ;;
esac
EOF
	chmod 755 "$cli"
	if [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" && -x "$(command -v xdg-open 2>/dev/null || true)" ]]; then
		mkdir -p "${XDG_DATA_HOME:-$HOME/.local/share}/applications"
		cat >"${XDG_DATA_HOME:-$HOME/.local/share}/applications/positron.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Positron
Comment=Evidence-gated coding orchestration
Exec="$cli" open
Terminal=false
Categories=Development;
EOF
		DESKTOP_STATUS='installed'
	else DESKTOP_STATUS='skipped (headless or xdg-open unavailable)'; fi
	printf 'Positron Installer v%s\nVersion: %s\nRelease integrity: HTTPS_GITHUB_ONLY\nApplication files: %s\nLauncher: %s\nDesktop integration: %s\n' "$INSTALLER_VERSION" "$TAG" "$final" "$cli" "$DESKTOP_STATUS"
}

while (($#)); do case "$1" in --version) (($# >= 2)) || die INVALID_VERSION "--version requires a value" "installation stopped before download" "use --version vX.Y.Z"; TAG="$2"; validate_tag "$TAG"; shift 2 ;; --help|-h) usage; exit 0 ;; *) die INVALID_ARGUMENT "unknown argument: $1" "installation stopped before download" "run bash install.sh --help" ;; esac; done
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then die DOWNLOAD_TOOL_MISSING 'curl or wget is required' 'no files were installed' 'install curl or wget using your distribution method, then retry'; fi
require_command tar ARCHIVE_TOOL_MISSING
[[ -n "${HOME:-}" && -d "$HOME" && -w "$HOME" ]] || die INSTALL_DIR_NOT_WRITABLE 'HOME is missing or not writable' 'no files were installed' 'use a writable user home directory'
[[ "$(uname -s)" == Linux ]] || die UNSUPPORTED_OS 'only Linux is supported by installer v1' 'no files were installed' 'use the documented Linux installer path'
[[ "$(uname -m)" == x86_64 ]] || die UNSUPPORTED_ARCH 'only Linux x86_64 is qualified by installer v1' 'no files were installed' 'use a qualified x86_64 machine'
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/positron-installer.XXXXXX")" || die TEMP_DIR_FAILED 'unable to create a private staging directory' 'no files were installed' 'check temporary directory permissions'
check_runtime
resolve_release
download_release
install_files
printf '%s\n' "Next: add $HOME/.local/bin to PATH if needed, then run: positron start"
