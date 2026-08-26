# Issue #211 — Docker Demo Installation Evidence

**Verification date:** 2026-08-26
**Base under test:** `105cb8b2512493057bcce79b397ba8a76d5733a8` plus PR B changes
**Mode:** local fake/demo only

## Legacy reproduction

From a clean checkout, the documented legacy sequence was checked:

```sh
cp .env.example apps/server/.env
docker compose up --build
```

`docker compose config` fails before startup because the legacy Compose file
requires host interpolation for `REDIS_PASSWORD`. The legacy file also
requires `POSITRON_ADMIN_TOKEN` and mounts host-specific OpenCode, SpecKit,
configuration, and home directories even when fake adapters are selected.

This is retained as historical evidence; the quickstart does not patch the
legacy stack in place.

## Safe demo path

The dedicated `docker-compose.quickstart.yml` uses fake GitHub, SpecKit, and
OpenCode adapters; an internal password-protected Redis service; named Docker
volumes; no host tool mounts; disabled push and merge; enabled merge kill
switch; and a disabled fix loop. The demo-only live fixture endpoint is
explicitly enabled to support local route smoke and screenshots.

The one-command Linux path is:

```sh
./scripts/quickstart.sh
```

It creates `.positron/quickstart/demo.env` with cryptographically random local
credentials, keeps that path ignored and mode `0600`, waits for
`http://localhost:5173/api/health`, and prints only the public local URL.

## Executed proof

| Check | Result |
| --- | --- |
| Compose syntax (`./scripts/quickstart.sh --dry-run`) | PASS |
| First clean build and start | PASS |
| API health through Nginx | PASS — `{"status":"ok","mode":"fake"}` |
| Service health | PASS — Redis, server, web, and Nginx healthy |
| Local demo fixture | PASS — one run created without external credentials |
| Route smoke | PASS — 9/9 existing routes |
| Narrow viewport capture | PASS — 390×844 viewport, no page/console errors |
| Status command | PASS |
| Stop command | PASS — volumes and ignored local env retained |
| Repeat start | PASS — existing running stack is reused and health rechecked |
| Manual secret edits | 0 |
| Git ignore check | PASS — `.positron/quickstart/demo.env` is ignored |

The initial clean build took approximately 3 minutes on the verification
machine, dominated by dependency installation. Repeat startup reuses built
images and does not rebuild an already-running stack.
