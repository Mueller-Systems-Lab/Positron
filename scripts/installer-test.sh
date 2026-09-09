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
printf '%s\n' "$*" >>"${DOCKER_CALL_LOG:?}"
[[ "${1:-}" == info ]] && exit 0
[[ "${1:-}" == compose && "${2:-}" == version ]] && exit 0
if [[ "${1:-}" == compose ]]; then
  case " $* " in
    *' config --quiet '*) exit 0 ;;
    *' up --detach '*) exit 0 ;;
    *' down '*) exit 0 ;;
    *' ps '*) exit 0 ;;
  esac
fi
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
for arg in "$@"; do [[ "$arg" == http://* || "$arg" == https://* ]] && url="$arg"; done
if [[ "$url" == */api/operator-readiness ]]; then
  printf '%s\n' '{"contract":"positron.operator-readiness.v1","overall_status":"READY_DEMO"}'
  exit 0
fi
if [[ "$url" == *'/releases/tags/'* || "$url" == *'/releases/latest' ]]; then
  cat >"$out" <<'JSON'
{"tag_name":"v0.2.0","draft":false,"prerelease":false,"tarball_url":"https://github.com/Mueller-Systems-Lab/Positron/tarball/v0.2.0","target_commitish":"bb0f32a59e874dffae47b03ddd971d590d66a8fd"}
JSON
else
  cp "$TEST_ARCHIVE" "$out"
fi
FAKE
chmod 755 "$TMP/bin/docker" "$TMP/bin/curl"
export DOCKER_CALL_LOG="$TMP/docker-calls.log"
printf '#!/usr/bin/env bash\nexit 0\n' >"$TMP/bin/opencode"
printf '#!/usr/bin/env bash\nexit 0\n' >"$TMP/bin/specify"
printf '#!/usr/bin/env bash\nexit 0\n' >"$TMP/bin/gh"
chmod 755 "$TMP/bin/opencode" "$TMP/bin/specify" "$TMP/bin/gh"
assert_error_contract() {
  local file="$1" code="$2"
  grep -q "ERROR_CODE=$code" "$file"
  grep -Eq '^WHAT_FAILED=.+$' "$file"
  grep -Eq '^IMPACT=.+$' "$file"
  grep -Eq '^NEXT_ACTION=.+$' "$file"
}
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
test "$(find "$home/state/positron/supervised" -type f 2>/dev/null | wc -l)" = 0
if GITHUB_TOKEN=ghp-test-token HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="/usr/bin:/bin" \
  "$home/.local/bin/positron" configure supervised --repo owner/sandbox --provider local --model free-model >"$TMP/opencode-missing.out" 2>&1; then exit 1; fi
assert_error_contract "$TMP/opencode-missing.out" OPENCODE_NOT_FOUND
mkdir -p "$TMP/opencode-only"
cp "$TMP/bin/opencode" "$TMP/opencode-only/opencode"
if GITHUB_TOKEN=ghp-test-token HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="$TMP/opencode-only:/usr/bin:/bin" \
  "$home/.local/bin/positron" configure supervised --repo owner/sandbox --provider local --model free-model >"$TMP/spec-kit-missing.out" 2>&1; then exit 1; fi
assert_error_contract "$TMP/spec-kit-missing.out" SPECKIT_NOT_FOUND
cp "$home/config/positron/supervised.env" "$TMP/supervised.env.good"
printf '%s\n' 'UNKNOWN_FIELD=must-fail' >>"$home/config/positron/supervised.env"
if HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="$TMP/bin:/usr/bin:/bin" \
  "$home/.local/bin/positron" doctor --supervised >/dev/null 2>&1; then exit 1; fi
grep -q 'SUPERVISED_CONFIG_INVALID' <(HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="$TMP/bin:/usr/bin:/bin" \
  "$home/.local/bin/positron" doctor --supervised 2>&1 || true)
mv "$TMP/supervised.env.good" "$home/config/positron/supervised.env"
mv "$TMP/bin/gh" "$TMP/bin/gh.good"
printf '#!/usr/bin/env bash\nexit 1\n' >"$TMP/bin/gh"
chmod 755 "$TMP/bin/gh"
if HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="$TMP/bin:/usr/bin:/bin" \
  "$home/.local/bin/positron" doctor --supervised >"$TMP/github-auth-invalid.out" 2>&1; then exit 1; fi
assert_error_contract "$TMP/github-auth-invalid.out" GITHUB_AUTH_INVALID
mv "$TMP/bin/gh.good" "$TMP/bin/gh"
cp "$home/config/positron/supervised.env" "$TMP/supervised.env.good"
sed -i 's/^POSITRON_MERGE_KILL_SWITCH=.*/POSITRON_MERGE_KILL_SWITCH=false/' "$home/config/positron/supervised.env"
if HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="$TMP/bin:/usr/bin:/bin" \
  "$home/.local/bin/positron" doctor --supervised >"$TMP/safety-tamper.out" 2>&1; then exit 1; fi
assert_error_contract "$TMP/safety-tamper.out" SUPERVISED_SAFETY_INVALID
mv "$TMP/supervised.env.good" "$home/config/positron/supervised.env"
cp "$home/config/positron/supervised.env" "$TMP/supervised.env.good"
sed -i '/^POSITRON_OPENCODE_MODEL=/d' "$home/config/positron/supervised.env"
if HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="$TMP/bin:/usr/bin:/bin" \
  "$home/.local/bin/positron" doctor --supervised >"$TMP/missing-field.out" 2>&1; then exit 1; fi
assert_error_contract "$TMP/missing-field.out" SUPERVISED_CONFIG_INVALID
mv "$TMP/supervised.env.good" "$home/config/positron/supervised.env"
GITHUB_TOKEN=ignored HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="$TMP/bin:/usr/bin:/bin" \
  "$home/.local/bin/positron" start --supervised >"$TMP/start.out"
grep -q 'supervised runtime started' "$TMP/start.out"
grep -q -- '--project-name positron-supervised' "$DOCKER_CALL_LOG"
grep -q -- "--env-file $home/state/positron/supervised/runtime.env" "$DOCKER_CALL_LOG"
grep -q -- "--file $home/data/positron/releases/v0.2.0/docker-compose.yml" "$DOCKER_CALL_LOG"
test "$(stat -c '%a' "$home/state/positron/supervised/redis-password")" = 600
test "$(stat -c '%a' "$home/state/positron/supervised/admin-token")" = 600
GITHUB_TOKEN=ignored HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="$TMP/bin:/usr/bin:/bin" \
  "$home/.local/bin/positron" stop --supervised >"$TMP/stop.out"
grep -q 'runtime stopped' "$TMP/stop.out"
test ! -e "$home/state/positron/supervised/runtime.env"
mv "$home/config/positron/secrets/github-token" "$TMP/github-token.real"
ln -s /etc/passwd "$home/config/positron/secrets/github-token"
if GITHUB_TOKEN=ghp-replacement HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="$TMP/bin:/usr/bin:/bin" \
  "$home/.local/bin/positron" configure supervised --repo owner/sandbox --provider local --model free-model >"$TMP/token-target.out" 2>&1; then exit 1; fi
grep -q 'ERROR_CODE=SECRET_TARGET_INVALID' "$TMP/token-target.out"
rm -f "$home/config/positron/secrets/github-token"
mv "$TMP/github-token.real" "$home/config/positron/secrets/github-token"
mv "$home/state/positron/supervised/redis-password" "$TMP/redis-password.real"
ln -s /etc/passwd "$home/state/positron/supervised/redis-password"
if HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="$TMP/bin:/usr/bin:/bin" \
  "$home/.local/bin/positron" status --supervised >"$TMP/runtime-target.out" 2>&1; then exit 1; fi
grep -q 'ERROR_CODE=SECRET_TARGET_INVALID' "$TMP/runtime-target.out"
rm -f "$home/state/positron/supervised/redis-password"
mv "$TMP/redis-password.real" "$home/state/positron/supervised/redis-password"
chmod 644 "$home/state/positron/supervised/redis-password"
if HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="$TMP/bin:/usr/bin:/bin" \
  "$home/.local/bin/positron" status --supervised >"$TMP/runtime-permissions.out" 2>&1; then exit 1; fi
grep -q 'ERROR_CODE=SECRET_FILE_PERMISSIONS' "$TMP/runtime-permissions.out"
chmod 600 "$home/state/positron/supervised/redis-password"
if HOME="$TMP/missing-token" XDG_CONFIG_HOME="$TMP/missing-token/config" XDG_STATE_HOME="$TMP/missing-token/state" PATH="$TMP/bin:/usr/bin:/bin" \
  "$home/.local/bin/positron" configure supervised --repo owner/sandbox --provider local --model free-model >"$TMP/missing-token.out" 2>&1; then exit 1; fi
grep -q 'ERROR_CODE=GITHUB_TOKEN_MISSING' "$TMP/missing-token.out"
if GITHUB_TOKEN=ghp-test-token HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="$TMP/bin:/usr/bin:/bin" \
  "$home/.local/bin/positron" configure supervised --repo 'owner/../../escape' --provider local --model free-model >"$TMP/invalid-repo.out" 2>&1; then exit 1; fi
assert_error_contract "$TMP/invalid-repo.out" INVALID_REPOSITORY
if GITHUB_TOKEN=ghp-test-token HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="$TMP/bin:/usr/bin:/bin" \
  "$home/.local/bin/positron" configure supervised --repo owner/sandbox --provider 'bad;provider' --model free-model >"$TMP/invalid-provider.out" 2>&1; then exit 1; fi
assert_error_contract "$TMP/invalid-provider.out" INVALID_PROVIDER
if GITHUB_TOKEN=ghp-test-token HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="$TMP/bin:/usr/bin:/bin" \
  "$home/.local/bin/positron" configure supervised --repo owner/sandbox --provider local --model 'bad model' >"$TMP/invalid-model.out" 2>&1; then exit 1; fi
assert_error_contract "$TMP/invalid-model.out" INVALID_MODEL
ln -s /etc/passwd "$TMP/token-symlink"
if GITHUB_TOKEN= HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" PATH="$TMP/bin:/usr/bin:/bin" \
  "$home/.local/bin/positron" configure supervised --repo owner/sandbox --provider local --model free-model --github-token-file "$TMP/token-symlink" >"$TMP/token-source.out" 2>&1; then exit 1; fi
assert_error_contract "$TMP/token-source.out" SECRET_SOURCE_INVALID
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
