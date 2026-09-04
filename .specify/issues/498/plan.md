# Issue #498 Plan

1. Reproduce the real Compose Redis failure and inspect the effective image identity, entrypoint, and `/data` ownership.
2. Run the A/B/C capability matrix on disposable containers, including auth and persistence for the non-root variant.
3. Add `user: redis` to both runtime Compose Redis services, preserving all hardening and auth settings while resolving the image's actual UID/GID at runtime.
4. Add a contract validator plus an executable Redis startup/persistence/security canary.
5. Run focused canaries, Compose validation, repository checks, and supervised/demo qualification where the local operator environment permits.
6. Record evidence and acceptance mapping in Issue #498, then prepare the narrow PR.
