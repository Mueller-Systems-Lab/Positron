# Restart and crash recovery

Existing durable attempt, queue, workspace-lock, provider-reservation and
approval/reconciliation tests cover stale lease recovery, fencing,
completed-state immutability and idempotent replay. The persistent mutation
lease uses the same SQLite file and generation check across independent DB
connections; stale generations are rejected before the Git writer is called.
The online-backup fixture additionally proves close/reopen semantics for all
release-critical durable records. No production external effect is attempted
by these tests.

| Invariant | Result |
|---|---|
| RESTART_RECOVERY | PASS |
| NO_DOUBLE_JOB_AUTHORITY / NO_DOUBLE_MUTATION_AUTHORITY | PASS |
| STALE_OWNER_REJECTED / EXPIRED_LEASE_RECOVERABLE | PASS |
| COMPLETED_ATTEMPT_NOT_REOPENED | PASS |
| CONSUMED_APPROVAL_NOT_REUSABLE | PASS |
| RECONCILIATION_NOT_DUPLICATED | PASS |
| STALE_GENERATION_WRITER_REJECTED / EXTERNAL_WRITE_CALLED=NO | PASS |
