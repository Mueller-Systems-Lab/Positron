#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/positron-installer-test.XXXXXX")"
trap 'rm -rf -- "$TMP"' EXIT
FIXTURE="$TMP/fixture"
mkdir -p "$FIXTURE/Positron-v0.2.0/scripts" "$TMP/bin"
for file in scripts/doctor.sh scripts/quickstart.sh scripts/supervised.sh docker-compose.yml docker-compose.quickstart.yml Dockerfile.quickstart nginx.conf; do
	mkdir -p "$FIXTURE/Positron-v0.2.0/$(dirname "$file")"
	cp "$ROOT_DIR/$file" "$FIXTURE/Positron-v0.2.0/$file"
done
mkdir -p "$FIXTURE/Positron-v0.2.0/.positron/quickstart"
printf '%s\n' 'legacy-credential-state' >"$FIXTURE/Positron-v0.2.0/.positron/quickstart/demo.env"
tar -czf "$TMP/release.tar.gz" -C "$FIXTURE" Positron-v0.2.0
cat >"$TMP/bin/docker" <<'FAKE'
#!/usr/bin/env bash
[[ "${1:-}" == info ]] && exit 0
[[ "${1:-}" == compose && "${2:-}" == version ]] && exit 0
exit 1
FAKE
cat >"$TMP/bin/curl" <<'FAKE'
#!/usr/bin/env bash
set -Eeuo pipefail
out=''
for ((i=1; i<=$#; i++)); do
  if [[ "${!i}" == -o ]]; then i=$((i+1)); out="${!i}"; fi
done
url=''
for arg in "$@"; do [[ "$arg" == https://* ]] && url="$arg"; done
if [[ "$url" == *'/releases/tags/'* || "$url" == *'/releases/latest' ]]; then
  cat >"$out" <<'JSON'
{"tag_name":"v0.2.0","draft":false,"prerelease":false,"tarball_url":"https://github.com/Mueller-Systems-Lab/Positron/tarball/v0.2.0","target_commitish":"bb0f32a59e874dffae47b03ddd971d590d66a8fd"}
JSON
else
  cp "$TEST_ARCHIVE" "$out"
fi
FAKE
chmod 755 "$TMP/bin/docker" "$TMP/bin/curl"
printf '#!/usr/bin/env bash\nexit 0\n' >"$TMP/bin/opencode"
printf '#!/usr/bin/env bash\nexit 0\n' >"$TMP/bin/specify"
printf '#!/usr/bin/env bash\nexit 0\n' >"$TMP/bin/gh"
chmod 755 "$TMP/bin/opencode" "$TMP/bin/specify" "$TMP/bin/gh"
run_install() {
  local home="$1" archive="$2"
  TEST_ARCHIVE="$archive" HOME="$home" XDG_DATA_HOME="$home/data" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" XDG_CACHE_HOME="$home/cache" PATH="$TMP/bin:/usr/bin:/bin" bash "$ROOT_DIR/install.sh" --version v0.2.0 --no-start
}
home="$TMP/home with spaces"
mkdir -p "$home"
run_install "$home" "$TMP/release.tar.gz" >/dev/null
test -L "$home/data/positron/current"
test -x "$home/.local/bin/positron"
test -x "$home/data/positron/releases/v0.2.0/scripts/supervised.sh"
GITHUB_TOKEN=ghp-test-token HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="$TMP/bin:/usr/bin:/bin" \
  "$home/.local/bin/positron" configure supervised --repo owner/sandbox --provider local --model free-model --allow-push >"$TMP/configure.out"
grep -q 'Configuration saved securely' "$TMP/configure.out"
test "$(stat -c '%a' "$home/config/positron/supervised.env")" = 600
test "$(stat -c '%a' "$home/config/positron/secrets/github-token")" = 600
! grep -q 'ghp-test-token' "$TMP/configure.out"
! grep -q 'ghp-test-token' "$home/config/positron/supervised.env"
GITHUB_TOKEN=ignored HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="$TMP/bin:/usr/bin:/bin" \
  "$home/.local/bin/positron" doctor --supervised >"$TMP/doctor.out"
grep -q 'GitHub auth: PASS' "$TMP/doctor.out"
! grep -q 'ghp-test-token' "$TMP/doctor.out"
test -L "$home/data/positron/releases/v0.2.0/.positron"
test -f "$home/state/positron/quickstart/demo.env"
grep -q legacy-credential-state "$home/state/positron/quickstart/demo.env"
printf '%s\n' 'credential-state' >"$home/state/positron/quickstart/demo.env"
grep -q 'Installed Positron: v0.2.0' <(HOME="$home" "$home/.local/bin/positron" version)
HOME="$home" "$home/.local/bin/positron" uninstall >/dev/null
test ! -e "$home/data/positron/current"
test -f "$home/state/positron/quickstart/demo.env"
grep -q credential-state "$home/state/positron/quickstart/demo.env"
run_install "$home" "$TMP/release.tar.gz" >/dev/null
before="$(readlink "$home/data/positron/current")"
printf '%s\n' 'existing-release-sentinel' >"$home/data/positron/releases/v0.2.0/sentinel"
run_install "$home" "$TMP/release.tar.gz" >/dev/null
grep -q existing-release-sentinel "$home/data/positron/releases/v0.2.0/sentinel"
printf 'not an archive\n' >"$TMP/bad.tar.gz"
if run_install "$home" "$TMP/bad.tar.gz" >/dev/null 2>&1; then exit 1; fi
test "$(readlink "$home/data/positron/current")" = "$before"
ln -s /etc/passwd "$FIXTURE/Positron-v0.2.0/absolute-link"
tar -czf "$TMP/symlink.tar.gz" -C "$FIXTURE" Positron-v0.2.0
if run_install "$home" "$TMP/symlink.tar.gz" >/dev/null 2>&1; then exit 1; fi
test "$(readlink "$home/data/positron/current")" = "$before"
if HOME="$TMP/no-docker" XDG_DATA_HOME="$TMP/no-docker/data" XDG_CONFIG_HOME="$TMP/no-docker/config" XDG_STATE_HOME="$TMP/no-docker/state" XDG_CACHE_HOME="$TMP/no-docker/cache" PATH="/usr/bin:/bin" bash "$ROOT_DIR/install.sh" --version v0.2.0 >/dev/null 2>&1; then exit 1; fi
if HOME="$TMP/injection" XDG_DATA_HOME="$TMP/injection/data" XDG_CONFIG_HOME="$TMP/injection/config" XDG_STATE_HOME="$TMP/injection/state" XDG_CACHE_HOME="$TMP/injection/cache" PATH="$TMP/bin:/usr/bin:/bin" bash "$ROOT_DIR/install.sh" --version 'v0.2.0;touch /tmp/positron-installer-canary' >/dev/null 2>&1; then exit 1; fi
test ! -e /tmp/positron-installer-canary
printf '%s\n' 'installer tests: PASS (install, spaces, current preservation, invalid archive, missing Docker, injection)'
