# Operational recovery runbook

- DB unavailable/corrupt: stop intake, preserve logs, do not create a blank DB;
  restore the last verified backup to a fresh regular path and run readiness.
- Migration failure: keep the source backup, isolate the failed target, and
  restore; downgrade by binary replacement alone is unsupported.
- Stale mutation lease/worker crash: wait for bounded expiry, let startup
  recovery reclaim it, and investigate the old owner; never manually reuse a
  fencing generation.
- Provider failure or approval mismatch: leave the attempt durable and blocked;
  require a new valid approval/effect binding rather than replaying one.
- Workspace lock conflict: inspect the active owner and expiry; do not delete
  another owner's lock or workspace.
- E2E port conflict: use the hermetic test ports/configuration and terminate
  only the test-owned processes.
- Configuration failure: correct the environment without logging values;
  missing auth, invalid leases and unsupported modes fail closed.

Recovery is complete only after `/api/health` is alive, `/api/readiness` is
ready, integrity is `ok`, and durable state counts/identities match the backup.
