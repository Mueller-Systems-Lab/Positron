# Backup and restore validation

## Supported contract

The service must be quiesced for an operational backup (no new external
effects), but the database backup itself uses SQLite's online backup API. A
raw file copy is not supported while writers are active. Back up the file at
`POSITRON_DB_PATH` to a new destination, retain the backup outside the live
workspace, and never include `.env`, tokens, or credential stores. Restore only
to a fresh regular file, then open it through the normal migration path and
run readiness before accepting work.

## Deterministic proof

`packages/control-plane/src/__tests__/backup.test.ts` creates a synthetic
source containing a run, queue item, job, attempt, decision, reconciliation,
and approval consumption. `backupDatabase` performs the online backup and
checks `PRAGMA integrity_check`; `restoreDatabase` restores into a fresh
location, reapplies migrations, and checks integrity again.

| Requirement | Result |
|---|---|
| BACKUP_CREATED | PASS |
| RESTORE_TO_FRESH_LOCATION | PASS |
| DATABASE_INTEGRITY | PASS |
| RUNS/JOBS/ATTEMPTS/DECISIONS | PASS |
| RECONCILIATIONS/APPROVAL_CONSUMPTIONS | PASS |
| NO_SECRET_LEAKAGE | PASS (fixture contains no secrets) |
| RESTORE_FAILURES_FAIL_CLOSED | PASS for missing source, existing target, symlink, corrupt/invalid source paths |

Production/user DB data was not used.
