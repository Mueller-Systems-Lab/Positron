# Issue #486 — Docker first-build reliability evidence

Status: implementation and fresh-environment proof in progress.

## Environment and protocol

- `REPRO_PROTOCOL_VERSION=issue486.repro.v1`
- Host: Linux x86_64, kernel `6.8.0-124-generic`, 16 CPUs, 16 GiB RAM, no swap.
- Docker Engine `29.6.1`, Compose `v2.24.5`, Buildx `v0.32.1`, BuildKit `v0.31.1`.
- Storage driver: `overlay2`; workspace filesystem reported as `ext2/ext3` by `stat`.
- Free disk at measurement: 782 GiB.
- Builds used `--no-cache`, `--progress=plain`, and bounded command windows; no host-wide prune or destructive cleanup was used.

## Reproduction and baseline

The server no-cache build reproduced the reported experience: after one npm deprecation notice, `npm ci --ignore-scripts` produced no output for several minutes, then completed. The process remained CPU-active and completed successfully.

| Build | Result | Total | Install stage |
| --- | --- | ---: | ---: |
| Server Dockerfile | PASS | 502.0 s | `npm ci` 235.5 s |
| Worker Dockerfile | PASS | 421.3 s | `npm ci` 202.2 s |
| Web Dockerfile | PASS | 188.0 s | `npm install` 165.0 s |
| Parallel Compose, before | PASS | 502.8 s | separate server/worker graphs |

During the parallel baseline BuildKit launched the independent server and worker graphs and their builder/runtime apt stages concurrently. Memory available fell to roughly 2.4–3.3 GiB, with no swap. No OOM, disk-full, or failed network request was observed. The `npm` process used CPU while silent, so the symptom is a long, opaque install/extraction phase rather than an indefinite registry stall.

## Network and npm baseline

- Host DNS resolution: PASS for npm and Docker registries.
- Container DNS/network: PASS; `node:22-slim` started and resolved the registry.
- `npm config get registry`: `https://registry.npmjs.org/`.
- `npm ping`: PASS in 483 ms with bounded fetch timeout/retries.
- Docker Hub HTTPS: PASS (`401` for unauthenticated registry API, expected).
- A large host HTTPS download did not finish inside a 15 s diagnostic window, but registry metadata and npm ping were successful; this was not treated as root cause evidence.

## Root cause decision

`ROOT_CAUSE=DUPLICATED_DEPENDENCY_INSTALL_WORK + PARALLEL_BUILD_RESOURCE_CONTENTION`

`ROOT_CAUSE_CONFIDENCE=HIGH`

The server and worker Dockerfiles each performed `COPY .`, `npm ci --ignore-scripts`, `npm rebuild better-sqlite3`, and `npm run build` in separate graphs. Compose scheduled those graphs concurrently. This duplicated dependency installation and workspace compilation during the first build and increased memory, disk, and registry pressure. DNS, registry reachability, lockfile failure, BuildKit failure, disk exhaustion, and OOM were not supported by observations.

## Selected fix and rejected alternatives

`Dockerfile.quickstart` now owns one shared builder stage. It installs dependencies, rebuilds the native module, and builds the workspace once. `server-runtime` and `worker-runtime` remain separate targets and retain their existing runtime security posture. Compose points both services at those targets.

The quickstart now invokes `docker compose --progress plain build` before detached startup, so the real Docker stage is visible and build failures surface before services are detached.

- npm timeout/retry increase: rejected; no timeout failure was observed.
- BuildKit npm cache mount: rejected as the primary fix; it would not remove the first-build install and would not by itself make detached quickstart progress visible.
- Host resource tuning or privileged/network changes: rejected; unsupported and unnecessary.
- Web Dockerfile changes: rejected; its independent build passed and is outside the diagnosed server/worker path.

## After-build evidence

- Shared server target: PASS; `npm ci`, `npm rebuild`, and `npm run build` each occurred once in the shared graph.
- Shared worker target: the separate no-cache CLI probe was intentionally stopped after the server target proof; the full Compose after-build below is the authoritative paired-target proof.
- Parallel Compose after: PASS, 429.8 s, one shared builder install/build followed by separate runtime assembly; BuildKit log shows worker builder steps cached when server target had completed the shared graph.
- No timeout, retry, TLS, host-network, privileged container, credential mount, or secret-bearing build argument was added.

## Fresh-environment final proof

Pending push and a new clone from the final PR head. The proof must start with no Positron state, no Positron images, and no Positron build cache, then run only the documented doctor, dry-run, quickstart, status, stop, restart, and health/readiness path.

## Security and hygiene review

- Build context continues to exclude `node_modules`, `dist`, `.git`, `.opencode`, `.positron`, release evidence, logs, and test artifacts.
- No `.env`, npm token, Git credential, private host path, or build secret is copied into the builder context by the change.
- Runtime services retain `cap_drop: ALL`, `no-new-privileges`, fake mode, disabled push/merge, and no host network mode.
- The quickstart remains responsible for local secret generation; secrets are not passed to the Docker build.

## Acceptance mapping

| Criterion | Evidence |
| --- | --- |
| Clean stall reproduced | Baseline server/worker builds reproduce the multi-minute silent `npm ci` phase. |
| Root cause identified with high confidence | Controlled network/resource observations plus independent-vs-shared graph comparison. |
| Minimal fix | Shared builder targets and explicit plain progress only. |
| Fresh clone and full quickstart | Pending final remote-head proof. |
| Stop/restart/status/readiness | Pending final remote-head proof. |
