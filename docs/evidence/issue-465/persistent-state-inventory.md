# Persistent-state inventory

| State | Classification | Backup/restore rule |
|---|---|---|
| `runs`, `run_events`, `artifacts`, command results | DURABLE_REQUIRED / BACKUP_REQUIRED | SQLite online backup; verify identities and event history |
| `cp_queue`, `cp_jobs`, `cp_attempts` | DURABLE_REQUIRED / BACKUP_REQUIRED | preserve state, leases and terminal attempts |
| `cp_decisions`, `cp_decision_reconciliations` | DURABLE_REQUIRED / BACKUP_REQUIRED | never rewrite history or duplicate reconciliation |
| `cp_approval_consumptions` | DURABLE_REQUIRED / BACKUP_REQUIRED | consumption and idempotency keys are never reset |
| attempt/workspace/provider leases and `cp_external_mutation_locks` | DURABLE_REQUIRED / BACKUP_REQUIRED | preserve generation/expiry; stale owners remain fenced |
| `cp_kv` migration ledger | DURABLE_REQUIRED / BACKUP_REQUIRED | migration version is written only after validation |
| runtime environment and non-secret configuration | CONFIGURATION | record names/defaults; restore operator-managed configuration |
| admin/provider/API credentials | SECRET | never put values in DB evidence, backup evidence, logs, or docs |
| active processes, timers, SSE clients, in-memory adapter maps | EPHEMERAL / REGENERABLE | recreate on restart; recovery derives authority from SQLite |
| `dist`, Vite output, caches and test reports | REGENERABLE | rebuild from lockfile and source |
| workspace paths/metadata and provider reservation metadata | DURABLE_REQUIRED | preserve references; validate paths before reuse |

The single control-plane SQLite file at `POSITRON_DB_PATH` is the persistence
authority. No second control plane, Redis lock, or naive live file-copy path is
supported.
