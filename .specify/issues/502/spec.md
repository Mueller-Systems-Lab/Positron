# Issue #502 Specification — Hardened Nginx Startup

## Scope

Make the supervised and quickstart Nginx services start deterministically with the current trusted `nginx:alpine` image while preserving the existing hardened container boundary.

## Acceptance criteria

- Nginx runs as the image's existing non-root runtime identity `101:101`.
- `/var/cache/nginx` and the `/var/run` target (`/run`) are explicit writable tmpfs paths owned by `101:101` with mode `755`.
- `read_only: true`, `no-new-privileges:true`, and `cap_drop: ALL` remain enabled; no capabilities are added.
- Nginx remains limited to the existing `5173` host publication and proxy behavior.
- A deterministic canary validates effective identity, security state, writable paths, readiness, restart behavior, and absence of unexpected host exposure.
- Both supervised and quickstart Compose configurations satisfy the contract.

## Non-goals

No privileged containers, broad capability restoration, security-option disabling, host namespace access, image replacement, release publication, or unrelated refactoring.
