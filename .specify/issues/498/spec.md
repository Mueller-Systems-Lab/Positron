# Issue #498 Specification — Least-Privilege Redis Startup

## Scope

Fix only the Redis startup failure caused by the official image's root-start privilege transition under `no-new-privileges:true` and `cap_drop: ALL`.

## Acceptance criteria

- Redis is configured with the image's non-root runtime identity (`redis`, currently `999:1000`).
- Redis keeps `no-new-privileges:true`, `cap_drop: ALL`, internal-only networking, `requirepass`, and protected mode.
- Redis starts and becomes healthy on a new named volume.
- Authenticated write, restart, and read-back persistence succeed.
- The existing root-created volume remains compatible without a migration service.
- A deterministic contract check and executable Docker canary prevent regression.

## Non-goals

No capability restoration, `privileged` mode, `SKIP_DROP_PRIVS`, image pinning, host port, release metadata, or product feature work.
