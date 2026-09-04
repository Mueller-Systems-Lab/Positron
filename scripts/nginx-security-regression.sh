#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
container='positron-502-nginx-regression'
network='positron-502-nginx-regression-network'
config=$(mktemp)
compose_json=$(mktemp)
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -f "$config" "$compose_json"
}
trap cleanup EXIT

cat >"$config" <<'NGINX'
events {}
http {
  server {
    listen 8080;
    location /health { return 200 'nginx security regression: PASS\n'; }
  }
}
NGINX
chmod 644 "$config"

cd "$repo_root"
for compose_file in docker-compose.yml docker-compose.quickstart.yml; do
  REDIS_PASSWORD='positron-502-regression-secret' POSITRON_ADMIN_TOKEN='positron-502-admin' \
    docker compose -f "$compose_file" config --format json >"$compose_json"
  COMPOSE_JSON="$compose_json" COMPOSE_FILE_NAME="$compose_file" node <<'NODE'
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync(process.env.COMPOSE_JSON, 'utf8'));
const nginx = config.services?.nginx;
if (!nginx) throw new Error(`${process.env.COMPOSE_FILE_NAME}: nginx service missing`);
if (nginx.user !== '101:101') throw new Error(`${process.env.COMPOSE_FILE_NAME}: nginx must run as 101:101`);
if (nginx.read_only !== true) throw new Error(`${process.env.COMPOSE_FILE_NAME}: read_only must remain enabled`);
if (!nginx.security_opt?.includes('no-new-privileges:true')) throw new Error(`${process.env.COMPOSE_FILE_NAME}: no-new-privileges missing`);
if (JSON.stringify(nginx.cap_drop) !== JSON.stringify(['ALL'])) throw new Error(`${process.env.COMPOSE_FILE_NAME}: cap_drop must be ALL`);
if (nginx.cap_add?.length) throw new Error(`${process.env.COMPOSE_FILE_NAME}: cap_add must be empty`);
if (JSON.stringify(nginx.tmpfs) !== JSON.stringify(['/var/cache/nginx:uid=101,gid=101,mode=755','/run:uid=101,gid=101,mode=755'])) throw new Error(`${process.env.COMPOSE_FILE_NAME}: writable paths are not explicit 101:101 tmpfs mounts`);
const ports = nginx.ports?.map((entry) => `${entry.target}:${entry.published}`) ?? [];
if (ports.length !== 1 || ports[0] !== '5173:5173') throw new Error(`${process.env.COMPOSE_FILE_NAME}: unexpected Nginx host exposure`);
NODE
done

docker network create --internal "$network" >/dev/null
docker run -d --name "$container" --network "$network" \
  --user 101:101 --security-opt no-new-privileges:true --cap-drop ALL --read-only \
  --tmpfs /var/cache/nginx:uid=101,gid=101,mode=755 \
  --tmpfs /run:uid=101,gid=101,mode=755 \
  -v "$config:/etc/nginx/nginx.conf:ro" nginx:alpine >/dev/null

for _ in {1..20}; do
  if docker exec "$container" wget -qO- http://127.0.0.1:8080/health >/dev/null 2>&1; then break; fi
  sleep 1
done
test "$(docker inspect "$container" --format '{{.State.Status}}')" = running
test "$(docker exec "$container" id -u)" = 101
test "$(docker exec "$container" id -g)" = 101
test "$(docker exec "$container" sh -c "awk '/CapEff/{print \$2}' /proc/1/status")" = 0000000000000000
test "$(docker exec "$container" sh -c "awk '/NoNewPrivs/{print \$2}' /proc/1/status")" = 1
test "$(docker exec "$container" stat -c '%u:%g:%a' /var/cache/nginx)" = 101:101:755
test "$(docker exec "$container" stat -c '%u:%g:%a' /run)" = 101:101:755
test "$(docker exec "$container" wget -qO- http://127.0.0.1:8080/health)" = 'nginx security regression: PASS'
docker restart "$container" >/dev/null
for _ in {1..20}; do
  if docker exec "$container" wget -qO- http://127.0.0.1:8080/health >/dev/null 2>&1; then break; fi
  sleep 1
done
test "$(docker inspect "$container" --format '{{.State.Status}}')" = running
echo 'nginx security regression: PASS'
