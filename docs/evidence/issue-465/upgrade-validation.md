# Upgrade validation

Supported path: verify the source is a supported V1–V6 control-plane database;
quiesce the service; create an SQLite online backup; install the new package;
open the DB through `openDatabase` and apply control-plane migrations; start;
check `/api/health` and `/api/readiness`; then verify runs, jobs, attempts,
decisions, reconciliations, approvals and leases. A migration failure is
fail-closed and must be recovered by restoring the pre-upgrade backup.

Downgrade is not supported after migration. Rollback means stop the service,
move the failed target aside, restore the verified backup to a fresh target,
and restart the old binary. No automatic rollback, tag, deployment or package
publication is part of #465.

UPGRADE_PATH=PASS. The deterministic migration and backup fixtures provide the
OLD_FIXTURE → BACKUP → NEW_CODE → MIGRATE → VERIFY proof without production
data.
