#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
password='positron-498-regression-secret'
volume='positron-498-redis-regression-data'
container='positron-498-redis-regression'
config_json=$(mktemp)
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -f "$config_json"
}
trap cleanup EXIT

cd "$repo_root"

for compose_file in docker-compose.yml docker-compose.quickstart.yml; do
  REDIS_PASSWORD="$password" POSITRON_ADMIN_TOKEN='positron-498-admin' \
    docker compose -f "$compose_file" config --format json >"$config_json"
  COMPOSE_JSON="$config_json" COMPOSE_FILE_NAME="$compose_file" node <<'NODE'
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync(process.env.COMPOSE_JSON, 'utf8'));
const redis = config.services?.redis;
if (!redis) throw new Error(`${process.env.COMPOSE_FILE_NAME}: redis service missing`);
if (redis.user !== 'redis') throw new Error(`${process.env.COMPOSE_FILE_NAME}: redis must run as the image's non-root redis user`);
if (!redis.security_opt?.includes('no-new-privileges:true')) throw new Error(`${process.env.COMPOSE_FILE_NAME}: no-new-privileges missing`);
if (JSON.stringify(redis.cap_drop) !== JSON.stringify(['ALL'])) throw new Error(`${process.env.COMPOSE_FILE_NAME}: cap_drop must be ALL`);
if (redis.cap_add?.length) throw new Error(`${process.env.COMPOSE_FILE_NAME}: cap_add must be empty`);
if (redis.ports?.length) throw new Error(`${process.env.COMPOSE_FILE_NAME}: Redis must not publish host ports`);
if (!redis.command?.toString().includes('--requirepass')) throw new Error(`${process.env.COMPOSE_FILE_NAME}: Redis auth missing`);
if (!redis.command?.toString().includes('--protected-mode')) throw new Error(`${process.env.COMPOSE_FILE_NAME}: protected mode missing`);
NODE
done

docker volume create "$volume" >/dev/null
docker run -d --name "$container" \
  --user 999:1000 \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  -v "$volume:/data" \
  redis:7-alpine redis-server --requirepass "$password" --protected-mode yes >/dev/null

for _ in {1..20}; do
  if docker exec "$container" redis-cli -a "$password" ping >/dev/null 2>&1; then break; fi
  sleep 1
done
test "$(docker inspect "$container" --format '{{.State.Status}}')" = running
test "$(docker exec "$container" id -u)" = 999
test "$(docker exec "$container" id -g)" = 1000
test "$(docker exec "$container" sh -c "awk '/CapEff/{print \$2}' /proc/1/status")" = 0000000000000000
test "$(docker exec "$container" sh -c "awk '/NoNewPrivs/{print \$2}' /proc/1/status")" = 1
test "$(docker exec "$container" redis-cli -a "$password" ping 2>/dev/null)" = PONG
test "$(docker exec "$container" sh -c 'redis-cli ping 2>&1')" = 'NOAUTH Authentication required.'
test "$(docker exec "$container" redis-cli -a "$password" set positron_acceptance value 2>/dev/null)" = OK
docker stop "$container" >/dev/null
docker start "$container" >/dev/null
for _ in {1..20}; do
  if [ "$(docker inspect "$container" --format '{{.State.Status}}')" = running ]; then break; fi
  sleep 1
done
test "$(docker exec "$container" redis-cli -a "$password" get positron_acceptance 2>/dev/null)" = value
echo 'redis security regression: PASS'
